const db = require('../config/db');
const { hasPermission } = require('../utils/permissions');

async function warehouseRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  // GET /api/warehouses - Elenco magazzini con relative frammentazioni (Capannoni/Reparti)
  fastify.get('/', async (request, reply) => {
    try {
      const [whRows] = await db.query(
        'SELECT * FROM WAREHOUSES WHERE is_active = 1 ORDER BY id ASC'
      );
      const [divRows] = await db.query(
        'SELECT * FROM WAREHOUSE_DIVISIONS ORDER BY warehouse_id ASC, name ASC'
      );

      const divMap = new Map();
      for (const d of divRows) {
        const list = divMap.get(d.warehouse_id) || [];
        list.push(d);
        divMap.set(d.warehouse_id, list);
      }

      return whRows.map(w => ({
        ...w,
        is_active: Boolean(w.is_active),
        divisions: divMap.get(w.id) || []
      }));
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore caricamento magazzini' });
    }
  });

  // POST /api/warehouses - Crea nuovo magazzino fisico
  fastify.post('/', async (request, reply) => {
    if (!hasPermission(request.user, 'settings_manage') && !hasPermission(request.user, 'pallet_move')) {
      return reply.code(403).send({ error: 'Accesso negato: permesso configurazione richiesto.' });
    }

    const { name, address, cap, city, province, notes } = request.body || {};
    const cleanName = String(name || '').trim();
    if (!cleanName) {
      return reply.code(400).send({ error: 'Il nome del magazzino è obbligatorio.' });
    }

    try {
      const [res] = await db.query(
        `INSERT INTO WAREHOUSES (name, address, cap, city, province, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          cleanName,
          address ? String(address).trim() : null,
          cap ? String(cap).trim() : null,
          city ? String(city).trim() : null,
          province ? String(province).trim().toUpperCase() : null,
          notes ? String(notes).trim() : null
        ]
      );

      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['CREATE_WAREHOUSE', `Creato nuovo magazzino: ${cleanName}`, 'Gestionale', request.user?.username || 'Sistema']
      );

      if (fastify.io) {
        fastify.io.emit('warehouses_updated');
        fastify.io.emit('locations_updated');
      }

      return { success: true, id: res.insertId, name: cleanName };
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return reply.code(400).send({ error: 'Esiste già un magazzino con questo nome.' });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore creazione magazzino' });
    }
  });

  // PUT /api/warehouses/:id - Aggiorna dati/indirizzo magazzino
  fastify.put('/:id', async (request, reply) => {
    if (!hasPermission(request.user, 'settings_manage') && !hasPermission(request.user, 'pallet_move')) {
      return reply.code(403).send({ error: 'Accesso negato: permesso configurazione richiesto.' });
    }

    const whId = parseInt(request.params.id, 10);
    const { name, address, cap, city, province, notes } = request.body || {};
    const cleanName = String(name || '').trim();
    if (!cleanName) {
      return reply.code(400).send({ error: 'Il nome del magazzino è obbligatorio.' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [[existing]] = await connection.query('SELECT * FROM WAREHOUSES WHERE id = ? FOR UPDATE', [whId]);
      if (!existing) {
        await connection.rollback();
        return reply.code(404).send({ error: 'Magazzino non trovato' });
      }

      await connection.query(
        `UPDATE WAREHOUSES SET name = ?, address = ?, cap = ?, city = ?, province = ?, notes = ? WHERE id = ?`,
        [
          cleanName,
          address ? String(address).trim() : null,
          cap ? String(cap).trim() : null,
          city ? String(city).trim() : null,
          province ? String(province).trim().toUpperCase() : null,
          notes ? String(notes).trim() : null,
          whId
        ]
      );

      if (existing.name !== cleanName) {
        await connection.query('UPDATE PALLETS SET warehouse = ? WHERE warehouse_id = ?', [cleanName, whId]);
      }

      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['UPDATE_WAREHOUSE', `Aggiornato magazzino #${whId} (${cleanName})`, 'Gestionale', request.user?.username || 'Sistema']
      );

      await connection.commit();
      if (fastify.io) {
        fastify.io.emit('warehouses_updated');
        fastify.io.emit('locations_updated');
        fastify.io.emit('inventory_updated');
      }
      return { success: true };
    } catch (err) {
      await connection.rollback();
      if (err.code === 'ER_DUP_ENTRY') {
        return reply.code(400).send({ error: 'Nome magazzino già esistente.' });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore aggiornamento magazzino' });
    } finally {
      connection.release();
    }
  });

  // DELETE /api/warehouses/:id
  fastify.delete('/:id', async (request, reply) => {
    if (!hasPermission(request.user, 'settings_manage')) {
      return reply.code(403).send({ error: 'Permesso settings_manage richiesto.' });
    }
    const whId = parseInt(request.params.id, 10);
    if (whId <= 2) {
      return reply.code(400).send({ error: 'I magazzini principali Settala e Caleppio non possono essere eliminati.' });
    }

    try {
      const [[palCnt]] = await db.query(
        "SELECT COUNT(*) AS cnt FROM PALLETS WHERE warehouse_id = ? AND status != 'SHIPPED' AND quantity > 0",
        [whId]
      );
      if (palCnt.cnt > 0) {
        return reply.code(400).send({ error: 'Impossibile eliminare: presenti palette attive in questo magazzino.' });
      }
      const [[locCnt]] = await db.query('SELECT COUNT(*) AS cnt FROM LOCATIONS WHERE warehouse_id = ?', [whId]);
      if (locCnt.cnt > 0) {
        return reply.code(400).send({ error: 'Impossibile eliminare: sposta o elimina prima le posizioni mappate in questo magazzino.' });
      }
      await db.query('DELETE FROM WAREHOUSES WHERE id = ?', [whId]);
      if (fastify.io) {
        fastify.io.emit('warehouses_updated');
        fastify.io.emit('locations_updated');
      }
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore eliminazione magazzino' });
    }
  });

  // POST /api/warehouses/:id/divisions - Aggiunge frammentazione (Capannone 1, Fuori, ecc.)
  fastify.post('/:id/divisions', async (request, reply) => {
    if (!hasPermission(request.user, 'settings_manage') && !hasPermission(request.user, 'pallet_move')) {
      return reply.code(403).send({ error: 'Accesso negato.' });
    }
    const whId = parseInt(request.params.id, 10);
    const { name, description } = request.body || {};
    const cleanName = String(name || '').trim();
    if (!cleanName) {
      return reply.code(400).send({ error: 'Il nome del capannone / reparto è obbligatorio.' });
    }
    try {
      const [res] = await db.query(
        'INSERT INTO WAREHOUSE_DIVISIONS (warehouse_id, name, description) VALUES (?, ?, ?)',
        [whId, cleanName, description ? String(description).trim() : null]
      );
      if (fastify.io) {
        fastify.io.emit('warehouses_updated');
        fastify.io.emit('locations_updated');
      }
      return { success: true, id: res.insertId, warehouse_id: whId, name: cleanName };
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return reply.code(400).send({ error: 'Questo reparto/capannone esiste già in questo magazzino.' });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore creazione reparto/capannone' });
    }
  });

  // DELETE /api/warehouses/divisions/:divId
  fastify.delete('/divisions/:divId', async (request, reply) => {
    if (!hasPermission(request.user, 'settings_manage') && !hasPermission(request.user, 'pallet_move')) {
      return reply.code(403).send({ error: 'Accesso negato.' });
    }
    const divId = parseInt(request.params.divId, 10);
    try {
      await db.query('UPDATE LOCATIONS SET division_id = NULL WHERE division_id = ?', [divId]);
      await db.query('UPDATE FREE_LOCATIONS SET division_id = NULL WHERE division_id = ?', [divId]);
      await db.query('DELETE FROM WAREHOUSE_DIVISIONS WHERE id = ?', [divId]);
      if (fastify.io) {
        fastify.io.emit('warehouses_updated');
        fastify.io.emit('locations_updated');
      }
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore eliminazione reparto' });
    }
  });
}

module.exports = warehouseRoutes;
