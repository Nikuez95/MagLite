const { hasPermission } = require('../utils/permissions');
const db = require('../config/db');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const logoPath = path.join(__dirname, '../../../frontend/public/logo_scuro.png');

async function locationRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  // GET /api/locations
  fastify.get('/', async (request, reply) => {
    const { warehouse_id, division_id } = request.query || {};
    try {
      const whereParts = ['1=1'];
      const params = [];
      if (warehouse_id) {
        whereParts.push('l.warehouse_id = ?');
        params.push(parseInt(warehouse_id, 10));
      }
      if (division_id) {
        whereParts.push('l.division_id = ?');
        params.push(parseInt(division_id, 10));
      }

      const [rows] = await db.query(`
        SELECT l.*, 
               COALESCE(w.name, 'Settala') as warehouse_name,
               wd.name as division_name,
               GROUP_CONCAT(DISTINCT p.pallet_code SEPARATOR ', ') as pallet_code,
               GROUP_CONCAT(DISTINCT pr.name SEPARATOR ', ') as product_name,
               GROUP_CONCAT(DISTINCT NULLIF(TRIM(p.batch), '') SEPARATOR ', ') as batch,
               GROUP_CONCAT(DISTINCT c.business_name SEPARATOR ', ') as customer_name,
               COALESCE(SUM(CASE WHEN p.status = 'STOCKED' AND p.quantity > 0 THEN p.quantity ELSE 0 END), 0) as quantity,
               MAX(COALESCE(p.pallet_uom, pr.uom)) as uom,
               MAX(COALESCE(p.units_per_box, pr.units_per_box, 1)) as units_per_box,
               MIN(p.expiration_date) as expiration_date,
               GROUP_CONCAT(DISTINCT NULLIF(TRIM(p.notes), '') SEPARATOR ' | ') as notes,
               GROUP_CONCAT(DISTINCT NULLIF(TRIM(p.client_pallet_number), '') SEPARATOR ', ') as client_pallet_number,
               GROUP_CONCAT(DISTINCT NULLIF(TRIM(p.client_article_number), '') SEPARATOR ', ') as client_article_number,
               MAX(pr.notes) as product_notes
        FROM LOCATIONS l
        LEFT JOIN WAREHOUSES w ON l.warehouse_id = w.id
        LEFT JOIN WAREHOUSE_DIVISIONS wd ON l.division_id = wd.id
        LEFT JOIN PALLETS p ON UPPER(TRIM(l.barcode)) = UPPER(TRIM(p.location))
          AND p.status = 'STOCKED' AND p.quantity > 0
          AND (p.warehouse_id IS NULL OR p.warehouse_id = l.warehouse_id)
        LEFT JOIN PRODUCTS pr ON p.product_id = pr.id
        LEFT JOIN CUSTOMERS c ON p.customer_id = c.id
        WHERE ${whereParts.join(' AND ')}
        GROUP BY l.id
        ORDER BY l.warehouse_id ASC, l.zone ASC, l.col ASC, l.pos ASC
      `, params);
      return rows;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante il recupero delle posizioni' });
    }
  });

  // GET /api/locations/routing-zones
  fastify.get('/routing-zones', async (request, reply) => {
    const { warehouse_id } = request.query || {};
    try {
      const whFilter = warehouse_id ? ' AND warehouse_id = ?' : '';
      const whParams = warehouse_id ? [parseInt(warehouse_id, 10)] : [];
      const [classicZones] = await db.query(`SELECT DISTINCT zone FROM LOCATIONS WHERE zone IS NOT NULL${whFilter}`, whParams);
      const zones = classicZones.map(z => z.zone);

      const [freeLocRows] = await db.query(`SELECT name FROM FREE_LOCATIONS WHERE 1=1${whFilter}`, whParams);

      const [legacyFreeLocations] = await db.query(`
        SELECT DISTINCT p.location 
        FROM PALLETS p 
        LEFT JOIN LOCATIONS l ON p.location = l.barcode AND (p.warehouse_id IS NULL OR p.warehouse_id = l.warehouse_id)
        WHERE l.barcode IS NULL AND p.location IS NOT NULL AND p.location != '' AND p.location NOT LIKE 'ZONA CARICO%'
        ${warehouse_id ? 'AND p.warehouse_id = ?' : ''}
      `, whParams);
      
      const allZones = [...new Set([
        ...zones, 
        ...freeLocRows.map(f => f.name),
        ...legacyFreeLocations.map(f => f.location)
      ])];
      return allZones;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore recupero zone per routing' });
    }
  });

  // POST /api/locations/bulk - Generatore massivo
  fastify.post('/bulk', async (request, reply) => {
    if (!hasPermission(request.user, 'pallet_move') && !hasPermission(request.user, 'settings_manage')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di creare posizioni o scaffali.' });
    }

    const { zone, rack, levels, warehouse_id = 1, division_id = null } = request.body || {};
    const targetWhId = parseInt(warehouse_id, 10) || 1;
    const targetDivId = division_id ? parseInt(division_id, 10) : null;
    
    if (!zone || !rack || !levels || levels.length === 0) {
      return reply.code(400).send({ error: 'Dati incompleti per la generazione' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      let created = 0;

      const [existing] = await connection.query('SELECT pin FROM LOCATIONS WHERE zone = ? AND warehouse_id = ?', [zone.toUpperCase(), targetWhId]);
      const usedPins = new Set(existing.map(r => r.pin));

      for (const pos of levels) {
        const barcode = `${zone.toUpperCase()}-${rack.toUpperCase()}-${pos}`;
        
        let pin;
        do {
          pin = Math.floor(100 + Math.random() * 900).toString();
        } while (usedPins.has(pin));
        
        usedPins.add(pin);
        
        try {
          await connection.query(
            'INSERT INTO LOCATIONS (warehouse_id, division_id, zone, col, pos, barcode, pin) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [targetWhId, targetDivId, zone.toUpperCase(), rack.toUpperCase(), pos, barcode, pin]
          );
          await connection.query(
            'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
            ['CREATE_LOC', `Creata posizione ${barcode} (Magazzino #${targetWhId})`, 'Gestionale', request.user.username]
          );
          created++;
        } catch (e) {
          if (e.code !== 'ER_DUP_ENTRY') throw e;
        }
      }

      await connection.commit();
      connection.release();

      if (fastify.io) {
        fastify.io.emit('locations_updated');
        fastify.io.emit('stow_updated');
        fastify.io.emit('dashboard_update');
      }

      return { success: true, message: `Generate ${created} nuove posizioni.` };
    } catch (err) {
      if (connection) {
        await connection.rollback();
        connection.release();
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante la generazione massiva' });
    }
  });

  // DELETE /api/locations/:id
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params;
    
    if (!hasPermission(request.user, 'pallet_delete') && !hasPermission(request.user, 'settings_manage') && !hasPermission(request.user, 'pallet_move')) {
      return reply.code(403).send({ error: 'Non hai i permessi per eliminare posizioni o zone di magazzino.' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [[loc]] = await connection.query('SELECT barcode FROM LOCATIONS WHERE id = ? FOR UPDATE', [id]);
      if (!loc) {
        await connection.rollback();
        return reply.code(404).send({ error: 'Posizione non trovata' });
      }

      const [pallets] = await connection.query("SELECT id FROM PALLETS WHERE location = ? AND status = 'STOCKED' AND quantity > 0 FOR UPDATE", [loc.barcode]);
      if (pallets.length > 0) {
        await connection.rollback();
        return reply.code(400).send({ error: 'Impossibile eliminare: la posizione è attualmente occupata da una paletta!' });
      }

      await connection.query('DELETE FROM LOCATIONS WHERE id = ?', [id]);
      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['DELETE_LOC', `Eliminata posizione ${loc.barcode}`, 'Gestionale', request.user.username]
      );
      await connection.commit();

      if (fastify.io) {
        fastify.io.emit('locations_updated');
        fastify.io.emit('stow_updated');
        fastify.io.emit('dashboard_update');
      }
      return { success: true };
    } catch (err) {
      await connection.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante l\'eliminazione' });
    } finally {
      connection.release();
    }
  });

  // DELETE /api/locations/zone/:zoneName
  fastify.delete('/zone/:zoneName', async (request, reply) => {
    const { zoneName } = request.params;
    const { warehouse_id } = request.query || {};
    
    if (!hasPermission(request.user, 'pallet_delete') && !hasPermission(request.user, 'settings_manage') && !hasPermission(request.user, 'pallet_move')) {
      return reply.code(403).send({ error: 'Non hai i permessi per eliminare posizioni o zone di magazzino.' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const whSql = warehouse_id ? ' AND l.warehouse_id = ?' : '';
      const qParams = warehouse_id ? [zoneName, parseInt(warehouse_id, 10)] : [zoneName];
      const [occupied] = await connection.query(`
        SELECT p.id 
        FROM PALLETS p
        JOIN LOCATIONS l ON p.location = l.barcode AND (p.warehouse_id IS NULL OR p.warehouse_id = l.warehouse_id)
        WHERE l.zone = ?${whSql} AND p.status = 'STOCKED' AND p.quantity > 0
        LIMIT 1
        FOR UPDATE
      `, qParams);

      if (occupied.length > 0) {
        await connection.rollback();
        return reply.code(400).send({ error: 'Impossibile eliminare la zona: alcune posizioni sono occupate.' });
      }

      if (warehouse_id) {
        await connection.query('DELETE FROM LOCATIONS WHERE zone = ? AND warehouse_id = ?', [zoneName, parseInt(warehouse_id, 10)]);
      } else {
        await connection.query('DELETE FROM LOCATIONS WHERE zone = ?', [zoneName]);
      }
      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['DELETE_ZONE', `Eliminata intera zona ${zoneName}`, 'Gestionale', request.user.username]
      );
      await connection.commit();

      if (fastify.io) {
        fastify.io.emit('locations_updated');
        fastify.io.emit('stow_updated');
        fastify.io.emit('dashboard_update');
      }
      return { success: true };
    } catch (err) {
      await connection.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante l\'eliminazione della zona' });
    } finally {
      connection.release();
    }
  });

  // PUT /api/locations/reassign - Sposta posizioni o intera zona in un altro magazzino / capannone (frammentazione)
  fastify.put('/reassign', async (request, reply) => {
    if (!hasPermission(request.user, 'pallet_move') && !hasPermission(request.user, 'settings_manage')) {
      return reply.code(403).send({ error: 'Accesso negato.' });
    }
    const {
      zone = null,
      source_warehouse_id = null,
      location_ids = [],
      free_location_ids = [],
      target_warehouse_id,
      target_division_id = null
    } = request.body || {};

    const tgtWhId = parseInt(target_warehouse_id, 10);
    const tgtDivId = target_division_id ? parseInt(target_division_id, 10) : null;
    if (!tgtWhId) {
      return reply.code(400).send({ error: 'Magazzino di destinazione obbligatorio.' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [[whRow]] = await connection.query('SELECT id, name FROM WAREHOUSES WHERE id = ?', [tgtWhId]);
      if (!whRow) {
        await connection.rollback();
        return reply.code(404).send({ error: 'Magazzino di destinazione non trovato.' });
      }

      let targetBarcodes = [];
      if (zone) {
        const [zRows] = source_warehouse_id
          ? await connection.query('SELECT id, barcode FROM LOCATIONS WHERE zone = ? AND warehouse_id = ?', [zone, parseInt(source_warehouse_id, 10)])
          : await connection.query('SELECT id, barcode FROM LOCATIONS WHERE zone = ?', [zone]);
        targetBarcodes = zRows.map(r => r.barcode);
        if (source_warehouse_id) {
          await connection.query(
            'UPDATE LOCATIONS SET warehouse_id = ?, division_id = ? WHERE zone = ? AND warehouse_id = ?',
            [tgtWhId, tgtDivId, zone, parseInt(source_warehouse_id, 10)]
          );
        } else {
          await connection.query(
            'UPDATE LOCATIONS SET warehouse_id = ?, division_id = ? WHERE zone = ?',
            [tgtWhId, tgtDivId, zone]
          );
        }
      } else if (Array.isArray(location_ids) && location_ids.length > 0) {
        const [idRows] = await connection.query('SELECT id, barcode FROM LOCATIONS WHERE id IN (?)', [location_ids]);
        targetBarcodes = idRows.map(r => r.barcode);
        await connection.query('UPDATE LOCATIONS SET warehouse_id = ?, division_id = ? WHERE id IN (?)', [tgtWhId, tgtDivId, location_ids]);
      }

      if (Array.isArray(free_location_ids) && free_location_ids.length > 0) {
        const [flRows] = await connection.query('SELECT id, name FROM FREE_LOCATIONS WHERE id IN (?)', [free_location_ids]);
        targetBarcodes.push(...flRows.map(r => r.name));
        await connection.query('UPDATE FREE_LOCATIONS SET warehouse_id = ?, division_id = ? WHERE id IN (?)', [tgtWhId, tgtDivId, free_location_ids]);
      }

      // Aggiorna eventuali palette stivate sulle posizioni spostate per mantenere coerenza magazzino
      if (targetBarcodes.length > 0) {
        await connection.query(
          "UPDATE PALLETS SET warehouse_id = ?, warehouse = ? WHERE status = 'STOCKED' AND UPPER(TRIM(location)) IN (?)",
          [whRow.id, whRow.name, targetBarcodes.map(b => String(b).trim().toUpperCase())]
        );
      }

      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        [
          'REASSIGN_LOCATIONS',
          `Riassegnate posizioni (${zone ? `Zona ${zone}` : `${targetBarcodes.length} posizioni`}) a ${whRow.name}${tgtDivId ? ` (Reparto #${tgtDivId})` : ''}`,
          'Gestionale',
          request.user?.username || 'Sistema'
        ]
      );

      await connection.commit();
      if (fastify.io) {
        fastify.io.emit('locations_updated');
        fastify.io.emit('stow_updated');
        fastify.io.emit('inventory_updated');
      }
      return { success: true };
    } catch (err) {
      await connection.rollback();
      if (err.code === 'ER_DUP_ENTRY') {
        return reply.code(400).send({ error: 'Conflitto di nomi posizione già esistenti nel magazzino di destinazione.' });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore riassegnazione posizioni' });
    } finally {
      connection.release();
    }
  });

  // GET /api/locations/zone/:zoneName/print
  fastify.get('/zone/:zoneName/print', async (request, reply) => {
    if (!hasPermission(request.user, 'view_locations') && !hasPermission(request.user, 'pallet_move')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di stampare i PIN di magazzino.' });
    }

    const { zoneName } = request.params;
    try {
      const [locations] = await db.query('SELECT * FROM LOCATIONS WHERE zone = ? ORDER BY col ASC, pos ASC', [zoneName]);
      
      if (locations.length === 0) {
        return reply.code(404).send({ error: 'Nessuna posizione trovata nella zona' });
      }

      const doc = new PDFDocument({ size: 'A4', margin: 20 });
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `inline; filename="PIN_${zoneName}.pdf"`);
      reply.send(doc);

      const labelsPerRow = 2;
      const labelsPerCol = 4;
      const labelWidth = (doc.page.width - 40) / labelsPerRow;
      const labelHeight = (doc.page.height - 40) / labelsPerCol;

      for (let i = 0; i < locations.length; i++) {
        const loc = locations[i];
        const pageIndex = i % (labelsPerRow * labelsPerCol);
        if (i > 0 && pageIndex === 0) {
          doc.addPage();
        }

        const col = pageIndex % labelsPerRow;
        const row = Math.floor(pageIndex / labelsPerRow);
        
        const x = 20 + (col * labelWidth);
        const y = 20 + (row * labelHeight);

        doc.rect(x + 5, y + 5, labelWidth - 10, labelHeight - 10).stroke('#cccccc');

        if (fs.existsSync(logoPath)) {
          doc.image(logoPath, x + 12, y + 9, { fit: [108, 32] });
        }

        doc.font('Helvetica-Bold').fontSize(16).fillColor('#333333').text(String(loc.barcode || ''), x, y + 44, {
          width: labelWidth,
          align: 'center'
        });

        let pinStr = String(loc.pin || '');
        let pinSize = 90;
        doc.font('Helvetica-Bold').fontSize(pinSize);
        while(doc.widthOfString(pinStr) > (labelWidth - 20) && pinSize > 20) {
          pinSize -= 5;
          doc.fontSize(pinSize);
        }
        
        doc.fillColor('#000000').text(pinStr, x, y + 76, {
          width: labelWidth,
          align: 'center'
        });
        
        doc.font('Helvetica').fontSize(10).fillColor('#666666').text(`Zona: ${loc.zone || ''} | Col: ${loc.col || ''} | Liv: ${loc.pos || ''}`, x, y + 175, {
          width: labelWidth,
          align: 'center'
        });
      }
      
      doc.end();
      return reply;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante la generazione del PDF' });
    }
  });

  fastify.get('/free', async (request, reply) => {
    const { warehouse_id, division_id } = request.query || {};
    try {
      const whereParts = ['1=1'];
      const params = [];
      if (warehouse_id) {
        whereParts.push('fl.warehouse_id = ?');
        params.push(parseInt(warehouse_id, 10));
      }
      if (division_id) {
        whereParts.push('fl.division_id = ?');
        params.push(parseInt(division_id, 10));
      }

      const [rows] = await db.query(`
        SELECT fl.*,
               COALESCE(w.name, 'Settala') AS warehouse_name,
               wd.name AS division_name,
               COUNT(DISTINCT CASE WHEN p.status = 'STOCKED' AND p.quantity > 0 THEN p.id END) AS items_count,
               COALESCE(SUM(CASE WHEN p.status = 'STOCKED' AND p.quantity > 0 THEN p.quantity ELSE 0 END), 0) AS total_qty,
               GROUP_CONCAT(DISTINCT CASE WHEN p.status = 'STOCKED' AND p.quantity > 0 THEN p.pallet_code END SEPARATOR ', ') AS pallet_codes
        FROM FREE_LOCATIONS fl
        LEFT JOIN WAREHOUSES w ON fl.warehouse_id = w.id
        LEFT JOIN WAREHOUSE_DIVISIONS wd ON fl.division_id = wd.id
        LEFT JOIN PALLETS p ON UPPER(TRIM(fl.name)) = UPPER(TRIM(p.location))
          AND (p.warehouse_id IS NULL OR p.warehouse_id = fl.warehouse_id)
        WHERE ${whereParts.join(' AND ')}
        GROUP BY fl.id
        ORDER BY fl.name ASC
      `, params);
      return rows;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore fetch free locations' });
    }
  });

  fastify.post('/free', async (request, reply) => {
    if (!hasPermission(request.user, 'pallet_move') && !hasPermission(request.user, 'settings_manage')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di creare posizioni libere.' });
    }
    const { name, warehouse_id = 1, division_id = null } = request.body || {};
    if (!name || name.trim() === '') return reply.code(400).send({ error: 'Nome obbligatorio' });
    const whId = parseInt(warehouse_id, 10) || 1;
    const divId = division_id ? parseInt(division_id, 10) : null;
    try {
      await db.query(
        'INSERT INTO FREE_LOCATIONS (warehouse_id, division_id, name) VALUES (?, ?, ?)',
        [whId, divId, name.trim().toUpperCase()]
      );
      if (fastify.io) {
        fastify.io.emit('locations_updated');
        fastify.io.emit('dashboard_update');
      }
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore creazione free location (forse nome duplicato in questo magazzino?)' });
    }
  });

  fastify.delete('/free/:id', async (request, reply) => {
    if (!hasPermission(request.user, 'pallet_delete') && !hasPermission(request.user, 'settings_manage') && !hasPermission(request.user, 'pallet_move')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di eliminare posizioni libere.' });
    }
    const { id } = request.params;
    try {
      const [[freeLoc]] = await db.query('SELECT name FROM FREE_LOCATIONS WHERE id = ?', [id]);
      if (freeLoc) {
        const [[occ]] = await db.query(
          "SELECT COUNT(*) AS cnt FROM PALLETS WHERE UPPER(TRIM(location)) = UPPER(TRIM(?)) AND status = 'STOCKED' AND quantity > 0",
          [freeLoc.name]
        );
        if (occ && occ.cnt > 0) {
          return reply.code(400).send({ error: 'Impossibile eliminare: sono presenti articoli stivati in questa posizione libera.' });
        }
      }
      await db.query('DELETE FROM FREE_LOCATIONS WHERE id = ?', [id]);
      if (fastify.io) {
        fastify.io.emit('locations_updated');
        fastify.io.emit('dashboard_update');
      }
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore eliminazione free location' });
    }
  });
}

module.exports = locationRoutes;
