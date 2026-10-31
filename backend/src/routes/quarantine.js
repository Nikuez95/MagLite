const db = require('../config/db');
const { resolveUserAccess, hasPermission, canAccessCustomer } = require('../utils/permissions');

async function quarantineRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.addHook('preHandler', async (request, reply) => {
    // Usa direttamente request.user già validato ed arricchito da fastify.authenticate
    request.callerAccess = request.user;
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

      const filteredPallets = activePallets.filter(p => canAccessCustomer(caller, p.customer_id));
      const filteredLogs = logs.filter(l => canAccessCustomer(caller, l.customer_id));
      const uniqueCustomers = new Set(filteredPallets.map(p => p.customer_id));
      const activeQuantity = filteredPallets.reduce((acc, p) => acc + (parseFloat(p.quantity) || 0), 0);
      const totalReleased = filteredLogs.filter(l => l.status === 'RELEASED').length;

      return {
        activePallets: filteredPallets,
        logs: filteredLogs,
        stats: {
          activeCount: filteredPallets.length,
          activeQuantity,
          totalBlocks: filteredLogs.length,
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

  // GET /api/quarantine/report/:id/pdf - Scarica Verbale Ufficiale Non Conformità / Quarantena (GDP)
  fastify.get('/report/:id/pdf', async (request, reply) => {
    const { id } = request.params;
    const PDFDocument = require('pdfkit');
    const path = require('path');
    const fs = require('fs');

    try {
      // Cerca prima nei log di quarantena
      let logData = null;
      let palletData = null;

      const [logs] = await db.query('SELECT * FROM QUARANTINE_LOGS WHERE id = ? OR pallet_id = ? ORDER BY id DESC LIMIT 1', [id, id]);
      if (logs.length > 0) {
        logData = logs[0];
      }

      const [pallets] = await db.query(`
        SELECT p.*, pr.name as product_name, pr.sku, c.business_name as customer_name, c.vat_number, c.unique_id as customer_code
        FROM PALLETS p
        JOIN PRODUCTS pr ON p.product_id = pr.id
        JOIN CUSTOMERS c ON p.customer_id = c.id
        WHERE p.id = ? OR p.pallet_code = ?
        LIMIT 1
      `, [id, logData?.pallet_code || id]);

      if (pallets.length > 0) {
        palletData = pallets[0];
      }

      if (!palletData && !logData) {
        return reply.code(404).send({ error: 'Riferimento quarantena o paletta non trovato' });
      }

      const palletCode = palletData?.pallet_code || logData?.pallet_code || `PAL-${id}`;
      const customerName = palletData?.customer_name || logData?.customer_name || 'Cliente';
      const productName = palletData?.product_name || logData?.product_name || 'Articolo';
      const sku = palletData?.sku || logData?.sku || '-';
      const batch = palletData?.batch || logData?.batch || 'N/D';
      const qty = palletData?.quantity || logData?.quantity || '-';
      const uom = palletData?.pallet_uom || palletData?.uom || logData?.uom || 'Pezzi';
      const location = palletData?.location || logData?.location || 'IN ATTESA';
      const reason = logData?.block_reason || palletData?.quarantine_reason || 'Controllo Qualità';
      const notes = logData?.block_notes || palletData?.quarantine_notes || '';
      const blockedBy = logData?.blocked_by || palletData?.quarantined_by || 'Responsabile QA';
      const blockedAt = logData?.blocked_at || palletData?.quarantined_at || new Date();
      const expirationDate = palletData?.expiration_date ? new Date(palletData.expiration_date).toLocaleDateString('it-IT') : 'N/D';

      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      const bufferPromise = new Promise((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
      });

      // --- LOGO & INTESTAZIONE ---
      const logoPath = path.join(__dirname, '../../../frontend/public/logo_scuro.png');
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 40, 40, { width: 140 });
      } else {
        doc.fillColor('#0ea5e9').fontSize(18).font('Helvetica-Bold').text('Logistic Porcelli', 40, 40);
      }

      doc.fillColor('#64748b').fontSize(9).font('Helvetica')
        .text('LOGISTICA INTEGRATA & CONTROLLO QUALITÀ GDP', 250, 42, { align: 'right' })
        .text('Procedure di Gestione Non Conformità - GDP Guidelines 2013/C 343/01', 250, 55, { align: 'right' })
        .text(`Data Emissione: ${new Date().toLocaleString('it-IT')}`, 250, 68, { align: 'right' });

      doc.moveDown(4);

      // Titolo Documento
      doc.rect(40, 100, doc.page.width - 80, 36).fill('#991b1b');
      doc.fillColor('#ffffff').fontSize(14).font('Helvetica-Bold')
        .text('VERBALE DI NON CONFORMITÀ E BLOCCO QUARANTENA', 40, 110, { align: 'center' });

      doc.moveDown(3);

      // Metadati Documento Protocollo
      const startY = 150;
      doc.rect(40, startY, doc.page.width - 80, 40).stroke('#cbd5e1');
      doc.fillColor('#334155').fontSize(10).font('Helvetica-Bold')
        .text(`N° Protocollo: NC-GDP-${logData?.id || id}-${new Date().getFullYear()}`, 50, startY + 8)
        .text(`Data Rilevazione: ${new Date(blockedAt).toLocaleString('it-IT')}`, 50, startY + 22);

      doc.text(`Stato Blocco: MERCE IN QUARANTENA`, 320, startY + 8, { fill: '#b91c1c' })
        .text(`Disposto da: ${blockedBy}`, 320, startY + 22);

      // Sezione 1: Intestatario / Committente
      const s1Y = startY + 55;
      doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold').text('1. COMMITTENTE / PROPRIETARIO MERCE', 40, s1Y);
      doc.rect(40, s1Y + 16, doc.page.width - 80, 45).fill('#f8fafc').stroke('#e2e8f0');
      doc.fillColor('#1e293b').fontSize(10).font('Helvetica-Bold').text(`Ragione Sociale: ${customerName}`, 50, s1Y + 24);
      doc.font('Helvetica').fontSize(9).fillColor('#475569')
        .text(`Codice Univoco Cliente: ${palletData?.customer_code || '-'}`, 50, s1Y + 38)
        .text(`Partita IVA / CF: ${palletData?.vat_number || 'Verifica anagrafica'}`, 320, s1Y + 38);

      // Sezione 2: Merce Oggetto del Blocco
      const s2Y = s1Y + 75;
      doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold').text('2. DETTAGLIO MERCE BLOCCATA', 40, s2Y);
      doc.rect(40, s2Y + 16, doc.page.width - 80, 95).fill('#f8fafc').stroke('#e2e8f0');

      doc.fillColor('#1e293b').fontSize(10).font('Helvetica-Bold').text(`Bancale / Pallet Code: ${palletCode}`, 50, s2Y + 24);
      doc.font('Helvetica').fontSize(9).fillColor('#334155')
        .text(`Descrizione Articolo: ${productName}`, 50, s2Y + 40)
        .text(`Codice Articolo / SKU: ${sku}`, 50, s2Y + 55)
        .text(`Lotto di Produzione: ${batch}`, 50, s2Y + 70)
        .text(`Data di Scadenza: ${expirationDate}`, 50, s2Y + 85);

      doc.text(`Quantità Bloccata: ${qty} ${uom}`, 320, s2Y + 40)
        .text(`Ubicazione Magazzino: ${location}`, 320, s2Y + 55)
        .text(`Magazzino: Settala (MI)`, 320, s2Y + 70)
        .text(`Rif. Cliente: ${palletData?.client_pallet_number || '-'}`, 320, s2Y + 85);

      // Sezione 3: Motivazione Non Conformità
      const s3Y = s2Y + 125;
      doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold').text('3. MOTIVO NON CONFORMITÀ E RILIEVI ISPETTIVI', 40, s3Y);
      doc.rect(40, s3Y + 16, doc.page.width - 80, 80).fill('#fff1f2').stroke('#fecdd3');

      doc.fillColor('#991b1b').fontSize(10).font('Helvetica-Bold').text(`Causale Primaria: ${reason}`, 50, s3Y + 26);
      doc.fillColor('#475569').fontSize(9).font('Helvetica')
        .text(`Note / Dettaglio Ispezione: ${notes || 'Nessuna nota aggiuntiva specificata.'}`, 50, s3Y + 42, { width: doc.page.width - 100 })
        .text('Azioni Applicate a Sistema: Paletta marcata non conforme, prelievo e stivaggio bloccati su tutti i terminali Zebra e sul gestionale.', 50, s3Y + 68);

      // Sezione 4: Disposizioni GDP
      const s4Y = s3Y + 110;
      doc.fillColor('#0f172a').fontSize(10).font('Helvetica-Bold').text('4. DISPOSIZIONI GDP & AZIONI SUCCESSIVE', 40, s4Y);
      doc.rect(40, s4Y + 14, doc.page.width - 80, 45).stroke('#cbd5e1');
      doc.fillColor('#475569').fontSize(8.5).font('Helvetica')
        .text('La merce resta custodita nell\'area Quarantena a temperatura monitorata fino a formale disposizione scritta da parte del committente (Reso, Distruzione conforme o Rilascio previa autorizzazione QA). La movimentazione senza sblocco a sistema costituisce violazione delle buone pratiche GDP.', 50, s4Y + 20, { width: doc.page.width - 100 });

      // Sezione 5: Firme
      const s5Y = s4Y + 80;
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#0f172a')
        .text('Firma Responsabile Qualità Magazzino', 60, s5Y)
        .text('Firma per Ricevuta e Presa Visione Committente / Vettore', 310, s5Y);

      doc.rect(60, s5Y + 20, 200, 45).stroke('#cbd5e1');
      doc.rect(310, s5Y + 20, 220, 45).stroke('#cbd5e1');

      doc.fillColor('#94a3b8').fontSize(8).font('Helvetica')
        .text(`Operatore: ${blockedBy}`, 65, s5Y + 52)
        .text('Timbro e Firma Legale Rappresentante / Delegato', 315, s5Y + 52);

      doc.end();
      const pdfBuffer = await bufferPromise;
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `inline; filename="VERBALE_NON_CONFORMITA_${palletCode}.pdf"`);
      reply.header('Content-Length', pdfBuffer.length);
      return reply.send(pdfBuffer);
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante la generazione del verbale di quarantena in PDF' });
    }
  });
}

module.exports = quarantineRoutes;
