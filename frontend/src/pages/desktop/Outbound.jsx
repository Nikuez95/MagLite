import { appAlert, appConfirm, appPrompt } from "../../utils/alerts.js";
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Select from 'react-select';
import { Truck, Search, Plus, Trash2, Printer, CheckCircle, Clock, Eye, XCircle, PackageSearch, X, Loader2, History } from 'lucide-react';
import { jwtDecode } from 'jwt-decode';
import { useNavigate } from 'react-router-dom';

function TimelineModal({ order, onClose, token }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get(`http://${window.location.hostname}:3000/api/outbound/${order.id}/details`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(res => {
      setDetails(res.data);
      setLoading(false);
    }).catch(err => {
      console.error(err);
      setLoading(false);
    });
  }, [order.id, token]);

  if (loading) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-2xl w-full shadow-2xl relative animate-fade-in-up">
        <button onClick={onClose} className="absolute top-6 right-6 text-slate-500 hover:text-brand-white transition-colors"><XCircle size={24} /></button>
        <h2 className="text-2xl font-bold text-brand-white mb-2 flex items-center gap-3">
          <Clock className="text-brand-blue" /> Tempistiche Spedizione
        </h2>
        <p className="text-slate-400 font-mono mb-6 text-sm">{order.order_code} {order.client_ddt && `• DDT Cliente: ${order.client_ddt}`}</p>
        
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 bg-slate-950 p-4 rounded-xl border border-slate-800">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Inizio Lavorazione (Presa in carico)</p>
              <p className="text-brand-white font-mono">{order.start_picking_at ? new Date(order.start_picking_at).toLocaleString('it-IT') : '-'}</p>
              <p className="text-xs text-brand-blue mt-1">Operatore: {order.picking_operator || '-'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Fine Lavorazione (Pronto)</p>
              <p className="text-brand-white font-mono">{order.end_picking_at ? new Date(order.end_picking_at).toLocaleString('it-IT') : '-'}</p>
            </div>
            <div className="col-span-2 pt-4 border-t border-slate-800 mt-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Spedito ed Evaso (Conferma Definitiva)</p>
              <p className="text-brand-white font-mono">{order.shipped_at ? new Date(order.shipped_at).toLocaleString('it-IT') : '-'}</p>
            </div>
          </div>
          
          <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-2">Dettaglio Tempi di Prelievo Articoli</h3>
          <div className="max-h-64 overflow-y-auto pr-2 space-y-2">
            {details?.items.map(item => (
              <div key={item.id} className="flex justify-between items-center p-3 bg-slate-950 rounded-lg border border-slate-800">
                <div>
                  <p className="text-xs font-bold text-brand-white">{item.product_name}</p>
                  <p className="text-[10px] text-slate-400 font-mono">
                    Paletta: {item.pallet_code} {item.batch ? `• Lotto: ${item.batch}` : ''} • Q.tà: {parseFloat(item.quantity_required)} {item.requested_uom || item.base_uom || 'Pezzi'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-mono text-brand-blue">{item.picked_at ? new Date(item.picked_at).toLocaleTimeString('it-IT') : 'In attesa'}</p>
                  <p className="text-[10px] text-slate-500">{item.status}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const Outbound = () => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Modale nuova spedizione
  const [showModal, setShowModal] = useState(false);
  const [newOrder, setNewOrder] = useState({ customer_id: '', exit_date: new Date().toISOString().split('T')[0] });
  const [cart, setCart] = useState([]);

  // Modale selezione paletta/lotto
  const [availablePallets, setAvailablePallets] = useState([]);
  const [palletSearchTerm, setPalletSearchTerm] = useState('');
  
  // Custom Pick Modal
  const [showPickModal, setShowPickModal] = useState(false);
  const [pickingPallet, setPickingPallet] = useState(null);
  const [pickQty, setPickQty] = useState('');
  const [pickUom, setPickUom] = useState('Pezzi');

  const [deleteConfirm, setDeleteConfirm] = useState({ show: false, id: null, code: '', expected: '', input: '' });
  
  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [timelineModal, setTimelineModal] = useState(null);
  
  const [includePending, setIncludePending] = useState(false);

  const token = localStorage.getItem('maglite_token');
  const userRole = token ? jwtDecode(token).role : '';

  useEffect(() => {
    fetchOrders();
    fetchBaseData();
  }, []);

  const toggleIncludePending = (checked) => {
    setIncludePending(checked);
    if (newOrder.customer_id) {
      searchPalletsByCustomer(newOrder.customer_id, newOrder.id, checked);
    }
  };

  const fetchOrders = async () => {
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/outbound`, { headers: { Authorization: `Bearer ${token}` }});
      setOrders(res.data);
    } catch (err) {
      console.error(err);
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
      setNewOrder({ id: order.id, customer_id: order.customer_id, exit_date: order.exit_date.split('T')[0], client_ddt: order.client_ddt || '' });
      setCart(items.map(i => ({
        pallet_id: i.pallet_id || null,
        pallet_code: i.pallet_code,
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
    setNewOrder({...newOrder, customer_id: val.value}); 
    setPalletSearchTerm('');
    searchPalletsByCustomer(val.value, newOrder.id, includePending);
  };

  const removeFromCart = (indexToRemove) => {
    setCart(cart.filter((_, idx) => idx !== indexToRemove));
  };

  const handleCreateOrder = async () => {
    if (!newOrder.customer_id || cart.length === 0) {
      appAlert('Seleziona cliente e inserisci almeno un articolo.');
      return;
    }
    setIsProcessing(true);
    try {
      const payload = {
        customer_id: newOrder.customer_id,
        exit_date: newOrder.exit_date,
        client_ddt: newOrder.client_ddt || null,
        items: cart.map(c => ({
          pallet_id: c.pallet_id || null,
          pallet_code: c.pallet_code || null,
          product_id: c.product_id,
          quantity_required: c.quantity_required,
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
      setNewOrder({ customer_id: '', exit_date: new Date().toISOString().split('T')[0] });
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
      appAlert('Spedizione confermata e merce scaricata!');
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
      padding: '0.25rem',
      boxShadow: 'none',
      '&:hover': { borderColor: '#38bdf8' }
    }),
    menu: base => ({ ...base, backgroundColor: '#0f172a', zIndex: 50, border: '1px solid #1e293b' }),
    option: (base, state) => ({ ...base, backgroundColor: state.isFocused ? '#1e293b' : 'transparent', color: '#f8fafc', cursor: 'pointer' }),
    singleValue: base => ({ ...base, color: '#f8fafc', fontWeight: 'bold' }),
    input: base => ({ ...base, color: '#f8fafc' }),
    placeholder: base => ({ ...base, color: '#475569' })
  };

  // Raggruppa le palette disponibili per (product_id + lotto) così da poter cercare direttamente per lotto
  // e spedire esclusivamente il lotto selezionato senza duplicazioni
  const groupedLotRows = React.useMemo(() => {
    const map = new Map();
    const batchesByProduct = new Map();

    availablePallets.forEach(p => {
      const batchNorm = (p.batch && String(p.batch).trim() !== '') ? String(p.batch).trim() : 'Nessun lotto';
      const key = `${p.product_id}__${batchNorm}`;
      const availQty = parseFloat((p.available_quantity ?? p.quantity) || 0);
      const upb = parseFloat(p.units_per_box) || 1;
      const bpp = parseFloat(p.boxes_per_pallet) || 1;
      const unitsPerPallet = upb * bpp;

      // Quanti bancali rappresenta questa riga paletta
      const rowPallets = (unitsPerPallet > 1 && availQty >= unitsPerPallet * 2)
        ? Math.max(1, Math.floor(availQty / unitsPerPallet))
        : 1;

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
        const baseUom = (p.uom === 'Scatole' || p.uom === 'Bancali' || !p.uom) ? 'Pezzi' : p.uom;
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
          locations: new Set(),
          expiration_date: p.expiration_date || null
        });
      }

      const g = map.get(key);
      g.total_quantity += availQty;
      g.pallet_count += rowPallets;
      if (p.pallet_code) g.pallet_codes.add(p.pallet_code);
      if (p.location) g.locations.add(p.location);
      if (p.expiration_date && (!g.expiration_date || new Date(p.expiration_date) < new Date(g.expiration_date))) {
        g.expiration_date = p.expiration_date;
      }
    });

    return Array.from(map.values()).map(g => ({
      ...g,
      pallet_codes: Array.from(g.pallet_codes),
      locations: Array.from(g.locations),
      productBatches: Array.from((batchesByProduct.get(g.product_id) || new Map()).values())
    }));
  }, [availablePallets]);

  const filteredLotRows = React.useMemo(() => {
    const term = palletSearchTerm.trim().toLowerCase();
    if (!term) return groupedLotRows;
    return groupedLotRows.filter(row => {
      const nameMatch = (row.name || '').toLowerCase().includes(term);
      const skuMatch = (row.sku || '').toLowerCase().includes(term);
      const batchMatch = (row.batch || '').toLowerCase().includes(term);
      const palletMatch = row.pallet_codes.some(c => c.toLowerCase().includes(term));
      const locMatch = row.locations.some(l => l.toLowerCase().includes(term));
      return nameMatch || skuMatch || batchMatch || palletMatch || locMatch;
    });
  }, [groupedLotRows, palletSearchTerm]);

  const filteredOrders = orders.filter(o => {
    let match = true;
    if (statusFilter && o.status !== statusFilter) match = false;
    if (dateFrom && o.exit_date.split('T')[0] < dateFrom) match = false;
    if (dateTo && o.exit_date.split('T')[0] > dateTo) match = false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const codeMatch = (o.order_code || '').toLowerCase().includes(term);
      const customerMatch = (o.customer_name || '').toLowerCase().includes(term);
      const ddtMatch = (o.client_ddt || '').toLowerCase().includes(term);
      const batchMatch = (o.batches || '').toLowerCase().includes(term);
      const prodMatch = (o.products || '').toLowerCase().includes(term);
      const palMatch = (o.pallets || '').toLowerCase().includes(term);
      if (!codeMatch && !customerMatch && !ddtMatch && !batchMatch && !prodMatch && !palMatch) match = false;
    }
    return match;
  });

  // Calcola le scorte disponibili per il lotto selezionato nel Pick Modal
  const selectedBatchStats = React.useMemo(() => {
    if (!pickingPallet) return { qty: 0, boxes: 0, pallets: 0 };
    const selBatch = pickingPallet.selectedBatch || pickingPallet.batch;
    const upb = parseFloat(pickingPallet.units_per_box) || 1;

    if (selBatch === 'TUTTI') {
      const totalQty = (pickingPallet.productBatches || []).reduce((acc, b) => acc + b.total_quantity, 0);
      const totalPallets = (pickingPallet.productBatches || []).reduce((acc, b) => acc + b.pallet_count, 0);
      return {
        qty: totalQty,
        boxes: Math.floor(totalQty / upb),
        pallets: totalPallets
      };
    }

    const found = (pickingPallet.productBatches || []).find(b => b.batch === selBatch);
    const qty = found ? found.total_quantity : pickingPallet.total_quantity;
    const pallets = found ? found.pallet_count : pickingPallet.pallet_count;
    return {
      qty,
      boxes: Math.floor(qty / upb),
      pallets
    };
  }, [pickingPallet]);

  return (
    <div className="p-8 max-w-7xl mx-auto animate-fade-in">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-4xl font-black text-brand-white flex items-center gap-3">
            <Truck className="text-brand-blue" size={40} />
            Uscite e Spedizioni
          </h1>
          <p className="text-slate-400 mt-2">Gestione DDT interni e picking guidato Zebra</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => navigate('/desktop/outbound/history')} className="bg-slate-800 hover:bg-slate-700 text-brand-white font-bold py-3 px-6 rounded-xl flex items-center gap-2 transition-all">
            <History size={20} /> Storico Articoli Usciti
          </button>
          <button onClick={() => {
            setNewOrder({ customer_id: '', exit_date: new Date().toISOString().split('T')[0] });
            setCart([]);
            setAvailablePallets([]);
            setPalletSearchTerm('');
            setShowModal(true);
          }} className="bg-brand-blue hover:bg-sky-400 text-brand-black font-bold py-3 px-6 rounded-xl flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(14,165,233,0.3)]">
            <Plus size={20} /> Nuova Spedizione
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 mb-6 flex flex-wrap gap-4 shadow-xl">
        <div className="flex-1 min-w-[200px] relative">
          <input 
            type="text" 
            placeholder="Cerca per ordine, cliente, DDT, lotto o articolo..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl py-3 pl-10 pr-4 focus:ring-brand-blue"
          />
          <Search size={18} className="absolute left-4 top-3.5 text-slate-500" />
        </div>
        <div className="w-[180px]">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 focus:ring-brand-blue">
            <option value="">Tutti gli stati</option>
            <option value="PENDING">In Attesa</option>
            <option value="PICKING">In Lavorazione (Zebra)</option>
            <option value="READY">Pronto</option>
            <option value="SHIPPED">Spedito</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-slate-950 border border-slate-800 text-slate-400 rounded-xl p-3 [color-scheme:dark]" title="Da data" />
          <span className="text-slate-500">-</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-slate-950 border border-slate-800 text-slate-400 rounded-xl p-3 [color-scheme:dark]" title="A data" />
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse whitespace-nowrap md:whitespace-normal">
            <thead>
              <tr className="bg-slate-950/50">
                <th className="px-3 py-3 text-slate-400 font-bold uppercase tracking-wider text-sm border-b border-slate-800">DDT / Ordine</th>
                <th className="px-3 py-3 text-slate-400 font-bold uppercase tracking-wider text-sm border-b border-slate-800">Data Uscita</th>
                <th className="px-3 py-3 text-slate-400 font-bold uppercase tracking-wider text-sm border-b border-slate-800">Cliente</th>
                <th className="px-3 py-3 text-slate-400 font-bold uppercase tracking-wider text-sm border-b border-slate-800">Stato</th>
                <th className="px-3 py-3 text-slate-400 font-bold uppercase tracking-wider text-sm border-b border-slate-800 text-right">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan="5" className="p-8 text-center text-slate-500">Nessuna spedizione corrisponde ai filtri</td>
                </tr>
              ) : filteredOrders.map(o => (
                <tr key={o.id} className="hover:bg-slate-800/50 transition-colors group">
                  <td className="px-3 py-3 font-mono font-bold text-brand-white">
                    <div className="flex flex-col">
                      <span>{o.order_code}</span>
                      {o.client_ddt && <span className="text-xs text-brand-blue uppercase">DDT Cliente: {o.client_ddt}</span>}
                      {o.batches && <span className="text-[11px] text-amber-400 font-sans mt-0.5">Lotti: {o.batches}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-300">{new Date(o.exit_date).toLocaleDateString('it-IT')}</td>
                  <td className="px-3 py-3 font-bold text-brand-blue">{o.customer_name}</td>
                  <td className="px-3 py-3">
                    {o.status === 'PENDING' && <span className="bg-slate-500/20 text-slate-400 px-3 py-1 rounded-full text-xs font-bold border border-slate-500/30">ATTESA</span>}
                    {o.status === 'PICKING' && <span className="bg-amber-500/20 text-amber-400 px-3 py-1 rounded-full text-xs font-bold border border-amber-500/30">IN PRELIEVO</span>}
                    {o.status === 'READY' && <span className="bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full text-xs font-bold border border-emerald-500/30">PRONTO</span>}
                    {o.status === 'SHIPPED' && <span className="bg-sky-500/20 text-sky-400 px-3 py-1 rounded-full text-xs font-bold border border-sky-500/30">SPEDITO</span>}
                  </td>
                  <td className="px-3 py-3 text-right flex justify-end gap-2">
                    <div className="flex gap-2">
                      <button 
                        onClick={() => setTimelineModal(o)}
                        className="p-2 bg-slate-800 hover:bg-slate-700 text-brand-blue rounded-lg transition-colors"
                        title="Vedi Dettagli e Tempistiche (Timeline)"
                      >
                        <Eye size={18} />
                      </button>
                      <button 
                        onClick={() => window.open(`http://${window.location.hostname}:3000/api/outbound/${o.order_code}/pdf?token=${token}`, '_blank')}
                        className="p-2 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-lg transition-colors"
                        title="Stampa DDT (Picking List)"
                      >
                        <Printer size={18} />
                      </button>
                      {(userRole === 'admin' || userRole === 'developer' || userRole === 'backoffice') && o.status !== 'SHIPPED' && (
                        <>
                          <button 
                            onClick={() => editOrder(o.id)}
                            className="bg-brand-blue/20 hover:bg-brand-blue text-brand-blue hover:text-brand-black p-2 rounded-xl transition-colors"
                            title="Modifica Spedizione"
                          >
                            ✏️
                          </button>
                          <button 
                            onClick={() => setDeleteConfirm({show: true, id: o.id, code: o.order_code, expected: Math.floor(1000 + Math.random() * 9000).toString(), input: ''})}
                            className="bg-rose-500/20 hover:bg-rose-500 text-rose-400 hover:text-white p-2 rounded-xl transition-colors"
                            title="Elimina Spedizione"
                          >
                            <Trash2 size={18} />
                          </button>
                        </>
                      )}
                    </div>
                    {o.status !== 'SHIPPED' && (
                      <button 
                        onClick={() => confirmOrder(o.order_code)}
                        className="p-2 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 rounded-lg transition-colors font-bold"
                        title="Conferma spedizione ed evasione magazzino (Forza senza Zebra)"
                      >
                        <CheckCircle size={18} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
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
        />
      )}

      {/* New Order Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-4xl w-full shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-2xl font-bold text-brand-white flex items-center gap-2">
                <Truck className="text-brand-blue" /> {newOrder.id ? 'Modifica Spedizione' : 'Crea Spedizione'}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-slate-500 hover:text-brand-white"><X size={24} /></button>
            </div>
            
            <div className="flex gap-4 mb-6">
              <div className="flex-1 grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-[10px] uppercase tracking-wider">Cliente Proprietario *</label>
                  <Select 
                    styles={selectStyles}
                    options={customers}
                    placeholder="Seleziona cliente..."
                    value={customers.find(c => c.value === newOrder.customer_id)}
                    onChange={val => {
                      handleCustomerChange(val);
                    }}
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-[10px] uppercase tracking-wider">DDT Cliente (Riferimento)</label>
                  <input 
                    type="text" 
                    value={newOrder.client_ddt || ''} 
                    onChange={e => setNewOrder({...newOrder, client_ddt: e.target.value})} 
                    className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-2.5 focus:ring-brand-blue" 
                    placeholder="Es. 3025"
                  />
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-slate-400 font-bold mb-2 text-[10px] uppercase tracking-wider">Data di Uscita</label>
                  <input 
                    type="date" 
                    value={newOrder.exit_date} 
                    onChange={e => setNewOrder({...newOrder, exit_date: e.target.value})} 
                    className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-2.5 [color-scheme:dark] focus:ring-brand-blue" 
                  />
                </div>
                <div className="flex-1 flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer p-2.5 bg-slate-950 border border-slate-800 rounded-xl w-full h-[42px] hover:border-brand-blue transition-colors">
                    <input 
                      type="checkbox" 
                      checked={includePending} 
                      onChange={e => toggleIncludePending(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-700 text-brand-blue focus:ring-brand-blue bg-slate-900"
                    />
                    <span className="text-xs font-bold text-slate-300">Permetti prelievo merce "In Attesa"</span>
                  </label>
                </div>
              </div>
            </div>

            {newOrder.customer_id && (
              <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 mb-6 flex-1 flex flex-col min-h-0">
                <h4 className="text-brand-white font-bold mb-4 flex items-center gap-2"><PackageSearch size={18} className="text-brand-blue" /> Aggiungi Merce (Cerca per Lotto, Articolo o Paletta)</h4>
                
                <div className="mb-4 relative">
                  <input 
                    type="text" 
                    placeholder="Cerca per numero di lotto, nome articolo, codice articolo o codice paletta..."
                    className="w-full bg-slate-900 border border-slate-800 text-brand-white text-sm rounded-xl focus:ring-brand-blue focus:border-brand-blue block p-4 pl-10 transition-colors placeholder-slate-500"
                    value={palletSearchTerm}
                    onChange={e => setPalletSearchTerm(e.target.value)}
                  />
                  <Search size={18} className="absolute left-3.5 top-4 text-slate-500" />
                </div>

                <div className="overflow-y-auto flex-1 border border-slate-800 rounded-xl mb-4 bg-slate-900/50">
                  {availablePallets.length === 0 && <p className="px-3 py-6 text-slate-500 text-center">Nessuna merce disponibile per questo cliente.</p>}
                  {availablePallets.length > 0 && filteredLotRows.length === 0 && (
                    <p className="px-3 py-6 text-slate-500 text-center">Nessun lotto o articolo trovato per "{palletSearchTerm}".</p>
                  )}
                  {filteredLotRows.length > 0 && (
                    <table className="w-full text-left">
                      <thead className="bg-slate-900 sticky top-0 shadow-md z-10">
                        <tr>
                          <th className="p-3 text-xs text-slate-400 uppercase font-bold">Articolo</th>
                          <th className="p-3 text-xs text-slate-400 uppercase font-bold">Lotto</th>
                          <th className="p-3 text-xs text-slate-400 uppercase font-bold text-center">Disponibilità Lotto</th>
                          <th className="p-3 text-xs text-slate-400 uppercase font-bold text-right">Azione</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredLotRows.map(row => {
                          const isInCart = cart.some(c =>
                            c.product_id === row.product_id &&
                            ((c.batch || 'Nessun lotto') === row.batch || c.batch === 'TUTTI')
                          );
                          return (
                            <tr key={row.key} className="border-t border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                              <td className="p-3">
                                <div className="text-sm font-bold text-brand-white">{row.name}</div>
                                <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                                  {row.sku && <span className="mr-2">Cod: {row.sku}</span>}
                                  {row.locations.length > 0 && <span className="mr-2">Pos: {row.locations.join(', ')}</span>}
                                  <span>Palette: {row.pallet_codes.join(', ')}</span>
                                </div>
                              </td>
                              <td className="p-3">
                                <span className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold border ${row.batch === 'Nessun lotto' ? 'bg-slate-800 text-slate-400 border-slate-700' : 'bg-amber-500/15 text-amber-300 border-amber-500/30'}`}>
                                  {row.batch}
                                </span>
                                {row.expiration_date && (
                                  <div className="text-[10px] text-slate-500 mt-1">
                                    Scad: {new Date(row.expiration_date).toLocaleDateString('it-IT')}
                                  </div>
                                )}
                              </td>
                              <td className="p-3 text-sm text-center">
                                <div className="flex flex-col items-center">
                                  <span className="font-black text-emerald-400">
                                    {row.total_quantity} <span className="text-[10px] uppercase text-slate-400">{row.base_uom}</span>
                                  </span>
                                  <span className="text-[10px] text-slate-400 mt-0.5">
                                    {row.units_per_box > 1 && (
                                      <>
                                        {Math.floor(row.total_quantity / row.units_per_box)} Scat.
                                        {(row.total_quantity % row.units_per_box) > 0 && ` + ${(row.total_quantity % row.units_per_box)} Sfusi`}
                                        {' • '}
                                      </>
                                    )}
                                    {row.pallet_count} {row.pallet_count === 1 ? 'Bancale/Paletta' : 'Bancali/Palette'}
                                  </span>
                                </div>
                              </td>
                              <td className="p-3 text-right">
                                {isInCart ? (
                                  <span className="text-emerald-500 text-xs font-bold uppercase flex items-center justify-end gap-1"><CheckCircle size={14}/>Aggiunto</span>
                                ) : (
                                  <button onClick={() => {
                                    setPickingPallet({
                                      ...row,
                                      selectedBatch: row.batch
                                    });
                                    setPickQty(1);
                                    setPickUom(row.base_uom || 'Pezzi');
                                    setShowPickModal(true);
                                  }} className="bg-sky-500/20 text-sky-400 px-3 py-2 rounded-lg text-xs font-bold hover:bg-sky-500 hover:text-brand-black transition-colors">
                                    + Seleziona Lotto
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>

                <div className="border-t border-slate-800 pt-4">
                  <h5 className="text-sm font-bold text-slate-400 uppercase mb-3">Lista Prelievo ({cart.length})</h5>
                  <div className="flex flex-wrap gap-2">
                    {cart.map((c, i) => (
                      <div key={i} className="bg-brand-blue/10 border border-brand-blue/30 px-3 py-2 rounded-xl flex items-center gap-3">
                        <div>
                          <p className="text-brand-white font-bold text-sm">{c.product_name}</p>
                          <p className="text-slate-400 text-xs">
                            Q.tà: <strong className="text-brand-white">{c.quantity_required} {c.requested_uom === 'Bancali' ? 'Bancali/Palette' : (c.requested_uom || 'Pezzi')}</strong>
                            {' | '}
                            Lotto: <strong className="text-amber-300">{c.batch && c.batch !== 'TUTTI' ? c.batch : 'Scelta Automatica'}</strong>
                            {c.pallet_code ? ` (${c.pallet_code})` : ''}
                          </p>
                        </div>
                        <button onClick={() => removeFromCart(i)} className="text-rose-400 hover:text-rose-300 p-1 bg-rose-500/10 rounded-lg"><Trash2 size={14}/></button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <button onClick={handleCreateOrder} disabled={isProcessing} className="w-full bg-brand-blue hover:bg-sky-400 text-brand-black font-bold py-4 rounded-xl transition-colors disabled:opacity-50">
              {isProcessing ? 'Salvataggio...' : (newOrder.id ? 'Salva Modifiche Spedizione' : 'Conferma e Crea Spedizione')}
            </button>
          </div>
        </div>
      )}

      {/* Pick Modal */}
      {showPickModal && pickingPallet && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold text-brand-white mb-2">Aggiungi al Prelievo</h3>
            <p className="text-brand-blue font-bold mb-4 text-lg text-center">{pickingPallet.name}</p>

            <div className="mb-4">
              <label className="block text-slate-400 text-xs font-bold mb-2">Lotto da Spedire</label>
              <select 
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-brand-white font-mono focus:border-brand-blue"
                value={pickingPallet.selectedBatch || pickingPallet.batch}
                onChange={e => setPickingPallet({...pickingPallet, selectedBatch: e.target.value})}
              >
                {(pickingPallet.productBatches || []).map(b => (
                  <option key={b.batch} value={b.batch}>
                    Lotto: {b.batch} ({b.total_quantity} {pickingPallet.base_uom || 'Pezzi'} • {b.pallet_count} Banc.)
                  </option>
                ))}
                {(pickingPallet.productBatches || []).length > 1 && (
                  <option value="TUTTI">Qualsiasi lotto (FIFO / Scadenza più vicina)</option>
                )}
              </select>
            </div>

            <div className="mb-4">
              <label className="block text-slate-400 text-xs font-bold mb-2">Unità di Misura Prelievo</label>
              <div className="grid grid-cols-3 gap-2">
                {Array.from(new Set([pickingPallet.base_uom || 'Pezzi', 'Scatole', 'Bancali'])).map(u => (
                  <button 
                    key={u}
                    type="button"
                    onClick={() => setPickUom(u)}
                    className={`py-2.5 px-2 text-xs font-bold rounded-lg border transition-colors ${pickUom === u ? 'bg-brand-blue text-brand-black border-brand-blue' : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-600'}`}
                  >
                    {u === 'Bancali' ? 'Bancali / Palette' : u}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-slate-400 text-xs font-bold mb-2">
                Quantità richiesta ({pickUom === 'Bancali' ? 'Bancali / Palette' : pickUom})
              </label>
              <input 
                type="number" 
                min="1"
                step="any"
                autoFocus
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-brand-white focus:border-brand-blue text-lg font-bold"
                value={pickQty}
                onChange={e => setPickQty(e.target.value)}
              />
              <div className="text-xs text-slate-400 mt-2 bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                <div>Disponibilità per <strong className="text-amber-300">{pickingPallet.selectedBatch === 'TUTTI' ? 'Tutti i lotti' : `Lotto ${pickingPallet.selectedBatch}`}</strong>:</div>
                <div className="mt-1 font-mono text-emerald-400">
                  • {selectedBatchStats.qty} {pickingPallet.base_uom || 'Pezzi'}
                  {pickingPallet.units_per_box > 1 && ` • ${selectedBatchStats.boxes} Scatole`}
                  {` • ${selectedBatchStats.pallets} Bancali/Palette`}
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowPickModal(false)} className="flex-1 py-3 text-slate-400 font-bold hover:text-brand-white transition-colors bg-slate-800 rounded-xl">Annulla</button>
              <button onClick={() => {
                 const reqVal = parseFloat(pickQty);
                 if (!pickQty || isNaN(reqVal) || reqVal <= 0) {
                   appAlert('Quantità non valida.');
                   return;
                 }

                 const upb = parseFloat(pickingPallet.units_per_box) || 1;
                 if (pickUom === 'Bancali' && reqVal > selectedBatchStats.pallets) {
                   appAlert(`Disponibilità insufficiente per questo lotto: massimo ${selectedBatchStats.pallets} bancali/palette disponibili.`);
                   return;
                 }
                 if (pickUom === 'Scatole' && (reqVal * upb) > selectedBatchStats.qty) {
                   appAlert(`Disponibilità insufficiente per questo lotto: massimo ${selectedBatchStats.boxes} scatole disponibili.`);
                   return;
                 }
                 if (pickUom !== 'Bancali' && pickUom !== 'Scatole' && reqVal > selectedBatchStats.qty) {
                   appAlert(`Disponibilità insufficiente per questo lotto: massimo ${selectedBatchStats.qty} ${pickingPallet.base_uom || 'Pezzi'} disponibili.`);
                   return;
                 }

                 const targetBatch = pickingPallet.selectedBatch || pickingPallet.batch || 'Nessun lotto';
                 const newCartItem = {
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
    </div>
  );
};

export default Outbound;
