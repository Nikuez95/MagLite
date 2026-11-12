/**
 * Utility per l'unificazione dei barcode (pallet_code) nella stessa posizione
 * e il consolidamento automatico delle giacenze identiche (stessa posizione + stesso prodotto + stesso lotto).
 */

/**
 * Restituisce il pallet_code già presente in una determinata posizione (se occupata da merce attiva),
 * così da evitare la generazione di nuovi barcode inutili in caso di aggiunta/frammentazione da Desktop o Zebra.
 *
 * @param {object} connection - Connessione o pool MySQL
 * @param {string} location - Ubicazione (mappata o FREE_LOCATIONS)
 * @param {boolean} allowNoBar - Se true, accetta anche codici NOBAR-*; se false, preferisce e restituisce solo codici PAL-*
 * @returns {Promise<string|null>}
 */
async function findExistingLocationBarcode(connection, location, allowNoBar = false) {
  if (!location) return null;
  const cleanLoc = String(location).trim().toUpperCase();
  if (!cleanLoc || cleanLoc.startsWith('ZONA CARICO')) return null;

  const [rows] = await connection.query(
    `SELECT pallet_code
     FROM PALLETS
     WHERE UPPER(TRIM(location)) = ?
       AND status = 'STOCKED'
       AND quantity > 0
     ORDER BY CASE WHEN pallet_code LIKE 'NOBAR-%' THEN 1 ELSE 0 END ASC, id ASC`,
    [cleanLoc]
  );

  if (rows.length === 0) return null;

  for (const r of rows) {
    const code = String(r.pallet_code || '').trim();
    if (!code) continue;
    if (!allowNoBar && code.startsWith('NOBAR-')) continue;
    return code;
  }

  return null;
}

/**
 * Consolida le righe PALLETS attive ('STOCKED' e quantity > 0) che si trovano nella medesima posizione:
 * 1. Unifica il pallet_code sulla posizione mantenendo il primo barcode esistente (preferendo PAL-* rispetto a NOBAR-*).
 * 2. Se nella stessa posizione sono presenti più righe con stesso customer_id, stesso product_id e stesso batch
 *    (non in quarantena e non appartenenti a DDT Inbound ancora aperti/in discrepanza),
 *    somma le quantità in un'unica riga PALLETS e riallinea eventuali riferimenti in OUTBOUND_ITEMS.
 *
 * @param {object} connection - Connessione o pool MySQL
 * @param {string|null} targetLocation - Ubicazione specifica da consolidare, oppure null per consolidare tutte le posizioni
 */
async function consolidateLocationPallets(connection, targetLocation = null) {
  let locationsToProcess = [];

  if (targetLocation) {
    const clean = String(targetLocation).trim().toUpperCase();
    if (!clean || clean.startsWith('ZONA CARICO')) return;
    locationsToProcess = [clean];
  } else {
    const [locRows] = await connection.query(`
      SELECT UPPER(TRIM(location)) AS loc
      FROM PALLETS
      WHERE status = 'STOCKED'
        AND quantity > 0
        AND location IS NOT NULL
        AND TRIM(location) != ''
        AND UPPER(TRIM(location)) NOT LIKE 'ZONA CARICO%'
      GROUP BY UPPER(TRIM(location))
      HAVING COUNT(*) > 1
    `);
    locationsToProcess = locRows.map(r => r.loc).filter(Boolean);
  }

  for (const loc of locationsToProcess) {
    const [rows] = await connection.query(
      `SELECT p.*, d.status AS ddt_status
       FROM PALLETS p
       LEFT JOIN INBOUND_DDTS d ON p.inbound_ddt_id = d.id
       WHERE UPPER(TRIM(p.location)) = ?
         AND p.status = 'STOCKED'
         AND p.quantity > 0
       ORDER BY p.id ASC`,
      [loc]
    );

    if (rows.length <= 1) continue;

    // 1. Determina il barcode canonico già esistente nella posizione (preferendo PAL-* a NOBAR-*)
    const firstBarcoded = rows.find(r => r.pallet_code && !String(r.pallet_code).startsWith('NOBAR-'));
    const canonicalCode = firstBarcoded ? firstBarcoded.pallet_code : rows[0].pallet_code;

    for (const r of rows) {
      if (r.pallet_code !== canonicalCode) {
        await connection.query('UPDATE PALLETS SET pallet_code = ? WHERE id = ?', [canonicalCode, r.id]);
        await connection.query(
          `UPDATE OUTBOUND_ITEMS oi
           JOIN OUTBOUND_ORDERS oo ON oi.order_id = oo.id
           SET oi.pallet_code = ?
           WHERE oi.pallet_id = ? AND oo.status != 'SHIPPED'`,
          [canonicalCode, r.id]
        );
        r.pallet_code = canonicalCode;
      }
    }

    // 2. Raggruppa per (customer_id, product_id, batch normalizzato) per unire merce identica nella stessa posizione
    const groups = new Map();
    for (const r of rows) {
      if (r.is_quarantined) continue;
      // Non fondere righe legate a un DDT Inbound ancora in corso di spunta o in discrepanza finché non è chiuso
      if (r.inbound_ddt_id && r.ddt_status && ['PENDING', 'IN_PROGRESS', 'DISCREPANCY'].includes(r.ddt_status)) {
        continue;
      }

      const normBatch = String(r.batch || '').trim().toUpperCase();
      const key = `${r.customer_id}__${r.product_id}__${normBatch}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(r);
    }

    for (const [, groupRows] of groups.entries()) {
      if (groupRows.length <= 1) continue;

      const primary = groupRows[0];
      const secondaries = groupRows.slice(1);
      const secondaryIds = secondaries.map(s => s.id);

      const totalQty = groupRows.reduce((sum, r) => sum + (parseFloat(r.quantity) || 0), 0);

      // Conserva metadati utili se mancanti sulla riga primaria
      const mergedNotes = groupRows.map(r => r.notes).filter(Boolean)[0] || null;
      const mergedClientPallet = groupRows.map(r => r.client_pallet_number).filter(Boolean)[0] || null;
      const mergedClientArticle = groupRows.map(r => r.client_article_number).filter(Boolean)[0] || null;
      const mergedExpDate = groupRows.map(r => r.expiration_date).filter(Boolean)[0] || null;
      const mergedUnitsPerBox = groupRows.map(r => r.units_per_box).filter(Boolean)[0] || null;
      const mergedPalletUom = groupRows.map(r => r.pallet_uom).filter(Boolean)[0] || null;

      await connection.query(
        `UPDATE PALLETS
         SET quantity = ?,
             pallet_code = ?,
             notes = ?,
             client_pallet_number = ?,
             client_article_number = ?,
             expiration_date = ?,
             units_per_box = COALESCE(units_per_box, ?),
             pallet_uom = COALESCE(pallet_uom, ?)
         WHERE id = ?`,
        [
          totalQty,
          canonicalCode,
          mergedNotes,
          mergedClientPallet,
          mergedClientArticle,
          mergedExpDate,
          mergedUnitsPerBox,
          mergedPalletUom,
          primary.id
        ]
      );

      // Riallinea eventuali righe OUTBOUND_ITEMS che puntavano alle righe secondarie
      await connection.query(
        `UPDATE OUTBOUND_ITEMS
         SET pallet_id = ?, pallet_code = ?
         WHERE pallet_id IN (?)`,
        [primary.id, canonicalCode, secondaryIds]
      );

      // Se in uno stesso ordine Outbound non ancora spedito si trovano ora più righe che puntano
      // allo stesso pallet_id + product_id + requested_uom, uniscile in un'unica riga di prelievo
      const [dupOrderItems] = await connection.query(
        `SELECT oi.id, oi.order_id, oi.requested_uom, oi.status, oi.quantity_required, oi.quantity_picked
         FROM OUTBOUND_ITEMS oi
         JOIN OUTBOUND_ORDERS oo ON oi.order_id = oo.id
         WHERE oi.pallet_id = ?
           AND oi.product_id = ?
           AND oo.status != 'SHIPPED'
         ORDER BY oi.id ASC`,
        [primary.id, primary.product_id]
      );

      if (dupOrderItems.length > 1) {
        const byOrderUom = new Map();
        for (const item of dupOrderItems) {
          const k = `${item.order_id}__${item.requested_uom || 'Pezzi'}__${item.status || 'PENDING'}`;
          if (!byOrderUom.has(k)) byOrderUom.set(k, []);
          byOrderUom.get(k).push(item);
        }
        for (const [, oiGroup] of byOrderUom.entries()) {
          if (oiGroup.length <= 1) continue;
          const firstOi = oiGroup[0];
          const extraOiIds = oiGroup.slice(1).map(x => x.id);
          const sumReq = oiGroup.reduce((s, x) => s + (parseFloat(x.quantity_required) || 0), 0);
          const sumPicked = oiGroup.reduce((s, x) => s + (parseFloat(x.quantity_picked) || 0), 0);
          await connection.query(
            'UPDATE OUTBOUND_ITEMS SET quantity_required = ?, quantity_picked = ? WHERE id = ?',
            [sumReq, sumPicked, firstOi.id]
          );
          await connection.query('DELETE FROM OUTBOUND_ITEMS WHERE id IN (?)', [extraOiIds]);
        }
      }

      // Elimina le righe secondarie accorpate
      await connection.query('DELETE FROM PALLETS WHERE id IN (?)', [secondaryIds]);
    }
  }
}

module.exports = {
  findExistingLocationBarcode,
  consolidateLocationPallets
};
