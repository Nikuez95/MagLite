import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import jsPDF from 'jspdf';
import {
  Signpost, Printer, Download, Sparkles, Layers, QrCode, Palette,
  Maximize2, Copy, CheckCircle2, Image as ImageIcon, Plus
} from 'lucide-react';
import { appAlert } from '../../utils/alerts';

const FORMAT_OPTIONS = [
  { id: 'A4_L', label: 'A4 Orizzontale', sizeLabel: '297 × 210 mm', format: 'a4', orientation: 'landscape', ratio: '297 / 210', wMm: 297, hMm: 210 },
  { id: 'A4_P', label: 'A4 Verticale', sizeLabel: '210 × 297 mm', format: 'a4', orientation: 'portrait', ratio: '210 / 297', wMm: 210, hMm: 297 },
  { id: 'A3_L', label: 'A3 Grande Orizzontale', sizeLabel: '420 × 297 mm', format: 'a3', orientation: 'landscape', ratio: '420 / 297', wMm: 420, hMm: 297 },
  { id: 'A3_P', label: 'A3 Grande Verticale', sizeLabel: '297 × 420 mm', format: 'a3', orientation: 'portrait', ratio: '297 / 420', wMm: 297, hMm: 420 },
  { id: 'POSTER_2X2', label: 'Poster XXL (4 Fogli A4)', sizeLabel: '594 × 420 mm (2×2 A4)', format: 'a4', orientation: 'landscape', ratio: '594 / 420', wMm: 594, hMm: 420, tiled: true }
];

const THEMES = {
  BRAND_LIGHT: {
    id: 'BRAND_LIGHT',
    name: 'Brand Chiaro (Eco Toner)',
    isDark: false,
    bgHex: '#ffffff',
    accentHex: '#0284c7',
    frameHex: '#0f172a',
    titleHex: '#0f172a',
    subHex: '#475569',
    badgeBgHex: '#e0f2fe',
    badgeTextHex: '#0369a1'
  },
  BRAND_DARK: {
    id: 'BRAND_DARK',
    name: 'Brand Scuro (Navy & Ciano)',
    isDark: true,
    bgHex: '#0f172a',
    accentHex: '#38bdf8',
    frameHex: '#1e293b',
    titleHex: '#ffffff',
    subHex: '#cbd5e1',
    badgeBgHex: '#082f49',
    badgeTextHex: '#38bdf8'
  },
  SAFETY_AMBER: {
    id: 'SAFETY_AMBER',
    name: 'Sicurezza / ADR (Giallo & Nero)',
    isDark: false,
    bgHex: '#fefce8',
    accentHex: '#eab308',
    frameHex: '#18181b',
    titleHex: '#18181b',
    subHex: '#52525b',
    badgeBgHex: '#18181b',
    badgeTextHex: '#facc15'
  },
  COLD_CHAIN: {
    id: 'COLD_CHAIN',
    name: 'Catena del Freddo (Ciano)',
    isDark: false,
    bgHex: '#f0f9ff',
    accentHex: '#06b6d4',
    frameHex: '#0e7490',
    titleHex: '#0c4a6e',
    subHex: '#0369a1',
    badgeBgHex: '#cffafe',
    badgeTextHex: '#0e7490'
  },
  DISPATCH_GREEN: {
    id: 'DISPATCH_GREEN',
    name: 'Zona Carico / OK (Verde)',
    isDark: false,
    bgHex: '#f0fdf4',
    accentHex: '#10b981',
    frameHex: '#065f46',
    titleHex: '#064e3b',
    subHex: '#047857',
    badgeBgHex: '#d1fae5',
    badgeTextHex: '#065f46'
  }
};

const QUICK_PRESETS = [
  { title: 'AREA 1', subtitle: 'Zona Stoccaggio Principale', theme: 'BRAND_LIGHT' },
  { title: 'AREA 2', subtitle: 'Corsia Bancali Interi', theme: 'BRAND_LIGHT' },
  { title: 'CELLA 1', subtitle: 'Temperatura Controllata +6°C / +8°C', theme: 'COLD_CHAIN' },
  { title: 'ZONA CARICO', subtitle: 'Merce Pronta per Spedizione', theme: 'DISPATCH_GREEN' },
  { title: 'QUARANTENA', subtitle: 'Merce Bloccata — Solo Personale Autorizzato', theme: 'SAFETY_AMBER' }
];

const hexToRgb = (hex) => {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const fetchAsDataUrl = async (url, headers = null) => {
  try {
    const res = await fetch(url, headers ? { headers } : undefined);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result);
      r.readAsDataURL(blob);
    });
  } catch (_) {
    return null;
  }
};

const drawSignToCanvas = async ({
  title,
  subtitle,
  eyebrow,
  theme,
  wPx,
  hPx,
  companySettings,
  showLogo,
  showBarcode,
  barcodeDataUrl,
  logoDataUrl
}) => {
  const canvas = document.createElement('canvas');
  canvas.width = wPx;
  canvas.height = hPx;
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = theme.bgHex;
  ctx.fillRect(0, 0, wPx, hPx);

  // Outer brand border + top/bottom stripes
  const pad = Math.round(Math.min(wPx, hPx) * 0.045);
  const borderW = Math.max(6, Math.round(Math.min(wPx, hPx) * 0.012));
  ctx.fillStyle = theme.accentHex;
  ctx.fillRect(0, 0, wPx, borderW * 2.2);
  ctx.fillRect(0, hPx - borderW * 1.4, wPx, borderW * 1.4);

  ctx.strokeStyle = theme.frameHex;
  ctx.lineWidth = borderW;
  ctx.strokeRect(pad, pad, wPx - pad * 2, hPx - pad * 2);

  // Corner accent marks
  const cornerLen = Math.round(Math.min(wPx, hPx) * 0.07);
  ctx.strokeStyle = theme.accentHex;
  ctx.lineWidth = Math.max(6, borderW * 1.15);
  const drawCorner = (x, y, dx, dy) => {
    ctx.beginPath();
    ctx.moveTo(x, y + dy * cornerLen);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dx * cornerLen, y);
    ctx.stroke();
  };
  drawCorner(pad, pad, 1, 1);
  drawCorner(wPx - pad, pad, -1, 1);
  drawCorner(pad, hPx - pad, 1, -1);
  drawCorner(wPx - pad, hPx - pad, -1, -1);

  // Header: Logo + Eyebrow badge
  const innerPad = pad + Math.round(Math.min(wPx, hPx) * 0.05);
  let topContentBottom = innerPad + Math.round(hPx * 0.1);

  if (showLogo && logoDataUrl) {
    await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const maxLogoH = Math.round(hPx * 0.14);
        const maxLogoW = Math.round(wPx * 0.24);
        const ratio = Math.min(maxLogoW / img.width, maxLogoH / img.height);
        const lw = img.width * ratio;
        const lh = img.height * ratio;
        ctx.drawImage(img, innerPad, innerPad, lw, lh);
        topContentBottom = Math.max(topContentBottom, innerPad + lh + 20);
        resolve();
      };
      img.onerror = resolve;
      img.src = logoDataUrl;
    });
  }

  const badgeText = (eyebrow || companySettings.company_name || 'MAGAZZINO LOGISTICA').toUpperCase();
  if (badgeText) {
    const badgeFont = Math.round(Math.min(wPx, hPx) * 0.028);
    ctx.font = `900 ${badgeFont}px sans-serif`;
    const bw = Math.min(wPx * 0.55, ctx.measureText(badgeText).width + badgeFont * 2.2);
    const bh = badgeFont * 2.1;
    const bx = wPx - innerPad - bw;
    const by = innerPad + 4;
    ctx.fillStyle = theme.badgeBgHex;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, bh / 2);
    ctx.fill();
    ctx.fillStyle = theme.badgeTextHex;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, bx + bw / 2, by + bh / 2, bw - badgeFont);
  }

  // Center Title & Subtitle
  const safeTitle = (title || 'AREA 1').trim();
  const safeSub = (subtitle || '').trim();
  const centerZoneTop = topContentBottom + Math.round(hPx * 0.04);
  const footerReserve = showBarcode && barcodeDataUrl ? Math.round(hPx * 0.22) : Math.round(hPx * 0.1);
  const centerZoneBottom = hPx - innerPad - footerReserve;
  const centerY = (centerZoneTop + centerZoneBottom) / 2;
  const maxTextW = wPx - innerPad * 2 - 40;

  let titleFontSize = Math.round(Math.min(wPx * 0.16, hPx * 0.24));
  const minTitleFont = Math.round(Math.min(wPx, hPx) * 0.055);
  ctx.font = `900 ${titleFontSize}px sans-serif`;
  while (titleFontSize > minTitleFont && ctx.measureText(safeTitle).width > maxTextW) {
    titleFontSize -= 4;
    ctx.font = `900 ${titleFontSize}px sans-serif`;
  }

  // Wrap title if still wider than maxTextW
  const words = safeTitle.split(/\s+/);
  const titleLines = [];
  let curLine = '';
  for (const w of words) {
    const test = curLine ? `${curLine} ${w}` : w;
    if (ctx.measureText(test).width <= maxTextW) {
      curLine = test;
    } else {
      if (curLine) titleLines.push(curLine);
      curLine = w;
    }
  }
  if (curLine) titleLines.push(curLine);

  const lineH = titleFontSize * 1.12;
  const totalTitleH = titleLines.length * lineH;

  let subLines = [];
  let subFontSize = Math.round(Math.min(wPx * 0.045, hPx * 0.065));
  if (safeSub) {
    ctx.font = `700 ${subFontSize}px sans-serif`;
    while (subFontSize > Math.round(minTitleFont * 0.55) && ctx.measureText(safeSub).width > maxTextW * 1.7) {
      subFontSize -= 2;
      ctx.font = `700 ${subFontSize}px sans-serif`;
    }
    const subWords = safeSub.split(/\s+/);
    let sCur = '';
    for (const sw of subWords) {
      const test = sCur ? `${sCur} ${sw}` : sw;
      if (ctx.measureText(test).width <= maxTextW) {
        sCur = test;
      } else {
        if (sCur) subLines.push(sCur);
        sCur = sw;
      }
    }
    if (sCur) subLines.push(sCur);
  }
  const subLineH = subFontSize * 1.25;
  const gapBetween = safeSub ? Math.round(hPx * 0.04) : 0;
  const dividerH = safeSub ? 8 : 0;
  const totalBlockH = totalTitleH + gapBetween + dividerH + (subLines.length * subLineH);

  let yCursor = centerY - totalBlockH / 2 + lineH / 2;
  ctx.fillStyle = theme.titleHex;
  ctx.font = `900 ${titleFontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const tl of titleLines) {
    ctx.fillText(tl, wPx / 2, yCursor, maxTextW);
    yCursor += lineH;
  }

  if (safeSub) {
    const divW = Math.min(maxTextW * 0.45, Math.round(wPx * 0.28));
    const divY = yCursor - lineH / 2 + gapBetween * 0.45;
    ctx.fillStyle = theme.accentHex;
    ctx.beginPath();
    ctx.roundRect(wPx / 2 - divW / 2, divY, divW, Math.max(6, borderW * 0.8), 4);
    ctx.fill();

    yCursor = divY + gapBetween * 0.65 + subLineH / 2;
    ctx.fillStyle = theme.subHex;
    ctx.font = `700 ${subFontSize}px sans-serif`;
    for (const sl of subLines) {
      ctx.fillText(sl, wPx / 2, yCursor, maxTextW);
      yCursor += subLineH;
    }
  }

  // Optional Barcode centered at bottom
  if (showBarcode && barcodeDataUrl) {
    await new Promise((resolve) => {
      const bImg = new Image();
      bImg.onload = () => {
        const bw = Math.min(wPx * 0.44, Math.round(wPx * 0.38));
        const bh = Math.round(hPx * 0.11);
        const bx = (wPx - bw) / 2;
        const by = hPx - innerPad - bh - Math.round(hPx * 0.03);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.roundRect(bx - 16, by - 10, bw + 32, bh + 20, 12);
        ctx.fill();
        ctx.drawImage(bImg, bx, by, bw, bh);
        resolve();
      };
      bImg.onerror = resolve;
      bImg.src = barcodeDataUrl;
    });
  }

  // Footer info
  const footerParts = [
    companySettings.company_name,
    companySettings.company_address
  ].filter(Boolean);
  if (footerParts.length > 0) {
    const footFont = Math.round(Math.min(wPx, hPx) * 0.02);
    ctx.font = `600 ${footFont}px sans-serif`;
    ctx.fillStyle = theme.subHex;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(footerParts.join('  •  '), wPx - innerPad, hPx - innerPad + 6, wPx * 0.65);
  }

  return canvas;
};

const WarehouseSigns = () => {
  const [title, setTitle] = useState('AREA 1');
  const [subtitle, setSubtitle] = useState('Stoccaggio Merce Secca');
  const [eyebrow, setEyebrow] = useState('');
  const [formatId, setFormatId] = useState('A4_L');
  const [themeId, setThemeId] = useState('BRAND_LIGHT');
  const [showLogo, setShowLogo] = useState(true);
  const [showBarcode, setShowBarcode] = useState(false);

  // Modalità serie multipla
  const [batchMode, setBatchMode] = useState(false);
  const [batchPrefix, setBatchPrefix] = useState('AREA ');
  const [batchFrom, setBatchFrom] = useState(1);
  const [batchTo, setBatchTo] = useState(4);
  const [batchListText, setBatchListText] = useState('');

  const [companySettings, setCompanySettings] = useState({});
  const [barcodePreviewUrl, setBarcodePreviewUrl] = useState('');
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const token = localStorage.getItem('maglite_token');
  const activeFormat = FORMAT_OPTIONS.find(f => f.id === formatId) || FORMAT_OPTIONS[0];
  const activeTheme = THEMES[themeId] || THEMES.BRAND_LIGHT;

  useEffect(() => {
    axios
      .get(`http://${window.location.hostname}:3000/api/settings`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      .then(res => setCompanySettings(res.data || {}))
      .catch(() => {});
  }, [token]);

  // Barcode live preview quando attivo
  useEffect(() => {
    let active = true;
    if (!showBarcode || !title.trim()) {
      setBarcodePreviewUrl('');
      return;
    }
    const clean = title.trim().slice(0, 60);
    fetchAsDataUrl(
      `http://${window.location.hostname}:3000/api/settings/barcode?text=${encodeURIComponent(clean)}`,
      { Authorization: `Bearer ${token}` }
    ).then(url => {
      if (active) setBarcodePreviewUrl(url || '');
    });
    return () => { active = false; };
  }, [showBarcode, title, token]);

  const batchTitles = useMemo(() => {
    if (!batchMode) return [title.trim() || 'AREA 1'];
    if (batchListText.trim()) {
      const list = batchListText.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
      if (list.length > 0) return list;
    }
    const start = Math.max(1, parseInt(batchFrom, 10) || 1);
    const end = Math.max(start, Math.min(start + 49, parseInt(batchTo, 10) || start));
    const arr = [];
    for (let i = start; i <= end; i++) {
      arr.push(`${batchPrefix}${i}`);
    }
    return arr;
  }, [batchMode, batchListText, batchPrefix, batchFrom, batchTo, title]);

  const handleGeneratePdf = async () => {
    setIsGeneratingPdf(true);
    try {
      const logoPath = activeTheme.isDark ? '/logo.png' : '/logo_scuro.png';
      const logoDataUrl = showLogo
        ? (companySettings.company_logo && String(companySettings.company_logo).startsWith('data:image')
          ? companySettings.company_logo
          : await fetchAsDataUrl(logoPath))
        : null;

      const isTiled = Boolean(activeFormat.tiled);
      const doc = new jsPDF({
        orientation: activeFormat.orientation,
        unit: 'mm',
        format: activeFormat.format
      });

      const scaleFactor = isTiled ? 5.5 : (activeFormat.format === 'a3' ? 5 : 5.5);
      const canvasW = Math.round(activeFormat.wMm * scaleFactor);
      const canvasH = Math.round(activeFormat.hMm * scaleFactor);

      let firstDocPage = true;
      for (const signTitle of batchTitles) {
        let bUrl = null;
        if (showBarcode && signTitle) {
          bUrl = await fetchAsDataUrl(
            `http://${window.location.hostname}:3000/api/settings/barcode?text=${encodeURIComponent(signTitle)}`,
            { Authorization: `Bearer ${token}` }
          );
        }

        const fullCanvas = await drawSignToCanvas({
          title: signTitle,
          subtitle,
          eyebrow,
          theme: activeTheme,
          wPx: canvasW,
          hPx: canvasH,
          companySettings,
          showLogo,
          showBarcode,
          barcodeDataUrl: bUrl,
          logoDataUrl
        });

        if (!isTiled) {
          if (!firstDocPage) doc.addPage(activeFormat.format, activeFormat.orientation);
          firstDocPage = false;
          const imgData = fullCanvas.toDataURL('image/png');
          doc.addImage(imgData, 'PNG', 0, 0, activeFormat.wMm, activeFormat.hMm);
        } else {
          // Dividi in 2x2 fogli A4 orizzontali con leggera sovrapposizione/segni taglio
          const cols = 2;
          const rows = 2;
          const tileW = fullCanvas.width / cols;
          const tileH = fullCanvas.height / rows;
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              if (!firstDocPage) doc.addPage('a4', 'landscape');
              firstDocPage = false;
              const tileCanvas = document.createElement('canvas');
              tileCanvas.width = Math.round(tileW);
              tileCanvas.height = Math.round(tileH);
              const tctx = tileCanvas.getContext('2d');
              tctx.drawImage(
                fullCanvas,
                c * tileW, r * tileH, tileW, tileH,
                0, 0, tileCanvas.width, tileCanvas.height
              );
              doc.addImage(tileCanvas.toDataURL('image/png'), 'PNG', 0, 0, 297, 210);
              doc.setFontSize(7);
              const [tr, tg, tb] = hexToRgb(activeTheme.subHex);
              doc.setTextColor(tr, tg, tb);
              doc.text(`Poster 2×2 — Riga ${r + 1}/2, Colonna ${c + 1}/2 (${signTitle})`, 6, 206);
            }
          }
        }
      }

      const fileSlug = (batchMode ? `${batchPrefix || 'cartelli'}_serie` : (title || 'cartello'))
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
      doc.save(`cartello_${fileSlug || 'magazzino'}_${activeFormat.id}.pdf`);
    } catch (err) {
      console.error(err);
      appAlert('Errore durante la generazione del PDF del cartello.');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const previewTitle = batchMode ? (batchTitles[0] || 'AREA 1') : (title || 'AREA 1');
  const logoSrc = companySettings.company_logo && String(companySettings.company_logo).startsWith('data:image')
    ? companySettings.company_logo
    : (activeTheme.isDark ? '/logo.png' : '/logo_scuro.png');

  return (
    <div className="w-full min-w-0 max-w-7xl mx-auto animate-fade-in-up space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-brand-white flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-brand-blue/15 border border-brand-blue/30 flex items-center justify-center text-brand-blue shrink-0">
              <Signpost size={24} />
            </span>
            Cartelli &amp; Etichette Magazzino
          </h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">
            Crea cartelli brandizzati e ad alta leggibilità per Aree, Celle, Corsie e Zone di Carico in A4, A3 o Poster XXL.
          </p>
        </div>

        <button
          type="button"
          disabled={isGeneratingPdf}
          onClick={handleGeneratePdf}
          className="w-full sm:w-auto px-5 py-3 bg-brand-blue hover:bg-sky-400 text-brand-black font-black rounded-2xl text-sm flex items-center justify-center gap-2 shadow-[0_0_25px_rgba(14,165,233,0.3)] transition-all disabled:opacity-50"
        >
          <Download size={18} />
          {isGeneratingPdf
            ? 'Generazione PDF...'
            : batchMode
            ? `Scarica Serie (${batchTitles.length} cartelli)`
            : 'Scarica / Stampa Cartello PDF'}
        </button>
      </div>

      {/* Preset Rapidi */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-black uppercase tracking-wider text-slate-500 mr-1">Preset rapidi:</span>
        {QUICK_PRESETS.map(p => (
          <button
            key={p.title}
            type="button"
            onClick={() => {
              setBatchMode(false);
              setTitle(p.title);
              setSubtitle(p.subtitle);
              setThemeId(p.theme);
            }}
            className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-brand-blue/50 text-xs font-bold text-slate-300 hover:text-white transition-all"
          >
            {p.title}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Colonna Sinistra: Controlli */}
        <div className="xl:col-span-5 bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-5 shadow-xl">
          {/* Singolo vs Serie */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-slate-950 rounded-2xl border border-slate-800">
            <button
              type="button"
              onClick={() => setBatchMode(false)}
              className={`py-2 px-3 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 ${
                !batchMode ? 'bg-brand-blue text-brand-black shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Signpost size={14} /> Cartello Singolo
            </button>
            <button
              type="button"
              onClick={() => setBatchMode(true)}
              className={`py-2 px-3 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 ${
                batchMode ? 'bg-brand-blue text-brand-black shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Layers size={14} /> Serie Multipla
            </button>
          </div>

          {!batchMode ? (
            <div>
              <label className="block text-xs font-black uppercase tracking-wider text-slate-400 mb-1.5">
                Titolo Principale (Centrato) *
              </label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Es. AREA 1, CELLA 2, CORSIA B..."
                className="w-full bg-slate-950 border border-slate-700 focus:border-brand-blue text-white font-black text-lg rounded-2xl px-4 py-3 outline-none"
              />
            </div>
          ) : (
            <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 space-y-3">
              <div className="text-xs font-black text-brand-blue uppercase tracking-wider">
                Generazione Multipla in 1 PDF
              </div>
              <div className="grid grid-cols-12 gap-2.5">
                <div className="col-span-6">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Prefisso</label>
                  <input
                    type="text"
                    value={batchPrefix}
                    onChange={e => setBatchPrefix(e.target.value)}
                    placeholder="AREA "
                    className="w-full bg-slate-900 border border-slate-700 text-white font-bold text-sm rounded-xl px-3 py-2 outline-none"
                  />
                </div>
                <div className="col-span-3">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Da</label>
                  <input
                    type="number"
                    min="1"
                    value={batchFrom}
                    onChange={e => setBatchFrom(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 text-white font-bold text-sm rounded-xl px-2.5 py-2 outline-none"
                  />
                </div>
                <div className="col-span-3">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">A</label>
                  <input
                    type="number"
                    min="1"
                    value={batchTo}
                    onChange={e => setBatchTo(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 text-white font-bold text-sm rounded-xl px-2.5 py-2 outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                  Oppure Lista Personalizzata (separata da virgola)
                </label>
                <input
                  type="text"
                  value={batchListText}
                  onChange={e => setBatchListText(e.target.value)}
                  placeholder="Es. Area 1, Area 2, Cella 1, Cella 2"
                  className="w-full bg-slate-900 border border-slate-700 text-white text-xs rounded-xl px-3 py-2 outline-none"
                />
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {batchTitles.slice(0, 8).map((t, i) => (
                  <span key={i} className="px-2 py-0.5 rounded-lg bg-brand-blue/15 text-brand-blue text-[11px] font-bold">
                    {t}
                  </span>
                ))}
                {batchTitles.length > 8 && (
                  <span className="text-[11px] text-slate-400">+{batchTitles.length - 8} altri</span>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-slate-400 mb-1.5">
              Sottotitolo (Opzionale)
            </label>
            <input
              type="text"
              value={subtitle}
              onChange={e => setSubtitle(e.target.value)}
              placeholder="Es. Bancali Secco, Temperatura +15/+25°C (lascia vuoto per nascondere)"
              className="w-full bg-slate-950 border border-slate-800 focus:border-brand-blue text-slate-200 text-sm rounded-2xl px-4 py-2.5 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-slate-400 mb-1.5">
              Etichetta Intestazione Alto Destra (Opzionale)
            </label>
            <input
              type="text"
              value={eyebrow}
              onChange={e => setEyebrow(e.target.value)}
              placeholder={companySettings.company_name ? `${companySettings.company_name} (Default)` : 'MAGAZZINO LOGISTICA (Default)'}
              className="w-full bg-slate-950 border border-slate-800 focus:border-brand-blue text-slate-200 text-sm rounded-2xl px-4 py-2.5 outline-none"
            />
          </div>

          {/* Formato Stampa */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
              <Maximize2 size={13} className="text-brand-blue" /> Formato Carta / Dimensione
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {FORMAT_OPTIONS.map(fmt => (
                <button
                  key={fmt.id}
                  type="button"
                  onClick={() => setFormatId(fmt.id)}
                  className={`text-left p-3 rounded-2xl border transition-all ${
                    formatId === fmt.id
                      ? 'bg-brand-blue/15 border-brand-blue text-white'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  } ${fmt.tiled ? 'sm:col-span-2' : ''}`}
                >
                  <div className="text-xs font-black">{fmt.label}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{fmt.sizeLabel}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Tema Colori Brandizzato */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
              <Palette size={13} className="text-brand-blue" /> Stile &amp; Colori
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Object.values(THEMES).map(th => (
                <button
                  key={th.id}
                  type="button"
                  onClick={() => setThemeId(th.id)}
                  className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all ${
                    themeId === th.id
                      ? 'bg-slate-800 border-brand-blue text-white'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <span
                    className="w-6 h-6 rounded-lg border shrink-0"
                    style={{ backgroundColor: th.bgHex, borderColor: th.accentHex, borderWidth: 3 }}
                  />
                  <span className="text-xs font-bold truncate">{th.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Toggle Extra */}
          <div className="flex flex-wrap gap-3 pt-1">
            <label className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer text-xs font-bold text-slate-200 select-none">
              <input
                type="checkbox"
                checked={showLogo}
                onChange={e => setShowLogo(e.target.checked)}
                className="w-4 h-4 rounded border-slate-700 text-brand-blue"
              />
              <ImageIcon size={14} className="text-brand-blue" /> Mostra Logo
            </label>
            <label className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer text-xs font-bold text-slate-200 select-none">
              <input
                type="checkbox"
                checked={showBarcode}
                onChange={e => setShowBarcode(e.target.checked)}
                className="w-4 h-4 rounded border-slate-700 text-brand-blue"
              />
              <QrCode size={14} className="text-emerald-400" /> Includi Barcode Code128
            </label>
          </div>
        </div>

        {/* Colonna Destra: Anteprima Live Responsive */}
        <div className="xl:col-span-7 bg-slate-900/70 border border-slate-800 rounded-3xl p-4 sm:p-6 shadow-xl flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-black uppercase tracking-wider text-slate-400">
              Anteprima Cartello ({activeFormat.label} • {activeFormat.sizeLabel})
            </span>
            {activeFormat.tiled && (
              <span className="px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[10px] font-bold">
                Stampa su 4 fogli A4 da affiancare
              </span>
            )}
          </div>

          <div className="w-full flex items-center justify-center bg-slate-950/80 border border-slate-800 rounded-2xl p-3 sm:p-6 overflow-hidden">
            <div
              className="w-full max-w-[680px] rounded-xl shadow-2xl relative overflow-hidden flex flex-col justify-between p-5 sm:p-8 transition-all"
              style={{
                aspectRatio: activeFormat.ratio,
                backgroundColor: activeTheme.bgHex,
                border: `4px solid ${activeTheme.frameHex}`
              }}
            >
              {/* Top & Bottom accent bars */}
              <div
                className="absolute top-0 left-0 right-0 h-2.5"
                style={{ backgroundColor: activeTheme.accentHex }}
              />
              <div
                className="absolute bottom-0 left-0 right-0 h-1.5"
                style={{ backgroundColor: activeTheme.accentHex }}
              />

              {/* Header */}
              <div className="flex items-start justify-between gap-3 pt-1">
                {showLogo ? (
                  <img
                    src={logoSrc}
                    alt="Logo Azienda"
                    className="h-8 sm:h-12 w-auto object-contain max-w-[140px]"
                  />
                ) : (
                  <div />
                )}
                <span
                  className="px-3 py-1 rounded-full text-[10px] sm:text-xs font-black uppercase tracking-widest truncate max-w-[60%]"
                  style={{
                    backgroundColor: activeTheme.badgeBgHex,
                    color: activeTheme.badgeTextHex
                  }}
                >
                  {(eyebrow || companySettings.company_name || 'MAGAZZINO LOGISTICA').toUpperCase()}
                </span>
              </div>

              {/* Center Title & Optional Subtitle */}
              <div className="flex-1 flex flex-col items-center justify-center text-center px-2 my-2">
                <div
                  className="font-black uppercase tracking-tight leading-none break-words max-w-full"
                  style={{
                    color: activeTheme.titleHex,
                    fontSize: 'clamp(1.75rem, 6vw, 4.25rem)'
                  }}
                >
                  {previewTitle}
                </div>

                {subtitle.trim() && (
                  <>
                    <div
                      className="w-24 sm:w-36 h-1.5 rounded-full my-3 sm:my-4"
                      style={{ backgroundColor: activeTheme.accentHex }}
                    />
                    <div
                      className="font-bold leading-snug break-words max-w-[90%]"
                      style={{
                        color: activeTheme.subHex,
                        fontSize: 'clamp(0.85rem, 2.2vw, 1.5rem)'
                      }}
                    >
                      {subtitle}
                    </div>
                  </>
                )}
              </div>

              {/* Footer + Optional Barcode */}
              <div className="flex flex-col items-center gap-2">
                {showBarcode && barcodePreviewUrl && (
                  <div className="bg-white px-4 py-1.5 rounded-xl shadow border border-slate-200">
                    <img src={barcodePreviewUrl} alt="Barcode" className="h-8 sm:h-11 w-auto object-contain" />
                  </div>
                )}
                {(companySettings.company_name || companySettings.company_address) && (
                  <div
                    className="w-full text-right text-[9px] sm:text-[11px] font-semibold truncate"
                    style={{ color: activeTheme.subHex }}
                  >
                    {[companySettings.company_name, companySettings.company_address].filter(Boolean).join(' • ')}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WarehouseSigns;
