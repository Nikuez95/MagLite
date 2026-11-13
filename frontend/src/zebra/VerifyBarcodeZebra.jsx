import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  Scan, Keyboard, Package, MapPin, CheckCircle2, AlertTriangle,
  Wrench, Sparkles, Lock, ArrowRightLeft, RefreshCw, X
} from 'lucide-react';
import useBarcodeScanner from '../hooks/useBarcodeScanner';
import { hasPerm } from '../utils/permissions';

const VerifyBarcodeZebra = () => {
  const navigate = useNavigate();
  const [scanInput, setScanInput] = useState('');
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [feedback, setFeedback] = useState(null); // { type: 'success'|'error', text }

  // Modal Correzione Discrepanza
  const [editItem, setEditItem] = useState(null);
  const [qtyMode, setQtyMode] = useState('BOXES'); // 'BOXES' | 'UNITS'
  const [boxesVal, setBoxesVal] = useState('');
  const [remUnitsVal, setRemUnitsVal] = useState('0');
  const [totalUnitsVal, setTotalUnitsVal] = useState('');
  const [batchVal, setBatchVal] = useState('');
  const [expVal, setExpVal] = useState('');
  const [notesVal, setNotesVal] = useState('');
  const [saving, setSaving] = useState(false);

  const inputRef = useRef(null);
  const scanDebounceRef = useRef(null);
  const getToken = () => localStorage.getItem('maglite_token');
  const canMove = hasPerm('pallet_move');

  const inspectCode = async (rawCode) => {
    const code = String(rawCode || '').trim().toUpperCase();
    if (!code) return;
    setLoading(true);
    setFeedback(null);
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/pallets/inspect/${encodeURIComponent(code)}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setData(res.data);
    } catch (err) {
      setData(null);
      setFeedback({ type: 'error', text: err.response?.data?.error || `Codice "${code}" non trovato` });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!data && inputRef.current) {
      setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 60);
    }
  }, [data]);

  useEffect(() => {
    const socket = io(`http://${window.location.hostname}:3000`);
    const refreshCurrent = () => {
      if (data?.pallet_code) inspectCode(data.pallet_code);
    };
    socket.on('inventory_updated', refreshCurrent);
    socket.on('stow_updated', refreshCurrent);
    return () => {
      socket.off('inventory_updated', refreshCurrent);
      socket.off('stow_updated', refreshCurrent);
      socket.disconnect();
    };
  }, [data?.pallet_code]);

  useBarcodeScanner((barcode) => {
    if (editItem) return;
    inspectCode(barcode);
  });

  const handleVerifyOk = async () => {
    if (!data || saving) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await axios.post(`http://${window.location.hostname}:3000/api/pallets/verify-discrepancy`, {
        pallet_code: data.pallet_code,
        action: 'VERIFY_OK'
      }, { headers: { Authorization: `Bearer ${getToken()}` } });
      setFeedback({ type: 'success', text: res.data?.message || 'Verifica registrata!' });
    } catch (err) {
      setFeedback({ type: 'error', text: err.response?.data?.error || 'Errore conferma verifica' });
    } finally {
      setSaving(false);
    }
  };

  const openCorrection = (item) => {
    const upb = Math.max(1, parseInt(item.units_per_box, 10) || 1);
    const total = parseFloat(item.quantity) || 0;
    const boxes = Math.floor(total / upb);
    const rem = Math.round((total - boxes * upb) * 100) / 100;

    setEditItem(item);
    setQtyMode(upb > 1 ? 'BOXES' : 'UNITS');
    setBoxesVal(String(boxes));
    setRemUnitsVal(String(rem));
    setTotalUnitsVal(String(total));
    setBatchVal(item.batch || '');
    setExpVal(item.expiration_date || '');
    setNotesVal(item.notes || '');
  };

  const computedCorrectedUnits = () => {
    if (!editItem) return 0;
    const upb = Math.max(1, parseInt(editItem.units_per_box, 10) || 1);
    if (qtyMode === 'BOXES' && upb > 1) {
      const b = parseFloat(boxesVal) || 0;
      const r = parseFloat(remUnitsVal) || 0;
      return Math.max(0, Math.round((b * upb + r) * 100) / 100);
    }
    return Math.max(0, parseFloat(totalUnitsVal) || 0);
  };

  const saveCorrection = async () => {
    if (!editItem || saving) return;
    const finalUnits = computedCorrectedUnits();
    setSaving(true);
    setFeedback(null);
    try {
      const res = await axios.post(`http://${window.location.hostname}:3000/api/pallets/verify-discrepancy`, {
        pallet_code: data.pallet_code,
        pallet_id: editItem.id,
        action: 'CORRECT',
        quantity: finalUnits,
        batch: batchVal,
        expiration_date: expVal || null,
        notes: notesVal
      }, { headers: { Authorization: `Bearer ${getToken()}` } });

      setEditItem(null);
      setFeedback({ type: 'success', text: res.data?.message || 'Discrepanza corretta!' });
      await inspectCode(data.pallet_code);
    } catch (err) {
      setFeedback({ type: 'error', text: err.response?.data?.error || 'Errore salvataggio correzione' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 p-4 flex flex-col w-full max-w-md mx-auto overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-xl font-black text-brand-white flex items-center gap-2">
            <Scan size={22} className="text-cyan-400" />
            Verifica & Discrepanze
          </h2>
          <p className="text-[11px] text-slate-400 font-semibold mt-0.5">
            Spara un barcode paletta o posizione per ispezionare e rettificare
          </p>
        </div>
        {data && (
          <button
            onClick={() => { setData(null); setFeedback(null); }}
            className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-bold text-slate-300 flex items-center gap-1"
          >
            <X size={14} /> Nuova
          </button>
        )}
      </div>

      {/* Box Scansione */}
      <div className="bg-slate-900 border-2 border-slate-800 rounded-3xl p-3.5 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-black uppercase text-cyan-400">Laser / Inserimento Codice</span>
          <button
            type="button"
            onClick={() => {
              const next = !keyboardOpen;
              setKeyboardOpen(next);
              setTimeout(() => next && inputRef.current?.focus(), 40);
            }}
            className={`px-2.5 py-1 rounded-xl text-[11px] font-bold flex items-center gap-1 ${
              keyboardOpen ? 'bg-cyan-400 text-brand-black' : 'bg-slate-800 text-slate-300 border border-slate-700'
            }`}
          >
            <Keyboard size={13} />
            {keyboardOpen ? 'Chiudi' : 'Tastiera'}
          </button>
        </div>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            inputMode={keyboardOpen ? 'text' : 'none'}
            placeholder={keyboardOpen ? 'Scrivi PAL-... o CELLA2-A-01' : 'Attendo scansione barcode...'}
            value={scanInput}
            onBlur={() => setKeyboardOpen(false)}
            onChange={(e) => {
              const val = e.target.value.toUpperCase();
              setScanInput(val);
              if (scanDebounceRef.current) clearTimeout(scanDebounceRef.current);
              const trimmed = val.trim();
              if (!keyboardOpen && trimmed.startsWith('PAL-') && trimmed.length >= 12) {
                scanDebounceRef.current = setTimeout(() => {
                  setScanInput('');
                  inspectCode(trimmed);
                }, 220);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && scanInput.trim() !== '') {
                if (scanDebounceRef.current) clearTimeout(scanDebounceRef.current);
                const code = scanInput.trim();
                setScanInput('');
                inspectCode(code);
              }
            }}
            className="flex-1 bg-slate-950 border-2 border-slate-700 p-3 rounded-xl text-sm font-mono font-bold uppercase focus:border-cyan-400 focus:outline-none text-brand-white"
          />
          <button
            type="button"
            disabled={loading || !scanInput.trim()}
            onClick={() => {
              const code = scanInput.trim();
              setScanInput('');
              inspectCode(code);
            }}
            className="bg-cyan-400 hover:bg-cyan-300 text-brand-black font-black px-4 rounded-xl text-sm disabled:opacity-40"
          >
            Cerca
          </button>
        </div>
      </div>

      {feedback && (
        <div className={`mb-4 p-3.5 rounded-2xl border text-xs font-bold flex items-center gap-2.5 animate-fade-in-up ${
          feedback.type === 'success'
            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
            : 'bg-rose-500/15 border-rose-500/40 text-rose-300'
        }`}>
          {feedback.type === 'success' ? <CheckCircle2 size={18} className="shrink-0" /> : <AlertTriangle size={18} className="shrink-0" />}
          <span>{feedback.text}</span>
        </div>
      )}

      {loading && (
        <div className="p-8 text-center text-slate-400 font-bold text-sm flex items-center justify-center gap-2">
          <RefreshCw size={18} className="animate-spin text-cyan-400" /> Verifica barcode...
        </div>
      )}

      {data && !loading && (
        <div className="space-y-3.5 pb-6 animate-fade-in-up">
          {/* Header Paletta & Dove si trova */}
          <div className="bg-slate-900 border-2 border-cyan-500/40 rounded-3xl p-4 space-y-3 shadow-lg">
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="font-mono font-black text-base text-cyan-400">{data.pallet_code}</span>
                {data.scanned_as_location && (
                  <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">Da Posizione</span>
                )}
              </div>
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase ${
                data.status === 'SHIPPED'
                  ? 'bg-slate-800 text-slate-400'
                  : data.is_quarantined
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              }`}>
                {data.is_quarantined ? 'QUARANTENA' : data.status}
              </span>
            </div>

            <div className="text-xs text-slate-300 font-bold">{data.customer_name}</div>

            {/* Dove si trova */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <MapPin size={18} className="text-brand-blue shrink-0" />
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-500">Dove si trova ora</div>
                  <div className="font-mono font-black text-base text-brand-white">
                    {data.location || 'NON STIVATA (IN ATTESA)'}
                  </div>
                </div>
              </div>
              {data.location_status?.is_free_location && (
                <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-slate-800 text-slate-300">
                  Posizione Libera
                </span>
              )}
            </div>

            {/* Stato Ottimale & Posizione Consigliata */}
            {data.slotting && (
              <div className={`rounded-2xl p-3.5 border ${
                data.location_status?.is_free_location
                  ? 'bg-slate-950/70 border-slate-800 text-slate-400'
                  : data.slotting.currentStatus?.isOptimal
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200'
                    : 'bg-amber-500/15 border-amber-500/40 text-amber-200'
              }`}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[11px] font-black uppercase flex items-center gap-1.5">
                    {data.slotting.currentStatus?.isOptimal ? (
                      <><CheckCircle2 size={15} className="text-emerald-400" /> È nella posizione ottimale</>
                    ) : data.location_status?.is_free_location ? (
                      <><Lock size={14} /> Esclusa da Slotting (Pos. Libera)</>
                    ) : (
                      <><Sparkles size={15} className="text-amber-400" /> Posizione Migliorabile</>
                    )}
                  </span>
                  <span className="text-[10px] font-black px-2 py-0.5 rounded bg-slate-950/70 text-slate-200">
                    Rotazione {data.slotting.velocity?.tier} ({data.slotting.velocity?.shipCount || 0} sped.)
                  </span>
                </div>

                <p className="text-xs leading-snug opacity-90">{data.slotting.currentStatus?.optimalMessage}</p>

                {!data.slotting.currentStatus?.isOptimal && data.slotting.recommended && !data.location_status?.is_free_location && (
                  <div className="mt-2.5 pt-2.5 border-t border-amber-500/30 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] uppercase font-bold text-amber-300/80">Posizione Consigliata</div>
                      <div className="font-mono font-black text-base text-white">
                        {data.slotting.recommended.barcode}
                        <span className="ml-1.5 text-[11px] font-sans font-bold text-amber-300">
                          (Piano {data.slotting.recommended.level} · {data.slotting.velocity?.levelRangeLabel})
                        </span>
                      </div>
                      {data.slotting.recommended.reasons?.[0] && (
                        <div className="text-[11px] text-amber-200/80 mt-0.5">{data.slotting.recommended.reasons[0]}</div>
                      )}
                    </div>
                    {canMove && (
                      <button
                        type="button"
                        onClick={() => navigate('/zebra/handling', { state: { initialBarcode: data.pallet_code } })}
                        className="px-3 py-2 rounded-xl bg-amber-400 text-brand-black font-black text-xs shrink-0 flex items-center gap-1"
                      >
                        <ArrowRightLeft size={13} /> Sposta
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Elenco Articoli & Conversione Scatole */}
          <div className="space-y-2.5">
            {data.items.map((item) => (
              <div key={item.id} className="bg-slate-900 border border-slate-800 rounded-3xl p-4 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] font-mono font-bold text-brand-blue">{item.sku}</div>
                    <h3 className="text-base font-black text-brand-white leading-tight">{item.product_name}</h3>
                  </div>
                  <Package size={20} className="text-slate-500 shrink-0" />
                </div>

                {/* Pezzi e Conversione Scatole */}
                <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3">
                  <div className="text-[10px] font-bold uppercase text-slate-500 mb-0.5">Quantità & Conversione Scatole</div>
                  <div className="text-xl font-black text-emerald-400">
                    {item.boxes_breakdown?.unitsPerBox > 1
                      ? `${item.boxes_breakdown.fullBoxes} Scatole${item.boxes_breakdown.remainder > 0 ? ` + ${item.boxes_breakdown.remainder} pz` : ''}`
                      : `${item.quantity} ${item.uom || 'pz'}`
                    }
                  </div>
                  <div className="text-xs font-mono text-slate-300 mt-0.5">
                    Totale: <span className="font-bold text-white">{item.quantity} {item.uom || 'Pezzi'}</span>
                    {item.boxes_breakdown?.unitsPerBox > 1 && (
                      <span className="text-slate-400"> ({item.boxes_breakdown.unitsPerBox} pz/scatola)</span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5">
                    <div className="text-[10px] uppercase text-slate-500 font-bold">Lotto</div>
                    <div className="font-mono font-bold text-amber-300">{item.batch || '-'}</div>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5">
                    <div className="text-[10px] uppercase text-slate-500 font-bold">Scadenza</div>
                    <div className="font-bold text-slate-200">
                      {item.expiration_date ? new Date(item.expiration_date).toLocaleDateString('it-IT') : 'Nessuna'}
                    </div>
                  </div>
                </div>

                {data.status !== 'SHIPPED' && (
                  <button
                    type="button"
                    disabled={item.is_quarantined}
                    onClick={() => openCorrection(item)}
                    className="w-full py-2.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 font-black text-xs flex items-center justify-center gap-1.5 disabled:opacity-40"
                  >
                    <Wrench size={14} />
                    {item.is_quarantined ? 'Bloccata in Quarantena' : 'Correggi Discrepanza'}
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Pulsante Verifica OK */}
          {data.status !== 'SHIPPED' && (
            <button
              type="button"
              disabled={saving}
              onClick={handleVerifyOk}
              className="w-full py-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-brand-black font-black text-base shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <CheckCircle2 size={20} />
              {saving ? 'Salvataggio...' : 'CONFERMA GIACENZA OK (NESSUNA DISCREPANZA)'}
            </button>
          )}
        </div>
      )}

      {/* Modal Correzione Discrepanza */}
      {editItem && (
        <div className="fixed inset-0 z-50 bg-brand-black/95 backdrop-blur-md flex flex-col p-4 overflow-y-auto animate-fade-in-up">
          <div className="max-w-md w-full mx-auto bg-slate-900 border border-amber-500/40 rounded-3xl p-5 space-y-4 my-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <span className="text-[10px] font-black uppercase text-amber-400">Rettifica Discrepanza</span>
                <h3 className="text-lg font-black text-white truncate max-w-[240px]">{editItem.product_name}</h3>
              </div>
              <button onClick={() => setEditItem(null)} className="p-2 rounded-xl bg-slate-800 text-slate-300">
                <X size={18} />
              </button>
            </div>

            {parseInt(editItem.units_per_box, 10) > 1 && (
              <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => setQtyMode('BOXES')}
                  className={`py-2 rounded-lg text-xs font-black ${qtyMode === 'BOXES' ? 'bg-amber-400 text-brand-black' : 'text-slate-400'}`}
                >
                  Inserisci in Scatole
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTotalUnitsVal(String(computedCorrectedUnits()));
                    setQtyMode('UNITS');
                  }}
                  className={`py-2 rounded-lg text-xs font-black ${qtyMode === 'UNITS' ? 'bg-amber-400 text-brand-black' : 'text-slate-400'}`}
                >
                  Inserisci in Pezzi
                </button>
              </div>
            )}

            {qtyMode === 'BOXES' && parseInt(editItem.units_per_box, 10) > 1 ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase mb-1">Scatole ({editItem.units_per_box} pz/sc)</label>
                  <input
                    type="number"
                    min="0"
                    value={boxesVal}
                    onChange={(e) => setBoxesVal(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-lg font-black text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase mb-1">+ Pezzi sfusi</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={remUnitsVal}
                    onChange={(e) => setRemUnitsVal(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-lg font-black text-white"
                  />
                </div>
                <div className="col-span-2 text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-2.5 text-center">
                  Nuovo Totale Salvato: {computedCorrectedUnits()} {editItem.uom || 'Pezzi'}
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase mb-1">Quantità Reale ({editItem.uom || 'Pezzi'})</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={totalUnitsVal}
                  onChange={(e) => setTotalUnitsVal(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xl font-black text-white"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase mb-1">Lotto</label>
                <input
                  type="text"
                  value={batchVal}
                  onChange={(e) => setBatchVal(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-sm font-mono font-bold text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase mb-1">Scadenza</label>
                <input
                  type="date"
                  value={expVal}
                  onChange={(e) => setExpVal(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-sm font-bold text-white [color-scheme:dark]"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase mb-1">Note / Motivo rettifica</label>
              <input
                type="text"
                placeholder="Es. Scatola danneggiata o conteggio errato"
                value={notesVal}
                onChange={(e) => setNotesVal(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-sm text-white"
              />
            </div>

            <button
              type="button"
              disabled={saving}
              onClick={saveCorrection}
              className="w-full py-3.5 rounded-2xl bg-amber-400 hover:bg-amber-300 text-brand-black font-black text-base disabled:opacity-50"
            >
              {saving ? 'Salvataggio...' : 'SALVA RETTIFICA DISCREPANZA'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default VerifyBarcodeZebra;
