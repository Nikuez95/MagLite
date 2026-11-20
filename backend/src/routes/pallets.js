const { hasPermission, canAccessCustomer } = require('../utils/permissions');
const db = require('../config/db');
const { drawLabel, generateLabelsPdfBuffer, sanitizeExpirationDate } = require('../utils/pdfLabels');
const { findExistingLocationBarcode, consolidateLocationPallets } = require('../utils/palletConsolidation');
const { withNamedLock } = require('../utils/concurrency');
const { formatBoxesBreakdown, recommendSlotForPallet, computeOptimizationTasks } = require('../utils/slotting');

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
        SELECT p.id, p.pallet_code, p.customer_id, p.product_id, p.quantity, p.units_per_box, p.pallet_uom,
               p.net_weight_kg, p.gross_weight_kg, p.tariff_plan_id,
               p.batch, p.warehouse, p.status, p.inbound_ddt_id, p.client_ddt, p.checkin_id, p.checkin_session_code,
               p.location, p.notes, p.client_pallet_number, p.client_article_number, p.expiration_date, p.flags,
               p.is_quarantined, p.quarantine_reason, p.quarantined_at, p.quarantined_by, p.quarantine_notes, p.created_at,
               pr.sku as sku, pr.name as product_name, COALESCE(p.pallet_uom, pr.uom) as uom, pr.notes as product_notes,
               c.business_name as customer_name, c.parent_id as customer_parent_id,
               tp.name as tariff_plan_name, tp.is_flat_rate as tariff_plan_flat_rate,
               COALESCE(p.units_per_box, pr.units_per_box) as units_per_box,
               IF(mx.pallet_code IS NOT NULL, 1, 0) as is_mixed
        FROM PALLETS p
        JOIN PRODUCTS pr ON p.product_id = pr.id
        JOIN CUSTOMERS c ON p.customer_id = c.id
        LEFT JOIN tariff_plans tp ON tp.id = p.tariff_plan_id
        LEFT JOIN INBOUND_DDTS d ON d.id = p.inbound_ddt_id
        LEFT JOIN (
          SELECT pallet_code
          FROM PALLETS
          WHERE status != 'SHIPPED' AND quantity > 0
          GROUP BY pallet_code
          HAVING COUNT(*) > 1
        ) mx ON mx.pallet_code = p.pallet_code
        WHERE p.status != 'SHIPPED'
          AND (p.inbound_ddt_id IS NULL OR d.status = 'COMPLETED')
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
        SELECT p.id, p.pallet_code, p.customer_id, p.product_id, p.quantity, p.units_per_box, p.pallet_uom,
               p.net_weight_kg, p.gross_weight_kg, p.tariff_plan_id,
               p.batch, p.warehouse, p.status, p.inbound_ddt_id, p.client_ddt, p.checkin_id, p.checkin_session_code,
               p.location, p.notes, p.client_pallet_number, p.client_article_number, p.expiration_date, p.flags,
               p.is_quarantined, p.quarantine_reason, p.quarantined_at, p.quarantined_by, p.quarantine_notes, p.created_at,
               pr.sku as sku, pr.name as product_name, COALESCE(p.pallet_uom, pr.uom) as uom, pr.notes as product_notes,
               c.business_name as customer_name, c.parent_id as customer_parent_id,
               tp.name as tariff_plan_name,
               COALESCE(p.units_per_box, pr.units_per_box) as units_per_box,
               l.zone, l.col, l.pos,
               IF(mx.pallet_code IS NOT NULL, 1, 0) as is_mixed
        FROM PALLETS p
        JOIN PRODUCTS pr ON p.product_id = pr.id
        JOIN CUSTOMERS c ON p.customer_id = c.id
        LEFT JOIN tariff_plans tp ON tp.id = p.tariff_plan_id
        LEFT JOIN LOCATIONS l ON p.location = l.barcode
        LEFT JOIN INBOUND_DDTS d ON d.id = p.inbound_ddt_id
        LEFT JOIN (
          SELECT pallet_code
          FROM PALLETS
          WHERE status != 'SHIPPED' AND quantity > 0
          GROUP BY pallet_code
          HAVING COUNT(*) > 1
        ) mx ON mx.pallet_code = p.pallet_code
        WHERE p.status != 'SHIPPED'
          AND (p.inbound_ddt_id IS NULL OR d.status = 'COMPLETED')
      `);
      return rows.filter(r => canAccessCustomer(request.user, r.customer_id));
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
    const { cart, printOptions, client_ddt, checkin_id, checkin_session_code } = request.body || {};
    
    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      return reply.code(400).send({ error: 'Carrello vuoto o formato non valido' });
    }

    const { paper_format = 'A4', print_mode = 'GRID', isMixed = false, noBarcode = false, freeLocation = '' } = printOptions || {};

    let connection = await db.getConnection();
    try {
      const generatedLabelsData = await withNamedLock(connection, 'maglite_pallet_gen', async () => {
        await connection.beginTransaction();
        try {
          let effectiveCheckinId = checkin_id || null;
          let effectiveSessionCode = checkin_session_code || null;
          const cleanClientDdt = client_ddt && String(client_ddt).trim() ? String(client_ddt).trim() : null;

          if (!effectiveCheckinId && cleanClientDdt) {
            const [matched] = await connection.query(`
              SELECT id, session_code FROM CUSTOM_FORM_SUBMISSIONS
              WHERE JSON_UNQUOTE(JSON_EXTRACT(answers, '$.step_ddt')) = ?
                 OR JSON_UNQUOTE(JSON_EXTRACT(answers, '$.step_container')) = ?
                 OR session_code = ?
              ORDER BY id DESC LIMIT 1
            `, [cleanClientDdt, cleanClientDdt, cleanClientDdt]);
            if (matched.length > 0) {
              effectiveCheckinId = matched[0].id;
              effectiveSessionCode = matched[0].session_code;
            }
          }
          
          const labelsData = []; 
          const nextPalletCode = await createPalletCodeGenerator(connection, noBarcode ? 'NOBAR' : 'PAL');
      
      if (isMixed || noBarcode) {
        // Generate or reuse ONE pallet code for the whole cart
        const firstCartLoc = cart.map(i => (i.location || '').trim().toUpperCase()).find(Boolean) || '';
        const finalLocation = noBarcode ? freeLocation.trim().toUpperCase() : (firstCartLoc || null);
        const finalStatus = (noBarcode || finalLocation) ? 'STOCKED' : 'PENDING';

        if (finalLocation && !noBarcode) {
          await ensureLocationExists(connection, finalLocation, request.user.username);
        }

        // Se nella posizione è già presente una paletta attiva, riutilizziamo il suo barcode esistente
        const existingCode = finalLocation
          ? await findExistingLocationBarcode(connection, finalLocation, noBarcode)
          : null;
        const code = existingCode || nextPalletCode();

        if (finalLocation && !noBarcode) {
          await connection.query(
            "UPDATE PALLETS SET pallet_code = ? WHERE location = ? AND status = 'STOCKED' AND quantity > 0",
            [code, finalLocation]
          );
        }
        
        const parseOptNum = (v) => (v === null || v === undefined || v === '') ? null : (Number.isFinite(parseFloat(v)) ? parseFloat(v) : null);
        const parseOptInt = (v) => (v === null || v === undefined || v === '') ? null : (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : null);

        for (const item of cart) {
          const { customer_id, product_id, quantity, batch, warehouse, notes, client_pallet_number, client_article_number, expiration_date, arrival_date, num_pallets } = item;
          const cleanExpDate = sanitizeExpirationDate(expiration_date);
          const countPallets = Math.max(1, parseInt(num_pallets, 10) || 1);
          const totalQtyForRow = (parseFloat(quantity) || 0) * countPallets;
          const itemPlanId = parseOptInt(item.tariff_plan_id);
          const itemNetKg = parseOptNum(item.net_weight_kg);
          const itemGrossKg = parseOptNum(item.gross_weight_kg);
          
          await connection.query(
            'INSERT INTO PALLETS (pallet_code, customer_id, product_id, quantity, units_per_box, pallet_uom, net_weight_kg, gross_weight_kg, tariff_plan_id, batch, warehouse, status, location, notes, client_pallet_number, client_article_number, expiration_date, created_at, flags, client_ddt, checkin_id, checkin_session_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?, ?)',
            [code, customer_id, product_id, totalQtyForRow, item.units_per_box || null, item.pallet_uom || null, itemNetKg, itemGrossKg, itemPlanId, batch || null, warehouse, finalStatus, finalLocation, notes || null, client_pallet_number || null, client_article_number || null, cleanExpDate, arrival_date ? new Date(arrival_date) : null, item.flags ? JSON.stringify(item.flags) : null, cleanClientDdt, effectiveCheckinId, effectiveSessionCode]
          );
          
          if (item.units_per_box || item.boxes_per_pallet) {
            await connection.query(
              'UPDATE PRODUCTS SET units_per_box = ?, boxes_per_pallet = ? WHERE id = ?',
              [item.units_per_box || 1, item.boxes_per_pallet || 1, product_id]
            );
          }
        }

        if (finalLocation) {
          await consolidateLocationPallets(connection, finalLocation);
        }
        
        await connection.query(
          "INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)",
          ['INBOUND', noBarcode ? `Carico libero in ${freeLocation} (${cart.length} art.)` : `${existingCode ? 'Agganciato a' : 'Creata'} paletta frammentata ${code} (${cart.length} articoli)${finalLocation ? ' in ' + finalLocation : ''}`, 'Gestionale', request.user.username]
        );
        
        if (!noBarcode) {
          const [activeRows] = await connection.query(`
            SELECT p.*, pr.name as product_name, COALESCE(p.pallet_uom, pr.uom) as uom, c.business_name as customer_name
            FROM PALLETS p
            JOIN PRODUCTS pr ON p.product_id = pr.id
            JOIN CUSTOMERS c ON p.customer_id = c.id
            WHERE p.pallet_code = ? AND p.status != 'SHIPPED' AND p.quantity > 0
            ORDER BY p.id ASC
          `, [code]);

          if (activeRows.length === 1) {
            const r = activeRows[0];
            labelsData.push({
              code,
              customer_name: r.customer_name,
              product_name: r.product_name,
              quantity: r.quantity,
              uom: r.uom,
              batch: r.batch || '-',
              warehouse: r.warehouse,
              client_pallet_number: r.client_pallet_number,
              client_article_number: r.client_article_number || '-',
              expiration_date: sanitizeExpirationDate(r.expiration_date),
              location: finalLocation
            });
          } else {
            const rowsForLabel = activeRows.length > 0 ? activeRows : cart;
            const [[customer]] = await connection.query('SELECT business_name FROM CUSTOMERS WHERE id = ?', [cart[0].customer_id]);
            const uniqueProdNames = activeRows.length > 0 ? [...new Set(activeRows.map(r => r.product_name))] : [];
            const uniqueBatches = [...new Set(rowsForLabel.map(r => r.batch).filter(Boolean))];
            const uniqueArticles = [...new Set(rowsForLabel.map(r => r.client_article_number).filter(Boolean))];
            const labelProdName = uniqueProdNames.length === 1
              ? `${uniqueProdNames[0]} (${rowsForLabel.length} LOTTI)`
              : `PALETTA MISTA (${rowsForLabel.length} Articoli)`;

            labelsData.push({
              code,
              customer_name: activeRows[0]?.customer_name || customer.business_name,
              product_name: labelProdName,
              quantity: '-',
              batch: uniqueBatches.length > 0 ? uniqueBatches.join(', ') : '-',
              warehouse: cart[0].warehouse,
              client_pallet_number: cart[0].client_pallet_number,
              client_article_number: uniqueArticles.length > 0 ? uniqueArticles.join(', ') : '-',
              expiration_date: sanitizeExpirationDate(cart[0].expiration_date),
              location: finalLocation
            });
          }
        }
      } else {
        // Generazione rigorosamente progressiva e in ordine di riga (1° riga -> 1° barcode, 2° riga -> 2° barcode, ecc.)
        // Se la posizione ha già una paletta con barcode esistente, si aggancia a quel barcode senza cambiarlo.
        // Se più righe condividono la stessa identica posizione, si frammentano/unificano nel barcode di quella posizione.
        const parseOptNum = (v) => (v === null || v === undefined || v === '') ? null : (Number.isFinite(parseFloat(v)) ? parseFloat(v) : null);
        const parseOptInt = (v) => (v === null || v === undefined || v === '') ? null : (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : null);

        const orderedSlots = [];
        const locSlotMap = new Map();
        const groupSlotMap = new Map();

        for (const item of cart) {
          const { customer_id, product_id, quantity, batch, warehouse, num_pallets, notes, client_pallet_number, client_article_number, expiration_date, arrival_date } = item;
          const itemLoc = (item.location || '').trim().toUpperCase();
          const itemGroup = (item.pallet_group || '').trim();
          const cleanExpDate = sanitizeExpirationDate(expiration_date);
          const itemPlanId = parseOptInt(item.tariff_plan_id);
          const itemNetKg = parseOptNum(item.net_weight_kg);
          const itemGrossKg = parseOptNum(item.gross_weight_kg);
          
          const [[product]] = await connection.query('SELECT name FROM PRODUCTS WHERE id = ?', [product_id]);
          const [[customer]] = await connection.query('SELECT business_name FROM CUSTOMERS WHERE id = ?', [customer_id]);

          if (itemLoc) {
            let slot = locSlotMap.get(itemLoc);
            if (!slot) {
              await ensureLocationExists(connection, itemLoc, request.user.username);
              // Se c'è già un barcode attivo nella posizione, agganciati ad esso senza generarne uno nuovo
              const existingCode = await findExistingLocationBarcode(connection, itemLoc, false);
              const code = existingCode || nextPalletCode();
              await connection.query(
                "UPDATE PALLETS SET pallet_code = ? WHERE location = ? AND status = 'STOCKED' AND quantity > 0",
                [code, itemLoc]
              );
              slot = { type: 'LOC', loc: itemLoc, code, existedBefore: Boolean(existingCode), rows: [] };
              locSlotMap.set(itemLoc, slot);
              orderedSlots.push(slot);
            }

            const countPallets = Math.max(1, parseInt(num_pallets, 10) || 1);
            const totalQtyForRow = (parseFloat(quantity) || 0) * countPallets;

            await connection.query(
              'INSERT INTO PALLETS (pallet_code, customer_id, product_id, quantity, units_per_box, pallet_uom, net_weight_kg, gross_weight_kg, tariff_plan_id, batch, warehouse, status, location, notes, client_pallet_number, client_article_number, expiration_date, created_at, flags, client_ddt, checkin_id, checkin_session_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?, ?)',
              [slot.code, customer_id, product_id, totalQtyForRow, item.units_per_box || null, item.pallet_uom || null, itemNetKg, itemGrossKg, itemPlanId, batch || null, warehouse, 'STOCKED', itemLoc, notes || null, client_pallet_number || null, client_article_number || null, cleanExpDate, arrival_date ? new Date(arrival_date) : null, item.flags ? JSON.stringify(item.flags) : null, cleanClientDdt, effectiveCheckinId, effectiveSessionCode]
            );

            await connection.query(
              "INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)",
              ['INBOUND', `${slot.existedBefore ? 'Agganciata merce a paletta' : 'Creata/stivata paletta'} ${slot.code} in ${itemLoc} (${totalQtyForRow} q.tà)`, 'Gestionale', request.user.username]
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
          } else if (itemGroup) {
            let slot = groupSlotMap.get(itemGroup);
            if (!slot) {
              const code = nextPalletCode();
              slot = { type: 'GROUP', group: itemGroup, loc: null, code, rows: [] };
              groupSlotMap.set(itemGroup, slot);
              orderedSlots.push(slot);
            }

            const countPallets = Math.max(1, parseInt(num_pallets, 10) || 1);
            const totalQtyForRow = (parseFloat(quantity) || 0) * countPallets;

            await connection.query(
              'INSERT INTO PALLETS (pallet_code, customer_id, product_id, quantity, units_per_box, pallet_uom, net_weight_kg, gross_weight_kg, tariff_plan_id, batch, warehouse, status, location, notes, client_pallet_number, client_article_number, expiration_date, created_at, flags, client_ddt, checkin_id, checkin_session_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?, ?)',
              [slot.code, customer_id, product_id, totalQtyForRow, item.units_per_box || null, item.pallet_uom || null, itemNetKg, itemGrossKg, itemPlanId, batch || null, warehouse, 'PENDING', null, notes || null, client_pallet_number || null, client_article_number || null, cleanExpDate, arrival_date ? new Date(arrival_date) : null, item.flags ? JSON.stringify(item.flags) : null, cleanClientDdt, effectiveCheckinId, effectiveSessionCode]
            );

            await connection.query(
              "INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)",
              ['INBOUND', `Aggiunta riga a paletta frammentata ${slot.code} (${itemGroup}: ${product.name}, ${totalQtyForRow} q.tà)`, 'Gestionale', request.user.username]
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
                'INSERT INTO PALLETS (pallet_code, customer_id, product_id, quantity, units_per_box, pallet_uom, net_weight_kg, gross_weight_kg, tariff_plan_id, batch, warehouse, status, location, notes, client_pallet_number, client_article_number, expiration_date, created_at, flags, client_ddt, checkin_id, checkin_session_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?, ?)',
                [code, customer_id, product_id, quantity, item.units_per_box || null, item.pallet_uom || null, itemNetKg, itemGrossKg, itemPlanId, batch || null, warehouse, 'PENDING', null, notes || null, client_pallet_number || null, client_article_number || null, cleanExpDate, arrival_date ? new Date(arrival_date) : null, item.flags ? JSON.stringify(item.flags) : null, cleanClientDdt, effectiveCheckinId, effectiveSessionCode]
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

        // Consolida tutte le posizioni toccate (somma eventuali righe identiche per prodotto + lotto nella stessa posizione)
        for (const loc of locSlotMap.keys()) {
          await consolidateLocationPallets(connection, loc);
        }

        // Compila labelsData rispettando rigorosamente l'ordine di riga (orderedSlots)
        for (const slot of orderedSlots) {
          if (slot.type === 'DIRECT') {
            labelsData.push(slot.label);
          } else if ((slot.type === 'LOC' || slot.type === 'GROUP') && slot.rows.length > 0) {
            const [activeRows] = await connection.query(`
              SELECT p.*, pr.name as product_name, COALESCE(p.pallet_uom, pr.uom) as uom, c.business_name as customer_name
              FROM PALLETS p
              JOIN PRODUCTS pr ON p.product_id = pr.id
              JOIN CUSTOMERS c ON p.customer_id = c.id
              WHERE p.pallet_code = ? AND p.status != 'SHIPPED' AND p.quantity > 0
              ORDER BY p.id ASC
            `, [slot.code]);

            const effectiveRows = activeRows.length > 0 ? activeRows : slot.rows;

            if (effectiveRows.length === 1) {
              const r = effectiveRows[0];
              labelsData.push({
                code: slot.code,
                customer_name: r.customer_name,
                product_name: r.product_name,
                quantity: r.quantity,
                uom: r.uom,
                batch: r.batch,
                warehouse: r.warehouse,
                client_pallet_number: r.client_pallet_number,
                client_article_number: r.client_article_number,
                expiration_date: sanitizeExpirationDate(r.expiration_date),
                location: slot.loc
              });
            } else {
              const first = effectiveRows[0];
              const uniqueProdNames = [...new Set(effectiveRows.map(r => r.product_name))];
              const uniqueBatches = [...new Set(effectiveRows.map(r => r.batch).filter(Boolean))];
              const uniqueArticles = [...new Set(effectiveRows.map(r => r.client_article_number).filter(Boolean))];

              const labelProdName = uniqueProdNames.length === 1
                ? `${uniqueProdNames[0]} (${effectiveRows.length} LOTTI)`
                : `PALETTA MISTA (${effectiveRows.length} Articoli)`;

              labelsData.push({
                code: slot.code,
                customer_name: first.customer_name,
                product_name: labelProdName,
                quantity: '-',
                batch: uniqueBatches.length > 0 ? uniqueBatches.join(', ') : '-',
                warehouse: first.warehouse,
                client_pallet_number: first.client_pallet_number,
                client_article_number: uniqueArticles.length > 0 ? uniqueArticles.join(', ') : '-',
                expiration_date: sanitizeExpirationDate(first.expiration_date),
                location: slot.loc
              });
            }
          }
        }
      }
          await connection.commit();
          return labelsData;
        } catch (txErr) {
          await connection.rollback();
          throw txErr;
        }
      });

      connection.release();
      connection = null;

      if (noBarcode) {
        if (fastify.io) {
          fastify.io.emit('inventory_updated');
          fastify.io.emit('stow_updated');
          fastify.io.emit('locations_updated');
          fastify.io.emit('dashboard_update');
        }
        return reply.send({ success: true, message: 'Stock libero salvato senza barcode' });
      }

      const pdfBuffer = await generateLabelsPdfBuffer(generatedLabelsData, { paper_format, print_mode });

      if (fastify.io) {
        fastify.io.emit('inventory_updated');
        fastify.io.emit('stow_updated');
        fastify.io.emit('locations_updated');
        fastify.io.emit('dashboard_update');
      }

      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', 'inline; filename="etichette.pdf"');
      return reply.send(pdfBuffer);
    } catch (err) {
      if (connection) {
        try { await connection.rollback(); } catch (_) {}
        connection.release();
      }
      fastify.log.error(err);
      return reply.code(err.statusCode || 500).send({ error: err.message || 'Errore durante la generazione' });
    }
  });

  // ---------------------------------------------------------------------------
  // SLOTTING INTELLIGENTE, OTTIMIZZAZIONE ZEBRA & VERIFICA DISCREPANZE BARCODE
  // ---------------------------------------------------------------------------

  // GET /api/pallets/slotting/recommend?pallet_code=PAL-...&zone=CELLA2
  fastify.get('/slotting/recommend', async (request, reply) => {
    if (!hasPermission(request.user, 'pallet_move') && !hasPermission(request.user, 'zebra_verify') && !hasPermission(request.user, 'zebra_optimize')) {
      return reply.code(403).send({ error: 'Accesso negato allo slotting intelligente.' });
    }
    const { pallet_code, zone } = request.query || {};
    if (!pallet_code) {
      return reply.code(400).send({ error: 'pallet_code obbligatorio' });
    }
    try {
      const rec = await recommendSlotForPallet(db, String(pallet_code).trim().toUpperCase(), zone || null);
      if (!rec) {
        return reply.code(404).send({ error: 'Paletta non trovata o non più attiva' });
      }
      return rec;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore calcolo posizionamento consigliato' });
    }
  });

  // GET /api/pallets/inspect/:code (scansione barcode paletta o scaffale per verifica & discrepanze)
  fastify.get('/inspect/:code', async (request, reply) => {
    if (!hasPermission(request.user, 'zebra_verify') && !hasPermission(request.user, 'pallet_edit')) {
      return reply.code(403).send({ error: 'Accesso negato: permesso Verifica & Correzione Discrepanze richiesto.' });
    }
    const rawCode = String(request.params.code || '').trim().toUpperCase();
    if (!rawCode) {
      return reply.code(400).send({ error: 'Barcode mancante' });
    }

    try {
      let targetPalletCode = rawCode;
      let scannedAsLocation = false;

      let [rows] = await db.query(`
        SELECT p.*, pr.sku, pr.name AS product_name,
               COALESCE(p.pallet_uom, pr.uom) AS uom,
               COALESCE(p.units_per_box, pr.units_per_box, 1) AS units_per_box,
               COALESCE(pr.boxes_per_pallet, 1) AS boxes_per_pallet,
               c.business_name AS customer_name
        FROM PALLETS p
        JOIN PRODUCTS pr ON p.product_id = pr.id
        JOIN CUSTOMERS c ON p.customer_id = c.id
        WHERE UPPER(TRIM(p.pallet_code)) = ?
        ORDER BY p.id ASC
      `, [targetPalletCode]);

      // Se non è un pallet_code diretto, controlla se l'operatore ha scansionato lo scaffale / posizione
      if (rows.length === 0) {
        const [locPallets] = await db.query(`
          SELECT DISTINCT p.pallet_code
          FROM PALLETS p
          WHERE UPPER(TRIM(p.location)) = ? AND p.status = 'STOCKED' AND p.quantity > 0
          ORDER BY p.id ASC
        `, [rawCode]);
        if (locPallets.length > 0) {
          scannedAsLocation = true;
          targetPalletCode = locPallets[0].pallet_code;
          [rows] = await db.query(`
            SELECT p.*, pr.sku, pr.name AS product_name,
                   COALESCE(p.pallet_uom, pr.uom) AS uom,
                   COALESCE(p.units_per_box, pr.units_per_box, 1) AS units_per_box,
                   COALESCE(pr.boxes_per_pallet, 1) AS boxes_per_pallet,
                   c.business_name AS customer_name
            FROM PALLETS p
            JOIN PRODUCTS pr ON p.product_id = pr.id
            JOIN CUSTOMERS c ON p.customer_id = c.id
            WHERE UPPER(TRIM(p.pallet_code)) = ?
            ORDER BY p.id ASC
          `, [targetPalletCode]);
        }
      }

      if (rows.length === 0) {
        return reply.code(404).send({ error: `Nessuna paletta trovata per il codice ${rawCode}` });
      }

      if (rows.some(r => !canAccessCustomer(request.user, r.customer_id))) {
        return reply.code(403).send({ error: 'Accesso negato: non puoi visualizzare la merce di questo cliente.' });
      }

      const activeRows = rows.filter(r => r.status !== 'SHIPPED' && parseFloat(r.quantity) > 0);
      const displayRows = activeRows.length > 0 ? activeRows : rows;
      const primary = displayRows[0];

      const cleanLoc = String(primary.location || '').trim().toUpperCase();
      const [[freeMatch]] = cleanLoc
        ? await db.query('SELECT id, name FROM FREE_LOCATIONS WHERE UPPER(TRIM(name)) = ?', [cleanLoc])
        : [[null]];
      const [[locMatch]] = cleanLoc
        ? await db.query('SELECT id, zone, col, pos, barcode FROM LOCATIONS WHERE UPPER(TRIM(barcode)) = ?', [cleanLoc])
        : [[null]];

      const items = displayRows.map(r => ({
        id: r.id,
        pallet_code: r.pallet_code,
        customer_id: r.customer_id,
        customer_name: r.customer_name,
        product_id: r.product_id,
        sku: r.sku,
        product_name: r.product_name,
        quantity: parseFloat(r.quantity) || 0,
        units_per_box: parseInt(r.units_per_box, 10) || 1,
        boxes_per_pallet: parseInt(r.boxes_per_pallet, 10) || 1,
        uom: r.uom,
        boxes_breakdown: formatBoxesBreakdown(r.quantity, r.units_per_box, r.uom),
        batch: r.batch || null,
        expiration_date: sanitizeExpirationDate(r.expiration_date),
        notes: r.notes || null,
        client_pallet_number: r.client_pallet_number || null,
        client_article_number: r.client_article_number || null,
        status: r.status,
        is_quarantined: Boolean(r.is_quarantined),
        quarantine_reason: r.quarantine_reason || null,
        created_at: r.created_at
      }));

      const slotting = primary.status !== 'SHIPPED' && activeRows.length > 0
        ? await recommendSlotForPallet(db, primary.pallet_code, locMatch?.zone || null)
        : null;

      return {
        pallet_code: primary.pallet_code,
        scanned_as_location: scannedAsLocation,
        customer_name: primary.customer_name,
        status: primary.status,
        is_mixed: items.length > 1,
        is_quarantined: items.some(i => i.is_quarantined),
        location: cleanLoc || null,
        location_status: {
          is_mapped: Boolean(locMatch && !freeMatch),
          is_free_location: Boolean(freeMatch),
          is_pending: !cleanLoc || primary.status === 'PENDING',
          zone: locMatch?.zone || null,
          col: locMatch?.col || null,
          pos: locMatch?.pos || null
        },
        items,
        slotting
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore ispezione barcode' });
    }
  });

  // POST /api/pallets/verify-discrepancy
  fastify.post('/verify-discrepancy', async (request, reply) => {
    if (!hasPermission(request.user, 'zebra_verify') && !hasPermission(request.user, 'pallet_edit')) {
      return reply.code(403).send({ error: 'Accesso negato: permesso Verifica & Correzione Discrepanze richiesto.' });
    }
    const { pallet_code, pallet_id, action = 'VERIFY_OK', quantity, batch, expiration_date, notes } = request.body || {};
    if (!pallet_code) {
      return reply.code(400).send({ error: 'pallet_code richiesto' });
    }

    const connection = await db.getConnection();
    try {
      const outcome = await withNamedLock(connection, 'maglite_pallet_loc', async () => {
        await connection.beginTransaction();
        try {
          const [rows] = pallet_id
            ? await connection.query('SELECT * FROM PALLETS WHERE id = ? FOR UPDATE', [pallet_id])
            : await connection.query('SELECT * FROM PALLETS WHERE pallet_code = ? AND status != "SHIPPED" FOR UPDATE', [pallet_code]);

          if (rows.length === 0) {
            await connection.rollback();
            return { status: 404, body: { error: 'Paletta non trovata' } };
          }
          if (rows.some(r => !canAccessCustomer(request.user, r.customer_id))) {
            await connection.rollback();
            return { status: 403, body: { error: 'Accesso negato per questo cliente.' } };
          }
          if (action === 'CORRECT' && rows.some(r => r.is_quarantined)) {
            await connection.rollback();
            return { status: 403, body: { error: 'BLOCCO QUARANTENA: Sblocca prima la paletta per correggerne la quantità o i dati.' } };
          }

          if (action === 'VERIFY_OK') {
            await connection.query(
              'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
              ['VERIFY_OK', `Controllo Zebra OK per ${pallet_code}${rows[0].location ? ' in ' + rows[0].location : ''} (${rows.length} righe)`, 'Zebra', request.user.username]
            );
            await connection.commit();
            return { status: 200, body: { success: true, message: 'Verifica registrata con successo' } };
          }

          if (rows.length > 1 && !pallet_id) {
            await connection.rollback();
            return { status: 400, body: { error: 'Seleziona la specifica riga articolo della paletta mista da rettificare.' } };
          }

          const targetRow = rows[0];
          const newQty = quantity !== undefined && quantity !== null ? parseFloat(quantity) : parseFloat(targetRow.quantity);
          if (isNaN(newQty) || newQty < 0) {
            await connection.rollback();
            return { status: 400, body: { error: 'Quantità non valida' } };
          }

          const newBatch = batch !== undefined ? (String(batch).trim() || null) : targetRow.batch;
          const newExp = expiration_date !== undefined ? sanitizeExpirationDate(expiration_date) : sanitizeExpirationDate(targetRow.expiration_date);
          const newNotes = notes !== undefined ? (String(notes).trim() || null) : targetRow.notes;

          await connection.query(
            'UPDATE PALLETS SET quantity = ?, batch = ?, expiration_date = ?, notes = ? WHERE id = ?',
            [newQty, newBatch, newExp, newNotes, targetRow.id]
          );

          await connection.query(
            'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
            [
              'DISCREPANCY_FIX',
              `Rettifica discrepanza Zebra su ${pallet_code} (riga #${targetRow.id}): Q.tà ${targetRow.quantity} -> ${newQty}, Lotto "${targetRow.batch || '-'}" -> "${newBatch || '-'}"`,
              'Zebra',
              request.user.username
            ]
          );

          await connection.commit();
          return { status: 200, body: { success: true, message: 'Discrepanza corretta e registrata in Audit.' } };
        } catch (txErr) {
          await connection.rollback();
          throw txErr;
        }
      });

      if (outcome.status !== 200) {
        return reply.code(outcome.status).send(outcome.body);
      }

      if (fastify.io && action === 'CORRECT') {
        fastify.io.emit('inventory_updated');
        fastify.io.emit('stow_updated');
        fastify.io.emit('locations_updated');
        fastify.io.emit('dashboard_update');
      }

      return outcome.body;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(err.statusCode || 500).send({ error: err.message || 'Errore verifica discrepanza' });
    } finally {
      connection.release();
    }
  });

  // GET /api/pallets/optimization/scores - Punteggio ottimizzazione magazzino e per singola zona (Desktop Mappa Magazzino & Zebra)
  fastify.get('/optimization/scores', async (request, reply) => {
    if (!hasPermission(request.user, 'view_locations') && !hasPermission(request.user, 'pallet_move') && !hasPermission(request.user, 'zebra_optimize')) {
      return reply.code(403).send({ error: 'Accesso negato ai punteggi di ottimizzazione.' });
    }
    try {
      const result = await computeOptimizationTasks(db, canAccessCustomer, request.user);
      return {
        warehouseScore: result.warehouseScore,
        zoneScores: result.zoneScores,
        summary: result.summary
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore calcolo punteggio ottimizzazione' });
    }
  });

  // GET /api/pallets/optimization/tasks
  fastify.get('/optimization/tasks', async (request, reply) => {
    if (!hasPermission(request.user, 'zebra_optimize')) {
      return reply.code(403).send({ error: 'Accesso negato: permesso Task Ottimizzazione Zebra richiesto.' });
    }
    try {
      const result = await computeOptimizationTasks(db, canAccessCustomer, request.user);
      const zoneFilter = request.query?.zone ? String(request.query.zone).trim().toUpperCase() : null;
      const tasks = zoneFilter
        ? result.tasks.filter(t => String(t.zone || '').toUpperCase() === zoneFilter)
        : result.tasks;
      const [[pinSetting]] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'require_location_pins'");
      const requirePins = pinSetting ? pinSetting.setting_value === 'true' : true;
      return { ...result, tasks, requirePins };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore generazione task ottimizzazione magazzino' });
    }
  });

  // POST /api/pallets/optimization/execute
  fastify.post('/optimization/execute', async (request, reply) => {
    if (!hasPermission(request.user, 'zebra_optimize')) {
      return reply.code(403).send({ error: 'Accesso negato: permesso Task Ottimizzazione Zebra richiesto.' });
    }
    const { action_type, pallet_code, to_location, source_codes, target_code, target_location, pin } = request.body || {};
    if (!action_type) {
      return reply.code(400).send({ error: 'action_type richiesto' });
    }

    const connection = await db.getConnection();
    try {
      const outcome = await withNamedLock(connection, 'maglite_pallet_loc', async () => {
        await connection.beginTransaction();
        try {
          const [[pinSetting]] = await connection.query("SELECT setting_value FROM settings WHERE setting_key = 'require_location_pins'");
          const requirePins = pinSetting ? pinSetting.setting_value === 'true' : true;

          if (action_type === 'MOVE') {
            if (!pallet_code || !to_location) {
              await connection.rollback();
              return { status: 400, body: { error: 'pallet_code e to_location obbligatori' } };
            }
            const cleanTargetLoc = String(to_location).trim().toUpperCase();
            const [pRows] = await connection.query(
              'SELECT id, customer_id, location, is_quarantined FROM PALLETS WHERE pallet_code = ? AND status != "SHIPPED" FOR UPDATE',
              [pallet_code]
            );
            if (pRows.length === 0) {
              await connection.rollback();
              return { status: 404, body: { error: 'Paletta non trovata' } };
            }
            if (pRows.some(r => r.is_quarantined) || pRows.some(r => !canAccessCustomer(request.user, r.customer_id))) {
              await connection.rollback();
              return { status: 403, body: { error: 'Operazione non consentita su questa paletta (quarantena o cliente non autorizzato).' } };
            }

            const [[locRow]] = await connection.query('SELECT * FROM LOCATIONS WHERE UPPER(TRIM(barcode)) = ?', [cleanTargetLoc]);
            if (locRow && requirePins && pin && locRow.pin !== String(pin).trim()) {
              await connection.rollback();
              return { status: 403, body: { error: 'PIN scaffale di destinazione errato' } };
            }
            if (locRow && requirePins && !pin) {
              await connection.rollback();
              return { status: 400, body: { error: 'Inserisci il PIN dello scaffale di destinazione per confermare lo spostamento.' } };
            }

            const [occ] = await connection.query(
              'SELECT pallet_code FROM PALLETS WHERE UPPER(TRIM(location)) = ? AND status = "STOCKED" AND quantity > 0 AND pallet_code != ? FOR UPDATE',
              [cleanTargetLoc, pallet_code]
            );
            if (occ.length > 0) {
              await connection.rollback();
              return { status: 409, body: { error: `La posizione ${cleanTargetLoc} è appena stata occupata da ${occ[0].pallet_code}` } };
            }

            await connection.query(
              'UPDATE PALLETS SET location = ?, status = "STOCKED" WHERE pallet_code = ? AND status != "SHIPPED"',
              [cleanTargetLoc, pallet_code]
            );
            await consolidateLocationPallets(connection, cleanTargetLoc);
            await connection.query(
              'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
              ['OPT_MOVE', `Task Ottimizzazione: spostata ${pallet_code} da ${pRows[0].location || '-'} a ${cleanTargetLoc}`, 'Zebra', request.user.username]
            );
            await connection.commit();
            return { status: 200, body: { success: true, message: `Paletta ${pallet_code} riordinata in ${cleanTargetLoc}` } };
          }

          if (action_type === 'MERGE_BATCH' || action_type === 'CONSOLIDATE_FRAGMENTS') {
            const cleanSources = Array.isArray(source_codes) ? source_codes.map(c => String(c).trim()).filter(Boolean) : [];
            const cleanTargetCode = String(target_code || '').trim();
            const cleanTargetLoc = target_location ? String(target_location).trim().toUpperCase() : null;

            if (!cleanTargetCode || cleanSources.length === 0) {
              await connection.rollback();
              return { status: 400, body: { error: 'target_code e source_codes richiesti' } };
            }

            const allCodes = [...new Set([cleanTargetCode, ...cleanSources])];
            const placeholders = allCodes.map(() => '?').join(',');
            const [lockedRows] = await connection.query(
              `SELECT id, pallet_code, customer_id, location, is_quarantined FROM PALLETS WHERE pallet_code IN (${placeholders}) AND status != "SHIPPED" FOR UPDATE`,
              allCodes
            );
            if (lockedRows.some(r => r.is_quarantined) || lockedRows.some(r => !canAccessCustomer(request.user, r.customer_id))) {
              await connection.rollback();
              return { status: 403, body: { error: 'Una o più palette sono bloccate in quarantena o non autorizzate.' } };
            }

            const targetRows = lockedRows.filter(r => r.pallet_code === cleanTargetCode);
            if (targetRows.length === 0) {
              await connection.rollback();
              return { status: 404, body: { error: `Paletta target ${cleanTargetCode} non trovata` } };
            }

            const originalTargetLoc = String(targetRows[0].location || '').trim().toUpperCase();
            const finalLoc = cleanTargetLoc || originalTargetLoc;

            if (finalLoc && finalLoc !== originalTargetLoc) {
              const [[locRow]] = await connection.query('SELECT * FROM LOCATIONS WHERE UPPER(TRIM(barcode)) = ?', [finalLoc]);
              if (locRow && requirePins && pin && locRow.pin !== String(pin).trim()) {
                await connection.rollback();
                return { status: 403, body: { error: 'PIN scaffale di destinazione errato' } };
              }
              if (locRow && requirePins && !pin) {
                await connection.rollback();
                return { status: 400, body: { error: 'Inserisci il PIN dello scaffale di destinazione.' } };
              }
              const [occ] = await connection.query(
                `SELECT pallet_code FROM PALLETS WHERE UPPER(TRIM(location)) = ? AND status = "STOCKED" AND quantity > 0 AND pallet_code NOT IN (${placeholders}) FOR UPDATE`,
                [finalLoc, ...allCodes]
              );
              if (occ.length > 0) {
                await connection.rollback();
                return { status: 409, body: { error: `Posizione ${finalLoc} già occupata da ${occ[0].pallet_code}` } };
              }
            }

            await connection.query(
              `UPDATE PALLETS SET pallet_code = ?, location = ?, status = "STOCKED" WHERE pallet_code IN (${placeholders}) AND status != "SHIPPED"`,
              [cleanTargetCode, finalLoc, ...allCodes]
            );

            if (finalLoc) {
              await consolidateLocationPallets(connection, finalLoc);
            }

            await connection.query(
              'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
              [
                action_type === 'MERGE_BATCH' ? 'OPT_MERGE_BATCH' : 'OPT_FRAGMENT',
                `Task Ottimizzazione (${action_type}): unite [${cleanSources.join(', ')}] in ${cleanTargetCode} -> ${finalLoc}`,
                'Zebra',
                request.user.username
              ]
            );

            await connection.commit();
            return {
              status: 200,
              body: {
                success: true,
                message: `Accorpate ${cleanSources.length} palette in ${cleanTargetCode} (${finalLoc})`
              }
            };
          }

          await connection.rollback();
          return { status: 400, body: { error: 'action_type non supportato' } };
        } catch (txErr) {
          await connection.rollback();
          throw txErr;
        }
      });

      if (outcome.status !== 200) {
        return reply.code(outcome.status).send(outcome.body);
      }

      if (fastify.io) {
        fastify.io.emit('inventory_updated');
        fastify.io.emit('stow_updated');
        fastify.io.emit('locations_updated');
        fastify.io.emit('dashboard_update');
      }

      return outcome.body;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(err.statusCode || 500).send({ error: err.message || 'Errore esecuzione task ottimizzazione' });
    } finally {
      connection.release();
    }
  });

  // GET /api/pallets/by-location/:locName - Restituisce tutti gli articoli attivi in una posizione (anche FREE_LOCATIONS)
  fastify.get('/by-location/:locName', async (request, reply) => {
    const cleanLoc = decodeURIComponent(request.params.locName || '').trim().toUpperCase();
    if (!cleanLoc) {
      return reply.code(400).send({ error: 'Nome posizione mancante' });
    }
    try {
      const [[freeRow]] = await db.query('SELECT id, name FROM FREE_LOCATIONS WHERE UPPER(TRIM(name)) = ?', [cleanLoc]);
      const [[locRow]] = await db.query('SELECT id, zone, col, pos, barcode FROM LOCATIONS WHERE UPPER(TRIM(barcode)) = ?', [cleanLoc]);

      const [rows] = await db.query(`
        SELECT p.*, pr.sku, pr.name as product_name, COALESCE(p.pallet_uom, pr.uom) as uom,
               COALESCE(p.units_per_box, pr.units_per_box, 1) as units_per_box,
               c.business_name as customer_name
        FROM PALLETS p
        JOIN PRODUCTS pr ON p.product_id = pr.id
        JOIN CUSTOMERS c ON p.customer_id = c.id
        WHERE UPPER(TRIM(p.location)) = ? AND p.status = 'STOCKED' AND p.quantity > 0
        ORDER BY p.id ASC
      `, [cleanLoc]);

      const visibleRows = rows.filter(r => canAccessCustomer(request.user, r.customer_id));

      return {
        location: cleanLoc,
        is_free_location: Boolean(freeRow),
        is_mapped_location: Boolean(locRow && !freeRow),
        items: visibleRows
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore lettura articoli nella posizione' });
    }
  });

  // POST /api/pallets/move-items - Sposta singolo articolo (anche quantità parziale) o tutta la paletta, anche verso/da FREE_LOCATIONS
  fastify.post('/move-items', async (request, reply) => {
    if (!hasPermission(request.user, 'pallet_move')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di spostare o stivare palette.' });
    }
    const {
      mode,
      pallet_code,
      pallet_id,
      move_quantity,
      target_location,
      pin,
      source = 'Gestionale',
      force = false,
      merge_into_existing = false
    } = request.body || {};

    const cleanTargetLoc = String(target_location || '').trim().toUpperCase();
    if (!cleanTargetLoc) {
      return reply.code(400).send({ error: 'Posizione di destinazione obbligatoria.' });
    }

    const effectiveMode = mode || (pallet_id ? 'SINGLE_ITEM' : 'ALL_PALLET');
    if (effectiveMode === 'SINGLE_ITEM' && !pallet_id) {
      return reply.code(400).send({ error: 'pallet_id obbligatorio per spostare un singolo articolo.' });
    }
    if (effectiveMode === 'ALL_PALLET' && !pallet_code) {
      return reply.code(400).send({ error: 'pallet_code obbligatorio per spostare tutta la paletta.' });
    }

    const connection = await db.getConnection();
    try {
      const outcome = await withNamedLock(connection, 'maglite_pallet_loc', async () => {
        await connection.beginTransaction();
        try {
          const [[freeDest]] = await connection.query('SELECT id, name FROM FREE_LOCATIONS WHERE UPPER(TRIM(name)) = ?', [cleanTargetLoc]);
          const [[mappedDest]] = freeDest
            ? [[null]]
            : await connection.query('SELECT * FROM LOCATIONS WHERE UPPER(TRIM(barcode)) = ?', [cleanTargetLoc]);

          if (!freeDest && !mappedDest) {
            if (!force) {
              await connection.rollback();
              return { status: 404, body: { error: `La posizione "${cleanTargetLoc}" non esiste tra gli scaffali mappati o le Posizioni Libere.` } };
            }
          }

          if (mappedDest) {
            const [[pinSetting]] = await connection.query("SELECT setting_value FROM settings WHERE setting_key = 'require_location_pins'");
            const requirePins = pinSetting ? pinSetting.setting_value === 'true' : true;
            if (source === 'Zebra' && requirePins) {
              if (!pin) {
                await connection.rollback();
                return { status: 400, body: { error: 'Inserisci il PIN dello scaffale di destinazione.' } };
              }
              if (mappedDest.pin !== String(pin).trim()) {
                await connection.rollback();
                return { status: 403, body: { error: 'PIN di sicurezza ERRATO' } };
              }
            } else if (pin && mappedDest.pin !== String(pin).trim()) {
              await connection.rollback();
              return { status: 403, body: { error: 'PIN di sicurezza ERRATO' } };
            }
          }

          const [sourceRows] = effectiveMode === 'SINGLE_ITEM'
            ? await connection.query(
                `SELECT p.*, pr.name as product_name, pr.sku
                 FROM PALLETS p
                 JOIN PRODUCTS pr ON p.product_id = pr.id
                 WHERE p.id = ? AND p.status != 'SHIPPED' AND p.quantity > 0
                 FOR UPDATE`,
                [pallet_id]
              )
            : await connection.query(
                `SELECT p.*, pr.name as product_name, pr.sku
                 FROM PALLETS p
                 JOIN PRODUCTS pr ON p.product_id = pr.id
                 WHERE p.pallet_code = ? AND p.status != 'SHIPPED' AND p.quantity > 0
                 FOR UPDATE`,
                [pallet_code]
              );

          if (sourceRows.length === 0) {
            await connection.rollback();
            return { status: 404, body: { error: 'Merce non trovata o già spedita.' } };
          }
          if (sourceRows.some(r => r.is_quarantined)) {
            await connection.rollback();
            return { status: 403, body: { error: 'BLOCCO QUARANTENA: Impossibile spostare merce in quarantena.' } };
          }
          if (sourceRows.some(r => !canAccessCustomer(request.user, r.customer_id))) {
            await connection.rollback();
            return { status: 403, body: { error: 'Accesso negato: cliente non autorizzato.' } };
          }

          const sourceLoc = String(sourceRows[0].location || '').trim().toUpperCase();
          if (sourceLoc && sourceLoc === cleanTargetLoc) {
            await connection.rollback();
            return { status: 400, body: { error: `La merce è già posizionata in ${cleanTargetLoc}.` } };
          }

          // Crea posizione mappata automatica solo se forced su una nuova coordinata non FREE_LOCATIONS
          if (!freeDest && !mappedDest && force) {
            await ensureLocationExists(connection, cleanTargetLoc, request.user.username);
          }

          const movedIds = sourceRows.map(r => r.id);

          // Controllo allocazioni outbound attive in caso di split parziale
          let requestedMoveQty = null;
          let isPartialSplit = false;
          if (effectiveMode === 'SINGLE_ITEM') {
            const totalRowQty = parseFloat(sourceRows[0].quantity) || 0;
            requestedMoveQty = (move_quantity !== undefined && move_quantity !== null && move_quantity !== '')
              ? parseFloat(move_quantity)
              : totalRowQty;

            if (isNaN(requestedMoveQty) || requestedMoveQty <= 0 || requestedMoveQty > totalRowQty + 1e-6) {
              await connection.rollback();
              return { status: 400, body: { error: `Quantità da spostare non valida (max ${totalRowQty}).` } };
            }
            if (requestedMoveQty < totalRowQty - 1e-6) {
              isPartialSplit = true;
              const [[allocRow]] = await connection.query(
                `SELECT COALESCE(SUM(GREATEST(0, oi.quantity_required - COALESCE(oi.quantity_picked, 0))), 0) AS reserved_qty
                 FROM OUTBOUND_ITEMS oi
                 JOIN OUTBOUND_ORDERS oo ON oi.order_id = oo.id
                 WHERE oi.pallet_id = ? AND oo.status IN ('PENDING', 'PICKING', 'READY')`,
                [sourceRows[0].id]
              );
              const reservedQty = parseFloat(allocRow?.reserved_qty) || 0;
              if (totalRowQty - requestedMoveQty < reservedQty - 1e-6) {
                await connection.rollback();
                return { status: 409, body: { error: `Quantità impegnata in picking attivo (${reservedQty}): non è possibile spostarne una parte inferiore.` } };
              }
            } else {
              requestedMoveQty = totalRowQty;
            }
          }

          // Determina barcode di destinazione e controlla eventuale occupazione (solo su scaffali mappati)
          let targetPalletCode = null;
          if (freeDest) {
            targetPalletCode = await findExistingLocationBarcode(connection, cleanTargetLoc, true);
            if (!targetPalletCode) {
              // Se spostiamo tutto un bancale senza lasciare residui sul vecchio codice, manteniamo il barcode; altrimenti nuovo NOBAR-*
              const [[siblingCheck]] = effectiveMode === 'SINGLE_ITEM'
                ? await connection.query(
                    'SELECT COUNT(*) AS cnt FROM PALLETS WHERE pallet_code = ? AND id != ? AND status != "SHIPPED" AND quantity > 0',
                    [sourceRows[0].pallet_code, sourceRows[0].id]
                  )
                : [[{ cnt: 0 }]];
              const leavesSiblings = isPartialSplit || (siblingCheck && siblingCheck.cnt > 0);
              if (!leavesSiblings && sourceRows[0].pallet_code) {
                targetPalletCode = sourceRows[0].pallet_code;
              } else {
                const nextNoBar = await createPalletCodeGenerator(connection, 'NOBAR');
                targetPalletCode = nextNoBar();
              }
            }
          } else {
            const idPlaceholders = movedIds.map(() => '?').join(',');
            const [occupied] = await connection.query(
              `SELECT id, pallet_code FROM PALLETS
               WHERE UPPER(TRIM(location)) = ? AND status = 'STOCKED' AND quantity > 0 AND id NOT IN (${idPlaceholders})
               FOR UPDATE`,
              [cleanTargetLoc, ...movedIds]
            );

            if (occupied.length > 0 && !merge_into_existing && !force) {
              await connection.rollback();
              return {
                status: 409,
                body: {
                  error: `La posizione ${cleanTargetLoc} è già occupata dalla paletta ${occupied[0].pallet_code}!`,
                  occupying_pallet: occupied[0].pallet_code
                }
              };
            }

            if (occupied.length > 0 && merge_into_existing) {
              targetPalletCode = await findExistingLocationBarcode(connection, cleanTargetLoc, true) || occupied[0].pallet_code;
            } else {
              const [[siblingCheck]] = effectiveMode === 'SINGLE_ITEM'
                ? await connection.query(
                    'SELECT COUNT(*) AS cnt FROM PALLETS WHERE pallet_code = ? AND id != ? AND status != "SHIPPED" AND quantity > 0',
                    [sourceRows[0].pallet_code, sourceRows[0].id]
                  )
                : [[{ cnt: 0 }]];
              const leavesSiblings = isPartialSplit || (siblingCheck && siblingCheck.cnt > 0);
              const srcCode = String(sourceRows[0].pallet_code || '');
              if (!leavesSiblings && srcCode && !srcCode.startsWith('NOBAR-')) {
                targetPalletCode = srcCode;
              } else {
                const nextPal = await createPalletCodeGenerator(connection, 'PAL');
                targetPalletCode = nextPal();
              }
            }
          }

          if (effectiveMode === 'ALL_PALLET') {
            const idPlaceholders = movedIds.map(() => '?').join(',');
            await connection.query(
              `UPDATE PALLETS SET pallet_code = ?, location = ?, status = 'STOCKED' WHERE id IN (${idPlaceholders})`,
              [targetPalletCode, cleanTargetLoc, ...movedIds]
            );
            await connection.query(
              `UPDATE OUTBOUND_ITEMS oi
               JOIN OUTBOUND_ORDERS oo ON oi.order_id = oo.id
               SET oi.pallet_code = ?
               WHERE oi.pallet_id IN (${idPlaceholders}) AND oo.status != 'SHIPPED'`,
              [targetPalletCode, ...movedIds]
            );
            await consolidateLocationPallets(connection, cleanTargetLoc);
            await connection.query(
              'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
              ['STOW', `Spostati tutti gli articoli (${sourceRows.length} righe, ${sourceRows[0].pallet_code} -> ${targetPalletCode}) in ${cleanTargetLoc}`, source, request.user.username]
            );
          } else {
            const row = sourceRows[0];
            if (isPartialSplit) {
              const remainingQty = Math.round((parseFloat(row.quantity) - requestedMoveQty) * 100) / 100;
              await connection.query('UPDATE PALLETS SET quantity = ? WHERE id = ?', [remainingQty, row.id]);
              await connection.query(
                `INSERT INTO PALLETS
                 (pallet_code, customer_id, product_id, quantity, units_per_box, pallet_uom, net_weight_kg, gross_weight_kg, tariff_plan_id, batch, warehouse, status, location, notes, client_pallet_number, client_article_number, expiration_date, flags, client_ddt, checkin_id, checkin_session_code, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'STOCKED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  targetPalletCode,
                  row.customer_id,
                  row.product_id,
                  requestedMoveQty,
                  row.units_per_box || null,
                  row.pallet_uom || null,
                  row.net_weight_kg || null,
                  row.gross_weight_kg || null,
                  row.tariff_plan_id || null,
                  row.batch || null,
                  row.warehouse || 'Settala',
                  cleanTargetLoc,
                  row.notes || null,
                  row.client_pallet_number || null,
                  row.client_article_number || null,
                  sanitizeExpirationDate(row.expiration_date),
                  row.flags ? (typeof row.flags === 'string' ? row.flags : JSON.stringify(row.flags)) : null,
                  row.client_ddt || null,
                  row.checkin_id || null,
                  row.checkin_session_code || null,
                  row.created_at || new Date()
                ]
              );
            } else {
              await connection.query(
                "UPDATE PALLETS SET pallet_code = ?, location = ?, status = 'STOCKED' WHERE id = ?",
                [targetPalletCode, cleanTargetLoc, row.id]
              );
              await connection.query(
                `UPDATE OUTBOUND_ITEMS oi
                 JOIN OUTBOUND_ORDERS oo ON oi.order_id = oo.id
                 SET oi.pallet_code = ?
                 WHERE oi.pallet_id = ? AND oo.status != 'SHIPPED'`,
                [targetPalletCode, row.id]
              );
            }
            await consolidateLocationPallets(connection, cleanTargetLoc);
            await connection.query(
              'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
              ['MOVE_ITEM', `Spostato ${row.product_name} (Q.tà ${requestedMoveQty}${isPartialSplit ? `/${row.quantity}` : ''}, lotto ${row.batch || '-'}) da ${sourceLoc || '-'} a ${cleanTargetLoc} (${targetPalletCode})`, source, request.user.username]
            );
          }

          await connection.commit();
          return {
            status: 200,
            body: {
              success: true,
              target_location: cleanTargetLoc,
              target_pallet_code: targetPalletCode,
              message: `Spostamento completato in ${cleanTargetLoc}`
            }
          };
        } catch (txErr) {
          await connection.rollback();
          throw txErr;
        }
      });

      if (outcome.status !== 200) {
        return reply.code(outcome.status).send(outcome.body);
      }

      if (fastify.io) {
        fastify.io.emit('inventory_updated');
        fastify.io.emit('stow_updated');
        fastify.io.emit('locations_updated');
        fastify.io.emit('dashboard_update');
      }

      return outcome.body;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(err.statusCode || 500).send({ error: err.message || 'Errore durante lo spostamento' });
    } finally {
      connection.release();
    }
  });

  fastify.get('/:code', async (request, reply) => {
    const { code } = request.params;
    try {
      const [allRows] = await db.query(`
        SELECT p.*, pr.sku, pr.name as product_name, COALESCE(p.pallet_uom, pr.uom) as uom,
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
      
      return { ...rows[0], isMixed: false, items: rows };
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

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [checkRows] = pallet_id
        ? await connection.query('SELECT id, customer_id, quantity, is_quarantined, quarantine_reason FROM PALLETS WHERE id = ? FOR UPDATE', [pallet_id])
        : await connection.query('SELECT id, customer_id, quantity, is_quarantined, quarantine_reason FROM PALLETS WHERE pallet_code = ? FOR UPDATE', [code]);

      if (checkRows.length === 0) {
        await connection.rollback();
        return reply.code(404).send({ error: 'Paletta non trovata' });
      }
      if (checkRows.some(r => r.is_quarantined)) {
        await connection.rollback();
        return reply.code(403).send({ error: 'BLOCCO QUARANTENA: Impossibile modificare la quantità di una paletta in quarantena. Sbloccala prima dal Registro Quarantene.' });
      }
      if (checkRows.some(r => !canAccessCustomer(request.user, r.customer_id))) {
        await connection.rollback();
        return reply.code(403).send({ error: 'Accesso negato: non puoi modificare la merce di questo cliente.' });
      }

      const oldQuantity = checkRows[0].quantity;
      if (pallet_id) {
        await connection.query('UPDATE PALLETS SET quantity = ? WHERE id = ?', [quantity, pallet_id]);
      } else {
        await connection.query('UPDATE PALLETS SET quantity = ? WHERE pallet_code = ?', [quantity, code]);
      }

      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['ADJUST_QTY', `Modificata q.tà paletta ${code}: da ${oldQuantity} a ${quantity}`, 'Gestionale', request.user.username]
      );
      await connection.commit();

      if (fastify.io) {
        fastify.io.emit('inventory_updated');
        fastify.io.emit('stow_updated');
        fastify.io.emit('dashboard_update');
      }

      return { success: true, new_quantity: quantity };
    } catch (err) {
      await connection.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante la modifica della quantità' });
    } finally {
      connection.release();
    }
  });


  fastify.put('/:code', async (request, reply) => {
    if (!hasPermission(request.user, 'pallet_edit')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di modificare le palette.' });
    }
    const { code } = request.params;
    const { notes, client_pallet_number, client_article_number, expiration_date, net_weight_kg, gross_weight_kg } = request.body;
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [checkRows] = await connection.query('SELECT id, customer_id, is_quarantined FROM PALLETS WHERE pallet_code = ? FOR UPDATE', [code]);
      if (checkRows.length === 0) {
        await connection.rollback();
        return reply.code(404).send({ error: 'Paletta non trovata' });
      }
      if (checkRows.some(r => r.is_quarantined)) {
        await connection.rollback();
        return reply.code(403).send({ error: 'BLOCCO QUARANTENA: Impossibile modificare una paletta in quarantena.' });
      }
      if (checkRows.some(r => !canAccessCustomer(request.user, r.customer_id))) {
        await connection.rollback();
        return reply.code(403).send({ error: 'Accesso negato: non puoi modificare la merce di questo cliente.' });
      }
      const parseOptWeight = (w) => (w === undefined || w === null || w === '') ? null : (Number.isFinite(parseFloat(w)) ? parseFloat(w) : null);
      const netVal = net_weight_kg !== undefined ? parseOptWeight(net_weight_kg) : undefined;
      const grossVal = gross_weight_kg !== undefined ? parseOptWeight(gross_weight_kg) : undefined;

      if (netVal !== undefined || grossVal !== undefined) {
        await connection.query(
          'UPDATE PALLETS SET notes = ?, client_pallet_number = ?, client_article_number = ?, expiration_date = ?, net_weight_kg = ?, gross_weight_kg = ? WHERE pallet_code = ?',
          [
            notes || null,
            client_pallet_number || null,
            client_article_number || null,
            sanitizeExpirationDate(expiration_date),
            netVal !== undefined ? netVal : null,
            grossVal !== undefined ? grossVal : null,
            code
          ]
        );
      } else {
        await connection.query(
          'UPDATE PALLETS SET notes = ?, client_pallet_number = ?, client_article_number = ?, expiration_date = ? WHERE pallet_code = ?',
          [notes || null, client_pallet_number || null, client_article_number || null, sanitizeExpirationDate(expiration_date), code]
        );
      }
      
      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['UPDATE', `Aggiornati metadati paletta ${code}`, 'Gestionale', request.user.username]
      );
      await connection.commit();
      
      if (fastify.io) {
        fastify.io.emit('inventory_updated');
        fastify.io.emit('stow_updated');
        fastify.io.emit('dashboard_update');
      }
      
      return { success: true };
    } catch(err) {
      await connection.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore salvataggio modifiche' });
    } finally {
      connection.release();
    }
  });

  fastify.delete('/:code', async (request, reply) => {
    if (!hasPermission(request.user, 'pallet_delete')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di eliminare palette.' });
    }
    const { code } = request.params;
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [checkRows] = await connection.query('SELECT id, customer_id, is_quarantined, quarantine_reason FROM PALLETS WHERE pallet_code = ? AND status != "SHIPPED" FOR UPDATE', [code]);
      if (checkRows.some(r => r.is_quarantined)) {
        await connection.rollback();
        return reply.code(403).send({ error: 'BLOCCO QUARANTENA: La paletta è in quarantena e non può essere eliminata! Deve prima essere sbloccata dal Registro Quarantene.' });
      }
      if (checkRows.some(r => !canAccessCustomer(request.user, r.customer_id))) {
        await connection.rollback();
        return reply.code(403).send({ error: 'Accesso negato: non puoi eliminare la merce di questo cliente.' });
      }
      const [delRes] = await connection.query('DELETE FROM PALLETS WHERE pallet_code = ?', [code]);
      if (delRes.affectedRows === 0) {
        await connection.rollback();
        return reply.code(404).send({ error: 'Paletta non trovata o già eliminata' });
      }
      
      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['DELETE', `Eliminata fisicamente paletta ${code}`, 'Gestionale', request.user.username]
      );
      await connection.commit();

      if (fastify.io) {
        fastify.io.emit('inventory_updated');
        fastify.io.emit('stow_updated');
        fastify.io.emit('locations_updated');
        fastify.io.emit('dashboard_update');
      }
      return { success: true };
    } catch(err) {
      await connection.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore eliminazione paletta' });
    } finally {
      connection.release();
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
    
    const connection = await db.getConnection();
    try {
      const outcome = await withNamedLock(connection, 'maglite_pallet_loc', async () => {
        await connection.beginTransaction();
        try {
          const [qRows] = await connection.query(
            'SELECT pallet_code, customer_id, is_quarantined FROM PALLETS WHERE pallet_code IN (?, ?) AND status != "SHIPPED" FOR UPDATE',
            [source_code, target_code]
          );
          if (qRows.some(r => r.is_quarantined)) {
            await connection.rollback();
            return { status: 403, body: { error: 'BLOCCO QUARANTENA: Impossibile unire palette che si trovano in quarantena!' } };
          }
          if (qRows.some(r => !canAccessCustomer(request.user, r.customer_id))) {
            await connection.rollback();
            return { status: 403, body: { error: 'Accesso negato: non puoi operare sulla merce di questo cliente.' } };
          }
          const [rows] = await connection.query(
            `SELECT id, location, status
             FROM PALLETS
             WHERE pallet_code = ? AND status != 'SHIPPED'
             ORDER BY CASE WHEN status = 'STOCKED' AND quantity > 0 THEN 0 ELSE 1 END, id ASC`,
            [target_code]
          );
          if (rows.length === 0) {
            await connection.rollback();
            return { status: 404, body: { error: 'Paletta di destinazione non trovata' } };
          }
          
          const targetLoc = rows[0].location || null;
          const targetStatus = targetLoc ? 'STOCKED' : (rows[0].status || 'PENDING');

          await connection.query(
            "UPDATE PALLETS SET pallet_code = ?, location = COALESCE(?, location), status = ? WHERE pallet_code = ? AND status != 'SHIPPED'",
            [target_code, targetLoc, targetStatus, source_code]
          );

          if (targetLoc) {
            await consolidateLocationPallets(connection, targetLoc);
          }
          
          await connection.query(
            "INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)",
            ['MERGE', `Paletta ${source_code} frammentata e unita a ${target_code}${targetLoc ? ' in ' + targetLoc : ''}`, 'Gestionale', request.user ? request.user.username : 'Sistema']
          );

          await connection.commit();
          return { status: 200, body: { success: true } };
        } catch (txErr) {
          await connection.rollback();
          throw txErr;
        }
      });

      if (outcome.status !== 200) {
        return reply.code(outcome.status).send(outcome.body);
      }

      if (fastify.io) {
        fastify.io.emit('inventory_updated');
        fastify.io.emit('stow_updated');
        fastify.io.emit('locations_updated');
        fastify.io.emit('dashboard_update');
      }
      
      return outcome.body;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(err.statusCode || 500).send({ error: err.message || 'Errore unione palette' });
    } finally {
      connection.release();
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

    const connection = await db.getConnection();
    try {
      const outcome = await withNamedLock(connection, 'maglite_pallet_loc', async () => {
        await connection.beginTransaction();
        try {
          const [qRows] = await connection.query(
            'SELECT id, customer_id, is_quarantined, quarantine_reason FROM PALLETS WHERE pallet_code = ? AND status != "SHIPPED" FOR UPDATE',
            [pallet_code]
          );
          if (qRows.some(r => r.is_quarantined)) {
            await connection.rollback();
            const qReason = qRows.find(r => r.is_quarantined)?.quarantine_reason || 'Blocco qualità';
            return {
              status: 403,
              body: { error: `BLOCCO QUARANTENA: La paletta ${pallet_code} è in quarantena (${qReason}) e non può essere spostata! Sbloccala prima dal Registro Quarantene.` }
            };
          }
          if (qRows.some(r => !canAccessCustomer(request.user, r.customer_id))) {
            await connection.rollback();
            return { status: 403, body: { error: 'Accesso negato: non puoi spostare la merce di questo cliente.' } };
          }
          if (!force) {
            const [occupied] = await connection.query(
              "SELECT id, pallet_code FROM PALLETS WHERE location = ? AND status = 'STOCKED' AND quantity > 0 AND pallet_code != ? FOR UPDATE", 
              [location, pallet_code]
            );
            
            if (occupied.length > 0) {
              await connection.rollback();
              fastify.log.info(`[STOW] Location occupied! Returning 409`);
              return {
                status: 409,
                body: { 
                  error: `La posizione ${location} è già occupata dalla paletta ${occupied[0].pallet_code}!`,
                  occupying_pallet: occupied[0].pallet_code 
                }
              };
            }
          } else {
            fastify.log.info(`[STOW] Force is true! Bypassing occupied check.`);
          }

          const [[freeDest]] = await connection.query('SELECT id FROM FREE_LOCATIONS WHERE UPPER(TRIM(name)) = UPPER(TRIM(?))', [location]);
          const [[loc]] = freeDest ? [[null]] : await connection.query('SELECT * FROM LOCATIONS WHERE barcode = ?', [location]);
          
          if (freeDest) {
            // Posizione Libera: non creare mai una riga fantasma in LOCATIONS
          } else if (loc) {
            if (pin && loc.pin !== pin) {
              await connection.rollback();
              return { status: 403, body: { error: 'PIN di sicurezza ERRATO' } };
            }
          } else {
            const parts = location.split('-');
            const zone = parts[0] || 'Z';
            const col = parts[1] || '00';
            const pos = parts[2] || '00';
            const finalPin = pin || Math.floor(10 + Math.random() * 90).toString(); 
            
            await connection.query(
              'INSERT IGNORE INTO LOCATIONS (zone, col, pos, barcode, pin) VALUES (?, ?, ?, ?, ?)',
              [zone, col, pos, location, finalPin]
            );
            await connection.query(
              'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
              ['CREATE_LOC', `Creata nuova posizione ${location}`, source || 'Zebra', request.user.username]
            );
          }

          const [result] = await connection.query(
            'UPDATE PALLETS SET location = ?, status = ? WHERE pallet_code = ? AND status != "SHIPPED"',
            [location, 'STOCKED', pallet_code]
          );
          
          if (result.affectedRows === 0) {
            await connection.rollback();
            return { status: 404, body: { error: 'Paletta non trovata' } };
          }

          // Consolida eventuali righe identiche per prodotto + lotto nella stessa posizione e unifica il barcode esistente
          await consolidateLocationPallets(connection, location);

          await connection.query(
            'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
            ['STOW', `Paletta ${pallet_code} stivata in ${location}`, source || 'Zebra', request.user.username]
          );

          await connection.commit();
          return { status: 200, body: { success: true, message: `Paletta stivata in ${location}` } };
        } catch (txErr) {
          await connection.rollback();
          throw txErr;
        }
      });

      if (outcome.status !== 200) {
        return reply.code(outcome.status).send(outcome.body);
      }

      if (fastify.io) {
        fastify.io.emit('inventory_updated');
        fastify.io.emit('stow_updated');
        fastify.io.emit('locations_updated');
        fastify.io.emit('dashboard_update');
      }

      return outcome.body;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(err.statusCode || 500).send({ error: err.message || 'Errore durante lo stivaggio' });
    } finally {
      connection.release();
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
