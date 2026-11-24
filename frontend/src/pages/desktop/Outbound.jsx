import { appAlert, appConfirm, appPrompt } from "../../utils/alerts.js";
import { hasPerm, canTouchCustomer } from "../../utils/permissions.js";
import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import Select from 'react-select';
import { io } from 'socket.io-client';
import {
  Truck, Search, Plus, Trash2, Printer, CheckCircle, Clock, Eye, XCircle,
  PackageSearch, X, History, User, Package, RotateCcw, Calendar, ArrowUpDown,
  AlertTriangle, Edit3, Zap, Layers, FileText, MapPin, ShieldAlert, Thermometer, SlidersHorizontal,
  Container, ShieldCheck, ClipboardCheck, Warehouse
} from 'lucide-react';
import { jwtDecode } from 'jwt-decode';
import { useNavigate } from 'react-router-dom';
import LogisticsMetaFields, { DEFAULT_ADR_DRAFT } from '../../components/LogisticsMetaFields';
import { TEMP_REGIME_MAP, normalizeTempRegime, parseAdrData, formatAdrDescription } from '../../utils/logisticsMeta';

const DEFAULT_BOLLA_OPTIONS = {
  is_adr: false,
  adr_note: '',
  temp_6_8: false,
  temp_15_25: false,
  legal_intact_goods: true,
  legal_driver_check: true,
  legal_transport_norm: true,
  causale: 'C/FINE DEPOSITO',
  porto: 'Franco',
  aspetto_beni: 'Bancali / Colli Imballati',
  carrier_name: '',
  vehicle_plate: '',
  transport_notes: ''
};

const parseBollaOpts = (raw) => {
  if (!raw) return { ...DEFAULT_BOLLA_OPTIONS };
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { ...DEFAULT_BOLLA_OPTIONS, ...(obj || {}) };
  } catch (_) {
    return { ...DEFAULT_BOLLA_OPTIONS };
  }
};

const formatDeliveryAddrOption = (a) => {
  if (!a) return '';
  const city = [a.cap, a.city, a.province ? `(${a.province})` : ''].filter(Boolean).join(' ');
  const main = [a.address_line, city].filter(Boolean).join(' - ');
  const contact = [a.contact_name ? `Ref: ${a.contact_name}` : '', a.contact_phone ? `Tel: ${a.contact_phone}` : ''].filter(Boolean).join(' • ');
  return contact ? `${main} | ${contact}` : main;
};

function TimelineModal({ order, onClose, token, onOpenReturn, onEditPalletMeta }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadDetails = () => {
    axios.get(`http://${window.location.hostname}:3000/api/outbound/${order.id}/details`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(res => {
      setDetails(res.data);
      setLoading(false);
    }).catch(err => {
      console.error(err);
      setLoading(false);
    });
  };

  useEffect(() => {
    loadDetails();
    const socket = io(`http://${window.location.hostname}:3000`);
    socket.on('outbound_updated', loadDetails);
    socket.on('inventory_updated', loadDetails);
    socket.on('dashboard_update', loadDetails);
    return () => socket.disconnect();
  }, [order.id, token]);

  if (loading) return null;

  const ordData = details?.order || order;
  const items = details?.items || [];
  const loadCheckin = details?.load_checkin || null;
  const compliance = details?.compliance || { tempRegimes: [], isAdr: false, adrDescriptions: [], mixedColdWarning: false };
  let checkinAnswers = {};
  if (loadCheckin?.answers) {
    try { checkinAnswers = typeof loadCheckin.answers === 'string' ? JSON.parse(loadCheckin.answers) : loadCheckin.answers; } catch (_) {}
  }
  const pickedCount = items.filter(i => i.status === 'PICKED').length;
  const pct = items.length > 0 ? Math.round((pickedCount / items.length) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-7 max-w-2xl w-full shadow-2xl relative animate-fade-in-up max-h-[92vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-6 right-6 text-slate-500 hover:text-brand-white transition-colors">
          <XCircle size={24} />
        </button>
        <h2 className="text-2xl font-bold text-brand-white mb-1 flex items-center gap-3 pr-8">
          <Clock className="text-brand-blue shrink-0" /> Dettaglio &amp; Tempistiche Spedizione
        </h2>
        <p className="text-slate-400 font-mono mb-3 text-sm">
          {ordData.order_code} {ordData.bolla_number && `• Bolla: ${ordData.bolla_number}`} {ordData.client_ddt && `• DDT: ${ordData.client_ddt}`} • <span className="text-brand-blue font-bold">{ordData.customer_name || order.customer_name}</span>
        </p>
        <div className="flex flex-wrap gap-1.5 mb-4">
          <span className={`px-2 py-0.5 rounded-lg text-[11px] font-black border ${ordData.is_container ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-slate-800 text-slate-300 border-slate-700'}`}>
            {ordData.is_container ? 'CARICO CONTAINER' : 'CARICO CAMION'}
          </span>
          {ordData.origin_warehouse_name && (
            <span className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              Origine: {ordData.origin_warehouse_name}
            </span>
          )}
          {Boolean(ordData.require_load_recheck) && (
            <span className="px-2 py-0.5 rounded-lg text-[11px] font-black bg-violet-500/20 text-violet-300 border border-violet-500/40">
              Ri-Verifica Carico Zebra
            </span>
          )}
          {compliance.tempRegimes?.map(tr => (
            <span key={tr} className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/35">
              {TEMP_REGIME_MAP[tr]?.shortLabel || tr}
            </span>
          ))}
          {compliance.isAdr && (
            <span className="px-2 py-0.5 rounded-lg text-[11px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/40">
              ADR ({compliance.adrDescriptions.join('; ')})
            </span>
          )}
        </div>

        {compliance.mixedColdWarning && (
          <div className="bg-orange-950/40 border border-orange-500/50 rounded-2xl p-3 mb-4 text-xs text-orange-200 font-bold flex items-center gap-2">
            <AlertTriangle size={16} className="text-orange-400 shrink-0" />
            ATTENZIONE: Presenti bancali a temperatura 2/8°C e 15/25°C nello stesso ordine!
          </div>
        )}

        {/* Barra progresso live dentro la modale */}
        {ordData.notes && (
          <div className="bg-amber-950/30 border border-amber-500/40 rounded-2xl p-3.5 mb-4">
            <div className="text-[10px] font-black uppercase tracking-wider text-amber-400 mb-1">
              Nota Operativa sul DDT per il Magazziniere:
            </div>
            <div className="text-sm font-bold text-amber-100 whitespace-pre-wrap">{ordData.notes}</div>
          </div>
        )}
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 mb-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Stato Prelievo Righe ({pickedCount} / {items.length})
            </span>
            <span className="font-mono text-sm font-black text-brand-blue">{pct}%</span>
          </div>
          <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
            <div
              className="h-full bg-gradient-to-r from-brand-blue to-emerald-400 transition-all duration-500 rounded-full"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-950 p-4 rounded-2xl border border-slate-800">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Inizio Picking</p>
              <p className="text-brand-white font-mono text-xs">{ordData.start_picking_at ? new Date(ordData.start_picking_at).toLocaleString('it-IT') : '-'}</p>
              <p className="text-xs text-brand-blue mt-1 font-semibold">Op: {ordData.picking_operator || '-'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Fine Picking (Pronto)</p>
              <p className="text-brand-white font-mono text-xs">{ordData.end_picking_at ? new Date(ordData.end_picking_at).toLocaleString('it-IT') : '-'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Conferma Spedizione</p>
              <p className="text-brand-white font-mono text-xs">{ordData.shipped_at ? new Date(ordData.shipped_at).toLocaleString('it-IT') : '-'}</p>
            </div>
          </div>
          
          <div>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5">
              Righe Articoli in Spedizione ({items.length})
            </h3>
            <div className="max-h-64 overflow-y-auto pr-1 space-y-2">
              {items.map(item => (
                <div key={item.id} className="flex justify-between items-center p-3 bg-slate-950 rounded-xl border border-slate-800 gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-xs font-bold text-brand-white">{item.product_name}</p>
                      {normalizeTempRegime(item.temp_regime) !== 'NONE' && (
                        <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/35 text-[9px] font-bold">
                          {TEMP_REGIME_MAP[normalizeTempRegime(item.temp_regime)]?.shortLabel}
                        </span>
                      )}
                      {Boolean(item.is_adr) && (
                        <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[9px] font-black">
                          ADR {parseAdrData(item.adr_data)?.un_number || ''}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                      {item.pallet_code ? `Paletta: ${item.pallet_code} • ` : ''}
                      {item.client_pallet_number ? `Rif. Pal. Cl: ${item.client_pallet_number} • ` : ''}
                      {item.batch ? `Lotto: ${item.batch} • ` : ''}
                      Q.tà: <strong className="text-brand-white">{parseFloat(item.quantity_required)} {item.requested_uom || item.base_uom || 'Pezzi'}</strong>
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {onEditPalletMeta && item.pallet_code && (
                      <button
                        type="button"
                        onClick={() => onEditPalletMeta(item, loadDetails)}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-sky-300 rounded-lg text-[10px] font-bold border border-slate-700"
                        title="Modifica Temperatura o ADR di questa paletta"
                      >
                        Temp/ADR
                      </button>
                    )}
                    <div className="text-right">
                      <p className="text-xs font-mono text-brand-blue">{item.picked_at ? new Date(item.picked_at).toLocaleTimeString('it-IT') : 'In attesa'}</p>
                      <span className={`inline-block mt-0.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${item.status === 'PICKED' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'}`}>
                        {item.status === 'PICKED' ? 'Prelevato' : 'Da prelevare'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

          {/* Registro permanente Modulo Carico Camion / Container (CARICO_USCITA) */}
          {(ordData.load_completed_at || loadCheckin) && (
            <div className="mt-4 bg-emerald-950/25 border border-emerald-500/35 rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs font-black uppercase tracking-wider text-emerald-300 flex items-center gap-1.5">
                  <ClipboardCheck size={15} /> Log Ufficiale Carico Mezzo ({ordData.load_checkin_session_code || loadCheckin?.session_code})
                </span>
                <span className="text-[11px] font-mono text-slate-300">
                  {ordData.load_completed_at ? new Date(ordData.load_completed_at).toLocaleString('it-IT') : ''} • Op: {ordData.load_completed_by || loadCheckin?.operator_name || '-'}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="bg-slate-950/80 p-2 rounded-xl border border-slate-800">
                  <div className="text-[9px] text-slate-500 uppercase font-bold">Mezzo &amp; Targa</div>
                  <div className="font-bold text-white font-mono">{checkinAnswers.vehicle_type || (ordData.is_container ? 'CONTAINER' : 'CAMION')} • {ordData.load_vehicle_plate || checkinAnswers.vehicle_plate || '-'}</div>
                </div>
                <div className="bg-slate-950/80 p-2 rounded-xl border border-slate-800">
                  <div className="text-[9px] text-slate-500 uppercase font-bold">Igienico-Sanitario</div>
                  <div className="font-bold text-emerald-300">{ordData.load_hygiene_ok !== false ? 'CONFORME ✓' : 'NON CONFORME'}</div>
                </div>
                <div className="bg-slate-950/80 p-2 rounded-xl border border-slate-800">
                  <div className="text-[9px] text-slate-500 uppercase font-bold">Temp. Rilevata / Strisciata</div>
                  <div className="font-bold text-cyan-300">
                    {ordData.load_recorded_temp ? `${ordData.load_recorded_temp}°C` : (checkinAnswers.needs_temp_check ? 'N/D' : 'Non rich.')}
                    {ordData.load_strisciata_taken ? ' • Strisciata OK' : ''}
                  </div>
                </div>
                <div className="bg-slate-950/80 p-2 rounded-xl border border-slate-800">
                  <div className="text-[9px] text-slate-500 uppercase font-bold">Ri-Verifica Barcode</div>
                  <div className="font-bold text-slate-200">
                    {checkinAnswers.require_load_recheck ? `${checkinAnswers.recheck_count || 0}/${checkinAnswers.expected_barcodes_count || 0} scansionati` : 'Non richiesta'}
                  </div>
                </div>
              </div>
              {(checkinAnswers.seal_number || checkinAnswers.hygiene_notes || checkinAnswers.notes) && (
                <p className="text-[11px] text-slate-300 pt-1">
                  {checkinAnswers.seal_number ? `Sigillo: ${checkinAnswers.seal_number} • ` : ''}
                  {checkinAnswers.hygiene_notes ? `Igiene: ${checkinAnswers.hygiene_notes} • ` : ''}
                  {checkinAnswers.notes || ''}
                </p>
              )}
            </div>
          )}
          {/* Pulsante Reso per ordini spediti */}
          {ordData.status === 'SHIPPED' && onOpenReturn && (
            <div className="pt-3">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenReturn(ordData);
                }}
                className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-black font-black rounded-xl transition-all flex items-center justify-center gap-2 text-sm shadow-[0_0_20px_rgba(245,158,11,0.25)]"
              >
                <RotateCcw size={18} />
                Fai Tornare la Merce (Registra Reso)
              </button>
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

const getLotExpBadge = (expDate) => {
  if (!expDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expDate);
  if (isNaN(exp.getTime())) return null;
  exp.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((exp - today) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    return {
      label: `SCADUTO (${new Date(expDate).toLocaleDateString('it-IT')})`,
      cls: 'bg-rose-500/20 text-rose-400 border-rose-500/40'
    };
  }
  if (diffDays <= 60) {
    return {
      label: `Scad: ${new Date(expDate).toLocaleDateString('it-IT')} (${diffDays}gg)`,
      cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40'
    };
  }
  return {
    label: `Scad: ${new Date(expDate).toLocaleDateString('it-IT')}`,
    cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
  };
};

const Outbound = () => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [customerRecords, setCustomerRecords] = useState([]);
  const [warehouses, setWarehouses] = useState([{ id: 1, name: 'Settala', address: '' }, { id: 2, name: 'Caleppio', address: '' }]);
  const [metaEditModal, setMetaEditModal] = useState({ show: false, palletCode: '', temp_regime: 'NONE', is_adr: false, adr_data: { ...DEFAULT_ADR_DRAFT }, onSaved: null });
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Modale nuova spedizione
  const [showModal, setShowModal] = useState(false);
  const [newOrder, setNewOrder] = useState({
    customer_id: '',
    exit_date: new Date().toISOString().split('T')[0],
    client_ddt: '',
    notes: '',
    generate_exit_ddt: true,
    is_container: false,
    require_load_recheck: false,
    origin_warehouse_id: '1',
    delivery_address_id: '',
    delivery_label: '',
    delivery_address_text: '',
    bolla_options: { ...DEFAULT_BOLLA_OPTIONS }
  });
  const [orderDeliveryAddresses, setOrderDeliveryAddresses] = useState([]);
  const [showAdvancedBollaCreate, setShowAdvancedBollaCreate] = useState(false);
  const [cart, setCart] = useState([]);

  // Modale Configura & Stampa Bolla di Uscita
  const [bollaModal, setBollaModal] = useState({
    show: false,
    order: null,
    items: [],
    compliance: { tempRegimes: [], isAdr: false, adrDescriptions: [], mixedColdWarning: false },
    addresses: [],
    saving: false,
    generate_exit_ddt: true,
    is_container: false,
    require_load_recheck: false,
    origin_warehouse_id: '1',
    delivery_address_id: '',
    delivery_label: '',
    delivery_address_text: '',
    bolla_options: { ...DEFAULT_BOLLA_OPTIONS }
  });

  // Modale selezione paletta/lotto
  const [availablePallets, setAvailablePallets] = useState([]);
  const [palletSearchTerm, setPalletSearchTerm] = useState('');
  const [lotSortBy, setLotSortBy] = useState('FEFO'); // 'FEFO' | 'QTY_DESC' | 'ALPHA'
  
  // Custom Pick Modal
  const [showPickModal, setShowPickModal] = useState(false);
  const [pickingPallet, setPickingPallet] = useState(null);
  const [pickQty, setPickQty] = useState('');
  const [pickUom, setPickUom] = useState('Pezzi');

  const [deleteConfirm, setDeleteConfirm] = useState({ show: false, id: null, code: '', expected: '', input: '' });
  
  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [timelineModal, setTimelineModal] = useState(null);
  
  const [includePending, setIncludePending] = useState(false);

  // Return modal state
  const [returnModal, setReturnModal] = useState({
    show: false,
    order: null,
    reason: 'Merce non accettata dal cliente',
    customReason: '',
    notes: '',
    loading: false,
    items: []
  });

  const openReturnModal = async (order) => {
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/outbound/${order.id}/details`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setReturnModal({
        show: true,
        order: res.data.order || order,
        reason: 'Merce non accettata dal cliente',
        customReason: '',
        notes: '',
        loading: false,
        items: res.data.items || []
      });
    } catch (e) {
      setReturnModal({
        show: true,
        order: order,
        reason: 'Merce non accettata dal cliente',
        customReason: '',
        notes: '',
        loading: false,
        items: []
      });
    }
  };

  const handleConfirmReturn = async () => {
    if (!returnModal.order) return;
    const finalReason = returnModal.reason === 'Altro (personalizzato)' || returnModal.customReason.trim() !== ''
      ? (returnModal.customReason.trim() || returnModal.reason)
      : returnModal.reason;

    if (!finalReason) {
      appAlert('Specificare un motivo per il reso');
      return;
    }

    setReturnModal(prev => ({ ...prev, loading: true }));
    try {
      await axios.post(
        `http://${window.location.hostname}:3000/api/outbound/${returnModal.order.id}/return`,
        { reason: finalReason, notes: returnModal.notes },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      appAlert('Reso registrato con successo! La merce è tornata in giacenza in magazzino con posizione "IN ATTESA".', 'success');
      setReturnModal({ show: false, order: null, reason: 'Merce non accettata dal cliente', customReason: '', notes: '', loading: false, items: [] });
      fetchOrders();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante la registrazione del reso');
      setReturnModal(prev => ({ ...prev, loading: false }));
    }
  };

  const token = localStorage.getItem('maglite_token');
  const userRole = token ? jwtDecode(token).role : '';
  const canCreateOutbound = hasPerm('outbound_create');
  const canPickOutbound = hasPerm(['outbound_pick', 'outbound_create']);
  const canReturnOutbound = hasPerm('outbound_return');
  const canDeleteOutbound = hasPerm('outbound_delete');

  const fetchOrders = async () => {
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/outbound`, { headers: { Authorization: `Bearer ${token}` }});
      setOrders(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchOrders();
    fetchBaseData();

    const socket = io(`http://${window.location.hostname}:3000`);
    const refreshCustomerAndOrders = () => {
      fetchOrders();
      fetchBaseData();
    };
    socket.on('outbound_updated', fetchOrders);
    socket.on('customers_updated', refreshCustomerAndOrders);
    socket.on('inventory_updated', fetchOrders);
    socket.on('locations_updated', fetchOrders);
    socket.on('dashboard_update', fetchOrders);

    return () => {
      socket.off('outbound_updated', fetchOrders);
      socket.off('customers_updated', refreshCustomerAndOrders);
      socket.off('inventory_updated', fetchOrders);
      socket.off('locations_updated', fetchOrders);
      socket.off('dashboard_update', fetchOrders);
      socket.disconnect();
    };
  }, []);

  const toggleIncludePending = (checked) => {
    setIncludePending(checked);
    if (newOrder.customer_id) {
      searchPalletsByCustomer(newOrder.customer_id, newOrder.id, checked);
    }
  };

  const confirmDeleteOrder = async () => {
    if (deleteConfirm.input !== deleteConfirm.expected) {
      appAlert('Codice errato. Impossibile eliminare.');
      return;
    }
    try {
      await axios.delete(`http://${window.location.hostname}:3000/api/outbound/${deleteConfirm.id}`, { headers: { Authorization: `Bearer ${token}` }});
      setDeleteConfirm({show: false, id: null, code: '', expected: '', input: ''});
      fetchOrders();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante l\'eliminazione');
    }
  };

  const fetchCustomerDeliveryAddresses = async (customerId) => {
    if (!customerId) return [];
    try {
      const res = await axios.get(
        `http://${window.location.hostname}:3000/api/customers/${customerId}/delivery-addresses`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      return res.data || [];
    } catch (_) {
      return [];
    }
  };

  const editOrder = async (orderId) => {
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/outbound/${orderId}/details`, { headers: { Authorization: `Bearer ${token}` }});
      const { order, items } = res.data;
      const addrs = await fetchCustomerDeliveryAddresses(order.customer_id);
      setOrderDeliveryAddresses(addrs);
      setNewOrder({
        id: order.id,
        customer_id: order.customer_id,
        exit_date: order.exit_date.split('T')[0],
        client_ddt: order.client_ddt || '',
        notes: order.notes || '',
        generate_exit_ddt: order.generate_exit_ddt !== undefined && order.generate_exit_ddt !== null ? Boolean(order.generate_exit_ddt) : true,
        is_container: Boolean(order.is_container),
        require_load_recheck: Boolean(order.require_load_recheck),
        origin_warehouse_id: order.origin_warehouse_id ? String(order.origin_warehouse_id) : String(warehouses[0]?.id || '1'),
        delivery_address_id: order.delivery_address_id ? String(order.delivery_address_id) : '',
        delivery_label: order.delivery_label || '',
        delivery_address_text: order.delivery_address_text || '',
        bolla_options: parseBollaOpts(order.bolla_options)
      });
      setCart(items.map(i => ({
        pallet_id: i.pallet_id || null,
        pallet_code: i.pallet_code || null,
        client_pallet_number: i.client_pallet_number || null,
        product_id: i.product_id,
        quantity_required: parseFloat(i.quantity_required),
        requested_uom: i.requested_uom || 'Pezzi',
        product_name: i.product_name,
        locStr: i.location || 'NO POS.',
        batch: i.batch || 'Nessun lotto',
        temp_regime: i.temp_regime || 'NONE',
        is_adr: Boolean(i.is_adr),
        adr_data: i.adr_data || null
      })));
      searchPalletsByCustomer(order.customer_id, order.id, includePending);
      setShowModal(true);
    } catch (err) {
      appAlert('Errore caricamento spedizione');
    }
  };

  const fetchBaseData = async () => {
    try {
      const [resC, resWh] = await Promise.all([
        axios.get(`http://${window.location.hostname}:3000/api/customers`, { headers: { Authorization: `Bearer ${token}` }}),
        axios.get(`http://${window.location.hostname}:3000/api/warehouses`, { headers: { Authorization: `Bearer ${token}` }}).catch(() => ({ data: [] }))
      ]);
      setCustomerRecords(resC.data || []);
      setCustomers((resC.data || []).map(c => ({ value: c.id, label: c.business_name })));
      if (Array.isArray(resWh.data) && resWh.data.length > 0) {
        setWarehouses(resWh.data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const searchPalletsByCustomer = async (customerId, excludeOrderId = null, pendingOpt) => {
    if (!customerId) {
      setAvailablePallets([]);
      return;
    }
    try {
      const pendingFlag = pendingOpt !== undefined ? pendingOpt : includePending;
      let url = `http://${window.location.hostname}:3000/api/outbound/search-pallets?customer_id=${customerId}`;
      if (excludeOrderId) url += `&exclude_order_id=${excludeOrderId}`;
      if (pendingFlag) url += `&include_pending=true`;
      
      const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` }});
      setAvailablePallets(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCustomerChange = async (val) => {
    const custId = val ? val.value : '';
    const custObj = customerRecords.find(c => Number(c.id) === Number(custId));
    const defaultGenDdt = custObj && custObj.generate_exit_ddt !== undefined && custObj.generate_exit_ddt !== null
      ? Boolean(custObj.generate_exit_ddt)
      : true;

    setPalletSearchTerm('');
    if (custId) {
      const addrs = await fetchCustomerDeliveryAddresses(custId);
      setOrderDeliveryAddresses(addrs);
      const defAddr = addrs.find(a => a.is_default) || addrs[0];
      setNewOrder(prev => ({
        ...prev,
        customer_id: custId,
        generate_exit_ddt: defaultGenDdt,
        delivery_address_id: defAddr ? String(defAddr.id) : '',
        delivery_label: defAddr ? defAddr.label : (custObj?.address ? 'Sede Cliente' : ''),
        delivery_address_text: defAddr ? formatDeliveryAddrOption(defAddr) : (custObj?.address || '')
      }));
      searchPalletsByCustomer(custId, newOrder.id, includePending);
    } else {
      setOrderDeliveryAddresses([]);
      setNewOrder(prev => ({
        ...prev,
        customer_id: '',
        generate_exit_ddt: true,
        delivery_address_id: '',
        delivery_label: '',
        delivery_address_text: ''
      }));
      setAvailablePallets([]);
    }
  };

  const removeFromCart = (indexToRemove) => {
    setCart(cart.filter((_, idx) => idx !== indexToRemove));
  };

  const updateCartItem = (indexToUpdate, updates) => {
    setCart(prev => prev.map((item, idx) => idx === indexToUpdate ? { ...item, ...updates } : item));
  };

  const handleQuickAddFullLot = (row) => {
    setCart(prev => [
      ...prev,
      {
        product_id: row.product_id,
        product_name: row.name,
        quantity_required: row.total_quantity,
        requested_uom: row.base_uom || 'Pezzi',
        batch: row.batch || 'Nessun lotto'
      }
    ]);
  };

  const handleCreateOrder = async () => {
    if (isProcessing) return;
    if (!newOrder.customer_id || cart.length === 0) {
      appAlert('Seleziona cliente e inserisci almeno un articolo.');
      return;
    }
    const invalidCartItem = cart.find(c => !c.quantity_required || isNaN(parseFloat(c.quantity_required)) || parseFloat(c.quantity_required) <= 0);
    if (invalidCartItem) {
      appAlert(`Quantità non valida per "${invalidCartItem.product_name}".`);
      return;
    }
    setIsProcessing(true);
    try {
      const payload = {
        customer_id: newOrder.customer_id,
        exit_date: newOrder.exit_date,
        client_ddt: newOrder.client_ddt || null,
        notes: newOrder.notes ? newOrder.notes.trim() : null,
        generate_exit_ddt: newOrder.generate_exit_ddt !== false,
        is_container: Boolean(newOrder.is_container),
        require_load_recheck: Boolean(newOrder.require_load_recheck),
        origin_warehouse_id: newOrder.origin_warehouse_id ? Number(newOrder.origin_warehouse_id) : null,
        delivery_address_id: newOrder.delivery_address_id ? Number(newOrder.delivery_address_id) : null,
        delivery_label: newOrder.delivery_label || null,
        delivery_address_text: newOrder.delivery_address_text || null,
        bolla_options: newOrder.bolla_options || DEFAULT_BOLLA_OPTIONS,
        items: cart.map(c => ({
          pallet_id: c.pallet_id || null,
          pallet_code: c.pallet_code || null,
          client_pallet_number: c.client_pallet_number || null,
          product_id: c.product_id,
          quantity_required: parseFloat(c.quantity_required),
          requested_uom: c.requested_uom,
          requested_kg: c.requested_kg ?? null,
          kg_per_unit: c.kg_per_unit ?? null,
          batch: c.batch
        }))
      };
      
      if (newOrder.id) {
        await axios.put(`http://${window.location.hostname}:3000/api/outbound/${newOrder.id}`, payload, { headers: { Authorization: `Bearer ${token}` }});
      } else {
        await axios.post(`http://${window.location.hostname}:3000/api/outbound`, payload, { headers: { Authorization: `Bearer ${token}` }});
      }
      
      setShowModal(false);
      setShowAdvancedBollaCreate(false);
      setCart([]);
      setNewOrder({
        customer_id: '',
        exit_date: new Date().toISOString().split('T')[0],
        client_ddt: '',
        notes: '',
        generate_exit_ddt: true,
        is_container: false,
        require_load_recheck: false,
        origin_warehouse_id: String(warehouses[0]?.id || '1'),
        delivery_address_id: '',
        delivery_label: '',
        delivery_address_text: '',
        bolla_options: { ...DEFAULT_BOLLA_OPTIONS }
      });
      setOrderDeliveryAddresses([]);
      setAvailablePallets([]);
      setPalletSearchTerm('');
      fetchOrders();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante il salvataggio');
    } finally {
      setIsProcessing(false);
    }
  };

  const openPalletMetaEditor = (itemOrPallet, onSavedCallback = null) => {
    const code = itemOrPallet.pallet_code;
    if (!code) return;
    setMetaEditModal({
      show: true,
      palletCode: code,
      temp_regime: normalizeTempRegime(itemOrPallet.temp_regime),
      is_adr: Boolean(itemOrPallet.is_adr),
      adr_data: parseAdrData(itemOrPallet.adr_data) || { ...DEFAULT_ADR_DRAFT },
      onSaved: onSavedCallback
    });
  };

  const handleSavePalletMeta = async (e) => {
    e.preventDefault();
    if (!metaEditModal.palletCode || isProcessing) return;
    setIsProcessing(true);
    try {
      const adrPayload = metaEditModal.is_adr
        ? { ...metaEditModal.adr_data, formatted_description: formatAdrDescription(metaEditModal.adr_data) }
        : null;
      await axios.put(
        `http://${window.location.hostname}:3000/api/pallets/${encodeURIComponent(metaEditModal.palletCode)}`,
        {
          temp_regime: metaEditModal.temp_regime || 'NONE',
          is_adr: Boolean(metaEditModal.is_adr),
          adr_data: adrPayload
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setMetaEditModal(prev => ({ ...prev, show: false }));
      if (newOrder.customer_id) searchPalletsByCustomer(newOrder.customer_id, newOrder.id, includePending);
      await fetchOrders();
      if (metaEditModal.onSaved) await metaEditModal.onSaved();
      appAlert(`Metadata Temp/ADR aggiornati per paletta ${metaEditModal.palletCode}`, 'Aggiornato', 'success');
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore aggiornamento metadata paletta');
    } finally {
      setIsProcessing(false);
    }
  };

  const refreshBollaModalCompliance = async (orderId) => {
    try {
      const dRes = await axios.get(`http://${window.location.hostname}:3000/api/outbound/${orderId}/details`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setBollaModal(prev => ({
        ...prev,
        items: dRes.data?.items || [],
        compliance: dRes.data?.compliance || { tempRegimes: [], isAdr: false, adrDescriptions: [], mixedColdWarning: false }
      }));
    } catch (_) {}
  };

  const openBollaModal = async (order) => {
    const [addrs, detailsRes] = await Promise.all([
      fetchCustomerDeliveryAddresses(order.customer_id),
      axios.get(`http://${window.location.hostname}:3000/api/outbound/${order.id}/details`, {
        headers: { Authorization: `Bearer ${token}` }
      }).catch(() => ({ data: null }))
    ]);
    const custObj = customerRecords.find(c => Number(c.id) === Number(order.customer_id));
    const detailItems = detailsRes.data?.items || [];
    const firstPalWh = detailItems.find(it => it.warehouse_id)?.warehouse_id;
    setBollaModal({
      show: true,
      order,
      items: detailItems,
      compliance: detailsRes.data?.compliance || { tempRegimes: [], isAdr: false, adrDescriptions: [], mixedColdWarning: false },
      addresses: addrs,
      saving: false,
      generate_exit_ddt: order.generate_exit_ddt !== undefined && order.generate_exit_ddt !== null ? Boolean(order.generate_exit_ddt) : true,
      is_container: Boolean(order.is_container),
      require_load_recheck: Boolean(order.require_load_recheck),
      origin_warehouse_id: order.origin_warehouse_id
        ? String(order.origin_warehouse_id)
        : (firstPalWh ? String(firstPalWh) : String(warehouses[0]?.id || '1')),
      delivery_address_id: order.delivery_address_id ? String(order.delivery_address_id) : '',
      delivery_label: order.delivery_label || (custObj?.address ? 'Sede Cliente' : ''),
      delivery_address_text: order.delivery_address_text || custObj?.address || '',
      bolla_options: parseBollaOpts(order.bolla_options)
    });
  };

  const handleSaveBollaModal = async (openPdfAfter = false) => {
    if (!bollaModal.order || bollaModal.saving) return;
    setBollaModal(prev => ({ ...prev, saving: true }));
    try {
      const selWh = warehouses.find(w => String(w.id) === String(bollaModal.origin_warehouse_id)) || null;
      const whAddr = selWh
        ? [selWh.address, [selWh.cap, selWh.city, selWh.province ? `(${selWh.province})` : ''].filter(Boolean).join(' ')].filter(Boolean).join(' - ')
        : null;
      const res = await axios.put(
        `http://${window.location.hostname}:3000/api/outbound/${bollaModal.order.id}/bolla-settings`,
        {
          generate_exit_ddt: bollaModal.generate_exit_ddt,
          is_container: Boolean(bollaModal.is_container),
          require_load_recheck: Boolean(bollaModal.require_load_recheck),
          origin_warehouse_id: bollaModal.origin_warehouse_id ? Number(bollaModal.origin_warehouse_id) : null,
          origin_warehouse_name: selWh?.name || null,
          origin_warehouse_address: whAddr,
          delivery_address_id: bollaModal.delivery_address_id ? Number(bollaModal.delivery_address_id) : null,
          delivery_label: bollaModal.delivery_label || null,
          delivery_address_text: bollaModal.delivery_address_text || null,
          bolla_options: bollaModal.bolla_options,
          generate_now: openPdfAfter
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      await fetchOrders();
      if (openPdfAfter) {
        const targetCode = res.data?.bolla_number || bollaModal.order.order_code;
        window.open(`http://${window.location.hostname}:3000/api/outbound/${targetCode}/bolla-pdf?token=${token}`, '_blank');
      }
      setBollaModal(prev => ({ ...prev, show: false, saving: false }));
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore salvataggio opzioni Bolla');
      setBollaModal(prev => ({ ...prev, saving: false }));
    }
  };

  const confirmOrder = async (code) => {
    if (isProcessing) return;
    if (!await appConfirm('Vuoi confermare la spedizione? Questo scaricherà la merce dal magazzino definitivamente.')) return;
    setIsProcessing(true);
    try {
      await axios.post(`http://${window.location.hostname}:3000/api/outbound/${code}/confirm`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchOrders();
      appAlert('Spedizione confermata e merce scaricata!', 'Successo', 'success');
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore');
    } finally {
      setIsProcessing(false);
    }
  };

  const selectStyles = {
    control: (base, state) => ({
      ...base,
      backgroundColor: '#020617', 
      borderColor: state.isFocused ? '#38bdf8' : '#1e293b', 
      borderRadius: '0.75rem',
      padding: '0.15rem',
      minHeight: '42px',
      boxShadow: 'none',
      '&:hover': { borderColor: '#38bdf8' }
    }),
    menu: base => ({ ...base, backgroundColor: '#0f172a', zIndex: 50, border: '1px solid #1e293b' }),
    option: (base, state) => ({ ...base, backgroundColor: state.isFocused ? '#1e293b' : 'transparent', color: '#f8fafc', cursor: 'pointer', fontSize: '0.875rem' }),
    singleValue: base => ({ ...base, color: '#f8fafc', fontWeight: 'bold', fontSize: '0.875rem' }),
    input: base => ({ ...base, color: '#f8fafc' }),
    placeholder: base => ({ ...base, color: '#475569', fontSize: '0.875rem' })
  };

  // Raggruppa le palette disponibili per (product_id + lotto) e conserva anche le singole palette (con Rif. Paletta Cliente)
  const groupedLotRows = useMemo(() => {
    const map = new Map();
    const batchesByProduct = new Map();
    const palletsByProduct = new Map();

    const sortSinglePallets = (list) => {
      return [...list].sort((a, b) => {
        const refA = (a.client_pallet_number || '').trim();
        const refB = (b.client_pallet_number || '').trim();
        if (refA && !refB) return -1;
        if (!refA && refB) return 1;
        if (refA && refB && refA !== refB) {
          return refA.localeCompare(refB, undefined, { numeric: true, sensitivity: 'base' });
        }
        if (!a.expiration_date && !b.expiration_date) return 0;
        if (!a.expiration_date) return 1;
        if (!b.expiration_date) return -1;
        return new Date(a.expiration_date) - new Date(b.expiration_date);
      });
    };

    availablePallets.forEach(p => {
      const batchNorm = (p.batch && String(p.batch).trim() !== '') ? String(p.batch).trim() : 'Nessun lotto';
      const key = `${p.product_id}__${batchNorm}`;
      const availQty = parseFloat((p.available_quantity ?? p.quantity) || 0);
      const upb = parseFloat(p.units_per_box) || 1;
      const bpp = parseFloat(p.boxes_per_pallet) || 1;
      const unitsPerPallet = upb * bpp;
      const baseUom = (p.uom === 'Scatole' || p.uom === 'Bancali' || !p.uom) ? 'Pezzi' : p.uom;
      const clientPalRef = p.client_pallet_number ? String(p.client_pallet_number).trim() : '';

      const rowPallets = (unitsPerPallet > 1 && availQty >= unitsPerPallet * 2)
        ? Math.max(1, Math.floor(availQty / unitsPerPallet))
        : 1;

      const singlePalletEntry = {
        id: p.id,
        pallet_code: p.pallet_code,
        client_pallet_number: clientPalRef,
        batch: batchNorm,
        available_quantity: availQty,
        rowPallets,
        location: p.location || '',
        expiration_date: p.expiration_date || null,
        units_per_box: upb,
        boxes_per_pallet: bpp,
        kg_per_unit: parseFloat(p.kg_per_unit) || null,
        base_uom: baseUom
      };

      if (!palletsByProduct.has(p.product_id)) {
        palletsByProduct.set(p.product_id, []);
      }
      palletsByProduct.get(p.product_id).push(singlePalletEntry);

      if (!batchesByProduct.has(p.product_id)) {
        batchesByProduct.set(p.product_id, new Map());
      }
      const prodBatches = batchesByProduct.get(p.product_id);
      if (!prodBatches.has(batchNorm)) {
        prodBatches.set(batchNorm, { batch: batchNorm, total_quantity: 0, pallet_count: 0 });
      }
      const bStat = prodBatches.get(batchNorm);
      bStat.total_quantity += availQty;
      bStat.pallet_count += rowPallets;

      if (!map.has(key)) {
        map.set(key, {
          key,
          product_id: p.product_id,
          name: p.product_name,
          sku: p.product_sku || p.client_article_number || '',
          batch: batchNorm,
          total_quantity: 0,
          pallet_count: 0,
          units_per_box: upb,
          boxes_per_pallet: bpp,
          kg_per_unit: parseFloat(p.kg_per_unit) || null,
          uom: p.uom || p.pallet_uom || 'Pezzi',
          base_uom: baseUom,
          pallet_codes: new Set(),
          client_pallet_numbers: new Set(),
          locations: new Set(),
          pallets: [],
          expiration_date: p.expiration_date || null
        });
      }

      const g = map.get(key);
      g.total_quantity += availQty;
      g.pallet_count += rowPallets;
      if (p.pallet_code) g.pallet_codes.add(p.pallet_code);
      if (clientPalRef) g.client_pallet_numbers.add(clientPalRef);
      if (p.location) g.locations.add(p.location);
      g.pallets.push(singlePalletEntry);
      if (p.expiration_date && (!g.expiration_date || new Date(p.expiration_date) < new Date(g.expiration_date))) {
        g.expiration_date = p.expiration_date;
      }
    });

    return Array.from(map.values()).map(g => {
      const sortedPallets = sortSinglePallets(g.pallets);
      const sortedProductPallets = sortSinglePallets(palletsByProduct.get(g.product_id) || []);
      const clientRefs = Array.from(g.client_pallet_numbers).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
      );
      return {
        ...g,
        pallet_codes: Array.from(g.pallet_codes),
        client_pallet_numbers: clientRefs,
        first_client_pallet: clientRefs[0] || '',
        locations: Array.from(g.locations),
        pallets: sortedPallets,
        productPallets: sortedProductPallets,
        productBatches: Array.from((batchesByProduct.get(g.product_id) || new Map()).values())
      };
    });
  }, [availablePallets]);

  const filteredLotRows = useMemo(() => {
    const term = palletSearchTerm.trim().toLowerCase();
    let rows = groupedLotRows;
    if (term) {
      rows = rows.filter(row => {
        const nameMatch = (row.name || '').toLowerCase().includes(term);
        const skuMatch = (row.sku || '').toLowerCase().includes(term);
        const batchMatch = (row.batch || '').toLowerCase().includes(term);
        const palletMatch = row.pallet_codes.some(c => c.toLowerCase().includes(term));
        const clientPalMatch = (row.client_pallet_numbers || []).some(cp => cp.toLowerCase().includes(term));
        const locMatch = row.locations.some(l => l.toLowerCase().includes(term));
        return nameMatch || skuMatch || batchMatch || palletMatch || clientPalMatch || locMatch;
      });
    }
    return [...rows].sort((a, b) => {
      if (lotSortBy === 'CLIENT_PAL_ASC' || lotSortBy === 'CLIENT_PAL_DESC') {
        const refA = (a.first_client_pallet || '').trim();
        const refB = (b.first_client_pallet || '').trim();
        if (!refA && !refB) return (a.name || '').localeCompare(b.name || '');
        if (!refA) return 1;
        if (!refB) return -1;
        const cmp = refA.localeCompare(refB, undefined, { numeric: true, sensitivity: 'base' });
        return lotSortBy === 'CLIENT_PAL_ASC' ? cmp : -cmp;
      }
      if (lotSortBy === 'FEFO') {
        if (!a.expiration_date && !b.expiration_date) return (a.name || '').localeCompare(b.name || '');
        if (!a.expiration_date) return 1;
        if (!b.expiration_date) return -1;
        return new Date(a.expiration_date) - new Date(b.expiration_date);
      }
      if (lotSortBy === 'QTY_DESC') {
        return b.total_quantity - a.total_quantity;
      }
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [groupedLotRows, palletSearchTerm, lotSortBy]);

  // Base filtered orders (without statusFilter) for KPI cards
  const baseFilteredOrders = useMemo(() => {
    return orders.filter(o => {
      if (customerFilter && String(o.customer_id) !== String(customerFilter)) return false;
      if (dateFrom && o.exit_date.split('T')[0] < dateFrom) return false;
      if (dateTo && o.exit_date.split('T')[0] > dateTo) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const codeMatch = (o.order_code || '').toLowerCase().includes(term);
        const customerMatch = (o.customer_name || '').toLowerCase().includes(term);
        const ddtMatch = (o.client_ddt || '').toLowerCase().includes(term);
        const batchMatch = (o.batches || '').toLowerCase().includes(term);
        const prodMatch = (o.products || '').toLowerCase().includes(term);
        const palMatch = (o.pallets || '').toLowerCase().includes(term);
        const opMatch = (o.picking_operator || '').toLowerCase().includes(term);
        if (!codeMatch && !customerMatch && !ddtMatch && !batchMatch && !prodMatch && !palMatch && !opMatch) return false;
      }
      return true;
    });
  }, [orders, customerFilter, dateFrom, dateTo, searchTerm]);

  const statusStats = useMemo(() => {
    const s = { ALL: baseFilteredOrders.length, PENDING: 0, PICKING: 0, READY: 0, SHIPPED: 0, RETURNED: 0 };
    baseFilteredOrders.forEach(o => {
      if (s[o.status] !== undefined) s[o.status] += 1;
    });
    return s;
  }, [baseFilteredOrders]);

  const filteredOrders = useMemo(() => {
    if (!statusFilter) return baseFilteredOrders;
    return baseFilteredOrders.filter(o => o.status === statusFilter);
  }, [baseFilteredOrders, statusFilter]);

  const hasActiveFilters = searchTerm !== '' || statusFilter !== '' || customerFilter !== '' || dateFrom !== '' || dateTo !== '';

  const resetAllFilters = () => {
    setSearchTerm('');
    setStatusFilter('');
    setCustomerFilter('');
    setDateFrom('');
    setDateTo('');
  };

  const applyDatePreset = (preset) => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    if (preset === 'TODAY') {
      setDateFrom(todayStr);
      setDateTo(todayStr);
    } else if (preset === 'WEEK') {
      const weekAgo = new Date(today);
      weekAgo.setDate(today.getDate() - 7);
      setDateFrom(weekAgo.toISOString().split('T')[0]);
      setDateTo(todayStr);
    } else if (preset === 'MONTH') {
      const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      setDateFrom(firstOfMonth.toISOString().split('T')[0]);
      setDateTo(todayStr);
    }
  };

  // Calcola le scorte disponibili per il lotto o bancale specifico selezionato nel Pick Modal
  const selectedBatchStats = useMemo(() => {
    if (!pickingPallet) return { qty: 0, boxes: 0, pallets: 0, chosenPallet: null, candidatePallets: [] };
    const selBatch = pickingPallet.selectedBatch || pickingPallet.batch;
    const upb = parseFloat(pickingPallet.units_per_box) || 1;
    const allProductPallets = pickingPallet.productPallets || pickingPallet.pallets || [];
    const candidatePallets = selBatch === 'TUTTI'
      ? allProductPallets
      : allProductPallets.filter(p => p.batch === selBatch);

    if (pickingPallet.selectedPalletId) {
      const chosen = candidatePallets.find(p => String(p.id) === String(pickingPallet.selectedPalletId));
      if (chosen) {
        return {
          qty: chosen.available_quantity,
          boxes: Math.floor(chosen.available_quantity / upb),
          pallets: chosen.rowPallets || 1,
          chosenPallet: chosen,
          candidatePallets
        };
      }
    }

    if (selBatch === 'TUTTI') {
      const totalQty = (pickingPallet.productBatches || []).reduce((acc, b) => acc + b.total_quantity, 0);
      const totalPallets = (pickingPallet.productBatches || []).reduce((acc, b) => acc + b.pallet_count, 0);
      return {
        qty: totalQty,
        boxes: Math.floor(totalQty / upb),
        pallets: totalPallets,
        chosenPallet: null,
        candidatePallets
      };
    }

    const found = (pickingPallet.productBatches || []).find(b => b.batch === selBatch);
    const qty = found ? found.total_quantity : pickingPallet.total_quantity;
    const pallets = found ? found.pallet_count : pickingPallet.pallet_count;
    return {
      qty,
      boxes: Math.floor(qty / upb),
      pallets,
      chosenPallet: null,
      candidatePallets
    };
  }, [pickingPallet]);

  return (
    <div className="w-full min-w-0 max-w-7xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-black text-brand-white flex items-center gap-2.5 sm:gap-3">
            <Truck className="text-brand-blue shrink-0" size={30} />
            <span className="truncate">Uscite e Spedizioni (Out-bound)</span>
          </h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">
            Gestione ordini d'uscita, semaforo avanzamento picking Zebra in tempo reale e scarico definitivo.
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5 sm:gap-3 w-full md:w-auto">
          <button
            onClick={() => navigate('/desktop/outbound/history')}
            className="w-full sm:w-auto justify-center bg-slate-900 border border-slate-700 hover:bg-slate-800 text-brand-white font-bold py-2.5 px-4 sm:px-5 rounded-xl flex items-center gap-2 transition-all text-sm"
          >
            <History size={18} className="text-brand-blue shrink-0" /> Storico Articoli Usciti
          </button>
          {canCreateOutbound && (<button
            onClick={() => {
              setNewOrder({
                customer_id: '',
                exit_date: new Date().toISOString().split('T')[0],
                client_ddt: '',
                notes: '',
                generate_exit_ddt: true,
                is_container: false,
                require_load_recheck: false,
                origin_warehouse_id: String(warehouses[0]?.id || '1'),
                delivery_address_id: '',
                delivery_label: '',
                delivery_address_text: '',
                bolla_options: { ...DEFAULT_BOLLA_OPTIONS }
              });
              setOrderDeliveryAddresses([]);
              setShowAdvancedBollaCreate(false);
              setCart([]);
              setAvailablePallets([]);
              setPalletSearchTerm('');
              setShowModal(true);
            }}
            className="w-full sm:w-auto justify-center bg-brand-blue hover:bg-sky-400 text-brand-black font-black py-2.5 px-5 sm:px-6 rounded-xl flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(14,165,233,0.3)] text-sm"
          >
            <Plus size={18} /> Nuova Spedizione
          </button>)}
        </div>
      </div>

      {/* Cruscotto Interattivo Stati Spedizione (5 Card KPI) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5 sm:gap-3 mb-6">
        <button
          type="button"
          onClick={() => setStatusFilter('')}
          className={`text-left p-4 rounded-2xl border transition-all relative overflow-hidden ${
            statusFilter === ''
              ? 'bg-slate-900 border-brand-blue shadow-[0_0_20px_rgba(14,165,233,0.15)]'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Tutte le Uscite</span>
            <Truck size={16} className="text-brand-blue" />
          </div>
          <div className="text-2xl font-black text-brand-white">{statusStats.ALL}</div>
          <div className="text-[11px] text-slate-400 mt-1">Ordini nel periodo</div>
          {statusStats.ALL > 0 && (
            <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden flex mt-2.5">
              <div style={{ width: `${(statusStats.PENDING / statusStats.ALL) * 100}%` }} className="bg-slate-500 h-full" />
              <div style={{ width: `${(statusStats.PICKING / statusStats.ALL) * 100}%` }} className="bg-amber-500 h-full" />
              <div style={{ width: `${(statusStats.READY / statusStats.ALL) * 100}%` }} className="bg-emerald-500 h-full" />
              <div style={{ width: `${(statusStats.SHIPPED / statusStats.ALL) * 100}%` }} className="bg-sky-500 h-full" />
              <div style={{ width: `${((statusStats.RETURNED || 0) / statusStats.ALL) * 100}%` }} className="bg-amber-500 h-full" />
            </div>
          )}
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === 'PENDING' ? '' : 'PENDING')}
          className={`text-left p-4 rounded-2xl border transition-all ${
            statusFilter === 'PENDING'
              ? 'bg-slate-800 border-slate-400 shadow-lg'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-600'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300">In Attesa</span>
            <Clock size={16} className="text-slate-400" />
          </div>
          <div className="text-2xl font-black text-brand-white">{statusStats.PENDING}</div>
          <div className="text-[11px] text-slate-400 mt-1">Da prendere in carico</div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === 'PICKING' ? '' : 'PICKING')}
          className={`text-left p-4 rounded-2xl border transition-all ${
            statusFilter === 'PICKING'
              ? 'bg-amber-950/40 border-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.2)]'
              : 'bg-slate-900/60 border-slate-800 hover:border-amber-500/50'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              {statusStats.PICKING > 0 && <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />}
              In Prelievo Live
            </span>
            <Zap size={16} className="text-amber-400" />
          </div>
          <div className="text-2xl font-black text-amber-400">{statusStats.PICKING}</div>
          <div className="text-[11px] text-amber-300/70 mt-1">Operatori su Zebra</div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === 'READY' ? '' : 'READY')}
          className={`text-left p-4 rounded-2xl border transition-all ${
            statusFilter === 'READY'
              ? 'bg-emerald-950/30 border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.2)]'
              : 'bg-slate-900/60 border-slate-800 hover:border-emerald-500/50'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">Pronte (Zona Carico)</span>
            <CheckCircle size={16} className="text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-400">{statusStats.READY}</div>
          <div className="text-[11px] text-emerald-300/70 mt-1">In attesa di conferma uscita</div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === 'SHIPPED' ? '' : 'SHIPPED')}
          className={`text-left p-4 rounded-2xl border transition-all ${
            statusFilter === 'SHIPPED'
              ? 'bg-sky-950/30 border-sky-500 shadow-[0_0_20px_rgba(14,165,233,0.2)]'
              : 'bg-slate-900/60 border-slate-800 hover:border-sky-500/50'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold uppercase tracking-wider text-sky-400">Spedite ed Evase</span>
            <Package size={16} className="text-sky-400" />
          </div>
          <div className="text-2xl font-black text-sky-400">{statusStats.SHIPPED}</div>
          <div className="text-[11px] text-sky-300/70 mt-1">Scaricate dal magazzino</div>
        </button>
      </div>

      {/* Barra Filtri Avanzata */}
      {/* Search & Filters Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 sm:p-4 mb-6 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3 shadow-xl">
        <div className="w-full sm:flex-1 sm:min-w-[230px] relative">
          <input 
            type="text" 
            placeholder="Cerca ordine, cliente, DDT, lotto, articolo o op..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl py-2.5 pl-10 pr-8 text-sm focus:ring-brand-blue"
          />
          <Search size={17} className="absolute left-3.5 top-3 text-slate-500" />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} className="absolute right-3 top-3 text-slate-500 hover:text-white">
              <X size={15} />
            </button>
          )}
        </div>

        <div className="w-full sm:w-[205px]">
          <select
            value={customerFilter}
            onChange={e => setCustomerFilter(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl py-2.5 px-3 text-sm focus:ring-brand-blue"
          >
            <option value="">Tutti i clienti</option>
            {customers.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        <div className="w-full lg:w-auto flex flex-wrap items-center gap-2 text-xs">
          <Calendar size={15} className="text-brand-blue ml-1 shrink-0" />
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="flex-1 sm:flex-none min-w-0 bg-slate-950 border border-slate-800 text-slate-300 rounded-xl px-2.5 py-2 [color-scheme:dark]" title="Da data" />
          <span className="text-slate-500">-</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="flex-1 sm:flex-none min-w-0 bg-slate-950 border border-slate-800 text-slate-300 rounded-xl px-2.5 py-2 [color-scheme:dark]" title="A data" />

          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button type="button" onClick={() => applyDatePreset('TODAY')} className="px-2 py-1 rounded-lg text-[11px] font-bold text-slate-400 hover:text-white hover:bg-slate-800">Oggi</button>
            <button type="button" onClick={() => applyDatePreset('WEEK')} className="px-2 py-1 rounded-lg text-[11px] font-bold text-slate-400 hover:text-white hover:bg-slate-800">7 gg</button>
            <button type="button" onClick={() => applyDatePreset('MONTH')} className="px-2 py-1 rounded-lg text-[11px] font-bold text-slate-400 hover:text-white hover:bg-slate-800">Mese</button>
          </div>
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={resetAllFilters}
            className="flex items-center justify-center gap-1.5 px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-xl text-xs font-bold transition-colors"
          >
            <RotateCcw size={13} /> Reset
          </button>
        )}
      </div>

      {/* Orders Table & Responsive Mobile Cards */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
        {/* Mobile & Tablet Cards (< lg) */}
        <div className="lg:hidden p-3 sm:p-4 space-y-3">
          {filteredOrders.length === 0 ? (
            <div className="p-8 text-center text-slate-500 font-medium text-sm">
              Nessuna spedizione corrisponde ai filtri selezionati
            </div>
          ) : filteredOrders.map(o => {
            const totalItems = parseInt(o.total_items, 10) || 0;
            const pickedItems = parseInt(o.picked_items, 10) || 0;
            const progressPct = totalItems > 0 ? Math.min(100, Math.round((pickedItems / totalItems) * 100)) : 0;
            const clientRecord = customerRecords.find(c => Number(c.id) === Number(o.customer_id));
            const clientExitDdtEnabled = clientRecord
              ? Number(clientRecord.generate_exit_ddt ?? 1) !== 0
              : Number(o.customer_generate_exit_ddt ?? 1) !== 0;

            return (
              <div key={o.id} className="bg-slate-950/70 border border-slate-800 rounded-2xl p-3.5 sm:p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-black text-brand-white text-sm">{o.order_code}</span>
                      {clientExitDdtEnabled && o.bolla_number && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 rounded-full font-mono font-bold">
                          <FileText size={10} /> {o.bolla_number}
                        </span>
                      )}
                    </div>
                    <div className="text-brand-blue font-bold text-sm mt-0.5 truncate">{o.customer_name}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[11px] font-bold text-slate-400">
                      {new Date(o.exit_date).toLocaleDateString('it-IT')}
                    </div>
                    {o.client_ddt && (
                      <div className="text-[10px] text-brand-blue font-bold uppercase mt-0.5">DDT: {o.client_ddt}</div>
                    )}
                  </div>
                </div>

                {(o.delivery_label || o.notes) && (
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    {o.delivery_label && (
                      <span className="px-2 py-0.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-300 font-semibold truncate max-w-full">
                        Dest: {o.delivery_label}
                      </span>
                    )}
                    {o.notes && (
                      <span className="px-2 py-0.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 font-semibold truncate max-w-full">
                        Nota: {o.notes}
                      </span>
                    )}
                  </div>
                )}

                <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-2.5 space-y-1.5">
                  <div className="text-xs font-semibold text-slate-200 line-clamp-2">
                    {o.products || <span className="text-slate-500 italic">Nessun articolo riepilogato</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-bold bg-slate-950 border border-slate-800 text-slate-400 px-2 py-0.5 rounded-md">
                      {totalItems} {totalItems === 1 ? 'riga' : 'righe'}
                    </span>
                    {o.batches && (
                      <span className="text-[10px] font-mono font-bold bg-amber-500/10 border border-amber-500/30 text-amber-300 px-2 py-0.5 rounded-md truncate max-w-full">
                        Lotti: {o.batches}
                      </span>
                    )}
                    {o.client_pallets && (
                      <span className="text-[10px] font-mono font-bold bg-sky-500/15 border border-sky-500/30 text-sky-300 px-2 py-0.5 rounded-md truncate max-w-full">
                        Rif. Pal: {o.client_pallets}
                      </span>
                    )}
                  </div>
                </div>

                {/* Stato & Avanzamento */}
                <div onClick={() => setTimelineModal(o)} className="cursor-pointer">
                  {o.status === 'PENDING' && (
                    <span className="inline-flex items-center gap-1.5 bg-slate-500/20 text-slate-300 px-3 py-1 rounded-full text-xs font-bold border border-slate-500/30">
                      <span className="w-2 h-2 rounded-full bg-slate-400" />
                      IN ATTESA ({pickedItems} / {totalItems} righe)
                    </span>
                  )}
                  {o.status === 'PICKING' && (
                    <div className="flex flex-col gap-1.5 bg-amber-500/10 border border-amber-500/30 rounded-xl p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-amber-400 text-xs font-black uppercase">
                          <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" /> IN PRELIEVO
                        </span>
                        <span className="font-mono text-xs font-black text-brand-white">
                          {pickedItems}/{totalItems} ({progressPct}%)
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-amber-500 to-emerald-400 rounded-full" style={{ width: `${Math.max(6, progressPct)}%` }} />
                      </div>
                      <div className="text-[11px] text-slate-300 font-semibold">
                        Operatore: <strong className="text-brand-white">{o.picking_operator || 'In corso...'}</strong>
                      </div>
                    </div>
                  )}
                  {o.status === 'READY' && (
                    <div className="flex flex-col gap-1 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-emerald-400 text-xs font-black uppercase">
                          <span className="w-2 h-2 rounded-full bg-emerald-400" /> PRONTO (ZONA CARICO)
                        </span>
                        <span className="font-mono text-xs font-bold text-emerald-300">{totalItems}/{totalItems} righe</span>
                      </div>
                      {o.picking_operator && (
                        <div className="text-[11px] text-slate-300 font-semibold">
                          Operatore: <strong className="text-brand-white">{o.picking_operator}</strong>
                        </div>
                      )}
                    </div>
                  )}
                  {o.status === 'SHIPPED' && (
                    <span className="inline-flex items-center gap-1.5 bg-sky-500/20 text-sky-400 px-3 py-1 rounded-full text-xs font-bold border border-sky-500/30">
                      <span className="w-2 h-2 rounded-full bg-sky-400" /> SPEDITO ({totalItems} righe)
                    </span>
                  )}
                </div>

                {/* Azioni Mobile */}
                <div className="flex flex-wrap items-center justify-end gap-1.5 pt-2 border-t border-slate-800/80">
                  <button
                    onClick={() => setTimelineModal(o)}
                    className="p-2 bg-slate-800 hover:bg-slate-700 text-brand-blue rounded-xl transition-colors"
                    title="Vedi Dettagli e Tempistiche"
                  >
                    <Eye size={16} />
                  </button>
                  <button
                    onClick={() => window.open(`http://${window.location.hostname}:3000/api/outbound/${o.order_code}/pdf?token=${token}`, '_blank')}
                    className="p-2 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-xl transition-colors"
                    title="Stampa Picking List Interna"
                  >
                    <Printer size={16} />
                  </button>
                  {clientExitDdtEnabled && (
                    <button
                      onClick={() => openBollaModal(o)}
                      className={`px-2.5 py-2 rounded-xl transition-all font-bold text-xs flex items-center gap-1.5 border ${
                        o.bolla_number
                          ? 'bg-sky-500/15 hover:bg-sky-500 text-sky-300 hover:text-brand-black border-sky-500/40'
                          : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border-slate-700'
                      }`}
                    >
                      <FileText size={14} /> {o.bolla_number ? 'Bolla DDT' : 'Bolla'}
                    </button>
                  )}
                  {o.status === 'SHIPPED' && canReturnOutbound && canTouchCustomer(o.customer_id) && (
                    <button
                      onClick={() => openReturnModal(o)}
                      className="px-2.5 py-2 bg-amber-500/20 hover:bg-amber-500 text-amber-400 hover:text-black border border-amber-500/40 rounded-xl transition-all font-bold text-xs flex items-center gap-1"
                    >
                      <RotateCcw size={14} /> Reso
                    </button>
                  )}
                  {o.status !== 'SHIPPED' && canTouchCustomer(o.customer_id) && (
                    <>
                      {canCreateOutbound && (
                        <button
                          onClick={() => editOrder(o.id)}
                          className="bg-brand-blue/15 hover:bg-brand-blue text-brand-blue hover:text-brand-black p-2 rounded-xl transition-colors"
                          title="Modifica Spedizione"
                        >
                          <Edit3 size={16} />
                        </button>
                      )}
                      {canDeleteOutbound && (
                        <button
                          onClick={() => setDeleteConfirm({show: true, id: o.id, code: o.order_code, expected: Math.floor(1000 + Math.random() * 9000).toString(), input: ''})}
                          className="bg-rose-500/15 hover:bg-rose-500 text-rose-400 hover:text-white p-2 rounded-xl transition-colors"
                          title="Elimina Spedizione"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </>
                  )}
                  {o.status !== 'SHIPPED' && canPickOutbound && canTouchCustomer(o.customer_id) && (
                    <button
                      onClick={() => confirmOrder(o.order_code)}
                      className={`px-3 py-2 rounded-xl transition-all font-bold text-xs flex items-center gap-1 ${
                        o.status === 'READY'
                          ? 'bg-emerald-500 hover:bg-emerald-400 text-emerald-950'
                          : 'bg-emerald-500/20 hover:bg-emerald-500 text-emerald-400 hover:text-emerald-950 border border-emerald-500/30'
                      }`}
                    >
                      <CheckCircle size={15} /> {o.status === 'RETURNED' ? 'Rispedisci' : o.status === 'READY' ? 'Conferma' : 'Evadi'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Desktop Table (>= lg) */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-left border-collapse whitespace-nowrap md:whitespace-normal">
            <thead>
              <tr className="bg-slate-950/60">
                <th className="px-4 py-3.5 text-slate-400 font-bold uppercase tracking-wider text-xs border-b border-slate-800">DDT / Ordine</th>
                <th className="px-4 py-3.5 text-slate-400 font-bold uppercase tracking-wider text-xs border-b border-slate-800">Data Uscita</th>
                <th className="px-4 py-3.5 text-slate-400 font-bold uppercase tracking-wider text-xs border-b border-slate-800">Cliente</th>
                <th className="px-4 py-3.5 text-slate-400 font-bold uppercase tracking-wider text-xs border-b border-slate-800">Merce & Lotti</th>
                <th className="px-4 py-3.5 text-slate-400 font-bold uppercase tracking-wider text-xs border-b border-slate-800">Stato & Avanzamento Picking</th>
                <th className="px-4 py-3.5 text-slate-400 font-bold uppercase tracking-wider text-xs border-b border-slate-800 text-right">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan="6" className="p-10 text-center text-slate-500 font-medium">Nessuna spedizione corrisponde ai filtri selezionati</td>
                </tr>
              ) : filteredOrders.map(o => {
                const totalItems = parseInt(o.total_items, 10) || 0;
                const pickedItems = parseInt(o.picked_items, 10) || 0;
                const progressPct = totalItems > 0 ? Math.min(100, Math.round((pickedItems / totalItems) * 100)) : 0;
                const clientRecord = customerRecords.find(c => Number(c.id) === Number(o.customer_id));
                const clientExitDdtEnabled = clientRecord
                  ? Number(clientRecord.generate_exit_ddt ?? 1) !== 0
                  : Number(o.customer_generate_exit_ddt ?? 1) !== 0;

                return (
                <tr key={o.id} className="hover:bg-slate-800/40 border-b border-slate-800/50 transition-colors group">
                  <td className="px-4 py-3.5 font-mono font-bold text-brand-white">
                    <div className="flex flex-col">
                      <span className="text-sm">{o.order_code}</span>
                      {clientExitDdtEnabled && o.bolla_number && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-mono font-bold mt-0.5">
                          <FileText size={11} /> Bolla: {o.bolla_number}
                        </span>
                      )}
                      {o.client_ddt && (
                        <span className="text-[11px] text-brand-blue font-sans font-bold uppercase mt-0.5">
                          DDT Rif: {o.client_ddt}
                        </span>
                      )}
                      {o.delivery_label && (
                        <span className="text-[10px] text-sky-300 font-sans font-semibold mt-0.5 truncate max-w-[190px]" title={o.delivery_address_text || o.delivery_label}>
                          Dest: {o.delivery_label}
                        </span>
                      )}
                      {o.notes && (
                        <span className="text-[10px] text-amber-300 font-sans font-semibold mt-0.5 truncate max-w-[180px]" title={`Nota DDT: ${o.notes}`}>
                          Nota: {o.notes}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-slate-300 text-sm">
                    {new Date(o.exit_date).toLocaleDateString('it-IT')}
                  </td>
                  <td className="px-4 py-3.5 font-bold text-brand-blue text-sm">
                    {o.customer_name}
                  </td>
                  <td className="px-4 py-3.5 max-w-[260px]">
                    <div className="flex flex-col gap-1">
                      {o.products ? (
                        <span className="text-xs font-semibold text-slate-200 truncate" title={o.products}>
                          {o.products}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500 italic">-</span>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-bold bg-slate-950 border border-slate-800 text-slate-400 px-2 py-0.5 rounded-md">
                          {totalItems} {totalItems === 1 ? 'riga' : 'righe'}
                        </span>
                        {o.batches && (
                          <span className="text-[10px] font-mono font-bold bg-amber-500/10 border border-amber-500/30 text-amber-300 px-2 py-0.5 rounded-md truncate max-w-[170px]" title={`Lotti: ${o.batches}`}>
                            Lotti: {o.batches}
                          </span>
                        )}
                        {o.client_pallets && (
                          <span className="text-[10px] font-mono font-bold bg-sky-500/15 border border-sky-500/30 text-sky-300 px-2 py-0.5 rounded-md truncate max-w-[170px]" title={`Rif. Palette Cliente: ${o.client_pallets}`}>
                            Rif. Pal: {o.client_pallets}
                          </span>
                        )}
                        {Boolean(o.is_container) && (
                          <span className="text-[10px] font-black bg-amber-500/20 border border-amber-500/40 text-amber-300 px-2 py-0.5 rounded-md">
                            CONTAINER
                          </span>
                        )}
                        {Boolean(o.has_adr) && (
                          <span className="text-[10px] font-black bg-rose-500/20 border border-rose-500/40 text-rose-300 px-2 py-0.5 rounded-md">
                            ADR
                          </span>
                        )}
                        {String(o.temp_regimes || '').split(',').filter(t => t && t !== 'NONE').map(t => (
                          <span key={t} className="text-[10px] font-bold bg-cyan-500/15 border border-cyan-500/35 text-cyan-300 px-2 py-0.5 rounded-md">
                            {TEMP_REGIME_MAP[normalizeTempRegime(t)]?.shortLabel || t}
                          </span>
                        ))}
                        {Boolean(o.load_completed_at) && (
                          <span className="text-[10px] font-bold bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 px-2 py-0.5 rounded-md">
                            Carico: {o.load_vehicle_plate || 'OK'}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 min-w-[250px]">
                    {o.status === 'PENDING' && (
                      <div
                        onClick={() => setTimelineModal(o)}
                        className="flex flex-col gap-1 items-start cursor-pointer"
                        title="Clicca per aprire il dettaglio"
                      >
                        <span className="inline-flex items-center gap-1.5 bg-slate-500/20 text-slate-300 px-3 py-1 rounded-full text-xs font-bold border border-slate-500/30 hover:border-slate-400 transition-colors">
                          <span className="w-2 h-2 rounded-full bg-slate-400" />
                          IN ATTESA ({pickedItems} / {totalItems} righe)
                        </span>
                      </div>
                    )}

                    {o.status === 'PICKING' && (
                      <div
                        onClick={() => setTimelineModal(o)}
                        className="flex flex-col gap-1.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl p-2.5 max-w-[290px] cursor-pointer hover:bg-amber-500/15 transition-colors"
                        title="Clicca per aprire il dettaglio Timeline"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-amber-400 text-xs font-black uppercase tracking-wider">
                            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
                            IN PRELIEVO
                          </span>
                          <span className="font-mono text-xs font-black text-brand-white bg-slate-950/80 px-2 py-0.5 rounded-lg border border-amber-500/30">
                            {pickedItems} / {totalItems} righe ({progressPct}%)
                          </span>
                        </div>
                        <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                          <div
                            className="h-full bg-gradient-to-r from-amber-500 to-emerald-400 transition-all duration-500 rounded-full"
                            style={{ width: `${Math.max(6, progressPct)}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-slate-300 font-semibold">
                          <span className="flex items-center gap-1">
                            <User size={12} className="text-amber-400" />
                            Operatore: <strong className="text-brand-white">{o.picking_operator || 'In corso...'}</strong>
                          </span>
                        </div>
                      </div>
                    )}

                    {o.status === 'READY' && (
                      <div
                        onClick={() => setTimelineModal(o)}
                        className="flex flex-col gap-1 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-2.5 max-w-[290px] cursor-pointer hover:bg-emerald-500/15 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-emerald-400 text-xs font-black uppercase tracking-wider">
                            <span className="w-2 h-2 rounded-full bg-emerald-400" />
                            PRONTO (ZONA CARICO)
                          </span>
                          <span className="font-mono text-xs font-bold text-emerald-300">
                            {totalItems} / {totalItems} righe
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden">
                          <div className="h-full w-full bg-emerald-400 rounded-full" />
                        </div>
                        {o.picking_operator && (
                          <div className="text-[11px] text-slate-300 font-semibold flex items-center gap-1">
                            <User size={11} className="text-emerald-400" />
                            Operatore: <strong className="text-brand-white">{o.picking_operator}</strong>
                          </div>
                        )}
                      </div>
                    )}

                    {o.status === 'SHIPPED' && canReturnOutbound && canTouchCustomer(o.customer_id) && (
                      <div
                        onClick={() => setTimelineModal(o)}
                        className="flex flex-col gap-1 items-start cursor-pointer"
                      >
                        <span className="inline-flex items-center gap-1.5 bg-sky-500/20 text-sky-400 px-3 py-1 rounded-full text-xs font-bold border border-sky-500/30">
                          <span className="w-2 h-2 rounded-full bg-sky-400" />
                          SPEDITO ({totalItems} righe)
                        </span>
                        {o.picking_operator && (
                          <span className="text-[10px] text-slate-400 pl-1">
                            Op: <strong className="text-slate-300">{o.picking_operator}</strong>
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <div className="flex justify-end items-center gap-1.5">
                      <button 
                        onClick={() => setTimelineModal(o)}
                        className="p-2 bg-slate-800 hover:bg-slate-700 text-brand-blue rounded-xl transition-colors"
                        title="Vedi Dettagli e Tempistiche (Timeline)"
                      >
                        <Eye size={17} />
                      </button>
                      <button 
                        onClick={() => window.open(`http://${window.location.hostname}:3000/api/outbound/${o.order_code}/pdf?token=${token}`, '_blank')}
                        className="p-2 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-xl transition-colors"
                        title="Stampa Picking List Interna"
                      >
                        <Printer size={17} />
                      </button>
                      {clientExitDdtEnabled && (
                        <button
                          onClick={() => openBollaModal(o)}
                          className={`px-2.5 py-2 rounded-xl transition-all font-bold text-xs flex items-center gap-1.5 border ${
                            o.bolla_number
                              ? 'bg-sky-500/15 hover:bg-sky-500 text-sky-300 hover:text-brand-black border-sky-500/40'
                              : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border-slate-700'
                          }`}
                          title={o.bolla_number ? `Configura / Stampa Bolla ${o.bolla_number}` : 'Configura & Genera Bolla di Uscita / DDT Autotrasporto'}
                        >
                          <FileText size={15} />
                          <span className="hidden xl:inline">{o.bolla_number ? 'Bolla DDT' : 'Bolla'}</span>
                        </button>
                      )}
                      {o.status === 'SHIPPED' && (
                        <button 
                          onClick={() => openReturnModal(o)}
                          className="px-3 py-2 bg-amber-500/20 hover:bg-amber-500 text-amber-400 hover:text-black border border-amber-500/40 rounded-xl transition-all font-bold text-xs flex items-center gap-1.5 shadow-sm"
                          title="Fai tornare la merce (Registra Reso)"
                        >
                          <RotateCcw size={15} />
                          <span>Reso Merce</span>
                        </button>
                      )}
                      {o.status !== 'SHIPPED' && canTouchCustomer(o.customer_id) && (
                        <>
                          {canCreateOutbound && (<button 
                            onClick={() => editOrder(o.id)}
                            className="bg-brand-blue/15 hover:bg-brand-blue text-brand-blue hover:text-brand-black p-2 rounded-xl transition-colors"
                            title="Modifica Spedizione"
                          >
                            <Edit3 size={17} />
                          </button>)}
                          {canDeleteOutbound && (<button 
                            onClick={() => setDeleteConfirm({show: true, id: o.id, code: o.order_code, expected: Math.floor(1000 + Math.random() * 9000).toString(), input: ''})}
                            className="bg-rose-500/15 hover:bg-rose-500 text-rose-400 hover:text-white p-2 rounded-xl transition-colors"
                            title="Elimina Spedizione"
                          >
                            <Trash2 size={17} />
                          </button>)}
                        </>
                      )}
                      {o.status !== 'SHIPPED' && canPickOutbound && canTouchCustomer(o.customer_id) && (
                        <button 
                          onClick={() => confirmOrder(o.order_code)}
                          className={`px-3 py-2 rounded-xl transition-all font-bold text-xs flex items-center gap-1.5 ${
                            o.status === 'READY'
                              ? 'bg-emerald-500 hover:bg-emerald-400 text-emerald-950 shadow-[0_0_15px_rgba(16,185,129,0.3)]'
                              : 'bg-emerald-500/20 hover:bg-emerald-500 text-emerald-400 hover:text-emerald-950 border border-emerald-500/30'
                          }`}
                          title="Conferma spedizione ed evasione definitiva magazzino"
                        >
                          <CheckCircle size={16} />
                          <span className="hidden xl:inline">{o.status === 'RETURNED' ? 'Rispedisci' : o.status === 'READY' ? 'Conferma Uscita' : 'Evadi'}</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Timeline Modal */}
      {timelineModal && (
        <TimelineModal 
          order={timelineModal} 
          onClose={() => setTimelineModal(null)} 
          token={token}
          onOpenReturn={openReturnModal}
          onEditPalletMeta={(it, reload) => openPalletMetaEditor(it, reload)}
        />
      )}

      {/* Modale Crea / Modifica Spedizione (Workspace Split-Screen) */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-6 max-w-7xl w-full shadow-2xl flex flex-col max-h-[94vh] overflow-y-auto lg:overflow-hidden">
            
            {/* Header Modale */}
            <div className="flex justify-between items-center pb-4 mb-4 border-b border-slate-800">
              <div>
                <h3 className="text-2xl font-black text-brand-white flex items-center gap-2.5">
                  <Truck className="text-brand-blue" size={26} />
                  {newOrder.id ? 'Modifica Spedizione' : 'Nuova Spedizione (Picking Guidato)'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Seleziona i lotti dal catalogo a sinistra o usa <strong>Tutto il Lotto</strong> per aggiungerli con 1 click, e modifica le quantità inline a destra.
                </p>
              </div>
              <button onClick={() => setShowModal(false)} className="p-2 text-slate-500 hover:text-brand-white rounded-xl hover:bg-slate-800">
                <X size={24} />
              </button>
            </div>
            
            {/* Riga Parametri Testata Ordine */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 mb-4">
              <div className="lg:col-span-3">
                <label className="block text-slate-400 font-bold mb-1 text-[10px] uppercase tracking-wider">Cliente Proprietario *</label>
                <Select 
                  styles={selectStyles}
                  options={customers}
                  placeholder="Seleziona cliente..."
                  value={customers.find(c => c.value === newOrder.customer_id) || null}
                  onChange={handleCustomerChange}
                />
              </div>
              <div className="lg:col-span-2">
                <label className="block text-slate-400 font-bold mb-1 text-[10px] uppercase tracking-wider">DDT Cliente (Rif.)</label>
                <input 
                  type="text" 
                  value={newOrder.client_ddt || ''} 
                  onChange={e => setNewOrder({...newOrder, client_ddt: e.target.value})} 
                  className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-3 py-2 text-sm focus:ring-brand-blue" 
                  placeholder="Es. DDT-3025"
                />
              </div>
              <div className="lg:col-span-2">
                <label className="block text-slate-400 font-bold mb-1 text-[10px] uppercase tracking-wider">Data di Uscita *</label>
                <input 
                  type="date" 
                  value={newOrder.exit_date} 
                  onChange={e => setNewOrder({...newOrder, exit_date: e.target.value})} 
                  className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-3 py-2 text-sm [color-scheme:dark] focus:ring-brand-blue" 
                />
              </div>
              <div className="lg:col-span-3">
                <label className="block text-amber-400 font-bold mb-1 text-[10px] uppercase tracking-wider">
                  Nota Libera sul DDT (per Magazziniere)
                </label>
                <input 
                  type="text" 
                  value={newOrder.notes || ''} 
                  onChange={e => setNewOrder({...newOrder, notes: e.target.value})} 
                  className="w-full bg-slate-950 border border-amber-500/40 text-amber-100 rounded-xl px-3 py-2 text-sm focus:border-amber-400 outline-none placeholder-slate-600" 
                  placeholder="Es. Ritira il cliente, spedire con DDT 3025, ecc..."
                />
              </div>
              <div className="lg:col-span-2 flex items-end">
                <label className="flex items-center gap-2 cursor-pointer px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl w-full h-[40px] hover:border-brand-blue transition-colors select-none">
                  <input 
                    type="checkbox" 
                    checked={includePending} 
                    onChange={e => toggleIncludePending(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-700 text-brand-blue focus:ring-brand-blue bg-slate-900"
                  />
                  <span className="text-xs font-bold text-slate-300 truncate">Includi "In Attesa"</span>
                </label>
              </div>
            </div>

            {/* Riga Compatta Destinazione & Bolla di Uscita */}
            <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-3 mb-4 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="flex-1 min-w-[230px]">
                  <label className="block text-sky-400 font-bold mb-1 text-[10px] uppercase tracking-wider flex items-center gap-1">
                    <MapPin size={11} /> Indirizzo di Consegna (Destinazione Bolla)
                  </label>
                  <div className="flex gap-2">
                    {orderDeliveryAddresses.length > 0 && (
                      <select
                        value={newOrder.delivery_address_id || ''}
                        onChange={e => {
                          const selectedId = e.target.value;
                          if (!selectedId) {
                            setNewOrder(prev => ({ ...prev, delivery_address_id: '' }));
                            return;
                          }
                          const found = orderDeliveryAddresses.find(a => String(a.id) === String(selectedId));
                          if (found) {
                            setNewOrder(prev => ({
                              ...prev,
                              delivery_address_id: String(found.id),
                              delivery_label: found.label,
                              delivery_address_text: formatDeliveryAddrOption(found)
                            }));
                          }
                        }}
                        className="bg-slate-900 border border-slate-700 text-white rounded-xl px-2.5 py-1.5 text-xs font-bold max-w-[220px] focus:border-brand-blue outline-none"
                      >
                        <option value="">Indirizzo personalizzato / sede</option>
                        {orderDeliveryAddresses.map(a => (
                          <option key={a.id} value={a.id}>
                            {a.label}{a.is_default ? ' ★' : ''}{a.is_inherited ? ' (Madre)' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                    <input
                      type="text"
                      value={newOrder.delivery_address_text || ''}
                      onChange={e => setNewOrder(prev => ({ ...prev, delivery_address_id: '', delivery_address_text: e.target.value }))}
                      placeholder="Indirizzo completo di consegna (es. Via Roma 10, Milano)"
                      className="flex-1 bg-slate-900 border border-slate-800 text-white rounded-xl px-3 py-1.5 text-xs focus:border-brand-blue outline-none"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 pt-3.5">
                  <button
                    type="button"
                    onClick={() => setNewOrder(prev => ({ ...prev, is_container: !prev.is_container }))}
                    className={`px-2.5 py-1.5 rounded-xl text-[11px] font-black border transition-all flex items-center gap-1 ${
                      newOrder.is_container
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                        : 'bg-slate-900 text-slate-300 border-slate-700 hover:text-white'
                    }`}
                    title="Se Container: fattura Carico Container una tantum anziché Out Paletta"
                  >
                    <Container size={12} /> {newOrder.is_container ? 'Carico Container' : 'Camion Standard'}
                  </button>

                  <select
                    value={newOrder.origin_warehouse_id || ''}
                    onChange={e => setNewOrder(prev => ({ ...prev, origin_warehouse_id: e.target.value }))}
                    className="bg-slate-900 border border-slate-700 text-emerald-300 rounded-xl px-2.5 py-1.5 text-[11px] font-bold focus:border-brand-blue outline-none"
                    title="Località inizio trasporto (Sede magazzino di partenza)"
                  >
                    {warehouses.map(w => (
                      <option key={w.id} value={w.id}>Partenza: {w.name}</option>
                    ))}
                  </select>

                  {(() => {
                    const selCust = customerRecords.find(c => Number(c.id) === Number(newOrder.customer_id));
                    const custDdtOn = selCust ? Number(selCust.generate_exit_ddt ?? 1) !== 0 : true;
                    if (!custDdtOn) {
                      return (
                        <span className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-slate-900 text-slate-400 border border-slate-800">
                          Bolla di Uscita disattivata per questo cliente
                        </span>
                      );
                    }
                    return (
                      <>
                        <button
                          type="button"
                          onClick={() => setNewOrder(prev => ({ ...prev, generate_exit_ddt: !prev.generate_exit_ddt }))}
                          className={`px-2.5 py-1.5 rounded-xl text-[11px] font-black border transition-all flex items-center gap-1 ${
                            newOrder.generate_exit_ddt
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                              : 'bg-slate-900 text-slate-400 border-slate-800'
                          }`}
                        >
                          <FileText size={12} /> Bolla: {newOrder.generate_exit_ddt ? 'SÌ' : 'NO'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setNewOrder(prev => ({ ...prev, require_load_recheck: !prev.require_load_recheck }))}
                          className={`px-2.5 py-1.5 rounded-xl text-[11px] font-black border transition-all flex items-center gap-1 ${
                            newOrder.require_load_recheck
                              ? 'bg-violet-500/20 text-violet-300 border-violet-500/50'
                              : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                          }`}
                          title="Richiedi nuova scansione barcode Zebra durante il carico mezzo"
                        >
                          <ShieldCheck size={12} /> Ri-verifica carico: {newOrder.require_load_recheck ? 'SÌ' : 'NO'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowAdvancedBollaCreate(v => !v)}
                          className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 flex items-center gap-1"
                        >
                          <SlidersHorizontal size={12} /> {showAdvancedBollaCreate ? 'Chiudi Vettore' : 'Vettore / Note'}
                        </button>
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Avviso automatico Temperatura mista 2-8°C + 15-25°C o ADR dal carrello */}
              {(() => {
                const temps = new Set();
                let hasAdrCart = false;
                cart.forEach(c => {
                  const matched = availablePallets.find(p =>
                    (c.pallet_id && Number(p.id) === Number(c.pallet_id)) ||
                    (String(p.product_id) === String(c.product_id) && (!c.batch || c.batch === 'TUTTI' || String(p.batch || 'Nessun lotto') === c.batch))
                  );
                  const t = normalizeTempRegime(matched?.temp_regime || c.temp_regime);
                  if (t !== 'NONE') temps.add(t);
                  if (matched?.is_adr || c.is_adr) hasAdrCart = true;
                });
                const mixedCold = temps.has('2_8') && temps.has('15_25');
                if (!mixedCold && temps.size === 0 && !hasAdrCart) return null;
                return (
                  <div className="space-y-1.5 pt-1">
                    {mixedCold && (
                      <div className="bg-orange-950/60 border border-orange-500/60 text-orange-200 rounded-xl px-3 py-2 text-xs font-black flex items-center gap-2">
                        <AlertTriangle size={15} className="text-orange-400 shrink-0" />
                        ATTENZIONE: Stai caricando insieme bancali 2/8°C e 15/25°C nella stessa bolla! Verifica l&apos;idoneità del trasporto.
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="text-slate-400 font-bold">Diciture automatiche Bolla da palette:</span>
                      {Array.from(temps).map(tr => (
                        <span key={tr} className="px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/35 font-bold">
                          {TEMP_REGIME_MAP[tr]?.shortLabel}
                        </span>
                      ))}
                      {hasAdrCart && (
                        <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 font-black">
                          ADR (automatico su Bolla)
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}

              {showAdvancedBollaCreate && (customerRecords.find(c => Number(c.id) === Number(newOrder.customer_id))?.generate_exit_ddt ?? 1) !== 0 && (
                <div className="pt-2.5 border-t border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
                  <input
                    type="text"
                    value={newOrder.bolla_options?.carrier_name || ''}
                    onChange={e => setNewOrder(prev => ({ ...prev, bolla_options: { ...prev.bolla_options, carrier_name: e.target.value } }))}
                    placeholder="Vettore / Trasportatore (opz.)"
                    className="bg-slate-900 border border-slate-800 text-white rounded-xl px-3 py-1.5 outline-none"
                  />
                  <input
                    type="text"
                    value={newOrder.bolla_options?.vehicle_plate || ''}
                    onChange={e => setNewOrder(prev => ({ ...prev, bolla_options: { ...prev.bolla_options, vehicle_plate: e.target.value.toUpperCase() } }))}
                    placeholder="Targa Mezzo (opz.)"
                    className="bg-slate-900 border border-slate-800 text-white rounded-xl px-3 py-1.5 outline-none font-mono uppercase"
                  />
                  <div className="md:col-span-2 flex flex-wrap gap-4 pt-1 text-[11px] text-slate-300">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={Boolean(newOrder.bolla_options?.legal_intact_goods)} onChange={e => setNewOrder(prev => ({ ...prev, bolla_options: { ...prev.bolla_options, legal_intact_goods: e.target.checked } }))} />
                      Integrità colli e imballaggio
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={Boolean(newOrder.bolla_options?.legal_driver_check)} onChange={e => setNewOrder(prev => ({ ...prev, bolla_options: { ...prev.bolla_options, legal_driver_check: e.target.checked } }))} />
                      Dichiarazione controllo conducente
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={Boolean(newOrder.bolla_options?.legal_transport_norm)} onChange={e => setNewOrder(prev => ({ ...prev, bolla_options: { ...prev.bolla_options, legal_transport_norm: e.target.checked } }))} />
                      Clausola D.P.R. 472/96 &amp; D.Lgs. 286/2005 (C/FINE DEPOSITO)
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* Area Centrale Split-Screen: Catalogo Giacenze (7/12) + Carrello Prelievo Inline (5/12) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-0 overflow-visible lg:overflow-hidden">
              
              {/* SINISTRA: Catalogo Lotti & Articoli del Cliente */}
              <div className="lg:col-span-7 bg-slate-950 p-4 rounded-2xl border border-slate-800 flex flex-col min-h-0">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <h4 className="text-brand-white font-bold text-sm flex items-center gap-2">
                    <PackageSearch size={18} className="text-brand-blue" />
                    Giacenze Disponibili ({filteredLotRows.length} lotti)
                  </h4>

                  <div className="flex items-center gap-1.5 text-xs">
                    <ArrowUpDown size={13} className="text-brand-blue" />
                    <select
                      value={lotSortBy}
                      onChange={e => setLotSortBy(e.target.value)}
                      className="bg-slate-900 border border-slate-800 text-slate-200 rounded-lg px-2 py-1 text-xs font-bold"
                    >
                      <option value="FEFO">Ordina: Scadenza (FEFO ↑)</option>
                      <option value="CLIENT_PAL_ASC">Ordina: Rif. Paletta Cliente (↑)</option>
                      <option value="CLIENT_PAL_DESC">Ordina: Rif. Paletta Cliente (↓)</option>
                      <option value="ALPHA">Ordina: Nome Articolo (A-Z)</option>
                      <option value="QTY_DESC">Ordina: Quantità (↓)</option>
                    </select>
                  </div>
                </div>

                <div className="mb-3 relative">
                  <input 
                    type="text" 
                    disabled={!newOrder.customer_id}
                    placeholder={newOrder.customer_id ? "Cerca per lotto, Rif. Paletta Cliente, nome articolo, SKU, posizione o codice paletta..." : "Seleziona prima un cliente..."}
                    className="w-full bg-slate-900 border border-slate-800 text-brand-white text-xs rounded-xl focus:ring-brand-blue focus:border-brand-blue block py-2.5 pl-9 pr-8 transition-colors placeholder-slate-500 disabled:opacity-50"
                    value={palletSearchTerm}
                    onChange={e => setPalletSearchTerm(e.target.value)}
                  />
                  <Search size={15} className="absolute left-3 top-3 text-slate-500" />
                  {palletSearchTerm && (
                    <button onClick={() => setPalletSearchTerm('')} className="absolute right-2.5 top-2.5 text-slate-500 hover:text-white">
                      <X size={14} />
                    </button>
                  )}
                </div>

                <div className="overflow-y-auto flex-1 border border-slate-800 rounded-xl bg-slate-900/40">
                  {!newOrder.customer_id ? (
                    <div className="h-full flex flex-col items-center justify-center p-8 text-slate-500 text-center">
                      <User size={36} className="text-slate-700 mb-2" />
                      <p className="font-bold text-slate-400 text-sm">Seleziona un Cliente Proprietario</p>
                      <p className="text-xs mt-1">Il catalogo mostrerà in automatico tutti i lotti e le palette disponibili.</p>
                    </div>
                  ) : availablePallets.length === 0 ? (
                    <p className="px-3 py-8 text-slate-500 text-center text-sm">Nessuna merce disponibile per questo cliente.</p>
                  ) : filteredLotRows.length === 0 ? (
                    <p className="px-3 py-8 text-slate-500 text-center text-sm">Nessun lotto o articolo trovato per "{palletSearchTerm}".</p>
                  ) : (
                    <table className="w-full text-left">
                      <thead className="bg-slate-900 sticky top-0 shadow-md z-10">
                        <tr>
                          <th className="p-2.5 text-[11px] text-slate-400 uppercase font-bold">Articolo & Ubicazione</th>
                          <th className="p-2.5 text-[11px] text-slate-400 uppercase font-bold">Lotto & Scad.</th>
                          <th className="p-2.5 text-[11px] text-slate-400 uppercase font-bold text-center">Disponibilità</th>
                          <th className="p-2.5 text-[11px] text-slate-400 uppercase font-bold text-right">Azione Rapida</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredLotRows.map(row => {
                          const isFullLotInCart = cart.some(c =>
                            c.product_id === row.product_id &&
                            !c.pallet_id &&
                            !c.client_pallet_number &&
                            ((c.batch || 'Nessun lotto') === row.batch || c.batch === 'TUTTI')
                          );
                          const palletsWithClientRef = (row.pallets || []).filter(p => p.client_pallet_number);
                          const expBadge = getLotExpBadge(row.expiration_date);
                          return (
                            <tr key={row.key} className="border-t border-slate-800/60 hover:bg-slate-800/40 transition-colors">
                              <td className="p-2.5">
                                <div className="text-xs font-bold text-brand-white">{row.name}</div>
                                <div className="text-[10px] text-slate-400 font-mono mt-0.5 flex flex-wrap gap-1.5">
                                  {row.sku && <span className="text-brand-blue font-bold">SKU: {row.sku}</span>}
                                  {row.locations.length > 0 && (
                                    <span className="bg-slate-950 px-1.5 py-0.2 rounded border border-slate-800 text-emerald-400">
                                      Pos: {row.locations.join(', ')}
                                    </span>
                                  )}
                                </div>
                                {palletsWithClientRef.length > 0 && (
                                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-sky-400 mr-0.5">
                                      Rif. Pal. Cl.:
                                    </span>
                                    {palletsWithClientRef.map(pal => {
                                      const isThisPalletInCart = cart.some(c =>
                                        (c.pallet_id && String(c.pallet_id) === String(pal.id)) ||
                                        (!c.pallet_id && c.product_id === row.product_id && c.client_pallet_number === pal.client_pallet_number)
                                      );
                                      return (
                                        <button
                                          key={pal.id}
                                          type="button"
                                          onClick={() => {
                                            if (isThisPalletInCart) return;
                                            setPickingPallet({
                                              ...row,
                                              selectedBatch: pal.batch,
                                              selectedPalletId: pal.id
                                            });
                                            setPickQty(pal.available_quantity);
                                            setPickUom(row.base_uom || 'Pezzi');
                                            setShowPickModal(true);
                                          }}
                                          className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold border transition-all flex items-center gap-1 ${
                                            isThisPalletInCart
                                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 cursor-default'
                                              : 'bg-sky-500/15 hover:bg-sky-500 text-sky-300 hover:text-slate-950 border-sky-500/40'
                                          }`}
                                          title={
                                            isThisPalletInCart
                                              ? `Bancale Rif. ${pal.client_pallet_number} già in lista prelievo`
                                              : `Clicca per selezionare esattamente il bancale Rif. Cliente "${pal.client_pallet_number}" (${pal.available_quantity} ${row.base_uom}${pal.location ? ' • Pos: ' + pal.location : ''})`
                                          }
                                        >
                                          {isThisPalletInCart ? '✓ ' : '+ '}Rif: {pal.client_pallet_number}
                                          <span className="opacity-75 text-[9px]">({pal.available_quantity})</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </td>
                              <td className="p-2.5">
                                <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-mono font-bold border ${row.batch === 'Nessun lotto' ? 'bg-slate-800 text-slate-400 border-slate-700' : 'bg-amber-500/15 text-amber-300 border-amber-500/30'}`}>
                                  {row.batch}
                                </span>
                                {expBadge && (
                                  <div className={`mt-1 inline-block px-1.5 py-0.5 rounded text-[9px] font-bold border ${expBadge.cls}`}>
                                    {expBadge.label}
                                  </div>
                                )}
                              </td>
                              <td className="p-2.5 text-center">
                                <div className="flex flex-col items-center">
                                  <span className="font-black text-emerald-400 text-xs">
                                    {row.total_quantity} <span className="text-[10px] uppercase text-slate-400">{row.base_uom}</span>
                                  </span>
                                  <span className="text-[10px] text-slate-400">
                                    {row.units_per_box > 1 && (
                                      <>
                                        {Math.floor(row.total_quantity / row.units_per_box)} Scat.
                                        {(row.total_quantity % row.units_per_box) > 0 && ` +${row.total_quantity % row.units_per_box}`}
                                        {' • '}
                                      </>
                                    )}
                                    {row.pallet_count} Pal.
                                  </span>
                                </div>
                              </td>
                              <td className="p-2.5 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  {!isFullLotInCart && (
                                    <button
                                      type="button"
                                      onClick={() => handleQuickAddFullLot(row)}
                                      className="bg-emerald-500/15 hover:bg-emerald-500 text-emerald-400 hover:text-emerald-950 border border-emerald-500/30 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors"
                                      title="Aggiungi subito l'intero lotto disponibile"
                                    >
                                      Tutto
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPickingPallet({
                                        ...row,
                                        selectedBatch: row.batch,
                                        selectedPalletId: ''
                                      });
                                      setPickQty(1);
                                      setPickUom(row.base_uom || 'Pezzi');
                                      setShowPickModal(true);
                                    }}
                                    className="bg-brand-blue/20 text-brand-blue border border-brand-blue/40 px-2.5 py-1.5 rounded-lg text-[11px] font-bold hover:bg-brand-blue hover:text-brand-black transition-colors"
                                    title="Scegli quantità o bancale specifico (Rif. Paletta Cliente)"
                                  >
                                    + Q.tà / Rif.
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* DESTRA: Lista Prelievo Spedizione con Modifica Inline (5/12) */}
              <div className="lg:col-span-5 bg-slate-950 p-4 rounded-2xl border border-slate-800 flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <Layers size={18} className="text-brand-blue" />
                    <h4 className="text-brand-white font-bold text-sm">Lista Prelievo Spedizione</h4>
                    <span className="bg-brand-blue text-brand-black font-black px-2 py-0.5 rounded-full text-xs">
                      {cart.length}
                    </span>
                  </div>
                  {cart.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setCart([])}
                      className="text-[11px] font-bold text-rose-400 hover:text-rose-300 px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/20"
                    >
                      Svuota lista
                    </button>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {cart.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center p-6 text-center border-2 border-dashed border-slate-800/80 rounded-xl text-slate-500">
                      <Truck size={34} className="text-slate-700 mb-2" />
                      <p className="font-bold text-slate-400 text-xs">Nessun articolo in lista prelievo</p>
                      <p className="text-[11px] mt-1">Clicca su <strong>Tutto</strong> o <strong>+ Q.tà</strong> accanto ai lotti a sinistra.</p>
                    </div>
                  ) : (
                    cart.map((c, i) => {
                      const matchingPalletsForCart = availablePallets.filter(p => {
                        if (String(p.product_id) !== String(c.product_id)) return false;
                        if (c.batch && c.batch !== 'TUTTI') {
                          const pBatch = (p.batch && String(p.batch).trim() !== '') ? String(p.batch).trim() : 'Nessun lotto';
                          if (pBatch !== c.batch) return false;
                        }
                        return true;
                      }).sort((a, b) => {
                        const refA = (a.client_pallet_number || '').trim();
                        const refB = (b.client_pallet_number || '').trim();
                        if (refA && !refB) return -1;
                        if (!refA && refB) return 1;
                        if (refA && refB) return refA.localeCompare(refB, undefined, { numeric: true, sensitivity: 'base' });
                        return 0;
                      });
                      const hasAnyClientRef = matchingPalletsForCart.some(p => p.client_pallet_number && String(p.client_pallet_number).trim() !== '') || Boolean(c.client_pallet_number);

                      return (
                      <div key={i} className="bg-slate-900 border border-slate-800 hover:border-slate-700 p-3 rounded-xl flex flex-col gap-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-brand-white font-bold text-xs truncate" title={c.product_name}>
                              #{i + 1} • {c.product_name}
                            </p>
                            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                              <span className="text-[11px] text-amber-300 font-mono">
                                Lotto: <strong>{c.batch && c.batch !== 'TUTTI' ? c.batch : 'Qualsiasi (FEFO)'}</strong>
                              </span>
                              {c.client_pallet_number && (
                                <span className="text-[10px] font-mono font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40 px-1.5 py-0.2 rounded">
                                  Rif. Pal. Cl: {c.client_pallet_number}
                                </span>
                              )}
                              {c.pallet_code && (
                                <span className="text-[10px] font-mono text-slate-400">
                                  ({c.pallet_code})
                                </span>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeFromCart(i)}
                            className="text-slate-500 hover:text-rose-400 p-1 hover:bg-rose-500/10 rounded-lg transition-colors shrink-0"
                            title="Rimuovi dalla spedizione"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>

                        {/* Selettore Inline Riferimento Paletta Cliente (se disponibile) */}
                        {(hasAnyClientRef || matchingPalletsForCart.length > 1) && (
                          <div className="pt-1 border-t border-slate-800/70">
                            <label className="block text-[9px] font-bold uppercase text-sky-400 mb-0.5">
                              Riferimento Paletta Cliente / Bancale Esatto (Opz.)
                            </label>
                            <select
                              value={c.pallet_id ? String(c.pallet_id) : ''}
                              onChange={e => {
                                const val = e.target.value;
                                if (!val) {
                                  updateCartItem(i, { pallet_id: null, pallet_code: null, client_pallet_number: null });
                                } else {
                                  const chosen = matchingPalletsForCart.find(p => String(p.id) === String(val));
                                  if (chosen) {
                                    const avail = parseFloat((chosen.available_quantity ?? chosen.quantity) || 0);
                                    const chosenBatch = (chosen.batch && String(chosen.batch).trim() !== '') ? String(chosen.batch).trim() : 'Nessun lotto';
                                    updateCartItem(i, {
                                      pallet_id: chosen.id,
                                      pallet_code: chosen.pallet_code,
                                      client_pallet_number: chosen.client_pallet_number ? String(chosen.client_pallet_number).trim() : null,
                                      batch: chosenBatch,
                                      quantity_required: c.requested_uom === 'Bancali' ? 1 : Math.min(parseFloat(c.quantity_required) || avail, avail)
                                    });
                                  }
                                }
                              }}
                              className="w-full bg-slate-950 border border-slate-700 focus:border-sky-400 text-sky-300 font-mono font-bold text-[11px] rounded-lg px-2 py-1.5"
                            >
                              <option value="">⚡ Automatico (FEFO / Scade prima)</option>
                              {matchingPalletsForCart.map(p => {
                                const avail = parseFloat((p.available_quantity ?? p.quantity) || 0);
                                const refStr = p.client_pallet_number ? `Rif. Cliente: ${p.client_pallet_number}` : `Senza Rif. Cl.`;
                                return (
                                  <option key={p.id} value={String(p.id)}>
                                    {refStr} • Pal: {p.pallet_code} ({avail} {p.uom || 'Pz'}{p.location ? ` • Pos: ${p.location}` : ''})
                                  </option>
                                );
                              })}
                            </select>
                          </div>
                        )}

                        {/* Modifica Inline Quantità e Unità di Misura */}
                        <div className="grid grid-cols-12 gap-2 items-center pt-1 border-t border-slate-800/70">
                          <div className="col-span-6">
                            <label className="block text-[9px] font-bold uppercase text-slate-500 mb-0.5">Quantità Richiesta</label>
                            <input
                              type="number"
                              min="0.01"
                              step="any"
                              onWheel={e => e.target.blur()}
                              value={c.quantity_required}
                              onChange={e => updateCartItem(i, { quantity_required: e.target.value === '' ? '' : parseFloat(e.target.value) || 0 })}
                              className="w-full bg-slate-950 border border-slate-700 focus:border-brand-blue text-emerald-400 font-black text-xs rounded-lg px-2.5 py-1.5"
                            />
                          </div>
                          <div className="col-span-6">
                            <label className="block text-[9px] font-bold uppercase text-slate-500 mb-0.5">Unità Prelievo</label>
                            <select
                              value={c.requested_uom || 'Pezzi'}
                              onChange={e => updateCartItem(i, { requested_uom: e.target.value })}
                              className="w-full bg-slate-950 border border-slate-700 focus:border-brand-blue text-brand-white font-bold text-xs rounded-lg px-2 py-1.5"
                            >
                              <option value="Pezzi">Pezzi</option>
                              <option value="Scatole">Scatole</option>
                              {(c.kg_per_unit > 0 || matchingPalletsForCart[0]?.kg_per_unit > 0) && (
                                <option value="Kg">Kg (peso)</option>
                              )}
                              <option value="Bancali">Bancali / Palette</option>
                              <option value="KG">KG (UDM base)</option>
                              <option value="Metro Cubo">Metro Cubo</option>
                            </select>
                          </div>
                        </div>
                        {(c.requested_kg || c.kg_per_unit > 0 || matchingPalletsForCart[0]?.kg_per_unit > 0) && (() => {
                          const effKgUnit = parseFloat(c.kg_per_unit || matchingPalletsForCart[0]?.kg_per_unit || 0);
                          const qNum = parseFloat(c.quantity_required) || 0;
                          if (!effKgUnit || !qNum) return null;
                          if (c.requested_uom === 'Kg') {
                            const convPcs = Number((qNum / effKgUnit).toFixed(4));
                            return (
                              <div className="text-[10px] text-emerald-300 font-mono bg-emerald-500/10 border border-emerald-500/25 rounded-lg px-2 py-1">
                                Conversione automatica: <strong>{qNum} kg</strong> ÷ {effKgUnit} kg/pz = <strong>{convPcs} Pezzi</strong>
                              </div>
                            );
                          }
                          const estKg = c.requested_kg || Number((qNum * effKgUnit).toFixed(2));
                          return (
                            <div className="text-[10px] text-slate-400 font-mono">
                              Peso equivalente: <strong className="text-emerald-300">{estKg} kg</strong> ({effKgUnit} kg/pz)
                            </div>
                          );
                        })()}
                      </div>
                    );
                    })
                  )}
                </div>

                <button
                  onClick={handleCreateOrder}
                  disabled={isProcessing || cart.length === 0 || !newOrder.customer_id}
                  className="w-full mt-3 bg-brand-blue hover:bg-sky-400 text-brand-black font-black py-3.5 rounded-xl transition-all disabled:opacity-40 shadow-[0_0_20px_rgba(14,165,233,0.25)] text-sm"
                >
                  {isProcessing ? 'Salvataggio in corso...' : (newOrder.id ? `Salva Modifiche (${cart.length} righe)` : `Conferma e Crea Spedizione (${cart.length} righe)`)}
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* Pick Modal (Scelta Quantità Personalizzata con Preset Rapidi) */}
      {showPickModal && pickingPallet && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold text-brand-white mb-1">Aggiungi al Prelievo</h3>
            <p className="text-brand-blue font-bold mb-4 text-base">{pickingPallet.name}</p>

            <div className="mb-4">
              <label className="block text-slate-400 text-xs font-bold mb-1.5">Lotto da Spedire</label>
              <select 
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-brand-white font-mono text-sm focus:border-brand-blue"
                value={pickingPallet.selectedBatch || pickingPallet.batch}
                onChange={e => setPickingPallet({...pickingPallet, selectedBatch: e.target.value, selectedPalletId: ''})}
              >
                {(pickingPallet.productBatches || []).map(b => (
                  <option key={b.batch} value={b.batch}>
                    Lotto: {b.batch} ({b.total_quantity} {pickingPallet.base_uom || 'Pezzi'} • {b.pallet_count} Banc.)
                  </option>
                ))}
                {(pickingPallet.productBatches || []).length > 1 && (
                  <option value="TUTTI">Qualsiasi lotto (FEFO / Scadenza più vicina)</option>
                )}
              </select>
            </div>

            {/* Selettore Numero Riferimento Paletta Cliente / Bancale Specifico */}
            {selectedBatchStats.candidatePallets && selectedBatchStats.candidatePallets.length > 0 && (
              <div className="mb-4 bg-slate-950/80 border border-slate-800 rounded-2xl p-3">
                <label className="block text-sky-400 text-xs font-bold mb-1.5">
                  Riferimento Paletta Cliente / Bancale Specifico (Opzionale)
                </label>
                {selectedBatchStats.candidatePallets.some(p => p.client_pallet_number) && (
                  <div className="flex flex-wrap gap-1.5 mb-2 max-h-24 overflow-y-auto pr-1">
                    <button
                      type="button"
                      onClick={() => setPickingPallet(prev => ({ ...prev, selectedPalletId: '' }))}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                        !pickingPallet.selectedPalletId
                          ? 'bg-brand-blue text-brand-black border-brand-blue'
                          : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
                      }`}
                    >
                      Auto (FEFO)
                    </button>
                    {selectedBatchStats.candidatePallets.filter(p => p.client_pallet_number).map(p => {
                      const isSel = String(pickingPallet.selectedPalletId) === String(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setPickingPallet(prev => ({
                              ...prev,
                              selectedPalletId: p.id,
                              selectedBatch: p.batch
                            }));
                            setPickQty(pickUom === 'Bancali' ? 1 : (pickUom === 'Kg' && pickingPallet.kg_per_unit > 0 ? Number((p.available_quantity * pickingPallet.kg_per_unit).toFixed(2)) : (pickUom === 'Scatole' ? Math.max(1, Math.floor(p.available_quantity / (parseFloat(pickingPallet.units_per_box) || 1))) : p.available_quantity)));
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold border transition-all ${
                            isSel
                              ? 'bg-sky-400 text-slate-950 border-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.3)]'
                              : 'bg-sky-500/10 text-sky-300 border-sky-500/30 hover:bg-sky-500/20'
                          }`}
                        >
                          Rif: {p.client_pallet_number} ({p.available_quantity} {pickingPallet.base_uom || 'Pz'})
                        </button>
                      );
                    })}
                  </div>
                )}
                <select
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-brand-white font-mono text-xs focus:border-sky-400"
                  value={pickingPallet.selectedPalletId ? String(pickingPallet.selectedPalletId) : ''}
                  onChange={e => {
                    const pid = e.target.value;
                    if (!pid) {
                      setPickingPallet(prev => ({ ...prev, selectedPalletId: '' }));
                    } else {
                      const chosen = selectedBatchStats.candidatePallets.find(p => String(p.id) === String(pid));
                      setPickingPallet(prev => ({
                        ...prev,
                        selectedPalletId: pid,
                        selectedBatch: chosen ? chosen.batch : prev.selectedBatch
                      }));
                      if (chosen) {
                        setPickQty(pickUom === 'Bancali' ? 1 : (pickUom === 'Kg' && pickingPallet.kg_per_unit > 0 ? Number((chosen.available_quantity * pickingPallet.kg_per_unit).toFixed(2)) : (pickUom === 'Scatole' ? Math.max(1, Math.floor(chosen.available_quantity / (parseFloat(pickingPallet.units_per_box) || 1))) : chosen.available_quantity)));
                      }
                    }
                  }}
                >
                  <option value="">⚡ Automatico (FEFO / Scade prima / Regole di Prelievo)</option>
                  {selectedBatchStats.candidatePallets.map(p => (
                    <option key={p.id} value={String(p.id)}>
                      {p.client_pallet_number ? `Rif. Paletta Cliente: ${p.client_pallet_number}` : `Senza Rif. Cliente`} • Cod: {p.pallet_code} • {p.available_quantity} {pickingPallet.base_uom || 'Pz'}{p.location ? ` • Pos: ${p.location}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="mb-4">
              <label className="block text-slate-400 text-xs font-bold mb-1.5">Unità di Misura Prelievo</label>
              <div className={`grid ${Number(pickingPallet.kg_per_unit) > 0 ? 'grid-cols-4' : 'grid-cols-3'} gap-2`}>
                {Array.from(new Set([
                  pickingPallet.base_uom || 'Pezzi',
                  'Scatole',
                  ...(Number(pickingPallet.kg_per_unit) > 0 ? ['Kg'] : []),
                  'Bancali'
                ])).map(u => (
                  <button 
                    key={u}
                    type="button"
                    onClick={() => {
                      setPickUom(u);
                      const kgUnit = parseFloat(pickingPallet.kg_per_unit) || 0;
                      const upbVal = parseFloat(pickingPallet.units_per_box) || 1;
                      if (u === 'Kg' && kgUnit > 0) {
                        setPickQty(Number((selectedBatchStats.qty * kgUnit).toFixed(2)));
                      } else if (u === 'Scatole') {
                        setPickQty(Math.max(1, Math.floor(selectedBatchStats.qty / upbVal)));
                      } else if (u === 'Bancali') {
                        setPickQty(1);
                      } else {
                        setPickQty(selectedBatchStats.qty);
                      }
                    }}
                    className={`py-2.5 px-2 text-xs font-bold rounded-xl border transition-colors ${pickUom === u ? 'bg-brand-blue text-brand-black border-brand-blue' : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-600'}`}
                  >
                    {u === 'Bancali' ? 'Bancali / Pal.' : (u === 'Kg' ? 'Kg (Peso)' : u)}
                  </button>
                ))}
              </div>
              {Number(pickingPallet.kg_per_unit) > 0 && (
                <div className="text-[11px] text-emerald-400 font-mono mt-1.5">
                  Conversione articolo: 1 {pickingPallet.base_uom || 'Pezzo'} = <strong>{pickingPallet.kg_per_unit} kg</strong>
                </div>
              )}
            </div>

            <div className="mb-5">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-slate-400 text-xs font-bold">
                  Quantità richiesta ({pickUom === 'Bancali' ? 'Bancali / Palette' : pickUom})
                </label>
                {/* Pulsanti Preset Rapidi */}
                <div className="flex items-center gap-1">
                  {pickUom === 'Scatole' && selectedBatchStats.boxes > 0 && (
                    <button
                      type="button"
                      onClick={() => setPickQty(selectedBatchStats.boxes)}
                      className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold hover:bg-emerald-500 hover:text-black"
                    >
                      Max ({selectedBatchStats.boxes} Scat.)
                    </button>
                  )}
                  {pickUom === 'Bancali' && selectedBatchStats.pallets > 0 && (
                    <button
                      type="button"
                      onClick={() => setPickQty(selectedBatchStats.pallets)}
                      className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold hover:bg-emerald-500 hover:text-black"
                    >
                      Max ({selectedBatchStats.pallets} Pal.)
                    </button>
                  )}
                  {pickUom === 'Kg' && pickingPallet.kg_per_unit > 0 && selectedBatchStats.qty > 0 && (() => {
                    const maxKg = Number((selectedBatchStats.qty * parseFloat(pickingPallet.kg_per_unit)).toFixed(3));
                    return (
                      <>
                        {maxKg >= 2 && (
                          <button
                            type="button"
                            onClick={() => setPickQty(Number((maxKg / 2).toFixed(2)))}
                            className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-bold hover:bg-slate-700"
                          >
                            50% ({Number((maxKg / 2).toFixed(2))} kg)
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setPickQty(maxKg)}
                          className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold hover:bg-emerald-500 hover:text-black"
                        >
                          Tutto ({maxKg} kg)
                        </button>
                      </>
                    );
                  })()}
                  {pickUom !== 'Scatole' && pickUom !== 'Bancali' && pickUom !== 'Kg' && selectedBatchStats.qty > 0 && (
                    <>
                      {selectedBatchStats.qty >= 2 && (
                        <button
                          type="button"
                          onClick={() => setPickQty(Math.floor(selectedBatchStats.qty / 2))}
                          className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-bold hover:bg-slate-700"
                        >
                          50% ({Math.floor(selectedBatchStats.qty / 2)})
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setPickQty(selectedBatchStats.qty)}
                        className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold hover:bg-emerald-500 hover:text-black"
                      >
                        Tutto ({selectedBatchStats.qty})
                      </button>
                    </>
                  )}
                </div>
              </div>
              <input 
                type="number" 
                min="0.001"
                step="any"
                autoFocus
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-brand-white focus:border-brand-blue text-lg font-bold"
                value={pickQty}
                onChange={e => setPickQty(e.target.value)}
              />
              {pickUom === 'Kg' && parseFloat(pickingPallet.kg_per_unit) > 0 && parseFloat(pickQty) > 0 && (() => {
                const kgU = parseFloat(pickingPallet.kg_per_unit);
                const convPcs = Number((parseFloat(pickQty) / kgU).toFixed(4));
                const isExactInt = Math.abs(convPcs - Math.round(convPcs)) < 0.0001;
                return (
                  <div className={`mt-2 p-2.5 rounded-xl border text-xs font-bold flex items-center justify-between ${
                    isExactInt
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                      : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                  }`}>
                    <span>Conversione automatica:</span>
                    <span className="font-mono text-sm">
                      {parseFloat(pickQty)} kg → {convPcs} {pickingPallet.base_uom || 'Pezzi'}
                    </span>
                  </div>
                );
              })()}
              <div className="text-xs text-slate-400 mt-2 bg-slate-950 p-3 rounded-xl border border-slate-800">
                <div>
                  Disponibilità per{' '}
                  {selectedBatchStats.chosenPallet ? (
                    <strong className="text-sky-400">
                      Bancale {selectedBatchStats.chosenPallet.client_pallet_number ? `Rif. Cliente ${selectedBatchStats.chosenPallet.client_pallet_number}` : selectedBatchStats.chosenPallet.pallet_code}
                    </strong>
                  ) : (
                    <strong className="text-amber-300">
                      {pickingPallet.selectedBatch === 'TUTTI' ? 'Tutti i lotti' : `Lotto ${pickingPallet.selectedBatch}`}
                    </strong>
                  )}:
                </div>
                <div className="mt-1 font-mono text-emerald-400 font-bold">
                  • {selectedBatchStats.qty} {pickingPallet.base_uom || 'Pezzi'}
                  {pickingPallet.units_per_box > 1 && ` • ${selectedBatchStats.boxes} Scatole`}
                  {pickingPallet.kg_per_unit > 0 && ` • ${Number((selectedBatchStats.qty * parseFloat(pickingPallet.kg_per_unit)).toFixed(2))} Kg (${pickingPallet.kg_per_unit} kg/pz)`}
                  {` • ${selectedBatchStats.pallets} Bancali/Palette`}
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowPickModal(false)} className="flex-1 py-3 text-slate-400 font-bold hover:text-brand-white transition-colors bg-slate-800 rounded-xl">Annulla</button>
              <button onClick={() => {
                 const reqVal = parseFloat(pickQty);
                 if (!pickQty || isNaN(reqVal) || reqVal <= 0) {
                   appAlert('Quantità non valida.');
                   return;
                 }

                 const upb = parseFloat(pickingPallet.units_per_box) || 1;
                 const kgPerUnit = parseFloat(pickingPallet.kg_per_unit) || 0;
                 let finalQtyReq = reqVal;
                 let finalReqUom = pickUom;
                 let finalReqKg = kgPerUnit > 0 ? Number((reqVal * (pickUom === 'Scatole' ? upb : 1) * kgPerUnit).toFixed(3)) : null;

                 if (pickUom === 'Bancali') {
                   if (reqVal > selectedBatchStats.pallets) {
                     appAlert(`Disponibilità insufficiente: massimo ${selectedBatchStats.pallets} bancali/palette disponibili.`);
                     return;
                   }
                 } else if (pickUom === 'Scatole') {
                   if ((reqVal * upb) > selectedBatchStats.qty) {
                     appAlert(`Disponibilità insufficiente: massimo ${selectedBatchStats.boxes} scatole disponibili.`);
                     return;
                   }
                 } else if (pickUom === 'Kg' && kgPerUnit > 0) {
                   const pcs = Number((reqVal / kgPerUnit).toFixed(4));
                   if (pcs > selectedBatchStats.qty + 0.0001) {
                     appAlert(`Disponibilità insufficiente: massimo ${Number((selectedBatchStats.qty * kgPerUnit).toFixed(2))} Kg (${selectedBatchStats.qty} ${pickingPallet.base_uom || 'Pezzi'}) disponibili.`);
                     return;
                   }
                   finalQtyReq = pcs;
                   finalReqUom = pickingPallet.base_uom || 'Pezzi';
                   finalReqKg = reqVal;
                 } else if (reqVal > selectedBatchStats.qty) {
                   appAlert(`Disponibilità insufficiente: massimo ${selectedBatchStats.qty} ${pickingPallet.base_uom || 'Pezzi'} disponibili.`);
                   return;
                 }

                 const chosen = selectedBatchStats.chosenPallet;
                 const targetBatch = chosen ? chosen.batch : (pickingPallet.selectedBatch || pickingPallet.batch || 'Nessun lotto');
                 const newCartItem = {
                    pallet_id: chosen ? chosen.id : null,
                    pallet_code: chosen ? chosen.pallet_code : null,
                    client_pallet_number: chosen && chosen.client_pallet_number ? chosen.client_pallet_number : null,
                    product_id: pickingPallet.product_id,
                    product_name: pickingPallet.name,
                    quantity_required: finalQtyReq,
                    requested_uom: finalReqUom,
                    requested_kg: finalReqKg,
                    kg_per_unit: kgPerUnit || null,
                    batch: targetBatch
                 };
                 setCart([...cart, newCartItem]);
                 setShowPickModal(false);
              }} className="flex-1 py-3 bg-brand-blue text-brand-black font-bold rounded-xl hover:bg-sky-400 transition-colors">Conferma</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm.show && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl">
            <div className="text-rose-500 mb-4 flex justify-center"><Trash2 size={40}/></div>
            <h3 className="text-xl font-bold text-brand-white mb-2 text-center">Conferma Eliminazione</h3>
            <p className="text-slate-400 text-sm text-center mb-6">Stai per eliminare la spedizione <strong className="text-brand-white">{deleteConfirm.code}</strong>. Inserisci il codice a 4 cifre per confermare.</p>
            
            <div className="text-center bg-slate-950 border border-slate-800 rounded-xl p-4 mb-4">
              <span className="text-3xl font-mono text-brand-white tracking-widest font-black">{deleteConfirm.expected}</span>
            </div>
            
            <input 
              type="text" 
              autoFocus
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-brand-white text-center text-xl font-mono tracking-widest mb-6 focus:border-rose-500"
              value={deleteConfirm.input}
              onChange={e => setDeleteConfirm({...deleteConfirm, input: e.target.value})}
              placeholder="----"
              maxLength={4}
            />

            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm({show: false, id: null, code: '', expected: '', input: ''})} className="flex-1 py-3 text-slate-400 font-bold hover:text-brand-white transition-colors bg-slate-800 rounded-xl">Annulla</button>
              <button onClick={confirmDeleteOrder} className="flex-1 py-3 bg-rose-500 text-white font-bold rounded-xl hover:bg-rose-400 transition-colors">Elimina</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Registrazione Reso Spedizione */}
      {returnModal.show && returnModal.order && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-950">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-amber-500/20 text-amber-400 rounded-2xl border border-amber-500/30">
                  <RotateCcw size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-brand-white">Registra Rientro Merce (Reso)</h3>
                  <p className="text-xs font-mono text-slate-400">{returnModal.order.order_code}</p>
                </div>
              </div>
              <button
                onClick={() => setReturnModal({ show: false, order: null, reason: 'Merce non accettata dal cliente', customReason: '', notes: '', loading: false, items: [] })}
                className="p-2 text-slate-400 hover:text-brand-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 text-sm flex-1">
              {/* Info Box */}
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Cliente:</span>
                  <strong className="text-brand-white">{returnModal.order.customer_name}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Preparato originariamente da:</span>
                  <strong className="text-slate-300">{returnModal.order.picking_operator || returnModal.order.created_by || 'Non registrato'}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Spedito originariamente da:</span>
                  <strong className="text-slate-300">{returnModal.order.shipped_by || 'Non registrato'} {returnModal.order.shipped_at ? `(${new Date(returnModal.order.shipped_at).toLocaleDateString('it-IT')})` : ''}</strong>
                </div>
                <div className="flex justify-between border-t border-slate-800/80 pt-2">
                  <span className="text-amber-400 font-bold">Destinazione merce rientrata:</span>
                  <strong className="text-emerald-400 font-bold">Giacenza magazzino - "IN ATTESA"</strong>
                </div>
              </div>

              {/* Motivo del reso */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">
                  Seleziona il Motivo del Reso <span className="text-rose-400">*</span>
                </label>
                <div className="space-y-2">
                  {[
                    "Merce rovinata/rotta",
                    "Merce non accettata dal cliente",
                    "Indirizzo sconosciuto o non trovato",
                    "Altro (personalizzato)"
                  ].map((r) => (
                    <label
                      key={r}
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                        returnModal.reason === r
                          ? 'bg-amber-500/15 border-amber-500 text-brand-white'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <input
                        type="radio"
                        name="returnReason"
                        checked={returnModal.reason === r}
                        onChange={() => setReturnModal(prev => ({ ...prev, reason: r }))}
                        className="accent-amber-400"
                      />
                      <span className="text-xs font-semibold">{r}</span>
                    </label>
                  ))}
                </div>

                {/* Campo motivo libero */}
                {(returnModal.reason === "Altro (personalizzato)" || returnModal.customReason) && (
                  <div className="mt-3">
                    <label className="block text-xs text-slate-400 mb-1">
                      Scrivi il motivo liberamente:
                    </label>
                    <input
                      type="text"
                      placeholder="Digita motivo personalizzato..."
                      value={returnModal.customReason}
                      onChange={(e) => setReturnModal(prev => ({ ...prev, customReason: e.target.value }))}
                      className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 text-xs focus:ring-amber-400"
                      autoFocus
                    />
                  </div>
                )}
              </div>

              {/* Note */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">
                  Note Aggiuntive (opzionale)
                </label>
                <textarea
                  rows="2"
                  placeholder="Eventuali dettagli o segnalazioni..."
                  value={returnModal.notes}
                  onChange={(e) => setReturnModal(prev => ({ ...prev, notes: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 text-xs focus:ring-amber-400"
                />
              </div>

              {/* Riepilogo Merce che tornerà in magazzino */}
              {returnModal.items && returnModal.items.length > 0 && (
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">
                    Merce che rientrerà in giacenza ({returnModal.items.length} articoli):
                  </label>
                  <div className="max-h-36 overflow-y-auto bg-slate-950 border border-slate-800 rounded-xl p-2 space-y-1.5">
                    {returnModal.items.map((it, idx) => (
                      <div key={idx} className="flex justify-between items-center text-xs p-1.5 border-b border-slate-900 last:border-b-0">
                        <div className="truncate max-w-[280px]">
                          <strong className="text-brand-white">{it.product_name}</strong>
                          {it.batch && <span className="text-slate-500 ml-2 font-mono">Lot: {it.batch}</span>}
                        </div>
                        <span className="font-bold text-amber-400">
                          {it.quantity_picked || it.quantity_required} {it.requested_uom || it.base_uom}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-800 bg-slate-950 flex justify-between items-center">
              <button
                onClick={() => setReturnModal({ show: false, order: null, reason: 'Merce non accettata dal cliente', customReason: '', notes: '', loading: false, items: [] })}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-xl text-xs font-bold transition-colors"
              >
                Annulla
              </button>
              <button
                onClick={handleConfirmReturn}
                disabled={returnModal.loading}
                className="bg-amber-500 hover:bg-amber-400 text-black px-5 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 shadow-[0_0_15px_rgba(245,158,11,0.3)] disabled:opacity-50"
              >
                <RotateCcw size={16} />
                {returnModal.loading ? 'Salvataggio in corso...' : 'Conferma Rientro Merce'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Configura & Stampa Bolla di Uscita */}
      {bollaModal.show && bollaModal.order && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-2xl w-full shadow-2xl my-8 animate-fade-in-up space-y-5">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-xl font-black text-white flex items-center gap-2.5">
                  <FileText className="text-sky-400" size={24} />
                  Bolla di Uscita / D.D.T. Autotrasporto
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Ordine <b className="text-white font-mono">{bollaModal.order.order_code}</b> • {bollaModal.order.customer_name}
                  {bollaModal.order.bolla_number && (
                    <span className="ml-2 px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-bold">
                      {bollaModal.order.bolla_number}
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBollaModal(prev => ({ ...prev, show: false }))}
                className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-400 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              {/* Destinazione / Indirizzo di Consegna */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 space-y-2.5">
                <label className="block text-xs font-black uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
                  <MapPin size={14} /> Indirizzo di Consegna (Destinazione Merce)
                </label>
                {bollaModal.addresses.length > 0 && (
                  <select
                    value={bollaModal.delivery_address_id || ''}
                    onChange={e => {
                      const selId = e.target.value;
                      if (!selId) {
                        setBollaModal(prev => ({ ...prev, delivery_address_id: '' }));
                        return;
                      }
                      const found = bollaModal.addresses.find(a => String(a.id) === String(selId));
                      if (found) {
                        setBollaModal(prev => ({
                          ...prev,
                          delivery_address_id: String(found.id),
                          delivery_label: found.label,
                          delivery_address_text: formatDeliveryAddrOption(found)
                        }));
                      }
                    }}
                    className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2 text-xs font-bold focus:border-brand-blue outline-none"
                  >
                    <option value="">-- Seleziona indirizzo salvato oppure personalizza sotto --</option>
                    {bollaModal.addresses.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.label}{a.is_default ? ' (Predefinito)' : ''}{a.is_inherited ? ' [Sede Madre]' : ''} — {a.address_line} {a.city || ''}
                      </option>
                    ))}
                  </select>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={bollaModal.delivery_label || ''}
                    onChange={e => setBollaModal(prev => ({ ...prev, delivery_address_id: '', delivery_label: e.target.value }))}
                    placeholder="Etichetta Sede (es. Deposito Nord)"
                    className="bg-slate-900 border border-slate-800 text-white rounded-xl px-3 py-2 text-xs focus:border-brand-blue outline-none"
                  />
                  <input
                    type="text"
                    value={bollaModal.delivery_address_text || ''}
                    onChange={e => setBollaModal(prev => ({ ...prev, delivery_address_id: '', delivery_address_text: e.target.value }))}
                    placeholder="Indirizzo completo di consegna..."
                    className="sm:col-span-2 bg-slate-900 border border-slate-800 text-white rounded-xl px-3 py-2 text-xs focus:border-brand-blue outline-none"
                  />
                </div>
              </div>

              {/* Avviso automatico Diciture Bolla da Palette + Località Origine + Container + Ri-Verifica */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-black uppercase tracking-wider text-emerald-400 mb-1.5 flex items-center gap-1.5">
                      <Warehouse size={13} /> Località Inizio Trasporto (Depositario)
                    </label>
                    <select
                      value={bollaModal.origin_warehouse_id || ''}
                      onChange={e => setBollaModal(prev => ({ ...prev, origin_warehouse_id: e.target.value }))}
                      className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2 text-xs font-bold"
                    >
                      {warehouses.map(w => (
                        <option key={w.id} value={w.id}>
                          {w.name}{w.address ? ` — ${w.address}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-black uppercase tracking-wider text-amber-400 mb-1.5 flex items-center gap-1.5">
                      <Container size={13} /> Modalità Carico / Fatturazione
                    </label>
                    <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-700">
                      <button
                        type="button"
                        onClick={() => setBollaModal(prev => ({ ...prev, is_container: false }))}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${!bollaModal.is_container ? 'bg-brand-blue text-brand-black' : 'text-slate-400 hover:text-white'}`}
                      >
                        Camion (OUT/paletta)
                      </button>
                      <button
                        type="button"
                        onClick={() => setBollaModal(prev => ({ ...prev, is_container: true }))}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${bollaModal.is_container ? 'bg-amber-500 text-brand-black' : 'text-slate-400 hover:text-white'}`}
                      >
                        Container (Carico Container)
                      </button>
                    </div>
                  </div>
                </div>

                <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-900 border border-slate-800 cursor-pointer text-xs font-bold text-violet-200 hover:border-violet-500/40">
                  <input
                    type="checkbox"
                    checked={Boolean(bollaModal.require_load_recheck)}
                    onChange={e => setBollaModal(prev => ({ ...prev, require_load_recheck: e.target.checked }))}
                    className="rounded border-slate-600 bg-slate-800 text-violet-500"
                  />
                  <ShieldCheck size={15} className="text-violet-400 shrink-0" />
                  Richiedi di nuovo verifica del carico (l&apos;operatore Zebra dovrà scansionare nuovamente i barcode delle palette prima della partenza)
                </label>

                {bollaModal.compliance?.mixedColdWarning && (
                  <div className="bg-orange-950/60 border border-orange-500/60 text-orange-200 rounded-xl px-3.5 py-2.5 text-xs font-black flex items-center gap-2">
                    <AlertTriangle size={16} className="text-orange-400 shrink-0" />
                    ATTENZIONE: Presenti bancali a temperatura 2/8°C e 15/25°C insieme in questa bolla!
                  </div>
                )}

                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-2">
                  <div className="text-[11px] font-black uppercase tracking-wider text-sky-400">
                    Diciture Temperatura &amp; ADR auto-rilevate dalle palette ({bollaModal.items?.length || 0} righe)
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(!bollaModal.compliance?.tempRegimes?.length && !bollaModal.compliance?.isAdr) ? (
                      <span className="text-xs text-slate-400 italic">Nessuna temperatura controllata o ADR sui bancali di questa spedizione (Senza temperatura / Standard).</span>
                    ) : (
                      <>
                        {bollaModal.compliance?.tempRegimes?.map(tr => (
                          <span key={tr} className="px-2.5 py-1 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/35 text-xs font-bold">
                            {TEMP_REGIME_MAP[tr]?.label || tr}
                          </span>
                        ))}
                        {bollaModal.compliance?.adrDescriptions?.map(desc => (
                          <span key={desc} className="px-2.5 py-1 rounded-lg bg-rose-500/20 text-rose-200 border border-rose-500/40 text-xs font-bold">
                            ADR: {desc}
                          </span>
                        ))}
                      </>
                    )}
                  </div>
                  {(bollaModal.items || []).some(it => it.pallet_code) && (
                    <div className="pt-2 border-t border-slate-800 space-y-1 max-h-28 overflow-y-auto">
                      {bollaModal.items.filter(it => it.pallet_code).map(it => (
                        <div key={it.id} className="flex items-center justify-between gap-2 text-[11px] text-slate-300">
                          <span className="truncate font-mono">
                            {it.pallet_code} • {it.product_name}
                          </span>
                          <button
                            type="button"
                            onClick={() => openPalletMetaEditor(it, () => refreshBollaModalCompliance(bollaModal.order.id))}
                            className="px-2 py-0.5 bg-slate-800 hover:bg-brand-blue hover:text-brand-black text-sky-300 rounded font-bold shrink-0"
                          >
                            Modifica Temp/ADR
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-1.5 pt-1 text-xs text-slate-300">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(bollaModal.bolla_options?.legal_intact_goods)}
                      onChange={e => setBollaModal(prev => ({ ...prev, bolla_options: { ...prev.bolla_options, legal_intact_goods: e.target.checked } }))}
                    />
                    Integrità colli, pallettizzazione e imballaggi conformi all&apos;uscita
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(bollaModal.bolla_options?.legal_driver_check)}
                      onChange={e => setBollaModal(prev => ({ ...prev, bolla_options: { ...prev.bolla_options, legal_driver_check: e.target.checked } }))}
                    />
                    Dichiarazione di verifica numero bancali/colli alla presa in carico del conducente
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(bollaModal.bolla_options?.legal_transport_norm)}
                      onChange={e => setBollaModal(prev => ({ ...prev, bolla_options: { ...prev.bolla_options, legal_transport_norm: e.target.checked } }))}
                    />
                    Validità documento di trasporto D.P.R. 472/96 (Causale C/FINE DEPOSITO) &amp; D.Lgs. 286/2005
                  </label>
                </div>
              </div>

              {/* Dati Vettore, Causale e Note */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-slate-400 font-bold mb-1 uppercase text-[10px]">Vettore / Trasportatore</label>
                  <input
                    type="text"
                    value={bollaModal.bolla_options?.carrier_name || ''}
                    onChange={e => setBollaModal(prev => ({ ...prev, bolla_options: { ...prev.bolla_options, carrier_name: e.target.value } }))}
                    placeholder="Es. Bartolini / Vettore Proprio"
                    className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-3 py-2 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-1 uppercase text-[10px]">Targa Mezzo</label>
                  <input
                    type="text"
                    value={bollaModal.bolla_options?.vehicle_plate || ''}
                    onChange={e => setBollaModal(prev => ({ ...prev, bolla_options: { ...prev.bolla_options, vehicle_plate: e.target.value.toUpperCase() } }))}
                    placeholder="Es. AB123CD"
                    className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-3 py-2 outline-none font-mono uppercase"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-1 uppercase text-[10px]">Causale Trasporto</label>
                  <input
                    type="text"
                    value={bollaModal.bolla_options?.causale || ''}
                    onChange={e => setBollaModal(prev => ({ ...prev, bolla_options: { ...prev.bolla_options, causale: e.target.value } }))}
                    className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-3 py-2 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-1 uppercase text-[10px]">Porto</label>
                  <select
                    value={bollaModal.bolla_options?.porto || 'Franco'}
                    onChange={e => setBollaModal(prev => ({ ...prev, bolla_options: { ...prev.bolla_options, porto: e.target.value } }))}
                    className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-3 py-2 outline-none"
                  >
                    <option value="Franco">Franco</option>
                    <option value="Assegnato">Assegnato</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-slate-400 font-bold mb-1 uppercase text-[10px]">Note per Autista / Trasporto</label>
                  <input
                    type="text"
                    value={bollaModal.bolla_options?.transport_notes || ''}
                    onChange={e => setBollaModal(prev => ({ ...prev, bolla_options: { ...prev.bolla_options, transport_notes: e.target.value } }))}
                    placeholder="Istruzioni scarico, orari, sponda idraulica..."
                    className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-3 py-2 outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setBollaModal(prev => ({ ...prev, show: false }))}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold text-xs transition-colors"
              >
                Chiudi
              </button>
              <button
                type="button"
                disabled={bollaModal.saving}
                onClick={() => handleSaveBollaModal(false)}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white border border-slate-600 rounded-xl font-bold text-xs transition-colors"
              >
                Salva Opzioni
              </button>
              <button
                type="button"
                disabled={bollaModal.saving}
                onClick={() => handleSaveBollaModal(true)}
                className="flex-1 px-5 py-2.5 bg-sky-400 hover:bg-sky-300 text-brand-black rounded-xl font-black text-xs transition-all flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(56,189,248,0.3)] disabled:opacity-50"
              >
                <Printer size={16} />
                {bollaModal.saving ? 'Generazione...' : 'Salva & Stampa Bolla PDF'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale Rapido Modifica Temperatura & ADR Paletta */}
      {metaEditModal.show && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-brand-black/90 backdrop-blur-md">
          <div className="bg-slate-900 border border-sky-500/40 rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-sky-400">Correzione Rapida Metadata Paletta</span>
                <h3 className="text-lg font-black text-white font-mono">{metaEditModal.palletCode}</h3>
              </div>
              <button type="button" onClick={() => setMetaEditModal(p => ({ ...p, show: false }))} className="p-1.5 text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <form onSubmit={handleSavePalletMeta} className="space-y-4">
              <LogisticsMetaFields
                compact
                tempRegime={metaEditModal.temp_regime}
                onTempChange={(val) => setMetaEditModal(p => ({ ...p, temp_regime: val }))}
                isAdr={metaEditModal.is_adr}
                onAdrToggle={(val) => setMetaEditModal(p => ({ ...p, is_adr: val }))}
                adrData={metaEditModal.adr_data}
                onAdrDataChange={(val) => setMetaEditModal(p => ({ ...p, adr_data: val }))}
              />
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setMetaEditModal(p => ({ ...p, show: false }))} className="flex-1 py-2.5 bg-slate-800 text-slate-300 rounded-xl font-bold text-xs">Annulla</button>
                <button type="submit" disabled={isProcessing} className="flex-1 py-2.5 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-xl font-black text-xs">Salva Temp / ADR</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Outbound;
