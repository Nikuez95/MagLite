import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import {
  Sparkles, ArrowRight, Layers, GitMerge, Boxes, RefreshCw,
  CheckCircle2, AlertCircle, Lock, ArrowDownUp, MapPin, ChevronRight
} from 'lucide-react';
import useBarcodeScanner from '../hooks/useBarcodeScanner';

const OptimizationZebra = () => {
  const [tasks, setTasks] = useState([]);
  const [summary, setSummary] = useState({
    totalTasks: 0,
    reorderCount: 0,
    mergeSameBatchCount: 0,
    fragmentConsolidateCount: 0,
    excludedFreeLocationPallets: 0
  });
  const [requirePins, setRequirePins] = useState(true);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('ALL');
  const [activeTask, setActiveTask] = useState(null);
  const [pinInput, setPinInput] = useState('');
  const [executing, setExecuting] = useState(false);
  const [feedback, setFeedback] = useState(null); // { type: 'success'|'error', text }

  const getToken = () => localStorage.getItem('maglite_token');

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/pallets/optimization/tasks`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setTasks(res.data?.tasks || []);
      setSummary(res.data?.summary || {
        totalTasks: 0, reorderCount: 0, mergeSameBatchCount: 0, fragmentConsolidateCount: 0, excludedFreeLocationPallets: 0
      });
      if (typeof res.data?.requirePins === 'boolean') {
        setRequirePins(res.data.requirePins);
      }
    } catch (err) {
      setFeedback({ type: 'error', text: err.response?.data?.error || 'Errore caricamento task ottimizzazione' });
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
      setFeedback({ type: 'error', text: 'Inserisci il PIN a 3 cifre dello scaffale di destinazione.' });
      return;
    }

    setExecuting(true);
    setFeedback(null);
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

      setFeedback({ type: 'success', text: res.data?.message || 'Task completata con successo!' });
      setActiveTask(null);
      setPinInput('');
      await fetchTasks();
    } catch (err) {
      setFeedback({ type: 'error', text: err.response?.data?.error || 'Errore durante esecuzione task' });
      setPinInput('');
    } finally {
      setExecuting(false);
    }
  };

  // Se l'operatore spara il barcode della paletta mentre guarda la lista task, apre direttamente la relativa task
  useBarcodeScanner((barcode) => {
    const code = String(barcode || '').trim().toUpperCase();
    if (!code || activeTask) return;
    const match = tasks.find(t =>
      t.pallet_code === code ||
      t.target_pallet_code === code ||
      (t.sources || []).some(s => s.pallet_code === code)
    );
    if (match) {
      setPinInput('');
      setActiveTask(match);
    }
  });

  const filteredTasks = tasks.filter(t => filterType === 'ALL' || t.type === filterType);

  const badgeForType = (type) => {
    if (type === 'MERGE_SAME_BATCH') {
      return { label: 'UNISCI LOTTO', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40', icon: GitMerge };
    }
    if (type === 'CONSOLIDATE_FRAGMENTS') {
      return { label: 'FRAMMENTA / ACCORPA', cls: 'bg-purple-500/20 text-purple-300 border-purple-500/40', icon: Boxes };
    }
    return { label: 'RIORDINO ABC', cls: 'bg-sky-500/20 text-sky-300 border-sky-500/40', icon: ArrowDownUp };
  };

  return (
    <div className="flex-1 p-4 flex flex-col w-full max-w-md mx-auto overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-xl font-black text-brand-white flex items-center gap-2">
            <Sparkles size={22} className="text-purple-400" />
            Task Ottimizzazione
          </h2>
          <p className="text-[11px] text-slate-400 font-semibold mt-0.5">
            Riordino ABC, lotti uguali e accorpamento scatole
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

      {summary.excludedFreeLocationPallets > 0 && (
        <div className="mb-3 px-3 py-2 rounded-xl bg-slate-900/90 border border-slate-800 text-[11px] text-slate-400 font-semibold flex items-center gap-2">
          <Lock size={13} className="text-slate-500 shrink-0" />
          <span>{summary.excludedFreeLocationPallets} palette in Posizioni Libere escluse dal conteggio.</span>
        </div>
      )}

      {feedback && (
        <div className={`mb-3 p-3.5 rounded-2xl border text-xs font-bold flex items-center gap-2.5 animate-fade-in-up ${
          feedback.type === 'success'
            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
            : 'bg-rose-500/15 border-rose-500/40 text-rose-300'
        }`}>
          {feedback.type === 'success' ? <CheckCircle2 size={18} className="shrink-0" /> : <AlertCircle size={18} className="shrink-0" />}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Filtri rapidi per categoria */}
      <div className="grid grid-cols-4 gap-1.5 mb-4">
        {[
          { id: 'ALL', label: `Tutte (${summary.totalTasks})` },
          { id: 'REORDER_SLOTTING', label: `ABC (${summary.reorderCount})` },
          { id: 'MERGE_SAME_BATCH', label: `Lotti (${summary.mergeSameBatchCount})` },
          { id: 'CONSOLIDATE_FRAGMENTS', label: `Scat. (${summary.fragmentConsolidateCount})` }
        ].map(f => (
          <button
            key={f.id}
            onClick={() => setFilterType(f.id)}
            className={`py-2 px-1.5 rounded-xl text-[11px] font-black border transition-colors ${
              filterType === f.id
                ? 'bg-purple-500/20 border-purple-400 text-purple-200'
                : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Lista Task */}
      <div className="space-y-3 pb-6">
        {loading ? (
          <div className="p-8 text-center text-slate-500 font-bold text-sm">Analisi magazzino in corso...</div>
        ) : filteredTasks.length === 0 ? (
          <div className="p-8 text-center bg-slate-900/70 border border-emerald-500/30 rounded-3xl space-y-2">
            <CheckCircle2 size={44} className="text-emerald-400 mx-auto" />
            <div className="text-lg font-black text-brand-white">Magazzino Ottimizzato!</div>
            <p className="text-xs text-slate-400">
              Nessuna task di riordino, unione o accorpamento necessaria al momento sugli scaffali mappati.
            </p>
          </div>
        ) : (
          filteredTasks.map(task => {
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
                  <p className="text-xs text-slate-400 font-semibold truncate mt-0.5">{task.subtitle}</p>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/80">
                  {task.reason}
                </p>

                <div className="flex items-center justify-between text-xs font-mono pt-1">
                  {task.action_type === 'MOVE' ? (
                    <div className="flex items-center gap-2 font-black">
                      <span className="text-amber-400">{task.from_location}</span>
                      <ArrowRight size={14} className="text-slate-500" />
                      <span className="text-emerald-400 bg-emerald-500/15 px-2 py-0.5 rounded-lg border border-emerald-500/30">{task.to_location}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-purple-300 font-bold">
                      <MapPin size={13} />
                      <span>Target: {task.target_pallet_code} ({task.target_location})</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal Esecuzione Task */}
      {activeTask && (
        <div className="fixed inset-0 z-50 bg-brand-black/95 backdrop-blur-md flex flex-col p-4 overflow-y-auto animate-fade-in-up">
          <div className="max-w-md w-full mx-auto flex-1 flex flex-col justify-between py-2">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-purple-400">Esecuzione Task</span>
                  <h3 className="text-xl font-black text-brand-white">{activeTask.title}</h3>
                </div>
                <button
                  onClick={() => { setActiveTask(null); setPinInput(''); }}
                  className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-bold text-slate-300"
                >
                  Chiudi
                </button>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2 text-xs">
                <p className="text-slate-200 leading-relaxed font-medium">{activeTask.reason}</p>
                {activeTask.action_type === 'MOVE' ? (
                  <div className="pt-2 flex items-center justify-between border-t border-slate-800 font-mono font-bold">
                    <span className="text-amber-300">Da: {activeTask.from_location}</span>
                    <ArrowRight size={16} className="text-slate-500" />
                    <span className="text-emerald-400 text-sm">A: {activeTask.to_location}</span>
                  </div>
                ) : (
                  <div className="pt-2 space-y-1.5 border-t border-slate-800">
                    <div className="font-bold text-emerald-400">
                      Destinazione Finale: <span className="font-mono">{activeTask.target_pallet_code}</span> → <span className="font-mono">{activeTask.target_location}</span>
                    </div>
                    {activeTask.target_summary && (
                      <div className="text-[11px] text-slate-400">Base: {activeTask.target_summary}</div>
                    )}
                    <div className="text-[11px] font-bold uppercase text-slate-400 pt-1">Palette da accorpare / prelevare:</div>
                    <div className="space-y-1 max-h-36 overflow-y-auto">
                      {(activeTask.sources || []).map(s => (
                        <div key={s.pallet_code} className="bg-slate-950 p-2 rounded-xl border border-slate-800 flex justify-between items-center gap-2">
                          <div>
                            <div className="font-mono font-bold text-brand-blue">{s.pallet_code}</div>
                            <div className="text-[11px] text-slate-400">{s.qty_label || s.items_summary}</div>
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
