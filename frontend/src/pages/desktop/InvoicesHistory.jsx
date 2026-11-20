import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import {
  Archive, Search, Loader2, Trash2, FileText, CheckCircle, XCircle,
  GitBranch, Eye, X, Boxes, Euro, Clock, FolderOpen, Folder,
  Calendar, ArrowUpDown, RotateCcw, Layers, Calculator
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { appAlert, appConfirm } from '../../utils/alerts';
import { hasPerm } from '../../utils/permissions';
import { generateProformaPdf, formatDateIT } from '../../utils/invoicePdf';
import { io } from 'socket.io-client';
import FinanceAdminNav from '../../components/FinanceAdminNav';

const MONTHS_IT = [
  { value: 1, label: 'Gennaio' },
  { value: 2, label: 'Febbraio' },
  { value: 3, label: 'Marzo' },
  { value: 4, label: 'Aprile' },
  { value: 5, label: 'Maggio' },
  { value: 6, label: 'Giugno' },
  { value: 7, label: 'Luglio' },
  { value: 8, label: 'Agosto' },
  { value: 9, label: 'Settembre' },
  { value: 10, label: 'Ottobre' },
  { value: 11, label: 'Novembre' },
  { value: 12, label: 'Dicembre' }
];

const InvoicesHistory = () => {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [loadingDetailId, setLoadingDetailId] = useState(null);
  const [companySettings, setCompanySettings] = useState({});

  // Cartella cliente attiva ('ALL' = tutte le cartelle, altrimenti rootCustomerId)
  const [activeFolderId, setActiveFolderId] = useState('ALL');
  const [folderSearch, setFolderSearch] = useState('');

  // Filtri ricerca cronologica & stato
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterYear, setFilterYear] = useState('');
  const [filterDate, setFilterDate] = useState(''); // YYYY-MM-DD su created_at
  const [filterStatus, setFilterStatus] = useState('ALL'); // ALL, PAID, UNPAID
  const [sortOrder, setSortOrder] = useState('DESC'); // DESC (più recenti), ASC (più vecchie)

  const [previewInvoice, setPreviewInvoice] = useState(null);

  const getToken = () => localStorage.getItem('maglite_token');
  const canManageFinance = hasPerm('finance_manage');

  const fetchInvoices = async () => {
    setLoading(true);
    setLoadError('');
    const headers = { Authorization: `Bearer ${getToken()}` };
    const base = `http://${window.location.hostname}:3000/api`;
    try {
      const [invRes, custRes, setRes] = await Promise.allSettled([
        axios.get(`${base}/finances/invoices`, { headers }),
        axios.get(`${base}/customers`, { headers }),
        axios.get(`${base}/settings`, { headers })
      ]);

      if (invRes.status === 'fulfilled') {
        setInvoices(invRes.value.data || []);
      } else {
        console.error('Errore fetch proforme:', invRes.reason);
        setLoadError(invRes.reason?.response?.data?.error || 'Impossibile caricare le proforme archiviate.');
      }

      if (custRes.status === 'fulfilled') {
        setCustomers(custRes.value.data || []);
      } else {
        console.warn('Errore fetch clienti archivio:', custRes.reason);
      }

      if (setRes.status === 'fulfilled') {
        setCompanySettings(setRes.value.data || {});
      }
    } finally {
      setLoading(false);
    }
  };

  const ensureInvoiceData = async (inv) => {
    if (inv.invoice_data) return inv;
    if (!inv.has_invoice_data) return inv;
    setLoadingDetailId(inv.id);
    try {
      const res = await axios.get(
        `http://${window.location.hostname}:3000/api/finances/invoices/${inv.id}`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      const fullInv = res.data;
      setInvoices(prev => prev.map(row => (row.id === inv.id ? { ...row, invoice_data: fullInv.invoice_data } : row)));
      return fullInv;
    } catch (err) {
      console.error(err);
      appAlert(err.response?.data?.error || 'Errore nel caricamento dei dettagli della proforma.');
      return null;
    } finally {
      setLoadingDetailId(null);
    }
  };

  useEffect(() => {
    fetchInvoices();
    const socket = io(`http://${window.location.hostname}:3000`);
    socket.on('finances_updated', fetchInvoices);
    return () => socket.disconnect();
  }, []);

  const handleDelete = async (id) => {
    if (!canManageFinance) return appAlert('Permesso Gestione Finanza richiesto per eliminare proforme.');
    if (!await appConfirm("Sei sicuro di voler eliminare questa proforma? L'operazione aggiornerà la Dashboard Finanza.")) return;
    try {
      await axios.delete(`http://${window.location.hostname}:3000/api/finances/invoices/${id}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      appAlert('Fattura eliminata con successo');
      fetchInvoices();
    } catch (err) {
      console.error(err);
      appAlert("Errore durante l'eliminazione");
    }
  };

  const togglePayment = async (id) => {
    if (!canManageFinance) return appAlert('Permesso Gestione Finanza richiesto per cambiare lo stato di pagamento.');
    try {
      await axios.put(`http://${window.location.hostname}:3000/api/finances/invoices/${id}/payment`, {}, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      fetchInvoices();
    } catch (err) {
      console.error(err);
      appAlert('Errore aggiornamento stato');
    }
  };

  const downloadPDF = async (rawInv) => {
    const inv = await ensureInvoiceData(rawInv);
    if (!inv || !inv.invoice_data) {
      if (inv) appAlert('Questa proforma non contiene i dati di dettaglio storici per ricreare il PDF.');
      return;
    }

    try {
      const data = typeof inv.invoice_data === 'string' ? JSON.parse(inv.invoice_data) : inv.invoice_data;
      const {
        items = [],
        pallets = [],
        sections = [],
        vatRate = 22,
        period,
        includeNotesInPdf = true,
        pdfOptions = null,
        storageModeLabel = ''
      } = data;

      await generateProformaPdf({
        companySettings,
        customer: {
          business_name: inv.business_name,
          address: inv.address,
          vat_number: inv.vat_number
        },
        period: period || `${String(inv.period_month).padStart(2, '0')}/${inv.period_year}`,
        storageModeLabel,
        sections,
        items,
        pallets,
        includeNotesInPdf,
        pdfOptions,
        vatRate,
        baseTotal: parseFloat(inv.base_total || 0),
        vatAmount: parseFloat(inv.vat_amount || 0),
        grandTotal: parseFloat(inv.grand_total || 0)
      });
    } catch (e) {
      console.error(e);
      appAlert('Errore nella generazione del PDF: i dati storici potrebbero essere corrotti.');
    }
  };

  // Cartelle separate per ciascun cliente (include tutti i clienti padre + eventuali clienti da proforme)
  const customerFolders = useMemo(() => {
    const map = new Map();

    // 1. Pre-popola tutte le cartelle dai clienti padre caricati
    customers.forEach(c => {
      if (c.parent_id) return;
      const folderId = String(c.id);
      if (!map.has(folderId)) {
        map.set(folderId, {
          id: folderId,
          name: c.business_name || `Cliente #${folderId}`,
          count: 0,
          paidCount: 0,
          unpaidCount: 0,
          totalAmount: 0,
          unpaidAmount: 0,
          latestTs: 0
        });
      }
    });

    // 2. Aggrega le proforme archiviate nelle rispettive cartelle
    invoices.forEach(inv => {
      const folderId = String(inv.parent_id || inv.customer_id);
      const folderName = inv.parent_business_name || inv.business_name || `Cliente #${folderId}`;
      const existing = map.get(folderId) || {
        id: folderId,
        name: folderName,
        count: 0,
        paidCount: 0,
        unpaidCount: 0,
        totalAmount: 0,
        unpaidAmount: 0,
        latestTs: 0
      };
      const val = parseFloat(inv.grand_total) || 0;
      const ts = new Date(inv.created_at).getTime() || 0;
      existing.count += 1;
      existing.totalAmount += val;
      if (inv.is_paid) existing.paidCount += 1;
      else {
        existing.unpaidCount += 1;
        existing.unpaidAmount += val;
      }
      if (ts > existing.latestTs) existing.latestTs = ts;
      map.set(folderId, existing);
    });

    const list = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'it'));
    if (!folderSearch.trim()) return list;
    const fq = folderSearch.trim().toLowerCase();
    return list.filter(f => f.name.toLowerCase().includes(fq));
  }, [customers, invoices, folderSearch]);

  const availableYears = useMemo(() => {
    const yrs = new Set(invoices.map(i => Number(i.period_year)).filter(Boolean));
    yrs.add(new Date().getFullYear());
    return Array.from(yrs).sort((a, b) => b - a);
  }, [invoices]);

  // Proforme filtrate & ordinate cronologicamente
  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();

    const matches = invoices.filter(i => {
      const folderId = String(i.parent_id || i.customer_id);
      if (activeFolderId !== 'ALL' && folderId !== String(activeFolderId)) return false;

      if (filterMonth && Number(i.period_month) !== Number(filterMonth)) return false;
      if (filterYear && Number(i.period_year) !== Number(filterYear)) return false;

      if (filterDate) {
        const dt = new Date(i.created_at);
        if (isNaN(dt.getTime())) return false;
        const localDate = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
        if (localDate !== filterDate) return false;
      }

      if (filterStatus === 'PAID' && !i.is_paid) return false;
      if (filterStatus === 'UNPAID' && i.is_paid) return false;

      if (q) {
        const periodStr = `${String(i.period_month).padStart(2, '0')}/${i.period_year}`;
        const rawPeriodStr = `${i.period_month}/${i.period_year}`;
        const createdStr = new Date(i.created_at).toLocaleDateString('it-IT');
        const hit =
          (i.business_name || '').toLowerCase().includes(q) ||
          (i.parent_business_name || '').toLowerCase().includes(q) ||
          periodStr.includes(q) ||
          rawPeriodStr.includes(q) ||
          createdStr.includes(q) ||
          String(i.grand_total || '').includes(q);
        if (!hit) return false;
      }
      return true;
    });

    return [...matches].sort((a, b) => {
      const cmpYear = Number(a.period_year) - Number(b.period_year);
      if (cmpYear !== 0) return sortOrder === 'DESC' ? -cmpYear : cmpYear;
      const cmpMonth = Number(a.period_month) - Number(b.period_month);
      if (cmpMonth !== 0) return sortOrder === 'DESC' ? -cmpMonth : cmpMonth;
      const cmpTs = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return sortOrder === 'DESC' ? -cmpTs : cmpTs;
    });
  }, [invoices, activeFolderId, filterMonth, filterYear, filterDate, filterStatus, searchTerm, sortOrder]);

  const kpi = useMemo(() => {
    const scopeList = activeFolderId === 'ALL'
      ? invoices
      : invoices.filter(i => String(i.parent_id || i.customer_id) === String(activeFolderId));

    let paidSum = 0;
    let unpaidSum = 0;
    let paidCount = 0;
    let unpaidCount = 0;
    scopeList.forEach(i => {
      const val = parseFloat(i.grand_total) || 0;
      if (i.is_paid) {
        paidSum += val;
        paidCount++;
      } else {
        unpaidSum += val;
        unpaidCount++;
      }
    });
    return {
      totalCount: scopeList.length,
      paidSum,
      unpaidSum,
      totalSum: paidSum + unpaidSum,
      paidCount,
      unpaidCount
    };
  }, [invoices, activeFolderId]);

  const hasActiveFilters = Boolean(searchTerm || filterMonth || filterYear || filterDate || filterStatus !== 'ALL');

  const resetFilters = () => {
    setSearchTerm('');
    setFilterMonth('');
    setFilterYear('');
    setFilterDate('');
    setFilterStatus('ALL');
  };

  const openGoodsPreview = async (rawInv) => {
    const inv = await ensureInvoiceData(rawInv);
    if (!inv || !inv.invoice_data) {
      if (inv) appAlert('Nessun dato di dettaglio disponibile per questa proforma.');
      return;
    }
    try {
      const data = typeof inv.invoice_data === 'string' ? JSON.parse(inv.invoice_data) : inv.invoice_data;
      const flatPallets = (data.pallets && data.pallets.length > 0)
        ? data.pallets
        : (data.sections || []).flatMap(s => s.pallets || []);
      setPreviewInvoice({ inv, data, pallets: flatPallets });
    } catch (e) {
      appAlert('Impossibile leggere i dettagli merce di questa proforma.');
    }
  };

  const activeFolderObj = customerFolders.find(f => String(f.id) === String(activeFolderId));

  return (
    <div className="flex-1 p-6 md:p-8 overflow-y-auto bg-brand-black min-h-screen">
      <div className="max-w-7xl mx-auto animate-fade-in-up">
        <FinanceAdminNav />

        {loadError && (
          <div className="mb-5 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/40 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-rose-300 font-bold">
              {loadError}
            </div>
            <button
              type="button"
              onClick={fetchInvoices}
              className="px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-xs font-bold transition-colors"
            >
              Riprova
            </button>
          </div>
        )}

        <div className="mb-6 flex flex-wrap justify-between items-end gap-4">
          <div>
            <h1 className="text-3xl font-black text-white mb-1 flex items-center gap-3">
              <Archive className="text-brand-blue" size={32} />
              Archivio Proforme per Cliente
            </h1>
            <p className="text-slate-400 text-sm">
              Cartelle clienti separate in ordine cronologico, con ricerca per mese, anno, data di emissione e stato pagamento.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/desktop/billing-dashboard')}
            className="px-4 py-2.5 bg-brand-blue hover:bg-sky-400 text-brand-black font-black text-xs rounded-xl flex items-center gap-2 shadow-[0_0_20px_rgba(14,165,233,0.25)] transition-all"
          >
            <Calculator size={16} /> Nuova Pre-Fattura
          </button>
        </div>

        {/* KPI Bar (relativa alla cartella attiva o globale) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <FileText size={13} className="text-brand-blue" /> {activeFolderObj ? `Proforme (${activeFolderObj.name})` : 'Totale Proforme'}
            </div>
            <div className="text-2xl font-black text-white mt-1">{kpi.totalCount}</div>
            <div className="text-xs text-slate-500 mt-0.5">Valore: € {kpi.totalSum.toFixed(2)}</div>
          </div>
          <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
              <CheckCircle size={13} /> Incassato ({kpi.paidCount})
            </div>
            <div className="text-2xl font-black text-emerald-400 mt-1">€ {kpi.paidSum.toFixed(2)}</div>
          </div>
          <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              <Clock size={13} /> Da Incassare ({kpi.unpaidCount})
            </div>
            <div className="text-2xl font-black text-amber-400 mt-1">€ {kpi.unpaidSum.toFixed(2)}</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
              <Euro size={13} /> Tasso Incasso
            </div>
            <div className="text-2xl font-black text-sky-400 mt-1">
              {kpi.totalSum > 0 ? Math.round((kpi.paidSum / kpi.totalSum) * 100) : 0}%
            </div>
          </div>
        </div>

        {/* Layout Cartelle Clienti (Sinistra) + Archivio Cronologico (Destra) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Colonna Sinistra: Cartelle Clienti */}
          <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-3xl p-4 shadow-xl space-y-3 lg:sticky lg:top-6">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Folder size={14} className="text-brand-blue" /> Cartelle Clienti ({customerFolders.length})
              </span>
            </div>

            <div className="relative">
              <Search size={14} className="absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                value={folderSearch}
                onChange={e => setFolderSearch(e.target.value)}
                placeholder="Filtra cartella cliente..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-2 text-xs text-white focus:border-brand-blue outline-none"
              />
            </div>

            <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
              <button
                type="button"
                onClick={() => setActiveFolderId('ALL')}
                className={`w-full text-left p-3 rounded-2xl border transition-all flex items-center justify-between gap-2 ${
                  activeFolderId === 'ALL'
                    ? 'bg-brand-blue/15 border-brand-blue/60 text-white shadow'
                    : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {activeFolderId === 'ALL' ? (
                    <FolderOpen size={18} className="text-brand-blue shrink-0" />
                  ) : (
                    <Folder size={18} className="text-slate-400 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="font-bold text-xs truncate">Tutte le Cartelle</div>
                    <div className="text-[10px] text-slate-500">Vista cronologica unificata</div>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-black text-brand-blue shrink-0">
                  {invoices.length}
                </span>
              </button>

              {customerFolders.map(folder => {
                const isSelected = String(activeFolderId) === String(folder.id);
                return (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => setActiveFolderId(folder.id)}
                    className={`w-full text-left p-3 rounded-2xl border transition-all ${
                      isSelected
                        ? 'bg-brand-blue/15 border-brand-blue/60 text-white shadow'
                        : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {isSelected ? (
                          <FolderOpen size={17} className="text-brand-blue shrink-0" />
                        ) : (
                          <Folder size={17} className="text-amber-400/80 shrink-0" />
                        )}
                        <span className="font-bold text-xs truncate">{folder.name}</span>
                      </div>
                      <span className="px-2 py-0.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-black text-slate-200 shrink-0">
                        {folder.count}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1.5 pl-6">
                      <span>Tot: <b className="text-slate-200">€ {folder.totalAmount.toFixed(2)}</b></span>
                      {folder.count === 0 ? (
                        <span className="text-slate-500">Nessuna proforma</span>
                      ) : folder.unpaidCount > 0 ? (
                        <span className="text-amber-400 font-bold">{folder.unpaidCount} da pagare</span>
                      ) : (
                        <span className="text-emerald-400 font-bold">Tutto pagato</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Colonna Destra: Filtri Mese/Data + Elenco Cronologico */}
          <div className="lg:col-span-8 space-y-5">
            {/* Barra Filtri Avanzata */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 shadow-xl space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                <div className="sm:col-span-5 relative">
                  <Search className="absolute left-3.5 top-2.5 text-slate-500" size={16} />
                  <input
                    type="text"
                    placeholder="Cerca cliente, mese (es. 11/2026) o importo..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-3 py-2 text-xs text-white focus:border-brand-blue outline-none"
                  />
                </div>
                <div className="sm:col-span-3">
                  <select
                    value={filterMonth}
                    onChange={e => setFilterMonth(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-200 focus:border-brand-blue outline-none"
                  >
                    <option value="">Tutti i Mesi</option>
                    {MONTHS_IT.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <select
                    value={filterYear}
                    onChange={e => setFilterYear(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-200 focus:border-brand-blue outline-none"
                  >
                    <option value="">Tutti Anni</option>
                    {availableYears.map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <input
                    type="date"
                    value={filterDate}
                    onChange={e => setFilterDate(e.target.value)}
                    title="Filtra per data esatta di emissione"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2 py-2 text-xs text-slate-200 focus:border-brand-blue outline-none [color-scheme:dark]"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex bg-slate-950 rounded-xl border border-slate-800 p-1">
                  <button
                    type="button"
                    onClick={() => setFilterStatus('ALL')}
                    className={`px-3 py-1 rounded-lg font-bold text-xs transition-colors ${filterStatus === 'ALL' ? 'bg-brand-blue text-brand-black' : 'text-slate-400 hover:text-white'}`}
                  >
                    Tutte ({kpi.totalCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterStatus('UNPAID')}
                    className={`px-3 py-1 rounded-lg font-bold text-xs transition-colors ${filterStatus === 'UNPAID' ? 'bg-amber-500 text-brand-black' : 'text-slate-400 hover:text-amber-500'}`}
                  >
                    Da Pagare ({kpi.unpaidCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterStatus('PAID')}
                    className={`px-3 py-1 rounded-lg font-bold text-xs transition-colors ${filterStatus === 'PAID' ? 'bg-emerald-500 text-brand-black' : 'text-slate-400 hover:text-emerald-500'}`}
                  >
                    Pagate ({kpi.paidCount})
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSortOrder(prev => (prev === 'DESC' ? 'ASC' : 'DESC'))}
                    className="px-3 py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl text-xs font-bold flex items-center gap-1.5"
                  >
                    <ArrowUpDown size={13} className="text-brand-blue" />
                    {sortOrder === 'DESC' ? 'Ordine: Più recenti' : 'Ordine: Più vecchie'}
                  </button>
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 rounded-xl text-xs font-bold flex items-center gap-1"
                    >
                      <RotateCcw size={12} /> Reset
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Lista Cronologica Proforme */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl">
              {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="animate-spin text-brand-blue" size={40} /></div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-14 text-slate-500 space-y-2">
                  <Archive size={36} className="mx-auto text-slate-700" />
                  <p className="text-sm font-semibold text-slate-400">Nessuna proforma trovata con i filtri selezionati.</p>
                  <p className="text-xs text-slate-500">Salva una proforma da Pre-Fatturazione per archiviarla nella cartella del cliente.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filtered.map(inv => {
                    const parsedData = inv.invoice_data
                      ? (typeof inv.invoice_data === 'string' ? JSON.parse(inv.invoice_data) : inv.invoice_data)
                      : null;
                    const sectionsCount = parsedData?.sections?.length || 0;
                    const palletsCount = parsedData?.pallets?.length || (parsedData?.sections || []).reduce((acc, s) => acc + (s.pallets?.length || 0), 0);
                    const monthLabel = MONTHS_IT.find(m => m.value === Number(inv.period_month))?.label || inv.period_month;

                    return (
                      <div
                        key={inv.id}
                        className={`bg-slate-950/90 border rounded-2xl p-4 hover:border-brand-blue/70 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                          inv.is_paid ? 'border-emerald-500/35' : 'border-amber-500/35'
                        }`}
                      >
                        <div className="min-w-0 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="px-2.5 py-0.5 rounded-lg bg-brand-blue/15 text-brand-blue border border-brand-blue/30 text-[11px] font-black uppercase">
                              {monthLabel} {inv.period_year} ({String(inv.period_month).padStart(2, '0')}/{inv.period_year})
                            </span>
                            {inv.is_paid ? (
                              <span className="inline-flex items-center gap-1 text-emerald-400 bg-emerald-400/10 border border-emerald-500/30 px-2 py-0.5 rounded-lg text-[10px] font-black">
                                <CheckCircle size={11} /> PAGATO
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-lg text-[10px] font-black">
                                <Clock size={11} /> DA PAGARE
                              </span>
                            )}
                            <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1">
                              <Calendar size={11} /> Emessa: {new Date(inv.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-black text-white">{inv.business_name}</h3>
                            {sectionsCount > 1 && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-violet-500/15 text-violet-300 text-[10px] font-bold">
                                <GitBranch size={11} /> {sectionsCount} Framm.
                              </span>
                            )}
                            {palletsCount > 0 && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-bold">
                                <Boxes size={11} className="text-brand-blue" /> {palletsCount} Bancali
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400 font-mono">
                            <span>Imponibile: <b className="text-slate-200">€ {parseFloat(inv.base_total || 0).toFixed(2)}</b></span>
                            <span>IVA: <b className="text-slate-200">€ {parseFloat(inv.vat_amount || 0).toFixed(2)}</b></span>
                            <span className="text-emerald-400 font-black text-sm">Totale: € {parseFloat(inv.grand_total || 0).toFixed(2)}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 flex-wrap">
                          <button
                            onClick={() => togglePayment(inv.id)}
                            className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${
                              inv.is_paid
                                ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/30'
                                : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                            }`}
                            title={inv.is_paid ? 'Segna come Da Pagare' : 'Segna come Pagato'}
                          >
                            {inv.is_paid ? 'Da Pagare' : 'Segna Pagato'}
                          </button>

                          {(inv.invoice_data || inv.has_invoice_data) && (
                            <>
                              <button
                                onClick={() => openGoodsPreview(inv)}
                                disabled={loadingDetailId === inv.id}
                                className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-slate-200 border border-slate-700 font-bold text-xs rounded-xl transition-colors"
                              >
                                {loadingDetailId === inv.id ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Merce
                              </button>
                              <button
                                onClick={() => downloadPDF(inv)}
                                disabled={loadingDetailId === inv.id}
                                className="flex items-center gap-1.5 px-3.5 py-2 bg-brand-blue hover:bg-sky-400 disabled:opacity-60 text-brand-black font-black text-xs rounded-xl transition-colors"
                              >
                                {loadingDetailId === inv.id ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} PDF
                              </button>
                            </>
                          )}

                          {canManageFinance && (
                            <button
                              onClick={() => handleDelete(inv.id)}
                              className="p-2 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-colors"
                              title="Elimina Proforma"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modal Anteprima Report Merce */}
      {previewInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 max-w-6xl w-full shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center pb-4 border-b border-slate-800">
              <div>
                <h2 className="text-xl font-black text-white">
                  Report Dettagliato Merce — {previewInvoice.inv.business_name} ({String(previewInvoice.inv.period_month).padStart(2, '0')}/{previewInvoice.inv.period_year})
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {previewInvoice.pallets.length} bancali registrati • {previewInvoice.data.storageModeLabel || 'Archivio'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => downloadPDF(previewInvoice.inv)}
                  className="px-4 py-2 bg-brand-blue hover:bg-sky-400 text-brand-black font-black text-xs rounded-xl flex items-center gap-1.5"
                >
                  <FileText size={14} /> Scarica PDF
                </button>
                <button
                  onClick={() => setPreviewInvoice(null)}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="overflow-auto flex-1 mt-4 rounded-2xl border border-slate-800">
              {previewInvoice.pallets.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-sm">
                  Nessun bancale collegato a questa proforma storica.
                </div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] sticky top-0">
                    <tr>
                      <th className="p-3">Cod. Art.</th>
                      <th className="p-3">Prodotto / Paletta</th>
                      <th className="p-3">Lotto</th>
                      <th className="p-3 text-center">KG Netti / Lordi</th>
                      <th className="p-3 text-center">Scadenza</th>
                      <th className="p-3 text-center">Arrivo</th>
                      <th className="p-3 text-center">Uscita / Stato</th>
                      <th className="p-3 text-center">Q.tà &amp; Gg Sosta</th>
                      <th className="p-3">Listino / Causali</th>
                      <th className="p-3 text-right">Importo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-200">
                    {previewInvoice.pallets.map((p, idx) => (
                      <tr key={`${p.pallet_code}-${idx}`} className="hover:bg-slate-800/30">
                        <td className="p-3 font-mono font-bold text-sky-400">{p.sku || '-'}</td>
                        <td className="p-3">
                          <div className="font-bold text-white">{p.product_name || '-'}</div>
                          <div className="text-[10px] font-mono text-slate-500">{p.pallet_code} {p.customer_pallet_ref ? `• Rif: #${p.customer_pallet_ref}` : ''}</div>
                        </td>
                        <td className="p-3 font-mono text-amber-300 font-bold">{p.batch || '-'}</td>
                        <td className="p-3 text-center font-mono text-[11px] whitespace-nowrap">
                          {Number(p.net_weight_kg) > 0 || Number(p.gross_weight_kg) > 0 ? (
                            <>
                              {Number(p.net_weight_kg) > 0 && <div className="text-sky-300">N: {Number(p.net_weight_kg)}kg</div>}
                              {Number(p.gross_weight_kg) > 0 && <div className="text-amber-300">L: {Number(p.gross_weight_kg)}kg</div>}
                            </>
                          ) : '-'}
                        </td>
                        <td className="p-3 text-center font-mono">{p.expiration_date_str || formatDateIT(p.expiration_date)}</td>
                        <td className="p-3 text-center font-mono text-sky-300">{formatDateIT(p.created_at)}</td>
                        <td className="p-3 text-center">
                          {p.shipped_at ? (
                            <span className="px-2 py-0.5 rounded bg-rose-950/40 text-rose-300 border border-rose-500/30 font-mono text-[10px]">
                              OUT {formatDateIT(p.shipped_at)}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-emerald-950/40 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
                              In Deposito
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          <div className="font-bold">{p.effective_quantity ?? p.quantity ?? 0} {p.pallet_uom || 'Pz'}</div>
                          {p.storageDays > 0 && <div className="text-[10px] font-mono text-amber-400">{p.storageDays} gg sosta</div>}
                        </td>
                        <td className="p-3 text-[11px] text-slate-300">
                          {(p.invoice_label || p.tariff_plan_name) && (
                            <div className="text-[10px] font-bold text-brand-blue mb-0.5 flex items-center gap-1">
                              <Layers size={10} /> {p.invoice_label || p.tariff_plan_name}
                            </div>
                          )}
                          {(p.charges || []).map(c => c.label || c.description).join(' • ') || p.movementSummary || '-'}
                        </td>
                        <td className="p-3 text-right font-mono font-black text-emerald-400">
                          € {parseFloat(p.customPrice !== undefined ? p.customPrice : (p.totalPrice || 0)).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InvoicesHistory;
