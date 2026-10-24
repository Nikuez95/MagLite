import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { io } from 'socket.io-client';
import {
  Activity,
  Package,
  Database,
  Smartphone,
  Monitor,
  CheckCircle,
  XCircle,
  Loader2,
  User,
  PackagePlus,
  PackageMinus,
  AlertTriangle,
  Flame,
  Truck,
  Users,
  Box,
  Search,
  ArrowUpRight,
  Clock,
  MapPin
} from 'lucide-react';

const Dashboard = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    total_locations: 0,
    occupied_locations: 0,
    saturation_percentage: 0,
    active_pallets: 0,
    pending_stow: 0,
    loading_zone_pallets: 0,
    active_outbound: 0,
    ready_outbound: 0,
    expired_pallets: 0,
    expiring_30d_pallets: 0,
    total_customers: 0,
    total_products: 0,
    recent_logs: []
  });
  const [socketStatus, setSocketStatus] = useState('CONNECTING');
  const [logFilter, setLogFilter] = useState('ALL'); // ALL, ZEBRA, GESTIONALE
  const [logSearch, setLogSearch] = useState('');
  
  const [historyModal, setHistoryModal] = useState(null);
  const [historyData, setHistoryData] = useState(null);

  const getToken = () => localStorage.getItem('maglite_token');

  const fetchStats = async () => {
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/dashboard/stats`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setStats(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchStats();
    
    const socket = io(`http://${window.location.hostname}:3000`);
    
    socket.on('connect', () => setSocketStatus('CONNECTED'));
    socket.on('disconnect', () => setSocketStatus('DISCONNECTED'));
    socket.on('connect_error', () => setSocketStatus('DISCONNECTED'));

    socket.on('dashboard_update', () => {
      fetchStats();
    });
    socket.on('stow_updated', () => {
      fetchStats();
    });

    return () => socket.disconnect();
  }, []);

  const openHistory = async (code) => {
    setHistoryModal(code);
    setHistoryData(null);
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/pallets/${code}/history`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setHistoryData(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const filteredLogs = (stats.recent_logs || []).filter((log) => {
    const isZebra = String(log.source || '').toUpperCase() === 'ZEBRA';
    if (logFilter === 'ZEBRA' && !isZebra) return false;
    if (logFilter === 'GESTIONALE' && isZebra) return false;
    if (logSearch.trim()) {
      const q = logSearch.toLowerCase();
      return (
        String(log.details || '').toLowerCase().includes(q) ||
        String(log.action || '').toLowerCase().includes(q) ||
        String(log.username || '').toLowerCase().includes(q) ||
        String(log.product_name || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="flex-1 overflow-y-auto bg-brand-black">
      <div className="max-w-7xl mx-auto animate-fade-in-up space-y-6">
        
        {/* Top Hero Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-900/70 border border-slate-800 rounded-3xl p-6 shadow-xl">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-brand-blue/15 border border-brand-blue/30 flex items-center justify-center text-brand-blue shrink-0">
              <Activity size={26} />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black text-brand-white tracking-tight">
                Control Center Operativo
              </h1>
              <p className="text-slate-400 text-sm">
                Panoramica in tempo reale su scaffali, palette, spedizioni e scadenze di magazzino.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => navigate('/desktop/inbound')}
              className="flex items-center gap-2 px-4 py-2.5 bg-brand-blue text-brand-black font-bold rounded-xl hover:bg-sky-400 transition-all shadow-lg text-sm"
            >
              <PackagePlus size={18} />
              Carica Merce (In)
            </button>
            <button
              onClick={() => navigate('/desktop/outbound')}
              className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-brand-white font-bold rounded-xl border border-slate-700 transition-all text-sm"
            >
              <PackageMinus size={18} className="text-brand-blue" />
              Nuova Spedizione (Out)
            </button>
            <button
              onClick={() => navigate('/desktop/inventory')}
              className="flex items-center gap-2 px-4 py-2.5 bg-slate-950 hover:bg-slate-800 text-slate-300 font-bold rounded-xl border border-slate-800 transition-all text-sm"
            >
              <Box size={18} className="text-brand-blue" />
              Stampa Inventario
            </button>
          </div>
        </div>

        {/* 4 Primary Interactive KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          
          {/* 1. Saturazione Scaffali */}
          <div
            onClick={() => navigate('/desktop/locations')}
            className="bg-slate-900 border border-slate-800 hover:border-brand-blue/50 rounded-3xl p-6 shadow-xl flex flex-col justify-between cursor-pointer transition-all group"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Database size={15} className="text-brand-blue" /> Saturazione Scaffali
                </span>
                <ArrowUpRight size={16} className="text-slate-600 group-hover:text-brand-blue transition-colors" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-black text-brand-white">{stats.saturation_percentage}%</span>
                <span className="text-xs text-slate-400 font-bold">
                  ({stats.occupied_locations}/{stats.total_locations} pos.)
                </span>
              </div>
            </div>
            <div className="mt-5">
              <div className="h-2.5 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                <div 
                  className="h-full bg-gradient-to-r from-brand-blue to-sky-300 rounded-full transition-all duration-700" 
                  style={{ width: `${Math.min(100, stats.saturation_percentage)}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-2 font-medium">
                {Math.max(0, stats.total_locations - stats.occupied_locations)} posizioni libere disponibili
              </p>
            </div>
          </div>

          {/* 2. Palette in Giacenza & Stivaggio */}
          <div
            onClick={() => navigate('/desktop/products')}
            className="bg-slate-900 border border-slate-800 hover:border-brand-blue/50 rounded-3xl p-6 shadow-xl flex flex-col justify-between cursor-pointer transition-all group"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Package size={15} className="text-brand-blue" /> Palette in Giacenza
                </span>
                <ArrowUpRight size={16} className="text-slate-600 group-hover:text-brand-blue transition-colors" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-black text-brand-white">{stats.active_pallets || 0}</span>
                <span className="text-xs text-slate-400 font-bold">palette attive</span>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {stats.pending_stow > 0 ? (
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                  ⏳ {stats.pending_stow} da stivare
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  ✓ Tutte stivate
                </span>
              )}
              {stats.loading_zone_pallets > 0 && (
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-sky-500/15 text-sky-300 border border-sky-500/30">
                  📦 {stats.loading_zone_pallets} in Zona Carico
                </span>
              )}
            </div>
          </div>

          {/* 3. Spedizioni Outbound & Picking */}
          <div
            onClick={() => navigate('/desktop/outbound')}
            className="bg-slate-900 border border-slate-800 hover:border-brand-blue/50 rounded-3xl p-6 shadow-xl flex flex-col justify-between cursor-pointer transition-all group"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Truck size={15} className="text-brand-blue" /> Spedizioni Attive
                </span>
                <ArrowUpRight size={16} className="text-slate-600 group-hover:text-brand-blue transition-colors" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-black text-brand-white">{stats.active_outbound || 0}</span>
                <span className="text-xs text-slate-400 font-bold">ordini aperti</span>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {stats.ready_outbound > 0 ? (
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 animate-pulse">
                  ✓ {stats.ready_outbound} pronte da confermare
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-950 text-slate-400 border border-slate-800">
                  Nessuna in attesa conferma
                </span>
              )}
            </div>
          </div>

          {/* 4. Monitor Scadenze (FEFO) */}
          <div
            onClick={() => navigate('/desktop/inventory')}
            className={`border rounded-3xl p-6 shadow-xl flex flex-col justify-between cursor-pointer transition-all group ${
              stats.expired_pallets > 0
                ? 'bg-rose-950/20 border-rose-500/40 hover:border-rose-500'
                : stats.expiring_30d_pallets > 0
                ? 'bg-amber-950/15 border-amber-500/40 hover:border-amber-500'
                : 'bg-slate-900 border-slate-800 hover:border-brand-blue/50'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <Clock size={15} className={stats.expired_pallets > 0 ? 'text-rose-400' : 'text-amber-400'} /> Monitor Scadenze
                </span>
                <ArrowUpRight size={16} className="text-slate-500 group-hover:text-brand-white transition-colors" />
              </div>
              <div className="flex items-baseline gap-3">
                <div>
                  <span className={`text-4xl font-black ${stats.expired_pallets > 0 ? 'text-rose-400' : 'text-brand-white'}`}>
                    {stats.expired_pallets || 0}
                  </span>
                  <span className="text-xs text-slate-400 font-bold ml-1.5">scaduti</span>
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {stats.expiring_30d_pallets > 0 ? (
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                  <AlertTriangle size={12} /> {stats.expiring_30d_pallets} in scadenza ≤ 30gg
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  ✓ Nessuna urgenza a 30gg
                </span>
              )}
            </div>
          </div>

        </div>

        {/* Live Audit Log + Side Summary */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-col">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
              <div className="flex items-center gap-2.5">
                <Activity className="text-brand-blue" size={20} />
                <h2 className="text-lg font-extrabold text-brand-white">Live Audit Log</h2>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                  {filteredLogs.length}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search size={14} className="text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={logSearch}
                    onChange={(e) => setLogSearch(e.target.value)}
                    placeholder="Filtra log..."
                    className="bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-brand-white focus:border-brand-blue focus:ring-0 w-36"
                  />
                </div>
                <div className="flex bg-slate-950 p-0.5 rounded-xl border border-slate-800 text-xs font-bold">
                  {[
                    { id: 'ALL', label: 'Tutti' },
                    { id: 'ZEBRA', label: 'Zebra' },
                    { id: 'GESTIONALE', label: 'Ufficio' }
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setLogFilter(tab.id)}
                      className={`px-2.5 py-1 rounded-lg transition-colors ${
                        logFilter === tab.id ? 'bg-brand-blue text-brand-black' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="max-h-[420px] overflow-y-auto pr-2 space-y-2.5">
              {filteredLogs.length === 0 ? (
                <div className="text-center p-8 text-slate-500 italic text-sm">Nessuna operazione trovata con i filtri selezionati.</div>
              ) : filteredLogs.map(log => {
                const isZebra = String(log.source || '').toUpperCase() === 'ZEBRA';
                return (
                  <div key={log.id} className="bg-slate-950/90 border border-slate-800/80 hover:border-slate-700 rounded-2xl p-3.5 flex items-center justify-between gap-4 transition-colors">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded uppercase tracking-wider bg-slate-800 text-brand-blue border border-slate-700">
                          {log.action}
                        </span>
                        <span className="text-slate-500 text-xs font-mono">
                          {new Date(log.created_at).toLocaleString('it-IT')}
                        </span>
                        <span className="text-slate-400 text-xs flex items-center gap-1 font-semibold">
                          • <User size={12} className="text-brand-blue" /> {log.username}
                        </span>
                      </div>
                      <p className="text-brand-white text-sm font-medium">
                        {log.product_name && log.pallet_code ? (
                          log.details.split(new RegExp(`(paletta ${log.pallet_code})`, 'i')).map((part, idx) => {
                            if (part.toLowerCase() === `paletta ${log.pallet_code.toLowerCase()}`) {
                              return (
                                <button
                                  key={idx}
                                  onClick={() => openHistory(log.pallet_code)}
                                  className="text-brand-blue font-bold hover:text-sky-300 transition-colors underline underline-offset-4 decoration-brand-blue/40"
                                  title={`Apri storico ${log.pallet_code}`}
                                >
                                  {log.pallet_code} ({log.product_name})
                                </button>
                              );
                            }
                            return <span key={idx}>{part}</span>;
                          })
                        ) : (
                          log.details
                        )}
                      </p>
                    </div>
                    <div className="shrink-0">
                      {isZebra ? (
                        <div className="flex items-center gap-1.5 bg-amber-500/10 text-amber-400 border border-amber-500/30 px-2.5 py-1 rounded-xl">
                          <Smartphone size={14} />
                          <span className="text-[10px] font-extrabold uppercase tracking-wider">Zebra</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 bg-brand-blue/10 text-brand-blue border border-brand-blue/30 px-2.5 py-1 rounded-xl">
                          <Monitor size={14} />
                          <span className="text-[10px] font-extrabold uppercase tracking-wider">PC</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Anagrafiche & Stato Sistema */}
          <div className="flex flex-col gap-5">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
              <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-400 mb-4">Anagrafiche & Sistema</h3>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => navigate('/desktop/customers')}
                  className="bg-slate-950 border border-slate-800 hover:border-brand-blue/50 rounded-2xl p-4 text-left transition-all"
                >
                  <Users size={18} className="text-brand-blue mb-2" />
                  <div className="text-2xl font-black text-brand-white">{stats.total_customers || 0}</div>
                  <div className="text-xs text-slate-400 font-semibold">Clienti Attivi</div>
                </button>
                <button
                  onClick={() => navigate('/desktop/products')}
                  className="bg-slate-950 border border-slate-800 hover:border-brand-blue/50 rounded-2xl p-4 text-left transition-all"
                >
                  <Box size={18} className="text-brand-blue mb-2" />
                  <div className="text-2xl font-black text-brand-white">{stats.total_products || 0}</div>
                  <div className="text-xs text-slate-400 font-semibold">Articoli Censiti</div>
                </button>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl flex-1 flex flex-col justify-center items-center text-center">
              {socketStatus === 'CONNECTING' && (
                <>
                  <Loader2 size={44} className="text-amber-500 animate-spin mb-3" />
                  <h3 className="text-base font-bold text-brand-white">Connessione in corso...</h3>
                  <p className="text-amber-500 text-xs font-bold mt-1">Sincronizzazione WebSockets</p>
                </>
              )}

              {socketStatus === 'CONNECTED' && (
                <>
                  <CheckCircle size={44} className="text-emerald-400 mb-3 drop-shadow-[0_0_15px_rgba(34,197,94,0.35)]" />
                  <h3 className="text-base font-bold text-brand-white">Sincronizzazione Real-Time Attiva</h3>
                  <p className="text-slate-400 text-xs mt-1 max-w-xs">
                    Tutti gli stivaggi, spostamenti e prelievi effettuati sui terminali Zebra aggiornano automaticamente il gestionale.
                  </p>
                </>
              )}

              {socketStatus === 'DISCONNECTED' && (
                <>
                  <XCircle size={44} className="text-rose-500 mb-3 drop-shadow-[0_0_15px_rgba(244,63,94,0.35)]" />
                  <h3 className="text-base font-bold text-brand-white">Connessione Real-Time Assente</h3>
                  <p className="text-rose-400 text-xs font-bold mt-1">Verifica la rete o il server backend</p>
                </>
              )}
            </div>
          </div>
        </div>

      </div>
      
      {/* Modal Storico Paletta */}
      {historyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/90 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-lg w-full shadow-2xl relative animate-fade-in-up">
            <button 
              onClick={() => setHistoryModal(null)}
              className="absolute top-6 right-6 text-slate-500 hover:text-brand-white transition-colors"
            >
              <XCircle size={24} />
            </button>
            <h2 className="text-2xl font-bold text-brand-white mb-2">Storia Paletta</h2>
            {historyData ? (
              <>
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 mb-6 mt-4 shadow-inner">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-mono text-brand-blue font-bold text-lg">{historyData.pallet.pallet_code}</p>
                      <p className="text-brand-white font-bold">{historyData.pallet.product_name}</p>
                    </div>
                    <span className="bg-slate-800 text-brand-white px-3 py-1 rounded-lg text-sm font-bold border border-slate-700">
                      {historyData.pallet.location || 'IN ATTESA'}
                    </span>
                  </div>
                  <p className="text-slate-400 text-sm">Lotto: <span className="text-slate-300 font-bold">{historyData.pallet.batch || '-'}</span> | Cliente: <span className="text-slate-300 font-bold">{historyData.pallet.customer_name}</span></p>
                </div>
                
                <h3 className="text-slate-400 font-bold uppercase tracking-wider text-xs mb-4">Cronologia Eventi</h3>
                <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-slate-700 before:to-transparent">
                  {historyData.history.map((h, i) => (
                    <div key={h.id} className="relative flex items-center justify-between group">
                      <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-slate-900 bg-brand-blue text-brand-black shadow shrink-0 z-10 relative">
                        {i === 0 ? <CheckCircle size={16} /> : <Activity size={16} />}
                      </div>
                      <div className="w-[calc(100%-4rem)] p-4 rounded-xl border border-slate-800 bg-slate-950 shadow z-10 relative">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-bold text-xs uppercase tracking-wider text-slate-400">{h.action}</span>
                          <time className="font-mono text-brand-blue text-xs">{new Date(h.created_at).toLocaleString('it-IT')}</time>
                        </div>
                        <div className="text-brand-white text-sm font-medium mb-3">{h.details}</div>
                        <div className="flex gap-2">
                          <div className="text-slate-500 text-xs flex items-center gap-1 bg-slate-900 px-2 py-1 rounded border border-slate-800"><User size={12}/> {h.username}</div>
                          <div className="text-slate-500 text-xs flex items-center gap-1 bg-slate-900 px-2 py-1 rounded border border-slate-800"><Monitor size={12}/> {h.source}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex justify-center p-12">
                <Loader2 size={48} className="text-brand-blue animate-spin" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
