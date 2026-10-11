const db = require('../config/db');

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
        await connection.query(
          'INSERT INTO INBOUND_DDT_ITEMS (inbound_ddt_id, product_id, sku, product_name, product_uom, expected_quantity, batch, units_per_box, client_pallet_number, client_article_number, expiration_date, pallet_uom) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [ddtId, item.product_id, item.sku, item.product_name || item.name, item.uom || item.product_uom || 'Pezzi', item.quantity, item.batch, item.units_per_box, item.client_pallet_number, item.client_article_number, item.expiration_date || null, item.pallet_uom || item.uom || 'Pezzi']
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
        const randStr = Math.random().toString(36).substring(2,6).toUpperCase();
        const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        palletCode = `PAL-${timestamp}-${randStr}`;
      }

      // Insert Pallet
      await connection.query(`
        INSERT INTO PALLETS 
        (pallet_code, customer_id, product_id, quantity, units_per_box, batch, warehouse, status, location, client_pallet_number, client_article_number, expiration_date, pallet_uom, inbound_ddt_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        palletCode, ddts[0].customer_id, item.product_id, quantity, item.units_per_box, item.batch,
        warehouse || 'Settala', locStr ? 'STOCKED' : 'PENDING', locStr || null, item.client_pallet_number, item.client_article_number,
        expiration_date || item.expiration_date, item.pallet_uom, ddt_id
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
      const PDFDocument = require('pdfkit');
      const bwipjs = require('bwip-js');
      const path = require('path');
      const fsModule = require('fs');
      const logoPath = path.join(__dirname, '../../../frontend/public/logo.png');
      
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

      const generatedLabels = pallets.map(p => ({
        code: p.pallet_code,
        customer_name: p.business_name,
        product_name: p.product_name,
        quantity: p.quantity,
        uom: p.pallet_uom || p.product_uom || 'Pezzi',
        batch: p.batch || '-',
        warehouse: p.warehouse,
        client_pallet_number: p.client_pallet_number,
        client_article_number: p.client_article_number,
        expiration_date: p.expiration_date,
        flags: p.flags
      }));

      async function drawLabel(doc, lbl, x, y, w, h) {
  // Bordo arrotondato moderno
  doc.roundedRect(x, y, w, h, 8).lineWidth(1).strokeOpacity(0.3).strokeColor('#000000').stroke();
  doc.strokeOpacity(1).strokeColor('black').lineWidth(1); // reset

  // HEADER (Logo & Warehouse)
  if (fsModule.existsSync(logoPath)) {
    doc.image(logoPath, x + 12, y + 12, { fit: [90, 25] });
    doc.fontSize(9).font('Helvetica').fillColor('#64748b').text(`Magazzino: ${lbl.warehouse}`, x + 110, y + 18, { width: w - 122, align: 'right' });
  } else {
    doc.fontSize(9).font('Helvetica').fillColor('#64748b').text(`Magazzino: ${lbl.warehouse}`, x + 12, y + 18, { width: w - 24, align: 'right' });
  }

  // Divider
  doc.moveTo(x + 10, y + 42).lineTo(x + w - 10, y + 42).lineWidth(0.5).strokeOpacity(0.2).strokeColor('#000000').stroke();
  doc.strokeOpacity(1).strokeColor('black').lineWidth(1); // reset

  // CLIENTE (Auto-shrink text per evitare a capo)
  let cName = (lbl.customer_name || '').toUpperCase();
  let maxFontSizeC = 11;
  doc.fontSize(maxFontSizeC).font('Helvetica-Bold');
  while(doc.widthOfString(cName) > (w - 24) && maxFontSizeC > 6) {
    maxFontSizeC -= 0.5;
    doc.fontSize(maxFontSizeC);
  }
  doc.fillColor('#334155').text(cName, x + 12, y + 50, { width: w - 24, align: 'left', lineBreak: false });

  // PRODOTTO (Auto-shrink text per evitare a capo)
  let pName = (lbl.product_name || '').toUpperCase();
  let maxFontSize = 18;
  doc.fontSize(maxFontSize).font('Helvetica-Bold');
  while(doc.widthOfString(pName) > (w - 24) && maxFontSize > 8) {
    maxFontSize -= 0.5;
    doc.fontSize(maxFontSize);
  }
  doc.fillColor('black').text(pName, x + 12, y + 68, { width: w - 24, align: 'left', lineBreak: false });

  // LOTTO & SCADENZA (Niente Q.tà stampata!)
  let metaY = y + 70 + maxFontSize + 8; // posiziona sotto al prodotto
  let batchStr = `Lotto: ${lbl.batch || '-'}`;
  if (lbl.expiration_date) {
    let exp = lbl.expiration_date instanceof Date ? lbl.expiration_date.toLocaleDateString('it-IT') : new Date(lbl.expiration_date).toLocaleDateString('it-IT');
    if (exp === 'Invalid Date') exp = lbl.expiration_date;
    batchStr += `   |   Scad: ${exp}`;
  }
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#475569').text(batchStr, x + 12, metaY, { width: w - 24, align: 'left' });
  
  // DATI AGGIUNTIVI OPZIONALI
  if (lbl.client_pallet_number || lbl.client_article_number) {
    metaY += 14;
    let extras = [];
    if (lbl.client_pallet_number) extras.push(`Pal. Cliente: ${lbl.client_pallet_number}`);
    if (lbl.client_article_number) extras.push(`Art: ${lbl.client_article_number}`);
    doc.fontSize(9).font('Helvetica').fillColor('#64748b').text(extras.join('  |  '), x + 12, metaY, { width: w - 24, align: 'left' });
  }

  doc.fillColor('black'); // reset colore testo per sicurezza

  // BARCODE (Ridimensiona per stare nel blocco rimanente senza sovrapporsi)
  const barcodeY = metaY + 18;
  const remainingHeight = h - (barcodeY - y) - 10; 
  const finalBarcodeHeight = Math.max(25, remainingHeight);
  
  const pngBuffer = await bwipjs.toBuffer({
    bcid: 'code128',
    text: lbl.code,
    scale: 3,
    height: 12,
    includetext: true,
    textxalign: 'center',
  });
  
  const barcodeW = w - 40;
  doc.image(pngBuffer, x + 20, barcodeY, { fit: [barcodeW, finalBarcodeHeight], align: 'center', valign: 'top' });
}



      const doc = new PDFDocument({ size: 'A4', margin: 20 });
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', 'inline; filename="barcodes.pdf"');
      reply.send(doc);

      const margin = 20;
      const spacingX = 15;
      const spacingY = 15;
      const w = (595.28 - margin * 2 - spacingX) / 2;
      const h = (841.89 - margin * 2 - spacingY * 3) / 4;

      for (let i = 0; i < generatedLabels.length; i++) {
        if (i > 0 && i % 8 === 0) doc.addPage();
        const posOnPage = i % 8;
        const col = posOnPage % 2;
        const row = Math.floor(posOnPage / 2);

        const x = margin + col * (w + spacingX);
        const y = margin + row * (h + spacingY);

        await drawLabel(doc, generatedLabels[i], x, y, w, h);
      }
      doc.end();
      return reply;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore generazione barcodes' });
    }
  });

}

module.exports = inboundRoutes;
