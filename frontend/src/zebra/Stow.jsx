import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Scan, Box, MapPin, CheckCircle2, AlertCircle, Edit3, ArrowLeft } from 'lucide-react';
import useBarcodeScanner from '../hooks/useBarcodeScanner';

const Stow = () => {
  const [pallet, setPallet] = useState(null); // { code, product_name, ... }
  const [suggestedLocation, setSuggestedLocation] = useState(null);
  
  // Stati di flusso: WAITING_PALLET -> WAITING_PIN -> (o OVERRIDE_LOCATION) -> SUCCESS / ERROR
  const [status, setStatus] = useState('WAITING_PALLET'); 
  const [message, setMessage] = useState('');
  
  // Stato per input PIN numerico
  const [pinInput, setPinInput] = useState('');
  
  // Stato per Override Location (Assegna nuova posizione)
  const [overrideData, setOverrideData] = useState({ zone: '', col: '', pos: '' });
  const [availableZones, setAvailableZones] = useState([]);

  const getToken = () => localStorage.getItem('maglite_token');

  // Carica le zone esistenti per la tendina
  useEffect(() => {
    const fetchZones = async () => {
      try {
        const res = await axios.get(`http://${window.location.hostname}:3000/api/locations`, {
          headers: { Authorization: `Bearer ${getToken()}` }
        });
        const zones = [...new Set(res.data.map(l => l.zone))];
        setAvailableZones(zones);
      } catch (err) {
        console.error("Errore fetch zone");
      }
    };
    fetchZones();
  }, []);

  useBarcodeScanner(async (barcode) => {
    // Il Laser si usa SOLO nello step iniziale per leggere la paletta
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
        
        if (res.data.status !== 'PENDING') {
          setStatus('ERROR');
          setMessage(`Paletta già stivata in: ${res.data.location}`);
          setTimeout(() => setStatus('WAITING_PALLET'), 4000);
          return;
        }

        setPallet(res.data);
        // Logica suggerimento. Se ha una posizione fissa "A-01-01", usa quella, altrimenti per MVP suggeriamo VST-01-01
        setSuggestedLocation(res.data.location || 'VST-01-01');
        setPinInput('');
        setStatus('WAITING_PIN');
      } catch (err) {
        setStatus('ERROR');
        setMessage(err.response?.data?.error || 'Paletta non trovata');
        setTimeout(() => setStatus('WAITING_PALLET'), 3000);
      }
    }
  });

  const confirmStow = async (targetLocation, targetPin) => {
    if (!targetPin) {
      alert("Inserisci il PIN di sicurezza!");
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
      setMessage(`Stivato in: ${targetLocation}`);
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
    if (pinInput.length < 5) {
      setPinInput(prev => prev + num);
    }
  };

  const deleteNumpad = () => {
    setPinInput(prev => prev.slice(0, -1));
  };

  return (
    <div className={`flex-1 p-6 flex flex-col items-center justify-center text-center transition-colors duration-300 
      ${status === 'SUCCESS' ? 'bg-green-500/20' : status === 'ERROR' ? 'bg-rose-500/20' : 'bg-brand-black'}`}>
      
      {status === 'WAITING_PALLET' && (
        <div className="animate-fade-in-up">
          <div className="relative mb-8 flex justify-center">
            <Scan size={96} className="text-brand-blue opacity-80" />
            <div className="absolute inset-0 bg-brand-blue opacity-20 blur-2xl rounded-full animate-pulse"></div>
          </div>
          <h2 className="text-4xl font-extrabold text-brand-white mb-4 uppercase">Stivaggio</h2>
          <p className="text-slate-400 mb-10 max-w-[280px] text-lg leading-relaxed mx-auto">
            Spara il codice a barre della <b>Paletta</b> che stai trasportando.
          </p>
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
            <p className="text-brand-blue font-bold uppercase tracking-wider text-sm mb-1">Vai allo Scaffale</p>
            <p className="text-5xl font-black text-brand-white mb-6">{suggestedLocation}</p>
            
            <p className="text-slate-400 text-sm mb-4">Leggi e digita il PIN scritto sullo scaffale:</p>
            
            <div className="w-full flex gap-2 justify-center mb-6">
              {[0, 1, 2, 3, 4].map((i) => (
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
              disabled={pinInput.length === 0}
              className="w-full py-4 bg-brand-blue text-brand-black text-xl font-black rounded-2xl active:bg-sky-400 disabled:opacity-50"
            >
              Conferma PIN
            </button>
          </div>
        </div>
      )}

      {status === 'OVERRIDE_LOCATION' && (
        <div className="w-full max-w-sm animate-fade-in-up text-left">
          <button onClick={() => setStatus('WAITING_PIN')} className="flex items-center gap-2 text-slate-400 mb-6 active:text-brand-white">
            <ArrowLeft size={20} /> Indietro
          </button>
          
          <h3 className="text-2xl font-black text-brand-white mb-2">Nuova Posizione</h3>
          <p className="text-slate-400 text-sm mb-6">Dove hai deciso di stivare la merce?</p>

          <div className="space-y-4 mb-8">
            <div>
              <label className="block text-brand-blue font-bold text-xs uppercase mb-2">Zona (es. CELLA2)</label>
              <input list="zones-list" value={overrideData.zone} onChange={e => setOverrideData({...overrideData, zone: e.target.value.toUpperCase()})} className="w-full bg-slate-900 border-2 border-slate-700 rounded-xl p-4 text-brand-white text-xl uppercase" placeholder="Es. CELLA2" maxLength={10} />
              <datalist id="zones-list">
                {availableZones.map(z => <option key={z} value={z} />)}
              </datalist>
            </div>
            
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-brand-blue font-bold text-xs uppercase mb-2">Colonna</label>
                <input type="number" value={overrideData.col} onChange={e => setOverrideData({...overrideData, col: e.target.value.padStart(2, '0')})} className="w-full bg-slate-900 border-2 border-slate-700 rounded-xl p-4 text-brand-white text-xl text-center" placeholder="01" />
              </div>
              <div className="flex-1">
                <label className="block text-brand-blue font-bold text-xs uppercase mb-2">Piano</label>
                <input type="number" value={overrideData.pos} onChange={e => setOverrideData({...overrideData, pos: e.target.value.padStart(2, '0')})} className="w-full bg-slate-900 border-2 border-slate-700 rounded-xl p-4 text-brand-white text-xl text-center" placeholder="11" />
              </div>
            </div>
            
            <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 text-center mt-4">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Codice Generato</p>
              <p className="text-3xl font-mono text-brand-white">
                {overrideData.zone || '?'}-{overrideData.col || '?'}-{overrideData.pos || '?'}
              </p>
            </div>
          </div>

          <button 
            onClick={() => {
              if(!overrideData.zone || !overrideData.col || !overrideData.pos) { alert("Completa i campi!"); return; }
              const manualLoc = `${overrideData.zone}-${overrideData.col}-${overrideData.pos}`;
              setSuggestedLocation(manualLoc);
              setPinInput('');
              setStatus('WAITING_PIN'); // Torna alla validazione PIN per questa nuova posizione
            }}
            className="w-full py-4 bg-brand-blue text-brand-black text-xl font-black rounded-2xl active:bg-sky-400"
          >
            Conferma e Inserisci PIN
          </button>
        </div>
      )}

      {status === 'SUCCESS' && (
        <div className="flex flex-col items-center animate-[bounce_0.5s_ease-in-out]">
          <CheckCircle2 size={100} className="text-green-400 mb-6 drop-shadow-[0_0_15px_rgba(74,222,128,0.5)]" />
          <h2 className="text-4xl font-extrabold text-brand-white mb-4">Ottimo!</h2>
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

export default Stow;
