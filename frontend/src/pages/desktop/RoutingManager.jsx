import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Route, Save, GripVertical, Plus, Trash2, ArrowLeft } from 'lucide-react';
import { appAlert } from '../../utils/alerts';
import { useNavigate } from 'react-router-dom';

const RoutingManager = () => {
  const [zones, setZones] = useState([]);
  const [posPatterns, setPosPatterns] = useState([]);
  const [newPattern, setNewPattern] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const navigate = useNavigate();
  const token = localStorage.getItem('maglite_token');

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

    } catch (err) {
      console.error(err);
      appAlert('Errore nel caricamento delle priorità');
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await axios.post(`http://${window.location.hostname}:3000/api/settings`, {
        zone_routing_priority: JSON.stringify(zones),
        position_routing_priority: JSON.stringify(posPatterns)
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
    </div>
  );
};

export default RoutingManager;
