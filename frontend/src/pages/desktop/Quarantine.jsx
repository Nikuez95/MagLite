import { appAlert } from "../../utils/alerts.js";
import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import {
  ShieldAlert, ShieldCheck, Lock, Unlock, Search, Plus, AlertTriangle,
  Clock, User, Package, MapPin, FileText, CheckCircle2, X, Building2, Filter
} from 'lucide-react';
import { io } from 'socket.io-client';
import { hasPerm, canTouchCustomer } from '../../utils/permissions';

export const DEFAULT_BLOCK_REASONS = [
  'Controllo Qualità in corso',
  'Merce danneggiata / Imballo compromesso',
  'Non conformità lotto fornitore',
  'Blocco cautelativo disposto dal cliente',
  'Verifica integrità / Anomalia scadenza'
];

export const DEFAULT_UNBLOCK_REASONS = [
  'Controllo Qualità superato - Merce conforme',
  'Autorizzazione allo sblocco dal cliente',
  'Riconfezionamento / Bonifica completata',
  'Errore operativo di blocco'
];

const Quarantine = () => {
  const [activeTab, setActiveTab] = useState('active'); // 'active' | 'history'
  const [activePallets, setActivePallets] = useState([]);
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState({ activeCount: 0, activeQuantity: 0, totalBlocks: 0, totalReleased: 0, customersAffected: 0 });
  const [loading, setLoading] = useState(true);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL' | 'QUARANTINED' | 'RELEASED'

  // Modal per Sblocco da Quarantena
  const [unblockModal, setUnblockModal] = useState({
    show: false,
    palletIds: [],
    palletCode: '',
    productName: '',
    reasonPreset: DEFAULT_UNBLOCK_REASONS[0],
    customReason: '',
    notes: ''
  });

  // Modal per Nuovo Blocco in Quarantena (da lista giacenze)
  const [blockModal, setBlockModal] = useState({
    show: false,
    searchStock: '',
    selectedPalletIds: [],
    reasonPreset: DEFAULT_BLOCK_REASONS[0],
    customReason: '',
    notes: ''
  });
  const [allStockPallets, setAllStockPallets] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const canManageQuarantine = hasPerm('quarantine_manage');
  const getToken = () => localStorage.getItem('maglite_token');

  const fetchQuarantineData = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/quarantine`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setActivePallets(res.data.activePallets || []);
      setLogs(res.data.logs || []);
      setStats(res.data.stats || { activeCount: 0, activeQuantity: 0, totalBlocks: 0, totalReleased: 0, customersAffected: 0 });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuarantineData();
    const socket = io(`http://${window.location.hostname}:3000`);
    socket.on('quarantine_updated', fetchQuarantineData);
    socket.on('stow_updated', fetchQuarantineData);
    return () => socket.disconnect();
  }, []);

  const openNewBlockModal = async () => {
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/pallets/inventory`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      const available = (res.data || []).filter(p => !p.is_quarantined && canTouchCustomer(p.customer_id));
      setAllStockPallets(available);
      setBlockModal({
        show: true,
        searchStock: '',
        selectedPalletIds: [],
        reasonPreset: DEFAULT_BLOCK_REASONS[0],
        customReason: '',
        notes: ''
      });
    } catch (err) {
      appAlert('Errore caricamento palette disponibili');
    }
  };

  const handleConfirmBlock = async (e) => {
    e.preventDefault();
    if (blockModal.selectedPalletIds.length === 0 || isProcessing) {
      appAlert('Seleziona almeno una paletta da porre in quarantena.');
      return;
    }
    const finalReason = blockModal.reasonPreset === 'CUSTOM'
      ? blockModal.customReason.trim()
      : blockModal.reasonPreset;

    if (!finalReason) {
      appAlert('Inserisci il motivo di blocco in quarantena.');
      return;
    }

    setIsProcessing(true);
    try {
      await axios.post(
        `http://${window.location.hostname}:3000/api/quarantine/block`,
        {
          pallet_ids: blockModal.selectedPalletIds,
          reason: finalReason,
          notes: blockModal.notes
        },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      setBlockModal({ ...blockModal, show: false });
      await fetchQuarantineData();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante il blocco in quarantena');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmUnblock = async (e) => {
    e.preventDefault();
    if (isProcessing) return;
    const finalReason = unblockModal.reasonPreset === 'CUSTOM'
      ? unblockModal.customReason.trim()
      : unblockModal.reasonPreset;

    if (!finalReason) {
      appAlert('Specifica il motivo di sblocco.');
      return;
    }

    setIsProcessing(true);
    try {
      await axios.post(
        `http://${window.location.hostname}:3000/api/quarantine/unblock`,
        {
          pallet_ids: unblockModal.palletIds,
          pallet_code: unblockModal.palletCode,
          unblock_reason: finalReason,
          unblock_notes: unblockModal.notes
        },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      setUnblockModal({ ...unblockModal, show: false });
      await fetchQuarantineData();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante lo sblocco');
    } finally {
      setIsProcessing(false);
    }
  };

  const filteredActive = useMemo(() => {
    if (!searchTerm.trim()) return activePallets;
    const q = searchTerm.toLowerCase();
    return activePallets.filter(p =>
      (p.pallet_code || '').toLowerCase().includes(q) ||
      (p.product_name || '').toLowerCase().includes(q) ||
      (p.customer_name || '').toLowerCase().includes(q) ||
      (p.batch || '').toLowerCase().includes(q) ||
      (p.quarantine_reason || '').toLowerCase().includes(q)
    );
  }, [activePallets, searchTerm]);

  const filteredLogs = useMemo(() => {
    return logs.filter(l => {
      if (statusFilter !== 'ALL' && l.status !== statusFilter) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        return (
          (l.pallet_code || '').toLowerCase().includes(q) ||
          (l.product_name || '').toLowerCase().includes(q) ||
          (l.customer_name || '').toLowerCase().includes(q) ||
          (l.batch || '').toLowerCase().includes(q) ||
          (l.block_reason || '').toLowerCase().includes(q) ||
          (l.unblock_reason || '').toLowerCase().includes(q) ||
          (l.blocked_by || '').toLowerCase().includes(q) ||
          (l.unblocked_by || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [logs, statusFilter, searchTerm]);

  const filteredStockForModal = useMemo(() => {
    if (!blockModal.searchStock.trim()) return allStockPallets.slice(0, 60);
    const q = blockModal.searchStock.toLowerCase();
    return allStockPallets.filter(p =>
      (p.pallet_code || '').toLowerCase().includes(q) ||
      (p.product_name || '').toLowerCase().includes(q) ||
      (p.customer_name || '').toLowerCase().includes(q) ||
      (p.batch || '').toLowerCase().includes(q) ||
      (p.location || '').toLowerCase().includes(q)
    ).slice(0, 60);
  }, [allStockPallets, blockModal.searchStock]);

  return (
    <div className="max-w-7xl mx-auto pb-16 space-y-6">
      {/* Header & KPI */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-rose-950/20 border border-slate-800 rounded-3xl p-6 md:p-8 shadow-2xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="p-3 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-400">
              <ShieldAlert size={28} />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black text-brand-white tracking-tight">
                Quarantena & Registro Qualità
              </h1>
              <p className="text-slate-400 text-sm">
                Blocco cautelativo merce: i bancali in quarantena non possono essere spostati, spediti o eliminati fino allo sblocco.
              </p>
            </div>
          </div>

          {canManageQuarantine && (
            <button
              onClick={openNewBlockModal}
              className="px-5 py-3 bg-rose-600 hover:bg-rose-500 text-white font-black rounded-2xl text-sm flex items-center gap-2 transition-all shadow-[0_0_25px_rgba(225,29,72,0.35)]"
            >
              <Lock size={17} />
              <span>+ Metti Merce in Quarantena</span>
            </button>
          )}
        </div>

        {/* KPI Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-slate-800/80">
          <div className="bg-slate-950/70 border border-rose-500/30 rounded-2xl p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-rose-300">Palette Bloccate Ora</div>
            <div className="text-3xl font-black text-rose-400 mt-1">{stats.activeCount}</div>
            <div className="text-xs text-slate-400 mt-1">In stato di quarantena attiva</div>
          </div>

          <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Unità / Q.tà Bloccata</div>
            <div className="text-3xl font-black text-amber-400 mt-1">{stats.activeQuantity}</div>
            <div className="text-xs text-slate-500 mt-1">Non prelevabili né spedibili</div>
          </div>

          <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Sblocchi Completati</div>
            <div className="text-3xl font-black text-emerald-400 mt-1">{stats.totalReleased}</div>
            <div className="text-xs text-slate-500 mt-1">Su {stats.totalBlocks} blocchi registrati</div>
          </div>

          <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Clienti Coinvolti</div>
            <div className="text-3xl font-black text-brand-blue mt-1">{stats.customersAffected}</div>
            <div className="text-xs text-slate-500 mt-1">Con merce attualmente bloccata</div>
          </div>
        </div>

        {/* Tabs & Search */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mt-6">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setActiveTab('active')}
              className={`px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all ${
                activeTab === 'active'
                  ? 'bg-rose-600 text-white shadow-lg'
                  : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              <Lock size={15} />
              <span>Attualmente in Quarantena ({activePallets.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('history')}
              className={`px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all ${
                activeTab === 'history'
                  ? 'bg-brand-blue text-brand-black shadow-lg'
                  : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              <FileText size={15} />
              <span>Registro Storico Blocchi & Sblocchi ({logs.length})</span>
            </button>
          </div>

          <div className="relative w-full md:w-80">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Cerca paletta, prodotto, lotto, motivo..."
              className="w-full bg-slate-950 border border-slate-800 text-brand-white text-xs rounded-xl pl-10 pr-4 py-2.5 focus:border-brand-blue"
            />
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* TAB 1: MERCE ATTUALMENTE IN QUARANTENA                            */}
      {/* ================================================================= */}
      {activeTab === 'active' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 shadow-xl space-y-4">
          {filteredActive.length === 0 ? (
            <div className="text-center py-16 space-y-3">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto">
                <ShieldCheck size={32} />
              </div>
              <h3 className="text-xl font-bold text-brand-white">Nessuna paletta in quarantena</h3>
              <p className="text-slate-400 text-sm max-w-md mx-auto">
                Tutta la merce in magazzino è regolarmente operativa e disponibile per movimentazione e spedizione.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {filteredActive.map(pal => {
                const canOperateCustomer = canTouchCustomer(pal.customer_id);
                return (
                  <div
                    key={pal.id}
                    className="bg-slate-950/90 border-2 border-rose-500/40 rounded-2xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-[0_0_25px_rgba(244,63,94,0.08)]"
                  >
                    <div className="space-y-2 flex-1">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="px-3 py-1 rounded-xl bg-rose-600 text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
                          <Lock size={13} /> IN QUARANTENA
                        </span>
                        <span className="font-mono text-sm font-black text-brand-blue bg-slate-900 px-3 py-1 rounded-xl border border-slate-800">
                          {pal.pallet_code}
                        </span>
                        <span className="px-2.5 py-1 rounded-xl bg-slate-900 text-slate-300 border border-slate-800 text-xs font-bold flex items-center gap-1">
                          <MapPin size={12} className="text-amber-400" /> {pal.location || 'IN ATTESA'}
                        </span>
                        <span className="px-2.5 py-1 rounded-xl bg-slate-900 text-sky-300 border border-slate-800 text-xs font-bold flex items-center gap-1">
                          <Building2 size={12} /> {pal.customer_name}
                        </span>
                      </div>

                      <div className="text-lg font-black text-brand-white">
                        {pal.product_name}{' '}
                        <span className="text-sm font-mono text-emerald-400 ml-2">
                          ({parseFloat(pal.quantity)} {pal.uom || 'Pezzi'})
                        </span>
                        {pal.batch && (
                          <span className="text-xs font-mono text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded ml-2">
                            Lotto: {pal.batch}
                          </span>
                        )}
                      </div>

                      <div className="bg-rose-950/30 border border-rose-500/30 rounded-xl p-3 text-xs space-y-1">
                        <div className="font-bold text-rose-300">
                          Motivo del Blocco: <span className="text-white">{pal.quarantine_reason || 'Controllo Qualità'}</span>
                        </div>
                        {pal.quarantine_notes && (
                          <div className="text-slate-300">Note: {pal.quarantine_notes}</div>
                        )}
                        <div className="text-slate-400 flex items-center gap-4 pt-1">
                          <span>Bloccato da: <strong className="text-brand-white">{pal.quarantined_by || 'Sistema'}</strong></span>
                          {pal.quarantined_at && (
                            <span>Data: <strong className="text-brand-white">{new Date(pal.quarantined_at).toLocaleString('it-IT')}</strong></span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0 flex flex-wrap items-center gap-2">
                      <a
                        href={`http://${window.location.hostname}:3000/api/quarantine/report/${pal.id}/pdf?token=${getToken()}`}
                        target="_blank"
                        rel="noreferrer"
                        className="w-full sm:w-auto px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all border border-slate-700 shadow"
                        title="Scarica Verbale Ufficiale Non Conformità PDF"
                      >
                        <FileText size={16} className="text-rose-400" />
                        <span>Verbale PDF</span>
                      </a>

                      {canManageQuarantine && canOperateCustomer && (
                        <button
                          onClick={() =>
                            setUnblockModal({
                              show: true,
                              palletIds: [pal.id],
                              palletCode: pal.pallet_code,
                              productName: pal.product_name,
                              reasonPreset: DEFAULT_UNBLOCK_REASONS[0],
                              customReason: '',
                              notes: ''
                            })
                          }
                          className="w-full sm:w-auto px-5 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-lg"
                        >
                          <Unlock size={16} />
                          <span>Sblocca</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 2: REGISTRO STORICO BLOCCHI & SBLOCCHI                        */}
      {/* ================================================================= */}
      {activeTab === 'history' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 shadow-xl space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-lg font-black text-brand-white">Cronologia Completa Quarantene</h2>
            <div className="flex items-center gap-2">
              {['ALL', 'QUARANTINED', 'RELEASED'].map(st => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                    statusFilter === st
                      ? 'bg-brand-blue text-brand-black'
                      : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-white'
                  }`}
                >
                  {st === 'ALL' ? 'Tutti' : st === 'QUARANTINED' ? '🔒 Ancora Bloccati' : '✅ Sbloccati'}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] uppercase tracking-wider text-slate-400">
                  <th className="py-3 px-3">Stato</th>
                  <th className="py-3 px-3">Paletta & Posizione</th>
                  <th className="py-3 px-3">Cliente & Articolo</th>
                  <th className="py-3 px-3">Dettagli Blocco (Quarantena)</th>
                  <th className="py-3 px-3">Dettagli Sblocco (Rilascio)</th>
                  <th className="py-3 px-3 text-right">Verbale</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {filteredLogs.map(log => {
                  const isReleased = log.status === 'RELEASED';
                  return (
                    <tr key={log.id} className="hover:bg-slate-800/30">
                      <td className="py-4 px-3">
                        {isReleased ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-black">
                            <Unlock size={12} /> SBLOCCATO
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/20 text-rose-400 border border-rose-500/40 font-black">
                            <Lock size={12} /> BLOCCATO
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-3">
                        <div className="font-mono font-black text-brand-blue">{log.pallet_code}</div>
                        <div className="text-slate-400 mt-0.5">Pos: {log.location || 'IN ATTESA'}</div>
                      </td>
                      <td className="py-4 px-3">
                        <div className="font-bold text-brand-white">{log.product_name}</div>
                        <div className="text-slate-400">
                          {log.customer_name} • Q.tà: <strong>{parseFloat(log.quantity)} {log.uom}</strong>
                          {log.batch && ` • Lotto: ${log.batch}`}
                        </div>
                      </td>
                      <td className="py-4 px-3">
                        <div className="font-bold text-rose-300">{log.block_reason}</div>
                        {log.block_notes && <div className="text-slate-400 italic">"{log.block_notes}"</div>}
                        <div className="text-[11px] text-slate-500 mt-1">
                          Da: <strong className="text-slate-300">{log.blocked_by}</strong> il {new Date(log.blocked_at).toLocaleString('it-IT')}
                        </div>
                      </td>
                      <td className="py-4 px-3">
                        {isReleased ? (
                          <div>
                            <div className="font-bold text-emerald-300">{log.unblock_reason}</div>
                            {log.unblock_notes && <div className="text-slate-400 italic">"{log.unblock_notes}"</div>}
                            <div className="text-[11px] text-slate-500 mt-1">
                              Da: <strong className="text-slate-300">{log.unblocked_by}</strong> il {log.unblocked_at ? new Date(log.unblocked_at).toLocaleString('it-IT') : '-'}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-500 italic">Ancora in quarantena</span>
                        )}
                      </td>
                      <td className="py-4 px-3 text-right">
                        <a
                          href={`http://${window.location.hostname}:3000/api/quarantine/report/${log.id}/pdf?token=${getToken()}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 text-[11px] font-bold"
                          title="Scarica Verbale Non Conformità PDF"
                        >
                          <FileText size={13} className="text-rose-400" /> PDF
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL NUOVO BLOCCO IN QUARANTENA                                  */}
      {/* ================================================================= */}
      {blockModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/90 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h2 className="text-xl font-black text-brand-white flex items-center gap-2">
                <Lock className="text-rose-500" /> Metti Merce in Quarantena
              </h2>
              <button onClick={() => setBlockModal({ ...blockModal, show: false })} className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleConfirmBlock} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  1. Cerca e Seleziona Palette da Bloccare ({blockModal.selectedPalletIds.length} selezionate)
                </label>
                <input
                  type="text"
                  value={blockModal.searchStock}
                  onChange={e => setBlockModal({ ...blockModal, searchStock: e.target.value })}
                  placeholder="Cerca per codice paletta, articolo, lotto o cliente..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-brand-white mb-2"
                />
                <div className="max-h-52 overflow-y-auto bg-slate-950 border border-slate-800 rounded-2xl divide-y divide-slate-900">
                  {filteredStockForModal.map(p => {
                    const isSel = blockModal.selectedPalletIds.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setBlockModal(prev => ({
                            ...prev,
                            selectedPalletIds: isSel
                              ? prev.selectedPalletIds.filter(id => id !== p.id)
                              : [...prev.selectedPalletIds, p.id]
                          }));
                        }}
                        className={`w-full p-3 text-left flex items-center justify-between gap-3 transition-colors ${
                          isSel ? 'bg-rose-950/40 text-rose-200' : 'hover:bg-slate-900 text-slate-300'
                        }`}
                      >
                        <div className="min-w-0 text-xs">
                          <div className="font-bold truncate">
                            <span className="font-mono text-brand-blue mr-2">{p.pallet_code}</span>
                            {p.product_name}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {p.customer_name} • Lotto: {p.batch || '-'} • Q.tà: {parseFloat(p.quantity)} • Pos: {p.location || 'IN ATTESA'}
                          </div>
                        </div>
                        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black ${
                          isSel ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-400'
                        }`}>
                          {isSel ? 'SELEZIONATA' : 'Seleziona'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  2. Motivo del Blocco in Quarantena *
                </label>
                <div className="space-y-2">
                  {DEFAULT_BLOCK_REASONS.map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setBlockModal({ ...blockModal, reasonPreset: r })}
                      className={`w-full p-3 rounded-xl border text-left text-xs font-bold transition-all ${
                        blockModal.reasonPreset === r
                          ? 'bg-rose-950/50 border-rose-500 text-rose-200'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setBlockModal({ ...blockModal, reasonPreset: 'CUSTOM' })}
                    className={`w-full p-3 rounded-xl border text-left text-xs font-bold transition-all ${
                      blockModal.reasonPreset === 'CUSTOM'
                        ? 'bg-rose-950/50 border-rose-500 text-rose-200'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    ✏️ Altro motivo (Scrivi liberamente)...
                  </button>
                </div>

                {blockModal.reasonPreset === 'CUSTOM' && (
                  <input
                    type="text"
                    required
                    value={blockModal.customReason}
                    onChange={e => setBlockModal({ ...blockModal, customReason: e.target.value })}
                    placeholder="Specifica il motivo di blocco..."
                    className="w-full mt-2 bg-slate-950 border border-rose-500/50 rounded-xl p-3 text-sm text-brand-white"
                  />
                )}
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Note Aggiuntive (Opzionale)
                </label>
                <textarea
                  rows={2}
                  value={blockModal.notes}
                  onChange={e => setBlockModal({ ...blockModal, notes: e.target.value })}
                  placeholder="Dettagli ispezione, riferimento verbale o disposizioni..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-brand-white"
                />
              </div>

              <div className="flex gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setBlockModal({ ...blockModal, show: false })}
                  className="flex-1 py-3 bg-slate-800 text-brand-white font-bold rounded-xl"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={isProcessing || blockModal.selectedPalletIds.length === 0}
                  className="flex-1 py-3 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white font-black rounded-xl shadow-lg"
                >
                  {isProcessing ? 'Blocco in corso...' : 'Conferma Blocco Quarantena'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL SBLOCCO DA QUARANTENA                                       */}
      {/* ================================================================= */}
      {unblockModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/90 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 max-w-lg w-full shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <h2 className="text-xl font-black text-brand-white flex items-center gap-2">
                  <Unlock className="text-emerald-400" /> Sblocca dalla Quarantena
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Paletta: <strong className="text-brand-blue font-mono">{unblockModal.palletCode}</strong> ({unblockModal.productName})
                </p>
              </div>
              <button onClick={() => setUnblockModal({ ...unblockModal, show: false })} className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleConfirmUnblock} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Motivo dello Sblocco *
                </label>
                <div className="space-y-2">
                  {DEFAULT_UNBLOCK_REASONS.map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setUnblockModal({ ...unblockModal, reasonPreset: r })}
                      className={`w-full p-3 rounded-xl border text-left text-xs font-bold transition-all ${
                        unblockModal.reasonPreset === r
                          ? 'bg-emerald-950/50 border-emerald-500 text-emerald-200'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setUnblockModal({ ...unblockModal, reasonPreset: 'CUSTOM' })}
                    className={`w-full p-3 rounded-xl border text-left text-xs font-bold transition-all ${
                      unblockModal.reasonPreset === 'CUSTOM'
                        ? 'bg-emerald-950/50 border-emerald-500 text-emerald-200'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    ✏️ Altro motivo (Scrivi liberamente)...
                  </button>
                </div>

                {unblockModal.reasonPreset === 'CUSTOM' && (
                  <input
                    type="text"
                    required
                    value={unblockModal.customReason}
                    onChange={e => setUnblockModal({ ...unblockModal, customReason: e.target.value })}
                    placeholder="Specifica il motivo di sblocco..."
                    className="w-full mt-2 bg-slate-950 border border-emerald-500/50 rounded-xl p-3 text-sm text-brand-white"
                  />
                )}
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Note di Rilascio (Opzionale)
                </label>
                <textarea
                  rows={2}
                  value={unblockModal.notes}
                  onChange={e => setUnblockModal({ ...unblockModal, notes: e.target.value })}
                  placeholder="Eventuali note di collaudo o verifica..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-brand-white"
                />
              </div>

              <div className="flex gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setUnblockModal({ ...unblockModal, show: false })}
                  className="flex-1 py-3 bg-slate-800 text-brand-white font-bold rounded-xl"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={isProcessing}
                  className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-xl shadow-lg"
                >
                  {isProcessing ? 'Sblocco...' : 'Conferma Sblocco'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Quarantine;
