function parseShelfPos(posStr) {
  const clean = String(posStr || '').trim();
  if (/^\d{2,}$/.test(clean)) {
    return {
      pos: clean,
      level: parseInt(clean[0], 10),
      colIndex: parseInt(clean.slice(1), 10)
    };
  }
  if (/^\d$/.test(clean)) {
    return {
      pos: clean,
      level: 0,
      colIndex: parseInt(clean, 10)
    };
  }
  const digits = clean.match(/\d+/g);
  if (digits && digits.length >= 2) {
    return {
      pos: clean,
      level: parseInt(digits[0], 10),
      colIndex: parseInt(digits[1], 10)
    };
  }
  if (digits && digits.length === 1 && digits[0].length >= 2) {
    return {
      pos: clean,
      level: parseInt(digits[0][0], 10),
      colIndex: parseInt(digits[0].slice(1), 10)
    };
  }
  return { pos: clean, level: 0, colIndex: 0 };
}

function getLevelRangeLabel(level) {
  const lvl = Math.max(0, Number(level) || 0);
  return `${lvl}1-${lvl}2-${lvl}3`;
}

function getLevelName(level) {
  const lvl = Number(level) || 0;
  if (lvl === 0) return 'Piano 0 (Terra / Basso)';
  return `Piano ${lvl}`;
}

function formatBoxesBreakdown(qty, unitsPerBox, uom = 'Pezzi') {
  const q = parseFloat(qty) || 0;
  const upb = Math.max(1, parseInt(unitsPerBox, 10) || 1);
  if (upb > 1) {
    const fullBoxes = Math.floor(q / upb);
    const remainder = Math.round((q - fullBoxes * upb) * 100) / 100;
    const label = remainder > 0
      ? `${fullBoxes} scatole + ${remainder} pz (${q} pz tot · ${upb} pz/sc)`
      : `${fullBoxes} scatole (${q} pz tot · ${upb} pz/sc)`;
    return { totalQty: q, unitsPerBox: upb, fullBoxes, remainder, exactBoxes: Math.round((q / upb) * 100) / 100, uom, label };
  }
  return { totalQty: q, unitsPerBox: 1, fullBoxes: q, remainder: 0, exactBoxes: q, uom, label: `${q} ${uom}` };
}

async function getProductVelocities(connection) {
  const [rows] = await connection.query(`
    SELECT oi.product_id,
           COUNT(DISTINCT CASE WHEN oo.status IN ('SHIPPED', 'READY') THEN oo.id END) AS shipped_orders,
           COUNT(DISTINCT oo.id) AS total_orders,
           SUM(CASE WHEN oo.status IN ('SHIPPED', 'READY') THEN COALESCE(oi.quantity_picked, oi.quantity_required) ELSE COALESCE(oi.quantity_required, 0) END) AS total_qty_out
    FROM OUTBOUND_ITEMS oi
    JOIN OUTBOUND_ORDERS oo ON oi.order_id = oo.id
    WHERE oo.status != 'RETURNED'
    GROUP BY oi.product_id
  `);

  const hasShippedHistory = rows.some(r => Number(r.shipped_orders) > 0);
  const scored = rows
    .map(r => {
      const count = hasShippedHistory ? Number(r.shipped_orders) || 0 : Number(r.total_orders) || 0;
      const qtyOut = parseFloat(r.total_qty_out) || 0;
      return { product_id: Number(r.product_id), shipCount: count, totalQtyOut: qtyOut };
    })
    .filter(r => r.shipCount > 0)
    .sort((a, b) => (b.shipCount - a.shipCount) || (b.totalQtyOut - a.totalQtyOut));

  const map = new Map();
  const n = scored.length;
  const maxCount = n > 0 ? scored[0].shipCount : 0;

  scored.forEach((entry, idx) => {
    let tier = 'BASSISSIMA';
    let idealLevel = 3;

    if (n <= 4) {
      const ratio = maxCount > 0 ? entry.shipCount / maxCount : 0;
      if (ratio >= 0.7 || idx === 0) {
        tier = 'ALTA';
        idealLevel = 0;
      } else if (ratio >= 0.4) {
        tier = 'MEDIA';
        idealLevel = 1;
      } else if (ratio > 0.15) {
        tier = 'BASSA';
        idealLevel = 2;
      } else {
        tier = 'BASSISSIMA';
        idealLevel = 3;
      }
    } else {
      const pct = idx / n;
      if (pct < 0.25) {
        tier = 'ALTA';
        idealLevel = 0;
      } else if (pct < 0.55) {
        tier = 'MEDIA';
        idealLevel = 1;
      } else if (pct < 0.80) {
        tier = 'BASSA';
        idealLevel = 2;
      } else {
        tier = 'BASSISSIMA';
        idealLevel = 3;
      }
    }

    map.set(entry.product_id, {
      product_id: entry.product_id,
      shipCount: entry.shipCount,
      totalQtyOut: Math.round(entry.totalQtyOut * 100) / 100,
      tier,
      idealLevel,
      levelRangeLabel: getLevelRangeLabel(idealLevel)
    });
  });

  return map;
}

function getVelocityForProduct(velocitiesMap, productId) {
  return velocitiesMap.get(Number(productId)) || {
    product_id: Number(productId),
    shipCount: 0,
    totalQtyOut: 0,
    tier: 'BASSISSIMA',
    idealLevel: 3,
    levelRangeLabel: '31-32-33'
  };
}

function getDominantVelocityForRows(velocitiesMap, rows) {
  if (!rows || rows.length === 0) {
    return { shipCount: 0, totalQtyOut: 0, tier: 'BASSISSIMA', idealLevel: 3, levelRangeLabel: '31-32-33' };
  }
  let best = getVelocityForProduct(velocitiesMap, rows[0].product_id);
  for (let i = 1; i < rows.length; i++) {
    const v = getVelocityForProduct(velocitiesMap, rows[i].product_id);
    // Una paletta mista segue la rotazione dell'articolo più veloce che contiene
    if (v.idealLevel < best.idealLevel || (v.idealLevel === best.idealLevel && v.shipCount > best.shipCount)) {
      best = v;
    }
  }
  return best;
}

async function loadMappedWarehouseSnapshot(connection) {
  const [freeRows] = await connection.query('SELECT name FROM FREE_LOCATIONS');
  const freeLocSet = new Set(freeRows.map(r => String(r.name || '').trim().toUpperCase()).filter(Boolean));

  const [locRows] = await connection.query('SELECT id, zone, col, pos, barcode FROM LOCATIONS ORDER BY zone ASC, col ASC, pos ASC');
  const locationsByBarcode = new Map();
  const locations = [];
  for (const loc of locRows) {
    const cleanBarcode = String(loc.barcode || '').trim().toUpperCase();
    if (!cleanBarcode || freeLocSet.has(cleanBarcode)) continue;
    const parsed = parseShelfPos(loc.pos);
    const enriched = {
      id: loc.id,
      zone: String(loc.zone || '').trim().toUpperCase(),
      col: String(loc.col || '').trim().toUpperCase(),
      pos: parsed.pos,
      level: parsed.level,
      colIndex: parsed.colIndex,
      barcode: cleanBarcode
    };
    locations.push(enriched);
    locationsByBarcode.set(cleanBarcode, enriched);
  }

  const [palletRows] = await connection.query(`
    SELECT p.*, pr.name AS product_name, pr.sku,
           COALESCE(p.pallet_uom, pr.uom) AS uom,
           COALESCE(p.units_per_box, pr.units_per_box, 1) AS eff_units_per_box,
           COALESCE(pr.boxes_per_pallet, 1) AS eff_boxes_per_pallet,
           c.business_name AS customer_name
    FROM PALLETS p
    JOIN PRODUCTS pr ON p.product_id = pr.id
    JOIN CUSTOMERS c ON p.customer_id = c.id
    WHERE p.status = 'STOCKED' AND p.quantity > 0
    ORDER BY p.id ASC
  `);

  const [reservedRows] = await connection.query(`
    SELECT DISTINCT oi.pallet_id, oi.pallet_code
    FROM OUTBOUND_ITEMS oi
    JOIN OUTBOUND_ORDERS oo ON oi.order_id = oo.id
    WHERE oo.status IN ('PENDING', 'PICKING', 'READY')
  `);
  const reservedPalletIds = new Set(reservedRows.map(r => r.pallet_id).filter(Boolean));
  const reservedPalletCodes = new Set(reservedRows.map(r => String(r.pallet_code || '').trim().toUpperCase()).filter(Boolean));

  const occupiedByBarcode = new Map();
  const mappedPallets = [];
  let excludedFreeLocationPallets = 0;

  for (const p of palletRows) {
    const cleanLoc = String(p.location || '').trim().toUpperCase();
    if (!cleanLoc || cleanLoc.startsWith('ZONA CARICO')) continue;
    if (freeLocSet.has(cleanLoc)) {
      excludedFreeLocationPallets++;
      continue;
    }
    const locObj = locationsByBarcode.get(cleanLoc);
    if (!locObj) continue; // Esclude posizioni non mappate / libere

    const item = {
      ...p,
      clean_location: cleanLoc,
      loc_zone: locObj.zone,
      loc_col: locObj.col,
      loc_pos: locObj.pos,
      loc_level: locObj.level,
      loc_colIndex: locObj.colIndex,
      norm_batch: String(p.batch || '').trim().toUpperCase(),
      is_reserved_outbound: reservedPalletIds.has(p.id) || reservedPalletCodes.has(String(p.pallet_code || '').trim().toUpperCase())
    };
    mappedPallets.push(item);
    if (!occupiedByBarcode.has(cleanLoc)) occupiedByBarcode.set(cleanLoc, []);
    occupiedByBarcode.get(cleanLoc).push(item);
  }

  return {
    freeLocSet,
    locations,
    locationsByBarcode,
    occupiedByBarcode,
    mappedPallets,
    excludedFreeLocationPallets
  };
}

function buildZoneStats(snapshot, itemRows, excludePalletCode = null) {
  const zonesMap = new Map();
  const itemKeys = (itemRows || []).map(r => ({
    product_id: Number(r.product_id),
    norm_batch: String(r.batch || '').trim().toUpperCase()
  }));

  for (const loc of snapshot.locations) {
    if (!zonesMap.has(loc.zone)) {
      zonesMap.set(loc.zone, {
        zone: loc.zone,
        totalSlots: 0,
        occupiedSlots: 0,
        freeSlots: 0,
        maxLevel: 0,
        sameBatchLocations: []
      });
    }
    const zStat = zonesMap.get(loc.zone);
    zStat.totalSlots++;
    if (loc.level > zStat.maxLevel) zStat.maxLevel = loc.level;

    const occupants = snapshot.occupiedByBarcode.get(loc.barcode) || [];
    const activeOthers = occupants.filter(o => o.pallet_code !== excludePalletCode);
    if (activeOthers.length > 0) {
      zStat.occupiedSlots++;
      const sharesBatch = activeOthers.some(o =>
        itemKeys.some(k => k.product_id === Number(o.product_id) && k.norm_batch !== '' && k.norm_batch === o.norm_batch)
      );
      if (sharesBatch) {
        zStat.sameBatchLocations.push({
          barcode: loc.barcode,
          col: loc.col,
          pos: loc.pos,
          level: loc.level,
          colIndex: loc.colIndex,
          pallet_code: activeOthers[0].pallet_code
        });
      }
    } else {
      zStat.freeSlots++;
    }
  }

  return Array.from(zonesMap.values()).map(z => ({
    ...z,
    occupancyPct: z.totalSlots > 0 ? Math.round((z.occupiedSlots / z.totalSlots) * 100) : 0,
    hasSameBatch: z.sameBatchLocations.length > 0
  }));
}

function scoreZoneSlots({ targetZone, itemRows, velocity, snapshot, excludePalletCode = null, reservedTargetBarcodes = null }) {
  const cleanZone = String(targetZone || '').trim().toUpperCase();
  const zoneLocs = snapshot.locations.filter(l => l.zone === cleanZone);
  if (zoneLocs.length === 0) return { best: null, alternatives: [], zoneInfo: null };

  const maxLevelInZone = Math.max(...zoneLocs.map(l => l.level), 0);
  const effectiveTargetLevel = Math.min(velocity.idealLevel, maxLevelInZone);

  const itemKeys = (itemRows || []).map(r => ({
    product_id: Number(r.product_id),
    norm_batch: String(r.batch || '').trim().toUpperCase()
  }));

  // Raccogli vicini stesso lotto e stesso prodotto nella zona selezionata (escluso FREE_LOCATIONS già filtrato)
  const sameBatchNeighbors = [];
  const sameProductNeighbors = [];
  let totalSlots = 0;
  let freeSlotsCount = 0;

  for (const loc of zoneLocs) {
    totalSlots++;
    const occ = (snapshot.occupiedByBarcode.get(loc.barcode) || []).filter(o => o.pallet_code !== excludePalletCode);
    if (occ.length === 0 && !(reservedTargetBarcodes && reservedTargetBarcodes.has(loc.barcode))) {
      freeSlotsCount++;
    }
    for (const o of occ) {
      const sameBatch = itemKeys.some(k => k.product_id === Number(o.product_id) && k.norm_batch !== '' && k.norm_batch === o.norm_batch);
      const sameProd = itemKeys.some(k => k.product_id === Number(o.product_id));
      if (sameBatch) sameBatchNeighbors.push({ loc, pallet_code: o.pallet_code, batch: o.norm_batch });
      else if (sameProd) sameProductNeighbors.push({ loc, pallet_code: o.pallet_code });
    }
  }

  const freeRatio = totalSlots > 0 ? freeSlotsCount / totalSlots : 0;
  // Quando l'area è più piena (freeRatio basso), il sistema dà leggermente più peso al tenere vicini i lotti
  const batchProximityBoostScale = freeRatio < 0.35 ? 1.15 : 1.0;

  const candidates = [];
  for (const loc of zoneLocs) {
    const occ = (snapshot.occupiedByBarcode.get(loc.barcode) || []).filter(o => o.pallet_code !== excludePalletCode);
    if (occ.length > 0) continue;
    if (reservedTargetBarcodes && reservedTargetBarcodes.has(loc.barcode)) continue;

    const levelDiff = Math.abs(loc.level - effectiveTargetLevel);
    let score = 100 - levelDiff * 35 - loc.level * 1.5;
    const reasons = [];

    if (loc.level === effectiveTargetLevel) {
      reasons.push(`Livello ${loc.level} (${getLevelRangeLabel(loc.level)}) ideale per rotazione ${velocity.tier}`);
    } else if (levelDiff === 1) {
      reasons.push(`Livello ${loc.level} vicino al target ${effectiveTargetLevel}`);
    } else {
      reasons.push(`Livello ${loc.level} disponibile in ${cleanZone}`);
    }

    let isSameBatchNeighbor = false;
    let bestBatchDist = Infinity;
    let bestBatchNeighbor = null;

    for (const nb of sameBatchNeighbors) {
      const sameCol = nb.loc.col === loc.col;
      const colDist = Math.abs(nb.loc.colIndex - loc.colIndex);
      const lvlDist = Math.abs(nb.loc.level - loc.level);

      if (sameCol && colDist === 0 && lvlDist === 1) {
        // Es. una al 01 e l'altra subito sopra al 11 (o sotto)
        score += Math.round(45 * batchProximityBoostScale);
        isSameBatchNeighbor = true;
        if (0 < bestBatchDist) {
          bestBatchDist = 0;
          bestBatchNeighbor = nb;
        }
      } else if (sameCol && colDist <= 1 && lvlDist <= 1) {
        score += Math.round(34 * batchProximityBoostScale);
        isSameBatchNeighbor = true;
        if (1 < bestBatchDist) {
          bestBatchDist = 1;
          bestBatchNeighbor = nb;
        }
      } else if (sameCol) {
        score += Math.round(20 * batchProximityBoostScale);
        isSameBatchNeighbor = true;
        if (2 < bestBatchDist) {
          bestBatchDist = 2;
          bestBatchNeighbor = nb;
        }
      }
    }

    if (bestBatchNeighbor) {
      reasons.push(`Vicino a stesso lotto su ${bestBatchNeighbor.loc.barcode}`);
    } else if (sameProductNeighbors.some(nb => nb.loc.col === loc.col)) {
      score += 8;
      reasons.push(`Stesso articolo in colonna ${loc.col}`);
    }

    candidates.push({
      barcode: loc.barcode,
      zone: loc.zone,
      col: loc.col,
      pos: loc.pos,
      level: loc.level,
      colIndex: loc.colIndex,
      score: Math.round(score * 10) / 10,
      isSameBatchNeighbor,
      reasons
    });
  }

  candidates.sort((a, b) =>
    (b.score - a.score) ||
    (a.level - b.level) ||
    a.col.localeCompare(b.col) ||
    (a.colIndex - b.colIndex)
  );

  return {
    best: candidates[0] || null,
    alternatives: candidates.slice(0, 4),
    zoneInfo: {
      zone: cleanZone,
      totalSlots,
      freeSlots: freeSlotsCount,
      occupiedSlots: totalSlots - freeSlotsCount,
      occupancyPct: totalSlots > 0 ? Math.round(((totalSlots - freeSlotsCount) / totalSlots) * 100) : 0,
      effectiveTargetLevel,
      maxLevelInZone,
      sameBatchCount: sameBatchNeighbors.length
    }
  };
}

async function recommendSlotForPallet(connection, palletCode, targetZone = null) {
  const [rows] = await connection.query(`
    SELECT p.*, pr.name AS product_name, pr.sku,
           COALESCE(p.pallet_uom, pr.uom) AS uom,
           COALESCE(p.units_per_box, pr.units_per_box, 1) AS eff_units_per_box
    FROM PALLETS p
    JOIN PRODUCTS pr ON p.product_id = pr.id
    WHERE p.pallet_code = ? AND p.status != 'SHIPPED' AND p.quantity > 0
  `, [palletCode]);

  if (rows.length === 0) return null;

  const snapshot = await loadMappedWarehouseSnapshot(connection);
  const velocities = await getProductVelocities(connection);
  const velocity = getDominantVelocityForRows(velocities, rows);

  const currentLocRaw = String(rows[0].location || '').trim().toUpperCase();
  const isInFreeLocation = Boolean(currentLocRaw && snapshot.freeLocSet.has(currentLocRaw));
  const currentMappedLoc = !isInFreeLocation && currentLocRaw ? snapshot.locationsByBarcode.get(currentLocRaw) || null : null;

  const zoneStats = buildZoneStats(snapshot, rows, palletCode);
  let chosenZone = targetZone ? String(targetZone).trim().toUpperCase() : null;
  if (!chosenZone) {
    if (currentMappedLoc) {
      chosenZone = currentMappedLoc.zone;
    } else {
      const zoneWithSpace = zoneStats
        .filter(z => z.freeSlots > 0)
        .sort((a, b) => (Number(b.hasSameBatch) - Number(a.hasSameBatch)) || (b.freeSlots - a.freeSlots))[0];
      chosenZone = zoneWithSpace ? zoneWithSpace.zone : (zoneStats[0]?.zone || null);
    }
  }

  let recommendation = chosenZone
    ? scoreZoneSlots({ targetZone: chosenZone, itemRows: rows, velocity, snapshot, excludePalletCode: palletCode })
    : { best: null, alternatives: [], zoneInfo: null };

  // Verifica se la paletta è già posizionata in modo ottimale
  let isOptimal = false;
  let optimalMessage = '';
  if (isInFreeLocation) {
    optimalMessage = `Posizione attuale "${currentLocRaw}" in FREE_LOCATIONS (esclusa dal calcolo slotting).`;
  } else if (!currentMappedLoc) {
    optimalMessage = currentLocRaw
      ? `Attualmente in "${currentLocRaw}" (fuori scaffalatura mappata).`
      : 'Paletta non ancora stivata su scaffale.';
  } else {
    const zInfo = zoneStats.find(z => z.zone === currentMappedLoc.zone);
    const maxLvl = zInfo ? zInfo.maxLevel : 3;
    const idealInZone = Math.min(velocity.idealLevel, maxLvl);
    if (currentMappedLoc.level === idealInZone) {
      isOptimal = true;
      optimalMessage = `È nella posizione ottimale (${getLevelName(currentMappedLoc.level)} per rotazione ${velocity.tier}).`;
    } else if (recommendation.best && recommendation.best.level === currentMappedLoc.level) {
      isOptimal = true;
      optimalMessage = `Posizione ottimale per disponibilità attuale in ${currentMappedLoc.zone}.`;
    } else {
      optimalMessage = `Attualmente al Piano ${currentMappedLoc.level}; livello consigliato Piano ${idealInZone} (${getLevelRangeLabel(idealInZone)}).`;
    }
  }

  return {
    pallet_code: palletCode,
    velocity,
    zoneStats,
    selectedZone: chosenZone,
    recommended: recommendation.best,
    alternatives: recommendation.alternatives,
    zoneInfo: recommendation.zoneInfo,
    currentStatus: {
      location: currentLocRaw || null,
      isMapped: Boolean(currentMappedLoc),
      isInFreeLocation,
      currentZone: currentMappedLoc?.zone || null,
      currentLevel: currentMappedLoc?.level ?? null,
      isOptimal,
      optimalMessage
    },
    excludedFreeLocationPallets: snapshot.excludedFreeLocationPallets
  };
}

function groupMappedPalletsByCode(snapshot) {
  const byCode = new Map();
  for (const row of snapshot.mappedPallets) {
    if (!byCode.has(row.pallet_code)) {
      byCode.set(row.pallet_code, {
        pallet_code: row.pallet_code,
        customer_id: row.customer_id,
        customer_name: row.customer_name,
        location: row.clean_location,
        zone: row.loc_zone,
        col: row.loc_col,
        pos: row.loc_pos,
        level: row.loc_level,
        colIndex: row.loc_colIndex,
        is_quarantined: Boolean(row.is_quarantined),
        is_reserved_outbound: Boolean(row.is_reserved_outbound),
        items: []
      });
    }
    const group = byCode.get(row.pallet_code);
    if (row.is_quarantined) group.is_quarantined = true;
    if (row.is_reserved_outbound) group.is_reserved_outbound = true;
    group.items.push(row);
  }
  return Array.from(byCode.values());
}

async function computeOptimizationTasks(connection, canAccessCustomerFn, user) {
  const snapshot = await loadMappedWarehouseSnapshot(connection);
  const velocities = await getProductVelocities(connection);
  const allGroups = groupMappedPalletsByCode(snapshot);

  const accessiblePallets = allGroups.filter(g =>
    !g.is_quarantined &&
    !g.is_reserved_outbound &&
    canAccessCustomerFn(user, g.customer_id)
  );

  const tasks = [];
  const usedPalletCodes = new Set();
  const reservedTargets = new Set();

  // ---------------------------------------------------------------------------
  // TASK 1: UNIONE ARTICOLI CON LOTTI UGUALI (su paletta più completa)
  // ---------------------------------------------------------------------------
  const singleItemPallets = accessiblePallets.filter(g => g.items.length === 1);
  const bySameBatchKey = new Map();
  for (const p of singleItemPallets) {
    const it = p.items[0];
    if (!it.norm_batch) continue;
    const key = `${p.customer_id}__${it.product_id}__${it.norm_batch}`;
    if (!bySameBatchKey.has(key)) bySameBatchKey.set(key, []);
    bySameBatchKey.get(key).push(p);
  }

  for (const [, candidates] of bySameBatchKey.entries()) {
    if (candidates.length < 2) continue;
    const itSample = candidates[0].items[0];
    const upb = Math.max(1, parseInt(itSample.eff_units_per_box, 10) || 1);
    const bpp = Math.max(1, parseInt(itSample.eff_boxes_per_pallet, 10) || 1);
    const maxPalletUnits = bpp > 1 ? bpp * upb : null;
    const velocity = getVelocityForProduct(velocities, itSample.product_id);

    // Scegli come target la paletta più completa (quantità maggiore, preferendo livello più vicino all'ideale)
    const sorted = [...candidates].sort((a, b) => {
      const qa = parseFloat(a.items[0].quantity) || 0;
      const qb = parseFloat(b.items[0].quantity) || 0;
      if (qb !== qa) return qb - qa;
      return Math.abs(a.level - velocity.idealLevel) - Math.abs(b.level - velocity.idealLevel);
    });

    const target = sorted[0];
    let targetQty = parseFloat(target.items[0].quantity) || 0;
    const sources = [];

    for (let i = 1; i < sorted.length; i++) {
      const src = sorted[i];
      const srcQty = parseFloat(src.items[0].quantity) || 0;
      const srcBoxes = upb > 1 ? srcQty / upb : srcQty;

      // Consenti unione se c'è capienza sul bancale target o se la sorgente è piccola/parziale
      const fitsCapacity = maxPalletUnits
        ? (targetQty + srcQty <= maxPalletUnits * 1.1)
        : (srcBoxes <= 20);

      if (fitsCapacity && !usedPalletCodes.has(src.pallet_code)) {
        sources.push(src);
        targetQty += srcQty;
        usedPalletCodes.add(src.pallet_code);
      }
    }

    if (sources.length > 0) {
      usedPalletCodes.add(target.pallet_code);
      const addedQty = sources.reduce((s, p) => s + (parseFloat(p.items[0].quantity) || 0), 0);
      tasks.push({
        id: `MERGE_BATCH_${target.pallet_code}`,
        type: 'MERGE_SAME_BATCH',
        priority: 95 + sources.length * 5,
        title: `Unisci Lotto ${itSample.batch}`,
        subtitle: `${itSample.product_name} (${target.customer_name})`,
        reason: `${sources.length + 1} palette con stesso articolo e lotto sparsi su più posizioni: unisci ${formatBoxesBreakdown(addedQty, upb, itSample.uom).label} su ${target.pallet_code} (${target.location}) per liberare ${sources.length} postazioni.`,
        action_type: 'MERGE_BATCH',
        customer_name: target.customer_name,
        product_name: itSample.product_name,
        sku: itSample.sku,
        batch: itSample.batch,
        target_pallet_code: target.pallet_code,
        target_location: target.location,
        target_qty_before: parseFloat(target.items[0].quantity) || 0,
        target_qty_after: targetQty,
        uom: itSample.uom,
        units_per_box: upb,
        sources: sources.map(s => ({
          pallet_code: s.pallet_code,
          location: s.location,
          quantity: parseFloat(s.items[0].quantity) || 0,
          qty_label: formatBoxesBreakdown(s.items[0].quantity, upb, itSample.uom).label
        }))
      });
    }
  }

  // ---------------------------------------------------------------------------
  // TASK 2: FRAMMENTAZIONE / ACCORPAMENTO PICCOLI ARTICOLI IN UNICA PALETTA
  // ---------------------------------------------------------------------------
  const sparseByCustomer = new Map();
  for (const p of accessiblePallets) {
    if (usedPalletCodes.has(p.pallet_code)) continue;
    // Calcola quanto è "scarico" il bancale
    let totalFillRatio = 0;
    let totalBoxes = 0;
    let hasCapacityMeta = false;

    for (const it of p.items) {
      const q = parseFloat(it.quantity) || 0;
      const upb = Math.max(1, parseInt(it.eff_units_per_box, 10) || 1);
      const bpp = Math.max(1, parseInt(it.eff_boxes_per_pallet, 10) || 1);
      const boxes = upb > 1 ? q / upb : q;
      totalBoxes += boxes;
      if (bpp > 1) {
        hasCapacityMeta = true;
        totalFillRatio += q / (bpp * upb);
      }
    }

    const isSparse = hasCapacityMeta
      ? (totalFillRatio <= 0.35 && totalBoxes <= 18)
      : (p.items.length === 1 && totalBoxes <= 8);

    if (isSparse) {
      if (!sparseByCustomer.has(p.customer_id)) sparseByCustomer.set(p.customer_id, []);
      sparseByCustomer.get(p.customer_id).push({ pallet: p, fillRatio: totalFillRatio, totalBoxes });
    }
  }

  for (const [, sparseList] of sparseByCustomer.entries()) {
    if (sparseList.length < 2) continue;

    // Raggruppa al massimo fino a 5 bancali parziali per volta così stanno comodamente su un solo bancale
    sparseList.sort((a, b) => a.totalBoxes - b.totalBoxes);
    const batchSlice = [];
    let runningFill = 0;
    let runningBoxes = 0;

    for (const entry of sparseList) {
      const nextFill = runningFill + (entry.fillRatio || 0.15);
      if (batchSlice.length >= 5) break;
      if (batchSlice.length >= 2 && nextFill > 0.95) break;
      batchSlice.push(entry);
      runningFill = nextFill;
      runningBoxes += entry.totalBoxes;
    }

    if (batchSlice.length < 2) continue;

    // Target = la paletta col maggior contenuto iniziale o in posizione migliore
    batchSlice.sort((a, b) => b.totalBoxes - a.totalBoxes);
    const targetEntry = batchSlice[0];
    const target = targetEntry.pallet;
    const sources = batchSlice.slice(1).map(e => e.pallet);

    const combinedRows = [target, ...sources].flatMap(p => p.items);
    const combinedVelocity = getDominantVelocityForRows(velocities, combinedRows);

    // Calcola la posizione X ottimale nella zona di appartenenza (escludendo i codici sorgenti che verranno liberati)
    const zoneRec = scoreZoneSlots({
      targetZone: target.zone,
      itemRows: combinedRows,
      velocity: combinedVelocity,
      snapshot,
      excludePalletCode: target.pallet_code,
      reservedTargetBarcodes: reservedTargets
    });

    const optimalPos = zoneRec.best && (zoneRec.best.level < target.level || Math.abs(zoneRec.best.level - combinedVelocity.idealLevel) < Math.abs(target.level - combinedVelocity.idealLevel))
      ? zoneRec.best.barcode
      : target.location;

    if (optimalPos !== target.location) {
      reservedTargets.add(optimalPos);
    }

    [target, ...sources].forEach(p => usedPalletCodes.add(p.pallet_code));

    tasks.push({
      id: `FRAGMENT_${target.pallet_code}`,
      type: 'CONSOLIDATE_FRAGMENTS',
      priority: 85 + sources.length * 4,
      title: `Frammenta ${sources.length + 1} bancali in ${target.pallet_code}`,
      subtitle: `${target.customer_name} · Sposta in ${optimalPos}`,
      reason: `Trovati ${sources.length + 1} bancali parziali con poche scatole (~${Math.round(runningBoxes * 10) / 10} colli totali). Frammenta tutto sul barcode ${target.pallet_code} e posizionalo in ${optimalPos} (${getLevelRangeLabel(combinedVelocity.idealLevel)}). Liberi ${sources.length} scaffali!`,
      action_type: 'CONSOLIDATE_FRAGMENTS',
      customer_name: target.customer_name,
      target_pallet_code: target.pallet_code,
      target_location: optimalPos,
      needs_relocation: optimalPos !== target.location,
      velocity: combinedVelocity,
      sources: sources.map(s => ({
        pallet_code: s.pallet_code,
        location: s.location,
        items_summary: s.items.map(it => `${it.product_name} (${formatBoxesBreakdown(it.quantity, it.eff_units_per_box, it.uom).label})`).join(' · ')
      })),
      target_summary: target.items.map(it => `${it.product_name} (${formatBoxesBreakdown(it.quantity, it.eff_units_per_box, it.uom).label})`).join(' · ')
    });
  }

  // ---------------------------------------------------------------------------
  // TASK 3: RIORDINO VERTICALE ABC (alta frequenza giù, bassa frequenza su)
  // ---------------------------------------------------------------------------
  const reorderCandidates = [];
  for (const p of accessiblePallets) {
    if (usedPalletCodes.has(p.pallet_code)) continue;
    const velocity = getDominantVelocityForRows(velocities, p.items);
    const zLocs = snapshot.locations.filter(l => l.zone === p.zone);
    const maxLvl = zLocs.length > 0 ? Math.max(...zLocs.map(l => l.level)) : 3;
    const effectiveIdeal = Math.min(velocity.idealLevel, maxLvl);

    const diff = p.level - effectiveIdeal;
    // Alta rotazione troppo in alto (diff >= 1 quando ideal=0, o diff >= 2)
    // Oppure bassissima rotazione sul piano 0 che occupa spazio prezioso di picking
    const fastMoverHigh = (effectiveIdeal <= 1 && p.level > effectiveIdeal);
    const slowMoverFloor = (effectiveIdeal >= 2 && p.level === 0 && maxLvl >= 2);

    if (!fastMoverHigh && !slowMoverFloor) continue;

    reorderCandidates.push({
      pallet: p,
      velocity,
      effectiveIdeal,
      urgency: fastMoverHigh ? (70 + diff * 12 + velocity.shipCount * 2) : (55 + diff * 6)
    });
  }

  reorderCandidates.sort((a, b) => b.urgency - a.urgency);

  for (const cand of reorderCandidates) {
    const p = cand.pallet;
    const rec = scoreZoneSlots({
      targetZone: p.zone,
      itemRows: p.items,
      velocity: cand.velocity,
      snapshot,
      excludePalletCode: p.pallet_code,
      reservedTargetBarcodes: reservedTargets
    });

    if (!rec.best) continue;

    const currentDist = Math.abs(p.level - cand.effectiveIdeal);
    const nextDist = Math.abs(rec.best.level - cand.effectiveIdeal);
    // Proponi spostamento solo se avvicina concretamente al livello target
    if (nextDist >= currentDist) continue;

    reservedTargets.add(rec.best.barcode);
    usedPalletCodes.add(p.pallet_code);

    const isMovingDown = rec.best.level < p.level;
    tasks.push({
      id: `REORDER_${p.pallet_code}`,
      type: 'REORDER_SLOTTING',
      priority: Math.round(cand.urgency),
      title: isMovingDown
        ? `Abbassa ${p.pallet_code} → Piano ${rec.best.level}`
        : `Alza bassa rotazione ${p.pallet_code} → Piano ${rec.best.level}`,
      subtitle: p.items.length > 1
        ? `PALETTA MISTA (${p.items.length} art.) · ${p.customer_name}`
        : `${p.items[0].product_name} (${p.customer_name})`,
      reason: isMovingDown
        ? `Rotazione ${cand.velocity.tier} (${cand.velocity.shipCount} spedizioni): sposta dal Piano ${p.level} (${p.location}) al Piano ${rec.best.level} (${rec.best.barcode}) per velocizzare il picking.`
        : `Rotazione ${cand.velocity.tier} (${cand.velocity.shipCount} spedizioni) occupa il Piano 0 (${p.location}): libera spazio basso spostandola in ${rec.best.barcode} (Piano ${rec.best.level}).`,
      action_type: 'MOVE',
      pallet_code: p.pallet_code,
      from_location: p.location,
      to_location: rec.best.barcode,
      current_level: p.level,
      target_level: rec.best.level,
      ideal_level: cand.effectiveIdeal,
      velocity: cand.velocity,
      batch: p.items.map(i => i.batch).filter(Boolean).join(', ') || '-',
      qty_label: p.items.length === 1
        ? formatBoxesBreakdown(p.items[0].quantity, p.items[0].eff_units_per_box, p.items[0].uom).label
        : `${p.items.length} articoli misti`
    });
  }

  tasks.sort((a, b) => b.priority - a.priority);

  const summary = {
    totalTasks: tasks.length,
    reorderCount: tasks.filter(t => t.type === 'REORDER_SLOTTING').length,
    mergeSameBatchCount: tasks.filter(t => t.type === 'MERGE_SAME_BATCH').length,
    fragmentConsolidateCount: tasks.filter(t => t.type === 'CONSOLIDATE_FRAGMENTS').length,
    excludedFreeLocationPallets: snapshot.excludedFreeLocationPallets
  };

  return { summary, tasks };
}

module.exports = {
  parseShelfPos,
  getLevelRangeLabel,
  getLevelName,
  formatBoxesBreakdown,
  getProductVelocities,
  loadMappedWarehouseSnapshot,
  recommendSlotForPallet,
  computeOptimizationTasks
};
