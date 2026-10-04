import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ChevronLeft, ScanBarcode, CheckCircle, PackagePlus, Box, AlertTriangle, Play, MapPin, Hash } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import useBarcodeScanner from '../hooks/useBarcodeScanner';

const InboundZebra = () => {
  const navigate = useNavigate();
  const token = localStorage.getItem('maglite_token');
  
  const [step, setStep] = useState('SCAN_DDT');
  const [scannedDdt, setScannedDdt] = useState('');
  const [ddt, setDdt] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [selectedItem, setSelectedItem] = useState(null);
  const [qtyInput, setQtyInput] = useState('');
  const [expDateInput, setExpDateInput] = useState('');
  const [locationInput, setLocationInput] = useState('');
    const [locationsList, setLocationsList] = useState([]);
  
  const fetchLocs = async () => {
    try {
      const [locRes, freeRes] = await Promise.all([
        axios.get(`http://${window.location.hostname}:3000/api/locations`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`http://${window.location.hostname}:3000/api/locations/free`, { headers: { Authorization: `Bearer ${token}` } })
      ]);
      const allLocs = [
        ...locRes.data.map(l => ({ name: l.barcode, occupied: !!l.pallet_code })),
        ...freeRes.data.map(l => ({ name: l.name, occupied: false }))
      ];
      
      const invRes = await axios.get(`http://${window.location.hostname}:3000/api/pallets/inventory`, { headers: { Authorization: `Bearer ${token}` } });
      const occupiedLocs = new Set(invRes.data.filter(p => p.location).map(p => p.location));
      
      const finalLocs = allLocs.map(l => ({
        name: l.name,
        occupied: l.occupied || occupiedLocs.has(l.name)
      }));
      
      setLocationsList(finalLocs);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchLocs();
  }, [token]);

  useBarcodeScanner((barcode) => {
    if (isProcessing) return;
    if (step === 'SCAN_DDT') {
      setScannedDdt(barcode);
      fetchDdt(barcode);
    }
  });

  const fetchDdt = async (code) => {
    setIsProcessing(true);
    setError(null);
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/inbound/ddt/${code}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data.ddt.status === 'COMPLETED' || res.data.ddt.status === 'DISCREPANCY') {
        setError('Questo DDT è già stato completato.');
        return;
      }
      setDdt(res.data.ddt);
      setItems(res.data.items);
      setStep('LIST_ITEMS');
    } catch (err) {
      setError('DDT non trovato o errore server');
      setScannedDdt('');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCompleteDdt = async () => {
    setIsProcessing(true);
    try {
      const res = await axios.post(`http://${window.location.hostname}:3000/api/inbound/ddt/${ddt.id}/complete`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setStep('FINISHED');
    } catch (err) {
      setError('Errore durante la chiusura del DDT.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGeneratePallet = async () => {
    const q = parseFloat(qtyInput);
    if (isNaN(q) || q <= 0) {
      setError('Quantità non valida');
      return;
    }
    
    setIsProcessing(true);
    setError(null);
    try {
      const res = await axios.post(`http://${window.location.hostname}:3000/api/inbound/ddt/${ddt.id}/scan`, {
          item_id: selectedItem.id,
          quantity: q,
          expiration_date: expDateInput || null,
          location: locationInput || null,
          warehouse: 'Settala'
        }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      // Update local item quantity
      setItems(items.map(i => i.id === selectedItem.id ? { ...i, actual_quantity: parseFloat(i.actual_quantity) + q } : i));
      setSelectedItem(null);
      setQtyInput('');
      await fetchLocs();
      setStep('LIST_ITEMS');
    } catch (err) {
      setError(err.response?.data?.error || 'Errore generazione paletta');
    } finally {
      setIsProcessing(false);
    }
  };

  if (step === 'SCAN_DDT') {
    return (
      <div className="flex-1 p-6 flex flex-col items-center justify-center">
        <button onClick={() => navigate('/zebra')} className="absolute top-24 left-6 p-3 bg-slate-800 rounded-full text-brand-white">
          <ChevronLeft size={24} />
        </button>
        <ScanBarcode size={80} className="text-brand-blue mb-8 animate-pulse" />
        <h2 className="text-3xl font-black text-brand-white text-center mb-4">Spunta Entrata</h2>
        <p className="text-slate-400 text-center text-lg mb-8">Scansiona o digita il numero del DDT.</p>
        
        {error && <div className="bg-rose-500/10 border border-rose-500/50 p-4 rounded-xl text-rose-400 text-center font-bold mb-6 w-full">{error}</div>}
        
        <input 
          type="text" 
          placeholder="Es. IN-2026-0001"
          className="bg-slate-900 border-2 border-slate-800 p-4 rounded-xl text-center text-2xl font-bold w-full uppercase"
          value={scannedDdt}
          onChange={e => {
            const val = e.target.value.toUpperCase();
            setScannedDdt(val);
          }}
          onKeyDown={e => e.key === 'Enter' && fetchDdt(scannedDdt)}
        />
        <button 
          onClick={() => fetchDdt(scannedDdt)}
          disabled={!scannedDdt || isProcessing}
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
        <h2 className="text-3xl font-black text-brand-white text-center mb-4">DDT Completato!</h2>
        <p className="text-slate-400 text-center text-lg mb-8">La spunta è terminata.</p>
        <button 
          onClick={() => navigate('/zebra')}
          className="w-full bg-brand-blue text-brand-black p-4 rounded-xl font-bold text-xl"
        >
          Torna alla Home
        </button>
      </div>
    );
  }

  if (step === 'LIST_ITEMS') {
    let hasDiscrepancy = false;
    let allDone = true;
    items.forEach(i => {
      if (parseFloat(i.actual_quantity) < parseFloat(i.expected_quantity)) allDone = false;
      if (parseFloat(i.actual_quantity) !== parseFloat(i.expected_quantity)) hasDiscrepancy = true;
    });

    return (
      <div className="flex-1 p-4 flex flex-col">
        <div className="flex items-center gap-4 mb-6">
          <button onClick={() => setStep('SCAN_DDT')} className="p-3 bg-slate-800 rounded-full text-brand-white shrink-0">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h2 className="text-2xl font-black text-white leading-tight">Spunta DDT</h2>
            <p className="text-brand-blue font-bold text-sm">{ddt?.ddt_number}</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4">
          {items.map(item => {
            const exp = parseFloat(item.expected_quantity);
            const act = parseFloat(item.actual_quantity || 0);
            const isComplete = act >= exp;
            
            return (
              <button 
                key={item.id}
                onClick={() => { setSelectedItem(item); setStep('INPUT_QTY'); setQtyInput(''); setExpDateInput(item.expiration_date ? new Date(item.expiration_date).toISOString().slice(0, 10) : ''); setLocationInput(''); setExistingPalletInput(''); setLocationInput(''); setError(null); }}
                className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${isComplete ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-slate-900 border-slate-800 active:bg-slate-800'}`}
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="font-bold text-white text-lg truncate flex-1">{item.product_name}{item.batch && <div className="text-xs text-amber-500 font-mono mt-1">Lotto: {item.batch}</div>}</div>
                  <div className="text-xs font-mono text-slate-500 ml-2 mt-1 shrink-0">{item.sku}</div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-400">Attesi: <strong className="text-white">{exp}</strong></span>
                  <span className="text-slate-600">|</span>
                  <span className="text-brand-blue">Fatti: <strong className={`text-lg ${act >= exp ? 'text-emerald-500' : 'text-brand-blue'}`}>{act}</strong></span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-4 pt-4 border-t border-slate-800">
          <button 
            onClick={handleCompleteDdt}
            disabled={isProcessing}
            className={`w-full p-4 rounded-xl font-bold text-xl flex items-center justify-center gap-2 ${hasDiscrepancy ? 'bg-amber-500 text-amber-950' : 'bg-emerald-500 text-emerald-950'}`}
          >
            {isProcessing ? 'Chiusura...' : 'Concludi Spunta'}
          </button>
          {hasDiscrepancy && (
            <p className="text-amber-500 text-xs text-center mt-2 font-bold">Attenzione: Le quantità non coincidono.</p>
          )}
        </div>
      </div>
    );
  }

  if (step === 'INPUT_QTY') {
    const exp = parseFloat(selectedItem.expected_quantity);
    const act = parseFloat(selectedItem.actual_quantity || 0);
    const remaining = Math.max(0, exp - act);

    return (
      <div className="flex-1 p-4 flex flex-col">
        <div className="flex items-center gap-4 mb-6">
          <button onClick={() => setStep('LIST_ITEMS')} className="p-3 bg-slate-800 rounded-full text-brand-white shrink-0">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h2 className="text-xl font-black text-white leading-tight truncate pr-4">{selectedItem.product_name}</h2>
            <p className="text-slate-400 font-mono text-sm">{selectedItem.sku} {selectedItem.batch && `| Lotto: ${selectedItem.batch}`}</p>
          </div>
        </div>

        <div className="flex-1 flex flex-col justify-center">
          {error && <div className="bg-rose-500/10 border border-rose-500/50 p-4 rounded-xl text-rose-400 text-center font-bold mb-6 w-full">{error}</div>}

          <div className="text-center mb-8">
            <p className="text-slate-400 font-bold mb-2">Da fare: <span className="text-brand-blue text-2xl">{remaining}</span> / {exp}</p>
            <p className="text-xs text-slate-500">Inserisci i pezzi da mettere su questa paletta.</p>
          </div>

          <div className="flex gap-2 items-center justify-center mb-6">
              <input 
                type="number" onWheel={(e) => e.target.blur()} 
                autoFocus
                className="bg-slate-900 border-2 border-brand-blue text-brand-white text-center text-4xl font-black w-32 h-20 rounded-2xl"
                value={qtyInput}
                onChange={e => setQtyInput(e.target.value)}
                placeholder={remaining.toString()}
              />
              <span className="text-slate-400 font-bold text-xl">{selectedItem.product_uom}</span>
            </div>
            
            <div className="mb-4 w-full max-w-[250px] mx-auto">
              <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider text-center">Data Scadenza (Opzionale)</label>
              <input 
                type="date"
                value={expDateInput}
                onChange={e => setExpDateInput(e.target.value)}
                className="w-full bg-slate-900 border-2 border-slate-800 p-4 rounded-xl text-center text-white font-bold focus:ring-brand-blue focus:border-brand-blue"
              />
            </div>
            
            <div className="mb-8 w-full max-w-[250px] mx-auto">
              <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider text-center">Posizione / Frammenta</label>
              <input 
                list="locations-list"
                value={locationInput}
                onChange={e => setLocationInput(e.target.value.toUpperCase())}
                placeholder="Scrivi o scegli..."
                className="w-full bg-slate-900 border-2 border-slate-800 p-4 rounded-xl text-center text-white font-bold focus:ring-brand-blue uppercase"
              />
              <datalist id="locations-list">
                {locationsList.map(l => (
                  <option key={l.name} value={l.name}>
                    {l.name} {l.occupied ? '(OCCUPATA)' : '(LIBERA)'}
                  </option>
                ))}
              </datalist>
            </div>

          <button 
            onClick={handleGeneratePallet} 
            disabled={isProcessing || !qtyInput}
            className="w-full bg-brand-blue text-brand-black p-4 rounded-xl font-bold text-xl disabled:opacity-50"
          >
            {isProcessing ? 'Creazione...' : 'Genera Paletta'}
          </button>
        </div>
      </div>
    );
  }

  return null;
};

export default InboundZebra;
