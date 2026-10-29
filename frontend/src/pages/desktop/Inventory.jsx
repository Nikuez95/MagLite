import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import {
  Search, SlidersHorizontal, Filter, Download, Printer, GripVertical, Clock,
  Calendar, AlertTriangle, ShieldCheck, Flame, RotateCcw, Package, CheckCircle,
  Columns, ChevronDown, ChevronUp, X, Layers, ArrowUpDown
} from 'lucide-react';
import Select from 'react-select';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { io } from 'socket.io-client';

const defaultColumns = [
  { key: 'code', label: 'Cod. Paletta', visible: true },
  { key: 'clientPallet', label: 'Rif. Paletta Cl.', visible: true },
  { key: 'customer', label: 'Cliente', visible: true },
  { key: 'product', label: 'Prodotto', visible: true },
  { key: 'quantity', label: 'Q.tà', visible: true },
  { key: 'location', label: 'Posizione', visible: true },
  { key: 'arrival', label: 'Arrivo', visible: true },
  { key: 'batch', label: 'Lotto', visible: true },
  { key: 'expiration', label: 'Scadenza', visible: true },
  { key: 'flags', label: 'Flag', visible: true },
  { key: 'status', label: 'Stato', visible: false },
  { key: 'notes', label: 'Note', visible: false }
];

const formatUOM = (uom) => {
  const u = (uom || '').toLowerCase();
  if (u.includes('bancal')) return 'Bancali';
  if (u === 'kg') return 'KG';
  if (u.includes('metr')) return 'Metri Cubi';
  if (u === 'scatole') return 'Scatole';
  if (u === 'pezzi') return 'Pezzi';
  return uom;
};

const formatQuantity = (qty, uom) => {
  const q = parseFloat(qty || 0);
  const u = (uom || '').toLowerCase();
  if (u.includes('pezzi') || u.includes('scatole') || u.includes('bancal')) {
    return q.toFixed(0);
  }
  return q.toFixed(2);
};

const formatPalletCode = (code) => {
  if (!code) return '';
  if (code === 'MULTIPLI' || code.includes('Palette')) return code;
  const parts = code.split('-');
  if (parts.length >= 3) {
    return parts.slice(2).join('-');
  }
  return code;
};

const formatDurationText = (days, unit = 'days') => {
  const absDays = Math.abs(days);
  if (unit === 'months') {
    if (absDays < 30) {
      return `${absDays} gg`;
    }
    const months = Math.floor(absDays / 30);
    const remDays = absDays % 30;
    const mLabel = months === 1 ? 'mese' : 'mesi';
    return remDays > 0 ? `${months} ${mLabel} e ${remDays} gg` : `${months} ${mLabel}`;
  }
  return `${absDays} gg`;
};

const getWarningThresholdDays = (val, unit = 'days') => {
  const num = Math.max(0, parseFloat(val) || 0);
  if (unit === 'months') {
    if (num === 12) return 365;
    return Math.round(num * 30);
  }
  return Math.round(num);
};

const getExpirationStatus = (expDate, warningValue, warningUnit = 'days') => {
  if (!expDate) {
    return {
      category: 'NO_EXP',
      diffDays: null,
      color: 'text-slate-400',
      label: 'SENZA SCADENZA',
      secondaryLabel: '',
      bg: 'bg-slate-800/40 border-slate-700/50',
      barColor: 'bg-slate-600',
      progress: 0
    };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expDate);
  if (isNaN(exp.getTime())) {
    return {
      category: 'NO_EXP',
      diffDays: null,
      color: 'text-slate-400',
      label: 'SENZA SCADENZA',
      secondaryLabel: '',
      bg: 'bg-slate-800/40 border-slate-700/50',
      barColor: 'bg-slate-600',
      progress: 0
    };
  }
  exp.setHours(0, 0, 0, 0);

  const diffTime = exp - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const thresholdDays = getWarningThresholdDays(warningValue, warningUnit);

  const primaryDuration = formatDurationText(diffDays, warningUnit);
  const altDuration = warningUnit === 'months'
    ? `${Math.abs(diffDays)} gg`
    : (Math.abs(diffDays) >= 30 ? `~${(Math.abs(diffDays) / 30).toFixed(1).replace('.0', '')} mesi` : '');

  if (diffDays < 0) {
    return {
      category: 'EXPIRED',
      diffDays,
      color: 'text-rose-400',
      label: `SCADUTO DA ${primaryDuration.toUpperCase()}`,
      secondaryLabel: altDuration ? `(${altDuration})` : '',
      bg: 'bg-rose-500/15 border-rose-500/40 shadow-[0_0_12px_rgba(244,63,94,0.12)]',
      barColor: 'bg-rose-500',
      progress: 100
    };
  }
  if (diffDays === 0) {
    return {
      category: 'WARNING',
      diffDays: 0,
      color: 'text-rose-400',
      label: 'SCADE OGGI!',
      secondaryLabel: '',
      bg: 'bg-rose-500/20 border-rose-500/50 shadow-[0_0_12px_rgba(244,63,94,0.2)]',
      barColor: 'bg-rose-500',
      progress: 8
    };
  }
  if (diffDays <= thresholdDays) {
    const pct = thresholdDays > 0 ? Math.max(10, Math.min(100, Math.round((diffDays / thresholdDays) * 100))) : 15;
    return {
      category: 'WARNING',
      diffDays,
      color: 'text-amber-400',
      label: `SCADE TRA ${primaryDuration.toUpperCase()}`,
      secondaryLabel: altDuration ? `(${altDuration})` : '',
      bg: 'bg-amber-500/15 border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.1)]',
      barColor: 'bg-amber-500',
      progress: pct
    };
  }
  const safePct = Math.min(100, Math.max(35, Math.round((diffDays / Math.max(thresholdDays * 3, 365)) * 100)));
  return {
    category: 'SAFE',
    diffDays,
    color: 'text-emerald-400',
    label: `Valido (+${primaryDuration})`,
    secondaryLabel: altDuration ? `(${altDuration})` : '',
    bg: 'bg-emerald-500/10 border-emerald-500/30',
    barColor: 'bg-emerald-500',
    progress: safePct
  };
};

const Inventory = () => {
  const [pallets, setPallets] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters and sorting state
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCustomers, setSelectedCustomers] = useState([]);
  const [filterWarehouse, setFilterWarehouse] = useState('ALL'); // 'ALL' | 'Settala' | 'Caleppio'
  const [filterLocationState, setFilterLocationState] = useState('ALL'); // 'ALL' | 'SHELF' | 'LOADING_ZONE' | 'PENDING'
  const [sortBy, setSortBy] = useState('alphabetical'); // 'alphabetical', 'customer', 'zone', 'arrival', 'qty_desc', 'expiration_asc', 'expiration_desc', 'client_pallet_asc', 'client_pallet_desc'
  const [groupByBatch, setGroupByBatch] = useState(false);
  const [showColumnManager, setShowColumnManager] = useState(false);

  // Stampa rapida Barcode in ordine visivo
  const [barcodePrintModal, setBarcodePrintModal] = useState(false);
  const [barcodeFormat, setBarcodeFormat] = useState('A4');
  const [barcodeCopies, setBarcodeCopies] = useState(1);
  const [printingBarcodes, setPrintingBarcodes] = useState(false);

  // Filtri Scadenza & Preavviso (GG / MESI)
  const [expirationWarningValue, setExpirationWarningValue] = useState(60);
  const [warningUnit, setWarningUnit] = useState('days'); // 'days' | 'months'
  const [filterExpCategory, setFilterExpCategory] = useState('ALL'); // 'ALL' | 'EXPIRED' | 'WARNING' | 'WARNING_AND_EXPIRED' | 'SAFE' | 'NO_EXP'
  const [dateFilterMode, setDateFilterMode] = useState('EXPIRATION'); // 'EXPIRATION' | 'ARRIVAL'
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  const handleToggleWarningUnit = (newUnit) => {
    if (newUnit === warningUnit) return;
    if (newUnit === 'months') {
      const converted = Math.max(1, Math.round((parseFloat(expirationWarningValue) || 30) / 30));
      setExpirationWarningValue(converted);
    } else {
      const converted = Math.max(1, Math.round((parseFloat(expirationWarningValue) || 1) * 30));
      setExpirationWarningValue(converted);
    }
    setWarningUnit(newUnit);
  };

  const user = JSON.parse(localStorage.getItem('maglite_user') || '{}');
  const [columns, setColumns] = useState(() => {
    let cols = [...defaultColumns];
    if (user.preferences && Array.isArray(user.preferences.inventoryColumns)) {
      cols = [...user.preferences.inventoryColumns];
    }
    if (!cols.find(c => c.key === 'clientPallet')) {
      cols.splice(1, 0, { key: 'clientPallet', label: 'Rif. Paletta Cl.', visible: true });
    } else {
      cols = cols.map(c => c.key === 'clientPallet' ? { ...c, label: 'Rif. Paletta Cl.', visible: true } : c);
    }
    if (!cols.find(c => c.key === 'expiration')) {
      const batchIdx = cols.findIndex(c => c.key === 'batch');
      const insertIdx = batchIdx >= 0 ? batchIdx + 1 : 7;
      cols.splice(insertIdx, 0, { key: 'expiration', label: 'Scadenza', visible: true });
    }
    if (!cols.find(c => c.key === 'flags')) {
      cols.splice(8, 0, { key: 'flags', label: 'Flag', visible: true });
    }
    return cols;
  });

  const [draggedColumnIndex, setDraggedColumnIndex] = useState(null);

  const getToken = () => localStorage.getItem('maglite_token');

  const fetchData = async () => {
    setLoading(true);
    try {
      const [invRes, custRes] = await Promise.all([
        axios.get(`http://${window.location.hostname}:3000/api/pallets/inventory`, { headers: { Authorization: `Bearer ${getToken()}` } }),
        axios.get(`http://${window.location.hostname}:3000/api/customers`, { headers: { Authorization: `Bearer ${getToken()}` } })
      ]);
      setPallets(invRes.data);
      setCustomers(custRes.data.map(c => ({ value: c.id, label: c.business_name })));
    } catch (err) {
      console.error("Errore fetch inventario:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const socket = io(`http://${window.location.hostname}:3000`);
    socket.on('stow_updated', () => fetchData());
    socket.on('dashboard_update', () => fetchData());
    return () => socket.disconnect();
  }, []);

  const savePreferences = async (newColumns) => {
    try {
      const updatedUser = { ...user, preferences: { ...(user.preferences || {}), inventoryColumns: newColumns } };
      localStorage.setItem('maglite_user', JSON.stringify(updatedUser));
      await axios.put(`http://${window.location.hostname}:3000/api/auth/preferences`, { preferences: updatedUser.preferences }, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
    } catch (err) {
      console.error("Errore salvataggio preferenze:", err);
    }
  };

  const selectStyles = {
    control: (base, state) => ({
      ...base,
      backgroundColor: '#020617',
      borderColor: state.isFocused ? '#38bdf8' : '#1e293b',
      borderRadius: '0.75rem',
      padding: '0.1rem',
      minHeight: '38px',
      boxShadow: 'none',
      '&:hover': { borderColor: '#38bdf8' }
    }),
    menu: base => ({ ...base, backgroundColor: '#0f172a', zIndex: 50, border: '1px solid #1e293b' }),
    option: (base, state) => ({ ...base, backgroundColor: state.isFocused ? '#1e293b' : 'transparent', color: '#F8FAFC', cursor: 'pointer', fontSize: '0.8rem' }),
    multiValue: base => ({ ...base, backgroundColor: '#1e293b', borderRadius: '0.4rem' }),
    multiValueLabel: base => ({ ...base, color: '#38bdf8', fontWeight: 'bold', fontSize: '0.75rem' }),
    multiValueRemove: base => ({ ...base, color: '#38bdf8', ':hover': { backgroundColor: '#38bdf8', color: '#020617' } }),
    input: base => ({ ...base, color: '#F8FAFC', fontSize: '0.8rem' }),
    placeholder: base => ({ ...base, color: '#64748b', fontSize: '0.8rem' })
  };

  const toggleColumn = (key) => {
    const newCols = columns.map(c => c.key === key ? { ...c, visible: !c.visible } : c);
    setColumns(newCols);
    savePreferences(newCols);
  };

  const applyColumnPreset = (preset) => {
    let visibleKeys = [];
    if (preset === 'COMPACT') {
      visibleKeys = ['clientPallet', 'customer', 'product', 'quantity', 'location', 'batch', 'expiration'];
    } else if (preset === 'FEFO') {
      visibleKeys = ['code', 'clientPallet', 'customer', 'product', 'batch', 'expiration', 'quantity', 'location'];
    } else if (preset === 'ALL') {
      visibleKeys = columns.map(c => c.key);
    } else {
      visibleKeys = defaultColumns.filter(c => c.visible).map(c => c.key);
    }
    const newCols = columns.map(c => ({ ...c, visible: visibleKeys.includes(c.key) }));
    setColumns(newCols);
    savePreferences(newCols);
  };

  const handleDragStart = (index) => {
    setDraggedColumnIndex(index);
  };

  const handleDrop = (index) => {
    if (draggedColumnIndex === null || draggedColumnIndex === index) return;
    const newCols = [...columns];
    const draggedItem = newCols[draggedColumnIndex];
    newCols.splice(draggedColumnIndex, 1);
    newCols.splice(index, 0, draggedItem);
    setColumns(newCols);
    savePreferences(newCols);
    setDraggedColumnIndex(null);
  };

  // Filtro base (ricerca, clienti, magazzino, ubicazione, range date)
  const baseFilteredData = useMemo(() => {
    let data = pallets;

    if (selectedCustomers.length > 0) {
      const customerIds = selectedCustomers.map(c => c.value);
      data = data.filter(p => customerIds.includes(p.customer_id));
    }

    if (filterWarehouse !== 'ALL') {
      data = data.filter(p => p.warehouse === filterWarehouse);
    }

    if (filterLocationState !== 'ALL') {
      data = data.filter(p => {
        const loc = String(p.location || '');
        if (filterLocationState === 'LOADING_ZONE') return loc.startsWith('ZONA CARICO');
        if (filterLocationState === 'PENDING') return !p.location || p.status === 'PENDING';
        if (filterLocationState === 'SHELF') return p.location && !loc.startsWith('ZONA CARICO');
        return true;
      });
    }

    if (searchTerm.trim() !== '') {
      const s = searchTerm.toLowerCase().trim();
      data = data.filter(p =>
        (p.product_name && p.product_name.toLowerCase().includes(s)) ||
        (p.pallet_code && p.pallet_code.toLowerCase().includes(s)) ||
        (p.customer_name && p.customer_name.toLowerCase().includes(s)) ||
        (p.batch && p.batch.toLowerCase().includes(s)) ||
        (p.location && p.location.toLowerCase().includes(s)) ||
        (p.notes && p.notes.toLowerCase().includes(s)) ||
        (p.client_pallet_number && p.client_pallet_number.toLowerCase().includes(s)) ||
        (p.client_article_number && p.client_article_number.toLowerCase().includes(s)) ||
        (p.expiration_date && new Date(p.expiration_date).toLocaleDateString('it-IT').includes(s))
      );
    }

    if (filterStartDate || filterEndDate) {
      data = data.filter(p => {
        const rawTargetDate = dateFilterMode === 'EXPIRATION' ? p.expiration_date : p.created_at;
        if (!rawTargetDate) return false;
        const pDate = new Date(rawTargetDate);
        if (isNaN(pDate.getTime())) return false;
        if (filterStartDate) {
          const start = new Date(filterStartDate);
          start.setHours(0, 0, 0, 0);
          if (pDate < start) return false;
        }
        if (filterEndDate) {
          const end = new Date(filterEndDate);
          end.setHours(23, 59, 59, 999);
          if (pDate > end) return false;
        }
        return true;
      });
    }

    return data;
  }, [pallets, selectedCustomers, filterWarehouse, filterLocationState, searchTerm, filterStartDate, filterEndDate, dateFilterMode]);

  // Statistiche KPI scadenze in tempo reale
  const expStats = useMemo(() => {
    const stats = {
      ALL: { count: baseFilteredData.length, qty: 0 },
      EXPIRED: { count: 0, qty: 0 },
      WARNING: { count: 0, qty: 0 },
      SAFE: { count: 0, qty: 0 },
      NO_EXP: { count: 0, qty: 0 }
    };
    baseFilteredData.forEach(p => {
      const q = parseFloat(p.quantity) || 0;
      stats.ALL.qty += q;
      const st = getExpirationStatus(p.expiration_date, expirationWarningValue, warningUnit);
      if (stats[st.category]) {
        stats[st.category].count += 1;
        stats[st.category].qty += q;
      }
    });
    return stats;
  }, [baseFilteredData, expirationWarningValue, warningUnit]);

  const processedData = useMemo(() => {
    let data = baseFilteredData.filter(p => {
      if (filterExpCategory === 'ALL') return true;
      const st = getExpirationStatus(p.expiration_date, expirationWarningValue, warningUnit);
      if (filterExpCategory === 'WARNING_AND_EXPIRED') {
        return st.category === 'WARNING' || st.category === 'EXPIRED';
      }
      return st.category === filterExpCategory;
    });

    if (groupByBatch) {
      const groups = {};
      data.forEach(p => {
        const key = `${p.product_id}_${p.batch || 'NOBATCH'}`;
        if (!groups[key]) {
          groups[key] = {
            ...p,
            id: key,
            palletIds: [p.id],
            clientPalletList: p.client_pallet_number ? [String(p.client_pallet_number).trim()] : [],
            quantity: parseFloat(p.quantity) || 0,
            palletCount: 1,
            location: '',
            zone: '',
            col: '',
            pos: '',
            pallet_code: 'MULTIPLI'
          };
        } else {
          groups[key].palletIds.push(p.id);
          if (p.client_pallet_number) {
            const trimmed = String(p.client_pallet_number).trim();
            if (trimmed && !groups[key].clientPalletList.includes(trimmed)) {
              groups[key].clientPalletList.push(trimmed);
            }
          }
          groups[key].quantity += (parseFloat(p.quantity) || 0);
          groups[key].palletCount += 1;
          if (p.expiration_date) {
            if (!groups[key].expiration_date || new Date(p.expiration_date) < new Date(groups[key].expiration_date)) {
              groups[key].expiration_date = p.expiration_date;
            }
          }
        }
      });
      data = Object.values(groups).map(g => {
        g.pallet_code = `${g.palletCount} Palette`;
        g.client_pallet_number = g.clientPalletList.join(', ');
        return g;
      });
    }

    data = [...data].sort((a, b) => {
      if (sortBy === 'client_pallet_asc' || sortBy === 'client_pallet_desc') {
        const refA = String(a.client_pallet_number || '').trim();
        const refB = String(b.client_pallet_number || '').trim();
        if (!refA && !refB) return String(a.id || '').localeCompare(String(b.id || ''));
        if (!refA) return 1; // Senza riferimento sempre in fondo
        if (!refB) return -1;
        const cmp = refA.localeCompare(refB, undefined, { numeric: true, sensitivity: 'base' });
        if (cmp !== 0) return sortBy === 'client_pallet_asc' ? cmp : -cmp;
        return String(a.id || '').localeCompare(String(b.id || ''));
      }
      if (sortBy === 'alphabetical') {
        return (a.product_name || '').localeCompare(b.product_name || '');
      }
      if (sortBy === 'customer') {
        return (a.customer_name || '').localeCompare(b.customer_name || '');
      }
      if (sortBy === 'qty_desc') {
        return (parseFloat(b.quantity) || 0) - (parseFloat(a.quantity) || 0);
      }
      if (sortBy === 'zone') {
        const zoneA = a.zone || 'ZZZ';
        const zoneB = b.zone || 'ZZZ';
        if (zoneA !== zoneB) return zoneA.localeCompare(zoneB);
        const colA = a.col || '00';
        const colB = b.col || '00';
        if (colA !== colB) return colA.localeCompare(colB);
        const posA = a.pos || '00';
        const posB = b.pos || '00';
        return posA.localeCompare(posB);
      }
      if (sortBy === 'arrival') {
        return new Date(a.created_at) - new Date(b.created_at);
      }
      if (sortBy === 'expiration_asc') {
        if (!a.expiration_date && !b.expiration_date) return 0;
        if (!a.expiration_date) return 1;
        if (!b.expiration_date) return -1;
        return new Date(a.expiration_date) - new Date(b.expiration_date);
      }
      if (sortBy === 'expiration_desc') {
        if (!a.expiration_date && !b.expiration_date) return 0;
        if (!a.expiration_date) return 1;
        if (!b.expiration_date) return -1;
        return new Date(b.expiration_date) - new Date(a.expiration_date);
      }
      return 0;
    });
    return data;
  }, [baseFilteredData, filterExpCategory, expirationWarningValue, warningUnit, sortBy, groupByBatch]);

  // Lista degli ID paletta nell'ORDINE ESATTO visualizzato a schermo (riga 1 -> 1° barcode, riga 2 -> 2° barcode, ecc.)
  const orderedVisiblePalletIds = useMemo(() => {
    const ids = [];
    processedData.forEach(row => {
      if (Array.isArray(row.palletIds) && row.palletIds.length > 0) {
        row.palletIds.forEach(pid => ids.push(pid));
      } else if (row.id) {
        ids.push(row.id);
      }
    });
    return ids;
  }, [processedData]);

  // Funzione stampa rapida di TUTTI i barcode visualizzati nell'ordine esatto
  const handlePrintAllDisplayedBarcodes = async (e) => {
    if (e) e.preventDefault();
    if (orderedVisiblePalletIds.length === 0) return;
    setPrintingBarcodes(true);
    try {
      const response = await axios.post(
        `http://${window.location.hostname}:3000/api/pallets/print-bulk`,
        {
          ids: orderedVisiblePalletIds,
          format: barcodeFormat,
          copies: barcodeCopies
        },
        {
          headers: { Authorization: `Bearer ${getToken()}` },
          responseType: 'blob'
        }
      );
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      window.open(url, '_blank');
      setBarcodePrintModal(false);
    } catch (err) {
      alert(err.response?.data?.error || 'Errore nella generazione del PDF dei barcode');
    } finally {
      setPrintingBarcodes(false);
    }
  };

  // Riepilogo live dei totali della vista corrente
  const summaryMetrics = useMemo(() => {
    let totalUnits = 0;
    let totalBoxes = 0;
    const customerSet = new Set();
    processedData.forEach(r => {
      const q = parseFloat(r.quantity) || 0;
      const upb = parseInt(r.units_per_box) || 1;
      totalUnits += q;
      if (upb > 1) totalBoxes += Math.floor(q / upb);
      if (r.customer_id) customerSet.add(r.customer_id);
    });
    return {
      rows: processedData.length,
      totalUnits,
      totalBoxes,
      customersCount: customerSet.size
    };
  }, [processedData]);

  const hasActiveFilters = searchTerm !== '' || selectedCustomers.length > 0 || filterWarehouse !== 'ALL' || filterLocationState !== 'ALL' || filterStartDate !== '' || filterEndDate !== '' || filterExpCategory !== 'ALL';

  const resetAllFilters = () => {
    setSearchTerm('');
    setSelectedCustomers([]);
    setFilterWarehouse('ALL');
    setFilterLocationState('ALL');
    setFilterStartDate('');
    setFilterEndDate('');
    setFilterExpCategory('ALL');
  };

  const getCellValue = (row, key) => {
    switch (key) {
      case 'code': return formatPalletCode(row.pallet_code);
      case 'customer': return row.customer_name;
      case 'product': return row.product_name;
      case 'quantity': return `${formatQuantity(row.quantity, row.uom)} ${formatUOM(row.uom)}`;
      case 'location': return groupByBatch ? '-' : (row.location ? (row.zone ? `${row.zone} ${row.col} ${row.pos}` : row.location) : 'IN ATTESA');
      case 'arrival': return new Date(row.created_at).toLocaleDateString('it-IT');
      case 'batch': return row.batch || '-';
      case 'expiration': {
        if (!row.expiration_date) return 'Senza Scadenza';
        const st = getExpirationStatus(row.expiration_date, expirationWarningValue, warningUnit);
        return `${new Date(row.expiration_date).toLocaleDateString('it-IT')} (${st.label})`;
      }
      case 'flags': {
        const parsedFlags = row.flags && typeof row.flags === 'string' ? JSON.parse(row.flags) : row.flags || [];
        return parsedFlags.join(' | ');
      }
      case 'status': return row.status;
      case 'notes': return groupByBatch ? '-' : (row.notes || '-');
      case 'clientPallet': return row.client_pallet_number || '-';
      default: return '';
    }
  };

  const renderCellHtml = (row, key) => {
    switch (key) {
      case 'code': return (
        <div className="flex flex-col gap-1 items-start">
          <span className="font-mono text-sm text-brand-blue font-bold whitespace-nowrap">{formatPalletCode(row.pallet_code)}</span>
          {row.is_mixed === 1 && !groupByBatch && (
            <span className="bg-amber-500/20 text-amber-500 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider" title="Paletta Frammentata">Mista</span>
          )}
        </div>
      );
      case 'customer': return <span className="text-sm font-semibold text-slate-300">{row.customer_name}</span>;
      case 'product': return <span className="font-bold text-brand-white">{row.product_name}</span>;
      case 'quantity': {
        const qty = parseFloat(row.quantity) || 0;
        const upb = parseInt(row.units_per_box) || 1;
        const uom = row.uom || "";
        
        if (upb > 1 && !uom.toLowerCase().includes('scatol') && !uom.toLowerCase().includes('bancal') && uom !== 'KG' && uom !== 'Metro Cubo') {
          const scatole = Math.floor(qty / upb);
          const sfusi = qty % upb;
          return (
            <div className="flex flex-col items-end">
              <div className="text-right">
                <span className="font-black text-brand-blue text-lg">{qty}</span>
                <span className="text-[10px] text-slate-500 ml-1 uppercase">({uom || 'Pezzi'})</span>
              </div>
              <span className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider">
                {scatole} Scat. {sfusi > 0 ? ` + ${sfusi} Sfusi` : ''}
              </span>
            </div>
          );
        }

        return (
          <div className="text-right">
            <span className="font-black text-brand-blue text-lg">{qty}</span>
            <span className="text-xs text-slate-500 ml-1 uppercase">{uom}</span>
          </div>
        );
      }
      case 'location': return (
        <div className="text-center">
          {groupByBatch ? (
            <span className="text-slate-500 font-bold">-</span>
          ) : row.location ? (
            String(row.location).startsWith('ZONA CARICO') ? (
              <span
                className="inline-flex items-center gap-1.5 bg-amber-500/15 border border-amber-500/40 px-3 py-1 rounded-lg text-xs font-bold text-amber-400"
                title="Merce prelevata in picking e in attesa di conferma spedizione dal backoffice"
              >
                <Package size={13} /> {row.location}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 bg-slate-950 border border-slate-700 px-3 py-1 rounded-lg text-sm font-bold text-brand-white">
                {row.zone ? `${row.zone} ${row.col} ${row.pos}` : row.location}
              </span>
            )
          ) : (
            <span className="inline-flex items-center gap-1 bg-amber-500/10 text-amber-500 px-3 py-1 rounded-lg text-xs font-bold border border-amber-500/20">IN ATTESA</span>
          )}
        </div>
      );
      case 'arrival': return <span className="text-sm text-slate-400">{new Date(row.created_at).toLocaleDateString('it-IT')}</span>;
      case 'batch': return <span className="text-sm font-mono text-slate-300">{row.batch || '-'}</span>;
      case 'expiration': {
        const expStatus = getExpirationStatus(row.expiration_date, expirationWarningValue, warningUnit);
        if (!row.expiration_date) {
          return (
            <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-slate-950 text-slate-500 border border-slate-800">
              Senza Scadenza
            </span>
          );
        }
        return (
          <div className="inline-flex flex-col gap-1 min-w-[165px]">
            <div className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border ${expStatus.color} ${expStatus.bg}`}>
              <div className="flex items-center justify-between gap-2">
                <span>{new Date(row.expiration_date).toLocaleDateString('it-IT')}</span>
                {expStatus.secondaryLabel && <span className="opacity-75 font-normal lowercase">{expStatus.secondaryLabel}</span>}
              </div>
              <div className="mt-0.5 text-[10.5px] font-black tracking-wide">
                {expStatus.label}
              </div>
            </div>
            <div className="w-full h-1 bg-slate-950 rounded-full overflow-hidden">
              <div className={`h-full ${expStatus.barColor} transition-all`} style={{ width: `${expStatus.progress}%` }} />
            </div>
          </div>
        );
      }
      case 'flags': {
        const parsedFlags = row.flags && typeof row.flags === 'string' ? JSON.parse(row.flags) : row.flags || [];
        if (parsedFlags.length === 0) return <span className="text-slate-600 text-xs">-</span>;
        return (
          <div className="flex gap-1 flex-wrap">
            {parsedFlags.map(f => (
              <span key={f} className="bg-amber-500/10 text-amber-500 border border-amber-500/30 px-1.5 py-0.5 rounded uppercase tracking-wider text-[9px]">{f}</span>
            ))}
          </div>
        );
      }
      case 'status': return (
        <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded-md ${row.status === 'STOCKED' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
          {row.status}
        </span>
      );
      case 'notes': return groupByBatch ? <span className="text-slate-500">-</span> : <div className="text-xs text-slate-400 max-w-xs truncate" title={row.notes}>{row.notes || '-'}</div>;
      case 'clientPallet': return row.client_pallet_number ? (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-500/15 border border-sky-500/40 text-xs font-mono font-bold text-sky-300">
          {row.client_pallet_number}
        </span>
      ) : (
        <span className="text-xs text-slate-600">-</span>
      );
      default: return null;
    }
  };

  const getActiveExpFilterLabel = () => {
    const unitLabel = warningUnit === 'months' ? (expirationWarningValue == 1 ? 'mese' : 'mesi') : 'gg';
    if (filterExpCategory === 'EXPIRED') return 'Solo Prodotti SCADUTI';
    if (filterExpCategory === 'WARNING') return `In Scadenza (<= ${expirationWarningValue} ${unitLabel})`;
    if (filterExpCategory === 'WARNING_AND_EXPIRED') return `In Scadenza (<= ${expirationWarningValue} ${unitLabel}) + Scaduti`;
    if (filterExpCategory === 'SAFE') return `Lunga Scadenza (> ${expirationWarningValue} ${unitLabel})`;
    if (filterExpCategory === 'NO_EXP') return 'Senza Scadenza';
    return 'Tutti';
  };

  const exportCSV = () => {
    const visibleCols = columns.filter(c => c.visible);
    const headers = visibleCols.map(c => c.label);
    const csvRows = [headers.join(',')];
    
    for (const row of processedData) {
      const values = visibleCols.map(col => {
        let val = getCellValue(row, col.key);
        return typeof val === 'string' && val.includes(',') ? `"${val}"` : val;
      });
      csvRows.push(values.join(','));
    }

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Inventario_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const exportPDF = async () => {
    const doc = new jsPDF('landscape');
    const visibleCols = columns.filter(c => c.visible);
    const headers = visibleCols.map(c => c.label);
    const data = processedData.map(row => visibleCols.map(col => getCellValue(row, col.key)));

    let title = 'Inventario Globale | Logistic Porcelli';
    if (selectedCustomers.length === 1) {
      title = `Inventario per ${selectedCustomers[0].label.toUpperCase()} | Logistic Porcelli`;
    } else if (selectedCustomers.length > 1) {
      title = 'Inventario per Multi-Cliente | Logistic Porcelli';
    }

    let filterText = 'Ord: ';
    if (sortBy === 'alphabetical') filterText += 'Alfabetico';
    if (sortBy === 'customer') filterText += 'Cliente';
    if (sortBy === 'qty_desc') filterText += 'Quantità';
    if (sortBy === 'zone') filterText += 'Zone';
    if (sortBy === 'arrival') filterText += 'Data Arrivo';
    if (sortBy === 'expiration_asc') filterText += 'Scadenza (FEFO - Più urgenti)';
    if (sortBy === 'expiration_desc') filterText += 'Scadenza (Più lontane)';
    if (sortBy === 'client_pallet_asc') filterText += 'Rif. Paletta Cliente ↑ (Crescente)';
    if (sortBy === 'client_pallet_desc') filterText += 'Rif. Paletta Cliente ↓ (Decrescente)';
    if (filterWarehouse !== 'ALL') {
      filterText += ` | Magazzino: ${filterWarehouse}`;
    }
    if (filterExpCategory !== 'ALL') {
      filterText += ` | Scadenza: ${getActiveExpFilterLabel()}`;
    }
    if (filterStartDate || filterEndDate) {
      filterText += ` | ${dateFilterMode === 'EXPIRATION' ? 'Scad.' : 'Arrivo'} ${filterStartDate ? 'dal ' + filterStartDate : ''} ${filterEndDate ? 'al ' + filterEndDate : ''}`;
    }
    if (selectedCustomers.length > 0) {
      filterText += ` | Clienti: ${selectedCustomers.map(c => c.label).join(', ')}`;
    }

    const renderRest = (textX) => {
      doc.setFontSize(16);
      doc.text(title, textX, 18);
      
      doc.setFontSize(10);
      doc.text(`Data: ${new Date().toLocaleDateString('it-IT')} | Elementi stampati: ${processedData.length} | Totale Unità: ${summaryMetrics.totalUnits.toLocaleString('it-IT')}`, textX, 26);
      doc.text(filterText, textX, 32);

      autoTable(doc, {
        startY: 38,
        head: [headers],
        body: data,
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [25, 41, 53], textColor: 255 },
        alternateRowStyles: { fillColor: [240, 248, 255] }
      });

      doc.save(`Inventario_${new Date().toISOString().split('T')[0]}.pdf`);
    };

    try {
      const response = await fetch('/logo_scuro.png');
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result;
        doc.addImage(base64data, 'PNG', 14, 10, 36, 25);
        renderRest(56);
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      console.error("Errore caricamento logo per PDF:", e);
      renderRest(14);
    }
  };

  if (loading) {
    return <div className="p-8 text-brand-blue font-bold animate-pulse">Caricamento inventario...</div>;
  }

  const visibleCols = columns.filter(c => c.visible);

  return (
    <div className="flex flex-col h-full">
      {/* Header + Export */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-5">
        <div>
          <h2 className="text-3xl font-black text-brand-white tracking-tight flex items-center gap-3">
            <Layers className="text-brand-blue" size={32} />
            Inventario Globale
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            Esplora, filtra per scadenza o magazzino e stampa solo ciò che ti serve.
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={() => setShowColumnManager(!showColumnManager)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border font-bold text-sm transition-all ${
              showColumnManager
                ? 'bg-brand-blue/15 border-brand-blue text-brand-blue'
                : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Columns size={17} />
            Colonne ({visibleCols.length}/{columns.length})
            {showColumnManager ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          <button
            type="button"
            disabled={orderedVisiblePalletIds.length === 0}
            onClick={() => setBarcodePrintModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 text-brand-black rounded-xl hover:bg-amber-400 disabled:opacity-40 transition-colors shadow-[0_0_20px_rgba(245,158,11,0.25)] font-black text-sm"
            title="Stampa tutti i barcode dei prodotti visualizzati nell'ordine esatto a schermo (Riga 1 = 1° barcode, Riga 2 = 2° barcode, ecc.)"
          >
            <Printer size={18} /> Stampa Barcode in Ordine ({orderedVisiblePalletIds.length})
          </button>
          <button onClick={exportCSV} className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 border border-slate-700 text-brand-white rounded-xl hover:bg-slate-800 transition-colors shadow-lg font-bold text-sm">
            <Download size={18} className="text-brand-blue" /> CSV ({processedData.length})
          </button>
          <button onClick={exportPDF} className="flex items-center gap-2 px-5 py-2.5 bg-brand-blue text-brand-black rounded-xl hover:bg-sky-400 transition-colors shadow-[0_0_20px_rgba(14,165,233,0.25)] font-black text-sm">
            <Printer size={18} /> Stampa PDF ({processedData.length})
          </button>
        </div>
      </div>

      {/* Cruscotto Scadenze Interattivo (5 Card KPI) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <button
          type="button"
          onClick={() => setFilterExpCategory('ALL')}
          className={`text-left p-4 rounded-2xl border transition-all relative overflow-hidden ${
            filterExpCategory === 'ALL'
              ? 'bg-slate-900 border-brand-blue shadow-[0_0_20px_rgba(14,165,233,0.15)]'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Totale Inventario</span>
            <Package size={16} className="text-brand-blue" />
          </div>
          <div className="text-2xl font-black text-brand-white">{expStats.ALL.count}</div>
          <div className="text-[11px] text-slate-400 mt-1">
            {expStats.ALL.qty.toLocaleString('it-IT')} unità complessive
          </div>
          {expStats.ALL.count > 0 && (
            <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden flex mt-2.5">
              <div style={{ width: `${(expStats.EXPIRED.count / expStats.ALL.count) * 100}%` }} className="bg-rose-500 h-full" title={`Scaduti: ${expStats.EXPIRED.count}`} />
              <div style={{ width: `${(expStats.WARNING.count / expStats.ALL.count) * 100}%` }} className="bg-amber-500 h-full" title={`In avviso: ${expStats.WARNING.count}`} />
              <div style={{ width: `${(expStats.SAFE.count / expStats.ALL.count) * 100}%` }} className="bg-emerald-500 h-full" title={`Lunga scadenza: ${expStats.SAFE.count}`} />
              <div style={{ width: `${(expStats.NO_EXP.count / expStats.ALL.count) * 100}%` }} className="bg-slate-600 h-full" title={`Senza scadenza: ${expStats.NO_EXP.count}`} />
            </div>
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            const next = filterExpCategory === 'EXPIRED' ? 'ALL' : 'EXPIRED';
            setFilterExpCategory(next);
            if (next === 'EXPIRED') setSortBy('expiration_asc');
          }}
          className={`text-left p-4 rounded-2xl border transition-all relative overflow-hidden ${
            filterExpCategory === 'EXPIRED'
              ? 'bg-rose-950/40 border-rose-500 shadow-[0_0_25px_rgba(244,63,94,0.25)]'
              : 'bg-slate-900/60 border-slate-800 hover:border-rose-500/50'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1.5">
              {expStats.EXPIRED.count > 0 && <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />}
              Scaduti
            </span>
            <Flame size={16} className="text-rose-500" />
          </div>
          <div className="text-2xl font-black text-rose-400">{expStats.EXPIRED.count}</div>
          <div className="text-[11px] text-rose-300/70 mt-1">
            {expStats.EXPIRED.count > 0 ? `${expStats.EXPIRED.qty.toLocaleString('it-IT')} u. già scadute` : 'Nessun prodotto scaduto'}
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            const next = (filterExpCategory === 'WARNING' || filterExpCategory === 'WARNING_AND_EXPIRED') ? 'ALL' : 'WARNING';
            setFilterExpCategory(next);
            if (next === 'WARNING') setSortBy('expiration_asc');
          }}
          className={`text-left p-4 rounded-2xl border transition-all relative overflow-hidden ${
            filterExpCategory === 'WARNING' || filterExpCategory === 'WARNING_AND_EXPIRED'
              ? 'bg-amber-950/40 border-amber-500 shadow-[0_0_25px_rgba(245,158,11,0.2)]'
              : 'bg-slate-900/60 border-slate-800 hover:border-amber-500/50'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
              In Scadenza (≤ {expirationWarningValue} {warningUnit === 'months' ? (expirationWarningValue == 1 ? 'mese' : 'mesi') : 'gg'})
            </span>
            <AlertTriangle size={16} className="text-amber-500" />
          </div>
          <div className="text-2xl font-black text-amber-400">{expStats.WARNING.count}</div>
          <div className="text-[11px] text-amber-300/70 mt-1">
            {expStats.WARNING.count > 0 ? `${expStats.WARNING.qty.toLocaleString('it-IT')} u. in preavviso` : 'Nessuno in preavviso'}
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            const next = filterExpCategory === 'SAFE' ? 'ALL' : 'SAFE';
            setFilterExpCategory(next);
          }}
          className={`text-left p-4 rounded-2xl border transition-all relative overflow-hidden ${
            filterExpCategory === 'SAFE'
              ? 'bg-emerald-950/30 border-emerald-500 shadow-[0_0_25px_rgba(16,185,129,0.2)]'
              : 'bg-slate-900/60 border-slate-800 hover:border-emerald-500/50'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              Lunga Scadenza (&gt; {expirationWarningValue} {warningUnit === 'months' ? 'm' : 'gg'})
            </span>
            <ShieldCheck size={16} className="text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-emerald-400">{expStats.SAFE.count}</div>
          <div className="text-[11px] text-emerald-300/70 mt-1">
            {expStats.SAFE.qty.toLocaleString('it-IT')} u. con ampio margine
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            const next = filterExpCategory === 'NO_EXP' ? 'ALL' : 'NO_EXP';
            setFilterExpCategory(next);
          }}
          className={`text-left p-4 rounded-2xl border transition-all relative overflow-hidden ${
            filterExpCategory === 'NO_EXP'
              ? 'bg-slate-800 border-slate-400 shadow-lg'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-600'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Senza Scadenza</span>
            <Calendar size={16} className="text-slate-500" />
          </div>
          <div className="text-2xl font-black text-slate-300">{expStats.NO_EXP.count}</div>
          <div className="text-[11px] text-slate-500 mt-1">
            {expStats.NO_EXP.qty.toLocaleString('it-IT')} u. non deperibili
          </div>
        </button>
      </div>

      {/* Pannello Controlli Compatto */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 mb-5 shadow-xl space-y-3">
        
        {/* Riga 1: Ricerca, Multi-Cliente, Magazzino, Ubicazione, Ordine, Raggruppa per Lotto */}
        <div className="flex flex-col xl:flex-row flex-wrap items-stretch xl:items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input
              type="text"
              placeholder="Cerca prodotto, codice paletta, lotto, posizione, cliente..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl pl-10 pr-8 py-2 text-sm focus:ring-brand-blue"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                <X size={14} />
              </button>
            )}
          </div>

          <div className="min-w-[220px] flex-1 max-w-sm">
            <Select 
              isMulti
              styles={selectStyles}
              options={customers}
              value={selectedCustomers}
              onChange={setSelectedCustomers}
              placeholder="Filtra per uno o più clienti..."
            />
          </div>

          {/* Switch Magazzino */}
          <div className="flex bg-slate-950 rounded-xl border border-slate-800 p-1 text-xs font-bold">
            <button onClick={() => setFilterWarehouse('ALL')} className={`px-2.5 py-1.5 rounded-lg transition-colors ${filterWarehouse === 'ALL' ? 'bg-slate-800 text-brand-white' : 'text-slate-500 hover:text-slate-300'}`}>Tutti Mag.</button>
            <button onClick={() => setFilterWarehouse('Settala')} className={`px-2.5 py-1.5 rounded-lg transition-colors ${filterWarehouse === 'Settala' ? 'bg-brand-blue text-brand-black' : 'text-slate-500 hover:text-brand-blue'}`}>Settala</button>
            <button onClick={() => setFilterWarehouse('Caleppio')} className={`px-2.5 py-1.5 rounded-lg transition-colors ${filterWarehouse === 'Caleppio' ? 'bg-amber-500 text-brand-black' : 'text-slate-500 hover:text-amber-500'}`}>Caleppio</button>
          </div>

          {/* Switch Stato Ubicazione */}
          <div className="flex bg-slate-950 rounded-xl border border-slate-800 p-1 text-xs font-bold">
            <button onClick={() => setFilterLocationState('ALL')} className={`px-2.5 py-1.5 rounded-lg transition-colors ${filterLocationState === 'ALL' ? 'bg-slate-800 text-brand-white' : 'text-slate-500 hover:text-slate-300'}`}>Tutte Pos.</button>
            <button onClick={() => setFilterLocationState('SHELF')} className={`px-2.5 py-1.5 rounded-lg transition-colors ${filterLocationState === 'SHELF' ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-500 hover:text-emerald-400'}`}>Scaffale</button>
            <button onClick={() => setFilterLocationState('LOADING_ZONE')} className={`px-2.5 py-1.5 rounded-lg transition-colors ${filterLocationState === 'LOADING_ZONE' ? 'bg-amber-500/20 text-amber-400' : 'text-slate-500 hover:text-amber-400'}`}>Zona Carico</button>
            <button onClick={() => setFilterLocationState('PENDING')} className={`px-2.5 py-1.5 rounded-lg transition-colors ${filterLocationState === 'PENDING' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>In Attesa</button>
          </div>

          <div className="flex items-center gap-2">
            <select 
              value={sortBy} 
              onChange={e => setSortBy(e.target.value)} 
              className="bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-3 py-2 focus:ring-brand-blue text-xs font-bold"
            >
              <option value="alphabetical">Ordina: Prodotto (A-Z)</option>
              <option value="client_pallet_asc">Ordina: Rif. Paletta Cliente ↑ (Crescente)</option>
              <option value="client_pallet_desc">Ordina: Rif. Paletta Cliente ↓ (Decrescente)</option>
              <option value="customer">Ordina: Cliente (A-Z)</option>
              <option value="zone">Ordina: Zona / Posizione</option>
              <option value="qty_desc">Ordina: Quantità (↓)</option>
              <option value="arrival">Ordina: Data Arrivo</option>
              <option value="expiration_asc">Ordina: Scadenza ↑ (FEFO)</option>
              <option value="expiration_desc">Ordina: Scadenza ↓</option>
            </select>

            <label className="flex items-center gap-2 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl cursor-pointer select-none hover:border-brand-blue transition-colors">
              <input type="checkbox" className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-brand-blue focus:ring-0" checked={groupByBatch} onChange={() => setGroupByBatch(!groupByBatch)} />
              <span className="text-xs font-bold text-brand-white whitespace-nowrap">
                Raggruppa per Lotto
              </span>
            </label>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetAllFilters}
                className="flex items-center gap-1 px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-xl text-xs font-bold transition-colors"
              >
                <RotateCcw size={13} /> Reset
              </button>
            )}
          </div>
        </div>

        {/* Riga 2: Barra Controllo Scadenze (Range Date + Switch GG/MESI + Spunta Filtra solo in avviso) */}
        <div className="pt-3 border-t border-slate-800/80 flex flex-col lg:flex-row flex-wrap items-start lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
            <Calendar size={15} className="text-brand-blue" />
            <div className="flex bg-slate-950 rounded-lg border border-slate-800 p-0.5">
              <button
                type="button"
                onClick={() => setDateFilterMode('EXPIRATION')}
                className={`px-2.5 py-1 rounded-md transition-colors font-bold ${
                  dateFilterMode === 'EXPIRATION' ? 'bg-brand-blue text-brand-black' : 'text-slate-400 hover:text-white'
                }`}
              >
                Data Scadenza
              </button>
              <button
                type="button"
                onClick={() => setDateFilterMode('ARRIVAL')}
                className={`px-2.5 py-1 rounded-md transition-colors font-bold ${
                  dateFilterMode === 'ARRIVAL' ? 'bg-brand-blue text-brand-black' : 'text-slate-400 hover:text-white'
                }`}
              >
                Data Arrivo
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Dal:</span>
              <input
                type="date"
                value={filterStartDate}
                onChange={e => setFilterStartDate(e.target.value)}
                className="w-[125px] bg-slate-950 border border-slate-800 text-brand-white rounded-lg px-2 py-1 focus:ring-brand-blue [color-scheme:dark]"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Al:</span>
              <input
                type="date"
                value={filterEndDate}
                onChange={e => setFilterEndDate(e.target.value)}
                className="w-[125px] bg-slate-950 border border-slate-800 text-brand-white rounded-lg px-2 py-1 focus:ring-brand-blue [color-scheme:dark]"
              />
            </div>
            {(filterStartDate || filterEndDate) && (
              <button
                type="button"
                onClick={() => { setFilterStartDate(''); setFilterEndDate(''); }}
                className="text-rose-400 hover:text-rose-300 font-bold px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/20"
              >
                ✕ Pulisci date
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs font-medium">
            <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5">
              <Clock size={15} className="text-amber-500 shrink-0" />
              <span className="text-slate-300 font-bold">Preavviso Scadenza:</span>
              <input
                type="number"
                min="1"
                onWheel={(e) => e.target.blur()}
                value={expirationWarningValue}
                onChange={e => setExpirationWarningValue(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className="w-16 bg-slate-900 border border-slate-700 text-amber-400 font-bold text-center rounded-lg px-2 py-1 focus:ring-amber-500 focus:border-amber-500"
              />

              {/* Switch GG / MESI */}
              <div className="flex bg-slate-900 rounded-lg border border-slate-800 p-0.5">
                <button
                  type="button"
                  onClick={() => handleToggleWarningUnit('days')}
                  className={`px-2.5 py-1 rounded-md font-bold transition-all ${
                    warningUnit === 'days'
                      ? 'bg-amber-500 text-brand-black shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  GG
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleWarningUnit('months')}
                  className={`px-2.5 py-1 rounded-md font-bold transition-all ${
                    warningUnit === 'months'
                      ? 'bg-amber-500 text-brand-black shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  MESI
                </button>
              </div>

              {/* Preset rapidi */}
              <div className="hidden xl:flex items-center gap-1 pl-1 border-l border-slate-800">
                {(warningUnit === 'days' ? [15, 30, 60, 90, 180] : [1, 2, 3, 6, 12]).map(preset => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setExpirationWarningValue(preset)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${
                      Number(expirationWarningValue) === preset
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                        : 'bg-slate-900 text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {preset}{warningUnit === 'days' ? 'g' : 'm'}
                  </button>
                ))}
              </div>
            </div>

            {/* Spunta "Mostra solo in avviso" */}
            <label
              onClick={() => {
                const isCurrentlyWarningFilter = filterExpCategory === 'WARNING' || filterExpCategory === 'WARNING_AND_EXPIRED';
                const next = isCurrentlyWarningFilter ? 'ALL' : 'WARNING';
                setFilterExpCategory(next);
                if (next === 'WARNING') setSortBy('expiration_asc');
              }}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer select-none transition-all font-bold ${
                filterExpCategory === 'WARNING' || filterExpCategory === 'WARNING_AND_EXPIRED'
                  ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.15)]'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-amber-500/50 hover:text-slate-200'
              }`}
            >
              <div className={`w-4 h-4 rounded flex items-center justify-center border transition-all ${
                filterExpCategory === 'WARNING' || filterExpCategory === 'WARNING_AND_EXPIRED'
                  ? 'bg-amber-500 border-amber-500 text-brand-black'
                  : 'bg-slate-900 border-slate-700'
              }`}>
                {(filterExpCategory === 'WARNING' || filterExpCategory === 'WARNING_AND_EXPIRED') && (
                  <CheckCircle size={12} strokeWidth={3} />
                )}
              </div>
              <span>Mostra solo in avviso ({expStats.WARNING.count})</span>
            </label>

            {(filterExpCategory === 'WARNING' || filterExpCategory === 'WARNING_AND_EXPIRED') && (
              <button
                type="button"
                onClick={() => setFilterExpCategory(filterExpCategory === 'WARNING_AND_EXPIRED' ? 'WARNING' : 'WARNING_AND_EXPIRED')}
                className={`px-2.5 py-2 rounded-xl border text-xs font-bold transition-all ${
                  filterExpCategory === 'WARNING_AND_EXPIRED'
                    ? 'bg-rose-500/20 border-rose-500 text-rose-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-rose-400'
                }`}
              >
                {filterExpCategory === 'WARNING_AND_EXPIRED' ? '✓ Scaduti inclusi' : `+ Includi Scaduti (${expStats.EXPIRED.count})`}
              </button>
            )}
          </div>
        </div>

        {/* Cassetto Collassabile Gestione Colonne */}
        {showColumnManager && (
          <div className="pt-3 border-t border-slate-800 animate-fade-in">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <span className="text-slate-400 font-bold text-xs uppercase tracking-wider">
                Trascina per Riordinare o Clicca per Attivare/Disattivare le Colonne (anche in Stampa PDF/CSV)
              </span>
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-500">Preset:</span>
                <button type="button" onClick={() => applyColumnPreset('DEFAULT')} className="px-2.5 py-1 bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-lg font-bold">Standard</button>
                <button type="button" onClick={() => applyColumnPreset('COMPACT')} className="px-2.5 py-1 bg-slate-950 hover:bg-slate-800 text-brand-blue border border-slate-800 rounded-lg font-bold">Compatta Stampa</button>
                <button type="button" onClick={() => applyColumnPreset('FEFO')} className="px-2.5 py-1 bg-slate-950 hover:bg-slate-800 text-amber-400 border border-slate-800 rounded-lg font-bold">Focus Scadenze</button>
                <button type="button" onClick={() => applyColumnPreset('ALL')} className="px-2.5 py-1 bg-slate-950 hover:bg-slate-800 text-emerald-400 border border-slate-800 rounded-lg font-bold">Tutte (12)</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {columns.map((col, idx) => (
                <div 
                  key={col.key}
                  draggable
                  onDragStart={() => handleDragStart(idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDrop(idx)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors border cursor-grab active:cursor-grabbing ${col.visible ? 'bg-brand-blue/20 text-brand-blue border-brand-blue' : 'bg-slate-950 text-slate-500 border-slate-800 hover:bg-slate-800'}`}
                >
                  <GripVertical size={13} className={col.visible ? 'text-brand-blue/60' : 'text-slate-600'} />
                  <button onClick={() => toggleColumn(col.key)} className="focus:outline-none">
                    {col.label}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Barra Riepilogo Totali Live */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 mb-3 bg-slate-900/80 border border-slate-800 rounded-2xl text-xs">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-slate-400">
            Elementi visibili: <strong className="text-brand-white font-black">{summaryMetrics.rows}</strong> {groupByBatch ? 'lotti raggruppati' : 'palette'}
          </span>
          <span className="text-slate-700">•</span>
          <span className="text-slate-400">
            Totale Unità: <strong className="text-brand-blue font-black">{summaryMetrics.totalUnits.toLocaleString('it-IT')}</strong>
          </span>
          {summaryMetrics.totalBoxes > 0 && (
            <>
              <span className="text-slate-700">•</span>
              <span className="text-slate-400">
                Scatole stimate: <strong className="text-emerald-400 font-black">{summaryMetrics.totalBoxes.toLocaleString('it-IT')}</strong>
              </span>
            </>
          )}
          <span className="text-slate-700">•</span>
          <span className="text-slate-400">
            Clienti: <strong className="text-slate-200 font-bold">{summaryMetrics.customersCount}</strong>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-slate-500 italic hidden md:block">
            Clicca sulle intestazioni di colonna per ordinare rapidamente
          </span>
          {orderedVisiblePalletIds.length > 0 && (
            <button
              type="button"
              onClick={() => setBarcodePrintModal(true)}
              className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/15 hover:bg-amber-500 text-amber-400 hover:text-brand-black border border-amber-500/40 rounded-lg font-bold transition-all"
            >
              <Printer size={13} /> Stampa {orderedVisiblePalletIds.length} Barcode in Ordine
            </button>
          )}
        </div>
      </div>

      {/* Tabella Dati */}
      <div className="flex-1 bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-950 border-b border-slate-800">
                {visibleCols.map(col => {
                  const isSortable = ['expiration', 'product', 'customer', 'location', 'arrival', 'quantity', 'clientPallet'].includes(col.key);
                  return (
                    <th
                      key={col.key}
                      onClick={() => {
                        if (col.key === 'expiration') setSortBy(sortBy === 'expiration_asc' ? 'expiration_desc' : 'expiration_asc');
                        else if (col.key === 'clientPallet') setSortBy(sortBy === 'client_pallet_asc' ? 'client_pallet_desc' : 'client_pallet_asc');
                        else if (col.key === 'product') setSortBy('alphabetical');
                        else if (col.key === 'customer') setSortBy('customer');
                        else if (col.key === 'location') setSortBy('zone');
                        else if (col.key === 'arrival') setSortBy('arrival');
                        else if (col.key === 'quantity') setSortBy('qty_desc');
                      }}
                      className={`p-3.5 text-xs font-bold text-slate-400 uppercase tracking-wider ${
                        col.key === 'quantity' ? 'text-right' : col.key === 'location' ? 'text-center' : ''
                      } ${isSortable ? 'cursor-pointer hover:text-brand-blue select-none transition-colors' : ''}`}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {col.key === 'expiration' && sortBy === 'expiration_asc' && <span className="text-brand-blue">↑</span>}
                        {col.key === 'expiration' && sortBy === 'expiration_desc' && <span className="text-brand-blue">↓</span>}
                        {col.key === 'clientPallet' && sortBy === 'client_pallet_asc' && <span className="text-brand-blue">↑</span>}
                        {col.key === 'clientPallet' && sortBy === 'client_pallet_desc' && <span className="text-brand-blue">↓</span>}
                        {col.key === 'product' && sortBy === 'alphabetical' && <span className="text-brand-blue">↑</span>}
                        {col.key === 'customer' && sortBy === 'customer' && <span className="text-brand-blue">↑</span>}
                        {col.key === 'location' && sortBy === 'zone' && <span className="text-brand-blue">↑</span>}
                        {col.key === 'arrival' && sortBy === 'arrival' && <span className="text-brand-blue">↑</span>}
                        {col.key === 'quantity' && sortBy === 'qty_desc' && <span className="text-brand-blue">↓</span>}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {processedData.length === 0 ? (
                <tr>
                  <td colSpan={visibleCols.length} className="p-10 text-center text-slate-500 font-medium">Nessuna paletta trovata con i filtri selezionati.</td>
                </tr>
              ) : (
                processedData.map((row, i) => {
                  const expStatus = getExpirationStatus(row.expiration_date, expirationWarningValue, warningUnit);
                  const isExpired = expStatus.category === 'EXPIRED';
                  const isWarning = expStatus.category === 'WARNING';
                  return (
                    <tr
                      key={row.id}
                      className={`border-b border-slate-800/50 transition-colors ${
                        isExpired
                          ? 'bg-rose-950/15 hover:bg-rose-950/25'
                          : isWarning
                          ? 'bg-amber-950/10 hover:bg-amber-950/20'
                          : i % 2 === 0
                          ? 'bg-transparent hover:bg-slate-800/50'
                          : 'bg-slate-950/30 hover:bg-slate-800/50'
                      }`}
                    >
                      {visibleCols.map(col => (
                        <td key={col.key} className="p-3.5">
                          {renderCellHtml(row, col.key)}
                        </td>
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODALE STAMPA BARCODE IN ORDINE VISIVO */}
      {barcodePrintModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold text-brand-white mb-2 flex items-center gap-2">
              <Printer className="text-amber-400" /> Stampa Barcode in Ordine
            </h3>
            <p className="text-slate-400 text-xs mb-4 leading-relaxed">
              Verranno generati <strong className="text-brand-white">{orderedVisiblePalletIds.length} barcode</strong> nell&apos;esatto ordine in cui sono visualizzati in tabella (Riga 1 = 1° Barcode, Riga 2 = 2° Barcode, ecc.).
            </p>

            {/* Anteprima delle prime righe in sequenza */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 mb-5 max-h-36 overflow-y-auto space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Sequenza di Stampa:
              </div>
              {processedData.slice(0, 6).map((row, idx) => (
                <div key={row.id} className="flex items-center justify-between text-xs gap-2 py-0.5 border-b border-slate-900 last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-5 h-5 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-400 font-black text-[10px] flex items-center justify-center shrink-0">
                      {idx + 1}°
                    </span>
                    <span className="font-mono font-bold text-brand-blue shrink-0">
                      {formatPalletCode(row.pallet_code)}
                    </span>
                    {row.client_pallet_number && (
                      <span className="px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-sky-300 font-mono text-[10px] shrink-0">
                        Rif: {row.client_pallet_number}
                      </span>
                    )}
                    <span className="text-slate-300 truncate">{row.product_name}</span>
                  </div>
                </div>
              ))}
              {processedData.length > 6 && (
                <div className="text-[11px] text-slate-500 italic pt-1 text-center">
                  ...e altre {processedData.length - 6} righe in ordine
                </div>
              )}
            </div>

            <form onSubmit={handlePrintAllDisplayedBarcodes} className="space-y-4">
              <div>
                <label className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2 block">Formato Carta</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setBarcodeFormat('A4')}
                    className={`p-3 rounded-xl border text-center font-bold transition-all ${barcodeFormat === 'A4' ? 'bg-brand-blue/20 border-brand-blue text-brand-white' : 'bg-slate-950 border-slate-800 text-slate-500'}`}
                  >
                    A4 (Griglia)
                  </button>
                  <button
                    type="button"
                    onClick={() => setBarcodeFormat('Zebra')}
                    className={`p-3 rounded-xl border text-center font-bold transition-all ${barcodeFormat === 'Zebra' ? 'bg-brand-blue/20 border-brand-blue text-brand-white' : 'bg-slate-950 border-slate-800 text-slate-500'}`}
                  >
                    Zebra (10x15)
                  </button>
                </div>
              </div>

              <div>
                <label className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1 block">Numero Copie per Etichetta</label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  onWheel={(e) => e.target.blur()}
                  required
                  value={barcodeCopies}
                  onChange={e => setBarcodeCopies(parseInt(e.target.value, 10) || 1)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-brand-white focus:ring-brand-blue font-bold text-lg text-center"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setBarcodePrintModal(false)}
                  className="flex-1 py-3 rounded-xl bg-slate-800 text-slate-300 font-bold hover:bg-slate-700"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={printingBarcodes}
                  className="flex-1 py-3 rounded-xl bg-amber-500 text-brand-black font-black hover:bg-amber-400 transition-colors flex justify-center items-center gap-2 shadow-lg"
                >
                  <Printer size={18} /> {printingBarcodes ? 'Generazione...' : `Stampa (${orderedVisiblePalletIds.length})`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Inventory;
