import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import {
  Truck, Container, ScanBarcode, CheckCircle2, AlertTriangle, Thermometer,
  ShieldCheck, FileText, ArrowRight, ChevronLeft, Keyboard, Lock, ClipboardCheck
} from 'lucide-react';
import useBarcodeScanner from '../hooks/useBarcodeScanner';
import ZebraErrorModal from './ZebraErrorModal';
import { useZebraWorkspace } from '../utils/zebraWorkspace';

const ZebraLoadVehicleWizard = () => {
  const navigate = useNavigate();
  const workspace = useZebraWorkspace();
  const token = localStorage.getItem('maglite_token');

  // Step: SCAN_BOLLA -> FORM_CONTROLS -> RECHECK_BARCODES (optional) -> DONE
  const [step, setStep] = useState('SCAN_BOLLA');
  const [scanInput, setScanInput] = useState('');
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [readyShipments, setReadyShipments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [bollaData, setBollaData] = useState(null); // { order, items, unique_barcodes, compliance }

  // Form data
  const [vehicleType, setVehicleType] = useState('CAMION');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [sealNumber, setSealNumber] = useState('');
  const [carrierName, setCarrierName] = useState('');
  const [hygieneOk, setHygieneOk] = useState(true);
  const [hygieneNotes, setHygieneNotes] = useState('');
  const [recordedTemp, setRecordedTemp] = useState('');
  const [strisciataTaken, setStrisciataTaken] = useState(false);
  const [notes, setNotes] = useState('');

  // Barcode recheck
  const [scannedBarcodes, setScannedBarcodes] = useState([]);
  const [recheckInput, setRecheckInput] = useState('');
  const [doneResult, setDoneResult] = useState(null);

  const inputRef = useRef(null);
  const recheckRef = useRef(null);

  const fetchReady = async () => {
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/outbound?ready_only=true`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setReadyShipments(res.data || []);
    } catch (_) {}
  };

  useEffect(() => {
    if (step === 'SCAN_BOLLA') fetchReady();
  }, [step]);

  const lookupBolla = async (rawCode) => {
    const clean = String(rawCode || '').trim().toUpperCase();
    if (!clean || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(
        `http://${window.location.hostname}:3000/api/outbound/bolla-lookup/${encodeURIComponent(clean)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = res.data;
      setBollaData(data);
      const ord = data.order || {};
      const parsedOpts = ord.bolla_options_parsed || {};
      setVehicleType(ord.is_container ? 'CONTAINER' : 'CAMION');
      setVehiclePlate(ord.load_vehicle_plate || parsedOpts.vehicle_plate || '');
      setCarrierName(parsedOpts.carrier_name || '');
      setSealNumber(parsedOpts.seal_number || '');
      setHygieneOk(true);
      setHygieneNotes('');
      setRecordedTemp('');
      setStrisciataTaken(false);
      setNotes('');
      setScannedBarcodes([]);
      setStep('FORM_CONTROLS');
    } catch (err) {
      setError(err.response?.data?.error || `Bolla o Spedizione "${clean}" non trovata`);
    } finally {
      setLoading(false);
    }
  };

  useBarcodeScanner((barcode) => {
    const clean = String(barcode || '').trim().toUpperCase();
    if (!clean) return;
    if (step === 'SCAN_BOLLA') {
      lookupBolla(clean);
    } else if (step === 'RECHECK_BARCODES') {
      handleRecheckScan(clean);
    }
  });

  const handleRecheckScan = (rawBarcode) => {
    const code = String(rawBarcode || '').trim().toUpperCase();
    if (!code || !bollaData) return;
    const expected = (bollaData.unique_barcodes || []).map(b => b.toUpperCase());
    if (!expected.includes(code)) {
      setError(`ATTENZIONE: "${code}" non appartiene ai bancali di questa Bolla!`);
      return;
    }
    setError(null);
    setScannedBarcodes(prev => (prev.includes(code) ? prev : [...prev, code]));
    setRecheckInput('');
  };

  const submitLoadComplete = async () => {
    if (!bollaData || loading) return;
    if (!vehiclePlate.trim()) {
      return setError('Inserisci la targa del camion o sigla del container.');
    }
    if (!hygieneOk) {
      return setError('Conferma che le condizioni igienico-sanitarie sono conformi.');
    }
    if (bollaData.compliance?.needsTempCheck) {
      if (recordedTemp === '' || recordedTemp === null) {
        return setError('Spedizione a temperatura controllata: inserisci la temperatura rilevata.');
      }
      if (!strisciataTaken) {
        return setError('Ricordati di ritirare la strisciata dal camionista e spunta la conferma!');
      }
    }

    const expectedBarcodes = bollaData.unique_barcodes || [];
    if (bollaData.order?.require_load_recheck && expectedBarcodes.length > 0 && step !== 'RECHECK_BARCODES') {
      setError(null);
      setStep('RECHECK_BARCODES');
      setTimeout(() => recheckRef.current?.focus({ preventScroll: true }), 80);
      return;
    }

    if (bollaData.order?.require_load_recheck && expectedBarcodes.some(b => !scannedBarcodes.includes(b.toUpperCase()))) {
      return setError('Completa la ri-scansione di tutti i bancali prima di chiudere il carico.');
    }

    setLoading(true);
    setError(null);
    try {
      const targetCode = bollaData.order?.bolla_number || bollaData.order?.order_code;
      const res = await axios.post(
        `http://${window.location.hostname}:3000/api/outbound/${encodeURIComponent(targetCode)}/bolla-complete-loading`,
        {
          vehicle_type: vehicleType,
          vehicle_plate: vehiclePlate.trim().toUpperCase(),
          seal_number: sealNumber.trim(),
          carrier_name: carrierName.trim(),
          hygiene_ok: hygieneOk,
          hygiene_notes: hygieneNotes.trim(),
          recorded_temp: recordedTemp !== '' ? recordedTemp : null,
          strisciata_taken: strisciataTaken,
          driver_present: true,
          recheck_scanned_barcodes: scannedBarcodes,
          warehouse_id: workspace?.warehouseId || null,
          warehouse_name: workspace?.warehouseName || null,
          division_name: workspace?.divisionName || null,
          notes: notes.trim()
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setDoneResult(res.data);
      setStep('DONE');
    } catch (err) {
      setError(err.response?.data?.error || 'Errore completamento carico mezzo');
    } finally {
      setLoading(false);
    }
  };

  const resetAll = () => {
    setBollaData(null);
    setScanInput('');
    setDoneResult(null);
    setError(null);
    setStep('SCAN_BOLLA');
  };

  if (step === 'DONE' && doneResult) {
    return (
      <div className="flex-1 p-5 flex flex-col items-center justify-center text-center max-w-md mx-auto w-full">
        <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center mb-5 shadow-[0_0_30px_rgba(16,185,129,0.3)]">
          <CheckCircle2 size={46} className="text-emerald-400" />
        </div>
        <h2 className="text-2xl font-black text-white mb-1">Carico Mezzo Registrato!</h2>
        <p className="text-emerald-300 font-mono font-bold text-sm mb-3">
          {doneResult.order_code} {doneResult.bolla_number ? `• ${doneResult.bolla_number}` : ''}
        </p>
        <div className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 mb-6 text-left text-xs space-y-1.5">
          <div className="flex justify-between">
            <span className="text-slate-400">ID Log Permanente:</span>
            <span className="font-mono font-black text-sky-400">{doneResult.session_code}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Mezzo / Targa:</span>
            <span className="font-mono font-bold text-white">{vehicleType} • {vehiclePlate}</span>
          </div>
          {recordedTemp !== '' && (
            <div className="flex justify-between">
              <span className="text-slate-400">Temperatura &amp; Strisciata:</span>
              <span className="font-bold text-cyan-300">{recordedTemp}°C {strisciataTaken ? '• Strisciata OK' : ''}</span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={resetAll}
          className="w-full py-4 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-2xl font-black text-base mb-3"
        >
          Registra Altro Carico / Bolla
        </button>
        <button
          type="button"
          onClick={() => navigate('/zebra')}
          className="w-full py-3.5 bg-slate-800 text-white rounded-2xl font-bold text-sm"
        >
          Torna alla Home Zebra
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 flex flex-col gap-3 max-w-md mx-auto w-full">
      <ZebraErrorModal message={error} onClose={() => setError(null)} />

      {/* Top header */}
      <div className="flex items-center justify-between gap-2 bg-slate-900 border border-slate-800 rounded-2xl px-3.5 py-2.5">
        <button
          type="button"
          onClick={() => (step === 'SCAN_BOLLA' ? navigate('/zebra') : resetAll())}
          className="p-2 bg-slate-800 rounded-xl text-slate-300"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="text-center min-w-0 flex-1">
          <h2 className="text-sm font-black text-white uppercase tracking-wide flex items-center justify-center gap-1.5">
            {vehicleType === 'CONTAINER' ? <Container size={16} className="text-amber-400" /> : <Truck size={16} className="text-brand-blue" />}
            Carico Camion / Container
          </h2>
          {bollaData && (
            <p className="text-[11px] font-mono text-sky-400 truncate">
              {bollaData.order?.bolla_number || bollaData.order?.order_code} • {bollaData.order?.customer_name}
            </p>
          )}
        </div>
        <div className="w-8" />
      </div>

      {error && (
        <div className="bg-rose-500/15 border-2 border-rose-500 p-3 rounded-2xl flex gap-2 items-center text-rose-200 text-xs font-bold">
          <AlertTriangle size={18} className="text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* STEP 1: SCAN BOLLA */}
      {step === 'SCAN_BOLLA' && (
        <div className="space-y-4">
          <div className="bg-slate-900 border-2 border-brand-blue rounded-3xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase text-brand-blue flex items-center gap-1.5">
                <ScanBarcode size={18} /> Scansiona Bolla di Uscita
              </span>
              <button
                type="button"
                onClick={() => {
                  const next = !keyboardOpen;
                  setKeyboardOpen(next);
                  setTimeout(() => inputRef.current?.focus(), 40);
                }}
                className={`px-2.5 py-1 rounded-xl text-xs font-bold flex items-center gap-1 ${keyboardOpen ? 'bg-brand-blue text-brand-black' : 'bg-slate-800 text-slate-300'}`}
              >
                <Keyboard size={14} /> {keyboardOpen ? 'Chiudi' : 'Digita'}
              </button>
            </div>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                inputMode={keyboardOpen ? 'text' : 'none'}
                value={scanInput}
                onChange={e => setScanInput(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && lookupBolla(scanInput)}
                placeholder="Spara BOL-... o OUT-..."
                className="flex-1 bg-slate-950 border-2 border-slate-700 rounded-2xl p-3 font-mono font-bold text-white uppercase text-sm focus:border-brand-blue outline-none"
              />
              <button
                type="button"
                disabled={loading || !scanInput.trim()}
                onClick={() => lookupBolla(scanInput)}
                className="px-4 bg-brand-blue text-brand-black font-black rounded-2xl disabled:opacity-40"
              >
                <ArrowRight size={20} />
              </button>
            </div>
          </div>

          {/* Elenco rapido bolle pronte */}
          <div className="space-y-2">
            <div className="text-[11px] font-black uppercase tracking-wider text-slate-400 px-1">
              Spedizioni Pronte per il Carico ({readyShipments.length})
            </div>
            {readyShipments.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 bg-slate-900/50 border border-slate-800 rounded-2xl">
                Nessuna spedizione in stato PRONTO. Puoi comunque scansionare una qualsiasi Bolla / Ordine qui sopra.
              </div>
            ) : (
              readyShipments.map(o => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => lookupBolla(o.bolla_number || o.order_code)}
                  className="w-full text-left bg-slate-900 border border-slate-800 active:border-brand-blue rounded-2xl p-3.5 space-y-1 shadow"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-black text-sky-400 text-sm">
                      {o.bolla_number || o.order_code}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-black ${o.is_container ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-slate-300'}`}>
                      {o.is_container ? 'CONTAINER' : 'CAMION'}
                    </span>
                  </div>
                  <div className="text-sm font-bold text-white truncate">{o.customer_name}</div>
                  <div className="flex flex-wrap gap-1.5 text-[10px]">
                    <span className="text-slate-400">{o.total_items} righe</span>
                    {Boolean(o.require_load_recheck) && (
                      <span className="px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 font-bold">Ri-verifica Barcode</span>
                    )}
                    {Boolean(o.has_adr) && (
                      <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold">ADR</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* STEP 2: CONTROLLI IGIENE, TEMPERATURA, STRISCIATA, TARGA */}
      {step === 'FORM_CONTROLS' && bollaData && (
        <div className="space-y-3 pb-6">
          {/* Riepilogo Compliance Bolla */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-black text-slate-300 uppercase text-[10px]">Riepilogo Merce in Bolla</span>
              <span className="font-mono font-bold text-emerald-400">{bollaData.items?.length || 0} righe</span>
            </div>
            {bollaData.order?.delivery_address_text && (
              <p className="text-slate-400 text-[11px] truncate">Dest: {bollaData.order.delivery_address_text}</p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {bollaData.compliance?.temp_labels?.map(lbl => (
                <span key={lbl} className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-black text-[10px]">
                  <Thermometer size={11} className="inline mr-1" />{lbl}
                </span>
              ))}
              {bollaData.compliance?.isAdr && (
                <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 font-black text-[10px]">
                  MERCE ADR
                </span>
              )}
              {bollaData.order?.require_load_recheck && (
                <span className="px-2 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/40 font-black text-[10px]">
                  <ShieldCheck size={11} className="inline mr-1" />Richiesta Ri-Verifica Barcode ({bollaData.unique_barcodes?.length || 0} pal.)
                </span>
              )}
            </div>
          </div>

          {/* Tipo Mezzo + Targa + Sigillo */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-3">
            <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
              {['CAMION', 'CONTAINER'].map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setVehicleType(t)}
                  className={`flex-1 py-2 rounded-lg text-xs font-black transition-all ${
                    vehicleType === t
                      ? (t === 'CONTAINER' ? 'bg-amber-500 text-brand-black' : 'bg-brand-blue text-brand-black')
                      : 'text-slate-400'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">
                {vehicleType === 'CONTAINER' ? 'Numero Container / Targa Motrice *' : 'Targa Camion / Rimorchio *'}
              </label>
              <input
                type="text"
                value={vehiclePlate}
                onChange={e => setVehiclePlate(e.target.value.toUpperCase())}
                placeholder={vehicleType === 'CONTAINER' ? 'Es. MSCU1234567' : 'Es. AB123CD'}
                className="w-full bg-slate-950 border-2 border-slate-700 rounded-xl p-3 font-mono font-black text-white uppercase text-base focus:border-brand-blue outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Sigillo (opz.)</label>
                <input
                  type="text"
                  value={sealNumber}
                  onChange={e => setSealNumber(e.target.value.toUpperCase())}
                  placeholder="SIG-..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs font-mono text-white uppercase"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Vettore (opz.)</label>
                <input
                  type="text"
                  value={carrierName}
                  onChange={e => setCarrierName(e.target.value)}
                  placeholder="Trasportatore"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-white"
                />
              </div>
            </div>
          </div>

          {/* Temperatura & Strisciata (se merce a Temperatura Controllata) */}
          {bollaData.compliance?.needsTempCheck && (
            <div className="bg-cyan-950/30 border-2 border-cyan-500/50 rounded-2xl p-3.5 space-y-3">
              <div className="text-xs font-black uppercase text-cyan-300 flex items-center gap-1.5">
                <Thermometer size={16} /> Controllo Temperatura &amp; Strisciata Obbligatori
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-cyan-200 mb-1">
                  Temperatura Rilevata sul Mezzo (°C) *
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={recordedTemp}
                  onChange={e => setRecordedTemp(e.target.value)}
                  placeholder="Es. 5.4 o 18.2"
                  className="w-full bg-slate-950 border-2 border-cyan-500/50 rounded-xl p-3 font-mono font-black text-white text-lg focus:border-cyan-400 outline-none"
                />
              </div>
              <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-950 border border-amber-500/40 cursor-pointer">
                <input
                  type="checkbox"
                  checked={strisciataTaken}
                  onChange={e => setStrisciataTaken(e.target.checked)}
                  className="mt-0.5 w-5 h-5 rounded border-amber-500 bg-slate-900 text-amber-400"
                />
                <span className="text-xs font-black text-amber-200 leading-snug">
                  RICORDA: Ho preso la strisciata / stampata termografica dal camionista prima della partenza!
                </span>
              </label>
            </div>
          )}

          {/* Condizioni Igienico-Sanitarie */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2.5">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={hygieneOk}
                onChange={e => setHygieneOk(e.target.checked)}
                className="mt-0.5 w-5 h-5 rounded border-emerald-500 bg-slate-950 text-emerald-500"
              />
              <div>
                <span className="text-xs font-black text-emerald-300 block">
                  Condizioni Igienico-Sanitarie Mezzo Conformi *
                </span>
                <span className="text-[10px] text-slate-400">
                  Piano di carico pulito, asciutto, privo di odori, parassiti o residui contaminanti.
                </span>
              </div>
            </label>
            <input
              type="text"
              value={hygieneNotes}
              onChange={e => setHygieneNotes(e.target.value)}
              placeholder="Note pulizia / carico / autista (opzionale)..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white"
            />
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={submitLoadComplete}
            className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 text-brand-black rounded-2xl font-black text-base shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {bollaData.order?.require_load_recheck && (bollaData.unique_barcodes?.length || 0) > 0 ? (
              <>
                <ShieldCheck size={20} /> Avvia Ri-Verifica Barcode ({bollaData.unique_barcodes.length} pal.)
              </>
            ) : (
              <>
                <ClipboardCheck size={20} /> Conferma Carico &amp; Segna Spedito
              </>
            )}
          </button>
        </div>
      )}

      {/* STEP 3: RI-VERIFICA BARCODE BANCALI DA UFFICIO */}
      {step === 'RECHECK_BARCODES' && bollaData && (
        <div className="space-y-3 pb-6">
          <div className="bg-violet-950/35 border-2 border-violet-500 rounded-3xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase text-violet-300 flex items-center gap-1.5">
                <ShieldCheck size={17} /> Ri-Verifica Obbligatoria Palette
              </span>
              <span className="font-mono text-sm font-black text-white">
                {scannedBarcodes.length} / {bollaData.unique_barcodes.length}
              </span>
            </div>
            <div className="flex gap-2">
              <input
                ref={recheckRef}
                type="text"
                value={recheckInput}
                onChange={e => setRecheckInput(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handleRecheckScan(recheckInput)}
                placeholder="Scansiona barcode PAL-..."
                className="flex-1 bg-slate-950 border-2 border-violet-500/50 rounded-xl p-3 font-mono font-bold text-white uppercase text-sm"
              />
              <button
                type="button"
                onClick={() => handleRecheckScan(recheckInput)}
                className="px-4 bg-violet-500 text-white font-black rounded-xl"
              >
                <ArrowRight size={18} />
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            {bollaData.unique_barcodes.map(code => {
              const isDone = scannedBarcodes.includes(code.toUpperCase());
              const rowItem = bollaData.items.find(i => i.pallet_code === code);
              return (
                <div
                  key={code}
                  className={`p-3 rounded-2xl border flex items-center justify-between ${
                    isDone
                      ? 'bg-emerald-500/15 border-emerald-500 text-emerald-200'
                      : 'bg-slate-900 border-slate-800 text-slate-300'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-mono font-black text-sm">{code}</div>
                    <div className="text-[11px] truncate opacity-80">{rowItem?.product_name || ''}</div>
                  </div>
                  {isDone ? (
                    <CheckCircle2 size={22} className="text-emerald-400 shrink-0" />
                  ) : (
                    <span className="text-[10px] font-black uppercase bg-slate-800 px-2 py-1 rounded">Da sparare</span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep('FORM_CONTROLS')}
              className="px-4 py-3.5 bg-slate-800 text-slate-300 rounded-2xl font-bold text-xs"
            >
              Indietro
            </button>
            <button
              type="button"
              disabled={loading || scannedBarcodes.length < bollaData.unique_barcodes.length}
              onClick={submitLoadComplete}
              className="flex-1 py-3.5 bg-emerald-500 hover:bg-emerald-400 text-brand-black rounded-2xl font-black text-sm disabled:opacity-40"
            >
              Conferma Carico Finale
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ZebraLoadVehicleWizard;
