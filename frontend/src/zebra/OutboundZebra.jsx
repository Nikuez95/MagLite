import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { useNavigate, useLocation } from 'react-router-dom';
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
  Plus,
  Users,
  FileText,
  ShieldAlert,
  Thermometer,
  Truck,
  Scale,
  ArrowRightLeft
} from 'lucide-react';
import useBarcodeScanner from '../hooks/useBarcodeScanner';
import ZebraErrorModal from './ZebraErrorModal';
import Handling from './Handling';
import { useZebraWorkspace } from '../utils/zebraWorkspace';

// Calcola la visualizzazione prioritaria per il Picking: prima SCATOLE (cosa prendere fisicamente), poi l'equivalente in PEZZI
export const getPickQuantityInfo = (item) => {
  if (!item) {
    return {
      qty: 0,
      uom: 'Pezzi',
      upb: 1,
      kgPerUnit: null,
      totalKg: null,
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
  const kgPerUnit = parseFloat(item.kg_per_unit) || 0;
  const uom = (item.uom || 'Pezzi').trim();
  const uomLower = uom.toLowerCase();
  const totalPiecesForKg = (uomLower === 'scatole' || uomLower === 'cartoni') && upb > 1 ? qty * upb : qty;
  const totalKg = item.requested_kg != null
    ? parseFloat(item.requested_kg)
    : (kgPerUnit > 0 ? Number((totalPiecesForKg * kgPerUnit).toFixed(3)) : null);
  const kgSuffix = totalKg ? ` · ${totalKg} kg${kgPerUnit > 0 ? ` (${kgPerUnit} kg/pz)` : ''}` : '';

  // Caso 1: Richiesto in Pezzi/Sfuso ma il prodotto ha confezionamento in Scatole (units_per_box > 1)
  if (upb > 1 && (uomLower === 'pezzi' || uomLower === 'sfuso' || uomLower === 'pz' || uomLower === 'pezzo')) {
    const boxes = Math.floor(qty / upb);
    const loosePieces = Math.round((qty - boxes * upb) * 100) / 100;

    if (boxes > 0 && loosePieces === 0) {
      return {
        qty,
        uom,
        upb,
        kgPerUnit: kgPerUnit || null,
        totalKg,
        primaryText: `${boxes} ${boxes === 1 ? 'SCATOLA' : 'SCATOLE'}`,
        secondaryText: `Equivalgono a ${qty} Pezzi${kgSuffix}`,
        badgeText: `1 scatola = ${upb} pz${totalKg ? ` • ${totalKg} kg` : ''}`,
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
        kgPerUnit: kgPerUnit || null,
        totalKg,
        primaryText: `${boxes} ${boxes === 1 ? 'SCATOLA' : 'SCATOLE'} + ${loosePieces} ${loosePieces === 1 ? 'SFUSO' : 'SFUSI'}`,
        secondaryText: `Equivalgono a ${qty} Pezzi totali${kgSuffix}`,
        badgeText: `${boxes}×${upb} pz + ${loosePieces} sfusi${totalKg ? ` • ${totalKg} kg` : ''}`,
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
      kgPerUnit: kgPerUnit || null,
      totalKg,
      primaryText: `${qty} ${qty === 1 ? 'PEZZO SFUSO' : 'PEZZI SFUSI'}`,
      secondaryText: `Meno di 1 scatola (1 scat. = ${upb} pz)${kgSuffix}`,
      badgeText: `Conf. ${upb} pz/scat.${totalKg ? ` • ${totalKg} kg` : ''}`,
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
      kgPerUnit: kgPerUnit || null,
      totalKg,
      primaryText: `${qty} ${qty === 1 ? 'SCATOLA' : 'SCATOLE'}`,
      secondaryText: `${totalPieces ? `Equivalgono a ${totalPieces} Pezzi` : 'Preleva i colli indicati'}${kgSuffix}`,
      badgeText: upb > 1 ? `1 scatola = ${upb} pz${totalKg ? ` • ${totalKg} kg` : ''}` : (totalKg ? `${totalKg} kg` : null),
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
      kgPerUnit: kgPerUnit || null,
      totalKg,
      primaryText: `${qty} ${qty === 1 ? 'BANCALE INTERO' : 'BANCALI'}`,
      secondaryText: `${palQty > 0 ? `Contenuto paletta: ${palQty} ${item.base_uom || 'Pezzi'}` : 'Preleva bancale intero'}${totalKg ? ` · ${totalKg} kg` : ''}`,
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
    kgPerUnit: kgPerUnit || null,
    totalKg,
    primaryText: `${qty} ${qty === 1 && uomLower === 'pezzi' ? 'PEZZO' : uom.toUpperCase()}`,
    secondaryText: totalKg ? `Equivalgono a ${totalKg} kg (${kgPerUnit} kg/pz)` : 'Unità singole da prelevare',
    badgeText: totalKg ? `${totalKg} kg (${kgPerUnit} kg/pz)` : null,
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
  let zone = item.zone && item.zone !== 'null' ? item.zone : '';
  let col = item.col && item.col !== 'null' ? item.col : '';
  let pos = item.pos && item.pos !== 'null' ? item.pos : '';
  if (!zone && item.location) {
    const parts = item.location.split('-').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 3) {
      zone = parts[0];
      col = parts[1];
      pos = parts.slice(2).join('-');
    } else if (parts.length === 2) {
      col = parts[0];
      pos = parts[1];
    }
  }
  if (zone || col) {
    return [zone, col, pos].filter(Boolean).join(' · ');
  }
  return item.location || 'Senza Posizione';
};

const OutboundZebra = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const workspace = useZebraWorkspace();
  const token = localStorage.getItem('maglite_token');
  const [quickHandlingOpen, setQuickHandlingOpen] = useState(false);

  const [order, setOrder] = useState(null);
  const [allOrderItems, setAllOrderItems] = useState([]);
  const [items, setItems] = useState([]);
  const [currentItemIndex, setCurrentItemIndex] = useState(0);
  // Steps: SCAN_ORDER, SCAN_PIN, SCAN_PALLET, SELECT_MIXED_ITEM, INPUT_QTY, PICK_CONFIRMED, READY_DISPATCH, DISPATCH_CONFIRMED, FINISHED
  const [step, setStep] = useState('SCAN_ORDER');

  const [pendingOrders, setPendingOrders] = useState([]);
  const [readyOrders, setReadyOrders] = useState([]);
  const [orderListTab, setOrderListTab] = useState(location.state?.defaultTab === 'READY' ? 'READY' : 'PICKING');

  // Verifica & Carico Bolla (READY_DISPATCH)
  const [recheckMode, setRecheckMode] = useState(false);
  const [recheckedItemIds, setRecheckedItemIds] = useState([]);
  const [dispatchPlate, setDispatchPlate] = useState('');
  const [dispatchConfirmedInfo, setDispatchConfirmedInfo] = useState(null);
  const [lastBollaGenerated, setLastBollaGenerated] = useState(null);
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
  const [joinConfirmData, setJoinConfirmData] = useState(null);

  const inputRef = useRef(null);
  const autoAdvanceTimerRef = useRef(null);
  const scanDebounceRef = useRef(null);

  const currentItem = items[currentItemIndex];

  const fetchPendingOrders = useCallback(() => {
    Promise.all([
      axios
        .get(`http://${window.location.hostname}:3000/api/outbound?active_only=true`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        .catch(() => ({ data: [] })),
      axios
        .get(`http://${window.location.hostname}:3000/api/outbound?ready_only=true`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        .catch(() => ({ data: [] }))
    ]).then(([actRes, readyRes]) => {
      const active = (actRes.data || []).filter(
        (o) => o.status === 'PENDING' || o.status === 'PICKING' || o.status === 'RETURNED'
      );
      setPendingOrders(active);
      setReadyOrders(readyRes.data || []);
    });
  }, [token]);

  // Carica lista ordini attivi (PENDING / PICKING) per avvio rapido con 1 tap + aggiornamento real-time
  useEffect(() => {
    if (step !== 'SCAN_ORDER') return;
    fetchPendingOrders();
    const socket = io(`http://${window.location.hostname}:3000`);
    socket.on('outbound_updated', fetchPendingOrders);
    return () => {
      socket.off('outbound_updated', fetchPendingOrders);
      socket.disconnect();
    };
  }, [step, fetchPendingOrders]);

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
    const expectedCode = String(targetItem.pallet_code || '').trim();
    const isExactPallet = cleanCode.toLowerCase() === expectedCode.toLowerCase();

    // Blocca subito alla scansione se il barcode non corrisponde esattamente alla paletta attesa (anche a parità di prodotto e lotto)
    if (!isExactPallet) {
      try {
        navigator.vibrate?.([100, 60, 100]);
      } catch (e) {}
      setError(`Paletta errata (${cleanCode}). Attesa: ${expectedCode}`);
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/pallets/${cleanCode}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const palData = res.data;

      if (palData.is_quarantined) {
        try {
          navigator.vibrate?.([100, 60, 100]);
        } catch (e) {}
        setError(`BLOCCO QUARANTENA: La paletta ${palData.pallet_code} è in quarantena (${palData.quarantine_reason || 'Bloccata'}) e non può essere prelevata!`);
        return;
      }

      if (palData.status === 'SHIPPED') {
        try {
          navigator.vibrate?.([100, 60, 100]);
        } catch (e) {}
        setError(`Paletta errata (${cleanCode}): risulta già spedita.`);
        return;
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
    if (!barcode || isProcessing || step === 'FINISHED' || joinConfirmData || quickHandlingOpen) return;

    // Se siamo sulla schermata di conferma post-prelievo e l'operatore spara già la paletta del prelievo successivo
    if (step === 'PICK_CONFIRMED') {
      const nextItem = items[currentItemIndex];
      if (nextItem && !isItemNoScan(nextItem) && barcode.toUpperCase().startsWith('PAL-')) {
        advanceFromConfirmed(items, currentItemIndex, barcode);
      }
      return;
    }

    if (step === 'INPUT_QTY' || step === 'SELECT_MIXED_ITEM' || step === 'DISPATCH_CONFIRMED') return;

    if (step === 'READY_DISPATCH') {
      if (!recheckMode) return;
      const cleanScan = barcode.toUpperCase();
      const matchingItems = allOrderItems.filter((it) => {
        const pCode = String(it.pallet_code || '').trim().toUpperCase();
        const cCode = String(it.client_pallet_number || '').trim().toUpperCase();
        return pCode === cleanScan || (cCode && cCode === cleanScan);
      });
      if (matchingItems.length === 0) {
        setError(`Paletta "${barcode}" NON appartiene a questa bolla di uscita (${order?.bolla_number || order?.order_code})!`);
        return;
      }
      const nextUnchecked = matchingItems.find((it) => !recheckedItemIds.includes(it.id)) || matchingItems[0];
      setRecheckedItemIds((prev) => (prev.includes(nextUnchecked.id) ? prev : [...prev, nextUnchecked.id]));
      setError(null);
      try { navigator.vibrate?.(120); } catch (_) {}
      return;
    }

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

  const applyOrderData = useCallback(
    (data) => {
      setOrder(data.order);
      setAllOrderItems(data.items || []);
      const remaining = (data.items || []).filter((i) => i.status !== 'PICKED');
      setItems(remaining);
      setPreviousLocationKey(null);
      setLastPickedSummary(null);
      setLastBollaGenerated(data.order?.bolla_number || null);

      if (data.order?.status === 'READY' || remaining.length === 0) {
        setRecheckMode(false);
        setRecheckedItemIds([]);
        setDispatchPlate(data.order?.bolla_options_parsed?.vehicle_plate || '');
        setDispatchConfirmedInfo(null);
        setStep('READY_DISPATCH');
      } else {
        setCurrentItemIndex(0);
        checkAndSkipPin(remaining[0]);
      }
    },
    [checkAndSkipPin]
  );

  // Avvio automatico se arriviamo dalla Home Zebra con scansione OUT- / BOL- o tab specifica
  useEffect(() => {
    if (location.state?.initialCode) {
      const initCode = String(location.state.initialCode).trim().toUpperCase();
      setScannedOrder(initCode);
      fetchOrder(initCode);
      navigate('/zebra/outbound', { replace: true, state: {} });
    }
  }, [location.state]);

  const fetchOrder = async (code, forceJoin = false) => {
    const cleanCode = String(code || '').trim().toUpperCase();
    if (!cleanCode) return;
    setIsProcessing(true);
    setError(null);
    try {
      const whQ = workspace?.warehouseId ? `?warehouse_id=${workspace.warehouseId}` : '';
      const res = await axios.get(`http://${window.location.hostname}:3000/api/outbound/zebra/${cleanCode}${whQ}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!forceJoin && res.data?.already_in_progress) {
        setJoinConfirmData({
          order: res.data.order,
          items: res.data.items || []
        });
        return;
      }

      setJoinConfirmData(null);
      applyOrderData(res.data);
    } catch (err) {
      setJoinConfirmData(null);
      setError(err.response?.data?.error || 'Ordine non trovato');
      setScannedOrder('');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmJoin = async () => {
    if (!joinConfirmData?.order?.order_code || isProcessing) return;
    const targetCode = joinConfirmData.order.order_code;
    setJoinConfirmData(null);
    await fetchOrder(targetCode, true);
  };

  const handleCancelJoin = () => {
    setJoinConfirmData(null);
    setScannedOrder('');
    setError(null);
    fetchPendingOrders();
    setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true });
    }, 50);
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
        if (res.data.bolla_number) {
          setLastBollaGenerated(res.data.bolla_number);
          setOrder((prev) => (prev ? { ...prev, bolla_number: res.data.bolla_number, status: 'READY' } : prev));
        }
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
      const errMsg = err.response?.data?.error || 'Errore di salvataggio';
      if (err.response?.status === 409 && order?.order_code) {
        await fetchOrder(order.order_code, true);
        setError(errMsg);
        return;
      }
      setError(errMsg);
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
  const confirmDispatchShipment = async () => {
    if (!order?.order_code || isProcessing) return;
    setIsProcessing(true);
    setError(null);
    try {
      const res = await axios.post(
        `http://${window.location.hostname}:3000/api/outbound/${order.order_code}/confirm`,
        {
          source: 'ZEBRA',
          recheck_completed: recheckMode || recheckedItemIds.length > 0,
          rechecked_items: recheckedItemIds.length,
          vehicle_plate: dispatchPlate.trim()
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      try { navigator.vibrate?.([120, 60, 180]); } catch (_) {}
      setDispatchConfirmedInfo({
        order_code: res.data?.order_code || order.order_code,
        bolla_number: res.data?.bolla_number || order.bolla_number || lastBollaGenerated,
        customer_name: order.customer_name,
        rechecked: recheckedItemIds.length
      });
      setStep('DISPATCH_CONFIRMED');
    } catch (err) {
      setError(err.response?.data?.error || 'Errore nella conferma spedizione');
    } finally {
      setIsProcessing(false);
    }
  };

  // ============================================================================
  // STEP 1: SCANSIONE ORDINE / BOLLA
  // ============================================================================
  if (step === 'SCAN_ORDER') {
    const displayedOrders = orderListTab === 'READY' ? readyOrders : pendingOrders;
    return (
      <div className="flex-1 p-4 flex flex-col max-w-md mx-auto w-full">
        <ZebraErrorModal message={error} onClose={() => setError(null)} />

        {joinConfirmData && (
          <div
            className="fixed inset-0 z-[95] flex items-center justify-center p-5 bg-brand-black/85 backdrop-blur-sm animate-fade-in-up"
            role="alertdialog"
            aria-modal="true"
          >
            <div className="w-full max-w-sm bg-slate-900 border-2 border-amber-500 rounded-3xl p-6 shadow-[0_0_40px_rgba(245,158,11,0.35)] text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 mx-auto">
                <Users size={36} />
              </div>

              <div>
                <h3 className="text-xl font-black text-brand-white uppercase tracking-tight">
                  Ordine Già in Corso
                </h3>
                <p className="font-mono font-black text-brand-blue text-sm mt-1">
                  {joinConfirmData.order?.order_code}
                  {joinConfirmData.order?.customer_name ? ` · ${joinConfirmData.order.customer_name}` : ''}
                </p>
                <p className="text-sm font-bold text-amber-200 mt-3 leading-relaxed break-words">
                  {joinConfirmData.order?.picking_operator ? (
                    <>
                      L&apos;operatore{' '}
                      <span className="text-amber-400 font-black">
                        {joinConfirmData.order.picking_operator}
                      </span>{' '}
                      sta già facendo questo picking.
                    </>
                  ) : (
                    'Un altro operatore sta già facendo questo picking.'
                  )}
                </p>
                <p className="text-sm font-semibold text-slate-300 mt-1.5">
                  Vuoi unirti comunque?
                </p>
              </div>

              <div className="flex flex-col gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={handleConfirmJoin}
                  disabled={isProcessing}
                  className="w-full py-4 rounded-2xl bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 font-black text-base flex items-center justify-center gap-2 transition-all shadow-lg disabled:opacity-50"
                >
                  <Check size={20} strokeWidth={3} />
                  <span>{isProcessing ? 'ACCESSO...' : 'SÌ, UNISCITI COMUNQUE'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleCancelJoin}
                  disabled={isProcessing}
                  className="w-full py-3.5 rounded-2xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 border border-slate-700 font-bold text-base flex items-center justify-center gap-2 transition-all"
                >
                  <ChevronLeft size={20} />
                  <span>NO, TORNA INDIETRO</span>
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => navigate('/zebra')}
            className="p-3 bg-slate-800 active:bg-slate-700 rounded-2xl text-brand-white shrink-0"
          >
            <ChevronLeft size={24} />
          </button>
          <div>
            <h2 className="text-2xl font-black text-brand-white leading-tight">
              {orderListTab === 'READY' ? 'Carico & Bolle Pronte' : 'Picking & Carico'}
            </h2>
            <p className="text-slate-400 text-xs font-semibold">Scansiona Ordine (OUT) o Bolla (BOL)</p>
          </div>
        </div>

        {error && (
          <div className="bg-rose-500/15 border-2 border-rose-500/60 p-3.5 rounded-2xl text-rose-300 text-center font-bold mb-4 flex items-center justify-center gap-2">
            <AlertTriangle size={20} className="shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Box Scansione Laser DDT / Bolla senza apertura automatica tastiera */}
        <div className="bg-slate-900 border-2 border-brand-blue/40 rounded-3xl p-4 mb-4 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-black uppercase tracking-wider text-brand-blue flex items-center gap-1.5">
              <ScanBarcode size={16} /> Laser attivo — Spara Ordine o Bolla
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
              disabled={isProcessing || Boolean(joinConfirmData)}
              placeholder={keyboardOpen ? 'Digita OUT-... o BOL-...' : 'In attesa di scansione laser...'}
              className="bg-slate-950 border-2 border-slate-700 p-3.5 rounded-2xl text-lg font-mono font-bold w-full uppercase focus:border-brand-blue focus:outline-none text-brand-white"
              value={scannedOrder}
              onBlur={() => setKeyboardOpen(false)}
              onChange={(e) => {
                if (joinConfirmData) return;
                const val = e.target.value.toUpperCase();
                setScannedOrder(val);
                if (val.length >= 15 && (val.startsWith('OUT-') || val.startsWith('BOL-'))) fetchOrder(val);
              }}
              onKeyDown={(e) => e.key === 'Enter' && scannedOrder && !joinConfirmData && fetchOrder(scannedOrder)}
            />
            <button
              onClick={() => fetchOrder(scannedOrder)}
              disabled={!scannedOrder || isProcessing || Boolean(joinConfirmData)}
              className="bg-brand-blue text-brand-black px-5 rounded-2xl font-black text-lg disabled:opacity-40 shrink-0 active:scale-95 transition-transform"
            >
              {isProcessing ? '...' : <ArrowRight size={24} />}
            </button>
          </div>
        </div>

        {/* Switcher Tab: Da Prelevare vs Bolle Pronte Carico */}
        <div className="grid grid-cols-2 gap-2 p-1.5 bg-slate-900 border border-slate-800 rounded-2xl mb-3">
          <button
            type="button"
            onClick={() => setOrderListTab('PICKING')}
            className={`py-2.5 px-3 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 ${
              orderListTab === 'PICKING'
                ? 'bg-emerald-500 text-emerald-950 shadow'
                : 'text-slate-400 active:text-white'
            }`}
          >
            <PackageMinus size={14} /> Da Prelevare ({pendingOrders.length})
          </button>
          <button
            type="button"
            onClick={() => setOrderListTab('READY')}
            className={`py-2.5 px-3 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 ${
              orderListTab === 'READY'
                ? 'bg-sky-400 text-brand-black shadow'
                : 'text-slate-400 active:text-white'
            }`}
          >
            <FileText size={14} /> Bolle Pronte ({readyOrders.length})
          </button>
        </div>

        {/* Lista Ordini */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto space-y-2.5 pr-0.5">
            {displayedOrders.length === 0 ? (
              <div className="bg-slate-900/50 border border-slate-800 border-dashed rounded-2xl p-6 text-center text-slate-500 text-sm font-semibold">
                {orderListTab === 'READY'
                  ? 'Nessuna bolla pronta in attesa di carico. Scansiona BOL-... per verificare o spedire.'
                  : 'Nessun ordine in attesa. Scansiona un codice DDT per iniziare.'}
              </div>
            ) : (
              displayedOrders.map((ord) => (
                <button
                  key={ord.id}
                  onClick={() => {
                    const target = ord.bolla_number || ord.order_code;
                    setScannedOrder(target);
                    fetchOrder(ord.order_code);
                  }}
                  disabled={isProcessing || Boolean(joinConfirmData)}
                  className={`w-full text-left bg-slate-900 hover:bg-slate-800/90 active:scale-[0.99] border-2 p-4 rounded-2xl transition-all flex items-center justify-between gap-3 ${
                    ord.status === 'READY'
                      ? 'border-sky-500/40 hover:border-sky-400'
                      : 'border-slate-800 hover:border-brand-blue/60'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-mono font-black text-brand-blue text-base">
                        {ord.status === 'READY' && ord.bolla_number ? ord.bolla_number : ord.order_code}
                      </span>
                      {ord.status === 'READY' ? (
                        <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          Pronta al Carico
                        </span>
                      ) : (
                        <span
                          className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                            ord.status === 'PICKING'
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                              : 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                          }`}
                        >
                          {ord.status === 'PICKING'
                            ? `In Corso${ord.picking_operator ? ` · ${ord.picking_operator}` : ''}`
                            : 'Da Iniziare'}
                        </span>
                      )}
                    </div>
                    <p className="text-brand-white font-bold text-base truncate">{ord.customer_name}</p>
                    {ord.status === 'READY' && ord.delivery_address_text && (
                      <p className="text-sky-300 text-xs truncate mt-0.5 flex items-center gap-1">
                        <MapPin size={11} className="shrink-0" /> {ord.delivery_address_text}
                      </p>
                    )}
                    {ord.products && (
                      <p className="text-slate-400 text-xs truncate mt-0.5">{ord.products}</p>
                    )}
                  </div>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    ord.status === 'READY' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-brand-blue/15 text-brand-blue'
                  }`}>
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
  // STEP VERIFICA & CARICO BOLLA (ORDINE PRONTO -> SEGNA SPEDITO O RICONTROLLA)
  // ============================================================================
  if (step === 'READY_DISPATCH') {
    const bollaOpts = order?.bolla_options_parsed || {};
    const totalPallets = new Set(allOrderItems.map(i => i.pallet_code).filter(Boolean)).size || allOrderItems.length;
    const totalNet = allOrderItems.reduce((acc, it) => acc + (parseFloat(it.net_weight_kg) || 0), 0);
    const totalGross = allOrderItems.reduce((acc, it) => acc + (parseFloat(it.gross_weight_kg) || 0), 0);
    const recheckedCount = recheckedItemIds.length;
    const allRechecked = allOrderItems.length > 0 && recheckedCount >= allOrderItems.length;

    return (
      <div className="flex-1 p-4 flex flex-col max-w-md mx-auto w-full">
        <ZebraErrorModal message={error} onClose={() => setError(null)} />

        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <button
            onClick={() => {
              setOrder(null);
              setScannedOrder('');
              setRecheckMode(false);
              setStep('SCAN_ORDER');
            }}
            className="p-2.5 bg-slate-800 active:bg-slate-700 rounded-2xl text-brand-white shrink-0"
          >
            <ChevronLeft size={22} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono font-black text-sky-400 text-base">
                {order?.bolla_number || lastBollaGenerated || order?.order_code}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-black uppercase">
                Pronta per Carico
              </span>
            </div>
            <p className="text-xs text-slate-400 font-bold truncate">
              Ordine: {order?.order_code} • {order?.customer_name}
            </p>
          </div>
        </div>

        {/* Allerte ADR / Temperatura se attive */}
        {(bollaOpts.is_adr || bollaOpts.temp_6_8 || bollaOpts.temp_15_25) && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {bollaOpts.is_adr && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-rose-500/20 border border-rose-500/50 text-rose-300 text-xs font-black">
                <ShieldAlert size={13} /> ADR {bollaOpts.adr_note ? `(${bollaOpts.adr_note})` : ''}
              </span>
            )}
            {bollaOpts.temp_6_8 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-cyan-500/20 border border-cyan-500/50 text-cyan-300 text-xs font-black">
                <Thermometer size={13} /> TEMP. +6/+8°C
              </span>
            )}
            {bollaOpts.temp_15_25 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-amber-500/20 border border-amber-500/50 text-amber-300 text-xs font-black">
                <Thermometer size={13} /> TEMP. +15/+25°C
              </span>
            )}
          </div>
        )}

        {/* Destinazione + Pesi / Bancali */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 mb-3 space-y-2">
          <div className="flex items-start gap-2 text-xs">
            <MapPin size={15} className="text-sky-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase text-slate-500">
                Consegna: {order?.delivery_label || 'Destinatario'}
              </div>
              <div className="text-white font-semibold leading-snug">
                {order?.delivery_address_text || order?.customer_address || 'Sede cliente'}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800 text-center">
            <div className="bg-slate-950 rounded-xl p-2">
              <div className="text-[10px] font-bold text-slate-500">BANCALI</div>
              <div className="text-base font-black text-white">{totalPallets}</div>
            </div>
            <div className="bg-slate-950 rounded-xl p-2">
              <div className="text-[10px] font-bold text-slate-500">KG NETTI</div>
              <div className="text-sm font-black text-emerald-400">{totalNet > 0 ? totalNet.toFixed(1) : 'N.D.'}</div>
            </div>
            <div className="bg-slate-950 rounded-xl p-2">
              <div className="text-[10px] font-bold text-slate-500">KG LORDI</div>
              <div className="text-sm font-black text-sky-400">{totalGross > 0 ? totalGross.toFixed(1) : 'N.D.'}</div>
            </div>
          </div>
        </div>

        {/* Toggle Modalità Ricontrollo Merce prima del carico */}
        <button
          type="button"
          onClick={() => setRecheckMode((v) => !v)}
          className={`w-full mb-3 p-3.5 rounded-2xl border-2 font-black text-sm flex items-center justify-between transition-all ${
            recheckMode
              ? 'bg-sky-500/15 border-sky-400 text-sky-300'
              : 'bg-slate-900 border-slate-700 text-slate-200 active:border-brand-blue'
          }`}
        >
          <span className="flex items-center gap-2">
            <ScanBarcode size={18} />
            {recheckMode ? 'Ricontrollo Attivo — Spara Palette' : 'Ricontrolla Merce Prima di Caricare'}
          </span>
          <span className="px-2.5 py-0.5 rounded-full bg-slate-950 text-xs font-mono">
            {recheckMode ? `${recheckedCount}/${allOrderItems.length}` : 'Opzionale'}
          </span>
        </button>

        {/* Elenco Palette / Articoli della Bolla (clic o scan per verificare se recheckMode attivo) */}
        <div className="flex-1 overflow-y-auto space-y-2 mb-3 pr-0.5">
          {allOrderItems.map((it) => {
            const isVerified = recheckedItemIds.includes(it.id);
            const qInfo = getPickQuantityInfo(it);
            return (
              <div
                key={it.id}
                onClick={() => {
                  if (!recheckMode) return;
                  setRecheckedItemIds((prev) =>
                    prev.includes(it.id) ? prev.filter((id) => id !== it.id) : [...prev, it.id]
                  );
                }}
                className={`p-3 rounded-2xl border-2 transition-all flex items-center justify-between gap-2.5 ${
                  recheckMode ? 'cursor-pointer active:scale-[0.99]' : ''
                } ${
                  isVerified
                    ? 'bg-emerald-950/30 border-emerald-500'
                    : 'bg-slate-900 border-slate-800'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-black text-xs text-brand-blue">
                      {(it.pallet_code || '').startsWith('NOBAR-') ? 'Senza Bar.' : it.pallet_code}
                    </span>
                    {it.batch && (
                      <span className="text-[11px] font-mono text-amber-300">Lotto: {it.batch}</span>
                    )}
                  </div>
                  <p className="text-sm font-bold text-white truncate">{it.product_name}</p>
                  {(it.net_weight_kg || it.gross_weight_kg) && (
                    <p className="text-[10px] text-slate-400 font-mono">
                      Netto: {it.net_weight_kg ?? '-'} kg • Lordo: {it.gross_weight_kg ?? '-'} kg
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0 flex items-center gap-2">
                  <div>
                    <div className="text-xs font-black text-emerald-400">{qInfo.primaryText}</div>
                    {qInfo.hasBoxConversion && (
                      <div className="text-[10px] text-slate-400">({qInfo.qty} pz)</div>
                    )}
                  </div>
                  {recheckMode && (
                    <div className={`w-7 h-7 rounded-xl flex items-center justify-center border ${
                      isVerified
                        ? 'bg-emerald-500 border-emerald-400 text-emerald-950'
                        : 'bg-slate-950 border-slate-700 text-slate-600'
                    }`}>
                      <Check size={16} strokeWidth={3} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Targa Mezzo opzionale + Bottone Segna Spedito */}
        <div className="space-y-2.5 pt-1">
          <input
            type="text"
            value={dispatchPlate}
            onChange={(e) => setDispatchPlate(e.target.value.toUpperCase())}
            placeholder="Targa Camion (opzionale, es. AB123CD)"
            className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-3.5 py-2.5 text-sm font-mono uppercase focus:border-brand-blue outline-none"
          />
          <button
            type="button"
            disabled={isProcessing}
            onClick={confirmDispatchShipment}
            className="w-full bg-emerald-500 active:bg-emerald-400 text-emerald-950 p-4 rounded-2xl font-black text-lg flex items-center justify-center gap-2 shadow-[0_0_25px_rgba(16,185,129,0.3)] disabled:opacity-50"
          >
            <Truck size={22} />
            <span>
              {isProcessing
                ? 'Conferma in corso...'
                : recheckMode && !allRechecked
                ? `SEGNA SPEDITO (${recheckedCount}/${allOrderItems.length} verificati)`
                : 'SEGNA COME SPEDITO'}
            </span>
          </button>
        </div>
      </div>
    );
  }

  // ============================================================================
  // STEP SPEDIZIONE CONFERMATA (DA ZEBRA)
  // ============================================================================
  if (step === 'DISPATCH_CONFIRMED') {
    return (
      <div className="flex-1 p-6 flex flex-col items-center justify-center text-center max-w-md mx-auto w-full">
        <div className="w-24 h-24 rounded-full bg-sky-500/20 border-2 border-sky-400 flex items-center justify-center mb-5 shadow-[0_0_40px_rgba(56,189,248,0.3)]">
          <Truck size={50} className="text-sky-400" />
        </div>
        <h2 className="text-3xl font-black text-white mb-2">Merce Spedita!</h2>
        <p className="text-sky-400 font-mono font-bold text-lg">
          {dispatchConfirmedInfo?.bolla_number || dispatchConfirmedInfo?.order_code}
        </p>
        <p className="text-slate-300 text-sm font-semibold mt-1">
          {dispatchConfirmedInfo?.customer_name}
        </p>
        <p className="text-slate-400 text-xs mt-2 mb-7">
          Giacenze scaricate dal magazzino definitivamente.
          {dispatchConfirmedInfo?.rechecked > 0 && ` Ricontrollo completato su ${dispatchConfirmedInfo.rechecked} righe.`}
        </p>

        <button
          onClick={() => {
            setOrder(null);
            setScannedOrder('');
            setOrderListTab('READY');
            setStep('SCAN_ORDER');
          }}
          className="w-full bg-sky-400 active:bg-sky-300 text-brand-black p-4 rounded-2xl font-black text-lg mb-3 transition-all"
        >
          Carica / Scansiona Altra Bolla
        </button>
        <button
          onClick={() => navigate('/zebra')}
          className="w-full bg-slate-800 hover:bg-slate-700 text-brand-white p-4 rounded-2xl font-bold text-base transition-colors"
        >
          Torna alla Home
        </button>
      </div>
    );
  }

  // ============================================================================
  // STEP FINALE: PICKING COMPLETATO (CON ACCESSO RAPIDO A CARICO BOLLA)
  // ============================================================================
  if (step === 'FINISHED') {
    const bollaCode = order?.bolla_number || lastBollaGenerated;
    return (
      <div className="flex-1 p-6 flex flex-col items-center justify-center text-center max-w-md mx-auto w-full">
        <div className="w-24 h-24 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center mb-6 shadow-[0_0_40px_rgba(16,185,129,0.3)]">
          <CheckCircle size={56} className="text-emerald-400" />
        </div>
        <h2 className="text-3xl font-black text-brand-white mb-2">Picking Completato!</h2>
        <p className="text-emerald-400 font-mono font-bold text-lg mb-1">{order?.order_code}</p>
        {bollaCode && (
          <div className="px-3.5 py-1.5 rounded-xl bg-sky-500/15 border border-sky-400/40 text-sky-300 font-mono font-black text-sm mb-3">
            Bolla Generata: {bollaCode}
          </div>
        )}
        <p className="text-slate-400 text-sm mb-7">
          Tutti i {allOrderItems.length} prelievi sono stati validati. Porta la merce in area di carico.
        </p>

        <button
          onClick={() => {
            setRecheckMode(false);
            setRecheckedItemIds([]);
            setStep('READY_DISPATCH');
          }}
          className="w-full bg-sky-400 active:bg-sky-300 text-brand-black p-4 rounded-2xl font-black text-lg mb-3 transition-all flex items-center justify-center gap-2"
        >
          <Truck size={22} /> Verifica &amp; Segna Spedito Ora
        </button>
        <button
          onClick={() => {
            setOrder(null);
            setScannedOrder('');
            setStep('SCAN_ORDER');
          }}
          className="w-full bg-emerald-500 active:bg-emerald-400 text-emerald-950 p-4 rounded-2xl font-black text-lg mb-3 transition-all"
        >
          Preleva Altro Ordine
        </button>
        <button
          onClick={() => navigate('/zebra')}
          className="w-full bg-slate-800 hover:bg-slate-700 text-brand-white p-4 rounded-2xl font-bold text-base transition-colors"
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
                <p className="text-xl font-black text-brand-white break-words leading-tight">{formatLocationLabel(nextItem)}</p>
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

  let currentZone = (currentItem?.zone && currentItem.zone !== 'null') ? currentItem.zone : '';
  let currentCol = (currentItem?.col && currentItem.col !== 'null') ? currentItem.col : '';
  let currentPos = (currentItem?.pos && currentItem.pos !== 'null') ? currentItem.pos : '';

  if (!currentZone && currentItem?.location) {
    const parts = currentItem.location.split('-').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 3) {
      currentZone = parts[0];
      currentCol = parts[1];
      pos = parts.slice(2).join('-');
    } else if (parts.length === 2) {
      currentCol = parts[0];
      currentPos = parts[1];
    }
  }

  const isMappedShelf = Boolean(currentZone || currentCol);
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
        <ZebraErrorModal message={error} onClose={() => setError(null)} />
        {order?.notes && (
          <div className="bg-amber-500/15 border border-amber-500/40 px-3 py-2 rounded-2xl text-amber-200 text-xs font-bold shrink-0">
            <span className="text-amber-400 uppercase font-black mr-1.5">NOTA DDT:</span>
            {order.notes}
          </div>
        )}
        {order?.wrong_warehouse_count > 0 && (
          <div className="bg-orange-500/15 border border-orange-500/50 px-3 py-2 rounded-2xl text-orange-200 text-xs font-bold shrink-0 flex items-center gap-2">
            <AlertTriangle size={16} className="text-orange-400 shrink-0" />
            <span>
              Attenzione: {order.wrong_warehouse_count} righe di questo ordine appartengono ad un magazzino diverso da <strong>{workspace?.warehouseName}</strong>.
            </span>
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
            <div className="flex gap-2 text-center items-stretch">
              <div className="flex-[1.6] min-w-0 bg-slate-950 border border-slate-800 rounded-2xl py-2 px-1.5 flex flex-col justify-center">
                <p className="text-[10px] font-extrabold uppercase text-slate-400 mb-0.5">Zona</p>
                <p className={`font-black text-brand-white tracking-tight break-words leading-tight ${
                  (currentZone || '').length > 15
                    ? 'text-xs'
                    : (currentZone || '').length > 8
                    ? 'text-sm'
                    : 'text-xl'
                }`}>
                  {currentZone || '—'}
                </p>
              </div>
              <div className="w-20 shrink-0 bg-slate-950 border border-sky-500/40 rounded-2xl py-2 px-1 flex flex-col justify-center">
                <p className="text-[10px] font-extrabold uppercase text-sky-400 mb-0.5">Scaffale</p>
                <p className="text-2xl font-black text-sky-400 tracking-tight">
                  {currentCol || '—'}
                </p>
              </div>
              <div className="w-20 shrink-0 bg-slate-950 border border-emerald-500/40 rounded-2xl py-2 px-1 flex flex-col justify-center">
                <p className="text-[10px] font-extrabold uppercase text-emerald-400 mb-0.5">Pos / Piano</p>
                <p className="text-2xl font-black text-emerald-400 tracking-tight">
                  {currentPos || '—'}
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-slate-950 border border-sky-500/30 rounded-2xl p-3 text-center">
              <p className="text-[10px] font-extrabold uppercase text-sky-400 mb-0.5">Area / Posizione Libera</p>
              <p className="text-xl font-black text-brand-white uppercase break-words">
                {currentItem?.location || 'Cerca in magazzino'}
              </p>
            </div>
          )}

          <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400 font-mono">
            <span className="truncate mr-2">Posizione: <strong className="text-brand-white">{currentLocLabel}</strong></span>
            {currentItem?.loc_pin && (
              <span className="shrink-0">PIN: <strong className="text-amber-400 font-bold">{currentItem.loc_pin}</strong></span>
            )}
          </div>
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
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-extrabold uppercase text-slate-400">Paletta Attesa</p>
                  {Boolean(currentItem?.is_specific) && (
                    <span className="text-[9px] font-black uppercase bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded border border-amber-500/40">
                      Specifica
                    </span>
                  )}
                </div>
                {isNoBarPallet ? (
                  <p className="text-xs font-black text-sky-400 uppercase mt-0.5">Senza Barcode</p>
                ) : (
                  <>
                    <p className="font-mono font-bold text-xs text-slate-400 truncate mt-0.5">
                      {palletPrefix}
                      <span className="text-lg font-black text-brand-blue bg-brand-blue/15 px-1.5 py-0.5 rounded ml-0.5">
                        {palletHighlight}
                      </span>
                    </p>
                    {currentItem?.client_pallet_number && (
                      <p className="text-[11px] font-mono text-emerald-400 font-bold truncate mt-1">
                        Rif: {currentItem.client_pallet_number}
                      </p>
                    )}
                  </>
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
          {/* Tasto rapido Sposta / Handling senza uscire dal picking */}
          {(step === 'SCAN_PIN' || step === 'SCAN_PALLET' || step === 'INPUT_QTY') && (
            <button
              type="button"
              onClick={() => setQuickHandlingOpen(true)}
              className="w-full py-2.5 px-3 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 rounded-2xl font-black text-xs flex items-center justify-center gap-2 active:scale-[0.98] shrink-0"
            >
              <ArrowRightLeft size={15} /> Sposta Paletta (Handling Rapido) &amp; Torna Qui
            </button>
          )}

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
                        <span className="font-black text-sm text-sky-400 break-words leading-tight">
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

      {/* Overlay Handling Rapido durante Picking — conserva esattamente posizione & stato del Picking */}
      {quickHandlingOpen && (
        <div className="fixed inset-0 z-50 bg-brand-black overflow-y-auto flex flex-col">
          <Handling
            embedded
            onCancel={() => setQuickHandlingOpen(false)}
            onComplete={async () => {
              setQuickHandlingOpen(false);
              if (order?.order_code) {
                try {
                  const whQ = workspace?.warehouseId ? `?warehouse_id=${workspace.warehouseId}` : '';
                  const res = await axios.get(`http://${window.location.hostname}:3000/api/outbound/zebra/${order.order_code}${whQ}`, {
                    headers: { Authorization: `Bearer ${token}` }
                  });
                  if (res.data?.items) {
                    setAllOrderItems(res.data.items);
                    setItems(prev => prev.map(oldItem => res.data.items.find(ni => ni.id === oldItem.id) || oldItem));
                  }
                } catch (_) {}
              }
            }}
          />
        </div>
      )}
    </div>
  );
};

export default OutboundZebra;
