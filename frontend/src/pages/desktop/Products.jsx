import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Package, Plus, Search, Filter, MapPin, XCircle, CheckCircle, Activity, User, Monitor, Loader2, Trash2, Edit3, Printer, Clock } from 'lucide-react';
import { io } from 'socket.io-client';
import CreatableSelect from 'react-select/creatable';

const getExpirationStatus = (expDate, warningDays) => {
  if (!expDate) return null;
  const today = new Date();
  today.setHours(0,0,0,0);
  const exp = new Date(expDate);
  exp.setHours(0,0,0,0);
  
  const diffTime = exp - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays < 0) return { color: 'text-rose-500', label: 'SCADUTO', bg: 'bg-rose-500/10 border-rose-500/30' };
  if (diffDays <= warningDays) return { color: 'text-amber-500', label: `SCADE TRA ${diffDays} GG`, bg: 'bg-amber-500/10 border-amber-500/30' };
  return { color: 'text-emerald-500', label: `Valido (${diffDays} gg)`, bg: 'bg-emerald-500/10 border-emerald-500/30' };
};

const ProductsManagement = () => {
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
  const [activeTab, setActiveTab] = useState('pallets'); // 'pallets' o 'products'
  const [pallets, setPallets] = useState([]);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newProduct, setNewProduct] = useState({ sku: '', name: '', uom: 'Scatole', units_per_box: 1, boxes_per_pallet: 1, customer_id: '', notes: '' });
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [filterWarehouse, setFilterWarehouse] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [expirationWarningDays, setExpirationWarningDays] = useState(60);
  
  // Modifica Paletta (Posizione e Metadati)
  const [editModal, setEditModal] = useState({ 
    show: false, 
    pallet: null, 
    newLocation: '', 
    notes: '', 
    client_pallet_number: '', 
    client_article_number: '',
    expiration_date: '',
    error: null 
  });
  
  const [historyModal, setHistoryModal] = useState(null);
  const [historyData, setHistoryData] = useState(null);

  const [printModal, setPrintModal] = useState({ show: false, code: '', copies: 1, format: 'THERMAL' });

  const getToken = () => localStorage.getItem('maglite_token');
  
  const getUser = () => {
    try {
      const token = getToken();
      if (!token) return null;
      return JSON.parse(atob(token.split('.')[1]));
    } catch(e) {
      return null;
    }
  };
  const user = getUser();
  const isDeveloper = user?.role === 'developer';

  const fetchData = async () => {
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      const [palletsRes, productsRes, custRes, locRes] = await Promise.all([
        axios.get(`http://${window.location.hostname}:3000/api/pallets`, { headers }),
        axios.get(`http://${window.location.hostname}:3000/api/products`, { headers }),
        axios.get(`http://${window.location.hostname}:3000/api/customers`, { headers }),
        axios.get(`http://${window.location.hostname}:3000/api/locations`, { headers })
      ]);
      setPallets(palletsRes.data);
      setProducts(productsRes.data);
      setCustomers(custRes.data);
      setLocations(locRes.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchData();
    const socket = io(`http://${window.location.hostname}:3000`);
    socket.on('stow_updated', () => fetchData());
    socket.on('dashboard_update', () => fetchData());
    return () => socket.disconnect();
  }, []);

  const openHistory = async (code) => {
    setHistoryModal(code);
    setHistoryData(null);
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/pallets/${code}/history`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setHistoryData(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateProduct = async (e) => {
    e.preventDefault();
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      await axios.post(`http://${window.location.hostname}:3000/api/products`, newProduct, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setShowAddModal(false);
      setNewProduct({ sku: '', name: '', uom: 'Scatole', customer_id: '', notes: '' });
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Errore');
    } finally {
      setIsProcessing(false);
    }
  };

  const [deleteConfirmModal, setDeleteConfirmModal] = useState({ show: false, type: null, id: null, title: '' });

  const confirmDeleteAction = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      if (deleteConfirmModal.type === 'product') {
        await axios.delete(`http://${window.location.hostname}:3000/api/products/${deleteConfirmModal.id}`, {
          headers: { Authorization: `Bearer ${getToken()}` }
        });
      } else if (deleteConfirmModal.type === 'pallet') {
        await axios.delete(`http://${window.location.hostname}:3000/api/pallets/${deleteConfirmModal.id}`, {
          headers: { Authorization: `Bearer ${getToken()}` }
        });
      }
      setDeleteConfirmModal({ show: false, type: null, id: null, title: '' });
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Impossibile eliminare (in uso?)');
      setDeleteConfirmModal({ show: false, type: null, id: null, title: '' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteProduct = (id, name) => {
    setDeleteConfirmModal({ show: true, type: 'product', id, title: `Eliminare definitivamente l'anagrafica "${name}"?` });
  };

  const handleDeletePallet = (code) => {
    setDeleteConfirmModal({ show: true, type: 'pallet', id: code, title: `Eliminare definitivamente la paletta ${code}?` });
  };

  const handleUpdatePallet = async (e) => {
    e.preventDefault();
    if (isProcessing) return;
    setIsProcessing(true);
    setEditModal(prev => ({ ...prev, error: null }));
    try {
      // Aggiorna metadati
      await axios.put(`http://${window.location.hostname}:3000/api/pallets/${editModal.pallet.pallet_code}`, {
        notes: editModal.notes,
        client_pallet_number: editModal.client_pallet_number,
        client_article_number: editModal.client_article_number,
        expiration_date: editModal.expiration_date
      }, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });

      // Se ha inserito una posizione e questa è cambiata o prima non l'aveva
      if (editModal.newLocation && editModal.newLocation !== editModal.pallet.location) {
        await axios.post(`http://${window.location.hostname}:3000/api/pallets/stow`, {
          pallet_code: editModal.pallet.pallet_code,
          location: editModal.newLocation,
          source: 'Gestionale'
        }, {
          headers: { Authorization: `Bearer ${getToken()}` }
        });
      }
      
      setEditModal({ show: false, pallet: null, newLocation: '', notes: '', client_pallet_number: '', client_article_number: '', error: null });
      fetchData();
    } catch (err) {
      setEditModal(prev => ({ ...prev, error: err.response?.data || { error: 'Errore imprevisto' } }));
    } finally {
      setIsProcessing(false);
    }
  };

  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  const filteredPallets = pallets.filter(p => {
    const searchLower = searchTerm.toLowerCase();
    const matchSearch = p.product_name.toLowerCase().includes(searchLower) || 
                        p.pallet_code.toLowerCase().includes(searchLower) ||
                        p.customer_name.toLowerCase().includes(searchLower) ||
                        (p.batch && p.batch.toLowerCase().includes(searchLower)) ||
                        (p.location && p.location.toLowerCase().includes(searchLower)) ||
                        (p.notes && p.notes.toLowerCase().includes(searchLower)) ||
                        (p.product_notes && p.product_notes.toLowerCase().includes(searchLower)) ||
                        (p.client_pallet_number && p.client_pallet_number.toLowerCase().includes(searchLower)) ||
                        (p.client_article_number && p.client_article_number.toLowerCase().includes(searchLower)) ||
                        (p.expiration_date && new Date(p.expiration_date).toLocaleDateString('it-IT').includes(searchLower));
    const matchWarehouse = filterWarehouse === 'ALL' || p.warehouse === filterWarehouse;
    const matchStatus = filterStatus === 'ALL' || p.status === filterStatus;
    
    let matchDate = true;
    if (filterStartDate || filterEndDate) {
      const pDate = new Date(p.created_at);
      if (filterStartDate) {
        const start = new Date(filterStartDate);
        start.setHours(0, 0, 0, 0);
        if (pDate < start) matchDate = false;
      }
      if (filterEndDate) {
        const end = new Date(filterEndDate);
        end.setHours(23, 59, 59, 999);
        if (pDate > end) matchDate = false;
      }
    }

    return matchSearch && matchWarehouse && matchStatus && matchDate;
  });

  const filteredProducts = products.filter(p => {
    const searchLower = searchTerm.toLowerCase();
    return p.name.toLowerCase().includes(searchLower) || 
           p.sku.toLowerCase().includes(searchLower) ||
           p.customer_name.toLowerCase().includes(searchLower) ||
           (p.notes && p.notes.toLowerCase().includes(searchLower));
  });

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-brand-black min-h-screen">
      <div className="max-w-7xl mx-auto animate-fade-in-up">
        
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-brand-white mb-2 flex items-center gap-3">
              <Package className="text-brand-blue" size={32} />
              Stock & Anagrafica Prodotti
            </h1>
            <p className="text-slate-400">Inventario fisico in tempo reale e gestione referenze.</p>
          </div>
          <button onClick={() => setShowAddModal(true)} className="flex items-center gap-2 px-5 py-3 bg-brand-blue text-brand-black font-bold rounded-xl hover:bg-sky-400 transition-all shadow-[0_0_20px_rgba(14,165,233,0.2)] active:scale-95">
            <Plus size={20} /> Nuova Referenza
          </button>
        </div>

        <div className="flex gap-4 mb-6 border-b border-slate-800 pb-2">
          <button onClick={() => setActiveTab('pallets')} className={`px-4 py-2 font-bold text-lg transition-colors border-b-2 ${activeTab === 'pallets' ? 'text-brand-white border-brand-blue' : 'text-slate-500 border-transparent hover:text-slate-300'}`}>
            Stock Palette
          </button>
          <button onClick={() => setActiveTab('products')} className={`px-4 py-2 font-bold text-lg transition-colors border-b-2 ${activeTab === 'products' ? 'text-brand-white border-brand-blue' : 'text-slate-500 border-transparent hover:text-slate-300'}`}>
            Anagrafica Prodotti
          </button>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-slate-800 flex flex-col md:flex-row gap-4 items-center">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input type="text" placeholder="Ricerca universale..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl pl-12 pr-4 py-3 focus:ring-brand-blue focus:border-brand-blue transition-all" />
            </div>
            
            {activeTab === 'pallets' && (
              <>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Filter size={16} className="text-slate-500" />
                  <span className="text-slate-400">Magazzino:</span>
                  <div className="flex bg-slate-950 rounded-lg border border-slate-800 p-1">
                    <button onClick={() => setFilterWarehouse('ALL')} className={`px-3 py-1.5 rounded-md transition-colors ${filterWarehouse === 'ALL' ? 'bg-slate-800 text-brand-white' : 'text-slate-500 hover:text-slate-300'}`}>Tutti</button>
                    <button onClick={() => setFilterWarehouse('Settala')} className={`px-3 py-1.5 rounded-md transition-colors ${filterWarehouse === 'Settala' ? 'bg-brand-blue text-brand-black font-bold' : 'text-slate-500 hover:text-brand-blue'}`}>Settala</button>
                    <button onClick={() => setFilterWarehouse('Caleppio')} className={`px-3 py-1.5 rounded-md transition-colors ${filterWarehouse === 'Caleppio' ? 'bg-amber-500 text-brand-black font-bold' : 'text-slate-500 hover:text-amber-500'}`}>Caleppio</button>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="text-slate-400">Stato:</span>
                  <div className="flex bg-slate-950 rounded-lg border border-slate-800 p-1">
                    <button onClick={() => setFilterStatus('ALL')} className={`px-3 py-1.5 rounded-md transition-colors ${filterStatus === 'ALL' ? 'bg-slate-800 text-brand-white' : 'text-slate-500 hover:text-slate-300'}`}>Tutti</button>
                    <button onClick={() => setFilterStatus('PENDING')} className={`px-3 py-1.5 rounded-md transition-colors ${filterStatus === 'PENDING' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>In Attesa</button>
                    <button onClick={() => setFilterStatus('STOCKED')} className={`px-3 py-1.5 rounded-md transition-colors ${filterStatus === 'STOCKED' ? 'bg-green-500/20 text-green-400 font-bold' : 'text-slate-500 hover:text-green-400'}`}>Stivati</button>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="text-slate-400">Dal:</span>
                    <input type="date" value={filterStartDate} onChange={e => setFilterStartDate(e.target.value)} className="w-[120px] bg-slate-950 border border-slate-800 text-brand-white rounded-md px-2 py-1 focus:ring-brand-blue [color-scheme:dark]" />
                  </div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="text-slate-400">Al:</span>
                    <input type="date" value={filterEndDate} onChange={e => setFilterEndDate(e.target.value)} className="w-[120px] bg-slate-950 border border-slate-800 text-brand-white rounded-md px-2 py-1 focus:ring-brand-blue [color-scheme:dark]" />
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Clock size={16} className="text-amber-500" />
                  <span className="text-slate-400">Avviso (gg):</span>
                  <input type="number" value={expirationWarningDays} onChange={e => setExpirationWarningDays(parseInt(e.target.value) || 0)} className="w-16 bg-slate-950 border border-slate-800 text-brand-white rounded-md px-2 py-1 focus:ring-brand-blue" />
                </div>
              </>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              {activeTab === 'pallets' ? (
                <>
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                      <th className="p-4 font-semibold uppercase tracking-wider text-xs">Paletta</th>
                      <th className="p-4 font-semibold uppercase tracking-wider text-xs">Prodotto & Info</th>
                      <th className="p-4 font-semibold uppercase tracking-wider text-xs text-center">Q.tà</th>
                      <th className="p-4 font-semibold uppercase tracking-wider text-xs">Arrivo</th>
                      <th className="p-4 font-semibold uppercase tracking-wider text-xs">Lotto/Scad</th>
                      <th className="p-4 font-semibold uppercase tracking-wider text-xs">Note</th>
                      <th className="p-4 font-semibold uppercase tracking-wider text-xs">Posizione</th>
                      <th className="p-4 font-semibold uppercase tracking-wider text-xs text-right">Azioni</th>
                    </tr>
                  </thead>
                  <tbody className="text-brand-white">
                    {filteredPallets.length === 0 ? (
                      <tr><td colSpan="7" className="p-12 text-center text-slate-500 italic font-medium">Nessuna paletta trovata.</td></tr>
                    ) : filteredPallets.map(p => (
                      <tr key={p.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                        <td className="p-4">
                          <div className="flex flex-col gap-1 items-start">
                            <button onClick={() => setPrintModal({ show: true, code: p.pallet_code, copies: 1, format: 'THERMAL' })} className="font-mono text-brand-blue font-bold text-xs flex items-center gap-1 hover:underline" title="Ristampa Etichetta">
                              <Printer size={12} /> {p.pallet_code}
                            </button>
                            {p.is_mixed === 1 && (
                              <span className="bg-amber-500/20 text-amber-500 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider" title="Paletta Frammentata">Mista</span>
                            )}
                          </div>
                          <div className={`mt-1 inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${p.warehouse === 'Settala' ? 'bg-brand-blue/10 text-brand-blue border border-brand-blue/30' : 'bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/30'}`}>
                            {p.warehouse}
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="font-bold">{p.product_name}</div>
                          <div className="text-slate-400 text-xs">{p.customer_name}</div>
                          {(p.client_pallet_number || p.client_article_number) && (
                            <div className="text-slate-500 text-[10px] uppercase mt-1">
                              {p.client_pallet_number && <span className="mr-2">Pal: {p.client_pallet_number}</span>}
                              {p.client_article_number && <span>Art: {p.client_article_number}</span>}
                            </div>
                          )}
                        </td>
                        <td className="p-4 text-center">
                          {p.units_per_box > 1 && p.uom !== 'Scatole' && p.uom !== 'Bancali' && p.uom !== 'Bancale' ? (
                            <div className="flex flex-col items-center">
                              <span className="font-bold text-brand-blue">{p.quantity} <span className="text-[10px] text-slate-500 uppercase">({p.uom || 'Pezzi'})</span></span>
                              <span className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider">
                                {Math.floor(p.quantity / p.units_per_box)} Scat.
                                {(p.quantity % p.units_per_box) > 0 && ` + ${(p.quantity % p.units_per_box)} Sfusi`}
                              </span>
                            </div>
                          ) : (
                            <span className="font-bold text-brand-blue">{p.quantity} <span className="text-[10px] text-slate-500 uppercase">({p.uom || 'Pezzi'})</span></span>
                          )}
                        </td>
                        <td className="p-4 text-slate-300 text-sm font-medium">
                          {new Date(p.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="p-4 text-slate-400 text-sm">
                          <div>{p.batch || '-'}</div>
                          {p.expiration_date && (() => {
                            const status = getExpirationStatus(p.expiration_date, expirationWarningDays);
                            return (
                              <div className={`mt-1 inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${status.color} ${status.bg}`}>
                                Scad: {new Date(p.expiration_date).toLocaleDateString('it-IT')} ({status.label})
                              </div>
                            );
                          })()}
                        </td>
                        <td className="p-4">
                          {p.notes || p.product_notes ? (
                            <div className="max-w-[150px] truncate text-slate-400 text-xs" title={`${p.product_notes ? `Pr: ${p.product_notes}\n` : ''}${p.notes ? `Pal: ${p.notes}` : ''}`}>
                              {p.notes || p.product_notes}
                            </div>
                          ) : <span className="text-slate-600 text-xs">-</span>}
                        </td>
                        <td className="p-4">
                          {p.status === 'PENDING' ? (
                            <span className="text-slate-500 italic text-sm font-medium bg-slate-950 px-2 py-1 rounded border border-slate-800">⏳ IN ATTESA</span>
                          ) : (
                            <span className="text-green-400 font-bold bg-green-500/10 px-2 py-1 rounded border border-green-500/30 flex items-center gap-1 w-max cursor-pointer hover:bg-green-500/20" onClick={() => openHistory(p.pallet_code)}>
                              <MapPin size={14} /> {p.location}
                            </span>
                          )}
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => setEditModal({ show: true, pallet: p, newLocation: p.location || '', notes: p.notes || '', client_pallet_number: p.client_pallet_number || '', client_article_number: p.client_article_number || '', expiration_date: p.expiration_date ? p.expiration_date.split('T')[0] : '', error: null })} className="p-2 text-slate-400 hover:text-brand-blue hover:bg-brand-blue/10 rounded-xl transition-colors" title="Modifica">
                              <Edit3 size={18} />
                            </button>
                            {isDeveloper && (
                              <button onClick={() => handleDeletePallet(p.pallet_code)} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-xl transition-colors" title="Elimina Paletta">
                                <Trash2 size={18} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </>
              ) : (
                <>
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                      <th className="p-4 font-semibold uppercase tracking-wider text-xs">SKU</th>
                      <th className="p-4 font-semibold uppercase tracking-wider text-xs">Nome Prodotto</th>
                      <th className="p-4 font-semibold uppercase tracking-wider text-xs">Cliente</th>
                      <th className="p-4 font-semibold uppercase tracking-wider text-xs">Giacenza Totale</th>
                      <th className="p-4 font-semibold uppercase tracking-wider text-xs">UDM Base</th>
                      <th className="p-4 font-semibold uppercase tracking-wider text-xs">Note</th>
                      {isDeveloper && <th className="p-4 font-semibold uppercase tracking-wider text-xs text-right">Azioni</th>}
                    </tr>
                  </thead>
                  <tbody className="text-brand-white">
                    {filteredProducts.length === 0 ? (
                      <tr><td colSpan="7" className="p-12 text-center text-slate-500 italic font-medium">Nessun prodotto trovato.</td></tr>
                    ) : filteredProducts.map(p => {
                      const totalStock = stock.filter(pal => pal.product_id === p.id && pal.status !== 'SHIPPED').reduce((acc, curr) => acc + curr.quantity, 0);
                      return (
                      <tr key={p.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                        <td className="p-4 font-mono text-brand-blue text-xs font-bold">{p.sku}</td>
                        <td className="p-4 font-bold">{p.name}</td>
                        <td className="p-4 text-slate-400">{p.customer_name}</td>
                        <td className="p-4 font-bold text-brand-blue">{totalStock} <span className="text-[10px] text-slate-500 uppercase">({p.uom || 'Pezzi'})</span></td>
                        <td className="p-4 text-slate-300 text-sm">{p.uom}</td>
                        <td className="p-4 text-slate-400 text-xs">{p.notes || '-'}</td>
                        {isDeveloper && (
                          <td className="p-4 text-right">
                            <button onClick={() => handleDeleteProduct(p.id, p.name)} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-xl transition-colors" title="Elimina Anagrafica">
                              <Trash2 size={18} />
                            </button>
                          </td>
                        )}
                      </tr>
                      );
                    })}
                  </tbody>
                </>
              )}
            </table>
          </div>
        </div>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-10 max-w-md w-full shadow-2xl animate-fade-in-up">
            <h2 className="text-2xl font-bold text-brand-white mb-8 flex items-center gap-3">
              <span className="w-10 h-10 bg-brand-blue/20 flex items-center justify-center rounded-xl text-brand-blue"><Plus size={24} /></span>
              Registra Anagrafica
            </h2>
            <form onSubmit={handleCreateProduct} className="space-y-6">
              <div>
                <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Codice Articolo (SKU) *</label>
                <input required value={newProduct.sku} onChange={e => setNewProduct({...newProduct, sku: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue font-mono uppercase" />
              </div>
              <div>
                <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Nome Prodotto *</label>
                <input required value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Unità Base (UDM) *</label>
                  <select required value={newProduct.uom} onChange={e => setNewProduct({...newProduct, uom: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue">
                    <option value="Pezzi">Pezzi</option>
                    <option value="Scatole">Scatole</option>
                    <option value="Bancali">Bancali (Pallet)</option>
                    <option value="KG">KG</option>
                    <option value="Metro Cubo">Metro Cubo (m³)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Cliente Proprietario *</label>
                  <select required value={newProduct.customer_id} onChange={e => setNewProduct({...newProduct, customer_id: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue">
                    <option value="" disabled>Seleziona cliente...</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.business_name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Unità per Scatola</label>
                  <input type="number" min="1" value={newProduct.units_per_box} onChange={e => setNewProduct({...newProduct, units_per_box: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue" />
                </div>
              </div>
              <div>
                <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Note Generiche (Opzionale)</label>
                <textarea value={newProduct.notes} onChange={e => setNewProduct({...newProduct, notes: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue resize-none h-20"></textarea>
              </div>
              <div className="flex gap-4 mt-8 pt-8 border-t border-slate-800/80">
                <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 py-4 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-xl font-bold transition-colors">Annulla</button>
                <button type="submit" disabled={isProcessing} className="flex-1 py-4 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-xl font-bold transition-colors shadow-[0_0_20px_rgba(14,165,233,0.3)] disabled:opacity-50">Crea Prodotto</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-lg w-full shadow-2xl relative animate-fade-in-up">
            <h2 className="text-2xl font-bold text-brand-white mb-6 flex items-center gap-3">
              <span className="w-10 h-10 bg-brand-blue/20 flex items-center justify-center rounded-xl text-brand-blue"><Edit3 size={24} /></span>
              Modifica Paletta
            </h2>
            <div className="mb-6 bg-slate-950 p-4 rounded-xl border border-slate-800 shadow-inner flex justify-between">
              <div>
                <p className="font-mono text-brand-white font-bold">{editModal.pallet.pallet_code}</p>
                <p className="text-brand-blue text-sm">{editModal.pallet.product_name}</p>
              </div>
              <div className="text-right">
                <p className="text-slate-400 text-sm">Q.tà: <span className="text-brand-white font-bold">{editModal.pallet.quantity}</span></p>
                <p className="text-slate-400 text-sm">Lotto: <span className="text-brand-white font-bold">{editModal.pallet.batch || '-'}</span></p>
              </div>
            </div>
            
            {editModal.error && (
              <div className="mb-6 bg-rose-950/40 border border-rose-900/50 p-4 rounded-xl">
                <h4 className="text-rose-400 font-bold text-sm mb-1">Attenzione</h4>
                <p className="text-rose-300/80 text-xs">{editModal.error.error}</p>
              </div>
            )}

            <form onSubmit={handleUpdatePallet} className="space-y-4">
              <div>
                <label className="block text-slate-400 font-bold mb-1 text-xs uppercase tracking-wider">Posizione / Scaffale</label>
                <CreatableSelect 
                  styles={selectStyles}
                  isClearable
                  placeholder="Lascia vuoto o cerca scaffale..."
                  options={locations.filter(l => !l.pallet_code).map(l => ({ value: l.barcode, label: l.barcode }))}
                  value={editModal.newLocation ? { value: editModal.newLocation, label: editModal.newLocation } : null}
                  onChange={val => setEditModal({...editModal, newLocation: val ? val.value.toUpperCase() : ''})}
                  formatCreateLabel={(val) => `Forza posizione: "${val.toUpperCase()}"`}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 font-bold mb-1 text-xs uppercase tracking-wider">Paletta Cliente</label>
                  <input value={editModal.client_pallet_number} onChange={e => setEditModal({...editModal, client_pallet_number: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 focus:ring-brand-blue" />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-1 text-xs uppercase tracking-wider">Articolo Cliente</label>
                  <input value={editModal.client_article_number} onChange={e => setEditModal({...editModal, client_article_number: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 focus:ring-brand-blue" />
                </div>
              </div>
              <div>
                <label className="block text-slate-400 font-bold mb-1 text-xs uppercase tracking-wider">Scadenza</label>
                <input type="date" value={editModal.expiration_date} onChange={e => setEditModal({...editModal, expiration_date: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 focus:ring-brand-blue [color-scheme:dark]" />
              </div>
              <div>
                <label className="block text-slate-400 font-bold mb-1 text-xs uppercase tracking-wider">Note Paletta</label>
                <textarea value={editModal.notes} onChange={e => setEditModal({...editModal, notes: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 focus:ring-brand-blue resize-none h-16"></textarea>
              </div>
              <div className="flex gap-4 mt-6 pt-6 border-t border-slate-800/80">
                <button type="button" onClick={() => setEditModal({ show: false, pallet: null, newLocation: '', notes: '', client_pallet_number: '', client_article_number: '', error: null })} className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-xl font-bold transition-colors">Annulla</button>
                <button type="submit" disabled={isProcessing} className="flex-1 py-3 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-xl font-bold transition-colors shadow-[0_0_20px_rgba(14,165,233,0.3)] disabled:opacity-50">Aggiorna</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {historyModal && historyData && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-brand-black/90 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-lg w-full shadow-2xl relative animate-fade-in-up">
            <button onClick={() => setHistoryModal(null)} className="absolute top-6 right-6 text-slate-500 hover:text-brand-white transition-colors"><XCircle size={24} /></button>
            <h2 className="text-2xl font-bold text-brand-white mb-4">Storia Paletta</h2>
            <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-slate-700 before:to-transparent">
              {historyData.history.map((h, i) => (
                <div key={h.id} className="relative flex items-center justify-between group">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-slate-900 bg-brand-blue text-brand-black shadow shrink-0 z-10 relative">
                    {i === 0 ? <CheckCircle size={16} /> : <Activity size={16} />}
                  </div>
                  <div className="w-[calc(100%-4rem)] p-4 rounded-xl border border-slate-800 bg-slate-950 shadow z-10 relative">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-xs uppercase tracking-wider text-slate-400">{h.action}</span>
                      <time className="font-mono text-brand-blue text-xs">{new Date(h.created_at).toLocaleString()}</time>
                    </div>
                    <div className="text-brand-white text-sm font-medium mb-3">{h.details}</div>
                    <div className="flex gap-2">
                      <div className="text-slate-500 text-xs flex items-center gap-1 bg-slate-900 px-2 py-1 rounded border border-slate-800"><User size={12}/> {h.username}</div>
                      <div className="text-slate-500 text-xs flex items-center gap-1 bg-slate-900 px-2 py-1 rounded border border-slate-800"><Monitor size={12}/> {h.source}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {printModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-md w-full shadow-2xl relative animate-fade-in-up">
            <h2 className="text-xl font-bold text-brand-white mb-6 flex items-center gap-2">
              <Printer className="text-brand-blue" size={24} /> Opzioni Stampa
            </h2>
            <div className="space-y-6">
              <div>
                <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Codice Paletta</label>
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 font-mono text-brand-blue font-bold text-center">
                  {printModal.code}
                </div>
              </div>
              
              <div>
                <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Formato Carta</label>
                <div className="flex gap-4">
                  <label className={`flex-1 flex items-center justify-center p-3 rounded-xl border-2 cursor-pointer transition-all ${printModal.format === 'THERMAL' ? 'border-brand-blue bg-brand-blue/10' : 'border-slate-800 bg-slate-950'}`}>
                    <input type="radio" className="hidden" checked={printModal.format === 'THERMAL'} onChange={() => setPrintModal({...printModal, format: 'THERMAL'})} />
                    <span className={`font-bold text-sm ${printModal.format === 'THERMAL' ? 'text-brand-blue' : 'text-slate-500'}`}>Zebra (10x15)</span>
                  </label>
                  <label className={`flex-1 flex items-center justify-center p-3 rounded-xl border-2 cursor-pointer transition-all ${printModal.format === 'A4' ? 'border-brand-blue bg-brand-blue/10' : 'border-slate-800 bg-slate-950'}`}>
                    <input type="radio" className="hidden" checked={printModal.format === 'A4'} onChange={() => setPrintModal({...printModal, format: 'A4'})} />
                    <span className={`font-bold text-sm ${printModal.format === 'A4' ? 'text-brand-blue' : 'text-slate-500'}`}>A4 (Griglia)</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Moltiplicatore (Copie)</label>
                <input type="number" min="1" max="100" value={printModal.copies} onChange={e => setPrintModal({...printModal, copies: parseInt(e.target.value) || 1})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 focus:ring-brand-blue text-center font-bold text-lg" />
              </div>

              <div className="flex gap-4 border-t border-slate-800/80 pt-6">
                <button onClick={() => setPrintModal({ show: false, code: '', copies: 1, format: 'THERMAL' })} className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-xl font-bold transition-colors">
                  Annulla
                </button>
                <button onClick={() => {
                  window.open(`http://${window.location.hostname}:3000/api/pallets/${printModal.code}/print?token=${getToken()}&format=${printModal.format}&copies=${printModal.copies}`, '_blank');
                  setPrintModal({ show: false, code: '', copies: 1, format: 'THERMAL' });
                }} className="flex-1 py-3 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-xl font-bold transition-colors flex justify-center items-center gap-2">
                  <Printer size={18} /> Stampa
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteConfirmModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-md w-full shadow-2xl relative animate-fade-in-up">
            <h2 className="text-xl font-bold text-rose-500 mb-4 flex items-center gap-2">
              <Trash2 size={24} /> Conferma Eliminazione
            </h2>
            <p className="text-brand-white font-medium mb-6">{deleteConfirmModal.title}</p>
            <p className="text-slate-400 text-sm mb-8">Questa operazione è irreversibile e sarà registrata negli Audit Logs del sistema.</p>
            <div className="flex gap-4 border-t border-slate-800/80 pt-6">
              <button onClick={() => setDeleteConfirmModal({ show: false, type: null, id: null, title: '' })} className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-xl font-bold transition-colors">
                Annulla
              </button>
              <button onClick={confirmDeleteAction} disabled={isProcessing} className="flex-1 py-3 bg-rose-500 hover:bg-rose-400 text-brand-black rounded-xl font-bold transition-colors shadow-[0_0_20px_rgba(244,63,94,0.3)] disabled:opacity-50 flex justify-center items-center gap-2">
                {isProcessing ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                Elimina
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductsManagement;
