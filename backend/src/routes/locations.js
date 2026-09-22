const db = require('../config/db');
const PDFDocument = require('pdfkit');

async function locationRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  // GET /api/locations
  fastify.get('/', async (request, reply) => {
    try {
      const [rows] = await db.query(`
        SELECT l.*, 
               p.pallet_code, p.quantity, p.batch, p.expiration_date, p.notes,
               p.client_pallet_number, p.client_article_number,
               pr.name as product_name, pr.notes as product_notes, c.business_name as customer_name
        FROM LOCATIONS l
        LEFT JOIN PALLETS p ON l.barcode = p.location AND p.status = 'STOCKED'
        LEFT JOIN PRODUCTS pr ON p.product_id = pr.id
        LEFT JOIN CUSTOMERS c ON p.customer_id = c.id
        ORDER BY l.zone ASC, l.col ASC, l.pos ASC
      `);
      return rows;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante il recupero delle posizioni' });
    }
  });

  // POST /api/locations/bulk - Generatore massivo
  fastify.post('/bulk', async (request, reply) => {
    const { zone, rack, levels } = request.body;
    
    if (!zone || !rack || !levels || levels.length === 0) {
      return reply.code(400).send({ error: 'Dati incompleti per la generazione' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      let created = 0;

      for (const pos of levels) {
        const barcode = `${zone.toUpperCase()}-${rack.toUpperCase()}-${pos}`;
        const pin = Math.floor(10 + Math.random() * 90).toString(); // PIN casuale 10-99
        
        try {
          await connection.query(
            'INSERT INTO LOCATIONS (zone, col, pos, barcode, pin) VALUES (?, ?, ?, ?, ?)',
            [zone.toUpperCase(), rack.toUpperCase(), pos, barcode, pin]
          );
          await connection.query(
            'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
            ['CREATE_LOC', `Creata posizione ${barcode}`, 'Gestionale', request.user.username]
          );
          created++;
        } catch (e) {
          // Se esiste già (Duplicate entry), ignora
          if (e.code !== 'ER_DUP_ENTRY') throw e;
        }
      }

      if (fastify.io) {
        fastify.io.emit('dashboard_update');
      }

      await connection.commit();
      connection.release();
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
    
    if (request.user.role !== 'developer') {
      return reply.code(403).send({ error: 'Azione consentita solo ai developer' });
    }

    try {
      const [[loc]] = await db.query('SELECT barcode FROM LOCATIONS WHERE id = ?', [id]);
      if (!loc) return reply.code(404).send({ error: 'Posizione non trovata' });

      const [pallets] = await db.query("SELECT id FROM PALLETS WHERE location = ? AND status = 'STOCKED'", [loc.barcode]);
      if (pallets.length > 0) {
        return reply.code(400).send({ error: 'Impossibile eliminare: la posizione è attualmente occupata da una paletta!' });
      }

      await db.query('DELETE FROM LOCATIONS WHERE id = ?', [id]);
      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['DELETE_LOC', `Eliminata posizione ${loc.barcode}`, 'Gestionale', request.user.username]
      );
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante l\'eliminazione' });
    }
  });

  // DELETE /api/locations/zone/:zoneName
  fastify.delete('/zone/:zoneName', async (request, reply) => {
    const { zoneName } = request.params;
    
    if (request.user.role !== 'developer') {
      return reply.code(403).send({ error: 'Azione consentita solo ai developer' });
    }

    try {
      // Controllo se ci sono palette nella zona (attraverso la foreign key fittizia o la join)
      const [occupied] = await db.query(`
        SELECT p.id 
        FROM PALLETS p
        JOIN LOCATIONS l ON p.location = l.barcode
        WHERE l.zone = ? AND p.status = 'STOCKED'
        LIMIT 1
      `, [zoneName]);

      if (occupied.length > 0) {
        return reply.code(400).send({ error: 'Impossibile eliminare la zona: alcune posizioni sono occupate.' });
      }

      await db.query('DELETE FROM LOCATIONS WHERE zone = ?', [zoneName]);
      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['DELETE_ZONE', `Eliminata intera zona ${zoneName}`, 'Gestionale', request.user.username]
      );
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante l\'eliminazione della zona' });
    }
  });

  // GET /api/locations/zone/:zoneName/print
  fastify.get('/zone/:zoneName/print', async (request, reply) => {
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
      const labelWidth = (doc.page.width - 40) / labelsPerRow; // ~277
      const labelHeight = (doc.page.height - 40) / labelsPerCol; // ~200

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

        // Bordo etichetta
        doc.rect(x + 5, y + 5, labelWidth - 10, labelHeight - 10).stroke('#cccccc');

        // Scaffale/Posizione (In alto)
        doc.font('Helvetica-Bold').fontSize(16).fillColor('#333333').text(String(loc.barcode || ''), x, y + 25, {
          width: labelWidth,
          align: 'center'
        });

        // PIN Gigantesco (Centro)
        doc.font('Helvetica-Bold').fontSize(90).fillColor('#000000').text(String(loc.pin || ''), x, y + 60, {
          width: labelWidth,
          align: 'center'
        });
        
        // Info testuale aggiuntiva (In basso)
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
}

module.exports = locationRoutes;
