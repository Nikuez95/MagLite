const { hasPermission, canAccessCustomer } = require('../utils/permissions');
const db = require('../config/db');
const { drawLabel, generateLabelsPdfBuffer, sanitizeExpirationDate } = require('../utils/pdfLabels');

async function ensureLocationExists(connection, locStr, username) {
  if (!locStr) return;
  const cleanLoc = locStr.trim().toUpperCase().slice(0, 50);
  if (!cleanLoc) return;

  const [[existingLoc]] = await connection.query('SELECT id FROM LOCATIONS WHERE barcode = ?', [cleanLoc]);
  if (existingLoc) return;

  const [[existingFree]] = await connection.query('SELECT id FROM FREE_LOCATIONS WHERE UPPER(name) = ?', [cleanLoc]);
  if (existingFree) return;

  const parts = cleanLoc.split('-');
  const zone = (parts[0] || 'Z').slice(0, 10);
  const col = (parts[1] || '00').slice(0, 10);
  const pos = (parts[2] || '00').slice(0, 10);
  const finalPin = Math.floor(100 + Math.random() * 900).toString();

  await connection.query(
    'INSERT IGNORE INTO LOCATIONS (zone, col, pos, barcode, pin) VALUES (?, ?, ?, ?, ?)',
    [zone, col, pos, cleanLoc, finalPin]
  );
  await connection.query(
    'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
    ['CREATE_LOC', `Creata posizione automatica ${cleanLoc}`, 'Gestionale', username || 'Sistema']
  );
}

// Generatore progressivo di codici paletta giornalieri (es. PAL-20261020-0001, 0002, ...)
async function createPalletCodeGenerator(connection, prefix = 'PAL') {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const basePrefix = `${prefix}-${dateStr}-`;
  const [rows] = await connection.query(
    'SELECT DISTINCT pallet_code FROM PALLETS WHERE pallet_code LIKE ?',
    [`${basePrefix}%`]
  );
  let maxSeq = 0;
  for (const r of rows) {
    const suffix = String(r.pallet_code || '').slice(basePrefix.length);
    if (/^\d+$/.test(suffix)) {
      const num = parseInt(suffix, 10);
      if (num > maxSeq) maxSeq = num;
    }
  }
  return () => {
    maxSeq += 1;
    return `${basePrefix}${String(maxSeq).padStart(4, '0')}`;
  };
}

async function palletRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/', async (request, reply) => {
    try {
      const [rows] = await db.query(`
        SELECT p.*, pr.sku as sku, pr.name as product_name, COALESCE(p.pallet_uom, pr.uom) as uom, pr.notes as product_notes, c.business_name as customer_name, c.parent_id as customer_parent_id, COALESCE(p.units_per_box, pr.units_per_box) as units_per_box,
        (SELECT COUNT(*) > 1 FROM PALLETS p2 WHERE p2.pallet_code = p.pallet_code) as is_mixed
        FROM PALLETS p
        JOIN PRODUCTS pr ON p.product_id = pr.id
        JOIN CUSTOMERS c ON p.customer_id = c.id
        WHERE p.status != 'SHIPPED'
          AND (p.inbound_ddt_id IS NULL OR NOT EXISTS (SELECT 1 FROM INBOUND_DDTS d WHERE d.id = p.inbound_ddt_id AND d.status != 'COMPLETED'))
        ORDER BY p.created_at DESC
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
        SELECT p.*, pr.sku as sku, pr.name as product_name, COALESCE(p.pallet_uom, pr.uom) as uom, pr.notes as product_notes, c.business_name as customer_name, c.parent_id as customer_parent_id,
               COALESCE(p.units_per_box, pr.units_per_box) as units_per_box,
               l.zone, l.col, l.pos,
               (SELECT COUNT(*) > 1 FROM PALLETS p2 WHERE p2.pallet_code = p.pallet_code) as is_mixed
        FROM PALLETS p
        JOIN PRODUCTS pr ON p.product_id = pr.id
        JOIN CUSTOMERS c ON p.customer_id = c.id
        LEFT JOIN LOCATIONS l ON p.location = l.barcode
        WHERE p.status != 'SHIPPED'
          AND (p.inbound_ddt_id IS NULL OR NOT EXISTS (SELECT 1 FROM INBOUND_DDTS d WHERE d.id = p.inbound_ddt_id AND d.status != 'COMPLETED'))
      `);
      return rows;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante il recupero inventario' });
    }
  });

  fastify.post('/generate', async (request, reply) => {
    if (!hasPermission(request.user, 'inbound_create')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di aggiungere nuova merce.' });
    }
    if (Array.isArray(request.body?.cart)) {
      for (const it of request.body.cart) {
        if (it.customer_id && !canAccessCustomer(request.user, it.customer_id)) {
          return reply.code(403).send({ error: 'Accesso negato: non puoi aggiungere o toccare la merce del cliente selezionato.' });
        }
      }
    }
    const { cart, printOptions } = request.body;
    
    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      return reply.code(400).send({ error: 'Carrello vuoto o formato non valido' });
    }

    const { paper_format = 'A4', print_mode = 'GRID', isMixed = false, noBarcode = false, freeLocation = '' } = printOptions || {};

    let connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      
      const generatedLabelsData = []; 
      const nextPalletCode = await createPalletCodeGenerator(connection, noBarcode ? 'NOBAR' : 'PAL');
      
      if (isMixed || noBarcode) {
        // Generate ONLY ONE pallet code for the whole cart
        const firstCartLoc = cart.map(i => (i.location || '').trim().toUpperCase()).find(Boolean) || '';
        const finalLocation = noBarcode ? freeLocation.trim().toUpperCase() : (firstCartLoc || null);
        const finalStatus = (noBarcode || finalLocation) ? 'STOCKED' : 'PENDING';

        if (finalLocation && !noBarcode) {
          await ensureLocationExists(connection, finalLocation, request.user.username);
        }

        const code = nextPalletCode();
        if (finalLocation && !noBarcode) {
          await connection.query(
            "UPDATE PALLETS SET pallet_code = ? WHERE location = ? AND status = 'STOCKED'",
            [code, finalLocation]
          );
        }
        
        for (const item of cart) {
          const { customer_id, product_id, quantity, batch, warehouse, notes, client_pallet_number, client_article_number, expiration_date, arrival_date } = item;
          const cleanExpDate = sanitizeExpirationDate(expiration_date);
          
          await connection.query(
            'INSERT INTO PALLETS (pallet_code, customer_id, product_id, quantity, units_per_box, pallet_uom, batch, warehouse, status, location, notes, client_pallet_number, client_article_number, expiration_date, created_at, flags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?)',
            [code, customer_id, product_id, quantity, item.units_per_box || null, item.pallet_uom || null, batch || null, warehouse, finalStatus, finalLocation, notes || null, client_pallet_number || null, client_article_number || null, cleanExpDate, arrival_date ? new Date(arrival_date) : null, item.flags ? JSON.stringify(item.flags) : null]
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
          ['INBOUND', noBarcode ? `Carico libero in ${freeLocation} (${cart.length} art.)` : `Creata paletta frammentata ${code} (${cart.length} articoli)${finalLocation ? ' in ' + finalLocation : ''}`, 'Gestionale', request.user.username]
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
            expiration_date: sanitizeExpirationDate(cart[0].expiration_date),
            location: finalLocation
          });
        }
      } else {
        // Generazione rigorosamente progressiva e in ordine di riga (1° riga -> 1° barcode, 2° riga -> 2° barcode, ecc.)
        // Se più righe condividono la stessa identica posizione, si frammentano nel barcode assegnato alla prima riga di quella posizione.
        const orderedSlots = [];
        const locSlotMap = new Map();

        for (const item of cart) {
          const { customer_id, product_id, quantity, batch, warehouse, num_pallets, notes, client_pallet_number, client_article_number, expiration_date, arrival_date } = item;
          const itemLoc = (item.location || '').trim().toUpperCase();
          const cleanExpDate = sanitizeExpirationDate(expiration_date);
          
          const [[product]] = await connection.query('SELECT name FROM PRODUCTS WHERE id = ?', [product_id]);
          const [[customer]] = await connection.query('SELECT business_name FROM CUSTOMERS WHERE id = ?', [customer_id]);

          if (itemLoc) {
            let slot = locSlotMap.get(itemLoc);
            if (!slot) {
              await ensureLocationExists(connection, itemLoc, request.user.username);
              const code = nextPalletCode();
              // Unifica eventuali palette già stivate nella medesima posizione sotto il nuovo codice progressivo
              await connection.query(
                "UPDATE PALLETS SET pallet_code = ? WHERE location = ? AND status = 'STOCKED'",
                [code, itemLoc]
              );
              slot = { type: 'LOC', loc: itemLoc, code, rows: [] };
              locSlotMap.set(itemLoc, slot);
              orderedSlots.push(slot);
            }

            const countPallets = Math.max(1, parseInt(num_pallets, 10) || 1);
            const totalQtyForRow = (parseFloat(quantity) || 0) * countPallets;

            await connection.query(
              'INSERT INTO PALLETS (pallet_code, customer_id, product_id, quantity, units_per_box, pallet_uom, batch, warehouse, status, location, notes, client_pallet_number, client_article_number, expiration_date, created_at, flags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?)',
              [slot.code, customer_id, product_id, totalQtyForRow, item.units_per_box || null, item.pallet_uom || null, batch || null, warehouse, 'STOCKED', itemLoc, notes || null, client_pallet_number || null, client_article_number || null, cleanExpDate, arrival_date ? new Date(arrival_date) : null, item.flags ? JSON.stringify(item.flags) : null]
            );

            await connection.query(
              "INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)",
              ['INBOUND', `Creata/stivata paletta ${slot.code} in ${itemLoc} (${totalQtyForRow} q.tà)`, 'Gestionale', request.user.username]
            );

            slot.rows.push({
              customer_name: customer.business_name,
              product_name: product.name,
              quantity: totalQtyForRow,
              batch,
              warehouse,
              client_pallet_number,
              client_article_number,
              expiration_date: cleanExpDate
            });
          } else {
            const countPallets = Math.max(1, parseInt(num_pallets, 10) || 1);
            for (let i = 0; i < countPallets; i++) {
              const code = nextPalletCode();
              
              await connection.query(
                'INSERT INTO PALLETS (pallet_code, customer_id, product_id, quantity, units_per_box, pallet_uom, batch, warehouse, status, location, notes, client_pallet_number, client_article_number, expiration_date, created_at, flags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?)',
                [code, customer_id, product_id, quantity, item.units_per_box || null, item.pallet_uom || null, batch || null, warehouse, 'PENDING', null, notes || null, client_pallet_number || null, client_article_number || null, cleanExpDate, arrival_date ? new Date(arrival_date) : null, item.flags ? JSON.stringify(item.flags) : null]
              );
              
              await connection.query(
                "INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)",
                ['INBOUND', `Creata paletta ${code} (${quantity} q.tà)`, 'Gestionale', request.user.username]
              );
              
              orderedSlots.push({
                type: 'DIRECT',
                label: {
                  code,
                  customer_name: customer.business_name,
                  product_name: product.name,
                  quantity,
                  batch,
                  warehouse,
                  client_pallet_number,
                  client_article_number,
                  expiration_date: cleanExpDate,
                  location: null
                }
              });
            }
          }

          // AGGIORNA ANAGRAFICA PRODOTTO CON I NUOVI MOLTIPLICATORI INSERITI IN INBOUND
          if (item.units_per_box || item.boxes_per_pallet) {
            await connection.query(
              'UPDATE PRODUCTS SET units_per_box = ?, boxes_per_pallet = ? WHERE id = ?',
              [item.units_per_box || 1, item.boxes_per_pallet || 1, product_id]
            );
          }
        }

        // Compila generatedLabelsData rispettando rigorosamente l'ordine di riga (orderedSlots)
        for (const slot of orderedSlots) {
          if (slot.type === 'DIRECT') {
            generatedLabelsData.push(slot.label);
          } else if (slot.type === 'LOC' && slot.rows.length > 0) {
            if (slot.rows.length === 1) {
              const r = slot.rows[0];
              generatedLabelsData.push({
                code: slot.code,
                customer_name: r.customer_name,
                product_name: r.product_name,
                quantity: r.quantity,
                batch: r.batch,
                warehouse: r.warehouse,
                client_pallet_number: r.client_pallet_number,
                client_article_number: r.client_article_number,
                expiration_date: r.expiration_date,
                location: slot.loc
              });
            } else {
              const first = slot.rows[0];
              const uniqueProdNames = [...new Set(slot.rows.map(r => r.product_name))];
              const uniqueBatches = [...new Set(slot.rows.map(r => r.batch).filter(Boolean))];
              const uniqueArticles = [...new Set(slot.rows.map(r => r.client_article_number).filter(Boolean))];

              const labelProdName = uniqueProdNames.length === 1
                ? `${uniqueProdNames[0]} (${slot.rows.length} LOTTI)`
                : `PALETTA MISTA (${slot.rows.length} Articoli)`;

              generatedLabelsData.push({
                code: slot.code,
                customer_name: first.customer_name,
                product_name: labelProdName,
                quantity: '-',
                batch: uniqueBatches.length > 0 ? uniqueBatches.join(', ') : '-',
                warehouse: first.warehouse,
                client_pallet_number: first.client_pallet_number,
                client_article_number: uniqueArticles.length > 0 ? uniqueArticles.join(', ') : '-',
                expiration_date: first.expiration_date,
                location: slot.loc
              });
            }
          }
        }
      }
      await connection.commit();
      connection.release();
      connection = null;

      if (noBarcode) {
        if (fastify.io) fastify.io.emit('dashboard_update');
        return reply.send({ success: true, message: 'Stock libero salvato senza barcode' });
      }

      const pdfBuffer = await generateLabelsPdfBuffer(generatedLabelsData, { paper_format, print_mode });

      if (fastify.io) {
        fastify.io.emit('stow_updated');
        fastify.io.emit('dashboard_update');
      }

      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', 'inline; filename="etichette.pdf"');
      return reply.send(pdfBuffer);
    } catch (err) {
      if (connection) {
        await connection.rollback();
        connection.release();
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: err.message || 'Errore durante la generazione' });
    }
  });

  fastify.get('/:code', async (request, reply) => {
    const { code } = request.params;
    try {
      const [allRows] = await db.query(`
        SELECT p.*, pr.name as product_name, COALESCE(p.pallet_uom, pr.uom) as uom,
               COALESCE(p.units_per_box, pr.units_per_box, 1) as units_per_box,
               c.business_name as customer_name
        FROM PALLETS p
        JOIN PRODUCTS pr ON p.product_id = pr.id
        JOIN CUSTOMERS c ON p.customer_id = c.id
        WHERE p.pallet_code = ?
      `, [code]);
      
      if (allRows.length === 0) {
        return reply.code(404).send({ error: 'Paletta non trovata' });
      }

      const activeRows = allRows.filter(r => r.status !== 'SHIPPED' && parseFloat(r.quantity) > 0);
      const rows = activeRows.length > 0 ? activeRows : allRows;

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
      const [allRows] = await db.query(`
        SELECT p.*, pr.name as product_name, COALESCE(p.pallet_uom, pr.uom) as uom, c.business_name as customer_name
        FROM PALLETS p
        JOIN PRODUCTS pr ON p.product_id = pr.id
        JOIN CUSTOMERS c ON p.customer_id = c.id
        WHERE p.pallet_code = ?
        ORDER BY p.id ASC
      `, [code]);

      if (allRows.length === 0) return reply.code(404).send({ error: 'Paletta non trovata' });
      const activeRows = allRows.filter(r => r.status !== 'SHIPPED' && parseFloat(r.quantity) > 0);
      const rows = activeRows.length > 0 ? activeRows : allRows;
      const pallet = rows[0];

      const paper_format = request.query.format || 'THERMAL';
      const print_mode = request.query.mode || 'GRID';
      const copies = parseInt(request.query.copies, 10) || 1;

      const uniqueProdNames = [...new Set(rows.map(r => r.product_name))];
      const uniqueBatches = [...new Set(rows.map(r => r.batch).filter(Boolean))];
      const uniqueArticles = [...new Set(rows.map(r => r.client_article_number).filter(Boolean))];

      const lbl = {
        code: pallet.pallet_code,
        customer_name: pallet.customer_name,
        product_name: rows.length > 1
          ? (uniqueProdNames.length === 1 ? `${uniqueProdNames[0]} (${rows.length} LOTTI)` : `PALETTA MISTA (${rows.length} Articoli)`)
          : pallet.product_name,
        quantity: rows.length > 1 ? '-' : pallet.quantity,
        uom: pallet.uom,
        batch: rows.length > 1 ? (uniqueBatches.join(', ') || '-') : pallet.batch,
        warehouse: pallet.warehouse,
        client_pallet_number: pallet.client_pallet_number,
        client_article_number: rows.length > 1 ? (uniqueArticles.join(', ') || '-') : pallet.client_article_number,
        expiration_date: pallet.expiration_date,
        flags: pallet.flags,
        location: pallet.location || null
      };

      const generatedLabelsData = Array(copies).fill(lbl);
      const pdfBuffer = await generateLabelsPdfBuffer(generatedLabelsData, { paper_format, print_mode });

      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `inline; filename="${code}.pdf"`);
      return reply.send(pdfBuffer);
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore stampa' });
    }
  });

  fastify.post('/print-bulk', async (request, reply) => {
    const { ids, paper_format = 'A4', print_mode = 'GRID', copies = 1 } = request.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return reply.code(400).send({ error: 'Nessun ID fornito' });
    }

    try {
      // Mantiene rigorosamente l'ordine esatto dell'array ids ricevuto dal frontend
      // (Riga 1 visualizzata -> 1° barcode, Riga 2 -> 2° barcode, ecc.)
      const [idRows] = await db.query(`SELECT id, pallet_code FROM PALLETS WHERE id IN (?)`, [ids]);
      const idToCode = new Map(idRows.map(r => [Number(r.id), r.pallet_code]));
      const codes = [];
      const seenCodes = new Set();
      for (const rawId of ids) {
        const code = idToCode.get(Number(rawId));
        if (code && !seenCodes.has(code)) {
          seenCodes.add(code);
          codes.push(code);
        }
      }

      if (codes.length === 0) {
        return reply.code(404).send({ error: 'Nessuna paletta valida trovata per la stampa' });
      }

      const [allCodeRows] = await db.query(`
        SELECT p.*, pr.name as product_name, COALESCE(p.pallet_uom, pr.uom) as uom, c.business_name as customer_name
        FROM PALLETS p
        JOIN PRODUCTS pr ON p.product_id = pr.id
        JOIN CUSTOMERS c ON p.customer_id = c.id
        WHERE p.pallet_code IN (?)
        ORDER BY p.id ASC
      `, [codes]);

      const rowsByCode = new Map();
      for (const r of allCodeRows) {
        if (!rowsByCode.has(r.pallet_code)) rowsByCode.set(r.pallet_code, []);
        rowsByCode.get(r.pallet_code).push(r);
      }

      const generatedLabelsData = [];
      
      for (const code of codes) {
        const allRows = rowsByCode.get(code) || [];
        if (allRows.length === 0) continue;
        
        const activeRows = allRows.filter(r => r.status !== 'SHIPPED' && parseFloat(r.quantity) > 0);
        const rows = activeRows.length > 0 ? activeRows : allRows;
        const pallet = rows[0];
        const uniqueProdNames = [...new Set(rows.map(r => r.product_name))];
        const uniqueBatches = [...new Set(rows.map(r => r.batch).filter(Boolean))];
        const uniqueArticles = [...new Set(rows.map(r => r.client_article_number).filter(Boolean))];
        
        generatedLabelsData.push({
          code: pallet.pallet_code,
          customer_name: pallet.customer_name,
          product_name: rows.length > 1
            ? (uniqueProdNames.length === 1 ? `${uniqueProdNames[0]} (${rows.length} LOTTI)` : `PALETTA MISTA (${rows.length} Articoli)`)
            : pallet.product_name,
          quantity: rows.length > 1 ? '-' : pallet.quantity,
          uom: pallet.uom,
          batch: rows.length > 1 ? (uniqueBatches.join(', ') || '-') : pallet.batch,
          warehouse: pallet.warehouse,
          client_pallet_number: pallet.client_pallet_number,
          client_article_number: rows.length > 1 ? (uniqueArticles.join(', ') || '-') : pallet.client_article_number,
          expiration_date: pallet.expiration_date,
          flags: pallet.flags,
          location: pallet.location || null
        });
      }

      const finalLabels = [];
      for (const lbl of generatedLabelsData) {
        for (let i = 0; i < copies; i++) {
          finalLabels.push(lbl);
        }
      }

      const pdfBuffer = await generateLabelsPdfBuffer(finalLabels, { paper_format, print_mode });

      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', 'inline; filename="etichette_bulk.pdf"');
      return reply.send(pdfBuffer);
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore stampa bulk' });
    }
  });

  fastify.put('/:code/quantity', async (request, reply) => {
    if (!hasPermission(request.user, 'pallet_edit')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di modificare le quantità delle palette.' });
    }
    const { code } = request.params;
    const { quantity, pallet_id } = request.body;

    if (quantity === undefined || quantity < 0) {
      return reply.code(400).send({ error: 'Quantità non valida' });
    }

    try {
      const [checkRows] = pallet_id
        ? await db.query('SELECT id, customer_id, is_quarantined, quarantine_reason FROM PALLETS WHERE id = ?', [pallet_id])
        : await db.query('SELECT id, customer_id, is_quarantined, quarantine_reason FROM PALLETS WHERE pallet_code = ?', [code]);
      if (checkRows.some(r => r.is_quarantined)) {
        return reply.code(403).send({ error: 'BLOCCO QUARANTENA: Impossibile modificare la quantità di una paletta in quarantena. Sbloccala prima dal Registro Quarantene.' });
      }
      if (checkRows.some(r => !canAccessCustomer(request.user, r.customer_id))) {
        return reply.code(403).send({ error: 'Accesso negato: non puoi modificare la merce di questo cliente.' });
      }
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
    if (!hasPermission(request.user, 'pallet_edit')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di modificare le palette.' });
    }
    const { code } = request.params;
    const { notes, client_pallet_number, client_article_number, expiration_date } = request.body;
    try {
      const [checkRows] = await db.query('SELECT customer_id, is_quarantined FROM PALLETS WHERE pallet_code = ?', [code]);
      if (checkRows.some(r => r.is_quarantined)) {
        return reply.code(403).send({ error: 'BLOCCO QUARANTENA: Impossibile modificare una paletta in quarantena.' });
      }
      if (checkRows.some(r => !canAccessCustomer(request.user, r.customer_id))) {
        return reply.code(403).send({ error: 'Accesso negato: non puoi modificare la merce di questo cliente.' });
      }
      await db.query(
        'UPDATE PALLETS SET notes = ?, client_pallet_number = ?, client_article_number = ?, expiration_date = ? WHERE pallet_code = ?',
        [notes || null, client_pallet_number || null, client_article_number || null, sanitizeExpirationDate(expiration_date), code]
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
    if (!hasPermission(request.user, 'pallet_delete')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di eliminare palette.' });
    }
    const { code } = request.params;
    try {
      const [checkRows] = await db.query('SELECT customer_id, is_quarantined, quarantine_reason FROM PALLETS WHERE pallet_code = ? AND status != "SHIPPED"', [code]);
      if (checkRows.some(r => r.is_quarantined)) {
        return reply.code(403).send({ error: 'BLOCCO QUARANTENA: La paletta è in quarantena e non può essere eliminata! Deve prima essere sbloccata dal Registro Quarantene.' });
      }
      if (checkRows.some(r => !canAccessCustomer(request.user, r.customer_id))) {
        return reply.code(403).send({ error: 'Accesso negato: non puoi eliminare la merce di questo cliente.' });
      }
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


  // Unisci paletta a un'altra (Frammenta)
  fastify.post('/merge', async (request, reply) => {
    if (!hasPermission(request.user, 'pallet_move')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di unire o spostare palette.' });
    }
    const { source_code, target_code } = request.body;
    if (!source_code || !target_code) return reply.code(400).send({ error: 'Codici mancanti' });
    if (source_code === target_code) return reply.code(400).send({ error: 'I codici sono identici' });
    
    try {
      const [qRows] = await db.query('SELECT pallet_code, customer_id, is_quarantined FROM PALLETS WHERE pallet_code IN (?, ?) AND status != "SHIPPED"', [source_code, target_code]);
      if (qRows.some(r => r.is_quarantined)) {
        return reply.code(403).send({ error: 'BLOCCO QUARANTENA: Impossibile unire palette che si trovano in quarantena!' });
      }
      if (qRows.some(r => !canAccessCustomer(request.user, r.customer_id))) {
        return reply.code(403).send({ error: 'Accesso negato: non puoi operare sulla merce di questo cliente.' });
      }
      const [rows] = await db.query('SELECT id FROM PALLETS WHERE pallet_code = ?', [target_code]);
      if (rows.length === 0) return reply.code(404).send({ error: 'Paletta di destinazione non trovata' });
      
      await db.query('UPDATE PALLETS SET pallet_code = ? WHERE pallet_code = ?', [target_code, source_code]);
      
      await db.query(
          "INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)",
          ['MERGE', `Paletta ${source_code} frammentata e unita a ${target_code}`, 'Gestionale', request.user ? request.user.username : 'Sistema']
        );
      
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore unione palette' });
    }
  });
  
  fastify.post('/stow', async (request, reply) => {
    if (!hasPermission(request.user, 'pallet_move')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di spostare o stivare palette.' });
    }
    const { pallet_code, location, pin, source = 'Zebra', force = false } = request.body;
    
    fastify.log.info(`[STOW] Received stow request: pallet=${pallet_code}, location=${location}, force=${force}`);

    if (!pallet_code || !location) {
      return reply.code(400).send({ error: 'Pallet Code e Location richiesti' });
    }

    try {
      const [qRows] = await db.query('SELECT customer_id, is_quarantined, quarantine_reason FROM PALLETS WHERE pallet_code = ? AND status != "SHIPPED"', [pallet_code]);
      if (qRows.some(r => r.is_quarantined)) {
        const qReason = qRows.find(r => r.is_quarantined)?.quarantine_reason || 'Blocco qualità';
        return reply.code(403).send({
          error: `BLOCCO QUARANTENA: La paletta ${pallet_code} è in quarantena (${qReason}) e non può essere spostata! Sbloccala prima dal Registro Quarantene.`
        });
      }
      if (qRows.some(r => !canAccessCustomer(request.user, r.customer_id))) {
        return reply.code(403).send({ error: 'Accesso negato: non puoi spostare la merce di questo cliente.' });
      }
      if (!force) {
        const [occupied] = await db.query(
          "SELECT id, pallet_code FROM PALLETS WHERE location = ? AND status = 'STOCKED' AND quantity > 0 AND pallet_code != ?", 
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
      const [allRows] = await db.query(`
        SELECT p.*, pr.name as product_name, pr.notes as product_notes, c.business_name as customer_name
        FROM PALLETS p
        JOIN PRODUCTS pr ON p.product_id = pr.id
        JOIN CUSTOMERS c ON p.customer_id = c.id
        WHERE p.pallet_code = ?
        ORDER BY p.id ASC
      `, [code]);
      
      if (allRows.length === 0) return reply.code(404).send({ error: 'Paletta non trovata' });
      const activeRows = allRows.filter(r => r.status !== 'SHIPPED' && parseFloat(r.quantity) > 0);
      const rows = activeRows.length > 0 ? activeRows : allRows;
      const uniqueProdNames = [...new Set(rows.map(r => r.product_name))];
      const uniqueBatches = [...new Set(rows.map(r => r.batch).filter(Boolean))];

      const pallet = rows.length > 1
        ? {
            ...rows[0],
            product_name: uniqueProdNames.length === 1
              ? `${uniqueProdNames[0]} (${rows.length} LOTTI)`
              : `PALETTA MISTA (${rows.length} Articoli)`,
            batch: uniqueBatches.join(', ') || rows[0].batch,
            isMixed: true,
            items: rows
          }
        : rows[0];
      
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
