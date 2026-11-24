const db = require('../config/db');
const { hasPermission, canAccessCustomer, parseJsonSafe } = require('../utils/permissions');
const { sanitizeExpirationDate } = require('../utils/pdfLabels');
const { formatBoxesBreakdown } = require('../utils/slotting');
const { createNotification } = require('../utils/notifications');

const NON_CONFORMITY_CAUSES = [
  { code: 'LOTTO_ERRATO', label: 'Lotto errato / illeggibile' },
  { code: 'SCADENZA_ERRATA', label: 'Data di scadenza errata / assente / merce scaduta' },
  { code: 'ARTICOLO_ERRATO', label: 'Articolo / Nome / SKU errato (merce diversa)' },
  { code: 'QUANTITA_ERRATA', label: 'Quantità / Colli errati (eccesso o mancanza)' },
  { code: 'COLLO_ROTTO', label: 'Collo rotto / Imballaggio danneggiato' },
  { code: 'PESO_NETTO_ERRATO', label: 'Kili netti errati' },
  { code: 'PESO_LORDO_ERRATO', label: 'Kili lordi errati' },
  { code: 'ETICHETTA_MANCANTE', label: 'Etichetta / Barcode assente o illeggibile' },
  { code: 'CONSERVAZIONE_ANOMALA', label: 'Anomalia temperatura / conservazione / contaminazione' },
  { code: 'BANCALE_NON_CONFORME', label: 'Bancale danneggiato / instabile / non conforme' },
  { code: 'DOCUMENTI_ERRATI', label: 'DDT / Riferimenti cliente / Metadati errati' },
  { code: 'ALTRO', label: 'Altro problema (vedi note operatore)' }
];

const CAUSE_MAP = new Map(NON_CONFORMITY_CAUSES.map(c => [c.code, c.label]));

async function generateNextNcCode(connection) {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `NC-${dateStr}-`;
  const [rows] = await connection.query(
    'SELECT nc_code FROM NON_CONFORMITIES WHERE nc_code LIKE ?',
    [`${prefix}%`]
  );
  let maxSeq = 0;
  for (const r of rows) {
    const suffix = String(r.nc_code || '').slice(prefix.length);
    if (/^\d+$/.test(suffix)) {
      const n = parseInt(suffix, 10);
      if (n > maxSeq) maxSeq = n;
    }
  }
  return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
}

async function fetchFullPalletRows(connection, palletCode) {
  const [rows] = await connection.query(`
    SELECT p.*,
           pr.sku, pr.name AS product_name, pr.notes AS product_notes,
           pr.default_article_number,
           COALESCE(p.pallet_uom, pr.uom) AS uom,
           COALESCE(p.units_per_box, pr.units_per_box, 1) AS effective_units_per_box,
           COALESCE(pr.boxes_per_pallet, 1) AS boxes_per_pallet,
           c.business_name AS customer_name,
           d.ddt_number AS inbound_ddt_number,
           tp.name AS tariff_plan_name
    FROM PALLETS p
    JOIN PRODUCTS pr ON p.product_id = pr.id
    JOIN CUSTOMERS c ON p.customer_id = c.id
    LEFT JOIN INBOUND_DDTS d ON p.inbound_ddt_id = d.id
    LEFT JOIN tariff_plans tp ON p.tariff_plan_id = tp.id
    WHERE UPPER(TRIM(p.pallet_code)) = ?
    ORDER BY p.id ASC
  `, [palletCode]);
  return rows;
}

function mapFullItemSnapshot(r) {
  const upb = parseInt(r.effective_units_per_box || r.units_per_box, 10) || 1;
  const qty = parseFloat(r.quantity) || 0;
  const flagsParsed = parseJsonSafe(r.flags, []);
  return {
    pallet_id: r.id,
    pallet_code: r.pallet_code,
    customer_id: r.customer_id,
    customer_name: r.customer_name,
    product_id: r.product_id,
    sku: r.sku,
    product_name: r.product_name,
    product_notes: r.product_notes || null,
    quantity: qty,
    units_per_box: upb,
    boxes_per_pallet: parseInt(r.boxes_per_pallet, 10) || 1,
    uom: r.uom || 'Pezzi',
    boxes_breakdown: formatBoxesBreakdown(qty, upb, r.uom || 'Pezzi'),
    net_weight_kg: r.net_weight_kg !== null && r.net_weight_kg !== undefined ? parseFloat(r.net_weight_kg) : null,
    gross_weight_kg: r.gross_weight_kg !== null && r.gross_weight_kg !== undefined ? parseFloat(r.gross_weight_kg) : null,
    batch: r.batch || null,
    expiration_date: sanitizeExpirationDate(r.expiration_date),
    warehouse: r.warehouse || null,
    location: r.location || null,
    status: r.status || null,
    inbound_ddt_id: r.inbound_ddt_id || null,
    inbound_ddt_number: r.inbound_ddt_number || null,
    client_ddt: r.client_ddt || null,
    checkin_id: r.checkin_id || null,
    checkin_session_code: r.checkin_session_code || null,
    client_pallet_number: r.client_pallet_number || null,
    client_article_number: r.client_article_number || r.default_article_number || null,
    tariff_plan_id: r.tariff_plan_id || null,
    tariff_plan_name: r.tariff_plan_name || null,
    flags: Array.isArray(flagsParsed) ? flagsParsed : [],
    notes: r.notes || null,
    is_quarantined: Boolean(r.is_quarantined),
    quarantine_reason: r.quarantine_reason || null,
    quarantined_by: r.quarantined_by || null,
    quarantined_at: r.quarantined_at || null,
    created_at: r.created_at || null
  };
}

function canViewNc(user) {
  return (
    hasPermission(user, 'view_non_conformities') ||
    hasPermission(user, 'non_conformities_manage') ||
    hasPermission(user, 'access_desktop')
  );
}

function canManageNc(user) {
  return (
    hasPermission(user, 'non_conformities_manage') ||
    hasPermission(user, 'pallet_edit') ||
    hasPermission(user, 'access_desktop')
  );
}

async function nonConformitiesRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  // Catalogo cause disponibili
  fastify.get('/causes', async () => {
    return NON_CONFORMITY_CAUSES;
  });

  // GET /api/non-conformities/inspect/:code (Usato su palmare Zebra per leggere paletta + metadati completi)
  fastify.get('/inspect/:code', async (request, reply) => {
    const rawCode = String(request.params.code || '').trim().toUpperCase();
    if (!rawCode) {
      return reply.code(400).send({ error: 'Barcode paletta mancante' });
    }

    try {
      let targetCode = rawCode;
      let scannedAsLocation = false;
      let rows = await fetchFullPalletRows(db, targetCode);

      if (rows.length === 0) {
        const [locRows] = await db.query(
          `SELECT DISTINCT pallet_code FROM PALLETS WHERE UPPER(TRIM(location)) = ? AND status != 'SHIPPED' AND quantity > 0 ORDER BY id ASC`,
          [rawCode]
        );
        if (locRows.length > 0) {
          scannedAsLocation = true;
          targetCode = locRows[0].pallet_code;
          rows = await fetchFullPalletRows(db, targetCode);
        }
      }

      if (rows.length === 0) {
        return reply.code(404).send({ error: `Nessuna paletta trovata per il codice "${rawCode}"` });
      }

      if (rows.some(r => !canAccessCustomer(request.user, r.customer_id))) {
        return reply.code(403).send({ error: 'Accesso negato: non puoi accedere alla merce di questo cliente.' });
      }

      const activeRows = rows.filter(r => r.status !== 'SHIPPED' && parseFloat(r.quantity) > 0);
      const displayRows = activeRows.length > 0 ? activeRows : rows;
      const items = displayRows.map(mapFullItemSnapshot);
      const primary = items[0];

      const [openNcs] = await db.query(
        `SELECT id, nc_code, status, causes, operator_notes, reported_by, reported_at
         FROM NON_CONFORMITIES
         WHERE pallet_code = ? AND status = 'OPEN'
         ORDER BY reported_at DESC`,
        [primary.pallet_code]
      );

      return {
        pallet_code: primary.pallet_code,
        scanned_as_location: scannedAsLocation,
        customer_id: primary.customer_id,
        customer_name: primary.customer_name,
        warehouse: primary.warehouse,
        location: primary.location || 'IN ATTESA',
        status: primary.status,
        is_mixed: items.length > 1,
        is_quarantined: items.some(i => i.is_quarantined),
        items,
        existing_open_nc: openNcs.map(n => ({
          ...n,
          causes: parseJsonSafe(n.causes, [])
        }))
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore lettura barcode paletta per Non Conformità' });
    }
  });

  // POST /api/non-conformities - Invia segnalazione Non Conformità (Zebra o Desktop)
  fastify.post('/', async (request, reply) => {
    const {
      pallet_code,
      causes,
      operator_notes = null,
      target_pallet_item_id = null,
      source = 'ZEBRA'
    } = request.body || {};

    const cleanCode = String(pallet_code || '').trim().toUpperCase();
    if (!cleanCode) {
      return reply.code(400).send({ error: 'Barcode paletta obbligatorio.' });
    }

    const rawCauses = Array.isArray(causes) ? causes : [];
    const normalizedCauses = rawCauses
      .map(c => {
        if (typeof c === 'string') {
          const code = c.trim().toUpperCase();
          return { code, label: CAUSE_MAP.get(code) || c.trim() };
        }
        if (c && typeof c === 'object') {
          const code = String(c.code || 'ALTRO').trim().toUpperCase();
          const label = String(c.label || CAUSE_MAP.get(code) || code).trim();
          return { code, label };
        }
        return null;
      })
      .filter(Boolean);

    const cleanNotes = operator_notes && String(operator_notes).trim() !== ''
      ? String(operator_notes).trim()
      : null;

    if (normalizedCauses.length === 0 && !cleanNotes) {
      return reply.code(400).send({ error: 'Seleziona almeno una causa di Non Conformità oppure inserisci una nota descrittiva.' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const rows = await fetchFullPalletRows(connection, cleanCode);
      if (rows.length === 0) {
        await connection.rollback();
        connection.release();
        return reply.code(404).send({ error: `Paletta "${cleanCode}" non trovata.` });
      }

      if (rows.some(r => !canAccessCustomer(request.user, r.customer_id))) {
        await connection.rollback();
        connection.release();
        return reply.code(403).send({ error: 'Accesso negato: non sei autorizzato su questo cliente.' });
      }

      const activeRows = rows.filter(r => r.status !== 'SHIPPED' && parseFloat(r.quantity) > 0);
      const snapshotRows = activeRows.length > 0 ? activeRows : rows;
      const itemsSnapshot = snapshotRows.map(mapFullItemSnapshot);
      const primary = itemsSnapshot[0];

      const totalQty = itemsSnapshot.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
      const totalNetKg = itemsSnapshot.reduce((s, it) => s + (Number(it.net_weight_kg) || 0), 0);
      const totalGrossKg = itemsSnapshot.reduce((s, it) => s + (Number(it.gross_weight_kg) || 0), 0);

      const palletMeta = {
        pallet_code: primary.pallet_code,
        is_mixed: itemsSnapshot.length > 1,
        total_items: itemsSnapshot.length,
        total_quantity: totalQty,
        total_net_weight_kg: totalNetKg > 0 ? Number(totalNetKg.toFixed(2)) : null,
        total_gross_weight_kg: totalGrossKg > 0 ? Number(totalGrossKg.toFixed(2)) : null,
        inbound_ddt_number: primary.inbound_ddt_number,
        client_ddt: primary.client_ddt,
        checkin_session_code: primary.checkin_session_code,
        pallet_status: primary.status,
        is_quarantined: itemsSnapshot.some(i => i.is_quarantined),
        reported_source: source === 'DESKTOP' ? 'DESKTOP' : 'ZEBRA'
      };

      const ncCode = await generateNextNcCode(connection);
      const actor = request.user?.username || 'Operatore';

      const [insRes] = await connection.query(
        `INSERT INTO NON_CONFORMITIES
         (nc_code, pallet_code, customer_id, customer_name, warehouse, location, causes, target_pallet_item_id,
          operator_notes, items_snapshot, pallet_metadata_snapshot, status, reported_by, reported_source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)`,
        [
          ncCode,
          primary.pallet_code,
          primary.customer_id,
          primary.customer_name,
          primary.warehouse,
          primary.location || null,
          JSON.stringify(normalizedCauses),
          target_pallet_item_id ? parseInt(target_pallet_item_id, 10) : null,
          cleanNotes,
          JSON.stringify(itemsSnapshot),
          JSON.stringify(palletMeta),
          actor,
          palletMeta.reported_source
        ]
      );

      const causesSummary = normalizedCauses.map(c => c.label).join(', ');
      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        [
          'REPORT_NON_CONFORMITY',
          `Segnalata Non Conformità ${ncCode} su paletta ${primary.pallet_code} (${primary.customer_name}): ${causesSummary || 'Vedi note'}${cleanNotes ? ` — Note: ${cleanNotes}` : ''}`,
          palletMeta.reported_source === 'ZEBRA' ? 'Zebra Mobile' : 'Gestionale',
          actor
        ]
      );

      await createNotification(connection, fastify.io, {
        type: 'NON_CONFORMITY',
        title: `Nuova Non Conformità ${ncCode}`,
        message: `${actor} ha segnalato su ${primary.pallet_code} (${primary.customer_name}): ${causesSummary || cleanNotes}`,
        customer_id: primary.customer_id,
        customer_name: primary.customer_name,
        entity_type: 'NON_CONFORMITY',
        entity_code: ncCode,
        link_path: '/desktop/non-conformities',
        actor_username: actor
      });

      await connection.commit();
      connection.release();

      if (fastify.io) {
        fastify.io.emit('non_conformity_updated', { nc_code: ncCode, action: 'REPORTED' });
        fastify.io.emit('dashboard_update');
      }

      return {
        success: true,
        id: insRes.insertId,
        nc_code: ncCode,
        pallet_code: primary.pallet_code
      };
    } catch (err) {
      await connection.rollback();
      connection.release();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore salvataggio Non Conformità' });
    }
  });

  // GET /api/non-conformities - Lista segnalazioni e storico tracciabilità
  fastify.get('/', async (request, reply) => {
    if (!canViewNc(request.user)) {
      return reply.code(403).send({ error: 'Accesso negato alla sezione Non Conformità.' });
    }

    const { status = 'ALL', search = '', customer_id = '' } = request.query || {};

    try {
      const [rows] = await db.query(
        `SELECT * FROM NON_CONFORMITIES ORDER BY reported_at DESC, id DESC LIMIT 1000`
      );

      const accessible = rows.filter(r => canAccessCustomer(request.user, r.customer_id));

      const stats = {
        total: accessible.length,
        open: accessible.filter(r => r.status === 'OPEN').length,
        accepted: accessible.filter(r => r.status === 'ACCEPTED').length,
        rejected: accessible.filter(r => r.status === 'REJECTED').length,
        corrected: accessible.filter(r => Boolean(r.corrected)).length
      };

      const palletCodes = [...new Set(accessible.map(r => r.pallet_code).filter(Boolean))];
      const liveMap = new Map();
      if (palletCodes.length > 0) {
        const [liveRows] = await db.query(`
          SELECT p.*,
                 pr.sku, pr.name AS product_name, pr.notes AS product_notes, pr.default_article_number,
                 COALESCE(p.pallet_uom, pr.uom) AS uom,
                 COALESCE(p.units_per_box, pr.units_per_box, 1) AS effective_units_per_box,
                 COALESCE(pr.boxes_per_pallet, 1) AS boxes_per_pallet,
                 c.business_name AS customer_name,
                 d.ddt_number AS inbound_ddt_number,
                 tp.name AS tariff_plan_name
          FROM PALLETS p
          JOIN PRODUCTS pr ON p.product_id = pr.id
          JOIN CUSTOMERS c ON p.customer_id = c.id
          LEFT JOIN INBOUND_DDTS d ON p.inbound_ddt_id = d.id
          LEFT JOIN tariff_plans tp ON p.tariff_plan_id = tp.id
          WHERE p.pallet_code IN (?)
          ORDER BY p.id ASC
        `, [palletCodes]);
        for (const lr of liveRows) {
          const arr = liveMap.get(lr.pallet_code) || [];
          arr.push(mapFullItemSnapshot(lr));
          liveMap.set(lr.pallet_code, arr);
        }
      }

      const q = String(search || '').trim().toLowerCase();
      const filtered = accessible
        .map(r => ({
          ...r,
          causes: parseJsonSafe(r.causes, []),
          items_snapshot: parseJsonSafe(r.items_snapshot, []),
          pallet_metadata_snapshot: parseJsonSafe(r.pallet_metadata_snapshot, {}),
          correction_summary: parseJsonSafe(r.correction_summary, []),
          corrected: Boolean(r.corrected),
          live_items: liveMap.get(r.pallet_code) || []
        }))
        .filter(r => {
          if (status && status !== 'ALL' && r.status !== status) return false;
          if (customer_id && String(r.customer_id) !== String(customer_id)) return false;
          if (q) {
            const hay = [
              r.nc_code,
              r.pallet_code,
              r.customer_name,
              r.location,
              r.reported_by,
              r.operator_notes,
              r.resolution_notes,
              ...(r.causes || []).map(c => c.label),
              ...(r.items_snapshot || []).flatMap(it => [it.product_name, it.sku, it.batch, it.client_pallet_number, it.client_article_number, it.client_ddt])
            ].filter(Boolean).join(' ').toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        });

      return { items: filtered, stats, causes_catalog: NON_CONFORMITY_CAUSES };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore caricamento Non Conformità' });
    }
  });

  // GET /api/non-conformities/:id/products - Lista prodotti del cliente per eventuale cambio articolo in rettifica
  fastify.get('/:id/products', async (request, reply) => {
    if (!canViewNc(request.user)) {
      return reply.code(403).send({ error: 'Accesso negato' });
    }
    try {
      const [[nc]] = await db.query('SELECT id, customer_id FROM NON_CONFORMITIES WHERE id = ?', [request.params.id]);
      if (!nc) return reply.code(404).send({ error: 'Non Conformità non trovata' });
      if (!canAccessCustomer(request.user, nc.customer_id)) {
        return reply.code(403).send({ error: 'Accesso negato su questo cliente' });
      }
      const [products] = await db.query(
        'SELECT id, sku, name, uom, units_per_box, default_article_number FROM PRODUCTS WHERE customer_id = ? ORDER BY name ASC',
        [nc.customer_id]
      );
      return products;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore recupero articoli cliente' });
    }
  });

  // POST /api/non-conformities/:id/accept - Accetta NC con note opzionali
  fastify.post('/:id/accept', async (request, reply) => {
    if (!canManageNc(request.user)) {
      return reply.code(403).send({ error: 'Accesso negato: permesso gestione Non Conformità richiesto.' });
    }
    const { resolution_notes = null } = request.body || {};
    const cleanNotes = resolution_notes && String(resolution_notes).trim() !== '' ? String(resolution_notes).trim() : null;

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [[nc]] = await connection.query('SELECT * FROM NON_CONFORMITIES WHERE id = ? FOR UPDATE', [request.params.id]);
      if (!nc) {
        await connection.rollback();
        connection.release();
        return reply.code(404).send({ error: 'Non Conformità non trovata' });
      }
      if (!canAccessCustomer(request.user, nc.customer_id)) {
        await connection.rollback();
        connection.release();
        return reply.code(403).send({ error: 'Accesso negato su questo cliente' });
      }

      const actor = request.user?.username || 'Gestionale';
      await connection.query(
        `UPDATE NON_CONFORMITIES
         SET status = 'ACCEPTED', resolution_notes = COALESCE(?, resolution_notes), resolved_by = ?, resolved_at = NOW()
         WHERE id = ?`,
        [cleanNotes, actor, nc.id]
      );

      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['ACCEPT_NON_CONFORMITY', `Accettata Non Conformità ${nc.nc_code} su ${nc.pallet_code}${cleanNotes ? ` — Note: ${cleanNotes}` : ''}`, 'Gestionale', actor]
      );

      await connection.commit();
      connection.release();

      if (fastify.io) {
        fastify.io.emit('non_conformity_updated', { id: nc.id, nc_code: nc.nc_code, action: 'ACCEPTED' });
        fastify.io.emit('dashboard_update');
      }

      return { success: true };
    } catch (err) {
      await connection.rollback();
      connection.release();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore accettazione Non Conformità' });
    }
  });

  // POST /api/non-conformities/:id/reject - Rifiuta / rimuove dalle aperte mantenendo tracciabilità storica
  fastify.post('/:id/reject', async (request, reply) => {
    if (!canManageNc(request.user)) {
      return reply.code(403).send({ error: 'Accesso negato: permesso gestione Non Conformità richiesto.' });
    }
    const { resolution_notes = null } = request.body || {};
    const cleanNotes = resolution_notes && String(resolution_notes).trim() !== '' ? String(resolution_notes).trim() : null;

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [[nc]] = await connection.query('SELECT * FROM NON_CONFORMITIES WHERE id = ? FOR UPDATE', [request.params.id]);
      if (!nc) {
        await connection.rollback();
        connection.release();
        return reply.code(404).send({ error: 'Non Conformità non trovata' });
      }
      if (!canAccessCustomer(request.user, nc.customer_id)) {
        await connection.rollback();
        connection.release();
        return reply.code(403).send({ error: 'Accesso negato su questo cliente' });
      }

      const actor = request.user?.username || 'Gestionale';
      await connection.query(
        `UPDATE NON_CONFORMITIES
         SET status = 'REJECTED', resolution_notes = COALESCE(?, resolution_notes), resolved_by = ?, resolved_at = NOW()
         WHERE id = ?`,
        [cleanNotes, actor, nc.id]
      );

      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['REJECT_NON_CONFORMITY', `Rifiutata ed eliminata dalle aperte la Non Conformità ${nc.nc_code} su ${nc.pallet_code}${cleanNotes ? ` — Motivo: ${cleanNotes}` : ''}`, 'Gestionale', actor]
      );

      await connection.commit();
      connection.release();

      if (fastify.io) {
        fastify.io.emit('non_conformity_updated', { id: nc.id, nc_code: nc.nc_code, action: 'REJECTED' });
        fastify.io.emit('dashboard_update');
      }

      return { success: true };
    } catch (err) {
      await connection.rollback();
      connection.release();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore rifiuto Non Conformità' });
    }
  });

  // POST /api/non-conformities/:id/correct - Rettifica diretta dei dati paletta / prodotto segnalati
  fastify.post('/:id/correct', async (request, reply) => {
    if (!canManageNc(request.user)) {
      return reply.code(403).send({ error: 'Accesso negato: permesso gestione/rettifica Non Conformità richiesto.' });
    }

    const {
      corrections = [],
      accept_nc = true,
      resolution_notes = null
    } = request.body || {};

    if (!Array.isArray(corrections) || corrections.length === 0) {
      return reply.code(400).send({ error: 'Nessuna correzione inviata.' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [[nc]] = await connection.query('SELECT * FROM NON_CONFORMITIES WHERE id = ? FOR UPDATE', [request.params.id]);
      if (!nc) {
        await connection.rollback();
        connection.release();
        return reply.code(404).send({ error: 'Non Conformità non trovata' });
      }
      if (!canAccessCustomer(request.user, nc.customer_id)) {
        await connection.rollback();
        connection.release();
        return reply.code(403).send({ error: 'Accesso negato su questo cliente' });
      }

      const actor = request.user?.username || 'Gestionale';
      const existingHistory = parseJsonSafe(nc.correction_summary, []);
      const batchDiffs = [];

      const parseOptWeight = (w) => (w === undefined || w === null || w === '')
        ? null
        : (Number.isFinite(parseFloat(w)) ? parseFloat(w) : null);

      for (const corr of corrections) {
        const palletId = parseInt(corr.pallet_id, 10);
        if (!palletId) continue;

        const [[row]] = await connection.query(`
          SELECT p.*, pr.name AS product_name, pr.sku, tp.name AS tariff_plan_name
          FROM PALLETS p
          JOIN PRODUCTS pr ON p.product_id = pr.id
          LEFT JOIN tariff_plans tp ON tp.id = p.tariff_plan_id
          WHERE p.id = ? FOR UPDATE
        `, [palletId]);
        if (!row) continue;

        if (!canAccessCustomer(request.user, row.customer_id)) {
          await connection.rollback();
          connection.release();
          return reply.code(403).send({ error: 'Accesso negato sul cliente della paletta' });
        }

        const changes = [];
        let nextProductId = row.product_id;

        if (corr.product_id && parseInt(corr.product_id, 10) !== Number(row.product_id)) {
          const newPid = parseInt(corr.product_id, 10);
          const [[prod]] = await connection.query('SELECT id, name, sku, customer_id FROM PRODUCTS WHERE id = ?', [newPid]);
          if (prod && Number(prod.customer_id) === Number(row.customer_id)) {
            changes.push({ field: 'Articolo', from: `${row.product_name} (${row.sku})`, to: `${prod.name} (${prod.sku})` });
            nextProductId = newPid;
          }
        } else if (corr.rename_product_name && String(corr.rename_product_name).trim() !== '' && String(corr.rename_product_name).trim() !== row.product_name) {
          const cleanProdName = String(corr.rename_product_name).trim();
          changes.push({ field: 'Nome Articolo', from: row.product_name, to: cleanProdName });
          await connection.query('UPDATE PRODUCTS SET name = ? WHERE id = ?', [cleanProdName, row.product_id]);
        }

        const nextBatch = corr.batch !== undefined ? (String(corr.batch || '').trim() || null) : row.batch;
        if (nextBatch !== (row.batch || null)) {
          changes.push({ field: 'Lotto', from: row.batch || '-', to: nextBatch || '-' });
        }

        const nextExp = corr.expiration_date !== undefined ? sanitizeExpirationDate(corr.expiration_date) : sanitizeExpirationDate(row.expiration_date);
        const curExp = sanitizeExpirationDate(row.expiration_date);
        if (nextExp !== curExp) {
          changes.push({ field: 'Scadenza', from: curExp || '-', to: nextExp || '-' });
        }

        const nextQty = corr.quantity !== undefined && corr.quantity !== '' ? Math.max(0, parseFloat(corr.quantity) || 0) : parseFloat(row.quantity);
        if (Math.abs(nextQty - (parseFloat(row.quantity) || 0)) > 0.0001) {
          changes.push({ field: 'Quantità', from: row.quantity, to: nextQty });
        }

        const nextUpb = corr.units_per_box !== undefined && corr.units_per_box !== '' ? Math.max(1, parseInt(corr.units_per_box, 10) || 1) : row.units_per_box;
        if (nextUpb !== row.units_per_box) {
          changes.push({ field: 'Pz/Scatola', from: row.units_per_box || '-', to: nextUpb });
        }

        const nextNet = corr.net_weight_kg !== undefined ? parseOptWeight(corr.net_weight_kg) : (row.net_weight_kg !== null ? parseFloat(row.net_weight_kg) : null);
        const curNet = row.net_weight_kg !== null && row.net_weight_kg !== undefined ? parseFloat(row.net_weight_kg) : null;
        if (nextNet !== curNet) {
          changes.push({ field: 'Kg Netti', from: curNet ?? '-', to: nextNet ?? '-' });
        }

        const nextGross = corr.gross_weight_kg !== undefined ? parseOptWeight(corr.gross_weight_kg) : (row.gross_weight_kg !== null ? parseFloat(row.gross_weight_kg) : null);
        const curGross = row.gross_weight_kg !== null && row.gross_weight_kg !== undefined ? parseFloat(row.gross_weight_kg) : null;
        if (nextGross !== curGross) {
          changes.push({ field: 'Kg Lordi', from: curGross ?? '-', to: nextGross ?? '-' });
        }

        const nextClientPal = corr.client_pallet_number !== undefined ? (String(corr.client_pallet_number || '').trim() || null) : row.client_pallet_number;
        if (nextClientPal !== (row.client_pallet_number || null)) {
          changes.push({ field: 'Rif. Paletta Cliente', from: row.client_pallet_number || '-', to: nextClientPal || '-' });
        }

        const nextClientArt = corr.client_article_number !== undefined ? (String(corr.client_article_number || '').trim() || null) : row.client_article_number;
        if (nextClientArt !== (row.client_article_number || null)) {
          changes.push({ field: 'Rif. Articolo Cliente', from: row.client_article_number || '-', to: nextClientArt || '-' });
        }

        const nextNotes = corr.notes !== undefined ? (String(corr.notes || '').trim() || null) : row.notes;
        if (nextNotes !== (row.notes || null)) {
          changes.push({ field: 'Note Paletta', from: row.notes || '-', to: nextNotes || '-' });
        }

        let nextTariffPlanId = row.tariff_plan_id || null;
        if (corr.tariff_plan_id !== undefined) {
          const parsedTp = (corr.tariff_plan_id === null || corr.tariff_plan_id === '')
            ? null
            : parseInt(corr.tariff_plan_id, 10);
          if (parsedTp !== null && Number.isFinite(parsedTp) && parsedTp > 0) {
            const [[tpRow]] = await connection.query('SELECT id, name FROM tariff_plans WHERE id = ? LIMIT 1', [parsedTp]);
            if (tpRow && Number(row.tariff_plan_id || 0) !== Number(tpRow.id)) {
              changes.push({ field: 'Listino Prezzi', from: row.tariff_plan_name || 'Predefinito Cliente', to: tpRow.name });
              nextTariffPlanId = tpRow.id;
            }
          } else if (parsedTp === null && row.tariff_plan_id) {
            changes.push({ field: 'Listino Prezzi', from: row.tariff_plan_name || String(row.tariff_plan_id), to: 'Predefinito Cliente' });
            nextTariffPlanId = null;
          }
        }

        await connection.query(
          `UPDATE PALLETS
           SET product_id = ?, batch = ?, expiration_date = ?, quantity = ?, units_per_box = ?,
               net_weight_kg = ?, gross_weight_kg = ?, client_pallet_number = ?, client_article_number = ?, notes = ?, tariff_plan_id = ?
           WHERE id = ?`,
          [
            nextProductId,
            nextBatch,
            nextExp,
            nextQty,
            nextUpb,
            nextNet,
            nextGross,
            nextClientPal,
            nextClientArt,
            nextNotes,
            nextTariffPlanId,
            palletId
          ]
        );

        if (changes.length > 0) {
          batchDiffs.push({
            pallet_id: palletId,
            sku: row.sku,
            corrected_by: actor,
            corrected_at: new Date().toISOString(),
            changes
          });
        }
      }

      const mergedSummary = [...(Array.isArray(existingHistory) ? existingHistory : []), ...batchDiffs];
      const cleanResNotes = resolution_notes && String(resolution_notes).trim() !== '' ? String(resolution_notes).trim() : null;

      await connection.query(
        `UPDATE NON_CONFORMITIES
         SET corrected = TRUE,
             correction_summary = ?,
             status = IF(? AND status = 'OPEN', 'ACCEPTED', status),
             resolution_notes = COALESCE(?, resolution_notes),
             resolved_by = IF(? AND resolved_by IS NULL, ?, resolved_by),
             resolved_at = IF(? AND resolved_at IS NULL, NOW(), resolved_at)
         WHERE id = ?`,
        [
          JSON.stringify(mergedSummary),
          accept_nc ? 1 : 0,
          cleanResNotes,
          accept_nc ? 1 : 0,
          actor,
          accept_nc ? 1 : 0,
          nc.id
        ]
      );

      const summaryTxt = batchDiffs
        .flatMap(d => d.changes.map(c => `${c.field}: ${c.from} → ${c.to}`))
        .join(' | ') || 'Rettifica applicata';

      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['CORRECT_NON_CONFORMITY', `Rettifica Non Conformità ${nc.nc_code} su ${nc.pallet_code}: ${summaryTxt}`, 'Gestionale', actor]
      );

      await connection.commit();
      connection.release();

      if (fastify.io) {
        fastify.io.emit('non_conformity_updated', { id: nc.id, nc_code: nc.nc_code, action: 'CORRECTED' });
        fastify.io.emit('inventory_updated');
        fastify.io.emit('stow_updated');
        fastify.io.emit('billing_updated');
        fastify.io.emit('dashboard_update');
      }

      return { success: true, changes: batchDiffs };
    } catch (err) {
      await connection.rollback();
      connection.release();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore applicazione correzione Non Conformità' });
    }
  });
}

module.exports = nonConformitiesRoutes;
