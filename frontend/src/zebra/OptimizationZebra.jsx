import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import {
  Sparkles, ArrowRight, GitMerge, Boxes, RefreshCw, Search, X,
  CheckCircle2, Lock, ArrowDownUp, MapPin, ChevronRight, ArrowLeft, Award
} from 'lucide-react';
import useBarcodeScanner from '../hooks/useBarcodeScanner';
import ZebraErrorModal from './ZebraErrorModal';

const scoreTheme = (score) => {
  if (score >= 90) return { text: 'text-emerald-400', bar: 'bg-emerald-500', badge: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' };
  if (score >= 70) return { text: 'text-amber-400', bar: 'bg-amber-500', badge: 'bg-amber-500/15 border-amber-500/40 text-amber-300' };
  return { text: 'text-rose-400', bar: 'bg-rose-500', badge: 'bg-rose-500/15 border-rose-500/40 text-rose-300' };
};

const OptimizationZebra = () => {
  const [tasks, setTasks] = useState([]);
  const [warehouseScore, setWarehouseScore] = useState(100);
  const [zoneScores, setZoneScores] = useState([]);
  const [summary, setSummary] = useState({
    totalTasks: 0,
    reorderCount: 0,
    mergeSameBatchCount: 0,
    fragmentConsolidateCount: 0,
    excludedFreeLocationPallets: 0,
    warehouseScore: 100
  });
  const [requirePins, setRequirePins] = useState(true);
  const [loading, setLoading] = useState(true);

  const [selectedZone, setSelectedZone] = useState(null);
  const [zoneSearch, setZoneSearch] = useState('');
  const [taskSearch, setTaskSearch] = useState('');
  const [filterType, setFilterType] = useState('ALL');

  const [activeTask, setActiveTask] = useState(null);
  const [pinInput, setPinInput] = useState('');
  const [executing, setExecuting] = useState(false);
  const [successMsg, setSuccessMsg] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  const getToken = () => localStorage.getItem('maglite_token');

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/pallets/optimization/tasks`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setTasks(res.data?.tasks || []);
      setWarehouseScore(res.data?.warehouseScore ?? res.data?.summary?.warehouseScore ?? 100);
      setZoneScores(res.data?.zoneScores || []);
      setSummary(res.data?.summary || {
        totalTasks: 0, reorderCount: 0, mergeSameBatchCount: 0, fragmentConsolidateCount: 0, excludedFreeLocationPallets: 0, warehouseScore: 100
      });
      if (typeof res.data?.requirePins === 'boolean') {
        setRequirePins(res.data.requirePins);
      }
    } catch (err) {
      setErrorMsg(err.response?.data?.error || 'Errore caricamento task ottimizzazione');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    const socket = io(`http://${window.location.hostname}:3000`);
    const refresh = () => fetchTasks();
    socket.on('inventory_updated', refresh);
    socket.on('stow_updated', refresh);
    socket.on('locations_updated', refresh);
    socket.on('outbound_updated', refresh);
    return () => {
      socket.off('inventory_updated', refresh);
      socket.off('stow_updated', refresh);
      socket.off('locations_updated', refresh);
      socket.off('outbound_updated', refresh);
      socket.disconnect();
    };
  }, [fetchTasks]);

  const needsPinForTask = (task) => {
    if (!requirePins || !task) return false;
    if (task.action_type === 'MOVE') return true;
    if (task.action_type === 'CONSOLIDATE_FRAGMENTS' && task.needs_relocation) return true;
    return false;
  };

  const executeTask = async (task, enteredPin = '') => {
    if (!task || executing) return;
    if (needsPinForTask(task) && String(enteredPin || '').trim().length < 3) {
      setErrorMsg('Inserisci il PIN a 3 cifre dello scaffale di destinazione.');
      return;
    }

    setExecuting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const payload = {
        action_type: task.action_type,
        pin: enteredPin || undefined
      };

      if (task.action_type === 'MOVE') {
        payload.pallet_code = task.pallet_code;
        payload.to_location = task.to_location;
      } else {
        payload.source_codes = (task.sources || []).map(s => s.pallet_code);
        payload.target_code = task.target_pallet_code;
        payload.target_location = task.target_location;
      }

      const res = await axios.post(`http://${window.location.hostname}:3000/api/pallets/optimization/execute`, payload, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });

      setActiveTask(null);
      setPinInput('');
      setSuccessMsg(res.data?.message || 'Task completata con successo!');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      await fetchTasks();
    } catch (err) {
      setPinInput('');
      setErrorMsg(err.response?.data?.error || 'Errore durante esecuzione task');
    } finally {
      setExecuting(false);
    }
  };

  useBarcodeScanner((barcode) => {
    const code = String(barcode || '').trim().toUpperCase();
    if (!code || activeTask) return;
    const match = tasks.find(t =>
      t.pallet_code === code ||
      t.target_pallet_code === code ||
      (t.sources || []).some(s => s.pallet_code === code)
    );
    if (match) {
      if (match.zone) setSelectedZone(match.zone);
      setPinInput('');
      setActiveTask(match);
    }
  });

  const currentZoneInfo = useMemo(() => {
    if (!selectedZone) return null;
    return zoneScores.find(z => z.zone === selectedZone) || {
      zone: selectedZone,
      score: 100,
      tasksCount: tasks.filter(t => t.zone === selectedZone).length,
      palletCount: 0
    };
  }, [selectedZone, zoneScores, tasks]);

  const zoneTasks = useMemo(() => {
    if (!selectedZone) return [];
    return tasks.filter(t => String(t.zone || '').toUpperCase() === selectedZone.toUpperCase());
  }, [tasks, selectedZone]);

  const zoneCounts = useMemo(() => ({
    ALL: zoneTasks.length,
    REORDER_SLOTTING: zoneTasks.filter(t => t.type === 'REORDER_SLOTTING').length,
    MERGE_SAME_BATCH: zoneTasks.filter(t => t.type === 'MERGE_SAME_BATCH').length,
    CONSOLIDATE_FRAGMENTS: zoneTasks.filter(t => t.type === 'CONSOLIDATE_FRAGMENTS').length
  }), [zoneTasks]);

  const filteredTasks = useMemo(() => {
    const q = taskSearch.trim().toLowerCase();
    return zoneTasks.filter(t => {
      if (filterType !== 'ALL' && t.type !== filterType) return false;
      if (!q) return true;
      const haystack = [
        t.title,
        t.subtitle,
        t.reason,
        t.pallet_code,
        t.target_pallet_code,
        t.from_location,
        t.to_location,
        t.target_location,
        t.product_name,
        t.sku,
        t.batch,
        t.customer_name,
        ...(t.sources || []).flatMap(s => [s.pallet_code, s.location, s.items_summary])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [zoneTasks, filterType, taskSearch]);

  const badgeForType = (type) => {
    if (type === 'MERGE_SAME_BATCH') {
      return { label: 'UNISCI LOTTO', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40', icon: GitMerge };
    }
    if (type === 'CONSOLIDATE_FRAGMENTS') {
      return { label: 'FRAMMENTA / ACCORPA', cls: 'bg-purple-500/20 text-purple-300 border-purple-500/40', icon: Boxes };
    }
    return { label: 'RIORDINO ABC', cls: 'bg-sky-500/20 text-sky-300 border-sky-500/40', icon: ArrowDownUp };
  };

  const wTheme = scoreTheme(warehouseScore);

  return (
    <div className="flex-1 p-4 flex flex-col w-full max-w-md mx-auto overflow-y-auto">
      <ZebraErrorModal message={errorMsg} title="Errore Task" onClose={() => setErrorMsg(null)} />

      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-xl font-black text-brand-white flex items-center gap-2">
            <Sparkles size={22} className="text-purple-400" />
            Task Ottimizzazione
          </h2>
          <p className="text-[11px] text-slate-400 font-semibold mt-0.5">
            {selectedZone ? `Area selezionata: ${selectedZone}` : 'Seleziona una zona / area per iniziare'}
          </p>
        </div>
        <button
          onClick={fetchTasks}
          disabled={loading}
          className="p-2.5 rounded-2xl bg-slate-900 border border-slate-800 text-brand-blue active:scale-95"
          title="Ricalcola Task"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {successMsg && (
        <div className="mb-3 p-3.5 rounded-2xl border bg-emerald-500/15 border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center justify-between gap-2 animate-fade-in-up">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-200 hover:text-white"><X size={15} /></button>
        </div>
      )}

      {/* STEP 1: SCELTA ZONA + PUNTEGGIO MAGAZZINO E ZONE */}
      {!selectedZone ? (
        <div className="space-y-3 pb-6">
          {/* Card Punteggio Globale Magazzino */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 shadow-lg space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Award size={20} className={wTheme.text} />
                <span className="text-xs font-black uppercase tracking-wider text-slate-300">Punteggio Magazzino</span>
              </div>
              <span className={`text-2xl font-black ${wTheme.text}`}>{warehouseScore}%</span>
            </div>
            <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${wTheme.bar}`} style={{ width: `${warehouseScore}%` }} />
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold">
              <span>{summary.totalTasks} task totali rilevate</span>
              <span>{zoneScores.length} zone mappate</span>
            </div>
            {summary.excludedFreeLocationPallets > 0 && (
              <div className="pt-2 border-t border-slate-800 text-[10px] text-slate-500 flex items-center gap-1.5">
                <Lock size={11} />
                <span>{summary.excludedFreeLocationPallets} palette in Posizioni Libere escluse dal calcolo.</span>
              </div>
            )}
          </div>

          {/* Ricerca Zona */}
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Cerca zona / area (es. AREA1)..."
              value={zoneSearch}
              onChange={(e) => setZoneSearch(e.target.value.toUpperCase())}
              className="w-full bg-slate-900 border border-slate-800 rounded-2xl pl-9 pr-8 py-2.5 text-sm font-bold text-brand-white uppercase focus:border-purple-400 focus:outline-none"
            />
            {zoneSearch && (
              <button onClick={() => setZoneSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                <X size={15} />
              </button>
            )}
          </div>

          {loading ? (
            <div className="p-8 text-center text-slate-500 font-bold text-sm">Analisi zone in corso...</div>
          ) : (
            <div className="space-y-2.5">
              {zoneScores
                .filter(z => z.zone.includes(zoneSearch.trim()))
                .sort((a, b) => (b.tasksCount - a.tasksCount) || a.zone.localeCompare(b.zone))
                .map(z => {
                  const zTheme = scoreTheme(z.score);
                  return (
                    <button
                      key={z.zone}
                      type="button"
                      onClick={() => {
                        setSelectedZone(z.zone);
                        setFilterType('ALL');
                        setTaskSearch('');
                      }}
                      className="w-full text-left bg-slate-900 border-2 border-slate-800 active:border-purple-400 rounded-3xl p-4 shadow-lg transition-all space-y-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-lg font-black text-brand-white">Zona: <span className="text-brand-blue">{z.zone}</span></div>
                          <div className="text-[11px] text-slate-400 font-semibold">
                            {z.palletCount} palette · {z.occupiedSlots}/{z.totalSlots} scaffali occ.
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2.5 py-1 rounded-xl text-xs font-black border ${zTheme.badge}`}>
                            {z.score}%
                          </span>
                          <ChevronRight size={18} className="text-slate-500" />
                        </div>
                      </div>

                      <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${zTheme.bar}`} style={{ width: `${z.score}%` }} />
                      </div>

                      <div className="flex items-center justify-between text-[11px] font-bold">
                        {z.tasksCount > 0 ? (
                          <span className="text-purple-300">
                            {z.tasksCount} task ({z.reorderCount} ABC · {z.mergeSameBatchCount} Lotti · {z.fragmentConsolidateCount} Scat.)
                          </span>
                        ) : (
                          <span className="text-emerald-400">✓ Zona al 100% ottimizzata</span>
                        )}
                      </div>
                    </button>
                  );
                })}
            </div>
          )}
        </div>
      ) : (
        /* STEP 2: TASK DELLA ZONA SELEZIONATA */
        <div className="space-y-3 pb-6">
          {/* Barra zona + punteggio */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => { setSelectedZone(null); setTaskSearch(''); setFilterType('ALL'); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-bold text-slate-300 active:scale-95"
            >
              <ArrowLeft size={15} /> Zone
            </button>
            <div className="text-center">
              <div className="text-xs font-black text-brand-blue">{selectedZone}</div>
              <div className="text-[10px] text-slate-400 font-semibold">{zoneTasks.length} task in area</div>
            </div>
            {currentZoneInfo && (
              <div className={`px-2.5 py-1 rounded-xl text-xs font-black border ${scoreTheme(currentZoneInfo.score).badge}`}>
                Score {currentZoneInfo.score}%
              </div>
            )}
          </div>

          {/* Barra di Ricerca Task */}
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Cerca prodotto, PAL-, lotto, posizione, cliente..."
              value={taskSearch}
              onChange={(e) => setTaskSearch(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-2xl pl-9 pr-8 py-2.5 text-xs font-bold text-brand-white focus:border-purple-400 focus:outline-none"
            />
            {taskSearch && (
              <button onClick={() => setTaskSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                <X size={15} />
              </button>
            )}
          </div>

          {/* Filtri categoria nella zona */}
          <div className="grid grid-cols-4 gap-1.5">
            {[
              { id: 'ALL', label: `Tutte (${zoneCounts.ALL})` },
              { id: 'REORDER_SLOTTING', label: `ABC (${zoneCounts.REORDER_SLOTTING})` },
              { id: 'MERGE_SAME_BATCH', label: `Lotti (${zoneCounts.MERGE_SAME_BATCH})` },
              { id: 'CONSOLIDATE_FRAGMENTS', label: `Scat. (${zoneCounts.CONSOLIDATE_FRAGMENTS})` }
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setFilterType(f.id)}
                className={`py-2 px-1 rounded-xl text-[11px] font-black border transition-colors ${
                  filterType === f.id
                    ? 'bg-purple-500/20 border-purple-400 text-purple-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {filteredTasks.length === 0 ? (
            <div className="p-8 text-center bg-slate-900/70 border border-emerald-500/30 rounded-3xl space-y-2">
              <CheckCircle2 size={42} className="text-emerald-400 mx-auto" />
              <div className="text-base font-black text-brand-white">
                {zoneTasks.length === 0 ? `Zona ${selectedZone} Ottimizzata!` : 'Nessuna task trovata con questo filtro'}
              </div>
              <p className="text-xs text-slate-400">
                {zoneTasks.length === 0
                  ? 'Tutte le palette e scatole in questa area sono già posizionate correttamente.'
                  : 'Prova a cambiare il filtro o il testo cercato.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTasks.map(task => {
                const b = badgeForType(task.type);
                const IconComp = b.icon;
                return (
                  <div
                    key={task.id}
                    onClick={() => { setPinInput(''); setActiveTask(task); }}
                    className="bg-slate-900 border-2 border-slate-800 active:border-purple-400 rounded-3xl p-4 shadow-lg space-y-2.5 cursor-pointer transition-all"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black border ${b.cls}`}>
                        <IconComp size={12} /> {b.label}
                      </span>
                      <ChevronRight size={18} className="text-slate-500" />
                    </div>

                    <div>
                      <h3 className="text-base font-black text-brand-white leading-snug">{task.title}</h3>
                      <p className="text-xs text-slate-400 font-semibold mt-0.5">{task.subtitle}</p>
                    </div>

                    {/* Dettagli completi di TUTTE le palette coinvolte */}
                    {task.type === 'MERGE_SAME_BATCH' && (
                      <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-3 space-y-2 text-xs">
                        <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-800/80">
                          <div>
                            <span className="text-[10px] font-black uppercase text-emerald-400 block">Paletta Destinazione (A)</span>
                            <span className="font-mono font-bold text-white">{task.target_pallet_code}</span> · <span className="font-mono text-sky-300">{task.target_location}</span>
                          </div>
                          <span className="font-black text-emerald-300 text-right">{task.target_before_label}</span>
                        </div>
                        {(task.sources || []).map((s, idx) => (
                          <div key={s.pallet_code} className="flex items-center justify-between gap-2 text-[11px]">
                            <div>
                              <span className="text-[10px] font-black uppercase text-amber-400 block">Da Unire ({String.fromCharCode(66 + idx)})</span>
                              <span className="font-mono font-bold text-slate-200">{s.pallet_code}</span> · <span className="font-mono text-amber-300">{s.location}</span>
                            </div>
                            <span className="font-bold text-amber-200 text-right">+ {s.qty_label}</span>
                          </div>
                        ))}
                        <div className="pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-black text-sky-300">
                          <span>Totale finale su {task.target_pallet_code}:</span>
                          <span>{task.target_after_label}</span>
                        </div>
                      </div>
                    )}

                    {task.type === 'CONSOLIDATE_FRAGMENTS' && (
                      <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-3 space-y-2 text-xs">
                        <div className="pb-1.5 border-b border-slate-800/80">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase text-emerald-400">Paletta Base ({task.target_pallet_code})</span>
                            <span className="font-black text-emerald-300">{task.target_boxes} colli · {task.target_initial_location}</span>
                          </div>
                          <div className="text-[11px] text-slate-300 mt-0.5">{task.target_summary}</div>
                        </div>
                        {(task.sources || []).map((s) => (
                          <div key={s.pallet_code} className="pb-1 border-b border-slate-900 last:border-0 last:pb-0">
                            <div className="flex items-center justify-between">
                              <span className="font-mono font-bold text-amber-300 text-[11px]">{s.pallet_code} ({s.location})</span>
                              <span className="font-bold text-amber-200 text-[11px]">+ {s.boxes} colli</span>
                            </div>
                            <div className="text-[11px] text-slate-400">{s.items_summary}</div>
                          </div>
                        ))}
                        <div className="pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-black text-purple-300">
                          <span>Destinazione X: {task.target_location}</span>
                          <span>Totale ~{task.total_boxes_after} colli</span>
                        </div>
                      </div>
                    )}

                    {task.type === 'REORDER_SLOTTING' && (
                      <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-3 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-mono text-brand-blue font-bold">{task.pallet_code}</span>
                          <span className="font-bold text-emerald-300">{task.qty_label}</span>
                        </div>
                        <div className="text-[11px] text-slate-300">
                          SKU: <span className="font-mono">{task.sku || '-'}</span> · Lotto: <strong className="text-amber-300">{task.batch || '-'}</strong>
                        </div>
                        <div className="flex items-center gap-2 font-mono font-black pt-1">
                          <span className="text-amber-400">{task.from_location} (P{task.current_level})</span>
                          <ArrowRight size={14} className="text-slate-500" />
                          <span className="text-emerald-400 bg-emerald-500/15 px-2 py-0.5 rounded-lg border border-emerald-500/30">
                            {task.to_location} (P{task.target_level})
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal Esecuzione Task */}
      {activeTask && (
        <div className="fixed inset-0 z-50 bg-brand-black/95 backdrop-blur-md flex flex-col p-4 overflow-y-auto animate-fade-in-up">
          <div className="max-w-md w-full mx-auto flex-1 flex flex-col justify-between py-2">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-purple-400">Esecuzione Task · {activeTask.zone}</span>
                  <h3 className="text-xl font-black text-brand-white">{activeTask.title}</h3>
                </div>
                <button
                  onClick={() => { setActiveTask(null); setPinInput(''); }}
                  className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-bold text-slate-300"
                >
                  Chiudi
                </button>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2.5 text-xs">
                <p className="text-slate-200 leading-relaxed font-medium">{activeTask.reason}</p>
                {activeTask.action_type === 'MOVE' ? (
                  <div className="pt-2 space-y-1.5 border-t border-slate-800">
                    <div className="text-slate-300">Contenuto: <strong className="text-emerald-300">{activeTask.qty_label}</strong> (Lotto: <strong className="text-amber-300">{activeTask.batch}</strong>)</div>
                    <div className="flex items-center justify-between font-mono font-bold">
                      <span className="text-amber-300">Da: {activeTask.from_location}</span>
                      <ArrowRight size={16} className="text-slate-500" />
                      <span className="text-emerald-400 text-sm">A: {activeTask.to_location}</span>
                    </div>
                  </div>
                ) : (
                  <div className="pt-2 space-y-2 border-t border-slate-800">
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-2.5">
                      <div className="font-bold text-emerald-400">
                        Paletta Base / Finale: <span className="font-mono text-white">{activeTask.target_pallet_code}</span> → <span className="font-mono">{activeTask.target_location}</span>
                      </div>
                      {activeTask.target_before_label && (
                        <div className="text-[11px] text-emerald-200 mt-0.5">
                          Attualmente su {activeTask.target_pallet_code}: <strong>{activeTask.target_before_label}</strong> → Diventa: <strong>{activeTask.target_after_label}</strong>
                        </div>
                      )}
                      {activeTask.target_summary && (
                        <div className="text-[11px] text-slate-300 mt-0.5">Base ({activeTask.target_boxes} colli): {activeTask.target_summary}</div>
                      )}
                    </div>

                    <div className="text-[11px] font-bold uppercase text-slate-400">Palette da unire / spostare sopra:</div>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                      {(activeTask.sources || []).map(s => (
                        <div key={s.pallet_code} className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 flex justify-between items-center gap-2">
                          <div>
                            <div className="font-mono font-bold text-brand-blue">{s.pallet_code}</div>
                            <div className="text-[11px] text-slate-300">{s.qty_label || s.items_summary}</div>
                          </div>
                          <span className="font-mono font-black text-amber-300 text-xs shrink-0">{s.location}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {needsPinForTask(activeTask) && (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center space-y-3">
                  <div className="text-xs font-bold text-slate-300">
                    Digita il <span className="text-brand-blue">PIN a 3 cifre</span> dello scaffale <span className="font-mono text-white">{activeTask.to_location || activeTask.target_location}</span>:
                  </div>
                  <div className="flex gap-2 justify-center">
                    {[0, 1, 2].map(i => (
                      <div key={i} className={`w-12 h-14 rounded-xl flex items-center justify-center text-2xl font-black border-2 ${i < pinInput.length ? 'border-brand-blue text-white bg-slate-800' : 'border-slate-800 text-slate-600 bg-slate-950'}`}>
                        {pinInput[i] || ''}
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => pinInput.length < 3 && setPinInput(prev => prev + num)}
                        className="h-12 bg-slate-800 rounded-xl text-white text-xl font-bold active:bg-slate-700"
                      >
                        {num}
                      </button>
                    ))}
                    <div />
                    <button
                      type="button"
                      onClick={() => pinInput.length < 3 && setPinInput(prev => prev + '0')}
                      className="h-12 bg-slate-800 rounded-xl text-white text-xl font-bold active:bg-slate-700"
                    >
                      0
                    </button>
                    <button
                      type="button"
                      onClick={() => setPinInput(prev => prev.slice(0, -1))}
                      className="h-12 bg-rose-500/15 text-rose-400 rounded-xl font-bold text-sm"
                    >
                      Canc
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-4 space-y-2">
              <button
                type="button"
                disabled={executing || (needsPinForTask(activeTask) && pinInput.length < 3)}
                onClick={() => executeTask(activeTask, pinInput)}
                className="w-full py-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-brand-black font-black text-lg shadow-lg disabled:opacity-40 flex items-center justify-center gap-2"
              >
                <CheckCircle2 size={22} />
                {executing ? 'Salvataggio...' : 'CONFERMA ESECUZIONE TASK'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OptimizationZebra;
