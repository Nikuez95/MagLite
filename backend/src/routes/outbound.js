const db = require('../config/db');
const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');

async function outboundRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  // GET /api/outbound - List all orders
  fastify.get('/', async (request, reply) => {
    try {
      const [orders] = await db.query(`
        SELECT o.*, c.business_name as customer_name
        FROM OUTBOUND_ORDERS o
        JOIN CUSTOMERS c ON o.customer_id = c.id
        ORDER BY o.created_at DESC
      `);
      return orders;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore nel recupero degli ordini' });
    }
  });

  // POST /api/outbound - Create new order
  fastify.post('/', async (request, reply) => {
    const { customer_id, exit_date, items, client_ddt } = request.body; // items = [{ pallet_code, product_id, quantity_required }]
    const connection = await db.getConnection();
    
    try {
      await connection.beginTransaction();
      
      const orderCode = `OUT-${new Date().toISOString().slice(2,10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
      
      const username = request.user?.username || 'SYSTEM';
      
      const [orderRes] = await connection.query(
        'INSERT INTO OUTBOUND_ORDERS (order_code, customer_id, exit_date, created_by, client_ddt) VALUES (?, ?, ?, ?, ?)',
        [orderCode, customer_id ?? null, exit_date ?? null, username, client_ddt ?? null]
      );
      const orderId = orderRes.insertId;

      for (const item of items) {
        await connection.query(
          'INSERT INTO OUTBOUND_ITEMS (order_id, pallet_code, product_id, quantity_required, requested_uom) VALUES (?, ?, ?, ?, ?)',
          [orderId, item.pallet_code ?? null, item.product_id ?? null, item.quantity_required ?? null, item.requested_uom ?? null]
        );
      }
      
      // Audit Log
      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['CREATE_OUTBOUND', `Creata spedizione ${orderCode}`, 'BACKOFFICE', username]
      );

      fastify.io.emit('audit_log', {
        action: 'CREATE_OUTBOUND',
        details: `Creata spedizione ${orderCode}`,
        source: 'BACKOFFICE',
        username: username,
        created_at: new Date()
      });

      await connection.commit();
      connection.release();
      return { success: true, order_code: orderCode };
    } catch (err) {
      if (connection) {
        await connection.rollback();
        connection.release();
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: "Errore nella creazione dell'ordine" });
    }
  });

  // PUT /api/outbound/:id - Edit an outbound order
  fastify.put('/:id', async (request, reply) => {
    const { id } = request.params;
    const { customer_id, exit_date, items, client_ddt } = request.body;
    
    const userRole = request.user?.role;
    if (userRole !== 'developer' && userRole !== 'backoffice' && userRole !== 'admin') {
      return reply.code(403).send({ error: 'Non autorizzato a modificare le spedizioni' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      
      const [orders] = await connection.query('SELECT status FROM OUTBOUND_ORDERS WHERE id = ?', [id]);
      if (orders.length === 0) throw new Error('Ordine non trovato');
      if (orders[0].status === 'SHIPPED') throw new Error('Impossibile modificare un ordine già spedito.');

      await connection.query(
        'UPDATE OUTBOUND_ORDERS SET customer_id = ?, exit_date = ?, client_ddt = ?, status = "PENDING" WHERE id = ?',
        [customer_id ?? null, exit_date ?? null, client_ddt ?? null, id]
      );

      await connection.query('DELETE FROM OUTBOUND_ITEMS WHERE order_id = ?', [id]);

      for (const item of items) {
        await connection.query(
          'INSERT INTO OUTBOUND_ITEMS (order_id, pallet_code, product_id, quantity_required, requested_uom) VALUES (?, ?, ?, ?, ?)',
          [id, item.pallet_code ?? null, item.product_id ?? null, item.quantity_required ?? null, item.requested_uom ?? null]
        );
      }
      
      const orderCode = orders[0].order_code;
      const username = request.user?.username || 'SYSTEM';

      // Audit Log
      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['UPDATE_OUTBOUND', `Modificata spedizione ${orderCode}`, 'BACKOFFICE', username]
      );

      fastify.io.emit('audit_log', {
        action: 'UPDATE_OUTBOUND',
        details: `Modificata spedizione ${orderCode}`,
        source: 'BACKOFFICE',
        username: username,
        created_at: new Date()
      });

      await connection.commit();
      connection.release();
      return { success: true };
    } catch (err) {
      if (connection) {
        await connection.rollback();
        connection.release();
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: err.message || "Errore nella modifica dell'ordine" });
    }
  });

  // GET /api/outbound/:id/details - Get order details for editing
  fastify.get('/:id/details', async (request, reply) => {
    const { id } = request.params;
    try {
      const [orders] = await db.query('SELECT * FROM OUTBOUND_ORDERS WHERE id = ?', [id]);
      if (orders.length === 0) return reply.code(404).send({ error: 'Ordine non trovato' });
      
      const [items] = await db.query(`
        SELECT i.*, p.name as product_name, p.uom as base_uom, pal.batch, pal.location
        FROM OUTBOUND_ITEMS i
        JOIN PRODUCTS p ON i.product_id = p.id
        JOIN PALLETS pal ON i.pallet_code = pal.pallet_code
        WHERE i.order_id = ?
      `, [id]);
      
      return { order: orders[0], items };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore nel recupero dettagli ordine' });
    }
  });

  // DELETE /api/outbound/:id - Delete an outbound order (Developer / Backoffice)
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params;
    
    // Auth check
    const userRole = request.user?.role;
    if (userRole !== 'developer' && userRole !== 'backoffice' && userRole !== 'admin') {
      return reply.code(403).send({ error: 'Non autorizzato a eliminare le spedizioni' });
    }

    try {
      const [orders] = await db.query('SELECT status, order_code FROM OUTBOUND_ORDERS WHERE id = ?', [id]);
      if (orders.length === 0) return reply.code(404).send({ error: 'Ordine non trovato' });
      
      const order = orders[0];
      if (order.status === 'SHIPPED') {
        return reply.code(400).send({ error: 'Impossibile eliminare un ordine già confermato e spedito. Le giacenze sono già state scaricate.' });
      }

      await db.query('DELETE FROM OUTBOUND_ORDERS WHERE id = ?', [id]);
      
      const orderCode = order.order_code;
      const username = request.user?.username || 'SYSTEM';
      
      // Audit Log
      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['DELETE_OUTBOUND', `Eliminata spedizione ${orderCode}`, 'BACKOFFICE', username]
      );

      fastify.io.emit('audit_log', {
        action: 'DELETE_OUTBOUND',
        details: `Eliminata spedizione ${orderCode}`,
        source: 'BACKOFFICE',
        username: username,
        created_at: new Date()
      });

      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: "Errore nell'eliminazione dell'ordine" });
    }
  });

  // GET /api/outbound/:code/pdf - Print DDT / Picking List
  fastify.get('/:code/pdf', async (request, reply) => {
    const { code } = request.params;
    try {
      const [orders] = await db.query(`
        SELECT o.*, c.business_name as customer_name
        FROM OUTBOUND_ORDERS o
        JOIN CUSTOMERS c ON o.customer_id = c.id
        WHERE o.order_code = ?
      `, [code]);
      
      if (orders.length === 0) return reply.code(404).send({ error: 'Ordine non trovato' });
      const order = orders[0];

      const [items] = await db.query(`
        SELECT i.*, p.name as product_name, COALESCE(i.requested_uom, p.uom) as uom, p.units_per_box, pal.location, pal.batch, loc.zone, loc.col, loc.pos, loc.pin
        FROM OUTBOUND_ITEMS i
        JOIN PRODUCTS p ON i.product_id = p.id
        JOIN PALLETS pal ON i.pallet_code = pal.pallet_code
        LEFT JOIN LOCATIONS loc ON pal.location = loc.barcode
        WHERE i.order_id = ?
        ORDER BY loc.zone ASC, loc.col ASC, loc.pos ASC
      `, [order.id]);

      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `inline; filename="DDT_${code}.pdf"`);
      reply.send(doc);

      // --- BRAND HEADER ---
      doc.rect(0, 0, doc.page.width, 80).fill('#0ea5e9'); // Brand blue
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(28).text('LOGISTIC PORCELLI', 40, 25, { align: 'left' });
      doc.fontSize(10).font('Helvetica').text('Magazzino e Logistica Avanzata', 40, 55, { align: 'left' });
      
      // Reset color
      doc.fillColor('#000000');
      doc.moveDown(4);

      // --- DOCUMENT TITLE ---
      doc.font('Helvetica-Bold').fontSize(16).text('DOCUMENTO DI TRASPORTO INTERNO (PICKING LIST)', { align: 'left' });
      doc.moveTo(40, doc.y + 5).lineTo(550, doc.y + 5).lineWidth(2).strokeColor('#0ea5e9').stroke();
      doc.moveDown();

      // --- INFO CARDS ---
      const infoTop = doc.y + 10;
      doc.lineWidth(1);
      
      // Box Cliente
      doc.rect(40, infoTop, 245, 60).fillAndStroke('#f8fafc', '#cbd5e1');
      doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(9).text('CLIENTE DESTINATARIO:', 50, infoTop + 10);
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(14).text(order.customer_name, 50, infoTop + 25);

      // Box Spedizione
      doc.rect(305, infoTop, 245, 60).fillAndStroke('#f8fafc', '#cbd5e1');
      doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(9).text('DATA PREVISTA USCITA:', 315, infoTop + 10);
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(14).text(new Date(order.exit_date).toLocaleDateString('it-IT'), 315, infoTop + 25);

      doc.y = infoTop + 75;
      
      if (order.client_ddt) {
        doc.fillColor('#0ea5e9').font('Helvetica-Bold').fontSize(11).text(`RIF. DDT CLIENTE: ${order.client_ddt}`, { align: 'center' });
        doc.moveDown(0.5);
      }

      // --- BARCODE SECTION ---
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(12).text('CODICE ORDINE: ' + order.order_code, { align: 'center' });
      const barcodeBuffer = await bwipjs.toBuffer({
        bcid: 'code128',
        text: order.order_code,
        scale: 3,
        height: 12,
        includetext: true,
        textxalign: 'center',
      });
      doc.image(barcodeBuffer, (doc.page.width - 200) / 2, doc.y + 5, { width: 200 });
      doc.moveDown(5);
      
      doc.fillColor('#64748b').font('Helvetica').fontSize(10).text('Da scansionare con terminale Zebra per avviare il prelievo guidato', { align: 'center' });
      doc.moveDown(2);

      // --- ITEMS TABLE ---
      let tableTop = doc.y;
      
      const drawTableHeader = (yPos) => {
        doc.rect(40, yPos, 510, 25).fill('#f1f5f9');
        doc.fillColor('#334155').font('Helvetica-Bold').fontSize(9);
        doc.text('POSIZIONE', 50, yPos + 8);
        doc.text('ARTICOLO', 150, yPos + 8);
        doc.text('LOTTO', 315, yPos + 8);
        doc.text('PALETTA', 390, yPos + 8);
        doc.text('Q.TÀ', 495, yPos + 8);
        doc.moveTo(40, yPos + 25).lineTo(550, yPos + 25).lineWidth(1).strokeColor('#cbd5e1').stroke();
      };

      drawTableHeader(tableTop);
      let y = tableTop + 35;

      doc.fillColor('#0f172a').font('Helvetica').fontSize(10);
      for (const item of items) {
        if (y > 750) {
          doc.addPage();
          drawTableHeader(40);
          y = 75;
          doc.fillColor('#0f172a').font('Helvetica').fontSize(10);
        }
        
        const locStr = item.location ? `${item.zone} | ${item.col} | ${item.pos}` : 'NO POS.';
        
        doc.font('Helvetica-Bold').text(locStr, 50, y);
        doc.font('Helvetica').text(item.product_name, 150, y, { width: 155, lineBreak: false });
        doc.text(item.batch || '-', 315, y);
        doc.font('Helvetica-Bold').text(item.pallet_code, 390, y);
        
        let qtyText = `${item.quantity_required} ${item.uom}`;
        if (item.units_per_box > 1 && item.uom !== 'Scatole' && item.uom !== 'Bancale' && item.uom !== 'Bancali') {
           const scatole = Math.floor(item.quantity_required / item.units_per_box);
           const sfusi = item.quantity_required % item.units_per_box;
           let breakDown = [];
           if (scatole > 0) breakDown.push(`${scatole} SCAT.`);
           if (sfusi > 0) breakDown.push(`${sfusi} SFUSI`);
           qtyText = breakDown.join(' + ');
        }

        doc.fillColor('#0ea5e9').text(qtyText, 495, y, { lineBreak: false });
        doc.fillColor('#0f172a');
        
        doc.moveTo(40, y + 15).lineTo(550, y + 15).lineWidth(0.5).strokeColor('#e2e8f0').stroke();
        y += 25;
      }

      doc.end();
      return reply;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore generazione DDT' });
    }
  });

  // GET /api/outbound/zebra/:code - Fetch order details for Zebra
  fastify.get('/zebra/:code', async (request, reply) => {
    const { code } = request.params;
    try {
      const [orders] = await db.query('SELECT * FROM OUTBOUND_ORDERS WHERE order_code = ?', [code]);
      if (orders.length === 0) return reply.code(404).send({ error: 'Ordine non trovato' });
      const order = orders[0];

      if (order.status === 'SHIPPED') {
        return reply.code(400).send({ error: 'Ordine già spedito' });
      }

      const [items] = await db.query(`
        SELECT i.*, p.name as product_name, p.units_per_box, COALESCE(i.requested_uom, pal.pallet_uom, p.uom) as uom, pal.location, pal.batch, loc.zone, loc.col, loc.pos, loc.pin as loc_pin
        FROM OUTBOUND_ITEMS i
        JOIN PRODUCTS p ON i.product_id = p.id
        JOIN PALLETS pal ON i.pallet_code = pal.pallet_code
        LEFT JOIN LOCATIONS loc ON pal.location = loc.barcode
        WHERE i.order_id = ?
        ORDER BY 
          loc.zone ASC, 
          loc.col ASC, 
          loc.pos ASC
      `, [order.id]);

      // Imposta in PICKING se era PENDING
      if (order.status === 'PENDING') {
        await db.query('UPDATE OUTBOUND_ORDERS SET status = "PICKING" WHERE id = ?', [order.id]);
      }

      return { order, items };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore lettura ordine' });
    }
  });

  // POST /api/outbound/zebra/pick - Zebra confirms a pick step
  fastify.post('/zebra/pick', async (request, reply) => {
    const { order_id, item_id, pin, pallet_code, qty_picked } = request.body;
    try {
      // Verifica item
      const [items] = await db.query(`
        SELECT i.*, pal.location, loc.pin as loc_pin, pr.name as product_name
        FROM OUTBOUND_ITEMS i
        JOIN PALLETS pal ON i.pallet_code = pal.pallet_code
        LEFT JOIN LOCATIONS loc ON pal.location = loc.barcode
        JOIN PRODUCTS pr ON i.product_id = pr.id
        WHERE i.id = ? AND i.order_id = ?
      `, [item_id, order_id]);

      if (items.length === 0) return reply.code(404).send({ error: 'Riga ordine non trovata' });
      const item = items[0];

      // Se la paletta ha una posizione, verifica il PIN
      if (item.loc_pin && item.loc_pin.toLowerCase() !== pin.toLowerCase()) {
        return reply.code(400).send({ error: 'PIN Scaffale errato' });
      }

      // Verifica Barcode Paletta
      if (item.pallet_code.toLowerCase() !== pallet_code.toLowerCase()) {
        return reply.code(400).send({ error: 'Codice Paletta errato (Lotto non corrispondente)' });
      }

      // Aggiorna Riga Ordine
      await db.query('UPDATE OUTBOUND_ITEMS SET quantity_picked = ?, status = "PICKED", picked_at = CURRENT_TIMESTAMP WHERE id = ?', [qty_picked, item_id]);

      // Log Audit Zebra
      const operator = request.user?.username || 'ZEBRA';
      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        [
          'OUTBOUND_PICK',
          `Prelevati ${qty_picked} di ${item.product_name} dalla paletta ${item.pallet_code}`,
          'ZEBRA',
          operator
        ]
      );

      // Verifica se è il primo pezzo prelevato (per impostare l'inizio della bolla)
      const [order] = await db.query('SELECT start_picking_at FROM OUTBOUND_ORDERS WHERE id = ?', [order_id]);
      if (order.length > 0 && !order[0].start_picking_at) {
        await db.query('UPDATE OUTBOUND_ORDERS SET start_picking_at = CURRENT_TIMESTAMP, picking_operator = ? WHERE id = ?', [operator, order_id]);
      }

      // Controllo se l'intero ordine è pronto
      const [all_items] = await db.query('SELECT status FROM OUTBOUND_ITEMS WHERE order_id = ?', [order_id]);
      const allPicked = all_items.every(i => i.status === 'PICKED');
      
      if (allPicked) {
        await db.query('UPDATE OUTBOUND_ORDERS SET status = "READY", end_picking_at = CURRENT_TIMESTAMP WHERE id = ?', [order_id]);
      }

      return { success: true, all_picked: allPicked };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore registrazione prelievo' });
    }
  });

  // POST /api/outbound/:code/confirm - Finalize order from PC
  fastify.post('/:code/confirm', async (request, reply) => {
    const { code } = request.params;
    const connection = await db.getConnection();
    
    try {
      await connection.beginTransaction();

      const [orders] = await connection.query('SELECT * FROM OUTBOUND_ORDERS WHERE order_code = ?', [code]);
      if (orders.length === 0) throw new Error('Ordine non trovato');
      const order = orders[0];

      if (order.status === 'SHIPPED') {
        throw new Error('L\'ordine è già stato confermato e spedito.');
      }

      const [items] = await connection.query('SELECT * FROM OUTBOUND_ITEMS WHERE order_id = ?', [order.id]);

      for (const item of items) {
        // Usa quantity_picked se > 0 (Zebra usato), altrimenti assumi che dal PC si forzi quantity_required
        const actualPicked = parseFloat(item.quantity_picked) > 0 ? parseFloat(item.quantity_picked) : parseFloat(item.quantity_required);

        // Scarica la giacenza
        const [pallets] = await connection.query('SELECT pal.*, p.units_per_box FROM PALLETS pal JOIN PRODUCTS p ON pal.product_id = p.id WHERE pal.pallet_code = ? AND pal.product_id = ?', [item.pallet_code, item.product_id]);
        if (pallets.length > 0) {
          const pallet = pallets[0];
          let newQty;

          if (item.requested_uom === 'Bancale' && actualPicked >= 1) {
            newQty = 0;
          } else {
            let deduction = actualPicked;
            if (item.requested_uom === 'Scatole' || item.requested_uom === 'Cartoni') {
              deduction *= (pallet.units_per_box || 1);
            }
            newQty = parseFloat(pallet.quantity) - deduction;
          }
          
          if (newQty <= 0) {
            // Paletta esaurita, svuota la posizione e marca SHIPPED
            await connection.query('UPDATE PALLETS SET quantity = 0, status = "SHIPPED", location = NULL WHERE id = ?', [pallet.id]);
          } else {
            // Paletta parziale
            await connection.query('UPDATE PALLETS SET quantity = ? WHERE id = ?', [newQty, pallet.id]);
          }

          // Audit Log
          await connection.query(
            'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
            [
              'OUTBOUND_PICK', 
              `Prelevato ${actualPicked} da paletta ${pallet.pallet_code} (rimanenza: ${newQty})`,
              'BACKOFFICE',
              request.user?.username || 'SYSTEM'
            ]
          );
        }
      }

      if (!order.start_picking_at) {
        await connection.query('UPDATE OUTBOUND_ORDERS SET status = "SHIPPED", shipped_at = CURRENT_TIMESTAMP, start_picking_at = CURRENT_TIMESTAMP, end_picking_at = CURRENT_TIMESTAMP, picking_operator = ? WHERE id = ?', [request.user?.username || 'SYSTEM', order.id]);
        await connection.query('UPDATE OUTBOUND_ITEMS SET picked_at = CURRENT_TIMESTAMP WHERE order_id = ? AND picked_at IS NULL', [order.id]);
      } else {
        await connection.query('UPDATE OUTBOUND_ORDERS SET status = "SHIPPED", shipped_at = CURRENT_TIMESTAMP WHERE id = ?', [order.id]);
      }

      await connection.commit();
      connection.release();
      return { success: true };
    } catch (err) {
      if (connection) {
        await connection.rollback();
        connection.release();
      }
      fastify.log.error(err);
      return reply.code(400).send({ error: err.message || 'Errore durante la conferma spedizione' });
    }
  });

  // GET /api/outbound/search-pallets - Aiuto per PC per cercare palette disponibili
  fastify.get('/search-pallets', async (request, reply) => {
    const { customer_id, exclude_order_id, include_pending } = request.query;
    try {
      let excludeCondition = '';
      if (exclude_order_id && exclude_order_id !== 'undefined') {
        excludeCondition = `AND oo.id != ${db.escape(exclude_order_id)}`;
      }
      
      const statusCondition = include_pending === 'true' ? "IN ('STOCKED', 'PENDING')" : "= 'STOCKED'";

      const [pallets] = await db.query(`
        SELECT pal.*, l.zone, l.col, l.pos, p.name as product_name, COALESCE(pal.pallet_uom, p.uom) as uom, p.units_per_box, p.boxes_per_pallet,
               (pal.quantity - COALESCE((
                 SELECT SUM(
                   CASE 
                     WHEN oi.requested_uom = 'Bancale' THEN pal.quantity 
                     WHEN oi.requested_uom = 'Scatole' THEN (oi.quantity_required * p.units_per_box)
                     ELSE oi.quantity_required 
                   END
                 )
                 FROM OUTBOUND_ITEMS oi
                 JOIN OUTBOUND_ORDERS oo ON oi.order_id = oo.id
                 WHERE oi.pallet_code = pal.pallet_code
                   AND oo.status != 'SHIPPED'
                   ${excludeCondition}
               ), 0)) as available_quantity
        FROM PALLETS pal
        JOIN PRODUCTS p ON pal.product_id = p.id
        LEFT JOIN LOCATIONS l ON pal.location = l.barcode
        WHERE pal.customer_id = ? AND pal.status ${statusCondition}
        HAVING available_quantity > 0
        ORDER BY pal.expiration_date ASC, pal.created_at ASC
      `, [customer_id]);
      
      return pallets;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore ricerca palette' });
    }
  });
}

module.exports = outboundRoutes;
