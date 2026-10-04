const db = require('../config/db');
const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');

async function getRoutingSettings(connection) {
  const [rows] = await connection.query('SELECT setting_key, setting_value FROM settings WHERE setting_key IN ("zone_routing_priority", "position_routing_priority")');
  let zonePriority = [];
  let posPriority = [];
  rows.forEach(r => {
    if (r.setting_key === 'zone_routing_priority') zonePriority = JSON.parse(r.setting_value);
    if (r.setting_key === 'position_routing_priority') posPriority = JSON.parse(r.setting_value);
  });
  return { zonePriority, posPriority };
}

function sortPalletsByRouting(pallets, zonePriority, posPriority) {
  const getZoneIndex = (z) => {
    if (!z || z === 'null') return 999;
    const idx = zonePriority.indexOf(z);
    return idx >= 0 ? idx : 999;
  };
  
  const getPosIndex = (pos) => {
    if (!pos) return 999;
    for (let i = 0; i < posPriority.length; i++) {
        const p = posPriority[i];
        if (p.split(',').map(s=>s.trim()).includes(pos)) return i;
    }
    return 999;
  };

  return pallets.sort((a, b) => {
    // 1. Expiration (FIFO)
    const expA = a.expiration_date ? new Date(a.expiration_date).getTime() : 9999999999999;
    const expB = b.expiration_date ? new Date(b.expiration_date).getTime() : 9999999999999;
    if (expA !== expB) return expA - expB;
    
    // 2. Zone Priority
    const trueZoneA = (a.zone && a.zone !== 'null') ? a.zone : a.location;
    const trueZoneB = (b.zone && b.zone !== 'null') ? b.zone : b.location;
    const zA = getZoneIndex(trueZoneA);
    const zB = getZoneIndex(trueZoneB);
    if (zA !== zB) return zA - zB;
    
    // 3. Pos Priority
    const pA = getPosIndex(a.pos);
    const pB = getPosIndex(b.pos);
    if (pA !== pB) return pA - pB;
    
    return 0;
  });
}

async function allocateOutboundItems(items, connection) {
  const allocatedPallets = [];
  const { zonePriority, posPriority } = await getRoutingSettings(connection);

  for (const req of items) {
    // Se c'è già il pallet_code (vecchio sistema), lo passiamo senza toccarlo
    if (req.pallet_code) {
      allocatedPallets.push(req);
      continue;
    }

    let query = `
      SELECT pal.*, loc.zone, loc.col, loc.pos, p.units_per_box 
      FROM PALLETS pal 
      JOIN PRODUCTS p ON pal.product_id = p.id 
      LEFT JOIN LOCATIONS loc ON pal.location = loc.barcode 
      WHERE pal.product_id = ? AND pal.status != 'SHIPPED' AND pal.quantity > 0
    `;
    const params = [req.product_id];
    if (req.batch && req.batch !== 'TUTTI' && req.batch !== 'Nessun lotto') {
       query += ` AND pal.batch = ?`;
       params.push(req.batch);
    } else if (req.batch === 'Nessun lotto') {
       query += ` AND (pal.batch IS NULL OR pal.batch = '')`;
    }
    
    const [available] = await connection.query(query, params);
    sortPalletsByRouting(available, zonePriority, posPriority);

    let remainingToAllocate = parseFloat(req.quantity_required);
    let allocatedForThisReq = [];

    for (const pal of available) {
       if (remainingToAllocate <= 0) break;

       let palletQtyInRequestedUom = parseFloat(pal.quantity);
       if (req.requested_uom === 'Scatole' || req.requested_uom === 'Cartoni') {
          palletQtyInRequestedUom = palletQtyInRequestedUom / (pal.units_per_box || 1);
       } else if (req.requested_uom === 'Bancali') {
          palletQtyInRequestedUom = 1;
       }

       if (palletQtyInRequestedUom <= 0) continue;

       let take = Math.min(remainingToAllocate, palletQtyInRequestedUom);
       
       allocatedForThisReq.push({
          pallet_code: pal.pallet_code,
          product_id: req.product_id,
          quantity_required: take,
          requested_uom: req.requested_uom
       });
       
       remainingToAllocate -= take;
       if (req.requested_uom === 'Bancali' && take >= 1) remainingToAllocate = 0;
    }

    if (remainingToAllocate > 0) {
       throw new Error(`Quantità insufficiente in magazzino per l'articolo ID ${req.product_id}`);
    }
    
    allocatedPallets.push(...allocatedForThisReq);
  }
  return allocatedPallets;
}

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

      const allocatedItemsPOST = await allocateOutboundItems(items, connection);
      for (const item of allocatedItemsPOST) {
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
      return reply.code(400).send({ error: err.message || "Errore nella creazione dell'ordine" });
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

      const allocatedItemsPUT = await allocateOutboundItems(items, connection);
      for (const item of allocatedItemsPUT) {
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
        JOIN PALLETS pal ON i.pallet_code = pal.pallet_code AND i.product_id = pal.product_id
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
        JOIN PALLETS pal ON i.pallet_code = pal.pallet_code AND i.product_id = pal.product_id
        LEFT JOIN LOCATIONS loc ON pal.location = loc.barcode
        WHERE i.order_id = ?
      `, [order.id]);

      const connection = await db.getConnection();
      try {
        const { zonePriority, posPriority } = await getRoutingSettings(connection);
        sortPalletsByRouting(items, zonePriority, posPriority);
      } finally {
        connection.release();
      }

      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `inline; filename="DDT_${code}.pdf"`);
      reply.send(doc);

      // --- BRAND HEADER ---
      const fs = require('fs');
      const path = require('path');
      const logoPath = path.join(__dirname, '../../../frontend/public/logo.png');
      
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 40, 30, { fit: [150, 50] });
      } else {
        doc.fillColor('#192935').font('Helvetica-Bold').fontSize(24).text('LOGISTIC PORCELLI', 40, 35, { align: 'left' });
      }
      
      doc.fillColor('#64748b').fontSize(10).font('Helvetica').text('Magazzino e Logistica Avanzata', 350, 45, { align: 'right', width: 200 });
      doc.moveDown(4);

      // --- DOCUMENT TITLE ---
      doc.y = 95;
      doc.fillColor('#192935').font('Helvetica-Bold').fontSize(16).text('DOCUMENTO DI TRASPORTO INTERNO (PICKING LIST)', 40, doc.y, { align: 'left' });
      doc.moveTo(40, doc.y + 5).lineTo(550, doc.y + 5).lineWidth(2).strokeColor('#192935').stroke();
      doc.moveDown(1.5);

      // --- INFO CARDS ---
      const infoTop = doc.y;
      doc.lineWidth(1);
      
      // Box Cliente
      doc.rect(40, infoTop, 245, 60).fillAndStroke('#f8fafc', '#e2e8f0');
      doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(9).text('CLIENTE DESTINATARIO:', 50, infoTop + 10);
      
      // Auto-shrink nome cliente
      let cName = (order.customer_name || '').toUpperCase();
      let maxFontSizeC = 14;
      doc.fontSize(maxFontSizeC).font('Helvetica-Bold');
      while (doc.widthOfString(cName) > 225 && maxFontSizeC > 8) {
        maxFontSizeC -= 1;
        doc.fontSize(maxFontSizeC);
      }
      doc.fillColor('#192935').text(cName, 50, infoTop + 25);

      // Box Spedizione
      doc.rect(305, infoTop, 245, 60).fillAndStroke('#f8fafc', '#e2e8f0');
      doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(9).text('DATA PREVISTA USCITA:', 315, infoTop + 10);
      doc.fillColor('#192935').font('Helvetica-Bold').fontSize(14).text(new Date(order.exit_date).toLocaleDateString('it-IT'), 315, infoTop + 25);

      doc.y = infoTop + 75;
      
      const detailsLines = [];
      if (order.client_ddt) {
        detailsLines.push(`RIF. DDT CLIENTE: ${order.client_ddt}`);
      }
      if (order.created_by) {
        detailsLines.push(`PREPARATO DA: ${order.created_by}`);
      }

      if (detailsLines.length > 0) {
        doc.fillColor('#192935').font('Helvetica-Bold').fontSize(11).text(detailsLines.join('   |   '), { align: 'center' });
        doc.moveDown(0.5);
      }

      // --- BARCODE SECTION ---
      doc.fillColor('#192935').font('Helvetica-Bold').fontSize(12).text('CODICE ORDINE: ' + order.order_code, { align: 'center' });
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
        doc.rect(40, yPos, 515, 25).fill('#192935');
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
        doc.text('POSIZIONE', 45, yPos + 8);
        doc.text('ARTICOLO', 135, yPos + 8);
        doc.text('LOTTO', 265, yPos + 8);
        doc.text('PALETTA', 345, yPos + 8);
        doc.text('Q.TÀ', 485, yPos + 8);
      };

      drawTableHeader(tableTop);
      let y = tableTop + 35;

      for (const item of items) {
        let locStr = 'NO POS.';
        if (item.zone && item.zone !== 'null') {
          locStr = `${item.zone} | ${item.col} | ${item.pos}`;
        } else if (item.location && item.location !== 'null') {
          locStr = item.location;
        }

        // Calculate height for article name to allow multiline
        const articleHeight = doc.font('Helvetica').fontSize(9).heightOfString(item.product_name, { width: 120 });
        const rowHeight = Math.max(25, articleHeight + 10);

        if (y + rowHeight > 780) {
          doc.addPage();
          drawTableHeader(40);
          y = 75;
        }
        
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#192935').text(locStr, 45, y, { width: 85 });
        doc.font('Helvetica').fontSize(9).fillColor('#334155').text(item.product_name, 135, y, { width: 120 });
        doc.text(item.batch || '-', 265, y, { width: 75 });
        
        const displayPallet = item.pallet_code.startsWith('NOBAR-') ? '-' : item.pallet_code;
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#192935').text(displayPallet, 345, y, { width: 135 });
        
        let qtyText = `${item.quantity_required} ${item.uom}`;
        if (item.units_per_box > 1 && item.uom !== 'Scatole' && item.uom !== 'Bancali') {
           const scatole = Math.floor(item.quantity_required / item.units_per_box);
           const sfusi = item.quantity_required % item.units_per_box;
           let breakDown = [];
           if (scatole > 0) breakDown.push(`${scatole} SCAT.`);
           if (sfusi > 0) breakDown.push(`${sfusi} SFUSI`);
           qtyText = breakDown.join(' + ');
        }

        doc.fillColor('#192935').font('Helvetica-Bold').fontSize(9).text(qtyText, 485, y, { width: 70 });
        
        doc.moveTo(40, y + rowHeight - 5).lineTo(555, y + rowHeight - 5).lineWidth(0.5).strokeColor('#e2e8f0').stroke();
        y += rowHeight;
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
        JOIN PALLETS pal ON i.pallet_code = pal.pallet_code AND i.product_id = pal.product_id
        LEFT JOIN LOCATIONS loc ON pal.location = loc.barcode
        WHERE i.order_id = ?
      `, [order.id]);

      const connection = await db.getConnection();
      try {
        const { zonePriority, posPriority } = await getRoutingSettings(connection);
        sortPalletsByRouting(items, zonePriority, posPriority);
      } finally {
        connection.release();
      }

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
        JOIN PALLETS pal ON i.pallet_code = pal.pallet_code AND i.product_id = pal.product_id
        LEFT JOIN LOCATIONS loc ON pal.location = loc.barcode
        JOIN PRODUCTS pr ON i.product_id = pr.id
        WHERE i.id = ? AND i.order_id = ?
      `, [item_id, order_id]);

      if (items.length === 0) return reply.code(404).send({ error: 'Riga ordine non trovata' });
      const item = items[0];

      // Controllo del PIN rimosso su richiesta
      // if (item.loc_pin && item.loc_pin.toLowerCase() !== pin.toLowerCase()) {
      //   return reply.code(400).send({ error: 'PIN Scaffale errato' });
      // }

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

      if (fastify.io) fastify.io.emit('dashboard_update');

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

          if (item.requested_uom === 'Bancali' && actualPicked >= 1) {
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
        await connection.query('UPDATE OUTBOUND_ORDERS SET status = "SHIPPED", shipped_at = CURRENT_TIMESTAMP, start_picking_at = CURRENT_TIMESTAMP, end_picking_at = CURRENT_TIMESTAMP, picking_operator = ?, shipped_by = ? WHERE id = ?', [request.user?.username || 'SYSTEM', request.user?.username || 'SYSTEM', order.id]);
        await connection.query('UPDATE OUTBOUND_ITEMS SET picked_at = CURRENT_TIMESTAMP WHERE order_id = ? AND picked_at IS NULL', [order.id]);
      } else {
        await connection.query('UPDATE OUTBOUND_ORDERS SET status = "SHIPPED", shipped_at = CURRENT_TIMESTAMP, shipped_by = ? WHERE id = ?', [request.user?.username || 'SYSTEM', order.id]);
      }

      await connection.commit();
      connection.release();
      
      if (fastify.io) fastify.io.emit('dashboard_update');
      
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
                     WHEN oi.requested_uom = 'Bancali' THEN pal.quantity 
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
  // GET /api/outbound/history/items
  fastify.get('/history/items', async (request, reply) => {
    try {
      const [rows] = await db.query(`
        SELECT 
          i.id,
          o.order_code,
          o.shipped_at,
          o.created_by AS operator_prep,
          o.shipped_by AS operator_ship,
          c.business_name AS customer_name,
          p.name AS product_name,
          i.pallet_code,
          pal.batch,
          i.quantity_picked,
          COALESCE(i.requested_uom, pal.pallet_uom, p.uom) AS uom
        FROM OUTBOUND_ITEMS i
        JOIN OUTBOUND_ORDERS o ON i.order_id = o.id
        JOIN CUSTOMERS c ON o.customer_id = c.id
        JOIN PRODUCTS p ON i.product_id = p.id
        LEFT JOIN PALLETS pal ON i.pallet_code = pal.pallet_code AND i.product_id = pal.product_id
        WHERE o.status = 'SHIPPED'
        ORDER BY o.shipped_at DESC
      `);
      return rows;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore nel recupero dello storico uscite' });
    }
  });

}
module.exports = outboundRoutes;
