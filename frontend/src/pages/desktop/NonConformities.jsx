import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Search,
  X,
  CheckCircle2,
  XCircle,
  Wrench,
  Package,
  MapPin,
  Calendar,
  Scale,
  Tag,
  FileText,
  User,
  ExternalLink,
  History,
  Plus,
  Send,
  Lock,
  Layers
} from 'lucide-react';
import { hasPerm } from '../../utils/permissions';

const CAUSES_CATALOG = [
  { code: 'LOTTO_ERRATO', label: 'Lotto errato / illeggibile' },
  { code: 'SCADENZA_ERRATA', label: 'Data di scadenza errata / assente / merce scaduta' },
  { code: 'ARTICOLO_ERRATO', label: 'Articolo / Nome / SKU errato (merce diversa)' },
  { code: 'QUANTITA_ERRATA', label: 'Quantità / Colli errati (eccesso o mancanza)' },
  { code: 'COLLO_ROTTO', label: 'Collo rotto / Imballaggio danneggiato' },
  { code: 'PESO_NETTO_ERRATO', label: 'Kili netti errati' },
  { code: 'PESO_LORDO_ERRATO', label: 'Kili lordi errati' },
  { code: 'ETICHETTA_MANCANTE', label: 'Etichetta / Barcode mancante o non leggibile' },
  { code: 'CONSERVAZIONE_ANOMALA', label: 'Anomalia temperatura / conservazione / contaminazione' },
  { code: 'BANCALE_NON_CONFORME', label: 'Bancale danneggiato / instabile / non conforme' },
  { code: 'DOCUMENTI_ERRATI', label: 'DDT / Riferimenti cliente / Metadati errati' },
  { code: 'ALTRO', label: 'Altro problema (vedi note)' }
];

const NonConformities = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({ total: 0, open: 0, accepted: 0, rejected: 0, corrected: 0 });
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('OPEN'); // 'OPEN' | 'ACCEPTED' | 'REJECTED' | 'ALL'
  const [searchTerm, setSearchTerm] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [notice, setNotice] = useState(null);

  // Modali Decisione (Accetta / Rifiuta)
  const [decisionModal, setDecisionModal] = useState(null); // { nc, action: 'ACCEPT' | 'REJECT' }
  const [decisionNotes, setDecisionNotes] = useState('');
  const [savingDecision, setSavingDecision] = useState(false);

  // Modale Correzione Diretta Paletta
  const [correctModal, setCorrectModal] = useState(null); // { nc, forms: [...], products: [...], acceptNc: true, notes: '' }
  const [tariffPlans, setTariffPlans] = useState([]);
  const [savingCorrection, setSavingCorrection] = useState(false);

  // Modale Nuova Segnalazione dal Gestionale
  const [newNcModal, setNewNcModal] = useState(false);
  const [scanCode, setScanCode] = useState('');
  const [inspectedPallet, setInspectedPallet] = useState(null);
  const [newCauses, setNewCauses] = useState([]);
  const [newNotes, setNewNotes] = useState('');
  const [inspectLoading, setInspectLoading] = useState(false);
  const [submittingNew, setSubmittingNew] = useState(false);

  const getToken = () => localStorage.getItem('maglite_token');
  const canManage = hasPerm(['non_conformities_manage', 'pallet_edit', 'access_desktop']);

  const showToast = (type, text) => {
    setNotice({ type, text });
    setTimeout(() => setNotice(prev => (prev?.text === text ? null : prev)), 4000);
  };

  const fetchList = async () => {
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      const [res, plansRes] = await Promise.all([
        axios.get(`http://${window.location.hostname}:3000/api/non-conformities`, { headers }),
        axios.get(`http://${window.location.hostname}:3000/api/products/tariff-plans`, { headers }).catch(() => ({ data: [] }))
      ]);
      setItems(res.data?.items || []);
      setStats(res.data?.stats || { total: 0, open: 0, accepted: 0, rejected: 0, corrected: 0 });
      setTariffPlans(Array.isArray(plansRes.data) ? plansRes.data : []);
    } catch (err) {
      showToast('error', err.response?.data?.error || 'Errore caricamento Non Conformità');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
    const socket = io(`http://${window.location.hostname}:3000`);
    const refresh = () => fetchList();
    socket.on('non_conformity_updated', refresh);
    socket.on('inventory_updated', refresh);
    return () => {
      socket.off('non_conformity_updated', refresh);
      socket.off('inventory_updated', refresh);
      socket.disconnect();
    };
  }, []);

  const uniqueCustomers = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      if (it.customer_id && it.customer_name) {
        map.set(it.customer_id, it.customer_name);
      }
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return items.filter(r => {
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      if (customerFilter && String(r.customer_id) !== String(customerFilter)) return false;
      if (q) {
        const hay = [
          r.nc_code,
          r.pallet_code,
          r.customer_name,
          r.location,
          r.warehouse,
          r.reported_by,
          r.operator_notes,
          r.resolution_notes,
          ...(r.causes || []).map(c => c.label),
          ...(r.items_snapshot || []).flatMap(it => [
            it.product_name, it.sku, it.batch, it.client_pallet_number, it.client_article_number, it.client_ddt
          ])
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, statusFilter, customerFilter, searchTerm]);

  const handleConfirmDecision = async () => {
    if (!decisionModal || savingDecision) return;
    setSavingDecision(true);
    try {
      const endpoint = decisionModal.action === 'ACCEPT' ? 'accept' : 'reject';
      await axios.post(
        `http://${window.location.hostname}:3000/api/non-conformities/${decisionModal.nc.id}/${endpoint}`,
        { resolution_notes: decisionNotes.trim() || null },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      showToast(
        'ok',
        decisionModal.action === 'ACCEPT'
          ? `Non Conformità ${decisionModal.nc.nc_code} accettata.`
          : `Non Conformità ${decisionModal.nc.nc_code} rifiutata ed archiviata nello storico tracciabilità.`
      );
      setDecisionModal(null);
      setDecisionNotes('');
      fetchList();
    } catch (err) {
      showToast('error', err.response?.data?.error || 'Errore aggiornamento Non Conformità');
    } finally {
      setSavingDecision(false);
    }
  };

  const openCorrectionModal = async (nc) => {
    const baseItems = (nc.live_items && nc.live_items.length > 0) ? nc.live_items : (nc.items_snapshot || []);
    let customerProducts = [];
    try {
      const res = await axios.get(
        `http://${window.location.hostname}:3000/api/non-conformities/${nc.id}/products`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      customerProducts = res.data || [];
    } catch {
      customerProducts = [];
    }

    setCorrectModal({
      nc,
      products: customerProducts,
      acceptNc: nc.status === 'OPEN',
      resolutionNotes: nc.resolution_notes || '',
      forms: baseItems.map(it => ({
        pallet_id: it.pallet_id,
        sku: it.sku,
        product_id: it.product_id,
        product_name: it.product_name,
        rename_product_name: '',
        batch: it.batch || '',
        expiration_date: it.expiration_date ? String(it.expiration_date).slice(0, 10) : '',
        quantity: it.quantity ?? '',
        units_per_box: it.units_per_box ?? 1,
        net_weight_kg: it.net_weight_kg ?? '',
        gross_weight_kg: it.gross_weight_kg ?? '',
        client_pallet_number: it.client_pallet_number || '',
        client_article_number: it.client_article_number || '',
        tariff_plan_id: it.tariff_plan_id ? String(it.tariff_plan_id) : '',
        notes: it.notes || ''
      }))
    });
  };

  const handleSaveCorrection = async (e) => {
    e.preventDefault();
    if (!correctModal || savingCorrection) return;
    setSavingCorrection(true);
    try {
      await axios.post(
        `http://${window.location.hostname}:3000/api/non-conformities/${correctModal.nc.id}/correct`,
        {
          corrections: correctModal.forms.map(f => ({
            pallet_id: f.pallet_id,
            product_id: f.product_id,
            rename_product_name: f.rename_product_name || undefined,
            batch: f.batch,
            expiration_date: f.expiration_date || null,
            quantity: f.quantity,
            units_per_box: f.units_per_box,
            net_weight_kg: f.net_weight_kg,
            gross_weight_kg: f.gross_weight_kg,
            client_pallet_number: f.client_pallet_number,
            client_article_number: f.client_article_number,
            tariff_plan_id: f.tariff_plan_id ? parseInt(f.tariff_plan_id, 10) : null,
            notes: f.notes
          })),
          accept_nc: correctModal.acceptNc,
          resolution_notes: correctModal.resolutionNotes.trim() || null
        },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      showToast('ok', `Rettifica applicata sulla paletta ${correctModal.nc.pallet_code} e salvata in tracciabilità.`);
      setCorrectModal(null);
      fetchList();
    } catch (err) {
      showToast('error', err.response?.data?.error || 'Errore salvataggio rettifica');
    } finally {
      setSavingCorrection(false);
    }
  };

  const handleInspectForNewNc = async () => {
    const code = scanCode.trim().toUpperCase();
    if (!code) return;
    setInspectLoading(true);
    try {
      const res = await axios.get(
        `http://${window.location.hostname}:3000/api/non-conformities/inspect/${encodeURIComponent(code)}`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      setInspectedPallet(res.data);
    } catch (err) {
      setInspectedPallet(null);
      showToast('error', err.response?.data?.error || `Codice "${code}" non trovato`);
    } finally {
      setInspectLoading(false);
    }
  };

  const handleCreateDesktopNc = async () => {
    if (!inspectedPallet || submittingNew) return;
    if (newCauses.length === 0 && !newNotes.trim()) {
      showToast('error', 'Seleziona almeno una causa oppure scrivi una nota.');
      return;
    }
    setSubmittingNew(true);
    try {
      const res = await axios.post(
        `http://${window.location.hostname}:3000/api/non-conformities`,
        {
          pallet_code: inspectedPallet.pallet_code,
          causes: newCauses,
          operator_notes: newNotes.trim() || null,
          source: 'DESKTOP'
        },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      showToast('ok', `Non Conformità ${res.data.nc_code} registrata.`);
      setNewNcModal(false);
      setScanCode('');
      setInspectedPallet(null);
      setNewCauses([]);
      setNewNotes('');
      fetchList();
    } catch (err) {
      showToast('error', err.response?.data?.error || 'Errore creazione Non Conformità');
    } finally {
      setSubmittingNew(false);
    }
  };

  return (
    <div className="w-full min-w-0 max-w-7xl mx-auto animate-fade-in space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-black text-brand-white flex items-center gap-3">
            <AlertTriangle className="text-rose-400 shrink-0" size={32} />
            <span>Gestione Non Conformità</span>
          </h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">
            Segnalazioni dai terminali Zebra e dal magazzino con snapshot completo metadati, approvazione/rifiuto tracciati e rettifica diretta in stock.
          </p>
        </div>

        <button
          type="button"
          onClick={() => { setNewNcModal(true); setScanCode(''); setInspectedPallet(null); setNewCauses([]); setNewNotes(''); }}
          className="w-full md:w-auto justify-center bg-rose-500 hover:bg-rose-400 text-white font-black py-2.5 px-5 rounded-xl flex items-center gap-2 shadow-[0_0_20px_rgba(244,63,94,0.3)] transition-all text-sm"
        >
          <Plus size={18} /> Nuova Non Conformità
        </button>
      </div>

      {notice && (
        <div className={`px-4 py-3 rounded-2xl border text-xs sm:text-sm font-bold flex items-center gap-2 ${
          notice.type === 'error'
            ? 'bg-rose-500/15 border-rose-500/40 text-rose-200'
            : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200'
        }`}>
          {notice.type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
          <span className="flex-1">{notice.text}</span>
          <button onClick={() => setNotice(null)}><X size={15} /></button>
        </div>
      )}

      {/* KPI Filter Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <button
          type="button"
          onClick={() => setStatusFilter('OPEN')}
          className={`text-left p-4 rounded-2xl border transition-all ${
            statusFilter === 'OPEN'
              ? 'bg-rose-500/15 border-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.18)]'
              : 'bg-slate-900 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="text-[11px] font-black uppercase text-rose-400">Aperte (Da Gestire)</div>
          <div className="text-2xl font-black text-brand-white mt-1">{stats.open}</div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('ACCEPTED')}
          className={`text-left p-4 rounded-2xl border transition-all ${
            statusFilter === 'ACCEPTED'
              ? 'bg-emerald-500/15 border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.18)]'
              : 'bg-slate-900 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="text-[11px] font-black uppercase text-emerald-400">Accettate</div>
          <div className="text-2xl font-black text-brand-white mt-1">{stats.accepted}</div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('REJECTED')}
          className={`text-left p-4 rounded-2xl border transition-all ${
            statusFilter === 'REJECTED'
              ? 'bg-amber-500/15 border-amber-500'
              : 'bg-slate-900 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="text-[11px] font-black uppercase text-amber-400">Rifiutate (Storico)</div>
          <div className="text-2xl font-black text-brand-white mt-1">{stats.rejected}</div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('ALL')}
          className={`text-left p-4 rounded-2xl border transition-all ${
            statusFilter === 'ALL'
              ? 'bg-brand-blue/15 border-brand-blue'
              : 'bg-slate-900 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="text-[11px] font-black uppercase text-brand-blue">Tutte (Tracciabilità)</div>
          <div className="text-2xl font-black text-brand-white mt-1">{stats.total}</div>
        </button>

        <div className="p-4 rounded-2xl border bg-slate-900 border-slate-800">
          <div className="text-[11px] font-black uppercase text-cyan-400">Palette Rettificate</div>
          <div className="text-2xl font-black text-brand-white mt-1">{stats.corrected}</div>
        </div>
      </div>

      {/* Search & Customer Filters */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 sm:p-4 flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 shadow-xl">
        <div className="flex-1 relative min-w-[220px]">
          <Search size={17} className="absolute left-3.5 top-3 text-slate-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Cerca per codice NC, barcode PAL, prodotto, lotto, causa, note o operatore..."
            className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2.5 pl-10 pr-8 text-sm text-white focus:border-brand-blue outline-none"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} className="absolute right-3 top-3 text-slate-500 hover:text-white">
              <X size={15} />
            </button>
          )}
        </div>

        <select
          value={customerFilter}
          onChange={e => setCustomerFilter(e.target.value)}
          className="w-full sm:w-56 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white font-semibold outline-none"
        >
          <option value="">Tutti i clienti</option>
          {uniqueCustomers.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Lista Segnalazioni */}
      {loading ? (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center text-slate-400 text-sm">
          Caricamento Non Conformità...
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center text-slate-500 text-sm italic">
          Nessuna Non Conformità trovata nella vista selezionata.
        </div>
      ) : (
        <div className="space-y-4">
          {filteredItems.map(nc => {
            const snapItems = nc.items_snapshot || [];
            const meta = nc.pallet_metadata_snapshot || {};
            const liveItems = nc.live_items || [];
            const isOpen = nc.status === 'OPEN';
            const isAccepted = nc.status === 'ACCEPTED';
            const isRejected = nc.status === 'REJECTED';

            return (
              <div
                key={nc.id}
                className={`bg-slate-900 border rounded-3xl p-4 sm:p-6 shadow-xl space-y-4 transition-all ${
                  isOpen ? 'border-rose-500/40' : isAccepted ? 'border-emerald-500/30' : 'border-slate-800 opacity-90'
                }`}
              >
                {/* Header Riga NC */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="font-mono font-black text-sm px-3 py-1 rounded-xl bg-slate-950 border border-slate-700 text-brand-white">
                      {nc.nc_code}
                    </span>

                    <span className="font-mono font-black text-sm px-3 py-1 rounded-xl bg-brand-blue/15 border border-brand-blue/35 text-brand-blue">
                      {nc.pallet_code}
                    </span>

                    {isOpen && (
                      <span className="px-2.5 py-1 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs font-black uppercase">
                        Aperta
                      </span>
                    )}
                    {isAccepted && (
                      <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-black uppercase">
                        Accettata
                      </span>
                    )}
                    {isRejected && (
                      <span className="px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/35 text-amber-300 text-xs font-black uppercase">
                        Rifiutata / Archiviata
                      </span>
                    )}
                    {nc.corrected && (
                      <span className="px-2.5 py-1 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-xs font-black uppercase flex items-center gap-1">
                        <Wrench size={11} /> Rettificata in Stock
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span className="flex items-center gap-1 font-bold text-slate-300">
                      <User size={13} className="text-brand-blue" /> {nc.reported_by} ({nc.reported_source || 'ZEBRA'})
                    </span>
                    <span>•</span>
                    <span>{new Date(nc.reported_at).toLocaleString('it-IT')}</span>
                  </div>
                </div>

                {/* Cliente + Posizione + Cause + Note Operatore */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                  <div className="lg:col-span-5 space-y-2.5">
                    <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-3.5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-400 font-bold uppercase">Cliente</span>
                        <span className="text-sm font-black text-brand-white">{nc.customer_name || '-'}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-slate-400 font-bold">Magazzino / Posizione</span>
                        <span className="font-mono font-bold text-emerald-400 flex items-center gap-1">
                          <MapPin size={12} /> {nc.warehouse || '-'} • {nc.location || 'IN ATTESA'}
                        </span>
                      </div>
                      {(meta.inbound_ddt_number || meta.client_ddt || meta.checkin_session_code) && (
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-slate-400 font-bold">Riferimenti Ingresso</span>
                          <span className="font-mono text-slate-200">
                            {meta.inbound_ddt_number || ''} {meta.client_ddt ? `DDT:${meta.client_ddt}` : ''} {meta.checkin_session_code ? `• ${meta.checkin_session_code}` : ''}
                          </span>
                        </div>
                      )}
                      {(meta.total_net_weight_kg || meta.total_gross_weight_kg) && (
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-slate-400 font-bold">Pesi Snapshot Paletta</span>
                          <span className="font-mono text-sky-300">
                            Netti: {meta.total_net_weight_kg ?? '-'} kg • Lordi: {meta.total_gross_weight_kg ?? '-'} kg
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Cause */}
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-black uppercase tracking-wider text-rose-400">
                        Cause Segnalate
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(nc.causes || []).map((c, idx) => (
                          <span
                            key={`${c?.code || c}-${idx}`}
                            className="px-2.5 py-1 rounded-xl bg-rose-500/15 border border-rose-500/35 text-rose-200 text-xs font-bold"
                          >
                            {typeof c === 'object' ? (c?.label || c?.code || '') : c}
                          </span>
                        ))}
                      </div>
                    </div>

                    {nc.operator_notes && (
                      <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3 text-xs text-amber-100">
                        <span className="font-black uppercase text-[10px] text-amber-400 block mb-0.5">Note Operatore:</span>
                        {nc.operator_notes}
                      </div>
                    )}
                  </div>

                  {/* Contenuto Snapshot Completo Paletta */}
                  <div className="lg:col-span-7 space-y-2">
                    <div className="text-[11px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                      <Layers size={13} className="text-brand-blue" />
                      Contenuto Paletta &amp; Metadati al Momento della Segnalazione ({snapItems.length} {snapItems.length === 1 ? 'riga' : 'righe'})
                    </div>

                    <div className="space-y-2">
                      {snapItems.map((it, idx) => {
                        const liveMatch = liveItems.find(l => Number(l.pallet_id) === Number(it.pallet_id));
                        return (
                          <div key={`${it.pallet_id}-${idx}`} className="bg-slate-950/75 border border-slate-800 rounded-2xl p-3 space-y-2">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="font-black text-sm text-brand-white">{it.product_name}</div>
                                <div className="text-xs font-mono text-brand-blue font-bold">
                                  SKU: {it.sku}
                                  {it.client_article_number ? ` • Art. Cliente: ${it.client_article_number}` : ''}
                                  {it.client_pallet_number ? ` • Rif. Pal: ${it.client_pallet_number}` : ''}
                                </div>
                              </div>
                              <div className="text-right">
                                <span className="px-2.5 py-1 rounded-xl bg-slate-900 border border-slate-800 text-xs font-black text-emerald-400">
                                  {it.quantity} {it.uom}
                                </span>
                                {it.boxes_breakdown && (
                                  <div className="text-[10px] text-slate-400 mt-0.5">
                                    {typeof it.boxes_breakdown === 'object' ? (it.boxes_breakdown?.label || '') : it.boxes_breakdown}
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                              <div className="bg-slate-900/70 rounded-xl px-2.5 py-1.5">
                                <span className="text-slate-500 block text-[10px]">Lotto</span>
                                <strong className="font-mono text-white">{it.batch || '-'}</strong>
                              </div>
                              <div className="bg-slate-900/70 rounded-xl px-2.5 py-1.5">
                                <span className="text-slate-500 block text-[10px]">Scadenza</span>
                                <strong className="font-mono text-amber-300">
                                  {it.expiration_date ? new Date(it.expiration_date).toLocaleDateString('it-IT') : 'Nessuna'}
                                </strong>
                              </div>
                              <div className="bg-slate-900/70 rounded-xl px-2.5 py-1.5">
                                <span className="text-slate-500 block text-[10px]">Kg Netti / Lordi</span>
                                <strong className="font-mono text-sky-300">
                                  {it.net_weight_kg ?? '-'} / {it.gross_weight_kg ?? '-'} kg
                                </strong>
                              </div>
                              <div className="bg-slate-900/70 rounded-xl px-2.5 py-1.5">
                                <span className="text-slate-500 block text-[10px]">Listino / Stato</span>
                                <strong className="text-slate-200 truncate block">
                                  {it.tariff_plan_name || it.status || '-'}
                                </strong>
                              </div>
                            </div>

                            {(it.notes || it.product_notes || it.is_quarantined || (it.flags && it.flags.length > 0)) && (
                              <div className="flex flex-wrap items-center gap-1.5 text-[11px] pt-0.5">
                                {it.is_quarantined && (
                                  <span className="px-2 py-0.5 rounded bg-rose-500/20 border border-rose-500/40 text-rose-300 font-bold text-[10px] flex items-center gap-1">
                                    <Lock size={10} /> Quarantena: {it.quarantine_reason || 'Sì'}
                                  </span>
                                )}
                                {(Array.isArray(it.flags) ? it.flags : []).map((f, fIdx) => {
                                  const fLabel = typeof f === 'object' ? (f?.label || f?.value || '') : f;
                                  return fLabel ? (
                                    <span key={`${fLabel}-${fIdx}`} className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-bold uppercase">
                                      <Tag size={9} className="inline mr-0.5" /> {fLabel}
                                    </span>
                                  ) : null;
                                })}
                                {(it.notes || it.product_notes) && (
                                  <span className="text-slate-400 italic">Note: {it.notes || it.product_notes}</span>
                                )}
                              </div>
                            )}

                            {liveMatch && (
                              <div className="text-[10px] font-mono text-cyan-300/90 border-t border-slate-800/70 pt-1.5">
                                Attuale in Stock → Q.tà: {liveMatch.quantity} {liveMatch.uom} • Lotto: {liveMatch.batch || '-'} • Netti/Lordi: {liveMatch.net_weight_kg ?? '-'}/{liveMatch.gross_weight_kg ?? '-'} kg
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Tracciabilità Esito & Storico Rettifiche */}
                {(nc.resolved_by || (nc.correction_summary && nc.correction_summary.length > 0)) && (
                  <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-3.5 space-y-2 text-xs">
                    {nc.resolved_by && (
                      <div className="flex flex-wrap items-center gap-2">
                        <History size={14} className="text-brand-blue" />
                        <span className="font-bold text-slate-300">
                          {isAccepted ? 'Accettata' : isRejected ? 'Rifiutata' : 'Gestita'} da{' '}
                          <strong className="text-white">{nc.resolved_by}</strong>
                        </span>
                        {nc.resolved_at && <span className="text-slate-500">({new Date(nc.resolved_at).toLocaleString('it-IT')})</span>}
                        {nc.resolution_notes && (
                          <span className="text-slate-200 bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-lg">
                            Note: {nc.resolution_notes}
                          </span>
                        )}
                      </div>
                    )}

                    {Array.isArray(nc.correction_summary) && nc.correction_summary.length > 0 && (
                      <div className="space-y-1 pt-1">
                        <div className="text-[10px] font-black uppercase text-cyan-400">Rettifiche Applicate in Tracciabilità:</div>
                        {nc.correction_summary.map((cs, cIdx) => (
                          <div key={cIdx} className="text-[11px] font-mono text-slate-300">
                            • [{cs.corrected_by}] {cs.changes?.map(ch => `${ch.field}: "${ch.from}" → "${ch.to}"`).join(' | ')}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Pulsanti Azione */}
                <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => navigate('/desktop/products', { state: { search: nc.pallet_code } })}
                    className="px-3.5 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-bold flex items-center gap-1.5"
                    title="Apri la paletta nella sezione Stock & Prodotti"
                  >
                    <ExternalLink size={14} /> Apri in Stock
                  </button>

                  {canManage && (
                    <>
                      <button
                        type="button"
                        onClick={() => openCorrectionModal(nc)}
                        className="px-4 py-2 rounded-xl bg-brand-blue hover:bg-sky-400 text-brand-black font-black text-xs flex items-center gap-1.5 shadow-[0_0_15px_rgba(14,165,233,0.25)]"
                      >
                        <Wrench size={14} /> Correggi Dati Paletta
                      </button>

                      {nc.status !== 'ACCEPTED' && (
                        <button
                          type="button"
                          onClick={() => { setDecisionModal({ nc, action: 'ACCEPT' }); setDecisionNotes(''); }}
                          className="px-3.5 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500 text-emerald-300 hover:text-brand-black border border-emerald-500/35 font-black text-xs flex items-center gap-1.5 transition-all"
                        >
                          <CheckCircle2 size={14} /> Accetta NC
                        </button>
                      )}

                      {nc.status !== 'REJECTED' && (
                        <button
                          type="button"
                          onClick={() => { setDecisionModal({ nc, action: 'REJECT' }); setDecisionNotes(''); }}
                          className="px-3.5 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500 text-rose-300 hover:text-white border border-rose-500/35 font-black text-xs flex items-center gap-1.5 transition-all"
                        >
                          <XCircle size={14} /> Rifiuta (Elimina)
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modale Accetta / Rifiuta */}
      {decisionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/90 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="text-lg font-black text-brand-white flex items-center gap-2">
              {decisionModal.action === 'ACCEPT' ? (
                <><CheckCircle2 className="text-emerald-400" size={22} /> Accetta Non Conformità</>
              ) : (
                <><XCircle className="text-rose-400" size={22} /> Rifiuta ed Elimina NC</>
              )}
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              {decisionModal.action === 'ACCEPT'
                ? `Confermi l'accettazione di ${decisionModal.nc.nc_code} su paletta ${decisionModal.nc.pallet_code}? Puoi aggiungere note operative opzionali.`
                : `La segnalazione ${decisionModal.nc.nc_code} verrà rimossa dalle segnalazioni aperte ma rimarrà sempre consultabile nello Storico Rifiutate & Audit Logs per tracciabilità.`}
            </p>
            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase mb-1">Note Opzionali</label>
              <textarea
                rows={3}
                value={decisionNotes}
                onChange={e => setDecisionNotes(e.target.value)}
                placeholder={decisionModal.action === 'ACCEPT' ? 'Azioni intraprese, conferma controllo...' : 'Motivo del rifiuto (es. falso allarme, dato già aggiornato)...'}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white outline-none focus:border-brand-blue"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDecisionModal(null)}
                className="px-4 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 text-xs font-bold"
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={savingDecision}
                onClick={handleConfirmDecision}
                className={`px-5 py-2 rounded-xl font-black text-xs ${
                  decisionModal.action === 'ACCEPT'
                    ? 'bg-emerald-500 text-brand-black hover:bg-emerald-400'
                    : 'bg-rose-500 text-white hover:bg-rose-400'
                }`}
              >
                {savingDecision ? 'Salvataggio...' : decisionModal.action === 'ACCEPT' ? 'Conferma Accettazione' : 'Rifiuta & Archivia'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale Rettifica Diretta Dati Paletta */}
      {correctModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/90 backdrop-blur-sm">
          <form onSubmit={handleSaveCorrection} className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 max-w-4xl w-full shadow-2xl max-h-[92vh] flex flex-col gap-4">
            <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-lg font-black text-brand-white flex items-center gap-2">
                  <Wrench className="text-brand-blue" size={20} />
                  Correggi Dati Paletta — {correctModal.nc.pallet_code}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Modifica articolo, lotto, scadenza, quantità, pesi netti/lordi o riferimenti direttamente sullo stock attuale.
                </p>
              </div>
              <button type="button" onClick={() => setCorrectModal(null)} className="p-2 rounded-xl bg-slate-950 text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto space-y-4 pr-1">
              {correctModal.forms.map((f, idx) => (
                <div key={f.pallet_id || idx} className="bg-slate-950/75 border border-slate-800 rounded-2xl p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-black uppercase text-brand-blue">
                      Riga #{idx + 1} • {f.product_name} ({f.sku})
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Cambia Articolo / Prodotto (Catalogo Cliente)</label>
                      <select
                        value={f.product_id}
                        onChange={e => {
                          const val = parseInt(e.target.value, 10);
                          setCorrectModal(prev => ({
                            ...prev,
                            forms: prev.forms.map((row, rIdx) => (rIdx === idx ? { ...row, product_id: val } : row))
                          }));
                        }}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-semibold"
                      >
                        {correctModal.products.length === 0 ? (
                          <option value={f.product_id}>{f.product_name} ({f.sku})</option>
                        ) : correctModal.products.map(p => (
                          <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Oppure Rinomina Articolo Corrente (opz.)</label>
                      <input
                        type="text"
                        value={f.rename_product_name}
                        onChange={e => {
                          const val = e.target.value;
                          setCorrectModal(prev => ({
                            ...prev,
                            forms: prev.forms.map((row, rIdx) => (rIdx === idx ? { ...row, rename_product_name: val } : row))
                          }));
                        }}
                        placeholder={f.product_name}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Lotto</label>
                      <input
                        type="text"
                        value={f.batch}
                        onChange={e => {
                          const val = e.target.value;
                          setCorrectModal(prev => ({
                            ...prev,
                            forms: prev.forms.map((row, rIdx) => (rIdx === idx ? { ...row, batch: val } : row))
                          }));
                        }}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Scadenza</label>
                      <input
                        type="date"
                        value={f.expiration_date}
                        onChange={e => {
                          const val = e.target.value;
                          setCorrectModal(prev => ({
                            ...prev,
                            forms: prev.forms.map((row, rIdx) => (rIdx === idx ? { ...row, expiration_date: val } : row))
                          }));
                        }}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white [color-scheme:dark]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Quantità</label>
                      <input
                        type="number"
                        step="0.01"
                        value={f.quantity}
                        onChange={e => {
                          const val = e.target.value;
                          setCorrectModal(prev => ({
                            ...prev,
                            forms: prev.forms.map((row, rIdx) => (rIdx === idx ? { ...row, quantity: val } : row))
                          }));
                        }}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-emerald-300 font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Pz / Scatola</label>
                      <input
                        type="number"
                        min="1"
                        value={f.units_per_box}
                        onChange={e => {
                          const val = e.target.value;
                          setCorrectModal(prev => ({
                            ...prev,
                            forms: prev.forms.map((row, rIdx) => (rIdx === idx ? { ...row, units_per_box: val } : row))
                          }));
                        }}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-white"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Kili Netti (kg)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={f.net_weight_kg}
                        onChange={e => {
                          const val = e.target.value;
                          setCorrectModal(prev => ({
                            ...prev,
                            forms: prev.forms.map((row, rIdx) => (rIdx === idx ? { ...row, net_weight_kg: val } : row))
                          }));
                        }}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-sky-300 font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Kili Lordi (kg)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={f.gross_weight_kg}
                        onChange={e => {
                          const val = e.target.value;
                          setCorrectModal(prev => ({
                            ...prev,
                            forms: prev.forms.map((row, rIdx) => (rIdx === idx ? { ...row, gross_weight_kg: val } : row))
                          }));
                        }}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-amber-300 font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Rif. Paletta Cliente</label>
                      <input
                        type="text"
                        value={f.client_pallet_number}
                        onChange={e => {
                          const val = e.target.value;
                          setCorrectModal(prev => ({
                            ...prev,
                            forms: prev.forms.map((row, rIdx) => (rIdx === idx ? { ...row, client_pallet_number: val } : row))
                          }));
                        }}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Rif. Articolo Cliente</label>
                      <input
                        type="text"
                        value={f.client_article_number}
                        onChange={e => {
                          const val = e.target.value;
                          setCorrectModal(prev => ({
                            ...prev,
                            forms: prev.forms.map((row, rIdx) => (rIdx === idx ? { ...row, client_article_number: val } : row))
                          }));
                        }}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Listino Prezzi (Fatturazione Paletta)</label>
                    <select
                      value={f.tariff_plan_id ?? ''}
                      onChange={e => {
                        const val = e.target.value;
                        setCorrectModal(prev => ({
                          ...prev,
                          forms: prev.forms.map((row, rIdx) => (rIdx === idx ? { ...row, tariff_plan_id: val } : row))
                        }));
                      }}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-semibold text-white"
                    >
                      <option value="">Listino Predefinito Cliente / Globale</option>
                      {tariffPlans.map(tp => (
                        <option key={tp.id} value={tp.id}>
                          {tp.name}{tp.is_flat_rate ? ' (Fisso Mensile)' : tp.is_default ? ' (Default)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Note Paletta</label>
                    <input
                      type="text"
                      value={f.notes}
                      onChange={e => {
                        const val = e.target.value;
                        setCorrectModal(prev => ({
                          ...prev,
                          forms: prev.forms.map((row, rIdx) => (rIdx === idx ? { ...row, notes: val } : row))
                        }));
                      }}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                    />
                  </div>
                </div>
              ))}

              <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-3.5 space-y-2">
                <label className="flex items-center gap-2 text-xs font-bold text-emerald-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={correctModal.acceptNc}
                    onChange={e => setCorrectModal(prev => ({ ...prev, acceptNc: e.target.checked }))}
                  />
                  Segna automaticamente la Non Conformità come ACCETTATA dopo la rettifica
                </label>
                <input
                  type="text"
                  value={correctModal.resolutionNotes}
                  onChange={e => setCorrectModal(prev => ({ ...prev, resolutionNotes: e.target.value }))}
                  placeholder="Note di chiusura / rettifica opzionali..."
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setCorrectModal(null)}
                className="px-4 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 text-xs font-bold"
              >
                Annulla
              </button>
              <button
                type="submit"
                disabled={savingCorrection}
                className="px-5 py-2 rounded-xl bg-brand-blue hover:bg-sky-400 text-brand-black font-black text-xs"
              >
                {savingCorrection ? 'Salvataggio...' : 'Applica Correzione su Stock'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modale Nuova Segnalazione dal Gestionale */}
      {newNcModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/90 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-xl w-full shadow-2xl max-h-[90vh] flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-brand-white flex items-center gap-2">
                <AlertTriangle className="text-rose-400" size={20} /> Registra Non Conformità
              </h3>
              <button onClick={() => setNewNcModal(false)} className="p-2 rounded-xl bg-slate-950 text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={scanCode}
                onChange={e => setScanCode(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleInspectForNewNc(); }}
                placeholder="Inserisci o spara barcode PAL-..."
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-mono uppercase text-white"
              />
              <button
                type="button"
                disabled={inspectLoading}
                onClick={handleInspectForNewNc}
                className="px-4 py-2.5 rounded-xl bg-brand-blue text-brand-black font-black text-xs"
              >
                {inspectLoading ? '...' : 'Carica Paletta'}
              </button>
            </div>

            {inspectedPallet && (
              <div className="overflow-y-auto space-y-3 pr-1">
                <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 text-xs space-y-1">
                  <div className="font-mono font-black text-brand-blue">{inspectedPallet.pallet_code} • {inspectedPallet.customer_name}</div>
                  {inspectedPallet.items.map(it => (
                    <div key={it.pallet_id} className="text-slate-300">
                      • <strong>{it.product_name}</strong> ({it.sku}) — {it.quantity} {it.uom} • Lotto: {it.batch || '-'}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {CAUSES_CATALOG.map(c => {
                    const active = newCauses.includes(c.code);
                    return (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => setNewCauses(prev => prev.includes(c.code) ? prev.filter(x => x !== c.code) : [...prev, c.code])}
                        className={`text-left px-3 py-2 rounded-xl border text-xs font-bold ${
                          active ? 'bg-rose-500/20 border-rose-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400'
                        }`}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>

                <textarea
                  rows={2}
                  value={newNotes}
                  onChange={e => setNewNotes(e.target.value)}
                  placeholder="Note aggiuntive..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white"
                />

                <button
                  type="button"
                  disabled={submittingNew}
                  onClick={handleCreateDesktopNc}
                  className="w-full py-3 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-black text-xs flex items-center justify-center gap-2"
                >
                  <Send size={15} /> {submittingNew ? 'Invio...' : 'Invia Segnalazione Non Conformità'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NonConformities;
