const db = require('../config/db');
const { drawLabel, generateLabelsPdfBuffer, sanitizeExpirationDate } = require('../utils/pdfLabels');

async function inboundRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  // 1. Create Inbound DDT
  fastify.post('/ddt', async (request, reply) => {
    const { cart } = request.body;
    if (!cart || cart.length === 0) return reply.code(400).send({ error: 'Carrello vuoto' });

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const customer_id = cart[0].customer_id;
      
      // Generate DDT Number
      const [rows] = await connection.query('SELECT COUNT(*) as count FROM INBOUND_DDTS WHERE YEAR(created_at) = YEAR(CURRENT_DATE)');
      const nextId = rows[0].count + 1;
      const ddtNumber = `IN-${new Date().getFullYear()}-${nextId.toString().padStart(4, '0')}`;

      const [resDdt] = await connection.query(
        'INSERT INTO INBOUND_DDTS (ddt_number, customer_id, status) VALUES (?, ?, ?)',
        [ddtNumber, customer_id, 'PENDING']
      );
      const ddtId = resDdt.insertId;

      for (const item of cart) {
        const [[prodRow]] = await connection.query('SELECT sku, name FROM PRODUCTS WHERE id = ?', [item.product_id]);
        const itemSku = item.sku || item.client_article_number || prodRow?.sku || null;
        const itemName = prodRow?.name || item.product_name || item.name;
        const itemLocation = item.location ? String(item.location).trim().toUpperCase() : null;
        await connection.query(
          'INSERT INTO INBOUND_DDT_ITEMS (inbound_ddt_id, product_id, sku, product_name, product_uom, expected_quantity, batch, units_per_box, client_pallet_number, client_article_number, expiration_date, pallet_uom, location) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [ddtId, item.product_id, itemSku, itemName, item.uom || item.product_uom || 'Pezzi', item.quantity, item.batch, item.units_per_box, item.client_pallet_number, item.client_article_number, sanitizeExpirationDate(item.expiration_date), item.pallet_uom || item.uom || 'Pezzi', itemLocation]
        );
      }

      await connection.commit();
      return { success: true, ddt_id: ddtId, ddt_number: ddtNumber };
    } catch (err) {
      await connection.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore creazione DDT' });
    } finally {
      connection.release();
    }
  });

  // 2. Get all Inbound DDTs
  fastify.get('/ddt', async (request, reply) => {
    try {
      const [rows] = await db.query(`
        SELECT d.*, c.business_name 
        FROM INBOUND_DDTS d
        JOIN CUSTOMERS c ON d.customer_id = c.id
        ORDER BY d.created_at DESC
      `);
      return rows;
    } catch (err) {
      return reply.code(500).send({ error: 'Errore fetch DDTs' });
    }
  });

  // 3. Get Single DDT Details (for Zebra)
  fastify.get('/ddt/:identifier', async (request, reply) => {
    const { identifier } = request.params;
    try {
      const isId = !isNaN(identifier);
      const queryStr = isId ? 'SELECT d.*, c.business_name FROM INBOUND_DDTS d JOIN CUSTOMERS c ON d.customer_id = c.id WHERE d.id = ?' : 'SELECT d.*, c.business_name FROM INBOUND_DDTS d JOIN CUSTOMERS c ON d.customer_id = c.id WHERE d.ddt_number = ?';
      const [ddts] = await db.query(queryStr, [identifier]);
      
      if (ddts.length === 0) return reply.code(404).send({ error: 'DDT non trovato' });
      const ddt = ddts[0];

      const [items] = await db.query(`
        SELECT i.*, 
               COALESCE(NULLIF(i.sku, ''), p.sku) AS sku,
               COALESCE(NULLIF(i.product_name, ''), p.name) AS product_name,
               COALESCE(i.product_uom, p.uom, 'Pezzi') AS product_uom,
               COALESCE(NULLIF(i.units_per_box, 0), p.units_per_box, 1) AS units_per_box
        FROM INBOUND_DDT_ITEMS i
        LEFT JOIN PRODUCTS p ON i.product_id = p.id
        WHERE i.inbound_ddt_id = ?
      `, [ddt.id]);
      
      return { ddt, items };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore fetch DDT details' });
    }
  });

  // 4. Zebra: Generate Pallet for DDT Item
  fastify.post('/ddt/:id/scan', async (request, reply) => {
    const { item_id, quantity, warehouse, location, expiration_date } = request.body;
    const ddt_id = request.params.id;
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Get item
      const [items] = await connection.query('SELECT * FROM INBOUND_DDT_ITEMS WHERE id = ? AND inbound_ddt_id = ?', [item_id, ddt_id]);
      if (items.length === 0) throw new Error('Item non trovato nel DDT');
      const item = items[0];

      const [ddts] = await connection.query('SELECT * FROM INBOUND_DDTS WHERE id = ?', [ddt_id]);
      if (ddts[0].status === 'PENDING') {
        await connection.query('UPDATE INBOUND_DDTS SET status = ? WHERE id = ?', ['IN_PROGRESS', ddt_id]);
      }

      // Generate or use existing pallet code based on location
      let palletCode = null;
      let locStr = null;
      if (location) {
        locStr = location.toUpperCase().trim();
        const [existing] = await connection.query('SELECT pallet_code FROM PALLETS WHERE location = ? LIMIT 1', [locStr]);
        if (existing.length > 0) {
          palletCode = existing[0].pallet_code;
        }
      }
      
      if (!palletCode) {
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const basePrefix = `PAL-${dateStr}-`;
        const [seqRows] = await connection.query(
          'SELECT DISTINCT pallet_code FROM PALLETS WHERE pallet_code LIKE ?',
          [`${basePrefix}%`]
        );
        let maxSeq = 0;
        for (const r of seqRows) {
          const suffix = String(r.pallet_code || '').slice(basePrefix.length);
          if (/^\d+$/.test(suffix)) {
            const num = parseInt(suffix, 10);
            if (num > maxSeq) maxSeq = num;
          }
        }
        palletCode = `${basePrefix}${String(maxSeq + 1).padStart(4, '0')}`;
      }

      // Insert Pallet
      await connection.query(`
        INSERT INTO PALLETS 
        (pallet_code, customer_id, product_id, quantity, units_per_box, batch, warehouse, status, location, client_pallet_number, client_article_number, expiration_date, pallet_uom, inbound_ddt_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        palletCode, ddts[0].customer_id, item.product_id, quantity, item.units_per_box, item.batch,
        warehouse || 'Settala', locStr ? 'STOCKED' : 'PENDING', locStr || null, item.client_pallet_number, item.client_article_number,
        sanitizeExpirationDate(expiration_date || item.expiration_date), item.pallet_uom, ddt_id
      ]);
      
      await connection.query(
        "INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)",
        ['INBOUND', `Spunta Zebra: Creata paletta ${palletCode} (${quantity} pz)${locStr ? ' in ' + locStr : ''}`, 'Zebra', request.user ? request.user.username : 'Operatore']
      );

      // Update actual quantity
      await connection.query('UPDATE INBOUND_DDT_ITEMS SET actual_quantity = actual_quantity + ? WHERE id = ?', [quantity, item_id]);

      await connection.commit();
      return { success: true, pallet_code: palletCode };
    } catch (err) {
      await connection.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: err.message || 'Errore scan' });
    } finally {
      connection.release();
    }
  });

  // 5. Complete DDT
  fastify.post('/ddt/:id/complete', async (request, reply) => {
    try {
      const [items] = await db.query('SELECT expected_quantity, actual_quantity FROM INBOUND_DDT_ITEMS WHERE inbound_ddt_id = ?', [request.params.id]);
      let discrepancy = false;
      let totalDiff = 0;
      for (const item of items) {
        if (parseFloat(item.expected_quantity) !== parseFloat(item.actual_quantity)) {
          discrepancy = true;
          totalDiff += (parseFloat(item.actual_quantity) - parseFloat(item.expected_quantity));
        }
      }

      const status = discrepancy ? 'DISCREPANCY' : 'COMPLETED';
      const notes = discrepancy ? `Completato con discrepanza (${totalDiff > 0 ? '+' : ''}${totalDiff})` : null;

      await db.query('UPDATE INBOUND_DDTS SET status = ?, closed_at = NOW(), notes = ? WHERE id = ?', [status, notes, request.params.id]);
      
      await db.query('INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)', [
        'COMPLETE_INBOUND_DDT', `Completato DDT ${request.params.id} con stato ${status}`, 'Zebra', request.user.username
      ]);

      return { success: true, status, notes };
    } catch (err) {
      return reply.code(500).send({ error: 'Errore completamento DDT' });
    }
  });

  // 6. Get DDT PDF
  fastify.get('/ddt/:identifier/pdf', async (request, reply) => {
    const { identifier } = request.params;
    try {
      const PDFDocument = require('pdfkit');
      
      const isId = !isNaN(identifier);
      const queryStr = isId ? 'SELECT d.*, c.business_name FROM INBOUND_DDTS d JOIN CUSTOMERS c ON d.customer_id = c.id WHERE d.id = ?' : 'SELECT d.*, c.business_name FROM INBOUND_DDTS d JOIN CUSTOMERS c ON d.customer_id = c.id WHERE d.ddt_number = ?';
      const [ddts] = await db.query(queryStr, [identifier]);
      
      if (ddts.length === 0) return reply.code(404).send({ error: 'DDT non trovato' });
      const ddt = ddts[0];

      const [items] = await db.query(`
        SELECT i.*, p.sku, p.name as product_name, p.uom as product_uom
        FROM INBOUND_DDT_ITEMS i
        JOIN PRODUCTS p ON i.product_id = p.id
        WHERE i.inbound_ddt_id = ?
      `, [ddt.id]);

      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `inline; filename="${ddt.ddt_number}.pdf"`);
      reply.send(doc);

      const fsModule = require('fs');
      const path = require('path');
      const logoPath = path.join(__dirname, '../../../frontend/public/logo.png');
      
      if (fsModule.existsSync(logoPath)) {
        doc.image(logoPath, (doc.page.width - 200) / 2, doc.y, { fit: [200, 60], align: 'center' });
        doc.moveDown(4);
      } else {
        doc.fillColor('#0ea5e9').fontSize(24).font('Helvetica-Bold').text('Logistic Porcelli', { align: 'center' });
        doc.fillColor('#94a3b8').fontSize(10).font('Helvetica').text('Logistica & Magazzino', { align: 'center' });
      }
      doc.moveDown(2);

      doc.fillColor('#1e293b').fontSize(16).font('Helvetica-Bold').text('DDT ENTRATA MERCE (SPUNTA)', { align: 'center' });
      
      // We need a barcode for the DDT number!
      const bwipjs = require('bwip-js');
      try {
        const barcodeBuffer = await bwipjs.toBuffer({ bcid: 'code128', text: ddt.ddt_number, scale: 3, height: 10, includetext: false });
        doc.image(barcodeBuffer, 225, doc.y + 10, { width: 150 });
        doc.moveDown(4);
      } catch (e) {
        doc.moveDown(2);
      }
      
      doc.fontSize(12).text(`DDT Numero: ${ddt.ddt_number}`, { align: 'center' });
      doc.moveDown(1.5);
      
      doc.fontSize(12).font('Helvetica').text(`Cliente: ${ddt.business_name}`);
      doc.text(`Data: ${new Date(ddt.created_at).toLocaleDateString('it-IT')}`);
      doc.text(`Stato: ${ddt.status}`);
      if (ddt.notes) doc.text(`Note: ${ddt.notes}`);
      
      doc.moveDown(2);
      doc.font('Helvetica-Bold').text('RIGHE ATTESE:', { underline: true });
      doc.moveDown(0.5);

      items.forEach((item, idx) => {
        const exp = parseFloat(item.expected_quantity);
        const act = parseFloat(item.actual_quantity || 0);
        const isDiscrepancy = exp !== act && ddt.status !== 'PENDING';
        
        doc.font('Helvetica-Bold').fontSize(11).fillColor('black').text(`${idx + 1}. ${item.product_name} (${item.sku})`);
        
        if (isDiscrepancy) {
          doc.font('Helvetica-Bold').fontSize(10).fillColor('#ef4444').text(`Q.ta Attesa: ${item.expected_quantity} ${item.product_uom} (Effettiva: ${item.actual_quantity}) - DISCREPANZA!`);
        } else {
          doc.font('Helvetica').fontSize(10).fillColor('#475569').text(`Q.ta Attesa: ${item.expected_quantity} ${item.product_uom} (Effettiva: ${item.actual_quantity})`);
        }
        
        doc.fillColor('black');
        if (item.batch) doc.text(`Lotto: ${item.batch}`);
        doc.moveDown(0.5);
      });

      doc.end();
      return reply;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore generazione PDF DDT' });
    }
  });


  // 7. Get Barcodes for generated pallets
  fastify.get('/ddt/:identifier/barcodes', async (request, reply) => {
    const { identifier } = request.params;
    try {
      const isId = !isNaN(identifier);
      const queryStr = isId ? 'SELECT d.id FROM INBOUND_DDTS d WHERE d.id = ?' : 'SELECT d.id FROM INBOUND_DDTS d WHERE d.ddt_number = ?';
      const [ddts] = await db.query(queryStr, [identifier]);
      if (ddts.length === 0) return reply.code(404).send({ error: 'DDT non trovato' });

      const [pallets] = await db.query(`
        SELECT p.*, pr.name as product_name, pr.uom as product_uom, c.business_name
        FROM PALLETS p
        JOIN PRODUCTS pr ON p.product_id = pr.id
        JOIN CUSTOMERS c ON p.customer_id = c.id
        WHERE p.inbound_ddt_id = ?
        ORDER BY p.id ASC
      `, [ddts[0].id]);

      if (pallets.length === 0) return reply.code(400).send({ error: 'Nessuna paletta generata per questo DDT' });

      const groupedByCode = new Map();
      for (const p of pallets) {
        if (!groupedByCode.has(p.pallet_code)) {
          groupedByCode.set(p.pallet_code, []);
        }
        groupedByCode.get(p.pallet_code).push(p);
      }

      const generatedLabels = [];
      for (const [code, rows] of groupedByCode.entries()) {
        const p = rows[0];
        const uniqueProdNames = [...new Set(rows.map(r => r.product_name))];
        const uniqueBatches = [...new Set(rows.map(r => r.batch).filter(Boolean))];
        const uniqueArticles = [...new Set(rows.map(r => r.client_article_number).filter(Boolean))];
        generatedLabels.push({
          code,
          customer_name: p.business_name,
          product_name: rows.length > 1
            ? (uniqueProdNames.length === 1 ? `${uniqueProdNames[0]} (${rows.length} LOTTI)` : `PALETTA MISTA (${rows.length} Articoli)`)
            : p.product_name,
          quantity: rows.length > 1 ? '-' : p.quantity,
          uom: p.pallet_uom || p.product_uom || 'Pezzi',
          batch: rows.length > 1 ? (uniqueBatches.join(', ') || '-') : (p.batch || '-'),
          warehouse: p.warehouse,
          client_pallet_number: p.client_pallet_number,
          client_article_number: rows.length > 1 ? (uniqueArticles.join(', ') || '-') : p.client_article_number,
          expiration_date: p.expiration_date,
          location: p.location || null,
          flags: p.flags
        });
      }

      const pdfBuffer = await generateLabelsPdfBuffer(generatedLabels, { paper_format: 'A4', print_mode: 'GRID' });
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', 'inline; filename="barcodes.pdf"');
      return reply.send(pdfBuffer);
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore generazione barcodes' });
    }
  });

}

module.exports = inboundRoutes;
