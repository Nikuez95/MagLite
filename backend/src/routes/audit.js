const { hasPermission } = require('../utils/permissions');
const db = require('../config/db');

async function auditRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('preHandler', async (request, reply) => {
    if (!hasPermission(request.user, 'view_audit')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di visualizzare gli Audit Logs.' });
    }
  });

  // 1. GET /api/audit - Registro Globale Operazioni Arricchito
  fastify.get('/', async (request, reply) => {
    const { search = '', start_date, end_date, source = '', category = '', username = '' } = request.query;

    try {
      let query = 'SELECT * FROM AUDIT_LOGS WHERE 1=1';
      const params = [];

      if (search && search.trim()) {
        const s = `%${search.trim()}%`;
        query += ' AND (details LIKE ? OR action LIKE ? OR username LIKE ? OR source LIKE ?)';
        params.push(s, s, s, s);
      }

      if (source && source !== 'ALL') {
        query += ' AND source = ?';
        params.push(source);
      }

      if (username && username !== 'ALL') {
        query += ' AND username = ?';
        params.push(username);
      }

      if (category && category !== 'ALL') {
        if (category === 'INBOUND') {
          query += " AND (action LIKE '%INBOUND%' OR action LIKE '%DDT%' OR action LIKE '%DISCREPANCY%')";
        } else if (category === 'STOW_HANDLING') {
          query += " AND (action LIKE '%STOW%' OR action LIKE '%HANDLING%' OR action LIKE '%MOVE%' OR action LIKE '%LOC%')";
        } else if (category === 'OUTBOUND') {
          query += " AND (action LIKE '%OUTBOUND%' OR action LIKE '%PICK%' OR action LIKE '%SHIP%')";
        } else if (category === 'STOCK_PRODUCTS') {
          query += " AND (action LIKE '%PRODUCT%' OR action LIKE '%PALLET%' OR action LIKE '%QTY%' OR action LIKE '%ADJUST%' OR action LIKE '%DELETE%')";
        } else if (category === 'CUSTOMERS_BILLING') {
          query += " AND (action LIKE '%CUSTOMER%' OR action LIKE '%INVOICE%' OR action LIKE '%EXPENSE%' OR action LIKE '%PAYMENT%' OR action LIKE '%TARIFF%')";
        }
      }

      if (start_date) {
        query += ' AND DATE(created_at) >= ?';
        params.push(start_date);
      }

      if (end_date) {
        query += ' AND DATE(created_at) <= ?';
        params.push(end_date);
      }

      query += ' ORDER BY created_at DESC LIMIT 600';

      const [logs] = await db.query(query, params);

      // Pre-carica mappa palette e prodotti per arricchire i log con info cliccabili di prodotto/bancale/cliente
      const [allPallets] = await db.query(`
        SELECT p.id, p.pallet_code, p.product_id, p.customer_id, p.batch, p.location, p.quantity, p.status, p.client_pallet_number,
               pr.name AS product_name, pr.sku AS sku, c.business_name AS customer_name
        FROM PALLETS p
        LEFT JOIN PRODUCTS pr ON p.product_id = pr.id
        LEFT JOIN CUSTOMERS c ON p.customer_id = c.id
      `);

      const palletByCode = new Map();
      for (const p of allPallets) {
        if (!palletByCode.has(p.pallet_code)) {
          palletByCode.set(p.pallet_code, []);
        }
        palletByCode.get(p.pallet_code).push(p);
      }

      const [allProducts] = await db.query(`
        SELECT pr.id, pr.sku, pr.name, c.business_name AS customer_name
        FROM PRODUCTS pr
        LEFT JOIN CUSTOMERS c ON pr.customer_id = c.id
      `);

      for (const log of logs) {
        const text = String(log.details || '');
        // Cerca codici paletta PAL-... o NOBAR-...
        const palMatch = text.match(/\b(PAL-[A-Z0-9\-]+|NOBAR-[A-Z0-9\-]+)\b/i);
        if (palMatch) {
          const code = palMatch[1].toUpperCase();
          log.pallet_code = code;
          const pRows = palletByCode.get(code) || [];
          if (pRows.length > 0) {
            log.product_id = pRows[0].product_id;
            log.product_name = pRows.length > 1
              ? `${pRows[0].product_name} (+${pRows.length - 1})`
              : pRows[0].product_name;
            log.sku = pRows[0].sku;
            log.customer_name = pRows[0].customer_name;
            log.batch = pRows[0].batch;
            log.location = pRows[0].location;
            log.client_pallet_number = pRows[0].client_pallet_number;
          }
        }

        // Cerca codici DDT IN-... o Ordini OUT-...
        const ddtMatch = text.match(/\b(IN-\d{4}-\d+)\b/i);
        if (ddtMatch) log.ddt_number = ddtMatch[1].toUpperCase();

        const outMatch = text.match(/\b(OUT-[A-Z0-9\-]+)\b/i);
        if (outMatch) log.order_code = outMatch[1].toUpperCase();

        // Se non abbiamo già agganciato un prodotto da paletta, proviamo per SKU o nome prodotto
        if (!log.product_id && allProducts.length > 0) {
          for (const pr of allProducts) {
            if (
              (pr.sku && text.includes(pr.sku)) ||
              (pr.name && pr.name.length >= 4 && text.toLowerCase().includes(pr.name.toLowerCase()))
            ) {
              log.product_id = pr.id;
              log.product_name = pr.name;
              log.sku = pr.sku;
              log.customer_name = log.customer_name || pr.customer_name;
              break;
            }
          }
        }
      }

      return logs;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore recupero audit logs' });
    }
  });

  // 2. GET /api/audit/products - Lista Prodotti con KPI di Tracciamento per selettore Storico Prodotto
  fastify.get('/products', async (request, reply) => {
    try {
      const [rows] = await db.query(`
        SELECT pr.*,
               c.business_name AS customer_name,
               pc.business_name AS parent_customer_name,
               COALESCE((
                 SELECT SUM(p.quantity) FROM PALLETS p 
                 WHERE p.product_id = pr.id AND p.status != 'SHIPPED'
                   AND (p.inbound_ddt_id IS NULL OR NOT EXISTS (SELECT 1 FROM INBOUND_DDTS d WHERE d.id = p.inbound_ddt_id AND d.status != 'COMPLETED'))
               ), 0) AS active_stock_qty,
               (
                 SELECT COUNT(*) FROM PALLETS p 
                 WHERE p.product_id = pr.id AND p.status != 'SHIPPED' AND p.quantity > 0
                   AND (p.inbound_ddt_id IS NULL OR NOT EXISTS (SELECT 1 FROM INBOUND_DDTS d WHERE d.id = p.inbound_ddt_id AND d.status != 'COMPLETED'))
               ) AS active_pallets_count,
               (SELECT COUNT(*) FROM PALLETS p WHERE p.product_id = pr.id) AS total_pallets_ever,
               (SELECT COUNT(*) FROM INBOUND_DDT_ITEMS idi WHERE idi.product_id = pr.id) AS total_inbound_ddts,
               (SELECT COUNT(*) FROM OUTBOUND_ITEMS oi WHERE oi.product_id = pr.id) AS total_outbound_picks,
               (SELECT MAX(p.created_at) FROM PALLETS p WHERE p.product_id = pr.id) AS last_inbound_at
        FROM PRODUCTS pr
        JOIN CUSTOMERS c ON pr.customer_id = c.id
        LEFT JOIN CUSTOMERS pc ON c.parent_id = pc.id
        ORDER BY pr.name ASC
      `);
      return rows;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore recupero lista prodotti per tracciabilità' });
    }
  });

  // 3. GET /api/audit/product/:productId/history - Storico Completo a 360° di un Prodotto
  fastify.get('/product/:productId/history', async (request, reply) => {
    const { productId } = request.params;
    try {
      const [[product]] = await db.query(`
        SELECT pr.*, c.business_name AS customer_name, c.unique_id AS customer_code,
               pc.business_name AS parent_customer_name
        FROM PRODUCTS pr
        JOIN CUSTOMERS c ON pr.customer_id = c.id
        LEFT JOIN CUSTOMERS pc ON c.parent_id = pc.id
        WHERE pr.id = ?
      `, [productId]);

      if (!product) {
        return reply.code(404).send({ error: 'Prodotto non trovato' });
      }

      // 1. Tutte le palette (attive e spedite) di questo prodotto
      const [pallets] = await db.query(`
        SELECT p.*, d.ddt_number AS inbound_ddt_number, d.status AS inbound_ddt_status
        FROM PALLETS p
        LEFT JOIN INBOUND_DDTS d ON p.inbound_ddt_id = d.id
        WHERE p.product_id = ?
        ORDER BY p.created_at DESC
      `, [productId]);

      // 2. Tutte le righe DDT Inbound di questo prodotto
      const [inboundItems] = await db.query(`
        SELECT i.*, d.ddt_number, d.status AS ddt_status, d.created_at AS ddt_created_at,
               d.closed_at AS ddt_closed_at, d.discrepancy_accepted, d.discrepancy_reason,
               d.discrepancy_resolved_by, d.discrepancy_resolved_at
        FROM INBOUND_DDT_ITEMS i
        JOIN INBOUND_DDTS d ON i.inbound_ddt_id = d.id
        WHERE i.product_id = ?
        ORDER BY d.created_at DESC
      `, [productId]);

      // 3. Tutti i prelievi e spedizioni Outbound di questo prodotto
      const [outboundItems] = await db.query(`
        SELECT oi.*, o.order_code, o.client_ddt, o.exit_date, o.status AS order_status,
               o.picking_operator, o.start_picking_at, o.end_picking_at, o.shipped_at, o.shipped_by,
               o.created_by, o.created_at AS order_created_at,
               p.client_pallet_number, p.location AS pallet_current_location
        FROM OUTBOUND_ITEMS oi
        JOIN OUTBOUND_ORDERS o ON oi.order_id = o.id
        LEFT JOIN PALLETS p ON oi.pallet_id = p.id
        WHERE oi.product_id = ?
        ORDER BY COALESCE(oi.picked_at, o.shipped_at, o.created_at) DESC
      `, [productId]);

      // 4. Tutti gli Audit Logs correlati al prodotto o ai suoi codici paletta
      const palletCodes = [...new Set(pallets.map(p => p.pallet_code).filter(Boolean))];
      let relatedAuditLogs = [];
      const auditConds = ['details LIKE ?', 'details LIKE ?'];
      const auditParams = [`%${product.name}%`, `%${product.sku}%`];

      for (const code of palletCodes.slice(0, 80)) {
        auditConds.push('details LIKE ?');
        auditParams.push(`%${code}%`);
      }

      const [logsRows] = await db.query(
        `SELECT * FROM AUDIT_LOGS WHERE (${auditConds.join(' OR ')}) ORDER BY created_at DESC LIMIT 300`,
        auditParams
      );
      relatedAuditLogs = logsRows;

      // Costruisci la Timeline Cronologica Unificata a 360°
      const timeline = [];

      // Eventi dalle Palette
      for (const p of pallets) {
        timeline.push({
          id: `pal-in-${p.id}`,
          timestamp: p.created_at,
          type: 'INBOUND_PALLET',
          badge: 'INGRESSO PALETTA',
          color: 'emerald',
          title: `Creato Bancale ${p.pallet_code}${p.client_pallet_number ? ` (Rif. Cl: ${p.client_pallet_number})` : ''}`,
          description: `Quantità attuale: ${p.quantity} ${p.pallet_uom || product.uom} • Lotto: ${p.batch || 'N/D'} • Posizione: ${p.location || 'IN ATTESA'} (${p.warehouse || 'Settala'})${p.inbound_ddt_number ? ` • Da DDT ${p.inbound_ddt_number}` : ''}`,
          meta: {
            pallet_code: p.pallet_code,
            client_pallet_number: p.client_pallet_number,
            batch: p.batch,
            location: p.location,
            quantity: p.quantity,
            uom: p.pallet_uom || product.uom,
            expiration_date: p.expiration_date,
            status: p.status
          }
        });

        if (p.shipped_at || p.status === 'SHIPPED') {
          timeline.push({
            id: `pal-out-${p.id}`,
            timestamp: p.shipped_at || p.created_at,
            type: 'PALLET_SHIPPED',
            badge: 'BANCALE ESAURITO / SPEDITO',
            color: 'sky',
            title: `Bancale ${p.pallet_code} uscito dal magazzino`,
            description: `Lotto: ${p.batch || 'N/D'}${p.client_pallet_number ? ` • Rif. Pal. Cl: ${p.client_pallet_number}` : ''}`,
            meta: {
              pallet_code: p.pallet_code,
              batch: p.batch
            }
          });
        }
      }

      // Eventi dai DDT Inbound e Discrepanze
      for (const idi of inboundItems) {
        const exp = parseFloat(idi.expected_quantity) || 0;
        const act = parseFloat(idi.actual_quantity) || 0;
        const diff = act - exp;
        timeline.push({
          id: `ddt-item-${idi.id}`,
          timestamp: idi.ddt_closed_at || idi.ddt_created_at,
          type: diff !== 0 && idi.ddt_status !== 'PENDING' ? 'DDT_DISCREPANCY' : 'DDT_SPUNTA',
          badge: diff !== 0 && idi.ddt_status !== 'PENDING' ? 'DISCREPANZA SPUNTA DDT' : 'SPUNTA DDT ENTRATA',
          color: diff !== 0 && idi.ddt_status !== 'PENDING' ? 'amber' : 'blue',
          title: `DDT ${idi.ddt_number} — Atteso: ${exp} ${idi.product_uom || product.uom} / Spuntato: ${act} ${idi.product_uom || product.uom}`,
          description: `Lotto: ${idi.batch || 'N/D'} • Stato DDT: ${idi.ddt_status}${idi.discrepancy_accepted ? ` • Discrepanza accettata da ${idi.discrepancy_resolved_by}: "${idi.discrepancy_reason}"` : ''}`,
          meta: {
            ddt_number: idi.ddt_number,
            expected_quantity: exp,
            actual_quantity: act,
            diff,
            batch: idi.batch,
            discrepancy_reason: idi.discrepancy_reason,
            discrepancy_resolved_by: idi.discrepancy_resolved_by
          }
        });
      }

      // Eventi da Outbound Picking & Spedizioni
      for (const oi of outboundItems) {
        const eventTime = oi.picked_at || oi.shipped_at || oi.order_created_at;
        timeline.push({
          id: `out-item-${oi.id}`,
          timestamp: eventTime,
          type: 'OUTBOUND_PICK',
          badge: oi.order_status === 'SHIPPED' ? 'USCITA CONFERMATA' : oi.status === 'PICKED' ? 'PRELEVATO (ZEBRA)' : 'ALLOCATO IN USCITA',
          color: oi.order_status === 'SHIPPED' ? 'purple' : 'amber',
          title: `Ordine ${oi.order_code}${oi.client_ddt ? ` (DDT Cl: ${oi.client_ddt})` : ''} — Paletta ${oi.pallet_code}`,
          description: `Richiesto: ${oi.quantity_required} ${oi.requested_uom || product.uom} • Prelevato: ${oi.quantity_picked} • Lotto: ${oi.batch || 'N/D'}${oi.picking_operator ? ` • Operatore Zebra: ${oi.picking_operator}` : ''}${oi.shipped_by ? ` • Confermato da: ${oi.shipped_by}` : ''}`,
          meta: {
            order_code: oi.order_code,
            pallet_code: oi.pallet_code,
            batch: oi.batch,
            quantity_required: oi.quantity_required,
            quantity_picked: oi.quantity_picked,
            picking_operator: oi.picking_operator,
            shipped_by: oi.shipped_by,
            order_status: oi.order_status
          }
        });
      }

      // Eventi da Audit Logs (Stivaggio, Handling, Rettifiche, ecc.)
      for (const lg of relatedAuditLogs) {
        timeline.push({
          id: `log-${lg.id}`,
          timestamp: lg.created_at,
          type: 'AUDIT_LOG',
          badge: lg.action,
          color: 'slate',
          title: `${lg.action} (${lg.source}) — Operatore: ${lg.username}`,
          description: lg.details,
          meta: {
            username: lg.username,
            source: lg.source,
            action: lg.action
          }
        });
      }

      timeline.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      // Calcolo KPI riepilogativi del prodotto
      let currentStockQty = 0;
      let loadingZoneQty = 0;
      let activePalletsCount = 0;
      let shippedPalletsCount = 0;
      const batchesSet = new Set();

      for (const p of pallets) {
        if (p.batch) batchesSet.add(p.batch);
        const q = parseFloat(p.quantity) || 0;
        const isDdtPending = p.inbound_ddt_id && p.inbound_ddt_status && p.inbound_ddt_status !== 'COMPLETED';
        if (p.status === 'SHIPPED') {
          shippedPalletsCount += 1;
        } else if (!isDdtPending) {
          currentStockQty += q;
          if (q > 0) activePalletsCount += 1;
          if (String(p.location || '').startsWith('ZONA CARICO')) {
            loadingZoneQty += q;
          }
        }
      }

      const totalPickedQty = outboundItems.reduce((s, oi) => s + (parseFloat(oi.quantity_picked) || 0), 0);

      return {
        product: {
          ...product,
          kpis: {
            currentStockQty,
            loadingZoneQty,
            totalPickedQty,
            activePalletsCount,
            shippedPalletsCount,
            totalPalletsEver: pallets.length,
            uniqueBatchesCount: batchesSet.size,
            batches: Array.from(batchesSet)
          }
        },
        pallets,
        inboundItems,
        outboundItems,
        timeline
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore recupero storico completo prodotto' });
    }
  });
}

module.exports = auditRoutes;
