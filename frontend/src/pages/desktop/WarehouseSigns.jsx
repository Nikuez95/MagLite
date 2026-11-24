import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import jsPDF from 'jspdf';
import {
  Signpost, Printer, Download, Sparkles, Layers, QrCode, Palette,
  Maximize2, Copy, CheckCircle2, Image as ImageIcon, Plus,
  Type, Save, RotateCcw, Sliders
} from 'lucide-react';
import { appAlert } from '../../utils/alerts';

const SIGN_DEFAULTS_STORAGE_KEY = 'maglite_warehouse_sign_defaults_v1';

const DEFAULT_SIGN_SCALES = {
  logoScale: 100,
  titleScale: 100,
  subtitleScale: 100,
  badgeScale: 100
};

const clampScaleVal = (val, fallback = 100) => {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(200, Math.max(40, Math.round(n)));
};

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
  logoDataUrl,
  logoScale = 100,
  titleScale = 100,
  subtitleScale = 100,
  badgeScale = 100
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
        const lFactor = clampScaleVal(logoScale, 100) / 100;
        const maxLogoH = Math.min(Math.round(hPx * 0.40), Math.round(hPx * 0.21 * lFactor));
        const maxLogoW = Math.min(Math.round(wPx * 0.60), Math.round(wPx * 0.34 * lFactor));
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
    const bFactor = clampScaleVal(badgeScale, 100) / 100;
    const badgeFont = Math.round(Math.min(wPx, hPx) * 0.028 * bFactor);
    ctx.font = `900 ${badgeFont}px sans-serif`;
    const bw = Math.min(wPx * 0.62, ctx.measureText(badgeText).width + badgeFont * 2.2);
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
    topContentBottom = Math.max(topContentBottom, by + bh + 16);
  }

  // Center Title & Subtitle
  const safeTitle = (title || 'AREA 1').trim();
  const safeSub = (subtitle || '').trim();
  const centerZoneTop = topContentBottom + Math.round(hPx * 0.03);
  const footerReserve = showBarcode && barcodeDataUrl ? Math.round(hPx * 0.22) : Math.round(hPx * 0.09);
  const centerZoneBottom = hPx - innerPad - footerReserve;
  const maxAvailableH = Math.max(120, centerZoneBottom - centerZoneTop);
  const centerY = (centerZoneTop + centerZoneBottom) / 2;
  const maxTextW = wPx - innerPad * 2 - 40;

  const tFactor = clampScaleVal(titleScale, 100) / 100;
  const sFactor = clampScaleVal(subtitleScale, 100) / 100;

  const wrapWords = (text, fontStr, maxWidth) => {
    ctx.font = fontStr;
    const wList = text.split(/\s+/).filter(Boolean);
    const out = [];
    let cur = '';
    for (const w of wList) {
      const test = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(test).width <= maxWidth) {
        cur = test;
      } else {
        if (cur) out.push(cur);
        cur = w;
      }
    }
    if (cur) out.push(cur);
    return out.length > 0 ? out : [text];
  };

  let titleFontSize = Math.round(Math.min(wPx * 0.16, hPx * 0.24) * tFactor);
  const minTitleFont = Math.max(18, Math.round(Math.min(wPx, hPx) * 0.04));
  let titleLines = wrapWords(safeTitle, `900 ${titleFontSize}px sans-serif`, maxTextW);

  let subFontSize = Math.round(Math.min(wPx * 0.045, hPx * 0.065) * sFactor);
  const minSubFont = Math.max(12, Math.round(minTitleFont * 0.45));
  let subLines = safeSub ? wrapWords(safeSub, `700 ${subFontSize}px sans-serif`, maxTextW) : [];

  const longestWordW = (lines, fontStr) => {
    ctx.font = fontStr;
    let mx = 0;
    for (const l of lines) {
      mx = Math.max(mx, ctx.measureText(l).width);
    }
    return mx;
  };

  // Shrink slightly only if text overflows width or available vertical area cleanly
  for (let guard = 0; guard < 60; guard++) {
    const tW = longestWordW(titleLines, `900 ${titleFontSize}px sans-serif`);
    const tH = titleLines.length * (titleFontSize * 1.12);
    const gapB = safeSub ? Math.round(hPx * 0.035) : 0;
    const divH = safeSub ? 8 : 0;
    const sH = subLines.length * (subFontSize * 1.24);
    const totH = tH + gapB + divH + sH;
    if (tW <= maxTextW && totH <= maxAvailableH) break;
    if (titleFontSize > minTitleFont && (tW > maxTextW || totH > maxAvailableH)) {
      titleFontSize = Math.max(minTitleFont, titleFontSize - 4);
      titleLines = wrapWords(safeTitle, `900 ${titleFontSize}px sans-serif`, maxTextW);
    }
    if (safeSub && subFontSize > minSubFont && totH > maxAvailableH) {
      subFontSize = Math.max(minSubFont, subFontSize - 2);
      subLines = wrapWords(safeSub, `700 ${subFontSize}px sans-serif`, maxTextW);
    }
    if (titleFontSize <= minTitleFont && (!safeSub || subFontSize <= minSubFont)) break;
  }

  const lineH = titleFontSize * 1.12;
  const totalTitleH = titleLines.length * lineH;
  const subLineH = subFontSize * 1.25;
  const gapBetween = safeSub ? Math.round(hPx * 0.035) : 0;
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
  const loadLocalSignDefaults = () => {
    try {
      const raw = localStorage.getItem(SIGN_DEFAULTS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  };
  const initialLocal = loadLocalSignDefaults();

  const [title, setTitle] = useState('AREA 1');
  const [subtitle, setSubtitle] = useState('Stoccaggio Merce Secca');
  const [eyebrow, setEyebrow] = useState('');
  const [formatId, setFormatId] = useState(initialLocal.formatId || 'A4_L');
  const [themeId, setThemeId] = useState(initialLocal.themeId || 'BRAND_LIGHT');
  const [showLogo, setShowLogo] = useState(initialLocal.showLogo !== undefined ? Boolean(initialLocal.showLogo) : true);
  const [showBarcode, setShowBarcode] = useState(Boolean(initialLocal.showBarcode));

  // Dimensioni personalizzabili (% rispetto allo standard) persistenti
  const [logoScale, setLogoScale] = useState(clampScaleVal(initialLocal.logoScale, DEFAULT_SIGN_SCALES.logoScale));
  const [titleScale, setTitleScale] = useState(clampScaleVal(initialLocal.titleScale, DEFAULT_SIGN_SCALES.titleScale));
  const [subtitleScale, setSubtitleScale] = useState(clampScaleVal(initialLocal.subtitleScale, DEFAULT_SIGN_SCALES.subtitleScale));
  const [badgeScale, setBadgeScale] = useState(clampScaleVal(initialLocal.badgeScale, DEFAULT_SIGN_SCALES.badgeScale));
  const [isSavingStandard, setIsSavingStandard] = useState(false);
  const [standardSavedToast, setStandardSavedToast] = useState(false);

  // Modalità serie multipla
  const [batchMode, setBatchMode] = useState(false);
  const [batchPrefix, setBatchPrefix] = useState('AREA ');
  const [batchFrom, setBatchFrom] = useState(1);
  const [batchTo, setBatchTo] = useState(4);
  const [batchListText, setBatchListText] = useState('');

  const [companySettings, setCompanySettings] = useState({});
  const [barcodePreviewUrl, setBarcodePreviewUrl] = useState('');
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  // Dimensione contenitore anteprima live per proporzionamento responsive 1:1 con il PDF
  const previewCardRef = useRef(null);
  const [previewDims, setPreviewDims] = useState({ width: 640, height: 452 });

  const token = localStorage.getItem('maglite_token');
  const activeFormat = FORMAT_OPTIONS.find(f => f.id === formatId) || FORMAT_OPTIONS[0];
  const activeTheme = THEMES[themeId] || THEMES.BRAND_LIGHT;

  useEffect(() => {
    axios
      .get(`http://${window.location.hostname}:3000/api/settings`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      .then(res => {
        const data = res.data || {};
        setCompanySettings(data);
        if (data.warehouse_sign_defaults) {
          try {
            const saved = typeof data.warehouse_sign_defaults === 'string'
              ? JSON.parse(data.warehouse_sign_defaults)
              : data.warehouse_sign_defaults;
            if (saved && typeof saved === 'object') {
              if (saved.logoScale !== undefined) setLogoScale(clampScaleVal(saved.logoScale, 100));
              if (saved.titleScale !== undefined) setTitleScale(clampScaleVal(saved.titleScale, 100));
              if (saved.subtitleScale !== undefined) setSubtitleScale(clampScaleVal(saved.subtitleScale, 100));
              if (saved.badgeScale !== undefined) setBadgeScale(clampScaleVal(saved.badgeScale, 100));
              if (saved.formatId && FORMAT_OPTIONS.some(f => f.id === saved.formatId)) setFormatId(saved.formatId);
              if (saved.themeId && THEMES[saved.themeId]) setThemeId(saved.themeId);
              if (saved.showLogo !== undefined) setShowLogo(Boolean(saved.showLogo));
              if (saved.showBarcode !== undefined) setShowBarcode(Boolean(saved.showBarcode));
              localStorage.setItem(SIGN_DEFAULTS_STORAGE_KEY, JSON.stringify(saved));
            }
          } catch (_) {}
        }
      })
      .catch(() => {});
  }, [token]);

  // Salvataggio locale automatico ad ogni regolazione per non perdere mai lo standard
  useEffect(() => {
    try {
      localStorage.setItem(SIGN_DEFAULTS_STORAGE_KEY, JSON.stringify({
        logoScale,
        titleScale,
        subtitleScale,
        badgeScale,
        formatId,
        themeId,
        showLogo,
        showBarcode
      }));
    } catch (_) {}
  }, [logoScale, titleScale, subtitleScale, badgeScale, formatId, themeId, showLogo, showBarcode]);

  // Osserva la larghezza/altezza reale della card di anteprima per scalare testi e logo in modo perfettamente responsive
  useEffect(() => {
    const el = previewCardRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const updateDims = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setPreviewDims({ width: rect.width, height: rect.height });
      }
    };
    updateDims();
    const ro = new ResizeObserver(updateDims);
    ro.observe(el);
    return () => ro.disconnect();
  }, [formatId]);

  const handleSaveStandard = async () => {
    const payload = {
      logoScale: clampScaleVal(logoScale, 100),
      titleScale: clampScaleVal(titleScale, 100),
      subtitleScale: clampScaleVal(subtitleScale, 100),
      badgeScale: clampScaleVal(badgeScale, 100),
      formatId,
      themeId,
      showLogo,
      showBarcode
    };
    setIsSavingStandard(true);
    try {
      localStorage.setItem(SIGN_DEFAULTS_STORAGE_KEY, JSON.stringify(payload));
      await axios.put(
        `http://${window.location.hostname}:3000/api/settings/warehouse-sign-defaults`,
        payload,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setStandardSavedToast(true);
      setTimeout(() => setStandardSavedToast(false), 3000);
    } catch (err) {
      appAlert(err.response?.data?.error || 'Standard salvato localmente (errore sync server).', 'Attenzione', 'warning');
    } finally {
      setIsSavingStandard(false);
    }
  };

  const handleResetScales = () => {
    setLogoScale(100);
    setTitleScale(100);
    setSubtitleScale(100);
    setBadgeScale(100);
  };

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
          logoDataUrl,
          logoScale,
          titleScale,
          subtitleScale,
          badgeScale
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

          {/* Dimensioni Testi & Logo (Responsive & Salvabili come Standard) */}
          <div className="bg-slate-950/75 border border-slate-800 rounded-2xl p-4 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-black uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
                <Sliders size={14} /> Dimensioni Testi &amp; Logo (%)
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleResetScales}
                  className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] font-bold text-slate-300 flex items-center gap-1 transition-colors"
                  title="Riporta tutte le dimensioni al 100%"
                >
                  <RotateCcw size={11} /> 100%
                </button>
                <button
                  type="button"
                  disabled={isSavingStandard}
                  onClick={handleSaveStandard}
                  className={`px-3 py-1 rounded-lg text-[11px] font-black flex items-center gap-1.5 transition-all ${
                    standardSavedToast
                      ? 'bg-emerald-500 text-slate-950'
                      : 'bg-brand-blue hover:bg-sky-400 text-brand-black'
                  } disabled:opacity-50`}
                  title="Salva queste dimensioni come standard aziendale per tutti i prossimi cartelli"
                >
                  {standardSavedToast ? <CheckCircle2 size={12} /> : <Save size={12} />}
                  {standardSavedToast ? 'Standard Salvato!' : (isSavingStandard ? 'Salvataggio...' : 'Salva Standard')}
                </button>
              </div>
            </div>

            {[
              { label: 'Dimensione Logo Aziendale', value: logoScale, setter: setLogoScale, icon: ImageIcon, color: 'text-sky-400', disabled: !showLogo },
              { label: 'Dimensione Titolo Centrale', value: titleScale, setter: setTitleScale, icon: Type, color: 'text-emerald-400', disabled: false },
              { label: 'Dimensione Sottotitolo', value: subtitleScale, setter: setSubtitleScale, icon: Type, color: 'text-amber-300', disabled: !subtitle.trim() },
              { label: 'Dimensione Etichetta Intestazione', value: badgeScale, setter: setBadgeScale, icon: Sparkles, color: 'text-violet-300', disabled: false }
            ].map((ctrl) => {
              const IconComp = ctrl.icon;
              return (
                <div key={ctrl.label} className={`space-y-1 ${ctrl.disabled ? 'opacity-45' : ''}`}>
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-bold text-slate-300 flex items-center gap-1.5 truncate">
                      <IconComp size={12} className={ctrl.color} /> {ctrl.label}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => ctrl.setter(prev => clampScaleVal(prev - 10, 100))}
                        className="w-6 h-6 rounded-md bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white font-black flex items-center justify-center"
                      >
                        -
                      </button>
                      <span className="w-11 text-center font-mono font-black text-brand-blue text-xs">
                        {ctrl.value}%
                      </span>
                      <button
                        type="button"
                        onClick={() => ctrl.setter(prev => clampScaleVal(prev + 10, 100))}
                        className="w-6 h-6 rounded-md bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white font-black flex items-center justify-center"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <input
                    type="range"
                    min="40"
                    max="200"
                    step="5"
                    value={ctrl.value}
                    onChange={(e) => ctrl.setter(clampScaleVal(e.target.value, 100))}
                    className="w-full accent-sky-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                  />
                </div>
              );
            })}
            <p className="text-[10px] text-slate-500 leading-snug">
              Le dimensioni si salvano automaticamente in locale; clicca <strong className="text-slate-300">Salva Standard</strong> per renderle predefinite per tutte le postazioni.
            </p>
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
            {(() => {
              const pW = previewDims.width || 640;
              const pH = previewDims.height || 452;
              const minSide = Math.min(pW, pH);
              const logoMaxH = Math.min(Math.round(pH * 0.40), Math.round(pH * 0.21 * (logoScale / 100)));
              const logoMaxW = Math.min(Math.round(pW * 0.60), Math.round(pW * 0.34 * (logoScale / 100)));
              const badgeFontPx = Math.max(8, Math.round(minSide * 0.028 * (badgeScale / 100)));
              const titleFontPx = Math.max(14, Math.round(Math.min(pW * 0.16, pH * 0.24) * (titleScale / 100)));
              const subFontPx = Math.max(10, Math.round(Math.min(pW * 0.045, pH * 0.065) * (subtitleScale / 100)));
              return (
                <div
                  ref={previewCardRef}
                  className="w-full max-w-[680px] rounded-xl shadow-2xl relative overflow-hidden flex flex-col justify-between p-4 sm:p-8 transition-all"
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
                  <div className="flex items-start justify-between gap-2 pt-1 min-w-0">
                    {showLogo ? (
                      <img
                        src={logoSrc}
                        alt="Logo Azienda"
                        className="w-auto object-contain shrink-0 transition-all"
                        style={{ maxHeight: `${logoMaxH}px`, maxWidth: `${logoMaxW}px` }}
                      />
                    ) : (
                      <div />
                    )}
                    <span
                      className="px-3 py-1 rounded-full font-black uppercase tracking-widest truncate max-w-[62%] transition-all"
                      style={{
                        backgroundColor: activeTheme.badgeBgHex,
                        color: activeTheme.badgeTextHex,
                        fontSize: `${badgeFontPx}px`
                      }}
                    >
                      {(eyebrow || companySettings.company_name || 'MAGAZZINO LOGISTICA').toUpperCase()}
                    </span>
                  </div>

                  {/* Center Title & Optional Subtitle */}
                  <div className="flex-1 flex flex-col items-center justify-center text-center px-2 my-2 min-h-0 overflow-hidden">
                    <div
                      className="font-black uppercase tracking-tight leading-none break-words max-w-full transition-all"
                      style={{
                        color: activeTheme.titleHex,
                        fontSize: `${titleFontPx}px`,
                        overflowWrap: 'anywhere'
                      }}
                    >
                      {previewTitle}
                    </div>

                    {subtitle.trim() && (
                      <>
                        <div
                          className="w-24 sm:w-36 h-1.5 rounded-full my-2.5 sm:my-4 shrink-0"
                          style={{ backgroundColor: activeTheme.accentHex }}
                        />
                        <div
                          className="font-bold leading-snug break-words max-w-[92%] transition-all"
                          style={{
                            color: activeTheme.subHex,
                            fontSize: `${subFontPx}px`,
                            overflowWrap: 'anywhere'
                          }}
                        >
                          {subtitle}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Footer + Optional Barcode */}
                  <div className="flex flex-col items-center gap-2 shrink-0">
                    {showBarcode && barcodePreviewUrl && (
                      <div className="bg-white px-4 py-1.5 rounded-xl shadow border border-slate-200">
                        <img src={barcodePreviewUrl} alt="Barcode" className="h-7 sm:h-11 w-auto object-contain" />
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
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WarehouseSigns;
