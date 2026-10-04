import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Scan, Box, MapPin, CheckCircle2, AlertCircle, ArrowLeft, Search } from 'lucide-react';

const Handling = () => {
  const [pallet, setPallet] = useState(null);
  const [status, setStatus] = useState('WAITING_PALLET'); 
  const [message, setMessage] = useState('');
  
  const [pinInput, setPinInput] = useState('');
  
  const [locations, setLocations] = useState([]);
  const [zones, setZones] = useState([]);
  const [selectedZone, setSelectedZone] = useState('');
  const [selectedCol, setSelectedCol] = useState('');
  const [targetLocation, setTargetLocation] = useState(null);
  const [occupyingPallet, setOccupyingPallet] = useState(null);

  const [zoneSearch, setZoneSearch] = useState('');
  const [manualScanInput, setManualScanInput] = useState('');
  
  const [requirePins, setRequirePins] = useState(true);

  const getToken = () => localStorage.getItem('maglite_token');

  useEffect(() => {
    const fetchInit = async () => {
      try {
        const [resLoc, resSettings] = await Promise.all([
          axios.get(`http://${window.location.hostname}:3000/api/locations`, { headers: { Authorization: `Bearer ${getToken()}` } }),
          axios.get(`http://${window.location.hostname}:3000/api/settings`, { headers: { Authorization: `Bearer ${getToken()}` } })
        ]);
        setLocations(resLoc.data);
        const uniqueZones = [...new Set(resLoc.data.map(l => l.zone).filter(Boolean))].sort();
        setZones(uniqueZones);
        
        if (resSettings.data.require_location_pins) {
          setRequirePins(resSettings.data.require_location_pins === 'true');
        }
      } catch (err) {
        console.error("Errore fetch", err);
      }
    };
    fetchInit();
  }, []);

  const handleScan = async (barcodeStr) => {
    const barcode = barcodeStr.trim();
    if (!barcode) return;
    
    if (status === 'WAITING_PALLET' || status === 'SUCCESS' || status === 'ERROR') {
      if (!barcode.startsWith('PAL-')) {
        setStatus('ERROR');
        setMessage('Scansiona un codice Paletta valido (PAL-...)');
        setTimeout(() => setStatus('WAITING_PALLET'), 3000);
        return;
      }
      
      try {
        const res = await axios.get(`http://${window.location.hostname}:3000/api/pallets/${barcode}`, {
          headers: { Authorization: `Bearer ${getToken()}` }
        });
        
        if (res.data.status === 'SHIPPED') {
          setStatus('ERROR');
          setMessage(`Paletta già spedita!`);
          setTimeout(() => setStatus('WAITING_PALLET'), 4000);
          return;
        }

        setPallet(res.data);
        setPinInput('');
        setStatus('SELECT_ZONE');
      } catch (err) {
        setStatus('ERROR');
        setMessage(err.response?.data?.error || 'Paletta non trovata');
        setTimeout(() => setStatus('WAITING_PALLET'), 3000);
      }
    }
  };

  const inputRef = React.useRef(null);
  useEffect(() => {
    if (status === 'WAITING_PALLET' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [status]);

  const handleNumpad = async (num) => {
    if (pinInput.length < 3) {
      const newVal = pinInput + num;
      setPinInput(newVal);
      if (newVal.length === 3) {
        await processPin(newVal);
      }
    }
  };

  const deleteNumpad = () => setPinInput(prev => prev.slice(0, -1));

  const processPin = async (pin) => {
    const loc = locations.find(l => l.zone === selectedZone && l.pin === pin);
    if (!loc) {
      setStatus('ERROR');
      setMessage(`PIN ${pin} non trovato in ${selectedZone}`);
      setTimeout(() => {
        setPinInput('');
        setStatus('WAITING_PIN');
      }, 3000);
      return;
    }
    
    await checkOccupiedAndStow(loc.barcode, pin);
  };

  const checkOccupiedAndStow = async (locBarcode, pin = '') => {
    setTargetLocation(locBarcode);
    const loc = locations.find(l => l.barcode === locBarcode);
    if (loc && loc.pallet_code) {
      const existingPallets = loc.pallet_code.split(',').map(p => p.trim());
      if (existingPallets.length > 0 && !existingPallets.includes(pallet.pallet_code)) {
        setOccupyingPallet(existingPallets[0]);
        setStatus('WARNING_OCCUPIED');
        return;
      }
    }
    await executeStow(locBarcode, pin);
  };

  
  const executeMerge = async () => {
    try {
      await axios.post(`http://${window.location.hostname}:3000/api/pallets/merge`, {
        source_code: pallet.pallet_code,
        target_code: occupyingPallet
      }, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      
      await axios.post(`http://${window.location.hostname}:3000/api/pallets/stow`, {
        pallet_code: occupyingPallet,
        location: targetLocation,
        pin: pinInput,
        source: 'Zebra',
        force: true
      }, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });

      setStatus('SUCCESS');
      setMessage(`Unita e Spostata in: ${targetLocation}`);
      setPallet(null);
      setPinInput('');
      setTargetLocation(null);
      setTimeout(() => setStatus('WAITING_PALLET'), 2000);
    } catch (err) {
      setStatus('ERROR');
      setMessage(err.response?.data?.error || 'Errore durante frammentazione');
      setTimeout(() => {
        setPinInput('');
        if (requirePins) setStatus('WAITING_PIN');
        else setStatus('SELECT_ZONE');
      }, 3000);
    }
  };

  const executeStow = async (locationCode, pin, force = false) => {
    try {
      await axios.post(`http://${window.location.hostname}:3000/api/pallets/stow`, {
        pallet_code: pallet.pallet_code,
        location: locationCode,
        pin: pin,
        source: 'Zebra',
        force
      }, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });

      setStatus('SUCCESS');
      setMessage(`Spostato in: ${locationCode}`);
      setPallet(null);
      setPinInput('');
      setTargetLocation(null);
      setTimeout(() => setStatus('WAITING_PALLET'), 2000);
    } catch (err) {
      if (err.response?.status === 409) {
        setOccupyingPallet(err.response.data.occupying_pallet);
        setStatus('WARNING_OCCUPIED');
      } else {
        setStatus('ERROR');
        setMessage(err.response?.data?.error || 'Posizione/PIN errato o errore di rete');
        setTimeout(() => {
          setPinInput('');
          if (requirePins) setStatus('WAITING_PIN');
          else setStatus('SELECT_ZONE');
        }, 3000);
      }
    }
  };

  const colsInZone = [...new Set(locations.filter(l => l.zone === selectedZone).map(l => l.col))].sort();
  const posInCol = [...new Set(locations.filter(l => l.zone === selectedZone && l.col === selectedCol).map(l => l.pos))].sort();

  return (
    <div className={`flex-1 p-6 flex flex-col items-center justify-center text-center transition-colors duration-300 
      ${status === 'SUCCESS' ? 'bg-green-500/20' : status === 'ERROR' ? 'bg-rose-500/20' : 'bg-brand-black'}`}>
      
      {status === 'WAITING_PALLET' && (
        <div className="animate-fade-in-up w-full flex flex-col items-center">
          <div className="relative mb-8 flex justify-center w-full">
            <Scan size={96} className="text-brand-blue opacity-80" />
            <div className="absolute inset-0 bg-brand-blue opacity-20 blur-2xl rounded-full animate-pulse"></div>
          </div>
          <h2 className="text-4xl font-extrabold text-brand-white mb-4 uppercase">Handling / Spostamento</h2>
          <p className="text-slate-400 mb-6 max-w-[280px] text-lg leading-relaxed mx-auto">
            Spara il codice a barre della <b>Paletta</b> da spostare.
          </p>
          
          <div className="flex gap-2 w-full max-w-xs">
            <input 
              ref={inputRef}
              type="text"
              placeholder="Scrivi o Scansiona..."
              className="bg-slate-900 border-2 border-slate-700 p-4 rounded-xl text-lg font-bold uppercase focus:border-brand-blue focus:ring-0 text-brand-white w-full"
              value={manualScanInput}
              onBlur={(e) => { if(status === 'WAITING_PALLET') setTimeout(() => e.target.focus(), 500); }}
              onChange={(e) => setManualScanInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                 if(e.key === 'Enter' && manualScanInput.trim() !== '') {
                    handleScan(manualScanInput);
                    setManualScanInput('');
                 }
              }}
            />
            <button 
              onClick={() => {
                if(manualScanInput.trim() !== '') {
                  handleScan(manualScanInput);
                  setManualScanInput('');
                }
              }}
              className="bg-brand-blue hover:bg-sky-400 text-brand-black font-bold px-4 rounded-xl transition-colors shrink-0"
            >
              Vai
            </button>
          </div>
        </div>
      )}

      {status === 'SELECT_ZONE' && pallet && (
        <div className="w-full max-w-sm animate-fade-in-up text-left flex flex-col h-full py-4">
          <div className="bg-slate-900 border-2 border-brand-blue rounded-3xl p-5 mb-4 shadow-[0_0_30px_rgba(14,165,233,0.3)]">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-brand-blue font-bold text-sm bg-brand-blue/10 px-2 py-1 rounded">{pallet.pallet_code}</span>
              <span className="text-brand-white font-bold text-sm">{pallet.quantity}</span>
            </div>
            <h3 className="text-xl font-bold text-brand-white text-left truncate">{pallet.product_name}</h3>
          </div>
          
          <h3 className="text-2xl font-black text-brand-white mb-2">Nuova ZONA?</h3>
          
          <div className="flex gap-2 mb-4">
            <input 
              type="text"
              placeholder={requirePins ? "Cerca zona..." : "O scrivi posizione per intero..."}
              className="w-full bg-slate-900 border-2 border-slate-700 p-4 rounded-xl text-lg font-bold uppercase focus:border-brand-blue focus:ring-0 text-brand-white"
              value={zoneSearch}
              onChange={(e) => setZoneSearch(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                 if (e.key === 'Enter' && zoneSearch.trim() !== '') {
                    if (!requirePins && zoneSearch.includes('-')) {
                      checkOccupiedAndStow(zoneSearch.trim());
                    }
                 }
              }}
              autoFocus
            />
            {!requirePins && (
              <button 
                onClick={() => {
                  if (zoneSearch.trim() !== '') checkOccupiedAndStow(zoneSearch.trim());
                }}
                className="bg-brand-blue hover:bg-sky-400 text-brand-black font-bold px-4 rounded-xl transition-colors shrink-0 flex items-center justify-center"
              >
                <CheckCircle2 size={24} />
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pb-4">
            {zones.filter(z => z.toUpperCase().includes(zoneSearch)).map(z => (
              <button 
                key={z} 
                onClick={() => {
                  setSelectedZone(z);
                  if (requirePins) {
                    setPinInput('');
                    setStatus('WAITING_PIN');
                  } else {
                    setStatus('SELECT_COL');
                  }
                }}
                className="w-full py-4 px-6 bg-slate-900 border border-slate-700 rounded-2xl text-xl font-bold text-brand-white text-left hover:border-brand-blue active:bg-slate-800 transition-colors"
              >
                Zona: <span className="text-brand-blue ml-2">{z}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {status === 'SELECT_COL' && pallet && !requirePins && (
        <div className="w-full max-w-sm animate-fade-in-up text-left flex flex-col h-full py-4">
          <button onClick={() => setStatus('SELECT_ZONE')} className="flex items-center gap-2 text-slate-400 mb-4 active:text-brand-white">
            <ArrowLeft size={20} /> Cambia Zona
          </button>
          <h3 className="text-2xl font-black text-brand-white mb-2">Zona: {selectedZone}</h3>
          <p className="text-slate-400 mb-4">Scegli la Colonna (Lettera)</p>
          
          <div className="flex-1 overflow-y-auto grid grid-cols-2 gap-3 pb-4">
            {colsInZone.map(c => (
              <button 
                key={c} 
                onClick={() => {
                  setSelectedCol(c);
                  setStatus('SELECT_POS');
                }}
                className="py-4 px-2 bg-slate-900 border border-slate-700 rounded-2xl text-2xl font-bold text-brand-blue text-center hover:border-brand-blue active:bg-slate-800 transition-colors"
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      {status === 'SELECT_POS' && pallet && !requirePins && (
        <div className="w-full max-w-sm animate-fade-in-up text-left flex flex-col h-full py-4">
          <button onClick={() => setStatus('SELECT_COL')} className="flex items-center gap-2 text-slate-400 mb-4 active:text-brand-white">
            <ArrowLeft size={20} /> Cambia Colonna
          </button>
          <h3 className="text-2xl font-black text-brand-white mb-2">{selectedZone}-{selectedCol}</h3>
          <p className="text-slate-400 mb-4">Scegli il Livello (Numero)</p>
          
          <div className="flex-1 overflow-y-auto grid grid-cols-3 gap-3 pb-4">
            {posInCol.map(p => (
              <button 
                key={p} 
                onClick={() => checkOccupiedAndStow(`${selectedZone}-${selectedCol}-${p}`)}
                className="py-4 px-2 bg-slate-900 border border-slate-700 rounded-2xl text-2xl font-bold text-emerald-400 text-center hover:border-emerald-400 active:bg-slate-800 transition-colors"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {status === 'WAITING_PIN' && pallet && requirePins && (
        <div className="w-full max-w-sm animate-fade-in-up flex flex-col h-full py-4">
          <button onClick={() => setStatus('SELECT_ZONE')} className="flex items-center gap-2 text-slate-400 mb-4 active:text-brand-white">
            <ArrowLeft size={20} /> Cambia Zona
          </button>
          
          <div className="flex-1 flex flex-col items-center justify-center">
            <p className="text-brand-blue font-bold uppercase tracking-wider text-sm mb-1">Zona Selezionata</p>
            <p className="text-5xl font-black text-brand-white mb-6">{selectedZone}</p>
            
            <p className="text-slate-400 text-sm mb-4">Leggi e digita il PIN esatto dello scaffale:</p>
            
            <div className="w-full flex gap-2 justify-center mb-6">
              {[0, 1, 2].map((i) => (
                <div key={i} className={`w-14 h-16 rounded-xl flex items-center justify-center text-3xl font-bold border-2 ${i < pinInput.length ? 'border-brand-blue text-brand-white bg-slate-800' : 'border-slate-800 text-slate-600 bg-slate-950'}`}>
                  {pinInput[i] || ''}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-3 w-full mb-6">
              {[1,2,3,4,5,6,7,8,9].map(num => (
                <button key={num} onClick={() => handleNumpad(num.toString())} className="h-14 bg-slate-800 rounded-xl text-brand-white text-2xl font-bold active:bg-slate-700 active:scale-95 transition-all">{num}</button>
              ))}
              <div className="h-14"></div>
              <button onClick={() => handleNumpad('0')} className="h-14 bg-slate-800 rounded-xl text-brand-white text-2xl font-bold active:bg-slate-700 active:scale-95 transition-all">0</button>
              <button onClick={deleteNumpad} className="h-14 bg-rose-500/10 text-rose-500 rounded-xl font-bold active:bg-rose-500/20 active:scale-95 transition-all flex items-center justify-center">Canc</button>
            </div>
          </div>
        </div>
      )}

      {status === 'WARNING_OCCUPIED' && (
        <div className="w-full max-w-sm animate-fade-in-up flex flex-col h-full py-4 items-center justify-center text-center">
          <div className="animate-[shake_0.5s_ease-in-out]">
            <AlertCircle size={80} className="text-rose-500 mb-6 mx-auto drop-shadow-[0_0_15px_rgba(244,63,94,0.5)]" />
            <h2 className="text-3xl font-black text-brand-white mb-2">Posizione Occupata!</h2>
            <p className="text-rose-300 text-lg font-bold px-4 mb-6">
              La posizione <span className="text-white bg-rose-900/50 px-2 py-1 rounded mx-1">{targetLocation}</span> è già occupata dalla paletta <span className="text-white font-mono bg-amber-900/80 px-2 py-1 rounded mx-1">{occupyingPallet}</span>.
            </p>
          </div>
          
          <button 
            onClick={executeMerge}
            className="w-full py-4 bg-amber-500 text-amber-950 text-xl font-black rounded-2xl active:bg-amber-400 mb-3 shadow-[0_0_15px_rgba(245,158,11,0.3)]"
          >
            UNISCI / FRAMMENTA
          </button>
          
          <button 
            onClick={() => executeStow(targetLocation, pinInput, true)}
            className="w-full py-4 bg-rose-600 text-white text-xl font-black rounded-2xl active:bg-rose-500 mb-3"
          >
            FORZA COMUNQUE
          </button>
          
          <button 
            onClick={() => {
              setPinInput('');
              if (requirePins) setStatus('WAITING_PIN');
              else setStatus('SELECT_ZONE');
            }}
            className="w-full py-4 bg-slate-800 text-brand-white text-xl font-bold rounded-2xl active:bg-slate-700"
          >
            Annulla (Cambia)
          </button>
        </div>
      )}

      {status === 'SUCCESS' && (
        <div className="flex flex-col items-center animate-[bounce_0.5s_ease-in-out]">
          <CheckCircle2 size={100} className="text-green-400 mb-6 drop-shadow-[0_0_15px_rgba(74,222,128,0.5)]" />
          <h2 className="text-4xl font-extrabold text-brand-white mb-4">Spostamento Eseguito!</h2>
          <p className="text-green-300 text-xl font-bold">{message}</p>
        </div>
      )}

      {status === 'ERROR' && (
        <div className="flex flex-col items-center animate-[shake_0.5s_ease-in-out]">
          <AlertCircle size={100} className="text-rose-500 mb-6 drop-shadow-[0_0_15px_rgba(244,63,94,0.5)]" />
          <h2 className="text-4xl font-extrabold text-brand-white mb-4">Attenzione</h2>
          <p className="text-rose-300 text-xl font-bold px-4">{message}</p>
        </div>
      )}

    </div>
  );
};

export default Handling;
