import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useLocation } from 'react-router-dom';
import { Scan, Box, MapPin, CheckCircle2, AlertCircle, ArrowLeft, Search, Keyboard, Layers, Sparkles } from 'lucide-react';
import { io } from 'socket.io-client';
import useBarcodeScanner from '../hooks/useBarcodeScanner';
import { useZebraWorkspace } from '../utils/zebraWorkspace';

// Estrae Piano (level) e Posizione Orizzontale (colIndex) da una posizione scaffale (es. "01", "12", "33", "010")
const parseShelfPos = (posStr) => {
  const clean = String(posStr || '').trim();
  if (/^\d{2,}$/.test(clean)) {
    return {
      pos: clean,
      level: parseInt(clean[0], 10),
      colIndex: parseInt(clean.slice(1), 10)
    };
  }
  if (/^\d$/.test(clean)) {
    return {
      pos: clean,
      level: 0,
      colIndex: parseInt(clean, 10)
    };
  }
  const digits = clean.match(/\d+/g);
  if (digits && digits.length >= 2) {
    return {
      pos: clean,
      level: parseInt(digits[0], 10),
      colIndex: parseInt(digits[1], 10)
    };
  }
  if (digits && digits.length === 1 && digits[0].length >= 2) {
    return {
      pos: clean,
      level: parseInt(digits[0][0], 10),
      colIndex: parseInt(digits[0].slice(1), 10)
    };
  }
  return {
    pos: clean,
    level: 0,
    colIndex: 0
  };
};

const Handling = ({ embedded = false, initialBarcodeProp = null, onComplete = null, onCancel = null }) => {
  const routeLocation = useLocation();
  const workspace = useZebraWorkspace();
  const [showAllDivisions, setShowAllDivisions] = useState(false);
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
  const [destTab, setDestTab] = useState('MAPPED'); // 'MAPPED' | 'FREE'
  const [freeLocations, setFreeLocations] = useState([]);
  const [sourceItems, setSourceItems] = useState([]);
  const [sourceFreeLocName, setSourceFreeLocName] = useState(null);
  const [movePlan, setMovePlan] = useState(null); // { mode: 'ALL_PALLET'|'SINGLE_ITEM', pallet_code, pallet_id, move_quantity, label }
  const [partialModalItem, setPartialModalItem] = useState(null);
  const [partialQtyInput, setPartialQtyInput] = useState('');

  const [manualScanInput, setManualScanInput] = useState('');
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const scanDebounceRef = useRef(null);
  const [slottingData, setSlottingData] = useState(null);
  
  const [requirePins, setRequirePins] = useState(true);

  const getToken = () => localStorage.getItem('maglite_token');

  const fetchRecommendation = async (palletCode, zone = null) => {
    if (!palletCode) return;
    try {
      const qs = zone
        ? `pallet_code=${encodeURIComponent(palletCode)}&zone=${encodeURIComponent(zone)}`
        : `pallet_code=${encodeURIComponent(palletCode)}`;
      const res = await axios.get(`http://${window.location.hostname}:3000/api/pallets/slotting/recommend?${qs}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setSlottingData(res.data);
    } catch (err) {
      // Fallback silenzioso se calcolo non disponibile
    }
  };

  const fetchInit = async () => {
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      const params = new URLSearchParams();
      if (workspace?.warehouseId) params.set('warehouse_id', workspace.warehouseId);
      if (workspace?.divisionId && !showAllDivisions) params.set('division_id', workspace.divisionId);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const whOnlyQs = workspace?.warehouseId ? `?warehouse_id=${workspace.warehouseId}` : '';

      const [resLoc, resFree, resSettings] = await Promise.all([
        axios.get(`http://${window.location.hostname}:3000/api/locations${qs}`, { headers }).catch(() => ({ data: [] })),
        axios.get(`http://${window.location.hostname}:3000/api/locations/free${whOnlyQs}`, { headers }).catch(() => ({ data: [] })),
        axios.get(`http://${window.location.hostname}:3000/api/settings`, { headers }).catch(() => ({ data: {} }))
      ]);
      const locList = resLoc.data || [];
      setLocations(locList);
      setFreeLocations(resFree.data || []);
      const uniqueZones = [...new Set(locList.map(l => l.zone).filter(Boolean))].sort();
      setZones(uniqueZones);
      
      if (resSettings.data && resSettings.data.require_location_pins !== undefined) {
        setRequirePins(resSettings.data.require_location_pins === 'true');
      }
    } catch (err) {
      console.error("Errore fetch", err);
    }
  };

  useEffect(() => {
    fetchInit();
    const socket = io(`http://${window.location.hostname}:3000`);
    const refresh = () => fetchInit();
    socket.on('locations_updated', refresh);
    socket.on('stow_updated', refresh);
    socket.on('inventory_updated', refresh);
    socket.on('warehouses_updated', refresh);
    return () => {
      socket.off('locations_updated', refresh);
      socket.off('stow_updated', refresh);
      socket.off('inventory_updated', refresh);
      socket.off('warehouses_updated', refresh);
      socket.disconnect();
    };
  }, [workspace?.warehouseId, workspace?.divisionId, showAllDivisions]);

  useEffect(() => {
    const initCode = initialBarcodeProp || routeLocation.state?.initialBarcode;
    if (initCode) {
      handleScan(initCode);
    }
  }, [routeLocation.state, initialBarcodeProp]);

  const openFreeLocation = async (locName) => {
    try {
      const whQ = workspace?.warehouseId ? `?warehouse_id=${workspace.warehouseId}` : '';
      const res = await axios.get(`http://${window.location.hostname}:3000/api/pallets/by-location/${encodeURIComponent(locName)}${whQ}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      const items = res.data?.items || [];
      if (items.length === 0) {
        setStatus('ERROR');
        setMessage(`Nessun articolo presente in ${locName}`);
        setTimeout(() => setStatus('WAITING_PALLET'), 2500);
        return;
      }
      setSourceFreeLocName(res.data.location);
      setSourceItems(items);
      setPallet(items[0]);
      setMovePlan(null);
      setSlottingData(null);
      setPinInput('');
      setDestTab('MAPPED');
      setStatus('SELECT_ITEMS');
    } catch (err) {
      setStatus('ERROR');
      setMessage(err.response?.data?.error || `Errore apertura posizione ${locName}`);
      setTimeout(() => setStatus('WAITING_PALLET'), 3000);
    }
  };

  const handleScan = async (barcodeStr) => {
    const barcode = barcodeStr.trim();
    if (!barcode) return;
    
    if (status === 'WAITING_PALLET' || status === 'SUCCESS' || status === 'ERROR') {
      const upper = barcode.toUpperCase();
      if (!upper.startsWith('PAL-') && !upper.startsWith('NOBAR-')) {
        // Se non è un barcode paletta, prova a vedere se è un barcode posizione / FREE_LOCATIONS
        try {
          const whQ = workspace?.warehouseId ? `?warehouse_id=${workspace.warehouseId}` : '';
          const resLoc = await axios.get(`http://${window.location.hostname}:3000/api/pallets/by-location/${encodeURIComponent(upper)}${whQ}`, {
            headers: { Authorization: `Bearer ${getToken()}` }
          });
          if (resLoc.data?.items?.length > 0) {
            setSourceFreeLocName(resLoc.data.location);
            setSourceItems(resLoc.data.items);
            setPallet(resLoc.data.items[0]);
            setMovePlan(null);
            setSlottingData(null);
            setPinInput('');
            setDestTab('MAPPED');
            setStatus('SELECT_ITEMS');
            return;
          }
        } catch (_) {}

        setStatus('ERROR');
        setMessage('Scansiona un codice Paletta (PAL-...) o seleziona una Posizione Libera');
        setTimeout(() => setStatus('WAITING_PALLET'), 3000);
        return;
      }
      
      try {
        const res = await axios.get(`http://${window.location.hostname}:3000/api/pallets/${barcode}`, {
          headers: { Authorization: `Bearer ${getToken()}` }
        });

        if (workspace?.warehouseId && res.data.warehouse_id && Number(res.data.warehouse_id) !== Number(workspace.warehouseId)) {
          setStatus('ERROR');
          setMessage(`Paletta in altro magazzino (${res.data.warehouse || 'Altra sede'}). Cambia sede in alto prima di spostarla.`);
          setTimeout(() => setStatus('WAITING_PALLET'), 4000);
          return;
        }
        
        if (res.data.status === 'SHIPPED') {
          setStatus('ERROR');
          setMessage(`Paletta già spedita!`);
          setTimeout(() => setStatus('WAITING_PALLET'), 4000);
          return;
        }

        const rows = Array.isArray(res.data.items) && res.data.items.length > 0 ? res.data.items : [res.data];
        setPallet(res.data);
        setSourceItems(rows);
        setSourceFreeLocName(null);
        setSlottingData(null);
        setPinInput('');
        setDestTab('MAPPED');

        if (rows.length > 1) {
          setMovePlan(null);
          setStatus('SELECT_ITEMS');
        } else {
          setMovePlan({
            mode: 'SINGLE_ITEM',
            pallet_id: rows[0].id,
            pallet_code: rows[0].pallet_code,
            move_quantity: parseFloat(rows[0].quantity),
            label: `${rows[0].product_name} (${rows[0].quantity} ${rows[0].uom || ''})`
          });
          setStatus('SELECT_ZONE');
        }
        fetchRecommendation(res.data.pallet_code);
      } catch (err) {
        setStatus('ERROR');
        setMessage(err.response?.data?.error || 'Paletta non trovata');
        setTimeout(() => setStatus('WAITING_PALLET'), 3000);
      }
    }
  };

  const inputRef = useRef(null);
  useEffect(() => {
    setKeyboardOpen(false);
    if (status === 'WAITING_PALLET' && inputRef.current) {
      setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
    }
  }, [status]);

  useBarcodeScanner((barcode) => {
    if (status === 'WAITING_PALLET' || status === 'SUCCESS' || status === 'ERROR') {
      handleScan(barcode);
    }
  });

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
    const isFreeDest = freeLocations.some(fl => fl.name.toUpperCase() === locBarcode.toUpperCase());
    if (!isFreeDest) {
      const loc = locations.find(l => l.barcode === locBarcode);
      if (loc && loc.pallet_code) {
        const existingPallets = loc.pallet_code.split(',').map(p => p.trim());
        const plan = movePlan || { mode: 'ALL_PALLET', pallet_code: pallet.pallet_code };
        if (existingPallets.length > 0 && !existingPallets.includes(plan.pallet_code)) {
          setOccupyingPallet(existingPallets[0]);
          setStatus('WARNING_OCCUPIED');
          return;
        }
      }
    }
    await executeStow(locBarcode, pin, false, false);
  };

  const buildMovePayload = (locationCode, pin, force = false, mergeIntoExisting = false) => {
    const plan = movePlan || { mode: 'ALL_PALLET', pallet_code: pallet.pallet_code };
    return {
      mode: plan.mode,
      pallet_code: plan.pallet_code || pallet.pallet_code,
      pallet_id: plan.pallet_id || undefined,
      move_quantity: plan.move_quantity !== undefined ? plan.move_quantity : undefined,
      target_location: locationCode,
      pin: pin || undefined,
      source: 'Zebra',
      force,
      merge_into_existing: mergeIntoExisting,
      active_warehouse_id: workspace?.warehouseId || undefined
    };
  };

  const executeMerge = async () => {
    try {
      await axios.post(
        `http://${window.location.hostname}:3000/api/pallets/move-items`,
        buildMovePayload(targetLocation, pinInput, false, true),
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );

      await fetchInit();
      setStatus('SUCCESS');
      setMessage(`Unita e Spostata in: ${targetLocation}`);
      setPallet(null);
      setMovePlan(null);
      setSourceItems([]);
      setPinInput('');
      setTargetLocation(null);
      setTimeout(() => {
        if (embedded && onComplete) onComplete(targetLocation);
        else setStatus('WAITING_PALLET');
      }, 1500);
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

  const executeStow = async (locationCode, pin, force = false, mergeIntoExisting = false) => {
    try {
      await axios.post(
        `http://${window.location.hostname}:3000/api/pallets/move-items`,
        buildMovePayload(locationCode, pin, force, mergeIntoExisting),
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );

      await fetchInit();
      setStatus('SUCCESS');
      setMessage(`Spostato in: ${locationCode}`);
      setPallet(null);
      setMovePlan(null);
      setSourceItems([]);
      setPinInput('');
      setTargetLocation(null);
      setTimeout(() => {
        if (embedded && onComplete) onComplete(locationCode);
        else setStatus('WAITING_PALLET');
      }, 1500);
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

  // Costruisce la vista reale dello scaffale: ripiani ordinati dall'ALTO verso il BASSO (es. 3 -> 2 -> 1 -> 0)
  // e posizioni ordinate da SINISTRA verso DESTRA su ogni ripiano (es. 31 32 33 / 21 22 23 / 11 12 13 / 01 02 03)
  const shelfRows = (() => {
    const rackLocs = locations.filter(l => l.zone === selectedZone && l.col === selectedCol);
    const uniqueByPos = new Map();
    rackLocs.forEach(l => {
      if (!uniqueByPos.has(l.pos)) {
        uniqueByPos.set(l.pos, {
          ...l,
          ...parseShelfPos(l.pos)
        });
      }
    });

    const byLevel = new Map();
    uniqueByPos.forEach(item => {
      if (!byLevel.has(item.level)) byLevel.set(item.level, []);
      byLevel.get(item.level).push(item);
    });

    // Livelli dal più alto (in cima allo scaffale) al più basso (0 = terra)
    const sortedLevels = [...byLevel.keys()].sort((a, b) => b - a);
    return sortedLevels.map(lvl => ({
      level: lvl,
      items: byLevel.get(lvl).sort((a, b) => a.colIndex - b.colIndex || a.pos.localeCompare(b.pos, undefined, { numeric: true }))
    }));
  })();

  return (
    <div className={`flex-1 p-6 flex flex-col items-center justify-center text-center transition-colors duration-300 
      ${status === 'SUCCESS' ? 'bg-green-500/20' : status === 'ERROR' ? 'bg-rose-500/20' : 'bg-brand-black'}`}>
      
      {status === 'WAITING_PALLET' && (
        <div className="animate-fade-in-up w-full flex flex-col items-center">
          {embedded && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="self-start mb-3 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-bold text-xs flex items-center gap-1.5"
            >
              <ArrowLeft size={16} /> Torna al Picking
            </button>
          )}
          {workspace?.warehouseName && (
            <div className="mb-3 flex flex-wrap items-center justify-center gap-1.5 text-[11px]">
              <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 font-black">
                Sede: {workspace.warehouseName}{workspace.divisionName && !showAllDivisions ? ` • ${workspace.divisionName}` : ''}
              </span>
              {workspace.divisionId && (
                <button
                  type="button"
                  onClick={() => setShowAllDivisions(v => !v)}
                  className="px-2.5 py-1 rounded-full bg-slate-900 border border-slate-700 text-slate-300 font-bold"
                >
                  {showAllDivisions ? `Solo ${workspace.divisionName}` : 'Tutti i Reparti'}
                </button>
              )}
            </div>
          )}
          <div className="relative mb-5 flex justify-center w-full">
            <Scan size={76} className="text-brand-blue opacity-80" />
            <div className="absolute inset-0 bg-brand-blue opacity-20 blur-2xl rounded-full animate-pulse"></div>
          </div>
          <h2 className="text-3xl font-extrabold text-brand-white mb-2 uppercase">Handling / Spostamento</h2>
          <p className="text-slate-400 mb-5 max-w-[290px] text-sm leading-relaxed mx-auto">
            Spara il barcode della <b>Paletta / Posizione</b> oppure scegli una <b>Posizione Libera</b> sotto.
          </p>
          
          <div className="w-full max-w-xs bg-slate-900 border-2 border-slate-800 rounded-3xl p-3.5 mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase text-brand-blue">Laser Pronto</span>
              <button
                type="button"
                onClick={() => {
                  const next = !keyboardOpen;
                  setKeyboardOpen(next);
                  setTimeout(() => next && inputRef.current?.focus(), 40);
                }}
                className={`px-3 py-1 rounded-xl text-xs font-bold flex items-center gap-1.5 ${
                  keyboardOpen ? 'bg-brand-blue text-brand-black' : 'bg-slate-800 text-slate-300 border border-slate-700'
                }`}
              >
                <Keyboard size={14} />
                {keyboardOpen ? 'Chiudi Tastiera' : 'Tastiera'}
              </button>
            </div>
            <div className="flex gap-2">
              <input 
                ref={inputRef}
                type="text"
                inputMode={keyboardOpen ? 'text' : 'none'}
                placeholder={keyboardOpen ? "Scrivi PAL- o Posizione..." : "Attendo scansione..."}
                className="bg-slate-950 border-2 border-slate-700 p-3.5 rounded-xl text-base font-mono font-bold uppercase focus:border-brand-blue focus:outline-none text-brand-white w-full"
                value={manualScanInput}
                onBlur={() => setKeyboardOpen(false)}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase();
                  setManualScanInput(val);
                  if (scanDebounceRef.current) clearTimeout(scanDebounceRef.current);
                  const trimmed = val.trim();
                  if (!keyboardOpen && (trimmed.startsWith('PAL-') || trimmed.startsWith('NOBAR-')) && trimmed.length >= 12) {
                    scanDebounceRef.current = setTimeout(() => {
                      setManualScanInput('');
                      handleScan(trimmed);
                    }, 220);
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
                className="bg-brand-blue hover:bg-sky-400 text-brand-black font-bold px-4 rounded-xl transition-colors shrink-0"
              >
                Vai
              </button>
            </div>
          </div>

          {freeLocations.length > 0 && (
            <div className="w-full max-w-xs text-left space-y-2">
              <div className="text-[11px] font-black uppercase tracking-wider text-slate-400 px-1">
                Posizioni Libere / Scaffalini ({freeLocations.length})
              </div>
              <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto">
                {freeLocations.map(fl => {
                  const cnt = Number(fl.items_count) || 0;
                  const udmCnt = Number(fl.pallets_count) || 0;
                  return (
                    <button
                      key={fl.id}
                      type="button"
                      disabled={cnt === 0}
                      onClick={() => cnt > 0 && openFreeLocation(fl.name)}
                      className={`w-full p-3 rounded-2xl flex items-center justify-between transition-all border ${
                        cnt > 0
                          ? 'bg-slate-900 border-slate-700 hover:border-brand-blue active:scale-[0.98]'
                          : 'bg-slate-900/50 border-slate-800/70 opacity-65 cursor-default'
                      }`}
                    >
                      <span className="font-bold text-sm text-brand-white truncate">{fl.name}</span>
                      <span className={`text-xs font-black px-2 py-0.5 rounded-lg border shrink-0 ${
                        cnt > 0
                          ? 'bg-brand-blue/15 text-brand-blue border-brand-blue/30'
                          : 'bg-slate-950 text-slate-500 border-slate-800'
                      }`}>
                        {cnt > 0 ? `${udmCnt || 1} UDM · ${cnt} art.` : 'Vuota'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {status === 'SELECT_ITEMS' && (
        <div className="w-full max-w-sm animate-fade-in-up text-left flex flex-col h-full py-3">
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => { setStatus('WAITING_PALLET'); setPallet(null); setSourceItems([]); setSourceFreeLocName(null); }}
              className="flex items-center gap-1.5 text-slate-400 active:text-brand-white font-bold text-sm bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800"
            >
              <ArrowLeft size={18} /> Indietro
            </button>
            <span className="text-xs font-mono font-bold text-brand-blue bg-brand-blue/10 px-2.5 py-1 rounded-lg">
              {sourceFreeLocName || pallet?.pallet_code}
            </span>
          </div>

          <h3 className="text-xl font-black text-brand-white mb-1">Cosa vuoi spostare?</h3>
          <p className="text-xs text-slate-400 mb-3">
            Sposta un singolo articolo (o una parte) oppure tutto il contenuto insieme.
          </p>

          {(() => {
            const uniqueCodes = [...new Set(sourceItems.map(i => i.pallet_code).filter(Boolean))];
            if (uniqueCodes.length === 1) {
              return (
                <button
                  type="button"
                  onClick={() => {
                    setPallet(sourceItems[0]);
                    setMovePlan({
                      mode: 'ALL_PALLET',
                      pallet_code: uniqueCodes[0],
                      label: `TUTTI gli articoli (${sourceItems.length} righe)`
                    });
                    setStatus('SELECT_ZONE');
                    fetchRecommendation(uniqueCodes[0]);
                  }}
                  className="w-full mb-3 py-3.5 px-4 rounded-2xl bg-amber-500 text-brand-black font-black text-sm flex items-center justify-between shadow-lg active:scale-[0.98]"
                >
                  <span>SPOSTA TUTTI GLI ARTICOLI ({sourceItems.length})</span>
                  <span className="text-xs font-mono bg-black/20 px-2 py-0.5 rounded">{uniqueCodes[0]}</span>
                </button>
              );
            }
            return null;
          })()}

          <div className="flex-1 overflow-y-auto space-y-3 pb-4">
            {(() => {
              const udmMap = new Map();
              sourceItems.forEach(item => {
                const code = item.pallet_code || `ROW-${item.id}`;
                if (!udmMap.has(code)) udmMap.set(code, []);
                udmMap.get(code).push(item);
              });
              const udmGroups = Array.from(udmMap.entries());
              const showGroupHeaders = udmGroups.length > 1;

              return udmGroups.map(([udmCode, udmItems]) => (
                <div key={udmCode} className={showGroupHeaders ? 'bg-slate-950/70 border border-slate-800 rounded-2xl p-2.5 space-y-2' : 'space-y-2.5'}>
                  {showGroupHeaders && (
                    <div className="flex items-center justify-between gap-2 px-1">
                      <span className="font-mono text-xs font-black text-brand-blue bg-brand-blue/15 px-2.5 py-1 rounded-lg border border-brand-blue/30">
                        {udmCode}
                      </span>
                      {udmItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            setPallet(udmItems[0]);
                            setMovePlan({
                              mode: 'ALL_PALLET',
                              pallet_code: udmCode,
                              label: `Intera UDM ${udmCode} (${udmItems.length} righe)`
                            });
                            setStatus('SELECT_ZONE');
                            fetchRecommendation(udmCode);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-amber-500 text-brand-black font-black text-[11px] active:scale-95"
                        >
                          Sposta Intera UDM ({udmItems.length})
                        </button>
                      )}
                    </div>
                  )}

                  {udmItems.map(item => (
                    <div key={item.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[11px] font-mono font-bold text-brand-blue">{item.sku || item.pallet_code}</div>
                          <div className="text-sm font-black text-brand-white leading-snug">{item.product_name}</div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            {item.customer_name} {item.batch ? `· Lotto: ${item.batch}` : ''}
                          </div>
                        </div>
                        <span className="text-sm font-black text-emerald-400 shrink-0">
                          {item.quantity} {item.uom || ''}
                        </span>
                      </div>

                      {item.is_quarantined ? (
                        <div className="text-[11px] font-bold text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-1.5">
                          Bloccato in Quarantena
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setPallet(item);
                              setMovePlan({
                                mode: 'SINGLE_ITEM',
                                pallet_id: item.id,
                                pallet_code: item.pallet_code,
                                move_quantity: parseFloat(item.quantity),
                                label: `${item.product_name} (${item.quantity} ${item.uom || ''})`
                              });
                              setStatus('SELECT_ZONE');
                              fetchRecommendation(item.pallet_code);
                            }}
                            className="py-2.5 px-2 rounded-xl bg-brand-blue text-brand-black font-black text-xs active:scale-95"
                          >
                            Sposta Tutto ({item.quantity})
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPartialModalItem(item);
                              setPartialQtyInput(String(Math.min(1, parseFloat(item.quantity) || 1)));
                            }}
                            className="py-2.5 px-2 rounded-xl bg-slate-800 border border-slate-700 text-brand-white font-bold text-xs active:scale-95"
                          >
                            Q.tà Parziale...
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* Modal Quantità Parziale su Zebra */}
      {partialModalItem && (
        <div className="fixed inset-0 z-50 bg-brand-black/95 backdrop-blur-md flex flex-col justify-center p-4 animate-fade-in-up">
          <div className="max-w-sm w-full mx-auto bg-slate-900 border border-brand-blue/50 rounded-3xl p-5 space-y-4 text-left">
            <div>
              <span className="text-[10px] font-black uppercase text-brand-blue">Sposta Quantità Parziale</span>
              <h3 className="text-lg font-black text-brand-white mt-0.5">{partialModalItem.product_name}</h3>
              <p className="text-xs text-slate-400">
                Disponibile in questa riga: <strong className="text-emerald-400">{partialModalItem.quantity} {partialModalItem.uom || ''}</strong>
                {partialModalItem.units_per_box > 1 ? ` (${partialModalItem.units_per_box} pz/scatola)` : ''}
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPartialQtyInput(String(Math.max(0.01, (parseFloat(partialQtyInput) || 0) - 1)))}
                  className="w-12 h-12 rounded-xl bg-slate-800 text-white font-black text-xl"
                >
                  -
                </button>
                <input
                  type="number"
                  min="0.01"
                  max={partialModalItem.quantity}
                  step="any"
                  value={partialQtyInput}
                  onChange={(e) => setPartialQtyInput(e.target.value)}
                  className="flex-1 bg-slate-950 border-2 border-slate-700 rounded-xl p-3 text-center text-2xl font-black text-white"
                />
                <button
                  type="button"
                  onClick={() => setPartialQtyInput(String(Math.min(parseFloat(partialModalItem.quantity), (parseFloat(partialQtyInput) || 0) + 1)))}
                  className="w-12 h-12 rounded-xl bg-slate-800 text-white font-black text-xl"
                >
                  +
                </button>
              </div>
              {parseInt(partialModalItem.units_per_box, 10) > 1 && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPartialQtyInput(String(Math.min(parseFloat(partialModalItem.quantity), (parseFloat(partialQtyInput) || 0) + parseInt(partialModalItem.units_per_box, 10))))}
                    className="flex-1 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold text-xs"
                  >
                    +1 Scatola (+{partialModalItem.units_per_box})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPartialQtyInput(String(partialModalItem.quantity))}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs"
                  >
                    Max ({partialModalItem.quantity})
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPartialModalItem(null)}
                className="py-3 rounded-xl bg-slate-800 text-slate-300 font-bold text-sm"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={() => {
                  const q = parseFloat(partialQtyInput);
                  const maxQ = parseFloat(partialModalItem.quantity) || 0;
                  if (isNaN(q) || q <= 0 || q > maxQ) return;
                  setPallet(partialModalItem);
                  setMovePlan({
                    mode: 'SINGLE_ITEM',
                    pallet_id: partialModalItem.id,
                    pallet_code: partialModalItem.pallet_code,
                    move_quantity: q,
                    label: `${partialModalItem.product_name} (${q}/${maxQ} ${partialModalItem.uom || ''})`
                  });
                  setPartialModalItem(null);
                  setStatus('SELECT_ZONE');
                  fetchRecommendation(partialModalItem.pallet_code);
                }}
                className="py-3 rounded-xl bg-brand-blue text-brand-black font-black text-sm"
              >
                Conferma Q.tà
              </button>
            </div>
          </div>
        </div>
      )}

      {status === 'SELECT_ZONE' && pallet && (
        <div className="w-full max-w-sm animate-fade-in-up text-left flex flex-col h-full py-4">
          <div className="bg-slate-900 border-2 border-brand-blue rounded-3xl p-4 mb-3 shadow-[0_0_30px_rgba(14,165,233,0.2)]">
            <div className="flex items-center justify-between mb-1.5 gap-2">
              <span className="font-mono text-brand-blue font-bold text-xs bg-brand-blue/10 px-2 py-1 rounded">{pallet.pallet_code}</span>
              <span className="text-emerald-400 font-black text-sm text-right">
                {(() => {
                  const q = movePlan?.move_quantity !== undefined ? parseFloat(movePlan.move_quantity) : (parseFloat(pallet.quantity) || 0);
                  const upb = parseInt(pallet.units_per_box, 10) || 1;
                  if (upb > 1 && q >= upb) {
                    const b = Math.floor(q / upb);
                    const rem = q % upb;
                    return `${b} SCAT.${rem > 0 ? ` + ${rem}` : ''} (${q} pz)`;
                  }
                  return `${q || '-'} ${pallet.uom || ''}`;
                })()}
              </span>
            </div>
            <h3 className="text-lg font-bold text-brand-white text-left truncate">
              {movePlan?.mode === 'ALL_PALLET' && sourceItems.length > 1
                ? `TUTTI GLI ARTICOLI (${sourceItems.length})`
                : pallet.product_name}
            </h3>
            <div className="flex items-center justify-between mt-1 text-xs font-mono">
              {pallet.batch && <span className="text-amber-400">Lotto: {pallet.batch}</span>}
              {pallet.location && <span className="text-sky-400">Da: {pallet.location}</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {sourceItems.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setStatus('SELECT_ITEMS')}
                  className="text-[11px] font-black px-2.5 py-1 rounded-lg bg-slate-800 text-amber-300 border border-slate-700"
                >
                  Cambia Articolo / Tutto
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setPartialModalItem(sourceItems[0] || pallet);
                    setPartialQtyInput(String(movePlan?.move_quantity ?? pallet.quantity));
                  }}
                  className="text-[11px] font-black px-2.5 py-1 rounded-lg bg-slate-800 text-amber-300 border border-slate-700"
                >
                  Sposta Q.tà Parziale
                </button>
              )}
            </div>
            {slottingData?.velocity && (
              <div className="mt-2.5 pt-2 border-t border-slate-800 flex items-center justify-between gap-2 text-[11px]">
                <span className="inline-flex items-center gap-1 font-black text-sky-300">
                  <Sparkles size={13} className="text-sky-400" />
                  Rotazione {slottingData.velocity.tier} ({slottingData.velocity.shipCount} sped.)
                </span>
                <span className="font-mono font-black px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">
                  Consiglio: {slottingData.velocity.levelRangeLabel}
                </span>
              </div>
            )}
          </div>
          
          <h3 className="text-xl font-black text-brand-white mb-2">Dove vuoi spostare?</h3>

          <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-900 border border-slate-800 rounded-2xl mb-3">
            <button
              type="button"
              onClick={() => setDestTab('MAPPED')}
              className={`py-2 rounded-xl text-xs font-black transition-colors ${destTab === 'MAPPED' ? 'bg-brand-blue text-brand-black' : 'text-slate-400'}`}
            >
              Scaffali Mappati
            </button>
            <button
              type="button"
              onClick={() => setDestTab('FREE')}
              className={`py-2 rounded-xl text-xs font-black transition-colors ${destTab === 'FREE' ? 'bg-amber-400 text-brand-black' : 'text-slate-400'}`}
            >
              Posizioni Libere ({freeLocations.length})
            </button>
          </div>
          
          <div className="flex gap-2 mb-3">
            <input 
              type="text"
              placeholder={destTab === 'FREE' ? "Cerca posizione libera..." : (requirePins ? "Cerca zona..." : "O scrivi posizione per intero...")}
              className="w-full bg-slate-900 border-2 border-slate-700 p-3 rounded-xl text-base font-bold uppercase focus:border-brand-blue focus:ring-0 text-brand-white"
              value={zoneSearch}
              onChange={(e) => setZoneSearch(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                 if (e.key === 'Enter' && zoneSearch.trim() !== '') {
                    if (!requirePins && zoneSearch.includes('-')) {
                      checkOccupiedAndStow(zoneSearch.trim());
                    }
                 }
              }}
            />
            {!requirePins && destTab === 'MAPPED' && (
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

          <div className="flex-1 overflow-y-auto space-y-2.5 pb-4">
            {destTab === 'MAPPED' ? (
              zones.filter(z => z.toUpperCase().includes(zoneSearch)).map(z => {
                const zStat = (slottingData?.zoneStats || []).find(s => s.zone === z.toUpperCase());
                return (
                  <button 
                    key={z} 
                    onClick={() => {
                      setSelectedZone(z);
                      fetchRecommendation(pallet.pallet_code, z);
                      if (requirePins) {
                        setPinInput('');
                        setStatus('WAITING_PIN');
                      } else {
                        setStatus('SELECT_COL');
                      }
                    }}
                    className="w-full py-3.5 px-5 bg-slate-900 border border-slate-700 rounded-2xl text-left hover:border-brand-blue active:bg-slate-800 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xl font-bold text-brand-white">
                        Zona: <span className="text-brand-blue ml-1">{z}</span>
                      </span>
                      {zStat && (
                        <span className={`text-xs font-black px-2 py-0.5 rounded-lg border ${
                          zStat.freeSlots > 0
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                            : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                        }`}>
                          {zStat.freeSlots}/{zStat.totalSlots} liberi
                        </span>
                      )}
                    </div>
                    {zStat?.hasSameBatch && (
                      <div className="mt-1 text-[11px] font-bold text-amber-300">
                        ★ Stesso lotto già presente ({zStat.sameBatchLocations.map(l => `${l.col}-${l.pos}`).slice(0, 2).join(', ')})
                      </div>
                    )}
                  </button>
                );
              })
            ) : (
              freeLocations
                .filter(fl => fl.name.toUpperCase().includes(zoneSearch))
                .map(fl => (
                  <button
                    key={fl.id}
                    type="button"
                    onClick={() => checkOccupiedAndStow(fl.name.toUpperCase(), '')}
                    className="w-full py-3.5 px-5 bg-slate-900 border border-amber-500/40 rounded-2xl text-left hover:border-amber-400 active:bg-slate-800 transition-colors flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="text-lg font-black text-brand-white">{fl.name}</div>
                      <div className="text-[11px] text-slate-400">Posizione Libera · Nessun PIN richiesto</div>
                    </div>
                    <span className="text-xs font-black px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0">
                      {fl.items_count > 0 ? `${fl.pallets_count || 1} UDM · ${fl.items_count} art.` : 'Vuota'}
                    </span>
                  </button>
                ))
            )}
          </div>
        </div>
      )}

      {status === 'SELECT_COL' && pallet && !requirePins && (
        <div className="w-full max-w-sm animate-fade-in-up text-left flex flex-col h-full py-4">
          <button onClick={() => setStatus('SELECT_ZONE')} className="flex items-center gap-2 text-slate-400 mb-3 active:text-brand-white">
            <ArrowLeft size={20} /> Cambia Zona
          </button>
          <h3 className="text-2xl font-black text-brand-white mb-1">Zona: {selectedZone}</h3>
          <p className="text-slate-400 mb-3 text-sm">Scegli la Colonna (Lettera)</p>

          {slottingData?.recommended && slottingData.recommended.zone === selectedZone?.toUpperCase() && (
            <div className="mb-3 p-3 rounded-2xl bg-sky-500/15 border border-sky-400/50 text-xs">
              <div className="font-black text-sky-300 flex items-center gap-1.5">
                <Sparkles size={14} /> CONSIGLIATA: {slottingData.recommended.barcode} (Piano {slottingData.recommended.level})
              </div>
              {slottingData.recommended.reasons?.[0] && (
                <div className="text-sky-100/80 mt-0.5">{slottingData.recommended.reasons[0]}</div>
              )}
            </div>
          )}
          
          <div className="flex-1 overflow-y-auto grid grid-cols-2 gap-3 pb-4">
            {colsInZone.map(c => {
              const isRecCol = slottingData?.recommended?.zone === selectedZone?.toUpperCase() && slottingData?.recommended?.col === c?.toUpperCase();
              return (
                <button 
                  key={c} 
                  onClick={() => {
                    setSelectedCol(c);
                    setStatus('SELECT_POS');
                  }}
                  className={`py-4 px-2 rounded-2xl text-2xl font-bold text-center active:bg-slate-800 transition-colors flex flex-col items-center justify-center ${
                    isRecCol
                      ? 'bg-sky-500/15 border-2 border-sky-400 text-sky-300 shadow-[0_0_20px_rgba(56,189,248,0.2)]'
                      : 'bg-slate-900 border border-slate-700 text-brand-blue hover:border-brand-blue'
                  }`}
                >
                  <span>{c}</span>
                  {isRecCol && <span className="text-[10px] font-black uppercase tracking-wider text-sky-300 mt-1">★ Consigliata</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {status === 'SELECT_POS' && pallet && !requirePins && (
        <div className="w-full max-w-sm animate-fade-in-up text-left flex flex-col h-full py-2">
          <div className="flex items-center justify-between mb-2">
            <button onClick={() => setStatus('SELECT_COL')} className="flex items-center gap-1.5 text-slate-400 active:text-brand-white font-bold text-sm bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800">
              <ArrowLeft size={18} /> Cambia Colonna
            </button>
            <div className="flex items-center gap-2 text-[11px] font-bold">
              <span className="inline-flex items-center gap-1 text-emerald-400"><span className="w-2 h-2 rounded-full bg-emerald-400"></span>Libera</span>
              <span className="inline-flex items-center gap-1 text-amber-400"><span className="w-2 h-2 rounded-full bg-amber-400"></span>Occupata</span>
            </div>
          </div>

          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-2xl font-black text-brand-white flex items-center gap-2">
              <Layers size={22} className="text-brand-blue" />
              <span>Scaffale {selectedZone}-{selectedCol}</span>
            </h3>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Vista Frontale</span>
          </div>

          {/* Cornice Scaffale Reale (Dall'alto verso il basso) */}
          <div className="flex-1 overflow-y-auto bg-slate-950/80 border-x-4 border-t-2 border-slate-700 rounded-t-2xl p-2.5 space-y-2.5 shadow-inner">
            <div className="text-center text-[10px] font-black uppercase tracking-widest text-sky-400/80 bg-sky-500/10 border border-sky-500/20 rounded-lg py-1">
              ⬆️ Ripiani Alti (Cima Scaffale)
            </div>

            {shelfRows.map((row) => (
              <div
                key={row.level}
                className="bg-slate-900/70 rounded-xl p-2 border-b-4 border-amber-500/70 shadow-md"
              >
                <div className="flex items-center justify-between mb-1.5 px-1">
                  <span className="text-[10px] font-black uppercase tracking-wider text-amber-400">
                    {row.level === 0 ? 'Piano 0 (Terra)' : `Piano ${row.level}`}
                  </span>
                  <span className="text-[10px] font-mono text-slate-500">
                    {row.items.length} {row.items.length === 1 ? 'posizione' : 'posizioni'}
                  </span>
                </div>
                <div
                  className="grid gap-2"
                  style={{
                    gridTemplateColumns: `repeat(${Math.min(Math.max(row.items.length, 1), 4)}, minmax(0, 1fr))`
                  }}
                >
                  {row.items.map((item) => {
                    const fullCode = `${selectedZone}-${selectedCol}-${item.pos}`;
                    const existingPallets = item.pallet_code
                      ? item.pallet_code.split(',').map(s => s.trim()).filter(Boolean)
                      : [];
                    const isCurrentPalletHere = existingPallets.includes(pallet.pallet_code) || pallet.location === fullCode;
                    const isOccupiedByOther = existingPallets.some(code => code !== pallet.pallet_code);
                    const isRecommendedSlot = slottingData?.recommended?.barcode === fullCode.toUpperCase();
                    const isAlternativeSlot = !isRecommendedSlot && (slottingData?.alternatives || []).some(a => a.barcode === fullCode.toUpperCase());

                    return (
                      <button
                        key={item.pos}
                        onClick={() => checkOccupiedAndStow(fullCode)}
                        className={`py-3 px-1.5 rounded-xl border-2 flex flex-col items-center justify-center transition-all active:scale-95 ${
                          isCurrentPalletHere
                            ? 'bg-sky-500/20 border-sky-400 text-sky-300'
                            : isRecommendedSlot
                              ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 shadow-[0_0_20px_rgba(34,211,238,0.35)] ring-2 ring-cyan-400/50'
                              : isAlternativeSlot
                                ? 'bg-emerald-500/15 border-emerald-400 text-emerald-300'
                                : isOccupiedByOther
                                  ? 'bg-amber-500/15 border-amber-500/60 text-amber-300 hover:border-amber-400'
                                  : 'bg-slate-950 border-emerald-500/50 text-emerald-400 hover:border-emerald-400 active:bg-slate-800'
                        }`}
                      >
                        <span className="text-2xl font-black leading-none tracking-tight">{item.pos}</span>
                        <span className={`text-[9px] font-black uppercase mt-1 px-1.5 py-0.5 rounded ${
                          isCurrentPalletHere
                            ? 'bg-sky-500/30 text-sky-200'
                            : isRecommendedSlot
                              ? 'bg-cyan-400 text-brand-black'
                              : isOccupiedByOther
                                ? 'bg-amber-500/25 text-amber-300'
                                : 'bg-emerald-500/15 text-emerald-400'
                        }`}>
                          {isCurrentPalletHere ? 'QUI' : isRecommendedSlot ? '★ TOP' : isOccupiedByOther ? 'OCC.' : 'LIBERA'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="text-center text-[10px] font-black uppercase tracking-widest text-emerald-400/90 bg-emerald-500/10 border border-emerald-500/20 rounded-lg py-1.5">
              ⬇️ Pavimento / Terra (Piano 0)
            </div>
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
            <p className="text-4xl font-black text-brand-white mb-3">{selectedZone}</p>

            {slottingData?.recommended && slottingData.recommended.zone === selectedZone?.toUpperCase() ? (
              <div className="w-full mb-4 bg-sky-500/15 border-2 border-sky-400/60 rounded-2xl p-3 text-left shadow-[0_0_20px_rgba(56,189,248,0.18)]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-black uppercase tracking-wider text-sky-300 flex items-center gap-1">
                    <Sparkles size={13} /> Posizione Consigliata
                  </span>
                  <span className="text-[10px] font-black px-2 py-0.5 rounded bg-sky-500/20 text-sky-200">
                    Piano {slottingData.recommended.level} ({slottingData.velocity?.levelRangeLabel})
                  </span>
                </div>
                <div className="text-2xl font-mono font-black text-white mt-0.5">{slottingData.recommended.barcode}</div>
                {slottingData.recommended.reasons?.length > 0 && (
                  <div className="text-[11px] text-sky-100/85 mt-1 leading-snug">
                    {slottingData.recommended.reasons.join(' · ')}
                  </div>
                )}
                {slottingData.alternatives?.length > 1 && (
                  <div className="text-[10px] text-slate-300 mt-1.5 pt-1.5 border-t border-sky-500/25">
                    Alternative: <span className="font-mono font-bold text-slate-100">{slottingData.alternatives.slice(1, 3).map(a => a.barcode).join(', ')}</span>
                  </div>
                )}
              </div>
            ) : slottingData?.zoneInfo?.freeSlots === 0 && (
              <div className="w-full mb-4 bg-amber-500/15 border border-amber-500/40 rounded-2xl p-2.5 text-xs font-bold text-amber-300">
                Zona {selectedZone} attualmente piena: scegli una posizione da unire o cambia zona.
              </div>
            )}
            
            <p className="text-slate-400 text-sm mb-3">Leggi e digita il PIN esatto dello scaffale:</p>
            
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
