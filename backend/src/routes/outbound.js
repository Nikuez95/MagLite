const { hasPermission, canAccessCustomer } = require('../utils/permissions');
const db = require('../config/db');
const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');

async function getRoutingSettings(connection) {
  const [rows] = await connection.query('SELECT setting_key, setting_value FROM settings WHERE setting_key IN ("zone_routing_priority", "position_routing_priority")');
  let zonePriority = [];
  let posPriority = ['01,02,03', '11,12,13', '21,22,23'];
  rows.forEach(r => {
    try {
      if (r.setting_key === 'zone_routing_priority' && r.setting_value) {
        const parsed = JSON.parse(r.setting_value);
        if (Array.isArray(parsed)) zonePriority = parsed;
      }
      if (r.setting_key === 'position_routing_priority' && r.setting_value) {
        const parsed = JSON.parse(r.setting_value);
        if (Array.isArray(parsed) && parsed.length > 0) posPriority = parsed;
      }
    } catch (e) {
      // ignore malformed JSON
    }
  });
  return { zonePriority, posPriority };
}

function extractLocationCoords(item) {
  let zone = (item.zone && item.zone !== 'null') ? String(item.zone).trim().toUpperCase() : '';
  let col = (item.col && item.col !== 'null') ? String(item.col).trim().toUpperCase() : '';
  let pos = (item.pos && item.pos !== 'null') ? String(item.pos).trim().toUpperCase() : '';
  const rawLoc = (item.location && item.location !== 'null') ? String(item.location).trim().toUpperCase() : '';

  if (!zone && rawLoc) {
    const parts = rawLoc.split('-').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 3) {
      zone = parts[0];
      col = parts[1];
      pos = parts.slice(2).join('-');
    } else {
      zone = rawLoc;
    }
  }
  return { zone, col, pos, rawLoc };
}

function getZoneSortRank(zone, zonePriority) {
  if (!zone) return 9999;
  const normZone = zone.trim().toUpperCase();
  const normPriority = (zonePriority || []).map(z => String(z).trim().toUpperCase());
  const idx = normPriority.indexOf(normZone);
  return idx >= 0 ? idx : 999;
}

function getPosSortRank(pos, posPriority) {
  if (!pos) return { groupIdx: 999, subIdx: 999 };
  const normPos = String(pos).trim().toUpperCase();
  const patterns = Array.isArray(posPriority) ? posPriority : [];

  // 1. Ricerca esatta nel pattern configurato (es. "01,02,03")
  for (let i = 0; i < patterns.length; i++) {
    const tokens = String(patterns[i]).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const subIdx = tokens.indexOf(normPos);
    if (subIdx >= 0) {
      return { groupIdx: i, subIdx };
    }
  }

  // 2. Fallback intelligente per stesso piano (es. pos "04" quando il gruppo 0 ha "01,02,03" -> piano "0")
  if (normPos.length >= 2 && /^\d+$/.test(normPos)) {
    const floorPrefix = normPos[0];
    for (let i = 0; i < patterns.length; i++) {
      const tokens = String(patterns[i]).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      if (tokens.length > 0 && tokens.every(t => t.length >= 2 && t[0] === floorPrefix)) {
        return { groupIdx: i, subIdx: 100 + parseInt(normPos, 10) };
      }
    }
  }

  return { groupIdx: 999, subIdx: 999 };
}

// Confronto puro per percorso fisico in magazzino (Regole di Prelievo senza avanti-e-indietro)
function compareByWarehousePath(a, b, zonePriority, posPriority) {
  const coordsA = extractLocationCoords(a);
  const coordsB = extractLocationCoords(b);

  // 1. Priorità Zona (ordine impostato in Regole di Prelievo)
  const zA = getZoneSortRank(coordsA.zone, zonePriority);
  const zB = getZoneSortRank(coordsB.zone, zonePriority);
  if (zA !== zB) return zA - zB;

  // Se entrambe le zone non sono nella lista priorità, raggruppa per nome zona
  if (coordsA.zone !== coordsB.zone) {
    return coordsA.zone.localeCompare(coordsB.zone, undefined, { numeric: true, sensitivity: 'base' });
  }

  // 2. Stessa Zona -> Ordina per Corsia / Scaffale (col: A, B, C... o 01, 02...) per non fare avanti e indietro tra scaffali
  if (coordsA.col !== coordsB.col) {
    if (!coordsA.col) return 1;
    if (!coordsB.col) return -1;
    return coordsA.col.localeCompare(coordsB.col, undefined, { numeric: true, sensitivity: 'base' });
  }

  // 3. Stesso Scaffale -> Priorità Piano / Posizione (es. prima piano terra 01,02,03 in ordine, poi 11,12,13...)
  const pA = getPosSortRank(coordsA.pos, posPriority);
  const pB = getPosSortRank(coordsB.pos, posPriority);
  if (pA.groupIdx !== pB.groupIdx) return pA.groupIdx - pB.groupIdx;
  if (pA.subIdx !== pB.subIdx) return pA.subIdx - pB.subIdx;

  if (coordsA.pos !== coordsB.pos) {
    return coordsA.pos.localeCompare(coordsB.pos, undefined, { numeric: true, sensitivity: 'base' });
  }

  // 4. Stessa Posizione -> tieni vicine le stesse locazioni e stesse palette
  if (coordsA.rawLoc !== coordsB.rawLoc) {
    return coordsA.rawLoc.localeCompare(coordsB.rawLoc, undefined, { numeric: true, sensitivity: 'base' });
  }

  const palA = String(a.pallet_code || '');
  const palB = String(b.pallet_code || '');
  if (palA !== palB) {
    return palA.localeCompare(palB, undefined, { numeric: true, sensitivity: 'base' });
  }

  return (a.id || 0) - (b.id || 0);
}

// Ordinamento per allocazione merce (stesso prodotto: FEFO scadenza -> PIANO PIÙ BASSO -> Percorso magazzino)
function getFloorLevel(pos, posPriority) {
  if (!pos) return 999;
  const normPos = String(pos).trim().toUpperCase();
  const patterns = Array.isArray(posPriority) ? posPriority : [];

  for (let i = 0; i < patterns.length; i++) {
    const tokens = String(patterns[i]).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (tokens.includes(normPos)) {
      return i;
    }
  }

  const digits = normPos.replace(/\D/g, '');
  if (digits.length > 0) {
    const num = parseInt(digits, 10);
    if (!isNaN(num)) {
      return Math.floor(num / 10);
    }
  }

  return 999;
}

function sortPalletsByRouting(pallets, zonePriority, posPriority) {
  return pallets.sort((a, b) => {
    // 1. FEFO (Data scadenza più vicina)
    const expA = a.expiration_date ? new Date(a.expiration_date).getTime() : 9999999999999;
    const expB = b.expiration_date ? new Date(b.expiration_date).getTime() : 9999999999999;
    if (expA !== expB) return expA - expB;

    // 2. LIVELLO PIANO: Sempre priorità al piano più basso (piano terra 01,02,03 prima di 11,21,31...)
    // Se un pallet è in Area1-G-23 e un altro in Area1-L-01 o Area3-B-03, invia sempre in quello più in basso
    const coordsA = extractLocationCoords(a);
    const coordsB = extractLocationCoords(b);
    const floorA = getFloorLevel(coordsA.pos, posPriority);
    const floorB = getFloorLevel(coordsB.pos, posPriority);
    if (floorA !== floorB) {
      return floorA - floorB;
    }

    // 3. A parità di piano, rispetta il percorso di magazzino (Zona -> Corsia -> Posizione)
    return compareByWarehousePath(a, b, zonePriority, posPriority);
  });
}

// Ordinamento percorso di prelievo per Zebra e Picking List PDF (rispetta Regole di Prelievo senza avanti e indietro)
function sortPickingTour(items, zonePriority, posPriority) {
  return items.sort((a, b) => compareByWarehousePath(a, b, zonePriority, posPriority));
}

async function allocateOutboundItems(items, connection, excludeOrderId = null) {
  const allocatedPallets = [];
  const { zonePriority, posPriority } = await getRoutingSettings(connection);
  const inMemoryUsedByPalletId = new Map();

  let excludeCondition = '';
  if (excludeOrderId) {
    excludeCondition = `AND oo.id != ${connection.escape(excludeOrderId)}`;
  }

  // Alloca prima le righe che richiedono un bancale specifico (per ID, Rif. Paletta Cliente o Codice Paletta)
  // così la selezione automatica FEFO di eventuali altre righe dello stesso lotto non sottrae il bancale scelto.
  const prioritizedItems = [...items].sort((a, b) => {
    const aSpecific = Boolean(a.pallet_id || a.client_pallet_number || a.pallet_code);
    const bSpecific = Boolean(b.pallet_id || b.client_pallet_number || b.pallet_code);
    if (aSpecific === bSpecific) return 0;
    return aSpecific ? -1 : 1;
  });

  for (const req of prioritizedItems) {
    const normalizedUom = req.requested_uom === 'Palette' ? 'Bancali' : (req.requested_uom || 'Pezzi');

    let query = `
      SELECT pal.*, loc.zone, loc.col, loc.pos,
             COALESCE(pal.units_per_box, p.units_per_box, 1) as effective_units_per_box,
             COALESCE(p.boxes_per_pallet, 1) as effective_boxes_per_pallet,
             (pal.quantity - COALESCE((
               SELECT SUM(
                 CASE 
                   WHEN oi.requested_uom IN ('Bancali', 'Palette') THEN 
                     CASE WHEN COALESCE(p.boxes_per_pallet, 1) > 1 AND pal.quantity >= 2 * (COALESCE(pal.units_per_box, p.units_per_box, 1) * p.boxes_per_pallet)
                          THEN (oi.quantity_required * COALESCE(pal.units_per_box, p.units_per_box, 1) * p.boxes_per_pallet)
                          ELSE pal.quantity 
                     END
                   WHEN oi.requested_uom IN ('Scatole', 'Cartoni') THEN (oi.quantity_required * COALESCE(pal.units_per_box, p.units_per_box, 1))
                   ELSE oi.quantity_required 
                 END
               )
               FROM OUTBOUND_ITEMS oi
               JOIN OUTBOUND_ORDERS oo ON oi.order_id = oo.id
               WHERE (
                 (oi.pallet_id IS NOT NULL AND oi.pallet_id = pal.id)
                 OR (oi.pallet_id IS NULL AND oi.pallet_code = pal.pallet_code AND oi.product_id = pal.product_id AND (oi.batch IS NULL OR oi.batch = pal.batch))
               )
               AND oo.status != 'SHIPPED'
               ${excludeCondition}
             ), 0)) as available_quantity
      FROM PALLETS pal 
      JOIN PRODUCTS p ON pal.product_id = p.id 
      LEFT JOIN LOCATIONS loc ON pal.location = loc.barcode 
      WHERE pal.product_id = ? AND pal.status != 'SHIPPED' AND pal.quantity > 0 AND (pal.is_quarantined IS NULL OR pal.is_quarantined = FALSE)
    `;
    const params = [req.product_id];

    if (req.pallet_id) {
      query += ` AND pal.id = ?`;
      params.push(req.pallet_id);
    } else {
      if (req.client_pallet_number && String(req.client_pallet_number).trim() !== '') {
        query += ` AND TRIM(pal.client_pallet_number) = TRIM(?)`;
        params.push(String(req.client_pallet_number).trim());
      }
      if (req.pallet_code && String(req.pallet_code).trim() !== '') {
        query += ` AND pal.pallet_code = ?`;
        params.push(String(req.pallet_code).trim());
      }
      if (req.batch && req.batch !== 'TUTTI' && req.batch !== 'Nessun lotto') {
        query += ` AND TRIM(pal.batch) = TRIM(?)`;
        params.push(req.batch);
      } else if (req.batch === 'Nessun lotto') {
        query += ` AND (pal.batch IS NULL OR TRIM(pal.batch) = '')`;
      }
    }
    
    const [rawAvailable] = await connection.query(query, params);
    const available = rawAvailable.filter(pal => {
      const alreadyUsedBase = inMemoryUsedByPalletId.get(pal.id) || 0;
      return (parseFloat(pal.available_quantity) - alreadyUsedBase) > 0;
    });
    sortPalletsByRouting(available, zonePriority, posPriority);

    let remainingToAllocate = parseFloat(req.quantity_required);
    const allocatedForThisReq = [];

    for (const pal of available) {
      if (remainingToAllocate <= 0) break;

      const alreadyUsedBase = inMemoryUsedByPalletId.get(pal.id) || 0;
      const availBaseQty = Math.max(0, parseFloat(pal.available_quantity) - alreadyUsedBase);
      if (availBaseQty <= 0) continue;

      const upb = parseFloat(pal.effective_units_per_box) || 1;
      const bpp = parseFloat(pal.effective_boxes_per_pallet) || 1;
      const unitsPerPallet = upb * bpp;

      let palletQtyInRequestedUom = availBaseQty;
      if (normalizedUom === 'Scatole' || normalizedUom === 'Cartoni') {
        palletQtyInRequestedUom = availBaseQty / upb;
      } else if (normalizedUom === 'Bancali') {
        // Se la riga paletta rappresenta più bancali accorpati (es. carico multi-paletta su stessa posizione)
        // e non ci sono abbastanza righe distinte per coprire la richiesta, calcola i bancali contenuti nella riga
        if (available.length < remainingToAllocate && unitsPerPallet > 1 && availBaseQty >= unitsPerPallet * 2) {
          palletQtyInRequestedUom = Math.max(1, Math.floor(availBaseQty / unitsPerPallet));
        } else {
          palletQtyInRequestedUom = 1;
        }
      }

      if (palletQtyInRequestedUom <= 0) continue;

      const take = Math.min(remainingToAllocate, palletQtyInRequestedUom);
      
      allocatedForThisReq.push({
        pallet_id: pal.id,
        pallet_code: pal.pallet_code,
        client_pallet_number: pal.client_pallet_number || null,
        product_id: req.product_id,
        batch: pal.batch || null,
        quantity_required: take,
        requested_uom: normalizedUom,
        location: pal.location || null,
        zone: pal.zone || null,
        col: pal.col || null,
        pos: pal.pos || null
      });

      let usedBaseForTake = take;
      if (normalizedUom === 'Scatole' || normalizedUom === 'Cartoni') {
        usedBaseForTake = take * upb;
      } else if (normalizedUom === 'Bancali') {
        usedBaseForTake = (palletQtyInRequestedUom > 1 && unitsPerPallet > 1) ? (take * unitsPerPallet) : availBaseQty;
      }
      inMemoryUsedByPalletId.set(pal.id, alreadyUsedBase + usedBaseForTake);
      
      remainingToAllocate -= take;
    }

    if (remainingToAllocate > 0) {
      const clientPalLabel = req.client_pallet_number ? ` (Rif. Paletta Cliente: ${req.client_pallet_number})` : '';
      const batchLabel = (req.batch && req.batch !== 'TUTTI') ? ` (Lotto: ${req.batch})` : '';
      throw new Error(`Quantità insufficiente in magazzino per l'articolo richiesto${clientPalLabel}${batchLabel}`);
    }
    
    allocatedPallets.push(...allocatedForThisReq);
  }
  sortPickingTour(allocatedPallets, zonePriority, posPriority);
  return allocatedPallets;
}

async function outboundRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  // GET /api/outbound - List all orders
  fastify.get('/', async (request, reply) => {
    try {
      const [orders] = await db.query(`
        SELECT o.*, c.business_name as customer_name,
               (SELECT COUNT(*) FROM OUTBOUND_ITEMS oi WHERE oi.order_id = o.id) as total_items,
               (SELECT COUNT(*) FROM OUTBOUND_ITEMS oi WHERE oi.order_id = o.id AND oi.status = 'PICKED') as picked_items,
               (SELECT GROUP_CONCAT(DISTINCT COALESCE(oi.batch, pal.batch) SEPARATOR ', ')
                FROM OUTBOUND_ITEMS oi
                LEFT JOIN PALLETS pal ON pal.id = oi.pallet_id
                WHERE oi.order_id = o.id) as batches,
               (SELECT GROUP_CONCAT(DISTINCT p.name SEPARATOR ', ')
                FROM OUTBOUND_ITEMS oi
                JOIN PRODUCTS p ON p.id = oi.product_id
                WHERE oi.order_id = o.id) as products,
               (SELECT GROUP_CONCAT(DISTINCT oi.pallet_code SEPARATOR ', ')
                FROM OUTBOUND_ITEMS oi
                WHERE oi.order_id = o.id) as pallets,
               (SELECT GROUP_CONCAT(DISTINCT pal.client_pallet_number SEPARATOR ', ')
                FROM OUTBOUND_ITEMS oi
                LEFT JOIN PALLETS pal ON pal.id = oi.pallet_id
                WHERE oi.order_id = o.id AND pal.client_pallet_number IS NOT NULL AND pal.client_pallet_number != '') as client_pallets
        FROM OUTBOUND_ORDERS o
        JOIN CUSTOMERS c ON o.customer_id = c.id
        ORDER BY o.created_at DESC
      `);
      return orders.filter(o => canAccessCustomer(request.user, o.customer_id));
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore nel recupero degli ordini' });
    }
  });

  // POST /api/outbound - Create new order
  fastify.post('/', async (request, reply) => {
    const { customer_id, exit_date, items, client_ddt, notes } = request.body;
    if (!hasPermission(request.user, 'outbound_create')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di creare spedizioni.' });
    }
    if (customer_id && !canAccessCustomer(request.user, customer_id)) {
      return reply.code(403).send({ error: 'Accesso negato: non puoi creare spedizioni per questo cliente.' });
    }
    const connection = await db.getConnection();
    
    try {
      await connection.beginTransaction();
      
      const orderCode = `OUT-${new Date().toISOString().slice(2,10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
      
      const username = request.user?.username || 'SYSTEM';
      const cleanNotes = notes && String(notes).trim() !== '' ? String(notes).trim() : null;
      
      const [orderRes] = await connection.query(
        'INSERT INTO OUTBOUND_ORDERS (order_code, customer_id, exit_date, created_by, client_ddt, notes) VALUES (?, ?, ?, ?, ?, ?)',
        [orderCode, customer_id ?? null, exit_date ?? null, username, client_ddt ?? null, cleanNotes]
      );
      const orderId = orderRes.insertId;

      const allocatedItemsPOST = await allocateOutboundItems(items, connection);
      for (const item of allocatedItemsPOST) {
        await connection.query(
          'INSERT INTO OUTBOUND_ITEMS (order_id, pallet_id, pallet_code, product_id, batch, quantity_required, requested_uom) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [orderId, item.pallet_id ?? null, item.pallet_code ?? null, item.product_id ?? null, item.batch ?? null, item.quantity_required ?? null, item.requested_uom ?? null]
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
      return { success: true, id: orderId, order_id: orderId, order_code: orderCode };
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
    const { customer_id, exit_date, items, client_ddt, notes } = request.body;
    
    if (!hasPermission(request.user, 'outbound_create')) {
      return reply.code(403).send({ error: 'Non autorizzato a modificare le spedizioni' });
    }
    if (customer_id && !canAccessCustomer(request.user, customer_id)) {
      return reply.code(403).send({ error: 'Accesso negato: non puoi operare sulle spedizioni di questo cliente.' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      
      const [orders] = await connection.query('SELECT status, order_code FROM OUTBOUND_ORDERS WHERE id = ?', [id]);
      if (orders.length === 0) throw new Error('Ordine non trovato');
      if (orders[0].status === 'SHIPPED') throw new Error('Impossibile modificare un ordine già spedito. Registra prima il reso per poterlo modificare.');

      const cleanNotes = notes && String(notes).trim() !== '' ? String(notes).trim() : null;

      await connection.query(
        'UPDATE OUTBOUND_ORDERS SET customer_id = ?, exit_date = ?, client_ddt = ?, notes = ?, status = "PENDING" WHERE id = ?',
        [customer_id ?? null, exit_date ?? null, client_ddt ?? null, cleanNotes, id]
      );

      await connection.query('DELETE FROM OUTBOUND_ITEMS WHERE order_id = ?', [id]);

      const allocatedItemsPUT = await allocateOutboundItems(items, connection, id);
      for (const item of allocatedItemsPUT) {
        await connection.query(
          'INSERT INTO OUTBOUND_ITEMS (order_id, pallet_id, pallet_code, product_id, batch, quantity_required, requested_uom) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [id, item.pallet_id ?? null, item.pallet_code ?? null, item.product_id ?? null, item.batch ?? null, item.quantity_required ?? null, item.requested_uom ?? null]
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
        SELECT i.*, p.name as product_name, p.uom as base_uom, COALESCE(i.batch, pal.batch) as batch, pal.location, pal.client_pallet_number
        FROM OUTBOUND_ITEMS i
        JOIN PRODUCTS p ON i.product_id = p.id
        LEFT JOIN PALLETS pal ON pal.id = COALESCE(
          i.pallet_id,
          (SELECT p2.id FROM PALLETS p2 
           WHERE p2.pallet_code = i.pallet_code 
             AND p2.product_id = i.product_id 
             AND (i.batch IS NULL OR p2.batch = i.batch)
           ORDER BY p2.id ASC LIMIT 1)
        )
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
    
    if (!hasPermission(request.user, 'outbound_delete')) {
      return reply.code(403).send({ error: 'Non hai il permesso di eliminare le spedizioni' });
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
        SELECT i.*, p.name as product_name, COALESCE(i.requested_uom, p.uom) as uom, COALESCE(pal.units_per_box, p.units_per_box, 1) as units_per_box, pal.location, pal.client_pallet_number, COALESCE(i.batch, pal.batch) as batch, pal.expiration_date, loc.zone, loc.col, loc.pos, loc.pin
        FROM OUTBOUND_ITEMS i
        JOIN PRODUCTS p ON i.product_id = p.id
        LEFT JOIN PALLETS pal ON pal.id = COALESCE(
          i.pallet_id,
          (SELECT p2.id FROM PALLETS p2 
           WHERE p2.pallet_code = i.pallet_code 
             AND p2.product_id = i.product_id 
             AND (i.batch IS NULL OR p2.batch = i.batch)
           ORDER BY p2.id ASC LIMIT 1)
        )
        LEFT JOIN LOCATIONS loc ON pal.location = loc.barcode
        WHERE i.order_id = ?
      `, [order.id]);

      const connection = await db.getConnection();
      try {
        const { zonePriority, posPriority } = await getRoutingSettings(connection);

        // Se l'ordine non è ancora spedito, assicuriamoci che ogni riga non prelevata punti al bancale più basso disponibile
        if (order.status !== 'SHIPPED') {
          for (const it of items) {
            if (it.status !== 'PICKED' && it.location) {
              const currentCoords = extractLocationCoords(it);
              const currentFloor = getFloorLevel(currentCoords.pos, posPriority);
              if (currentFloor > 0) {
                const [alternatives] = await connection.query(`
                  SELECT pal.*, loc.zone, loc.col, loc.pos, loc.pin as loc_pin,
                         (pal.quantity - COALESCE((
                           SELECT SUM(oi.quantity_required) FROM OUTBOUND_ITEMS oi
                           JOIN OUTBOUND_ORDERS oo ON oi.order_id = oo.id
                           WHERE oi.pallet_id = pal.id AND oo.status != 'SHIPPED' AND oi.id != ?
                         ), 0)) as avail_qty
                  FROM PALLETS pal
                  LEFT JOIN LOCATIONS loc ON pal.location = loc.barcode
                  WHERE pal.product_id = ?
                    AND (TRIM(pal.batch) = TRIM(?) OR (pal.batch IS NULL AND ? IS NULL))
                    AND pal.status = 'STOCKED'
                    AND (pal.is_quarantined IS NULL OR pal.is_quarantined = FALSE)
                    AND pal.id != ?
                  HAVING avail_qty >= ?
                `, [it.id, it.product_id, it.batch, it.batch, it.pallet_id, parseFloat(it.quantity_required)]);

                if (alternatives.length > 0) {
                  sortPalletsByRouting(alternatives, zonePriority, posPriority);
                  const bestAlt = alternatives[0];
                  const altCoords = extractLocationCoords(bestAlt);
                  const altFloor = getFloorLevel(altCoords.pos, posPriority);
                  if (altFloor < currentFloor) {
                    await connection.query('UPDATE OUTBOUND_ITEMS SET pallet_id = ?, pallet_code = ? WHERE id = ?', [
                      bestAlt.id, bestAlt.pallet_code, it.id
                    ]);
                    it.pallet_id = bestAlt.id;
                    it.pallet_code = bestAlt.pallet_code;
                    it.location = bestAlt.location;
                    it.zone = bestAlt.zone;
                    it.col = bestAlt.col;
                    it.pos = bestAlt.pos;
                    it.loc_pin = bestAlt.loc_pin;
                  }
                }
              }
            }
          }
        }

        sortPickingTour(items, zonePriority, posPriority);
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
      const logoPath = path.join(__dirname, '../../../frontend/public/logo_scuro.png');
      
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

      // --- NOTA LIBERA PER IL MAGAZZINIERE (SE PRESENTE) ---
      if (order.notes && String(order.notes).trim() !== '') {
        const noteText = String(order.notes).trim();
        doc.font('Helvetica').fontSize(10);
        const noteHeight = doc.heightOfString(noteText, { width: 490 });
        const boxHeight = Math.max(36, noteHeight + 22);
        const boxY = doc.y + 2;

        doc.rect(40, boxY, 515, boxHeight).fillAndStroke('#fffbeb', '#f59e0b');
        doc.fillColor('#b45309').font('Helvetica-Bold').fontSize(9).text('NOTA OPERATIVA PER IL MAGAZZINIERE:', 50, boxY + 7);
        doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(10).text(noteText, 50, boxY + 19, { width: 495 });
        doc.y = boxY + boxHeight + 10;
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
        
        const basePalletStr = (item.pallet_code || '').startsWith('NOBAR-') ? '-' : item.pallet_code;
        const displayPallet = item.client_pallet_number ? `${basePalletStr} (Rif: ${item.client_pallet_number})` : basePalletStr;
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#192935').text(displayPallet, 345, y, { width: 135 });
        
        let qtyText = `${parseFloat(item.quantity_required)} ${item.uom}`;
        if (item.units_per_box > 1 && item.uom !== 'Scatole' && item.uom !== 'Bancali' && item.uom !== 'Palette') {
           const scatole = Math.floor(item.quantity_required / item.units_per_box);
           const sfusi = item.quantity_required % item.units_per_box;
           let breakDown = [];
           if (scatole > 0) breakDown.push(`${scatole} SCAT.`);
           if (sfusi > 0) breakDown.push(`${sfusi} SFUSI`);
           if (breakDown.length > 0) qtyText = `${breakDown.join(' + ')} (${parseFloat(item.quantity_required)} pz)`;
        } else if (item.units_per_box > 1 && (item.uom === 'Scatole' || item.uom === 'Cartoni')) {
           qtyText = `${parseFloat(item.quantity_required)} SCAT. (${parseFloat(item.quantity_required) * item.units_per_box} pz)`;
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
    if (!hasPermission(request.user, 'access_zebra') || !hasPermission(request.user, 'outbound_pick')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di effettuare il Picking su Zebra.' });
    }
    const { code } = request.params;
    try {
      const [orders] = await db.query(`
        SELECT o.*, c.business_name as customer_name
        FROM OUTBOUND_ORDERS o
        LEFT JOIN CUSTOMERS c ON o.customer_id = c.id
        WHERE o.order_code = ?
      `, [code]);
      if (orders.length === 0) return reply.code(404).send({ error: 'Ordine non trovato' });
      const order = orders[0];

      if (order.status === 'SHIPPED') {
        return reply.code(400).send({ error: 'Ordine già spedito' });
      }

      const [items] = await db.query(`
        SELECT i.*, p.name as product_name, p.sku, p.uom as base_uom,
               COALESCE(pal.client_article_number, p.sku) as article_code,
               COALESCE(pal.units_per_box, p.units_per_box, 1) as units_per_box,
               COALESCE(p.boxes_per_pallet, 1) as boxes_per_pallet,
               COALESCE(i.requested_uom, pal.pallet_uom, p.uom) as uom,
               pal.location, pal.client_pallet_number, pal.quantity as pallet_quantity,
               COALESCE(i.batch, pal.batch) as batch, pal.expiration_date,
               loc.zone, loc.col, loc.pos, loc.pin as loc_pin
        FROM OUTBOUND_ITEMS i
        JOIN PRODUCTS p ON i.product_id = p.id
        LEFT JOIN PALLETS pal ON pal.id = COALESCE(
          i.pallet_id,
          (SELECT p2.id FROM PALLETS p2 
           WHERE p2.pallet_code = i.pallet_code 
             AND p2.product_id = i.product_id 
             AND (i.batch IS NULL OR p2.batch = i.batch)
           ORDER BY p2.id ASC LIMIT 1)
        )
        LEFT JOIN LOCATIONS loc ON pal.location = loc.barcode
        WHERE i.order_id = ?
      `, [order.id]);

      const connection = await db.getConnection();
      try {
        const { zonePriority, posPriority } = await getRoutingSettings(connection);
        sortPickingTour(items, zonePriority, posPriority);
      } finally {
        connection.release();
      }

      // Imposta in PICKING se era PENDING
      if (order.status === 'PENDING') {
        const operator = request.user?.username || 'ZEBRA';
        await db.query(
          'UPDATE OUTBOUND_ORDERS SET status = "PICKING", picking_operator = COALESCE(picking_operator, ?) WHERE id = ?',
          [operator, order.id]
        );
        order.status = 'PICKING';
        order.picking_operator = order.picking_operator || operator;
        if (fastify.io) {
          fastify.io.emit('outbound_updated');
          fastify.io.emit('dashboard_update');
        }
      }

      return { order, items };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore lettura ordine' });
    }
  });

  // POST /api/outbound/zebra/pick - Zebra confirms a pick step
  fastify.post('/zebra/pick', async (request, reply) => {
    if (!hasPermission(request.user, 'access_zebra') || !hasPermission(request.user, 'outbound_pick')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di effettuare il Picking su Zebra.' });
    }
    const { order_id, item_id, pin, pallet_code, qty_picked } = request.body;
    try {
      // Verifica item
      const [items] = await db.query(`
        SELECT i.*, pal.id as resolved_pallet_id, pal.location, pal.is_quarantined, pal.quarantine_reason, loc.pin as loc_pin, pr.name as product_name
        FROM OUTBOUND_ITEMS i
        LEFT JOIN PALLETS pal ON pal.id = COALESCE(
          i.pallet_id,
          (SELECT p2.id FROM PALLETS p2 
           WHERE p2.pallet_code = i.pallet_code 
             AND p2.product_id = i.product_id 
             AND (i.batch IS NULL OR p2.batch = i.batch)
             AND p2.status != 'SHIPPED'
           ORDER BY p2.id ASC LIMIT 1)
        )
        LEFT JOIN LOCATIONS loc ON pal.location = loc.barcode
        JOIN PRODUCTS pr ON i.product_id = pr.id
        WHERE i.id = ? AND i.order_id = ?
      `, [item_id, order_id]);

      if (items.length === 0) return reply.code(404).send({ error: 'Riga ordine non trovata' });
      const item = items[0];
      if (item.is_quarantined) {
        return reply.code(403).send({ error: `BLOCCO QUARANTENA: La paletta ${item.pallet_code} è in quarantena (${item.quarantine_reason || 'Bloccata'}) e non può essere prelevata!` });
      }

      // Verifica Barcode Paletta con controllo giacenza e prenotazioni
      let actualPalletId = item.resolved_pallet_id;
      if (item.pallet_code.toLowerCase() !== pallet_code.toLowerCase()) {
        const [scannedPallets] = await db.query(
          'SELECT id, pallet_code, product_id, batch, status, location, quantity, is_quarantined, quarantine_reason FROM PALLETS WHERE pallet_code = ? AND status != "SHIPPED"',
          [pallet_code.trim()]
        );

        if (scannedPallets.length === 0) {
          return reply.code(404).send({ error: 'Paletta non trovata o già spedita.' });
        }

        const altPallet = scannedPallets[0];

        if (altPallet.is_quarantined) {
          return reply.code(403).send({ error: `BLOCCO QUARANTENA: La paletta ${altPallet.pallet_code} è in quarantena (${altPallet.quarantine_reason || 'Bloccata'}) e non può essere prelevata!` });
        }

        const isSameBatch = ((altPallet.batch || '').trim().toUpperCase() === (item.batch || '').trim().toUpperCase()) || (!altPallet.batch && !item.batch);
        if (altPallet.product_id !== item.product_id || !isSameBatch) {
          return reply.code(400).send({ error: 'Codice Paletta errato: Articolo o Lotto non corrispondente alla riga ordine.' });
        }

        // Verifica disponibilità giacenza sufficiente sulla paletta alternativa
        const availableQty = parseFloat(altPallet.quantity) || 0;
        const requiredQty = parseFloat(qty_picked) || 0;
        if (availableQty < requiredQty) {
          return reply.code(400).send({ error: `Giacenza insufficiente sulla paletta scansionata (${availableQty} disponibili contro ${requiredQty} richiesti).` });
        }

        // Verifica che la paletta non sia già prenotata da un altro ordine Outbound aperto
        const [reserved] = await db.query(
          `SELECT oi.id, oi.order_id, o.order_code
           FROM OUTBOUND_ITEMS oi
           JOIN OUTBOUND_ORDERS o ON oi.order_id = o.id
           WHERE (oi.pallet_id = ? OR (oi.pallet_code = ? AND oi.product_id = ?))
             AND oi.id != ?
             AND o.status NOT IN ('SHIPPED', 'CANCELLED', 'RETURNED')
             AND oi.status IN ('PENDING', 'PICKING')`,
          [altPallet.id, altPallet.pallet_code, item.product_id, item_id]
        );

        if (reserved.length > 0) {
          return reply.code(400).send({
            error: `La paletta ${altPallet.pallet_code} è già prenotata per l'ordine ${reserved[0].order_code || ('#' + reserved[0].order_id)}.`
          });
        }

        actualPalletId = altPallet.id;
        await db.query('UPDATE OUTBOUND_ITEMS SET pallet_id = ?, pallet_code = ? WHERE id = ?', [
          actualPalletId,
          altPallet.pallet_code,
          item_id
        ]);
        item.pallet_code = altPallet.pallet_code;
      } else {
        // Prelievo diretto dalla paletta originale assegnata: verifica giacenza fisica
        if (actualPalletId) {
          const [[origPallet]] = await db.query('SELECT quantity FROM PALLETS WHERE id = ?', [actualPalletId]);
          if (origPallet && parseFloat(origPallet.quantity) < parseFloat(qty_picked)) {
            return reply.code(400).send({
              error: `Giacenza insufficiente sulla paletta (${origPallet.quantity} disponibili contro ${qty_picked} richiesti).`
            });
          }
        }
      }

      // Aggiorna Riga Ordine
      await db.query(
        'UPDATE OUTBOUND_ITEMS SET quantity_picked = ?, pallet_id = COALESCE(pallet_id, ?), status = "PICKED", picked_at = CURRENT_TIMESTAMP WHERE id = ?',
        [qty_picked, actualPalletId || null, item_id]
      );

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

      // Verifica ordine e primo pezzo prelevato
      const [order] = await db.query('SELECT order_code, start_picking_at FROM OUTBOUND_ORDERS WHERE id = ?', [order_id]);
      const orderCode = order[0]?.order_code || `ID-${order_id}`;
      if (order.length > 0 && !order[0].start_picking_at) {
        await db.query('UPDATE OUTBOUND_ORDERS SET start_picking_at = CURRENT_TIMESTAMP, picking_operator = ? WHERE id = ?', [operator, order_id]);
      } else {
        await db.query('UPDATE OUTBOUND_ORDERS SET picking_operator = COALESCE(picking_operator, ?) WHERE id = ?', [operator, order_id]);
      }

      // Se la paletta (o la specifica riga paletta) va a 0 scorta residua a scaffale dopo il prelievo,
      // spostiamo la sua posizione in ZONA CARICO (DDT) liberando subito il posto sullo scaffale,
      // senza però scaricarla dall'inventario finché il backoffice non conferma la spedizione.
      if (item.resolved_pallet_id) {
        const [[remRow]] = await db.query(`
          SELECT pal.id, pal.pallet_code, pal.location,
                 (pal.quantity - COALESCE((
                   SELECT SUM(
                     CASE 
                       WHEN oi.requested_uom IN ('Bancali', 'Palette') THEN 
                         CASE WHEN COALESCE(p.boxes_per_pallet, 1) > 1 AND pal.quantity >= 2 * (COALESCE(pal.units_per_box, p.units_per_box, 1) * p.boxes_per_pallet)
                              THEN (COALESCE(NULLIF(oi.quantity_picked, 0), oi.quantity_required) * COALESCE(pal.units_per_box, p.units_per_box, 1) * p.boxes_per_pallet)
                              ELSE pal.quantity 
                         END
                       WHEN oi.requested_uom IN ('Scatole', 'Cartoni') THEN (COALESCE(NULLIF(oi.quantity_picked, 0), oi.quantity_required) * COALESCE(pal.units_per_box, p.units_per_box, 1))
                       ELSE COALESCE(NULLIF(oi.quantity_picked, 0), oi.quantity_required)
                     END
                   )
                   FROM OUTBOUND_ITEMS oi
                   JOIN OUTBOUND_ORDERS oo ON oi.order_id = oo.id
                   WHERE (
                     (oi.pallet_id IS NOT NULL AND oi.pallet_id = pal.id)
                     OR (oi.pallet_id IS NULL AND oi.pallet_code = pal.pallet_code AND oi.product_id = pal.product_id AND (oi.batch IS NULL OR oi.batch = pal.batch))
                   )
                   AND oi.status = 'PICKED'
                   AND oo.status != 'SHIPPED'
                 ), 0)) as remaining_on_shelf
          FROM PALLETS pal
          JOIN PRODUCTS p ON pal.product_id = p.id
          WHERE pal.id = ?
        `, [item.resolved_pallet_id]);

        if (remRow && parseFloat(remRow.remaining_on_shelf) <= 0) {
          const loadingLocation = `ZONA CARICO (${orderCode})`;
          if (remRow.location !== loadingLocation) {
            const prevLoc = remRow.location || 'NESSUNA';
            await db.query('UPDATE PALLETS SET location = ? WHERE id = ?', [loadingLocation, remRow.id]);
            await db.query(
              'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
              [
                'STOW',
                `Paletta ${remRow.pallet_code} spostata da ${prevLoc} a ${loadingLocation} (scaffale liberato in picking)`,
                'ZEBRA',
                operator
              ]
            );
            if (fastify.io) fastify.io.emit('stow_updated');
          }
        }
      }

      // Controllo se l'intero ordine è pronto
      const [all_items] = await db.query('SELECT status FROM OUTBOUND_ITEMS WHERE order_id = ?', [order_id]);
      const allPicked = all_items.every(i => i.status === 'PICKED');
      
      if (allPicked) {
        await db.query('UPDATE OUTBOUND_ORDERS SET status = "READY", end_picking_at = CURRENT_TIMESTAMP WHERE id = ?', [order_id]);
      }

      if (fastify.io) {
        fastify.io.emit('outbound_updated');
        fastify.io.emit('dashboard_update');
      }

      return { success: true, all_picked: allPicked };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore registrazione prelievo' });
    }
  });

  // POST /api/outbound/:code/confirm - Finalize order from PC
  fastify.post('/:code/confirm', async (request, reply) => {
    if (!hasPermission(request.user, 'outbound_pick') && !hasPermission(request.user, 'outbound_create')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di confermare l\'uscita della spedizione.' });
    }
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

        // Scarica la giacenza esattamente dalla riga PALLETS del lotto selezionato
        let palletsQuery = `
          SELECT pal.*, COALESCE(pal.units_per_box, p.units_per_box, 1) as effective_units_per_box, COALESCE(p.boxes_per_pallet, 1) as effective_boxes_per_pallet
          FROM PALLETS pal
          JOIN PRODUCTS p ON pal.product_id = p.id
          WHERE 
        `;
        let palletsParams = [];
        if (item.pallet_id) {
          palletsQuery += `pal.id = ?`;
          palletsParams = [item.pallet_id];
        } else if (item.batch) {
          palletsQuery += `pal.pallet_code = ? AND pal.product_id = ? AND TRIM(pal.batch) = TRIM(?) AND pal.status != 'SHIPPED' ORDER BY pal.id ASC LIMIT 1`;
          palletsParams = [item.pallet_code, item.product_id, item.batch];
        } else {
          palletsQuery += `pal.pallet_code = ? AND pal.product_id = ? AND pal.status != 'SHIPPED' ORDER BY pal.id ASC LIMIT 1`;
          palletsParams = [item.pallet_code, item.product_id];
        }

        const [pallets] = await connection.query(palletsQuery, palletsParams);
        if (pallets.length > 0) {
          const pallet = pallets[0];
          if (pallet.is_quarantined) {
            throw new Error(`BLOCCO QUARANTENA: La paletta ${pallet.pallet_code} è in quarantena (${pallet.quarantine_reason || 'Bloccata'}) e non può essere spedita. Sbloccala prima dal Registro Quarantene.`);
          }
          const upb = parseFloat(pallet.effective_units_per_box) || 1;
          const bpp = parseFloat(pallet.effective_boxes_per_pallet) || 1;
          const unitsPerPallet = upb * bpp;
          let newQty;

          if ((item.requested_uom === 'Bancali' || item.requested_uom === 'Palette') && actualPicked >= 1) {
            if (unitsPerPallet > 1 && parseFloat(pallet.quantity) > actualPicked * unitsPerPallet) {
              newQty = parseFloat(pallet.quantity) - (actualPicked * unitsPerPallet);
            } else {
              newQty = 0;
            }
          } else {
            let deduction = actualPicked;
            if (item.requested_uom === 'Scatole' || item.requested_uom === 'Cartoni') {
              deduction *= upb;
            }
            newQty = parseFloat(pallet.quantity) - deduction;
          }
          
          if (newQty <= 0) {
            newQty = 0;
            // Paletta esaurita, svuota la posizione, marca SHIPPED e registra shipped_at
            await connection.query('UPDATE PALLETS SET quantity = 0, status = "SHIPPED", location = NULL, shipped_at = CURRENT_TIMESTAMP WHERE id = ?', [pallet.id]);
          } else {
            // Paletta parziale
            await connection.query('UPDATE PALLETS SET quantity = ? WHERE id = ?', [newQty, pallet.id]);
          }

          if (!parseFloat(item.quantity_picked) || parseFloat(item.quantity_picked) <= 0) {
            await connection.query('UPDATE OUTBOUND_ITEMS SET quantity_picked = ?, status = "PICKED" WHERE id = ?', [actualPicked, item.id]);
          }

          // Audit Log
          await connection.query(
            'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
            [
              'OUTBOUND_PICK', 
              `Prelevato ${actualPicked} ${item.requested_uom || ''} da paletta ${pallet.pallet_code}${pallet.batch ? ` (Lotto: ${pallet.batch})` : ''} (rimanenza: ${newQty})`,
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
      
      if (fastify.io) {
        fastify.io.emit('stow_updated');
        fastify.io.emit('dashboard_update');
      }
      
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
        SELECT pal.*, l.zone, l.col, l.pos, p.name as product_name, p.sku as product_sku, COALESCE(pal.pallet_uom, p.uom) as uom, COALESCE(pal.units_per_box, p.units_per_box, 1) as units_per_box, COALESCE(p.boxes_per_pallet, 1) as boxes_per_pallet,
               (pal.quantity - COALESCE((
                 SELECT SUM(
                   CASE 
                     WHEN oi.requested_uom IN ('Bancali', 'Palette') THEN 
                       CASE WHEN COALESCE(p.boxes_per_pallet, 1) > 1 AND pal.quantity >= 2 * (COALESCE(pal.units_per_box, p.units_per_box, 1) * p.boxes_per_pallet)
                            THEN (oi.quantity_required * COALESCE(pal.units_per_box, p.units_per_box, 1) * p.boxes_per_pallet)
                            ELSE pal.quantity 
                       END
                     WHEN oi.requested_uom IN ('Scatole', 'Cartoni') THEN (oi.quantity_required * COALESCE(pal.units_per_box, p.units_per_box, 1))
                     ELSE oi.quantity_required 
                   END
                 )
                 FROM OUTBOUND_ITEMS oi
                 JOIN OUTBOUND_ORDERS oo ON oi.order_id = oo.id
                 WHERE (
                   (oi.pallet_id IS NOT NULL AND oi.pallet_id = pal.id)
                   OR (oi.pallet_id IS NULL AND oi.pallet_code = pal.pallet_code AND oi.product_id = pal.product_id AND (oi.batch IS NULL OR oi.batch = pal.batch))
                 )
                 AND oo.status != 'SHIPPED'
                 ${excludeCondition}
               ), 0)) as available_quantity
        FROM PALLETS pal
        JOIN PRODUCTS p ON pal.product_id = p.id
        LEFT JOIN LOCATIONS l ON pal.location = l.barcode
        WHERE pal.customer_id = ? AND pal.status ${statusCondition} AND (pal.is_quarantined IS NULL OR pal.is_quarantined = FALSE)
        HAVING available_quantity > 0
        ORDER BY pal.expiration_date ASC, pal.created_at ASC
      `, [customer_id]);
      
      const connection = await db.getConnection();
      try {
        const { zonePriority, posPriority } = await getRoutingSettings(connection);
        sortPalletsByRouting(pallets, zonePriority, posPriority);
      } finally {
        connection.release();
      }
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
          COALESCE(i.batch, pal.batch) AS batch,
          CASE WHEN i.quantity_picked > 0 THEN i.quantity_picked ELSE i.quantity_required END AS quantity_picked,
          COALESCE(i.requested_uom, pal.pallet_uom, p.uom) AS uom
        FROM OUTBOUND_ITEMS i
        JOIN OUTBOUND_ORDERS o ON i.order_id = o.id
        JOIN CUSTOMERS c ON o.customer_id = c.id
        JOIN PRODUCTS p ON i.product_id = p.id
        LEFT JOIN PALLETS pal ON pal.id = COALESCE(
          i.pallet_id,
          (SELECT p2.id FROM PALLETS p2 
           WHERE p2.pallet_code = i.pallet_code 
             AND p2.product_id = i.product_id 
             AND (i.batch IS NULL OR p2.batch = i.batch)
           ORDER BY p2.id ASC LIMIT 1)
        )
        WHERE o.status = 'SHIPPED'
        ORDER BY o.shipped_at DESC
      `);
      return rows;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore nel recupero dello storico uscite' });
    }
  });



  // POST /api/outbound/:id/return - Registra reso spedizione e rientro merce
  fastify.post('/:id/return', async (request, reply) => {
    if (!hasPermission(request.user, 'outbound_return')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di registrare resi di merce spedita.' });
    }
    const { id } = request.params;
    const { reason, notes } = request.body || {};

    if (!reason || !String(reason).trim()) {
      return reply.code(400).send({ error: 'È obbligatorio specificare un motivo per il reso' });
    }

    const cleanReason = String(reason).trim();
    const cleanNotes = notes && String(notes).trim() !== '' ? String(notes).trim() : null;
    const operator = request.user?.username || 'SYSTEM';

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [orders] = await connection.query(
        `SELECT o.*, c.business_name as customer_name
         FROM OUTBOUND_ORDERS o
         LEFT JOIN CUSTOMERS c ON o.customer_id = c.id
         WHERE o.id = ?`,
        [id]
      );

      if (orders.length === 0) {
        throw new Error('Spedizione non trovata');
      }
      const order = orders[0];

      if (order.status !== 'SHIPPED') {
        throw new Error('Solo una spedizione già confermata ed evasa può essere resa.');
      }

      // Recupera tutti gli item della spedizione
      const [items] = await connection.query(
        `SELECT oi.*, p.name as product_name, p.sku, p.uom as base_uom,
                COALESCE(pal.units_per_box, p.units_per_box, 1) as prod_upb,
                COALESCE(p.boxes_per_pallet, 1) as prod_bpp
         FROM OUTBOUND_ITEMS oi
         JOIN PRODUCTS p ON oi.product_id = p.id
         LEFT JOIN PALLETS pal ON oi.pallet_id = pal.id
         WHERE oi.order_id = ?`,
        [order.id]
      );

      if (items.length === 0) {
        throw new Error('Nessun articolo trovato nella spedizione da rendere.');
      }

      const itemsSnapshot = [];

      for (const item of items) {
        const actualPicked = parseFloat(item.quantity_picked) > 0 
          ? parseFloat(item.quantity_picked) 
          : parseFloat(item.quantity_required);

        const upb = parseFloat(item.prod_upb) || 1;
        const bpp = parseFloat(item.prod_bpp) || 1;
        const unitsPerPallet = upb * bpp;

        let restoreQty = actualPicked;
        if (item.requested_uom === 'Scatole' || item.requested_uom === 'Cartoni') {
          restoreQty = actualPicked * upb;
        } else if ((item.requested_uom === 'Bancali' || item.requested_uom === 'Palette') && unitsPerPallet > 1) {
          restoreQty = actualPicked * unitsPerPallet;
        }

        let pallet = null;
        if (item.pallet_id) {
          const [pals] = await connection.query('SELECT * FROM PALLETS WHERE id = ?', [item.pallet_id]);
          if (pals.length > 0) pallet = pals[0];
        }
        if (!pallet && item.pallet_code) {
          const [pals] = await connection.query(
            'SELECT * FROM PALLETS WHERE pallet_code = ? AND product_id = ? ORDER BY id DESC LIMIT 1',
            [item.pallet_code, item.product_id]
          );
          if (pals.length > 0) pallet = pals[0];
        }

        let assignedPalletId = item.pallet_id;
        let assignedPalletCode = item.pallet_code || (pallet ? pallet.pallet_code : `PAL-RESO-${order.id}`);

        if (pallet && (pallet.status === 'SHIPPED' || parseFloat(pallet.quantity) === 0)) {
          // Paletta azzerata/spedita: riattivala come PENDING da stivare (location = NULL)
          await connection.query(
            'UPDATE PALLETS SET quantity = ?, status = "PENDING", location = NULL, shipped_at = NULL WHERE id = ?',
            [restoreQty, pallet.id]
          );
          assignedPalletId = pallet.id;
          assignedPalletCode = pallet.pallet_code;
        } else if (pallet && pallet.status !== 'SHIPPED') {
          // Paletta parziale rimasta sullo scaffale: generiamo codice dedicato PAL-RESO univoco e status PENDING, location NULL
          const resoCode = `PAL-RESO-${order.id}-${item.id}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
          const [insertRes] = await connection.query(
            `INSERT INTO PALLETS 
             (pallet_code, customer_id, product_id, quantity, units_per_box, pallet_uom, batch, warehouse, status, location, client_pallet_number, client_article_number, expiration_date)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NULL, ?, ?, ?)`,
            [
              resoCode,
              pallet.customer_id,
              pallet.product_id,
              restoreQty,
              pallet.units_per_box,
              pallet.pallet_uom,
              pallet.batch,
              pallet.warehouse || 'Settala',
              pallet.client_pallet_number,
              pallet.client_article_number,
              pallet.expiration_date
            ]
          );
          assignedPalletId = insertRes.insertId;
          assignedPalletCode = resoCode;
          await connection.query('UPDATE OUTBOUND_ITEMS SET pallet_id = ?, pallet_code = ? WHERE id = ?', [assignedPalletId, assignedPalletCode, item.id]);
        } else {
          // Paletta non trovata: inserisci nuova paletta PENDING da stivare
          const resoCode = `PAL-RESO-${order.id}-${item.id}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
          const [insertRes] = await connection.query(
            `INSERT INTO PALLETS 
             (pallet_code, customer_id, product_id, quantity, units_per_box, pallet_uom, batch, warehouse, status, location)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'Settala', 'PENDING', NULL)`,
            [
              resoCode,
              order.customer_id,
              item.product_id,
              restoreQty,
              upb,
              item.requested_uom || 'Pezzi',
              item.batch
            ]
          );
          assignedPalletId = insertRes.insertId;
          assignedPalletCode = resoCode;
          await connection.query('UPDATE OUTBOUND_ITEMS SET pallet_id = ?, pallet_code = ? WHERE id = ?', [assignedPalletId, assignedPalletCode, item.id]);
        }

        itemsSnapshot.push({
          item_id: item.id,
          product_id: item.product_id,
          product_name: item.product_name,
          sku: item.sku,
          batch: item.batch,
          quantity: actualPicked,
          requested_uom: item.requested_uom || item.base_uom,
          pallet_id: assignedPalletId,
          pallet_code: assignedPalletCode
        });
      }

      const preparedBy = order.picking_operator || order.created_by || 'Non registrato';
      const shippedBy = order.shipped_by || 'Non registrato';

      // Inserisci nello storico resi
      const [returnRes] = await connection.query(
        `INSERT INTO OUTBOUND_RETURNS 
         (order_id, order_code, customer_id, customer_name, return_reason, returned_by, prepared_by, shipped_by, original_shipped_at, items_snapshot, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          order.id,
          order.order_code,
          order.customer_id,
          order.customer_name || 'N/D',
          cleanReason,
          operator,
          preparedBy,
          shippedBy,
          order.shipped_at,
          JSON.stringify(itemsSnapshot),
          cleanNotes
        ]
      );

      // Aggiorna l'ordine di spedizione: risulta completato/reso (RETURNED)
      await connection.query(
        `UPDATE OUTBOUND_ORDERS 
         SET status = "RETURNED",
             return_count = COALESCE(return_count, 0) + 1,
             last_returned_at = CURRENT_TIMESTAMP,
             last_returned_by = ?,
             last_return_reason = ?
         WHERE id = ?`,
        [operator, cleanReason, order.id]
      );

      // Reset stato righe a PENDING
      await connection.query(
        'UPDATE OUTBOUND_ITEMS SET status = "PENDING" WHERE order_id = ?',
        [order.id]
      );

      // Log Audit
      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        [
          'OUTBOUND_RETURN',
          `Registrato reso spedizione ${order.order_code} (${order.customer_name || 'N/D'}). Motivo: ${cleanReason}. Merce rientrata in posizione IN ATTESA.`,
          'BACKOFFICE',
          operator
        ]
      );

      await connection.commit();
      connection.release();

      if (fastify.io) {
        fastify.io.emit('outbound_updated');
        fastify.io.emit('stow_updated');
        fastify.io.emit('dashboard_update');
        fastify.io.emit('audit_log', {
          action: 'OUTBOUND_RETURN',
          details: `Registrato reso spedizione ${order.order_code}`,
          source: 'BACKOFFICE',
          username: operator,
          created_at: new Date()
        });
      }

      return {
        success: true,
        message: 'Reso registrato con successo. La merce è tornata in giacenza in posizione "IN ATTESA".',
        return_id: returnRes.insertId
      };
    } catch (err) {
      if (connection) {
        await connection.rollback();
        connection.release();
      }
      fastify.log.error(err);
      return reply.code(400).send({ error: err.message || 'Errore durante la registrazione del reso' });
    }
  });

  // GET /api/outbound/returns - Storico completo dei resi
  fastify.get('/returns', async (request, reply) => {
    try {
      const [rows] = await db.query(`
        SELECT r.*, c.business_name as customer_name_current
        FROM OUTBOUND_RETURNS r
        LEFT JOIN CUSTOMERS c ON r.customer_id = c.id
        ORDER BY r.returned_at DESC
      `);
      return rows;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore nel recupero storico resi' });
    }
  });

  // GET /api/outbound/returns/:id - Dettaglio singolo reso
  fastify.get('/returns/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const [rows] = await db.query('SELECT * FROM OUTBOUND_RETURNS WHERE id = ?', [id]);
      if (rows.length === 0) return reply.code(404).send({ error: 'Reso non trovato' });
      return rows[0];
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore nel recupero del reso' });
    }
  });
}

module.exports = outboundRoutes;
