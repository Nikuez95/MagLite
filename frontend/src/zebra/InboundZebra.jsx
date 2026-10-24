import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ChevronLeft, ScanBarcode, CheckCircle, PackagePlus, Box, AlertTriangle, Play, MapPin, Hash, Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import useBarcodeScanner from '../hooks/useBarcodeScanner';

const InboundZebra = () => {
  const navigate = useNavigate();
  const token = localStorage.getItem('maglite_token');
  
  const [step, setStep] = useState('SCAN_DDT');
  const [scannedDdt, setScannedDdt] = useState('');
  const [ddt, setDdt] = useState(null);
  const [items, setItems] = useState([]);
  const [searchFilter, setSearchFilter] = useState('');
  const [error, setError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [selectedItem, setSelectedItem] = useState(null);
  const [qtyInput, setQtyInput] = useState('');
  const [boxesInput, setBoxesInput] = useState('');
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
    } else if (step === 'LIST_ITEMS') {
      setSearchFilter(barcode.trim());
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
      setSearchFilter('');
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
      setBoxesInput('');
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

    const filteredItems = items.filter(item => {
      if (!searchFilter.trim()) return true;
      const q = searchFilter.toLowerCase().trim();
      const nameMatch = item.product_name && item.product_name.toLowerCase().includes(q);
      const batchMatch = item.batch && item.batch.toLowerCase().includes(q);
      const skuMatch = item.sku && item.sku.toLowerCase().includes(q);
      const clientArticleMatch = item.client_article_number && item.client_article_number.toLowerCase().includes(q);
      return nameMatch || batchMatch || skuMatch || clientArticleMatch;
    });

    return (
      <div className="flex-1 p-4 flex flex-col">
        <div className="flex items-center gap-4 mb-4">
          <button onClick={() => setStep('SCAN_DDT')} className="p-3 bg-slate-800 rounded-full text-brand-white shrink-0">
            <ChevronLeft size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-black text-white leading-tight">Spunta DDT</h2>
            <p className="text-brand-blue font-bold text-sm truncate">{ddt?.ddt_number}</p>
          </div>
        </div>

        {/* Ricerca per Nome o Lotto */}
        <div className="relative mb-3">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Cerca per nome o lotto..."
            value={searchFilter}
            onChange={e => setSearchFilter(e.target.value)}
            className="w-full bg-slate-900 border-2 border-slate-700 focus:border-brand-blue rounded-xl py-3 pl-11 pr-11 text-brand-white text-base font-bold placeholder-slate-500 focus:outline-none"
          />
          {searchFilter && (
            <button 
              onClick={() => setSearchFilter('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg active:scale-95"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {searchFilter.trim() && (
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2 px-1">
            <span>Trovati: <strong className="text-brand-blue font-bold">{filteredItems.length}</strong> su {items.length}</span>
            <button 
              onClick={() => setSearchFilter('')}
              className="text-brand-blue hover:underline font-bold"
            >
              Azzera filtro
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-3">
          {filteredItems.map(item => {
            const exp = parseFloat(item.expected_quantity);
            const act = parseFloat(item.actual_quantity || 0);
            const isComplete = act >= exp;
            
            return (
              <button 
                key={item.id}
                onClick={() => { setSelectedItem(item); setStep('INPUT_QTY'); setQtyInput(''); setBoxesInput(''); setExpDateInput(item.expiration_date ? new Date(item.expiration_date).toISOString().slice(0, 10) : ''); setLocationInput(item.location || ''); setError(null); }}
                className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${isComplete ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-slate-900 border-slate-800 active:bg-slate-800 hover:border-brand-blue'}`}
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="font-bold text-white text-lg truncate flex-1">
                    {item.product_name}
                    {item.batch && (
                      <div className="text-xs text-amber-400 font-mono font-bold mt-1 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-lg w-fit">
                        Lotto: {item.batch}
                      </div>
                    )}
                  </div>
                  <div className="text-xs font-mono text-slate-500 ml-2 mt-1 shrink-0">{item.sku}</div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-400">Attesi: <strong className="text-white">{exp}</strong></span>
                  <span className="text-slate-600">|</span>
                  <span className="text-brand-blue">Fatti: <strong className={`text-lg ${act >= exp ? 'text-emerald-500' : 'text-brand-blue'}`}>{act}</strong></span>
                  {item.units_per_box > 0 && (item.product_uom?.toLowerCase() === 'pezzi' || item.product_uom?.toLowerCase() === 'pz') && (
                    <span className="text-xs text-slate-500 font-mono ml-auto">({item.units_per_box} pz/scat.)</span>
                  )}
                </div>
              </button>
            );
          })}

          {filteredItems.length === 0 && (
            <div className="p-6 text-center bg-slate-900/50 border border-slate-800 rounded-2xl my-4">
              <p className="text-slate-400 text-sm mb-1">Nessun articolo trovato per:</p>
              <p className="text-brand-blue font-mono font-bold text-base mb-3">"{searchFilter}"</p>
              <button 
                onClick={() => setSearchFilter('')}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold text-xs active:scale-95 transition-all"
              >
                Mostra tutti ({items.length})
              </button>
            </div>
          )}
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
    if (!selectedItem) return null;

    const exp = parseFloat(selectedItem.expected_quantity);
    const act = parseFloat(selectedItem.actual_quantity || 0);
    const remaining = Math.max(0, exp - act);

    const unitsPerBox = parseInt(selectedItem.units_per_box, 10);
    const rawUom = (selectedItem.product_uom || selectedItem.uom || '').toLowerCase().trim();
    const isPieces = rawUom === 'pezzi' || rawUom === 'pz' || rawUom === 'pezzo' || rawUom === 'base' || rawUom === '' || (unitsPerBox > 1 && rawUom !== 'scatole' && rawUom !== 'bancali');
    const hasUnitsPerBox = !isNaN(unitsPerBox) && unitsPerBox > 1;

    const handleBoxesChange = (val) => {
      setBoxesInput(val);
      if (val === '' || isNaN(parseFloat(val))) {
        setQtyInput('');
        return;
      }
      const b = parseFloat(val);
      if (hasUnitsPerBox) {
        setQtyInput((b * unitsPerBox).toString());
      }
    };

    const handleQtyChange = (val) => {
      setQtyInput(val);
      if (val === '' || isNaN(parseFloat(val))) {
        setBoxesInput('');
        return;
      }
      const q = parseFloat(val);
      if (hasUnitsPerBox) {
        const b = q / unitsPerBox;
        setBoxesInput(Number.isInteger(b) ? b.toString() : parseFloat(b.toFixed(2)).toString());
      }
    };

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

          <div className="text-center mb-6">
            {isPieces && hasUnitsPerBox && remaining >= unitsPerBox ? (
              <div>
                <p className="text-emerald-400 font-black text-3xl">
                  {Number.isInteger(remaining / unitsPerBox) ? (remaining / unitsPerBox) : (remaining / unitsPerBox).toFixed(1)} SCATOLE
                </p>
                <p className="text-slate-300 font-bold text-sm mt-1">
                  Equivalgono a <span className="text-brand-blue font-black">{remaining}</span> / {exp} {selectedItem.product_uom}
                </p>
              </div>
            ) : (
              <p className="text-slate-400 font-bold mb-1">
                Da fare: <span className="text-brand-blue text-2xl">{remaining}</span> / {exp} {selectedItem.product_uom}
              </p>
            )}
            <p className="text-xs text-slate-500 mt-1">Inserisci scatole o pezzi da mettere su questa paletta.</p>
          </div>

          {isPieces && hasUnitsPerBox ? (
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 mb-6 max-w-sm mx-auto w-full shadow-lg">
              <div className="text-xs text-amber-400 font-mono font-bold text-center mb-4 bg-amber-500/10 border border-amber-500/20 py-1.5 px-3 rounded-lg w-fit mx-auto flex items-center gap-1.5">
                <span>📦</span>
                <span>1 Scatola = <strong>{unitsPerBox}</strong> Pezzi</span>
              </div>

              <div className="grid grid-cols-2 gap-3 items-start">
                {/* Input Scatole (Primario) */}
                <div className="flex flex-col items-center">
                  <label className="text-xs text-emerald-400 uppercase font-black mb-1.5">Scatole</label>
                  <input 
                    type="number"
                    onWheel={(e) => e.target.blur()}
                    className="bg-slate-950 border-2 border-emerald-500 focus:border-emerald-400 text-emerald-400 text-center text-3xl font-black w-full h-16 rounded-xl"
                    value={boxesInput}
                    onChange={e => handleBoxesChange(e.target.value)}
                    placeholder={hasUnitsPerBox && remaining > 0 ? (Number.isInteger(remaining / unitsPerBox) ? (remaining / unitsPerBox).toString() : (remaining / unitsPerBox).toFixed(1)) : '0'}
                  />
                  <span className="text-[11px] text-emerald-400/80 font-bold mt-1.5">Colli / Scatole</span>
                </div>

                {/* Input Pezzi Totali */}
                <div className="flex flex-col items-center">
                  <label className="text-xs text-slate-400 uppercase font-bold mb-1.5">Pezzi Equivalenti</label>
                  <input 
                    type="number"
                    onWheel={(e) => e.target.blur()}
                    className="bg-slate-950 border-2 border-slate-700 focus:border-brand-blue text-brand-white text-center text-3xl font-black w-full h-16 rounded-xl"
                    value={qtyInput}
                    onChange={e => handleQtyChange(e.target.value)}
                    placeholder={remaining.toString()}
                  />
                  <span className="text-[11px] text-slate-500 font-bold mt-1.5">Pezzi effettivi</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 items-center justify-center mb-6">
              <input 
                type="number" onWheel={(e) => e.target.blur()} 
                className="bg-slate-900 border-2 border-brand-blue text-brand-white text-center text-4xl font-black w-32 h-20 rounded-2xl"
                value={qtyInput}
                onChange={e => setQtyInput(e.target.value)}
                placeholder={remaining.toString()}
              />
              <span className="text-slate-400 font-bold text-xl">{selectedItem.product_uom}</span>
            </div>
          )}
            
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
