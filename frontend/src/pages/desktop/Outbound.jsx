import { appAlert, appConfirm, appPrompt } from "../../utils/alerts.js";
import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import Select from 'react-select';
import { io } from 'socket.io-client';
import {
  Truck, Search, Plus, Trash2, Printer, CheckCircle, Clock, Eye, XCircle,
  PackageSearch, X, History, User, Package, RotateCcw, Calendar, ArrowUpDown,
  AlertTriangle, Edit3, Zap, Layers
} from 'lucide-react';
import { jwtDecode } from 'jwt-decode';
import { useNavigate } from 'react-router-dom';

function TimelineModal({ order, onClose, token, onOpenReturn }) {
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
    socket.on('dashboard_update', loadDetails);
    return () => socket.disconnect();
  }, [order.id, token]);

  if (loading) return null;

  const ordData = details?.order || order;
  const items = details?.items || [];
  const pickedCount = items.filter(i => i.status === 'PICKED').length;
  const pct = items.length > 0 ? Math.round((pickedCount / items.length) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-7 max-w-2xl w-full shadow-2xl relative animate-fade-in-up">
        <button onClick={onClose} className="absolute top-6 right-6 text-slate-500 hover:text-brand-white transition-colors">
          <XCircle size={24} />
        </button>
        <h2 className="text-2xl font-bold text-brand-white mb-1 flex items-center gap-3">
          <Clock className="text-brand-blue" /> Dettaglio & Tempistiche Spedizione
        </h2>
        <p className="text-slate-400 font-mono mb-5 text-sm">
          {ordData.order_code} {ordData.client_ddt && `• DDT Cliente: ${ordData.client_ddt}`} • <span className="text-brand-blue font-bold">{ordData.customer_name || order.customer_name}</span>
        </p>

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
                <div key={item.id} className="flex justify-between items-center p-3 bg-slate-950 rounded-xl border border-slate-800">
                  <div>
                    <p className="text-xs font-bold text-brand-white">{item.product_name}</p>
                    <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                      {item.pallet_code ? `Paletta: ${item.pallet_code} • ` : ''}
                      {item.client_pallet_number ? `Rif. Pal. Cl: ${item.client_pallet_number} • ` : ''}
                      {item.batch ? `Lotto: ${item.batch} • ` : ''}
                      Q.tà: <strong className="text-brand-white">{parseFloat(item.quantity_required)} {item.requested_uom || item.base_uom || 'Pezzi'}</strong>
                    </p>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-xs font-mono text-brand-blue">{item.picked_at ? new Date(item.picked_at).toLocaleTimeString('it-IT') : 'In attesa'}</p>
                    <span className={`inline-block mt-0.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${item.status === 'PICKED' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'}`}>
                      {item.status === 'PICKED' ? 'Prelevato' : 'Da prelevare'}
                    </span>
                  </div>
                </div>
              ))}
            
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
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Modale nuova spedizione
  const [showModal, setShowModal] = useState(false);
  const [newOrder, setNewOrder] = useState({ customer_id: '', exit_date: new Date().toISOString().split('T')[0], client_ddt: '', notes: '' });
  const [cart, setCart] = useState([]);

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
    socket.on('outbound_updated', fetchOrders);
    socket.on('dashboard_update', fetchOrders);

    return () => socket.disconnect();
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

  const editOrder = async (orderId) => {
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/outbound/${orderId}/details`, { headers: { Authorization: `Bearer ${token}` }});
      const { order, items } = res.data;
      setNewOrder({ id: order.id, customer_id: order.customer_id, exit_date: order.exit_date.split('T')[0], client_ddt: order.client_ddt || '', notes: order.notes || '' });
      setCart(items.map(i => ({
        pallet_id: i.pallet_id || null,
        pallet_code: i.pallet_code || null,
        client_pallet_number: i.client_pallet_number || null,
        product_id: i.product_id,
        quantity_required: parseFloat(i.quantity_required),
        requested_uom: i.requested_uom || 'Pezzi',
        product_name: i.product_name,
        locStr: i.location || 'NO POS.',
        batch: i.batch || 'Nessun lotto'
      })));
      searchPalletsByCustomer(order.customer_id, order.id, includePending);
      setShowModal(true);
    } catch (err) {
      appAlert('Errore caricamento spedizione');
    }
  };

  const fetchBaseData = async () => {
    try {
      const resC = await axios.get(`http://${window.location.hostname}:3000/api/customers`, { headers: { Authorization: `Bearer ${token}` }});
      setCustomers(resC.data.map(c => ({ value: c.id, label: c.business_name })));
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

  const handleCustomerChange = (val) => {
    setNewOrder({...newOrder, customer_id: val ? val.value : ''}); 
    setPalletSearchTerm('');
    if (val) {
      searchPalletsByCustomer(val.value, newOrder.id, includePending);
    } else {
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
        items: cart.map(c => ({
          pallet_id: c.pallet_id || null,
          pallet_code: c.pallet_code || null,
          client_pallet_number: c.client_pallet_number || null,
          product_id: c.product_id,
          quantity_required: parseFloat(c.quantity_required),
          requested_uom: c.requested_uom,
          batch: c.batch
        }))
      };
      
      if (newOrder.id) {
        await axios.put(`http://${window.location.hostname}:3000/api/outbound/${newOrder.id}`, payload, { headers: { Authorization: `Bearer ${token}` }});
      } else {
        await axios.post(`http://${window.location.hostname}:3000/api/outbound`, payload, { headers: { Authorization: `Bearer ${token}` }});
      }
      
      setShowModal(false);
      setCart([]);
      setNewOrder({ customer_id: '', exit_date: new Date().toISOString().split('T')[0], client_ddt: '', notes: '' });
      setAvailablePallets([]);
      setPalletSearchTerm('');
      fetchOrders();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante il salvataggio');
    } finally {
      setIsProcessing(false);
    }
  };

  const confirmOrder = async (code) => {
    if (!await appConfirm('Vuoi confermare la spedizione? Questo scaricherà la merce dal magazzino definitivamente.')) return;
    try {
      await axios.post(`http://${window.location.hostname}:3000/api/outbound/${code}/confirm`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchOrders();
      appAlert('Spedizione confermata e merce scaricata!', 'Successo', 'success');
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore');
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
    <div className="max-w-7xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-black text-brand-white flex items-center gap-3">
            <Truck className="text-brand-blue" size={34} />
            Uscite e Spedizioni (Out-bound)
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Gestione ordini d'uscita, semaforo avanzamento picking Zebra in tempo reale e scarico definitivo.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => navigate('/desktop/outbound/history')}
            className="bg-slate-900 border border-slate-700 hover:bg-slate-800 text-brand-white font-bold py-2.5 px-5 rounded-xl flex items-center gap-2 transition-all text-sm"
          >
            <History size={18} className="text-brand-blue" /> Storico Articoli Usciti
          </button>
          <button
            onClick={() => {
              setNewOrder({ customer_id: '', exit_date: new Date().toISOString().split('T')[0], client_ddt: '', notes: '' });
              setCart([]);
              setAvailablePallets([]);
              setPalletSearchTerm('');
              setShowModal(true);
            }}
            className="bg-brand-blue hover:bg-sky-400 text-brand-black font-black py-2.5 px-6 rounded-xl flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(14,165,233,0.3)] text-sm"
          >
            <Plus size={18} /> Nuova Spedizione
          </button>
        </div>
      </div>

      {/* Cruscotto Interattivo Stati Spedizione (5 Card KPI) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
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
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 mb-6 flex flex-wrap items-center gap-3 shadow-xl">
        <div className="flex-1 min-w-[230px] relative">
          <input 
            type="text" 
            placeholder="Cerca per ordine, cliente, DDT, lotto, articolo, paletta o operatore..."
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

        <div className="w-[200px]">
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

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Calendar size={15} className="text-brand-blue ml-1" />
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-slate-950 border border-slate-800 text-slate-300 rounded-xl px-2.5 py-2 [color-scheme:dark]" title="Da data" />
          <span className="text-slate-500">-</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-slate-950 border border-slate-800 text-slate-300 rounded-xl px-2.5 py-2 [color-scheme:dark]" title="A data" />

          <div className="hidden lg:flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button type="button" onClick={() => applyDatePreset('TODAY')} className="px-2 py-1 rounded-lg text-[11px] font-bold text-slate-400 hover:text-white hover:bg-slate-800">Oggi</button>
            <button type="button" onClick={() => applyDatePreset('WEEK')} className="px-2 py-1 rounded-lg text-[11px] font-bold text-slate-400 hover:text-white hover:bg-slate-800">7 gg</button>
            <button type="button" onClick={() => applyDatePreset('MONTH')} className="px-2 py-1 rounded-lg text-[11px] font-bold text-slate-400 hover:text-white hover:bg-slate-800">Mese</button>
          </div>
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={resetAllFilters}
            className="flex items-center gap-1.5 px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-xl text-xs font-bold transition-colors"
          >
            <RotateCcw size={13} /> Reset
          </button>
        )}
      </div>

      {/* Orders Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
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

                return (
                <tr key={o.id} className="hover:bg-slate-800/40 border-b border-slate-800/50 transition-colors group">
                  <td className="px-4 py-3.5 font-mono font-bold text-brand-white">
                    <div className="flex flex-col">
                      <span className="text-sm">{o.order_code}</span>
                      {o.client_ddt && (
                        <span className="text-[11px] text-brand-blue font-sans font-bold uppercase mt-0.5">
                          DDT Rif: {o.client_ddt}
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

                    {o.status === 'SHIPPED' && (
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
                        title="Stampa DDT (Picking List)"
                      >
                        <Printer size={17} />
                      </button>
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
                      {(userRole === 'admin' || userRole === 'developer' || userRole === 'backoffice') && o.status !== 'SHIPPED' && (
                        <>
                          <button 
                            onClick={() => editOrder(o.id)}
                            className="bg-brand-blue/15 hover:bg-brand-blue text-brand-blue hover:text-brand-black p-2 rounded-xl transition-colors"
                            title="Modifica Spedizione"
                          >
                            <Edit3 size={17} />
                          </button>
                          <button 
                            onClick={() => setDeleteConfirm({show: true, id: o.id, code: o.order_code, expected: Math.floor(1000 + Math.random() * 9000).toString(), input: ''})}
                            className="bg-rose-500/15 hover:bg-rose-500 text-rose-400 hover:text-white p-2 rounded-xl transition-colors"
                            title="Elimina Spedizione"
                          >
                            <Trash2 size={17} />
                          </button>
                        </>
                      )}
                      {o.status !== 'SHIPPED' && (
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
        />
      )}

      {/* Modale Crea / Modifica Spedizione (Workspace Split-Screen) */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-7xl w-full shadow-2xl flex flex-col max-h-[92vh]">
            
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

            {/* Area Centrale Split-Screen: Catalogo Giacenze (7/12) + Carrello Prelievo Inline (5/12) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-0 overflow-hidden">
              
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
                              <option value="Bancali">Bancali / Palette</option>
                              <option value="KG">KG</option>
                              <option value="Metro Cubo">Metro Cubo</option>
                            </select>
                          </div>
                        </div>
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
                            setPickQty(pickUom === 'Bancali' ? 1 : (pickUom === 'Scatole' ? Math.max(1, Math.floor(p.available_quantity / (parseFloat(pickingPallet.units_per_box) || 1))) : p.available_quantity));
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
                        setPickQty(pickUom === 'Bancali' ? 1 : (pickUom === 'Scatole' ? Math.max(1, Math.floor(chosen.available_quantity / (parseFloat(pickingPallet.units_per_box) || 1))) : chosen.available_quantity));
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
              <div className="grid grid-cols-3 gap-2">
                {Array.from(new Set([pickingPallet.base_uom || 'Pezzi', 'Scatole', 'Bancali'])).map(u => (
                  <button 
                    key={u}
                    type="button"
                    onClick={() => setPickUom(u)}
                    className={`py-2.5 px-2 text-xs font-bold rounded-xl border transition-colors ${pickUom === u ? 'bg-brand-blue text-brand-black border-brand-blue' : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-600'}`}
                  >
                    {u === 'Bancali' ? 'Bancali / Pal.' : u}
                  </button>
                ))}
              </div>
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
                  {pickUom !== 'Scatole' && pickUom !== 'Bancali' && selectedBatchStats.qty > 0 && (
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
                min="1"
                step="any"
                autoFocus
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-brand-white focus:border-brand-blue text-lg font-bold"
                value={pickQty}
                onChange={e => setPickQty(e.target.value)}
              />
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
                 if (pickUom === 'Bancali' && reqVal > selectedBatchStats.pallets) {
                   appAlert(`Disponibilità insufficiente: massimo ${selectedBatchStats.pallets} bancali/palette disponibili.`);
                   return;
                 }
                 if (pickUom === 'Scatole' && (reqVal * upb) > selectedBatchStats.qty) {
                   appAlert(`Disponibilità insufficiente: massimo ${selectedBatchStats.boxes} scatole disponibili.`);
                   return;
                 }
                 if (pickUom !== 'Bancali' && pickUom !== 'Scatole' && reqVal > selectedBatchStats.qty) {
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
                    quantity_required: reqVal,
                    requested_uom: pickUom,
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

    </div>
  );
};

export default Outbound;
