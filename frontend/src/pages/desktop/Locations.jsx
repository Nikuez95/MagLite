import { appAlert, appConfirm, appConfirmThreeWay, appPrompt } from "../../utils/alerts.js";
import { hasPerm } from "../../utils/permissions.js";
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Map, RefreshCw, Layers, Search, Trash2, Eye, Info, ChevronDown, ChevronRight, Printer, LayoutGrid, List, CheckCircle2, Package, Plus, ArrowRightLeft, X, Award, Warehouse, Building2 } from 'lucide-react';
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
  const [warehouses, setWarehouses] = useState([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('ALL');
  const [selectedDivisionId, setSelectedDivisionId] = useState('ALL');
  const [bulkForm, setBulkForm] = useState({
    zone: 'CELLA2',
    rack: 'A',
    cols: 4,       // Lunghezza (quante colonne)
    levels: 3,     // Piani (quanti livelli in altezza)
    custom: '01, 11, 21', // Usato in CUSTOM
    warehouse_id: '1',
    division_id: ''
  });
  const [newFreeModal, setNewFreeModal] = useState({ show: false, name: '', warehouse_id: '1', division_id: '' });
  const [reassignModal, setReassignModal] = useState({
    show: false,
    title: '',
    zone: null,
    source_warehouse_id: null,
    location_ids: [],
    free_location_ids: [],
    target_warehouse_id: '1',
    target_division_id: ''
  });
  
  const [searchTerm, setSearchTerm] = useState('');
  const [viewPallet, setViewPallet] = useState(null); // per il modal con i dettagli
  const [viewShelfItems, setViewShelfItems] = useState([]);
  const [optScores, setOptScores] = useState({ warehouseScore: null, zoneScores: [], summary: { totalTasks: 0 } });
  const [freeInspect, setFreeInspect] = useState({ show: false, location: '', items: [], loading: false });
  const [freeMoveDraft, setFreeMoveDraft] = useState({ item: null, mode: 'SINGLE_ITEM', moveQty: '', targetLocation: '', error: null });
  
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

  const fetchLocations = async (whOverride = selectedWarehouseId, divOverride = selectedDivisionId) => {
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      const params = new URLSearchParams();
      if (whOverride && whOverride !== 'ALL') params.set('warehouse_id', whOverride);
      if (divOverride && divOverride !== 'ALL') params.set('division_id', divOverride);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const scoreQs = whOverride && whOverride !== 'ALL' ? `?warehouse_id=${whOverride}` : '';

      const [resLoc, resFree, resSettings, resScores, resWh] = await Promise.all([
        axios.get(`http://${window.location.hostname}:3000/api/locations${qs}`, { headers }),
        axios.get(`http://${window.location.hostname}:3000/api/locations/free${qs}`, { headers }),
        axios.get(`http://${window.location.hostname}:3000/api/settings`, { headers }),
        axios.get(`http://${window.location.hostname}:3000/api/pallets/optimization/scores${scoreQs}`, { headers }).catch(() => ({ data: null })),
        axios.get(`http://${window.location.hostname}:3000/api/warehouses`, { headers }).catch(() => ({ data: [] }))
      ]);
      setLocations(resLoc.data || []);
      setFreeLocations(resFree.data || []);
      const whList = resWh.data || [];
      setWarehouses(whList);
      if (resSettings.data && resSettings.data.require_location_pins !== undefined) {
        setRequirePins(resSettings.data.require_location_pins === 'true');
      }
      if (resScores?.data) {
        setOptScores(resScores.data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchLocations(selectedWarehouseId, selectedDivisionId);
  }, [selectedWarehouseId, selectedDivisionId]);

  useEffect(() => {
    const socket = io(`http://${window.location.hostname}:3000`);
    const handleRefresh = () => fetchLocations(selectedWarehouseId, selectedDivisionId);
    socket.on('stow_updated', handleRefresh);
    socket.on('locations_updated', handleRefresh);
    socket.on('warehouses_updated', handleRefresh);
    socket.on('inventory_updated', handleRefresh);

    return () => {
      socket.off('stow_updated', handleRefresh);
      socket.off('locations_updated', handleRefresh);
      socket.off('warehouses_updated', handleRefresh);
      socket.off('inventory_updated', handleRefresh);
      socket.disconnect();
    };
  }, [selectedWarehouseId, selectedDivisionId]);

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
        levels: levelsArray,
        warehouse_id: Number(bulkForm.warehouse_id) || 1,
        division_id: bulkForm.division_id ? Number(bulkForm.division_id) : null
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

  const handleDeleteZone = async (zoneName, zoneWarehouseId = null) => {
    if (isProcessing) return;
    if (!await appConfirm(`Sicuro di voler eliminare interamente la zona "${zoneName}"? L'operazione non è reversibile.`)) return;
    setIsProcessing(true);
    try {
      const whQ = zoneWarehouseId ? `?warehouse_id=${zoneWarehouseId}` : '';
      await axios.delete(`http://${window.location.hostname}:3000/api/locations/zone/${encodeURIComponent(zoneName)}${whQ}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      fetchLocations();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore eliminazione zona');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddFreeLocation = () => {
    if (isProcessing) return;
    const defaultWh = selectedWarehouseId !== 'ALL' ? String(selectedWarehouseId) : String(warehouses[0]?.id || '1');
    const defaultDiv = selectedDivisionId !== 'ALL' && selectedDivisionId !== 'NONE' ? String(selectedDivisionId) : '';
    setNewFreeModal({ show: true, name: '', warehouse_id: defaultWh, division_id: defaultDiv });
  };

  const submitAddFreeLocation = async (e) => {
    e.preventDefault();
    if (isProcessing || !newFreeModal.name.trim()) return;
    setIsProcessing(true);
    try {
      await axios.post(`http://${window.location.hostname}:3000/api/locations/free`, {
        name: newFreeModal.name.trim(),
        warehouse_id: Number(newFreeModal.warehouse_id) || 1,
        division_id: newFreeModal.division_id ? Number(newFreeModal.division_id) : null
      }, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setNewFreeModal({ show: false, name: '', warehouse_id: '1', division_id: '' });
      fetchLocations();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore creazione posizione libera');
    } finally {
      setIsProcessing(false);
    }
  };

  const submitReassign = async (e) => {
    e.preventDefault();
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      await axios.put(`http://${window.location.hostname}:3000/api/locations/reassign`, {
        zone: reassignModal.zone,
        source_warehouse_id: reassignModal.source_warehouse_id,
        location_ids: reassignModal.location_ids,
        free_location_ids: reassignModal.free_location_ids,
        target_warehouse_id: Number(reassignModal.target_warehouse_id),
        target_division_id: reassignModal.target_division_id ? Number(reassignModal.target_division_id) : null
      }, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setReassignModal(prev => ({ ...prev, show: false }));
      await fetchLocations();
      appAlert('Posizioni riassegnate con successo al nuovo magazzino / reparto!', 'Spostamento Completato', 'success');
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore riassegnazione posizioni');
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
    if (selectedDivisionId === 'NONE' && l.division_id) return false;
    if (selectedDivisionId !== 'ALL' && selectedDivisionId !== 'NONE' && String(l.division_id || '') !== String(selectedDivisionId)) return false;
    const matchesSearch =
      l.barcode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.zone.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (l.warehouse_name && l.warehouse_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (l.division_name && l.division_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (l.pallet_code && l.pallet_code.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (l.product_name && l.product_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (l.customer_name && l.customer_name.toLowerCase().includes(searchTerm.toLowerCase()));
    if (!matchesSearch) return false;
    if (statusFilter === 'OCCUPIED') return !!l.pallet_code;
    if (statusFilter === 'FREE') return !l.pallet_code;
    return true;
  });

  const activeWhObj = warehouses.find(w => String(w.id) === String(selectedWarehouseId)) || null;
  const activeWhDivisions = activeWhObj?.divisions || [];
  const bulkWhDivisions = (warehouses.find(w => String(w.id) === String(bulkForm.warehouse_id))?.divisions) || [];

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

  const openShelfDetails = async (loc) => {
    setViewPallet(loc);
    setViewShelfItems([]);
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/pallets/by-location/${encodeURIComponent(loc.barcode)}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setViewShelfItems(res.data?.items || []);
    } catch (_) {}
  };

  const openFreeLocationInspector = async (locName) => {
    setFreeInspect({ show: true, location: locName, items: [], loading: true });
    setFreeMoveDraft({ item: null, mode: 'SINGLE_ITEM', moveQty: '', targetLocation: '', error: null });
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/pallets/by-location/${encodeURIComponent(locName)}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setFreeInspect({ show: true, location: locName, items: res.data?.items || [], loading: false });
    } catch (err) {
      setFreeInspect({ show: true, location: locName, items: [], loading: false });
      appAlert(err.response?.data?.error || 'Errore apertura posizione libera');
    }
  };

  const executeFreeMove = async (e) => {
    e.preventDefault();
    if (isProcessing || !freeMoveDraft.item) return;
    const targetLoc = String(freeMoveDraft.targetLocation || '').trim().toUpperCase();
    if (!targetLoc) {
      setFreeMoveDraft(prev => ({ ...prev, error: 'Seleziona o digita una posizione di destinazione.' }));
      return;
    }

    const item = freeMoveDraft.item;
    const maxQ = parseFloat(item.quantity) || 0;
    const qty = freeMoveDraft.mode === 'SINGLE_ITEM' ? parseFloat(freeMoveDraft.moveQty) : maxQ;
    if (freeMoveDraft.mode === 'SINGLE_ITEM' && (isNaN(qty) || qty <= 0 || qty > maxQ)) {
      setFreeMoveDraft(prev => ({ ...prev, error: `Quantità non valida (max ${maxQ}).` }));
      return;
    }

    const payload = {
      mode: freeMoveDraft.mode,
      pallet_code: item.pallet_code,
      pallet_id: freeMoveDraft.mode === 'SINGLE_ITEM' ? item.id : undefined,
      move_quantity: freeMoveDraft.mode === 'SINGLE_ITEM' ? qty : undefined,
      target_location: targetLoc,
      source: 'Gestionale'
    };

    setIsProcessing(true);
    setFreeMoveDraft(prev => ({ ...prev, error: null }));
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      try {
        await axios.post(`http://${window.location.hostname}:3000/api/pallets/move-items`, payload, { headers });
      } catch (err) {
        if (err.response?.status === 409 && err.response?.data?.occupying_pallet) {
          const choice = await appConfirmThreeWay(
            `La posizione ${targetLoc} è già occupata dalla paletta ${err.response.data.occupying_pallet}. Come vuoi procedere?`,
            'Posizione Occupata',
            'Unisci / Frammenta',
            'Forza comunque',
            'Annulla'
          );
          if (choice === 'CONFIRM') {
            await axios.post(`http://${window.location.hostname}:3000/api/pallets/move-items`, { ...payload, merge_into_existing: true }, { headers });
          } else if (choice === 'DENY') {
            await axios.post(`http://${window.location.hostname}:3000/api/pallets/move-items`, { ...payload, force: true }, { headers });
          } else {
            setIsProcessing(false);
            return;
          }
        } else {
          throw err;
        }
      }
      await fetchLocations();
      await openFreeLocationInspector(freeInspect.location);
    } catch (err) {
      setFreeMoveDraft(prev => ({ ...prev, error: err.response?.data?.error || 'Errore durante lo spostamento' }));
    } finally {
      setIsProcessing(false);
    }
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

        {/* Selettore Sede Magazzino & Reparto / Capannone */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-black uppercase tracking-wider text-slate-400 mr-1 flex items-center gap-1.5">
              <Warehouse size={15} className="text-brand-blue" /> Sede Magazzino:
            </span>
            <button
              type="button"
              onClick={() => { setSelectedWarehouseId('ALL'); setSelectedDivisionId('ALL'); }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                selectedWarehouseId === 'ALL'
                  ? 'bg-brand-blue text-brand-black border-brand-blue font-black'
                  : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-600'
              }`}
            >
              Tutti i Magazzini
            </button>
            {warehouses.map(w => (
              <button
                key={w.id}
                type="button"
                onClick={() => {
                  const idStr = String(w.id);
                  setSelectedWarehouseId(idStr);
                  setSelectedDivisionId('ALL');
                  setBulkForm(prev => ({ ...prev, warehouse_id: idStr, division_id: '' }));
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 ${
                  String(selectedWarehouseId) === String(w.id)
                    ? 'bg-brand-blue text-brand-black border-brand-blue font-black shadow'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-600'
                }`}
              >
                <Building2 size={13} /> {w.name}
                {w.divisions?.length > 0 && (
                  <span className="text-[10px] opacity-80">({w.divisions.length})</span>
                )}
              </button>
            ))}
          </div>

          {activeWhDivisions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/80">
              <span className="text-[11px] font-bold uppercase tracking-wider text-violet-300 mr-1">
                Capannone / Reparto:
              </span>
              <button
                type="button"
                onClick={() => setSelectedDivisionId('ALL')}
                className={`px-3 py-1 rounded-lg text-xs font-bold border ${
                  selectedDivisionId === 'ALL' ? 'bg-violet-500 text-white border-violet-500' : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                Tutti i Reparti
              </button>
              <button
                type="button"
                onClick={() => setSelectedDivisionId('NONE')}
                className={`px-3 py-1 rounded-lg text-xs font-bold border ${
                  selectedDivisionId === 'NONE' ? 'bg-slate-700 text-white border-slate-600' : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                Senza Reparto
              </button>
              {activeWhDivisions.map(d => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => {
                    setSelectedDivisionId(String(d.id));
                    setBulkForm(prev => ({ ...prev, division_id: String(d.id) }));
                  }}
                  className={`px-3 py-1 rounded-lg text-xs font-bold border ${
                    String(selectedDivisionId) === String(d.id)
                      ? 'bg-violet-500 text-white border-violet-400'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-violet-500/40'
                  }`}
                >
                  {d.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* KPI Magazzino */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
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
          <div className="bg-slate-900/90 border border-purple-500/30 rounded-2xl p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-purple-300 mb-1 flex items-center gap-1">
              <Award size={13} className="text-purple-400" /> Ottimizzazione
            </div>
            <div className={`text-2xl font-black ${
              (optScores.warehouseScore ?? 100) >= 90 ? 'text-emerald-400' : (optScores.warehouseScore ?? 100) >= 70 ? 'text-amber-400' : 'text-rose-400'
            }`}>
              {optScores.warehouseScore !== null ? `${optScores.warehouseScore}%` : '-'}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              {optScores.summary?.totalTasks > 0 ? `${optScores.summary.totalTasks} task suggerite` : 'Slotting ottimale'}
            </div>
          </div>
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4">
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
              <form onSubmit={handleBulkGenerate} className="space-y-4">
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Sede Magazzino *</label>
                    <select
                      value={bulkForm.warehouse_id}
                      onChange={e => setBulkForm({ ...bulkForm, warehouse_id: e.target.value, division_id: '' })}
                      className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-2.5 text-sm font-bold"
                    >
                      {warehouses.map(w => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                      {warehouses.length === 0 && <option value="1">Settala</option>}
                    </select>
                  </div>
                  {bulkWhDivisions.length > 0 && (
                    <div>
                      <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Capannone / Reparto (Opz.)</label>
                      <select
                        value={bulkForm.division_id}
                        onChange={e => setBulkForm({ ...bulkForm, division_id: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-2.5 text-sm font-bold"
                      >
                        <option value="">-- Nessun reparto specifico --</option>
                        {bulkWhDivisions.map(d => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

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
                    const zScoreObj = (optScores.zoneScores || []).find(zs => zs.zone === zoneName.toUpperCase());
                    const firstLoc = zoneLocations[0];
                    const zoneWhId = firstLoc?.warehouse_id || 1;
                    const zoneWhName = firstLoc?.warehouse_name || warehouses.find(w => w.id === zoneWhId)?.name || 'Settala';
                    const uniqueDivNames = [...new Set(zoneLocations.map(l => l.division_name).filter(Boolean))];
                    return (
                      <div key={zoneName} className="bg-slate-950/60 border border-slate-800 rounded-2xl overflow-hidden">
                        {/* Header Zona */}
                        <div
                          onClick={() => toggleZone(zoneName)}
                          className="p-3.5 bg-slate-900/90 hover:bg-slate-800/80 cursor-pointer transition-colors flex flex-wrap items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            {isExpanded ? <ChevronDown size={18} className="text-brand-blue" /> : <ChevronRight size={18} className="text-slate-400" />}
                            <span className="font-black text-base text-brand-white">Zona {zoneName}</span>
                            <span className="bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 px-2 py-0.5 rounded-lg text-[11px] font-bold">
                              {zoneWhName}
                            </span>
                            {uniqueDivNames.map(dn => (
                              <span key={dn} className="bg-violet-500/15 text-violet-300 border border-violet-500/30 px-2 py-0.5 rounded-lg text-[11px] font-bold">
                                {dn}
                              </span>
                            ))}
                            <span className="bg-slate-950 text-slate-300 px-2 py-0.5 rounded-lg text-xs border border-slate-800 font-bold">
                              {zoneLocations.length} pos.
                            </span>
                            {zScoreObj && (
                              <span
                                className={`px-2.5 py-0.5 rounded-full text-xs font-black border ${
                                  zScoreObj.score >= 90
                                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                                    : zScoreObj.score >= 70
                                      ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                                      : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                                }`}
                                title={`${zScoreObj.tasksCount} task di ottimizzazione in questa zona`}
                              >
                                Ottim.: {zScoreObj.score}%{zScoreObj.tasksCount > 0 ? ` · ${zScoreObj.tasksCount} task` : ''}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs font-bold">
                            <span className="text-sky-400 bg-sky-500/10 border border-sky-500/20 px-2.5 py-0.5 rounded-full">{totalOccupied} occ. ({zonePct}%)</span>
                            <span className="text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full">{zoneLocations.length - totalOccupied} lib.</span>
                            {canManageLocations && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setReassignModal({
                                    show: true,
                                    title: `Sposta Zona "${zoneName}" (${zoneWhName})`,
                                    zone: zoneName,
                                    source_warehouse_id: zoneWhId,
                                    location_ids: [],
                                    free_location_ids: [],
                                    target_warehouse_id: String(zoneWhId),
                                    target_division_id: firstLoc?.division_id ? String(firstLoc.division_id) : ''
                                  });
                                }}
                                className="px-2 py-1 bg-violet-500/15 text-violet-300 hover:bg-violet-500 hover:text-white border border-violet-500/30 rounded-lg transition-colors flex items-center gap-1 text-[11px]"
                                title="Sposta / Riassegna Magazzino o Capannone per questa Zona"
                              >
                                <ArrowRightLeft size={13} /> Riassegna Sede
                              </button>
                            )}
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
                                onClick={(e) => { e.stopPropagation(); handleDeleteZone(zoneName, zoneWhId); }}
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
                                    onClick={() => isOccupied && openShelfDetails(loc)}
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
                                        <div className="text-[10px] font-mono text-amber-300/90 truncate">
                                          Lotto: {loc.batch || '-'}
                                        </div>
                                        <div className="flex items-center justify-between text-[11px] text-slate-400 pt-0.5">
                                          <span className="truncate max-w-[90px]">{loc.customer_name || '-'}</span>
                                          <span className="font-black text-brand-white">x{loc.quantity} {loc.uom || ''}</span>
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
                                          <button onClick={() => openShelfDetails(loc)} className="p-1.5 bg-sky-500/20 text-sky-400 hover:bg-sky-500 hover:text-brand-black rounded-lg transition-colors" title="Vedi merce stivata">
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
                <p className="text-xs text-slate-400 mt-1">Le posizioni libere ospitano più UDM bancali mantenendoli separati in un&apos;unica area di sosta.</p>
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
              {freeLocations.map(fl => {
                const count = Number(fl.items_count) || 0;
                const palletsCount = Number(fl.pallets_count) || 0;
                const totalQ = parseFloat(fl.total_qty) || 0;
                return (
                  <div
                    key={fl.id}
                    onClick={() => openFreeLocationInspector(fl.name)}
                    className="bg-slate-950/70 border border-slate-800 hover:border-brand-blue/60 p-4 rounded-2xl flex justify-between items-center transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${count > 0 ? 'bg-sky-500/15 border-sky-500/40 text-sky-400' : 'bg-slate-900 border-slate-800 text-slate-500'}`}>
                        <Package size={18} />
                      </div>
                      <div className="min-w-0">
                        <span className="text-brand-white font-bold block truncate">{fl.name}</span>
                        <div className="flex items-center gap-1 flex-wrap mt-0.5">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/25">
                            {fl.warehouse_name || 'Settala'}
                          </span>
                          {fl.division_name && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/30">
                              {fl.division_name}
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] font-semibold text-slate-400 block mt-0.5">
                          {count > 0
                            ? `${palletsCount || 1} UDM · ${count} ${count === 1 ? 'articolo' : 'articoli'} (${totalQ} u.)`
                            : 'Vuota · Clicca per ispezionare'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {canManageLocations && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setReassignModal({
                              show: true,
                              title: `Riassegna Posizione "${fl.name}"`,
                              zone: null,
                              source_warehouse_id: fl.warehouse_id || 1,
                              location_ids: [],
                              free_location_ids: [fl.id],
                              target_warehouse_id: String(fl.warehouse_id || 1),
                              target_division_id: fl.division_id ? String(fl.division_id) : ''
                            });
                          }}
                          className="p-2 bg-violet-500/15 text-violet-300 hover:bg-violet-500 hover:text-white rounded-xl transition-colors"
                          title="Cambia Magazzino / Capannone"
                        >
                          <ArrowRightLeft size={15} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openFreeLocationInspector(fl.name); }}
                        className="p-2 bg-sky-500/10 text-sky-400 hover:bg-sky-500 hover:text-brand-black rounded-xl transition-colors"
                        title="Vedi e sposta articoli"
                      >
                        <Eye size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDeleteFreeLocation(fl.id); }}
                        disabled={isProcessing}
                        className="p-2 bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white rounded-xl transition-colors disabled:opacity-40"
                        title="Elimina Posizione Libera"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
              {freeLocations.length === 0 && (
                <div className="col-span-full p-8 text-center text-slate-500 font-bold border-2 border-dashed border-slate-800 rounded-2xl">
                  Nessuna posizione libera definita.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal Contenuto Posizione Libera (Scaffalino) con Spostamento Parziale / Singolo Articolo */}
      {freeInspect.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md animate-fade-in-up">
          <div className="bg-slate-900 border border-brand-blue/40 rounded-3xl p-7 max-w-2xl w-full shadow-2xl relative max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-brand-blue">Contenuto Posizione Libera</span>
                <h3 className="text-2xl font-black text-brand-white">{freeInspect.location}</h3>
              </div>
              <button
                type="button"
                onClick={() => { setFreeInspect({ show: false, location: '', items: [], loading: false }); setFreeMoveDraft({ item: null, mode: 'SINGLE_ITEM', moveQty: '', targetLocation: '', error: null }); }}
                className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            {freeInspect.loading ? (
              <div className="p-10 text-center text-slate-400 font-bold">Caricamento articoli...</div>
            ) : freeInspect.items.length === 0 ? (
              <div className="p-10 text-center text-slate-500 font-bold border-2 border-dashed border-slate-800 rounded-2xl">
                Nessun articolo presente in questa posizione libera.
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {(() => {
                  const udmMap = new Map();
                  freeInspect.items.forEach(item => {
                    const code = item.pallet_code || `ROW-${item.id}`;
                    if (!udmMap.has(code)) udmMap.set(code, []);
                    udmMap.get(code).push(item);
                  });
                  const udmGroups = Array.from(udmMap.entries());

                  return udmGroups.map(([udmCode, udmItems]) => {
                    const hasMovable = udmItems.some(i => !i.is_quarantined);
                    return (
                      <div key={udmCode} className="bg-slate-950/60 border border-slate-800 rounded-2xl p-3 space-y-2.5">
                        <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-800/80">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono text-xs font-black px-2.5 py-1 rounded-lg bg-brand-blue/15 text-brand-blue border border-brand-blue/30">
                              {udmCode}
                            </span>
                            <span className="text-[11px] font-bold text-slate-400">
                              {udmItems.length} {udmItems.length === 1 ? 'riga' : 'righe'}
                            </span>
                          </div>
                          {canManageLocations && hasMovable && udmItems.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setFreeMoveDraft({
                                item: udmItems[0],
                                mode: 'ALL_PALLET',
                                moveQty: String(udmItems[0].quantity),
                                targetLocation: '',
                                error: null
                              })}
                              className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-brand-black border border-amber-500/40 font-black text-[11px] flex items-center gap-1.5 transition-colors shrink-0"
                            >
                              <ArrowRightLeft size={13} /> Sposta Intera UDM ({udmItems.length})
                            </button>
                          )}
                        </div>

                        <div className="space-y-2">
                          {udmItems.map(item => (
                            <div key={item.id} className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-mono text-xs font-bold text-brand-blue">{item.sku}</span>
                                  {item.batch && (
                                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                      Lotto: {item.batch}
                                    </span>
                                  )}
                                </div>
                                <div className="font-black text-sm text-brand-white mt-0.5">{item.product_name}</div>
                                <div className="text-xs text-slate-400 mt-0.5">
                                  {item.customer_name}
                                </div>
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                <div className="text-right">
                                  <div className="font-black text-base text-emerald-400">{item.quantity} {item.uom || ''}</div>
                                </div>
                                {canManageLocations && !item.is_quarantined && (
                                  <button
                                    type="button"
                                    onClick={() => setFreeMoveDraft({
                                      item,
                                      mode: 'SINGLE_ITEM',
                                      moveQty: String(item.quantity),
                                      targetLocation: '',
                                      error: null
                                    })}
                                    className="px-3 py-2 rounded-xl bg-brand-blue text-brand-black font-black text-xs hover:bg-sky-400 transition-colors flex items-center gap-1.5"
                                  >
                                    <ArrowRightLeft size={14} /> Sposta
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}

            {freeMoveDraft.item && (
              <form onSubmit={executeFreeMove} className="mt-4 pt-4 border-t border-slate-800 bg-slate-950/90 p-4 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase text-emerald-400">
                    {freeMoveDraft.mode === 'ALL_PALLET'
                      ? `Sposta TUTTI (${freeInspect.items.length} articoli)`
                      : `Sposta: ${freeMoveDraft.item.product_name}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFreeMoveDraft({ item: null, mode: 'SINGLE_ITEM', moveQty: '', targetLocation: '', error: null })}
                    className="text-xs text-slate-400 hover:text-white font-bold"
                  >
                    Annulla
                  </button>
                </div>

                {freeMoveDraft.error && (
                  <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs font-bold text-rose-300">
                    {freeMoveDraft.error}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {freeMoveDraft.mode === 'SINGLE_ITEM' && (
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">
                        Quantità (max {freeMoveDraft.item.quantity})
                      </label>
                      <input
                        type="number"
                        min="0.01"
                        max={freeMoveDraft.item.quantity}
                        step="0.01"
                        required
                        value={freeMoveDraft.moveQty}
                        onChange={(e) => setFreeMoveDraft(prev => ({ ...prev, moveQty: e.target.value }))}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-sm font-black text-white"
                      />
                    </div>
                  )}
                  <div className={freeMoveDraft.mode === 'ALL_PALLET' ? 'sm:col-span-2' : ''}>
                    <label className="block text-[11px] font-bold uppercase text-slate-400 mb-1">
                      Destinazione (Scaffale o Posizione Libera)
                    </label>
                    <input
                      list="free-move-targets"
                      required
                      placeholder="Es. CELLA2-A-01 o altra Posizione Libera..."
                      value={freeMoveDraft.targetLocation}
                      onChange={(e) => setFreeMoveDraft(prev => ({ ...prev, targetLocation: e.target.value.toUpperCase() }))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-sm font-mono font-bold text-white uppercase"
                    />
                    <datalist id="free-move-targets">
                      {freeLocations.filter(f => f.name.toUpperCase() !== freeInspect.location).map(f => (
                        <option key={`fl-${f.id}`} value={f.name.toUpperCase()} />
                      ))}
                      {locations.map(l => (
                        <option key={`loc-${l.id}`} value={l.barcode} />
                      ))}
                    </datalist>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isProcessing}
                  className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-brand-black font-black text-sm disabled:opacity-50"
                >
                  {isProcessing ? 'Spostamento...' : 'Conferma Spostamento'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Modal Dettaglio Merce */}
      {viewPallet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md animate-fade-in-up">
          <div className="bg-slate-900 border border-sky-500/30 rounded-3xl p-8 max-w-lg w-full shadow-[0_0_40px_rgba(14,165,233,0.15)] relative">
            <h3 className="text-xl font-bold text-brand-white mb-5 flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Info className="text-sky-400" />
                Contenuto Scaffale · <span className="font-mono text-sky-300">{viewPallet.barcode}</span>
              </span>
            </h3>
            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Codice Paletta</p>
                  <p className="font-mono text-xl font-bold text-brand-white">{viewPallet.pallet_code}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Totale Scaffale</p>
                  <p className="font-black text-xl text-emerald-400">{viewPallet.quantity ?? 0} {viewPallet.uom || ''}</p>
                </div>
              </div>

              {viewShelfItems.length > 1 ? (
                <div className="space-y-2">
                  <p className="text-xs text-slate-400 uppercase tracking-wider font-bold">
                    Articoli sullo scaffale ({viewShelfItems.length})
                  </p>
                  {viewShelfItems.map(it => (
                    <div key={it.id} className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 space-y-1">
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <span className="font-mono text-[11px] font-bold text-brand-blue">{it.sku}</span>
                          <div className="font-bold text-sm text-brand-white">{it.product_name}</div>
                        </div>
                        <span className="font-black text-sm text-emerald-400 shrink-0">{it.quantity} {it.uom || ''}</span>
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                        <span>Lotto: <strong className="text-amber-300">{it.batch || '-'}</strong></span>
                        <span>Cliente: <strong className="text-slate-200">{it.customer_name}</strong></span>
                        {it.expiration_date && (
                          <span>Scad.: <strong className="text-rose-400">{new Date(it.expiration_date).toLocaleDateString('it-IT')}</strong></span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                    <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Prodotto</p>
                    <p className="font-bold text-brand-blue text-lg">{viewShelfItems[0]?.product_name || viewPallet.product_name}</p>
                    {viewPallet.product_notes && (
                      <p className="text-sm text-slate-400 mt-2 italic bg-slate-900/50 p-2 rounded-lg">
                        &quot;{viewPallet.product_notes}&quot;
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                      <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Quantità</p>
                      <p className="font-bold text-emerald-400 text-xl">
                        {viewShelfItems[0]?.quantity ?? viewPallet.quantity ?? 0} {viewShelfItems[0]?.uom || viewPallet.uom || ''}
                      </p>
                    </div>
                    <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                      <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Lotto</p>
                      <p className="font-bold text-amber-300 text-lg">{viewShelfItems[0]?.batch || viewPallet.batch || '-'}</p>
                    </div>
                  </div>
                </>
              )}

              {(viewPallet.expiration_date || viewPallet.client_pallet_number || viewPallet.client_article_number) && viewShelfItems.length <= 1 && (
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
                <p className="font-bold text-slate-300">{viewShelfItems[0]?.customer_name || viewPallet.customer_name || '-'}</p>
              </div>

              {viewPallet.notes && (
                <div className="bg-amber-500/10 p-4 rounded-2xl border border-amber-500/20">
                  <p className="text-xs text-amber-500/70 uppercase tracking-wider mb-1 font-bold">Note Paletta</p>
                  <p className="text-amber-400/90 text-sm">{viewPallet.notes}</p>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              {canManageLocations && (
                <button
                  type="button"
                  onClick={() => {
                    const b = viewPallet.barcode;
                    setViewPallet(null);
                    openFreeLocationInspector(b);
                  }}
                  className="flex-1 py-4 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-xl font-black transition-colors flex items-center justify-center gap-2"
                >
                  <ArrowRightLeft size={18} /> Sposta Merce
                </button>
              )}
              <button onClick={() => setViewPallet(null)} className="flex-1 py-4 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-xl font-bold transition-colors">
                Chiudi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Nuova Posizione Libera con Magazzino & Capannone */}
      {newFreeModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/90 backdrop-blur-md">
          <div className="bg-slate-900 border border-brand-blue/40 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-black text-white">Nuova Posizione Libera</h3>
              <button type="button" onClick={() => setNewFreeModal(p => ({ ...p, show: false }))} className="p-1.5 text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <form onSubmit={submitAddFreeLocation} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-400 mb-1">Nome Posizione *</label>
                <input
                  required
                  value={newFreeModal.name}
                  onChange={e => setNewFreeModal(p => ({ ...p, name: e.target.value.toUpperCase() }))}
                  placeholder="Es. CELLA 2, PIAZZALE FUORI..."
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl p-3 text-sm font-bold uppercase"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-400 mb-1">Sede Magazzino *</label>
                <select
                  value={newFreeModal.warehouse_id}
                  onChange={e => setNewFreeModal(p => ({ ...p, warehouse_id: e.target.value, division_id: '' }))}
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl p-3 text-sm font-bold"
                >
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              {((warehouses.find(w => String(w.id) === String(newFreeModal.warehouse_id))?.divisions) || []).length > 0 && (
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-400 mb-1">Capannone / Reparto (Opz.)</label>
                  <select
                    value={newFreeModal.division_id}
                    onChange={e => setNewFreeModal(p => ({ ...p, division_id: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl p-3 text-sm"
                  >
                    <option value="">-- Nessuno --</option>
                    {warehouses.find(w => String(w.id) === String(newFreeModal.warehouse_id)).divisions.map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setNewFreeModal(p => ({ ...p, show: false }))} className="flex-1 py-2.5 bg-slate-800 text-slate-300 rounded-xl font-bold text-sm">Annulla</button>
                <button type="submit" disabled={isProcessing} className="flex-1 py-2.5 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-xl font-black text-sm">Crea Posizione</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Riassegnazione Sede / Capannone per Zona o Posizione */}
      {reassignModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/90 backdrop-blur-md">
          <div className="bg-slate-900 border border-violet-500/40 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-violet-400">Riassegna Posizioni</span>
                <h3 className="text-lg font-black text-white">{reassignModal.title}</h3>
              </div>
              <button type="button" onClick={() => setReassignModal(p => ({ ...p, show: false }))} className="p-1.5 text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <form onSubmit={submitReassign} className="space-y-4">
              <p className="text-xs text-slate-400">
                Le eventuali palette attualmente posizionate in questa zona/posizione verranno aggiornate automaticamente con la nuova sede magazzino.
              </p>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-400 mb-1">Nuovo Magazzino di Destinazione *</label>
                <select
                  value={reassignModal.target_warehouse_id}
                  onChange={e => setReassignModal(p => ({ ...p, target_warehouse_id: e.target.value, target_division_id: '' }))}
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl p-3 text-sm font-bold"
                >
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-400 mb-1">Nuovo Capannone / Reparto</label>
                <select
                  value={reassignModal.target_division_id}
                  onChange={e => setReassignModal(p => ({ ...p, target_division_id: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl p-3 text-sm"
                >
                  <option value="">-- Nessun reparto specifico --</option>
                  {((warehouses.find(w => String(w.id) === String(reassignModal.target_warehouse_id))?.divisions) || []).map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setReassignModal(p => ({ ...p, show: false }))} className="flex-1 py-2.5 bg-slate-800 text-slate-300 rounded-xl font-bold text-sm">Annulla</button>
                <button type="submit" disabled={isProcessing} className="flex-1 py-2.5 bg-violet-500 hover:bg-violet-400 text-white rounded-xl font-black text-sm">Applica Spostamento</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Locations;






