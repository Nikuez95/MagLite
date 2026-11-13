import { appAlert, appConfirm, appPrompt } from "../../utils/alerts.js";
import { hasPerm } from "../../utils/permissions.js";
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Map, RefreshCw, Layers, Search, Trash2, Eye, Info, ChevronDown, ChevronRight, Printer, LayoutGrid, List, CheckCircle2, Package, Plus } from 'lucide-react';
import { io } from 'socket.io-client';
import { jwtDecode } from 'jwt-decode';

const Locations = () => {
  const [locations, setLocations] = useState([]);
  const [freeLocations, setFreeLocations] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState('mapped');
  const [requirePins, setRequirePins] = useState(true); // 'mapped' or 'free'
  const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL' | 'OCCUPIED' | 'FREE'
  const [viewMode, setViewMode] = useState('GRID'); // 'GRID' | 'LIST'
  const [bulkMode, setBulkMode] = useState('STANDARD'); // STANDARD, TERRA, CUSTOM
  const [bulkForm, setBulkForm] = useState({
    zone: 'CELLA2',
    rack: 'A',
    cols: 4,       // Lunghezza (quante colonne)
    levels: 3,     // Piani (quanti livelli in altezza)
    custom: '01, 11, 21' // Usato in CUSTOM
  });
  
  const [searchTerm, setSearchTerm] = useState('');
  const [viewPallet, setViewPallet] = useState(null); // per il modal con i dettagli
  
  const getToken = () => localStorage.getItem('maglite_token');
  const getUserRole = () => {
    try {
      return jwtDecode(getToken()).role;
    } catch {
      return null;
    }
  };
  const role = getUserRole();
  const canManageLocations = hasPerm(['pallet_move', 'settings_manage']);
  const canDeleteLocations = hasPerm(['pallet_delete', 'settings_manage']);

  const fetchLocations = async () => {
    try {
      const [resLoc, resFree, resSettings] = await Promise.all([
        axios.get(`http://${window.location.hostname}:3000/api/locations`, { headers: { Authorization: `Bearer ${getToken()}` } }),
        axios.get(`http://${window.location.hostname}:3000/api/locations/free`, { headers: { Authorization: `Bearer ${getToken()}` } }),
        axios.get(`http://${window.location.hostname}:3000/api/settings`, { headers: { Authorization: `Bearer ${getToken()}` } })
      ]);
      setLocations(resLoc.data);
      setFreeLocations(resFree.data);
      if (resSettings.data && resSettings.data.require_location_pins !== undefined) {
        setRequirePins(resSettings.data.require_location_pins === 'true');
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchLocations();

    const socket = io(`http://${window.location.hostname}:3000`);
    const handleRefresh = () => fetchLocations();
    socket.on('stow_updated', handleRefresh);
    socket.on('locations_updated', handleRefresh);
    socket.on('inventory_updated', handleRefresh);

    return () => {
      socket.off('stow_updated', handleRefresh);
      socket.off('locations_updated', handleRefresh);
      socket.off('inventory_updated', handleRefresh);
      socket.disconnect();
    };
  }, []);

  const togglePins = async () => {
    if (!canManageLocations) return appAlert('Non hai i permessi per modificare le impostazioni PIN.');
    const newValue = !requirePins;
    try {
      await axios.post(`http://${window.location.hostname}:3000/api/settings`, { require_location_pins: newValue.toString() }, { headers: { Authorization: `Bearer ${getToken()}` } });
      setRequirePins(newValue);
      appAlert(`Richiesta PIN ${newValue ? 'attivata' : 'disattivata'} con successo!`, 'Successo', 'success');
    } catch (err) {
      appAlert('Errore nel salvataggio impostazioni');
    }
  };

  const handleBulkGenerate = async (e) => {
    e.preventDefault();
    if (!canManageLocations) return appAlert('Non hai i permessi per generare scaffalature.');
    if (isProcessing) return;
    setIsProcessing(true);

    try {
      let levelsArray = [];
      
      if (bulkMode === 'STANDARD') {
        // Genera 01, 02, 03... 11, 12, 13...
        for (let piano = 0; piano < bulkForm.levels; piano++) {
          for (let colonna = 1; colonna <= bulkForm.cols; colonna++) {
            levelsArray.push(`${piano}${colonna}`);
          }
        }
      } else if (bulkMode === 'TERRA') {
        // Logicamente identico, le cataste sono come scaffali invisibili
        for (let colonna = 1; colonna <= bulkForm.cols; colonna++) {
          for (let piano = 0; piano < bulkForm.levels; piano++) {
            levelsArray.push(`${piano}${colonna}`);
          }
        }
      } else {
        // Custom
        levelsArray = bulkForm.custom.split(',').map(s => s.trim()).filter(s => s);
      }
      
      const res = await axios.post(`http://${window.location.hostname}:3000/api/locations/bulk`, {
        zone: bulkForm.zone,
        rack: bulkForm.rack,
        levels: levelsArray
      }, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });

      appAlert(res.data.message);
      fetchLocations();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante la generazione');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async (id) => {
    if (isProcessing) return;
    if (!await appConfirm("Sicuro di voler eliminare questa postazione?")) return;
    setIsProcessing(true);
    try {
      await axios.delete(`http://${window.location.hostname}:3000/api/locations/${id}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      fetchLocations();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore eliminazione');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteZone = async (zoneName) => {
    if (isProcessing) return;
    if (!await appConfirm(`Sicuro di voler eliminare interamente la zona "${zoneName}"? L'operazione non è reversibile.`)) return;
    setIsProcessing(true);
    try {
      await axios.delete(`http://${window.location.hostname}:3000/api/locations/zone/${zoneName}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      fetchLocations();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore eliminazione zona');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddFreeLocation = async () => {
    if (isProcessing) return;
    const name = await appPrompt("Nome della posizione libera (es. CELLA 2, SCAFFALE ESTERNO):");
    if (!name) return;
    setIsProcessing(true);
    try {
      await axios.post(`http://${window.location.hostname}:3000/api/locations/free`, { name }, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      fetchLocations();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore creazione posizione libera');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteFreeLocation = async (id) => {
    if (isProcessing) return;
    if (!await appConfirm("Eliminare questa posizione libera?")) return;
    setIsProcessing(true);
    try {
      await axios.delete(`http://${window.location.hostname}:3000/api/locations/free/${id}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      fetchLocations();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore eliminazione');
    } finally {
      setIsProcessing(false);
    }
  };

  const [expandedZones, setExpandedZones] = useState({});

  const totalLocs = locations.length;
  const occupiedLocs = locations.filter(l => !!l.pallet_code).length;
  const freeLocs = totalLocs - occupiedLocs;
  const occupancyPct = totalLocs > 0 ? Math.round((occupiedLocs / totalLocs) * 100) : 0;
  const allZonesList = [...new Set(locations.map(l => l.zone))];

  const filteredLocations = locations.filter(l => {
    const matchesSearch =
      l.barcode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.zone.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (l.pallet_code && l.pallet_code.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (l.product_name && l.product_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (l.customer_name && l.customer_name.toLowerCase().includes(searchTerm.toLowerCase()));
    if (!matchesSearch) return false;
    if (statusFilter === 'OCCUPIED') return !!l.pallet_code;
    if (statusFilter === 'FREE') return !l.pallet_code;
    return true;
  });

  const groupedLocations = filteredLocations.reduce((acc, loc) => {
    if (!acc[loc.zone]) acc[loc.zone] = [];
    acc[loc.zone].push(loc);
    return acc;
  }, {});

  const toggleZone = (zone) => {
    setExpandedZones(prev => ({
      ...prev,
      [zone]: !prev[zone]
    }));
  };

  const setAllZonesExpanded = (expand) => {
    const next = {};
    allZonesList.forEach(z => { next[z] = expand; });
    setExpandedZones(next);
  };

  return (
    <div className="flex-1 p-6 md:p-8 overflow-y-auto bg-brand-black min-h-screen">
      <div className="max-w-7xl mx-auto animate-fade-in-up space-y-6">
        
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-3xl font-black text-brand-white mb-1 flex items-center gap-3">
              <Map className="text-brand-blue" size={32} />
              Mappa Magazzino
            </h1>
            <p className="text-slate-400 text-sm">Gestisci corsie, occupazione visiva in tempo reale, PIN di sicurezza Zebra e aree libere.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center cursor-pointer gap-2 bg-slate-900 border border-slate-800 px-4 py-2.5 rounded-xl transition-all hover:border-brand-blue">
              <span className="text-xs font-bold text-slate-300">PIN Scaffale (Zebra)</span>
              <div className="relative">
                <input type="checkbox" className="sr-only" checked={requirePins} onChange={togglePins} />
                <div className={`block w-10 h-6 rounded-full transition-colors ${requirePins ? 'bg-brand-blue' : 'bg-slate-700'}`}></div>
                <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${requirePins ? 'transform translate-x-4' : ''}`}></div>
              </div>
            </label>
            <div className="flex gap-1.5 p-1 bg-slate-900 border border-slate-800 rounded-xl">
              <button
                onClick={() => setActiveTab('mapped')}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${activeTab === 'mapped' ? 'bg-brand-blue text-brand-black' : 'text-slate-400 hover:text-white'}`}
              >
                Postazioni Mappate ({totalLocs})
              </button>
              <button
                onClick={() => setActiveTab('free')}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${activeTab === 'free' ? 'bg-brand-blue text-brand-black' : 'text-slate-400 hover:text-white'}`}
              >
                Posizioni Libere ({freeLocations.length})
              </button>
            </div>
          </div>
        </div>

        {/* KPI Magazzino */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">Postazioni Mappate</div>
            <div className="text-2xl font-black text-brand-white">{totalLocs}</div>
            <div className="text-xs text-slate-500 mt-0.5">{allZonesList.length} zone attive</div>
          </div>
          <div className="bg-slate-900/90 border border-sky-500/20 rounded-2xl p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-sky-400 mb-1">Occupate</div>
            <div className="text-2xl font-black text-sky-400">{occupiedLocs}</div>
            <div className="text-xs text-slate-500 mt-0.5">Clicca per ispezionare</div>
          </div>
          <div className="bg-slate-900/90 border border-emerald-500/20 rounded-2xl p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 mb-1">Libere</div>
            <div className="text-2xl font-black text-emerald-400">{freeLocs}</div>
            <div className="text-xs text-slate-500 mt-0.5">Pronte per stivaggio</div>
          </div>
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">Saturazione</div>
            <div className="text-2xl font-black text-brand-white">{occupancyPct}%</div>
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden mt-2">
              <div className={`h-full rounded-full ${occupancyPct > 85 ? 'bg-rose-500' : occupancyPct > 60 ? 'bg-amber-400' : 'bg-sky-500'}`} style={{ width: `${occupancyPct}%` }} />
            </div>
          </div>
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 col-span-2 md:col-span-1">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">Aree Libere (Terra)</div>
            <div className="text-2xl font-black text-brand-blue">{freeLocations.length}</div>
            <div className="text-xs text-slate-500 mt-0.5">Zone senza griglia</div>
          </div>
        </div>

        {activeTab === 'mapped' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Colonna Sinistra: Generatore Massivo */}
          <div className="lg:col-span-1">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl sticky top-8">
              <h2 className="text-xl font-bold text-brand-white mb-6 flex items-center gap-2">
                <Layers className="text-brand-blue" size={24} />
                Generatore Corsie
              </h2>
              <form onSubmit={handleBulkGenerate} className="space-y-5">
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Modello Stivaggio</label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setBulkMode('STANDARD')} className={`flex-1 p-2 rounded-xl border text-xs font-bold transition-all ${bulkMode === 'STANDARD' ? 'bg-brand-blue border-brand-blue text-brand-black' : 'bg-slate-950 border-slate-800 text-slate-500'}`}>Scaffale Std</button>
                    <button type="button" onClick={() => setBulkMode('TERRA')} className={`flex-1 p-2 rounded-xl border text-xs font-bold transition-all ${bulkMode === 'TERRA' ? 'bg-brand-blue border-brand-blue text-brand-black' : 'bg-slate-950 border-slate-800 text-slate-500'}`}>A Terra</button>
                    <button type="button" onClick={() => setBulkMode('CUSTOM')} className={`flex-1 p-2 rounded-xl border text-xs font-bold transition-all ${bulkMode === 'CUSTOM' ? 'bg-brand-blue border-brand-blue text-brand-black' : 'bg-slate-950 border-slate-800 text-slate-500'}`}>Manuale</button>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Nome Zona / Stanza</label>
                  <input required value={bulkForm.zone} onChange={e => setBulkForm({...bulkForm, zone: e.target.value.toUpperCase()})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 focus:ring-brand-blue font-bold uppercase text-center text-xl" placeholder="CELLA2" maxLength={10} />
                </div>

                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Nome Scaffale / Corsia</label>
                  <input required value={bulkForm.rack} onChange={e => setBulkForm({...bulkForm, rack: e.target.value.toUpperCase()})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 focus:ring-brand-blue font-bold uppercase text-center text-xl" placeholder="A" maxLength={10} />
                </div>
                
                {bulkMode !== 'CUSTOM' && (
                  <>
                    <div>
                      <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">{bulkMode === 'TERRA' ? 'Numero di Cataste' : 'Lunghezza (Quante colonne?)'}</label>
                      <input required type="number" min="1" max="100" value={bulkForm.cols} onChange={e => setBulkForm({...bulkForm, cols: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 focus:ring-brand-blue text-center text-xl" />
                    </div>
                    <div>
                      <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">{bulkMode === 'TERRA' ? 'Altezza Massima' : 'Livelli (Quanti ripiani in altezza?)'}</label>
                      <input required type="number" min="1" max="10" value={bulkForm.levels} onChange={e => setBulkForm({...bulkForm, levels: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 focus:ring-brand-blue text-center text-xl" />
                      <p className="text-xs text-slate-500 mt-2">Creerà posizioni es. 01,02,03 (Piano 0) e 11,12,13 (Piano 1).</p>
                    </div>
                  </>
                )}

                {bulkMode === 'CUSTOM' && (
                  <div>
                    <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Posizioni libere (separate da virgola)</label>
                    <input required value={bulkForm.custom} onChange={e => setBulkForm({...bulkForm, custom: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 focus:ring-brand-blue text-center font-mono" placeholder="01, 11, 21, 31" />
                  </div>
                )}
                <button type="submit" disabled={isProcessing} className="w-full py-4 mt-4 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-2xl font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  <RefreshCw size={20} className={isProcessing ? "animate-spin" : ""} />
                  Genera Scaffalatura
                </button>
              </form>
            </div>
          </div>

          {/* Colonna Destra: Mappa / Elenco Scaffali */}
          <div className="lg:col-span-2">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
              <div className="p-4 border-b border-slate-800 bg-slate-950/60 space-y-3">
                <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                    <input 
                      type="text" 
                      placeholder="Cerca scaffale, zona, barcode paletta, prodotto o cliente..." 
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl pl-10 pr-3 py-2 text-sm focus:ring-brand-blue"
                    />
                  </div>
                  <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 p-1 rounded-xl shrink-0">
                    <button
                      type="button"
                      onClick={() => setViewMode('GRID')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${viewMode === 'GRID' ? 'bg-brand-blue text-brand-black' : 'text-slate-400 hover:text-white'}`}
                    >
                      <LayoutGrid size={14} /> Griglia
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('LIST')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${viewMode === 'LIST' ? 'bg-brand-blue text-brand-black' : 'text-slate-400 hover:text-white'}`}
                    >
                      <List size={14} /> Tabella
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {[
                      { id: 'ALL', label: `Tutte (${totalLocs})` },
                      { id: 'OCCUPIED', label: `Occupate (${occupiedLocs})` },
                      { id: 'FREE', label: `Libere (${freeLocs})` },
                    ].map(f => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setStatusFilter(f.id)}
                        className={`px-3 py-1 rounded-lg text-xs font-bold border transition-colors ${statusFilter === f.id
                          ? 'bg-sky-500/20 border-sky-500/50 text-sky-300'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <button type="button" onClick={() => setAllZonesExpanded(true)} className="text-sky-400 hover:text-sky-300 font-bold">Espandi tutte</button>
                    <span className="text-slate-700">|</span>
                    <button type="button" onClick={() => setAllZonesExpanded(false)} className="text-slate-400 hover:text-slate-200 font-bold">Comprimi</button>
                  </div>
                </div>
              </div>

              <div className="max-h-[680px] overflow-y-auto p-3 space-y-3">
                {filteredLocations.length === 0 ? (
                  <div className="p-12 text-center text-slate-500 italic font-medium">Nessuno scaffale trovato con i filtri selezionati.</div>
                ) : (
                  Object.entries(groupedLocations).sort(([zoneA], [zoneB]) => zoneA.localeCompare(zoneB)).map(([zoneName, zoneLocations]) => {
                    const isExpanded = expandedZones[zoneName] || searchTerm.trim().length > 0 || statusFilter !== 'ALL';
                    const totalOccupied = zoneLocations.filter(l => l.pallet_code).length;
                    const zonePct = zoneLocations.length > 0 ? Math.round((totalOccupied / zoneLocations.length) * 100) : 0;
                    return (
                      <div key={zoneName} className="bg-slate-950/60 border border-slate-800 rounded-2xl overflow-hidden">
                        {/* Header Zona */}
                        <div
                          onClick={() => toggleZone(zoneName)}
                          className="p-3.5 bg-slate-900/90 hover:bg-slate-800/80 cursor-pointer transition-colors flex flex-wrap items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-2.5">
                            {isExpanded ? <ChevronDown size={18} className="text-brand-blue" /> : <ChevronRight size={18} className="text-slate-400" />}
                            <span className="font-black text-base text-brand-white">Zona {zoneName}</span>
                            <span className="bg-slate-950 text-slate-300 px-2 py-0.5 rounded-lg text-xs border border-slate-800 font-bold">
                              {zoneLocations.length} pos.
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs font-bold">
                            <span className="text-sky-400 bg-sky-500/10 border border-sky-500/20 px-2.5 py-0.5 rounded-full">{totalOccupied} occ. ({zonePct}%)</span>
                            <span className="text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full">{zoneLocations.length - totalOccupied} lib.</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(`http://${window.location.hostname}:3000/api/locations/zone/${encodeURIComponent(zoneName)}/print?token=${getToken()}`, '_blank');
                              }}
                              className="p-1.5 bg-sky-500/10 text-sky-400 hover:bg-sky-500 hover:text-brand-black rounded-lg transition-colors"
                              title="Stampa PIN Zona in A4"
                            >
                              <Printer size={15} />
                            </button>
                            {canDeleteLocations && totalOccupied === 0 && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteZone(zoneName); }}
                                disabled={isProcessing}
                                className="p-1.5 bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white rounded-lg transition-colors disabled:opacity-40"
                                title="Elimina intera zona"
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                        </div>

                        {isExpanded && (
                          viewMode === 'GRID' ? (
                            <div className="p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                              {zoneLocations.map(loc => {
                                const isOccupied = !!loc.pallet_code;
                                return (
                                  <div
                                    key={loc.id}
                                    onClick={() => isOccupied && setViewPallet(loc)}
                                    className={`rounded-xl p-3 border transition-all flex flex-col justify-between gap-2 ${isOccupied
                                      ? 'bg-sky-500/10 border-sky-500/40 hover:border-sky-400 cursor-pointer hover:bg-sky-500/15'
                                      : 'bg-emerald-500/5 border-emerald-500/20 hover:border-emerald-500/40'
                                    }`}
                                  >
                                    <div className="flex items-start justify-between gap-1">
                                      <span className="font-mono font-black text-sm text-brand-white">{loc.barcode}</span>
                                      <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/30" title="PIN Sicurezza">
                                        {loc.pin}
                                      </span>
                                    </div>
                                    {isOccupied ? (
                                      <div className="space-y-0.5">
                                        <div className="text-[11px] font-mono font-bold text-sky-300 truncate">{loc.pallet_code}</div>
                                        <div className="text-xs font-semibold text-slate-200 truncate" title={loc.product_name}>{loc.product_name}</div>
                                        <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                                          <span className="truncate max-w-[90px]">{loc.customer_name}</span>
                                          <span className="font-black text-brand-white">x{loc.quantity}</span>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="flex items-center justify-between pt-1">
                                        <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1"><CheckCircle2 size={12} /> Libera</span>
                                        {canDeleteLocations && (
                                          <button
                                            onClick={(e) => { e.stopPropagation(); handleDelete(loc.id); }}
                                            disabled={isProcessing}
                                            className="p-1 text-rose-400/70 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors"
                                            title="Elimina Posizione"
                                          >
                                            <Trash2 size={13} />
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <table className="w-full text-left border-collapse">
                              <thead>
                                <tr className="border-y border-slate-800 text-slate-400 bg-slate-950/80 text-[11px] uppercase">
                                  <th className="px-3 py-2 font-semibold">Barcode Scaffale</th>
                                  <th className="px-3 py-2 font-semibold text-center">Col / Liv</th>
                                  <th className="px-3 py-2 font-semibold text-center">PIN</th>
                                  <th className="px-3 py-2 font-semibold">Contenuto</th>
                                  <th className="px-3 py-2 font-semibold text-right">Azioni</th>
                                </tr>
                              </thead>
                              <tbody>
                                {zoneLocations.map(loc => {
                                  const isOccupied = !!loc.pallet_code;
                                  return (
                                    <tr key={loc.id} className={`border-b border-slate-800/40 text-sm transition-colors ${isOccupied ? 'bg-sky-500/5 hover:bg-sky-500/10' : 'hover:bg-slate-900/60'}`}>
                                      <td className="px-3 py-2.5 font-mono font-bold text-brand-white">
                                        {loc.barcode}
                                        {isOccupied
                                          ? <span className="ml-2 text-[10px] uppercase bg-sky-500 text-brand-black px-2 py-0.5 rounded-full font-black">Occ.</span>
                                          : <span className="ml-2 text-[10px] uppercase bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-bold">Lib.</span>
                                        }
                                      </td>
                                      <td className="px-3 py-2.5 text-center text-slate-400 text-xs">{loc.col} - {loc.pos}</td>
                                      <td className="px-3 py-2.5 text-center">
                                        <span className="bg-rose-500/10 text-rose-400 border border-rose-500/30 px-2.5 py-0.5 rounded-lg font-black tracking-widest text-xs">
                                          {loc.pin}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2.5 text-xs">
                                        {isOccupied ? (
                                          <div>
                                            <span className="font-mono font-bold text-sky-300">{loc.pallet_code}</span> · <span className="text-slate-200">{loc.product_name}</span> <span className="font-bold text-white">(x{loc.quantity})</span>
                                          </div>
                                        ) : <span className="text-slate-600">-</span>}
                                      </td>
                                      <td className="px-3 py-2.5 text-right flex items-center justify-end gap-1.5">
                                        {isOccupied && (
                                          <button onClick={() => setViewPallet(loc)} className="p-1.5 bg-sky-500/20 text-sky-400 hover:bg-sky-500 hover:text-brand-black rounded-lg transition-colors" title="Vedi merce stivata">
                                            <Eye size={15} />
                                          </button>
                                        )}
                                        {canDeleteLocations && (
                                          <button onClick={() => handleDelete(loc.id)} disabled={isProcessing} className="p-1.5 bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white rounded-lg transition-colors disabled:opacity-40" title="Elimina Posizione">
                                            <Trash2 size={15} />
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

        </div>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
              <div>
                <h2 className="text-xl font-bold text-brand-white flex items-center gap-2">
                  <Layers className="text-brand-blue" size={24} />
                  Elenco Posizioni Libere (Aree Terra / Celle)
                </h2>
                <p className="text-xs text-slate-400 mt-1">Le posizioni libere raggruppano automaticamente gli articoli omogenei aggiunti da Desktop o Zebra.</p>
              </div>
              <button 
                onClick={handleAddFreeLocation}
                disabled={isProcessing}
                className="px-4 py-2.5 bg-brand-blue text-brand-black font-bold rounded-xl hover:bg-sky-400 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <Plus size={18} /> Nuova Posizione Libera
              </button>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {freeLocations.map(fl => (
                <div key={fl.id} className="bg-slate-950/70 border border-slate-800 hover:border-brand-blue/40 p-4 rounded-2xl flex justify-between items-center transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-brand-blue/10 border border-brand-blue/30 flex items-center justify-center text-brand-blue">
                      <Package size={18} />
                    </div>
                    <span className="text-brand-white font-bold">{fl.name}</span>
                  </div>
                  <button onClick={() => handleDeleteFreeLocation(fl.id)} disabled={isProcessing} className="p-2 bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white rounded-xl transition-colors disabled:opacity-40">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {freeLocations.length === 0 && (
                <div className="col-span-full p-8 text-center text-slate-500 font-bold border-2 border-dashed border-slate-800 rounded-2xl">
                  Nessuna posizione libera definita.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal Dettaglio Merce */}
      {viewPallet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md animate-fade-in-up">
          <div className="bg-slate-900 border border-sky-500/30 rounded-3xl p-8 max-w-md w-full shadow-[0_0_40px_rgba(14,165,233,0.15)] relative">
            <h3 className="text-xl font-bold text-brand-white mb-6 flex items-center gap-2">
              <Info className="text-sky-400" />
              Contenuto Scaffale
            </h3>
            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Codice Paletta</p>
                <p className="font-mono text-xl font-bold text-brand-white">{viewPallet.pallet_code}</p>
              </div>
              
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Prodotto</p>
                <p className="font-bold text-brand-blue text-lg">{viewPallet.product_name}</p>
                {viewPallet.product_notes && (
                  <p className="text-sm text-slate-400 mt-2 italic bg-slate-900/50 p-2 rounded-lg">
                    "{viewPallet.product_notes}"
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Quantità</p>
                  <p className="font-bold text-brand-white text-xl">{viewPallet.quantity}</p>
                </div>
                <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Lotto</p>
                  <p className="font-bold text-brand-white text-lg">{viewPallet.batch || '-'}</p>
                </div>
              </div>

              {(viewPallet.expiration_date || viewPallet.client_pallet_number || viewPallet.client_article_number) && (
                <div className="grid grid-cols-2 gap-4">
                  {viewPallet.expiration_date && (
                    <div className="bg-rose-500/10 p-4 rounded-2xl border border-rose-500/20 col-span-2">
                      <p className="text-xs text-rose-400/70 uppercase tracking-wider mb-1 font-bold">Scadenza</p>
                      <p className="font-bold text-rose-400 text-lg">{new Date(viewPallet.expiration_date).toLocaleDateString('it-IT')}</p>
                    </div>
                  )}
                  {viewPallet.client_pallet_number && (
                    <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Paletta Cliente</p>
                      <p className="font-bold text-slate-300 text-sm">{viewPallet.client_pallet_number}</p>
                    </div>
                  )}
                  {viewPallet.client_article_number && (
                    <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Articolo Cliente</p>
                      <p className="font-bold text-slate-300 text-sm">{viewPallet.client_article_number}</p>
                    </div>
                  )}
                </div>
              )}

              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Cliente</p>
                <p className="font-bold text-slate-300">{viewPallet.customer_name}</p>
              </div>

              {viewPallet.notes && (
                <div className="bg-amber-500/10 p-4 rounded-2xl border border-amber-500/20">
                  <p className="text-xs text-amber-500/70 uppercase tracking-wider mb-1 font-bold">Note Paletta</p>
                  <p className="text-amber-400/90 text-sm">{viewPallet.notes}</p>
                </div>
              )}
            </div>
            
            <button onClick={() => setViewPallet(null)} className="w-full mt-6 py-4 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-xl font-bold transition-colors">
              Chiudi
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Locations;






