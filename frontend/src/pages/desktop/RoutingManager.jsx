import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Route, Save, GripVertical, Plus, Trash2, ArrowLeft } from 'lucide-react';
import { appAlert } from '../../utils/alerts';
import { hasPerm } from '../../utils/permissions';
import { useNavigate } from 'react-router-dom';

const RoutingManager = () => {
  const [zones, setZones] = useState([]);
  const [posPatterns, setPosPatterns] = useState([]);
  const [newPattern, setNewPattern] = useState('');
  const [exactFirst, setExactFirst] = useState(true);
  const [fallbackMode, setFallbackMode] = useState('LESS_FULL');
  const [isSaving, setIsSaving] = useState(false);
  const navigate = useNavigate();
  const token = localStorage.getItem('maglite_token');
  const canManageRouting = hasPerm(['settings_manage', 'pallet_move']);

  useEffect(() => {
    fetchSettingsAndZones();
  }, []);

  const fetchSettingsAndZones = async () => {
    try {
      // Fetch distinct zones & free locations
      const locRes = await axios.get(`http://${window.location.hostname}:3000/api/locations/routing-zones`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const uniqueZones = locRes.data;

      // Fetch saved settings
      const setRes = await axios.get(`http://${window.location.hostname}:3000/api/settings`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const savedZones = setRes.data.zone_routing_priority ? JSON.parse(setRes.data.zone_routing_priority) : [];
      const savedPos = setRes.data.position_routing_priority ? JSON.parse(setRes.data.position_routing_priority) : ['01,02,03', '11,12,13', '21,22,23'];

      // Merge saved zones with any new zones that might have been created
      const mergedZones = [...savedZones];
      uniqueZones.forEach(z => {
        if (!mergedZones.includes(z)) mergedZones.push(z);
      });

      // Remove zones that no longer exist (optional, but let's keep them in case they are re-added)
      setZones(mergedZones);
      setPosPatterns(savedPos);
      if (setRes.data.allocation_exact_first !== undefined && setRes.data.allocation_exact_first !== null) {
        setExactFirst(String(setRes.data.allocation_exact_first).toLowerCase() !== 'false' && setRes.data.allocation_exact_first !== '0');
      }
      if (setRes.data.allocation_fallback_mode) {
        setFallbackMode(String(setRes.data.allocation_fallback_mode).toUpperCase() === 'LOWEST_SHELF' ? 'LOWEST_SHELF' : 'LESS_FULL');
      }

    } catch (err) {
      console.error(err);
      appAlert('Errore nel caricamento delle priorità');
    }
  };

  const handleSave = async () => {
    if (!canManageRouting) return appAlert('Non hai i permessi per modificare le regole di instradamento.');
    setIsSaving(true);
    try {
      await axios.post(`http://${window.location.hostname}:3000/api/settings`, {
        zone_routing_priority: JSON.stringify(zones),
        position_routing_priority: JSON.stringify(posPatterns),
        allocation_exact_first: exactFirst ? 'true' : 'false',
        allocation_fallback_mode: fallbackMode
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      appAlert('Regole di instradamento salvate con successo!', 'Salvato', 'success');
    } catch (err) {
      appAlert('Errore durante il salvataggio');
    } finally {
      setIsSaving(false);
    }
  };

  const addPattern = () => {
    if (newPattern.trim()) {
      setPosPatterns([...posPatterns, newPattern.trim()]);
      setNewPattern('');
    }
  };

  const removePattern = (index) => {
    const newP = [...posPatterns];
    newP.splice(index, 1);
    setPosPatterns(newP);
  };

  // Drag & Drop logic for Zones
  const [draggedZoneIdx, setDraggedZoneIdx] = useState(null);

  const handleZoneDragStart = (e, index) => {
    setDraggedZoneIdx(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleZoneDragOver = (e, index) => {
    e.preventDefault();
    if (draggedZoneIdx === null || draggedZoneIdx === index) return;
    
    const newZones = [...zones];
    const draggedItem = newZones[draggedZoneIdx];
    newZones.splice(draggedZoneIdx, 1);
    newZones.splice(index, 0, draggedItem);
    
    setDraggedZoneIdx(index);
    setZones(newZones);
  };

  const handleZoneDragEnd = () => {
    setDraggedZoneIdx(null);
  };

  // Drag & Drop logic for Positions
  const [draggedPosIdx, setDraggedPosIdx] = useState(null);

  const handlePosDragStart = (e, index) => {
    setDraggedPosIdx(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handlePosDragOver = (e, index) => {
    e.preventDefault();
    if (draggedPosIdx === null || draggedPosIdx === index) return;
    
    const newPos = [...posPatterns];
    const draggedItem = newPos[draggedPosIdx];
    newPos.splice(draggedPosIdx, 1);
    newPos.splice(index, 0, draggedItem);
    
    setDraggedPosIdx(index);
    setPosPatterns(newPos);
  };

  const handlePosDragEnd = () => {
    setDraggedPosIdx(null);
  };

  return (
    <div className="p-8 pb-32 min-h-screen bg-brand-black text-brand-white">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-3 bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors">
            <ArrowLeft size={24} />
          </button>
          <div>
            <h1 className="text-4xl font-black flex items-center gap-3">
              <Route className="text-brand-blue" size={40} />
              Regole di Prelievo
            </h1>
            <p className="text-slate-400 mt-2">Trascina le zone e i piani per stabilire l'ordine guida sul terminale Zebra.</p>
          </div>
        </div>
        <button 
          onClick={handleSave} 
          disabled={isSaving}
          className="bg-brand-blue hover:bg-sky-400 text-brand-black font-bold py-3 px-6 rounded-xl flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(14,165,233,0.3)] disabled:opacity-50"
        >
          <Save size={20} /> {isSaving ? 'Salvataggio...' : 'Salva Regole'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* ZONES */}
        <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
          <h2 className="text-xl font-bold text-brand-white mb-4">1. Priorità Zone (Drag & Drop)</h2>
          <p className="text-sm text-slate-400 mb-6">L'ordine in cui Zebra ti farà visitare le zone. La zona in alto verrà visitata per prima.</p>
          
          <div className="flex flex-col gap-2">
            {zones.map((zone, index) => (
              <div 
                key={zone}
                draggable
                onDragStart={(e) => handleZoneDragStart(e, index)}
                onDragOver={(e) => handleZoneDragOver(e, index)}
                onDragEnd={handleZoneDragEnd}
                className={`bg-slate-950 border border-slate-700 p-4 rounded-xl flex items-center gap-4 cursor-grab active:cursor-grabbing transition-colors ${draggedZoneIdx === index ? 'opacity-50' : 'hover:border-brand-blue'}`}
              >
                <GripVertical size={20} className="text-slate-500" />
                <span className="font-bold text-lg">{zone}</span>
              </div>
            ))}
          </div>
        </div>

        {/* POSITIONS */}
        <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
          <h2 className="text-xl font-bold text-brand-white mb-4">2. Priorità Piani / Posizioni (Drag & Drop)</h2>
          <p className="text-sm text-slate-400 mb-6">Specifica l'ordine di svuotamento dei piani a parità di zona o lotto (es: preleva prima dal piano terra 01-02-03, poi piano 1, ecc).</p>
          
          <div className="flex flex-col gap-2 mb-6">
            {posPatterns.map((pos, index) => (
              <div 
                key={pos}
                draggable
                onDragStart={(e) => handlePosDragStart(e, index)}
                onDragOver={(e) => handlePosDragOver(e, index)}
                onDragEnd={handlePosDragEnd}
                className={`bg-slate-950 border border-slate-700 p-4 rounded-xl flex items-center justify-between cursor-grab active:cursor-grabbing transition-colors ${draggedPosIdx === index ? 'opacity-50' : 'hover:border-brand-blue'}`}
              >
                <div className="flex items-center gap-4">
                  <GripVertical size={20} className="text-slate-500" />
                  <span className="font-bold text-lg">{pos}</span>
                </div>
                <button onClick={() => removePattern(index)} className="text-rose-500 hover:text-rose-400 p-2"><Trash2 size={18}/></button>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <input 
              type="text" 
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              placeholder="Es: 31,32,33"
              className="flex-1 bg-slate-950 border border-slate-800 text-brand-white rounded-xl py-3 px-4 focus:ring-brand-blue"
              onKeyDown={(e) => e.key === 'Enter' && addPattern()}
            />
            <button onClick={addPattern} className="bg-slate-800 hover:bg-slate-700 text-brand-white px-4 rounded-xl font-bold transition-colors">
              <Plus size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* ALLOCATION STRATEGY */}
      <div className="mt-8 bg-slate-900 p-6 rounded-2xl border border-slate-800 space-y-5">
        <div>
          <h2 className="text-xl font-bold text-brand-white">3. Strategia Intelligente Scelta Bancali</h2>
          <p className="text-sm text-slate-400 mt-1">
            Stabilisce quale bancale viene assegnato automaticamente per primo a parità di scadenza FEFO.
          </p>
        </div>

        <label className="flex items-start gap-3 p-4 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer hover:border-brand-blue transition-colors">
          <input
            type="checkbox"
            checked={exactFirst}
            onChange={(e) => setExactFirst(e.target.checked)}
            className="mt-1 w-5 h-5 rounded border-slate-600 bg-slate-900 text-brand-blue cursor-pointer"
          />
          <div>
            <div className="font-bold text-brand-white">
              Priorità al bancale finito/chiuso (quantità esatta), anche se in alto
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Es: la spedizione richiede 50 pz e hai 50 pz su un bancale in alto e 10 pz in basso → indirizza subito sul bancale da 50 per svuotarlo completamente in un solo prelievo.
            </div>
          </div>
        </label>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
            Quando non c&apos;è un bancale esatto, scegli prima:
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setFallbackMode('LESS_FULL')}
              className={`p-4 rounded-xl border text-left transition-all ${
                fallbackMode === 'LESS_FULL'
                  ? 'bg-brand-blue/15 border-brand-blue text-white'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="font-bold text-sm text-brand-white">Bancale meno pieno (libera spazio)</div>
              <div className="text-xs text-slate-400 mt-1">
                Dà priorità alle palette con meno quantità residua per liberare prima le ubicazioni, poi per piano più comodo.
              </div>
            </button>
            <button
              type="button"
              onClick={() => setFallbackMode('LOWEST_SHELF')}
              className={`p-4 rounded-xl border text-left transition-all ${
                fallbackMode === 'LOWEST_SHELF'
                  ? 'bg-brand-blue/15 border-brand-blue text-white'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="font-bold text-sm text-brand-white">Posizione più comoda (piano più basso)</div>
              <div className="text-xs text-slate-400 mt-1">
                Dà priorità al livello terra / piano più basso definito al punto 2 e al percorso tra zone.
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RoutingManager;
