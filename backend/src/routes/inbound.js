const db = require('../config/db');
const { drawLabel, generateLabelsPdfBuffer, sanitizeExpirationDate, shouldShowPalletBarcodeLogo } = require('../utils/pdfLabels');
const { hasPermission, canAccessCustomer } = require('../utils/permissions');
const { normalizeTempRegime, parseAdrData } = require('../utils/logisticsMeta');
const { findExistingLocationBarcode, consolidateLocationPallets } = require('../utils/palletConsolidation');
const { withNamedLock } = require('../utils/concurrency');
const { createNotification } = require('../utils/notifications');

function formatDateISO(val) {
  if (!val) return '';
  if (val instanceof Date && !isNaN(val.getTime())) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(val).trim();
  const match = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return '';
}

async function inboundRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  // 1. Create Inbound DDT
  fastify.post('/ddt', async (request, reply) => {
    if (!hasPermission(request.user, 'inbound_create')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di creare DDT o aggiungere merce in ingresso.' });
    }

    const { cart, client_ddt, checkin_id, checkin_session_code } = request.body || {};
    if (!cart || cart.length === 0) return reply.code(400).send({ error: 'Carrello vuoto' });

    const customer_id = cart[0].customer_id;
    if (!canAccessCustomer(request.user, customer_id)) {
      return reply.code(403).send({ error: 'Accesso negato: questo cliente è limitato per il tuo profilo.' });
    }

    const connection = await db.getConnection();
    try {
      const result = await withNamedLock(connection, 'maglite_inbound_ddt', async () => {
        await connection.beginTransaction();
        try {
          let effectiveCheckinId = checkin_id || null;
          let effectiveSessionCode = checkin_session_code || null;
          const cleanClientDdt = client_ddt && String(client_ddt).trim() ? String(client_ddt).trim() : null;

          // Se fornito numero DDT / Container ma non checkin_id, cerchiamo automaticamente nei check-in
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

          // Generate DDT Number in modo incrementale sicuro senza rischio di collisioni post-eliminazione
          const year = new Date().getFullYear();
          const prefix = `IN-${year}-`;
          const [seqRows] = await connection.query(
            'SELECT ddt_number FROM INBOUND_DDTS WHERE ddt_number LIKE ?',
            [`${prefix}%`]
          );
          let maxSeq = 0;
          for (const r of seqRows) {
            const numPart = String(r.ddt_number || '').replace(prefix, '');
            const num = parseInt(numPart, 10);
            if (!isNaN(num) && num > maxSeq) {
              maxSeq = num;
            }
          }
          const ddtNumber = `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;

          const [resDdt] = await connection.query(
            'INSERT INTO INBOUND_DDTS (ddt_number, customer_id, status, client_ddt, checkin_id, checkin_session_code) VALUES (?, ?, ?, ?, ?, ?)',
            [ddtNumber, customer_id, 'PENDING', cleanClientDdt, effectiveCheckinId, effectiveSessionCode]
          );
          const ddtId = resDdt.insertId;

          const parseOptNum = (v) => (v === null || v === undefined || v === '') ? null : (Number.isFinite(parseFloat(v)) ? parseFloat(v) : null);
          const parseOptInt = (v) => (v === null || v === undefined || v === '') ? null : (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : null);

          const [whLookupRows] = await connection.query('SELECT id, name FROM WAREHOUSES');
          const resolveWh = (whIdArg, whNameArg) => {
            if (whIdArg) {
              const m = whLookupRows.find(w => Number(w.id) === Number(whIdArg));
              if (m) return { id: m.id, name: m.name };
            }
            if (whNameArg) {
              const m = whLookupRows.find(w => String(w.name).trim().toLowerCase() === String(whNameArg).trim().toLowerCase());
              if (m) return { id: m.id, name: m.name };
              return { id: 1, name: String(whNameArg).trim() };
            }
            return { id: 1, name: whLookupRows[0]?.name || 'Settala' };
          };

          for (const item of cart) {
            const [[prodRow]] = await connection.query('SELECT sku, name, kg_per_unit FROM PRODUCTS WHERE id = ?', [item.product_id]);
            const itemSku = item.sku || item.client_article_number || prodRow?.sku || null;
            const itemName = prodRow?.name || item.product_name || item.name;
            const itemLocation = item.location ? String(item.location).trim().toUpperCase() : null;
            const itemPlanId = parseOptInt(item.tariff_plan_id);
            const itemNetKg = parseOptNum(item.net_weight_kg);
            const itemGrossKg = parseOptNum(item.gross_weight_kg);
            const itemKgPerUnit = parseOptNum(item.kg_per_unit) ?? (prodRow?.kg_per_unit !== null && prodRow?.kg_per_unit !== undefined ? parseFloat(prodRow.kg_per_unit) : null);
            const itemGroup = item.pallet_group ? String(item.pallet_group).trim() : null;
            const itemFlagsJson = Array.isArray(item.flags) && item.flags.length > 0
              ? JSON.stringify(item.flags)
              : (typeof item.flags === 'string' && item.flags.trim() ? item.flags : null);
            const whPair = resolveWh(item.warehouse_id, item.warehouse);
            const itemTemp = normalizeTempRegime(item.temp_regime);
            const itemAdrFlag = Boolean(item.is_adr);
            const itemAdrData = itemAdrFlag ? parseAdrData(item.adr_data, itemName) : null;
            let itemArrivalDt = null;
            if (item.arrival_date) {
              const parsedArr = new Date(item.arrival_date);
              if (!isNaN(parsedArr.getTime())) itemArrivalDt = parsedArr;
            }
            await connection.query(
              'INSERT INTO INBOUND_DDT_ITEMS (inbound_ddt_id, product_id, sku, product_name, product_uom, expected_quantity, batch, units_per_box, kg_per_unit, client_pallet_number, client_article_number, expiration_date, pallet_uom, net_weight_kg, gross_weight_kg, tariff_plan_id, pallet_group, flags, arrival_date, location, warehouse, warehouse_id, temp_regime, is_adr, adr_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [ddtId, item.product_id, itemSku, itemName, item.uom || item.product_uom || 'Pezzi', item.quantity, item.batch, item.units_per_box, itemKgPerUnit, item.client_pallet_number, item.client_article_number, sanitizeExpirationDate(item.expiration_date), item.pallet_uom || item.uom || 'Pezzi', itemNetKg, itemGrossKg, itemPlanId, itemGroup, itemFlagsJson, itemArrivalDt, itemLocation, whPair.name, whPair.id, itemTemp, itemAdrFlag ? 1 : 0, itemAdrData ? JSON.stringify(itemAdrData) : null]
            );
            // Aggiorna i valori predefiniti sul prodotto (Temp/ADR/kg_per_unit) per i carichi futuri
            if (item.product_id) {
              await connection.query(
                `UPDATE PRODUCTS
                 SET kg_per_unit = COALESCE(?, kg_per_unit),
                     default_temp_regime = ?,
                     default_is_adr = ?,
                     default_adr_data = ?
                 WHERE id = ?`,
                [
                  itemKgPerUnit,
                  itemTemp,
                  itemAdrFlag ? 1 : 0,
                  itemAdrData ? JSON.stringify(itemAdrData) : null,
                  item.product_id
                ]
              );
            }
          }

          await connection.query(
            "INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)",
            ['CREATE_INBOUND_DDT', `Creato DDT Entrata ${ddtNumber} (${cart.length} righe attese)`, 'Gestionale', request.user?.username || 'Operatore']
          );

          await connection.commit();
          return { success: true, ddt_id: ddtId, ddt_number: ddtNumber };
        } catch (txErr) {
          await connection.rollback();
          throw txErr;
        }
      });

      if (fastify.io) {
        fastify.io.emit('inbound_updated');
        fastify.io.emit('dashboard_update');
      }
      return result;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(err.statusCode || 500).send({ error: err.message || 'Errore creazione DDT' });
    } finally {
      connection.release();
    }
  });

  // 2. Get all Inbound DDTs (with items summary & discrepancy info)
  fastify.get('/ddt', async (request, reply) => {
    if (!hasPermission(request.user, 'view_documents') && !hasPermission(request.user, 'view_inbound') && !hasPermission(request.user, 'inbound_create')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di visualizzare i DDT Entrata.' });
    }

    try {
      const { active_only, limit } = request.query || {};
      const onlyActive = active_only === 'true' || active_only === '1';
      const parsedLimit = limit ? Math.min(Math.max(parseInt(limit, 10) || 0, 1), 2000) : null;

      let ddtSql = `
        SELECT d.id, d.ddt_number, d.customer_id, d.status, d.created_at, d.closed_at, d.notes,
               d.discrepancy_accepted, d.discrepancy_reason, d.discrepancy_resolved_by, d.discrepancy_resolved_at,
               d.rejected_count, d.last_rejected_reason, d.last_rejected_by, d.last_rejected_at,
               d.client_ddt, d.checkin_id, d.checkin_session_code,
               c.business_name, 
               c.business_name AS customer_name,
               c.parent_id AS customer_parent_id,
               pc.business_name AS parent_customer_name,
               COALESCE(p_agg.cnt, 0) AS pallets_count
        FROM INBOUND_DDTS d
        JOIN CUSTOMERS c ON d.customer_id = c.id
        LEFT JOIN CUSTOMERS pc ON c.parent_id = pc.id
        LEFT JOIN (
          SELECT inbound_ddt_id, COUNT(*) AS cnt FROM PALLETS WHERE inbound_ddt_id IS NOT NULL GROUP BY inbound_ddt_id
        ) p_agg ON p_agg.inbound_ddt_id = d.id
      `;
      const ddtParams = [];
      if (onlyActive) {
        ddtSql += " WHERE d.status IN ('PENDING', 'IN_PROGRESS')";
      }
      ddtSql += ' ORDER BY d.created_at DESC';
      if (parsedLimit) {
        ddtSql += ' LIMIT ?';
        ddtParams.push(parsedLimit);
      }

      const [allRows] = await db.query(ddtSql, ddtParams);

      const rows = allRows.filter(r => canAccessCustomer(request.user, r.customer_id));

      if (rows.length > 0 && !onlyActive) {
        const ddtIds = rows.map(r => r.id);
        const [[allItems], [discLogs]] = await Promise.all([
          db.query(`
            SELECT i.id, i.inbound_ddt_id, i.product_id, i.expected_quantity, i.actual_quantity,
                   i.net_weight_kg, i.actual_net_weight_kg, i.batch, i.actual_batch,
                   i.client_pallet_number, i.client_article_number, i.expiration_date, i.actual_expiration_date,
                   i.pallet_uom, i.location, i.notes,
                   COALESCE(NULLIF(i.sku, ''), p.sku) AS sku,
                   COALESCE(NULLIF(i.product_name, ''), p.name) AS product_name,
                   COALESCE(i.product_uom, p.uom, 'Pezzi') AS product_uom,
                   COALESCE(NULLIF(i.units_per_box, 0), p.units_per_box, 1) AS units_per_box,
                   COALESCE(NULLIF(i.kg_per_unit, 0), p.kg_per_unit) AS kg_per_unit
            FROM INBOUND_DDT_ITEMS i
            LEFT JOIN PRODUCTS p ON i.product_id = p.id
            WHERE i.inbound_ddt_id IN (?)
            ORDER BY i.id ASC
          `, [ddtIds]),
          db.query(`
            SELECT id, inbound_ddt_id, ddt_number, customer_id, decision, reason, items_snapshot, username, source, created_at
            FROM INBOUND_DISCREPANCY_LOGS
            WHERE inbound_ddt_id IN (?)
            ORDER BY created_at DESC
          `, [ddtIds])
        ]);

        const itemsByDdt = new Map();
        for (const it of allItems) {
          if (!itemsByDdt.has(it.inbound_ddt_id)) itemsByDdt.set(it.inbound_ddt_id, []);
          itemsByDdt.get(it.inbound_ddt_id).push(it);
        }

        const logsByDdt = new Map();
        for (const lg of discLogs) {
          if (!logsByDdt.has(lg.inbound_ddt_id)) logsByDdt.set(lg.inbound_ddt_id, []);
          let parsedSnap = [];
          try {
            parsedSnap = lg.items_snapshot ? (typeof lg.items_snapshot === 'string' ? JSON.parse(lg.items_snapshot) : lg.items_snapshot) : [];
          } catch (e) {
            parsedSnap = [];
          }
          logsByDdt.get(lg.inbound_ddt_id).push({ ...lg, items_snapshot: parsedSnap });
        }

        for (const r of rows) {
          const dItems = (itemsByDdt.get(r.id) || []).map(it => ({
            ...it,
            expiration_date: formatDateISO(it.expiration_date) || null,
            actual_expiration_date: formatDateISO(it.actual_expiration_date) || null
          }));
          const snapRes = buildDdtDiscrepancySnapshot(dItems);
          r.items = dItems;
          r.discrepancy_logs = logsByDdt.get(r.id) || [];
          r.total_items = dItems.length;
          r.completed_items = dItems.filter(i => parseFloat(i.actual_quantity || 0) >= parseFloat(i.expected_quantity || 0)).length;
          r.discrepant_items_count = snapRes.itemsSnapshot.filter(x => x.discrepancy_reasons && x.discrepancy_reasons.length > 0).length;
          r.total_expected_qty = dItems.reduce((s, i) => s + (parseFloat(i.expected_quantity) || 0), 0);
          r.total_actual_qty = dItems.reduce((s, i) => s + (parseFloat(i.actual_quantity) || 0), 0);
        }
      }

      return rows;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore fetch DDTs' });
    }
  });

  // 2b. Get Discrepancies History (Storico Discrepanze & Motivi Accettazione/Rifiuto)
  fastify.get('/discrepancies/history', async (request, reply) => {
    if (!hasPermission(request.user, 'view_documents') && !hasPermission(request.user, 'view_inbound') && !hasPermission(request.user, 'inbound_create')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di visualizzare i DDT Entrata.' });
    }

    try {
      const [rows] = await db.query(`
        SELECT l.*, 
               c.business_name AS customer_name,
               pc.business_name AS parent_customer_name,
               d.status AS current_ddt_status,
               d.discrepancy_accepted,
               d.discrepancy_reason,
               d.discrepancy_resolved_by,
               d.discrepancy_resolved_at
        FROM INBOUND_DISCREPANCY_LOGS l
        JOIN CUSTOMERS c ON l.customer_id = c.id
        LEFT JOIN CUSTOMERS pc ON c.parent_id = pc.id
        LEFT JOIN INBOUND_DDTS d ON l.inbound_ddt_id = d.id
        ORDER BY l.created_at DESC
        LIMIT 500
      `);

      const formatted = rows
        .filter(r => canAccessCustomer(request.user, r.customer_id))
        .map(r => {
          let parsedSnap = [];
          try {
            parsedSnap = r.items_snapshot ? (typeof r.items_snapshot === 'string' ? JSON.parse(r.items_snapshot) : r.items_snapshot) : [];
          } catch (e) {
            parsedSnap = [];
          }
          return {
            ...r,
            items_snapshot: parsedSnap
          };
        });

      return formatted;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore recupero storico discrepanze' });
    }
  });

  // 3. Get Single DDT Details (for Zebra & Desktop)
  fastify.get('/ddt/:identifier', async (request, reply) => {
    if (!hasPermission(request.user, 'view_documents') && !hasPermission(request.user, 'view_inbound') && !hasPermission(request.user, 'inbound_create')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di accedere ai DDT Entrata.' });
    }

    const { identifier } = request.params;
    try {
      const isId = !isNaN(identifier);
      const queryStr = isId
        ? 'SELECT d.*, c.business_name, c.business_name AS customer_name FROM INBOUND_DDTS d JOIN CUSTOMERS c ON d.customer_id = c.id WHERE d.id = ?'
        : 'SELECT d.*, c.business_name, c.business_name AS customer_name FROM INBOUND_DDTS d JOIN CUSTOMERS c ON d.customer_id = c.id WHERE d.ddt_number = ?';
      const [ddts] = await db.query(queryStr, [identifier]);
      
      if (ddts.length === 0) return reply.code(404).send({ error: 'DDT non trovato' });
      const ddt = ddts[0];

      if (!canAccessCustomer(request.user, ddt.customer_id)) {
        return reply.code(403).send({ error: 'Accesso negato: il cliente di questo DDT è limitato per il tuo profilo.' });
      }

      const [items] = await db.query(`
        SELECT i.*, 
               COALESCE(NULLIF(i.sku, ''), p.sku) AS sku,
               COALESCE(NULLIF(i.product_name, ''), p.name) AS product_name,
               COALESCE(i.product_uom, p.uom, 'Pezzi') AS product_uom,
               COALESCE(NULLIF(i.units_per_box, 0), p.units_per_box, 1) AS units_per_box,
               COALESCE(NULLIF(i.kg_per_unit, 0), p.kg_per_unit) AS kg_per_unit
        FROM INBOUND_DDT_ITEMS i
        LEFT JOIN PRODUCTS p ON i.product_id = p.id
        WHERE i.inbound_ddt_id = ?
      `, [ddt.id]);
      
      return {
        ddt,
        items: items.map(it => ({
          ...it,
          expiration_date: formatDateISO(it.expiration_date) || null,
          actual_expiration_date: formatDateISO(it.actual_expiration_date) || null
        }))
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore fetch DDT details' });
    }
  });

  // 4. Zebra: Generate Pallet for DDT Item
  fastify.post('/ddt/:id/scan', async (request, reply) => {
    if (!hasPermission(request.user, 'inbound_create')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di effettuare spunta in entrata.' });
    }

    const { item_id, quantity, warehouse, location, expiration_date, net_weight_kg, batch } = request.body;
    const ddt_id = request.params.id;
    const connection = await db.getConnection();
    try {
      const outcome = await withNamedLock(connection, 'maglite_pallet_gen', async () => {
        await connection.beginTransaction();
        try {
          // Get item (locked FOR UPDATE to avoid concurrent double-scan race)
          const [items] = await connection.query('SELECT * FROM INBOUND_DDT_ITEMS WHERE id = ? AND inbound_ddt_id = ? FOR UPDATE', [item_id, ddt_id]);
          if (items.length === 0) throw new Error('Item non trovato nel DDT');
          const item = items[0];

          const [ddts] = await connection.query('SELECT * FROM INBOUND_DDTS WHERE id = ? FOR UPDATE', [ddt_id]);
          if (ddts.length === 0) throw new Error('DDT non trovato');
          if (!canAccessCustomer(request.user, ddts[0].customer_id)) {
            await connection.rollback();
            return { status: 403, body: { error: 'Accesso negato: cliente limitato per il tuo profilo.' } };
          }
          if (ddts[0].status === 'COMPLETED') {
            await connection.rollback();
            return { status: 409, body: { error: 'Questo DDT è già stato chiuso da un altro operatore.' } };
          }
          if (ddts[0].status === 'PENDING') {
            await connection.query('UPDATE INBOUND_DDTS SET status = ? WHERE id = ?', ['IN_PROGRESS', ddt_id]);
          }

          const [[prodRowScan]] = await connection.query('SELECT uom, kg_per_unit FROM PRODUCTS WHERE id = ?', [item.product_id]);
          const rawItemUom = String(item.pallet_uom || item.product_uom || prodRowScan?.uom || 'Pezzi').toLowerCase().trim();
          const isBancaliUom = ['bancali', 'bancale', 'palette', 'pallet'].includes(rawItemUom);
          const scanQtyNum = parseFloat(quantity);
          if (!Number.isFinite(scanQtyNum) || scanQtyNum <= 0) {
            await connection.rollback();
            return { status: 400, body: { error: 'Quantità spunta non valida.' } };
          }
          const expItemQty = parseFloat(item.expected_quantity) || 0;
          const actItemQty = parseFloat(item.actual_quantity) || 0;
          const remItemQty = Math.max(0, expItemQty - actItemQty);
          if (isBancaliUom && remItemQty > 0 && Math.abs(scanQtyNum - remItemQty) > 0.001 && Math.abs(scanQtyNum - 1) > 0.001) {
            await connection.rollback();
            return {
              status: 400,
              body: { error: 'Con UDM Bancali/Palette non è consentito modificare il numero di pezzi: puoi rettificare KG Netti, Lotto o Scadenza.' }
            };
          }
          const effectiveQty = isBancaliUom && remItemQty > 0 && Math.abs(scanQtyNum - 1) <= 0.001 && remItemQty >= 1
            ? scanQtyNum
            : (isBancaliUom && remItemQty > 0 ? remItemQty : scanQtyNum);

          const parseOptNumScan = (v) => (v === null || v === undefined || v === '') ? null : (Number.isFinite(parseFloat(v)) ? parseFloat(v) : null);
          const scannedNetKg = parseOptNumScan(net_weight_kg);
          const effectivePalletNetKg = scannedNetKg !== null ? scannedNetKg : (item.net_weight_kg ?? null);
          const hasBatchParam = batch !== undefined;
          const scannedBatchTrimmed = hasBatchParam ? String(batch ?? '').trim() : null;
          const scannedBatch = hasBatchParam ? scannedBatchTrimmed : null;
          const effectivePalletBatch = hasBatchParam ? (scannedBatchTrimmed || null) : (item.batch || null);
          const scannedExp = expiration_date ? sanitizeExpirationDate(expiration_date) : null;
          const effectivePalletExp = scannedExp || sanitizeExpirationDate(item.expiration_date);
          const effectiveKgPerUnit = item.kg_per_unit ?? prodRowScan?.kg_per_unit ?? null;

          // Se la riga a Bancali è già stata completamente spuntata (actual_quantity >= expected_quantity), aggiorna i metadati rettificati senza duplicare bancali
          if (isBancaliUom && remItemQty <= 0 && actItemQty > 0) {
            await connection.query(
              `UPDATE PALLETS
               SET net_weight_kg = COALESCE(?, net_weight_kg),
                   batch = CASE WHEN ? THEN ? ELSE batch END,
                   expiration_date = COALESCE(?, expiration_date)
               WHERE inbound_ddt_id = ? AND product_id = ?`,
              [scannedNetKg, hasBatchParam ? 1 : 0, effectivePalletBatch, scannedExp, ddt_id, item.product_id]
            );
            await connection.query(
              `UPDATE INBOUND_DDT_ITEMS
               SET actual_net_weight_kg = COALESCE(?, actual_net_weight_kg),
                   actual_batch = CASE WHEN ? THEN ? ELSE actual_batch END,
                   actual_expiration_date = COALESCE(?, actual_expiration_date)
               WHERE id = ?`,
              [scannedNetKg, hasBatchParam ? 1 : 0, scannedBatch, scannedExp, item_id]
            );
            await connection.commit();
            return { status: 200, body: { success: true, updated_metadata: true } };
          }

          // Generate or use existing pallet code based on location or pallet_group
          let palletCode = null;
          let locStr = null;
          if (location) {
            locStr = location.toUpperCase().trim();
            palletCode = await findExistingLocationBarcode(connection, locStr, false);
          }
          if (!palletCode && item.pallet_group) {
            const [sibRows] = await connection.query(
              `SELECT p.pallet_code
               FROM PALLETS p
               JOIN INBOUND_DDT_ITEMS di ON di.inbound_ddt_id = p.inbound_ddt_id
                 AND di.product_id = p.product_id
                 AND COALESCE(di.batch, '') = COALESCE(p.batch, '')
               WHERE p.inbound_ddt_id = ? AND di.pallet_group = ? AND di.actual_quantity > 0
               ORDER BY p.id ASC LIMIT 1`,
              [ddt_id, item.pallet_group]
            );
            if (sibRows.length > 0) {
              palletCode = sibRows[0].pallet_code;
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

          // Insert Pallet (eredita client_ddt, check-in, listino, flag, data arrivo, pesi, magazzino, temperatura e ADR)
          const itemFlagsVal = item.flags
            ? (typeof item.flags === 'string' ? item.flags : JSON.stringify(item.flags))
            : null;
          const itemArrivalVal = item.arrival_date ? new Date(item.arrival_date) : null;
          const resolvedWhName = warehouse || item.warehouse || 'Settala';
          const [[whRowScan]] = await connection.query('SELECT id, name FROM WAREHOUSES WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1', [resolvedWhName]);
          const resolvedWhId = whRowScan?.id || item.warehouse_id || 1;
          const itemAdrVal = item.adr_data ? (typeof item.adr_data === 'string' ? item.adr_data : JSON.stringify(item.adr_data)) : null;

          await connection.query(`
            INSERT INTO PALLETS 
            (pallet_code, customer_id, product_id, quantity, units_per_box, kg_per_unit, batch, warehouse, warehouse_id, temp_regime, is_adr, adr_data, status, location, client_pallet_number, client_article_number, expiration_date, pallet_uom, net_weight_kg, gross_weight_kg, tariff_plan_id, flags, created_at, inbound_ddt_id, client_ddt, checkin_id, checkin_session_code)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?, ?)
          `, [
            palletCode, ddts[0].customer_id, item.product_id, effectiveQty, item.units_per_box, effectiveKgPerUnit, effectivePalletBatch,
            whRowScan?.name || resolvedWhName, resolvedWhId, item.temp_regime || 'NONE', item.is_adr ? 1 : 0, itemAdrVal,
            locStr ? 'STOCKED' : 'PENDING', locStr || null, item.client_pallet_number, item.client_article_number,
            effectivePalletExp, item.pallet_uom,
            effectivePalletNetKg, item.gross_weight_kg ?? null, item.tariff_plan_id ?? null, itemFlagsVal,
            itemArrivalVal,
            ddt_id, ddts[0].client_ddt || null, ddts[0].checkin_id || null, ddts[0].checkin_session_code || null
          ]);

          if (locStr) {
            await consolidateLocationPallets(connection, locStr);
          }
          
          await connection.query(
            "INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)",
            ['INBOUND', `Spunta Zebra (${ddts[0].ddt_number}): Creata/aggiornata paletta ${palletCode} (${effectiveQty} ${item.product_uom || 'pz'}${effectivePalletNetKg !== null ? ` · ${effectivePalletNetKg} kg netti` : ''}) per ${item.product_name || 'Articolo'}${locStr ? ' in ' + locStr : ''}`, 'Zebra', request.user ? request.user.username : 'Operatore']
          );

          // Update actual quantity, net weight, batch, expiration
          await connection.query(
            `UPDATE INBOUND_DDT_ITEMS
             SET actual_quantity = actual_quantity + ?,
                 actual_net_weight_kg = CASE WHEN ? IS NOT NULL THEN COALESCE(actual_net_weight_kg, 0) + ? ELSE actual_net_weight_kg END,
                 actual_batch = CASE WHEN ? THEN ? ELSE actual_batch END,
                 actual_expiration_date = COALESCE(?, actual_expiration_date)
             WHERE id = ?`,
            [effectiveQty, scannedNetKg, scannedNetKg, hasBatchParam ? 1 : 0, scannedBatch, scannedExp, item_id]
          );

          await connection.commit();
          return { status: 200, body: { success: true, pallet_code: palletCode } };
        } catch (txErr) {
          await connection.rollback();
          throw txErr;
        }
      });

      if (outcome.status !== 200) {
        return reply.code(outcome.status).send(outcome.body);
      }

      if (fastify.io) {
        fastify.io.emit('inbound_updated');
        fastify.io.emit('inventory_updated');
        fastify.io.emit('stow_updated');
        fastify.io.emit('locations_updated');
        fastify.io.emit('dashboard_update');
      }
      return outcome.body;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(err.statusCode || 500).send({ error: err.message || 'Errore scan' });
    } finally {
      connection.release();
    }
  });

  function buildDdtDiscrepancySnapshot(items) {
    let discrepancy = false;
    let totalDiff = 0;
    let totalWeightDiff = 0;
    const summaryTags = new Set();

    const itemsSnapshot = items.map(item => {
      const exp = parseFloat(item.expected_quantity) || 0;
      const act = parseFloat(item.actual_quantity) || 0;
      const diff = Number((act - exp).toFixed(4));
      const hasQtyDisc = Math.abs(diff) > 0.0001;

      const expNetKg = item.net_weight_kg !== null && item.net_weight_kg !== undefined ? parseFloat(item.net_weight_kg) : null;
      const actNetKg = item.actual_net_weight_kg !== null && item.actual_net_weight_kg !== undefined ? parseFloat(item.actual_net_weight_kg) : null;
      const weightDiff = (expNetKg !== null && actNetKg !== null)
        ? Number((actNetKg - expNetKg).toFixed(3))
        : (expNetKg === null && actNetKg !== null ? Number(actNetKg.toFixed(3)) : 0);
      const hasWeightDisc = actNetKg !== null && (expNetKg === null || Math.abs(actNetKg - expNetKg) > 0.001);

      const expBatch = (item.batch || '').trim();
      const hasActualBatchCol = item.actual_batch !== null && item.actual_batch !== undefined;
      const actBatch = hasActualBatchCol ? String(item.actual_batch).trim() : null;
      const hasBatchDisc = hasActualBatchCol && actBatch !== expBatch;

      const expExp = formatDateISO(item.expiration_date);
      const actExp = formatDateISO(item.actual_expiration_date);
      const hasExpDisc = Boolean(actExp && actExp !== expExp);

      const reasons = [];
      if (hasQtyDisc) {
        totalDiff += diff;
        reasons.push(`Q.tà (${diff > 0 ? '+' : ''}${diff})`);
        summaryTags.add('Quantità');
      }
      if (hasWeightDisc) {
        totalWeightDiff = Number((totalWeightDiff + weightDiff).toFixed(3));
        reasons.push(`KG Netti (${expNetKg ?? '-'} → ${actNetKg} kg)`);
        summaryTags.add('KG Netti');
      }
      if (hasBatchDisc) {
        reasons.push(`Lotto (${expBatch || '-'} → ${actBatch || '[vuoto]'})`);
        summaryTags.add('Lotto');
      }
      if (hasExpDisc) {
        reasons.push(`Scadenza (${expExp || '-'} → ${actExp})`);
        summaryTags.add('Scadenza');
      }
      if (reasons.length > 0) discrepancy = true;

      return {
        item_id: item.id,
        product_id: item.product_id,
        sku: item.sku,
        product_name: item.product_name,
        batch: item.batch || null,
        actual_batch: actBatch || null,
        expiration_date: expExp || null,
        actual_expiration_date: actExp || null,
        uom: item.product_uom || 'Pezzi',
        expected_quantity: exp,
        actual_quantity: act,
        diff,
        expected_net_weight_kg: expNetKg,
        actual_net_weight_kg: actNetKg,
        weight_diff: weightDiff,
        discrepancy_reasons: reasons
      };
    });

    const summaryDetails = [];
    if (Math.abs(totalDiff) > 0.0001) summaryDetails.push(`Q.tà: ${totalDiff > 0 ? '+' : ''}${totalDiff}`);
    if (Math.abs(totalWeightDiff) > 0.001) summaryDetails.push(`KG Netti: ${totalWeightDiff > 0 ? '+' : ''}${totalWeightDiff} kg`);
    if (summaryTags.has('Lotto')) summaryDetails.push('Lotto variato');
    if (summaryTags.has('Scadenza')) summaryDetails.push('Scadenza variata');

    return {
      discrepancy,
      totalDiff,
      totalWeightDiff,
      summaryLabel: summaryDetails.join(' • ') || (totalDiff !== 0 ? `${totalDiff > 0 ? '+' : ''}${totalDiff}` : 'Dati variati'),
      itemsSnapshot
    };
  }

  // 5. Complete DDT (from Zebra)
  fastify.post('/ddt/:id/complete', async (request, reply) => {
    if (!hasPermission(request.user, 'inbound_create')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di completare la spunta DDT.' });
    }

    const ddtId = request.params.id;
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [[ddt]] = await connection.query('SELECT * FROM INBOUND_DDTS WHERE id = ? FOR UPDATE', [ddtId]);
      if (!ddt) {
        await connection.rollback();
        return reply.code(404).send({ error: 'DDT non trovato' });
      }
      if (!canAccessCustomer(request.user, ddt.customer_id)) {
        await connection.rollback();
        return reply.code(403).send({ error: 'Accesso negato: cliente limitato per il tuo profilo.' });
      }
      if (ddt.status === 'COMPLETED') {
        await connection.rollback();
        return reply.code(409).send({ error: 'DDT già completato da un altro operatore' });
      }

      const [items] = await connection.query(`
        SELECT i.*, 
               COALESCE(NULLIF(i.sku, ''), p.sku) AS sku,
               COALESCE(NULLIF(i.product_name, ''), p.name) AS product_name,
               COALESCE(i.product_uom, p.uom, 'Pezzi') AS product_uom
        FROM INBOUND_DDT_ITEMS i
        LEFT JOIN PRODUCTS p ON i.product_id = p.id
        WHERE i.inbound_ddt_id = ?
      `, [ddtId]);

      const { discrepancy, summaryLabel, itemsSnapshot } = buildDdtDiscrepancySnapshot(items);

      const status = discrepancy ? 'DISCREPANCY' : 'COMPLETED';
      const notes = discrepancy
        ? `Rilevata discrepanza in spunta (${summaryLabel}) — In attesa di approvazione o rifiuto da Backoffice`
        : 'Spunta completata regolarmente senza discrepanze';

      await connection.query(
        'UPDATE INBOUND_DDTS SET status = ?, closed_at = NOW(), notes = ? WHERE id = ?',
        [status, notes, ddtId]
      );

      if (!discrepancy) {
        await consolidateLocationPallets(connection);
      }
      if (discrepancy) {
        await connection.query(
          `INSERT INTO INBOUND_DISCREPANCY_LOGS (inbound_ddt_id, ddt_number, customer_id, decision, reason, items_snapshot, username, source)
           VALUES (?, ?, ?, 'REPORTED', ?, ?, ?, 'Zebra')`,
          [
            ddtId,
            ddt.ddt_number,
            ddt.customer_id,
            `Discrepanza rilevata a fine spunta Zebra (${summaryLabel})`,
            JSON.stringify(itemsSnapshot),
            request.user?.username || 'Operatore Zebra'
          ]
        );
      }

      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        [
          'COMPLETE_INBOUND_DDT',
          `Completata spunta DDT ${ddt.ddt_number} con stato ${status}${discrepancy ? ` (${summaryLabel})` : ''}`,
          'Zebra',
          request.user?.username || 'Operatore Zebra'
        ]
      );

      await connection.commit();
      await createNotification(db, fastify.io, {
        type: discrepancy ? 'INBOUND_DISCREPANCY' : 'INBOUND_COMPLETED',
        title: discrepancy ? `Discrepanza DDT ${ddt.ddt_number}` : `DDT Entrata Completato: ${ddt.ddt_number}`,
        message: discrepancy
          ? `Rilevata discrepanza in spunta DDT ${ddt.ddt_number} (${summaryLabel}). Richiesta verifica Backoffice.`
          : `La spunta del DDT ${ddt.ddt_number} è stata completata regolarmente.`,
        customer_id: ddt.customer_id,
        entity_type: 'INBOUND',
        entity_code: ddt.ddt_number,
        link_path: '/desktop/documents',
        actor_username: request.user?.username || 'Operatore Zebra'
      });
      if (fastify.io) {
        fastify.io.emit('inbound_updated');
        fastify.io.emit('inventory_updated');
        fastify.io.emit('locations_updated');
        fastify.io.emit('dashboard_update');
        fastify.io.emit('stow_updated');
      }
      return { success: true, status, notes };
    } catch (err) {
      await connection.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore completamento DDT' });
    } finally {
      connection.release();
    }
  });

  // 5b. Accept Discrepancy (from Desktop Backoffice)
  fastify.post('/ddt/:id/discrepancy/accept', async (request, reply) => {
    if (!hasPermission(request.user, 'inbound_create')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di gestire e confermare discrepanze DDT.' });
    }

    const ddtId = request.params.id;
    const { reason } = request.body || {};

    if (!reason || !String(reason).trim()) {
      return reply.code(400).send({ error: 'Devi specificare obbligatoriamente il motivo dell\'accettazione della discrepanza.' });
    }

    const cleanReason = String(reason).trim();
    const username = request.user?.username || 'Backoffice';
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const [[ddt]] = await connection.query('SELECT * FROM INBOUND_DDTS WHERE id = ? FOR UPDATE', [ddtId]);
      if (!ddt) {
        await connection.rollback();
        return reply.code(404).send({ error: 'DDT non trovato' });
      }
      if (!canAccessCustomer(request.user, ddt.customer_id)) {
        await connection.rollback();
        return reply.code(403).send({ error: 'Accesso negato: cliente limitato per il tuo profilo.' });
      }
      if (ddt.status === 'COMPLETED') {
        await connection.rollback();
        return reply.code(409).send({ error: 'Discrepanza già accettata da un altro operatore' });
      }

      const [items] = await connection.query(`
        SELECT i.*, 
               COALESCE(NULLIF(i.sku, ''), p.sku) AS sku,
               COALESCE(NULLIF(i.product_name, ''), p.name) AS product_name,
               COALESCE(i.product_uom, p.uom, 'Pezzi') AS product_uom
        FROM INBOUND_DDT_ITEMS i
        LEFT JOIN PRODUCTS p ON i.product_id = p.id
        WHERE i.inbound_ddt_id = ?
      `, [ddtId]);

      const { itemsSnapshot, summaryLabel } = buildDdtDiscrepancySnapshot(items);

      // Applica allo stock (PALLETS) le rettifiche accettate rilevate dal terminale Zebra (KG Netti, Lotto, Scadenza)
      const appliedChanges = [];
      for (const item of items) {
        const hasActualBatch = item.actual_batch !== null && item.actual_batch !== undefined;
        const acceptedBatch = hasActualBatch ? (String(item.actual_batch).trim() || null) : (item.batch || null);
        const acceptedExp = formatDateISO(item.actual_expiration_date) || formatDateISO(item.expiration_date) || null;
        const hasActualNetKg = item.actual_net_weight_kg !== null && item.actual_net_weight_kg !== undefined;
        const acceptedNetKg = hasActualNetKg ? parseFloat(item.actual_net_weight_kg) : null;

        const sameProductItemsCount = items.filter(x => Number(x.product_id) === Number(item.product_id)).length;
        const [palRows] = sameProductItemsCount === 1
          ? await connection.query(
              'SELECT id, quantity, batch FROM PALLETS WHERE inbound_ddt_id = ? AND product_id = ?',
              [ddtId, item.product_id]
            )
          : await connection.query(
              'SELECT id, quantity, batch FROM PALLETS WHERE inbound_ddt_id = ? AND product_id = ? AND COALESCE(batch, "") IN (?, ?)',
              [ddtId, item.product_id, item.batch || '', acceptedBatch || '']
            );

        if (palRows.length > 0) {
          const totalPalQty = palRows.reduce((acc, r) => acc + (parseFloat(r.quantity) || 0), 0);
          for (const pr of palRows) {
            const propWeight = hasActualNetKg
              ? (palRows.length === 1 || totalPalQty <= 0
                  ? acceptedNetKg
                  : Number(((acceptedNetKg * (parseFloat(pr.quantity) || 0)) / totalPalQty).toFixed(3)))
              : null;
            await connection.query(
              `UPDATE PALLETS
               SET net_weight_kg = CASE WHEN ? THEN ? ELSE net_weight_kg END,
                   batch = CASE WHEN ? THEN ? ELSE batch END,
                   expiration_date = COALESCE(?, expiration_date)
               WHERE id = ?`,
              [hasActualNetKg ? 1 : 0, propWeight, hasActualBatch ? 1 : 0, acceptedBatch, acceptedExp, pr.id]
            );
          }
        }

        const snapItem = itemsSnapshot.find(s => Number(s.item_id) === Number(item.id));
        if (snapItem && Array.isArray(snapItem.discrepancy_reasons) && snapItem.discrepancy_reasons.length > 0) {
          appliedChanges.push(`${item.product_name || item.sku}: ${snapItem.discrepancy_reasons.join(', ')}`);
        }
      }

      const resolvedNote = `Discrepanza accettata da ${username}: ${cleanReason}${summaryLabel ? ` [${summaryLabel}]` : ''}`;

      await connection.query(
        `UPDATE INBOUND_DDTS 
         SET status = 'COMPLETED',
             discrepancy_accepted = 1,
             discrepancy_reason = ?,
             discrepancy_resolved_by = ?,
             discrepancy_resolved_at = NOW(),
             notes = ?
         WHERE id = ?`,
        [cleanReason, username, resolvedNote, ddtId]
      );

      await connection.query(
        `INSERT INTO INBOUND_DISCREPANCY_LOGS (inbound_ddt_id, ddt_number, customer_id, decision, reason, items_snapshot, username, source)
         VALUES (?, ?, ?, 'ACCEPTED', ?, ?, ?, 'Gestionale')`,
        [ddtId, ddt.ddt_number, ddt.customer_id, cleanReason, JSON.stringify(itemsSnapshot), username]
      );

      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        [
          'ACCEPT_DISCREPANCY',
          `Accettata discrepanza DDT ${ddt.ddt_number} — Motivo: "${cleanReason}". Applicate rettifiche stock: ${appliedChanges.join(' | ') || summaryLabel}.`,
          'Gestionale',
          username
        ]
      );

      await consolidateLocationPallets(connection);
      await connection.commit();
      await createNotification(db, fastify.io, {
        type: 'INBOUND_COMPLETED',
        title: `DDT Accettato: ${ddt.ddt_number}`,
        message: `${username} ha accettato la discrepanza sul DDT ${ddt.ddt_number}. Motivo: ${cleanReason}`,
        customer_id: ddt.customer_id,
        entity_type: 'INBOUND',
        entity_code: ddt.ddt_number,
        link_path: '/desktop/documents',
        actor_username: username
      });
      if (fastify.io) {
        fastify.io.emit('inbound_updated');
        fastify.io.emit('inventory_updated');
        fastify.io.emit('locations_updated');
        fastify.io.emit('dashboard_update');
        fastify.io.emit('stow_updated');
      }

      return { success: true, status: 'COMPLETED', reason: cleanReason, resolved_by: username };
    } catch (err) {
      await connection.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante l\'accettazione della discrepanza' });
    } finally {
      connection.release();
    }
  });

  // 5c. Reject Discrepancy (from Desktop Backoffice)
  fastify.post('/ddt/:id/discrepancy/reject', async (request, reply) => {
    if (!hasPermission(request.user, 'inbound_create')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di rifiutare discrepanze DDT.' });
    }

    const ddtId = request.params.id;
    const { reason } = request.body || {};
    const cleanReason = reason && String(reason).trim() ? String(reason).trim() : 'Richiesta nuova spunta da Backoffice';
    const username = request.user?.username || 'Backoffice';
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const [[ddt]] = await connection.query('SELECT * FROM INBOUND_DDTS WHERE id = ?', [ddtId]);
      if (!ddt) {
        await connection.rollback();
        return reply.code(404).send({ error: 'DDT non trovato' });
      }
      if (!canAccessCustomer(request.user, ddt.customer_id)) {
        await connection.rollback();
        return reply.code(403).send({ error: 'Accesso negato: cliente limitato per il tuo profilo.' });
      }

      const [items] = await connection.query(`
        SELECT i.*, 
               COALESCE(NULLIF(i.sku, ''), p.sku) AS sku,
               COALESCE(NULLIF(i.product_name, ''), p.name) AS product_name,
               COALESCE(i.product_uom, p.uom, 'Pezzi') AS product_uom
        FROM INBOUND_DDT_ITEMS i
        LEFT JOIN PRODUCTS p ON i.product_id = p.id
        WHERE i.inbound_ddt_id = ?
      `, [ddtId]);

      const { itemsSnapshot } = buildDdtDiscrepancySnapshot(items);

      await connection.query('DELETE FROM PALLETS WHERE inbound_ddt_id = ?', [ddtId]);
      await connection.query(
        'UPDATE INBOUND_DDT_ITEMS SET actual_quantity = 0, actual_net_weight_kg = NULL, actual_batch = NULL, actual_expiration_date = NULL WHERE inbound_ddt_id = ?',
        [ddtId]
      );

      const rejectNote = `Discrepanza RIFIUTATA da ${username} (${cleanReason}) — Da rispuntare su Zebra`;

      await connection.query(
        `UPDATE INBOUND_DDTS 
         SET status = 'PENDING',
             closed_at = NULL,
             rejected_count = COALESCE(rejected_count, 0) + 1,
             last_rejected_reason = ?,
             last_rejected_by = ?,
             last_rejected_at = NOW(),
             notes = ?
         WHERE id = ?`,
        [cleanReason, username, rejectNote, ddtId]
      );

      await connection.query(
        `INSERT INTO INBOUND_DISCREPANCY_LOGS (inbound_ddt_id, ddt_number, customer_id, decision, reason, items_snapshot, username, source)
         VALUES (?, ?, ?, 'REJECTED', ?, ?, ?, 'Gestionale')`,
        [ddtId, ddt.ddt_number, ddt.customer_id, cleanReason, JSON.stringify(itemsSnapshot), username]
      );

      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        [
          'REJECT_DISCREPANCY',
          `Rifiutata discrepanza DDT ${ddt.ddt_number} — Motivo: "${cleanReason}". Spunta azzerata e rimandata a Zebra.`,
          'Gestionale',
          username
        ]
      );

      await connection.commit();
      if (fastify.io) {
        fastify.io.emit('dashboard_update');
        fastify.io.emit('stow_updated');
      }

      return { success: true, status: 'PENDING', reason: cleanReason };
    } catch (err) {
      await connection.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante il rifiuto della discrepanza' });
    } finally {
      connection.release();
    }
  });

  // 6. Get DDT PDF
  fastify.get('/ddt/:identifier/pdf', async (request, reply) => {
    if (!hasPermission(request.user, 'view_documents') && !hasPermission(request.user, 'view_inbound') && !hasPermission(request.user, 'inbound_create')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di visualizzare i PDF dei DDT.' });
    }

    const { identifier } = request.params;
    try {
      const PDFDocument = require('pdfkit');
      
      const isId = !isNaN(identifier);
      const queryStr = isId
        ? 'SELECT d.*, c.business_name FROM INBOUND_DDTS d JOIN CUSTOMERS c ON d.customer_id = c.id WHERE d.id = ?'
        : 'SELECT d.*, c.business_name FROM INBOUND_DDTS d JOIN CUSTOMERS c ON d.customer_id = c.id WHERE d.ddt_number = ?';
      const [ddts] = await db.query(queryStr, [identifier]);
      
      if (ddts.length === 0) return reply.code(404).send({ error: 'DDT non trovato' });
      const ddt = ddts[0];

      if (!canAccessCustomer(request.user, ddt.customer_id)) {
        return reply.code(403).send({ error: 'Accesso negato: cliente limitato per il tuo profilo.' });
      }

      const [items] = await db.query(`
        SELECT i.*, 
               COALESCE(NULLIF(i.sku, ''), p.sku) AS sku,
               COALESCE(NULLIF(i.product_name, ''), p.name) as product_name,
               COALESCE(i.product_uom, p.uom, 'Pezzi') as product_uom
        FROM INBOUND_DDT_ITEMS i
        LEFT JOIN PRODUCTS p ON i.product_id = p.id
        WHERE i.inbound_ddt_id = ?
      `, [ddt.id]);

      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `inline; filename="${ddt.ddt_number}.pdf"`);
      reply.send(doc);

      const fsModule = require('fs');
      const path = require('path');
      const logoPath = path.join(__dirname, '../../../frontend/public/logo_scuro.png');
      
      if (fsModule.existsSync(logoPath)) {
        doc.image(logoPath, (doc.page.width - 280) / 2, 24, { fit: [280, 88], align: 'center' });
        doc.y = 120;
      } else {
        doc.fillColor('#0ea5e9').fontSize(24).font('Helvetica-Bold').text('Logistic Porcelli', { align: 'center' });
        doc.fillColor('#94a3b8').fontSize(10).font('Helvetica').text('Logistica & Magazzino', { align: 'center' });
        doc.moveDown(2);
      }

      doc.fillColor('#1e293b').fontSize(16).font('Helvetica-Bold').text('DDT ENTRATA MERCE (SPUNTA)', { align: 'center' });
      
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
      if (ddt.discrepancy_accepted && ddt.discrepancy_reason) {
        doc.text(`Discrepanza Accettata da ${ddt.discrepancy_resolved_by || 'Backoffice'} il ${ddt.discrepancy_resolved_at ? new Date(ddt.discrepancy_resolved_at).toLocaleString('it-IT') : '-'}`);
        doc.text(`Motivo Accettazione: ${ddt.discrepancy_reason}`);
      } else if (ddt.notes) {
        doc.text(`Note: ${ddt.notes}`);
      }
      
      doc.moveDown(2);
      doc.font('Helvetica-Bold').text('RIGHE ATTESE:', { underline: true });
      doc.moveDown(0.5);

      items.forEach((item, idx) => {
        const exp = parseFloat(item.expected_quantity);
        const act = parseFloat(item.actual_quantity || 0);
        const isDiscrepancy = exp !== act && ddt.status !== 'PENDING';
        
        doc.font('Helvetica-Bold').fontSize(11).fillColor('black').text(`${idx + 1}. ${item.product_name} (${item.sku})`);
        
        if (isDiscrepancy) {
          doc.font('Helvetica-Bold').fontSize(10).fillColor('#ef4444').text(`Q.ta Attesa: ${item.expected_quantity} ${item.product_uom} (Effettiva: ${item.actual_quantity}) - DISCREPANZA (${act - exp > 0 ? '+' : ''}${act - exp})`);
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

  // 7. Get Barcodes for generated pallets (Solo quando COMPLETED)
  fastify.get('/ddt/:identifier/barcodes', async (request, reply) => {
    if (!hasPermission(request.user, 'view_documents') && !hasPermission(request.user, 'view_inbound') && !hasPermission(request.user, 'inbound_create')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di stampare i barcode del DDT.' });
    }

    const { identifier } = request.params;
    try {
      const isId = !isNaN(identifier);
      const queryStr = isId ? 'SELECT d.* FROM INBOUND_DDTS d WHERE d.id = ?' : 'SELECT d.* FROM INBOUND_DDTS d WHERE d.ddt_number = ?';
      const [ddts] = await db.query(queryStr, [identifier]);
      if (ddts.length === 0) return reply.code(404).send({ error: 'DDT non trovato' });
      if (!canAccessCustomer(request.user, ddts[0].customer_id)) {
        return reply.code(403).send({ error: 'Accesso negato: cliente limitato per il tuo profilo.' });
      }
      if (ddts[0].status !== 'COMPLETED') {
        return reply.code(400).send({ error: 'Impossibile stampare i barcode finché il DDT non è Completato (o la discrepanza non è stata accettata).' });
      }

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

      const showPalletLogo = await shouldShowPalletBarcodeLogo(db);
      const pdfBuffer = await generateLabelsPdfBuffer(generatedLabels, { paper_format: 'A4', print_mode: 'GRID', show_logo: showPalletLogo });
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', 'inline; filename="barcodes.pdf"');
      return reply.send(pdfBuffer);
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore generazione barcodes' });
    }
  });

  // 7. DELETE /api/inbound/ddt/:id - Elimina definitivamente un DDT Entrata
  fastify.delete('/ddt/:id', async (request, reply) => {
    if (!hasPermission(request.user, 'delete_inbound_ddt')) {
      return reply.code(403).send({ error: 'Accesso negato: il tuo ruolo non possiede il permesso di eliminare i DDT Entrata (Spunta).' });
    }

    const ddtId = request.params.id;
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const [[ddt]] = await connection.query(`
        SELECT d.*, c.business_name AS customer_name
        FROM INBOUND_DDTS d
        JOIN CUSTOMERS c ON d.customer_id = c.id
        WHERE d.id = ?
      `, [ddtId]);

      if (!ddt) {
        await connection.rollback();
        return reply.code(404).send({ error: 'DDT Entrata non trovato' });
      }

      if (!canAccessCustomer(request.user, ddt.customer_id)) {
        await connection.rollback();
        return reply.code(403).send({ error: 'Accesso negato: il cliente associato a questo DDT è limitato per il tuo profilo.' });
      }

      // Controllo se ci sono palette già spedite derivate da questo DDT
      const [shippedPallets] = await connection.query(
        "SELECT id, pallet_code FROM PALLETS WHERE inbound_ddt_id = ? AND status = 'SHIPPED'",
        [ddtId]
      );
      if (shippedPallets.length > 0) {
        await connection.rollback();
        const codes = shippedPallets.map(p => p.pallet_code).slice(0, 5).join(', ');
        return reply.code(400).send({
          error: `Impossibile eliminare il DDT: ${shippedPallets.length} palett${shippedPallets.length === 1 ? 'a risulta già spedita' : 'e risultano già spedite'} (${codes}${shippedPallets.length > 5 ? '...' : ''}).`
        });
      }

      // Controllo se ci sono palette impegnate in spedizioni Outbound aperte
      const [reservedPallets] = await connection.query(`
        SELECT oi.id, o.order_code, p.pallet_code 
        FROM OUTBOUND_ITEMS oi
        JOIN OUTBOUND_ORDERS o ON oi.order_id = o.id
        JOIN PALLETS p ON oi.pallet_id = p.id
        WHERE p.inbound_ddt_id = ? AND o.status NOT IN ('CANCELLED', 'RETURNED')
      `, [ddtId]);

      if (reservedPallets.length > 0) {
        await connection.rollback();
        return reply.code(400).send({
          error: `Impossibile eliminare il DDT: la paletta ${reservedPallets[0].pallet_code} è già impegnata nell'ordine di spedizione ${reservedPallets[0].order_code}.`
        });
      }

      // Recupera quante palette verranno eliminate
      const [[palCountRow]] = await connection.query(
        'SELECT COUNT(*) as count FROM PALLETS WHERE inbound_ddt_id = ?',
        [ddtId]
      );
      const deletedPalletsCount = palCountRow?.count || 0;

      // 1. Rimuovi le palette generate dalla spunta da PALLETS
      await connection.query('DELETE FROM PALLETS WHERE inbound_ddt_id = ?', [ddtId]);

      // 2. Rimuovi i log di discrepanza
      await connection.query('DELETE FROM INBOUND_DISCREPANCY_LOGS WHERE inbound_ddt_id = ?', [ddtId]);

      // 3. Rimuovi le righe del DDT
      await connection.query('DELETE FROM INBOUND_DDT_ITEMS WHERE inbound_ddt_id = ?', [ddtId]);

      // 4. Elimina il record principale DDT
      await connection.query('DELETE FROM INBOUND_DDTS WHERE id = ?', [ddtId]);

      const username = request.user?.username || 'Backoffice';

      // 5. Registra l'evento in AUDIT_LOGS
      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        [
          'DELETE_INBOUND_DDT',
          `Eliminato definitivamente DDT Entrata "${ddt.ddt_number}" (${ddt.customer_name}) con rimozione di ${deletedPalletsCount} palette dall'inventario`,
          'Gestionale',
          username
        ]
      );

      await connection.commit();

      if (fastify.io) {
        fastify.io.emit('inbound_updated');
        fastify.io.emit('dashboard_update');
        fastify.io.emit('stow_updated');
        fastify.io.emit('inventory_updated');
      }

      return {
        success: true,
        message: `DDT Entrata ${ddt.ddt_number} eliminato con successo.${deletedPalletsCount > 0 ? ` ${deletedPalletsCount} palette rimosse dall'inventario.` : ''}`,
        deleted_pallets_count: deletedPalletsCount
      };
    } catch (err) {
      await connection.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante l\'eliminazione del DDT Entrata' });
    } finally {
      connection.release();
    }
  });
}

module.exports = inboundRoutes;
