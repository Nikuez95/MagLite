const db = require('../config/db');
const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');
const fs = require('fs');
const path = require('path');

const logoPath = path.join(__dirname, '../../../logo_xs.png');

async function drawLabel(doc, lbl, x, y, w, h) {
  doc.rect(x, y, w, h).stroke();
  
  if (fs.existsSync(logoPath)) {
    // Usiamo fit per vincolare sia l'altezza che la larghezza massima senza deformare, 
    // così se il logo è molto largo non si sovrappone al testo
    doc.image(logoPath, x + 10, y + 10, { fit: [100, 30] });
    doc.fontSize(10).font('Helvetica').text(`Logistic Porcelli - ${lbl.warehouse}`, x + 115, y + 18, { width: w - 125, align: 'right' });
  } else {
    doc.fontSize(10).font('Helvetica').text(`Logistic Porcelli - ${lbl.warehouse}`, x + 10, y + 15, { width: w - 20, align: 'center' });
  }
  
  doc.fontSize(14).font('Helvetica-Bold').text(lbl.customer_name, x + 10, y + 45, { width: w - 20, align: 'center' });
  doc.fontSize(16).font('Helvetica-Bold').text(lbl.product_name, x + 10, y + 65, { width: w - 20, align: 'center' });
  
  let metaY = y + 90;
  let batchStr = `Lotto: ${lbl.batch || '-'}`;
  if (lbl.expiration_date) {
    // format as DD/MM/YYYY or keep as string depending on what we pass. If it's a date object, format it. If string, just use it.
    let exp = lbl.expiration_date instanceof Date ? lbl.expiration_date.toLocaleDateString('it-IT') : new Date(lbl.expiration_date).toLocaleDateString('it-IT');
    if (exp === 'Invalid Date') exp = lbl.expiration_date;
    batchStr += ` | Scad: ${exp}`;
  }
  doc.fontSize(11).font('Helvetica').text(`Q.ta: ${lbl.quantity} | ${batchStr}`, x + 10, metaY, { width: w - 20, align: 'center' });
  
  if (lbl.client_pallet_number || lbl.client_article_number) {
    metaY += 15;
    let extras = [];
    if (lbl.client_pallet_number) extras.push(`Paletta Cliente: ${lbl.client_pallet_number}`);
    if (lbl.client_article_number) extras.push(`Articolo: ${lbl.client_article_number}`);
    doc.fontSize(9).text(extras.join(' | '), x + 10, metaY, { width: w - 20, align: 'center' });
  }

  const barcodeY = metaY + 20;
  
  const pngBuffer = await bwipjs.toBuffer({
    bcid: 'code128',
    text: lbl.code,
    scale: 3,
    height: 12,
    includetext: true,
    textxalign: 'center',
  });
  
  const barcodeW = w - 40;
  doc.image(pngBuffer, x + 20, barcodeY, { width: barcodeW });
}

async function palletRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/', async (request, reply) => {
    try {
      const [rows] = await db.query(`
        SELECT p.*, pr.name as product_name, COALESCE(p.pallet_uom, pr.uom) as uom, pr.notes as product_notes, c.business_name as customer_name, COALESCE(p.units_per_box, pr.units_per_box) as units_per_box,
        (SELECT COUNT(*) > 1 FROM PALLETS p2 WHERE p2.pallet_code = p.pallet_code) as is_mixed
        FROM PALLETS p
        JOIN PRODUCTS pr ON p.product_id = pr.id
        JOIN CUSTOMERS c ON p.customer_id = c.id
        ORDER BY p.created_at DESC
        LIMIT 100
      `);
      return rows;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante il recupero storico palette' });
    }
  });

  fastify.get('/inventory', async (request, reply) => {
    try {
      const [rows] = await db.query(`
        SELECT p.*, pr.name as product_name, COALESCE(p.pallet_uom, pr.uom) as uom, pr.notes as product_notes, c.business_name as customer_name,
               l.zone, l.col, l.pos,
               (SELECT COUNT(*) > 1 FROM PALLETS p2 WHERE p2.pallet_code = p.pallet_code) as is_mixed
        FROM PALLETS p
        JOIN PRODUCTS pr ON p.product_id = pr.id
        JOIN CUSTOMERS c ON p.customer_id = c.id
        LEFT JOIN LOCATIONS l ON p.location = l.barcode
        WHERE p.status != 'SHIPPED'
      `);
      return rows;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante il recupero inventario' });
    }
  });

  fastify.post('/generate', async (request, reply) => {
    const { cart, printOptions } = request.body;
    
    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      return reply.code(400).send({ error: 'Carrello vuoto o formato non valido' });
    }

    const { paper_format = 'A4', print_mode = 'GRID', isMixed = false, noBarcode = false, freeLocation = '' } = printOptions || {};

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      
      const generatedLabelsData = []; 
      const finalStatus = noBarcode ? 'STOCKED' : 'PENDING';
      const finalLocation = noBarcode ? freeLocation : null;
      
      if (isMixed || noBarcode) {
        // Generate ONLY ONE pallet code for the whole cart
        const dateStr = new Date().toISOString().slice(0,10).replace(/-/g, '');
        const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
        const code = noBarcode ? `NOBAR-${dateStr}-${randomStr}` : `PAL-${dateStr}-${randomStr}`;
        
        for (const item of cart) {
          const { customer_id, product_id, quantity, batch, warehouse, notes, client_pallet_number, client_article_number, expiration_date, arrival_date } = item;
          
          await connection.query(
            'INSERT INTO PALLETS (pallet_code, customer_id, product_id, quantity, units_per_box, pallet_uom, batch, warehouse, status, location, notes, client_pallet_number, client_article_number, expiration_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))',
            [code, customer_id, product_id, quantity, item.units_per_box || null, item.pallet_uom || null, batch || null, warehouse, finalStatus, finalLocation, notes || null, client_pallet_number || null, client_article_number || null, expiration_date || null, arrival_date ? new Date(arrival_date) : null]
          );
          
          if (item.units_per_box || item.boxes_per_pallet) {
            await connection.query(
              'UPDATE PRODUCTS SET units_per_box = ?, boxes_per_pallet = ? WHERE id = ?',
              [item.units_per_box || 1, item.boxes_per_pallet || 1, product_id]
            );
          }
        }
        
        await connection.query(
          "INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)",
          ['INBOUND', noBarcode ? `Carico libero in ${freeLocation} (${cart.length} art.)` : `Creata paletta frammentata ${code} (${cart.length} articoli)`, 'Gestionale', request.user.username]
        );
        
        if (!noBarcode) {
          const [[customer]] = await connection.query('SELECT business_name FROM CUSTOMERS WHERE id = ?', [cart[0].customer_id]);
          generatedLabelsData.push({
            code,
            customer_name: customer.business_name,
            product_name: `PALETTA MISTA (${cart.length} Articoli)`,
            quantity: '-',
            batch: '-',
            warehouse: cart[0].warehouse,
            client_pallet_number: cart[0].client_pallet_number,
            client_article_number: '-',
            expiration_date: cart[0].expiration_date
          });
        }
      } else {
        for (const item of cart) {
          const { customer_id, product_id, quantity, batch, warehouse, num_pallets, notes, client_pallet_number, client_article_number, expiration_date, arrival_date } = item;
          
          const [[product]] = await connection.query('SELECT name FROM PRODUCTS WHERE id = ?', [product_id]);
          const [[customer]] = await connection.query('SELECT business_name FROM CUSTOMERS WHERE id = ?', [customer_id]);
          
          for (let i = 0; i < num_pallets; i++) {
            const dateStr = new Date().toISOString().slice(0,10).replace(/-/g, '');
            const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
            const code = `PAL-${dateStr}-${randomStr}`;
            
            await connection.query(
              'INSERT INTO PALLETS (pallet_code, customer_id, product_id, quantity, units_per_box, pallet_uom, batch, warehouse, status, location, notes, client_pallet_number, client_article_number, expiration_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))',
              [code, customer_id, product_id, quantity, item.units_per_box || null, item.pallet_uom || null, batch || null, warehouse, finalStatus, finalLocation, notes || null, client_pallet_number || null, client_article_number || null, expiration_date || null, arrival_date ? new Date(arrival_date) : null]
            );
            
            await connection.query(
              "INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)",
              ['INBOUND', `Creata paletta ${code} (${quantity} q.tà)`, 'Gestionale', request.user.username]
            );
            
            generatedLabelsData.push({
              code,
              customer_name: customer.business_name,
              product_name: product.name,
              quantity,
              batch,
              warehouse,
              client_pallet_number,
              client_article_number,
              expiration_date
            });
          }

          // AGGIORNA ANAGRAFICA PRODOTTO CON I NUOVI MOLTIPLICATORI INSERITI IN INBOUND
          if (item.units_per_box || item.boxes_per_pallet) {
            await connection.query(
              'UPDATE PRODUCTS SET units_per_box = ?, boxes_per_pallet = ? WHERE id = ?',
              [item.units_per_box || 1, item.boxes_per_pallet || 1, product_id]
            );
          }
        }
      }
      await connection.commit();
      connection.release();

      if (noBarcode) {
        if (fastify.io) fastify.io.emit('dashboard_update');
        return reply.send({ success: true, message: 'Stock libero salvato senza barcode' });
      }

      const docOptions = { margin: 20 };
      if (paper_format === 'THERMAL') {
        docOptions.size = [283, 425];
      } else {
        docOptions.size = 'A4';
      }

      const doc = new PDFDocument(docOptions);
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', 'inline; filename="etichette.pdf"');
      reply.send(doc);

      if (paper_format === 'THERMAL' || print_mode === 'SINGLE_PAGE') {
        for (let i = 0; i < generatedLabelsData.length; i++) {
          if (i > 0) doc.addPage();
          const lbl = generatedLabelsData[i];
          const w = doc.page.width - 40;
          const h = doc.page.height - 40;
          await drawLabel(doc, lbl, 20, 20, w, h);
        }
      } else {
        const labelsPerRow = 2;
        const labelWidth = 265;
        const labelHeight = 180;
        const startX = 25;
        let startY = 25;

        for (let i = 0; i < generatedLabelsData.length; i++) {
          const lbl = generatedLabelsData[i];
          const col = i % labelsPerRow;
          const row = Math.floor((i % 8) / labelsPerRow);
          
          if (i > 0 && i % 8 === 0) {
            doc.addPage();
            startY = 25;
          }

          const x = startX + (col * (labelWidth + 15));
          const y = startY + (row * (labelHeight + 15));
          await drawLabel(doc, lbl, x, y, labelWidth, labelHeight);
        }
      }

      if (fastify.io) fastify.io.emit('dashboard_update');

      doc.end();
      return reply;
    } catch (err) {
      if (connection) {
        await connection.rollback();
        connection.release();
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante la generazione' });
    }
  });

  fastify.get('/:code', async (request, reply) => {
    const { code } = request.params;
    try {
      const [rows] = await db.query(`
        SELECT p.*, pr.name as product_name, COALESCE(p.pallet_uom, pr.uom) as uom, c.business_name as customer_name
        FROM PALLETS p
        JOIN PRODUCTS pr ON p.product_id = pr.id
        JOIN CUSTOMERS c ON p.customer_id = c.id
        WHERE p.pallet_code = ?
      `, [code]);
      
      if (rows.length === 0) {
        return reply.code(404).send({ error: 'Paletta non trovata' });
      }

      if (rows.length > 1) {
        // Paletta mista
        const mixedPallet = {
          ...rows[0],
          product_name: `PALETTA MISTA (${rows.length} Articoli)`,
          isMixed: true,
          items: rows
        };
        return mixedPallet;
      }
      
      return rows[0];
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore lettura paletta' });
    }
  });

  fastify.get('/:code/print', async (request, reply) => {
    const { code } = request.params;
    try {
      const [[pallet]] = await db.query(`
        SELECT p.*, pr.name as product_name, c.business_name as customer_name
        FROM PALLETS p
        JOIN PRODUCTS pr ON p.product_id = pr.id
        JOIN CUSTOMERS c ON p.customer_id = c.id
        WHERE p.pallet_code = ?
      `, [code]);

      if (!pallet) return reply.code(404).send({ error: 'Paletta non trovata' });

      const paper_format = request.query.format || 'THERMAL';
      const print_mode = request.query.mode || 'GRID';
      const copies = parseInt(request.query.copies, 10) || 1;

      const docOptions = { margin: 20 };
      if (paper_format === 'THERMAL') {
        docOptions.size = [283, 425];
      } else {
        docOptions.size = 'A4';
      }

      const doc = new PDFDocument(docOptions);
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `inline; filename="${code}.pdf"`);
      reply.send(doc);

      const lbl = {
        code: pallet.pallet_code,
        customer_name: pallet.customer_name,
        product_name: pallet.product_name,
        quantity: pallet.quantity,
        batch: pallet.batch,
        warehouse: pallet.warehouse,
        client_pallet_number: pallet.client_pallet_number,
        client_article_number: pallet.client_article_number,
        expiration_date: pallet.expiration_date
      };

      const generatedLabelsData = Array(copies).fill(lbl);

      if (paper_format === 'THERMAL' || print_mode === 'SINGLE_PAGE') {
        for (let i = 0; i < generatedLabelsData.length; i++) {
          if (i > 0) doc.addPage();
          const currentLbl = generatedLabelsData[i];
          const w = doc.page.width - 40;
          const h = doc.page.height - 40;
          await drawLabel(doc, currentLbl, 20, 20, w, h);
        }
      } else {
        const labelsPerRow = 2;
        const labelWidth = 265;
        const labelHeight = 180;
        const startX = 25;
        let startY = 25;

        for (let i = 0; i < generatedLabelsData.length; i++) {
          const currentLbl = generatedLabelsData[i];
          const col = i % labelsPerRow;
          const row = Math.floor((i % 8) / labelsPerRow);
          
          if (i > 0 && i % 8 === 0) {
            doc.addPage();
            startY = 25;
          }

          const x = startX + (col * (labelWidth + 15));
          const y = startY + (row * (labelHeight + 15));
          await drawLabel(doc, currentLbl, x, y, labelWidth, labelHeight);
        }
      }

      doc.end();
      return reply;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore stampa' });
    }
  });

  fastify.put('/:code/quantity', async (request, reply) => {
    const { code } = request.params;
    const { quantity, pallet_id } = request.body;

    if (quantity === undefined || quantity < 0) {
      return reply.code(400).send({ error: 'Quantità non valida' });
    }

    try {
      let oldPallet;
      if (pallet_id) {
        [[oldPallet]] = await db.query('SELECT quantity FROM PALLETS WHERE id = ?', [pallet_id]);
        if (!oldPallet) return reply.code(404).send({ error: 'Paletta non trovata' });
        await db.query('UPDATE PALLETS SET quantity = ? WHERE id = ?', [quantity, pallet_id]);
      } else {
        [[oldPallet]] = await db.query('SELECT quantity FROM PALLETS WHERE pallet_code = ?', [code]);
        if (!oldPallet) return reply.code(404).send({ error: 'Paletta non trovata' });
        await db.query('UPDATE PALLETS SET quantity = ? WHERE pallet_code = ?', [quantity, code]);
      }

      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['ADJUST_QTY', `Modificata q.tà paletta ${code}: da ${oldPallet.quantity} a ${quantity}`, 'Gestionale', request.user.username]
      );

      if (fastify.io) fastify.io.emit('dashboard_update');

      return { success: true, new_quantity: quantity };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante la modifica della quantità' });
    }
  });


  fastify.put('/:code', async (request, reply) => {
    const { code } = request.params;
    const { notes, client_pallet_number, client_article_number, expiration_date } = request.body;
    try {
      await db.query(
        'UPDATE PALLETS SET notes = ?, client_pallet_number = ?, client_article_number = ?, expiration_date = ? WHERE pallet_code = ?',
        [notes || null, client_pallet_number || null, client_article_number || null, expiration_date || null, code]
      );
      
      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['UPDATE', `Aggiornati metadati paletta ${code}`, 'Gestionale', request.user.username]
      );
      
      if (fastify.io) fastify.io.emit('dashboard_update');
      
      return { success: true };
    } catch(err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore salvataggio modifiche' });
    }
  });

  fastify.delete('/:code', async (request, reply) => {
    if (request.user.role !== 'developer') return reply.code(403).send({ error: 'Solo per developer' });
    const { code } = request.params;
    try {
      await db.query('DELETE FROM PALLETS WHERE pallet_code = ?', [code]);
      
      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['DELETE', `Eliminata fisicamente paletta ${code}`, 'Gestionale', request.user.username]
      );

      if (fastify.io) {
        fastify.io.emit('stow_updated');
        fastify.io.emit('dashboard_update');
      }
      return { success: true };
    } catch(err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore eliminazione paletta' });
    }
  });

  fastify.post('/stow', async (request, reply) => {
    const { pallet_code, location, pin, source = 'Zebra', force = false } = request.body;
    
    fastify.log.info(`[STOW] Received stow request: pallet=${pallet_code}, location=${location}, force=${force}`);

    if (!pallet_code || !location) {
      return reply.code(400).send({ error: 'Pallet Code e Location richiesti' });
    }

    try {
      if (!force) {
        const [occupied] = await db.query(
          "SELECT id, pallet_code FROM PALLETS WHERE location = ? AND status = 'STOCKED' AND pallet_code != ?", 
          [location, pallet_code]
        );
        
        if (occupied.length > 0) {
          fastify.log.info(`[STOW] Location occupied! Returning 409`);
          return reply.code(409).send({ 
            error: `La posizione ${location} è già occupata dalla paletta ${occupied[0].pallet_code}!`,
            occupying_pallet: occupied[0].pallet_code 
          });
        }
      } else {
        fastify.log.info(`[STOW] Force is true! Bypassing occupied check.`);
      }

      const [[loc]] = await db.query('SELECT * FROM LOCATIONS WHERE barcode = ?', [location]);
      
      if (loc) {
        if (pin && loc.pin !== pin) {
          return reply.code(403).send({ error: 'PIN di sicurezza ERRATO' });
        }
      } else {
        const parts = location.split('-');
        const zone = parts[0] || 'Z';
        const col = parts[1] || '00';
        const pos = parts[2] || '00';
        const finalPin = pin || Math.floor(10 + Math.random() * 90).toString(); 
        
        await db.query(
          'INSERT INTO LOCATIONS (zone, col, pos, barcode, pin) VALUES (?, ?, ?, ?, ?)',
          [zone, col, pos, location, finalPin]
        );
        await db.query(
          'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
          ['CREATE_LOC', `Creata nuova posizione ${location}`, source || 'Zebra', request.user.username]
        );
      }

      const [result] = await db.query(
        'UPDATE PALLETS SET location = ?, status = ? WHERE pallet_code = ?',
        [location, 'STOCKED', pallet_code]
      );
      
      if (result.affectedRows === 0) {
        return reply.code(404).send({ error: 'Paletta non trovata' });
      }

      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['STOW', `Paletta ${pallet_code} stivata in ${location}`, source || 'Zebra', request.user.username]
      );

      if (fastify.io) {
        fastify.io.emit('stow_updated');
        fastify.io.emit('dashboard_update');
      }

      return { success: true, message: `Paletta stivata in ${location}` };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante lo stivaggio' });
    }
  });
  
  fastify.get('/:code/history', async (request, reply) => {
    const { code } = request.params;
    try {
      const [[pallet]] = await db.query(`
        SELECT p.*, pr.name as product_name, pr.notes as product_notes, c.business_name as customer_name
        FROM PALLETS p
        JOIN PRODUCTS pr ON p.product_id = pr.id
        JOIN CUSTOMERS c ON p.customer_id = c.id
        WHERE p.pallet_code = ?
      `, [code]);
      
      if (!pallet) return reply.code(404).send({ error: 'Paletta non trovata' });
      
      const [history] = await db.query(`
        SELECT * FROM AUDIT_LOGS
        WHERE details LIKE ?
        ORDER BY created_at DESC
      `, [`%${code}%`]);
      
      return { pallet, history };
    } catch(err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore server' });
    }
  });
}

module.exports = palletRoutes;
