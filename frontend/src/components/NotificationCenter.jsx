import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  BellOff,
  CheckCheck,
  SlidersHorizontal,
  X,
  PackageCheck,
  PackagePlus,
  RotateCcw,
  FileCheck2,
  AlertTriangle,
  ShieldAlert,
  Ticket,
  Search,
  EyeOff,
  Eye
} from 'lucide-react';
import { appToast } from '../utils/alerts';

const TYPE_META = {
  ORDER_COMPLETED: { label: 'Completamento Ordini', Icon: PackageCheck, color: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30' },
  ORDER_CREATED: { label: 'Nuovi Ordini', Icon: PackagePlus, color: 'text-sky-400 bg-sky-500/15 border-sky-500/30' },
  ORDER_RETURNED: { label: 'Resi Spedizioni', Icon: RotateCcw, color: 'text-amber-400 bg-amber-500/15 border-amber-500/30' },
  INBOUND_COMPLETED: { label: 'DDT Completati', Icon: FileCheck2, color: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30' },
  INBOUND_DISCREPANCY: { label: 'Discrepanze DDT', Icon: AlertTriangle, color: 'text-rose-400 bg-rose-500/15 border-rose-500/30' },
  QUARANTINE_BLOCKED: { label: 'Quarantena', Icon: ShieldAlert, color: 'text-rose-400 bg-rose-500/15 border-rose-500/30' },
  TICKET_UPDATE: { label: 'Aggiornamenti Ticket', Icon: Ticket, color: 'text-purple-400 bg-purple-500/15 border-purple-500/30' },
  TICKET_CREATED: { label: 'Nuovi Ticket', Icon: Ticket, color: 'text-amber-400 bg-amber-500/15 border-amber-500/30' }
};

const NotificationCenter = ({ socket }) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('LIST'); // 'LIST' | 'PREFS'
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [customerFilter, setCustomerFilter] = useState('ALL');
  const [includeMuted, setIncludeMuted] = useState(false);

  const [prefsLoading, setPrefsLoading] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [mutedCustomerIds, setMutedCustomerIds] = useState([]);
  const [mutedTypes, setMutedTypes] = useState([]);
  const [availableTypes, setAvailableTypes] = useState([]);
  const [custSearch, setCustSearch] = useState('');

  const panelRef = useRef(null);
  const mutedCustomerRef = useRef(new Set());
  const mutedTypeRef = useRef(new Set());

  const getToken = () => localStorage.getItem('maglite_token');

  const fetchNotifications = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const res = await axios.get('/api/notifications', {
        params: {
          limit: 60,
          type: typeFilter,
          customer_id: customerFilter,
          include_muted: includeMuted ? 'true' : 'false'
        },
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = res.data || {};
      setNotifications(data.notifications || []);
      setUnreadCount(data.unread_count || 0);
      const mCust = data.muted_customer_ids || [];
      const mTypes = data.muted_types || [];
      setMutedCustomerIds(mCust);
      setMutedTypes(mTypes);
      mutedCustomerRef.current = new Set(mCust.map(Number));
      mutedTypeRef.current = new Set(mTypes);
      if (Array.isArray(data.available_types)) {
        setAvailableTypes(data.available_types);
      }
    } catch {
      // ignore
    }
  }, [typeFilter, customerFilter, includeMuted]);

  const fetchPreferences = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    setPrefsLoading(true);
    try {
      const res = await axios.get('/api/notifications/preferences', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = res.data || {};
      setCustomers(data.customers || []);
      const mCust = data.muted_customer_ids || [];
      const mTypes = data.muted_types || [];
      setMutedCustomerIds(mCust);
      setMutedTypes(mTypes);
      mutedCustomerRef.current = new Set(mCust.map(Number));
      mutedTypeRef.current = new Set(mTypes);
      setAvailableTypes(data.available_types || []);
    } catch {
      // ignore
    } finally {
      setPrefsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    fetchPreferences();
  }, [fetchNotifications, fetchPreferences]);

  useEffect(() => {
    if (!socket) return;
    const handleNew = (notif) => {
      fetchNotifications();
      const isMutedCust = notif?.customer_id && mutedCustomerRef.current.has(Number(notif.customer_id));
      const isMutedType = notif?.type && mutedTypeRef.current.has(notif.type);
      if (!isMutedCust && !isMutedType && notif?.title) {
        appToast(`${notif.title}${notif.customer_name ? ` · ${notif.customer_name}` : ''}`, 'info');
      }
    };
    socket.on('notification_created', handleNew);
    return () => socket.off('notification_created', handleNew);
  }, [socket, fetchNotifications]);

  useEffect(() => {
    const handleOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const handleMarkRead = async (notif) => {
    const token = getToken();
    if (!notif.is_read && token) {
      try {
        await axios.post(`/api/notifications/${notif.id}/read`, {}, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
        setUnreadCount(prev => Math.max(0, prev - 1));
      } catch {
        // ignore
      }
    }
    if (notif.link_path) {
      setOpen(false);
      navigate(notif.link_path);
    }
  };

  const handleMarkAllRead = async () => {
    const token = getToken();
    if (!token) return;
    try {
      await axios.post('/api/notifications/read-all', {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch {
      // ignore
    }
  };

  const handleToggleCustomerMute = async (customerId, customerName, nextMute) => {
    const token = getToken();
    if (!token || !customerId) return;
    try {
      const res = await axios.post(
        `/api/notifications/customer/${customerId}/toggle`,
        { mute: nextMute },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const isMuted = Boolean(res.data?.is_muted);
      const nextList = isMuted
        ? [...new Set([...mutedCustomerIds, Number(customerId)])]
        : mutedCustomerIds.filter(id => id !== Number(customerId));
      setMutedCustomerIds(nextList);
      mutedCustomerRef.current = new Set(nextList);
      setCustomers(prev => prev.map(c => c.id === Number(customerId) ? { ...c, is_muted: isMuted } : c));
      fetchNotifications();
      appToast(
        isMuted
          ? `Notifiche disabilitate per ${customerName || 'cliente'}`
          : `Notifiche riattivate per ${customerName || 'cliente'}`,
        'success'
      );
    } catch {
      // ignore
    }
  };

  const handleOnlyCustomer = async (targetCustomerId, targetCustomerName) => {
    const token = getToken();
    if (!token) return;
    const allOthersMuted = customers
      .filter(c => Number(c.id) !== Number(targetCustomerId))
      .map(c => Number(c.id));
    try {
      await axios.put(
        '/api/notifications/preferences',
        { muted_customer_ids: allOthersMuted },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setMutedCustomerIds(allOthersMuted);
      mutedCustomerRef.current = new Set(allOthersMuted);
      setCustomers(prev => prev.map(c => ({ ...c, is_muted: Number(c.id) !== Number(targetCustomerId) })));
      fetchNotifications();
      appToast(`Notifiche attive solo per ${targetCustomerName}`, 'success');
    } catch {
      // ignore
    }
  };

  const handleResetAllCustomers = async (muteAll) => {
    const token = getToken();
    if (!token) return;
    const nextMuted = muteAll ? customers.map(c => Number(c.id)) : [];
    try {
      await axios.put(
        '/api/notifications/preferences',
        { muted_customer_ids: nextMuted },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setMutedCustomerIds(nextMuted);
      mutedCustomerRef.current = new Set(nextMuted);
      setCustomers(prev => prev.map(c => ({ ...c, is_muted: muteAll })));
      fetchNotifications();
    } catch {
      // ignore
    }
  };

  const handleToggleTypeMute = async (typeKey) => {
    const token = getToken();
    if (!token) return;
    const nextTypes = mutedTypes.includes(typeKey)
      ? mutedTypes.filter(t => t !== typeKey)
      : [...mutedTypes, typeKey];
    try {
      await axios.put(
        '/api/notifications/preferences',
        { muted_types: nextTypes },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setMutedTypes(nextTypes);
      mutedTypeRef.current = new Set(nextTypes);
      fetchNotifications();
    } catch {
      // ignore
    }
  };

  const filteredCustomersForPrefs = customers.filter(c => {
    const s = custSearch.trim().toLowerCase();
    if (!s) return true;
    return (c.business_name || '').toLowerCase().includes(s) || (c.unique_id || '').toLowerCase().includes(s);
  });

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) {
            fetchNotifications();
            fetchPreferences();
          }
        }}
        className="relative p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-brand-white transition-all"
        title="Notifiche e Filtri Clienti"
      >
        <Bell size={18} className={unreadCount > 0 ? 'text-brand-blue' : 'text-slate-400'} />
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center shadow-lg">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed md:absolute right-3 md:right-0 top-14 md:top-full md:mt-2 w-[calc(100vw-24px)] md:w-[440px] bg-slate-900 border border-slate-700/90 rounded-3xl shadow-2xl z-[80] overflow-hidden flex flex-col max-h-[82vh]">
          {/* Header */}
          <div className="px-4 py-3.5 bg-slate-950/90 border-b border-slate-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Bell size={18} className="text-brand-blue" />
              <span className="font-black text-sm text-brand-white">Centro Notifiche</span>
              {mutedCustomerIds.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-bold">
                  {mutedCustomerIds.length} clienti nascosti
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActiveTab(activeTab === 'LIST' ? 'PREFS' : 'LIST')}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 transition-all border ${
                  activeTab === 'PREFS'
                    ? 'bg-brand-blue text-brand-black border-brand-blue'
                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
                }`}
                title="Filtra notifiche per Cliente e Tipologia"
              >
                <SlidersHorizontal size={13} />
                <span>{activeTab === 'PREFS' ? 'Torna' : 'Filtri Clienti'}</span>
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {activeTab === 'LIST' ? (
            <>
              {/* Quick Filters */}
              <div className="px-4 py-2.5 bg-slate-950/40 border-b border-slate-800/80 flex flex-wrap items-center gap-2">
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 font-semibold flex-1 min-w-[140px]"
                >
                  <option value="ALL">Tutte le tipologie</option>
                  {(availableTypes.length > 0 ? availableTypes : Object.entries(TYPE_META).map(([key, v]) => ({ key, label: v.label }))).map(t => (
                    <option key={t.key} value={t.key}>{t.label}</option>
                  ))}
                </select>

                <select
                  value={customerFilter}
                  onChange={(e) => setCustomerFilter(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 font-semibold flex-1 min-w-[130px]"
                >
                  <option value="ALL">Tutti i clienti attivi</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.business_name}{c.is_muted ? ' (Nascosto)' : ''}
                    </option>
                  ))}
                </select>

                <div className="flex items-center justify-between w-full pt-1 text-[11px]">
                  <label className="flex items-center gap-1.5 text-slate-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={includeMuted}
                      onChange={(e) => setIncludeMuted(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-950"
                    />
                    Mostra anche clienti disabilitati
                  </label>
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={handleMarkAllRead}
                      className="text-brand-blue hover:text-sky-300 font-bold flex items-center gap-1"
                    >
                      <CheckCheck size={13} />
                      Segna tutte lette
                    </button>
                  )}
                </div>
              </div>

              {/* Notifications List */}
              <div className="flex-1 overflow-y-auto divide-y divide-slate-800/70">
                {notifications.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-xs font-semibold space-y-2">
                    <BellOff size={28} className="mx-auto text-slate-600" />
                    <p>Nessuna notifica visibile con i filtri attuali.</p>
                  </div>
                ) : (
                  notifications.map((n) => {
                    const meta = TYPE_META[n.type] || { label: n.type, Icon: Bell, color: 'text-slate-300 bg-slate-800 border-slate-700' };
                    const Icon = meta.Icon;
                    return (
                      <div
                        key={n.id}
                        className={`p-3.5 transition-colors ${
                          n.is_read ? 'bg-slate-900/40 opacity-75' : 'bg-slate-900 hover:bg-slate-800/70'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 mt-0.5 ${meta.color}`}>
                            <Icon size={17} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <button
                              type="button"
                              onClick={() => handleMarkRead(n)}
                              className="text-left w-full group"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className={`text-xs font-black truncate ${n.is_read ? 'text-slate-300' : 'text-brand-white group-hover:text-brand-blue'}`}>
                                  {n.title}
                                </span>
                                {!n.is_read && <span className="w-2 h-2 rounded-full bg-brand-blue shrink-0" />}
                              </div>
                              <p className="text-xs text-slate-400 mt-0.5 leading-snug break-words">
                                {n.message}
                              </p>
                            </button>

                            <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {n.customer_name && (
                                  <span className="px-2 py-0.5 rounded-md bg-slate-950 border border-slate-800 text-[10px] font-bold text-slate-300">
                                    {n.customer_name}
                                  </span>
                                )}
                                <span className="text-[10px] text-slate-500">
                                  {new Date(n.created_at).toLocaleString('it-IT', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                  })}
                                </span>
                              </div>

                              {n.customer_id && (
                                <button
                                  type="button"
                                  onClick={() => handleToggleCustomerMute(n.customer_id, n.customer_name, !n.is_customer_muted)}
                                  className="text-[10px] font-bold text-slate-400 hover:text-amber-300 flex items-center gap-1 transition-colors"
                                  title={n.is_customer_muted ? 'Riattiva notifiche per questo cliente' : 'Nascondi notifiche di questo cliente'}
                                >
                                  {n.is_customer_muted ? <Eye size={11} /> : <EyeOff size={11} />}
                                  <span>{n.is_customer_muted ? 'Riattiva cliente' : 'Nascondi cliente'}</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            /* Tab Preferenze per Cliente & Tipologia */
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {/* Tipologie */}
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2">
                  Tipologie di Notifica
                </h4>
                <div className="grid grid-cols-1 gap-1.5">
                  {availableTypes.map((t) => {
                    const isMuted = mutedTypes.includes(t.key);
                    return (
                      <label
                        key={t.key}
                        className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-950/70 border border-slate-800 cursor-pointer hover:border-slate-700"
                      >
                        <span className={`text-xs font-bold ${isMuted ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
                          {t.label}
                        </span>
                        <input
                          type="checkbox"
                          checked={!isMuted}
                          onChange={() => handleToggleTypeMute(t.key)}
                          className="accent-sky-500 w-4 h-4"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Clienti */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-400">
                    Notifiche per Cliente
                  </h4>
                  <div className="flex items-center gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={() => handleResetAllCustomers(false)}
                      className="text-emerald-400 hover:text-emerald-300 font-bold"
                    >
                      Attiva tutti
                    </button>
                    <span className="text-slate-700">|</span>
                    <button
                      type="button"
                      onClick={() => handleResetAllCustomers(true)}
                      className="text-rose-400 hover:text-rose-300 font-bold"
                    >
                      Disattiva tutti
                    </button>
                  </div>
                </div>

                <div className="relative mb-2.5">
                  <Search size={14} className="absolute left-3 top-2.5 text-slate-500" />
                  <input
                    type="text"
                    value={custSearch}
                    onChange={(e) => setCustSearch(e.target.value)}
                    placeholder="Cerca cliente..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-2 text-xs text-brand-white placeholder-slate-500"
                  />
                </div>

                {prefsLoading ? (
                  <p className="text-xs text-slate-500 py-4 text-center">Caricamento clienti...</p>
                ) : (
                  <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                    {filteredCustomersForPrefs.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-950/70 border border-slate-800"
                      >
                        <div className="min-w-0 flex-1">
                          <div className={`text-xs font-bold truncate ${c.is_muted ? 'text-slate-500' : 'text-slate-200'}`}>
                            {c.business_name}
                          </div>
                          <div className="text-[10px] font-mono text-slate-500">{c.unique_id}</div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleOnlyCustomer(c.id, c.business_name)}
                            className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] font-bold text-brand-blue"
                            title="Vedi notifiche SOLO per questo cliente"
                          >
                            Solo questo
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleCustomerMute(c.id, c.business_name, !c.is_muted)}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-black transition-all ${
                              c.is_muted
                                ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                                : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                            }`}
                          >
                            {c.is_muted ? 'Disabilitato' : 'Attivo'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationCenter;
