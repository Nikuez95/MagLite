import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import {
  Scan,
  Keyboard,
  AlertTriangle,
  Package,
  MapPin,
  CheckCircle2,
  X,
  Lock,
  Send,
  Scale,
  Calendar,
  Tag,
  FileText,
  Layers,
  RefreshCw
} from 'lucide-react';
import useBarcodeScanner from '../hooks/useBarcodeScanner';
import { useZebraWorkspace } from '../utils/zebraWorkspace';

const DEFAULT_CAUSES = [
  { code: 'LOTTO_ERRATO', label: 'Lotto errato / illeggibile' },
  { code: 'SCADENZA_ERRATA', label: 'Scadenza errata / assente / scaduto' },
  { code: 'ARTICOLO_ERRATO', label: 'Articolo / Nome / SKU errato' },
  { code: 'QUANTITA_ERRATA', label: 'Quantità / Colli errati' },
  { code: 'COLLO_ROTTO', label: 'Collo rotto / Imballaggio danneggiato' },
  { code: 'PESO_NETTO_ERRATO', label: 'Kili netti errati' },
  { code: 'PESO_LORDO_ERRATO', label: 'Kili lordi errati' },
  { code: 'ETICHETTA_MANCANTE', label: 'Etichetta / Barcode mancante' },
  { code: 'CONSERVAZIONE_ANOMALA', label: 'Anomalia temperatura / conservazione' },
  { code: 'BANCALE_NON_CONFORME', label: 'Bancale danneggiato / instabile' },
  { code: 'DOCUMENTI_ERRATI', label: 'DDT / Riferimenti cliente errati' },
  { code: 'ALTRO', label: 'Altro (descrivi nelle note)' }
];

const NonConformityZebra = () => {
  const workspace = useZebraWorkspace();
  const [scanInput, setScanInput] = useState('');
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [palletData, setPalletData] = useState(null);
  const [selectedCauses, setSelectedCauses] = useState([]);
  const [targetItemId, setTargetItemId] = useState('');
  const [operatorNotes, setOperatorNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [successInfo, setSuccessInfo] = useState(null);

  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const getToken = () => localStorage.getItem('maglite_token');

  useEffect(() => {
    if (!palletData && !successInfo && inputRef.current) {
      setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 60);
    }
  }, [palletData, successInfo]);

  const inspectPallet = async (rawCode) => {
    const code = String(rawCode || '').trim().toUpperCase();
    if (!code) return;
    setLoading(true);
    setFeedback(null);
    try {
      const res = await axios.get(
        `http://${window.location.hostname}:3000/api/non-conformities/inspect/${encodeURIComponent(code)}`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      if (workspace?.warehouseId && res.data?.pallet?.warehouse_id && Number(res.data.pallet.warehouse_id) !== Number(workspace.warehouseId)) {
        setPalletData(null);
        setFeedback({ type: 'error', text: `Paletta presente in un altro magazzino (${res.data.pallet.warehouse || 'Altra sede'}). Cambia sede in alto prima di procedere.` });
        return;
      }
      setPalletData(res.data);
      setSelectedCauses([]);
      setTargetItemId(res.data?.items?.length === 1 ? String(res.data.items[0].pallet_id) : '');
      setOperatorNotes('');
    } catch (err) {
      setPalletData(null);
      setFeedback({ type: 'error', text: err.response?.data?.error || `Paletta "${code}" non trovata.` });
    } finally {
      setLoading(false);
    }
  };

  useBarcodeScanner((barcode) => {
    if (successInfo) {
      setSuccessInfo(null);
    }
    inspectPallet(barcode);
  });

  const handleManualInput = (e) => {
    const val = e.target.value;
    setScanInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const cleaned = val.trim().toUpperCase();
    if (!cleaned) return;
    if (cleaned.startsWith('PAL-') && cleaned.length >= 12) {
      debounceRef.current = setTimeout(() => {
        inspectPallet(cleaned);
        setScanInput('');
      }, 150);
    }
  };

  const toggleCause = (code) => {
    setSelectedCauses(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    );
  };

  const handleSubmitNc = async () => {
    if (!palletData || submitting) return;
    if (selectedCauses.length === 0 && !operatorNotes.trim()) {
      setFeedback({ type: 'error', text: 'Seleziona almeno una causa oppure scrivi una nota descrittiva.' });
      return;
    }

    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await axios.post(
        `http://${window.location.hostname}:3000/api/non-conformities`,
        {
          pallet_code: palletData.pallet_code,
          causes: selectedCauses,
          operator_notes: operatorNotes.trim() || null,
          target_pallet_item_id: targetItemId ? parseInt(targetItemId, 10) : null,
          source: 'ZEBRA'
        },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      setSuccessInfo({
        nc_code: res.data.nc_code,
        pallet_code: palletData.pallet_code,
        causesCount: selectedCauses.length
      });
      setPalletData(null);
      setSelectedCauses([]);
      setOperatorNotes('');
      setScanInput('');
    } catch (err) {
      setFeedback({ type: 'error', text: err.response?.data?.error || 'Errore durante invio Non Conformità' });
    } finally {
      setSubmitting(false);
    }
  };

  const resetToScanner = () => {
    setSuccessInfo(null);
    setPalletData(null);
    setSelectedCauses([]);
    setOperatorNotes('');
    setFeedback(null);
    setScanInput('');
    setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 80);
  };

  if (successInfo) {
    return (
      <div className="flex-1 p-5 flex flex-col items-center justify-center text-center bg-brand-black animate-fade-in">
        <div className="w-20 h-20 rounded-3xl bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center text-emerald-400 mb-5 shadow-[0_0_30px_rgba(16,185,129,0.25)]">
          <CheckCircle2 size={44} />
        </div>
        <h2 className="text-2xl font-black text-brand-white mb-2">Non Conformità Inviata!</h2>
        <p className="font-mono text-lg font-black text-brand-blue mb-1">{successInfo.nc_code}</p>
        <p className="text-sm text-slate-400 mb-6">
          Paletta <strong className="text-white">{successInfo.pallet_code}</strong> segnalata al gestionale con tutti i metadati.
        </p>
        <button
          type="button"
          onClick={resetToScanner}
          className="w-full max-w-xs py-4 rounded-2xl bg-brand-blue text-brand-black font-black text-base shadow-lg active:scale-95 transition-transform"
        >
          Scansiona Un'Altra Paletta
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 pb-8 overflow-y-auto w-full max-w-md mx-auto space-y-4">
      {/* Header Titolo */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-11 h-11 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
            <AlertTriangle size={24} />
          </div>
          <div>
            <h2 className="text-lg font-black text-brand-white leading-tight">Segnala Non Conformità</h2>
            <p className="text-[11px] text-slate-400 font-semibold">Scansiona il barcode paletta e invia rettifica</p>
          </div>
        </div>
        {palletData && (
          <button
            type="button"
            onClick={resetToScanner}
            className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 active:scale-95"
            title="Nuova scansione"
          >
            <RefreshCw size={18} />
          </button>
        )}
      </div>

      {feedback && (
        <div className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center gap-2 ${
          feedback.type === 'error'
            ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
            : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
        }`}>
          <AlertTriangle size={16} className="shrink-0" />
          <span className="flex-1">{feedback.text}</span>
          <button onClick={() => setFeedback(null)}><X size={15} /></button>
        </div>
      )}

      {/* Schermata Scan Barcode */}
      {!palletData ? (
        <div className="bg-slate-900 border-2 border-slate-800 rounded-3xl p-5 space-y-4 shadow-xl">
          <div className="flex flex-col items-center text-center py-3">
            <div className="w-20 h-20 rounded-3xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 mb-3 animate-pulse">
              <Scan size={42} />
            </div>
            <p className="text-base font-black text-brand-white">Punta il Laser sulla Paletta</p>
            <p className="text-xs text-slate-400 mt-1">
              Scansiona il codice <span className="font-mono text-brand-blue font-bold">PAL-xxxxxxxx</span> per vedere lotti, articoli e pesi.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                inputMode={keyboardOpen ? 'text' : 'none'}
                value={scanInput}
                onChange={handleManualInput}
                onKeyDown={e => {
                  if (e.key === 'Enter' && scanInput.trim()) {
                    e.preventDefault();
                    inspectPallet(scanInput);
                    setScanInput('');
                  }
                }}
                placeholder="Barcode PAL-..."
                className="flex-1 bg-slate-950 border border-slate-800 rounded-2xl px-4 py-3 text-sm font-mono font-bold text-white uppercase focus:border-brand-blue outline-none"
              />
              <button
                type="button"
                onClick={() => setKeyboardOpen(v => !v)}
                className={`px-3.5 rounded-2xl border flex items-center justify-center ${
                  keyboardOpen ? 'bg-brand-blue text-brand-black border-brand-blue' : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
                title="Mostra/nascondi tastiera"
              >
                <Keyboard size={20} />
              </button>
            </div>

            <button
              type="button"
              disabled={loading || !scanInput.trim()}
              onClick={() => { inspectPallet(scanInput); setScanInput(''); }}
              className="w-full py-3.5 rounded-2xl bg-brand-blue text-brand-black font-black text-sm disabled:opacity-40 active:scale-95 transition-all"
            >
              {loading ? 'Ricerca paletta...' : 'Cerca Barcode'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Riepilogo Paletta & Contenuto Completo */}
          <div className="bg-slate-900 border-2 border-slate-800 rounded-3xl p-4 space-y-3 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-mono text-base font-black text-brand-blue">{palletData.pallet_code}</div>
                <div className="text-xs font-bold text-white mt-0.5">{palletData.customer_name}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="px-2.5 py-1 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                  <MapPin size={12} /> {palletData.location || 'IN ATTESA'}
                </span>
                {palletData.warehouse && (
                  <span className="text-[10px] font-bold uppercase text-slate-400">{palletData.warehouse}</span>
                )}
              </div>
            </div>

            {palletData.is_quarantined && (
              <div className="px-3 py-2 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs font-black flex items-center gap-1.5">
                <Lock size={14} /> MERCE IN QUARANTENA
              </div>
            )}

            {palletData.existing_open_nc?.length > 0 && (
              <div className="px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-[11px] font-bold">
                ⚠ Presenti già {palletData.existing_open_nc.length} NC aperte su questa paletta ({palletData.existing_open_nc.map(n => n.nc_code).join(', ')})
              </div>
            )}

            <div className="text-[11px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5 pt-1">
              <Layers size={13} className="text-brand-blue" />
              Contenuto Paletta ({palletData.items.length} {palletData.items.length === 1 ? 'articolo/lotto' : 'articoli/lotti'})
            </div>

            <div className="space-y-2.5">
              {palletData.items.map(item => {
                const isTarget = String(targetItemId) === String(item.pallet_id);
                return (
                  <div
                    key={item.pallet_id}
                    onClick={() => setTargetItemId(prev => (String(prev) === String(item.pallet_id) && palletData.items.length > 1 ? '' : String(item.pallet_id)))}
                    className={`rounded-2xl border p-3 space-y-2 transition-all ${
                      isTarget ? 'bg-rose-500/10 border-rose-400/60' : 'bg-slate-950/80 border-slate-800'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-black text-brand-white leading-snug">{item.product_name}</div>
                        <div className="text-[11px] font-mono text-brand-blue font-bold">SKU: {item.sku}</div>
                      </div>
                      <span className="px-2.5 py-1 rounded-xl bg-slate-900 border border-slate-800 font-black text-xs text-emerald-400 shrink-0">
                        {item.quantity} {item.uom}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                      <div className="bg-slate-900/80 rounded-xl px-2.5 py-1.5">
                        <span className="text-slate-500 block text-[10px]">Lotto</span>
                        <strong className="font-mono text-white">{item.batch || '-'}</strong>
                      </div>
                      <div className="bg-slate-900/80 rounded-xl px-2.5 py-1.5">
                        <span className="text-slate-500 block text-[10px] flex items-center gap-1"><Calendar size={10} /> Scadenza</span>
                        <strong className="font-mono text-amber-300">
                          {item.expiration_date ? new Date(item.expiration_date).toLocaleDateString('it-IT') : 'Nessuna'}
                        </strong>
                      </div>
                      <div className="bg-slate-900/80 rounded-xl px-2.5 py-1.5">
                        <span className="text-slate-500 block text-[10px] flex items-center gap-1"><Scale size={10} /> Kg Netti / Lordi</span>
                        <strong className="font-mono text-sky-300">
                          {item.net_weight_kg ?? '-'} / {item.gross_weight_kg ?? '-'} kg
                        </strong>
                      </div>
                      <div className="bg-slate-900/80 rounded-xl px-2.5 py-1.5">
                        <span className="text-slate-500 block text-[10px] flex items-center gap-1"><FileText size={10} /> DDT / Rif. Pal</span>
                        <strong className="font-mono text-slate-200 truncate block">
                          {item.client_ddt || item.inbound_ddt_number || '-'} {item.client_pallet_number ? `• ${item.client_pallet_number}` : ''}
                        </strong>
                      </div>
                    </div>

                    {(item.notes || item.product_notes || (item.flags && item.flags.length > 0)) && (
                      <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-1.5 pt-0.5">
                        {(Array.isArray(item.flags) ? item.flags : []).map((f, fIdx) => {
                          const fLabel = typeof f === 'object' ? (f?.label || f?.value || '') : f;
                          return fLabel ? (
                            <span key={`${fLabel}-${fIdx}`} className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold text-[9px] uppercase">
                              <Tag size={9} className="inline mr-0.5" /> {fLabel}
                            </span>
                          ) : null;
                        })}
                        {(item.notes || item.product_notes) && (
                          <span className="italic truncate">{item.notes || item.product_notes}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Selezione Cause di Non Conformità */}
          <div className="bg-slate-900 border-2 border-slate-800 rounded-3xl p-4 space-y-3 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-wider text-rose-400 flex items-center gap-1.5">
                <AlertTriangle size={15} /> Seleziona Cause Riscontrate
              </h3>
              <span className="text-[11px] font-bold text-slate-400">{selectedCauses.length} selezionate</span>
            </div>

            <div className="grid grid-cols-1 gap-2">
              {DEFAULT_CAUSES.map(c => {
                const active = selectedCauses.includes(c.code);
                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => toggleCause(c.code)}
                    className={`w-full text-left px-3.5 py-3 rounded-2xl border-2 font-bold text-xs flex items-center justify-between gap-2 transition-all active:scale-[0.99] ${
                      active
                        ? 'bg-rose-500/20 border-rose-500 text-white shadow-[0_0_15px_rgba(244,63,94,0.2)]'
                        : 'bg-slate-950 border-slate-800 text-slate-300'
                    }`}
                  >
                    <span>{c.label}</span>
                    <span className={`w-5 h-5 rounded-lg flex items-center justify-center border ${
                      active ? 'bg-rose-500 border-rose-500 text-white' : 'border-slate-700'
                    }`}>
                      {active && <CheckCircle2 size={13} />}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="pt-2">
              <label className="block text-[11px] font-black uppercase text-slate-400 mb-1.5">
                Note Opzionali / Dettagli Riscontrati
              </label>
              <textarea
                rows={3}
                value={operatorNotes}
                onChange={e => setOperatorNotes(e.target.value)}
                placeholder="Descrivi il problema, il lotto reale stampato, quanti colli rotti o i kili effettivi..."
                className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-3 text-sm text-white placeholder:text-slate-600 focus:border-rose-500 outline-none"
              />
            </div>

            <button
              type="button"
              disabled={submitting}
              onClick={handleSubmitNc}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-rose-500 to-amber-500 text-brand-black font-black text-base flex items-center justify-center gap-2 shadow-[0_0_24px_rgba(244,63,94,0.35)] active:scale-95 transition-all disabled:opacity-50"
            >
              <Send size={18} />
              {submitting ? 'Invio al Gestionale...' : 'Invia Rettifica Non Conformità'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default NonConformityZebra;
