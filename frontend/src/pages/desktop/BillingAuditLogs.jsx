import React, { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import {
  FileSpreadsheet, Search, RefreshCw, Loader2, Filter, Clock, User, Building2, Tag
} from 'lucide-react';
import FinanceAdminNav from '../../components/FinanceAdminNav';

const ACTION_BADGES = {
  CREATE_PROFORMA: { label: 'Proforma Emessa', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  DELETE_PROFORMA: { label: 'Proforma Eliminata', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  MARK_INVOICE_PAID: { label: 'Proforma Pagata', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  MARK_INVOICE_UNPAID: { label: 'Proforma Da Pagare', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  UPDATE_CUSTOMER_TARIFFS: { label: 'Listino Cliente Salvato', cls: 'bg-brand-blue/15 text-brand-blue border-brand-blue/30' },
  BULK_PERCENT_ADJUST: { label: 'Variazione % Listino', cls: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' },
  APPLY_TARIFF_PLAN: { label: 'Assegnazione Listino', cls: 'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  RESET_TARIFF_PLAN: { label: 'Ripristino Listino', cls: 'bg-slate-700/60 text-slate-300 border-slate-600' },
  CREATE_TARIFF_PLAN: { label: 'Nuovo Listino Globale', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  UPDATE_TARIFF_PLAN: { label: 'Listino Globale Modificato', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  DELETE_TARIFF_PLAN: { label: 'Listino Globale Eliminato', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  CREATE_BILLING_RULE: { label: 'Nuovo Servizio/Flag', cls: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' },
  UPDATE_BILLING_RULE: { label: 'Regola Tariffa Modificata', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  DELETE_BILLING_RULE: { label: 'Regola Tariffa Eliminata', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  CHANGE_PALLET_TARIFF: { label: 'Cambio Listino Paletta', cls: 'bg-teal-500/15 text-teal-300 border-teal-500/30' },
  PREBILLING_DISCOUNT: { label: 'Sconto Pre-Fatturazione', cls: 'bg-pink-500/15 text-pink-300 border-pink-500/30' },
  PREBILLING_MANUAL_ITEM: { label: 'Voce Manuale Fattura', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  PREBILLING_PRICE_EDIT: { label: 'Modifica Prezzo Fattura', cls: 'bg-orange-500/15 text-orange-300 border-orange-500/30' }
};

const BillingAuditLogs = () => {
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [expandedId, setExpandedId] = useState(null);

  const getToken = () => localStorage.getItem('maglite_token');

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/billing/audit-logs?limit=500`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setLogs(res.data || []);
    } catch (err) {
      console.error('Errore fetch billing audit logs:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    const socket = io(`http://${window.location.hostname}:3000`);
    const onRefresh = () => fetchLogs();
    socket.on('billing_updated', onRefresh);
    return () => {
      socket.off('billing_updated', onRefresh);
      socket.disconnect();
    };
  }, []);

  const distinctActions = useMemo(() => {
    const s = new Set(logs.map(l => l.action).filter(Boolean));
    return Array.from(s).sort();
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter(l => {
      if (actionFilter !== 'ALL' && l.action !== actionFilter) return false;
      if (!q) return true;
      return (
        String(l.details || '').toLowerCase().includes(q) ||
        String(l.customer_name || '').toLowerCase().includes(q) ||
        String(l.entity_ref || '').toLowerCase().includes(q) ||
        String(l.username || '').toLowerCase().includes(q) ||
        String(l.action || '').toLowerCase().includes(q)
      );
    });
  }, [logs, search, actionFilter]);

  const parseMeta = (raw) => {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  };

  return (
    <div className="max-w-7xl mx-auto animate-fade-in-up pb-12 px-2 sm:px-0">
      <FinanceAdminNav />

      <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-brand-white tracking-tight flex items-center gap-3">
            <FileSpreadsheet className="text-emerald-400" size={30} />
            Storico Fatturazioni & Listini
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            Registro dedicato di ogni operazione economica: sconti applicati, variazioni prezzi o %, cambio listini, regole e proforme emesse/pagate.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchLogs}
          className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-bold text-xs flex items-center gap-2 border border-slate-700 self-start md:self-auto"
        >
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} /> Aggiorna
        </button>
      </div>

      {/* Filtri */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 mb-5 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-3 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Cerca per cliente, utente, riferimento proforma o descrizione modifica..."
            className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:border-brand-blue outline-none"
          />
        </div>
        <div className="sm:w-64 relative">
          <Filter size={15} className="absolute left-3.5 top-3 text-slate-500 pointer-events-none" />
          <select
            value={actionFilter}
            onChange={e => setActionFilter(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:border-brand-blue outline-none"
          >
            <option value="ALL">Tutte le Azioni ({logs.length})</option>
            {distinctActions.map(a => (
              <option key={a} value={a}>{ACTION_BADGES[a]?.label || a}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabella / Lista */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        {isLoading ? (
          <div className="py-16 flex flex-col items-center justify-center text-brand-blue">
            <Loader2 className="animate-spin mb-2" size={28} />
            <span className="text-xs font-bold">Caricamento storico fatturazioni...</span>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="py-14 text-center text-slate-500 text-sm">
            Nessuna registrazione trovata nel registro fatturazione per i filtri selezionati.
          </div>
        ) : (
          <div className="divide-y divide-slate-800/80">
            {filteredLogs.map(log => {
              const badge = ACTION_BADGES[log.action] || {
                label: log.action,
                cls: 'bg-slate-800 text-slate-300 border-slate-700'
              };
              const meta = parseMeta(log.metadata);
              const isExpanded = expandedId === log.id;

              return (
                <div key={log.id} className="p-4 hover:bg-slate-800/35 transition-colors">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5">
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-lg text-[11px] font-black border ${badge.cls}`}>
                          {badge.label}
                        </span>
                        {log.customer_name && (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-200 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                            <Building2 size={11} className="text-brand-blue" /> {log.customer_name}
                          </span>
                        )}
                        {log.entity_ref && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-mono text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                            <Tag size={10} /> {log.entity_ref}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-100 leading-snug">{log.details}</p>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 text-xs text-slate-400">
                      <span className="inline-flex items-center gap-1 font-semibold text-slate-300">
                        <User size={12} className="text-slate-500" /> {log.username || 'Sistema'}
                      </span>
                      <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                        <Clock size={12} className="text-slate-500" />
                        {log.created_at ? new Date(log.created_at).toLocaleString('it-IT') : '-'}
                      </span>
                      {meta && (
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : log.id)}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[11px] font-bold"
                        >
                          {isExpanded ? 'Nascondi' : 'Dettagli'}
                        </button>
                      )}
                    </div>
                  </div>

                  {isExpanded && meta && (
                    <pre className="mt-3 p-3 bg-slate-950 border border-slate-800 rounded-xl text-[11px] font-mono text-slate-300 overflow-x-auto">
                      {JSON.stringify(meta, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default BillingAuditLogs;
