import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Container as ContainerIcon,
  Box,
  Layers,
  Sparkles,
  RotateCw,
  Printer,
  FileText,
  Plus,
  Trash2,
  Eye,
  Play,
  Pause,
  RotateCcw,
  ArrowUpToLine,
  ArrowDownToLine,
  Maximize2,
  Move,
  CheckCircle2,
  AlertTriangle,
  Edit3,
  Check,
  Sliders,
  Compass,
  PackagePlus,
  ChevronRight
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useTheme } from '../../utils/theme';

const STORAGE_KEY = 'maglite_container_sim_v1';

const CONTAINER_PRESETS = [
  { id: '20_STD', name: "20' Standard", length: 590, width: 235, height: 239, maxWeight: 28200, desc: 'ISO 20ft Box' },
  { id: '40_STD', name: "40' Standard", length: 1203, width: 235, height: 239, maxWeight: 28800, desc: 'ISO 40ft Box' },
  { id: '40_HC', name: "40' High Cube", length: 1203, width: 235, height: 269, maxWeight: 28600, desc: 'ISO 40ft HC' },
  { id: '45_HC', name: "45' High Cube", length: 1355, width: 235, height: 269, maxWeight: 27700, desc: 'ISO 45ft HC' },
  { id: '20_REEFER', name: "20' Reefer", length: 545, width: 228, height: 226, maxWeight: 27400, desc: 'Frigo 20ft' },
  { id: '40_REEFER', name: "40' Reefer HC", length: 1158, width: 229, height: 254, maxWeight: 29100, desc: 'Frigo 40ft HC' },
  { id: 'BILICO', name: 'Bilico / Eurotrailer', length: 1360, width: 248, height: 270, maxWeight: 24000, desc: 'Semirimorchio 13.6m' },
  { id: 'CUSTOM', name: 'Personalizzato', length: 1203, width: 235, height: 269, maxWeight: 28000, desc: 'Misure custom cm' }
];

const PALLET_PRESETS = [
  { label: 'EPAL 80×120×86', length: 120, width: 80, height: 86, weight: 420 },
  { label: 'EPAL Alto 80×120×160', length: 120, width: 80, height: 160, weight: 650 },
  { label: 'Industriale 100×120×120', length: 120, width: 100, height: 120, weight: 700 },
  { label: 'Half 60×80×90', length: 80, width: 60, height: 90, weight: 220 }
];

const PALLET_COLORS = [
  '#38bdf8', '#f59e0b', '#10b981', '#a78bfa',
  '#fb7185', '#22d3ee', '#f97316', '#84cc16',
  '#e879f9', '#60a5fa', '#fbbf24', '#34d399'
];

// Restituisce ingombro su pianta (dx lungo container X, dy trasversale Y) in base all'orientamento:
// PUNTA = lato lungo lungo X (es. 120x80), PIATTO = lato corto lungo X / traverso lungo Y (es. 80x120)
function getFootprint(pallet, orientationOverride = null) {
  const ori = orientationOverride || pallet.orientation || 'PUNTA';
  const a = Math.max(1, Number(pallet.length) || 120);
  const b = Math.max(1, Number(pallet.width) || 80);
  const maxSide = Math.max(a, b);
  const minSide = Math.min(a, b);
  if (ori === 'PIATTO') {
    return { dx: minSide, dy: maxSide, ori: 'PIATTO' };
  }
  return { dx: maxSide, dy: minSide, ori: 'PUNTA' };
}

function getBoxBounds(p) {
  const { dx, dy } = getFootprint(p);
  const dz = Math.max(1, Number(p.height) || 1);
  const x = Number(p.x) || 0;
  const y = Number(p.y) || 0;
  const z = Number(p.z) || 0;
  return { x1: x, y1: y, z1: z, x2: x + dx, y2: y + dy, z2: z + dz, dx, dy, dz };
}

function overlaps2D(a, b, eps = 0.01) {
  return a.x1 < b.x2 - eps && a.x2 > b.x1 + eps && a.y1 < b.y2 - eps && a.y2 > b.y1 + eps;
}

function overlaps3D(a, b, eps = 0.01) {
  return overlaps2D(a, b, eps) && a.z1 < b.z2 - eps && a.z2 > b.z1 + eps;
}

function computeOverlapArea2D(a, b) {
  const ox = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const oy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  return ox * oy;
}

function checkPlacementValid(candidate, allPallets, container) {
  const cb = getBoxBounds(candidate);
  if (cb.x1 < -0.01 || cb.y1 < -0.01 || cb.z1 < -0.01) {
    return { ok: false, reason: 'Fuori dai bordi del container' };
  }
  if (cb.x2 > container.length + 0.01) {
    return { ok: false, reason: `Supera la lunghezza container (${container.length} cm)` };
  }
  if (cb.y2 > container.width + 0.01) {
    return { ok: false, reason: `Supera la larghezza container (${container.width} cm)` };
  }
  if (cb.z2 > container.height + 0.01) {
    return { ok: false, reason: `Supera l'altezza utile (${container.height} cm)` };
  }

  for (const other of allPallets) {
    if (other.id === candidate.id || !other.placed) continue;
    const ob = getBoxBounds(other);
    if (overlaps3D(cb, ob)) {
      return { ok: false, reason: `Sovrapposto a ${other.name || `#${other.seq}`}` };
    }
  }
  return { ok: true };
}

// Ordina le palette posizionate nella sequenza reale di carico (Fondo -> Porte, Basso -> Alto, SX -> DX)
function sortPlacedForLoading(pallets) {
  return [...pallets]
    .filter(p => p.placed)
    .sort((a, b) => {
      if (Math.abs((a.x || 0) - (b.x || 0)) > 8) return (a.x || 0) - (b.x || 0);
      if (Math.abs((a.z || 0) - (b.z || 0)) > 2) return (a.z || 0) - (b.z || 0);
      return (a.y || 0) - (b.y || 0);
    });
}

/**
 * Algoritmo "Intelligente":
 * 1. Le più alte vanno DIETRO (verso X = 0, fondo) e le più basse DAVANTI (verso X = L, porte).
 * 2. Le palette impilabili possono essere messe una sopra l'altra purché entrino in altezza (<= container.height).
 * 3. Valuta automaticamente entrambi gli orientamenti ("di punta" e "di piatto") per massimizzare lo spazio.
 */
function runIntelligentPacking(pallets, container, options = { allowStacking: true, strictHeightGradient: true }) {
  const L = Number(container.length) || 1203;
  const W = Number(container.width) || 235;
  const H = Number(container.height) || 269;

  const pool = pallets.map(p => ({
    ...p,
    placed: false,
    x: 0,
    y: 0,
    z: 0,
    stackedOnId: null
  }));

  // Fase 1: Costruisci colonne verticali (stack) se l'impilamento è attivo.
  // Creiamo unità logiche ("stacks") ciascuna composta da [base, ...sopra], poi ordinate per altezza totale decrescente!
  const sortedByHeightDesc = [...pool].sort((a, b) => {
    if (b.height !== a.height) return b.height - a.height;
    const areaA = a.length * a.width;
    const areaB = b.length * b.width;
    if (areaB !== areaA) return areaB - areaA;
    return (b.weight || 0) - (a.weight || 0);
  });

  const usedInStack = new Set();
  const stacks = [];

  if (options.allowStacking) {
    // Raggruppa prima le palette impilabili per formare colonne che sfruttino al massimo H
    // ma mantengano un buon profilo decrescente (tallest back -> shortest front).
    // Se una paletta da sola è già >= 68% dell'altezza, tenerla singola evita di bloccare altre basse se non serve,
    // altrimenti proviamo a impilare sopra finché entra in H!
    for (const base of sortedByHeightDesc) {
      if (usedInStack.has(base.id)) continue;
      usedInStack.add(base.id);
      const col = {
        items: [base],
        totalH: base.height,
        baseMax: Math.max(base.length, base.width),
        baseMin: Math.min(base.length, base.width)
      };

      if (base.stackable !== false) {
        // Cerca palette compatibili da mettere sopra: footprint <= base e somma altezze <= H
        let added = true;
        while (added) {
          added = false;
          let bestCandidate = null;
          let bestScore = -1;
          for (const cand of sortedByHeightDesc) {
            if (usedInStack.has(cand.id)) continue;
            if (cand.stackable === false) continue;
            if (col.totalH + cand.height > H) continue;
            const cMax = Math.max(cand.length, cand.width);
            const cMin = Math.min(cand.length, cand.width);
            // La paletta superiore deve poggiare dentro (o pari a) quella inferiore (tolleranza 5cm per sporgenza minima)
            if (cMax <= col.baseMax + 4 && cMin <= col.baseMin + 4) {
              // Privilegia riempire bene la colonna (più alta e pesante sotto, più leggera sopra)
              const weightPenalty = (cand.weight || 0) > (col.items[col.items.length - 1].weight || 99999) ? 0.5 : 1;
              const score = cand.height * weightPenalty + (cMax * cMin) / 10000;
              if (score > bestScore) {
                bestScore = score;
                bestCandidate = cand;
              }
            }
          }
          if (bestCandidate) {
            usedInStack.add(bestCandidate.id);
            col.items.push(bestCandidate);
            col.totalH += bestCandidate.height;
            col.baseMax = Math.min(col.baseMax, Math.max(bestCandidate.length, bestCandidate.width));
            col.baseMin = Math.min(col.baseMin, Math.min(bestCandidate.length, bestCandidate.width));
            added = true;
          }
        }
      }
      stacks.push(col);
    }
  } else {
    for (const p of sortedByHeightDesc) {
      stacks.push({ items: [p], totalH: p.height, baseMax: Math.max(p.length, p.width), baseMin: Math.min(p.length, p.width) });
    }
  }

  // Ordina gli stack per altezza totale DECRESCENTE (LE PIU' ALTE VANNO DIETRO = X basso!)
  stacks.sort((a, b) => {
    if (b.totalH !== a.totalH) return b.totalH - a.totalH;
    const wA = a.items.reduce((s, i) => s + (i.weight || 0), 0);
    const wB = b.items.reduce((s, i) => s + (i.weight || 0), 0);
    if (wB !== wA) return wB - wA;
    return (b.baseMax * b.baseMin) - (a.baseMax * a.baseMin);
  });

  // Helper per trovare tutte le posizioni candidate (extreme points su X, Y)
  const placedFloorRects = []; // { x1, y1, x2, y2, topH }
  const placedById = new Map();

  function getCandidateXY() {
    const xs = new Set([0]);
    const ys = new Set([0]);
    for (const r of placedFloorRects) {
      xs.add(r.x2);
      ys.add(r.y2);
      xs.add(r.x1);
      ys.add(r.y1);
    }
    const sortedX = [...xs].filter(v => v >= 0 && v < L).sort((a, b) => a - b);
    const sortedY = [...ys].filter(v => v >= 0 && v < W).sort((a, b) => a - b);
    return { sortedX, sortedY };
  }

  function findBestSpotForStack(col, stackIdx) {
    const baseItem = col.items[0];
    const orientations = ['PUNTA', 'PIATTO'];
    const { sortedX, sortedY } = getCandidateXY();

    let bestSpot = null;
    for (const x of sortedX) {
      for (const y of sortedY) {
        for (const ori of orientations) {
          const { dx, dy } = getFootprint(baseItem, ori);
          if (x + dx > L + 0.01 || y + dy > W + 0.01) continue;
          const rect = { x1: x, y1: y, x2: x + dx, y2: y + dy };
          let hits = false;
          for (const pr of placedFloorRects) {
            if (overlaps2D(rect, pr)) {
              hits = true;
              break;
            }
          }
          if (hits) continue;

          // Valutazione:
          // 1) Minimo X (posiziona le palette alte più indietro possibile verso il fondo X=0)
          // 2) Se siamo alla stessa X, preferisci Y piccolo e miglior sfruttamento fascia trasversale (meno resto in W o L)
          // 3) Verifica se un orientamento permette di appaiare un secondo bancale nella larghezza residua W!
          const remW = W - (y + dy);
          let pairBonus = 0;
          if (remW >= 78 && remW <= 125) pairBonus -= 35; // Ottimo allineamento per fila affiancata (es. 80+120 in 235)
          const sameHeightBonus = (stackIdx > 0 && Math.abs(x - (placedFloorRects[placedFloorRects.length - 1]?.x1 || 0)) < 1) ? -5 : 0;
          const score = x * 1000 + y * 5 + (x + dx) * 0.5 + pairBonus + sameHeightBonus;

          if (!bestSpot || score < bestSpot.score) {
            bestSpot = { x, y, dx, dy, ori, score };
          }
        }
      }
    }
    return bestSpot;
  }

  // Posiziona ogni stack in ordine dal più alto al più basso
  const unplacedSingles = [];
  stacks.forEach((col, sIdx) => {
    const spot = findBestSpotForStack(col, sIdx);
    if (spot) {
      placedFloorRects.push({
        x1: spot.x,
        y1: spot.y,
        x2: spot.x + spot.dx,
        y2: spot.y + spot.dy,
        topH: col.totalH
      });
      let curZ = 0;
      let prevId = null;
      for (const item of col.items) {
        const placedItem = {
          ...item,
          placed: true,
          orientation: spot.ori,
          x: Math.round(spot.x * 10) / 10,
          y: Math.round(spot.y * 10) / 10,
          z: Math.round(curZ * 10) / 10,
          stackedOnId: prevId
        };
        placedById.set(item.id, placedItem);
        curZ += item.height;
        prevId = item.id;
      }
    } else {
      for (const item of col.items) {
        unplacedSingles.push(item);
      }
    }
  });

  // Se qualche singolo dello stack non entrava a terra, prova a piazzarlo singolarmente o impilarlo su eventuali spazi liberi rimasti
  if (unplacedSingles.length > 0) {
    unplacedSingles.sort((a, b) => b.height - a.height);
    for (const item of unplacedSingles) {
      // Prima prova a impilare sopra una colonna esistente (dal fondo verso le porte) se stackable
      let placedItem = null;
      if (options.allowStacking && item.stackable !== false) {
        const allPlacedNow = [...placedById.values()];
        const topCandidates = allPlacedNow
          .filter(base => {
            if (base.stackable === false) return false;
            // Controlla che non abbia già qualcosa sopra
            const hasChild = allPlacedNow.some(o => o.stackedOnId === base.id);
            if (hasChild) return false;
            const topZ = base.z + base.height;
            if (topZ + item.height > H) return false;
            const bf = getFootprint(base);
            const itPunta = getFootprint(item, 'PUNTA');
            const itPiatto = getFootprint(item, 'PIATTO');
            return (
              (itPunta.dx <= bf.dx + 4 && itPunta.dy <= bf.dy + 4) ||
              (itPiatto.dx <= bf.dx + 4 && itPiatto.dy <= bf.dy + 4)
            );
          })
          .sort((a, b) => a.x - b.x || a.z - b.z);

        for (const base of topCandidates) {
          const bf = getFootprint(base);
          const ori = (getFootprint(item, base.orientation).dx <= bf.dx + 4 && getFootprint(item, base.orientation).dy <= bf.dy + 4)
            ? base.orientation
            : (base.orientation === 'PUNTA' ? 'PIATTO' : 'PUNTA');
          const cand = {
            ...item,
            placed: true,
            orientation: ori,
            x: base.x,
            y: base.y,
            z: base.z + base.height,
            stackedOnId: base.id
          };
          if (checkPlacementValid(cand, allPlacedNow, container).ok) {
            placedItem = cand;
            break;
          }
        }
      }

      if (!placedItem) {
        const spot = findBestSpotForStack({ items: [item], totalH: item.height }, 999);
        if (spot) {
          placedFloorRects.push({
            x1: spot.x,
            y1: spot.y,
            x2: spot.x + spot.dx,
            y2: spot.y + spot.dy,
            topH: item.height
          });
          placedItem = {
            ...item,
            placed: true,
            orientation: spot.ori,
            x: Math.round(spot.x * 10) / 10,
            y: Math.round(spot.y * 10) / 10,
            z: 0,
            stackedOnId: null
          };
        }
      }

      if (placedItem) {
        placedById.set(item.id, placedItem);
      }
    }
  }

  // Combina tutto e riassegna numero sequenziale ordinato di carico (1..N per i caricati, poi eventuali esclusi)
  const placedList = sortPlacedForLoading([...placedById.values()]);
  const unplacedList = pool.filter(p => !placedById.has(p.id));
  const combined = [...placedList, ...unplacedList].map((p, idx) => ({
    ...p,
    seq: idx + 1
  }));

  return combined;
}

// =========================================================================
// RENDERERS CANVAS CONDIVISI (Interactive Preview + High-Res Print Export)
// =========================================================================

function hexToRgba(hex, alpha = 1) {
  const clean = (hex || '#38bdf8').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return `rgba(56,189,248,${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function shadeHex(hex, factor) {
  const clean = (hex || '#38bdf8').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return hex;
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((num >> 16) & 255) * factor);
  const g = clamp(((num >> 8) & 255) * factor);
  const b = clamp((num & 255) * factor);
  return `rgb(${r},${g},${b})`;
}

function draw2DPlanCanvas(ctx, width, height, container, pallets, { selectedId = null, maxStep = null, theme = 'dark' } = {}) {
  const isLight = theme === 'light';
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = isLight ? '#ffffff' : '#020617';
  ctx.fillRect(0, 0, width, height);

  const padL = 56;
  const padR = 56;
  const padT = 36;
  const padB = 42;
  const availW = Math.max(60, width - padL - padR);
  const availH = Math.max(60, height - padT - padB);
  const scale = Math.min(availW / container.length, availH / container.width);

  const boxW = container.length * scale;
  const boxH = container.width * scale;
  const ox = padL + (availW - boxW) / 2;
  const oy = padT + (availH - boxH) / 2;

  // Header labels DIETRO (Fondo) <-> DAVANTI (Porte)
  ctx.fillStyle = isLight ? '#0f172a' : '#94a3b8';
  ctx.font = 'bold 11px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`DIETRO / FONDO (X=0) — ${container.length} × ${container.width} × ${container.height} cm`, ox, oy - 12);
  ctx.textAlign = 'right';
  ctx.fillStyle = isLight ? '#0284c7' : '#38bdf8';
  ctx.fillText('DAVANTI / PORTE →', ox + boxW, oy - 12);

  // Container floor
  ctx.fillStyle = isLight ? '#f8fafc' : '#0f172a';
  ctx.fillRect(ox, oy, boxW, boxH);

  // Grid every 100cm
  ctx.strokeStyle = isLight ? 'rgba(15,23,42,0.08)' : 'rgba(148,163,184,0.12)';
  ctx.lineWidth = 1;
  for (let gx = 100; gx < container.length; gx += 100) {
    const px = ox + gx * scale;
    ctx.beginPath();
    ctx.moveTo(px, oy);
    ctx.lineTo(px, oy + boxH);
    ctx.stroke();
    ctx.fillStyle = isLight ? '#64748b' : '#475569';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${(gx / 100).toFixed(0)}m`, px, oy + boxH + 14);
  }
  for (let gy = 50; gy < container.width; gy += 50) {
    const py = oy + gy * scale;
    ctx.beginPath();
    ctx.moveTo(ox, py);
    ctx.lineTo(ox + boxW, py);
    ctx.stroke();
  }

  // Container walls
  ctx.strokeStyle = isLight ? '#0f172a' : '#334155';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(ox, oy, boxW, boxH);

  // Back nose wall thick marker
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(ox - 5, oy, 5, boxH);
  // Doors open marker
  ctx.fillStyle = '#10b981';
  ctx.fillRect(ox + boxW, oy, 5, boxH);

  // Side vertical badges
  ctx.save();
  ctx.translate(ox - 16, oy + boxH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#ef4444';
  ctx.font = 'bold 10px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('FONDO (ALTE)', 0, 0);
  ctx.restore();

  ctx.save();
  ctx.translate(ox + boxW + 18, oy + boxH / 2);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = '#10b981';
  ctx.font = 'bold 10px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('PORTE (BASSE)', 0, 0);
  ctx.restore();

  // Sort placed by Z ascending so stacked pallets render on top clearly
  const visible = sortPlacedForLoading(pallets)
    .filter((p, idx) => maxStep === null || idx < maxStep)
    .sort((a, b) => (a.z || 0) - (b.z || 0));

  for (const p of visible) {
    const { dx, dy, ori } = getFootprint(p);
    const px = ox + (p.x || 0) * scale;
    const py = oy + (p.y || 0) * scale;
    const pw = dx * scale;
    const ph = dy * scale;
    const isStacked = (p.z || 0) > 0;
    const inset = isStacked ? Math.min(6, pw * 0.08, ph * 0.08) : 1.5;

    ctx.fillStyle = hexToRgba(p.color, isStacked ? 0.92 : 0.78);
    ctx.fillRect(px + inset, py + inset, pw - inset * 2, ph - inset * 2);

    ctx.strokeStyle = p.id === selectedId
      ? '#ffffff'
      : isStacked
      ? (isLight ? '#0f172a' : '#f8fafc')
      : shadeHex(p.color, 0.55);
    ctx.lineWidth = p.id === selectedId ? 3 : isStacked ? 1.8 : 1.2;
    ctx.strokeRect(px + inset, py + inset, pw - inset * 2, ph - inset * 2);

    // Label
    const cx = px + pw / 2;
    const cy = py + ph / 2;
    ctx.fillStyle = '#020617';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fontSize = Math.max(9, Math.min(13, Math.floor(Math.min(pw, ph) / 3.2)));
    ctx.font = `900 ${fontSize}px Inter, sans-serif`;
    const shortName = p.customName ? `${p.customName}` : `#${p.seq}`;
    const displayTitle = shortName.length > 10 ? `#${p.seq}` : shortName;
    ctx.fillText(displayTitle, cx, cy - (ph > 34 ? 6 : 0));
    if (ph > 32 && pw > 42) {
      ctx.font = 'bold 9px monospace';
      ctx.fillStyle = 'rgba(2,6,23,0.85)';
      ctx.fillText(`${ori === 'PUNTA' ? 'P' : 'D'} • H${p.height}${isStacked ? ' ↑' : ''}`, cx, cy + 7);
    }
  }

  ctx.restore();
  return { ox, oy, scale, boxW, boxH };
}

function draw2DSideCanvas(ctx, width, height, container, pallets, { selectedId = null, maxStep = null, theme = 'dark' } = {}) {
  const isLight = theme === 'light';
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = isLight ? '#ffffff' : '#020617';
  ctx.fillRect(0, 0, width, height);

  const padL = 56;
  const padR = 32;
  const padT = 26;
  const padB = 28;
  const availW = Math.max(60, width - padL - padR);
  const availH = Math.max(50, height - padT - padB);
  const scale = Math.min(availW / container.length, availH / container.height);

  const boxW = container.length * scale;
  const boxH = container.height * scale;
  const ox = padL + (availW - boxW) / 2;
  const oy = padT + (availH - boxH) / 2;

  ctx.fillStyle = isLight ? '#f8fafc' : '#0f172a';
  ctx.fillRect(ox, oy, boxW, boxH);

  // Height reference lines
  ctx.strokeStyle = isLight ? 'rgba(15,23,42,0.08)' : 'rgba(148,163,184,0.12)';
  ctx.lineWidth = 1;
  for (let gz = 50; gz < container.height; gz += 50) {
    const py = oy + boxH - gz * scale;
    ctx.beginPath();
    ctx.moveTo(ox, py);
    ctx.lineTo(ox + boxW, py);
    ctx.stroke();
    ctx.fillStyle = isLight ? '#64748b' : '#475569';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${gz}cm`, ox - 6, py + 3);
  }

  ctx.strokeStyle = isLight ? '#0f172a' : '#334155';
  ctx.lineWidth = 2;
  ctx.strokeRect(ox, oy, boxW, boxH);

  ctx.fillStyle = isLight ? '#0f172a' : '#94a3b8';
  ctx.font = 'bold 10px Inter, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`PROFILO LATERALE (Altezza max ${container.height} cm — Dietro più alte → Davanti più basse)`, ox, oy - 8);

  const visible = sortPlacedForLoading(pallets)
    .filter((p, idx) => maxStep === null || idx < maxStep)
    .sort((a, b) => (a.y || 0) - (b.y || 0));

  for (const p of visible) {
    const { dx } = getFootprint(p);
    const px = ox + (p.x || 0) * scale;
    const pw = dx * scale;
    const ph = (p.height || 1) * scale;
    const py = oy + boxH - ((p.z || 0) + (p.height || 1)) * scale;

    ctx.fillStyle = hexToRgba(p.color, 0.8);
    ctx.fillRect(px + 1, py + 1, Math.max(2, pw - 2), Math.max(2, ph - 2));
    ctx.strokeStyle = p.id === selectedId ? '#ffffff' : shadeHex(p.color, 0.5);
    ctx.lineWidth = p.id === selectedId ? 2.5 : 1.1;
    ctx.strokeRect(px + 1, py + 1, Math.max(2, pw - 2), Math.max(2, ph - 2));

    if (pw > 22 && ph > 16) {
      ctx.fillStyle = '#020617';
      ctx.font = 'bold 9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`#${p.seq}`, px + pw / 2, py + ph / 2);
    }
  }

  ctx.restore();
}

function draw3DContainerCanvas(
  ctx,
  width,
  height,
  container,
  pallets,
  { yaw = 0.62, pitch = 0.45, zoom = 1, selectedId = null, maxStep = null, theme = 'dark' } = {}
) {
  const isLight = theme === 'light';
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = isLight ? '#ffffff' : '#020617';
  ctx.fillRect(0, 0, width, height);

  const L = container.length;
  const W = container.width;
  const H = container.height;
  const cxWorld = L / 2;
  const cyWorld = W / 2;
  const czWorld = H / 2;

  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);

  const maxSpan = Math.sqrt(L * L + W * W + H * H) || 1000;
  const baseScale = (Math.min(width, height) * 0.78 / maxSpan) * zoom;
  const screenCX = width * 0.5;
  const screenCY = height * 0.54;

  // Project world (x: length back->front, y: width, z: up) into screen (sx, sy) and depth (camDist toward viewer)
  const project = (wx, wy, wz) => {
    const dx = wx - cxWorld;
    const dy = wy - cyWorld;
    const dz = wz - czWorld;
    // Rotate around vertical Z by yaw
    const rx = dx * cosY - dy * sinY;
    const ry = dx * sinY + dy * cosY;
    // Pitch around X (camera looks from above when pitch > 0)
    const rz = ry * sinP + dz * cosP;
    const depth = -ry * cosP + dz * sinP; // più grande = più vicino alla camera
    return {
      x: screenCX + rx * baseScale,
      y: screenCY - rz * baseScale,
      depth
    };
  };

  // Floor polygon
  const f00 = project(0, 0, 0);
  const f10 = project(L, 0, 0);
  const f11 = project(L, W, 0);
  const f01 = project(0, W, 0);
  const t00 = project(0, 0, H);
  const t10 = project(L, 0, H);
  const t11 = project(L, W, H);
  const t01 = project(0, W, H);

  ctx.beginPath();
  ctx.moveTo(f00.x, f00.y);
  ctx.lineTo(f10.x, f10.y);
  ctx.lineTo(f11.x, f11.y);
  ctx.lineTo(f01.x, f01.y);
  ctx.closePath();
  ctx.fillStyle = isLight ? '#e2e8f0' : '#0f172a';
  ctx.fill();

  // Floor grid lines inside container
  ctx.strokeStyle = isLight ? 'rgba(15,23,42,0.12)' : 'rgba(148,163,184,0.16)';
  ctx.lineWidth = 1;
  for (let gx = 100; gx < L; gx += 100) {
    const a = project(gx, 0, 0);
    const b = project(gx, W, 0);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // Back wall subtle tint (FONDO = X=0)
  ctx.beginPath();
  ctx.moveTo(f00.x, f00.y);
  ctx.lineTo(f01.x, f01.y);
  ctx.lineTo(t01.x, t01.y);
  ctx.lineTo(t00.x, t00.y);
  ctx.closePath();
  ctx.fillStyle = isLight ? 'rgba(239,68,68,0.10)' : 'rgba(239,68,68,0.12)';
  ctx.fill();

  // Back container edges
  const edges = [
    [f00, f10], [f10, f11], [f11, f01], [f01, f00],
    [t00, t10], [t10, t11], [t11, t01], [t01, t00],
    [f00, t00], [f10, t10], [f11, t11], [f01, t01]
  ];
  ctx.strokeStyle = isLight ? '#475569' : '#334155';
  ctx.lineWidth = 1.4;
  for (const [p1, p2] of edges) {
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  // Prepare placed pallets sorted via exact cuboid painter's order (DAG topological sort along camera vector)
  const visible = sortPlacedForLoading(pallets)
    .filter((p, idx) => maxStep === null || idx < maxStep);

  const camVecX = -sinY * cosP;
  const camVecY = -cosY * cosP;
  const camVecZ = sinP;

  const boxesWithDepth = visible.map(p => {
    const b = getBoxBounds(p);
    const centerProj = project((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, (b.z1 + b.z2) / 2);
    return { p, b, depth: centerProj.depth };
  });

  // Topological sort per cubi allineati agli assi: A deve stare PRIMA (più lontano) di B se separati verso la camera
  const nBoxes = boxesWithDepth.length;
  const behindGraph = Array.from({ length: nBoxes }, () => []);
  const inDegree = new Array(nBoxes).fill(0);
  const eps = 0.05;

  for (let i = 0; i < nBoxes; i++) {
    const A = boxesWithDepth[i].b;
    for (let j = i + 1; j < nBoxes; j++) {
      const B = boxesWithDepth[j].b;
      let aBeforeB = null; // true => draw A before B
      if (A.z2 <= B.z1 + eps) aBeforeB = camVecZ >= 0;
      else if (B.z2 <= A.z1 + eps) aBeforeB = camVecZ < 0;
      else if (A.x2 <= B.x1 + eps) aBeforeB = camVecX <= 0;
      else if (B.x2 <= A.x1 + eps) aBeforeB = camVecX > 0;
      else if (A.y2 <= B.y1 + eps) aBeforeB = camVecY <= 0;
      else if (B.y2 <= A.y1 + eps) aBeforeB = camVecY > 0;

      if (aBeforeB === true) {
        behindGraph[i].push(j);
        inDegree[j]++;
      } else if (aBeforeB === false) {
        behindGraph[j].push(i);
        inDegree[i]++;
      }
    }
  }

  const queue = [];
  for (let i = 0; i < nBoxes; i++) {
    if (inDegree[i] === 0) queue.push(i);
  }
  queue.sort((i, j) => boxesWithDepth[i].depth - boxesWithDepth[j].depth);

  const orderedBoxes = [];
  while (queue.length > 0) {
    const cur = queue.shift();
    orderedBoxes.push(boxesWithDepth[cur]);
    for (const nxt of behindGraph[cur]) {
      inDegree[nxt]--;
      if (inDegree[nxt] === 0) {
        queue.push(nxt);
        queue.sort((i, j) => boxesWithDepth[i].depth - boxesWithDepth[j].depth);
      }
    }
  }
  if (orderedBoxes.length < nBoxes) {
    // Fallback in caso di cicli rarissimi
    boxesWithDepth.sort((A, B) => A.depth - B.depth);
  } else {
    boxesWithDepth.splice(0, nBoxes, ...orderedBoxes);
  }

  const clickableFaces = [];

  for (const { p, b } of boxesWithDepth) {
    const c = [
      project(b.x1, b.y1, b.z1), // 0: minX minY minZ
      project(b.x2, b.y1, b.z1), // 1: maxX minY minZ
      project(b.x2, b.y2, b.z1), // 2: maxX maxY minZ
      project(b.x1, b.y2, b.z1), // 3: minX maxY minZ
      project(b.x1, b.y1, b.z2), // 4: minX minY maxZ
      project(b.x2, b.y1, b.z2), // 5: maxX minY maxZ
      project(b.x2, b.y2, b.z2), // 6: maxX maxY maxZ
      project(b.x1, b.y2, b.z2)  // 7: minX maxY maxZ
    ];

    const faces = [
      { idx: [4, 5, 6, 7], shade: 1.04, normal: 'top' },
      { idx: [0, 1, 5, 4], shade: 0.78, normal: 'sideY1' },
      { idx: [3, 2, 6, 7], shade: 0.72, normal: 'sideY2' },
      { idx: [0, 3, 7, 4], shade: 0.65, normal: 'backX' },
      { idx: [1, 2, 6, 5], shade: 0.88, normal: 'frontX' }
    ];

    // Keep only outward-facing (2D winding / depth sorted) faces
    const orderedFaces = faces
      .map(f => {
        const pts = f.idx.map(i => c[i]);
        const avgD = pts.reduce((s, pt) => s + pt.depth, 0) / 4;
        return { ...f, pts, avgD };
      })
      .sort((f1, f2) => f1.avgD - f2.avgD)
      .slice(-3);

    const isSelected = p.id === selectedId;
    for (const face of orderedFaces) {
      ctx.beginPath();
      ctx.moveTo(face.pts[0].x, face.pts[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(face.pts[i].x, face.pts[i].y);
      ctx.closePath();
      ctx.fillStyle = shadeHex(p.color, face.shade);
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#ffffff' : shadeHex(p.color, 0.35);
      ctx.lineWidth = isSelected ? 2.4 : 0.9;
      ctx.stroke();
    }

    // Top face label
    const topPts = [c[4], c[5], c[6], c[7]];
    const tx = topPts.reduce((s, pt) => s + pt.x, 0) / 4;
    const ty = topPts.reduce((s, pt) => s + pt.y, 0) / 4;
    ctx.fillStyle = '#020617';
    ctx.font = '900 10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = p.customName ? (p.customName.length > 8 ? `#${p.seq}` : p.customName) : `#${p.seq}`;
    ctx.fillText(label, tx, ty);

    clickableFaces.push({ id: p.id, x: tx, y: ty, pts: topPts });
  }

  // Labels DIETRO / DAVANTI in 3D space
  const backLbl = project(0, W / 2, H + 18);
  const frontLbl = project(L, W / 2, H + 18);
  ctx.font = 'bold 11px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ef4444';
  ctx.fillText('DIETRO (FONDO)', backLbl.x, Math.max(16, backLbl.y));
  ctx.fillStyle = '#10b981';
  ctx.fillText('DAVANTI (PORTE)', frontLbl.x, Math.max(16, frontLbl.y));

  ctx.restore();
  return clickableFaces;
}

const ContainerSimulator = () => {
  const { theme: appTheme } = useTheme();
  const [container, setContainer] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved?.container) return saved.container;
    } catch {
      // ignore
    }
    return { ...CONTAINER_PRESETS[2] }; // 40' HC default
  });

  const [pallets, setPallets] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (Array.isArray(saved?.pallets) && saved.pallets.length > 0) return saved.pallets;
    } catch {
      // ignore
    }
    return [
      { id: 'p-init-1', seq: 1, customName: '', length: 120, width: 80, height: 185, weight: 520, color: PALLET_COLORS[0], orientation: 'PUNTA', stackable: true, placed: false, x: 0, y: 0, z: 0, stackedOnId: null },
      { id: 'p-init-2', seq: 2, customName: '', length: 120, width: 80, height: 185, weight: 520, color: PALLET_COLORS[0], orientation: 'PUNTA', stackable: true, placed: false, x: 0, y: 0, z: 0, stackedOnId: null },
      { id: 'p-init-3', seq: 3, customName: '', length: 120, width: 80, height: 120, weight: 420, color: PALLET_COLORS[1], orientation: 'PUNTA', stackable: true, placed: false, x: 0, y: 0, z: 0, stackedOnId: null },
      { id: 'p-init-4', seq: 4, customName: '', length: 120, width: 80, height: 86, weight: 310, color: PALLET_COLORS[2], orientation: 'PUNTA', stackable: true, placed: false, x: 0, y: 0, z: 0, stackedOnId: null },
      { id: 'p-init-5', seq: 5, customName: '', length: 120, width: 80, height: 86, weight: 310, color: PALLET_COLORS[2], orientation: 'PUNTA', stackable: true, placed: false, x: 0, y: 0, z: 0, stackedOnId: null },
      { id: 'p-init-6', seq: 6, customName: '', length: 120, width: 80, height: 86, weight: 310, color: PALLET_COLORS[2], orientation: 'PUNTA', stackable: true, placed: false, x: 0, y: 0, z: 0, stackedOnId: null }
    ];
  });

  // Form aggiunta nuova paletta
  const [draft, setDraft] = useState({
    length: 120,
    width: 80,
    height: 86,
    weight: 400,
    qty: 1,
    prefixName: '',
    orientation: 'PUNTA',
    stackable: true,
    color: PALLET_COLORS[0]
  });

  const [selectedId, setSelectedId] = useState(null);
  const [editingNameId, setEditingNameId] = useState(null);
  const [editingNameVal, setEditingNameVal] = useState('');

  // Modalità Vista & Camera 3D
  const [viewMode, setViewMode] = useState('BOTH'); // '2D' | '3D' | 'BOTH'
  const [camYaw, setCamYaw] = useState(0.58);
  const [camPitch, setCamPitch] = useState(0.42);
  const [camZoom, setCamZoom] = useState(1.0);
  const [allowStacking, setAllowStacking] = useState(true);
  const [autoStackOnDrop, setAutoStackOnDrop] = useState(true);

  // Animazione sequenza carico
  const [animStep, setAnimStep] = useState(null);
  const [isPlayingAnim, setIsPlayingAnim] = useState(false);

  // Feedback banner inline
  const [notice, setNotice] = useState(null);

  // Canvas refs & drag states
  const canvas2DRef = useRef(null);
  const canvasSideRef = useRef(null);
  const canvas3DRef = useRef(null);
  const transform2DRef = useRef({ ox: 0, oy: 0, scale: 1 });
  const drag2DRef = useRef(null);
  const drag3DRef = useRef(null);
  const hitBoxes3DRef = useRef([]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ container, pallets }));
    } catch {
      // ignore
    }
  }, [container, pallets]);

  const placedPallets = useMemo(() => sortPlacedForLoading(pallets), [pallets]);
  const unplacedPallets = useMemo(() => pallets.filter(p => !p.placed), [pallets]);
  const selectedPallet = useMemo(() => pallets.find(p => p.id === selectedId) || null, [pallets, selectedId]);

  const metrics = useMemo(() => {
    const contVolM3 = (container.length * container.width * container.height) / 1_000_000;
    let usedVolCm3 = 0;
    let totalWeight = 0;
    let maxUsedX = 0;
    for (const p of placedPallets) {
      const { dx, dy } = getFootprint(p);
      usedVolCm3 += dx * dy * (p.height || 0);
      totalWeight += Number(p.weight) || 0;
      maxUsedX = Math.max(maxUsedX, (p.x || 0) + dx);
    }
    const usedVolM3 = usedVolCm3 / 1_000_000;
    const volPct = contVolM3 > 0 ? Math.min(100, (usedVolM3 / contVolM3) * 100) : 0;
    const lenPct = container.length > 0 ? Math.min(100, (maxUsedX / container.length) * 100) : 0;
    const overweight = container.maxWeight > 0 && totalWeight > container.maxWeight;
    return {
      placedCount: placedPallets.length,
      totalCount: pallets.length,
      contVolM3,
      usedVolM3,
      volPct,
      maxUsedX,
      lenPct,
      totalWeight,
      overweight
    };
  }, [container, pallets, placedPallets]);

  // Animazione passo-passo
  useEffect(() => {
    if (!isPlayingAnim) return;
    if (placedPallets.length === 0) {
      setIsPlayingAnim(false);
      setAnimStep(null);
      return;
    }
    const timer = setInterval(() => {
      setAnimStep(prev => {
        const cur = prev === null ? 0 : prev;
        if (cur >= placedPallets.length) {
          setIsPlayingAnim(false);
          return null;
        }
        return cur + 1;
      });
    }, 550);
    return () => clearInterval(timer);
  }, [isPlayingAnim, placedPallets.length]);

  // Render canvas loop whenever layout / selection / camera / resize changes
  const renderCanvases = useCallback(() => {
    if (canvas2DRef.current) {
      const el = canvas2DRef.current;
      const rect = el.getBoundingClientRect();
      if (rect.width > 10 && rect.height > 10) {
        const dpr = window.devicePixelRatio || 1;
        el.width = Math.round(rect.width * dpr);
        el.height = Math.round(rect.height * dpr);
        const ctx = el.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        transform2DRef.current = draw2DPlanCanvas(ctx, rect.width, rect.height, container, pallets, {
          selectedId,
          maxStep: animStep,
          theme: appTheme
        });
      }
    }
    if (canvasSideRef.current) {
      const el = canvasSideRef.current;
      const rect = el.getBoundingClientRect();
      if (rect.width > 10 && rect.height > 10) {
        const dpr = window.devicePixelRatio || 1;
        el.width = Math.round(rect.width * dpr);
        el.height = Math.round(rect.height * dpr);
        const ctx = el.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw2DSideCanvas(ctx, rect.width, rect.height, container, pallets, {
          selectedId,
          maxStep: animStep,
          theme: appTheme
        });
      }
    }
    if (canvas3DRef.current) {
      const el = canvas3DRef.current;
      const rect = el.getBoundingClientRect();
      if (rect.width > 10 && rect.height > 10) {
        const dpr = window.devicePixelRatio || 1;
        el.width = Math.round(rect.width * dpr);
        el.height = Math.round(rect.height * dpr);
        const ctx = el.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        hitBoxes3DRef.current = draw3DContainerCanvas(ctx, rect.width, rect.height, container, pallets, {
          yaw: camYaw,
          pitch: camPitch,
          zoom: camZoom,
          selectedId,
          maxStep: animStep,
          theme: appTheme
        });
      }
    }
  }, [container, pallets, selectedId, animStep, camYaw, camPitch, camZoom, appTheme]);

  useEffect(() => {
    renderCanvases();
    const onResize = () => renderCanvases();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [renderCanvases, viewMode]);

  const showToast = (type, text) => {
    setNotice({ type, text });
    setTimeout(() => setNotice(prev => (prev?.text === text ? null : prev)), 3200);
  };

  // Cambia Container Preset
  const handleSelectContainerPreset = (presetId) => {
    const found = CONTAINER_PRESETS.find(c => c.id === presetId);
    if (!found) return;
    setContainer({ ...found });
  };

  // Aggiunge N bancali numerati sequenzialmente dall'1
  const handleAddPallets = (e) => {
    e.preventDefault();
    const qty = Math.max(1, Math.min(100, parseInt(draft.qty, 10) || 1));
    const maxDim = Math.max(container.length, container.width, 500);
    const len = Math.max(20, Math.min(maxDim, parseInt(draft.length, 10) || 120));
    const wid = Math.max(20, Math.min(maxDim, parseInt(draft.width, 10) || 80));
    const hei = Math.max(10, parseInt(draft.height, 10) || 86);
    const wgt = Math.max(0, parseFloat(draft.weight) || 0);

    setPallets(prev => {
      const next = [...prev];
      const baseSeq = next.reduce((m, p) => Math.max(m, p.seq || 0), 0);
      for (let i = 0; i < qty; i++) {
        const seqNum = baseSeq + i + 1;
        const customName = draft.prefixName.trim()
          ? (qty > 1 ? `${draft.prefixName.trim()} #${seqNum}` : draft.prefixName.trim())
          : '';
        next.push({
          id: `pal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${i}`,
          seq: seqNum,
          customName,
          length: len,
          width: wid,
          height: hei,
          weight: wgt,
          color: draft.color || PALLET_COLORS[(seqNum - 1) % PALLET_COLORS.length],
          orientation: draft.orientation,
          stackable: Boolean(draft.stackable),
          placed: false,
          x: 0,
          y: 0,
          z: 0,
          stackedOnId: null
        });
      }
      return next;
    });
    // Ruota leggermente colore prossimo bancale
    setDraft(prev => ({
      ...prev,
      color: PALLET_COLORS[(PALLET_COLORS.indexOf(prev.color) + 1) % PALLET_COLORS.length]
    }));
    showToast('ok', `Aggiunt${qty === 1 ? 'o 1 bancale' : `i ${qty} bancali`} alla lista di carico.`);
  };

  // Posiziona manualmente una paletta non ancora caricata nel primo spazio libero (o sopra un'altra se serve)
  const handlePlaceSingle = (id) => {
    const target = pallets.find(p => p.id === id);
    if (!target) return;

    // Cerca primo punto libero a terra da X=0
    const L = container.length;
    const W = container.width;
    const oris = [target.orientation || 'PUNTA', target.orientation === 'PUNTA' ? 'PIATTO' : 'PUNTA'];

    const xs = [0, ...placedPallets.map(p => (p.x || 0) + getFootprint(p).dx)].filter(v => v >= 0 && v < L).sort((a, b) => a - b);
    const ys = [0, ...placedPallets.map(p => (p.y || 0) + getFootprint(p).dy)].filter(v => v >= 0 && v < W).sort((a, b) => a - b);

    for (const ori of oris) {
      const { dx, dy } = getFootprint(target, ori);
      for (const x of xs) {
        for (const y of ys) {
          if (x + dx > L || y + dy > W) continue;
          const cand = { ...target, orientation: ori, placed: true, x, y, z: 0, stackedOnId: null };
          if (checkPlacementValid(cand, pallets, container).ok) {
            setPallets(prev => prev.map(p => (p.id === id ? cand : p)));
            setSelectedId(id);
            return;
          }
        }
      }
    }

    // Se a terra non c'è posto, prova a impilarla sopra una paletta esistente compatibile
    if (allowStacking && target.stackable !== false) {
      for (const base of placedPallets) {
        if (base.stackable === false) continue;
        const hasChild = placedPallets.some(o => o.stackedOnId === base.id || (o.z > base.z && overlaps2D(getBoxBounds(o), getBoxBounds(base))));
        if (hasChild) continue;
        const topZ = (base.z || 0) + (base.height || 0);
        if (topZ + target.height > container.height) continue;
        const cand = { ...target, orientation: base.orientation, placed: true, x: base.x, y: base.y, z: topZ, stackedOnId: base.id };
        if (checkPlacementValid(cand, pallets, container).ok) {
          setPallets(prev => prev.map(p => (p.id === id ? cand : p)));
          setSelectedId(id);
          showToast('ok', `Bancale impilato sopra ${base.customName || `#${base.seq}`}.`);
          return;
        }
      }
    }

    showToast('warn', 'Spazio insufficiente nel container per questa paletta (controlla dimensioni o altezza).');
  };

  // Impila paletta selezionata direttamente sopra un altro bancale specifico
  const handleStackOnTarget = (palletId, baseId) => {
    const p = pallets.find(i => i.id === palletId);
    const base = pallets.find(i => i.id === baseId);
    if (!p || !base || p.id === base.id) return;
    const topZ = (base.z || 0) + (base.height || 0);
    if (topZ + p.height > container.height) {
      showToast('warn', `Troppo alta! (${topZ + p.height} cm > altezza container ${container.height} cm)`);
      return;
    }
    const cand = { ...p, placed: true, x: base.x, y: base.y, z: topZ, orientation: base.orientation, stackedOnId: base.id };
    const check = checkPlacementValid(cand, pallets, container);
    if (!check.ok) {
      showToast('warn', check.reason);
      return;
    }
    setPallets(prev => prev.map(item => (item.id === palletId ? cand : item)));
    showToast('ok', `${p.customName || `#${p.seq}`} impilata sopra ${base.customName || `#${base.seq}`} (Z=${topZ} cm).`);
  };

  // Ruota di 90° (Di Punta <-> Di Piatto)
  const handleToggleOrientation = (id) => {
    const target = pallets.find(p => p.id === id);
    if (!target) return;
    const nextOri = target.orientation === 'PIATTO' ? 'PUNTA' : 'PIATTO';
    const cand = { ...target, orientation: nextOri };
    if (target.placed) {
      const check = checkPlacementValid(cand, pallets, container);
      if (!check.ok) {
        showToast('warn', `Impossibile ruotare in questa posizione: ${check.reason}`);
        return;
      }
    }
    setPallets(prev => prev.map(p => (p.id === id ? cand : p)));
  };

  // Modifica coordinate manuali (X, Y, Z)
  const handleUpdatePosition = (id, patch) => {
    const target = pallets.find(p => p.id === id);
    if (!target) return;
    const cand = { ...target, ...patch };
    if (cand.placed) {
      const check = checkPlacementValid(cand, pallets, container);
      if (!check.ok) {
        showToast('warn', check.reason);
        return;
      }
    }
    setPallets(prev => prev.map(p => (p.id === id ? cand : p)));
  };

  // Algoritmo "Intelligente": Alte dietro (X=0), Basse davanti (X->L), impilabili dove conviene
  const handleRunIntelligent = () => {
    if (pallets.length === 0) {
      showToast('warn', 'Inserisci almeno un bancale prima di eseguire il calcolo intelligente.');
      return;
    }
    const packed = runIntelligentPacking(pallets, container, {
      allowStacking,
      strictHeightGradient: true
    });
    setPallets(packed);
    setAnimStep(null);
    setIsPlayingAnim(false);
    const countPlaced = packed.filter(p => p.placed).length;
    const unplaced = packed.length - countPlaced;
    if (unplaced > 0) {
      showToast('warn', `Carico intelligente completato: ${countPlaced}/${packed.length} bancali caricati (${unplaced} esclusi per spazio/altezza).`);
    } else {
      showToast('ok', `Carico intelligente ottimale completato! Tutti i ${countPlaced} bancali caricati (Alti dietro → Bassi davanti).`);
    }
  };

  // Drag & Drop su 2D Canvas
  const handle2DMouseDown = (e) => {
    if (!canvas2DRef.current) return;
    const rect = canvas2DRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { ox, oy, scale } = transform2DRef.current;
    const wx = (mx - ox) / scale;
    const wy = (my - oy) / scale;

    // Cerca dall'alto (z decrescente)
    const hits = placedPallets
      .filter(p => {
        const b = getBoxBounds(p);
        return wx >= b.x1 && wx <= b.x2 && wy >= b.y1 && wy <= b.y2;
      })
      .sort((a, b) => (b.z || 0) - (a.z || 0));

    if (hits.length > 0) {
      const hit = hits[0];
      setSelectedId(hit.id);
      drag2DRef.current = {
        id: hit.id,
        offsetX: wx - (hit.x || 0),
        offsetY: wy - (hit.y || 0),
        startX: hit.x || 0,
        startY: hit.y || 0,
        startZ: hit.z || 0
      };
    } else {
      setSelectedId(null);
    }
  };

  const handle2DMouseMove = (e) => {
    if (!drag2DRef.current || !canvas2DRef.current) return;
    const rect = canvas2DRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { ox, oy, scale } = transform2DRef.current;
    const wx = (mx - ox) / scale;
    const wy = (my - oy) / scale;

    const drag = drag2DRef.current;
    const target = pallets.find(p => p.id === drag.id);
    if (!target) return;
    const { dx, dy } = getFootprint(target);

    // Snap 5 cm + bordi container
    let nx = Math.round((wx - drag.offsetX) / 5) * 5;
    let ny = Math.round((wy - drag.offsetY) / 5) * 5;
    nx = Math.max(0, Math.min(container.length - dx, nx));
    ny = Math.max(0, Math.min(container.width - dy, ny));

    // Snap magnetico contro altri bancali (entro 10 cm)
    for (const other of placedPallets) {
      if (other.id === target.id) continue;
      const ob = getBoxBounds(other);
      if (Math.abs(nx - ob.x2) <= 10) nx = ob.x2;
      if (Math.abs((nx + dx) - ob.x1) <= 10) nx = Math.max(0, ob.x1 - dx);
      if (Math.abs(ny - ob.y2) <= 10) ny = ob.y2;
      if (Math.abs((ny + dy) - ob.y1) <= 10) ny = Math.max(0, ob.y1 - dy);
    }

    // Calcola Z automatico se "autoStackOnDrop" è attivo
    let nz = 0;
    let stackedOnId = null;
    if (autoStackOnDrop && allowStacking && target.stackable !== false) {
      const candRect = { x1: nx, y1: ny, x2: nx + dx, y2: ny + dy };
      let maxSupportTop = 0;
      let supId = null;
      for (const other of placedPallets) {
        if (other.id === target.id) continue;
        // Evita di appoggiare su qualcosa che poggia sopra di noi
        const ob = getBoxBounds(other);
        if (overlaps2D(candRect, ob, 5) && computeOverlapArea2D(candRect, ob) >= (dx * dy) * 0.45) {
          if (ob.z2 > maxSupportTop && other.stackable !== false) {
            maxSupportTop = ob.z2;
            supId = other.id;
          }
        }
      }
      if (maxSupportTop > 0 && maxSupportTop + target.height <= container.height) {
        nz = maxSupportTop;
        stackedOnId = supId;
      }
    }

    const cand = { ...target, x: nx, y: ny, z: nz, stackedOnId };
    if (checkPlacementValid(cand, pallets, container).ok) {
      setPallets(prev => prev.map(p => (p.id === target.id ? cand : p)));
    }
  };

  const handle2DMouseUp = () => {
    drag2DRef.current = null;
  };

  // Drag-to-orbit sul canvas 3D
  const handle3DMouseDown = (e) => {
    drag3DRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startYaw: camYaw,
      startPitch: camPitch,
      moved: false
    };
  };

  const handle3DMouseMove = (e) => {
    if (!drag3DRef.current) return;
    const dx = e.clientX - drag3DRef.current.startX;
    const dy = e.clientY - drag3DRef.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag3DRef.current.moved = true;
    setCamYaw(drag3DRef.current.startYaw + dx * 0.008);
    setCamPitch(Math.max(0.08, Math.min(1.35, drag3DRef.current.startPitch + dy * 0.006)));
  };

  const handle3DMouseUp = (e) => {
    if (drag3DRef.current && !drag3DRef.current.moved && canvas3DRef.current) {
      const rect = canvas3DRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      let closest = null;
      let bestDist = 42;
      for (const h of hitBoxes3DRef.current) {
        const d = Math.hypot(mx - h.x, my - h.y);
        if (d < bestDist) {
          bestDist = d;
          closest = h.id;
        }
      }
      if (closest) setSelectedId(closest);
    }
    drag3DRef.current = null;
  };

  const handleRemoveFromContainer = (id) => {
    setPallets(prev => prev.map(p => (p.id === id ? { ...p, placed: false, x: 0, y: 0, z: 0, stackedOnId: null } : p)));
  };

  const handleDeletePallet = (id) => {
    setPallets(prev => {
      const filtered = prev.filter(p => p.id !== id).map((p, idx) => ({ ...p, seq: idx + 1 }));
      return filtered;
    });
    if (selectedId === id) setSelectedId(null);
  };

  const handleEmptyContainer = () => {
    setPallets(prev => prev.map(p => ({ ...p, placed: false, x: 0, y: 0, z: 0, stackedOnId: null })));
    setSelectedId(null);
    setAnimStep(null);
    setIsPlayingAnim(false);
    showToast('ok', 'Container svuotato. I bancali restano pronti in lista.');
  };

  const handleSaveName = (id) => {
    setPallets(prev => prev.map(p => (p.id === id ? { ...p, customName: editingNameVal.trim() } : p)));
    setEditingNameId(null);
  };

  // =========================================================================
  // STAMPA PDF: 'RENDER' (2D/3D) | 'LIST' (Lista di Carico) | 'BOTH'
  // =========================================================================
  const handlePrintPdf = (mode = 'BOTH') => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const nowStr = new Date().toLocaleString('it-IT');

    const drawHeader = (title) => {
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, pageW, 18, 'F');
      doc.setTextColor(56, 189, 248);
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.text(`MAGLITE — ${title}`, 12, 11.5);
      doc.setTextColor(203, 213, 225);
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.text(
        `Container: ${container.name} (${container.length}×${container.width}×${container.height} cm) • Generato: ${nowStr}`,
        pageW - 12,
        11.5,
        { align: 'right' }
      );
    };

    const generateOffscreenImage = (w, h, fn) => {
      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const ctx = off.getContext('2d');
      fn(ctx, w, h);
      return off.toDataURL('image/png');
    };

    const includeRender = mode === 'RENDER' || mode === 'BOTH';
    const includeList = mode === 'LIST' || mode === 'BOTH';

    if (includeRender) {
      drawHeader('RENDER CARICO CONTAINER 2D / 3D');

      // KPI Strip
      doc.setFillColor(241, 245, 249);
      doc.roundedRect(12, 22, pageW - 24, 14, 2, 2, 'F');
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(`Bancali Caricati: ${metrics.placedCount} / ${metrics.totalCount}`, 17, 30.5);
      doc.text(`Riempimento Volume: ${metrics.volPct.toFixed(1)}% (${metrics.usedVolM3.toFixed(2)} / ${metrics.contVolM3.toFixed(2)} m³)`, 76, 30.5);
      doc.text(`Ingombro Lunghezza: ${metrics.maxUsedX} / ${container.length} cm (${metrics.lenPct.toFixed(0)}%)`, 164, 30.5);
      doc.text(`Peso Carico: ${metrics.totalWeight.toFixed(0)} kg`, pageW - 17, 30.5, { align: 'right' });

      // 2D Top + Side on Left Half, 3D Render on Right Half
      const img2D = generateOffscreenImage(1100, 460, (ctx, w, h) =>
        draw2DPlanCanvas(ctx, w, h, container, pallets, { theme: 'light' })
      );
      const imgSide = generateOffscreenImage(1100, 320, (ctx, w, h) =>
        draw2DSideCanvas(ctx, w, h, container, pallets, { theme: 'light' })
      );
      const img3D = generateOffscreenImage(1100, 820, (ctx, w, h) =>
        draw3DContainerCanvas(ctx, w, h, container, pallets, {
          yaw: camYaw,
          pitch: camPitch,
          zoom: camZoom,
          theme: 'light'
        })
      );

      doc.setDrawColor(203, 213, 225);
      doc.roundedRect(12, 40, 134, 86, 2, 2, 'S');
      doc.addImage(img2D, 'PNG', 13, 41, 132, 53);
      doc.addImage(imgSide, 'PNG', 13, 95, 132, 30);

      doc.roundedRect(150, 40, pageW - 162, 152, 2, 2, 'S');
      doc.addImage(img3D, 'PNG', 151, 42, pageW - 164, 148);

      // Mini nota guida
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text('LEGENDA CARICO:', 12, 134);
      doc.setFont('helvetica', 'normal');
      doc.text('• Ordine carico: dal #1 (DIETRO / FONDO) progressivamente verso le PORTE (DAVANTI).', 12, 140);
      doc.text('• Regola altezze: bancali/colonne più alti verso il fondo, più bassi verso le porte.', 12, 146);
      doc.text('• P = Di Punta (lato lungo lungo X) | D = Di Piatto (ruotata 90° trasversale)', 12, 152);
      doc.text('• ↑ = Bancale impilato sopra altro bancale (Z > 0 cm).', 12, 158);
      if (unplacedPallets.length > 0) {
        doc.setTextColor(190, 18, 60);
        doc.setFont('helvetica', 'bold');
        doc.text(`ATTENZIONE: ${unplacedPallets.length} bancali non ancora posizionati nel container.`, 12, 166);
      }

      doc.setTextColor(100, 116, 139);
      doc.setFontSize(8);
      doc.text('Documento generato da MagLite WMS — Simulatore Carico Container', 12, pageH - 6);
    }

    if (includeList) {
      if (includeRender) doc.addPage('a4', 'landscape');
      drawHeader('LISTA DI CARICO CONTAINER (SEQUENZA FONDO → PORTE)');

      const rows = placedPallets.map((p, idx) => {
        const { dx, dy, ori } = getFootprint(p);
        const baseObj = p.stackedOnId ? placedPallets.find(b => b.id === p.stackedOnId) : null;
        return [
          `#${idx + 1}`,
          p.customName || `Bancale #${p.seq}`,
          `${p.length} × ${p.width} × ${p.height} cm`,
          ori === 'PUNTA' ? `Di Punta (${dx}×${dy})` : `Di Piatto (${dx}×${dy})`,
          (p.z || 0) > 0
            ? `Sopra ${baseObj ? (baseObj.customName || `#${baseObj.seq}`) : 'base'} (Z=${p.z})`
            : 'A Terra (Z=0)',
          `X=${p.x} • Y=${p.y} cm`,
          `${Number(p.weight || 0).toFixed(0)} kg`
        ];
      });

      autoTable(doc, {
        startY: 24,
        head: [['Seq.', 'Nome / Riferimento', 'Misure Bancale', 'Orientamento (Ingombro)', 'Livello / Impilamento', 'Coordinate (Fondo/Lato)', 'Peso']],
        body: rows.length > 0 ? rows : [['-', 'Nessun bancale caricato nel container', '-', '-', '-', '-', '-']],
        theme: 'grid',
        headStyles: { fillColor: [15, 23, 42], textColor: [56, 189, 248], fontStyle: 'bold', fontSize: 8.5 },
        bodyStyles: { fontSize: 8.5, textColor: [15, 23, 42] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: 12, right: 12 }
      });

      if (unplacedPallets.length > 0) {
        const nextY = (doc.lastAutoTable?.finalY || 120) + 8;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(190, 18, 60);
        doc.text(`Bancali non caricati / in attesa (${unplacedPallets.length}):`, 12, nextY);
        autoTable(doc, {
          startY: nextY + 3,
          head: [['Num.', 'Nome', 'Misure (L×W×H cm)', 'Peso']],
          body: unplacedPallets.map(p => [`#${p.seq}`, p.customName || `Bancale #${p.seq}`, `${p.length}×${p.width}×${p.height} cm`, `${p.weight || 0} kg`]),
          theme: 'striped',
          headStyles: { fillColor: [190, 18, 60], textColor: [255, 255, 255], fontSize: 8 },
          bodyStyles: { fontSize: 8 },
          margin: { left: 12, right: 12 }
        });
      }
    }

    const blobUrl = doc.output('bloburl');
    window.open(blobUrl, '_blank');
  };

  return (
    <div className="w-full min-w-0 max-w-[1600px] mx-auto animate-fade-in space-y-5 pb-10">
      {/* Header */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-black text-brand-white flex items-center gap-3">
            <ContainerIcon className="text-brand-blue shrink-0" size={32} />
            <span>Simulazione Carico Container</span>
          </h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">
            Configura dimensioni container, inserisci e rinomina bancali, ruota di punta/di piatto, impila in altezza e genera il carico intelligente 2D/3D.
          </p>
        </div>

        {/* Azioni Stampa PDF & Auto-Pack */}
        <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
          <button
            type="button"
            onClick={handleRunIntelligent}
            className="flex-1 sm:flex-initial justify-center bg-gradient-to-r from-brand-blue to-cyan-400 hover:from-sky-400 hover:to-cyan-300 text-brand-black font-black py-2.5 px-4 rounded-xl flex items-center gap-2 shadow-[0_0_24px_rgba(14,165,233,0.35)] transition-all active:scale-95 text-sm"
          >
            <Sparkles size={17} />
            Carico Intelligente
          </button>

          <button
            type="button"
            onClick={() => handlePrintPdf('RENDER')}
            className="px-3.5 py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-xl font-bold text-xs sm:text-sm flex items-center gap-1.5 transition-all"
            title="Stampa solo viste 2D e 3D"
          >
            <Eye size={15} className="text-brand-blue" /> Stampa 2D/3D
          </button>

          <button
            type="button"
            onClick={() => handlePrintPdf('LIST')}
            className="px-3.5 py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-xl font-bold text-xs sm:text-sm flex items-center gap-1.5 transition-all"
            title="Stampa solo Lista di Carico sequenziale"
          >
            <FileText size={15} className="text-emerald-400" /> Lista Carico
          </button>

          <button
            type="button"
            onClick={() => handlePrintPdf('BOTH')}
            className="px-3.5 py-2.5 bg-emerald-500/15 hover:bg-emerald-500 text-emerald-300 hover:text-brand-black border border-emerald-500/35 rounded-xl font-black text-xs sm:text-sm flex items-center gap-1.5 transition-all"
            title="Stampa Render 2D/3D + Lista di Carico completa"
          >
            <Printer size={15} /> Stampa Entrambi
          </button>
        </div>
      </div>

      {/* Inline Toast Feedback */}
      {notice && (
        <div className={`px-4 py-3 rounded-2xl border text-xs sm:text-sm font-bold flex items-center gap-2.5 ${
          notice.type === 'warn'
            ? 'bg-amber-500/15 border-amber-500/40 text-amber-200'
            : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200'
        }`}>
          {notice.type === 'warn' ? <AlertTriangle size={17} className="text-amber-400 shrink-0" /> : <CheckCircle2 size={17} className="text-emerald-400 shrink-0" />}
          <span>{notice.text}</span>
        </div>
      )}

      {/* Barra Misure Container (Standard o Personalizzate) + KPI Live */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-end gap-4">
          <div className="w-full lg:w-64">
            <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5">
              Formato Container / Mezzo
            </label>
            <select
              value={container.id}
              onChange={e => handleSelectContainerPreset(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-3 py-2.5 text-sm font-bold focus:border-brand-blue outline-none"
            >
              {CONTAINER_PRESETS.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.length}×{c.width}×{c.height} cm)
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Lunghezza (cm)</label>
              <input
                type="number"
                min="100"
                max="2000"
                value={container.length}
                onChange={e => setContainer(prev => ({ ...prev, id: 'CUSTOM', name: 'Personalizzato', length: Math.max(50, Number(e.target.value) || 0) }))}
                className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-3 py-2 text-sm font-mono font-bold focus:border-brand-blue"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Larghezza (cm)</label>
              <input
                type="number"
                min="80"
                max="400"
                value={container.width}
                onChange={e => setContainer(prev => ({ ...prev, id: 'CUSTOM', name: 'Personalizzato', width: Math.max(50, Number(e.target.value) || 0) }))}
                className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-3 py-2 text-sm font-mono font-bold focus:border-brand-blue"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Altezza Utile (cm)</label>
              <input
                type="number"
                min="80"
                max="400"
                value={container.height}
                onChange={e => setContainer(prev => ({ ...prev, id: 'CUSTOM', name: 'Personalizzato', height: Math.max(50, Number(e.target.value) || 0) }))}
                className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-3 py-2 text-sm font-mono font-bold focus:border-brand-blue"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Portata Max (kg)</label>
              <input
                type="number"
                min="0"
                value={container.maxWeight}
                onChange={e => setContainer(prev => ({ ...prev, maxWeight: Math.max(0, Number(e.target.value) || 0) }))}
                className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-3 py-2 text-sm font-mono font-bold focus:border-brand-blue"
              />
            </div>
          </div>
        </div>

        {/* Telemetria Carico */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-slate-800/80">
          <div className="bg-slate-950/70 border border-slate-800 rounded-2xl px-3.5 py-2.5">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Bancali Caricati</div>
            <div className="text-lg font-black text-brand-white mt-0.5">
              {metrics.placedCount} <span className="text-xs font-semibold text-slate-500">/ {metrics.totalCount} totali</span>
            </div>
          </div>
          <div className="bg-slate-950/70 border border-slate-800 rounded-2xl px-3.5 py-2.5">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Volume Occupato</div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-lg font-black text-brand-blue">{metrics.volPct.toFixed(1)}%</span>
              <span className="text-xs text-slate-400 font-mono">{metrics.usedVolM3.toFixed(2)}/{metrics.contVolM3.toFixed(1)} m³</span>
            </div>
          </div>
          <div className="bg-slate-950/70 border border-slate-800 rounded-2xl px-3.5 py-2.5">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Lunghezza Occupata</div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-lg font-black text-emerald-400">{metrics.maxUsedX} cm</span>
              <span className="text-xs text-slate-400 font-mono">({metrics.lenPct.toFixed(0)}%)</span>
            </div>
          </div>
          <div className={`border rounded-2xl px-3.5 py-2.5 ${metrics.overweight ? 'bg-rose-950/30 border-rose-500/40' : 'bg-slate-950/70 border-slate-800'}`}>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Peso Totale Carico</div>
            <div className={`text-lg font-black mt-0.5 ${metrics.overweight ? 'text-rose-400' : 'text-amber-400'}`}>
              {metrics.totalWeight.toFixed(0)} kg
              {metrics.overweight && <span className="text-[11px] font-bold ml-1.5">(Sovraccarico!)</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Main Split Workspace: SX Controlli & Lista Bancali (4 cols) | DX Canvas 2D/3D (8 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* COLONNA SINISTRA: Creazione Bancali & Lista Sequenziale */}
        <div className="xl:col-span-4 space-y-5">
          {/* Form Crea Bancale */}
          <form onSubmit={handleAddPallets} className="bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-black text-brand-white uppercase tracking-wider flex items-center gap-2">
                <PackagePlus size={18} className="text-brand-blue" />
                Crea Bancali / Misure
              </h2>
            </div>

            {/* Preset Rapidi */}
            <div className="flex flex-wrap gap-1.5">
              {PALLET_PRESETS.map(pr => (
                <button
                  key={pr.label}
                  type="button"
                  onClick={() => setDraft(prev => ({ ...prev, length: pr.length, width: pr.width, height: pr.height, weight: pr.weight }))}
                  className="px-2 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[10px] font-bold text-slate-300 transition-colors"
                >
                  {pr.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Lato 1 (cm)</label>
                <input
                  type="number"
                  required
                  min="20"
                  value={draft.width}
                  onChange={e => setDraft(prev => ({ ...prev, width: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-2.5 py-2 text-sm font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Lato 2 (cm)</label>
                <input
                  type="number"
                  required
                  min="20"
                  value={draft.length}
                  onChange={e => setDraft(prev => ({ ...prev, length: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-2.5 py-2 text-sm font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Altezza (cm)</label>
                <input
                  type="number"
                  required
                  min="10"
                  value={draft.height}
                  onChange={e => setDraft(prev => ({ ...prev, height: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-2.5 py-2 text-sm font-mono font-bold"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Peso (kg)</label>
                <input
                  type="number"
                  min="0"
                  value={draft.weight}
                  onChange={e => setDraft(prev => ({ ...prev, weight: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-2.5 py-2 text-sm font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Quantità</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={draft.qty}
                  onChange={e => setDraft(prev => ({ ...prev, qty: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-2.5 py-2 text-sm font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Colore</label>
                <div className="flex items-center gap-1 flex-wrap bg-slate-950 border border-slate-800 rounded-xl p-1.5 h-[38px] overflow-hidden">
                  {PALLET_COLORS.slice(0, 6).map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setDraft(prev => ({ ...prev, color: c }))}
                      className={`w-4 h-4 rounded-full border-2 ${draft.color === c ? 'border-white scale-110' : 'border-transparent opacity-70'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Nome / Prefisso (opzionale — altrimenti #1, #2...)</label>
              <input
                type="text"
                placeholder="Es. LOTTO ACQUA (vuoto = numerazione #1, #2...)"
                value={draft.prefixName}
                onChange={e => setDraft(prev => ({ ...prev, prefixName: e.target.value }))}
                className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-3 py-2 text-xs font-semibold"
              />
            </div>

            {/* Orientamento Di Punta / Di Piatto & Impilabilità */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDraft(prev => ({ ...prev, orientation: 'PUNTA' }))}
                className={`px-3 py-2 rounded-xl border text-xs font-bold transition-all text-left ${
                  draft.orientation === 'PUNTA'
                    ? 'bg-brand-blue/20 border-brand-blue text-brand-blue'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                <div>Di Punta (→)</div>
                <div className="text-[10px] opacity-80 font-mono">
                  {Math.max(Number(draft.length) || 0, Number(draft.width) || 0)}×{Math.min(Number(draft.length) || 0, Number(draft.width) || 0)} cm
                </div>
              </button>
              <button
                type="button"
                onClick={() => setDraft(prev => ({ ...prev, orientation: 'PIATTO' }))}
                className={`px-3 py-2 rounded-xl border text-xs font-bold transition-all text-left ${
                  draft.orientation === 'PIATTO'
                    ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                <div>Di Piatto (↕)</div>
                <div className="text-[10px] opacity-80 font-mono">
                  {Math.min(Number(draft.length) || 0, Number(draft.width) || 0)}×{Math.max(Number(draft.length) || 0, Number(draft.width) || 0)} cm
                </div>
              </button>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-300 font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={draft.stackable}
                onChange={e => setDraft(prev => ({ ...prev, stackable: e.target.checked }))}
                className="rounded border-slate-700"
              />
              Impilabile (può stare sotto o sopra altri bancali)
            </label>

            <button
              type="submit"
              className="w-full py-2.5 rounded-xl bg-brand-blue hover:bg-sky-400 text-brand-black font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-95"
            >
              <Plus size={17} /> Aggiungi Bancal{Number(draft.qty) === 1 ? 'e' : 'i'}
            </button>
          </form>

          {/* Lista Bancali Sequenziali */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-black text-brand-white uppercase tracking-wider flex items-center gap-2">
                <Box size={17} className="text-amber-400" />
                Bancali ({pallets.length})
              </h3>
              <div className="flex items-center gap-1.5">
                {placedPallets.length > 0 && (
                  <button
                    type="button"
                    onClick={handleEmptyContainer}
                    className="px-2.5 py-1 bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-300 rounded-lg text-[11px] font-bold flex items-center gap-1"
                    title="Togli tutti i bancali dal container mantenendoli in lista"
                  >
                    <RotateCcw size={12} /> Svuota
                  </button>
                )}
                {pallets.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { setPallets([]); setSelectedId(null); }}
                    className="px-2.5 py-1 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 rounded-lg text-[11px] font-bold"
                  >
                    Cancella Tutti
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2 max-h-[430px] overflow-y-auto pr-1">
              {pallets.length === 0 ? (
                <div className="p-6 text-center text-slate-500 text-xs italic">
                  Nessun bancale inserito. Usa il modulo qui sopra per creare i bancali (es. 80×120×86).
                </div>
              ) : pallets.map(p => {
                const { dx, dy, ori } = getFootprint(p);
                const isSel = p.id === selectedId;
                return (
                  <div
                    key={p.id}
                    onClick={() => setSelectedId(p.id)}
                    className={`rounded-2xl border p-2.5 transition-all cursor-pointer ${
                      isSel
                        ? 'bg-brand-blue/10 border-brand-blue shadow-sm'
                        : p.placed
                        ? 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                        : 'bg-slate-950/40 border-amber-500/30 hover:border-amber-500/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span
                          className="w-6 h-6 rounded-lg shrink-0 flex items-center justify-center font-black text-[11px] text-slate-950"
                          style={{ backgroundColor: p.color }}
                        >
                          {p.seq}
                        </span>
                        {editingNameId === p.id ? (
                          <div className="flex items-center gap-1 flex-1" onClick={e => e.stopPropagation()}>
                            <input
                              type="text"
                              autoFocus
                              value={editingNameVal}
                              onChange={e => setEditingNameVal(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleSaveName(p.id); }}
                              placeholder={`Bancale #${p.seq}`}
                              className="w-full bg-slate-900 border border-brand-blue rounded-lg px-2 py-0.5 text-xs text-white outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveName(p.id)}
                              className="p-1 bg-emerald-500 text-brand-black rounded-lg"
                            >
                              <Check size={12} />
                            </button>
                          </div>
                        ) : (
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-xs text-brand-white truncate">
                                {p.customName || `Bancale #${p.seq}`}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingNameId(p.id);
                                  setEditingNameVal(p.customName || '');
                                }}
                                className="text-slate-500 hover:text-brand-blue"
                                title="Rinomina paletta"
                              >
                                <Edit3 size={11} />
                              </button>
                            </div>
                            <div className="text-[10px] font-mono text-slate-400">
                              {p.width}×{p.length}×H{p.height} cm • {p.weight || 0}kg • <strong className={ori === 'PUNTA' ? 'text-brand-blue' : 'text-amber-300'}>{ori === 'PUNTA' ? `Punta ${dx}×${dy}` : `Piatto ${dx}×${dy}`}</strong>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => handleToggleOrientation(p.id)}
                          className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800"
                          title="Ruota Di Punta / Di Piatto"
                        >
                          <RotateCw size={13} />
                        </button>
                        {p.placed ? (
                          <button
                            type="button"
                            onClick={() => handleRemoveFromContainer(p.id)}
                            className="px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 hover:bg-amber-500/20 hover:text-amber-300 border border-emerald-500/30 text-[10px] font-black"
                            title="Togli dal container"
                          >
                            {p.z > 0 ? `Z:${p.z}` : 'Caricato'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handlePlaceSingle(p.id)}
                            className="px-2 py-1 rounded-lg bg-brand-blue/20 hover:bg-brand-blue text-brand-blue hover:text-brand-black border border-brand-blue/35 text-[10px] font-black flex items-center gap-0.5"
                            title="Inserisci automaticamente nel container"
                          >
                            Carica <ChevronRight size={12} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeletePallet(p.id)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10"
                          title="Elimina bancale"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* COLONNA DESTRA: Area Simulazione 2D + 3D + Controlli */}
        <div className="xl:col-span-8 space-y-5">
          {/* Toolbar Controlli Canvas & Impilamento */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3 shadow-lg">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setViewMode('BOTH')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${viewMode === 'BOTH' ? 'bg-brand-blue text-brand-black' : 'text-slate-400 hover:text-white'}`}
                >
                  2D + 3D
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('2D')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${viewMode === '2D' ? 'bg-brand-blue text-brand-black' : 'text-slate-400 hover:text-white'}`}
                >
                  Solo 2D
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('3D')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${viewMode === '3D' ? 'bg-brand-blue text-brand-black' : 'text-slate-400 hover:text-white'}`}
                >
                  Solo 3D
                </button>
              </div>

              <label className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowStacking}
                  onChange={e => setAllowStacking(e.target.checked)}
                />
                <Layers size={14} className="text-amber-400" /> Impilamento Verticale
              </label>

              {allowStacking && (
                <label className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-300 cursor-pointer" title="Trascinando sopra una paletta si appoggia automaticamente sopra se entra in altezza">
                  <input
                    type="checkbox"
                    checked={autoStackOnDrop}
                    onChange={e => setAutoStackOnDrop(e.target.checked)}
                  />
                  Auto-Impila al Trascinamento
                </label>
              )}
            </div>

            {/* Simulatore Sequenza Carico */}
            <div className="flex items-center gap-2">
              {placedPallets.length > 0 && (
                <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (isPlayingAnim) {
                        setIsPlayingAnim(false);
                      } else {
                        setAnimStep(0);
                        setIsPlayingAnim(true);
                      }
                    }}
                    className="p-1 rounded-lg bg-brand-blue text-brand-black hover:bg-sky-400"
                    title="Anima sequenza carico dal fondo alle porte"
                  >
                    {isPlayingAnim ? <Pause size={13} /> : <Play size={13} />}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max={placedPallets.length}
                    value={animStep === null ? placedPallets.length : animStep}
                    onChange={e => {
                      setIsPlayingAnim(false);
                      const v = parseInt(e.target.value, 10);
                      setAnimStep(v >= placedPallets.length ? null : v);
                    }}
                    className="w-24 sm:w-32 accent-sky-400"
                  />
                  <span className="text-[11px] font-mono text-slate-300 font-bold">
                    {animStep === null ? `${placedPallets.length}/${placedPallets.length}` : `${animStep}/${placedPallets.length}`}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Interactive 2D Pianta + Profilo Laterale */}
          {(viewMode === '2D' || viewMode === 'BOTH') && (
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 shadow-xl space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-brand-white">
                  <Move size={15} className="text-brand-blue" />
                  Vista 2D Interattiva (Trascina le palette, snap magnetico &amp; auto-impilamento)
                </div>
                <div className="text-[11px] text-slate-400">
                  <span className="text-rose-400 font-bold">Rosso = Dietro (Più Alte)</span> • <span className="text-emerald-400 font-bold">Verde = Davanti / Porte (Più Basse)</span>
                </div>
              </div>

              <div className="w-full h-[240px] sm:h-[280px] rounded-2xl overflow-hidden border border-slate-800 bg-slate-950">
                <canvas
                  ref={canvas2DRef}
                  onMouseDown={handle2DMouseDown}
                  onMouseMove={handle2DMouseMove}
                  onMouseUp={handle2DMouseUp}
                  onMouseLeave={handle2DMouseUp}
                  className="w-full h-full cursor-grab active:cursor-grabbing block"
                />
              </div>

              <div className="w-full h-[155px] sm:h-[175px] rounded-2xl overflow-hidden border border-slate-800 bg-slate-950">
                <canvas ref={canvasSideRef} className="w-full h-full block" />
              </div>
            </div>
          )}

          {/* Interactive 3D Viewport */}
          {(viewMode === '3D' || viewMode === 'BOTH') && (
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 shadow-xl space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-brand-white">
                  <Compass size={15} className="text-cyan-400" />
                  Vista 3D Interattiva (Trascina per ruotare • Clicca un bancale per selezionarlo)
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => { setCamYaw(0.58); setCamPitch(0.42); setCamZoom(1.0); }}
                    className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-white font-bold text-[11px]"
                  >
                    3D Isometrica
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCamYaw(1.57); setCamPitch(0.25); setCamZoom(1.05); }}
                    className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-white font-bold text-[11px]"
                  >
                    Vista Porte
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCamYaw(0.0); setCamPitch(0.18); setCamZoom(1.0); }}
                    className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-white font-bold text-[11px]"
                  >
                    Lato Container
                  </button>
                  <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1">
                    <Maximize2 size={12} className="text-slate-400" />
                    <input
                      type="range"
                      min="0.6"
                      max="1.8"
                      step="0.05"
                      value={camZoom}
                      onChange={e => setCamZoom(parseFloat(e.target.value))}
                      className="w-16 accent-cyan-400"
                    />
                  </div>
                </div>
              </div>

              <div className="w-full h-[320px] sm:h-[390px] rounded-2xl overflow-hidden border border-slate-800 bg-slate-950">
                <canvas
                  ref={canvas3DRef}
                  onMouseDown={handle3DMouseDown}
                  onMouseMove={handle3DMouseMove}
                  onMouseUp={handle3DMouseUp}
                  onMouseLeave={handle3DMouseUp}
                  className="w-full h-full cursor-grab active:cursor-grabbing block"
                />
              </div>
            </div>
          )}

          {/* Inspector Bancale Selezionato */}
          {selectedPallet && (
            <div className="bg-slate-900 border border-brand-blue/40 rounded-3xl p-4 sm:p-5 shadow-xl space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-7 h-7 rounded-xl flex items-center justify-center font-black text-xs text-slate-950"
                    style={{ backgroundColor: selectedPallet.color }}
                  >
                    #{selectedPallet.seq}
                  </span>
                  <div>
                    <div className="font-black text-sm text-brand-white">
                      {selectedPallet.customName || `Bancale #${selectedPallet.seq}`}
                    </div>
                    <div className="text-[11px] font-mono text-slate-400">
                      {selectedPallet.width}×{selectedPallet.length}×H{selectedPallet.height} cm • {selectedPallet.weight || 0} kg
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggleOrientation(selectedPallet.id)}
                    className="px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-xs font-bold text-brand-blue flex items-center gap-1.5"
                  >
                    <RotateCw size={14} />
                    {selectedPallet.orientation === 'PUNTA' ? 'Di Punta → Passa a Di Piatto' : 'Di Piatto → Passa a Di Punta'}
                  </button>

                  {selectedPallet.placed && selectedPallet.z > 0 && (
                    <button
                      type="button"
                      onClick={() => handleUpdatePosition(selectedPallet.id, { z: 0, stackedOnId: null })}
                      className="px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-xs font-bold text-amber-300 flex items-center gap-1"
                    >
                      <ArrowDownToLine size={14} /> Metti a Terra (Z=0)
                    </button>
                  )}

                  {!selectedPallet.placed ? (
                    <button
                      type="button"
                      onClick={() => handlePlaceSingle(selectedPallet.id)}
                      className="px-3 py-1.5 rounded-xl bg-brand-blue text-brand-black font-black text-xs"
                    >
                      Inserisci nel Container
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleRemoveFromContainer(selectedPallet.id)}
                      className="px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/35 font-bold text-xs"
                    >
                      Rimuovi dal Carico
                    </button>
                  )}
                </div>
              </div>

              {selectedPallet.placed && (
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-800/80">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">X da Fondo (cm)</label>
                    <input
                      type="number"
                      step="5"
                      value={selectedPallet.x}
                      onChange={e => handleUpdatePosition(selectedPallet.id, { x: Number(e.target.value) || 0 })}
                      className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-2.5 py-1.5 text-xs font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Y da Parete SX (cm)</label>
                    <input
                      type="number"
                      step="5"
                      value={selectedPallet.y}
                      onChange={e => handleUpdatePosition(selectedPallet.id, { y: Number(e.target.value) || 0 })}
                      className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-2.5 py-1.5 text-xs font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Z Altezza (cm)</label>
                    <input
                      type="number"
                      step="5"
                      value={selectedPallet.z}
                      onChange={e => handleUpdatePosition(selectedPallet.id, { z: Number(e.target.value) || 0 })}
                      className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-2.5 py-1.5 text-xs font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1 flex items-center gap-1">
                      <ArrowUpToLine size={11} className="text-amber-400" /> Impila Sopra:
                    </label>
                    <select
                      value=""
                      onChange={e => { if (e.target.value) handleStackOnTarget(selectedPallet.id, e.target.value); }}
                      className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-2.5 py-1.5 text-xs font-bold"
                    >
                      <option value="">Scegli bancale base...</option>
                      {placedPallets
                        .filter(b => b.id !== selectedPallet.id && b.stackable !== false && (b.z || 0) + b.height + selectedPallet.height <= container.height)
                        .map(b => (
                          <option key={b.id} value={b.id}>
                            {b.customName || `#${b.seq}`} (Top {(b.z || 0) + b.height} cm)
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Riepilogo Lista di Carico Live (Fondo -> Porte) */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-black text-brand-white uppercase tracking-wider flex items-center gap-2">
                <Sliders size={16} className="text-emerald-400" />
                Sequenza di Carico (Fondo #1 → Porte)
              </h3>
              <span className="text-xs text-slate-400 font-semibold">
                {placedPallets.length} caricat{placedPallets.length === 1 ? 'o' : 'i'} • {unplacedPallets.length} in attesa
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider">
                    <th className="py-2 px-2">Ordine</th>
                    <th className="py-2 px-2">Bancale / Nome</th>
                    <th className="py-2 px-2">Misure (L×W×H)</th>
                    <th className="py-2 px-2">Orientamento</th>
                    <th className="py-2 px-2">Posizione / Piano</th>
                    <th className="py-2 px-2 text-right">Peso</th>
                  </tr>
                </thead>
                <tbody>
                  {placedPallets.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="py-6 text-center text-slate-500 italic">
                        Nessun bancale caricato. Premi &ldquo;Carico Intelligente&rdquo; o carica manualmente dalla lista a sinistra.
                      </td>
                    </tr>
                  ) : placedPallets.map((p, idx) => {
                    const { dx, dy, ori } = getFootprint(p);
                    const baseObj = p.stackedOnId ? placedPallets.find(b => b.id === p.stackedOnId) : null;
                    return (
                      <tr
                        key={p.id}
                        onClick={() => setSelectedId(p.id)}
                        className={`border-b border-slate-800/50 cursor-pointer transition-colors ${
                          p.id === selectedId ? 'bg-brand-blue/10' : 'hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="py-2 px-2 font-mono font-black text-brand-blue">#{idx + 1}</td>
                        <td className="py-2 px-2 font-bold text-brand-white">
                          <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5" style={{ backgroundColor: p.color }} />
                          {p.customName || `Bancale #${p.seq}`}
                        </td>
                        <td className="py-2 px-2 font-mono text-slate-300">{p.width}×{p.length}×{p.height} cm</td>
                        <td className="py-2 px-2">
                          <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${
                            ori === 'PUNTA' ? 'bg-brand-blue/15 text-brand-blue' : 'bg-amber-500/15 text-amber-300'
                          }`}>
                            {ori === 'PUNTA' ? `Di Punta (${dx}×${dy})` : `Di Piatto (${dx}×${dy})`}
                          </span>
                        </td>
                        <td className="py-2 px-2 font-mono text-slate-300">
                          X:{p.x} Y:{p.y} •{' '}
                          {(p.z || 0) > 0 ? (
                            <span className="text-amber-300 font-bold">
                              Sopra {baseObj ? (baseObj.customName || `#${baseObj.seq}`) : ''} (Z:{p.z})
                            </span>
                          ) : (
                            <span className="text-emerald-400">A Terra</span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-slate-300">{p.weight || 0} kg</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContainerSimulator;
