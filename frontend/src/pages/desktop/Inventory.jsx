import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { Search, SlidersHorizontal, Filter, Download, Printer, GripVertical, Clock, Calendar, AlertTriangle, ShieldCheck, Flame, RotateCcw, Package, CheckCircle } from 'lucide-react';
import Select from 'react-select';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { io } from 'socket.io-client';

const defaultColumns = [
  { key: 'code', label: 'Cod. Paletta', visible: true },
  { key: 'customer', label: 'Cliente', visible: true },
  { key: 'product', label: 'Prodotto', visible: true },
  { key: 'quantity', label: 'Q.tà', visible: true },
  { key: 'location', label: 'Posizione', visible: true },
  { key: 'arrival', label: 'Arrivo', visible: true },
  { key: 'batch', label: 'Lotto', visible: true },
  { key: 'expiration', label: 'Scadenza', visible: true },
  { key: 'flags', label: 'Flag', visible: true },
  { key: 'status', label: 'Stato', visible: false },
  { key: 'notes', label: 'Note', visible: false },
  { key: 'clientPallet', label: 'Rif. Paletta Cl.', visible: false }
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
  const [sortBy, setSortBy] = useState('alphabetical'); // 'alphabetical', 'zone', 'arrival', 'expiration_asc', 'expiration_desc'
  const [groupByBatch, setGroupByBatch] = useState(false);

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
      backgroundColor: '#101c25',
      borderColor: state.isFocused ? '#a9daff' : '#233746',
      borderRadius: '0.75rem',
      padding: '0.25rem',
      boxShadow: 'none',
      '&:hover': { borderColor: '#a9daff' }
    }),
    menu: base => ({ ...base, backgroundColor: '#101c25', zIndex: 50, border: '1px solid #233746' }),
    option: (base, state) => ({ ...base, backgroundColor: state.isFocused ? '#192935' : 'transparent', color: '#F8FAFC', cursor: 'pointer' }),
    multiValue: base => ({ ...base, backgroundColor: '#192935', borderRadius: '0.5rem' }),
    multiValueLabel: base => ({ ...base, color: '#a9daff', fontWeight: 'bold' }),
    multiValueRemove: base => ({ ...base, color: '#a9daff', ':hover': { backgroundColor: '#a9daff', color: '#101c25' } }),
    input: base => ({ ...base, color: '#F8FAFC' }),
  };

  const toggleColumn = (key) => {
    const newCols = columns.map(c => c.key === key ? { ...c, visible: !c.visible } : c);
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

  // Filtro base (ricerca, clienti, range date) prima del filtro categoria scadenza
  const baseFilteredData = useMemo(() => {
    let data = pallets;

    if (selectedCustomers.length > 0) {
      const customerIds = selectedCustomers.map(c => c.value);
      data = data.filter(p => customerIds.includes(p.customer_id));
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
  }, [pallets, selectedCustomers, searchTerm, filterStartDate, filterEndDate, dateFilterMode]);

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
            quantity: parseFloat(p.quantity) || 0,
            palletCount: 1,
            location: '',
            zone: '',
            col: '',
            pos: '',
            pallet_code: 'MULTIPLI'
          };
        } else {
          groups[key].quantity += (parseFloat(p.quantity) || 0);
          groups[key].palletCount += 1;
          // Mantieni la scadenza più ravvicinata del lotto raggruppato
          if (p.expiration_date) {
            if (!groups[key].expiration_date || new Date(p.expiration_date) < new Date(groups[key].expiration_date)) {
              groups[key].expiration_date = p.expiration_date;
            }
          }
        }
      });
      data = Object.values(groups).map(g => {
        g.pallet_code = `${g.palletCount} Palette`;
        return g;
      });
    }

    data = [...data].sort((a, b) => {
      if (sortBy === 'alphabetical') {
        return (a.product_name || '').localeCompare(b.product_name || '');
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

  const hasActiveFilters = searchTerm !== '' || selectedCustomers.length > 0 || filterStartDate !== '' || filterEndDate !== '' || filterExpCategory !== 'ALL';

  const resetAllFilters = () => {
    setSearchTerm('');
    setSelectedCustomers([]);
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
      case 'clientPallet': return groupByBatch ? '-' : (row.client_pallet_number || '-');
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
            <span className="inline-flex items-center gap-1 bg-slate-950 border border-slate-700 px-3 py-1 rounded-lg text-sm font-bold text-brand-white">
              {row.zone ? `${row.zone} ${row.col} ${row.pos}` : row.location}
            </span>
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
      case 'clientPallet': return groupByBatch ? <span className="text-slate-500">-</span> : <span className="text-xs text-slate-400">{row.client_pallet_number || '-'}</span>;
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
    if (sortBy === 'zone') filterText += 'Zone';
    if (sortBy === 'arrival') filterText += 'Data Arrivo';
    if (sortBy === 'expiration_asc') filterText += 'Scadenza (FEFO - Più urgenti)';
    if (sortBy === 'expiration_desc') filterText += 'Scadenza (Più lontane)';
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
      doc.text(`Data: ${new Date().toLocaleDateString('it-IT')} | Elementi stampati: ${processedData.length}`, textX, 26);
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
      const response = await fetch('/logo.png');
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result;
        doc.addImage(base64data, 'PNG', 14, 10, 40, 24);
        renderRest(60);
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
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <h2 className="text-3xl font-extrabold text-brand-white tracking-tight">Inventario Globale</h2>
          <p className="text-slate-400 mt-1">
            Esplora, filtra per scadenza e stampa solo ciò che ti serve ({processedData.length} {groupByBatch ? 'lotti raggruppati' : 'palette'} visibili).
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={exportCSV} className="flex items-center gap-2 px-5 py-3 bg-slate-900 border border-slate-700 text-brand-white rounded-xl hover:bg-slate-800 transition-colors shadow-lg font-bold">
            <Download size={20} className="text-brand-blue" /> CSV ({processedData.length})
          </button>
          <button onClick={exportPDF} className="flex items-center gap-2 px-5 py-3 bg-brand-blue text-brand-black rounded-xl hover:bg-sky-400 transition-colors shadow-lg font-bold">
            <Printer size={20} /> Stampa PDF ({processedData.length})
          </button>
        </div>
      </div>

      {/* Cruscotto Scadenze Interattivo (5 Card KPI) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
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

      {/* Pannello Controlli */}
      <div className="bg-slate-900 border-2 border-slate-800 rounded-3xl p-6 mb-8 shadow-xl space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 border-b border-slate-800 pb-6">
          <div>
            <label className="flex items-center gap-2 text-slate-400 font-bold mb-3 text-xs uppercase tracking-wider">
              <Search size={16} /> Ricerca Rapida
            </label>
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
              <input
                type="text"
                placeholder="Prodotto, lotto, posizione, scadenza..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full bg-[#101c25] border border-[#233746] text-brand-white rounded-xl pl-10 pr-3 py-3 text-sm focus:ring-brand-blue"
              />
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2 text-slate-400 font-bold mb-3 text-xs uppercase tracking-wider">
              <Filter size={16} /> Filtra per Clienti
            </label>
            <Select 
              isMulti
              styles={selectStyles}
              options={customers}
              value={selectedCustomers}
              onChange={setSelectedCustomers}
              placeholder="Tutti i clienti..."
            />
          </div>

          <div>
            <label className="flex items-center gap-2 text-slate-400 font-bold mb-3 text-xs uppercase tracking-wider">
              <SlidersHorizontal size={16} /> Ordina Per
            </label>
            <select 
              value={sortBy} 
              onChange={e => setSortBy(e.target.value)} 
              className="w-full bg-[#101c25] border border-[#233746] text-brand-white rounded-xl p-3 focus:ring-brand-blue text-sm font-semibold"
            >
              <option value="alphabetical">Ordine Alfabetico (Prodotto)</option>
              <option value="zone">Ordine per Zone (Magazzino)</option>
              <option value="arrival">Ordine di Arrivo (Data)</option>
              <option value="expiration_asc">Scadenza ↑ (FEFO - Più urgenti prima)</option>
              <option value="expiration_desc">Scadenza ↓ (Più lontane prima)</option>
            </select>
          </div>

          <div>
            <label className="flex items-center justify-between text-slate-400 font-bold mb-3 text-xs uppercase tracking-wider">
              <span>Vista Inventario</span>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetAllFilters}
                  className="text-brand-blue hover:underline flex items-center gap-1 text-[11px]"
                >
                  <RotateCcw size={12} /> Reset Filtri
                </button>
              )}
            </label>
            <div className="flex items-center gap-3 h-[44px]">
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={groupByBatch} onChange={() => setGroupByBatch(!groupByBatch)} />
                <div className="w-11 h-6 bg-slate-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-brand-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-blue"></div>
                <span className="ml-3 text-sm font-bold text-brand-white">
                  {groupByBatch ? 'Totali per Lotto' : 'Spaccato per Posizioni'}
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Barra Controllo Scadenze (Range Date + Switch GG/MESI + Spunta Filtra solo in avviso) */}
        <div className="flex flex-col lg:flex-row flex-wrap items-start lg:items-center justify-between gap-4 border-b border-slate-800 pb-6">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
            <Calendar size={15} className="text-brand-blue" />
            <div className="flex bg-[#101c25] rounded-lg border border-[#233746] p-0.5">
              <button
                type="button"
                onClick={() => setDateFilterMode('EXPIRATION')}
                className={`px-2.5 py-1.5 rounded-md transition-colors font-bold ${
                  dateFilterMode === 'EXPIRATION' ? 'bg-brand-blue text-brand-black' : 'text-slate-400 hover:text-white'
                }`}
              >
                Data Scadenza
              </button>
              <button
                type="button"
                onClick={() => setDateFilterMode('ARRIVAL')}
                className={`px-2.5 py-1.5 rounded-md transition-colors font-bold ${
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
                className="w-[130px] bg-[#101c25] border border-[#233746] text-brand-white rounded-lg px-2 py-1.5 focus:ring-brand-blue [color-scheme:dark]"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Al:</span>
              <input
                type="date"
                value={filterEndDate}
                onChange={e => setFilterEndDate(e.target.value)}
                className="w-[130px] bg-[#101c25] border border-[#233746] text-brand-white rounded-lg px-2 py-1.5 focus:ring-brand-blue [color-scheme:dark]"
              />
            </div>
            {(filterStartDate || filterEndDate) && (
              <button
                type="button"
                onClick={() => { setFilterStartDate(''); setFilterEndDate(''); }}
                className="text-rose-400 hover:text-rose-300 font-bold px-2 py-1 rounded bg-rose-500/10 border border-rose-500/20"
              >
                ✕ Pulisci date
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs font-medium">
            <div className="flex items-center gap-2 bg-[#101c25] border border-[#233746] rounded-xl px-3 py-1.5">
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
                  : 'bg-[#101c25] border-[#233746] text-slate-400 hover:border-amber-500/50 hover:text-slate-200'
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
                    : 'bg-[#101c25] border-[#233746] text-slate-400 hover:text-rose-400'
                }`}
              >
                {filterExpCategory === 'WARNING_AND_EXPIRED' ? '✓ Scaduti inclusi' : `+ Includi Scaduti (${expStats.EXPIRED.count})`}
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="block text-slate-400 font-bold mb-4 text-xs uppercase tracking-wider">Trascina per Riordinare o Clicca per Attivare/Disattivare le Colonne (anche in Stampa PDF/CSV)</label>
          <div className="flex flex-wrap gap-3">
            {columns.map((col, idx) => (
              <div 
                key={col.key}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(idx)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold transition-colors border cursor-grab active:cursor-grabbing ${col.visible ? 'bg-brand-blue/20 text-brand-blue border-brand-blue' : 'bg-[#101c25] text-slate-500 border-[#233746] hover:bg-slate-800'}`}
              >
                <GripVertical size={14} className={col.visible ? 'text-brand-blue/50' : 'text-slate-600'} />
                <button onClick={() => toggleColumn(col.key)} className="focus:outline-none">
                  {col.label}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabella Dati */}
      <div className="flex-1 bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-950 border-b border-slate-800">
                {visibleCols.map(col => (
                  <th
                    key={col.key}
                    onClick={() => {
                      if (col.key === 'expiration') {
                        setSortBy(sortBy === 'expiration_asc' ? 'expiration_desc' : 'expiration_asc');
                      }
                    }}
                    className={`p-4 text-xs font-bold text-slate-400 uppercase tracking-wider ${
                      col.key === 'quantity' ? 'text-right' : col.key === 'location' ? 'text-center' : ''
                    } ${col.key === 'expiration' ? 'cursor-pointer hover:text-brand-blue select-none' : ''}`}
                  >
                    {col.label}
                    {col.key === 'expiration' && sortBy === 'expiration_asc' && ' ↑'}
                    {col.key === 'expiration' && sortBy === 'expiration_desc' && ' ↓'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {processedData.length === 0 ? (
                <tr>
                  <td colSpan={visibleCols.length} className="p-8 text-center text-slate-500 font-medium">Nessuna paletta trovata con i filtri selezionati.</td>
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
                          : 'bg-[#101c25]/30 hover:bg-slate-800/50'
                      }`}
                    >
                      {visibleCols.map(col => (
                        <td key={col.key} className="p-4">
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
    </div>
  );
};

export default Inventory;
