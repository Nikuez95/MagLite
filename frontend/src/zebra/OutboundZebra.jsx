import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { PackageMinus, MapPin, ScanBarcode, ArrowRight, CheckCircle, AlertTriangle, ChevronLeft } from 'lucide-react';
import useBarcodeScanner from '../hooks/useBarcodeScanner';

const OutboundZebra = () => {
  const navigate = useNavigate();
  const token = localStorage.getItem('maglite_token');
  
  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);
  const [currentItemIndex, setCurrentItemIndex] = useState(0);
  const [step, setStep] = useState('SCAN_ORDER'); // SCAN_ORDER, SCAN_PIN, SCAN_PALLET, INPUT_QTY, FINISHED
  
  const [scannedOrder, setScannedOrder] = useState('');
  const [scannedPin, setScannedPin] = useState('');
  const [scannedPallet, setScannedPallet] = useState('');
  const [qtyInput, setQtyInput] = useState('');
  
  const [error, setError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Focus trap ref per tastiera scanner
  const inputRef = useRef(null);

  useEffect(() => {
    if ((step === 'SCAN_ORDER' || step === 'SCAN_PIN' || step === 'SCAN_PALLET') && inputRef.current) {
      inputRef.current.focus();
    }
  }, [step]);

  const handleScan = (barcode) => {
    if (isProcessing || step === 'FINISHED' || step === 'INPUT_QTY') return;
    
    setError(null);
    if (step === 'SCAN_ORDER') {
      const code = barcode.trim();
      setScannedOrder(code);
      fetchOrder(code);
    } else if (step === 'SCAN_PIN') {
      if (currentItem.loc_pin && barcode.toLowerCase() === currentItem.loc_pin.toLowerCase()) {
        setScannedPin(barcode);
        setStep('SCAN_PALLET');
      } else {
        setError(`PIN errato. Atteso: ${currentItem.loc_pin}`);
      }
    } else if (step === 'SCAN_PALLET') {
      if (barcode.toLowerCase() === currentItem.pallet_code.toLowerCase()) {
        setScannedPallet(barcode);
        setStep('INPUT_QTY');
        setQtyInput(currentItem.quantity_required.toString()); // default al richiesto
      } else {
        setError(`Paletta errata. Attesa: ${currentItem.pallet_code}`);
      }
    }
  };

  const fetchOrder = async (code) => {
    setIsProcessing(true);
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/outbound/zebra/${code}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setOrder(res.data.order);
      setItems(res.data.items.filter(i => i.status !== 'PICKED'));
      if (res.data.items.filter(i => i.status !== 'PICKED').length === 0) {
        setStep('FINISHED');
      } else {
        setCurrentItemIndex(0);
        checkAndSkipPin(res.data.items.filter(i => i.status !== 'PICKED')[0]);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Ordine non trovato');
      setScannedOrder('');
    } finally {
      setIsProcessing(false);
    }
  };

  const checkAndSkipPin = (item) => {
    if (!item.loc_pin) {
      // Nessuna posizione assegnata, salta il PIN
      setStep('SCAN_PALLET');
    } else {
      setStep('SCAN_PIN');
    }
  };

  const currentItem = items[currentItemIndex];

  const handleConfirmQty = async () => {
    const q = parseFloat(qtyInput);
    if (isNaN(q) || q <= 0 || q > currentItem.quantity_required) {
      setError('Quantità non valida');
      return;
    }
    
    setIsProcessing(true);
    setError(null);
    try {
      const res = await axios.post(`http://${window.location.hostname}:3000/api/outbound/zebra/pick`, {
        order_id: order.id,
        item_id: currentItem.id,
        pin: scannedPin,
        pallet_code: scannedPallet,
        qty_picked: q
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.data.all_picked) {
        setStep('FINISHED');
      } else {
        // Passa al prossimo
        const nextItems = items.filter(i => i.id !== currentItem.id);
        setItems(nextItems);
        setCurrentItemIndex(0);
        setScannedPin('');
        setScannedPallet('');
        setQtyInput('');
        checkAndSkipPin(nextItems[0]);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Errore di salvataggio');
    } finally {
      setIsProcessing(false);
    }
  };

  // UI Components
  if (step === 'SCAN_ORDER') {
    return (
      <div className="flex-1 p-6 flex flex-col items-center justify-center">
        <button onClick={() => navigate('/zebra')} className="absolute top-24 left-6 p-3 bg-slate-800 rounded-full text-brand-white">
          <ChevronLeft size={24} />
        </button>
        <ScanBarcode size={80} className="text-brand-blue mb-8 animate-pulse" />
        <h2 className="text-3xl font-black text-brand-white text-center mb-4">Inizia Prelievo</h2>
        <p className="text-slate-400 text-center text-lg mb-8">Scansiona il codice a barre master del DDT per iniziare.</p>
        
        {error && (
          <div className="bg-rose-500/10 border border-rose-500/50 p-4 rounded-xl text-rose-400 text-center font-bold mb-6 w-full">
            {error}
          </div>
        )}
        
        {/* Fallback per input manuale */}
        <input 
          ref={inputRef}
          autoFocus
          type="text"
          placeholder="Oppure scrivi OUT-..."
          className="bg-slate-900 border-2 border-slate-700 p-4 rounded-xl text-center text-xl font-bold w-full uppercase focus:border-brand-blue focus:ring-0 text-brand-white"
          value={scannedOrder}
          onChange={e => {
            const val = e.target.value.toUpperCase();
            setScannedOrder(val);
            if(val.length >= 17) fetchOrder(val);
          }}
          onKeyDown={e => e.key === 'Enter' && fetchOrder(scannedOrder)}
        />
        <button 
          onClick={() => fetchOrder(scannedOrder)}
          disabled={!scannedOrder || isProcessing}
          className="mt-4 w-full bg-brand-blue text-brand-black p-4 rounded-xl font-bold text-xl disabled:opacity-50"
        >
          {isProcessing ? 'Caricamento...' : 'Avvia'}
        </button>
      </div>
    );
  }

  if (step === 'FINISHED') {
    return (
      <div className="flex-1 p-6 flex flex-col items-center justify-center">
        <CheckCircle size={100} className="text-emerald-500 mb-8" />
        <h2 className="text-4xl font-black text-brand-white text-center mb-4">Ordine Pronto!</h2>
        <p className="text-slate-400 text-center text-lg mb-8">Tutta la merce è stata prelevata e validata. Porta la merce in area di carico.</p>
        <button onClick={() => navigate('/zebra')} className="w-full bg-slate-800 hover:bg-slate-700 text-brand-white p-5 rounded-2xl font-bold text-2xl transition-colors">
          Torna alla Home
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-89px)]">
      {(step === 'SCAN_ORDER' || step === 'SCAN_PIN' || step === 'SCAN_PALLET') && (
        <input 
          ref={inputRef}
          className="opacity-0 absolute w-0 h-0" 
          onBlur={(e) => { 
            if(step === 'SCAN_ORDER' || step === 'SCAN_PIN' || step === 'SCAN_PALLET') 
              setTimeout(() => e.target.focus(), 100); 
          }}
          onChange={(e) => {
             const val = e.target.value;
             if(val.length > 3) {
                handleScan(val);
                e.target.value = '';
             }
          }} 
          onKeyDown={(e) => {
             if(e.key === 'Enter') {
                handleScan(e.target.value);
                e.target.value = '';
             }
          }}
        />
      )}
      {/* Intestazione Ordine in corso */}
      <div className="bg-slate-900 p-4 border-b border-slate-800 flex justify-between items-center shrink-0">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-widest font-bold">Ordine in uscita</p>
          <p className="text-brand-white font-mono font-bold text-lg">{order?.order_code}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500 uppercase tracking-widest font-bold">Residui</p>
          <p className="text-brand-blue font-black text-2xl">{items.length}</p>
        </div>
      </div>

      {/* Area principale scrollabile */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {error && (
          <div className="bg-rose-500/10 border border-rose-500/50 p-4 rounded-2xl flex gap-3 items-center text-rose-400 shadow-lg shadow-rose-900/20 shrink-0">
            <AlertTriangle size={24} className="shrink-0" />
            <span className="font-bold">{error}</span>
          </div>
        )}

        {/* Card Dettaglio Articolo Attuale */}
        <div className="bg-slate-800/50 border-2 border-brand-blue/30 p-5 rounded-3xl shrink-0 shadow-[0_0_30px_rgba(14,165,233,0.1)]">
          {!currentItem?.loc_pin && (
            <div className="bg-amber-500/20 border border-amber-500/50 p-4 rounded-xl text-amber-400 font-bold mb-4 flex items-center gap-2">
              <AlertTriangle size={20} /> Nessuna posizione assegnata in sistema!
            </div>
          )}
          
          <h3 className="text-2xl font-bold text-brand-white mb-2 leading-tight">{currentItem?.product_name}</h3>
          
          <div className="flex gap-4 mb-4">
            <div className="flex-1 bg-slate-900 p-3 rounded-2xl">
              <p className="text-xs text-slate-500 uppercase font-bold mb-1">Paletta Attesa</p>
              <p className="text-brand-white font-mono font-bold text-lg">{currentItem?.pallet_code}</p>
            </div>
            <div className="flex-1 bg-slate-900 p-3 rounded-2xl">
              <p className="text-xs text-slate-500 uppercase font-bold mb-1">Da Prelevare</p>
              <p className="text-emerald-400 font-black text-2xl">{currentItem?.quantity_required} <span className="text-sm font-bold">{currentItem?.uom}</span></p>
            </div>
          </div>

          <div className="bg-slate-900 p-4 rounded-2xl flex items-center gap-4">
            <div className="w-12 h-12 bg-sky-500/20 text-sky-400 rounded-xl flex items-center justify-center shrink-0">
              <MapPin size={24} />
            </div>
            <div>
              <p className="text-xs text-slate-500 uppercase font-bold mb-1">Recati qui:</p>
              <p className="text-brand-white font-bold text-xl">
                {currentItem?.zone ? `${currentItem.zone} | ${currentItem.col} | ${currentItem.pos}` : 'Cerca in magazzino'}
              </p>
            </div>
          </div>
        </div>

        {/* Area Azione (Fissa in basso o scrollabile ma grande) */}
        <div className="mt-auto shrink-0 flex flex-col gap-4">
          {step === 'SCAN_PIN' && (
            <div className="bg-brand-blue/10 border-2 border-brand-blue border-dashed p-6 rounded-3xl text-center">
              <ScanBarcode size={48} className="text-brand-blue mx-auto mb-4 animate-bounce" />
              <p className="text-brand-white font-bold text-xl">1. Scansiona PIN Scaffale</p>
              <p className="text-slate-400 text-sm mt-2">Punta il laser sul PIN per sbloccare</p>
            </div>
          )}

          {step === 'SCAN_PALLET' && (
            <div className="bg-brand-blue/10 border-2 border-brand-blue border-dashed p-6 rounded-3xl text-center">
              <PackageMinus size={48} className="text-brand-blue mx-auto mb-4 animate-bounce" />
              <p className="text-brand-white font-bold text-xl">2. Scansiona Paletta</p>
              <p className="text-slate-400 text-sm mt-2">Assicurati di prendere il lotto esatto: {currentItem?.batch || 'N/D'}</p>
            </div>
          )}

          {step === 'INPUT_QTY' && (
            <div className="bg-slate-800 p-6 rounded-3xl border border-slate-700 flex flex-col gap-4">
              <p className="text-brand-white font-bold text-xl text-center">3. Conferma Quantità</p>
              <div className="flex gap-2 items-center justify-center">
                <input 
                  type="number" 
                  autoFocus
                  className="bg-slate-900 border-2 border-brand-blue text-brand-white text-center text-4xl font-black w-32 h-20 rounded-2xl"
                  value={qtyInput}
                  onChange={e => setQtyInput(e.target.value)}
                />
                <span className="text-slate-400 font-bold text-xl">{currentItem?.uom}</span>
              </div>
              <button 
                onClick={handleConfirmQty} 
                disabled={isProcessing}
                className="w-full bg-emerald-500 text-emerald-950 font-black text-2xl py-5 rounded-2xl mt-4 active:scale-95 transition-transform"
              >
                {isProcessing ? 'Conferma...' : 'CONFERMA PRELIEVO'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OutboundZebra;
