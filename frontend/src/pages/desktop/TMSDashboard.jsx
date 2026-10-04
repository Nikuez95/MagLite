import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Truck, MapPin, Calendar, Clock, Euro, MessageCircle, Copy, AlertTriangle, Briefcase, FileText, Plus, Edit2, X, Check, Trash2, CalendarDays, LayoutTemplate, StretchHorizontal, GripVertical } from 'lucide-react';
import { format, differenceInMinutes } from 'date-fns';
import { it } from 'date-fns/locale';
import Swal from 'sweetalert2';
import axios from 'axios';

const INITIAL_DRIVERS = [
  { id: 'driver-1', name: 'Mario Rossi', vehicle: 'IVECO Stralis - AB123CD' },
  { id: 'driver-2', name: 'Luigi Verdi', vehicle: 'Scania R500 - EF456GH' },
  { id: 'driver-3', name: 'Antonio Neri', vehicle: 'Mercedes Actros - LM789NO' }
];

const getMockDate = (dayOffset, hour) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

const INITIAL_TRIPS = {
  'unassigned': [
    { id: 'trip-1', customer: 'Logistics S.p.A.', ref: 'REF-2026-A1', pickup: 'Milano (MI)', pickupTime: getMockDate(0, 8), delivery: 'Roma (RM)', deliveryTime: getMockDate(0, 18), revenue: 450, cost: 200, status: 'UNASSIGNED', notes: ['Sponda idraulica'] },
    { id: 'trip-2', customer: 'GDO Supermercati', ref: 'REF-2026-B2', pickup: 'Bologna (BO)', pickupTime: getMockDate(1, 10), delivery: 'Verona (VR)', deliveryTime: getMockDate(1, 14), revenue: 150, cost: 80, status: 'UNASSIGNED', notes: ['Tassativo', 'Documenti in bolla'] }
  ],
  'driver-1': [
    { id: 'trip-3', customer: 'Tech Industries', ref: 'REF-2026-C3', pickup: 'Torino (TO)', pickupTime: getMockDate(0, 7), delivery: 'Genova (GE)', deliveryTime: getMockDate(0, 12), revenue: 200, cost: 250, status: 'IN_TRANSIT', notes: ['Mandare targa'] },
    { id: 'trip-4', customer: 'Fermo Macchina', ref: 'ADMIN-01', pickup: '', pickupTime: getMockDate(2, 8), delivery: '', deliveryTime: getMockDate(4, 18), revenue: 0, cost: 0, status: 'ADMIN', title: 'Guasto Meccanico (Officina)', notes: [] }
  ],
  'driver-2': [
    { id: 'trip-5', customer: 'Arredamenti S.r.l.', ref: 'REF-2026-D4', pickup: 'Firenze (FI)', pickupTime: getMockDate(0, 9), delivery: 'Napoli (NA)', deliveryTime: getMockDate(0, 19), revenue: 600, cost: 300, status: 'ASSIGNED', notes: [] },
    { id: 'trip-5b', customer: 'Ikea', ref: 'REF-2026-D5', pickup: 'Piacenza (PC)', pickupTime: getMockDate(1, 6), delivery: 'Bari (BA)', deliveryTime: getMockDate(2, 14), revenue: 1200, cost: 700, status: 'ASSIGNED', notes: [] }
  ],
  'driver-3': [
    { id: 'trip-6', customer: 'Ferie', ref: 'ADMIN-02', pickup: '', pickupTime: getMockDate(-1, 0), delivery: '', deliveryTime: getMockDate(10, 23), revenue: 0, cost: 0, status: 'ADMIN', title: 'Ferie Programmate', notes: [] }
  ]
};

const STATUS_COLORS = {
  'UNASSIGNED': 'border-slate-500 bg-slate-500/10 text-slate-400',
  'ASSIGNED': 'border-brand-blue bg-brand-blue/10 text-brand-blue border-solid border-l-4',
  'IN_TRANSIT': 'border-amber-500 bg-amber-500/10 text-amber-500 border-solid border-l-4',
  'DELIVERED': 'border-emerald-500 bg-emerald-500/10 text-emerald-500 border-solid border-l-4',
  'EXCEPTION': 'border-rose-500 bg-rose-500/10 text-rose-500 border-solid border-l-4',
  'ADMIN': 'border-fuchsia-500 bg-fuchsia-500/10 text-fuchsia-400 border-solid border-l-4'
};

const STATUS_BG = {
  'UNASSIGNED': 'bg-slate-800',
  'ASSIGNED': 'bg-brand-blue/20',
  'IN_TRANSIT': 'bg-amber-500/20',
  'DELIVERED': 'bg-emerald-500/20',
  'EXCEPTION': 'bg-rose-500/20',
  'ADMIN': 'bg-fuchsia-500/20'
};

const TMSDashboard = () => {
  const [drivers, setDrivers] = useState(INITIAL_DRIVERS);
  const [columns, setColumns] = useState(INITIAL_TRIPS);
  const [loading, setLoading] = useState(true);

  // Load State from Database
  useEffect(() => {
    const fetchTMS = async () => {
      try {
        const res = await axios.get(`http://${window.location.hostname}:3000/api/tms`, {
           headers: { Authorization: `Bearer ${localStorage.getItem('maglite_token')}` }
        });
        if (res.data.drivers.length > 0 || Object.keys(res.data.columns).length > 1) {
            setDrivers(res.data.drivers);
            setColumns(res.data.columns);
        }
      } catch (err) {
        console.error("Failed to load TMS from DB, using initial data.", err);
      } finally {
        setLoading(false);
      }
    };
    fetchTMS();
  }, []);

  const prevDrivers = useRef(drivers);
  const prevColumns = useRef(columns);
  const isInitialMount = useRef(true);

  // Persist State to DB on change
  useEffect(() => {
    if (loading) return;
    if (isInitialMount.current) {
        isInitialMount.current = false;
        prevDrivers.current = drivers;
        prevColumns.current = columns;
        return;
    }
    
    if (prevDrivers.current === drivers && prevColumns.current === columns) return;
    prevDrivers.current = drivers;
    prevColumns.current = columns;
    
    const saveToDB = async () => {
      try {
        await axios.post(`http://${window.location.hostname}:3000/api/tms/sync`, 
          { drivers, columns },
          { headers: { Authorization: `Bearer ${localStorage.getItem('maglite_token')}` } }
        );
      } catch (err) { console.error("Errore salvataggio DB", err); }
    };
    
    const timeoutId = setTimeout(() => saveToDB(), 300);
    return () => clearTimeout(timeoutId);
  }, [drivers, columns, loading]);

  
  // Views Configuration
  const [viewMode, setViewMode] = useState('TOTAL');
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  // Modals
  const [editingTrip, setEditingTrip] = useState(null);
  const [isTripModalOpen, setIsTripModalOpen] = useState(false);
  const [editingDriver, setEditingDriver] = useState(null);
  const [isDriverModalOpen, setIsDriverModalOpen] = useState(false);
  
  // Drag State for Native DnD
  const [draggedDriverId, setDraggedDriverId] = useState(null);
  
  

  // --- LOGIC ---
  const handleOpenDriverModal = (driver = null) => {
    if (driver) setEditingDriver({ ...driver, isNew: false });
    else setEditingDriver({ id: 'driver-' + Date.now(), name: '', vehicle: '', isNew: true });
    setIsDriverModalOpen(true);
  };

  const handleSaveDriver = (e) => {
    e.preventDefault();
    if (editingDriver.isNew) {
      const newDriver = { id: editingDriver.id, name: editingDriver.name, vehicle: editingDriver.vehicle };
      setDrivers([...drivers, newDriver]);
      setColumns(prev => ({ ...prev, [newDriver.id]: [] }));
    } else {
      setDrivers(drivers.map(d => d.id === editingDriver.id ? { ...d, name: editingDriver.name, vehicle: editingDriver.vehicle } : d));
    }
    setIsDriverModalOpen(false);
  };

  const handleDeleteDriver = async () => {
    const res = await Swal.fire({ title: 'Eliminare Autista?', text: "I viaggi andranno in Da Assegnare.", icon: 'warning', showCancelButton: true, confirmButtonColor: '#f43f5e', cancelButtonColor: '#1e293b' });
    if (res.isConfirmed) {
      const driverTrips = columns[editingDriver.id] || [];
      const updatedUnassigned = [...(columns['unassigned'] || []), ...driverTrips.map(t => ({ ...t, status: 'UNASSIGNED' }))];
      const newColumns = { ...columns, 'unassigned': updatedUnassigned };
      delete newColumns[editingDriver.id];
      setColumns(newColumns);
      setDrivers(drivers.filter(d => d.id !== editingDriver.id));
      setIsDriverModalOpen(false);
    }
  };

  const handleOpenTripModal = (trip = null) => {
    if (trip) setEditingTrip({ ...trip });
    else {
      const dateTarget = viewMode === 'CALENDAR' ? selectedDate : format(new Date(), 'yyyy-MM-dd');
      setEditingTrip({
        id: 'trip-' + Date.now(), isNew: true, customer: '', ref: 'REF-' + Math.floor(Math.random() * 10000), pickup: '',
        pickupTime: `${dateTarget}T08:00`, delivery: '', deliveryTime: `${dateTarget}T18:00`, revenue: 0, cost: 0, status: 'UNASSIGNED', title: '', notes: []
      });
    }
    setIsTripModalOpen(true);
  };

  const handleSaveTrip = (e) => {
    e.preventDefault();
    const tripToSave = {
      ...editingTrip, revenue: parseFloat(editingTrip.revenue) || 0, cost: parseFloat(editingTrip.cost) || 0,
      notes: typeof editingTrip.notes === 'string' ? editingTrip.notes.split(',').map(n => n.trim()).filter(n => n) : editingTrip.notes,
      pickupTime: editingTrip.pickupTime && editingTrip.pickupTime.length === 16 ? editingTrip.pickupTime + ':00Z' : editingTrip.pickupTime,
      deliveryTime: editingTrip.deliveryTime && editingTrip.deliveryTime.length === 16 ? editingTrip.deliveryTime + ':00Z' : editingTrip.deliveryTime,
    };
    let newColumns = { ...columns };
    if (editingTrip.isNew) {
      delete tripToSave.isNew;
      newColumns['unassigned'] = [tripToSave, ...(newColumns['unassigned'] || [])];
    } else {
      for (const colId in newColumns) {
        const index = newColumns[colId].findIndex(t => t.id === tripToSave.id);
        if (index > -1) { newColumns[colId][index] = tripToSave; break; }
      }
    }
    setColumns(newColumns);
    setIsTripModalOpen(false);
  };

  const handleDeleteTrip = () => {
    if(!window.confirm("Sicuro di voler eliminare questo viaggio?")) return;
    let newColumns = { ...columns };
    for (const colId in newColumns) newColumns[colId] = newColumns[colId].filter(t => t.id !== editingTrip.id);
    setColumns(newColumns);
    setIsTripModalOpen(false);
  };

  const handleWhatsApp = (trip, e) => {
    e.stopPropagation();
    const pickupFormatted = trip.pickupTime ? format(new Date(trip.pickupTime), 'dd/MM/yyyy HH:mm') : 'N/D';
    const deliveryFormatted = trip.deliveryTime ? format(new Date(trip.deliveryTime), 'dd/MM/yyyy HH:mm') : 'N/D';
    const text = `*MISSIONE DI TRASPORTO: ${trip.ref}*\n\n*Cliente:* ${trip.customer}\n\n*RITIRO:*\n📍 ${trip.pickup || 'N/D'}\n🕒 ${pickupFormatted}\n\n*CONSEGNA:*\n📍 ${trip.delivery || 'N/D'}\n🕒 ${deliveryFormatted}\n\n*Note:* ${(trip.notes || []).join(', ') || 'Nessuna'}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const handleCopy = (trip, e) => {
    e.stopPropagation();
    const newTrip = { ...trip, id: 'trip-' + Date.now(), ref: trip.ref + '-COPY', status: 'UNASSIGNED' };
    setColumns({
      ...columns,
      'unassigned': [newTrip, ...(columns['unassigned'] || [])]
    });
  };

  const moveTripToPosition = (tripId, destColId, targetTripId = null) => {
    let sourceColId = null;
    let trip = null;
    
    for (const colId in columns) {
      const t = columns[colId].find(t => t.id === tripId);
      if (t) { sourceColId = colId; trip = { ...t }; break; }
    }
    if (!trip) return;
    // allow same column reordering: if (sourceColId === destColId && !targetTripId) return;

    const sourceCol = [...columns[sourceColId]];
    let destCol = sourceColId === destColId ? sourceCol : [...(columns[destColId] || [])];

    const sourceIndex = sourceCol.findIndex(t => t.id === tripId);
    sourceCol.splice(sourceIndex, 1);

    if (sourceColId === 'unassigned' && destColId !== 'unassigned') trip.status = 'ASSIGNED';
    else if (sourceColId !== 'unassigned' && destColId === 'unassigned') trip.status = 'UNASSIGNED';

    if (targetTripId) {
      const targetIndex = destCol.findIndex(t => t.id === targetTripId);
      if (targetIndex > -1) destCol.splice(targetIndex, 0, trip);
      else destCol.push(trip);
    } else {
      destCol.push(trip);
    }
    setColumns({ ...columns, [sourceColId]: sourceCol, [destColId]: destCol });
  };

  const onNativeDropCard = (e, destColId, targetTripId) => {
    e.currentTarget.classList.remove('!border-t-4', '!border-brand-blue', 'scale-[1.02]');
    e.preventDefault();
    e.stopPropagation();
    const type = e.dataTransfer.getData('type');
    if (type !== 'trip') return;
    const tripId = e.dataTransfer.getData('tripId');
    if (tripId && tripId !== targetTripId) moveTripToPosition(tripId, destColId, targetTripId);
    
    
  };

  const onNativeDrop = (e, destColId) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('type');
    
    // Drop Autisti (riordinamento)
    if (type === 'driver') {
      if (draggedDriverId && draggedDriverId !== destColId && destColId !== 'unassigned') {
        const newDrivers = [...drivers];
        const sourceIndex = newDrivers.findIndex(d => d.id === draggedDriverId);
        const targetIndex = newDrivers.findIndex(d => d.id === destColId);
        if (sourceIndex > -1 && targetIndex > -1) {
          const [moved] = newDrivers.splice(sourceIndex, 1);
          newDrivers.splice(targetIndex, 0, moved);
          setDrivers(newDrivers);
        }
      }
      setDraggedDriverId(null);
      return;
    }

    // Drop Viaggi
    const tripId = e.dataTransfer.getData('tripId');
    if (tripId) moveTripToPosition(tripId, destColId, null);
  };

  // --- RENDERERS ---
  const displayedColumns = useMemo(() => {
    if (viewMode === 'TOTAL' || viewMode === 'TIMELINE') return columns;
    const filtered = {};
    for (const colId in columns) {
      filtered[colId] = columns[colId].filter(trip => {
        const start = (trip.pickupTime || '').slice(0, 10);
        const end = (trip.deliveryTime || '').slice(0, 10);
        if (!start && !end) return false;
        if (trip.status === 'ADMIN') return selectedDate >= start && selectedDate <= end;
        else return selectedDate === start || selectedDate === end;
      });
    }
    return filtered;
  }, [columns, viewMode, selectedDate]);

  const renderKanbanCard = (trip, colId) => {
    const isSpecial = trip.status === 'ADMIN';

    return (
      <div
        draggable
        onDragStart={e => {
          e.stopPropagation();
          e.dataTransfer.setData('tripId', trip.id);
          e.dataTransfer.setData('type', 'trip');
        }}
        onClick={() => handleOpenTripModal(trip)}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
        onDragEnter={e => { e.preventDefault(); e.currentTarget.classList.add('!border-t-4', '!border-brand-blue', 'scale-[1.02]'); }}
        onDragLeave={e => { e.preventDefault(); e.currentTarget.classList.remove('!border-t-4', '!border-brand-blue', 'scale-[1.02]'); }}
        
        
        onDrop={e => onNativeDropCard(e, colId, trip.id)}
        className={`mb-3 p-4 rounded-xl border-l-4 bg-slate-950 border-y border-r border-y-slate-800 border-r-slate-800 shadow-lg transition-all cursor-grab active:cursor-grabbing hover:border-r-slate-600 hover:bg-slate-900/80 ${STATUS_COLORS[trip.status].split(' ')[0]} `}
      >
        {isSpecial ? (
          <>
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center">
                <Briefcase className="mr-3 text-fuchsia-500" size={24} />
                <h3 className="text-xl font-bold text-fuchsia-400 uppercase tracking-widest">{trip.title || trip.customer}</h3>
              </div>
            </div>
            <div className="flex flex-col gap-1 mt-2 text-xs font-mono text-slate-400 bg-slate-900/50 p-2 rounded-lg border border-slate-800">
                <div className="flex justify-between"><span>Dal:</span> <span>{trip.pickupTime ? format(new Date(trip.pickupTime), "dd/MM HH:mm") : 'N/D'}</span></div>
                <div className="flex justify-between"><span>Al:</span> <span>{trip.deliveryTime ? format(new Date(trip.deliveryTime), "dd/MM HH:mm") : 'N/D'}</span></div>
            </div>
          </>
        ) : (
          <>
            <div className="flex justify-between items-start mb-3">
              <div>
                <h4 className="font-bold text-white leading-tight">{trip.customer}</h4>
                <span className="text-xs font-mono text-slate-500">{trip.ref}</span>
              </div>
              <div className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${STATUS_COLORS[trip.status]}`}>{trip.status.replace('_', ' ')}</div>
            </div>
            <div className="space-y-3 mb-4 relative">
              <div className="absolute left-2 top-3 bottom-3 w-px bg-slate-700"></div>
              <div className="flex items-start gap-3 relative z-10">
                <div className="mt-1 bg-slate-950 p-0.5 rounded-full"><MapPin size={14} className="text-brand-blue" /></div>
                <div>
                  <div className="text-sm text-slate-300 font-semibold">{trip.pickup || 'N/D'}</div>
                  <div className="text-[11px] font-mono text-slate-500 flex items-center gap-1"><Calendar size={10} /> {trip.pickupTime ? format(new Date(trip.pickupTime), "dd MMM HH:mm", { locale: it }) : 'N/A'}</div>
                </div>
              </div>
              <div className="flex items-start gap-3 relative z-10">
                <div className="mt-1 bg-slate-950 p-0.5 rounded-full"><MapPin size={14} className="text-emerald-500" /></div>
                <div>
                  <div className="text-sm text-slate-300 font-semibold">{trip.delivery || 'N/D'}</div>
                  <div className="text-[11px] font-mono text-slate-500 flex items-center gap-1"><Calendar size={10} /> {trip.deliveryTime ? format(new Date(trip.deliveryTime), "dd MMM HH:mm", { locale: it }) : 'N/A'}</div>
                </div>
              </div>
            </div>
          </>
        )}
        
        {trip.notes && trip.notes.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {trip.notes.map((note, idx) => (
              <span key={idx} className="bg-slate-900 text-slate-400 text-[10px] font-bold px-2 py-1 rounded-md border border-slate-700/50 flex items-center gap-1">
                <FileText size={10} /> {note}
              </span>
            ))}
          </div>
        )}
        
        <div className="flex justify-end gap-2 border-t border-slate-800/50 pt-2 mt-2">
          <button onClick={(e) => { e.stopPropagation(); handleOpenTripModal(trip); }} className="p-1.5 rounded-lg bg-slate-900 text-slate-400 hover:text-white transition-colors" title="Modifica"><Edit2 size={14} /></button>
          {!isSpecial && (
            <>
              <button onClick={(e) => handleCopy(trip, e)} className="p-1.5 rounded-lg bg-slate-900 text-slate-400 hover:text-white transition-colors" title="Duplica"><Copy size={14} /></button>
              <button onClick={(e) => handleWhatsApp(trip, e)} className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white transition-colors" title="WhatsApp"><MessageCircle size={14} /></button>
            </>
          )}
        </div>
      </div>
    );
  };

  const renderTimeline = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      return d;
    });

    const HOUR_WIDTH = 12; // px per ora
    const DAY_WIDTH = 24 * HOUR_WIDTH;
    const TOTAL_WIDTH = 7 * DAY_WIDTH;

    return (
      <div className="flex flex-1 bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden shadow-2xl relative">
        <div className="flex-1 overflow-auto custom-scrollbar relative flex bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTAgMGgyNHYyNEgweiIgZmlsbD0ibm9uZSIvPjxwYXRoIGQ9Ik0yNCAwdjI0SDBWMHoiIGZpbGw9Im5vbmUiLz48cGF0aCBkPSJNMCAwdjI0aDFWMHoiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wNSkiLz48L3N2Zz4=')]">
          
          <div className="w-64 shrink-0 bg-slate-900/90 border-r border-slate-800 flex flex-col sticky left-0 z-30 backdrop-blur-md">
            <div className="h-16 shrink-0 border-b border-slate-800 p-4 font-bold text-slate-400 uppercase text-xs tracking-widest flex items-center bg-slate-900 sticky top-0 z-40">
              Risorse (Autisti)
            </div>
            {drivers.map(driver => (
              <div 
                key={driver.id} 
                draggable
                onDragStart={(e) => {
                  setDraggedDriverId(driver.id);
                  e.dataTransfer.setData('type', 'driver');
                }}
                onDragOver={e => e.preventDefault()}
                onDrop={e => onNativeDrop(e, driver.id)}
                className={`h-24 shrink-0 border-b border-slate-800/50 p-4 flex flex-col justify-center group relative cursor-pointer transition-colors ${draggedDriverId === driver.id ? 'opacity-50 bg-slate-800' : 'hover:bg-slate-800/80'}`}
                onClick={() => handleOpenDriverModal(driver)}
              >
                <div className="absolute left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-slate-600 cursor-grab"><GripVertical size={14}/></div>
                <h3 className="font-bold text-white text-sm truncate ml-2">{driver.name}</h3>
                <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-1 truncate ml-2"><Truck size={10} className="shrink-0"/> {driver.vehicle}</div>
              </div>
            ))}
            
            <button onClick={() => handleOpenDriverModal()} className="h-16 shrink-0 border-b border-dashed border-slate-800 p-4 flex items-center justify-center text-slate-500 hover:text-white hover:bg-slate-800/80 transition-colors font-bold text-xs gap-2">
              <Plus size={14} /> AGGIUNGI MEZZO
            </button>
          </div>

          <div className="flex flex-col" style={{ width: TOTAL_WIDTH }}>
            <div className="h-16 shrink-0 flex border-b border-slate-800 bg-slate-900/95 sticky top-0 z-20 shadow-sm backdrop-blur-md">
              {days.map((d, i) => (
                <div key={i} className="border-r border-slate-800/50 relative" style={{ width: DAY_WIDTH }}>
                  <div className="absolute top-0 left-0 right-0 p-1.5 text-center text-xs font-bold text-slate-300 bg-slate-800/40 border-b border-slate-800/50">
                    {format(d, 'EEEE dd MMM', { locale: it })}
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 flex text-[9px] text-slate-500 font-mono">
                    {[0,6,12,18].map(h => (
                      <div key={h} className="border-l border-slate-800/40 pl-1 pb-1 flex items-end h-7" style={{ width: DAY_WIDTH / 4 }}>{h}:00</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {drivers.map(driver => (
              <div 
                key={driver.id} 
                className={`h-24 shrink-0 border-b border-slate-800/30 relative hover:bg-white/[0.02] transition-colors group ${draggedDriverId === driver.id ? 'bg-slate-800/20' : ''}`}
                onDragOver={e => e.preventDefault()}
                onDrop={e => onNativeDrop(e, driver.id)}
              >
                <div className="absolute inset-0 pointer-events-none flex">
                   {Array.from({length: 7*4}).map((_, i) => (
                     <div key={i} className="border-l border-slate-800/20 h-full" style={{ width: DAY_WIDTH / 4 }}></div>
                   ))}
                </div>

                {displayedColumns[driver.id]?.map(trip => {
                  const pTime = new Date(trip.pickupTime || today);
                  const dTime = new Date(trip.deliveryTime || new Date(pTime.getTime() + 7200000));
                  const startDiffHours = differenceInMinutes(pTime, today) / 60;
                  const durationHours = differenceInMinutes(dTime, pTime) / 60;
                  const leftPx = startDiffHours * HOUR_WIDTH;
                  const widthPx = Math.max(80, durationHours * HOUR_WIDTH);
                  if (leftPx + widthPx < 0 || leftPx > TOTAL_WIDTH) return null;
                  const isSpecial = trip.status === 'ADMIN';

                  return (
                    <div 
                      key={trip.id}
                      draggable
                      onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData('tripId', trip.id); e.dataTransfer.setData('type', 'trip'); }}
                      onClick={() => handleOpenTripModal(trip)}
                      className={`absolute top-3 bottom-3 rounded-lg border shadow-lg cursor-grab active:cursor-grabbing p-2 overflow-hidden flex flex-col justify-center transition-all hover:scale-[1.02] hover:z-50 hover:shadow-brand-blue/20 group/card ${STATUS_COLORS[trip.status]} ${STATUS_BG[trip.status]}`}
                      style={{ left: `${Math.max(0, leftPx)}px`, width: `${widthPx}px`, borderLeftWidth: '4px' }}
                    >
                      {isSpecial ? (
                        <div className="font-bold text-[10px] uppercase truncate flex items-center gap-1"><Briefcase size={10}/> {trip.title || 'ADMIN'}</div>
                      ) : (
                        <>
                          <div className="font-bold text-xs truncate text-white leading-tight pr-6">{trip.customer}</div>
                          <div className="text-[9px] truncate text-slate-400 mt-0.5">{trip.pickup?.split(' ')[0]} ➔ {trip.delivery?.split(' ')[0]}</div>
                          <div className="text-[8px] font-mono mt-1 opacity-70">{trip.pickupTime ? format(pTime, "HH:mm") : '--:--'} - {trip.deliveryTime ? format(dTime, "HH:mm") : '--:--'}</div>
                        </>
                      )}

                      {trip.notes && trip.notes.length > 0 && !isSpecial && (
                        <div className="flex gap-1 mt-1">
                          <span className="bg-slate-900 text-slate-400 text-[8px] font-bold px-1.5 py-0.5 rounded border border-slate-700/50">+{trip.notes.length} note</span>
                        </div>
                      )}

                      {!isSpecial && (
                        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex flex-col justify-center gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity bg-slate-900/90 px-1 py-1 rounded backdrop-blur z-20">
                          <button onClick={(e) => handleCopy(trip, e)} className="p-1 rounded text-slate-300 hover:text-white hover:bg-slate-700" title="Duplica"><Copy size={12} /></button>
                          <button onClick={(e) => handleWhatsApp(trip, e)} className="p-1 rounded text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/20" title="WhatsApp"><MessageCircle size={12} /></button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  if (loading) return <div className="flex h-screen items-center justify-center bg-brand-black"><div className="text-white text-xl animate-pulse">Caricamento TMS...</div></div>;

  return (
    <div className="flex flex-col h-screen bg-brand-black overflow-hidden relative">
      <div className="p-4 pb-4 shrink-0 border-b border-slate-800 bg-slate-900/50 backdrop-blur-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 z-30">
        <div className="flex flex-col md:flex-row items-start md:items-center gap-4 md:gap-6 w-full md:w-auto">
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Truck className="text-brand-blue" size={28} />
            TMS Board
          </h1>
          <div className="flex items-center bg-slate-950 rounded-lg p-1 border border-slate-800 shadow-inner">
            <button onClick={() => setViewMode('TOTAL')} className={`px-4 py-1.5 rounded-md text-sm font-bold flex items-center gap-2 transition-all ${viewMode === 'TOTAL' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}><LayoutTemplate size={16} /> Totale</button>
            <button onClick={() => setViewMode('CALENDAR')} className={`px-4 py-1.5 rounded-md text-sm font-bold flex items-center gap-2 transition-all ${viewMode === 'CALENDAR' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}><CalendarDays size={16} /> Giorno</button>
            <button onClick={() => setViewMode('TIMELINE')} className={`px-4 py-1.5 rounded-md text-sm font-bold flex items-center gap-2 transition-all ${viewMode === 'TIMELINE' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}><StretchHorizontal size={16} /> Timeline</button>
          </div>
          {viewMode === 'CALENDAR' && (
            <div className="flex items-center gap-3 bg-brand-blue/10 border border-brand-blue/30 px-3 py-1.5 rounded-lg">
              <Calendar size={18} className="text-brand-blue" />
              <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="bg-transparent text-white font-bold outline-none [color-scheme:dark] text-sm" />
            </div>
          )}
        </div>
        <button onClick={() => handleOpenTripModal()} className="px-4 py-2 bg-brand-blue text-brand-black font-bold text-sm rounded-lg hover:bg-sky-400 transition-colors flex items-center gap-2 shadow-[0_0_15px_rgba(56,189,248,0.3)]">
          <Plus size={18} /> Nuova Card
        </button>
      </div>

      <div className="flex-1 overflow-y-auto lg:overflow-hidden p-2 md:p-4 flex flex-col lg:flex-row gap-4">
        
        {/* UNASSIGNED COMMON LIST */}
        <div 
          className="w-full lg:w-72 shrink-0 flex flex-col h-[40vh] lg:h-full bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl"
          onDragOver={e => e.preventDefault()}
          onDrop={e => onNativeDrop(e, 'unassigned')}
        >
          <div className="p-3 bg-slate-950/80 border-b border-slate-800 flex justify-between items-center backdrop-blur-md">
            <h2 className="font-bold text-slate-300 text-sm">Da Assegnare</h2>
            <span className="bg-slate-800 text-slate-300 text-xs font-bold px-2 py-0.5 rounded-full">{displayedColumns['unassigned']?.length || 0}</span>
          </div>
          <div className="flex-1 p-3 overflow-y-auto custom-scrollbar">
            {displayedColumns['unassigned']?.map(trip => (
              viewMode === 'TIMELINE' ? (
                // Compact Timeline Unassigned Card
                <div 
                  key={trip.id}
                  draggable
                  onDragStart={e => { e.dataTransfer.setData('tripId', trip.id); e.dataTransfer.setData('type', 'trip'); }}
                  onClick={() => handleOpenTripModal(trip)}
                  className={`mb-2 p-3 rounded-xl border-l-4 border-y border-r border-y-slate-800 border-r-slate-800 shadow-lg cursor-grab active:cursor-grabbing hover:bg-slate-800/50 transition-colors ${STATUS_COLORS[trip.status]} ${STATUS_BG[trip.status]} group/card relative`}
                >
                  <div className="font-bold text-white text-sm truncate pr-6">{trip.customer}</div>
                  <div className="text-[10px] text-slate-400 truncate mt-1">{trip.pickup?.split(' ')[0] || 'N/D'} ➔ {trip.delivery?.split(' ')[0] || 'N/D'}</div>
                  <div className="text-[9px] text-slate-500 font-mono mt-1">{trip.pickupTime ? format(new Date(trip.pickupTime), "dd/MM HH:mm") : 'N/D'}</div>
                  
                  {trip.notes && trip.notes.length > 0 && (
                    <div className="flex gap-1 mt-2">
                      <span className="bg-slate-900 text-slate-400 text-[8px] font-bold px-1.5 py-0.5 rounded border border-slate-700/50">+{trip.notes.length} note</span>
                    </div>
                  )}

                  <div className="absolute right-1 top-1/2 -translate-y-1/2 flex flex-col justify-center gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity bg-slate-900/90 px-1 py-1 rounded backdrop-blur z-20">
                    <button onClick={(e) => handleCopy(trip, e)} className="p-1 rounded text-slate-300 hover:text-white hover:bg-slate-700" title="Duplica"><Copy size={12} /></button>
                    <button onClick={(e) => handleWhatsApp(trip, e)} className="p-1 rounded text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/20" title="WhatsApp"><MessageCircle size={12} /></button>
                  </div>
                </div>
              ) : (
                // Full Kanban Unassigned Card
                <React.Fragment key={trip.id}>
                  {renderKanbanCard(trip, 'unassigned')}
                </React.Fragment>
              )
            ))}
          </div>
        </div>

        {viewMode === 'TIMELINE' ? (
          renderTimeline()
        ) : (
          <div className="flex-1 overflow-x-hidden overflow-y-visible lg:overflow-x-auto lg:overflow-y-hidden custom-scrollbar">
            <div className="flex flex-col lg:flex-row gap-4 h-auto lg:h-full items-start lg:min-w-max lg:pr-4">
              {drivers.map(driver => (
                <div 
                  key={driver.id} 
                  className={`w-full lg:w-80 shrink-0 flex flex-col h-[50vh] lg:h-full bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl transition-all ${draggedDriverId === driver.id ? 'opacity-50' : ''}`}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => onNativeDrop(e, driver.id)}
                >
                  <div 
                    draggable
                    onDragStart={e => { e.dataTransfer.setData('driverId', driver.id); e.dataTransfer.setData('type', 'driver'); setDraggedDriverId(driver.id); }}
                    onDragEnd={() => setDraggedDriverId(null)}
                    className="p-3 bg-slate-950/80 border-b border-slate-800 flex flex-col relative group backdrop-blur-md cursor-grab active:cursor-grabbing hover:bg-slate-900/90 transition-colors"
                  >
                    <div className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-600 opacity-0 group-hover:opacity-100"><GripVertical size={14}/></div>
                    <div className="flex justify-between items-center mb-1 ml-4">
                      <h2 className="font-bold text-white text-base pr-8 truncate">{driver.name}</h2>
                      <span className="bg-brand-blue/20 text-brand-blue text-[10px] font-bold px-1.5 py-0.5 rounded-full">{displayedColumns[driver.id]?.length || 0}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 flex items-center gap-1 truncate pr-8 ml-4"><Truck size={10} className="shrink-0" /> {driver.vehicle}</div>
                    <button onClick={(e) => { e.stopPropagation(); handleOpenDriverModal(driver); }} className="absolute top-3 right-10 p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity" title="Modifica"><Edit2 size={12} /></button>
                  </div>
                  
                  <div className="flex-1 p-3 overflow-y-auto custom-scrollbar">
                    {displayedColumns[driver.id]?.map(trip => (
                      <React.Fragment key={trip.id}>
                        {renderKanbanCard(trip, driver.id)}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              ))}
              
              <button onClick={() => handleOpenDriverModal()} className="w-full lg:w-16 shrink-0 py-6 lg:py-0 lg:h-[calc(100vh-200px)] border-2 border-dashed border-slate-800 rounded-2xl flex items-center justify-center text-slate-600 hover:text-white hover:border-slate-500 hover:bg-slate-800/50 transition-all shadow-lg lg:mt-4 mb-32 lg:mb-0">
                <div className="lg:rotate-90 font-bold whitespace-nowrap tracking-wider flex items-center gap-2">
                  <Plus size={16} /> AGGIUNGI MEZZO
                </div>
              </button>
            </div>
          </div>
        )}
      </div>
      
      {/* MODALS */}
      {isDriverModalOpen && (
        <div className="absolute inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-white">{editingDriver.isNew ? 'Nuovo Autista' : 'Modifica Autista'}</h2>
              <button onClick={() => setIsDriverModalOpen(false)} className="text-slate-400 hover:text-white"><X size={24} /></button>
            </div>
            <form onSubmit={handleSaveDriver} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Nome Autista</label>
                <input type="text" value={editingDriver.name} onChange={e => setEditingDriver({...editingDriver, name: e.target.value})} className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg p-2.5 outline-none focus:border-brand-blue" required />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Veicolo e Targa</label>
                <input type="text" value={editingDriver.vehicle} onChange={e => setEditingDriver({...editingDriver, vehicle: e.target.value})} className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg p-2.5 outline-none focus:border-brand-blue" required />
              </div>
              <div className="flex justify-between pt-4 border-t border-slate-800 mt-6">
                {!editingDriver.isNew ? <button type="button" onClick={handleDeleteDriver} className="p-2 bg-rose-500/10 text-rose-500 rounded-lg hover:bg-rose-500 hover:text-white transition-colors"><Trash2 size={18} /></button> : <div></div>}
                <div className="flex gap-2">
                  <button type="button" onClick={() => setIsDriverModalOpen(false)} className="px-4 py-2 bg-slate-800 text-slate-300 font-bold rounded-lg hover:bg-slate-700">Annulla</button>
                  <button type="submit" className="px-4 py-2 bg-brand-blue text-brand-black font-bold rounded-lg hover:bg-sky-400 flex items-center gap-2"><Check size={18} /> Salva</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {isTripModalOpen && (
        <div className="absolute inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-2xl shadow-2xl w-full max-w-2xl overflow-y-auto max-h-[90vh] custom-scrollbar">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-white">{editingTrip.isNew ? 'Nuova Card' : 'Modifica Card'}</h2>
              <button onClick={() => setIsTripModalOpen(false)} className="text-slate-400 hover:text-white"><X size={24} /></button>
            </div>
            <form onSubmit={handleSaveTrip} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1">Status (Colore)</label>
                  <select value={editingTrip.status} onChange={e => setEditingTrip({...editingTrip, status: e.target.value})} className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg p-2.5 outline-none focus:border-brand-blue">
                    <option value="UNASSIGNED">Da Assegnare</option>
                    <option value="ASSIGNED">Assegnato</option>
                    <option value="IN_TRANSIT">In Viaggio</option>
                    <option value="DELIVERED">Consegnato</option>
                    <option value="EXCEPTION">Eccezione / Ritardo</option>
                    <option value="ADMIN">Amministrativo / Ferie</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1">Riferimento (Ref)</label>
                  <input type="text" value={editingTrip.ref} onChange={e => setEditingTrip({...editingTrip, ref: e.target.value})} className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg p-2.5 outline-none focus:border-brand-blue" required />
                </div>
              </div>

              {editingTrip.status === 'ADMIN' ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 mb-1">Titolo Evento Speciale</label>
                    <input type="text" value={editingTrip.title || ''} onChange={e => setEditingTrip({...editingTrip, title: e.target.value})} className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg p-2.5 outline-none focus:border-fuchsia-500" required />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-950/50 p-4 rounded-xl border border-slate-800">
                      <div className="text-slate-300 font-bold mb-3 flex items-center gap-2"><Calendar size={16}/> Data Inizio Evento</div>
                      <input type="datetime-local" value={(editingTrip.pickupTime || '').slice(0, 16).replace('Z','')} onChange={e => setEditingTrip({...editingTrip, pickupTime: e.target.value})} className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg p-2.5 outline-none focus:border-fuchsia-500 [color-scheme:dark]" />
                    </div>
                    <div className="bg-slate-950/50 p-4 rounded-xl border border-slate-800">
                      <div className="text-slate-300 font-bold mb-3 flex items-center gap-2"><Calendar size={16}/> Data Fine Evento</div>
                      <input type="datetime-local" value={(editingTrip.deliveryTime || '').slice(0, 16).replace('Z','')} onChange={e => setEditingTrip({...editingTrip, deliveryTime: e.target.value})} className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg p-2.5 outline-none focus:border-fuchsia-500 [color-scheme:dark]" />
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 mb-1">Cliente</label>
                    <input type="text" value={editingTrip.customer} onChange={e => setEditingTrip({...editingTrip, customer: e.target.value})} className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg p-2.5 outline-none focus:border-brand-blue" required />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800 hover:border-brand-blue/50">
                      <div className="text-brand-blue font-bold mb-2 flex items-center gap-2"><MapPin size={16}/> Ritiro</div>
                      <input type="text" placeholder="Luogo" value={editingTrip.pickup} onChange={e => setEditingTrip({...editingTrip, pickup: e.target.value})} className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg p-2.5 outline-none focus:border-brand-blue mb-2" />
                      <input type="datetime-local" value={(editingTrip.pickupTime || '').slice(0, 16).replace('Z','')} onChange={e => setEditingTrip({...editingTrip, pickupTime: e.target.value})} className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg p-2.5 outline-none focus:border-brand-blue [color-scheme:dark]" />
                    </div>
                    <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800 hover:border-emerald-500/50">
                      <div className="text-emerald-500 font-bold mb-2 flex items-center gap-2"><MapPin size={16}/> Consegna</div>
                      <input type="text" placeholder="Luogo" value={editingTrip.delivery} onChange={e => setEditingTrip({...editingTrip, delivery: e.target.value})} className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg p-2.5 outline-none focus:border-emerald-500 mb-2" />
                      <input type="datetime-local" value={(editingTrip.deliveryTime || '').slice(0, 16).replace('Z','')} onChange={e => setEditingTrip({...editingTrip, deliveryTime: e.target.value})} className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg p-2.5 outline-none focus:border-emerald-500 [color-scheme:dark]" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-400 mb-1">Ricavo EUR</label>
                      <input type="number" step="0.01" value={editingTrip.revenue} onChange={e => setEditingTrip({...editingTrip, revenue: e.target.value})} className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg p-2.5 outline-none focus:border-brand-blue" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 mb-1">Costi Straordinari EUR</label>
                      <input type="number" step="0.01" value={editingTrip.cost} onChange={e => setEditingTrip({...editingTrip, cost: e.target.value})} className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg p-2.5 outline-none focus:border-brand-blue" />
                    </div>
                  </div>
                </>
              )}
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Note Custom</label>
                <input type="text" value={Array.isArray(editingTrip.notes) ? editingTrip.notes.join(', ') : editingTrip.notes} onChange={e => setEditingTrip({...editingTrip, notes: e.target.value})} className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg p-2.5 outline-none focus:border-brand-blue" />
              </div>
              <div className="flex justify-between pt-4 border-t border-slate-800 mt-6">
                {!editingTrip.isNew ? <button type="button" onClick={handleDeleteTrip} className="px-4 py-2 bg-rose-500/10 text-rose-500 font-bold rounded-lg hover:bg-rose-500 hover:text-white flex items-center gap-2"><Trash2 size={16} /> Elimina</button> : <div></div>}
                <div className="flex gap-2">
                  <button type="button" onClick={() => setIsTripModalOpen(false)} className="px-4 py-2 bg-slate-800 text-slate-300 font-bold rounded-lg hover:bg-slate-700">Annulla</button>
                  <button type="submit" className="px-6 py-2 bg-brand-blue text-brand-black font-bold rounded-lg hover:bg-sky-400 flex items-center gap-2"><Check size={18} /> Salva</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default TMSDashboard;
