import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Truck,
  MapPin,
  Calendar,
  Clock,
  Euro,
  MessageCircle,
  Copy,
  AlertTriangle,
  Briefcase,
  FileText,
  Plus,
  Edit2,
  X,
  Check,
  Trash2,
  CalendarDays,
  StretchHorizontal,
  GripVertical,
  ChevronLeft,
  ChevronRight,
  Search,
  TrendingUp,
  UserCheck,
  Phone,
  ArrowRight,
  CheckCircle2,
  Navigation,
  Filter,
  Sparkles,
  RotateCcw
} from 'lucide-react';
import { format, addDays, subDays, isSameDay } from 'date-fns';
import { it } from 'date-fns/locale';
import { appAlert, appConfirm } from '../../utils/alerts';
import { hasPerm } from '../../utils/permissions';
import axios from 'axios';
import { io } from 'socket.io-client';

const INITIAL_DRIVERS = [
  { id: 'driver-1', name: 'Mario Rossi', vehicle: 'IVECO Stralis - AB123CD', phone: '' },
  { id: 'driver-2', name: 'Luigi Verdi', vehicle: 'Scania R500 - EF456GH', phone: '' },
  { id: 'driver-3', name: 'Antonio Neri', vehicle: 'Mercedes Actros - LM789NO', phone: '' }
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

const STATUS_META = {
  'UNASSIGNED': {
    label: 'Da Assegnare',
    shortLabel: 'Libero',
    cardClass: 'border-slate-600/80 bg-slate-900/90 text-slate-300 border-l-4 border-l-slate-500',
    badgeClass: 'bg-slate-800 text-slate-300 border-slate-700',
    timelineClass: 'bg-slate-800/95 border-slate-600 text-slate-200',
    dotClass: 'bg-slate-400'
  },
  'ASSIGNED': {
    label: 'Assegnato',
    shortLabel: 'Assegnato',
    cardClass: 'border-brand-blue/40 bg-slate-900/95 text-slate-100 border-l-4 border-l-brand-blue',
    badgeClass: 'bg-brand-blue/15 text-brand-blue border-brand-blue/30',
    timelineClass: 'bg-brand-blue/20 border-brand-blue text-sky-100',
    dotClass: 'bg-brand-blue'
  },
  'IN_TRANSIT': {
    label: 'In Viaggio',
    shortLabel: 'In Viaggio',
    cardClass: 'border-amber-500/40 bg-slate-900/95 text-slate-100 border-l-4 border-l-amber-500',
    badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    timelineClass: 'bg-amber-500/20 border-amber-500 text-amber-100',
    dotClass: 'bg-amber-400 animate-pulse'
  },
  'DELIVERED': {
    label: 'Consegnato',
    shortLabel: 'Consegnato',
    cardClass: 'border-emerald-500/40 bg-slate-900/95 text-slate-100 border-l-4 border-l-emerald-500',
    badgeClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    timelineClass: 'bg-emerald-500/20 border-emerald-500 text-emerald-100',
    dotClass: 'bg-emerald-400'
  },
  'EXCEPTION': {
    label: 'Ritardo / Problema',
    shortLabel: 'Problema',
    cardClass: 'border-rose-500/50 bg-rose-950/20 text-slate-100 border-l-4 border-l-rose-500',
    badgeClass: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
    timelineClass: 'bg-rose-500/25 border-rose-500 text-rose-100',
    dotClass: 'bg-rose-500 animate-ping'
  },
  'ADMIN': {
    label: 'Ferie / Permesso / Officina',
    shortLabel: 'Assenza / Admin',
    cardClass: 'border-fuchsia-500/40 bg-fuchsia-950/15 text-fuchsia-200 border-l-4 border-l-fuchsia-500',
    badgeClass: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30',
    timelineClass: 'bg-fuchsia-500/20 border-fuchsia-500 text-fuchsia-100',
    dotClass: 'bg-fuchsia-400'
  }
};

const NEXT_STATUS_FLOW = {
  'UNASSIGNED': 'ASSIGNED',
  'ASSIGNED': 'IN_TRANSIT',
  'IN_TRANSIT': 'DELIVERED'
};

const TMSDashboard = () => {
  const [drivers, setDrivers] = useState([]);
  const [columns, setColumns] = useState({ unassigned: [] });
  const [boardVersion, setBoardVersion] = useState(1);
  const [isSyncing, setIsSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const canManageTMS = hasPerm('tms_manage');
  const getAuthHeaders = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('maglite_token')}` } });

  // Views: ONLY 'CALENDAR' (Kanban con le date) and 'TIMELINE' (Timeline orizzontale)
  const [viewMode, setViewMode] = useState('CALENDAR');
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [selectedDate, setSelectedDate] = useState(todayStr);

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [showAllUnassignedDates, setShowAllUnassignedDates] = useState(false);

  // Drag & Drop State
  const [draggedTrip, setDraggedTrip] = useState(null);
  const [draggedFrom, setDraggedFrom] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);

  // Modals State
  const [isTripModalOpen, setIsTripModalOpen] = useState(false);
  const [editingTrip, setEditingTrip] = useState(null);
  const [editingCol, setEditingCol] = useState(null);

  const [isDriverModalOpen, setIsDriverModalOpen] = useState(false);
  const [editingDriver, setEditingDriver] = useState(null);

  // Trip Form State (includes targetDriverId so trips can be assigned directly on creation)
  const [tripForm, setTripForm] = useState({
    customer: '',
    ref: '',
    pickup: '',
    pickupTime: '',
    delivery: '',
    deliveryTime: '',
    revenue: 0,
    cost: 0,
    status: 'UNASSIGNED',
    title: '',
    notes: '',
    targetDriverId: 'unassigned'
  });

  // Driver Form State
  const [driverForm, setDriverForm] = useState({
    name: '',
    vehicle: '',
    phone: ''
  });

  // Load State from Database & listen to real-time multi-user updates via Socket.IO
  const fetchTMS = async (silent = false) => {
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/tms`, getAuthHeaders());
      setDrivers(res.data.drivers || []);
      setColumns(res.data.columns || { unassigned: [] });
      if (res.data.version !== undefined) setBoardVersion(res.data.version);
    } catch (err) {
      if (!silent) console.error('Failed to load TMS from DB.', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTMS();
    const socket = io(`http://${window.location.hostname}:3000`);
    socket.on('tms_updated', () => {
      fetchTMS(true);
    });
    return () => {
      socket.disconnect();
    };
  }, []);

  const handleTmsError = async (err, fallbackMsg) => {
    const status = err?.response?.status;
    const msg = err?.response?.data?.error || fallbackMsg;
    await fetchTMS(true);
    appAlert(status === 409 || status === 404 ? `Conflitto multi-utente: ${msg}` : msg);
  };

  // Date navigation helpers (Frecce Sinistra / Destra)
  const handleShiftDate = (daysDelta) => {
    const base = new Date(`${selectedDate}T12:00:00`);
    const next = daysDelta >= 0 ? addDays(base, daysDelta) : subDays(base, Math.abs(daysDelta));
    setSelectedDate(format(next, 'yyyy-MM-dd'));
  };

  const handleResetToday = () => {
    setSelectedDate(new Date().toISOString().split('T')[0]);
  };

  const formattedSelectedDate = useMemo(() => {
    try {
      const d = new Date(`${selectedDate}T12:00:00`);
      return format(d, 'EEEE d MMMM yyyy', { locale: it });
    } catch {
      return selectedDate;
    }
  }, [selectedDate]);

  const isSelectedToday = selectedDate === todayStr;

  // Check if a trip overlaps with a given YYYY-MM-DD date
  const tripOverlapsDate = (trip, dateStr) => {
    if (!trip.pickupTime || !trip.deliveryTime) return true;
    const tStart = new Date(trip.pickupTime);
    const tEnd = new Date(trip.deliveryTime);
    const dayStart = new Date(`${dateStr}T00:00:00`);
    const dayEnd = new Date(`${dateStr}T23:59:59`);
    return tStart <= dayEnd && tEnd >= dayStart;
  };

  // Check if a trip matches search & status filters
  const tripMatchesFilters = (trip, driverName = '') => {
    if (statusFilter !== 'ALL' && trip.status !== statusFilter) {
      return false;
    }
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase().trim();
    const notesStr = Array.isArray(trip.notes) ? trip.notes.join(' ') : String(trip.notes || '');
    return (
      (trip.customer || '').toLowerCase().includes(q) ||
      (trip.ref || '').toLowerCase().includes(q) ||
      (trip.pickup || '').toLowerCase().includes(q) ||
      (trip.delivery || '').toLowerCase().includes(q) ||
      (trip.title || '').toLowerCase().includes(q) ||
      notesStr.toLowerCase().includes(q) ||
      driverName.toLowerCase().includes(q)
    );
  };

  // Drag & Drop Handlers
  const handleDragStart = (e, trip, sourceCol) => {
    if (!canManageTMS) return;
    setDraggedTrip(trip);
    setDraggedFrom(sourceCol);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, colId = null) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (colId && dragOverCol !== colId) {
      setDragOverCol(colId);
    }
  };

  const handleDragLeave = () => {
    setDragOverCol(null);
  };

  const handleDrop = async (e, targetCol) => {
    e.preventDefault();
    setDragOverCol(null);
    if (!canManageTMS) return;
    if (!draggedTrip || draggedFrom === targetCol) return;

    const movingTrip = draggedTrip;
    const fromCol = draggedFrom;
    setDraggedTrip(null);
    setDraggedFrom(null);

    const sourceList = [...(columns[fromCol] || [])].filter(t => t.id !== movingTrip.id);
    const targetList = [...(columns[targetCol] || [])];
    const updatedTrip = { ...movingTrip };
    if (targetCol !== 'unassigned' && updatedTrip.status === 'UNASSIGNED') {
      updatedTrip.status = 'ASSIGNED';
    } else if (targetCol === 'unassigned') {
      updatedTrip.status = 'UNASSIGNED';
    }
    targetList.push(updatedTrip);

    setColumns({
      ...columns,
      [fromCol]: sourceList,
      [targetCol]: targetList
    });

    setIsSyncing(true);
    try {
      await axios.patch(
        `http://${window.location.hostname}:3000/api/tms/trips/${encodeURIComponent(movingTrip.id)}/move`,
        {
          driver_id: targetCol,
          sort_order: targetList.length - 1,
          expected_version: movingTrip.version
        },
        getAuthHeaders()
      );
      await fetchTMS(true);
    } catch (err) {
      await handleTmsError(err, 'Errore nello spostamento del viaggio.');
    } finally {
      setIsSyncing(false);
    }
  };

  // Quick 1-click status change directly from card
  const handleQuickStatusChange = async (tripId, colId, newStatus) => {
    if (!canManageTMS) return appAlert('Permesso Gestione TMS richiesto.');
    setColumns(prev => ({
      ...prev,
      [colId]: (prev[colId] || []).map(t => (t.id === tripId ? { ...t, status: newStatus } : t))
    }));
    setIsSyncing(true);
    try {
      await axios.patch(
        `http://${window.location.hostname}:3000/api/tms/trips/${encodeURIComponent(tripId)}/status`,
        { status: newStatus },
        getAuthHeaders()
      );
      await fetchTMS(true);
    } catch (err) {
      await handleTmsError(err, 'Errore aggiornamento stato.');
    } finally {
      setIsSyncing(false);
    }
  };

  // Trip Actions
  const handleDuplicate = async (trip, colId) => {
    if (!canManageTMS) return appAlert('Permesso Gestione TMS richiesto per duplicare viaggi.');
    const newTrip = {
      ...trip,
      id: 'trip-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      driver_id: colId,
      ref: `${trip.ref}-COPY`,
      status: colId === 'unassigned' ? 'UNASSIGNED' : 'ASSIGNED'
    };
    setIsSyncing(true);
    try {
      await axios.post(`http://${window.location.hostname}:3000/api/tms/trips`, newTrip, getAuthHeaders());
      await fetchTMS(true);
    } catch (err) {
      await handleTmsError(err, 'Errore duplicazione viaggio.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDeleteTrip = async (tripId, colId) => {
    if (!canManageTMS) return appAlert('Permesso Gestione TMS richiesto per eliminare viaggi.');
    const confirmed = await appConfirm('Sei sicuro di voler eliminare definitivamente questo viaggio?', 'Elimina Viaggio');
    if (confirmed) {
      setIsSyncing(true);
      try {
        await axios.delete(`http://${window.location.hostname}:3000/api/tms/trips/${encodeURIComponent(tripId)}`, getAuthHeaders());
        await fetchTMS(true);
      } catch (err) {
        await handleTmsError(err, 'Errore eliminazione viaggio.');
      } finally {
        setIsSyncing(false);
      }
    }
  };

  /**
   * Opens the Trip Modal:
   * - If `trip` is provided: edits existing trip in `colId`
   * - If `trip` is null and `colId` is a driver ID (clicked '+' on driver card):
   *   pre-selects `targetDriverId = colId` and sets default status to `'ASSIGNED'`!
   */
  const handleOpenTripModal = (trip = null, colId = 'unassigned') => {
    if (!canManageTMS) return appAlert('Permesso Gestione TMS richiesto per creare o modificare viaggi.');
    if (trip) {
      setEditingTrip(trip);
      setEditingCol(colId);
      setTripForm({
        ...trip,
        pickupTime: trip.pickupTime ? format(new Date(trip.pickupTime), "yyyy-MM-dd'T'HH:mm") : '',
        deliveryTime: trip.deliveryTime ? format(new Date(trip.deliveryTime), "yyyy-MM-dd'T'HH:mm") : '',
        notes: Array.isArray(trip.notes) ? trip.notes.join(', ') : (trip.notes || ''),
        targetDriverId: colId || 'unassigned'
      });
    } else {
      const isDirectDriverAssign = colId && colId !== 'unassigned';
      setEditingTrip(null);
      setEditingCol(colId || 'unassigned');
      setTripForm({
        customer: '',
        ref: 'REF-' + Math.floor(1000 + Math.random() * 9000),
        pickup: '',
        pickupTime: `${selectedDate}T08:00`,
        delivery: '',
        deliveryTime: `${selectedDate}T18:00`,
        revenue: 0,
        cost: 0,
        status: isDirectDriverAssign ? 'ASSIGNED' : 'UNASSIGNED',
        title: '',
        notes: '',
        targetDriverId: colId || 'unassigned'
      });
    }
    setIsTripModalOpen(true);
  };

  const handleSaveTrip = async (e) => {
    e.preventDefault();
    if (!canManageTMS) return appAlert('Permesso Gestione TMS richiesto.');
    if (isSyncing) return;
    const notesArray = String(tripForm.notes || '')
      .split(',')
      .map(n => n.trim())
      .filter(n => n !== '');

    const destinationCol = tripForm.targetDriverId || editingCol || 'unassigned';
    let finalStatus = tripForm.status;
    if (destinationCol !== 'unassigned' && finalStatus === 'UNASSIGNED') {
      finalStatus = 'ASSIGNED';
    } else if (destinationCol === 'unassigned' && finalStatus !== 'ADMIN') {
      finalStatus = 'UNASSIGNED';
    }

    const tripData = {
      customer: tripForm.customer,
      ref: tripForm.ref,
      pickup: tripForm.pickup,
      pickupTime: tripForm.pickupTime ? new Date(tripForm.pickupTime).toISOString() : new Date().toISOString(),
      delivery: tripForm.delivery,
      deliveryTime: tripForm.deliveryTime ? new Date(tripForm.deliveryTime).toISOString() : new Date().toISOString(),
      revenue: Number(tripForm.revenue) || 0,
      cost: Number(tripForm.cost) || 0,
      status: finalStatus,
      title: tripForm.title,
      notes: notesArray,
      driver_id: destinationCol,
      expected_version: editingTrip?.version
    };

    setIsSyncing(true);
    try {
      if (editingTrip) {
        await axios.put(`http://${window.location.hostname}:3000/api/tms/trips/${encodeURIComponent(editingTrip.id)}`, tripData, getAuthHeaders());
      } else {
        tripData.id = 'trip-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        await axios.post(`http://${window.location.hostname}:3000/api/tms/trips`, tripData, getAuthHeaders());
      }
      setIsTripModalOpen(false);
      await fetchTMS(true);
    } catch (err) {
      await handleTmsError(err, 'Errore salvataggio viaggio.');
    } finally {
      setIsSyncing(false);
    }
  };

  // Driver Actions
  const handleOpenDriverModal = (driver = null) => {
    if (!canManageTMS) return appAlert('Permesso Gestione TMS richiesto per gestire gli autisti.');
    if (driver) {
      setEditingDriver(driver);
      setDriverForm({ name: driver.name, vehicle: driver.vehicle, phone: driver.phone || '' });
    } else {
      setEditingDriver(null);
      setDriverForm({ name: '', vehicle: '', phone: '' });
    }
    setIsDriverModalOpen(true);
  };

  const handleSaveDriver = async (e) => {
    e.preventDefault();
    if (!canManageTMS) return appAlert('Permesso Gestione TMS richiesto.');
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      if (editingDriver) {
        await axios.put(`http://${window.location.hostname}:3000/api/tms/drivers/${encodeURIComponent(editingDriver.id)}`, driverForm, getAuthHeaders());
      } else {
        const newId = 'driver-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        await axios.post(`http://${window.location.hostname}:3000/api/tms/drivers`, { id: newId, ...driverForm }, getAuthHeaders());
      }
      setIsDriverModalOpen(false);
      await fetchTMS(true);
    } catch (err) {
      await handleTmsError(err, 'Errore salvataggio autista.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDeleteDriver = async (driverId) => {
    if (!canManageTMS) return appAlert('Permesso Gestione TMS richiesto per eliminare autisti.');
    if (columns[driverId] && columns[driverId].length > 0) {
      appAlert('Non puoi eliminare un autista che ha viaggi assegnati! Sposta o elimina prima i suoi viaggi.');
      return;
    }
    if (await appConfirm('Sei sicuro di voler eliminare questo autista?', 'Elimina Autista')) {
      setIsSyncing(true);
      try {
        await axios.delete(`http://${window.location.hostname}:3000/api/tms/drivers/${encodeURIComponent(driverId)}`, getAuthHeaders());
        await fetchTMS(true);
      } catch (err) {
        await handleTmsError(err, 'Errore eliminazione autista.');
      } finally {
        setIsSyncing(false);
      }
    }
  };

  const handleSendWhatsApp = (driver, trip) => {
    if (!driver.phone) {
      appAlert(`Nessun numero di telefono salvato per ${driver.name}. Modifica l'anagrafica dell'autista per inserire il numero.`);
      return;
    }

    const cleanPhone = driver.phone.replace(/[^0-9+]/g, '');
    const pickupDate = format(new Date(trip.pickupTime), 'dd/MM/yyyy HH:mm');
    const deliveryDate = format(new Date(trip.deliveryTime), 'dd/MM/yyyy HH:mm');
    const notesStr = trip.notes && trip.notes.length > 0 ? trip.notes.join(', ') : 'Nessuna nota particolare';

    const message =
      `Ciao *${driver.name}*, ecco i dettagli del tuo prossimo viaggio:\n\n` +
      `*Cliente:* ${trip.customer} (Rif: ${trip.ref})\n` +
      `*Ritiro:* ${trip.pickup} - il ${pickupDate}\n` +
      `*Consegna:* ${trip.delivery} - il ${deliveryDate}\n` +
      `*Note:* ${notesStr}\n\n` +
      `Buon viaggio!`;

    const encodedMessage = encodeURIComponent(message);
    window.open(`https://wa.me/${cleanPhone}?text=${encodedMessage}`, '_blank');
  };

  // Filtered Columns for Kanban Date View
  const displayColumns = useMemo(() => {
    const filtered = {};
    Object.keys(columns).forEach(colId => {
      const driverObj = drivers.find(d => d.id === colId);
      const dName = driverObj ? `${driverObj.name} ${driverObj.vehicle}` : '';
      filtered[colId] = (columns[colId] || [])
        .filter(trip => {
          const dateMatch = colId === 'unassigned' && showAllUnassignedDates
            ? true
            : tripOverlapsDate(trip, selectedDate);
          return dateMatch && tripMatchesFilters(trip, dName);
        })
        .sort((a, b) => new Date(a.pickupTime) - new Date(b.pickupTime));
    });
    return filtered;
  }, [columns, drivers, selectedDate, searchTerm, statusFilter, showAllUnassignedDates]);

  // Count total unassigned trips across all dates (to notify user if some are on other days)
  const totalUnassignedAllDates = (columns['unassigned'] || []).length;

  // Timeline configuration anchored on `selectedDate` (7-day window starting from selectedDate)
  const timelineData = useMemo(() => {
    const start = new Date(`${selectedDate}T00:00:00`);
    const days = [];
    for (let i = 0; i < 7; i++) {
      days.push(addDays(start, i));
    }
    const end = new Date(days[6]);
    end.setHours(23, 59, 59, 999);
    return { start, end, days, totalHours: 7 * 24 };
  }, [selectedDate]);

  // KPI Metrics for the active view (Selected Day in Kanban, or 7-day window in Timeline)
  const kpiStats = useMemo(() => {
    let totalTrips = 0;
    let unassignedCount = 0;
    let inTransitCount = 0;
    let deliveredCount = 0;
    let exceptionCount = 0;
    let totalRevenue = 0;
    let totalCost = 0;
    let activeDriversCount = 0;

    const isTripInActiveWindow = (trip) => {
      if (viewMode === 'CALENDAR') {
        return tripOverlapsDate(trip, selectedDate);
      }
      const tStart = new Date(trip.pickupTime);
      const tEnd = new Date(trip.deliveryTime);
      return tStart <= timelineData.end && tEnd >= timelineData.start;
    };

    (columns['unassigned'] || []).forEach(t => {
      if (isTripInActiveWindow(t)) {
        totalTrips++;
        unassignedCount++;
        totalRevenue += Number(t.revenue) || 0;
        totalCost += Number(t.cost) || 0;
      }
    });

    drivers.forEach(d => {
      const dTrips = (columns[d.id] || []).filter(isTripInActiveWindow);
      if (dTrips.some(t => t.status !== 'ADMIN')) {
        activeDriversCount++;
      }
      dTrips.forEach(t => {
        if (t.status !== 'ADMIN') {
          totalTrips++;
        }
        if (t.status === 'IN_TRANSIT' || t.status === 'ASSIGNED') inTransitCount++;
        if (t.status === 'DELIVERED') deliveredCount++;
        if (t.status === 'EXCEPTION') exceptionCount++;
        totalRevenue += Number(t.revenue) || 0;
        totalCost += Number(t.cost) || 0;
      });
    });

    const netMargin = totalRevenue - totalCost;
    const marginPct = totalRevenue > 0 ? Math.round((netMargin / totalRevenue) * 100) : 0;

    return {
      totalTrips,
      unassignedCount,
      inTransitCount,
      deliveredCount,
      exceptionCount,
      totalRevenue,
      totalCost,
      netMargin,
      marginPct,
      activeDriversCount
    };
  }, [columns, drivers, selectedDate, viewMode, timelineData]);

  const getTimelineBlockStyle = (trip) => {
    const tStart = new Date(trip.pickupTime);
    const tEnd = new Date(trip.deliveryTime);

    if (tEnd < timelineData.start || tStart > timelineData.end) return { display: 'none' };

    const clampedStart = tStart < timelineData.start ? timelineData.start : tStart;
    const clampedEnd = tEnd > timelineData.end ? timelineData.end : tEnd;

    const totalWindowMs = timelineData.end.getTime() - timelineData.start.getTime();
    const offsetMs = clampedStart.getTime() - timelineData.start.getTime();
    const durationMs = Math.max(clampedEnd.getTime() - clampedStart.getTime(), 3600000);

    const leftPercent = (offsetMs / totalWindowMs) * 100;
    const widthPercent = (durationMs / totalWindowMs) * 100;

    return {
      left: `${Math.max(0, leftPercent)}%`,
      width: `${Math.min(100 - leftPercent, Math.max(widthPercent, 2.5))}%`
    };
  };

  const renderTripCard = (trip, colId) => {
    const isException = trip.status === 'EXCEPTION';
    const isAdmin = trip.status === 'ADMIN';
    const meta = STATUS_META[trip.status] || STATUS_META['UNASSIGNED'];
    const driverObj = drivers.find(d => d.id === colId);
    const margin = (Number(trip.revenue) || 0) - (Number(trip.cost) || 0);
    const nextStatus = NEXT_STATUS_FLOW[trip.status];

    return (
      <div
        key={trip.id}
        draggable={canManageTMS}
        onDragStart={(e) => handleDragStart(e, trip, colId)}
        className={`p-3.5 rounded-xl border ${meta.cardClass} mb-3 ${canManageTMS ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'} shadow-lg transition-all hover:border-slate-500/80 hover:shadow-xl relative group select-none`}
      >
        {/* Top Header: Status Pill + Ref + Quick Actions */}
        <div className="flex justify-between items-start gap-2 mb-2.5">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <GripVertical size={14} className="text-slate-600 group-hover:text-slate-400 transition-colors shrink-0 -ml-1" />
            <span className={`inline-flex items-center gap-1.5 text-[10px] font-black px-2 py-0.5 rounded-md border uppercase tracking-wider ${meta.badgeClass}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${meta.dotClass}`} />
              {meta.shortLabel}
            </span>
            {!isAdmin && (
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-950/70 text-slate-400 border border-slate-800 truncate">
                {trip.ref}
              </span>
            )}
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center gap-0.5 opacity-85 group-hover:opacity-100 transition-opacity bg-slate-950/90 px-1.5 py-1 rounded-lg border border-slate-800 shrink-0">
            {canManageTMS && !isAdmin && nextStatus && colId !== 'unassigned' && (
              <button
                type="button"
                onClick={() => handleQuickStatusChange(trip.id, colId, nextStatus)}
                title={`Avanza stato a: ${STATUS_META[nextStatus]?.label}`}
                className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/15 p-1 rounded transition-colors"
              >
                <CheckCircle2 size={13} />
              </button>
            )}
            {canManageTMS && (
              <button
                type="button"
                onClick={() => handleOpenTripModal(trip, colId)}
                title="Modifica Viaggio"
                className="text-slate-400 hover:text-brand-blue hover:bg-brand-blue/10 p-1 rounded transition-colors"
              >
                <Edit2 size={13} />
              </button>
            )}
            {canManageTMS && !isAdmin && (
              <button
                type="button"
                onClick={() => handleDuplicate(trip, colId)}
                title="Duplica Viaggio"
                className="text-slate-400 hover:text-white hover:bg-slate-800 p-1 rounded transition-colors"
              >
                <Copy size={13} />
              </button>
            )}
            {!isAdmin && colId !== 'unassigned' && driverObj && (
              <button
                type="button"
                onClick={() => handleSendWhatsApp(driverObj, trip)}
                title="Invia dettagli su WhatsApp all'autista"
                className="text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 p-1 rounded transition-colors"
              >
                <MessageCircle size={13} />
              </button>
            )}
            {canManageTMS && (
              <button
                type="button"
                onClick={() => handleDeleteTrip(trip.id, colId)}
                title="Elimina Viaggio"
                className="text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 p-1 rounded transition-colors"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Customer / Admin Title */}
        <div className="mb-2.5">
          {isAdmin ? (
            <div className="flex items-center gap-2 font-bold text-sm text-fuchsia-300">
              <Briefcase size={15} className="shrink-0" />
              <span>{trip.title || trip.customer}</span>
            </div>
          ) : (
            <div className="font-bold text-white text-sm leading-snug flex items-center justify-between gap-2">
              <span className="truncate">{trip.customer}</span>
              {isException && (
                <span className="inline-flex items-center gap-1 text-[10px] font-black text-rose-400 bg-rose-500/15 px-1.5 py-0.5 rounded border border-rose-500/30 shrink-0">
                  <AlertTriangle size={11} /> ALERT
                </span>
              )}
            </div>
          )}
        </div>

        {/* Route Details (Pickup -> Delivery) */}
        {!isAdmin ? (
          <div className="space-y-2 text-xs bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 mb-2.5">
            <div className="flex items-start gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 mt-1 shrink-0 ring-4 ring-emerald-500/15" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400/90">Ritiro</span>
                  <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                    <Clock size={10} />
                    {format(new Date(trip.pickupTime), 'dd/MM HH:mm')}
                  </span>
                </div>
                <p className="font-bold text-slate-200 truncate">{trip.pickup || '-'}</p>
              </div>
            </div>

            <div className="border-t border-dashed border-slate-800/90 my-1" />

            <div className="flex items-start gap-2">
              <div className="w-2 h-2 rounded-full bg-rose-400 mt-1 shrink-0 ring-4 ring-rose-500/15" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400/90">Consegna</span>
                  <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                    <Clock size={10} />
                    {format(new Date(trip.deliveryTime), 'dd/MM HH:mm')}
                  </span>
                </div>
                <p className="font-bold text-slate-200 truncate">{trip.delivery || '-'}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-xs bg-slate-950/60 p-2.5 rounded-xl border border-fuchsia-500/20 mb-2.5 flex items-center justify-between text-fuchsia-200/80">
            <span className="flex items-center gap-1.5 font-medium">
              <Calendar size={12} /> Dal {format(new Date(trip.pickupTime), 'dd/MM HH:mm')}
            </span>
            <ArrowRight size={12} className="text-fuchsia-400" />
            <span className="font-medium">Al {format(new Date(trip.deliveryTime), 'dd/MM HH:mm')}</span>
          </div>
        )}

        {/* Notes Badges */}
        {trip.notes && trip.notes.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2.5">
            {trip.notes.map((n, idx) => (
              <span
                key={idx}
                className="text-[10px] bg-slate-950/80 text-slate-300 px-2 py-0.5 rounded-md border border-slate-800 flex items-center gap-1"
              >
                <FileText size={10} className="text-brand-blue shrink-0" /> {n}
              </span>
            ))}
          </div>
        )}

        {/* Financial Footer: Ricavo, Costo, Margine */}
        {!isAdmin && (
          <div className="flex justify-between items-center pt-2 border-t border-slate-800/80 text-[11px]">
            <div className="flex items-center gap-3">
              <span className="text-slate-400">
                Ricavo: <strong className="text-emerald-400 font-bold">€{Number(trip.revenue) || 0}</strong>
              </span>
              <span className="text-slate-400">
                Costo: <strong className="text-rose-400 font-bold">€{Number(trip.cost) || 0}</strong>
              </span>
            </div>
            <span
              className={`px-2 py-0.5 rounded font-black text-[10px] border ${
                margin >= 0
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                  : 'bg-rose-500/10 text-rose-400 border-rose-500/25'
              }`}
            >
              {margin >= 0 ? `+€${margin}` : `-€${Math.abs(margin)}`}
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col bg-slate-950 text-slate-100 overflow-hidden">
      {/* Top Control Header */}
      <div className="px-6 py-4 bg-slate-900/95 border-b border-slate-800 shrink-0 space-y-3.5">
        <div className="flex flex-wrap justify-between items-center gap-4">
          {/* Title */}
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-brand-blue/15 border border-brand-blue/30 flex items-center justify-center text-brand-blue shadow-lg shadow-brand-blue/10">
              <Truck size={24} />
            </div>
            <div>
              <h1 className="text-xl font-black text-white tracking-tight flex items-center gap-2.5 flex-wrap">
                TMS · Pianificazione Trasporti
                <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border ${isSyncing ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isSyncing ? 'bg-amber-400 animate-ping' : 'bg-emerald-400 animate-pulse'}`} />
                  {isSyncing ? 'Salvataggio...' : `Live Multi-Utente · v${boardVersion}`}
                </span>
              </h1>
              <p className="text-slate-400 text-xs">
                Gestione operativa viaggi, assegnazione rapida autisti e controllo marginalità
              </p>
            </div>
          </div>

          {/* Center: Date Navigation with Left & Right Arrows + View Switcher */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Date Navigator (< Date > + Oggi) */}
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 shadow-inner">
              <button
                type="button"
                onClick={() => handleShiftDate(-1)}
                title="Giorno precedente"
                className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors active:scale-95"
              >
                <ChevronLeft size={18} />
              </button>

              <div className="flex items-center gap-2 px-3 py-1 border-x border-slate-800/80">
                <Calendar size={15} className="text-brand-blue shrink-0" />
                <div className="flex flex-col">
                  <span className="text-[10px] font-black uppercase tracking-wider text-brand-blue leading-none mb-0.5 capitalize">
                    {viewMode === 'TIMELINE' ? 'Inizio Timeline (7 gg)' : formattedSelectedDate}
                  </span>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
                    className="bg-transparent text-xs text-white font-bold focus:outline-none cursor-pointer"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleShiftDate(1)}
                title="Giorno successivo"
                className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors active:scale-95"
              >
                <ChevronRight size={18} />
              </button>

              <button
                type="button"
                onClick={handleResetToday}
                title="Torna alla data di oggi"
                className={`ml-1 px-2.5 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${
                  isSelectedToday
                    ? 'bg-brand-blue/20 text-brand-blue border border-brand-blue/30'
                    : 'bg-slate-900 text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-800'
                }`}
              >
                Oggi
              </button>
            </div>

            {/* View Switcher: ONLY Kanban con le date & Timeline */}
            <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => setViewMode('CALENDAR')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${
                  viewMode === 'CALENDAR'
                    ? 'bg-brand-blue text-slate-950 shadow-lg shadow-brand-blue/20'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <CalendarDays size={15} /> Kanban Giornaliero
              </button>
              <button
                type="button"
                onClick={() => setViewMode('TIMELINE')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${
                  viewMode === 'TIMELINE'
                    ? 'bg-brand-blue text-slate-950 shadow-lg shadow-brand-blue/20'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <StretchHorizontal size={15} /> Timeline 7 Giorni
              </button>
            </div>

            {/* Action Buttons */}
            {canManageTMS && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleOpenDriverModal()}
                  className="bg-slate-800 hover:bg-slate-700 text-white font-bold px-3.5 py-2 rounded-xl flex items-center gap-2 text-xs border border-slate-700 transition-all shadow-sm"
                >
                  <Plus size={15} className="text-brand-blue" /> Nuovo Autista
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenTripModal(null, 'unassigned')}
                  className="bg-brand-blue hover:bg-sky-400 text-slate-950 font-black px-4 py-2 rounded-xl flex items-center gap-2 text-xs shadow-lg shadow-brand-blue/20 transition-all"
                >
                  <Plus size={16} /> Nuovo Viaggio
                </button>
              </div>
            )}
          </div>
        </div>

        {/* KPI Bar & Search/Filter Row */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 items-center pt-1">
          {/* 4 Compact KPI Cards */}
          <div className="xl:col-span-7 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl px-3.5 py-2.5 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Viaggi {viewMode === 'CALENDAR' ? 'del Giorno' : '(7 Giorni)'}
                </p>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="text-lg font-black text-white">{kpiStats.totalTrips}</span>
                  {kpiStats.unassignedCount > 0 && (
                    <span className="text-[10px] font-bold text-amber-400">
                      ({kpiStats.unassignedCount} da assegnare)
                    </span>
                  )}
                </div>
              </div>
              <div className="w-8 h-8 rounded-lg bg-brand-blue/10 border border-brand-blue/20 flex items-center justify-center text-brand-blue">
                <Navigation size={16} />
              </div>
            </div>

            <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl px-3.5 py-2.5 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Autisti Impegnati</p>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className="text-lg font-black text-white">{kpiStats.activeDriversCount}</span>
                  <span className="text-xs font-bold text-slate-500">/ {drivers.length}</span>
                </div>
              </div>
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                <UserCheck size={16} />
              </div>
            </div>

            <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl px-3.5 py-2.5 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Ricavi / Costi</p>
                <div className="flex items-baseline gap-2 mt-0.5 text-xs font-bold">
                  <span className="text-emerald-400 font-black text-sm">€{kpiStats.totalRevenue}</span>
                  <span className="text-slate-600">/</span>
                  <span className="text-rose-400 font-bold">€{kpiStats.totalCost}</span>
                </div>
              </div>
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <Euro size={16} />
              </div>
            </div>

            <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl px-3.5 py-2.5 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Margine Operativo</p>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span
                    className={`text-lg font-black ${
                      kpiStats.netMargin >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {kpiStats.netMargin >= 0 ? `+€${kpiStats.netMargin}` : `-€${Math.abs(kpiStats.netMargin)}`}
                  </span>
                  <span className="text-[10px] font-bold text-slate-400">({kpiStats.marginPct}%)</span>
                </div>
              </div>
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center border ${
                  kpiStats.netMargin >= 0
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                }`}
              >
                <TrendingUp size={16} />
              </div>
            </div>
          </div>

          {/* Search & Status Quick Filters */}
          <div className="xl:col-span-5 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Cerca cliente, rif, località, autista, note..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-brand-blue"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 overflow-x-auto">
              {[
                { id: 'ALL', label: 'Tutti' },
                { id: 'ASSIGNED', label: 'Assegnati' },
                { id: 'IN_TRANSIT', label: 'In Viaggio' },
                { id: 'DELIVERED', label: 'Consegnati' },
                { id: 'EXCEPTION', label: 'Problemi' }
              ].map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setStatusFilter(f.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap ${
                    statusFilter === f.id
                      ? 'bg-slate-800 text-brand-blue border border-brand-blue/30'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-5">
        {viewMode === 'TIMELINE' ? (
          /* ================= TIMELINE ORIZZONTALE (7 GIORNI) ================= */
          <div className="bg-slate-900 border border-slate-800 rounded-2xl h-full flex flex-col overflow-hidden shadow-2xl">
            {/* Timeline Navigation Sub-bar */}
            <div className="px-4 py-2.5 bg-slate-950/90 border-b border-slate-800 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-slate-300 font-bold">
                <StretchHorizontal size={15} className="text-brand-blue" />
                <span>
                  Finestra Temporale: dal{' '}
                  <strong className="text-white">{format(timelineData.start, 'dd MMM yyyy', { locale: it })}</strong> al{' '}
                  <strong className="text-white">{format(timelineData.end, 'dd MMM yyyy', { locale: it })}</strong>
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleShiftDate(-7)}
                  className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 font-bold flex items-center gap-1"
                >
                  <ChevronLeft size={13} /> -7 gg
                </button>
                <button
                  type="button"
                  onClick={() => handleShiftDate(7)}
                  className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 font-bold flex items-center gap-1"
                >
                  +7 gg <ChevronRight size={13} />
                </button>
              </div>
            </div>

            {/* Timeline Days Header */}
            <div className="flex border-b border-slate-800 bg-slate-950/60 shrink-0">
              <div className="w-72 shrink-0 p-3.5 border-r border-slate-800 font-black text-xs uppercase tracking-wider text-slate-400 flex items-center justify-between">
                <span>Autisti / Risorse</span>
                <span className="text-[10px] text-brand-blue font-bold">Clicca + per assegnare</span>
              </div>
              <div className="flex-1 grid grid-cols-7 divide-x divide-slate-800">
                {timelineData.days.map((d, i) => {
                  const dayIso = format(d, 'yyyy-MM-dd');
                  const isToday = dayIso === todayStr;
                  return (
                    <button
                      type="button"
                      key={i}
                      onClick={() => {
                        setSelectedDate(dayIso);
                        setViewMode('CALENDAR');
                      }}
                      title="Clicca per aprire il Kanban di questo giorno"
                      className={`p-2.5 text-center transition-colors hover:bg-slate-800/50 ${
                        isToday ? 'bg-brand-blue/10' : ''
                      }`}
                    >
                      <div className="text-[10px] text-slate-400 uppercase font-black tracking-wider">
                        {format(d, 'EEE', { locale: it })}
                      </div>
                      <div className={`text-sm font-black ${isToday ? 'text-brand-blue' : 'text-slate-200'}`}>
                        {format(d, 'dd MMM', { locale: it })}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Timeline Rows */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-800/70">
              {/* Optional Unassigned Row in Timeline if there are unassigned trips */}
              {(columns['unassigned'] || []).length > 0 && (
                <div
                  className="flex min-h-[84px] bg-slate-950/40 hover:bg-slate-900/60 transition-colors"
                  onDragOver={(e) => handleDragOver(e, 'unassigned')}
                  onDrop={(e) => handleDrop(e, 'unassigned')}
                >
                  <div className="w-72 shrink-0 p-3.5 border-r border-slate-800 flex items-center justify-between gap-2 bg-slate-950/60">
                    <div>
                      <div className="font-black text-amber-400 text-xs uppercase tracking-wider flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                        Da Assegnare ({(columns['unassigned'] || []).length})
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Trascina su un autista o clicca sul viaggio
                      </div>
                    </div>
                    {canManageTMS && (
                      <button
                        type="button"
                        onClick={() => handleOpenTripModal(null, 'unassigned')}
                        title="Nuovo viaggio da assegnare"
                        className="w-7 h-7 rounded-lg bg-amber-500/15 hover:bg-amber-500 text-amber-400 hover:text-slate-950 border border-amber-500/30 flex items-center justify-center transition-all shrink-0"
                      >
                        <Plus size={15} />
                      </button>
                    )}
                  </div>
                  <div className="flex-1 relative grid grid-cols-7 divide-x divide-slate-800/40">
                    {timelineData.days.map((_, i) => (
                      <div key={i} className="h-full" />
                    ))}
                    <div className="absolute inset-0 py-2 px-1">
                      {(columns['unassigned'] || [])
                        .filter(t => tripMatchesFilters(t, 'Da Assegnare'))
                        .map((trip, idx) => {
                          const style = getTimelineBlockStyle(trip);
                          if (style.display === 'none') return null;
                          const meta = STATUS_META[trip.status] || STATUS_META['UNASSIGNED'];
                          return (
                            <div
                              key={trip.id}
                              style={{ ...style, top: `${(idx % 2) * 38 + 6}px`, height: '34px' }}
                              draggable={canManageTMS}
                              onDragStart={(e) => handleDragStart(e, trip, 'unassigned')}
                              onClick={() => handleOpenTripModal(trip, 'unassigned')}
                              className={`absolute rounded-lg border px-2.5 py-1 flex items-center justify-between text-xs shadow-md overflow-hidden cursor-pointer hover:z-20 hover:scale-[1.01] transition-all ${meta.timelineClass}`}
                              title={`${trip.customer} | ${trip.pickup} -> ${trip.delivery}`}
                            >
                              <div className="truncate font-bold flex items-center gap-1.5">
                                <span className="truncate">{trip.customer}</span>
                                <span className="opacity-70 text-[10px]">({trip.pickup} → {trip.delivery})</span>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </div>
              )}

              {/* Driver Rows in Timeline */}
              {drivers.map(driver => {
                const driverTrips = (columns[driver.id] || []).filter(t =>
                  tripMatchesFilters(t, `${driver.name} ${driver.vehicle}`)
                );
                return (
                  <div
                    key={driver.id}
                    className={`flex min-h-[104px] relative group transition-colors ${
                      dragOverCol === driver.id ? 'bg-brand-blue/10' : 'hover:bg-slate-800/20'
                    }`}
                    onDragOver={(e) => handleDragOver(e, driver.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, driver.id)}
                  >
                    {/* Driver Info & '+' Quick Assign Button */}
                    <div className="w-72 shrink-0 p-3.5 border-r border-slate-800 flex items-center justify-between gap-2 bg-slate-900/90 z-10">
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-white text-sm flex items-center gap-1.5 truncate">
                          <Truck size={14} className="text-brand-blue shrink-0" />
                          <span className="truncate">{driver.name}</span>
                        </div>
                        <div className="text-xs text-slate-400 font-mono truncate mt-0.5">{driver.vehicle}</div>
                        {driver.phone && (
                          <div className="text-[10px] text-emerald-400 font-mono mt-0.5 flex items-center gap-1">
                            <Phone size={10} /> {driver.phone}
                          </div>
                        )}
                      </div>

                      {/* '+' Button to Directly Assign a Trip to this Driver */}
                      {canManageTMS && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleOpenTripModal(null, driver.id)}
                            title={`Assegna nuovo viaggio a ${driver.name}`}
                            className="w-8 h-8 rounded-xl bg-brand-blue/15 hover:bg-brand-blue text-brand-blue hover:text-slate-950 border border-brand-blue/30 flex items-center justify-center transition-all shadow-sm active:scale-95"
                          >
                            <Plus size={16} strokeWidth={2.5} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenDriverModal(driver)}
                            title="Modifica Autista"
                            className="p-1.5 text-slate-500 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                          >
                            <Edit2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Timeline Grid for this Driver */}
                    <div className="flex-1 relative grid grid-cols-7 divide-x divide-slate-800/50">
                      {timelineData.days.map((d, i) => {
                        const isToday = format(d, 'yyyy-MM-dd') === todayStr;
                        return <div key={i} className={`h-full ${isToday ? 'bg-brand-blue/[0.03]' : ''}`} />;
                      })}

                      <div className="absolute inset-0 py-2 px-1">
                        {driverTrips.map((trip, idx) => {
                          const style = getTimelineBlockStyle(trip);
                          if (style.display === 'none') return null;
                          const isAdmin = trip.status === 'ADMIN';
                          const meta = STATUS_META[trip.status] || STATUS_META['ASSIGNED'];

                          return (
                            <div
                              key={trip.id}
                              style={{ ...style, top: `${(idx % 2) * 44 + 8}px`, height: '40px' }}
                              draggable={canManageTMS}
                              onDragStart={(e) => handleDragStart(e, trip, driver.id)}
                              onClick={() => handleOpenTripModal(trip, driver.id)}
                              className={`absolute rounded-xl border px-2.5 py-1 flex items-center justify-between text-xs shadow-lg overflow-hidden cursor-pointer hover:z-20 hover:scale-[1.01] transition-all ${meta.timelineClass}`}
                              title={`${trip.customer} | ${trip.pickup} (${format(new Date(trip.pickupTime), 'dd/MM HH:mm')}) -> ${trip.delivery} (${format(new Date(trip.deliveryTime), 'dd/MM HH:mm')})`}
                            >
                              <div className="truncate font-bold flex items-center gap-1.5">
                                {trip.status === 'EXCEPTION' && (
                                  <AlertTriangle size={12} className="text-rose-400 shrink-0" />
                                )}
                                <span className="truncate">{isAdmin ? (trip.title || trip.customer) : trip.customer}</span>
                                {!isAdmin && (
                                  <span className="opacity-75 font-normal text-[10px] truncate">
                                    ({trip.pickup} → {trip.delivery})
                                  </span>
                                )}
                              </div>
                              {!isAdmin && (
                                <div className="text-[10px] font-mono font-bold opacity-90 shrink-0 ml-2 bg-slate-950/50 px-1.5 py-0.5 rounded">
                                  €{trip.revenue}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* ================= KANBAN CON LE DATE (VISTA GIORNALIERA) ================= */
          <div className="flex gap-5 h-full items-start">
            {/* Column 1: Viaggi Da Assegnare */}
            <div
              className={`w-80 shrink-0 bg-slate-900/95 border rounded-2xl flex flex-col h-full max-h-full shadow-xl transition-colors ${
                dragOverCol === 'unassigned' ? 'border-brand-blue bg-brand-blue/5' : 'border-slate-800'
              }`}
              onDragOver={(e) => handleDragOver(e, 'unassigned')}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, 'unassigned')}
            >
              <div className="p-4 border-b border-slate-800 bg-slate-900/60 rounded-t-2xl space-y-2">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                    <h2 className="font-black text-white text-sm uppercase tracking-wider">Da Assegnare</h2>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="bg-slate-800 text-slate-200 text-xs font-black px-2.5 py-0.5 rounded-full border border-slate-700">
                      {displayColumns['unassigned']?.length || 0}
                    </span>
                    {canManageTMS && (
                      <button
                        type="button"
                        onClick={() => handleOpenTripModal(null, 'unassigned')}
                        title="Crea nuovo viaggio da assegnare"
                        className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-brand-blue text-slate-300 hover:text-slate-950 border border-slate-700 flex items-center justify-center transition-all"
                      >
                        <Plus size={15} strokeWidth={2.5} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Toggle to see unassigned trips from all dates if any exist outside selectedDate */}
                {totalUnassignedAllDates > 0 && (
                  <div className="flex items-center justify-between pt-1 text-[11px]">
                    <span className="text-slate-400">
                      Totale in bacheca: <strong className="text-white">{totalUnassignedAllDates}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowAllUnassignedDates(prev => !prev)}
                      className={`px-2 py-0.5 rounded font-bold border transition-colors ${
                        showAllUnassignedDates
                          ? 'bg-brand-blue/15 text-brand-blue border-brand-blue/30'
                          : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                      }`}
                    >
                      {showAllUnassignedDates ? 'Filtra per data' : 'Mostra tutte le date'}
                    </button>
                  </div>
                )}
              </div>

              <div className="p-3 flex-1 overflow-y-auto">
                {displayColumns['unassigned']?.map(trip => renderTripCard(trip, 'unassigned'))}
                {(!displayColumns['unassigned'] || displayColumns['unassigned'].length === 0) && (
                  <div className="h-44 border-2 border-dashed border-slate-800/80 rounded-xl flex flex-col items-center justify-center text-slate-500 text-xs p-4 text-center gap-2">
                    <Sparkles size={20} className="text-slate-600" />
                    <span>Nessun viaggio da assegnare per questa data</span>
                    {canManageTMS && (
                      <button
                        type="button"
                        onClick={() => handleOpenTripModal(null, 'unassigned')}
                        className="mt-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-[11px] flex items-center gap-1 transition-colors"
                      >
                        <Plus size={12} /> Crea Viaggio
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Driver Columns */}
            {drivers.map(driver => {
              const driverTrips = displayColumns[driver.id] || [];
              const dayRevenue = driverTrips.reduce((s, t) => s + (Number(t.revenue) || 0), 0);
              const dayCost = driverTrips.reduce((s, t) => s + (Number(t.cost) || 0), 0);
              const dayMargin = dayRevenue - dayCost;
              const hasAdminAbsence = driverTrips.some(t => t.status === 'ADMIN');
              const hasInTransit = driverTrips.some(t => t.status === 'IN_TRANSIT');

              return (
                <div
                  key={driver.id}
                  className={`w-80 shrink-0 bg-slate-900/95 border rounded-2xl flex flex-col h-full max-h-full shadow-xl transition-all ${
                    dragOverCol === driver.id ? 'border-brand-blue bg-brand-blue/5 ring-2 ring-brand-blue/20' : 'border-slate-800'
                  }`}
                  onDragOver={(e) => handleDragOver(e, driver.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, driver.id)}
                >
                  {/* Driver Card Header with '+' Direct Assignment Button */}
                  <div className="p-4 border-b border-slate-800 bg-slate-900/70 rounded-t-2xl group">
                    <div className="flex justify-between items-start gap-2 mb-1.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-xs shrink-0 border ${
                            hasAdminAbsence
                              ? 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30'
                              : hasInTransit
                              ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                              : driverTrips.length > 0
                              ? 'bg-brand-blue/15 text-brand-blue border-brand-blue/30'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                        >
                          {driver.name
                            .split(' ')
                            .map(p => p[0])
                            .join('')
                            .slice(0, 2)
                            .toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <h2 className="font-black text-white text-sm truncate">{driver.name}</h2>
                          <p className="text-[11px] text-slate-400 font-mono truncate">{driver.vehicle}</p>
                        </div>
                      </div>

                      {/* Right Actions: Prominent '+' Button to assign trip directly + Edit/Delete Driver */}
                      <div className="flex items-center gap-1 shrink-0">
                        {canManageTMS && (
                          <button
                            type="button"
                            onClick={() => handleOpenTripModal(null, driver.id)}
                            title={`Assegna subito un nuovo viaggio a ${driver.name}`}
                            className="w-8 h-8 rounded-xl bg-brand-blue hover:bg-sky-400 text-slate-950 font-black flex items-center justify-center shadow-md shadow-brand-blue/20 transition-all active:scale-95"
                          >
                            <Plus size={17} strokeWidth={2.75} />
                          </button>
                        )}
                        {canManageTMS && (
                          <button
                            type="button"
                            onClick={() => handleOpenDriverModal(driver)}
                            title="Modifica Autista"
                            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                          >
                            <Edit2 size={13} />
                          </button>
                        )}
                        {canManageTMS && (
                          <button
                            type="button"
                            onClick={() => handleDeleteDriver(driver.id)}
                            title="Elimina Autista"
                            className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-rose-500/10 transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Driver Sub-Header: Phone + Daily Summary Badges */}
                    <div className="flex items-center justify-between pt-2 mt-2 border-t border-slate-800/80 text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <span className="bg-slate-950 text-slate-300 font-bold px-2 py-0.5 rounded-md border border-slate-800">
                          {driverTrips.length} {driverTrips.length === 1 ? 'viaggio' : 'viaggi'}
                        </span>
                        {driver.phone && (
                          <span className="text-emerald-400 font-mono text-[10px] flex items-center gap-1 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                            <Phone size={10} /> {driver.phone}
                          </span>
                        )}
                      </div>

                      {driverTrips.length > 0 && !hasAdminAbsence && (
                        <span
                          className={`font-black text-[10px] px-2 py-0.5 rounded border ${
                            dayMargin >= 0
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                          }`}
                        >
                          Margine: {dayMargin >= 0 ? `+€${dayMargin}` : `-€${Math.abs(dayMargin)}`}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Driver Trips List */}
                  <div className="p-3 flex-1 overflow-y-auto">
                    {driverTrips.map(trip => renderTripCard(trip, driver.id))}
                    {driverTrips.length === 0 && (
                      <div className="h-44 border-2 border-dashed border-slate-800/70 rounded-xl flex flex-col items-center justify-center text-slate-500 text-xs p-4 text-center gap-2">
                        <Truck size={20} className="text-slate-600" />
                        <span>Nessun viaggio per {driver.name} in questa data</span>
                        {canManageTMS && (
                          <button
                            type="button"
                            onClick={() => handleOpenTripModal(null, driver.id)}
                            className="mt-1 px-3 py-1.5 rounded-lg bg-brand-blue/15 hover:bg-brand-blue text-brand-blue hover:text-slate-950 border border-brand-blue/30 font-bold text-[11px] flex items-center gap-1 transition-all"
                          >
                            <Plus size={13} /> Assegna Viaggio
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Quick Footer Button on Driver Column */}
                  {canManageTMS && driverTrips.length > 0 && (
                    <div className="p-2.5 border-t border-slate-800/80 bg-slate-950/40 rounded-b-2xl">
                      <button
                        type="button"
                        onClick={() => handleOpenTripModal(null, driver.id)}
                        className="w-full py-2 rounded-xl bg-slate-800/80 hover:bg-brand-blue text-slate-300 hover:text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 transition-all border border-slate-700/70 hover:border-brand-blue"
                      >
                        <Plus size={14} /> Aggiungi viaggio a {driver.name.split(' ')[0]}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ================= TRIP MODAL (CREA / MODIFICA / ASSEGNA VIAGGIO) ================= */}
      {isTripModalOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center px-6 py-4 border-b border-slate-800 bg-slate-950/60">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-brand-blue/15 border border-brand-blue/30 flex items-center justify-center text-brand-blue">
                  <Truck size={18} />
                </div>
                <div>
                  <h3 className="font-black text-white text-base">
                    {editingTrip ? 'Modifica Viaggio / Attività' : 'Nuovo Viaggio / Attività'}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {tripForm.targetDriverId && tripForm.targetDriverId !== 'unassigned'
                      ? `Assegnazione diretta a: ${drivers.find(d => d.id === tripForm.targetDriverId)?.name || 'Autista'}`
                      : 'In bacheca "Da Assegnare" o scegli direttamente un autista'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsTripModalOpen(false)}
                className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveTrip} className="p-6 space-y-4 max-h-[82vh] overflow-y-auto">
              {/* Row 1: Direct Driver Selector + Status Selector */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
                <div>
                  <label className="block text-[11px] font-black text-brand-blue uppercase tracking-wider mb-1">
                    Autista Assegnato
                  </label>
                  <select
                    value={tripForm.targetDriverId || 'unassigned'}
                    onChange={(e) => {
                      const newDriverId = e.target.value;
                      setTripForm(prev => ({
                        ...prev,
                        targetDriverId: newDriverId,
                        status:
                          newDriverId !== 'unassigned' && prev.status === 'UNASSIGNED'
                            ? 'ASSIGNED'
                            : newDriverId === 'unassigned' && prev.status !== 'ADMIN'
                            ? 'UNASSIGNED'
                            : prev.status
                      }));
                    }}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-white text-sm font-bold focus:outline-none focus:border-brand-blue"
                  >
                    <option value="unassigned">📌 Da Assegnare (Bacheca)</option>
                    {drivers.map(d => (
                      <option key={d.id} value={d.id}>
                        🚛 {d.name} ({d.vehicle})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1">
                    Stato / Tipo Attività
                  </label>
                  <select
                    value={tripForm.status}
                    onChange={(e) => setTripForm({ ...tripForm, status: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-white text-sm font-bold focus:outline-none focus:border-brand-blue"
                  >
                    <option value="UNASSIGNED">Da Assegnare</option>
                    <option value="ASSIGNED">Assegnato (Pianificato)</option>
                    <option value="IN_TRANSIT">In Viaggio (In Corso)</option>
                    <option value="DELIVERED">Consegnato (Completato)</option>
                    <option value="EXCEPTION">Ritardo / Problema (Alert)</option>
                    <option value="ADMIN">Ferie / Permesso / Fermo Mezzo</option>
                  </select>
                </div>
              </div>

              {tripForm.status === 'ADMIN' ? (
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">
                    Motivo Assenza / Fermo (es. Ferie, Permesso, Officina)
                  </label>
                  <input
                    required
                    type="text"
                    value={tripForm.title}
                    onChange={(e) =>
                      setTripForm({ ...tripForm, title: e.target.value, customer: e.target.value })
                    }
                    placeholder="Es. Ferie Estive, Revisione Mezzo..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white text-sm focus:outline-none focus:border-brand-blue"
                  />
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Cliente *</label>
                      <input
                        required
                        type="text"
                        value={tripForm.customer}
                        onChange={(e) => setTripForm({ ...tripForm, customer: e.target.value })}
                        placeholder="Ragione Sociale Cliente"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white text-sm focus:outline-none focus:border-brand-blue"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-1">
                        Riferimento / DDT *
                      </label>
                      <input
                        required
                        type="text"
                        value={tripForm.ref}
                        onChange={(e) => setTripForm({ ...tripForm, ref: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white text-sm font-mono focus:outline-none focus:border-brand-blue"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-emerald-400 uppercase mb-1">
                        Luogo di Ritiro *
                      </label>
                      <input
                        required
                        type="text"
                        placeholder="Es. Settala (MI)"
                        value={tripForm.pickup}
                        onChange={(e) => setTripForm({ ...tripForm, pickup: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white text-sm focus:outline-none focus:border-brand-blue"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-rose-400 uppercase mb-1">
                        Luogo di Consegna *
                      </label>
                      <input
                        required
                        type="text"
                        placeholder="Es. Bologna (BO)"
                        value={tripForm.delivery}
                        onChange={(e) => setTripForm({ ...tripForm, delivery: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white text-sm focus:outline-none focus:border-brand-blue"
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">
                    Data e Ora Inizio / Ritiro *
                  </label>
                  <input
                    required
                    type="datetime-local"
                    value={tripForm.pickupTime}
                    onChange={(e) => setTripForm({ ...tripForm, pickupTime: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white text-sm focus:outline-none focus:border-brand-blue"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">
                    Data e Ora Fine / Consegna *
                  </label>
                  <input
                    required
                    type="datetime-local"
                    value={tripForm.deliveryTime}
                    onChange={(e) => setTripForm({ ...tripForm, deliveryTime: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white text-sm focus:outline-none focus:border-brand-blue"
                  />
                </div>
              </div>

              {tripForm.status !== 'ADMIN' && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end bg-slate-950/60 p-3.5 rounded-xl border border-slate-800">
                    <div>
                      <label className="block text-xs font-bold text-emerald-400 uppercase mb-1">
                        Ricavo (€)
                      </label>
                      <input
                        type="number"
                        value={tripForm.revenue}
                        onChange={(e) => setTripForm({ ...tripForm, revenue: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2 text-white text-sm font-bold focus:outline-none focus:border-brand-blue"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-rose-400 uppercase mb-1">
                        Costo Viaggio (€)
                      </label>
                      <input
                        type="number"
                        value={tripForm.cost}
                        onChange={(e) => setTripForm({ ...tripForm, cost: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2 text-white text-sm font-bold focus:outline-none focus:border-brand-blue"
                      />
                    </div>
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-2 text-center">
                      <span className="block text-[10px] font-bold uppercase text-slate-400">Margine Stimato</span>
                      <span
                        className={`text-sm font-black ${
                          (Number(tripForm.revenue) || 0) - (Number(tripForm.cost) || 0) >= 0
                            ? 'text-emerald-400'
                            : 'text-rose-400'
                        }`}
                      >
                        €{(Number(tripForm.revenue) || 0) - (Number(tripForm.cost) || 0)}
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">
                      Note Operative (separate da virgola)
                    </label>
                    <input
                      type="text"
                      placeholder="Es. Sponda idraulica, Tassativo ore 10, Chiamare prima..."
                      value={tripForm.notes}
                      onChange={(e) => setTripForm({ ...tripForm, notes: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white text-sm focus:outline-none focus:border-brand-blue"
                    />
                  </div>
                </>
              )}

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsTripModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-brand-blue hover:bg-sky-400 text-slate-950 text-xs font-black flex items-center gap-2 shadow-lg shadow-brand-blue/20"
                >
                  <Check size={16} /> {editingTrip ? 'Salva Modifiche' : 'Conferma e Assegna'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= DRIVER MODAL ================= */}
      {isDriverModalOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="flex justify-between items-center px-6 py-4 border-b border-slate-800 bg-slate-950/60">
              <h3 className="font-black text-white text-base">
                {editingDriver ? 'Modifica Autista' : 'Nuovo Autista'}
              </h3>
              <button
                type="button"
                onClick={() => setIsDriverModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSaveDriver} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">
                  Nome e Cognome *
                </label>
                <input
                  required
                  type="text"
                  placeholder="Es. Mario Rossi"
                  value={driverForm.name}
                  onChange={(e) => setDriverForm({ ...driverForm, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white text-sm focus:outline-none focus:border-brand-blue"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">
                  Veicolo e Targa *
                </label>
                <input
                  required
                  type="text"
                  placeholder="Es. IVECO Stralis - AB123CD"
                  value={driverForm.vehicle}
                  onChange={(e) => setDriverForm({ ...driverForm, vehicle: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white text-sm focus:outline-none focus:border-brand-blue"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">
                  Telefono cellulare (per invio rapido WhatsApp)
                </label>
                <input
                  type="tel"
                  placeholder="Es. +39 333 1234567"
                  value={driverForm.phone}
                  onChange={(e) => setDriverForm({ ...driverForm, phone: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white text-sm focus:outline-none focus:border-brand-blue"
                />
              </div>
              <div className="pt-3 flex justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsDriverModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-brand-blue text-slate-950 text-xs font-black flex items-center gap-2 shadow-lg shadow-brand-blue/20"
                >
                  <Check size={16} /> Salva Autista
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default TMSDashboard;
