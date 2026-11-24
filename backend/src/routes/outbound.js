const { hasPermission, canAccessCustomer } = require('../utils/permissions');
const db = require('../config/db');
const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');
const { consolidateLocationPallets } = require('../utils/palletConsolidation');
const { withNamedLock } = require('../utils/concurrency');
const { createNotification } = require('../utils/notifications');
const { TEMP_REGIME_MAP, normalizeTempRegime, parseAdrData } = require('../utils/logisticsMeta');

async function getRoutingSettings(connection) {
  const [rows] = await connection.query(
    'SELECT setting_key, setting_value FROM settings WHERE setting_key IN ("zone_routing_priority", "position_routing_priority", "allocation_exact_first", "allocation_fallback_mode")'
  );
  let zonePriority = [];
  let posPriority = ['01,02,03', '11,12,13', '21,22,23'];
  let exactFirst = true;
  let fallbackMode = 'LESS_FULL';
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
      if (r.setting_key === 'allocation_exact_first' && r.setting_value !== undefined && r.setting_value !== null) {
        exactFirst = String(r.setting_value).toLowerCase() !== 'false' && r.setting_value !== '0';
      }
      if (r.setting_key === 'allocation_fallback_mode' && r.setting_value) {
        const m = String(r.setting_value).trim().toUpperCase();
        if (m === 'LESS_FULL' || m === 'LOWEST_SHELF') fallbackMode = m;
      }
    } catch (e) {
      // ignore malformed JSON
    }
  });
  return { zonePriority, posPriority, exactFirst, fallbackMode };
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

function sortPalletsByRouting(pallets, zonePriority, posPriority, opts = {}) {
  const { exactFirst = true, fallbackMode = 'LESS_FULL', targetBaseQty = null, usedById = null } = opts;
  return pallets.sort((a, b) => {
    // 1. FEFO (Data scadenza più vicina)
    const expA = a.expiration_date ? new Date(a.expiration_date).getTime() : 9999999999999;
    const expB = b.expiration_date ? new Date(b.expiration_date).getTime() : 9999999999999;
    if (expA !== expB) return expA - expB;

    const availA = Math.max(0, (parseFloat(a.available_quantity) || 0) - (usedById?.get(a.id) || 0));
    const availB = Math.max(0, (parseFloat(b.available_quantity) || 0) - (usedById?.get(b.id) || 0));

    // 2. Priorità al bancale finito/chiuso (esatta quantità richiesta) anche se su ripiano alto
    if (exactFirst && targetBaseQty && targetBaseQty > 0) {
      const exactA = Math.abs(availA - targetBaseQty) < 0.001;
      const exactB = Math.abs(availB - targetBaseQty) < 0.001;
      if (exactA !== exactB) return exactA ? -1 : 1;
    }

    // 3. Strategia fallback: svuota bancale meno pieno (LESS_FULL) oppure posizione più bassa (LOWEST_SHELF)
    if (fallbackMode === 'LESS_FULL' && Math.abs(availA - availB) > 0.0001) {
      return availA - availB;
    }

    // 4. LIVELLO PIANO: priorità al piano più basso (piano terra 01,02,03 prima di 11,21,31...)
    const coordsA = extractLocationCoords(a);
    const coordsB = extractLocationCoords(b);
    const floorA = getFloorLevel(coordsA.pos, posPriority);
    const floorB = getFloorLevel(coordsB.pos, posPriority);
    if (floorA !== floorB) {
      return floorA - floorB;
    }

    // 5. A parità di piano, rispetta il percorso di magazzino (Zona -> Corsia -> Posizione)
    return compareByWarehousePath(a, b, zonePriority, posPriority);
  });
}

// Ordinamento percorso di prelievo per Zebra e Picking List PDF (rispetta Regole di Prelievo senza avanti e indietro)
function sortPickingTour(items, zonePriority, posPriority) {
  return items.sort((a, b) => compareByWarehousePath(a, b, zonePriority, posPriority));
}

async function allocateOutboundItems(items, connection, excludeOrderId = null) {
  await consolidateLocationPallets(connection);
  const allocatedPallets = [];
  const { zonePriority, posPriority, exactFirst, fallbackMode } = await getRoutingSettings(connection);
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
    const isSpecific = Boolean(req.pallet_id || (req.client_pallet_number && String(req.client_pallet_number).trim() !== '') || (req.pallet_code && String(req.pallet_code).trim() !== ''));

    let query = `
      SELECT pal.*, loc.zone, loc.col, loc.pos,
             COALESCE(pal.units_per_box, p.units_per_box, 1) as effective_units_per_box,
             COALESCE(p.boxes_per_pallet, 1) as effective_boxes_per_pallet,
             COALESCE(NULLIF(pal.kg_per_unit, 0), p.kg_per_unit) as effective_kg_per_unit,
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

    query += ` FOR UPDATE`;
    
    const [rawAvailable] = await connection.query(query, params);
    const available = rawAvailable.filter(pal => {
      const alreadyUsedBase = inMemoryUsedByPalletId.get(pal.id) || 0;
      return (parseFloat(pal.available_quantity) - alreadyUsedBase) > 0;
    });

    const firstKgPerUnit = parseFloat(available.find(p => parseFloat(p.effective_kg_per_unit) > 0)?.effective_kg_per_unit || req.kg_per_unit || 0) || null;
    const rawUomUpper = String(normalizedUom || 'Pezzi').trim().toUpperCase();
    const effectiveNormalizedUom = rawUomUpper === 'KG' && firstKgPerUnit && firstKgPerUnit > 0 ? 'Pezzi' : normalizedUom;
    const totalReqKg = rawUomUpper === 'KG'
      ? parseFloat(req.quantity_required)
      : (req.requested_kg != null ? parseFloat(req.requested_kg) : null);

    let remainingToAllocate = rawUomUpper === 'KG' && firstKgPerUnit && firstKgPerUnit > 0
      ? Number((parseFloat(req.quantity_required) / firstKgPerUnit).toFixed(4))
      : parseFloat(req.quantity_required);
    const allocatedForThisReq = [];
    const candidateQueue = [...available];

    while (remainingToAllocate > 0 && candidateQueue.length > 0) {
      if (!isSpecific) {
        const sampleUpb = parseFloat(candidateQueue[0]?.effective_units_per_box) || 1;
        const sampleBpp = parseFloat(candidateQueue[0]?.effective_boxes_per_pallet) || 1;
        const targetBaseQty = (effectiveNormalizedUom === 'Scatole' || effectiveNormalizedUom === 'Cartoni')
          ? remainingToAllocate * sampleUpb
          : (effectiveNormalizedUom === 'Bancali' ? remainingToAllocate * sampleUpb * sampleBpp : remainingToAllocate);
        sortPalletsByRouting(candidateQueue, zonePriority, posPriority, {
          exactFirst,
          fallbackMode,
          targetBaseQty,
          usedById: inMemoryUsedByPalletId
        });
      }

      const pal = candidateQueue.shift();
      const alreadyUsedBase = inMemoryUsedByPalletId.get(pal.id) || 0;
      const availBaseQty = Math.max(0, parseFloat(pal.available_quantity) - alreadyUsedBase);
      if (availBaseQty <= 0) continue;

      const upb = parseFloat(pal.effective_units_per_box) || 1;
      const bpp = parseFloat(pal.effective_boxes_per_pallet) || 1;
      const kgPerUnit = parseFloat(pal.effective_kg_per_unit) || firstKgPerUnit || null;
      const unitsPerPallet = upb * bpp;

      let palletQtyInRequestedUom = availBaseQty;
      if (effectiveNormalizedUom === 'Scatole' || effectiveNormalizedUom === 'Cartoni') {
        palletQtyInRequestedUom = availBaseQty / upb;
      } else if (effectiveNormalizedUom === 'Bancali') {
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
      let usedBaseForTake = take;
      if (effectiveNormalizedUom === 'Scatole' || effectiveNormalizedUom === 'Cartoni') {
        usedBaseForTake = take * upb;
      } else if (effectiveNormalizedUom === 'Bancali') {
        usedBaseForTake = (palletQtyInRequestedUom > 1 && unitsPerPallet > 1) ? (take * unitsPerPallet) : availBaseQty;
      }

      const sliceReqKg = kgPerUnit && kgPerUnit > 0
        ? (totalReqKg && remainingToAllocate === take && allocatedForThisReq.length === 0
            ? totalReqKg
            : Number((usedBaseForTake * kgPerUnit).toFixed(3)))
        : null;

      allocatedForThisReq.push({
        pallet_id: pal.id,
        pallet_code: pal.pallet_code,
        client_pallet_number: pal.client_pallet_number || req.client_pallet_number || null,
        is_specific: isSpecific ? 1 : 0,
        product_id: req.product_id,
        batch: pal.batch || null,
        quantity_required: take,
        requested_uom: effectiveNormalizedUom,
        requested_kg: sliceReqKg,
        kg_per_unit: kgPerUnit,
        location: pal.location || null,
        zone: pal.zone || null,
        col: pal.col || null,
        pos: pal.pos || null
      });

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
  const mergedAllocations = [];
  const allocMap = new Map();
  for (const item of allocatedPallets) {
    const locKey = (item.location || '').trim().toUpperCase();
    const batchKey = (item.batch || '').trim().toUpperCase();
    const uomKey = item.requested_uom || 'Pezzi';
    const mergeKey = locKey
      ? `LOC__${locKey}__${item.pallet_id || item.pallet_code}__${item.product_id}__${batchKey}__${uomKey}`
      : `PAL__${item.pallet_id || item.pallet_code}__${item.product_id}__${batchKey}__${uomKey}`;
    if (allocMap.has(mergeKey)) {
      const existing = allocMap.get(mergeKey);
      existing.quantity_required = parseFloat((parseFloat(existing.quantity_required) + parseFloat(item.quantity_required)).toFixed(4));
    } else {
      const cloned = { ...item };
      allocMap.set(mergeKey, cloned);
      mergedAllocations.push(cloned);
    }
  }
  sortPickingTour(mergedAllocations, zonePriority, posPriority);
  return mergedAllocations;
}

const DEFAULT_BOLLA_OPTIONS = {
  is_adr: false,
  adr_note: '',
  temp_6_8: false,
  temp_15_25: false,
  legal_intact_goods: true,
  legal_driver_check: true,
  legal_transport_norm: true,
  causale: 'C/FINE DEPOSITO',
  porto: 'Franco',
  aspetto_beni: 'Bancali / Colli Imballati',
  carrier_name: '',
  vehicle_plate: '',
  transport_notes: ''
};

async function resolveOriginWarehouse(connection, originWarehouseId, fallbackName = null, fallbackAddress = null, palletWarehouseId = null) {
  const targetId = originWarehouseId ? Number(originWarehouseId) : (palletWarehouseId ? Number(palletWarehouseId) : null);
  if (targetId) {
    const [[wh]] = await connection.query('SELECT id, name, address, cap, city, province FROM WAREHOUSES WHERE id = ? LIMIT 1', [targetId]);
    if (wh) {
      const cityPart = [wh.cap, wh.city, wh.province ? `(${wh.province})` : ''].filter(Boolean).join(' ');
      const fullAddr = [wh.address, cityPart].filter(Boolean).join(' - ') || wh.name;
      return { id: wh.id, name: wh.name, address: fullAddr };
    }
  }
  if (fallbackName || fallbackAddress) {
    return {
      id: originWarehouseId ? Number(originWarehouseId) : null,
      name: fallbackName || 'Magazzino Centrale',
      address: fallbackAddress || fallbackName || ''
    };
  }
  const [[defaultWh]] = await connection.query('SELECT id, name, address, cap, city, province FROM WAREHOUSES ORDER BY id ASC LIMIT 1');
  if (defaultWh) {
    const cityPart = [defaultWh.cap, defaultWh.city, defaultWh.province ? `(${defaultWh.province})` : ''].filter(Boolean).join(' ');
    const fullAddr = [defaultWh.address, cityPart].filter(Boolean).join(' - ') || defaultWh.name;
    return { id: defaultWh.id, name: defaultWh.name, address: fullAddr };
  }
  return { id: null, name: 'Magazzino Principale', address: null };
}

function summarizeOrderCompliance(items = [], legacyOpts = {}) {
  const tempSet = new Set();
  const adrMap = new Map();
  let hasExplicitTemp = false;

  for (const it of items) {
    const norm = normalizeTempRegime(it.temp_regime);
    if (norm !== 'NONE') {
      tempSet.add(norm);
      hasExplicitTemp = true;
    } else if (it.temp_regime === 'NONE') {
      hasExplicitTemp = true;
    }

    if (it.is_adr) {
      const parsed = parseAdrData(it.adr_data);
      const desc = parsed?.formatted_description
        || (parsed?.un_number ? `${parsed.un_number}${parsed.proper_shipping_name ? ` - ${parsed.proper_shipping_name}` : ''}` : null)
        || 'Merce Pericolosa ADR';
      adrMap.set(desc, parsed || { formatted_description: desc });
    }
  }

  // Fallback per ordini storici senza metadata su paletta
  if (!hasExplicitTemp) {
    if (legacyOpts.temp_6_8) tempSet.add('2_8');
    if (legacyOpts.temp_15_25) tempSet.add('15_25');
  }
  if (adrMap.size === 0 && legacyOpts.is_adr) {
    const legacyText = legacyOpts.adr_note ? `Merce Pericolosa ADR (${legacyOpts.adr_note})` : 'Merce Pericolosa ADR';
    adrMap.set(legacyText, { formatted_description: legacyText });
  }

  const tempRegimes = Array.from(tempSet);
  const adrDescriptions = Array.from(adrMap.keys());
  const mixedColdWarning = tempSet.has('2_8') && tempSet.has('15_25');

  return {
    tempRegimes,
    needsTempCheck: tempRegimes.length > 0,
    mixedColdWarning,
    isAdr: adrDescriptions.length > 0,
    adrDescriptions
  };
}

async function deductOutboundOrderStock(connection, order, items, username, sourceLabel = 'BACKOFFICE') {
  for (const item of items) {
    const actualPicked = parseFloat(item.quantity_picked) > 0 ? parseFloat(item.quantity_picked) : parseFloat(item.quantity_required);

    let palletsQuery = `
      SELECT pal.*, COALESCE(pal.units_per_box, p.units_per_box, 1) as effective_units_per_box, COALESCE(p.boxes_per_pallet, 1) as effective_boxes_per_pallet
      FROM PALLETS pal
      JOIN PRODUCTS p ON pal.product_id = p.id
      WHERE 
    `;
    let palletsParams = [];
    if (item.pallet_id) {
      palletsQuery += `pal.id = ? FOR UPDATE`;
      palletsParams = [item.pallet_id];
    } else if (item.batch) {
      palletsQuery += `pal.pallet_code = ? AND pal.product_id = ? AND TRIM(pal.batch) = TRIM(?) AND pal.status != 'SHIPPED' ORDER BY pal.id ASC LIMIT 1 FOR UPDATE`;
      palletsParams = [item.pallet_code, item.product_id, item.batch];
    } else {
      palletsQuery += `pal.pallet_code = ? AND pal.product_id = ? AND pal.status != 'SHIPPED' ORDER BY pal.id ASC LIMIT 1 FOR UPDATE`;
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
        await connection.query('UPDATE PALLETS SET quantity = 0, status = "SHIPPED", location = NULL, shipped_at = CURRENT_TIMESTAMP WHERE id = ?', [pallet.id]);
      } else {
        await connection.query('UPDATE PALLETS SET quantity = ? WHERE id = ?', [newQty, pallet.id]);
      }

      if (!parseFloat(item.quantity_picked) || parseFloat(item.quantity_picked) <= 0) {
        await connection.query('UPDATE OUTBOUND_ITEMS SET quantity_picked = ?, status = "PICKED" WHERE id = ?', [actualPicked, item.id]);
      }

      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        [
          'OUTBOUND_PICK',
          `Prelevato ${actualPicked} ${item.requested_uom || ''} da paletta ${pallet.pallet_code}${pallet.batch ? ` (Lotto: ${pallet.batch})` : ''} (rimanenza: ${newQty})`,
          sourceLabel,
          username
        ]
      );
    }
  }
}

function parseBollaOptions(raw) {
  let obj = {};
  if (raw) {
    if (typeof raw === 'string') {
      try { obj = JSON.parse(raw) || {}; } catch (_) { obj = {}; }
    } else if (typeof raw === 'object') {
      obj = raw;
    }
  }
  return { ...DEFAULT_BOLLA_OPTIONS, ...obj };
}

function formatDeliveryAddressRow(addr) {
  if (!addr) return '';
  const cityPart = [addr.cap, addr.city, addr.province ? `(${addr.province})` : ''].filter(Boolean).join(' ');
  const linePart = [addr.address_line, cityPart, addr.country && addr.country !== 'Italia' ? addr.country : ''].filter(Boolean).join(' - ');
  const contactPart = [addr.contact_name ? `Ref: ${addr.contact_name}` : '', addr.contact_phone ? `Tel: ${addr.contact_phone}` : ''].filter(Boolean).join(' • ');
  return contactPart ? `${linePart} | ${contactPart}` : linePart;
}

async function resolveCustomerDeliveryData(connection, customerId, { delivery_address_id, delivery_label, delivery_address_text }) {
  const [[cust]] = await connection.query(
    'SELECT id, parent_id, business_name, address, COALESCE(generate_exit_ddt, 1) AS generate_exit_ddt FROM CUSTOMERS WHERE id = ?',
    [customerId]
  );
  if (!cust) return { cust: null, addressId: null, label: null, text: null };

  if (delivery_address_id) {
    const [[addrRow]] = await connection.query('SELECT * FROM CUSTOMER_DELIVERY_ADDRESSES WHERE id = ?', [delivery_address_id]);
    if (addrRow) {
      return {
        cust,
        addressId: addrRow.id,
        label: delivery_label || addrRow.label,
        text: delivery_address_text ? String(delivery_address_text).trim() : formatDeliveryAddressRow(addrRow)
      };
    }
  }

  if (delivery_address_text && String(delivery_address_text).trim()) {
    return {
      cust,
      addressId: null,
      label: delivery_label ? String(delivery_label).trim() : 'Destinazione Specifica',
      text: String(delivery_address_text).trim()
    };
  }

  const targetIds = [cust.id];
  if (cust.parent_id) targetIds.push(cust.parent_id);
  const [defaultRows] = await connection.query(
    `SELECT * FROM CUSTOMER_DELIVERY_ADDRESSES
     WHERE customer_id IN (?)
     ORDER BY (customer_id = ?) DESC, is_default DESC, id ASC
     LIMIT 1`,
    [targetIds, cust.id]
  );
  if (defaultRows.length > 0) {
    return {
      cust,
      addressId: defaultRows[0].id,
      label: defaultRows[0].label,
      text: formatDeliveryAddressRow(defaultRows[0])
    };
  }

  return {
    cust,
    addressId: null,
    label: cust.address ? 'Sede Cliente' : null,
    text: cust.address || null
  };
}

async function generateBollaNumber(connection) {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const prefix = `BOL-${yy}${mm}${dd}-`;
  for (let attempt = 0; attempt < 15; attempt++) {
    const candidate = `${prefix}${Math.floor(1000 + Math.random() * 9000)}`;
    const [dup] = await connection.query('SELECT id FROM OUTBOUND_ORDERS WHERE bolla_number = ?', [candidate]);
    if (dup.length === 0) return candidate;
  }
  return `${prefix}${Date.now().toString().slice(-5)}`;
}

function computeOrderItemMetrics(item, orderStatus) {
  const qty = parseFloat(item.quantity_picked) > 0 ? parseFloat(item.quantity_picked) : parseFloat(item.quantity_required) || 0;
  const upb = parseFloat(item.units_per_box) || 1;
  const bpp = parseFloat(item.boxes_per_pallet) || 1;
  const uom = item.uom || item.requested_uom || item.base_uom || 'Pezzi';

  let deductionUnits = qty;
  if (uom === 'Scatole' || uom === 'Cartoni') deductionUnits = qty * upb;
  else if (uom === 'Bancali' || uom === 'Palette') deductionUnits = qty * upb * bpp;

  const palNet = item.net_weight_kg !== null && item.net_weight_kg !== undefined ? parseFloat(item.net_weight_kg) : null;
  const palGross = item.gross_weight_kg !== null && item.gross_weight_kg !== undefined ? parseFloat(item.gross_weight_kg) : null;
  const palQty = parseFloat(item.pallet_quantity) || 0;

  let ratio = 1;
  if (uom !== 'Bancali' && uom !== 'Palette' && orderStatus !== 'SHIPPED' && palQty > 0 && deductionUnits > 0 && deductionUnits < palQty) {
    ratio = Math.min(1, deductionUnits / palQty);
  }

  const netKg = palNet !== null && !isNaN(palNet) ? parseFloat((palNet * ratio).toFixed(2)) : null;
  const grossKg = palGross !== null && !isNaN(palGross) ? parseFloat((palGross * ratio).toFixed(2)) : null;

  return { qty, uom, upb, netKg, grossKg };
}

async function outboundRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  // GET /api/outbound - List orders (supports ?active_only=true, ?ready_only=true for Zebra and ?limit=... for long-term scale)
  fastify.get('/', async (request, reply) => {
    try {
      const { active_only, ready_only, limit } = request.query || {};
      const onlyActive = active_only === 'true' || active_only === '1';
      const onlyReady = ready_only === 'true' || ready_only === '1';
      const parsedLimit = limit ? Math.min(Math.max(parseInt(limit, 10) || 0, 1), 2000) : null;

      let sql = `
        SELECT o.id, o.order_code, o.customer_id, o.exit_date, o.status, o.client_ddt, o.notes,
               o.picking_operator, o.shipped_by, o.start_picking_at, o.end_picking_at, o.shipped_at,
               o.return_count, o.last_returned_at, o.last_returned_by, o.last_return_reason,
               o.generate_exit_ddt, o.bolla_number, o.bolla_generated_at,
               o.is_container, o.require_load_recheck, o.origin_warehouse_id, o.origin_warehouse_name, o.origin_warehouse_address,
               o.load_checkin_id, o.load_checkin_session_code, o.load_vehicle_plate, o.load_recorded_temp,
               o.load_hygiene_ok, o.load_strisciata_taken, o.load_completed_at, o.load_completed_by,
               o.delivery_address_id, o.delivery_label, o.delivery_address_text, o.bolla_options,
               o.created_by, o.created_at,
               c.business_name as customer_name,
               c.parent_id as customer_parent_id,
               pc.business_name as parent_customer_name,
               COALESCE(c.generate_exit_ddt, 1) as customer_generate_exit_ddt,
               COALESCE(agg.total_items, 0) as total_items,
               COALESCE(agg.picked_items, 0) as picked_items,
               COALESCE(agg.has_adr, 0) as has_adr,
               agg.temp_regimes,
               agg.warehouse_names,
               agg.batches,
               agg.products,
               agg.pallets,
               agg.client_pallets
        FROM OUTBOUND_ORDERS o
        JOIN CUSTOMERS c ON o.customer_id = c.id
        LEFT JOIN CUSTOMERS pc ON c.parent_id = pc.id
        LEFT JOIN (
          SELECT oi.order_id,
                 COUNT(*) as total_items,
                 SUM(CASE WHEN oi.status = 'PICKED' THEN 1 ELSE 0 END) as picked_items,
                 MAX(CASE WHEN COALESCE(pal.is_adr, 0) = 1 THEN 1 ELSE 0 END) as has_adr,
                 GROUP_CONCAT(DISTINCT NULLIF(TRIM(pal.temp_regime), '') SEPARATOR ',') as temp_regimes,
                 GROUP_CONCAT(DISTINCT NULLIF(TRIM(pal.warehouse), '') SEPARATOR ', ') as warehouse_names,
                 GROUP_CONCAT(DISTINCT NULLIF(TRIM(COALESCE(oi.batch, pal.batch)), '') SEPARATOR ', ') as batches,
                 GROUP_CONCAT(DISTINCT p.name SEPARATOR ', ') as products,
                 GROUP_CONCAT(DISTINCT oi.pallet_code SEPARATOR ', ') as pallets,
                 GROUP_CONCAT(DISTINCT NULLIF(TRIM(pal.client_pallet_number), '') SEPARATOR ', ') as client_pallets
          FROM OUTBOUND_ITEMS oi
          LEFT JOIN PRODUCTS p ON p.id = oi.product_id
          LEFT JOIN PALLETS pal ON pal.id = COALESCE(
            oi.pallet_id,
            (SELECT p2.id FROM PALLETS p2 WHERE p2.pallet_code = oi.pallet_code AND p2.product_id = oi.product_id ORDER BY p2.id ASC LIMIT 1)
          )
          GROUP BY oi.order_id
        ) agg ON agg.order_id = o.id
      `;
      const params = [];
      if (onlyReady) {
        sql += " WHERE o.status = 'READY'";
      } else if (onlyActive) {
        sql += " WHERE o.status IN ('PENDING', 'PICKING', 'RETURNED')";
      }
      sql += ' ORDER BY o.created_at DESC';
      if (parsedLimit) {
        sql += ' LIMIT ?';
        params.push(parsedLimit);
      }

      const [orders] = await db.query(sql, params);
      return orders.filter(o => canAccessCustomer(request.user, o.customer_id));
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore nel recupero degli ordini' });
    }
  });

  // POST /api/outbound - Create new order
  fastify.post('/', async (request, reply) => {
    const {
      customer_id,
      exit_date,
      items,
      client_ddt,
      notes,
      generate_exit_ddt,
      delivery_address_id = null,
      delivery_label = null,
      delivery_address_text = null,
      bolla_options = null,
      is_container = false,
      require_load_recheck = false,
      origin_warehouse_id = null,
      origin_warehouse_name = null,
      origin_warehouse_address = null
    } = request.body;
    if (!hasPermission(request.user, 'outbound_create')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di creare spedizioni.' });
    }
    if (customer_id && !canAccessCustomer(request.user, customer_id)) {
      return reply.code(403).send({ error: 'Accesso negato: non puoi creare spedizioni per questo cliente.' });
    }
    const connection = await db.getConnection();
    
    try {
      const result = await withNamedLock(connection, 'maglite_outbound_alloc', async () => {
        await connection.beginTransaction();
        try {
          let orderCode = '';
          const datePrefix = `OUT-${new Date().toISOString().slice(2,10).replace(/-/g, '')}-`;
          for (let attempt = 0; attempt < 10; attempt++) {
            const candidate = `${datePrefix}${Math.floor(1000 + Math.random() * 9000)}`;
            const [dup] = await connection.query('SELECT id FROM OUTBOUND_ORDERS WHERE order_code = ?', [candidate]);
            if (dup.length === 0) {
              orderCode = candidate;
              break;
            }
          }
          if (!orderCode) orderCode = `${datePrefix}${Date.now().toString().slice(-5)}`;
          
          const username = request.user?.username || 'SYSTEM';
          const cleanNotes = notes && String(notes).trim() !== '' ? String(notes).trim() : null;

          const deliveryData = await resolveCustomerDeliveryData(connection, customer_id, {
            delivery_address_id,
            delivery_label,
            delivery_address_text
          });
          const effectiveExitDdt = generate_exit_ddt !== undefined && generate_exit_ddt !== null
            ? (generate_exit_ddt === false || generate_exit_ddt === 0 || generate_exit_ddt === 'false' ? 0 : 1)
            : (deliveryData.cust ? Number(Boolean(deliveryData.cust.generate_exit_ddt)) : 1);
          const mergedOptions = parseBollaOptions(bolla_options);
          const allocatedItemsPOST = await allocateOutboundItems(items, connection);
          const firstPalId = allocatedItemsPOST.find(a => a.pallet_id)?.pallet_id || null;
          let fallbackWhId = null;
          if (!origin_warehouse_id && firstPalId) {
            const [[palWh]] = await connection.query('SELECT warehouse_id FROM PALLETS WHERE id = ?', [firstPalId]);
            if (palWh?.warehouse_id) fallbackWhId = palWh.warehouse_id;
          }
          const originWh = await resolveOriginWarehouse(connection, origin_warehouse_id, origin_warehouse_name, origin_warehouse_address, fallbackWhId);
          const isContainerFlag = (is_container === true || is_container === 1 || is_container === 'true') ? 1 : 0;
          const requireRecheckFlag = (require_load_recheck === true || require_load_recheck === 1 || require_load_recheck === 'true') ? 1 : 0;
          
          const [orderRes] = await connection.query(
            `INSERT INTO OUTBOUND_ORDERS
             (order_code, customer_id, exit_date, created_by, client_ddt, notes,
              generate_exit_ddt, is_container, require_load_recheck, origin_warehouse_id, origin_warehouse_name, origin_warehouse_address,
              delivery_address_id, delivery_label, delivery_address_text, bolla_options)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              orderCode,
              customer_id ?? null,
              exit_date ?? null,
              username,
              client_ddt ?? null,
              cleanNotes,
              effectiveExitDdt,
              isContainerFlag,
              requireRecheckFlag,
              originWh.id,
              originWh.name,
              originWh.address,
              deliveryData.addressId,
              deliveryData.label,
              deliveryData.text,
              JSON.stringify(mergedOptions)
            ]
          );
          const orderId = orderRes.insertId;

          for (const item of allocatedItemsPOST) {
            await connection.query(
              'INSERT INTO OUTBOUND_ITEMS (order_id, pallet_id, pallet_code, product_id, batch, quantity_required, requested_uom, requested_kg, kg_per_unit, client_pallet_number, is_specific) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [orderId, item.pallet_id ?? null, item.pallet_code ?? null, item.product_id ?? null, item.batch ?? null, item.quantity_required ?? null, item.requested_uom ?? null, item.requested_kg ?? null, item.kg_per_unit ?? null, item.client_pallet_number ?? null, item.is_specific ? 1 : 0]
            );
          }
          
          // Audit Log
          await connection.query(
            'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
            ['CREATE_OUTBOUND', `Creata spedizione ${orderCode}`, 'BACKOFFICE', username]
          );

          await connection.commit();
          return { orderId, orderCode, customerId: customer_id ?? null, username };
        } catch (txErr) {
          await connection.rollback();
          throw txErr;
        }
      });

      await createNotification(db, fastify.io, {
        type: 'ORDER_CREATED',
        title: `Nuovo Ordine ${result.orderCode}`,
        message: `${result.username} ha creato la spedizione ${result.orderCode}.`,
        customer_id: result.customerId,
        entity_type: 'OUTBOUND',
        entity_code: result.orderCode,
        link_path: '/desktop/outbound',
        actor_username: result.username
      });

      if (fastify.io) {
        fastify.io.emit('audit_log', {
          action: 'CREATE_OUTBOUND',
          details: `Creata spedizione ${result.orderCode}`,
          source: 'BACKOFFICE',
          username: result.username,
          created_at: new Date()
        });
        fastify.io.emit('outbound_updated');
        fastify.io.emit('inventory_updated');
        fastify.io.emit('dashboard_update');
      }

      return { success: true, id: result.orderId, order_id: result.orderId, order_code: result.orderCode };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(err.statusCode || 400).send({ error: err.message || "Errore nella creazione dell'ordine" });
    } finally {
      connection.release();
    }
  });

  // PUT /api/outbound/:id - Edit an outbound order
  fastify.put('/:id', async (request, reply) => {
    const { id } = request.params;
    const {
      customer_id,
      exit_date,
      items,
      client_ddt,
      notes,
      generate_exit_ddt,
      delivery_address_id,
      delivery_label,
      delivery_address_text,
      bolla_options,
      is_container,
      require_load_recheck,
      origin_warehouse_id,
      origin_warehouse_name,
      origin_warehouse_address
    } = request.body;
    
    if (!hasPermission(request.user, 'outbound_create')) {
      return reply.code(403).send({ error: 'Non autorizzato a modificare le spedizioni' });
    }
    if (customer_id && !canAccessCustomer(request.user, customer_id)) {
      return reply.code(403).send({ error: 'Accesso negato: non puoi operare sulle spedizioni di questo cliente.' });
    }

    const connection = await db.getConnection();
    try {
      const result = await withNamedLock(connection, 'maglite_outbound_alloc', async () => {
        await connection.beginTransaction();
        try {
          const [orders] = await connection.query('SELECT * FROM OUTBOUND_ORDERS WHERE id = ? FOR UPDATE', [id]);
          if (orders.length === 0) throw new Error('Ordine non trovato');
          if (orders[0].status === 'SHIPPED') throw new Error('Impossibile modificare un ordine già spedito. Registra prima il reso per poterlo modificare.');

          const cleanNotes = notes && String(notes).trim() !== '' ? String(notes).trim() : null;
          const prevOpts = parseBollaOptions(orders[0].bolla_options);
          const nextOpts = bolla_options ? parseBollaOptions({ ...prevOpts, ...bolla_options }) : prevOpts;

          let nextAddressId = orders[0].delivery_address_id;
          let nextLabel = orders[0].delivery_label;
          let nextAddrText = orders[0].delivery_address_text;
          if (delivery_address_id !== undefined || delivery_address_text !== undefined || Number(customer_id) !== Number(orders[0].customer_id)) {
            const deliveryData = await resolveCustomerDeliveryData(connection, customer_id, {
              delivery_address_id,
              delivery_label,
              delivery_address_text
            });
            nextAddressId = deliveryData.addressId;
            nextLabel = deliveryData.label;
            nextAddrText = deliveryData.text;
          }

          const nextExitDdt = generate_exit_ddt !== undefined && generate_exit_ddt !== null
            ? (generate_exit_ddt === false || generate_exit_ddt === 0 || generate_exit_ddt === 'false' ? 0 : 1)
            : (orders[0].generate_exit_ddt !== undefined && orders[0].generate_exit_ddt !== null ? Number(Boolean(orders[0].generate_exit_ddt)) : 1);

          const nextIsContainer = is_container !== undefined && is_container !== null
            ? (is_container === true || is_container === 1 || is_container === 'true' ? 1 : 0)
            : Number(Boolean(orders[0].is_container));
          const nextRequireRecheck = require_load_recheck !== undefined && require_load_recheck !== null
            ? (require_load_recheck === true || require_load_recheck === 1 || require_load_recheck === 'true' ? 1 : 0)
            : Number(Boolean(orders[0].require_load_recheck));

          let nextOriginWhId = orders[0].origin_warehouse_id;
          let nextOriginWhName = orders[0].origin_warehouse_name;
          let nextOriginWhAddr = orders[0].origin_warehouse_address;
          if (origin_warehouse_id !== undefined || origin_warehouse_name !== undefined || origin_warehouse_address !== undefined) {
            const whResolved = await resolveOriginWarehouse(connection, origin_warehouse_id, origin_warehouse_name, origin_warehouse_address);
            nextOriginWhId = whResolved.id;
            nextOriginWhName = whResolved.name;
            nextOriginWhAddr = whResolved.address;
          }

          await connection.query(
            `UPDATE OUTBOUND_ORDERS
             SET customer_id = ?, exit_date = ?, client_ddt = ?, notes = ?, status = "PENDING",
                 generate_exit_ddt = ?, is_container = ?, require_load_recheck = ?,
                 origin_warehouse_id = ?, origin_warehouse_name = ?, origin_warehouse_address = ?,
                 delivery_address_id = ?, delivery_label = ?, delivery_address_text = ?, bolla_options = ?
             WHERE id = ?`,
            [
              customer_id ?? null,
              exit_date ?? null,
              client_ddt ?? null,
              cleanNotes,
              nextExitDdt,
              nextIsContainer,
              nextRequireRecheck,
              nextOriginWhId,
              nextOriginWhName,
              nextOriginWhAddr,
              nextAddressId,
              nextLabel,
              nextAddrText,
              JSON.stringify(nextOpts),
              id
            ]
          );

          await connection.query('DELETE FROM OUTBOUND_ITEMS WHERE order_id = ?', [id]);

          const allocatedItemsPUT = await allocateOutboundItems(items, connection, id);
          for (const item of allocatedItemsPUT) {
            await connection.query(
              'INSERT INTO OUTBOUND_ITEMS (order_id, pallet_id, pallet_code, product_id, batch, quantity_required, requested_uom, requested_kg, kg_per_unit, client_pallet_number, is_specific) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [id, item.pallet_id ?? null, item.pallet_code ?? null, item.product_id ?? null, item.batch ?? null, item.quantity_required ?? null, item.requested_uom ?? null, item.requested_kg ?? null, item.kg_per_unit ?? null, item.client_pallet_number ?? null, item.is_specific ? 1 : 0]
            );
          }
          
          const orderCode = orders[0].order_code;
          const username = request.user?.username || 'SYSTEM';

          // Audit Log
          await connection.query(
            'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
            ['UPDATE_OUTBOUND', `Modificata spedizione ${orderCode}`, 'BACKOFFICE', username]
          );

          await connection.commit();
          return { orderCode, username };
        } catch (txErr) {
          await connection.rollback();
          throw txErr;
        }
      });

      if (fastify.io) {
        fastify.io.emit('audit_log', {
          action: 'UPDATE_OUTBOUND',
          details: `Modificata spedizione ${result.orderCode}`,
          source: 'BACKOFFICE',
          username: result.username,
          created_at: new Date()
        });
        fastify.io.emit('outbound_updated');
        fastify.io.emit('inventory_updated');
        fastify.io.emit('dashboard_update');
      }

      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(err.statusCode || 500).send({ error: err.message || "Errore nella modifica dell'ordine" });
    } finally {
      connection.release();
    }
  });

  // GET /api/outbound/:id/details - Get order details for editing
  fastify.get('/:id/details', async (request, reply) => {
    const { id } = request.params;
    try {
      const [orders] = await db.query(`
        SELECT o.*, c.business_name as customer_name, pc.business_name as parent_customer_name
        FROM OUTBOUND_ORDERS o
        LEFT JOIN CUSTOMERS c ON o.customer_id = c.id
        LEFT JOIN CUSTOMERS pc ON c.parent_id = pc.id
        WHERE o.id = ?
      `, [id]);
      if (orders.length === 0) return reply.code(404).send({ error: 'Ordine non trovato' });
      
      const [items] = await db.query(`
        SELECT i.*, p.name as product_name, p.uom as base_uom, COALESCE(i.batch, pal.batch) as batch, pal.location,
               pal.warehouse, pal.warehouse_id, COALESCE(pal.temp_regime, 'NONE') as temp_regime,
               COALESCE(pal.is_adr, 0) as is_adr, pal.adr_data,
               COALESCE(i.client_pallet_number, pal.client_pallet_number) as client_pallet_number
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

      let loadCheckin = null;
      if (orders[0].load_checkin_id) {
        const [[subRow]] = await db.query('SELECT * FROM CUSTOM_FORM_SUBMISSIONS WHERE id = ? LIMIT 1', [orders[0].load_checkin_id]);
        if (subRow) loadCheckin = subRow;
      }

      const opts = parseBollaOptions(orders[0].bolla_options);
      const compliance = summarizeOrderCompliance(items, opts);

      return { order: orders[0], items, load_checkin: loadCheckin, compliance };
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
        SELECT i.*, p.name as product_name, COALESCE(i.requested_uom, p.uom) as uom,
               COALESCE(pal.units_per_box, p.units_per_box, 1) as units_per_box,
               COALESCE(NULLIF(i.kg_per_unit, 0), NULLIF(pal.kg_per_unit, 0), p.kg_per_unit) as kg_per_unit,
               pal.location, COALESCE(i.client_pallet_number, pal.client_pallet_number) as client_pallet_number,
               COALESCE(i.batch, pal.batch) as batch, pal.expiration_date,
               COALESCE(loc.zone, '') as zone, COALESCE(loc.col, '') as col, COALESCE(loc.pos, '') as pos, loc.pin
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
        for (const it of items) {
          const coords = extractLocationCoords(it);
          it.zone = coords.zone || it.zone || '';
          it.col = coords.col || it.col || '';
          it.pos = coords.pos || it.pos || '';
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
        doc.image(logoPath, 40, 22, { fit: [215, 72] });
      } else {
        doc.fillColor('#192935').font('Helvetica-Bold').fontSize(24).text('LOGISTIC PORCELLI', 40, 35, { align: 'left' });
      }
      
      doc.fillColor('#64748b').fontSize(10).font('Helvetica').text('Magazzino e Logistica Avanzata', 340, 48, { align: 'right', width: 210 });
      doc.moveDown(4);

      // --- DOCUMENT TITLE ---
      doc.y = 104;
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
        const pdfKg = item.requested_kg || (item.kg_per_unit > 0 ? Number((parseFloat(item.quantity_required) * (item.uom === 'Scatole' ? (item.units_per_box || 1) : 1) * parseFloat(item.kg_per_unit)).toFixed(2)) : null);
        if (pdfKg) {
          qtyText += `\n(${pdfKg} kg)`;
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

  // PUT /api/outbound/:id/bolla-settings - Aggiorna opzioni legali, indirizzo consegna, magazzino origine, modalità container e genera numero bolla
  fastify.put('/:id/bolla-settings', async (request, reply) => {
    if (!hasPermission(request.user, 'outbound_create') && !hasPermission(request.user, 'outbound_pick')) {
      return reply.code(403).send({ error: 'Accesso negato: permesso insufficiente.' });
    }
    const { id } = request.params;
    const {
      generate_exit_ddt,
      delivery_address_id,
      delivery_label,
      delivery_address_text,
      bolla_options,
      generate_now = false,
      is_container,
      require_load_recheck,
      origin_warehouse_id,
      origin_warehouse_name,
      origin_warehouse_address
    } = request.body || {};

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [orders] = await connection.query('SELECT * FROM OUTBOUND_ORDERS WHERE id = ? FOR UPDATE', [id]);
      if (orders.length === 0) {
        await connection.rollback();
        return reply.code(404).send({ error: 'Ordine non trovato' });
      }
      const ord = orders[0];
      if (!canAccessCustomer(request.user, ord.customer_id)) {
        await connection.rollback();
        return reply.code(403).send({ error: 'Cliente non autorizzato' });
      }

      const prevOpts = parseBollaOptions(ord.bolla_options);
      const nextOpts = bolla_options ? parseBollaOptions({ ...prevOpts, ...bolla_options }) : prevOpts;
      if (!nextOpts.causale) nextOpts.causale = 'C/FINE DEPOSITO';

      let nextAddrId = ord.delivery_address_id;
      let nextLabel = ord.delivery_label;
      let nextAddrText = ord.delivery_address_text;

      if (delivery_address_id !== undefined || delivery_address_text !== undefined || delivery_label !== undefined) {
        if (delivery_address_id) {
          const [[addrRow]] = await connection.query('SELECT * FROM CUSTOMER_DELIVERY_ADDRESSES WHERE id = ?', [delivery_address_id]);
          if (addrRow) {
            nextAddrId = addrRow.id;
            nextLabel = delivery_label || addrRow.label;
            nextAddrText = (delivery_address_text && String(delivery_address_text).trim()) || formatDeliveryAddressRow(addrRow);
          }
        } else {
          nextAddrId = null;
          if (delivery_label !== undefined) nextLabel = delivery_label ? String(delivery_label).trim() : null;
          if (delivery_address_text !== undefined) nextAddrText = delivery_address_text ? String(delivery_address_text).trim() : null;
        }
      }

      const nextExitDdt = generate_exit_ddt !== undefined && generate_exit_ddt !== null
        ? (generate_exit_ddt === false || generate_exit_ddt === 0 || generate_exit_ddt === 'false' ? 0 : 1)
        : (ord.generate_exit_ddt !== undefined && ord.generate_exit_ddt !== null ? Number(Boolean(ord.generate_exit_ddt)) : 1);

      const nextIsContainer = is_container !== undefined && is_container !== null
        ? (is_container === true || is_container === 1 || is_container === 'true' ? 1 : 0)
        : Number(Boolean(ord.is_container));
      const nextRequireRecheck = require_load_recheck !== undefined && require_load_recheck !== null
        ? (require_load_recheck === true || require_load_recheck === 1 || require_load_recheck === 'true' ? 1 : 0)
        : Number(Boolean(ord.require_load_recheck));

      let nextOriginWhId = ord.origin_warehouse_id;
      let nextOriginWhName = ord.origin_warehouse_name;
      let nextOriginWhAddr = ord.origin_warehouse_address;
      if (origin_warehouse_id !== undefined || origin_warehouse_name !== undefined || origin_warehouse_address !== undefined) {
        const whResolved = await resolveOriginWarehouse(connection, origin_warehouse_id, origin_warehouse_name, origin_warehouse_address);
        nextOriginWhId = whResolved.id;
        nextOriginWhName = whResolved.name;
        nextOriginWhAddr = whResolved.address;
      }

      let bollaNumber = ord.bolla_number;
      let bollaGenAt = ord.bolla_generated_at;
      if ((generate_now || (nextExitDdt && ord.status === 'READY')) && !bollaNumber) {
        bollaNumber = await generateBollaNumber(connection);
        bollaGenAt = new Date();
      }

      await connection.query(
        `UPDATE OUTBOUND_ORDERS
         SET generate_exit_ddt = ?, is_container = ?, require_load_recheck = ?,
             origin_warehouse_id = ?, origin_warehouse_name = ?, origin_warehouse_address = ?,
             delivery_address_id = ?, delivery_label = ?, delivery_address_text = ?,
             bolla_options = ?, bolla_number = ?, bolla_generated_at = ?
         WHERE id = ?`,
        [
          nextExitDdt,
          nextIsContainer,
          nextRequireRecheck,
          nextOriginWhId,
          nextOriginWhName,
          nextOriginWhAddr,
          nextAddrId,
          nextLabel,
          nextAddrText,
          JSON.stringify(nextOpts),
          bollaNumber,
          bollaGenAt,
          ord.id
        ]
      );

      await connection.commit();
      if (fastify.io) {
        fastify.io.emit('outbound_updated');
      }
      return {
        success: true,
        bolla_number: bollaNumber,
        bolla_generated_at: bollaGenAt,
        is_container: Boolean(nextIsContainer),
        require_load_recheck: Boolean(nextRequireRecheck),
        origin_warehouse_id: nextOriginWhId,
        origin_warehouse_name: nextOriginWhName,
        origin_warehouse_address: nextOriginWhAddr,
        delivery_address_id: nextAddrId,
        delivery_label: nextLabel,
        delivery_address_text: nextAddrText,
        bolla_options: nextOpts,
        generate_exit_ddt: Boolean(nextExitDdt)
      };
    } catch (err) {
      await connection.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore salvataggio opzioni Bolla di Uscita' });
    } finally {
      connection.release();
    }
  });

  // GET /api/outbound/:code/bolla-pdf - Documento di Trasporto / Bolla di Uscita valida per camionisti
  fastify.get('/:code/bolla-pdf', async (request, reply) => {
    const { code } = request.params;
    const connection = await db.getConnection();
    try {
      const [orders] = await connection.query(`
        SELECT o.*,
               c.business_name as customer_name, c.vat_number as customer_vat,
               c.address as customer_address, c.phone as customer_phone, c.email as customer_email,
               c.parent_id as customer_parent_id,
               pc.business_name as parent_customer_name, pc.vat_number as parent_customer_vat, pc.address as parent_customer_address,
               COALESCE(c.generate_exit_ddt, 1) as customer_generate_exit_ddt
        FROM OUTBOUND_ORDERS o
        JOIN CUSTOMERS c ON o.customer_id = c.id
        LEFT JOIN CUSTOMERS pc ON c.parent_id = pc.id
        WHERE o.order_code = ? OR o.bolla_number = ?
      `, [code, code]);

      if (orders.length === 0) return reply.code(404).send({ error: 'Ordine o Bolla non trovati' });
      const order = orders[0];
      if (!canAccessCustomer(request.user, order.customer_id)) {
        return reply.code(403).send({ error: 'Accesso negato per questo cliente.' });
      }

      if (!order.bolla_number) {
        const newBolla = await generateBollaNumber(connection);
        await connection.query(
          'UPDATE OUTBOUND_ORDERS SET bolla_number = ?, bolla_generated_at = COALESCE(bolla_generated_at, CURRENT_TIMESTAMP) WHERE id = ?',
          [newBolla, order.id]
        );
        order.bolla_number = newBolla;
        order.bolla_generated_at = new Date();
      }

      if (!order.delivery_address_text) {
        const resolved = await resolveCustomerDeliveryData(connection, order.customer_id, {});
        order.delivery_label = resolved.label || 'Sede Cliente';
        order.delivery_address_text = resolved.text || order.customer_address || '';
      }

      const [settingsRows] = await connection.query('SELECT setting_key, setting_value FROM settings');
      const company = {};
      settingsRows.forEach(r => { company[r.setting_key] = r.setting_value; });

      const [items] = await connection.query(`
        SELECT i.*, p.name as product_name, p.sku, p.uom as base_uom,
               COALESCE(pal.units_per_box, p.units_per_box, 1) as units_per_box,
               COALESCE(p.boxes_per_pallet, 1) as boxes_per_pallet,
               COALESCE(NULLIF(i.kg_per_unit, 0), NULLIF(pal.kg_per_unit, 0), p.kg_per_unit) as kg_per_unit,
               COALESCE(i.requested_uom, pal.pallet_uom, p.uom) as uom,
               pal.quantity as pallet_quantity,
               pal.warehouse as pallet_warehouse,
               pal.warehouse_id as pallet_warehouse_id,
               COALESCE(pal.temp_regime, 'NONE') as temp_regime,
               COALESCE(pal.is_adr, 0) as is_adr,
               pal.adr_data,
               COALESCE(pal.net_weight_kg, (
                 SELECT idt.net_weight_kg FROM INBOUND_DDT_ITEMS idt
                 WHERE idt.inbound_ddt_id = pal.inbound_ddt_id AND idt.product_id = pal.product_id
                 ORDER BY idt.id DESC LIMIT 1
               )) as net_weight_kg,
               COALESCE(pal.gross_weight_kg, (
                 SELECT idt.gross_weight_kg FROM INBOUND_DDT_ITEMS idt
                 WHERE idt.inbound_ddt_id = pal.inbound_ddt_id AND idt.product_id = pal.product_id
                 ORDER BY idt.id DESC LIMIT 1
               )) as gross_weight_kg,
               COALESCE(i.client_pallet_number, pal.client_pallet_number) as client_pallet_number,
               COALESCE(i.batch, pal.batch) as batch, pal.expiration_date
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
        ORDER BY i.id ASC
      `, [order.id]);

      const firstPalWhId = items.find(i => i.pallet_warehouse_id)?.pallet_warehouse_id || null;
      const originWh = await resolveOriginWarehouse(
        connection,
        order.origin_warehouse_id,
        order.origin_warehouse_name,
        order.origin_warehouse_address,
        firstPalWhId
      );

      const opts = parseBollaOptions(order.bolla_options);
      const compliance = summarizeOrderCompliance(items, opts);
      const barcodeValue = order.bolla_number || order.order_code;
      const barcodeBuffer = await bwipjs.toBuffer({
        bcid: 'code128',
        text: barcodeValue,
        scale: 3,
        height: 11,
        includetext: true,
        textxalign: 'center'
      });

      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 24, bottom: 16, left: 36, right: 36 },
        bufferPages: true
      });
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `inline; filename="BOLLA_${barcodeValue}.pdf"`);
      reply.send(doc);

      const fs = require('fs');
      const path = require('path');
      const logoPath = path.join(__dirname, '../../../frontend/public/logo_scuro.png');
      const marginX = 36;
      const contentWidth = 523; // 595.28 - 72
      const safePageBottom = 792;

      // Top dark navy accent bar
      doc.rect(0, 0, 595.28, 9).fill('#0f172a');

      // --- HEADER: LOGO + MITTENTE (SX) vs TITOLO + BARCODE (DX) ---
      const rightW = 216;
      const rightX = marginX + contentWidth - rightW;
      let logoEndX = marginX;
      if (company.company_logo && String(company.company_logo).startsWith('data:image')) {
        try {
          const base64Part = String(company.company_logo).split(',')[1];
          const imgBuf = Buffer.from(base64Part, 'base64');
          doc.image(imgBuf, marginX, 16, { fit: [128, 62] });
          logoEndX = marginX + 136;
        } catch (_) {}
      } else if (fs.existsSync(logoPath)) {
        doc.image(logoPath, marginX, 16, { fit: [128, 62] });
        logoEndX = marginX + 136;
      }

      const emitterW = Math.max(115, rightX - logoEndX - 8);
      const emitterTitle = (company.company_name || 'MAGAZZINO LOGISTICA').toUpperCase();
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(10.5)
        .text(emitterTitle, logoEndX, 18, { width: emitterW });
      let emitterY = doc.y + 2;
      doc.fillColor('#475569').font('Helvetica').fontSize(7.6);
      if (company.company_address) {
        doc.text(`Partenza: ${company.company_address}`, logoEndX, emitterY, { width: emitterW });
        emitterY = doc.y + 1.5;
      }
      const fiscalLine = [company.company_piva ? `P.IVA ${company.company_piva}` : '', company.company_cf ? `CF ${company.company_cf}` : ''].filter(Boolean).join(' • ');
      if (fiscalLine) {
        doc.text(fiscalLine, logoEndX, emitterY, { width: emitterW });
        emitterY = doc.y + 1.5;
      }
      const contactLine = [company.company_phone ? `Tel: ${company.company_phone}` : '', company.company_email || ''].filter(Boolean).join(' • ');
      if (contactLine) {
        doc.text(contactLine, logoEndX, emitterY, { width: emitterW });
        emitterY = doc.y;
      }

      // Header Right: Titolo Documento + Numero + Barcode Code128
      const issueDt = order.bolla_generated_at ? new Date(order.bolla_generated_at) : new Date();
      const metaHeaderLine = `Emessa: ${issueDt.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })} | Ordine: ${order.order_code}`;
      const metaHeaderH = doc.font('Helvetica').fontSize(6.9).heightOfString(metaHeaderLine, { width: rightW - 14 });
      const rightBoxH = Math.max(84, 48 + metaHeaderH + 40);

      doc.roundedRect(rightX, 16, rightW, rightBoxH, 6).fillAndStroke('#f8fafc', '#cbd5e1');
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(9.2)
        .text('DOCUMENTO DI TRASPORTO (D.D.T.)', rightX + 7, 22, { width: rightW - 14, align: 'center' });
      doc.fillColor('#0284c7').font('Helvetica-Bold').fontSize(8.4)
        .text(`BOLLA DI USCITA N° ${order.bolla_number}`, rightX + 7, 34, { width: rightW - 14, align: 'center' });
      doc.fillColor('#475569').font('Helvetica').fontSize(6.9)
        .text(metaHeaderLine, rightX + 7, 46, { width: rightW - 14, align: 'center' });
      doc.image(barcodeBuffer, rightX + 14, 46 + metaHeaderH + 4, { width: rightW - 28, height: 36 });

      let cursorY = Math.max(emitterY + 10, logoEndX > marginX ? 86 : 0, 16 + rightBoxH + 10);

      // --- BANNER SPUNTA NORMATIVE / ALLERTE TRASPORTO AUTO-RILEVATE DALLE PALETTE ---
      const activeAlerts = [];
      if (order.is_container) activeAlerts.push('MODALITÀ TRASPORTO: CARICO CONTAINER');
      if (compliance.isAdr) {
        activeAlerts.push(`MERCE PERICOLOSA ADR: ${compliance.adrDescriptions.join('  •  ')}`);
      }
      compliance.tempRegimes.forEach(tr => {
        const meta = TEMP_REGIME_MAP[tr];
        if (meta && tr !== 'NONE') activeAlerts.push(meta.shortLabel.toUpperCase());
      });

      if (activeAlerts.length > 0) {
        const alertText = `ATTENZIONE TRASPORTO:  ${activeAlerts.join('   |   ')}`;
        const alertTextH = doc.font('Helvetica-Bold').fontSize(8.0).heightOfString(alertText, { width: contentWidth - 18 });
        const alertBoxH = Math.max(22, alertTextH + 12);
        doc.roundedRect(marginX, cursorY, contentWidth, alertBoxH, 4).fillAndStroke('#fef2f2', '#ef4444');
        doc.fillColor('#b91c1c').font('Helvetica-Bold').fontSize(8.0)
          .text(alertText, marginX + 9, cursorY + 6, { width: contentWidth - 18 });
        cursorY += alertBoxH + 8;
      }

      if (compliance.mixedColdWarning) {
        const mixText = 'AVVISO OPERATIVO: Nel carico sono presenti bancali a temperatura 2/8°C e 15/25°C insieme — verificare compartimentazione.';
        const mixH = Math.max(20, doc.font('Helvetica-Bold').fontSize(7.6).heightOfString(mixText, { width: contentWidth - 18 }) + 10);
        doc.roundedRect(marginX, cursorY, contentWidth, mixH, 4).fillAndStroke('#fff7ed', '#f97316');
        doc.fillColor('#9a3412').font('Helvetica-Bold').fontSize(7.6)
          .text(mixText, marginX + 9, cursorY + 5, { width: contentWidth - 18 });
        cursorY += mixH + 8;
      }

      // --- 2 COLONNE RESPONSIVE: DEPOSITANTE + DEPOSITARIO vs LUOGO DI DESTINAZIONE ---
      const colW = (contentWidth - 10) / 2;
      const innerColW = colW - 18;

      const emitterName = company.company_name || 'MagLite Logistica';
      const emitterLegalAddr = company.company_address || 'Sede Legale Depositario';
      const originLine = `Inizio Trasporto (${originWh.name}): ${originWh.address || emitterLegalAddr}`;
      const emitterSub = `${emitterLegalAddr}\n${originLine}`;

      const depositanteName = (order.parent_customer_name || order.customer_name || '').toUpperCase();
      const depositanteBranch = order.parent_customer_name && order.parent_customer_name !== order.customer_name
        ? `Divisione/Rif: ${order.customer_name}`
        : '';
      const depositanteVat = order.parent_customer_vat || order.customer_vat;
      const custSubLine = [
        depositanteBranch,
        depositanteVat ? `P.IVA: ${depositanteVat}` : '',
        order.client_ddt ? `Rif. DDT: ${order.client_ddt}` : ''
      ].filter(Boolean).join(' • ') || '-';

      const emitterNameH = doc.font('Helvetica-Bold').fontSize(8.2).heightOfString(emitterName, { width: innerColW });
      const emitterAddrH = doc.font('Helvetica').fontSize(7.3).heightOfString(emitterSub, { width: innerColW });
      const custNameH = doc.font('Helvetica-Bold').fontSize(8.2).heightOfString(depositanteName || '-', { width: innerColW });
      const custSubH = doc.font('Helvetica').fontSize(7.1).heightOfString(custSubLine, { width: innerColW });
      const leftTopPartH = 15 + emitterNameH + 2 + emitterAddrH + 6;
      const leftBottomPartH = 14 + custNameH + 2 + custSubH + 7;
      const leftTotalH = leftTopPartH + leftBottomPartH;

      const delivTitle = order.delivery_label || order.customer_name || 'Sede Destinatario';
      const delivAddr = order.delivery_address_text || order.customer_address || 'Da concordare con il destinatario';
      const exitDtStr = order.exit_date ? new Date(order.exit_date).toLocaleDateString('it-IT') : '-';
      const causaleText = 'C/FINE DEPOSITO';
      const transportModeLabel = order.is_container ? 'CONTAINER' : 'CAMION';
      const delivMeta = `Data Prevista Uscita: ${exitDtStr}  |  Mezzo: ${transportModeLabel}\nCAUSALE CONSEGNA: ${causaleText}`;

      const delivTitleH = doc.font('Helvetica-Bold').fontSize(8.6).heightOfString(delivTitle, { width: innerColW });
      const delivAddrH = doc.font('Helvetica').fontSize(7.7).heightOfString(delivAddr, { width: innerColW });
      const delivMetaH = doc.font('Helvetica-Bold').fontSize(7.2).heightOfString(delivMeta, { width: innerColW });
      const rightTotalH = 17 + delivTitleH + 3 + delivAddrH + 8 + delivMetaH + 7;

      const destBoxH = Math.max(leftTotalH, rightTotalH, 86);

      // Box Sinistra: DEPOSITARIO (nostra sede + luogo inizio trasporto) & DEPOSITANTE (cliente madre)
      doc.roundedRect(marginX, cursorY, colW, destBoxH, 5).fillAndStroke('#ffffff', '#cbd5e1');
      let ly = cursorY + 7;
      doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(6.8)
        .text('DEPOSITARIO / LUOGO INIZIO TRASPORTO', marginX + 9, ly, { width: innerColW });
      ly += 9;
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(8.2)
        .text(emitterName, marginX + 9, ly, { width: innerColW });
      ly += emitterNameH + 2;
      doc.fillColor('#334155').font('Helvetica').fontSize(7.3)
        .text(emitterSub, marginX + 9, ly, { width: innerColW });
      ly += emitterAddrH + 5;
      doc.moveTo(marginX + 9, ly).lineTo(marginX + colW - 9, ly).lineWidth(0.5).strokeColor('#e2e8f0').stroke();
      ly += 5;
      doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(6.8)
        .text('DEPOSITANTE (CLIENTE TITOLARE)', marginX + 9, ly, { width: innerColW });
      ly += 9;
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(8.2)
        .text(depositanteName || '-', marginX + 9, ly, { width: innerColW });
      ly += custNameH + 2;
      doc.fillColor('#475569').font('Helvetica').fontSize(7.1)
        .text(custSubLine, marginX + 9, ly, { width: innerColW });

      // Box Destra: Luogo di Destinazione / Consegna + CAUSALE C/FINE DEPOSITO
      const destX = marginX + colW + 10;
      doc.roundedRect(destX, cursorY, colW, destBoxH, 5).fillAndStroke('#f0f9ff', '#38bdf8');
      let ry = cursorY + 7;
      doc.fillColor('#0369a1').font('Helvetica-Bold').fontSize(6.8)
        .text('LUOGO DI DESTINAZIONE', destX + 9, ry, { width: innerColW });
      ry += 10;
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(8.6)
        .text(delivTitle, destX + 9, ry, { width: innerColW });
      ry += delivTitleH + 3;
      doc.fillColor('#1e293b').font('Helvetica').fontSize(7.7)
        .text(delivAddr, destX + 9, ry, { width: innerColW });
      const metaY = Math.max(ry + delivAddrH + 6, cursorY + destBoxH - delivMetaH - 7);
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(7.2)
        .text(delivMeta, destX + 9, metaY, { width: innerColW });

      cursorY += destBoxH + 10;

      // --- TABELLA ARTICOLI, LOTTI, BANCALI E PESI ---
      const colDefs = [
        { x: marginX + 6, w: 176, label: 'ARTICOLO / DESCRIZIONE' },
        { x: marginX + 185, w: 78, label: 'LOTTO / SCAD.' },
        { x: marginX + 266, w: 78, label: 'PALETTA / RIF.' },
        { x: marginX + 347, w: 74, label: 'Q.TÀ / UDM' },
        { x: marginX + 424, w: 46, label: 'KG NETTI', align: 'right' },
        { x: marginX + 472, w: 45, label: 'KG LORDI', align: 'right' }
      ];

      const drawGoodsHeader = (yPos) => {
        doc.rect(marginX, yPos, contentWidth, 20).fill('#0f172a');
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.2);
        colDefs.forEach(col => {
          doc.text(col.label, col.x, yPos + 6.5, { width: col.w, align: col.align || 'left', lineBreak: false });
        });
      };

      drawGoodsHeader(cursorY);
      cursorY += 23;

      let totalNetKg = 0;
      let totalGrossKg = 0;
      let hasAnyNet = false;
      let hasAnyGross = false;
      const uniquePallets = new Set();
      let explicitPalletUomSum = 0;

      items.forEach((item, idx) => {
        const { qty, uom, upb, netKg, grossKg } = computeOrderItemMetrics(item, order.status);
        if (netKg !== null) { totalNetKg += netKg; hasAnyNet = true; }
        if (grossKg !== null) { totalGrossKg += grossKg; hasAnyGross = true; }

        if (uom === 'Bancali' || uom === 'Palette') {
          explicitPalletUomSum += qty;
        } else if (item.pallet_code) {
          uniquePallets.add(item.pallet_code);
        }

        const prodBaseTitle = item.sku ? `${item.product_name} [${item.sku}]` : item.product_name;
        const rowMetaLines = [];
        const normTemp = normalizeTempRegime(item.temp_regime);
        if (normTemp !== 'NONE' && TEMP_REGIME_MAP[normTemp]) {
          rowMetaLines.push(TEMP_REGIME_MAP[normTemp].shortLabel);
        }
        if (item.is_adr) {
          const parsedAdr = parseAdrData(item.adr_data);
          const adrText = parsedAdr?.formatted_description || parsedAdr?.un_number || 'ADR';
          rowMetaLines.push(`ADR: ${adrText}`);
        }
        const prodTitle = rowMetaLines.length > 0 ? `${prodBaseTitle}\n${rowMetaLines.join(' | ')}` : prodBaseTitle;
        const expStr = item.expiration_date ? `\nScad: ${new Date(item.expiration_date).toLocaleDateString('it-IT')}` : '';
        const batchText = `${item.batch || '-'}${expStr}`;
        const palStr = (item.pallet_code || '').startsWith('NOBAR-') ? 'Senza Bar.' : (item.pallet_code || '-');
        const palDisplay = item.client_pallet_number ? `${palStr}\nRif: ${item.client_pallet_number}` : palStr;

        let qtyDisplay = `${qty} ${uom}`;
        if (upb > 1 && uom !== 'Scatole' && uom !== 'Cartoni' && uom !== 'Bancali' && uom !== 'Palette') {
          const boxes = Math.floor(qty / upb);
          const loose = qty % upb;
          if (boxes > 0) qtyDisplay = `${qty} ${uom}\n(${boxes} sc.${loose > 0 ? `+${loose}` : ''})`;
        } else if (upb > 1 && (uom === 'Scatole' || uom === 'Cartoni')) {
          qtyDisplay = `${qty} ${uom}\n(${qty * upb} pz)`;
        }

        const prodH = doc.font('Helvetica-Bold').fontSize(7.9).heightOfString(prodTitle, { width: colDefs[0].w });
        const batchH = doc.font('Helvetica').fontSize(7.4).heightOfString(batchText, { width: colDefs[1].w });
        const palH = doc.font('Helvetica').fontSize(7.3).heightOfString(palDisplay, { width: colDefs[2].w });
        const qtyH = doc.font('Helvetica-Bold').fontSize(7.7).heightOfString(qtyDisplay, { width: colDefs[3].w });
        const rowH = Math.max(22, prodH, batchH, palH, qtyH) + 8;

        if (cursorY + rowH > safePageBottom - 25) {
          doc.addPage();
          cursorY = 28;
          drawGoodsHeader(cursorY);
          cursorY += 23;
        }

        if (idx % 2 === 1) {
          doc.rect(marginX, cursorY - 2, contentWidth, rowH).fill('#f8fafc');
        }

        doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(7.9)
          .text(prodTitle, colDefs[0].x, cursorY + 2, { width: colDefs[0].w });
        doc.fillColor('#334155').font('Helvetica').fontSize(7.4)
          .text(batchText, colDefs[1].x, cursorY + 2, { width: colDefs[1].w });
        doc.fillColor('#0f172a').font('Helvetica').fontSize(7.3)
          .text(palDisplay, colDefs[2].x, cursorY + 2, { width: colDefs[2].w });
        doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(7.7)
          .text(qtyDisplay, colDefs[3].x, cursorY + 2, { width: colDefs[3].w });

        doc.fillColor('#334155').font('Helvetica').fontSize(7.9)
          .text(netKg !== null ? `${netKg.toFixed(2)}` : '-', colDefs[4].x, cursorY + 2, { width: colDefs[4].w, align: 'right' });
        doc.text(grossKg !== null ? `${grossKg.toFixed(2)}` : '-', colDefs[5].x, cursorY + 2, { width: colDefs[5].w, align: 'right' });

        doc.moveTo(marginX, cursorY + rowH - 2).lineTo(marginX + contentWidth, cursorY + rowH - 2).lineWidth(0.4).strokeColor('#e2e8f0').stroke();
        cursorY += rowH;
      });

      const totalPallets = uniquePallets.size + explicitPalletUomSum;
      const estimatedPallets = totalPallets > 0 ? totalPallets : (items.length > 0 ? items.length : 0);

      cursorY += 10;

      // --- RIEPILOGO COLLI, BANCALI, PESI E TRASPORTO (altezza dinamica) ---
      const sumCols = [
        { label: 'TOTALE BANCALI', val: `${Number.isInteger(estimatedPallets) ? estimatedPallets : estimatedPallets.toFixed(1)}` },
        { label: 'RIGHE / ARTICOLI', val: `${items.length}` },
        { label: 'KG NETTI TOTALI', val: hasAnyNet ? `${totalNetKg.toFixed(2)} kg` : 'N.D.' },
        { label: 'KG LORDI TOTALI', val: hasAnyGross ? `${totalGrossKg.toFixed(2)} kg` : 'N.D.' },
        { label: 'PORTO / ASPETTO', val: `${opts.porto || 'Franco'} - ${opts.aspetto_beni || 'Bancali'}` }
      ];
      const cellW = contentWidth / sumCols.length;
      const maxSumValH = Math.max(
        ...sumCols.map(sc => doc.font('Helvetica-Bold').fontSize(8.6).heightOfString(sc.val, { width: cellW - 14 }))
      );
      const sumBoxH = Math.max(44, 22 + maxSumValH + 8);
      if (cursorY + sumBoxH > safePageBottom) {
        doc.addPage();
        cursorY = 28;
      }

      doc.roundedRect(marginX, cursorY, contentWidth, sumBoxH, 5).fillAndStroke('#f1f5f9', '#cbd5e1');
      sumCols.forEach((sc, i) => {
        const cx = marginX + i * cellW + 7;
        doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(6.5).text(sc.label, cx, cursorY + 8, { width: cellW - 14 });
        doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(8.6).text(sc.val, cx, cursorY + 19, { width: cellW - 14 });
      });
      cursorY += sumBoxH + 8;

      // Vettore / Targa / Note Operative
      if (opts.carrier_name || opts.vehicle_plate || opts.transport_notes || order.notes) {
        const infoParts = [];
        if (opts.carrier_name) infoParts.push(`Vettore: ${opts.carrier_name}`);
        if (opts.vehicle_plate) infoParts.push(`Targa Mezzo: ${opts.vehicle_plate}`);
        if (order.notes) infoParts.push(`Note Spedizione: ${order.notes}`);
        if (opts.transport_notes) infoParts.push(`Note Trasporto: ${opts.transport_notes}`);
        const txt = infoParts.join('   |   ');
        const h = Math.max(24, doc.font('Helvetica').fontSize(7.6).heightOfString(txt, { width: contentWidth - 16 }) + 12);
        if (cursorY + h > safePageBottom) {
          doc.addPage();
          cursorY = 28;
        }
        doc.roundedRect(marginX, cursorY, contentWidth, h, 4).fillAndStroke('#ffffff', '#cbd5e1');
        doc.fillColor('#1e293b').font('Helvetica').fontSize(7.6).text(txt, marginX + 8, cursorY + 6, { width: contentWidth - 16 });
        cursorY += h + 8;
      }

      // --- NOTE LEGALI AUTO-GENERATE DALLE PALETTE + CLAUSOLE STANDARD ---
      const legalClauses = [];
      if (compliance.isAdr) {
        legalClauses.push(`• NORMATIVA ADR (${compliance.adrDescriptions.join('; ')}): Merce classificata ADR soggetta ad accordi internazionali su strada. Il trasportatore dichiara di disporre di idoneo equipaggiamento, pannelli arancio e documentazione ADR a bordo.`);
      }
      compliance.tempRegimes.forEach(tr => {
        const meta = TEMP_REGIME_MAP[tr];
        if (meta && tr !== 'NONE') {
          legalClauses.push(`• ${meta.legalClause}`);
        }
      });
      if (opts.legal_intact_goods) {
        legalClauses.push('• INTEGRITÀ COLLI: Merce imballata a regola d\'arte, pallettizzata e regolarmente etichettata al momento dell\'uscita dal magazzino.');
      }
      if (opts.legal_driver_check) {
        legalClauses.push('• VERIFICA CONDUCENTE: Con la sottoscrizione il conducente dichiara di aver controllato il numero dei bancali/colli e il loro stato apparente esterno senza riserve.');
      }
      if (opts.legal_transport_norm) {
        legalClauses.push('• RIFERIMENTI LEGALI AUTOTRASPORTO: Documento emesso ai sensi del D.P.R. 472/96 (Causale: C/FINE DEPOSITO) e valido ai fini delle disposizioni sull\'autotrasporto merci conto terzi (D.Lgs. 286/2005 e s.m.i.).');
      }

      if (legalClauses.length > 0) {
        const clausesText = legalClauses.join('\n');
        const cTextH = doc.font('Helvetica').fontSize(7.1).heightOfString(clausesText, { width: contentWidth - 18 });
        const cHeight = Math.max(36, cTextH + 24);
        if (cursorY + cHeight > safePageBottom) {
          doc.addPage();
          cursorY = 28;
        }
        doc.roundedRect(marginX, cursorY, contentWidth, cHeight, 4).fillAndStroke('#fffbeb', '#f59e0b');
        doc.fillColor('#92400e').font('Helvetica-Bold').fontSize(7.4).text('DICHIARAZIONI E CLAUSOLE LEGALI DI TRASPORTO:', marginX + 9, cursorY + 6, { width: contentWidth - 18 });
        doc.fillColor('#1e293b').font('Helvetica').fontSize(7.1).text(clausesText, marginX + 9, cursorY + 17, { width: contentWidth - 18 });
        cursorY += cHeight + 10;
      }

      // --- BOX FIRME (3 COLONNE) ---
      const sigBoxH = 54;
      if (cursorY + sigBoxH > safePageBottom) {
        doc.addPage();
        cursorY = 28;
      }
      const sigW = (contentWidth - 16) / 3;
      const sigTitles = [
        'FIRMA MITTENTE / MAGAZZINIERE',
        'FIRMA CONDUCENTE (VETTORE)',
        'FIRMA DESTINATARIO (RICEZIONE)'
      ];
      sigTitles.forEach((title, idx) => {
        const sx = marginX + idx * (sigW + 8);
        doc.roundedRect(sx, cursorY, sigW, sigBoxH, 4).fillAndStroke('#ffffff', '#94a3b8');
        doc.fillColor('#475569').font('Helvetica-Bold').fontSize(6.6)
          .text(title, sx + 6, cursorY + 7, { width: sigW - 12, align: 'center', lineBreak: false });
        doc.moveTo(sx + 12, cursorY + 37).lineTo(sx + sigW - 12, cursorY + 37).lineWidth(0.5).strokeColor('#cbd5e1').stroke();
        doc.fillColor('#94a3b8').font('Helvetica').fontSize(6.3)
          .text('Data / Ora: ____/____/______  ____:____', sx + 6, cursorY + 41, { width: sigW - 12, align: 'center', lineBreak: false });
      });

      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);
        doc.fillColor('#64748b').font('Helvetica').fontSize(7)
          .text(`${company.company_name || 'MagLite Logistica'} • Bolla ${order.bolla_number} (Ordine ${order.order_code})`, marginX, 810, { width: 360, lineBreak: false })
          .text(`Pagina ${i + 1} di ${pages.count}`, marginX, 810, { width: contentWidth, align: 'right', lineBreak: false });
      }

      doc.end();
      return reply;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore generazione Bolla di Uscita PDF' });
    } finally {
      connection.release();
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
        SELECT o.*, c.business_name as customer_name, c.address as customer_address,
               COALESCE(c.generate_exit_ddt, 1) as customer_generate_exit_ddt
        FROM OUTBOUND_ORDERS o
        LEFT JOIN CUSTOMERS c ON o.customer_id = c.id
        WHERE o.order_code = ? OR o.bolla_number = ?
      `, [code, code]);
      if (orders.length === 0) return reply.code(404).send({ error: 'Ordine o Bolla non trovati' });
      const order = orders[0];
      order.bolla_options_parsed = parseBollaOptions(order.bolla_options);

      if (order.status === 'SHIPPED') {
        return reply.code(400).send({ error: 'Ordine già spedito' });
      }
      await consolidateLocationPallets(db);

      const [items] = await db.query(`
        SELECT i.*, p.name as product_name, p.sku, p.uom as base_uom,
               COALESCE(pal.client_article_number, p.sku) as article_code,
               COALESCE(pal.units_per_box, p.units_per_box, 1) as units_per_box,
               COALESCE(p.boxes_per_pallet, 1) as boxes_per_pallet,
               COALESCE(NULLIF(i.kg_per_unit, 0), NULLIF(pal.kg_per_unit, 0), p.kg_per_unit) as kg_per_unit,
               COALESCE(i.requested_uom, pal.pallet_uom, p.uom) as uom,
               pal.location, pal.warehouse as pallet_warehouse, COALESCE(pal.warehouse_id, 1) as pallet_warehouse_id,
               COALESCE(pal.temp_regime, 'NONE') as temp_regime, COALESCE(pal.is_adr, 0) as is_adr, pal.adr_data,
               COALESCE(i.client_pallet_number, pal.client_pallet_number) as client_pallet_number, pal.quantity as pallet_quantity,
               COALESCE(pal.net_weight_kg, (
                 SELECT idt.net_weight_kg FROM INBOUND_DDT_ITEMS idt
                 WHERE idt.inbound_ddt_id = pal.inbound_ddt_id AND idt.product_id = pal.product_id
                 ORDER BY idt.id DESC LIMIT 1
               )) as net_weight_kg,
               COALESCE(pal.gross_weight_kg, (
                 SELECT idt.gross_weight_kg FROM INBOUND_DDT_ITEMS idt
                 WHERE idt.inbound_ddt_id = pal.inbound_ddt_id AND idt.product_id = pal.product_id
                 ORDER BY idt.id DESC LIMIT 1
               )) as gross_weight_kg,
               COALESCE(i.batch, pal.batch) as batch, pal.expiration_date,
               COALESCE(loc.zone, '') as zone, COALESCE(loc.col, '') as col, COALESCE(loc.pos, '') as pos, loc.pin as loc_pin
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

      const activeWhId = request.query?.warehouse_id ? Number(request.query.warehouse_id) : null;
      const otherWhItems = activeWhId ? items.filter(it => Number(it.pallet_warehouse_id || 1) !== activeWhId) : [];
      order.wrong_warehouse_count = otherWhItems.length;

      const connection = await db.getConnection();
      try {
        const { zonePriority, posPriority } = await getRoutingSettings(connection);
        for (const it of items) {
          const coords = extractLocationCoords(it);
          it.zone = coords.zone || it.zone || '';
          it.col = coords.col || it.col || '';
          it.pos = coords.pos || it.pos || '';
        }
        sortPickingTour(items, zonePriority, posPriority);
      } finally {
        connection.release();
      }

      const currentOperator = String(request.user?.username || 'ZEBRA').trim();
      const existingOperator = String(order.picking_operator || '').trim();
      const isDifferentOperator = !existingOperator || existingOperator.toLowerCase() !== currentOperator.toLowerCase();
      let alreadyInProgress = order.status === 'PICKING' && isDifferentOperator;

      // Imposta in PICKING se era PENDING
      if (order.status === 'PENDING') {
        const [updRes] = await db.query(
          'UPDATE OUTBOUND_ORDERS SET status = "PICKING", picking_operator = COALESCE(picking_operator, ?) WHERE id = ? AND status = "PENDING"',
          [currentOperator, order.id]
        );
        if (updRes.affectedRows > 0) {
          order.status = 'PICKING';
          order.picking_operator = order.picking_operator || currentOperator;
          if (fastify.io) {
            fastify.io.emit('outbound_updated');
            fastify.io.emit('dashboard_update');
          }
        } else {
          const [freshOrders] = await db.query('SELECT status, picking_operator FROM OUTBOUND_ORDERS WHERE id = ?', [order.id]);
          if (freshOrders.length > 0) {
            order.status = freshOrders[0].status;
            order.picking_operator = freshOrders[0].picking_operator;
            const freshOp = String(freshOrders[0].picking_operator || '').trim();
            alreadyInProgress = order.status === 'PICKING' && (!freshOp || freshOp.toLowerCase() !== currentOperator.toLowerCase());
          }
        }
      }

      return { order, items, already_in_progress: alreadyInProgress };
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
    const connection = await db.getConnection();
    try {
      const outcome = await withNamedLock(connection, 'maglite_outbound_pick', async () => {
        await connection.beginTransaction();
        try {
          // Verifica item e blocca la riga ordine + item FOR UPDATE per evitare doppio prelievo concorrente
          const [ordersLock] = await connection.query(
            `SELECT o.id, o.order_code, o.customer_id, o.status, o.start_picking_at, o.generate_exit_ddt, o.bolla_number,
                    COALESCE(c.generate_exit_ddt, 1) AS customer_generate_exit_ddt
             FROM OUTBOUND_ORDERS o
             JOIN CUSTOMERS c ON o.customer_id = c.id
             WHERE o.id = ? FOR UPDATE`,
            [order_id]
          );
          if (ordersLock.length === 0) {
            await connection.rollback();
            return { status: 404, body: { error: 'Ordine non trovato' } };
          }
          if (ordersLock[0].status === 'SHIPPED') {
            await connection.rollback();
            return { status: 409, body: { error: 'Ordine già spedito da un altro operatore.' } };
          }

          const [items] = await connection.query(`
            SELECT i.*, pal.id as resolved_pallet_id,
                   COALESCE(i.client_pallet_number, pal.client_pallet_number) as client_pallet_number,
                   pal.location, pal.is_quarantined, pal.quarantine_reason, loc.pin as loc_pin, pr.name as product_name
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
            FOR UPDATE
          `, [item_id, order_id]);

          if (items.length === 0) {
            await connection.rollback();
            return { status: 404, body: { error: 'Riga ordine non trovata' } };
          }
          const item = items[0];
          if (item.status === 'PICKED') {
            await connection.rollback();
            return { status: 409, body: { error: 'Questa riga è già stata prelevata da un altro operatore.' } };
          }
          if (item.is_quarantined) {
            await connection.rollback();
            return { status: 403, body: { error: `BLOCCO QUARANTENA: La paletta ${item.pallet_code} è in quarantena (${item.quarantine_reason || 'Bloccata'}) e non può essere prelevata!` } };
          }

          // Verifica Barcode Paletta con controllo giacenza e prenotazioni
          const scannedCode = String(pallet_code || '').trim();
          const scannedLower = scannedCode.toLowerCase();
          const itemPalletCode = String(item.pallet_code || '').trim().toLowerCase();
          const itemClientPallet = String(item.client_pallet_number || '').trim().toLowerCase();

          let isSamePalletScan = (scannedLower === itemPalletCode) || (itemClientPallet !== '' && scannedLower === itemClientPallet);
          let actualPalletId = item.resolved_pallet_id;

          if (!isSamePalletScan) {
            const [scannedPallets] = await connection.query(
              'SELECT id, pallet_code, client_pallet_number, product_id, batch, status, location, quantity, is_quarantined, quarantine_reason FROM PALLETS WHERE (pallet_code = ? OR client_pallet_number = ?) AND status != "SHIPPED" FOR UPDATE',
              [scannedCode, scannedCode]
            );

            if (scannedPallets.length === 0) {
              await connection.rollback();
              return { status: 404, body: { error: 'Paletta non trovata o già spedita.' } };
            }

            const altPallet = scannedPallets[0];

            // Se la paletta scansionata corrisponde fisicamente alla stessa assegnata (es. trovata tramite client_pallet_number)
            if (item.resolved_pallet_id && altPallet.id === item.resolved_pallet_id) {
              isSamePalletScan = true;
              actualPalletId = altPallet.id;
            } else {
              // Se la riga richiede una paletta specifica, non è consentito scambiarla
              if (item.is_specific) {
                await connection.rollback();
                const specificLabel = item.client_pallet_number 
                  ? `${item.pallet_code} (Rif. Cliente: ${item.client_pallet_number})`
                  : item.pallet_code;
                return {
                  status: 400,
                  body: { error: `Questa riga richiede specificamente la paletta ${specificLabel}. Non è consentito prelevare una paletta differente.` }
                };
              }

              if (altPallet.is_quarantined) {
                await connection.rollback();
                return { status: 403, body: { error: `BLOCCO QUARANTENA: La paletta ${altPallet.pallet_code} è in quarantena (${altPallet.quarantine_reason || 'Bloccata'}) e non può essere prelevata!` } };
              }

              const isSameBatch = ((altPallet.batch || '').trim().toUpperCase() === (item.batch || '').trim().toUpperCase()) || (!altPallet.batch && !item.batch);
              if (altPallet.product_id !== item.product_id || !isSameBatch) {
                await connection.rollback();
                return { status: 400, body: { error: 'Codice Paletta errato: Articolo o Lotto non corrispondente alla riga ordine.' } };
              }

              // Verifica disponibilità giacenza sufficiente sulla paletta alternativa
              const availableQty = parseFloat(altPallet.quantity) || 0;
              const requiredQty = parseFloat(qty_picked) || 0;
              if (availableQty < requiredQty) {
                await connection.rollback();
                return { status: 400, body: { error: `Giacenza insufficiente sulla paletta scansionata (${availableQty} disponibili contro ${requiredQty} richiesti).` } };
              }

              // Verifica che la paletta non sia già prenotata da un altro ordine Outbound aperto
              const [reserved] = await connection.query(
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
                await connection.rollback();
                return {
                  status: 400,
                  body: { error: `La paletta ${altPallet.pallet_code} è già prenotata per l'ordine ${reserved[0].order_code || ('#' + reserved[0].order_id)}.` }
                };
              }

              actualPalletId = altPallet.id;
              await connection.query('UPDATE OUTBOUND_ITEMS SET pallet_id = ?, pallet_code = ? WHERE id = ?', [
                actualPalletId,
                altPallet.pallet_code,
                item_id
              ]);
              item.pallet_code = altPallet.pallet_code;
            }
          }

          if (isSamePalletScan && actualPalletId) {
            const [[origPallet]] = await connection.query('SELECT quantity FROM PALLETS WHERE id = ? FOR UPDATE', [actualPalletId]);
            if (origPallet && parseFloat(origPallet.quantity) < parseFloat(qty_picked)) {
              await connection.rollback();
              return {
                status: 400,
                body: { error: `Giacenza insufficiente sulla paletta (${origPallet.quantity} disponibili contro ${qty_picked} richiesti).` }
              };
            }
          }

          // Aggiorna Riga Ordine
          await connection.query(
            'UPDATE OUTBOUND_ITEMS SET quantity_picked = ?, pallet_id = COALESCE(pallet_id, ?), status = "PICKED", picked_at = CURRENT_TIMESTAMP WHERE id = ?',
            [qty_picked, actualPalletId || null, item_id]
          );

          // Log Audit Zebra
          const operator = request.user?.username || 'ZEBRA';
          await connection.query(
            'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
            [
              'OUTBOUND_PICK',
              `Prelevati ${qty_picked} di ${item.product_name} dalla paletta ${item.pallet_code}`,
              'ZEBRA',
              operator
            ]
          );

          const orderCode = ordersLock[0]?.order_code || `ID-${order_id}`;
          if (!ordersLock[0].start_picking_at) {
            await connection.query('UPDATE OUTBOUND_ORDERS SET start_picking_at = CURRENT_TIMESTAMP, picking_operator = COALESCE(picking_operator, ?) WHERE id = ?', [operator, order_id]);
          } else {
            await connection.query('UPDATE OUTBOUND_ORDERS SET picking_operator = COALESCE(picking_operator, ?) WHERE id = ?', [operator, order_id]);
          }

          let shelfFreed = false;
          const targetRemPalletId = actualPalletId || item.resolved_pallet_id;
          if (targetRemPalletId) {
            const [[remRow]] = await connection.query(`
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
            `, [targetRemPalletId]);

            if (remRow && parseFloat(remRow.remaining_on_shelf) <= 0) {
              const loadingLocation = `ZONA CARICO (${orderCode})`;
              if (remRow.location !== loadingLocation) {
                const prevLoc = remRow.location || 'NESSUNA';
                await connection.query('UPDATE PALLETS SET location = ? WHERE id = ?', [loadingLocation, remRow.id]);
                await connection.query(
                  'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
                  [
                    'STOW',
                    `Paletta ${remRow.pallet_code} spostata da ${prevLoc} a ${loadingLocation} (scaffale liberato in picking)`,
                    'ZEBRA',
                    operator
                  ]
                );
                shelfFreed = true;
              }
            }
          }

          // Controllo se l'intero ordine è pronto
          const [all_items] = await connection.query('SELECT status FROM OUTBOUND_ITEMS WHERE order_id = ?', [order_id]);
          const allPicked = all_items.every(i => i.status === 'PICKED');
          
          let generatedBollaNumber = ordersLock[0]?.bolla_number || null;
          if (allPicked) {
            const custEnabled = Boolean(ordersLock[0]?.customer_generate_exit_ddt ?? 1);
            const orderEnabled = ordersLock[0]?.generate_exit_ddt === undefined || ordersLock[0]?.generate_exit_ddt === null ? true : Boolean(ordersLock[0].generate_exit_ddt);
            const shouldGenBolla = custEnabled && orderEnabled;

            if (shouldGenBolla && !generatedBollaNumber) {
              generatedBollaNumber = await generateBollaNumber(connection);
              await connection.query(
                'UPDATE OUTBOUND_ORDERS SET status = "READY", end_picking_at = CURRENT_TIMESTAMP, bolla_number = ?, bolla_generated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [generatedBollaNumber, order_id]
              );
              await connection.query(
                'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
                ['GENERATE_EXIT_BOLLA', `Generata automaticamente Bolla di Uscita ${generatedBollaNumber} per ordine ${orderCode}`, 'ZEBRA', operator]
              );
            } else {
              await connection.query('UPDATE OUTBOUND_ORDERS SET status = "READY", end_picking_at = CURRENT_TIMESTAMP WHERE id = ?', [order_id]);
            }
          }

          await connection.commit();
          return {
            status: 200,
            shelfFreed,
            allPicked,
            orderCode,
            bollaNumber: generatedBollaNumber,
            customerId: ordersLock[0]?.customer_id || null,
            operator,
            body: { success: true, all_picked: allPicked, bolla_number: generatedBollaNumber }
          };
        } catch (txErr) {
          await connection.rollback();
          throw txErr;
        }
      });

      if (outcome.status !== 200) {
        return reply.code(outcome.status).send(outcome.body);
      }

      if (outcome.allPicked) {
        await createNotification(db, fastify.io, {
          type: 'ORDER_COMPLETED',
          title: outcome.bollaNumber ? `Spedizione Pronta + Bolla ${outcome.bollaNumber}` : `Picking Completato: ${outcome.orderCode}`,
          message: outcome.bollaNumber
            ? `L'operatore ${outcome.operator} ha completato il prelievo di ${outcome.orderCode}. Bolla di Uscita ${outcome.bollaNumber} generata automaticamente e pronta per il carico.`
            : `L'operatore ${outcome.operator} ha completato il prelievo di ${outcome.orderCode} su Zebra (Pronto per spedizione).`,
          customer_id: outcome.customerId,
          entity_type: 'OUTBOUND',
          entity_code: outcome.orderCode,
          link_path: '/desktop/outbound',
          actor_username: outcome.operator
        });
      }

      if (fastify.io) {
        if (outcome.shelfFreed) {
          fastify.io.emit('stow_updated');
          fastify.io.emit('locations_updated');
        }
        fastify.io.emit('outbound_updated');
        fastify.io.emit('inventory_updated');
        fastify.io.emit('dashboard_update');
      }

      return outcome.body;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(err.statusCode || 500).send({ error: err.message || 'Errore registrazione prelievo' });
    } finally {
      connection.release();
    }
  });

  // POST /api/outbound/:code/confirm - Finalize order from PC
  fastify.post('/:code/confirm', async (request, reply) => {
    if (!hasPermission(request.user, 'outbound_pick') && !hasPermission(request.user, 'outbound_create')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di confermare l\'uscita della spedizione.' });
    }
    const { code } = request.params;
    const { recheck_completed = false, rechecked_items = 0, vehicle_plate = '', driver_notes = '', source = 'BACKOFFICE' } = request.body || {};
    const connection = await db.getConnection();
    
    try {
      await connection.beginTransaction();

      const [orders] = await connection.query('SELECT * FROM OUTBOUND_ORDERS WHERE order_code = ? OR bolla_number = ? FOR UPDATE', [code, code]);
      if (orders.length === 0) throw new Error('Ordine o Bolla non trovati');
      const order = orders[0];

      if (order.status === 'SHIPPED') {
        const conflictErr = new Error('L\'ordine è già stato confermato e spedito da un altro operatore.');
        conflictErr.statusCode = 409;
        throw conflictErr;
      }

      const [items] = await connection.query('SELECT * FROM OUTBOUND_ITEMS WHERE order_id = ? FOR UPDATE', [order.id]);

      await deductOutboundOrderStock(connection, order, items, request.user?.username || 'SYSTEM', source === 'ZEBRA' ? 'ZEBRA' : 'BACKOFFICE');

      const [[custRow]] = await connection.query('SELECT COALESCE(generate_exit_ddt, 1) AS generate_exit_ddt FROM CUSTOMERS WHERE id = ?', [order.customer_id]);
      const custEnabled = Boolean(custRow?.generate_exit_ddt ?? 1);
      const orderEnabled = order.generate_exit_ddt === undefined || order.generate_exit_ddt === null ? true : Boolean(order.generate_exit_ddt);
      const shouldGenBolla = custEnabled && orderEnabled;

      let finalBollaNumber = order.bolla_number || null;
      let finalBollaGenAt = order.bolla_generated_at || null;
      if (shouldGenBolla && !finalBollaNumber) {
        finalBollaNumber = await generateBollaNumber(connection);
        finalBollaGenAt = new Date();
      }

      const nextBollaOpts = parseBollaOptions(order.bolla_options);
      if (vehicle_plate && String(vehicle_plate).trim()) nextBollaOpts.vehicle_plate = String(vehicle_plate).trim();
      if (driver_notes && String(driver_notes).trim()) nextBollaOpts.transport_notes = [nextBollaOpts.transport_notes, String(driver_notes).trim()].filter(Boolean).join(' | ');
      if (recheck_completed) {
        nextBollaOpts.rechecked_at = new Date().toISOString();
        nextBollaOpts.rechecked_by = request.user?.username || 'SYSTEM';
        nextBollaOpts.rechecked_items = Number(rechecked_items) || items.length;
      }

      if (!order.start_picking_at) {
        await connection.query(
          'UPDATE OUTBOUND_ORDERS SET status = "SHIPPED", shipped_at = CURRENT_TIMESTAMP, start_picking_at = CURRENT_TIMESTAMP, end_picking_at = CURRENT_TIMESTAMP, picking_operator = ?, shipped_by = ?, bolla_number = ?, bolla_generated_at = ?, bolla_options = ? WHERE id = ?',
          [request.user?.username || 'SYSTEM', request.user?.username || 'SYSTEM', finalBollaNumber, finalBollaGenAt, JSON.stringify(nextBollaOpts), order.id]
        );
        await connection.query('UPDATE OUTBOUND_ITEMS SET picked_at = CURRENT_TIMESTAMP WHERE order_id = ? AND picked_at IS NULL', [order.id]);
      } else {
        await connection.query(
          'UPDATE OUTBOUND_ORDERS SET status = "SHIPPED", shipped_at = CURRENT_TIMESTAMP, shipped_by = ?, bolla_number = ?, bolla_generated_at = ?, bolla_options = ? WHERE id = ?',
          [request.user?.username || 'SYSTEM', finalBollaNumber, finalBollaGenAt, JSON.stringify(nextBollaOpts), order.id]
        );
      }

      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        [
          'SHIP_OUTBOUND',
          `Spedizione ${order.order_code}${finalBollaNumber ? ` (Bolla ${finalBollaNumber})` : ''} segnata come SPEDITA${recheck_completed ? ` con ricontrollo (${rechecked_items || items.length} righe)` : ''}${vehicle_plate ? ` • Targa: ${vehicle_plate}` : ''}`,
          source === 'ZEBRA' ? 'ZEBRA' : 'BACKOFFICE',
          request.user?.username || 'SYSTEM'
        ]
      );

      await connection.commit();
      connection.release();

      await createNotification(db, fastify.io, {
        type: 'ORDER_COMPLETED',
        title: `Ordine Spedito: ${order.order_code}`,
        message: `${request.user?.username || 'SYSTEM'} ha confermato la partenza della spedizione ${order.order_code}${finalBollaNumber ? ` (Bolla ${finalBollaNumber})` : ''}.`,
        customer_id: order.customer_id,
        entity_type: 'OUTBOUND',
        entity_code: order.order_code,
        link_path: '/desktop/outbound',
        actor_username: request.user?.username || 'SYSTEM'
      });

      if (fastify.io) {
        fastify.io.emit('outbound_updated');
        fastify.io.emit('inventory_updated');
        fastify.io.emit('locations_updated');
        fastify.io.emit('stow_updated');
        fastify.io.emit('dashboard_update');
      }

      return { success: true, order_code: order.order_code, bolla_number: finalBollaNumber };
    } catch (err) {
      if (connection) {
        await connection.rollback();
        connection.release();
      }
      fastify.log.error(err);
      return reply.code(err.statusCode || 400).send({ error: err.message || 'Errore durante la conferma spedizione' });
    }
  });

  // GET /api/outbound/bolla-lookup/:code - Cerca bolla / ordine per Modulo Zebra Carico Camion / Container (CARICO_USCITA)
  fastify.get('/bolla-lookup/:code', async (request, reply) => {
    if (!hasPermission(request.user, 'access_zebra')) {
      return reply.code(403).send({ error: 'Accesso negato a Zebra.' });
    }
    const cleanCode = decodeURIComponent(request.params.code || '').trim();
    if (!cleanCode) return reply.code(400).send({ error: 'Codice Bolla o Spedizione obbligatorio.' });

    try {
      const [orders] = await db.query(`
        SELECT o.*, c.business_name as customer_name, pc.business_name as parent_customer_name
        FROM OUTBOUND_ORDERS o
        JOIN CUSTOMERS c ON o.customer_id = c.id
        LEFT JOIN CUSTOMERS pc ON c.parent_id = pc.id
        WHERE o.bolla_number = ? OR o.order_code = ?
        LIMIT 1
      `, [cleanCode, cleanCode]);

      if (orders.length === 0) {
        return reply.code(404).send({ error: `Nessuna Bolla o Spedizione trovata con codice "${cleanCode}".` });
      }
      const order = orders[0];
      if (!canAccessCustomer(request.user, order.customer_id)) {
        return reply.code(403).send({ error: 'Cliente non autorizzato.' });
      }

      const [items] = await db.query(`
        SELECT i.id, i.pallet_id, i.pallet_code, i.product_id, COALESCE(i.batch, pal.batch) as batch,
               i.quantity_required, i.quantity_picked, COALESCE(i.requested_uom, pal.pallet_uom, p.uom) as uom,
               COALESCE(i.client_pallet_number, pal.client_pallet_number) as client_pallet_number,
               p.name as product_name, p.sku,
               pal.warehouse as pallet_warehouse, COALESCE(pal.warehouse_id, 1) as pallet_warehouse_id,
               COALESCE(pal.temp_regime, 'NONE') as temp_regime, COALESCE(pal.is_adr, 0) as is_adr, pal.adr_data
        FROM OUTBOUND_ITEMS i
        JOIN PRODUCTS p ON i.product_id = p.id
        LEFT JOIN PALLETS pal ON pal.id = COALESCE(
          i.pallet_id,
          (SELECT p2.id FROM PALLETS p2 WHERE p2.pallet_code = i.pallet_code AND p2.product_id = i.product_id ORDER BY p2.id ASC LIMIT 1)
        )
        WHERE i.order_id = ?
        ORDER BY i.id ASC
      `, [order.id]);

      const opts = parseBollaOptions(order.bolla_options);
      const compliance = summarizeOrderCompliance(items, opts);

      const uniqueBarcodes = Array.from(new Set(
        items.map(it => it.pallet_code).filter(c => c && !String(c).startsWith('NOBAR-'))
      ));

      return {
        order: {
          ...order,
          bolla_options_parsed: opts,
          is_container: Boolean(order.is_container),
          require_load_recheck: Boolean(order.require_load_recheck)
        },
        items,
        unique_barcodes: uniqueBarcodes,
        compliance: {
          ...compliance,
          temp_labels: compliance.tempRegimes.map(tr => TEMP_REGIME_MAP[tr]?.label || tr)
        }
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore ricerca Bolla per carico mezzo' });
    }
  });

  // POST /api/outbound/:code/bolla-complete-loading - Registra Modulo Carico Camion/Container & spedisce ordine
  fastify.post('/:code/bolla-complete-loading', async (request, reply) => {
    if (!hasPermission(request.user, 'access_zebra')) {
      return reply.code(403).send({ error: 'Accesso negato a Zebra.' });
    }
    const cleanCode = decodeURIComponent(request.params.code || '').trim();
    const {
      vehicle_type,
      vehicle_plate,
      seal_number = '',
      carrier_name = '',
      hygiene_ok = true,
      hygiene_notes = '',
      recorded_temp = '',
      strisciata_taken = false,
      driver_present = true,
      recheck_scanned_barcodes = [],
      warehouse_id = null,
      warehouse_name = null,
      division_name = null,
      notes = ''
    } = request.body || {};

    if (!vehicle_plate || !String(vehicle_plate).trim()) {
      return reply.code(400).send({ error: 'Inserisci la targa del camion o il codice del container.' });
    }
    if (!hygiene_ok) {
      return reply.code(400).send({ error: 'Le condizioni igienico-sanitarie devono essere conformi per procedere al carico.' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [orders] = await connection.query(
        'SELECT * FROM OUTBOUND_ORDERS WHERE bolla_number = ? OR order_code = ? FOR UPDATE',
        [cleanCode, cleanCode]
      );
      if (orders.length === 0) {
        await connection.rollback();
        return reply.code(404).send({ error: 'Bolla o Ordine non trovati' });
      }
      const order = orders[0];
      if (!canAccessCustomer(request.user, order.customer_id)) {
        await connection.rollback();
        return reply.code(403).send({ error: 'Cliente non autorizzato.' });
      }

      const [items] = await connection.query(`
        SELECT oi.*, pal.temp_regime, pal.is_adr, pal.adr_data
        FROM OUTBOUND_ITEMS oi
        LEFT JOIN PALLETS pal ON pal.id = COALESCE(
          oi.pallet_id,
          (SELECT p2.id FROM PALLETS p2 WHERE p2.pallet_code = oi.pallet_code AND p2.product_id = oi.product_id ORDER BY p2.id ASC LIMIT 1)
        )
        WHERE oi.order_id = ? FOR UPDATE
      `, [order.id]);

      const opts = parseBollaOptions(order.bolla_options);
      const compliance = summarizeOrderCompliance(items, opts);

      if (compliance.needsTempCheck && (!recorded_temp && recorded_temp !== 0)) {
        await connection.rollback();
        return reply.code(400).send({ error: 'Spedizione a temperatura controllata: inserisci la temperatura rilevata del camion/container.' });
      }
      if (compliance.needsTempCheck && !strisciata_taken) {
        await connection.rollback();
        return reply.code(400).send({ error: 'Conferma di aver ritirato la strisciata / stampata termografica dal conducente prima di chiudere il carico.' });
      }

      const expectedBarcodes = Array.from(new Set(
        items.map(it => String(it.pallet_code || '').trim().toUpperCase()).filter(c => c && !c.startsWith('NOBAR-'))
      ));
      const scannedSet = new Set(
        (Array.isArray(recheck_scanned_barcodes) ? recheck_scanned_barcodes : []).map(b => String(b).trim().toUpperCase())
      );

      if (order.require_load_recheck && expectedBarcodes.length > 0) {
        const missing = expectedBarcodes.filter(b => !scannedSet.has(b));
        if (missing.length > 0) {
          await connection.rollback();
          return reply.code(400).send({
            error: `Ri-verifica carico richiesta dall'ufficio: mancano ${missing.length} bancali da scansionare (${missing.slice(0, 3).join(', ')}).`
          });
        }
      }

      const username = request.user?.username || 'ZEBRA';
      const effectiveVehicleType = vehicle_type || (order.is_container ? 'CONTAINER' : 'CAMION');
      const cleanPlate = String(vehicle_plate).trim().toUpperCase();

      // Inserisci log permanente in CUSTOM_FORM_SUBMISSIONS (CARICO_USCITA)
      const [[formRow]] = await connection.query("SELECT id FROM CUSTOM_FORMS WHERE code = 'CARICO_USCITA' LIMIT 1");
      const sessCode = `CAR-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
      const formAnswers = {
        bolla_number: order.bolla_number || order.order_code,
        order_code: order.order_code,
        vehicle_type: effectiveVehicleType,
        vehicle_plate: cleanPlate,
        seal_number: String(seal_number || '').trim() || null,
        carrier_name: String(carrier_name || '').trim() || opts.carrier_name || null,
        hygiene_ok: Boolean(hygiene_ok),
        hygiene_notes: String(hygiene_notes || '').trim() || null,
        needs_temp_check: compliance.needsTempCheck,
        temp_regimes: compliance.tempRegimes,
        recorded_temp: recorded_temp !== '' && recorded_temp !== null ? String(recorded_temp).trim() : null,
        strisciata_taken: Boolean(strisciata_taken),
        driver_present: Boolean(driver_present),
        is_adr: compliance.isAdr,
        adr_descriptions: compliance.adrDescriptions,
        require_load_recheck: Boolean(order.require_load_recheck),
        recheck_scanned_barcodes: Array.from(scannedSet),
        recheck_count: scannedSet.size,
        expected_barcodes_count: expectedBarcodes.length,
        warehouse_id: warehouse_id ? Number(warehouse_id) : order.origin_warehouse_id,
        warehouse_name: warehouse_name || order.origin_warehouse_name || null,
        division_name: division_name || null,
        notes: String(notes || '').trim() || null
      };

      let submissionId = order.load_checkin_id || null;
      if (formRow) {
        const [subRes] = await connection.query(
          `INSERT INTO CUSTOM_FORM_SUBMISSIONS
           (form_id, session_code, status, current_step_id, operator_id, operator_name, answers, metadata, completed_at)
           VALUES (?, ?, 'COMPLETED', 'step_done', ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [
            formRow.id,
            sessCode,
            request.user?.id || null,
            username,
            JSON.stringify(formAnswers),
            JSON.stringify({ order_id: order.id, order_code: order.order_code, bolla_number: order.bolla_number, customer_id: order.customer_id })
          ]
        );
        submissionId = subRes.insertId;
      }

      // Scarica magazzino solo se non già spedito in precedenza
      let newlyShipped = false;
      if (order.status !== 'SHIPPED') {
        await deductOutboundOrderStock(connection, order, items, username, 'ZEBRA');
        newlyShipped = true;
      }

      const [[custRow]] = await connection.query('SELECT COALESCE(generate_exit_ddt, 1) AS generate_exit_ddt FROM CUSTOMERS WHERE id = ?', [order.customer_id]);
      const shouldGenBolla = Boolean(custRow?.generate_exit_ddt ?? 1) && (order.generate_exit_ddt === null ? true : Boolean(order.generate_exit_ddt));
      let finalBollaNumber = order.bolla_number || null;
      let finalBollaGenAt = order.bolla_generated_at || null;
      if (shouldGenBolla && !finalBollaNumber) {
        finalBollaNumber = await generateBollaNumber(connection);
        finalBollaGenAt = new Date();
      }

      const nextBollaOpts = parseBollaOptions(order.bolla_options);
      nextBollaOpts.vehicle_plate = cleanPlate;
      if (carrier_name && String(carrier_name).trim()) nextBollaOpts.carrier_name = String(carrier_name).trim();
      if (seal_number && String(seal_number).trim()) nextBollaOpts.seal_number = String(seal_number).trim();
      if (order.require_load_recheck || scannedSet.size > 0) {
        nextBollaOpts.rechecked_at = new Date().toISOString();
        nextBollaOpts.rechecked_by = username;
        nextBollaOpts.rechecked_items = scannedSet.size || expectedBarcodes.length;
      }

      await connection.query(
        `UPDATE OUTBOUND_ORDERS
         SET status = 'SHIPPED',
             shipped_at = COALESCE(shipped_at, CURRENT_TIMESTAMP),
             start_picking_at = COALESCE(start_picking_at, CURRENT_TIMESTAMP),
             end_picking_at = COALESCE(end_picking_at, CURRENT_TIMESTAMP),
             picking_operator = COALESCE(picking_operator, ?),
             shipped_by = COALESCE(shipped_by, ?),
             bolla_number = ?,
             bolla_generated_at = ?,
             bolla_options = ?,
             load_checkin_id = ?,
             load_checkin_session_code = ?,
             load_vehicle_plate = ?,
             load_recorded_temp = ?,
             load_hygiene_ok = ?,
             load_strisciata_taken = ?,
             load_completed_at = CURRENT_TIMESTAMP,
             load_completed_by = ?
         WHERE id = ?`,
        [
          username,
          username,
          finalBollaNumber,
          finalBollaGenAt,
          JSON.stringify(nextBollaOpts),
          submissionId,
          sessCode,
          cleanPlate,
          formAnswers.recorded_temp,
          hygiene_ok ? 1 : 0,
          strisciata_taken ? 1 : 0,
          username,
          order.id
        ]
      );
      if (newlyShipped) {
        await connection.query('UPDATE OUTBOUND_ITEMS SET picked_at = CURRENT_TIMESTAMP WHERE order_id = ? AND picked_at IS NULL', [order.id]);
      }

      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        [
          'CARICO_MEZZO_COMPLETATO',
          `Carico ${effectiveVehicleType} (${cleanPlate}) per ${order.order_code}${finalBollaNumber ? ` / ${finalBollaNumber}` : ''} (${sessCode})${formAnswers.recorded_temp ? ` • Temp: ${formAnswers.recorded_temp}°C` : ''}${strisciata_taken ? ' • Strisciata ritirata' : ''}${order.require_load_recheck ? ` • Ricontrollo barcode: ${scannedSet.size}/${expectedBarcodes.length}` : ''}`,
          'ZEBRA',
          username
        ]
      );

      await connection.commit();
      connection.release();

      await createNotification(db, fastify.io, {
        type: 'ORDER_COMPLETED',
        title: `Carico ${effectiveVehicleType} Completato: ${order.order_code}`,
        message: `${username} ha completato il controllo carico (${cleanPlate}, modulo ${sessCode}) e chiuso la spedizione ${order.order_code}.`,
        customer_id: order.customer_id,
        entity_type: 'OUTBOUND',
        entity_code: order.order_code,
        link_path: '/desktop/outbound',
        actor_username: username
      });

      if (fastify.io) {
        fastify.io.emit('outbound_updated');
        fastify.io.emit('inventory_updated');
        fastify.io.emit('locations_updated');
        fastify.io.emit('dashboard_update');
      }

      return {
        success: true,
        order_code: order.order_code,
        bolla_number: finalBollaNumber,
        session_code: sessCode,
        checkin_id: submissionId,
        newly_shipped: newlyShipped
      };
    } catch (err) {
      if (connection) {
        await connection.rollback();
        connection.release();
      }
      fastify.log.error(err);
      return reply.code(err.statusCode || 400).send({ error: err.message || 'Errore completamento carico mezzo' });
    }
  });

  // GET /api/outbound/search-pallets - Aiuto per PC per cercare palette disponibili
  fastify.get('/search-pallets', async (request, reply) => {
    const { customer_id, exclude_order_id, include_pending, warehouse_id } = request.query;
    try {
      let excludeCondition = '';
      if (exclude_order_id && exclude_order_id !== 'undefined') {
        excludeCondition = `AND oo.id != ${db.escape(exclude_order_id)}`;
      }
      
      const statusCondition = include_pending === 'true' ? "IN ('STOCKED', 'PENDING')" : "= 'STOCKED'";
      const whCondition = warehouse_id && warehouse_id !== 'ALL' ? `AND COALESCE(pal.warehouse_id, 1) = ${Number(warehouse_id) || 1}` : '';

      const [pallets] = await db.query(`
        SELECT pal.*, l.zone, l.col, l.pos, p.name as product_name, p.sku as product_sku, COALESCE(pal.pallet_uom, p.uom) as uom, COALESCE(pal.units_per_box, p.units_per_box, 1) as units_per_box, COALESCE(p.boxes_per_pallet, 1) as boxes_per_pallet, COALESCE(NULLIF(pal.kg_per_unit, 0), p.kg_per_unit) as kg_per_unit,
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
        WHERE pal.customer_id = ? AND pal.status ${statusCondition} AND (pal.is_quarantined IS NULL OR pal.is_quarantined = FALSE) ${whCondition}
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
      const { limit = 500, search = '' } = request.query || {};
      const safeLimit = limit === 'all' ? 5000 : Math.min(Math.max(parseInt(limit, 10) || 500, 1), 5000);
      const params = [];
      let whereClause = "WHERE o.status = 'SHIPPED'";
      if (search && String(search).trim()) {
        const like = `%${String(search).trim()}%`;
        whereClause += ' AND (o.order_code LIKE ? OR c.business_name LIKE ? OR p.name LIKE ? OR i.pallet_code LIKE ? OR COALESCE(i.batch, pal.batch) LIKE ?)';
        params.push(like, like, like, like, like);
      }
      params.push(safeLimit);

      const [rows] = await db.query(`
        SELECT 
          i.id,
          o.customer_id,
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
        ${whereClause}
        ORDER BY o.shipped_at DESC
        LIMIT ?
      `, params);
      return rows.filter(r => canAccessCustomer(request.user, r.customer_id));
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

      await createNotification(db, fastify.io, {
        type: 'ORDER_RETURNED',
        title: `Reso Registrato: ${order.order_code}`,
        message: `${operator} ha registrato il reso di ${order.order_code}. Motivo: ${cleanReason}`,
        customer_id: order.customer_id,
        customer_name: order.customer_name,
        entity_type: 'OUTBOUND',
        entity_code: order.order_code,
        link_path: '/desktop/outbound/returns',
        actor_username: operator
      });

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
