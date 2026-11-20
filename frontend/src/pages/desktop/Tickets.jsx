import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import {
  Ticket,
  Plus,
  Search,
  Send,
  CheckCircle2,
  Clock,
  AlertTriangle,
  HelpCircle,
  XCircle,
  Wrench,
  MessageSquare,
  ShieldCheck,
  Trash2,
  X,
  User,
  Maximize2,
  Minimize2,
  RotateCcw,
  Tag
} from 'lucide-react';
import { appAlert, appConfirm, appToast } from '../../utils/alerts';
import { getCurrentUser } from '../../utils/permissions';

const STATUS_CONFIG = {
  OPEN: { label: 'Aperto', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30', Icon: AlertTriangle },
  IN_PROGRESS: { label: 'In Corso', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30', Icon: Wrench },
  WAITING_INFO: { label: 'In Attesa Info', cls: 'bg-purple-500/15 text-purple-300 border-purple-500/30', Icon: HelpCircle },
  RESOLVED: { label: 'Sistemato', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', Icon: CheckCircle2 },
  CLOSED: { label: 'Chiuso', cls: 'bg-slate-700/40 text-slate-300 border-slate-600/40', Icon: CheckCircle2 },
  REJECTED: { label: 'Respinto', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30', Icon: XCircle }
};

const PRIORITY_CONFIG = {
  CRITICAL: { label: 'Critica', cls: 'bg-rose-500/20 text-rose-300 border-rose-500/40', bar: 'bg-rose-500' },
  HIGH: { label: 'Alta', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40', bar: 'bg-amber-500' },
  MEDIUM: { label: 'Media', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30', bar: 'bg-sky-500' },
  LOW: { label: 'Bassa', cls: 'bg-slate-800 text-slate-400 border-slate-700', bar: 'bg-slate-600' }
};

const CATEGORIES = [
  { value: 'BUG', label: 'Bug / Errore' },
  { value: 'ZEBRA', label: 'Terminale Zebra' },
  { value: 'UX', label: 'UX / Usabilità' },
  { value: 'PERFORMANCE', label: 'Lentezza / Performance' },
  { value: 'FEATURE', label: 'Nuova Funzione' },
  { value: 'ALTRO', label: 'Altro' }
];

const AREAS = [
  'Picking Zebra',
  'Spunta Entrata Zebra',
  'Handling / Stivaggio',
  'Spedizioni (Outbound)',
  'Nuova Merce (Inbound)',
  'Inventario & Stock',
  'Mappa Magazzino',
  'Fatturazione & Finanza',
  'TMS (Trasporti)',
  'Altro / Generale'
];

const Tickets = () => {
  const user = getCurrentUser();
  const isEngineer =
    user?.role === 'developer' ||
    String(user?.role_name || '').toLowerCase().includes('software engineer');

  const [tickets, setTickets] = useState([]);
  const [stats, setStats] = useState({ total: 0, open: 0, in_progress: 0, waiting_info: 0, resolved: 0, critical_open: 0 });
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState('ALL');
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [onlyMine, setOnlyMine] = useState(false);
  const [search, setSearch] = useState('');

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [expandedDetail, setExpandedDetail] = useState(false);

  const [replyMessage, setReplyMessage] = useState('');
  const [replyStatus, setReplyStatus] = useState('');
  const [resolutionNotesInput, setResolutionNotesInput] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTicket, setNewTicket] = useState({
    title: '',
    category: 'BUG',
    priority: 'MEDIUM',
    area: 'Picking Zebra',
    description: ''
  });

  const detailScrollRef = useRef(null);
  const getToken = () => localStorage.getItem('maglite_token');

  const fetchTickets = useCallback(async () => {
    try {
      const res = await axios.get('/api/tickets', {
        params: {
          status: statusFilter,
          priority: priorityFilter,
          category: categoryFilter,
          mine: onlyMine ? 'true' : 'false',
          search
        },
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      const list = res.data?.tickets || [];
      setTickets(list);
      setStats(res.data?.stats || {});
      setSelectedId((prev) => {
        if (prev && list.some(t => t.id === prev)) return prev;
        return list.length > 0 ? list[0].id : null;
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, priorityFilter, categoryFilter, onlyMine, search]);

  const fetchDetail = useCallback(async (ticketId) => {
    if (!ticketId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    try {
      const res = await axios.get(`/api/tickets/${ticketId}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setDetail(res.data);
      setReplyStatus(res.data?.ticket?.status || '');
      setResolutionNotesInput(res.data?.ticket?.resolution_notes || '');
    } catch (err) {
      console.error(err);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  useEffect(() => {
    fetchDetail(selectedId);
  }, [selectedId, fetchDetail]);

  useEffect(() => {
    const socket = io(`http://${window.location.hostname}:3000`);
    const handleUpdate = (payload) => {
      fetchTickets();
      if (payload?.id && Number(payload.id) === Number(selectedId)) {
        fetchDetail(selectedId);
      }
    };
    socket.on('ticket_updated', handleUpdate);
    return () => socket.disconnect();
  }, [fetchTickets, fetchDetail, selectedId]);

  const handleCreateTicket = async (e) => {
    e.preventDefault();
    if (!newTicket.title.trim() || !newTicket.description.trim()) {
      return appAlert('Inserisci titolo e descrizione del problema.', 'Dati mancanti', 'warning');
    }
    setCreating(true);
    try {
      const res = await axios.post('/api/tickets', newTicket, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setShowCreateModal(false);
      setNewTicket({ title: '', category: 'BUG', priority: 'MEDIUM', area: 'Picking Zebra', description: '' });
      appToast(`Ticket ${res.data?.ticket_code} aperto con successo!`);
      await fetchTickets();
      if (res.data?.id) setSelectedId(res.data.id);
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore creazione ticket', 'Errore', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleSendReply = async (e) => {
    e?.preventDefault();
    if (!detail?.ticket || sendingReply) return;
    if (!replyMessage.trim() && !(isEngineer && replyStatus && replyStatus !== detail.ticket.status)) {
      return appAlert('Scrivi un messaggio o seleziona un cambio di stato.', 'Attenzione', 'warning');
    }
    setSendingReply(true);
    try {
      await axios.post(
        `/api/tickets/${detail.ticket.id}/messages`,
        {
          message: replyMessage.trim(),
          ...(isEngineer ? { status: replyStatus, resolution_notes: resolutionNotesInput } : {})
        },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      setReplyMessage('');
      appToast('Risposta inviata');
      await Promise.all([fetchTickets(), fetchDetail(detail.ticket.id)]);
      setTimeout(() => {
        if (detailScrollRef.current) {
          detailScrollRef.current.scrollTop = detailScrollRef.current.scrollHeight;
        }
      }, 100);
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore invio risposta', 'Errore', 'error');
    } finally {
      setSendingReply(false);
    }
  };

  const handleQuickStatusChange = async (nextStatus) => {
    if (!detail?.ticket || !isEngineer) return;
    try {
      await axios.put(
        `/api/tickets/${detail.ticket.id}/status`,
        {
          status: nextStatus,
          resolution_notes: resolutionNotesInput
        },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      appToast(`Ticket impostato su: ${STATUS_CONFIG[nextStatus]?.label || nextStatus}`);
      await Promise.all([fetchTickets(), fetchDetail(detail.ticket.id)]);
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore aggiornamento stato', 'Errore', 'error');
    }
  };

  const handleDeleteTicket = async (tkt) => {
    const ok = await appConfirm(`Eliminare definitivamente il ticket ${tkt.ticket_code}?`, 'Elimina Ticket');
    if (!ok) return;
    try {
      await axios.delete(`/api/tickets/${tkt.id}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      appToast('Ticket eliminato');
      setSelectedId(null);
      await fetchTickets();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Impossibile eliminare il ticket', 'Errore', 'error');
    }
  };

  const hasFilters = statusFilter !== 'ALL' || priorityFilter !== 'ALL' || categoryFilter !== 'ALL' || onlyMine || search.trim() !== '';
  const clearFilters = () => {
    setStatusFilter('ALL');
    setPriorityFilter('ALL');
    setCategoryFilter('ALL');
    setOnlyMine(false);
    setSearch('');
  };

  const currentTicket = detail?.ticket;

  return (
    <div className="space-y-5 pb-10">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-brand-white flex items-center gap-3">
            <Ticket className="text-brand-blue" size={32} />
            Supporto &amp; Segnalazioni Ticket
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Segnala anomalie o richieste. Il team <span className="text-amber-400 font-bold">Software Engineering</span> monitora e aggiorna lo stato delle lavorazioni.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="px-5 py-3 rounded-2xl bg-brand-blue hover:bg-sky-400 active:scale-95 text-brand-black font-black text-sm flex items-center gap-2 shadow-[0_0_25px_rgba(14,165,233,0.3)] transition-all"
        >
          <Plus size={18} strokeWidth={3} />
          <span>Nuovo Ticket</span>
        </button>
      </div>

      {/* KPI Strip (cliccabili come filtri rapidi!) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { key: 'OPEN', label: 'Aperti', val: stats.open || 0, color: 'text-sky-400', activeRing: 'border-sky-500/70 bg-sky-950/25', filterVal: 'OPEN', type: 'status' },
          { key: 'IN_PROGRESS', label: 'In Corso', val: stats.in_progress || 0, color: 'text-amber-400', activeRing: 'border-amber-500/70 bg-amber-950/25', filterVal: 'IN_PROGRESS', type: 'status' },
          { key: 'WAITING_INFO', label: 'In Attesa Info', val: stats.waiting_info || 0, color: 'text-purple-400', activeRing: 'border-purple-500/70 bg-purple-950/25', filterVal: 'WAITING_INFO', type: 'status' },
          { key: 'RESOLVED', label: 'Sistemati', val: stats.resolved || 0, color: 'text-emerald-400', activeRing: 'border-emerald-500/70 bg-emerald-950/25', filterVal: 'RESOLVED', type: 'status' },
          { key: 'CRITICAL', label: 'Critici Aperti', val: stats.critical_open || 0, color: 'text-rose-400', activeRing: 'border-rose-500 bg-rose-950/30', baseBorder: 'border-rose-500/30', filterVal: 'CRITICAL', type: 'priority' }
        ].map(card => {
          const isActive = card.type === 'status' ? statusFilter === card.filterVal : priorityFilter === card.filterVal;
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => {
                if (card.type === 'status') {
                  setStatusFilter(prev => (prev === card.filterVal ? 'ALL' : card.filterVal));
                } else {
                  setPriorityFilter(prev => (prev === card.filterVal ? 'ALL' : card.filterVal));
                }
              }}
              className={`text-left rounded-2xl p-4 border transition-all cursor-pointer ${
                isActive
                  ? card.activeRing
                  : `bg-slate-900/90 ${card.baseBorder || 'border-slate-800'} hover:border-slate-700`
              }`}
            >
              <div className="text-[11px] font-bold uppercase text-slate-400 flex items-center justify-between">
                <span>{card.label}</span>
                {isActive && <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-white">Filtro attivo</span>}
              </div>
              <div className={`text-2xl font-black mt-1 ${card.color}`}>{card.val}</div>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3.5 top-2.5 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca per codice TKT-, titolo, area, autore..."
            className="w-full bg-slate-950 border border-slate-800 focus:border-brand-blue rounded-xl pl-10 pr-4 py-2 text-sm text-brand-white placeholder-slate-500 outline-none"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-200 outline-none focus:border-brand-blue"
        >
          <option value="ALL">Tutti gli stati</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-200 outline-none focus:border-brand-blue"
        >
          <option value="ALL">Tutte le priorità</option>
          {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-200 outline-none focus:border-brand-blue"
        >
          <option value="ALL">Tutte le categorie</option>
          {CATEGORIES.map(c => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-xs font-bold text-slate-300 cursor-pointer select-none px-2">
          <input
            type="checkbox"
            checked={onlyMine}
            onChange={(e) => setOnlyMine(e.target.checked)}
            className="accent-sky-500 w-4 h-4"
          />
          Solo i miei ticket
        </label>

        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-bold flex items-center gap-1"
          >
            <RotateCcw size={12} /> Reset
          </button>
        )}
      </div>

      {/* Master-Detail Layout con scroll fluido garantito anche su descrizioni/thread molto lunghi */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:h-[calc(100vh-15.5rem)] min-h-[580px]">
        {/* Left List */}
        {!expandedDetail && (
          <div className="lg:col-span-5 bg-slate-900/80 border border-slate-800 rounded-3xl overflow-hidden flex flex-col min-h-0 max-h-[420px] lg:max-h-none">
            <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between shrink-0">
              <span className="text-xs font-black uppercase tracking-wider text-slate-400">
                Elenco Ticket ({tickets.length})
              </span>
              <span className="text-[11px] text-slate-500">Seleziona per leggere</span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-800/70">
              {loading ? (
                <div className="p-8 text-center text-slate-500 text-sm">Caricamento ticket...</div>
              ) : tickets.length === 0 ? (
                <div className="p-10 text-center text-slate-500 text-sm space-y-2">
                  <Ticket size={32} className="mx-auto text-slate-600" />
                  <p>Nessun ticket trovato con i filtri attuali.</p>
                </div>
              ) : (
                tickets.map((t) => {
                  const st = STATUS_CONFIG[t.status] || STATUS_CONFIG.OPEN;
                  const pr = PRIORITY_CONFIG[t.priority] || PRIORITY_CONFIG.MEDIUM;
                  const isSelected = selectedId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      className={`w-full text-left p-4 transition-all relative ${
                        isSelected
                          ? 'bg-brand-blue/10'
                          : 'hover:bg-slate-800/50'
                      }`}
                    >
                      <div className={`absolute left-0 top-2 bottom-2 w-1 rounded-r ${isSelected ? 'bg-brand-blue' : pr.bar}`} />
                      <div className="pl-2">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span className="font-mono text-xs font-black text-brand-blue">{t.ticket_code}</span>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`px-2 py-0.5 rounded-full border text-[10px] font-black uppercase ${pr.cls}`}>
                              {pr.label}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full border text-[10px] font-black uppercase ${st.cls}`}>
                              {st.label}
                            </span>
                          </div>
                        </div>

                        <h3 className="font-bold text-sm text-brand-white line-clamp-1">{t.title}</h3>
                        <p className="text-xs text-slate-400 line-clamp-2 mt-1">{t.description}</p>

                        <div className="flex items-center justify-between gap-2 mt-2.5 text-[11px] text-slate-500">
                          <div className="flex items-center gap-2 truncate">
                            <span className="text-slate-300 font-semibold">{t.created_by_username}</span>
                            {t.area && <span>· {t.area}</span>}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="flex items-center gap-1 text-slate-400 font-bold">
                              <MessageSquare size={12} className="text-brand-blue" /> {t.messages_count || 0}
                            </span>
                            <span>
                              {new Date(t.updated_at || t.created_at).toLocaleDateString('it-IT')}
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Right Detail: Header fisso + Corpo Unico Scorrevole (Descrizione lunga + Risposte) + Box Risposta Fissato in basso */}
        <div className={`${expandedDetail ? 'lg:col-span-12' : 'lg:col-span-7'} bg-slate-900/90 border border-slate-800 rounded-3xl overflow-hidden flex flex-col min-h-[520px]`}>
          {!currentTicket ? (
            <div className="flex-1 flex flex-col items-center justify-center p-10 text-slate-500 text-sm">
              <Ticket size={40} className="mb-3 text-slate-700" />
              Seleziona un ticket dalla lista o creane uno nuovo.
            </div>
          ) : detailLoading ? (
            <div className="flex-1 flex items-center justify-center p-10 text-slate-400 text-sm">
              Caricamento dettaglio...
            </div>
          ) : (
            <>
              {/* Barra Superiore Fissa */}
              <div className="px-5 py-4 border-b border-slate-800 bg-slate-950/80 flex items-start justify-between gap-3 shrink-0">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="font-mono font-black text-brand-blue text-sm">{currentTicket.ticket_code}</span>
                    <span className={`px-2.5 py-0.5 rounded-full border text-[10px] font-black uppercase ${PRIORITY_CONFIG[currentTicket.priority]?.cls}`}>
                      Priorità: {PRIORITY_CONFIG[currentTicket.priority]?.label}
                    </span>
                    <span className={`px-2.5 py-0.5 rounded-full border text-[10px] font-black uppercase ${STATUS_CONFIG[currentTicket.status]?.cls}`}>
                      {STATUS_CONFIG[currentTicket.status]?.label}
                    </span>
                    {currentTicket.category && (
                      <span className="px-2 py-0.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 text-[10px] font-bold flex items-center gap-1">
                        <Tag size={10} /> {CATEGORIES.find(c => c.value === currentTicket.category)?.label || currentTicket.category}
                      </span>
                    )}
                    {currentTicket.area && (
                      <span className="px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300 text-[10px] font-bold">
                        {currentTicket.area}
                      </span>
                    )}
                  </div>
                  <h2 className="text-lg md:text-xl font-black text-brand-white leading-snug">{currentTicket.title}</h2>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 mt-1">
                    <span>
                      Aperto da <strong className="text-slate-200">{currentTicket.created_by_username}</strong> il{' '}
                      {new Date(currentTicket.created_at).toLocaleString('it-IT')}
                    </span>
                    {currentTicket.assigned_to_username && (
                      <span className="text-amber-300 font-bold flex items-center gap-1">
                        <ShieldCheck size={12} /> In carico a: {currentTicket.assigned_to_username}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setExpandedDetail(!expandedDetail)}
                    className="hidden lg:flex p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300"
                    title={expandedDetail ? 'Mostra elenco a sinistra' : 'Espandi lettura a tutto schermo'}
                  >
                    {expandedDetail ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                  </button>

                  {(isEngineer || (currentTicket.created_by_id === user.id && currentTicket.status === 'OPEN')) && (
                    <button
                      type="button"
                      onClick={() => handleDeleteTicket(currentTicket)}
                      className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400"
                      title="Elimina Ticket"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>

              {/* Unico Corpo Scorrevole (Descrizione Lunga + Controlli SE + Cronologia Risposte) */}
              <div ref={detailScrollRef} className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
                {/* Descrizione Completa */}
                <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4">
                  <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-2">
                    Descrizione Segnalazione
                  </div>
                  <div className="text-sm text-slate-200 whitespace-pre-wrap break-words leading-relaxed">
                    {currentTicket.description}
                  </div>
                </div>

                {currentTicket.resolution_notes && (
                  <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl px-4 py-3 text-xs text-emerald-200 whitespace-pre-wrap">
                    <strong className="text-emerald-400 uppercase mr-1.5">Nota Risoluzione:</strong>
                    {currentTicket.resolution_notes}
                  </div>
                )}

                {/* Software Engineering Control Bar */}
                {isEngineer && (
                  <div className="bg-slate-950/60 border border-amber-500/25 rounded-2xl p-3.5 space-y-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-black uppercase tracking-wider text-amber-400 flex items-center gap-1 mr-1">
                        <ShieldCheck size={13} /> Azioni Rapide SE:
                      </span>
                      {[
                        { key: 'IN_PROGRESS', label: 'In Corso', cls: 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border-amber-500/30' },
                        { key: 'WAITING_INFO', label: 'Richiedi Info', cls: 'bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 border-purple-500/30' },
                        { key: 'RESOLVED', label: 'Sistemato', cls: 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/40' },
                        { key: 'CLOSED', label: 'Chiudi', cls: 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700' },
                        { key: 'REJECTED', label: 'Respingi', cls: 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border-rose-500/30' }
                      ].map(btn => (
                        <button
                          key={btn.key}
                          type="button"
                          onClick={() => handleQuickStatusChange(btn.key)}
                          disabled={currentTicket.status === btn.key}
                          className={`px-2.5 py-1 rounded-xl border text-[11px] font-black transition-all disabled:opacity-40 ${btn.cls}`}
                        >
                          {btn.label}
                        </button>
                      ))}
                    </div>

                    <input
                      type="text"
                      value={resolutionNotesInput}
                      onChange={(e) => setResolutionNotesInput(e.target.value)}
                      placeholder="Nota tecnica di risoluzione (opzionale, salvata sul ticket al cambio stato/risposta)..."
                      className="w-full bg-slate-900 border border-slate-800 focus:border-amber-400 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 outline-none"
                    />
                  </div>
                )}

                {/* Conversation Timeline */}
                <div className="space-y-3 pt-1">
                  <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <MessageSquare size={12} className="text-brand-blue" /> Conversazione ({detail?.messages?.length || 0})
                  </div>

                  {(detail?.messages || []).length === 0 ? (
                    <div className="text-center text-slate-500 text-xs py-6 bg-slate-950/40 rounded-2xl border border-dashed border-slate-800">
                      Nessuna risposta ancora. Scrivi un aggiornamento qui sotto.
                    </div>
                  ) : (
                    detail.messages.map((m) => {
                      const isEngMsg = m.author_role === 'developer';
                      return (
                        <div
                          key={m.id}
                          className={`rounded-2xl p-4 border ${
                            isEngMsg
                              ? 'bg-amber-500/5 border-amber-500/25'
                              : 'bg-slate-950/75 border-slate-800'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center gap-1 text-xs font-black text-brand-white">
                                <User size={12} className={isEngMsg ? 'text-amber-400' : 'text-brand-blue'} />
                                {m.author_username}
                              </span>
                              {isEngMsg && (
                                <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-black uppercase">
                                  Software Engineering
                                </span>
                              )}
                              {m.status_change_to && (
                                <span className={`px-2 py-0.5 rounded-full border text-[10px] font-black uppercase ${STATUS_CONFIG[m.status_change_to]?.cls}`}>
                                  Stato → {STATUS_CONFIG[m.status_change_to]?.label || m.status_change_to}
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-500 flex items-center gap-1">
                              <Clock size={10} />
                              {new Date(m.created_at).toLocaleString('it-IT')}
                            </span>
                          </div>
                          <p className="text-sm text-slate-200 whitespace-pre-wrap break-words leading-relaxed">{m.message}</p>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Sticky Reply Form sempre accessibile in basso */}
              <form onSubmit={handleSendReply} className="p-4 border-t border-slate-800 bg-slate-950/90 flex flex-col gap-2 shrink-0">
                <div className="flex gap-2 items-end">
                  <textarea
                    rows={2}
                    value={replyMessage}
                    onChange={(e) => setReplyMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        handleSendReply();
                      }
                    }}
                    placeholder={isEngineer ? 'Scrivi risposta tecnica o aggiornamento... (Ctrl+Invio per inviare)' : 'Aggiungi dettagli o rispondi al team... (Ctrl+Invio per inviare)'}
                    className="flex-1 bg-slate-900 border border-slate-800 focus:border-brand-blue rounded-2xl px-4 py-2.5 text-sm text-brand-white placeholder-slate-500 resize-none outline-none"
                  />
                  <div className="flex flex-col gap-2 justify-end shrink-0">
                    {isEngineer && (
                      <select
                        value={replyStatus}
                        onChange={(e) => setReplyStatus(e.target.value)}
                        className="bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs font-bold text-amber-300 outline-none"
                      >
                        {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                          <option key={k} value={k}>Stato: {v.label}</option>
                        ))}
                      </select>
                    )}
                    <button
                      type="submit"
                      disabled={sendingReply}
                      className="px-5 py-2.5 rounded-xl bg-brand-blue hover:bg-sky-400 active:scale-95 text-brand-black font-black text-xs flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                    >
                      <Send size={14} />
                      <span>{sendingReply ? 'Invio...' : 'Invia'}</span>
                    </button>
                  </div>
                </div>
              </form>
            </>
          )}
        </div>
      </div>

      {/* Create Ticket Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-brand-black/85 backdrop-blur-md">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl overflow-hidden animate-fade-in-up max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between shrink-0">
              <h2 className="text-lg font-black text-brand-white flex items-center gap-2">
                <Ticket className="text-brand-blue" size={20} />
                Nuovo Ticket di Segnalazione
              </h2>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateTicket} className="p-6 space-y-4 overflow-y-auto flex-1 min-h-0">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-400 mb-1.5">Titolo Problema *</label>
                <input
                  type="text"
                  required
                  value={newTicket.title}
                  onChange={(e) => setNewTicket(p => ({ ...p, title: e.target.value }))}
                  placeholder="Es. Errore scansione barcode in Picking Zebra"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-brand-blue rounded-xl px-4 py-2.5 text-sm text-brand-white outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-400 mb-1.5">Area / Modulo</label>
                  <select
                    value={newTicket.area}
                    onChange={(e) => setNewTicket(p => ({ ...p, area: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs font-bold text-brand-white"
                  >
                    {AREAS.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-slate-400 mb-1.5">Categoria</label>
                  <select
                    value={newTicket.category}
                    onChange={(e) => setNewTicket(p => ({ ...p, category: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs font-bold text-brand-white"
                  >
                    {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-slate-400 mb-1.5">Priorità</label>
                  <select
                    value={newTicket.priority}
                    onChange={(e) => setNewTicket(p => ({ ...p, priority: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs font-bold text-brand-white"
                  >
                    <option value="LOW">Bassa</option>
                    <option value="MEDIUM">Media</option>
                    <option value="HIGH">Alta</option>
                    <option value="CRITICAL">Critica (Bloccante)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-400 mb-1.5">Descrizione Dettagliata *</label>
                <textarea
                  rows={5}
                  required
                  value={newTicket.description}
                  onChange={(e) => setNewTicket(p => ({ ...p, description: e.target.value }))}
                  placeholder="Descrivi cosa è successo, eventuale codice ordine/paletta, e come riprodurre il problema..."
                  className="w-full bg-slate-950 border border-slate-800 focus:border-brand-blue rounded-xl px-4 py-2.5 text-sm text-brand-white outline-none resize-y"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-5 py-2.5 rounded-xl bg-brand-blue hover:bg-sky-400 text-brand-black font-black text-xs flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Send size={14} />
                  <span>{creating ? 'Invio...' : 'Invia Ticket'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Tickets;
