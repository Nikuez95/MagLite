import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import {
  PackageMinus,
  MapPin,
  ScanBarcode,
  ArrowRight,
  CheckCircle,
  AlertTriangle,
  ChevronLeft,
  Keyboard,
  ListOrdered,
  Box,
  Layers,
  X,
  Check,
  Sparkles,
  Minus,
  Plus
} from 'lucide-react';
import useBarcodeScanner from '../hooks/useBarcodeScanner';

// Calcola la visualizzazione prioritaria per il Picking: prima SCATOLE (cosa prendere fisicamente), poi l'equivalente in PEZZI
export const getPickQuantityInfo = (item) => {
  if (!item) {
    return {
      qty: 0,
      uom: 'Pezzi',
      upb: 1,
      primaryText: '0 PEZZI',
      secondaryText: '',
      badgeText: null,
      hasBoxConversion: false,
      isExactBoxes: false,
      boxes: 0,
      loosePieces: 0
    };
  }

  const qty = parseFloat(item.quantity_required) || 0;
  const upb = parseInt(item.units_per_box, 10) || 1;
  const uom = (item.uom || 'Pezzi').trim();
  const uomLower = uom.toLowerCase();

  // Caso 1: Richiesto in Pezzi/Sfuso ma il prodotto ha confezionamento in Scatole (units_per_box > 1)
  if (upb > 1 && (uomLower === 'pezzi' || uomLower === 'sfuso' || uomLower === 'pz' || uomLower === 'pezzo')) {
    const boxes = Math.floor(qty / upb);
    const loosePieces = Math.round((qty - boxes * upb) * 100) / 100;

    if (boxes > 0 && loosePieces === 0) {
      return {
        qty,
        uom,
        upb,
        primaryText: `${boxes} ${boxes === 1 ? 'SCATOLA' : 'SCATOLE'}`,
        secondaryText: `Equivalgono a ${qty} Pezzi`,
        badgeText: `1 scatola = ${upb} pz`,
        hasBoxConversion: true,
        isExactBoxes: true,
        boxes,
        loosePieces: 0
      };
    }

    if (boxes > 0 && loosePieces > 0) {
      return {
        qty,
        uom,
        upb,
        primaryText: `${boxes} ${boxes === 1 ? 'SCATOLA' : 'SCATOLE'} + ${loosePieces} ${loosePieces === 1 ? 'SFUSO' : 'SFUSI'}`,
        secondaryText: `Equivalgono a ${qty} Pezzi totali`,
        badgeText: `${boxes}×${upb} pz + ${loosePieces} sfusi`,
        hasBoxConversion: true,
        isExactBoxes: false,
        boxes,
        loosePieces
      };
    }

    return {
      qty,
      uom,
      upb,
      primaryText: `${qty} ${qty === 1 ? 'PEZZO SFUSO' : 'PEZZI SFUSI'}`,
      secondaryText: `Meno di 1 scatola (1 scat. = ${upb} pz)`,
      badgeText: `Conf. ${upb} pz/scat.`,
      hasBoxConversion: false,
      isExactBoxes: false,
      boxes: 0,
      loosePieces: qty
    };
  }

  // Caso 2: Richiesto direttamente in Scatole / Cartoni
  if (uomLower === 'scatole' || uomLower === 'cartoni') {
    const totalPieces = upb > 1 ? Math.round(qty * upb * 100) / 100 : null;
    return {
      qty,
      uom,
      upb,
      primaryText: `${qty} ${qty === 1 ? 'SCATOLA' : 'SCATOLE'}`,
      secondaryText: totalPieces ? `Equivalgono a ${totalPieces} Pezzi` : 'Preleva i colli indicati',
      badgeText: upb > 1 ? `1 scatola = ${upb} pz` : null,
      hasBoxConversion: false,
      isExactBoxes: false,
      boxes: qty,
      loosePieces: 0
    };
  }

  // Caso 3: Bancali / Palette intere
  if (uomLower === 'bancali' || uomLower === 'palette') {
    const palQty = parseFloat(item.pallet_quantity);
    return {
      qty,
      uom,
      upb,
      primaryText: `${qty} ${qty === 1 ? 'BANCALE INTERO' : 'BANCALI'}`,
      secondaryText: palQty > 0 ? `Contenuto paletta: ${palQty} ${item.base_uom || 'Pezzi'}` : 'Preleva bancale intero',
      badgeText: upb > 1 ? `${upb} pz/scat.` : null,
      hasBoxConversion: false,
      isExactBoxes: false,
      boxes: 0,
      loosePieces: 0
    };
  }

  // Caso 4: Pezzi singoli senza multiplo scatola (units_per_box <= 1)
  return {
    qty,
    uom,
    upb,
    primaryText: `${qty} ${qty === 1 && uomLower === 'pezzi' ? 'PEZZO' : uom.toUpperCase()}`,
    secondaryText: 'Unità singole da prelevare',
    badgeText: null,
    hasBoxConversion: false,
    isExactBoxes: false,
    boxes: 0,
    loosePieces: qty
  };
};

const isItemNoScan = (item) => {
  if (!item) return false;
  const isFreeLocation = (!item.zone || item.zone === 'null') && (item.location && item.location !== 'null');
  return String(item.pallet_code || '').startsWith('NOBAR-') || isFreeLocation;
};

const formatLocationLabel = (item) => {
  if (!item) return 'N/D';
  if (item.zone && item.zone !== 'null') {
    return `${item.zone} · ${item.col} · ${item.pos}`;
  }
  return item.location || 'Senza Posizione';
};

const OutboundZebra = () => {
  const navigate = useNavigate();
  const token = localStorage.getItem('maglite_token');

  const [order, setOrder] = useState(null);
  const [allOrderItems, setAllOrderItems] = useState([]);
  const [items, setItems] = useState([]);
  const [currentItemIndex, setCurrentItemIndex] = useState(0);
  // Steps: SCAN_ORDER, SCAN_PIN, SCAN_PALLET, SELECT_MIXED_ITEM, INPUT_QTY, PICK_CONFIRMED, FINISHED
  const [step, setStep] = useState('SCAN_ORDER');

  const [pendingOrders, setPendingOrders] = useState([]);
  const [scannedOrder, setScannedOrder] = useState('');
  const [scannedPin, setScannedPin] = useState('');
  const [scannedPallet, setScannedPallet] = useState('');
  const [qtyInput, setQtyInput] = useState('');
  const [boxesInput, setBoxesInput] = useState('');
  const [manualScanInput, setManualScanInput] = useState('');

  // Controllo tastiera virtuale Zebra: di default CHIUSA (inputMode="none") per non coprire lo schermo
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [showRouteModal, setShowRouteModal] = useState(false);

  const [mixedPalletItems, setMixedPalletItems] = useState([]);
  const [lastPickedSummary, setLastPickedSummary] = useState(null);
  const [previousLocationKey, setPreviousLocationKey] = useState(null);

  // Protezione anti-doppio-tap tra una conferma e la successiva
  const [isConfirmLocked, setIsConfirmLocked] = useState(false);
  const [isTransitionLocked, setIsTransitionLocked] = useState(false);

  const [error, setError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const inputRef = useRef(null);
  const autoAdvanceTimerRef = useRef(null);
  const scanDebounceRef = useRef(null);

  const currentItem = items[currentItemIndex];

  // Carica lista ordini attivi (PENDING / PICKING) per avvio rapido con 1 tap
  useEffect(() => {
    if (step === 'SCAN_ORDER') {
      axios
        .get(`http://${window.location.hostname}:3000/api/outbound`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        .then((res) => {
          const active = (res.data || []).filter(
            (o) => o.status === 'PENDING' || o.status === 'PICKING' || o.status === 'RETURNED'
          );
          setPendingOrders(active);
        })
        .catch(() => {});
    }
  }, [step, token]);

  // Ogni volta che cambia lo step, chiudi la tastiera virtuale e mantieni il focus silenzioso (inputMode="none")
  useEffect(() => {
    setKeyboardOpen(false);
    if ((step === 'SCAN_ORDER' || step === 'SCAN_PIN' || step === 'SCAN_PALLET') && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus({ preventScroll: true });
      }, 50);
    }
  }, [step, currentItemIndex]);

  // Cleanup timer
  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current);
    };
  }, []);

  const toggleVirtualKeyboard = () => {
    const nextState = !keyboardOpen;
    setKeyboardOpen(nextState);
    setTimeout(() => {
      if (inputRef.current) {
        if (nextState) {
          inputRef.current.focus();
        } else {
          inputRef.current.blur();
          setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
        }
      }
    }, 30);
  };

  const prepareQtyInputs = useCallback((item) => {
    if (!item) return;
    const reqQty = parseFloat(item.quantity_required) || 0;
    const info = getPickQuantityInfo(item);
    setQtyInput(reqQty.toString());
    if (info.hasBoxConversion && info.isExactBoxes) {
      setBoxesInput(info.boxes.toString());
    } else {
      setBoxesInput('');
    }
    // Blocca il pulsante conferma per 750ms quando si entra in INPUT_QTY per evitare doppi tap involontari
    setIsConfirmLocked(true);
    setTimeout(() => setIsConfirmLocked(false), 750);
  }, []);

  const checkAndSkipPin = useCallback(
    (item) => {
      if (!item) return;
      if (isItemNoScan(item)) {
        setScannedPallet(item.pallet_code);
        prepareQtyInputs(item);
        setStep('INPUT_QTY');
      } else {
        setStep('SCAN_PALLET');
      }
    },
    [prepareQtyInputs]
  );

  const advanceFromConfirmed = useCallback(
    (nextItemsList, targetIdx = 0, preScannedBarcode = null) => {
      if (autoAdvanceTimerRef.current) {
        clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
      const nextItem = nextItemsList[targetIdx];
      if (!nextItem) {
        setStep('FINISHED');
        return;
      }
      setError(null);
      setScannedPin('');
      setScannedPallet('');
      setQtyInput('');
      setBoxesInput('');
      setManualScanInput('');
      setCurrentItemIndex(targetIdx);

      if (preScannedBarcode) {
        // L'operatore ha già sparato il barcode della paletta successiva mentre era sulla schermata di conferma
        setStep('SCAN_PALLET');
        setTimeout(() => {
          handlePalletBarcodeScan(preScannedBarcode, nextItem, nextItemsList, targetIdx);
        }, 30);
      } else {
        checkAndSkipPin(nextItem);
      }
    },
    [checkAndSkipPin]
  );

  const handlePalletBarcodeScan = async (barcode, targetItem = currentItem, currentItemsList = items, idx = currentItemIndex) => {
    if (!targetItem) return;
    const cleanCode = barcode.trim();
    setIsProcessing(true);
    setError(null);

    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/pallets/${cleanCode}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const palData = res.data;

      const isExactPallet = cleanCode.toLowerCase() === String(targetItem.pallet_code || '').toLowerCase();
      const targetBatch = (targetItem.batch || '').trim().toUpperCase();
      const palBatch = (palData.batch || '').trim().toUpperCase();
      const matchesBatch = !targetBatch || targetBatch === 'NESSUN LOTTO' || palBatch === targetBatch;
      const matchesProduct = palData.product_id === targetItem.product_id || (palData.isMixed && Array.isArray(palData.items) && palData.items.some(m => m.product_id === targetItem.product_id));

      if (!isExactPallet && (!matchesProduct || !matchesBatch || palData.status === 'SHIPPED')) {
        try {
          navigator.vibrate?.([100, 60, 100]);
        } catch (e) {}
        setError(`Paletta errata (${cleanCode}). Attesa: ${targetItem.pallet_code}`);
        return;
      }

      if (!isExactPallet) {
        targetItem.pallet_code = palData.pallet_code;
        targetItem.pallet_id = palData.id;
        targetItem.location = palData.location;
      }

      setScannedPallet(cleanCode);
      setError(null);

      if (res.data.isMixed && Array.isArray(res.data.items)) {
        // Raggruppa per prodotto + lotto per non mostrare duplicati identici
        const groupedMap = new Map();
        for (const m of res.data.items) {
          const key = `${m.product_id}__${(m.batch || '').trim().toUpperCase()}`;
          if (!groupedMap.has(key)) {
            groupedMap.set(key, { ...m, quantity: parseFloat(m.quantity) || 0 });
          } else {
            const existing = groupedMap.get(key);
            existing.quantity += parseFloat(m.quantity) || 0;
          }
        }
        const distinctMixed = Array.from(groupedMap.values());

        if (distinctMixed.length > 1) {
          setMixedPalletItems(distinctMixed);
          setStep('SELECT_MIXED_ITEM');
          return;
        }
      }

      const palletQty = parseFloat(res.data.quantity);
      const reqQty = parseFloat(targetItem.quantity_required);
      if (palletQty === reqQty || (targetItem.uom === 'Bancali' && reqQty === 1)) {
        // Bancale intero / quantità intera: processa subito e mostra la schermata di feedback PICK_CONFIRMED
        await processPick(reqQty, cleanCode, targetItem, currentItemsList, idx);
      } else {
        prepareQtyInputs(targetItem);
        setStep('INPUT_QTY');
      }
    } catch (err) {
      try {
        navigator.vibrate?.([100, 60, 100]);
      } catch (e) {}
      setError(`Errore lettura dettagli paletta (${cleanCode}).`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleScan = async (rawBarcode) => {
    const barcode = String(rawBarcode || '').trim();
    if (!barcode || isProcessing || step === 'FINISHED') return;

    // Se siamo sulla schermata di conferma post-prelievo e l'operatore spara già la paletta del prelievo successivo
    if (step === 'PICK_CONFIRMED') {
      const nextItem = items[currentItemIndex];
      if (nextItem && !isItemNoScan(nextItem) && barcode.toUpperCase().startsWith('PAL-')) {
        advanceFromConfirmed(items, currentItemIndex, barcode);
      }
      return;
    }

    if (step === 'INPUT_QTY' || step === 'SELECT_MIXED_ITEM') return;

    setError(null);
    if (step === 'SCAN_ORDER') {
      const code = barcode.toUpperCase();
      setScannedOrder(code);
      fetchOrder(code);
    } else if (step === 'SCAN_PIN') {
      if (currentItem?.loc_pin && barcode.toLowerCase() === currentItem.loc_pin.toLowerCase()) {
        setScannedPin(barcode);
        setStep('SCAN_PALLET');
      } else {
        setError(`PIN errato. Atteso: ${currentItem?.loc_pin}`);
      }
    } else if (step === 'SCAN_PALLET') {
      await handlePalletBarcodeScan(barcode);
    }
  };

  // Hook globale per catturare scansioni laser Zebra anche quando nessun input ha il focus
  useBarcodeScanner((barcode) => {
    handleScan(barcode);
  });

  const fetchOrder = async (code) => {
    const cleanCode = String(code || '').trim().toUpperCase();
    if (!cleanCode) return;
    setIsProcessing(true);
    setError(null);
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/outbound/zebra/${cleanCode}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setOrder(res.data.order);
      setAllOrderItems(res.data.items || []);
      const remaining = (res.data.items || []).filter((i) => i.status !== 'PICKED');
      setItems(remaining);
      setPreviousLocationKey(null);
      setLastPickedSummary(null);

      if (remaining.length === 0) {
        setStep('FINISHED');
      } else {
        setCurrentItemIndex(0);
        checkAndSkipPin(remaining[0]);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Ordine non trovato');
      setScannedOrder('');
    } finally {
      setIsProcessing(false);
    }
  };

  const processPick = async (q, overridePallet = null, targetItem = currentItem, currentItemsList = items, idx = currentItemIndex) => {
    if (!targetItem || !order) return;
    setIsProcessing(true);
    setError(null);
    try {
      const res = await axios.post(
        `http://${window.location.hostname}:3000/api/outbound/zebra/pick`,
        {
          order_id: order.id,
          item_id: targetItem.id,
          pin: scannedPin,
          pallet_code: overridePallet || scannedPallet,
          qty_picked: q
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      // Vibrazione di conferma sul terminale Zebra
      try {
        navigator.vibrate?.(150);
      } catch (e) {}

      const pickedQtyInfo = getPickQuantityInfo(targetItem);
      const pickedLocKey = formatLocationLabel(targetItem);
      setPreviousLocationKey(pickedLocKey);

      // Aggiorna stato generale delle righe per il modal Percorso
      setAllOrderItems((prev) =>
        prev.map((it) => (it.id === targetItem.id ? { ...it, status: 'PICKED', quantity_picked: q } : it))
      );

      if (res.data.all_picked) {
        setStep('FINISHED');
      } else {
        const nextItems = currentItemsList.filter((i) => i.id !== targetItem.id);
        const nextIdx = Math.min(idx, nextItems.length - 1);
        const nextItem = nextItems[nextIdx];

        setItems(nextItems);
        setCurrentItemIndex(nextIdx);
        setScannedPin('');
        setScannedPallet('');
        setQtyInput('');
        setBoxesInput('');
        setManualScanInput('');

        setLastPickedSummary({
          product_name: targetItem.product_name,
          batch: targetItem.batch,
          locationLabel: pickedLocKey,
          primaryQty: pickedQtyInfo.primaryText,
          secondaryQty: pickedQtyInfo.secondaryText,
          nextItem,
          nextRequiresScan: !isItemNoScan(nextItem),
          sameLocationAsNext: nextItem ? formatLocationLabel(nextItem) === pickedLocKey : false
        });

        // Blocca per 600ms il pulsante della schermata di conferma per evitare tap accidentali multipli
        setIsTransitionLocked(true);
        setTimeout(() => setIsTransitionLocked(false), 600);

        setStep('PICK_CONFIRMED');

        // Se il prossimo articolo RICHIEDE uno scan della paletta, avanza in automatico dopo 1.8s
        // Se invece il prossimo articolo NON prevede uno scan (va diretto a conferma quantità),
        // attende che l'operatore prema esplicitamente "VAI AL PROSSIMO PRELIEVO" per evitare conferme involontarie!
        if (nextItem && !isItemNoScan(nextItem)) {
          if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current);
          autoAdvanceTimerRef.current = setTimeout(() => {
            advanceFromConfirmed(nextItems, nextIdx);
          }, 1800);
        }
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Errore di salvataggio');
      if (step !== 'SCAN_PALLET') setStep('INPUT_QTY');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmQty = async () => {
    if (isConfirmLocked || isProcessing) return;
    const q = parseFloat(qtyInput);
    const reqQty = parseFloat(currentItem?.quantity_required);
    const qtyInfo = getPickQuantityInfo(currentItem);

    if (isNaN(q) || Math.abs(q - reqQty) > 0.001) {
      setError(
        `Attenzione: devi prelevare esattamente ${qtyInfo.primaryText}${
          qtyInfo.hasBoxConversion ? ` (${reqQty} ${currentItem?.uom || 'Pezzi'})` : ''
        }!`
      );
      return;
    }
    await processPick(q);
  };

  const handleBoxesChange = (val, upb) => {
    setBoxesInput(val);
    setError(null);
    if (val === '' || isNaN(parseFloat(val))) {
      setQtyInput('');
      return;
    }
    const b = parseFloat(val);
    setQtyInput((Math.round(b * upb * 100) / 100).toString());
  };

  const handlePiecesChange = (val, upb, hasBoxConv) => {
    setQtyInput(val);
    setError(null);
    if (!hasBoxConv || !upb || upb <= 1) return;
    if (val === '' || isNaN(parseFloat(val))) {
      setBoxesInput('');
      return;
    }
    const p = parseFloat(val);
    const b = p / upb;
    setBoxesInput(Number.isInteger(b) ? b.toString() : parseFloat(b.toFixed(2)).toString());
  };

  // ============================================================================
  // STEP 1: SCANSIONE O SELEZIONE ORDINE (DDT)
  // ============================================================================
  if (step === 'SCAN_ORDER') {
    return (
      <div className="flex-1 p-4 flex flex-col max-w-md mx-auto w-full">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => navigate('/zebra')}
            className="p-3 bg-slate-800 active:bg-slate-700 rounded-2xl text-brand-white shrink-0"
          >
            <ChevronLeft size={24} />
          </button>
          <div>
            <h2 className="text-2xl font-black text-brand-white leading-tight">Picking Guidato</h2>
            <p className="text-slate-400 text-xs font-semibold">Scansiona il DDT o tocca un ordine pronto</p>
          </div>
        </div>

        {error && (
          <div className="bg-rose-500/15 border-2 border-rose-500/60 p-3.5 rounded-2xl text-rose-300 text-center font-bold mb-4 flex items-center justify-center gap-2">
            <AlertTriangle size={20} className="shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Box Scansione Laser DDT senza apertura automatica tastiera */}
        <div className="bg-slate-900 border-2 border-brand-blue/40 rounded-3xl p-4 mb-4 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-black uppercase tracking-wider text-brand-blue flex items-center gap-1.5">
              <ScanBarcode size={16} /> Laser attivo — Spara codice DDT
            </span>
            <button
              type="button"
              onClick={toggleVirtualKeyboard}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                keyboardOpen
                  ? 'bg-brand-blue text-brand-black shadow-[0_0_12px_rgba(14,165,233,0.4)]'
                  : 'bg-slate-800 text-slate-300 border border-slate-700'
              }`}
            >
              <Keyboard size={15} />
              {keyboardOpen ? 'Chiudi Tastiera' : 'Tastiera'}
            </button>
          </div>

          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              inputMode={keyboardOpen ? 'text' : 'none'}
              placeholder={keyboardOpen ? 'Digita OUT-...' : 'In attesa di scansione laser...'}
              className="bg-slate-950 border-2 border-slate-700 p-3.5 rounded-2xl text-lg font-mono font-bold w-full uppercase focus:border-brand-blue focus:outline-none text-brand-white"
              value={scannedOrder}
              onBlur={() => setKeyboardOpen(false)}
              onChange={(e) => {
                const val = e.target.value.toUpperCase();
                setScannedOrder(val);
                if (val.length >= 17 && val.startsWith('OUT-')) fetchOrder(val);
              }}
              onKeyDown={(e) => e.key === 'Enter' && scannedOrder && fetchOrder(scannedOrder)}
            />
            <button
              onClick={() => fetchOrder(scannedOrder)}
              disabled={!scannedOrder || isProcessing}
              className="bg-brand-blue text-brand-black px-5 rounded-2xl font-black text-lg disabled:opacity-40 shrink-0 active:scale-95 transition-transform"
            >
              {isProcessing ? '...' : <ArrowRight size={24} />}
            </button>
          </div>
        </div>

        {/* Lista Ordini Attivi da Prelevare (1-Tap Start) */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
              Ordini da Prelevare ({pendingOrders.length})
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2.5 pr-0.5">
            {pendingOrders.length === 0 ? (
              <div className="bg-slate-900/50 border border-slate-800 border-dashed rounded-2xl p-6 text-center text-slate-500 text-sm font-semibold">
                Nessun ordine in attesa. Scansiona un codice DDT per iniziare.
              </div>
            ) : (
              pendingOrders.map((ord) => (
                <button
                  key={ord.id}
                  onClick={() => {
                    setScannedOrder(ord.order_code);
                    fetchOrder(ord.order_code);
                  }}
                  disabled={isProcessing}
                  className="w-full text-left bg-slate-900 hover:bg-slate-800/90 active:scale-[0.99] border-2 border-slate-800 hover:border-brand-blue/60 p-4 rounded-2xl transition-all flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono font-black text-brand-blue text-base">{ord.order_code}</span>
                      <span
                        className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                          ord.status === 'PICKING'
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                            : 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                        }`}
                      >
                        {ord.status === 'PICKING' ? 'In Corso' : 'Da Iniziare'}
                      </span>
                    </div>
                    <p className="text-brand-white font-bold text-base truncate">{ord.customer_name}</p>
                    {ord.products && (
                      <p className="text-slate-400 text-xs truncate mt-0.5">{ord.products}</p>
                    )}
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-brand-blue/15 text-brand-blue flex items-center justify-center shrink-0">
                    <ArrowRight size={20} />
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // STEP FINALE: ORDINE COMPLETATO
  // ============================================================================
  if (step === 'FINISHED') {
    return (
      <div className="flex-1 p-6 flex flex-col items-center justify-center text-center max-w-md mx-auto w-full">
        <div className="w-24 h-24 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center mb-6 shadow-[0_0_40px_rgba(16,185,129,0.3)]">
          <CheckCircle size={56} className="text-emerald-400" />
        </div>
        <h2 className="text-3xl font-black text-brand-white mb-2">Picking Completato!</h2>
        <p className="text-emerald-400 font-mono font-bold text-lg mb-2">{order?.order_code}</p>
        <p className="text-slate-400 text-base mb-8">
          Tutti i {allOrderItems.length} prelievi sono stati validati. Porta la merce in area di carico.
        </p>

        <button
          onClick={() => {
            setOrder(null);
            setScannedOrder('');
            setStep('SCAN_ORDER');
          }}
          className="w-full bg-emerald-500 active:bg-emerald-400 text-emerald-950 p-4 rounded-2xl font-black text-xl mb-3 transition-all"
        >
          Preleva Altro Ordine
        </button>
        <button
          onClick={() => navigate('/zebra')}
          className="w-full bg-slate-800 hover:bg-slate-700 text-brand-white p-4 rounded-2xl font-bold text-lg transition-colors"
        >
          Torna alla Home
        </button>
      </div>
    );
  }

  // ============================================================================
  // STEP DI FEEDBACK INTERMEDIO: PRELIEVO CONFERMATO (Anti-errore sul successivo)
  // ============================================================================
  if (step === 'PICK_CONFIRMED' && lastPickedSummary) {
    const nextItem = lastPickedSummary.nextItem;
    const nextQtyInfo = getPickQuantityInfo(nextItem);
    const totalCount = allOrderItems.length || items.length + 1;
    const doneCount = totalCount - items.length;

    return (
      <div className="flex-1 p-4 flex flex-col justify-between max-w-md mx-auto w-full bg-emerald-950/20">
        {/* Banner Conferma Prelievo Appena Eseguito */}
        <div className="bg-emerald-500/15 border-2 border-emerald-500 rounded-3xl p-5 text-center shadow-[0_0_30px_rgba(16,185,129,0.2)]">
          <div className="w-16 h-16 rounded-full bg-emerald-500 text-emerald-950 flex items-center justify-center mx-auto mb-3 shadow-lg">
            <Check size={38} strokeWidth={3.5} />
          </div>
          <p className="text-xs font-black uppercase tracking-widest text-emerald-400 mb-1">
            Prelievo {doneCount} di {totalCount} Registrato!
          </p>
          <h3 className="text-2xl font-black text-brand-white leading-tight mb-1">
            ✓ {lastPickedSummary.primaryQty}
          </h3>
          {lastPickedSummary.secondaryQty && (
            <p className="text-emerald-300 font-bold text-sm mb-2">({lastPickedSummary.secondaryQty})</p>
          )}
          <p className="text-slate-300 font-bold text-sm truncate">{lastPickedSummary.product_name}</p>
          <p className="text-slate-400 text-xs font-mono mt-0.5">Da: {lastPickedSummary.locationLabel}</p>
        </div>

        {/* Anteprima Prossimo Prelievo */}
        {nextItem && (
          <div className="bg-slate-900 border-2 border-slate-700 rounded-3xl p-4 my-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-black uppercase tracking-wider text-brand-blue">
                Prossima Tappa ({doneCount + 1} di {totalCount})
              </span>
              {lastPickedSummary.sameLocationAsNext && (
                <span className="bg-amber-500 text-amber-950 text-[11px] font-black uppercase px-2.5 py-0.5 rounded-full">
                  ⚡ Stessa Posizione!
                </span>
              )}
            </div>

            <div className="bg-slate-950 border border-sky-500/30 rounded-2xl p-3 mb-2.5 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center shrink-0">
                <MapPin size={22} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase text-slate-400">Vai alla posizione</p>
                <p className="text-xl font-black text-brand-white truncate">{formatLocationLabel(nextItem)}</p>
              </div>
            </div>

            <p className="text-brand-white font-bold text-base leading-snug mb-1">{nextItem.product_name}</p>
            <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2 mt-2">
              <span className="text-xs font-bold uppercase text-emerald-300">Da prendere:</span>
              <div className="text-right">
                <span className="text-lg font-black text-emerald-400">{nextQtyInfo.primaryText}</span>
                {nextQtyInfo.hasBoxConversion && (
                  <span className="block text-[11px] text-emerald-300/80 font-bold">
                    ({nextQtyInfo.secondaryText})
                  </span>
                )}
              </div>
            </div>

            {!lastPickedSummary.nextRequiresScan && (
              <div className="mt-2.5 bg-amber-500/15 border border-amber-500/40 rounded-xl p-2.5 text-amber-300 text-xs font-bold text-center">
                ⚠️ Il prossimo prelievo NON richiede scansione barcode: premi il pulsante qui sotto quando sei pronto.
              </div>
            )}
          </div>
        )}

        {/* Pulsante Avanza (bloccato per 600ms contro doppi tap involontari) */}
        <button
          onClick={() => !isTransitionLocked && advanceFromConfirmed(items, currentItemIndex)}
          disabled={isTransitionLocked}
          className={`w-full py-5 rounded-2xl font-black text-xl flex items-center justify-center gap-2 transition-all shadow-xl ${
            isTransitionLocked
              ? 'bg-slate-800 text-slate-500'
              : 'bg-brand-blue active:bg-sky-400 text-brand-black active:scale-95'
          }`}
        >
          <span>VAI AL PROSSIMO PRELIEVO</span>
          <ArrowRight size={24} />
        </button>
      </div>
    );
  }

  // ============================================================================
  // SCHERMATA PRINCIPALE DI PICKING (Dove Andare -> Cosa Prendere -> Quanto Prendere)
  // ============================================================================
  const qtyInfo = getPickQuantityInfo(currentItem);
  const totalCount = allOrderItems.length || items.length;
  const completedCount = totalCount - items.length;
  const currentStepNumber = completedCount + 1;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const isMappedShelf = Boolean(currentItem?.zone && currentItem.zone !== 'null');
  const currentLocLabel = formatLocationLabel(currentItem);
  const isSameLocationAsPrev = Boolean(previousLocationKey && previousLocationKey === currentLocLabel);

  // Evidenzia le ultime 4 cifre del codice paletta (es. PAL-20261022-0154 -> 0154)
  const rawPalletCode = String(currentItem?.pallet_code || '');
  const isNoBarPallet = rawPalletCode.startsWith('NOBAR-');
  const palletPrefix = !isNoBarPallet && rawPalletCode.length > 4 ? rawPalletCode.slice(0, -4) : rawPalletCode;
  const palletHighlight = !isNoBarPallet && rawPalletCode.length > 4 ? rawPalletCode.slice(-4) : '';

  return (
    <div className="flex flex-col h-[calc(100vh-89px)] max-w-md mx-auto w-full select-none">
      {/* Barra Superiore Compatta: Ordine + Avanzamento + Tasto Percorso */}
      <div className="bg-slate-900 px-3.5 py-2.5 border-b border-slate-800 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => setStep('SCAN_ORDER')}
              className="p-2 bg-slate-800 rounded-xl text-slate-300 active:bg-slate-700 shrink-0"
              title="Cambia Ordine"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-brand-white font-mono font-black text-sm">{order?.order_code}</span>
                {order?.customer_name && (
                  <span className="text-slate-400 text-xs font-bold truncate">· {order.customer_name}</span>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={() => setShowRouteModal(true)}
            className="flex items-center gap-1.5 bg-brand-blue/15 border border-brand-blue/40 text-brand-blue px-3 py-1.5 rounded-xl font-black text-xs shrink-0 active:scale-95"
          >
            <ListOrdered size={16} />
            <span>
              Tappa {currentStepNumber}/{totalCount}
            </span>
          </button>
        </div>

        {/* Barra progresso visuale */}
        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden mt-2">
          <div
            className="h-full bg-gradient-to-r from-brand-blue to-emerald-400 transition-all duration-300"
            style={{ width: `${Math.max(6, progressPct)}%` }}
          />
        </div>
      </div>

      {/* Area Centrale Scrollabile */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5">
        {order?.notes && (
          <div className="bg-amber-500/15 border border-amber-500/40 px-3 py-2 rounded-2xl text-amber-200 text-xs font-bold shrink-0">
            <span className="text-amber-400 uppercase font-black mr-1.5">NOTA DDT:</span>
            {order.notes}
          </div>
        )}
        {error && (
          <div className="bg-rose-500/15 border-2 border-rose-500 p-3 rounded-2xl flex gap-2.5 items-center text-rose-300 shadow-lg shrink-0 animate-[shake_0.4s_ease-in-out]">
            <AlertTriangle size={22} className="shrink-0 text-rose-400" />
            <span className="font-bold text-sm leading-snug">{error}</span>
          </div>
        )}

        {/* ================================================================
            1. DOVE DEVO ANDARE (POSIZIONE IN PRIMO PIANO)
           ================================================================ */}
        <div className="bg-slate-900 border-2 border-sky-500/50 rounded-3xl p-3.5 shrink-0 shadow-[0_0_25px_rgba(14,165,233,0.12)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-black uppercase tracking-widest text-sky-400 flex items-center gap-1.5">
              <MapPin size={15} /> 1. DOVE ANDARE (POSIZIONE)
            </span>
            {isSameLocationAsPrev && (
              <span className="bg-amber-500 text-amber-950 text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full">
                ⚡ Stessa Posizione
              </span>
            )}
          </div>

          {isMappedShelf ? (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-slate-950 border border-slate-800 rounded-2xl py-2 px-1">
                <p className="text-[10px] font-extrabold uppercase text-slate-400">Zona</p>
                <p className="text-2xl font-black text-brand-white tracking-tight truncate">
                  {currentItem.zone}
                </p>
              </div>
              <div className="bg-slate-950 border border-sky-500/40 rounded-2xl py-2 px-1">
                <p className="text-[10px] font-extrabold uppercase text-sky-400">Scaffale / Col</p>
                <p className="text-3xl font-black text-sky-400 tracking-tight">
                  {currentItem.col}
                </p>
              </div>
              <div className="bg-slate-950 border border-emerald-500/40 rounded-2xl py-2 px-1">
                <p className="text-[10px] font-extrabold uppercase text-emerald-400">Pos / Piano</p>
                <p className="text-3xl font-black text-emerald-400 tracking-tight">
                  {currentItem.pos}
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-slate-950 border border-sky-500/30 rounded-2xl p-3 text-center">
              <p className="text-[10px] font-extrabold uppercase text-sky-400 mb-0.5">Area / Posizione Libera</p>
              <p className="text-2xl font-black text-brand-white uppercase">
                {currentItem?.location || 'Cerca in magazzino'}
              </p>
            </div>
          )}
        </div>

        {/* ================================================================
            2. COSA PRENDERE E QUANTO PRENDERE (SCATOLE IN PRIMO PIANO!)
           ================================================================ */}
        <div className="bg-slate-900 border-2 border-slate-800 rounded-3xl p-3.5 shrink-0 flex flex-col gap-3">
          {/* Articolo + Lotto + Paletta */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                2. COSA PRENDERE
              </span>
              {currentItem?.article_code && (
                <span className="text-xs font-mono font-bold text-slate-300 bg-slate-800 px-2 py-0.5 rounded-lg">
                  Cod: {currentItem.article_code}
                </span>
              )}
            </div>

            <h3 className="text-xl font-black text-brand-white leading-snug">
              {currentItem?.product_name}
            </h3>

            {/* Lotto e Paletta ben visibili */}
            <div className="grid grid-cols-2 gap-2 mt-2.5">
              <div className="bg-amber-500/10 border border-amber-500/40 rounded-2xl p-2.5">
                <p className="text-[10px] font-extrabold uppercase text-amber-400/80">Lotto Richiesto</p>
                <p className="text-base font-mono font-black text-amber-300 truncate">
                  {currentItem?.batch || 'Qualsiasi / N.D.'}
                </p>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-2.5">
                <p className="text-[10px] font-extrabold uppercase text-slate-400">Paletta Attesa</p>
                {isNoBarPallet ? (
                  <p className="text-xs font-black text-sky-400 uppercase mt-0.5">Senza Barcode</p>
                ) : (
                  <p className="font-mono font-bold text-xs text-slate-400 truncate">
                    {palletPrefix}
                    <span className="text-lg font-black text-brand-blue bg-brand-blue/15 px-1.5 py-0.5 rounded ml-0.5">
                      {palletHighlight}
                    </span>
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* HERO BOX: QUANTO PRELEVARE (SCATOLE IN EVIDENZA ASSOLUTA) */}
          <div className="bg-emerald-500/15 border-2 border-emerald-500/70 rounded-2xl p-3.5 text-center shadow-[0_0_25px_rgba(16,185,129,0.12)]">
            <div className="flex items-center justify-center gap-2 mb-1">
              <span className="text-[11px] font-black uppercase tracking-widest text-emerald-300">
                3. QUANTITÀ DA PRELEVARE
              </span>
              {qtyInfo.badgeText && (
                <span className="bg-emerald-500/25 border border-emerald-400/40 text-emerald-200 text-[10px] font-mono font-black px-2 py-0.5 rounded-full">
                  {qtyInfo.badgeText}
                </span>
              )}
            </div>

            {/* Testo Gigante: ES. "3 SCATOLE" */}
            <p className="text-4xl font-black text-emerald-400 tracking-tight leading-none my-1">
              {qtyInfo.primaryText}
            </p>

            {/* Sottotitolo chiaro: ES. "Equivalgono a 30 Pezzi" */}
            {qtyInfo.secondaryText && (
              <p className="text-base font-extrabold text-brand-white mt-1">
                {qtyInfo.secondaryText}
              </p>
            )}
          </div>
        </div>

        {/* ================================================================
            4. AREA AZIONE: SCAN PALETTA / SELEZIONE MISTA / CONFERMA Q.TÀ
           ================================================================ */}
        <div className="mt-auto shrink-0">
          {(step === 'SCAN_PIN' || step === 'SCAN_PALLET') && (
            <div className="bg-slate-900 border-2 border-brand-blue rounded-3xl p-3.5 shadow-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <ScanBarcode size={22} className="text-brand-blue animate-pulse shrink-0" />
                  <span className="text-sm font-black text-brand-white uppercase">
                    {step === 'SCAN_PIN'
                      ? `Scansiona PIN (${currentItem?.loc_pin})`
                      : `Spara Paletta ...${palletHighlight || rawPalletCode}`}
                  </span>
                </div>

                {/* Pulsante per aprire la tastiera SOLO se l'operatore lo desidera */}
                <button
                  type="button"
                  onClick={toggleVirtualKeyboard}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                    keyboardOpen
                      ? 'bg-brand-blue text-brand-black shadow-[0_0_12px_rgba(14,165,233,0.4)]'
                      : 'bg-slate-800 text-slate-300 border border-slate-700'
                  }`}
                >
                  <Keyboard size={15} />
                  {keyboardOpen ? 'Chiudi Tastiera' : 'Digita'}
                </button>
              </div>

              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  inputMode={keyboardOpen ? 'text' : 'none'}
                  placeholder={keyboardOpen ? 'Scrivi codice PAL-...' : 'Laser pronto (Tastiera chiusa)...'}
                  className="w-full bg-slate-950 border-2 border-slate-700 p-3 rounded-2xl text-base font-mono font-bold uppercase focus:border-brand-blue focus:outline-none text-brand-white"
                  value={manualScanInput}
                  onBlur={() => setKeyboardOpen(false)}
                  onChange={(e) => {
                    const val = e.target.value.toUpperCase();
                    setManualScanInput(val);
                    if (scanDebounceRef.current) clearTimeout(scanDebounceRef.current);

                    const trimmed = val.trim();
                    const expectedCode = String(
                      step === 'SCAN_PIN' ? currentItem?.loc_pin || '' : currentItem?.pallet_code || ''
                    ).toUpperCase();

                    // Se il codice corrisponde esattamente a quello atteso, avvia subito senza attendere Enter
                    if (expectedCode && trimmed === expectedCode) {
                      setManualScanInput('');
                      handleScan(trimmed);
                      return;
                    }

                    // Se la tastiera è chiusa (lettura da laser Zebra senza Enter finale), invia dopo 250ms
                    if (!keyboardOpen && trimmed.length >= 6) {
                      scanDebounceRef.current = setTimeout(() => {
                        setManualScanInput('');
                        handleScan(trimmed);
                      }, 250);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && manualScanInput.trim() !== '') {
                      if (scanDebounceRef.current) clearTimeout(scanDebounceRef.current);
                      const toScan = manualScanInput.trim();
                      setManualScanInput('');
                      handleScan(toScan);
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (manualScanInput.trim() !== '') {
                      if (scanDebounceRef.current) clearTimeout(scanDebounceRef.current);
                      const toScan = manualScanInput.trim();
                      setManualScanInput('');
                      handleScan(toScan);
                    }
                  }}
                  className="bg-brand-blue hover:bg-sky-400 text-brand-black font-black px-5 rounded-2xl transition-colors shrink-0 active:scale-95"
                >
                  <ArrowRight size={22} />
                </button>
              </div>
            </div>
          )}

          {step === 'SELECT_MIXED_ITEM' && (
            <div className="bg-slate-900 p-4 rounded-3xl border-2 border-amber-500/60 flex flex-col gap-3">
              <p className="text-amber-400 font-black text-lg text-center">
                ⚠️ Paletta Mista — Conferma Articolo e Lotto
              </p>
              <p className="text-slate-300 text-center text-xs">
                Tocca l'articolo e lotto che stai prelevando fisicamente da questa paletta:
              </p>
              <div className="flex flex-col gap-2.5 max-h-[240px] overflow-y-auto">
                {mixedPalletItems.map((mItem) => {
                  const batchMatches = !currentItem.batch || (mItem.batch || '') === (currentItem.batch || '');
                  const isTarget = mItem.product_id === currentItem.product_id && batchMatches;
                  const mUpb = parseInt(mItem.units_per_box, 10) || 1;
                  const mQty = parseFloat(mItem.quantity) || 0;
                  const mBoxes = mUpb > 1 ? Math.floor(mQty / mUpb) : 0;

                  return (
                    <button
                      key={`${mItem.id}-${mItem.batch}`}
                      onClick={() => {
                        if (isTarget) {
                          prepareQtyInputs(currentItem);
                          setStep('INPUT_QTY');
                          setError(null);
                        } else {
                          setError(
                            `Articolo/Lotto errato! Richiesto: ${currentItem.product_name}${
                              currentItem.batch ? ` (Lotto: ${currentItem.batch})` : ''
                            }`
                          );
                        }
                      }}
                      className="bg-slate-950 border-2 border-slate-700 active:border-brand-blue p-3.5 rounded-2xl text-left transition-all"
                    >
                      <p className="font-black text-brand-white text-base">{mItem.product_name}</p>
                      <div className="flex items-center justify-between text-xs text-slate-400 mt-1 font-mono">
                        <span>Lotto: {mItem.batch || 'N/D'}</span>
                        <span>
                          Disp: {mBoxes > 0 ? `${mBoxes} scat. (${mQty} pz)` : `${mQty} ${mItem.uom || 'pz'}`}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 'INPUT_QTY' && (
            <div className="bg-slate-900 p-4 rounded-3xl border-2 border-emerald-500/50 flex flex-col gap-3 shadow-lg">
              {qtyInfo.hasBoxConversion && qtyInfo.isExactBoxes ? (
                /* Modalità con Scatole in Primo Piano + Equivalente in Pezzi */
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-950 border-2 border-emerald-500/60 rounded-2xl p-2.5 flex flex-col items-center">
                    <span className="text-[10px] font-black uppercase text-emerald-400 mb-1">
                      Scatole da Prendere
                    </span>
                    <div className="flex items-center gap-1.5 w-full justify-between">
                      <button
                        type="button"
                        onClick={() => {
                          const cur = parseFloat(boxesInput) || 0;
                          if (cur > 0) handleBoxesChange((cur - 1).toString(), qtyInfo.upb);
                        }}
                        className="w-10 h-12 rounded-xl bg-slate-800 active:bg-slate-700 text-brand-white flex items-center justify-center font-black"
                      >
                        <Minus size={18} />
                      </button>
                      <input
                        type="number"
                        onWheel={(e) => e.target.blur()}
                        value={boxesInput}
                        onChange={(e) => handleBoxesChange(e.target.value, qtyInfo.upb)}
                        className="w-16 h-12 bg-transparent text-center text-3xl font-black text-emerald-400 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const cur = parseFloat(boxesInput) || 0;
                          handleBoxesChange((cur + 1).toString(), qtyInfo.upb);
                        }}
                        className="w-10 h-12 rounded-xl bg-slate-800 active:bg-slate-700 text-brand-white flex items-center justify-center font-black"
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                    <span className="text-[10px] text-slate-400 font-bold mt-0.5">
                      Colli ({qtyInfo.upb} pz/scat.)
                    </span>
                  </div>

                  <div className="bg-slate-950 border border-slate-800 rounded-2xl p-2.5 flex flex-col items-center justify-center">
                    <span className="text-[10px] font-bold uppercase text-slate-400 mb-1">
                      Equivalente Pezzi
                    </span>
                    <input
                      type="number"
                      onWheel={(e) => e.target.blur()}
                      value={qtyInput}
                      onChange={(e) => handlePiecesChange(e.target.value, qtyInfo.upb, true)}
                      className="w-full h-12 bg-transparent text-center text-2xl font-black text-brand-white focus:outline-none"
                    />
                    <span className="text-[10px] text-slate-500 font-bold mt-0.5">
                      {currentItem?.uom || 'Pezzi'} totali
                    </span>
                  </div>
                </div>
              ) : (
                /* Modalità Quantità Diretta (senza autoFocus che apre la tastiera da sola) */
                <div className="flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      const cur = parseFloat(qtyInput) || 0;
                      if (cur > 1) setQtyInput((cur - 1).toString());
                    }}
                    className="w-14 h-14 rounded-2xl bg-slate-800 active:bg-slate-700 text-brand-white flex items-center justify-center font-black"
                  >
                    <Minus size={24} />
                  </button>
                  <div className="flex flex-col items-center">
                    <input
                      type="number"
                      onWheel={(e) => e.target.blur()}
                      className="bg-slate-950 border-2 border-brand-blue text-brand-white text-center text-3xl font-black w-28 h-14 rounded-2xl focus:outline-none"
                      value={qtyInput}
                      onChange={(e) => {
                        setQtyInput(e.target.value);
                        setError(null);
                      }}
                    />
                    <span className="text-[11px] text-slate-400 font-bold mt-1">
                      {qtyInfo.hasBoxConversion
                        ? `${qtyInfo.primaryText} (${qtyInfo.qty} ${currentItem?.uom})`
                        : currentItem?.uom || 'Pezzi'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const cur = parseFloat(qtyInput) || 0;
                      setQtyInput((cur + 1).toString());
                    }}
                    className="w-14 h-14 rounded-2xl bg-slate-800 active:bg-slate-700 text-brand-white flex items-center justify-center font-black"
                  >
                    <Plus size={24} />
                  </button>
                </div>
              )}

              <button
                onClick={handleConfirmQty}
                disabled={isProcessing || isConfirmLocked}
                className={`w-full font-black text-xl py-4 rounded-2xl transition-all flex items-center justify-center gap-2 shadow-lg ${
                  isConfirmLocked || isProcessing
                    ? 'bg-slate-800 text-slate-500'
                    : 'bg-emerald-500 active:bg-emerald-400 text-emerald-950 active:scale-95 shadow-emerald-900/30'
                }`}
              >
                <Check size={24} strokeWidth={3} />
                <span>
                  {isProcessing
                    ? 'Salvataggio...'
                    : isConfirmLocked
                    ? 'Verifica Quantità...'
                    : `CONFERMA ${qtyInfo.primaryText}`}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ====================================================================
          MODAL PERCORSO ORDINATO (Lista Tappe secondo Regole di Prelievo)
         ==================================================================== */}
      {showRouteModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col justify-end p-3">
          <div className="bg-slate-900 border-2 border-slate-700 rounded-3xl max-h-[82vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-brand-white flex items-center gap-2">
                  <ListOrdered size={20} className="text-brand-blue" />
                  Percorso di Prelievo Ordinato
                </h3>
                <p className="text-xs text-slate-400">
                  Ordinato secondo le Regole di Prelievo (Tocca una riga per selezionarla)
                </p>
              </div>
              <button
                onClick={() => setShowRouteModal(false)}
                className="p-2 bg-slate-800 rounded-xl text-slate-300"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {allOrderItems.map((it, idx) => {
                const isPicked = it.status === 'PICKED';
                const isCurrent = currentItem && it.id === currentItem.id && !isPicked;
                const itQtyInfo = getPickQuantityInfo(it);

                return (
                  <button
                    key={it.id}
                    disabled={isPicked}
                    onClick={() => {
                      const targetIndexInRemaining = items.findIndex((rem) => rem.id === it.id);
                      if (targetIndexInRemaining >= 0) {
                        setCurrentItemIndex(targetIndexInRemaining);
                        setError(null);
                        checkAndSkipPin(items[targetIndexInRemaining]);
                        setShowRouteModal(false);
                      }
                    }}
                    className={`w-full text-left p-3 rounded-2xl border-2 transition-all flex items-center justify-between gap-3 ${
                      isPicked
                        ? 'bg-emerald-950/20 border-emerald-500/30 opacity-60'
                        : isCurrent
                        ? 'bg-brand-blue/15 border-brand-blue'
                        : 'bg-slate-950 border-slate-800 active:border-slate-600'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-black px-2 py-0.5 rounded-md bg-slate-800 text-brand-blue font-mono">
                          #{idx + 1}
                        </span>
                        <span className="font-black text-sm text-sky-400 truncate">
                          {formatLocationLabel(it)}
                        </span>
                        {isPicked && (
                          <span className="text-[10px] font-black uppercase bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">
                            ✓ Fatto
                          </span>
                        )}
                        {isCurrent && (
                          <span className="text-[10px] font-black uppercase bg-brand-blue text-brand-black px-2 py-0.5 rounded-full">
                            In Corso
                          </span>
                        )}
                      </div>
                      <p className="text-brand-white font-bold text-sm truncate">{it.product_name}</p>
                      {it.batch && <p className="text-amber-400 text-xs font-mono">Lotto: {it.batch}</p>}
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-emerald-400 font-black text-sm">{itQtyInfo.primaryText}</p>
                      {itQtyInfo.hasBoxConversion && (
                        <p className="text-slate-400 text-[11px] font-bold">({itQtyInfo.qty} pz)</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OutboundZebra;
