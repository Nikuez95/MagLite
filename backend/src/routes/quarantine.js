const db = require('../config/db');
const { resolveUserAccess, hasPermission, canAccessCustomer } = require('../utils/permissions');

async function quarantineRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.addHook('preHandler', async (request, reply) => {
    const caller = await resolveUserAccess(request.user.id, db);
    if (!caller) {
      return reply.code(401).send({ error: 'Utente non autorizzato' });
    }
    request.callerAccess = caller;
  });

  // GET /api/quarantine - Ritorna merce attualmente in quarantena + registro storico blocchi/sblocchi
  fastify.get('/', async (request, reply) => {
    const caller = request.callerAccess;
    if (!hasPermission(caller, 'view_quarantine') && !hasPermission(caller, 'quarantine_manage') && !hasPermission(caller, 'view_products')) {
      return reply.code(403).send({ error: 'Accesso negato al Registro Quarantene.' });
    }

    try {
      const [activePallets] = await db.query(`
        SELECT p.*, pr.sku, pr.name as product_name, COALESCE(p.pallet_uom, pr.uom) as uom,
               c.business_name as customer_name, l.zone, l.col, l.pos
        FROM PALLETS p
        JOIN PRODUCTS pr ON p.product_id = pr.id
        JOIN CUSTOMERS c ON p.customer_id = c.id
        LEFT JOIN LOCATIONS l ON p.location = l.barcode
        WHERE p.is_quarantined = TRUE AND p.status != 'SHIPPED'
        ORDER BY p.quarantined_at DESC, p.id DESC
      `);

      const [logs] = await db.query(`
        SELECT * FROM QUARANTINE_LOGS
        ORDER BY blocked_at DESC, id DESC
      `);

      const uniqueCustomers = new Set(activePallets.map(p => p.customer_id));
      const activeQuantity = activePallets.reduce((acc, p) => acc + (parseFloat(p.quantity) || 0), 0);
      const totalReleased = logs.filter(l => l.status === 'RELEASED').length;

      return {
        activePallets,
        logs,
        stats: {
          activeCount: activePallets.length,
          activeQuantity,
          totalBlocks: logs.length,
          totalReleased,
          customersAffected: uniqueCustomers.size
        }
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore nel caricamento del registro quarantene' });
    }
  });

  // POST /api/quarantine/block - Mette in quarantena una o più palette / intero lotto / articolo
  fastify.post('/block', async (request, reply) => {
    const caller = request.callerAccess;
    if (!hasPermission(caller, 'quarantine_manage')) {
      return reply.code(403).send({ error: 'Accesso negato: il tuo ruolo non possiede il permesso di bloccare merce in quarantena.' });
    }

    const { pallet_ids, pallet_id, pallet_code, pallet_codes, product_id, batch, reason, notes } = request.body || {};
    const cleanReason = String(reason || '').trim();
    const cleanNotes = notes && String(notes).trim() !== '' ? String(notes).trim() : null;

    if (!cleanReason) {
      return reply.code(400).send({ error: 'Il motivo di blocco in quarantena è obbligatorio.' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      let targetPallets = [];

      const effectiveIds = [];
      if (Array.isArray(pallet_ids) && pallet_ids.length > 0) {
        effectiveIds.push(...pallet_ids);
      } else if (pallet_id !== undefined && pallet_id !== null && pallet_id !== '') {
        effectiveIds.push(pallet_id);
      }

      const effectiveCodes = [];
      if (Array.isArray(pallet_codes) && pallet_codes.length > 0) {
        effectiveCodes.push(...pallet_codes);
      } else if (pallet_code && String(pallet_code).trim() !== '') {
        effectiveCodes.push(String(pallet_code).trim());
      }

      if (effectiveIds.length > 0) {
        const [rows] = await connection.query(`
          SELECT p.*, pr.sku, pr.name as product_name, COALESCE(p.pallet_uom, pr.uom) as uom, c.business_name as customer_name
          FROM PALLETS p
          JOIN PRODUCTS pr ON p.product_id = pr.id
          JOIN CUSTOMERS c ON p.customer_id = c.id
          WHERE p.id IN (?) AND (p.status IS NULL OR p.status != 'SHIPPED')
        `, [effectiveIds]);
        targetPallets = rows;
      } else if (effectiveCodes.length > 0) {
        const [rows] = await connection.query(`
          SELECT p.*, pr.sku, pr.name as product_name, COALESCE(p.pallet_uom, pr.uom) as uom, c.business_name as customer_name
          FROM PALLETS p
          JOIN PRODUCTS pr ON p.product_id = pr.id
          JOIN CUSTOMERS c ON p.customer_id = c.id
          WHERE p.pallet_code IN (?) AND (p.status IS NULL OR p.status != 'SHIPPED')
        `, [effectiveCodes]);
        targetPallets = rows;
      } else if (product_id) {
        let q = `
          SELECT p.*, pr.sku, pr.name as product_name, COALESCE(p.pallet_uom, pr.uom) as uom, c.business_name as customer_name
          FROM PALLETS p
          JOIN PRODUCTS pr ON p.product_id = pr.id
          JOIN CUSTOMERS c ON p.customer_id = c.id
          WHERE p.product_id = ? AND (p.status IS NULL OR p.status != 'SHIPPED') AND p.quantity > 0
        `;
        const qParams = [product_id];
        if (batch && batch !== 'TUTTI') {
          q += ` AND TRIM(p.batch) = TRIM(?)`;
          qParams.push(batch);
        }
        const [rows] = await connection.query(q, qParams);
        targetPallets = rows;
      }

      if (targetPallets.length === 0) {
        await connection.rollback();
        connection.release();
        return reply.code(404).send({ error: 'Nessuna paletta attiva trovata per il blocco in quarantena.' });
      }

      // Verifica restrizioni cliente
      for (const pal of targetPallets) {
        if (!canAccessCustomer(caller, pal.customer_id)) {
          await connection.rollback();
          connection.release();
          return reply.code(403).send({
            error: `Accesso negato: non sei autorizzato ad operare sulla merce del cliente "${pal.customer_name}".`
          });
        }
      }

      const toBlock = targetPallets.filter(p => !p.is_quarantined);
      if (toBlock.length === 0) {
        await connection.rollback();
        connection.release();
        return reply.code(400).send({ error: 'Le palette selezionate sono già in stato di quarantena.' });
      }

      const idsToUpdate = toBlock.map(p => p.id);
      await connection.query(
        `UPDATE PALLETS
         SET is_quarantined = TRUE,
             quarantine_reason = ?,
             quarantined_at = CURRENT_TIMESTAMP,
             quarantined_by = ?,
             quarantine_notes = ?
         WHERE id IN (?)`,
        [cleanReason, caller.username, cleanNotes, idsToUpdate]
      );

      for (const pal of toBlock) {
        await connection.query(
          `INSERT INTO QUARANTINE_LOGS
           (pallet_id, pallet_code, product_id, product_name, sku, customer_id, customer_name, batch, quantity, uom, location, status, block_reason, block_notes, blocked_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUARANTINED', ?, ?, ?)`,
          [
            pal.id,
            pal.pallet_code,
            pal.product_id,
            pal.product_name,
            pal.sku,
            pal.customer_id,
            pal.customer_name,
            pal.batch || null,
            pal.quantity,
            pal.uom || 'Pezzi',
            pal.location || 'IN ATTESA',
            cleanReason,
            cleanNotes,
            caller.username
          ]
        );
      }

      const summaryCodes = [...new Set(toBlock.map(p => p.pallet_code))].join(', ');
      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        [
          'QUARANTINE_BLOCK',
          `Bloccate in QUARANTENA ${toBlock.length} palette (${summaryCodes}) - Motivo: ${cleanReason}`,
          'Gestionale',
          caller.username
        ]
      );

      await connection.commit();
      connection.release();

      if (fastify.io) {
        fastify.io.emit('quarantine_updated');
        fastify.io.emit('stow_updated');
        fastify.io.emit('dashboard_update');
      }

      return {
        success: true,
        blocked_count: toBlock.length,
        message: `${toBlock.length} palett${toBlock.length === 1 ? 'a posta' : 'e poste'} in quarantena.`
      };
    } catch (err) {
      if (connection) {
        await connection.rollback();
        connection.release();
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante il blocco in quarantena' });
    }
  });

  // POST /api/quarantine/unblock - Sblocca una o più palette dalla quarantena
  fastify.post('/unblock', async (request, reply) => {
    const caller = request.callerAccess;
    if (!hasPermission(caller, 'quarantine_manage')) {
      return reply.code(403).send({ error: 'Accesso negato: il tuo ruolo non possiede il permesso di sbloccare merce dalla quarantena.' });
    }

    const { pallet_ids, pallet_id, pallet_code, pallet_codes, log_id, unblock_reason, reason, unblock_notes, notes } = request.body || {};
    const cleanUnblockReason = String(unblock_reason || reason || '').trim();
    const cleanUnblockNotes = (unblock_notes || notes) && String(unblock_notes || notes).trim() !== '' ? String(unblock_notes || notes).trim() : null;

    if (!cleanUnblockReason) {
      return reply.code(400).send({ error: 'Il motivo di sblocco dalla quarantena è obbligatorio.' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      let targetPallets = [];

      const effectiveIds = [];
      if (Array.isArray(pallet_ids) && pallet_ids.length > 0) {
        effectiveIds.push(...pallet_ids);
      } else if (pallet_id !== undefined && pallet_id !== null && pallet_id !== '') {
        effectiveIds.push(pallet_id);
      }

      const effectiveCodes = [];
      if (Array.isArray(pallet_codes) && pallet_codes.length > 0) {
        effectiveCodes.push(...pallet_codes);
      } else if (pallet_code && String(pallet_code).trim() !== '') {
        effectiveCodes.push(String(pallet_code).trim());
      }

      if (log_id) {
        const [[logRow]] = await connection.query('SELECT * FROM QUARANTINE_LOGS WHERE id = ?', [log_id]);
        if (logRow && logRow.pallet_id) {
          const [rows] = await connection.query(`
            SELECT p.*, c.business_name as customer_name
            FROM PALLETS p
            JOIN CUSTOMERS c ON p.customer_id = c.id
            WHERE p.id = ?
          `, [logRow.pallet_id]);
          targetPallets = rows;
        } else if (logRow && logRow.pallet_code) {
          const [rows] = await connection.query(`
            SELECT p.*, c.business_name as customer_name
            FROM PALLETS p
            JOIN CUSTOMERS c ON p.customer_id = c.id
            WHERE p.pallet_code = ?
          `, [logRow.pallet_code]);
          targetPallets = rows;
        }
      } else if (effectiveIds.length > 0) {
        const [rows] = await connection.query(`
          SELECT p.*, c.business_name as customer_name
          FROM PALLETS p
          JOIN CUSTOMERS c ON p.customer_id = c.id
          WHERE p.id IN (?)
        `, [effectiveIds]);
        targetPallets = rows;
      } else if (effectiveCodes.length > 0) {
        const [rows] = await connection.query(`
          SELECT p.*, c.business_name as customer_name
          FROM PALLETS p
          JOIN CUSTOMERS c ON p.customer_id = c.id
          WHERE p.pallet_code IN (?)
        `, [effectiveCodes]);
        targetPallets = rows;
      }

      if (targetPallets.length === 0) {
        await connection.rollback();
        connection.release();
        return reply.code(404).send({ error: 'Paletta non trovata per lo sblocco.' });
      }

      for (const pal of targetPallets) {
        if (!canAccessCustomer(caller, pal.customer_id)) {
          await connection.rollback();
          connection.release();
          return reply.code(403).send({
            error: `Accesso negato: non sei autorizzato ad operare sulla merce del cliente "${pal.customer_name}".`
          });
        }
      }

      const idsToUnblock = targetPallets.map(p => p.id);
      const codesToUnblock = [...new Set(targetPallets.map(p => p.pallet_code))];

      await connection.query(
        `UPDATE PALLETS
         SET is_quarantined = FALSE,
             quarantine_reason = NULL,
             quarantined_at = NULL,
             quarantined_by = NULL,
             quarantine_notes = NULL
         WHERE id IN (?)`,
        [idsToUnblock]
      );

      await connection.query(
        `UPDATE QUARANTINE_LOGS
         SET status = 'RELEASED',
             unblock_reason = ?,
             unblock_notes = ?,
             unblocked_by = ?,
             unblocked_at = CURRENT_TIMESTAMP
         WHERE status = 'QUARANTINED' AND (pallet_id IN (?) OR pallet_code IN (?))`,
        [cleanUnblockReason, cleanUnblockNotes, caller.username, idsToUnblock, codesToUnblock]
      );

      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        [
          'QUARANTINE_UNBLOCK',
          `Sbloccate da QUARANTENA ${idsToUnblock.length} palette (${codesToUnblock.join(', ')}) - Motivo: ${cleanUnblockReason}`,
          'Gestionale',
          caller.username
        ]
      );

      await connection.commit();
      connection.release();

      if (fastify.io) {
        fastify.io.emit('quarantine_updated');
        fastify.io.emit('stow_updated');
        fastify.io.emit('dashboard_update');
      }

      return {
        success: true,
        unblocked_count: idsToUnblock.length,
        message: 'Merce sbloccata dalla quarantena e nuovamente operativa.'
      };
    } catch (err) {
      if (connection) {
        await connection.rollback();
        connection.release();
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante lo sblocco dalla quarantena' });
    }
  });
}

module.exports = quarantineRoutes;
