import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import {
  Activity, Search, Calendar, User, Monitor, Smartphone, Package, Layers,
  ArrowUpRight, Clock, CheckCircle, AlertTriangle, Truck, Download, Eye,
  Filter, RotateCcw, Box, Hash, MapPin, FileText
} from 'lucide-react';

const getActionStyle = (action = '') => {
  const a = action.toUpperCase();
  if (a.includes('DISCREPANCY') || a.includes('REJECT') || a.includes('DELETE')) {
    return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
  }
  if (a.includes('ACCEPT_DISCREPANCY')) {
    return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
  }
  if (a.includes('INBOUND') || a.includes('CREATE_PRODUCT') || a.includes('ADD')) {
    return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
  }
  if (a.includes('OUTBOUND') || a.includes('PICK') || a.includes('SHIP')) {
    return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
  }
  if (a.includes('STOW') || a.includes('HANDLING') || a.includes('MOVE') || a.includes('LOC')) {
    return 'bg-sky-500/15 text-sky-400 border-sky-500/30';
  }
  return 'bg-slate-800 text-slate-300 border-slate-700';
};

const AuditLogs = () => {
  const [activeTab, setActiveTab] = useState('LOGS'); // 'LOGS' | 'PRODUCT_HISTORY'

  // Stato Tab 1: Audit Logs
  const [logs, setLogs] = useState([]);
  const [filters, setFilters] = useState({
    search: '',
    start_date: '',
    end_date: '',
    source: 'ALL',
    category: 'ALL',
    username: 'ALL'
  });
  const [isLoading, setIsLoading] = useState(false);

  // Stato Tab 2: Storico & Tracciabilità Prodotto 360°
  const [productsList, setProductsList] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [productHistory, setProductHistory] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historySubView, setHistorySubView] = useState('TIMELINE'); // 'TIMELINE' | 'PALLETS' | 'OUTBOUND'
  const [timelineFilter, setTimelineFilter] = useState('ALL'); // 'ALL' | 'INBOUND_PALLET' | 'DDT' | 'OUTBOUND_PICK' | 'AUDIT_LOG'

  const getToken = () => localStorage.getItem('maglite_token');

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const query = new URLSearchParams();
      if (filters.search) query.append('search', filters.search);
      if (filters.start_date) query.append('start_date', filters.start_date);
      if (filters.end_date) query.append('end_date', filters.end_date);
      if (filters.source && filters.source !== 'ALL') query.append('source', filters.source);
      if (filters.category && filters.category !== 'ALL') query.append('category', filters.category);
      if (filters.username && filters.username !== 'ALL') query.append('username', filters.username);

      const res = await axios.get(`http://${window.location.hostname}:3000/api/audit?${query.toString()}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setLogs(res.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchProductsSummary = async () => {
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/audit/products`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      const list = res.data || [];
      setProductsList(list);
      if (!selectedProductId && list.length > 0) {
        setSelectedProductId(list[0].id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchProductHistory = async (prodId) => {
    if (!prodId) return;
    setLoadingHistory(true);
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/audit/product/${prodId}/history`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setProductHistory(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [filters]);

  useEffect(() => {
    fetchProductsSummary();
  }, []);

  useEffect(() => {
    if (selectedProductId) {
      fetchProductHistory(selectedProductId);
    }
  }, [selectedProductId]);

  const openProductHistoryFor = (productId) => {
    if (!productId) return;
    setSelectedProductId(productId);
    setActiveTab('PRODUCT_HISTORY');
  };

  const uniqueOperators = useMemo(() => {
    const set = new Set();
    logs.forEach(l => {
      if (l.username) set.add(l.username);
    });
    return Array.from(set).sort();
  }, [logs]);

  const logKpis = useMemo(() => {
    const zebraCount = logs.filter(l => (l.source || '').toLowerCase().includes('zebra')).length;
    const desktopCount = logs.length - zebraCount;
    const inboundCount = logs.filter(l => /INBOUND|DDT|DISCREPANCY/i.test(l.action || '')).length;
    const outboundCount = logs.filter(l => /OUTBOUND|PICK|SHIP/i.test(l.action || '')).length;
    return {
      total: logs.length,
      zebraCount,
      desktopCount,
      inboundCount,
      outboundCount
    };
  }, [logs]);

  const filteredProductsList = useMemo(() => {
    if (!productSearch.trim()) return productsList;
    const q = productSearch.toLowerCase().trim();
    return productsList.filter(p =>
      (p.name && p.name.toLowerCase().includes(q)) ||
      (p.sku && p.sku.toLowerCase().includes(q)) ||
      (p.customer_name && p.customer_name.toLowerCase().includes(q)) ||
      (p.default_article_number && p.default_article_number.toLowerCase().includes(q))
    );
  }, [productsList, productSearch]);

  const filteredTimeline = useMemo(() => {
    if (!productHistory?.timeline) return [];
    return productHistory.timeline.filter(ev => {
      if (timelineFilter === 'ALL') return true;
      if (timelineFilter === 'DDT') return ev.type === 'DDT_SPUNTA' || ev.type === 'DDT_DISCREPANCY';
      return ev.type === timelineFilter;
    });
  }, [productHistory, timelineFilter]);

  return (
    <div className="flex-1 p-6 md:p-8 overflow-y-auto bg-brand-black min-h-screen">
      <div className="max-w-7xl mx-auto animate-fade-in-up">
        {/* Header + Switch Modalità */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-black text-brand-white mb-1 flex items-center gap-3 tracking-tight">
              <Activity className="text-rose-500" size={32} />
              Audit Logs & Tracciabilità Prodotto 360°
            </h1>
            <p className="text-slate-400 text-sm">
              Tracciamento analitico di tutte le operazioni a sistema e ricostruzione storica completa di ogni prodotto, lotto e bancale.
            </p>
          </div>

          <div className="flex bg-slate-900 border border-slate-800 p-1.5 rounded-2xl shadow-lg">
            <button
              type="button"
              onClick={() => setActiveTab('LOGS')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all ${
                activeTab === 'LOGS'
                  ? 'bg-brand-blue text-brand-black shadow-[0_0_15px_rgba(14,165,233,0.3)]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Activity size={17} />
              Registro Operazioni ({logs.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('PRODUCT_HISTORY')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all ${
                activeTab === 'PRODUCT_HISTORY'
                  ? 'bg-emerald-500 text-brand-black shadow-[0_0_15px_rgba(16,185,129,0.3)]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Package size={17} />
              Storico & Tracciabilità Prodotto ({productsList.length})
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* TAB 1: REGISTRO OPERAZIONI LIVE (AUDIT LOG POTENZIATO)                     */}
        {/* ========================================================================= */}
        {activeTab === 'LOGS' && (
          <>
            {/* KPI Rapidi */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
              <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800">
                <div className="text-xs font-bold uppercase text-slate-400">Eventi Visualizzati</div>
                <div className="text-2xl font-black text-white mt-1">{logKpis.total}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Ultime operazioni registrate</div>
              </div>
              <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800">
                <div className="text-xs font-bold uppercase text-brand-blue flex items-center justify-between">
                  <span>Terminale Zebra</span>
                  <Smartphone size={15} />
                </div>
                <div className="text-2xl font-black text-brand-blue mt-1">{logKpis.zebraCount}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Spunte, stivaggi, picking</div>
              </div>
              <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800">
                <div className="text-xs font-bold uppercase text-purple-400 flex items-center justify-between">
                  <span>Gestionale PC</span>
                  <Monitor size={15} />
                </div>
                <div className="text-2xl font-black text-purple-400 mt-1">{logKpis.desktopCount}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Backoffice & amministrazione</div>
              </div>
              <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800">
                <div className="text-xs font-bold uppercase text-emerald-400">Ingressi & Spunte</div>
                <div className="text-2xl font-black text-emerald-400 mt-1">{logKpis.inboundCount}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Carichi, DDT e discrepanze</div>
              </div>
              <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800">
                <div className="text-xs font-bold uppercase text-amber-400">Picking & Spedizioni</div>
                <div className="text-2xl font-black text-amber-400 mt-1">{logKpis.outboundCount}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Prelievi e conferme uscita</div>
              </div>
            </div>

            {/* Pannello Filtri Avanzati */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 mb-6 shadow-xl space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
                <div className="relative xl:col-span-2">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input
                    type="text"
                    placeholder="Cerca prodotto, PAL-..., lotto, DDT, ordine, operatore..."
                    value={filters.search}
                    onChange={e => setFilters({ ...filters, search: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl pl-10 pr-4 py-2.5 text-sm focus:ring-brand-blue"
                  />
                </div>

                <div>
                  <select
                    value={filters.source}
                    onChange={e => setFilters({ ...filters, source: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-brand-blue"
                  >
                    <option value="ALL">Tutte le Sorgenti</option>
                    <option value="Zebra">Terminale Zebra</option>
                    <option value="Gestionale">Gestionale Desktop</option>
                    <option value="Gestionale Finanza">Gestionale Finanza</option>
                  </select>
                </div>

                <div>
                  <select
                    value={filters.username}
                    onChange={e => setFilters({ ...filters, username: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-brand-blue"
                  >
                    <option value="ALL">Tutti gli Operatori</option>
                    {uniqueOperators.map(u => (
                      <option key={u} value={u}>Operatore: {u}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={filters.start_date}
                    onChange={e => setFilters({ ...filters, start_date: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-2.5 py-2 text-xs [color-scheme:dark]"
                    title="Da Data"
                  />
                  <input
                    type="date"
                    value={filters.end_date}
                    onChange={e => setFilters({ ...filters, end_date: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-2.5 py-2 text-xs [color-scheme:dark]"
                    title="A Data"
                  />
                </div>
              </div>

              {/* Pill Categorie */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-800/80">
                <div className="flex flex-wrap gap-1.5 text-xs font-bold">
                  {[
                    { key: 'ALL', label: 'Tutte le Categorie' },
                    { key: 'INBOUND', label: 'Ingressi, DDT & Discrepanze' },
                    { key: 'STOW_HANDLING', label: 'Stivaggio & Handling' },
                    { key: 'OUTBOUND', label: 'Picking & Spedizioni' },
                    { key: 'STOCK_PRODUCTS', label: 'Prodotti & Rettifiche Stock' },
                    { key: 'CUSTOMERS_BILLING', label: 'Clienti & Fatturazione' }
                  ].map(cat => (
                    <button
                      key={cat.key}
                      type="button"
                      onClick={() => setFilters({ ...filters, category: cat.key })}
                      className={`px-3 py-1.5 rounded-xl border transition-all ${
                        filters.category === cat.key
                          ? 'bg-brand-blue text-brand-black border-brand-blue font-black'
                          : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                {(filters.search || filters.start_date || filters.end_date || filters.source !== 'ALL' || filters.category !== 'ALL' || filters.username !== 'ALL') && (
                  <button
                    type="button"
                    onClick={() => setFilters({ search: '', start_date: '', end_date: '', source: 'ALL', category: 'ALL', username: 'ALL' })}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-bold hover:bg-rose-500/20"
                  >
                    <RotateCcw size={13} /> Reset Filtri
                  </button>
                )}
              </div>
            </div>

            {/* Tabella Audit Logs Arricchita */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/70 text-xs uppercase tracking-wider">
                      <th className="p-4 font-bold">Data & Ora</th>
                      <th className="p-4 font-bold">Azione</th>
                      <th className="p-4 font-bold">Prodotto & Tracciabilità</th>
                      <th className="p-4 font-bold">Dettaglio Operazione</th>
                      <th className="p-4 font-bold">Operatore & Sorgente</th>
                      <th className="p-4 font-bold text-right">Ispeziona</th>
                    </tr>
                  </thead>
                  <tbody className="text-brand-white text-sm">
                    {isLoading ? (
                      <tr><td colSpan="6" className="p-12 text-center text-brand-blue font-bold animate-pulse">Caricamento log in corso...</td></tr>
                    ) : logs.length === 0 ? (
                      <tr><td colSpan="6" className="p-12 text-center text-slate-500 italic">Nessun log trovato con i filtri selezionati.</td></tr>
                    ) : logs.map(log => (
                      <tr key={log.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                        <td className="p-4 text-xs font-mono text-brand-blue whitespace-nowrap">
                          <div className="font-bold">{new Date(log.created_at).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}</div>
                          <div className="text-slate-400">{new Date(log.created_at).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome' })}</div>
                        </td>
                        <td className="p-4">
                          <span className={`inline-block text-[11px] font-black px-2.5 py-1 rounded-lg uppercase tracking-wider border ${getActionStyle(log.action)}`}>
                            {log.action}
                          </span>
                        </td>
                        <td className="p-4">
                          {log.product_name ? (
                            <div className="space-y-1">
                              <button
                                type="button"
                                onClick={() => openProductHistoryFor(log.product_id)}
                                className="font-bold text-white hover:text-brand-blue text-left flex items-center gap-1 group"
                                title="Clicca per aprire lo storico 360° di questo prodotto"
                              >
                                <span>{log.product_name}</span>
                                <ArrowUpRight size={14} className="text-brand-blue opacity-70 group-hover:opacity-100" />
                              </button>
                              <div className="flex flex-wrap gap-1.5 text-[11px]">
                                {log.sku && (
                                  <span className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 font-mono text-slate-300">
                                    SKU: {log.sku}
                                  </span>
                                )}
                                {log.pallet_code && (
                                  <span className="px-1.5 py-0.5 rounded bg-brand-blue/15 border border-brand-blue/30 font-mono font-bold text-brand-blue">
                                    {log.pallet_code}
                                  </span>
                                )}
                                {log.client_pallet_number && (
                                  <span className="px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 font-mono text-sky-300">
                                    Rif: {log.client_pallet_number}
                                  </span>
                                )}
                                {log.batch && (
                                  <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 font-mono text-amber-400">
                                    Lotto: {log.batch}
                                  </span>
                                )}
                              </div>
                              {log.customer_name && (
                                <div className="text-[11px] text-slate-400">Cliente: <b className="text-slate-300">{log.customer_name}</b></div>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-1.5 text-xs">
                              {log.pallet_code && (
                                <span className="px-2 py-0.5 rounded bg-brand-blue/15 border border-brand-blue/30 font-mono font-bold text-brand-blue">
                                  {log.pallet_code}
                                </span>
                              )}
                              {log.ddt_number && (
                                <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 font-mono font-bold text-emerald-400">
                                  {log.ddt_number}
                                </span>
                              )}
                              {log.order_code && (
                                <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 font-mono font-bold text-amber-400">
                                  {log.order_code}
                                </span>
                              )}
                              {!log.pallet_code && !log.ddt_number && !log.order_code && (
                                <span className="text-slate-600 text-xs">Sistema / Anagrafica</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="p-4 text-sm text-slate-200 max-w-md leading-relaxed">
                          {log.details}
                        </td>
                        <td className="p-4">
                          <div className="flex flex-col gap-1 text-xs">
                            <span className="inline-flex items-center gap-1.5 font-bold text-white">
                              <User size={13} className="text-brand-blue" /> {log.username}
                            </span>
                            <span className="inline-flex items-center gap-1.5 text-slate-400">
                              {(log.source || '').toLowerCase().includes('zebra') ? (
                                <Smartphone size={13} className="text-emerald-400" />
                              ) : (
                                <Monitor size={13} className="text-purple-400" />
                              )}
                              {log.source}
                            </span>
                          </div>
                        </td>
                        <td className="p-4 text-right">
                          {log.product_id ? (
                            <button
                              type="button"
                              onClick={() => openProductHistoryFor(log.product_id)}
                              className="px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500 text-emerald-400 hover:text-brand-black border border-emerald-500/30 text-xs font-black transition-all inline-flex items-center gap-1.5"
                            >
                              <Package size={14} /> Storico Prodotto
                            </button>
                          ) : log.pallet_code ? (
                            <button
                              type="button"
                              onClick={() => setFilters({ ...filters, search: log.pallet_code })}
                              className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-all"
                            >
                              Filtra {log.pallet_code}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: STORICO & TRACCIABILITA' PRODOTTO A 360°                           */}
        {/* ========================================================================= */}
        {activeTab === 'PRODUCT_HISTORY' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Colonna Sinistra: Selettore Prodotto Ricercabile */}
            <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl flex flex-col max-h-[82vh]">
              <h3 className="text-base font-black text-white mb-3 flex items-center gap-2">
                <Package size={18} className="text-emerald-400" /> Seleziona Prodotto ({filteredProductsList.length})
              </h3>
              <div className="relative mb-3">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                <input
                  type="text"
                  placeholder="Cerca per nome, SKU o cliente..."
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl pl-10 pr-4 py-2.5 text-xs focus:ring-brand-blue"
                />
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {filteredProductsList.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-xs italic">
                    Nessun prodotto trovato.
                  </div>
                ) : filteredProductsList.map(p => {
                  const isSelected = Number(selectedProductId) === Number(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedProductId(p.id)}
                      className={`w-full text-left p-3.5 rounded-2xl border transition-all ${
                        isSelected
                          ? 'bg-emerald-500/15 border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.15)]'
                          : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <span className="font-bold text-white text-sm leading-snug">{p.name}</span>
                        <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-brand-blue shrink-0">
                          {p.sku}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 mt-1 truncate">
                        Cliente: <strong className="text-slate-200">{p.customer_name}</strong>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-slate-800/70 text-[11px]">
                        <span className="text-emerald-400 font-bold">
                          Giacenza: {parseFloat(p.active_stock_qty || 0).toLocaleString('it-IT')} {p.uom}
                        </span>
                        <span className="text-slate-600">•</span>
                        <span className="text-slate-300">
                          {p.total_pallets_ever || 0} bancali tot.
                        </span>
                        <span className="text-slate-600">•</span>
                        <span className="text-amber-400">
                          {p.total_outbound_picks || 0} prelievi
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Colonna Destra: Dossier 360° del Prodotto Selezionato */}
            <div className="lg:col-span-8 flex flex-col gap-5">
              {loadingHistory ? (
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center text-brand-blue font-bold animate-pulse">
                  Ricostruzione storico 360° del prodotto in corso...
                </div>
              ) : !productHistory?.product ? (
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center text-slate-500">
                  Seleziona un prodotto a sinistra per visualizzarne l&apos;intero storico di tracciabilità.
                </div>
              ) : (
                <>
                  {/* Scheda Anagrafica + KPI Prodotto */}
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-5 border-b border-slate-800">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="px-2.5 py-0.5 rounded-lg bg-brand-blue/20 border border-brand-blue/40 text-brand-blue font-mono font-black text-xs">
                            SKU: {productHistory.product.sku}
                          </span>
                          <span className="px-2.5 py-0.5 rounded-lg bg-slate-800 text-slate-300 font-bold text-xs">
                            Cliente: {productHistory.product.customer_name}
                          </span>
                          {productHistory.product.parent_customer_name && (
                            <span className="px-2.5 py-0.5 rounded-lg bg-sky-500/15 text-sky-300 font-bold text-xs">
                              Madre: {productHistory.product.parent_customer_name}
                            </span>
                          )}
                        </div>
                        <h2 className="text-2xl font-black text-white">{productHistory.product.name}</h2>
                        <div className="text-xs text-slate-400 mt-1">
                          Unità di misura: <b className="text-white">{productHistory.product.uom}</b> • Pezzi per scatola: <b className="text-white">{productHistory.product.units_per_box || 1}</b> • Lotti tracciati: <b className="text-amber-400">{productHistory.product.kpis?.uniqueBatchesCount || 0}</b>
                        </div>
                      </div>
                    </div>

                    {/* 5 KPI Prodotto */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-5">
                      <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800">
                        <div className="text-[10px] font-bold uppercase text-emerald-400">Giacenza Attiva</div>
                        <div className="text-xl font-black text-emerald-400 mt-0.5">
                          {(productHistory.product.kpis?.currentStockQty || 0).toLocaleString('it-IT')}
                        </div>
                        <div className="text-[10px] text-slate-500">{productHistory.product.uom} in magazzino</div>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800">
                        <div className="text-[10px] font-bold uppercase text-amber-400">In Zona Carico</div>
                        <div className="text-xl font-black text-amber-400 mt-0.5">
                          {(productHistory.product.kpis?.loadingZoneQty || 0).toLocaleString('it-IT')}
                        </div>
                        <div className="text-[10px] text-slate-500">Prelevati in attesa uscita</div>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800">
                        <div className="text-[10px] font-bold uppercase text-brand-blue">Totale Prelevato</div>
                        <div className="text-xl font-black text-brand-blue mt-0.5">
                          {(productHistory.product.kpis?.totalPickedQty || 0).toLocaleString('it-IT')}
                        </div>
                        <div className="text-[10px] text-slate-500">{productHistory.outboundItems?.length || 0} righe d&apos;ordine</div>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800">
                        <div className="text-[10px] font-bold uppercase text-white">Bancali Attivi</div>
                        <div className="text-xl font-black text-white mt-0.5">
                          {productHistory.product.kpis?.activePalletsCount || 0}
                        </div>
                        <div className="text-[10px] text-slate-500">In stock attualmente</div>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800">
                        <div className="text-[10px] font-bold uppercase text-slate-400">Bancali Storici</div>
                        <div className="text-xl font-black text-slate-300 mt-0.5">
                          {productHistory.product.kpis?.totalPalletsEver || 0}
                        </div>
                        <div className="text-[10px] text-slate-500">{productHistory.product.kpis?.shippedPalletsCount || 0} già spediti</div>
                      </div>
                    </div>
                  </div>

                  {/* Selettore Sotto-Vista: Timeline 360° vs Bancali & Lotti vs Prelievi Outbound */}
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-5 pb-4 border-b border-slate-800">
                      <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 gap-1 text-xs font-bold">
                        <button
                          type="button"
                          onClick={() => setHistorySubView('TIMELINE')}
                          className={`px-3.5 py-2 rounded-lg transition-all ${
                            historySubView === 'TIMELINE' ? 'bg-brand-blue text-brand-black font-black' : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          Timeline Cronologica ({productHistory.timeline?.length || 0})
                        </button>
                        <button
                          type="button"
                          onClick={() => setHistorySubView('PALLETS')}
                          className={`px-3.5 py-2 rounded-lg transition-all ${
                            historySubView === 'PALLETS' ? 'bg-brand-blue text-brand-black font-black' : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          Tutti i Bancali & Lotti ({productHistory.pallets?.length || 0})
                        </button>
                        <button
                          type="button"
                          onClick={() => setHistorySubView('OUTBOUND')}
                          className={`px-3.5 py-2 rounded-lg transition-all ${
                            historySubView === 'OUTBOUND' ? 'bg-brand-blue text-brand-black font-black' : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          Storico Prelievi & Uscite ({productHistory.outboundItems?.length || 0})
                        </button>
                      </div>

                      {historySubView === 'TIMELINE' && (
                        <div className="flex flex-wrap gap-1 text-[11px] font-bold">
                          {[
                            { key: 'ALL', label: 'Tutti' },
                            { key: 'INBOUND_PALLET', label: 'Ingressi Bancali' },
                            { key: 'DDT', label: 'Spunte & Discrepanze DDT' },
                            { key: 'OUTBOUND_PICK', label: 'Prelievi & Uscite' },
                            { key: 'AUDIT_LOG', label: 'Movimenti & Log' }
                          ].map(f => (
                            <button
                              key={f.key}
                              type="button"
                              onClick={() => setTimelineFilter(f.key)}
                              className={`px-2.5 py-1 rounded-lg border transition-colors ${
                                timelineFilter === f.key
                                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                              }`}
                            >
                              {f.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* VISTA 1: TIMELINE CRONOLOGICA 360° */}
                    {historySubView === 'TIMELINE' && (
                      <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-2">
                        {filteredTimeline.length === 0 ? (
                          <div className="p-8 text-center text-slate-500 italic text-sm">
                            Nessun evento registrato per questo filtro.
                          </div>
                        ) : filteredTimeline.map(ev => (
                          <div key={ev.id} className="p-4 rounded-2xl bg-slate-950/90 border border-slate-800 hover:border-slate-700 transition-all flex flex-col sm:flex-row justify-between gap-3">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                                  ev.color === 'emerald'
                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                    : ev.color === 'amber'
                                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                    : ev.color === 'purple'
                                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                    : ev.color === 'sky' || ev.color === 'blue'
                                    ? 'bg-brand-blue/20 text-brand-blue border border-brand-blue/30'
                                    : 'bg-slate-800 text-slate-300 border border-slate-700'
                                }`}>
                                  {ev.badge}
                                </span>
                                <span className="font-bold text-white text-sm">{ev.title}</span>
                              </div>
                              <p className="text-xs text-slate-300 leading-relaxed">{ev.description}</p>
                            </div>
                            <div className="text-right font-mono text-xs text-brand-blue whitespace-nowrap shrink-0">
                              <div>{new Date(ev.timestamp).toLocaleDateString('it-IT')}</div>
                              <div className="text-slate-500">{new Date(ev.timestamp).toLocaleTimeString('it-IT')}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* VISTA 2: TUTTI I BANCALI & LOTTI DEL PRODOTTO */}
                    {historySubView === 'PALLETS' && (
                      <div className="overflow-x-auto max-h-[55vh]">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-950 text-slate-400 uppercase sticky top-0">
                            <tr>
                              <th className="p-3">Cod. Bancale</th>
                              <th className="p-3">Rif. Paletta Cl.</th>
                              <th className="p-3">Lotto</th>
                              <th className="p-3">Scadenza</th>
                              <th className="p-3 text-right">Q.tà Residua</th>
                              <th className="p-3">Posizione</th>
                              <th className="p-3">Stato</th>
                              <th className="p-3">Ingresso / Uscita</th>
                            </tr>
                          </thead>
                          <tbody className="text-slate-200">
                            {(productHistory.pallets || []).map(p => (
                              <tr key={p.id} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                                <td className="p-3 font-mono font-bold text-brand-blue">{p.pallet_code}</td>
                                <td className="p-3 font-mono text-sky-300">{p.client_pallet_number || '-'}</td>
                                <td className="p-3 font-mono text-amber-400">{p.batch || '-'}</td>
                                <td className="p-3">{p.expiration_date ? new Date(p.expiration_date).toLocaleDateString('it-IT') : '-'}</td>
                                <td className="p-3 text-right font-black text-white">{p.quantity} {p.pallet_uom || productHistory.product.uom}</td>
                                <td className="p-3 font-bold">{p.location || 'IN ATTESA'}</td>
                                <td className="p-3">
                                  <span className={`px-2 py-0.5 rounded font-bold text-[10px] uppercase ${
                                    p.status === 'STOCKED'
                                      ? 'bg-emerald-500/20 text-emerald-400'
                                      : p.status === 'SHIPPED'
                                      ? 'bg-slate-800 text-slate-400'
                                      : 'bg-amber-500/20 text-amber-400'
                                  }`}>
                                    {p.status}
                                  </span>
                                </td>
                                <td className="p-3 font-mono text-[11px] text-slate-400">
                                  <div>IN: {new Date(p.created_at).toLocaleDateString('it-IT')}</div>
                                  {p.shipped_at && <div className="text-sky-400">OUT: {new Date(p.shipped_at).toLocaleDateString('it-IT')}</div>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* VISTA 3: STORICO PRELIEVI & ORDINI OUTBOUND */}
                    {historySubView === 'OUTBOUND' && (
                      <div className="overflow-x-auto max-h-[55vh]">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-950 text-slate-400 uppercase sticky top-0">
                            <tr>
                              <th className="p-3">Ordine / DDT Cl.</th>
                              <th className="p-3">Bancale & Lotto</th>
                              <th className="p-3 text-right">Q.tà Richiesta</th>
                              <th className="p-3 text-right">Q.tà Prelevata</th>
                              <th className="p-3">Operatore Picking</th>
                              <th className="p-3">Stato & Date</th>
                            </tr>
                          </thead>
                          <tbody className="text-slate-200">
                            {(productHistory.outboundItems || []).length === 0 ? (
                              <tr>
                                <td colSpan="6" className="p-8 text-center text-slate-500 italic">
                                  Nessun prelievo registrato per questo prodotto.
                                </td>
                              </tr>
                            ) : (productHistory.outboundItems || []).map(oi => (
                              <tr key={oi.id} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                                <td className="p-3">
                                  <div className="font-mono font-bold text-brand-blue">{oi.order_code}</div>
                                  {oi.client_ddt && <div className="text-[11px] text-slate-400">DDT: {oi.client_ddt}</div>}
                                </td>
                                <td className="p-3">
                                  <div className="font-mono font-bold text-white">{oi.pallet_code}</div>
                                  {oi.batch && <div className="font-mono text-[11px] text-amber-400">Lotto: {oi.batch}</div>}
                                </td>
                                <td className="p-3 text-right font-bold">{oi.quantity_required}</td>
                                <td className="p-3 text-right font-black text-emerald-400">{oi.quantity_picked}</td>
                                <td className="p-3">
                                  <div>Picker: <b>{oi.picking_operator || '-'}</b></div>
                                  {oi.shipped_by && <div className="text-[11px] text-slate-400">Conferma: {oi.shipped_by}</div>}
                                </td>
                                <td className="p-3 text-[11px] font-mono">
                                  <span className={`px-2 py-0.5 rounded font-bold uppercase ${
                                    oi.order_status === 'SHIPPED' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                                  }`}>
                                    {oi.order_status}
                                  </span>
                                  {oi.picked_at && <div className="text-slate-400 mt-1">Pick: {new Date(oi.picked_at).toLocaleString('it-IT')}</div>}
                                  {oi.shipped_at && <div className="text-emerald-400">Out: {new Date(oi.shipped_at).toLocaleString('it-IT')}</div>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuditLogs;
