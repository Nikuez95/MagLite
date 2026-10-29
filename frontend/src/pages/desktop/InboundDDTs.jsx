import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import {
  Package, Search, Printer, CheckCircle, Clock, FileText, AlertTriangle,
  XCircle, Eye, ChevronDown, ChevronUp, History, User, Calendar, ShieldCheck,
  RotateCcw, Check, X, Layers
} from 'lucide-react';
import { io } from 'socket.io-client';
import { appAlert } from '../../utils/alerts';

const InboundDDTs = () => {
  const [ddts, setDdts] = useState([]);
  const [discrepancyHistory, setDiscrepancyHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  // Navigazione Tab: 'DDTS' | 'HISTORY'
  const [activeTab, setActiveTab] = useState('DDTS');

  // Filtri Tab DDT
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL' | 'PENDING' | 'IN_PROGRESS' | 'DISCREPANCY' | 'COMPLETED'
  const [expandedDdtId, setExpandedDdtId] = useState(null);

  // Filtri Tab Storico Discrepanze
  const [historySearch, setHistorySearch] = useState('');
  const [historyDecisionFilter, setHistoryDecisionFilter] = useState('ALL'); // 'ALL' | 'ACCEPTED' | 'REJECTED' | 'REPORTED'
  const [historyStartDate, setHistoryStartDate] = useState('');
  const [historyEndDate, setHistoryEndDate] = useState('');

  // Modale Gestione Discrepanza (Accetta con motivo / Rifiuta)
  const [discrepancyModal, setDiscrepancyModal] = useState({
    show: false,
    ddt: null,
    reason: '',
    isSubmitting: false
  });

  const getToken = () => localStorage.getItem('maglite_token');

  const fetchAllData = async () => {
    try {
      const [ddtRes, histRes] = await Promise.all([
        axios.get(`http://${window.location.hostname}:3000/api/inbound/ddt`, {
          headers: { Authorization: `Bearer ${getToken()}` }
        }),
        axios.get(`http://${window.location.hostname}:3000/api/inbound/discrepancies/history`, {
          headers: { Authorization: `Bearer ${getToken()}` }
        })
      ]);
      setDdts(ddtRes.data || []);
      setDiscrepancyHistory(histRes.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
    const socket = io(`http://${window.location.hostname}:3000`);
    socket.on('dashboard_update', () => fetchAllData());
    socket.on('stow_updated', () => fetchAllData());
    const interval = setInterval(fetchAllData, 15000);
    return () => {
      socket.disconnect();
      clearInterval(interval);
    };
  }, []);

  // Statistiche KPI
  const kpiStats = useMemo(() => {
    const total = ddts.length;
    const pendingOrInProgress = ddts.filter(d => d.status === 'PENDING' || d.status === 'IN_PROGRESS').length;
    const activeDiscrepancies = ddts.filter(d => d.status === 'DISCREPANCY').length;
    const completed = ddts.filter(d => d.status === 'COMPLETED').length;
    const acceptedHistoryCount = discrepancyHistory.filter(h => h.decision === 'ACCEPTED').length;
    const rejectedHistoryCount = discrepancyHistory.filter(h => h.decision === 'REJECTED').length;
    return {
      total,
      pendingOrInProgress,
      activeDiscrepancies,
      completed,
      acceptedHistoryCount,
      rejectedHistoryCount
    };
  }, [ddts, discrepancyHistory]);

  // Filtro DDTs
  const filteredDdts = useMemo(() => {
    return ddts.filter(d => {
      if (statusFilter !== 'ALL' && d.status !== statusFilter) return false;
      if (!searchTerm.trim()) return true;
      const q = searchTerm.toLowerCase().trim();
      const matchNumber = d.ddt_number && d.ddt_number.toLowerCase().includes(q);
      const matchCustomer = (d.customer_name || d.business_name || '').toLowerCase().includes(q);
      const matchParent = (d.parent_customer_name || '').toLowerCase().includes(q);
      const matchReason = (d.discrepancy_reason || d.notes || '').toLowerCase().includes(q);
      const matchItems = Array.isArray(d.items) && d.items.some(it =>
        (it.product_name && it.product_name.toLowerCase().includes(q)) ||
        (it.sku && it.sku.toLowerCase().includes(q)) ||
        (it.batch && it.batch.toLowerCase().includes(q))
      );
      return matchNumber || matchCustomer || matchParent || matchReason || matchItems;
    });
  }, [ddts, statusFilter, searchTerm]);

  // Filtro Storico Discrepanze
  const filteredHistory = useMemo(() => {
    return discrepancyHistory.filter(h => {
      if (historyDecisionFilter !== 'ALL' && h.decision !== historyDecisionFilter) return false;
      if (historyStartDate) {
        const start = new Date(historyStartDate);
        start.setHours(0, 0, 0, 0);
        if (new Date(h.created_at) < start) return false;
      }
      if (historyEndDate) {
        const end = new Date(historyEndDate);
        end.setHours(23, 59, 59, 999);
        if (new Date(h.created_at) > end) return false;
      }
      if (!historySearch.trim()) return true;
      const q = historySearch.toLowerCase().trim();
      const matchDdt = (h.ddt_number || '').toLowerCase().includes(q);
      const matchCust = (h.customer_name || '').toLowerCase().includes(q);
      const matchUser = (h.username || '').toLowerCase().includes(q);
      const matchReason = (h.reason || '').toLowerCase().includes(q);
      const matchItems = Array.isArray(h.items_snapshot) && h.items_snapshot.some(it =>
        (it.product_name && it.product_name.toLowerCase().includes(q)) ||
        (it.sku && it.sku.toLowerCase().includes(q)) ||
        (it.batch && it.batch.toLowerCase().includes(q))
      );
      return matchDdt || matchCust || matchUser || matchReason || matchItems;
    });
  }, [discrepancyHistory, historyDecisionFilter, historyStartDate, historyEndDate, historySearch]);

  const handleOpenDiscrepancyModal = (ddt) => {
    setDiscrepancyModal({
      show: true,
      ddt,
      reason: '',
      isSubmitting: false
    });
  };

  const handleAcceptDiscrepancy = async () => {
    if (!discrepancyModal.ddt) return;
    if (!discrepancyModal.reason.trim()) {
      return appAlert('Inserisci obbligatoriamente il motivo dell\'accettazione prima di confermare.', 'Motivo Richiesto', 'warning');
    }
    setDiscrepancyModal(prev => ({ ...prev, isSubmitting: true }));
    try {
      await axios.post(
        `http://${window.location.hostname}:3000/api/inbound/ddt/${discrepancyModal.ddt.id}/discrepancy/accept`,
        { reason: discrepancyModal.reason.trim() },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      setDiscrepancyModal({ show: false, ddt: null, reason: '', isSubmitting: false });
      await fetchAllData();
      appAlert(
        'Discrepanza accettata! La merce è stata conteggiata in inventario e ora puoi stampare i barcode.',
        'Discrepanza Accettata',
        'success'
      );
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante l\'accettazione della discrepanza');
      setDiscrepancyModal(prev => ({ ...prev, isSubmitting: false }));
    }
  };

  const handleRejectDiscrepancy = async () => {
    if (!discrepancyModal.ddt) return;
    setDiscrepancyModal(prev => ({ ...prev, isSubmitting: true }));
    try {
      await axios.post(
        `http://${window.location.hostname}:3000/api/inbound/ddt/${discrepancyModal.ddt.id}/discrepancy/reject`,
        { reason: discrepancyModal.reason.trim() || 'Rifare spunta su terminale Zebra' },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      setDiscrepancyModal({ show: false, ddt: null, reason: '', isSubmitting: false });
      await fetchAllData();
      appAlert(
        'Discrepanza rifiutata! Il DDT è tornato "In Attesa" e l\'operatore Zebra dovrà ripetere la spunta.',
        'Spunta Rimandata a Zebra',
        'info'
      );
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante il rifiuto della discrepanza');
      setDiscrepancyModal(prev => ({ ...prev, isSubmitting: false }));
    }
  };

  const renderStatusBadge = (d) => {
    switch (d.status) {
      case 'PENDING':
        return (
          <div className="flex flex-col gap-1">
            <span className="bg-slate-800 text-slate-300 border border-slate-700 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 w-max">
              <Clock size={13} /> In Attesa di Spunta
            </span>
            {d.rejected_count > 0 && (
              <span className="bg-rose-500/15 text-rose-400 border border-rose-500/30 px-2.5 py-0.5 rounded-lg text-[10px] font-bold w-max">
                Rifiutata ({d.rejected_count}x) — Rispunta richiesta su Zebra
              </span>
            )}
          </div>
        );
      case 'IN_PROGRESS':
        return (
          <span className="bg-brand-blue/20 text-brand-blue border border-brand-blue/40 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 w-max animate-pulse">
            <Clock size={13} /> In Spunta su Zebra
          </span>
        );
      case 'COMPLETED':
        return (
          <div className="flex flex-col gap-1">
            <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 w-max">
              <CheckCircle size={13} /> Completato (In Inventario)
            </span>
            {Boolean(d.discrepancy_accepted) && (
              <span
                className="bg-amber-500/15 text-amber-300 border border-amber-500/30 px-2.5 py-0.5 rounded-lg text-[10px] font-bold w-max"
                title={`Accettata da ${d.discrepancy_resolved_by || 'Backoffice'} il ${d.discrepancy_resolved_at ? new Date(d.discrepancy_resolved_at).toLocaleString('it-IT') : ''}: ${d.discrepancy_reason || ''}`}
              >
                ✓ Discrepanza Accettata ({d.discrepancy_resolved_by || 'Ufficio'})
              </span>
            )}
          </div>
        );
      case 'DISCREPANCY':
        return (
          <span className="bg-amber-500/20 text-amber-400 border border-amber-500/50 px-3 py-1 rounded-full text-xs font-black flex items-center gap-1.5 w-max shadow-[0_0_15px_rgba(245,158,11,0.2)]">
            <AlertTriangle size={14} className="animate-bounce" /> Discrepanza da Gestire
          </span>
        );
      default:
        return <span className="bg-slate-700 text-slate-300 px-3 py-1 rounded-full text-xs font-bold">{d.status}</span>;
    }
  };

  return (
    <div className="p-6 md:p-8 h-full flex flex-col overflow-y-auto bg-brand-black min-h-screen">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-black text-white flex items-center gap-3 tracking-tight">
            <FileText className="text-brand-blue" size={32} /> DDT Entrata (Spunta & Discrepanze)
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Monitora le spunte Zebra in tempo reale, approva o rifiuta eventuali discrepanze con motivazione e consulta lo storico.
          </p>
        </div>

        {/* Switch Tab principale */}
        <div className="flex bg-slate-900 border border-slate-800 p-1.5 rounded-2xl shadow-lg">
          <button
            type="button"
            onClick={() => setActiveTab('DDTS')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all ${
              activeTab === 'DDTS'
                ? 'bg-brand-blue text-brand-black shadow-[0_0_15px_rgba(14,165,233,0.3)]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Package size={17} />
            Documenti DDT ({ddts.length})
            {kpiStats.activeDiscrepancies > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-500 text-brand-black font-black text-xs">
                {kpiStats.activeDiscrepancies}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('HISTORY')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all ${
              activeTab === 'HISTORY'
                ? 'bg-amber-500 text-brand-black shadow-[0_0_15px_rgba(245,158,11,0.3)]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <History size={17} />
            Storico Discrepanze & Motivi ({discrepancyHistory.length})
          </button>
        </div>
      </div>

      {/* 5 Card KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <button
          type="button"
          onClick={() => { setActiveTab('DDTS'); setStatusFilter('ALL'); }}
          className={`text-left p-4 rounded-2xl border transition-all ${
            activeTab === 'DDTS' && statusFilter === 'ALL'
              ? 'bg-slate-900 border-brand-blue shadow-lg'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="text-xs font-bold uppercase text-slate-400 flex justify-between items-center">
            <span>Totale DDT</span>
            <FileText size={16} className="text-brand-blue" />
          </div>
          <div className="text-2xl font-black text-white mt-1">{kpiStats.total}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Documenti registrati</div>
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('DDTS'); setStatusFilter(statusFilter === 'PENDING' ? 'ALL' : 'PENDING'); }}
          className={`text-left p-4 rounded-2xl border transition-all ${
            activeTab === 'DDTS' && (statusFilter === 'PENDING' || statusFilter === 'IN_PROGRESS')
              ? 'bg-slate-900 border-sky-400 shadow-lg'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="text-xs font-bold uppercase text-sky-400 flex justify-between items-center">
            <span>In Attesa / Spunta</span>
            <Clock size={16} className="text-sky-400" />
          </div>
          <div className="text-2xl font-black text-white mt-1">{kpiStats.pendingOrInProgress}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Da lavorare su Zebra</div>
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('DDTS'); setStatusFilter(statusFilter === 'DISCREPANCY' ? 'ALL' : 'DISCREPANCY'); }}
          className={`text-left p-4 rounded-2xl border transition-all ${
            activeTab === 'DDTS' && statusFilter === 'DISCREPANCY'
              ? 'bg-amber-950/40 border-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.25)]'
              : kpiStats.activeDiscrepancies > 0
              ? 'bg-amber-950/20 border-amber-500/50 hover:border-amber-400'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="text-xs font-bold uppercase text-amber-400 flex justify-between items-center">
            <span className="flex items-center gap-1.5">
              {kpiStats.activeDiscrepancies > 0 && <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />}
              Discrepanze Attive
            </span>
            <AlertTriangle size={16} className="text-amber-500" />
          </div>
          <div className="text-2xl font-black text-amber-400 mt-1">{kpiStats.activeDiscrepancies}</div>
          <div className="text-[11px] text-amber-300/70 mt-0.5">
            {kpiStats.activeDiscrepancies > 0 ? 'Richiedono Accetta / Rifiuta' : 'Nessuna discrepanza in sospeso'}
          </div>
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('DDTS'); setStatusFilter(statusFilter === 'COMPLETED' ? 'ALL' : 'COMPLETED'); }}
          className={`text-left p-4 rounded-2xl border transition-all ${
            activeTab === 'DDTS' && statusFilter === 'COMPLETED'
              ? 'bg-emerald-950/30 border-emerald-500 shadow-lg'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="text-xs font-bold uppercase text-emerald-400 flex justify-between items-center">
            <span>Completati</span>
            <CheckCircle size={16} className="text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-emerald-400 mt-1">{kpiStats.completed}</div>
          <div className="text-[11px] text-emerald-300/70 mt-0.5">Merce in inventario & Barcode pronti</div>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('HISTORY')}
          className={`text-left p-4 rounded-2xl border transition-all ${
            activeTab === 'HISTORY'
              ? 'bg-amber-950/30 border-amber-500 shadow-lg'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="text-xs font-bold uppercase text-slate-300 flex justify-between items-center">
            <span>Storico Decisioni</span>
            <History size={16} className="text-amber-400" />
          </div>
          <div className="text-2xl font-black text-white mt-1">
            {kpiStats.acceptedHistoryCount + kpiStats.rejectedHistoryCount}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            <span className="text-emerald-400 font-bold">{kpiStats.acceptedHistoryCount} acc.</span> • <span className="text-rose-400 font-bold">{kpiStats.rejectedHistoryCount} rif.</span>
          </div>
        </button>
      </div>

      {/* TAB 1: DOCUMENTI DDT & SPUNTA */}
      {activeTab === 'DDTS' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl flex-1 flex flex-col">
          {/* Barra Filtri */}
          <div className="flex flex-col lg:flex-row flex-wrap justify-between items-stretch lg:items-center gap-3 mb-5">
            <div className="relative flex-1 min-w-[260px] max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                type="text"
                placeholder="Cerca DDT, cliente, prodotto, SKU, lotto o motivo..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl py-2.5 pl-10 pr-9 text-sm focus:ring-brand-blue focus:border-brand-blue"
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                  <X size={15} />
                </button>
              )}
            </div>

            <div className="flex flex-wrap bg-slate-950 border border-slate-800 rounded-xl p-1 gap-1 text-xs font-bold">
              {[
                { key: 'ALL', label: `Tutti (${ddts.length})` },
                { key: 'PENDING', label: `In Attesa (${ddts.filter(d => d.status === 'PENDING').length})` },
                { key: 'IN_PROGRESS', label: `In Spunta (${ddts.filter(d => d.status === 'IN_PROGRESS').length})` },
                { key: 'DISCREPANCY', label: `Discrepanze (${kpiStats.activeDiscrepancies})` },
                { key: 'COMPLETED', label: `Completati (${kpiStats.completed})` }
              ].map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setStatusFilter(tab.key)}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    statusFilter === tab.key
                      ? tab.key === 'DISCREPANCY'
                        ? 'bg-amber-500 text-brand-black font-black'
                        : 'bg-brand-blue text-brand-black font-black'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tabella DDT */}
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-950/70 text-slate-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="p-4 font-bold border-b border-slate-800">Numero DDT</th>
                  <th className="p-4 font-bold border-b border-slate-800">Data & Ora</th>
                  <th className="p-4 font-bold border-b border-slate-800">Cliente</th>
                  <th className="p-4 font-bold border-b border-slate-800">Avanzamento Righe</th>
                  <th className="p-4 font-bold border-b border-slate-800">Stato & Note</th>
                  <th className="p-4 font-bold border-b border-slate-800 text-right">Azioni</th>
                </tr>
              </thead>
              <tbody className="text-slate-300 text-sm">
                {loading ? (
                  <tr><td colSpan="6" className="p-10 text-center text-brand-blue font-bold animate-pulse">Caricamento DDT...</td></tr>
                ) : filteredDdts.length === 0 ? (
                  <tr><td colSpan="6" className="p-10 text-center text-slate-500 italic">Nessun DDT trovato con i filtri selezionati.</td></tr>
                ) : filteredDdts.map(d => {
                  const isExpanded = expandedDdtId === d.id;
                  const totalItems = d.total_items || (d.items ? d.items.length : 0);
                  const doneItems = d.completed_items || 0;
                  const pct = totalItems > 0 ? Math.min(100, Math.round((doneItems / totalItems) * 100)) : 0;

                  return (
                    <React.Fragment key={d.id}>
                      <tr className={`border-b border-slate-800/60 transition-colors ${
                        d.status === 'DISCREPANCY'
                          ? 'bg-amber-950/15 hover:bg-amber-950/25'
                          : 'hover:bg-slate-800/30'
                      }`}>
                        <td className="p-4">
                          <div className="font-black text-white font-mono text-base">{d.ddt_number}</div>
                          {d.pallets_count > 0 && (
                            <span className="text-[11px] text-brand-blue font-bold">
                              {d.pallets_count} {d.pallets_count === 1 ? 'paletta generata' : 'palette generate'}
                            </span>
                          )}
                        </td>
                        <td className="p-4 text-xs">
                          <div className="text-slate-200 font-semibold">{new Date(d.created_at).toLocaleString('it-IT')}</div>
                          {d.closed_at && (
                            <div className="text-slate-500 mt-0.5">
                              Chiuso: {new Date(d.closed_at).toLocaleString('it-IT')}
                            </div>
                          )}
                        </td>
                        <td className="p-4">
                          <div className="font-bold text-white">{d.customer_name || d.business_name}</div>
                          {d.parent_customer_name && (
                            <div className="text-[11px] text-sky-400 font-semibold mt-0.5">
                              Madre: {d.parent_customer_name}
                            </div>
                          )}
                        </td>
                        <td className="p-4">
                          <div className="w-44">
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-slate-400 font-semibold">{doneItems}/{totalItems} righe</span>
                              <span className="font-mono font-bold text-brand-white">
                                {d.total_actual_qty || 0} / {d.total_expected_qty || 0} u.
                              </span>
                            </div>
                            <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                              <div
                                className={`h-full transition-all ${
                                  d.status === 'DISCREPANCY'
                                    ? 'bg-amber-500'
                                    : d.status === 'COMPLETED'
                                    ? 'bg-emerald-500'
                                    : 'bg-brand-blue'
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="p-4">
                          {renderStatusBadge(d)}
                          {d.discrepancy_accepted && d.discrepancy_reason ? (
                            <div className="text-xs text-amber-200/90 mt-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1 max-w-xs">
                              <span className="font-bold text-amber-400">Motivo:</span> &ldquo;{d.discrepancy_reason}&rdquo;
                              <div className="text-[10px] text-slate-400 mt-0.5">
                                Operatore: <b>{d.discrepancy_resolved_by}</b> • {d.discrepancy_resolved_at ? new Date(d.discrepancy_resolved_at).toLocaleString('it-IT') : ''}
                              </div>
                            </div>
                          ) : d.notes ? (
                            <div className="text-xs text-slate-400 mt-1 max-w-xs">{d.notes}</div>
                          ) : null}
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex items-center justify-end gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={() => setExpandedDdtId(isExpanded ? null : d.id)}
                              className={`px-3 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all ${
                                isExpanded
                                  ? 'bg-brand-blue/20 border-brand-blue text-brand-blue'
                                  : 'bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-200'
                              }`}
                              title="Ispeziona righe attese vs riscontrate e storico"
                            >
                              <Eye size={15} />
                              Righe ({totalItems})
                              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>

                            <button
                              type="button"
                              onClick={() => window.open(`http://${window.location.hostname}:3000/api/inbound/ddt/${d.id}/pdf?token=${getToken()}`, '_blank')}
                              className="p-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-brand-white rounded-xl transition-colors flex items-center gap-1.5 text-xs font-bold"
                              title="Apri PDF DDT"
                            >
                              <FileText size={16} /> PDF
                            </button>

                            {/* Se in DISCREPANCY: mostra tasto Gestisci Discrepanza (Accetta/Rifiuta) e NASCONDE il tasto Barcode */}
                            {d.status === 'DISCREPANCY' && (
                              <button
                                type="button"
                                onClick={() => handleOpenDiscrepancyModal(d)}
                                className="px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-brand-black font-black rounded-xl transition-all flex items-center gap-1.5 text-xs shadow-[0_0_20px_rgba(245,158,11,0.3)]"
                              >
                                <AlertTriangle size={16} /> Gestisci Discrepanza
                              </button>
                            )}

                            {/* Solo quando è COMPLETED è possibile stampare il Barcode */}
                            {d.status === 'COMPLETED' && (
                              <button
                                type="button"
                                onClick={() => window.open(`http://${window.location.hostname}:3000/api/inbound/ddt/${d.id}/barcodes?token=${getToken()}`, '_blank')}
                                className="px-3.5 py-2 bg-brand-blue hover:bg-sky-400 text-brand-black font-black rounded-xl transition-all flex items-center gap-1.5 text-xs shadow-[0_0_15px_rgba(14,165,233,0.25)]"
                                title="Stampa Barcode Palette Generate"
                              >
                                <Printer size={16} /> Barcode
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Riga Espansa: Dettaglio Articoli Attesi vs Spuntati + Storico Discrepanze del DDT */}
                      {isExpanded && (
                        <tr className="bg-slate-950/90 border-b border-slate-800">
                          <td colSpan="6" className="p-5">
                            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                              {/* Tabella Righe DDT */}
                              <div className="xl:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-4">
                                <div className="flex items-center justify-between mb-3">
                                  <h4 className="text-xs font-black uppercase tracking-wider text-brand-blue flex items-center gap-2">
                                    <Layers size={15} /> Dettaglio Righe Spunta ({d.ddt_number})
                                  </h4>
                                  {d.status === 'DISCREPANCY' && (
                                    <button
                                      type="button"
                                      onClick={() => handleOpenDiscrepancyModal(d)}
                                      className="px-3 py-1 bg-amber-500 text-brand-black rounded-lg text-xs font-black hover:bg-amber-400"
                                    >
                                      Accetta o Rifiuta Discrepanza →
                                    </button>
                                  )}
                                </div>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left text-xs">
                                    <thead className="bg-slate-950 text-slate-400 uppercase">
                                      <tr>
                                        <th className="p-2.5">Prodotto / SKU</th>
                                        <th className="p-2.5">Lotto</th>
                                        <th className="p-2.5 text-right">Q.tà Attesa</th>
                                        <th className="p-2.5 text-right">Q.tà Spuntata</th>
                                        <th className="p-2.5 text-right">Differenza</th>
                                        <th className="p-2.5 text-center">Esito Riga</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(d.items || []).map(it => {
                                        const exp = parseFloat(it.expected_quantity) || 0;
                                        const act = parseFloat(it.actual_quantity) || 0;
                                        const diff = act - exp;
                                        const hasRowDisc = diff !== 0;
                                        return (
                                          <tr key={it.id} className={`border-b border-slate-800/50 ${hasRowDisc && d.status !== 'PENDING' ? 'bg-amber-500/10' : ''}`}>
                                            <td className="p-2.5">
                                              <div className="font-bold text-white">{it.product_name}</div>
                                              <div className="font-mono text-[11px] text-slate-400">{it.sku}</div>
                                            </td>
                                            <td className="p-2.5 font-mono text-amber-400">{it.batch || '-'}</td>
                                            <td className="p-2.5 text-right font-bold text-slate-200">{exp} {it.product_uom}</td>
                                            <td className="p-2.5 text-right font-black text-brand-blue">{act} {it.product_uom}</td>
                                            <td className={`p-2.5 text-right font-mono font-black ${
                                              diff === 0 ? 'text-emerald-400' : diff > 0 ? 'text-amber-400' : 'text-rose-400'
                                            }`}>
                                              {diff > 0 ? `+${diff}` : diff} {it.product_uom}
                                            </td>
                                            <td className="p-2.5 text-center">
                                              {diff === 0 ? (
                                                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">Allineato</span>
                                              ) : (
                                                <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold">
                                                  {diff < 0 ? 'Mancante' : 'Eccedenza'}
                                                </span>
                                              )}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </div>

                              {/* Timeline Storico Discrepanze di questo DDT */}
                              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col">
                                <h4 className="text-xs font-black uppercase tracking-wider text-amber-400 flex items-center gap-2 mb-3">
                                  <History size={15} /> Storico Eventi Discrepanza DDT
                                </h4>
                                {(!d.discrepancy_logs || d.discrepancy_logs.length === 0) ? (
                                  <div className="text-xs text-slate-500 italic my-auto text-center py-6">
                                    Nessuna discrepanza registrata per questo DDT.
                                  </div>
                                ) : (
                                  <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                                    {d.discrepancy_logs.map(lg => (
                                      <div key={lg.id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs">
                                        <div className="flex items-center justify-between gap-2 mb-1">
                                          <span className={`px-2 py-0.5 rounded font-black text-[10px] uppercase ${
                                            lg.decision === 'ACCEPTED'
                                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                              : lg.decision === 'REJECTED'
                                              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                                              : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                          }`}>
                                            {lg.decision === 'ACCEPTED' ? '✓ Accettata' : lg.decision === 'REJECTED' ? '✕ Rifiutata' : '⚠ Segnalata da Zebra'}
                                          </span>
                                          <span className="text-[11px] font-mono text-slate-400">
                                            {new Date(lg.created_at).toLocaleString('it-IT')}
                                          </span>
                                        </div>
                                        <div className="text-slate-200 font-semibold mt-1">
                                          {lg.reason || '-'}
                                        </div>
                                        <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5">
                                          <User size={12} className="text-brand-blue" /> Operatore: <strong className="text-white">{lg.username}</strong> ({lg.source})
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: STORICO DISCREPANZE & MOTIVI ACCETTAZIONE */}
      {activeTab === 'HISTORY' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl flex-1 flex flex-col">
          <div className="flex flex-col xl:flex-row flex-wrap justify-between items-stretch xl:items-center gap-3 mb-5">
            <div className="relative flex-1 min-w-[260px] max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                type="text"
                placeholder="Cerca per DDT, motivo accettazione, operatore, cliente o prodotto..."
                value={historySearch}
                onChange={e => setHistorySearch(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl py-2.5 pl-10 pr-9 text-sm focus:ring-brand-blue"
              />
              {historySearch && (
                <button onClick={() => setHistorySearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                  <X size={15} />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-400 font-bold">Dal:</span>
                <input
                  type="date"
                  value={historyStartDate}
                  onChange={e => setHistoryStartDate(e.target.value)}
                  className="bg-slate-950 border border-slate-800 text-white rounded-xl px-2.5 py-1.5 text-xs [color-scheme:dark]"
                />
                <span className="text-slate-400 font-bold">Al:</span>
                <input
                  type="date"
                  value={historyEndDate}
                  onChange={e => setHistoryEndDate(e.target.value)}
                  className="bg-slate-950 border border-slate-800 text-white rounded-xl px-2.5 py-1.5 text-xs [color-scheme:dark]"
                />
              </div>

              <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 gap-1 text-xs font-bold">
                {[
                  { key: 'ALL', label: 'Tutti gli Eventi' },
                  { key: 'ACCEPTED', label: '✓ Accettate (Con Motivo)' },
                  { key: 'REJECTED', label: '✕ Rifiutate (Rispunta)' },
                  { key: 'REPORTED', label: '⚠ Segnalate da Zebra' }
                ].map(btn => (
                  <button
                    key={btn.key}
                    type="button"
                    onClick={() => setHistoryDecisionFilter(btn.key)}
                    className={`px-3 py-1.5 rounded-lg transition-all ${
                      historyDecisionFilter === btn.key
                        ? 'bg-amber-500 text-brand-black font-black'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-950/70 text-slate-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="p-4 font-bold border-b border-slate-800">Data & Orario</th>
                  <th className="p-4 font-bold border-b border-slate-800">Operatore</th>
                  <th className="p-4 font-bold border-b border-slate-800">DDT & Cliente</th>
                  <th className="p-4 font-bold border-b border-slate-800">Decisione</th>
                  <th className="p-4 font-bold border-b border-slate-800">Motivo Registrato</th>
                  <th className="p-4 font-bold border-b border-slate-800">Articoli Coinvolti (Atteso vs Effettivo)</th>
                </tr>
              </thead>
              <tbody className="text-slate-300 text-sm">
                {filteredHistory.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="p-10 text-center text-slate-500 italic">
                      Nessun evento nello storico discrepanze con i filtri selezionati.
                    </td>
                  </tr>
                ) : filteredHistory.map(h => {
                  const discrepantItems = Array.isArray(h.items_snapshot)
                    ? h.items_snapshot.filter(i => parseFloat(i.expected_quantity) !== parseFloat(i.actual_quantity))
                    : [];
                  const itemsToShow = discrepantItems.length > 0 ? discrepantItems : (h.items_snapshot || []);

                  return (
                    <tr key={h.id} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                      <td className="p-4 font-mono text-xs text-brand-blue whitespace-nowrap">
                        <div className="font-bold">{new Date(h.created_at).toLocaleDateString('it-IT')}</div>
                        <div className="text-slate-400">{new Date(h.created_at).toLocaleTimeString('it-IT')}</div>
                      </td>
                      <td className="p-4">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs font-bold text-white">
                          <User size={13} className="text-brand-blue" />
                          {h.username}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-1 uppercase">{h.source}</div>
                      </td>
                      <td className="p-4">
                        <div className="font-mono font-black text-white">{h.ddt_number}</div>
                        <div className="text-xs font-semibold text-slate-300">{h.customer_name}</div>
                        {h.parent_customer_name && (
                          <div className="text-[10px] text-sky-400">Madre: {h.parent_customer_name}</div>
                        )}
                      </td>
                      <td className="p-4">
                        {h.decision === 'ACCEPTED' ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-xs font-black">
                            <CheckCircle size={13} /> ACCETTATA
                          </span>
                        ) : h.decision === 'REJECTED' ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-400 text-xs font-black">
                            <XCircle size={13} /> RIFIUTATA (Rispunta)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-400 text-xs font-black">
                            <AlertTriangle size={13} /> RILEVATA DA ZEBRA
                          </span>
                        )}
                      </td>
                      <td className="p-4 max-w-xs">
                        <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 font-medium leading-relaxed">
                          {h.reason || '-'}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="space-y-1 max-w-md">
                          {itemsToShow.map((it, idx) => {
                            const diff = (parseFloat(it.actual_quantity) || 0) - (parseFloat(it.expected_quantity) || 0);
                            return (
                              <div key={idx} className="flex items-center justify-between gap-2 text-xs bg-slate-950/80 border border-slate-800/80 px-2.5 py-1 rounded-lg">
                                <span className="font-bold text-white truncate">
                                  {it.product_name} <span className="font-mono text-slate-400">({it.sku})</span>
                                  {it.batch ? <span className="text-amber-400 font-mono ml-1">[L:{it.batch}]</span> : null}
                                </span>
                                <span className="font-mono whitespace-nowrap shrink-0">
                                  Att: <b>{it.expected_quantity}</b> → Eff: <b>{it.actual_quantity}</b>{' '}
                                  <strong className={diff === 0 ? 'text-emerald-400' : diff > 0 ? 'text-amber-400' : 'text-rose-400'}>
                                    ({diff > 0 ? `+${diff}` : diff})
                                  </strong>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODALE GESTIONE DISCREPANZA (ACCETTA CON MOTIVO / RIFIUTA -> RIFARE SPUNTA SU ZEBRA) */}
      {discrepancyModal.show && discrepancyModal.ddt && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 max-w-3xl w-full shadow-2xl my-8 animate-fade-in-up">
            <div className="flex justify-between items-start gap-4 mb-5">
              <div>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-400 text-xs font-black uppercase mb-2">
                  <AlertTriangle size={14} /> Gestione Discrepanza Spunta
                </span>
                <h2 className="text-2xl font-black text-white">
                  DDT {discrepancyModal.ddt.ddt_number} — {discrepancyModal.ddt.customer_name || discrepancyModal.ddt.business_name}
                </h2>
                <p className="text-slate-400 text-xs mt-1">
                  Verifica le differenze riscontrate dall&apos;operatore Zebra. Se accetti (indicando il motivo), la merce entrerà subito in inventario e potrai stampare i barcode. Se rifiuti, l&apos;operatore Zebra dovrà ripetere la spunta.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDiscrepancyModal({ show: false, ddt: null, reason: '', isSubmitting: false })}
                className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            {/* Tabella Comparativa Atteso vs Spuntato */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden mb-5 max-h-64 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900 text-slate-400 uppercase sticky top-0">
                  <tr>
                    <th className="p-3">Articolo / SKU</th>
                    <th className="p-3">Lotto</th>
                    <th className="p-3 text-right">Q.tà Attesa</th>
                    <th className="p-3 text-right">Q.tà Spuntata (Zebra)</th>
                    <th className="p-3 text-right">Differenza</th>
                  </tr>
                </thead>
                <tbody>
                  {(discrepancyModal.ddt.items || []).map(it => {
                    const exp = parseFloat(it.expected_quantity) || 0;
                    const act = parseFloat(it.actual_quantity) || 0;
                    const diff = act - exp;
                    return (
                      <tr key={it.id} className={`border-b border-slate-800/60 ${diff !== 0 ? 'bg-amber-500/10' : ''}`}>
                        <td className="p-3">
                          <div className="font-bold text-white">{it.product_name}</div>
                          <div className="font-mono text-slate-400">{it.sku}</div>
                        </td>
                        <td className="p-3 font-mono text-amber-400">{it.batch || '-'}</td>
                        <td className="p-3 text-right font-bold text-slate-300">{exp} {it.product_uom}</td>
                        <td className="p-3 text-right font-black text-brand-blue">{act} {it.product_uom}</td>
                        <td className={`p-3 text-right font-mono font-black ${
                          diff === 0 ? 'text-emerald-400' : diff > 0 ? 'text-amber-400' : 'text-rose-400'
                        }`}>
                          {diff > 0 ? `+${diff}` : diff} {it.product_uom}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Campo Motivo */}
            <div className="mb-6">
              <label className="block text-xs font-black uppercase tracking-wider text-slate-300 mb-2">
                Motivo dell&apos;Accettazione (Obbligatorio per accettare) / Nota per Rifiuto
              </label>
              <textarea
                rows={3}
                value={discrepancyModal.reason}
                onChange={e => setDiscrepancyModal(prev => ({ ...prev, reason: e.target.value }))}
                placeholder="Es. Merce mancante confermata dal fornitore su DDT integrativo / Collo danneggiato autorizzato dal cliente..."
                className="w-full bg-slate-950 border border-slate-700 focus:border-brand-blue rounded-2xl p-3.5 text-sm text-white placeholder-slate-500 focus:outline-none"
              />
              {/* Suggerimenti rapidi motivo */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {[
                  'Mancanza confermata dal fornitore',
                  'Eccedenza autorizzata dal cliente',
                  'Errore di battitura su DDT di origine',
                  'Rettifica concordata con amministrazione'
                ].map(preset => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setDiscrepancyModal(prev => ({ ...prev, reason: preset }))}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-bold transition-colors"
                  >
                    + {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Pulsanti Azione: Rifiuta (Rifai spunta su Zebra) vs Accetta (Carica in inventario e sblocca Barcode) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4 border-t border-slate-800">
              <button
                type="button"
                disabled={discrepancyModal.isSubmitting}
                onClick={handleRejectDiscrepancy}
                className="py-3.5 px-4 rounded-2xl bg-rose-500/15 hover:bg-rose-500 text-rose-400 hover:text-white border border-rose-500/40 font-black text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <RotateCcw size={18} />
                Rifiuta (Rifai Spunta su Zebra)
              </button>

              <button
                type="button"
                disabled={discrepancyModal.isSubmitting}
                onClick={handleAcceptDiscrepancy}
                className="py-3.5 px-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-brand-black font-black text-sm transition-all flex items-center justify-center gap-2 shadow-[0_0_25px_rgba(16,185,129,0.3)] disabled:opacity-50"
              >
                <CheckCircle size={18} />
                Accetta Discrepanza e Carica in Inventario
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InboundDDTs;
