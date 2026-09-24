import { appAlert, appConfirm, appPrompt } from "../utils/alerts.js";
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Select from 'react-select';
import { Scan, Box, MapPin, CheckCircle2, AlertCircle, Edit3, ArrowLeft } from 'lucide-react';
import useBarcodeScanner from '../hooks/useBarcodeScanner';

const Handling = () => {
  const [pallet, setPallet] = useState(null); // { code, product_name, ... }
  const [suggestedLocation, setSuggestedLocation] = useState(null);
  
  // Stati di flusso: WAITING_PALLET -> WAITING_PIN -> OVERRIDE_LOCATION -> SUCCESS / ERROR
  const [status, setStatus] = useState('WAITING_PALLET'); 
  const [message, setMessage] = useState('');
  
  // Stato per input PIN numerico
  const [pinInput, setPinInput] = useState('');
  
  // Stato per Override Location (Assegna nuova posizione)
  const [freeLocations, setFreeLocations] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState(null);

  const getToken = () => localStorage.getItem('maglite_token');

  // Carica le posizioni vuote
  useEffect(() => {
    const fetchLocations = async () => {
      try {
        const res = await axios.get(`http://${window.location.hostname}:3000/api/locations`, {
          headers: { Authorization: `Bearer ${getToken()}` }
        });
        const free = res.data.filter(l => !l.pallet_code);
        setFreeLocations(free);
      } catch (err) {
        console.error("Errore fetch locations");
      }
    };
    fetchLocations();
  }, []);

  const selectStyles = {
    control: (base, state) => ({
      ...base,
      backgroundColor: '#0f172a',
      borderColor: state.isFocused ? '#38bdf8' : '#334155',
      borderRadius: '0.75rem',
      padding: '0.5rem',
      boxShadow: 'none',
      '&:hover': { borderColor: '#38bdf8' }
    }),
    menu: base => ({ ...base, backgroundColor: '#0f172a', zIndex: 50, border: '1px solid #334155' }),
    option: (base, state) => ({ ...base, backgroundColor: state.isFocused ? '#1e293b' : 'transparent', color: '#f8fafc', cursor: 'pointer' }),
    singleValue: base => ({ ...base, color: '#f8fafc', fontWeight: 'bold' }),
    input: base => ({ ...base, color: '#f8fafc' }),
    placeholder: base => ({ ...base, color: '#94a3b8' })
  };

  const locationOptions = freeLocations.map(l => ({
    value: l.barcode,
    label: `${l.zone} | C: ${l.col} | P: ${l.pos}`
  }));

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
        
        // In Handling permettiamo lo spostamento di palette già in magazzino (STOCKED o PENDING)
        if (res.data.status === 'SHIPPED') {
          setStatus('ERROR');
          setMessage(`Paletta già spedita!`);
          setTimeout(() => setStatus('WAITING_PALLET'), 4000);
          return;
        }

        setPallet(res.data);
        
        // Lo spostamento prevede sempre la scelta di una nuova posizione libera
        setSelectedLocation(null);
        setStatus('OVERRIDE_LOCATION');

      } catch (err) {
        setStatus('ERROR');
        setMessage(err.response?.data?.error || 'Paletta non trovata');
        setTimeout(() => setStatus('WAITING_PALLET'), 3000);
      }
    }
  };

  // Focus automatico sull'input invisibile per Android Zebra
  const inputRef = React.useRef(null);
  useEffect(() => {
    if (status === 'WAITING_PALLET' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [status]);

  const confirmStow = async (targetLocation, targetPin) => {
    if (!targetPin) {
      appAlert("Inserisci il PIN di sicurezza!");
      return;
    }
    try {
      await axios.post(`http://${window.location.hostname}:3000/api/pallets/stow`, {
        pallet_code: pallet.pallet_code,
        location: targetLocation,
        pin: targetPin, // Il server validerà il PIN o creerà la posizione se non esiste
        source: 'Zebra'
      }, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });

      setStatus('SUCCESS');
      setMessage(`Spostato in: ${targetLocation}`);
      setPallet(null);
      setSuggestedLocation(null);
      setPinInput('');
      
      setTimeout(() => setStatus('WAITING_PALLET'), 2000);
    } catch (err) {
      setStatus('ERROR');
      setMessage(err.response?.data?.error || 'PIN errato o errore di rete');
      setTimeout(() => setStatus('WAITING_PIN'), 3000);
    }
  };

  const handleNumpad = (num) => {
    if (pinInput.length < 2) {
      setPinInput(prev => prev + num);
    }
  };

  const deleteNumpad = () => {
    setPinInput(prev => prev.slice(0, -1));
  };

  const [manualScanInput, setManualScanInput] = useState('');

  return (
    <div className={`flex-1 p-6 flex flex-col items-center justify-center text-center transition-colors duration-300 
      ${status === 'SUCCESS' ? 'bg-green-500/20' : status === 'ERROR' ? 'bg-rose-500/20' : 'bg-brand-black'}`}>
      
      {status === 'WAITING_PALLET' && (
        <div className="animate-fade-in-up w-full flex flex-col items-center">
          <div className="relative mb-8 flex justify-center w-full">
            <Scan size={96} className="text-brand-blue opacity-80" />
            <div className="absolute inset-0 bg-brand-blue opacity-20 blur-2xl rounded-full animate-pulse"></div>
          </div>
          <h2 className="text-4xl font-extrabold text-brand-white mb-4 uppercase">Handling</h2>
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

      {status === 'WAITING_PIN' && pallet && (
        <div className="w-full max-w-sm animate-fade-in-up flex flex-col h-full py-4">
          <div className="bg-slate-900 border-2 border-brand-blue rounded-3xl p-5 mb-4 shadow-[0_0_30px_rgba(14,165,233,0.3)]">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-brand-blue font-bold text-sm bg-brand-blue/10 px-2 py-1 rounded">{pallet.pallet_code}</span>
              <span className="text-brand-white font-bold text-sm">{pallet.quantity}</span>
            </div>
            <h3 className="text-xl font-bold text-brand-white text-left truncate">{pallet.product_name}</h3>
          </div>
          
          <div className="flex-1 flex flex-col items-center justify-center">
            <p className="text-brand-blue font-bold uppercase tracking-wider text-sm mb-1">Recati nel nuovo scaffale</p>
            <p className="text-5xl font-black text-brand-white mb-6">{suggestedLocation}</p>
            
            <p className="text-slate-400 text-sm mb-4">Leggi e digita il PIN scritto sullo scaffale:</p>
            
            <div className="w-full flex gap-2 justify-center mb-6">
              {[0, 1].map((i) => (
                <div key={i} className={`w-12 h-14 rounded-xl flex items-center justify-center text-2xl font-bold border-2 ${i < pinInput.length ? 'border-brand-blue text-brand-white bg-slate-800' : 'border-slate-800 text-slate-600 bg-slate-950'}`}>
                  {pinInput[i] || ''}
                </div>
              ))}
            </div>

            {/* Numpad */}
            <div className="grid grid-cols-3 gap-3 w-full mb-6">
              {[1,2,3,4,5,6,7,8,9].map(num => (
                <button key={num} onClick={() => handleNumpad(num.toString())} className="h-14 bg-slate-800 rounded-xl text-brand-white text-2xl font-bold active:bg-slate-700 active:scale-95 transition-all">{num}</button>
              ))}
              <button onClick={() => setStatus('OVERRIDE_LOCATION')} className="h-14 bg-slate-900 border border-slate-700 rounded-xl text-brand-blue text-sm font-bold active:bg-slate-800 active:scale-95 transition-all">Cambia Pos.</button>
              <button onClick={() => handleNumpad('0')} className="h-14 bg-slate-800 rounded-xl text-brand-white text-2xl font-bold active:bg-slate-700 active:scale-95 transition-all">0</button>
              <button onClick={deleteNumpad} className="h-14 bg-rose-500/10 text-rose-500 rounded-xl font-bold active:bg-rose-500/20 active:scale-95 transition-all flex items-center justify-center">Canc</button>
            </div>

            <button 
              onClick={() => confirmStow(suggestedLocation, pinInput)}
              disabled={pinInput.length !== 2}
              className="w-full py-4 bg-brand-blue text-brand-black text-xl font-black rounded-2xl active:bg-sky-400 disabled:opacity-50"
            >
              Conferma Spostamento
            </button>
          </div>
        </div>
      )}

      {status === 'OVERRIDE_LOCATION' && (
        <div className="w-full max-w-sm animate-fade-in-up text-left">
          <button onClick={() => {
            setPallet(null);
            setStatus('WAITING_PALLET');
          }} className="flex items-center gap-2 text-slate-400 mb-6 active:text-brand-white">
            <ArrowLeft size={20} /> Annulla Spostamento
          </button>
          
          <div className="bg-slate-900 border-2 border-brand-blue rounded-3xl p-4 mb-4">
            <p className="text-xs text-slate-500 uppercase font-bold mb-1">Paletta in Spostamento</p>
            <span className="font-mono text-brand-blue font-bold text-sm bg-brand-blue/10 px-2 py-1 rounded">{pallet?.pallet_code}</span>
          </div>

          <h3 className="text-2xl font-black text-brand-white mb-2">Scegli Destinazione</h3>
          <p className="text-slate-400 text-sm mb-6">Seleziona uno scaffale libero dal menu.</p>

          <div className="space-y-4 mb-8">
            <Select 
              styles={selectStyles}
              options={locationOptions}
              placeholder="Cerca scaffale libero..."
              value={locationOptions.find(o => o.value === selectedLocation)}
              onChange={val => setSelectedLocation(val ? val.value : null)}
              isClearable
              isSearchable
            />
          </div>

          <button 
            onClick={() => {
              if(!selectedLocation) { appAlert("Seleziona una posizione!"); return; }
              setSuggestedLocation(selectedLocation);
              setPinInput('');
              setStatus('WAITING_PIN'); // Torna alla validazione PIN per questa nuova posizione
            }}
            disabled={!selectedLocation}
            className="w-full py-4 bg-brand-blue text-brand-black text-xl font-black rounded-2xl active:bg-sky-400 disabled:opacity-50"
          >
            Conferma e Inserisci PIN
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
