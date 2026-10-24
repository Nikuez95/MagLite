import { appAlert, appConfirm, appConfirmThreeWay, appPrompt } from "../../utils/alerts.js";
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Package, Plus, Search, Filter, MapPin, XCircle, CheckCircle, Activity,
  User, Monitor, Loader2, Trash2, Edit3, Printer, Clock, AlertTriangle,
  Calendar, ArrowUpDown, ShieldCheck, RotateCcw, Flame, X, Layers, ExternalLink
} from 'lucide-react';
import { io } from 'socket.io-client';
import CreatableSelect from 'react-select/creatable';
import Select from 'react-select';

const formatUOM = (uom) => {
  const u = (uom || '').toLowerCase();
  if (u.includes('bancal')) return 'Bancali';
  if (u === 'kg') return 'KG';
  if (u.includes('metr')) return 'Metri Cubi';
  if (u === 'scatole') return 'Scatole';
  if (u === 'pezzi') return 'Pezzi';
  return uom;
};

const formatQuantity = (qty, uom) => {
  const q = parseFloat(qty || 0);
  const u = (uom || '').toLowerCase();
  if (u.includes('pezzi') || u.includes('scatole') || u.includes('bancal')) {
    return q.toFixed(0);
  }
  return q.toFixed(2);
};

const formatPalletCode = (code) => {
  if (!code) return '';
  const parts = code.split('-');
  if (parts.length >= 3) {
    return parts.slice(2).join('-');
  }
  return code;
};

const formatDurationText = (days, unit = 'days') => {
  const absDays = Math.abs(days);
  if (unit === 'months') {
    if (absDays < 30) {
      return `${absDays} gg`;
    }
    const months = Math.floor(absDays / 30);
    const remDays = absDays % 30;
    const mLabel = months === 1 ? 'mese' : 'mesi';
    return remDays > 0 ? `${months} ${mLabel} e ${remDays} gg` : `${months} ${mLabel}`;
  }
  return `${absDays} gg`;
};

const getWarningThresholdDays = (val, unit = 'days') => {
  const num = Math.max(0, parseFloat(val) || 0);
  if (unit === 'months') {
    if (num === 12) return 365;
    return Math.round(num * 30);
  }
  return Math.round(num);
};

const getExpirationStatus = (expDate, warningValue, warningUnit = 'days') => {
  if (!expDate) {
    return {
      category: 'NO_EXP',
      diffDays: null,
      color: 'text-slate-400',
      label: 'SENZA SCADENZA',
      secondaryLabel: '',
      bg: 'bg-slate-800/40 border-slate-700/50',
      barColor: 'bg-slate-600',
      progress: 0
    };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expDate);
  if (isNaN(exp.getTime())) {
    return {
      category: 'NO_EXP',
      diffDays: null,
      color: 'text-slate-400',
      label: 'SENZA SCADENZA',
      secondaryLabel: '',
      bg: 'bg-slate-800/40 border-slate-700/50',
      barColor: 'bg-slate-600',
      progress: 0
    };
  }
  exp.setHours(0, 0, 0, 0);

  const diffTime = exp - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const thresholdDays = getWarningThresholdDays(warningValue, warningUnit);

  const primaryDuration = formatDurationText(diffDays, warningUnit);
  const altDuration = warningUnit === 'months'
    ? `${Math.abs(diffDays)} gg`
    : (Math.abs(diffDays) >= 30 ? `~${(Math.abs(diffDays) / 30).toFixed(1).replace('.0', '')} mesi` : '');

  if (diffDays < 0) {
    return {
      category: 'EXPIRED',
      diffDays,
      color: 'text-rose-400',
      label: `SCADUTO DA ${primaryDuration.toUpperCase()}`,
      secondaryLabel: altDuration ? `(${altDuration})` : '',
      bg: 'bg-rose-500/15 border-rose-500/40 shadow-[0_0_12px_rgba(244,63,94,0.12)]',
      barColor: 'bg-rose-500',
      progress: 100
    };
  }
  if (diffDays === 0) {
    return {
      category: 'WARNING',
      diffDays: 0,
      color: 'text-rose-400',
      label: 'SCADE OGGI!',
      secondaryLabel: '',
      bg: 'bg-rose-500/20 border-rose-500/50 shadow-[0_0_12px_rgba(244,63,94,0.2)]',
      barColor: 'bg-rose-500',
      progress: 8
    };
  }
  if (diffDays <= thresholdDays) {
    const pct = thresholdDays > 0 ? Math.max(10, Math.min(100, Math.round((diffDays / thresholdDays) * 100))) : 15;
    return {
      category: 'WARNING',
      diffDays,
      color: 'text-amber-400',
      label: `SCADE TRA ${primaryDuration.toUpperCase()}`,
      secondaryLabel: altDuration ? `(${altDuration})` : '',
      bg: 'bg-amber-500/15 border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.1)]',
      barColor: 'bg-amber-500',
      progress: pct
    };
  }
  const safePct = Math.min(100, Math.max(35, Math.round((diffDays / Math.max(thresholdDays * 3, 365)) * 100)));
  return {
    category: 'SAFE',
    diffDays,
    color: 'text-emerald-400',
    label: `Valido (+${primaryDuration})`,
    secondaryLabel: altDuration ? `(${altDuration})` : '',
    bg: 'bg-emerald-500/10 border-emerald-500/30',
    barColor: 'bg-emerald-500',
    progress: safePct
  };
};


const Pagination = ({ currentPage, totalPages, onPageChange, itemsPerPage, onItemsPerPageChange, totalItems }) => {
  if (totalItems === 0) return null;
  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
      pages.push(i);
    } else if (i === currentPage - 3 || i === currentPage + 3) {
      pages.push('...');
    }
  }
  const uniquePages = pages.filter((p, index) => pages.indexOf(p) === index);

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-slate-800 bg-slate-950/40">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span>Mostra</span>
        <select
          value={itemsPerPage}
          onChange={e => onItemsPerPageChange(Number(e.target.value))}
          className="bg-slate-900 border border-slate-700 text-brand-white font-bold rounded-lg px-2 py-1 focus:border-brand-blue"
        >
          {[10, 25, 50, 100].map(n => (
            <option key={n} value={n}>{n} righe</option>
          ))}
        </select>
        <span>su <strong className="text-brand-white">{totalItems}</strong> risultati</span>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1.5">
          <button onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1} className="px-3 py-1.5 bg-slate-900 border border-slate-700 text-slate-400 text-xs font-bold rounded-lg disabled:opacity-40 hover:bg-slate-800 transition-colors">Prec</button>
          {uniquePages.map((p, idx) => (
            <button key={idx} onClick={() => p !== '...' && onPageChange(p)} disabled={p === '...'} className={`px-3 py-1.5 text-xs border rounded-lg transition-colors ${p === currentPage ? 'bg-brand-blue text-brand-black border-brand-blue font-black shadow-md' : p === '...' ? 'bg-transparent border-transparent text-slate-500' : 'bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white'}`}>{p}</button>
          ))}
          <button onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages} className="px-3 py-1.5 bg-slate-900 border border-slate-700 text-slate-400 text-xs font-bold rounded-lg disabled:opacity-40 hover:bg-slate-800 transition-colors">Succ</button>
        </div>
      )}
    </div>
  );
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
    placeholder: base => ({ ...base, color: '#475569' }),
    multiValue: base => ({ ...base, backgroundColor: '#1e293b', borderRadius: '0.375rem', border: '1px solid #334155' }),
    multiValueLabel: base => ({ ...base, color: '#38bdf8', fontWeight: 'bold', fontSize: '0.75rem', textTransform: 'uppercase' }),
    multiValueRemove: base => ({ ...base, color: '#94a3b8', ':hover': { backgroundColor: '#f43f5e', color: '#fff' } })
  };

  const [activeTab, setActiveTab] = useState('pallets'); // 'pallets' o 'products'
  const [pallets, setPallets] = useState([]);
  const [selectedPallets, setSelectedPallets] = useState([]);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [freeLocations, setFreeLocations] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newProduct, setNewProduct] = useState({ sku: '', name: '', uom: 'Scatole', units_per_box: 1, boxes_per_pallet: 1, customer_id: '', notes: '', default_article_number: '', flags: [] });
  const [editProductModal, setEditProductModal] = useState({ show: false, product: null });
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCustomer, setFilterCustomer] = useState('ALL');
  const [filterWarehouse, setFilterWarehouse] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL'); // 'ALL' | 'PENDING' | 'STOCKED' | 'LOADING_ZONE'
  const [productStockFilter, setProductStockFilter] = useState('ALL'); // 'ALL' | 'IN_STOCK' | 'OUT_OF_STOCK'
  const [expirationWarningValue, setExpirationWarningValue] = useState(60);
  const [warningUnit, setWarningUnit] = useState('days'); // 'days' | 'months'
  const [filterExpCategory, setFilterExpCategory] = useState('ALL'); // 'ALL' | 'EXPIRED' | 'WARNING' | 'WARNING_AND_EXPIRED' | 'SAFE' | 'NO_EXP'
  const [dateFilterMode, setDateFilterMode] = useState('EXPIRATION'); // 'EXPIRATION' | 'ARRIVAL'
  const [sortBy, setSortBy] = useState('ARRIVAL_DESC'); // 'ARRIVAL_DESC' | 'EXP_ASC' | 'EXP_DESC'

  const handleToggleWarningUnit = (newUnit) => {
    if (newUnit === warningUnit) return;
    if (newUnit === 'months') {
      const converted = Math.max(1, Math.round((parseFloat(expirationWarningValue) || 30) / 30));
      setExpirationWarningValue(converted);
    } else {
      const converted = Math.max(1, Math.round((parseFloat(expirationWarningValue) || 1) * 30));
      setExpirationWarningValue(converted);
    }
    setWarningUnit(newUnit);
  };
  
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
  
  // Modifica Quantità Paletta
  const [adjustQtyModal, setAdjustQtyModal] = useState({
    show: false,
    pallet: null,
    newQuantity: '',
    error: null
  });
  
  const [historyModal, setHistoryModal] = useState(null);
  const [historyData, setHistoryData] = useState(null);

  const [printModal, setPrintModal] = useState({ show: false, code: '', copies: 1, format: 'A4', isBulk: false });

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
  const canManageProducts = user?.role === 'developer' || user?.role === 'backoffice' || user?.role === 'admin';

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
      const payload = {
        ...newProduct,
        flags: newProduct.flags ? newProduct.flags.map(f => f.value) : []
      };
      await axios.post(`http://${window.location.hostname}:3000/api/products`, payload, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setShowAddModal(false);
      setNewProduct({ sku: '', name: '', uom: 'Scatole', units_per_box: 1, boxes_per_pallet: 1, customer_id: '', notes: '', default_article_number: '', flags: [] });
      fetchData();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpdateProduct = async (e) => {
    e.preventDefault();
    if (isProcessing) return;
    
    const originalFlagsStr = JSON.stringify(editProductModal.product.original_flags || []);
    const currentFlags = editProductModal.product.flags ? editProductModal.product.flags.map(f => f.value) : [];
    const currentFlagsStr = JSON.stringify(currentFlags);
    
    let updateExistingPallets = false;
    
    if (originalFlagsStr !== currentFlagsStr) {
      const choice = await appConfirmThreeWay(
        "I Flag di questo prodotto sono stati modificati.\nCome vuoi procedere con i bancali già in magazzino?",
        "Aggiornamento Flag",
        "Applica a tutto",
        "Da ora in poi",
        "Annulla Operazione"
      );
      if (choice === 'CANCEL') {
        setIsProcessing(false);
        return;
      }
      updateExistingPallets = (choice === 'CONFIRM');
    }
    
    setIsProcessing(true);
    try {
      const payload = {
        ...editProductModal.product,
        flags: currentFlags,
        updateExistingPallets
      };
      await axios.put(`http://${window.location.hostname}:3000/api/products/${editProductModal.product.id}`, payload, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setEditProductModal({ show: false, product: null });
      fetchData();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore');
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
      appAlert(err.response?.data?.error || 'Impossibile eliminare (in uso?)');
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

  const toggleSelect = (id) => {
    setSelectedPallets(prev => 
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    const visibleIds = currentPallets.map(p => p.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedPallets.includes(id));
    if (allVisibleSelected) {
      setSelectedPallets(prev => prev.filter(id => !visibleIds.includes(id)));
    } else {
      setSelectedPallets(prev => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const handlePrintBulk = () => { if (selectedPallets.length === 0) return; setPrintModal({ show: true, isBulk: true, format: "A4", copies: 1, code: "" }); };

  const handleAdjustQty = async (e) => {
    e.preventDefault();
    if (isProcessing) return;
    setIsProcessing(true);
    setAdjustQtyModal(prev => ({ ...prev, error: null }));
    const qty = parseFloat(adjustQtyModal.newQuantity);
    if (isNaN(qty) || qty < 0) {
      setAdjustQtyModal(prev => ({ ...prev, error: 'Inserisci una quantità numerica valida (>= 0)' }));
      setIsProcessing(false);
      return;
    }
    try {
      await axios.put(`http://${window.location.hostname}:3000/api/pallets/${adjustQtyModal.pallet.pallet_code}/quantity`, {
        pallet_id: adjustQtyModal.pallet.id,
        quantity: qty
      }, { headers: { Authorization: `Bearer ${getToken()}` } });
      
      setAdjustQtyModal({ show: false, pallet: null, newQuantity: '', error: null });
      fetchData();
    } catch (err) {
      setAdjustQtyModal(prev => ({ ...prev, error: err.response?.data?.error || 'Errore modifica quantità' }));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpdatePallet = async (e) => {
    e.preventDefault();
    if (isProcessing) return;
    setIsProcessing(true);
    setEditModal(prev => ({ ...prev, error: null }));
    try {
      await axios.put(`http://${window.location.hostname}:3000/api/pallets/${editModal.pallet.pallet_code}`, {
        notes: editModal.notes,
        client_pallet_number: editModal.client_pallet_number,
        client_article_number: editModal.client_article_number,
        expiration_date: editModal.expiration_date
      }, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });

      if (editModal.newLocation && editModal.newLocation !== editModal.pallet.location) {
        const locStr = editModal.newLocation.toUpperCase().trim();
        const isMapped = locations.some(l => l.barcode === locStr);
        const isFree = freeLocations.some(fl => fl.name.toUpperCase() === locStr);
        
        if (!isMapped && !isFree) {
          throw { response: { data: { error: 'La posizione inserita non esiste nel sistema. Scegli una posizione valida o crea una zona libera dal Magazzino.' } } };
        }

        let occupiedBy = null;
        if (isMapped) {
          const locObj = locations.find(l => l.barcode === locStr);
          if (locObj && locObj.pallet_code && locObj.pallet_code !== editModal.pallet.pallet_code) {
            occupiedBy = locObj.pallet_code;
          }
        } else {
          const occupyingPallet = pallets.find(p => p.location && p.location.toUpperCase() === locStr && p.pallet_code !== editModal.pallet.pallet_code);
          if (occupyingPallet) {
            occupiedBy = occupyingPallet.pallet_code;
          }
        }

        if (occupiedBy) {
          const choice = await appConfirmThreeWay(
            `La posizione ${locStr} è già occupata dalla paletta ${occupiedBy}. Come vuoi procedere?`,
            'Posizione Occupata',
            'Frammenta',
            'Forza comunque',
            'Annulla'
          );
          if (choice === 'CONFIRM') {
            await axios.post(`http://${window.location.hostname}:3000/api/pallets/merge`, {
              source_code: editModal.pallet.pallet_code,
              target_code: occupiedBy
            }, { headers: { Authorization: `Bearer ${getToken()}` } });
          } else if (choice === 'DENY') {
            await axios.post(`http://${window.location.hostname}:3000/api/pallets/stow`, {
              pallet_code: editModal.pallet.pallet_code,
              location: locStr,
              source: 'Gestionale',
              force: true
            }, { headers: { Authorization: `Bearer ${getToken()}` } });
          } else {
            setIsProcessing(false);
            return;
          }
        } else {
          await axios.post(`http://${window.location.hostname}:3000/api/pallets/stow`, {
            pallet_code: editModal.pallet.pallet_code,
            location: locStr,
            source: 'Gestionale'
          }, { headers: { Authorization: `Bearer ${getToken()}` } });
        }
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

  // Paginazione
  const [palletsCurrentPage, setPalletsCurrentPage] = useState(1);
  const [productsCurrentPage, setProductsCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  useEffect(() => {
    setPalletsCurrentPage(1);
    setProductsCurrentPage(1);
  }, [searchTerm, filterCustomer, filterWarehouse, filterStatus, productStockFilter, filterStartDate, filterEndDate, filterExpCategory, dateFilterMode, expirationWarningValue, warningUnit, sortBy, itemsPerPage]);

  const loadingZoneCount = React.useMemo(() => {
    return pallets.filter(p => String(p.location || '').startsWith('ZONA CARICO')).length;
  }, [pallets]);

  // Filtro base (ricerca, cliente, magazzino, stato, range date)
  const baseFilteredPallets = React.useMemo(() => {
    return pallets.filter(p => {
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
      const matchCustomer = filterCustomer === 'ALL' || String(p.customer_id) === String(filterCustomer);
      const matchWarehouse = filterWarehouse === 'ALL' || p.warehouse === filterWarehouse;

      let matchStatus = true;
      if (filterStatus === 'PENDING') {
        matchStatus = p.status === 'PENDING';
      } else if (filterStatus === 'STOCKED') {
        matchStatus = p.status === 'STOCKED' && !String(p.location || '').startsWith('ZONA CARICO');
      } else if (filterStatus === 'LOADING_ZONE') {
        matchStatus = String(p.location || '').startsWith('ZONA CARICO');
      }
      
      let matchDate = true;
      if (filterStartDate || filterEndDate) {
        const rawTargetDate = dateFilterMode === 'EXPIRATION' ? p.expiration_date : p.created_at;
        if (!rawTargetDate) {
          matchDate = false;
        } else {
          const pDate = new Date(rawTargetDate);
          if (isNaN(pDate.getTime())) {
            matchDate = false;
          } else {
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
        }
      }

      return matchSearch && matchCustomer && matchWarehouse && matchStatus && matchDate;
    });
  }, [pallets, searchTerm, filterCustomer, filterWarehouse, filterStatus, filterStartDate, filterEndDate, dateFilterMode]);

  // Statistiche in tempo reale sulle categorie di scadenza
  const expStats = React.useMemo(() => {
    const stats = {
      ALL: { count: baseFilteredPallets.length, qty: 0 },
      EXPIRED: { count: 0, qty: 0 },
      WARNING: { count: 0, qty: 0 },
      SAFE: { count: 0, qty: 0 },
      NO_EXP: { count: 0, qty: 0 }
    };
    baseFilteredPallets.forEach(p => {
      const q = parseFloat(p.quantity) || 0;
      stats.ALL.qty += q;
      const st = getExpirationStatus(p.expiration_date, expirationWarningValue, warningUnit);
      if (stats[st.category]) {
        stats[st.category].count += 1;
        stats[st.category].qty += q;
      }
    });
    return stats;
  }, [baseFilteredPallets, expirationWarningValue, warningUnit]);

  const filteredPallets = React.useMemo(() => {
    const list = baseFilteredPallets.filter(p => {
      if (filterExpCategory === 'ALL') return true;
      const st = getExpirationStatus(p.expiration_date, expirationWarningValue, warningUnit);
      if (filterExpCategory === 'WARNING_AND_EXPIRED') {
        return st.category === 'WARNING' || st.category === 'EXPIRED';
      }
      return st.category === filterExpCategory;
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'EXP_ASC') {
        if (!a.expiration_date && !b.expiration_date) return 0;
        if (!a.expiration_date) return 1;
        if (!b.expiration_date) return -1;
        return new Date(a.expiration_date) - new Date(b.expiration_date);
      }
      if (sortBy === 'EXP_DESC') {
        if (!a.expiration_date && !b.expiration_date) return 0;
        if (!a.expiration_date) return 1;
        if (!b.expiration_date) return -1;
        return new Date(b.expiration_date) - new Date(a.expiration_date);
      }
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }, [baseFilteredPallets, filterExpCategory, expirationWarningValue, warningUnit, sortBy]);

  const hasActiveFilters = searchTerm !== '' || filterCustomer !== 'ALL' || filterWarehouse !== 'ALL' || filterStatus !== 'ALL' || productStockFilter !== 'ALL' || filterStartDate !== '' || filterEndDate !== '' || filterExpCategory !== 'ALL' || sortBy !== 'ARRIVAL_DESC';

  const resetAllFilters = () => {
    setSearchTerm('');
    setFilterCustomer('ALL');
    setFilterWarehouse('ALL');
    setFilterStatus('ALL');
    setProductStockFilter('ALL');
    setFilterStartDate('');
    setFilterEndDate('');
    setFilterExpCategory('ALL');
    setSortBy('ARRIVAL_DESC');
  };

  // Mappa delle giacenze per prodotto (per velocizzare e arricchire Anagrafica Prodotti)
  const stockByProduct = React.useMemo(() => {
    const map = new Map();
    pallets.forEach(pal => {
      if (pal.status === 'SHIPPED') return;
      const prev = map.get(pal.product_id) || { totalQty: 0, palletCount: 0 };
      prev.totalQty += parseFloat(pal.quantity || 0);
      prev.palletCount += 1;
      map.set(pal.product_id, prev);
    });
    return map;
  }, [pallets]);

  const filteredProducts = React.useMemo(() => {
    const searchLower = searchTerm.toLowerCase();
    return products.filter(p => {
      if (filterCustomer !== 'ALL' && String(p.customer_id) !== String(filterCustomer)) return false;
      const st = stockByProduct.get(p.id) || { totalQty: 0, palletCount: 0 };
      if (productStockFilter === 'IN_STOCK' && st.totalQty <= 0) return false;
      if (productStockFilter === 'OUT_OF_STOCK' && st.totalQty > 0) return false;

      return p.name.toLowerCase().includes(searchLower) || 
             p.sku.toLowerCase().includes(searchLower) ||
             p.customer_name.toLowerCase().includes(searchLower) ||
             (p.default_article_number && p.default_article_number.toLowerCase().includes(searchLower)) ||
             (p.notes && p.notes.toLowerCase().includes(searchLower));
    });
  }, [products, searchTerm, filterCustomer, productStockFilter, stockByProduct]);

  const availableFlagsOptions = React.useMemo(() => {
    const flagsSet = new Set();
    products.forEach(p => {
      const pf = typeof p.flags === 'string' ? JSON.parse(p.flags) : (p.flags || []);
      if (Array.isArray(pf)) pf.forEach(f => flagsSet.add(f));
    });
    pallets.forEach(p => {
      const pf = typeof p.flags === 'string' ? JSON.parse(p.flags) : (p.flags || []);
      if (Array.isArray(pf)) pf.forEach(f => flagsSet.add(f));
    });
    return Array.from(flagsSet).map(f => ({ label: f, value: f }));
  }, [products, pallets]);

  const indexOfLastPallet = palletsCurrentPage * itemsPerPage;
  const indexOfFirstPallet = indexOfLastPallet - itemsPerPage;
  const currentPallets = filteredPallets.slice(indexOfFirstPallet, indexOfLastPallet);
  const totalPalletPages = Math.ceil(filteredPallets.length / itemsPerPage);

  const indexOfLastProduct = productsCurrentPage * itemsPerPage;
  const indexOfFirstProduct = indexOfLastProduct - itemsPerPage;
  const currentProducts = filteredProducts.slice(indexOfFirstProduct, indexOfLastProduct);
  const totalProductPages = Math.ceil(filteredProducts.length / itemsPerPage);

  return (
    <div className="flex-1 overflow-y-auto bg-brand-black">
      <div className="max-w-7xl mx-auto animate-fade-in-up">
        
        {/* Header + Switch Tab Moderno */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-black text-brand-white mb-1 flex items-center gap-3">
              <Package className="text-brand-blue" size={32} />
              Stock & Anagrafica Prodotti
            </h1>
            <p className="text-slate-400 text-sm">Inventario fisico per paletta in tempo reale, monitoraggio scadenze e catalogo referenze.</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Switch Tabs con Contatori Live */}
            <div className="flex bg-slate-900 p-1.5 rounded-2xl border border-slate-800">
              <button
                onClick={() => setActiveTab('pallets')}
                className={`px-4 py-2 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${
                  activeTab === 'pallets'
                    ? 'bg-brand-blue text-brand-black shadow-lg'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Layers size={16} />
                Stock Palette
                <span className={`px-2 py-0.5 rounded-full text-xs font-black ${activeTab === 'pallets' ? 'bg-brand-black/20 text-brand-black' : 'bg-slate-800 text-slate-300'}`}>
                  {filteredPallets.length}
                </span>
              </button>
              <button
                onClick={() => setActiveTab('products')}
                className={`px-4 py-2 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${
                  activeTab === 'products'
                    ? 'bg-brand-blue text-brand-black shadow-lg'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Package size={16} />
                Anagrafica Prodotti
                <span className={`px-2 py-0.5 rounded-full text-xs font-black ${activeTab === 'products' ? 'bg-brand-black/20 text-brand-black' : 'bg-slate-800 text-slate-300'}`}>
                  {filteredProducts.length}
                </span>
              </button>
            </div>

            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-brand-blue text-brand-black font-black text-sm rounded-xl hover:bg-sky-400 transition-all shadow-[0_0_20px_rgba(14,165,233,0.25)] active:scale-95"
            >
              <Plus size={18} /> Nuova Referenza
            </button>
          </div>
        </div>

        {/* 5 Card KPI Scadenze (Solo su Stock Palette) */}
        {activeTab === 'pallets' && (
          <div className="mb-6 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {/* Card 1: Tutti */}
              <button
                type="button"
                onClick={() => setFilterExpCategory('ALL')}
                className={`text-left p-4 rounded-2xl border transition-all relative overflow-hidden ${
                  filterExpCategory === 'ALL'
                    ? 'bg-slate-900 border-brand-blue shadow-[0_0_20px_rgba(14,165,233,0.15)]'
                    : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Totale Stock</span>
                  <Package size={16} className="text-brand-blue" />
                </div>
                <div className="text-2xl font-black text-brand-white">{expStats.ALL.count}</div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {expStats.ALL.qty.toLocaleString('it-IT')} unità complessive
                </div>
                {expStats.ALL.count > 0 && (
                  <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden flex mt-2.5">
                    <div style={{ width: `${(expStats.EXPIRED.count / expStats.ALL.count) * 100}%` }} className="bg-rose-500 h-full" title={`Scaduti: ${expStats.EXPIRED.count}`} />
                    <div style={{ width: `${(expStats.WARNING.count / expStats.ALL.count) * 100}%` }} className="bg-amber-500 h-full" title={`In avviso: ${expStats.WARNING.count}`} />
                    <div style={{ width: `${(expStats.SAFE.count / expStats.ALL.count) * 100}%` }} className="bg-emerald-500 h-full" title={`Lunga scadenza: ${expStats.SAFE.count}`} />
                    <div style={{ width: `${(expStats.NO_EXP.count / expStats.ALL.count) * 100}%` }} className="bg-slate-600 h-full" title={`Senza scadenza: ${expStats.NO_EXP.count}`} />
                  </div>
                )}
              </button>

              {/* Card 2: Scaduti */}
              <button
                type="button"
                onClick={() => {
                  const next = filterExpCategory === 'EXPIRED' ? 'ALL' : 'EXPIRED';
                  setFilterExpCategory(next);
                  if (next === 'EXPIRED') setSortBy('EXP_ASC');
                }}
                className={`text-left p-4 rounded-2xl border transition-all relative overflow-hidden ${
                  filterExpCategory === 'EXPIRED'
                    ? 'bg-rose-950/40 border-rose-500 shadow-[0_0_25px_rgba(244,63,94,0.25)]'
                    : 'bg-slate-900/60 border-slate-800 hover:border-rose-500/50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1.5">
                    {expStats.EXPIRED.count > 0 && <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />}
                    Scaduti
                  </span>
                  <Flame size={16} className="text-rose-500" />
                </div>
                <div className="text-2xl font-black text-rose-400">{expStats.EXPIRED.count}</div>
                <div className="text-[11px] text-rose-300/70 mt-1">
                  {expStats.EXPIRED.count > 0 ? `${expStats.EXPIRED.qty.toLocaleString('it-IT')} u. già scadute` : 'Nessun prodotto scaduto'}
                </div>
              </button>

              {/* Card 3: In Avviso */}
              <button
                type="button"
                onClick={() => {
                  const next = (filterExpCategory === 'WARNING' || filterExpCategory === 'WARNING_AND_EXPIRED') ? 'ALL' : 'WARNING';
                  setFilterExpCategory(next);
                  if (next === 'WARNING') setSortBy('EXP_ASC');
                }}
                className={`text-left p-4 rounded-2xl border transition-all relative overflow-hidden ${
                  filterExpCategory === 'WARNING' || filterExpCategory === 'WARNING_AND_EXPIRED'
                    ? 'bg-amber-950/40 border-amber-500 shadow-[0_0_25px_rgba(245,158,11,0.2)]'
                    : 'bg-slate-900/60 border-slate-800 hover:border-amber-500/50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
                    In Scadenza (≤ {expirationWarningValue} {warningUnit === 'months' ? (expirationWarningValue == 1 ? 'mese' : 'mesi') : 'gg'})
                  </span>
                  <AlertTriangle size={16} className="text-amber-500" />
                </div>
                <div className="text-2xl font-black text-amber-400">{expStats.WARNING.count}</div>
                <div className="text-[11px] text-amber-300/70 mt-1">
                  {expStats.WARNING.count > 0 ? `${expStats.WARNING.qty.toLocaleString('it-IT')} u. in preavviso` : 'Nessuno in preavviso'}
                </div>
              </button>

              {/* Card 4: Lunga Scadenza */}
              <button
                type="button"
                onClick={() => {
                  const next = filterExpCategory === 'SAFE' ? 'ALL' : 'SAFE';
                  setFilterExpCategory(next);
                }}
                className={`text-left p-4 rounded-2xl border transition-all relative overflow-hidden ${
                  filterExpCategory === 'SAFE'
                    ? 'bg-emerald-950/30 border-emerald-500 shadow-[0_0_25px_rgba(16,185,129,0.2)]'
                    : 'bg-slate-900/60 border-slate-800 hover:border-emerald-500/50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                    Lunga Scadenza (&gt; {expirationWarningValue} {warningUnit === 'months' ? 'm' : 'gg'})
                  </span>
                  <ShieldCheck size={16} className="text-emerald-500" />
                </div>
                <div className="text-2xl font-black text-emerald-400">{expStats.SAFE.count}</div>
                <div className="text-[11px] text-emerald-300/70 mt-1">
                  {expStats.SAFE.qty.toLocaleString('it-IT')} u. con ampio margine
                </div>
              </button>

              {/* Card 5: Senza Scadenza */}
              <button
                type="button"
                onClick={() => {
                  const next = filterExpCategory === 'NO_EXP' ? 'ALL' : 'NO_EXP';
                  setFilterExpCategory(next);
                }}
                className={`text-left p-4 rounded-2xl border transition-all relative overflow-hidden ${
                  filterExpCategory === 'NO_EXP'
                    ? 'bg-slate-800 border-slate-400 shadow-lg'
                    : 'bg-slate-900/60 border-slate-800 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Senza Scadenza</span>
                  <Calendar size={16} className="text-slate-500" />
                </div>
                <div className="text-2xl font-black text-slate-300">{expStats.NO_EXP.count}</div>
                <div className="text-[11px] text-slate-500 mt-1">
                  {expStats.NO_EXP.qty.toLocaleString('it-IT')} u. non deperibili
                </div>
              </button>
            </div>
          </div>
        )}

        <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-slate-800 space-y-4">
            {/* Riga 1: Ricerca, Cliente, Magazzino/Giacenza, Stato, Ordinamento, Stampa Bulk */}
            <div className="flex flex-col md:flex-row flex-wrap gap-3 items-stretch md:items-center">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
                <input
                  type="text"
                  placeholder="Ricerca universale (Prodotto, SKU, Lotto, Scaffale, Cliente, Scadenza)..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl pl-10 pr-8 py-2 focus:ring-brand-blue focus:border-brand-blue transition-all text-sm"
                />
                {searchTerm && (
                  <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                    <X size={15} />
                  </button>
                )}
              </div>

              {/* Filtro Cliente (comune ad entrambi i tab) */}
              <div className="w-[190px]">
                <select
                  value={filterCustomer}
                  onChange={e => setFilterCustomer(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-3 py-2 text-xs font-bold focus:border-brand-blue"
                >
                  <option value="ALL">Tutti i clienti</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.business_name}</option>
                  ))}
                </select>
              </div>

              {activeTab === 'products' && (
                <div className="flex bg-slate-950 rounded-xl border border-slate-800 p-1 text-xs font-bold">
                  <button onClick={() => setProductStockFilter('ALL')} className={`px-3 py-1 rounded-lg transition-colors ${productStockFilter === 'ALL' ? 'bg-slate-800 text-brand-white' : 'text-slate-500 hover:text-slate-300'}`}>Tutti</button>
                  <button onClick={() => setProductStockFilter('IN_STOCK')} className={`px-3 py-1 rounded-lg transition-colors ${productStockFilter === 'IN_STOCK' ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-500 hover:text-emerald-400'}`}>In Giacenza</button>
                  <button onClick={() => setProductStockFilter('OUT_OF_STOCK')} className={`px-3 py-1 rounded-lg transition-colors ${productStockFilter === 'OUT_OF_STOCK' ? 'bg-rose-500/20 text-rose-400' : 'text-slate-500 hover:text-rose-400'}`}>Esauriti (0)</button>
                </div>
              )}

              {activeTab === 'pallets' && (
                <>
                  <div className="flex items-center gap-1.5 text-xs font-medium">
                    <div className="flex bg-slate-950 rounded-xl border border-slate-800 p-1">
                      <button onClick={() => setFilterWarehouse('ALL')} className={`px-2.5 py-1 rounded-lg transition-colors ${filterWarehouse === 'ALL' ? 'bg-slate-800 text-brand-white font-bold' : 'text-slate-500 hover:text-slate-300'}`}>Tutti Mag.</button>
                      <button onClick={() => setFilterWarehouse('Settala')} className={`px-2.5 py-1 rounded-lg transition-colors ${filterWarehouse === 'Settala' ? 'bg-brand-blue text-brand-black font-bold' : 'text-slate-500 hover:text-brand-blue'}`}>Settala</button>
                      <button onClick={() => setFilterWarehouse('Caleppio')} className={`px-2.5 py-1 rounded-lg transition-colors ${filterWarehouse === 'Caleppio' ? 'bg-amber-500 text-brand-black font-bold' : 'text-slate-500 hover:text-amber-500'}`}>Caleppio</button>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs font-medium">
                    <div className="flex bg-slate-950 rounded-xl border border-slate-800 p-1">
                      <button onClick={() => setFilterStatus('ALL')} className={`px-2.5 py-1 rounded-lg transition-colors ${filterStatus === 'ALL' ? 'bg-slate-800 text-brand-white font-bold' : 'text-slate-500 hover:text-slate-300'}`}>Tutti Stati</button>
                      <button onClick={() => setFilterStatus('PENDING')} className={`px-2.5 py-1 rounded-lg transition-colors ${filterStatus === 'PENDING' ? 'bg-slate-700 text-white font-bold' : 'text-slate-500 hover:text-slate-300'}`}>In Attesa</button>
                      <button onClick={() => setFilterStatus('STOCKED')} className={`px-2.5 py-1 rounded-lg transition-colors ${filterStatus === 'STOCKED' ? 'bg-green-500/20 text-green-400 font-bold' : 'text-slate-500 hover:text-green-400'}`}>A Scaffale</button>
                      {loadingZoneCount > 0 && (
                        <button onClick={() => setFilterStatus('LOADING_ZONE')} className={`px-2.5 py-1 rounded-lg transition-colors ${filterStatus === 'LOADING_ZONE' ? 'bg-amber-500/25 text-amber-300 font-bold' : 'text-amber-400/70 hover:text-amber-300'}`}>
                          Zona Carico ({loadingZoneCount})
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs font-medium">
                    <ArrowUpDown size={14} className="text-brand-blue" />
                    <select
                      value={sortBy}
                      onChange={e => setSortBy(e.target.value)}
                      className="bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-2.5 py-1.5 font-semibold focus:border-brand-blue"
                    >
                      <option value="ARRIVAL_DESC">Ordina: Arrivo (Più recenti)</option>
                      <option value="EXP_ASC">Ordina: Scadenza ↑ (FEFO - Più urgenti)</option>
                      <option value="EXP_DESC">Ordina: Scadenza ↓ (Più lontane)</option>
                    </select>
                  </div>
                </>
              )}

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetAllFilters}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-xl text-xs font-bold transition-colors"
                  title="Azzera tutti i filtri"
                >
                  <RotateCcw size={13} /> Reset
                </button>
              )}

              {activeTab === 'pallets' && selectedPallets.length > 0 && (
                <div className="flex items-center gap-2">
                  {selectedPallets.length < filteredPallets.length && (
                    <button
                      type="button"
                      onClick={() => setSelectedPallets(filteredPallets.map(p => p.id))}
                      className="px-3 py-2 bg-slate-950 border border-slate-700 hover:border-brand-blue text-slate-300 rounded-xl text-xs font-bold transition-colors"
                    >
                      Seleziona tutte ({filteredPallets.length})
                    </button>
                  )}
                  <button
                    onClick={handlePrintBulk}
                    className="flex items-center gap-2 px-4 py-2 bg-brand-blue text-brand-black font-black rounded-xl hover:bg-sky-400 transition-all shadow-[0_0_20px_rgba(14,165,233,0.2)] active:scale-95 text-xs"
                  >
                    <Printer size={15} /> Stampa {selectedPallets.length} Etichett{selectedPallets.length === 1 ? 'a' : 'e'}
                  </button>
                </div>
              )}
            </div>

            {/* Riga 2 (solo Stock Palette): Controllo Scadenze Avanzato */}
            {activeTab === 'pallets' && (
              <div className="pt-3 border-t border-slate-800/80 flex flex-col lg:flex-row flex-wrap items-start lg:items-center justify-between gap-4 bg-slate-950/40 -mx-4 -mb-4 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
                  <Calendar size={15} className="text-brand-blue" />
                  <div className="flex bg-slate-950 rounded-lg border border-slate-800 p-0.5">
                    <button
                      type="button"
                      onClick={() => setDateFilterMode('EXPIRATION')}
                      className={`px-2.5 py-1 rounded-md transition-colors font-bold ${
                        dateFilterMode === 'EXPIRATION' ? 'bg-brand-blue text-brand-black' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Data Scadenza
                    </button>
                    <button
                      type="button"
                      onClick={() => setDateFilterMode('ARRIVAL')}
                      className={`px-2.5 py-1 rounded-md transition-colors font-bold ${
                        dateFilterMode === 'ARRIVAL' ? 'bg-brand-blue text-brand-black' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Data Arrivo
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400">Dal:</span>
                    <input
                      type="date"
                      value={filterStartDate}
                      onChange={e => setFilterStartDate(e.target.value)}
                      className="w-[125px] bg-slate-950 border border-slate-800 text-brand-white rounded-lg px-2 py-1 focus:ring-brand-blue [color-scheme:dark]"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400">Al:</span>
                    <input
                      type="date"
                      value={filterEndDate}
                      onChange={e => setFilterEndDate(e.target.value)}
                      className="w-[125px] bg-slate-950 border border-slate-800 text-brand-white rounded-lg px-2 py-1 focus:ring-brand-blue [color-scheme:dark]"
                    />
                  </div>
                  {(filterStartDate || filterEndDate) && (
                    <button
                      type="button"
                      onClick={() => { setFilterStartDate(''); setFilterEndDate(''); }}
                      className="text-rose-400 hover:text-rose-300 font-bold px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/20"
                    >
                      ✕ Pulisci date
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs font-medium">
                  <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5">
                    <Clock size={15} className="text-amber-500 shrink-0" />
                    <span className="text-slate-300 font-bold">Preavviso Scadenza:</span>
                    <input
                      type="number"
                      min="1"
                      onWheel={(e) => e.target.blur()}
                      value={expirationWarningValue}
                      onChange={e => setExpirationWarningValue(Math.max(0, parseInt(e.target.value, 10) || 0))}
                      className="w-16 bg-slate-900 border border-slate-700 text-amber-400 font-bold text-center rounded-lg px-2 py-1 focus:ring-amber-500 focus:border-amber-500"
                    />

                    {/* Switch GG / MESI */}
                    <div className="flex bg-slate-900 rounded-lg border border-slate-800 p-0.5">
                      <button
                        type="button"
                        onClick={() => handleToggleWarningUnit('days')}
                        className={`px-2.5 py-1 rounded-md font-bold transition-all ${
                          warningUnit === 'days'
                            ? 'bg-amber-500 text-brand-black shadow'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        GG
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleWarningUnit('months')}
                        className={`px-2.5 py-1 rounded-md font-bold transition-all ${
                          warningUnit === 'months'
                            ? 'bg-amber-500 text-brand-black shadow'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        MESI
                      </button>
                    </div>

                    <div className="hidden xl:flex items-center gap-1 pl-1 border-l border-slate-800">
                      {(warningUnit === 'days' ? [15, 30, 60, 90, 180] : [1, 2, 3, 6, 12]).map(preset => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setExpirationWarningValue(preset)}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${
                            Number(expirationWarningValue) === preset
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                              : 'bg-slate-900 text-slate-500 hover:text-slate-300'
                          }`}
                        >
                          {preset}{warningUnit === 'days' ? 'g' : 'm'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label
                    onClick={() => {
                      const isCurrentlyWarningFilter = filterExpCategory === 'WARNING' || filterExpCategory === 'WARNING_AND_EXPIRED';
                      const next = isCurrentlyWarningFilter ? 'ALL' : 'WARNING';
                      setFilterExpCategory(next);
                      if (next === 'WARNING') setSortBy('EXP_ASC');
                    }}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer select-none transition-all font-bold ${
                      filterExpCategory === 'WARNING' || filterExpCategory === 'WARNING_AND_EXPIRED'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.15)]'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-amber-500/50 hover:text-slate-200'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded flex items-center justify-center border transition-all ${
                      filterExpCategory === 'WARNING' || filterExpCategory === 'WARNING_AND_EXPIRED'
                        ? 'bg-amber-500 border-amber-500 text-brand-black'
                        : 'bg-slate-900 border-slate-700'
                    }`}>
                      {(filterExpCategory === 'WARNING' || filterExpCategory === 'WARNING_AND_EXPIRED') && (
                        <CheckCircle size={12} strokeWidth={3} />
                      )}
                    </div>
                    <span>Mostra solo in avviso ({expStats.WARNING.count})</span>
                  </label>

                  {(filterExpCategory === 'WARNING' || filterExpCategory === 'WARNING_AND_EXPIRED') && (
                    <button
                      type="button"
                      onClick={() => setFilterExpCategory(filterExpCategory === 'WARNING_AND_EXPIRED' ? 'WARNING' : 'WARNING_AND_EXPIRED')}
                      className={`px-2.5 py-2 rounded-xl border text-xs font-bold transition-all ${
                        filterExpCategory === 'WARNING_AND_EXPIRED'
                          ? 'bg-rose-500/20 border-rose-500 text-rose-300'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-rose-400'
                      }`}
                    >
                      {filterExpCategory === 'WARNING_AND_EXPIRED' ? '✓ Scaduti inclusi' : `+ Includi Scaduti (${expStats.EXPIRED.count})`}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap md:whitespace-normal">
              {activeTab === 'pallets' ? (
                <>
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                      <th className="px-3 py-3 w-12 text-center">
                        <div
                          onClick={toggleSelectAll}
                          className={`w-5 h-5 mx-auto rounded border-2 flex items-center justify-center cursor-pointer transition-all ${
                            currentPallets.length > 0 && currentPallets.every(p => selectedPallets.includes(p.id))
                              ? 'bg-brand-blue border-brand-blue'
                              : 'bg-slate-900 border-slate-700 hover:border-brand-blue'
                          }`}
                        >
                          {currentPallets.length > 0 && currentPallets.every(p => selectedPallets.includes(p.id)) && (
                            <CheckCircle size={14} className="text-brand-black" strokeWidth={3} />
                          )}
                        </div>
                      </th>
                      <th className="px-3 py-3 font-semibold uppercase tracking-wider text-xs">Paletta</th>
                      <th className="px-3 py-3 font-semibold uppercase tracking-wider text-xs">Prodotto & Info</th>
                      <th className="px-3 py-3 font-semibold uppercase tracking-wider text-xs text-center">Q.tà</th>
                      <th
                        onClick={() => setSortBy('ARRIVAL_DESC')}
                        className="px-3 py-3 font-semibold uppercase tracking-wider text-xs cursor-pointer hover:text-brand-blue transition-colors"
                        title="Clicca per ordinare per data di arrivo"
                      >
                        Arrivo {sortBy === 'ARRIVAL_DESC' && '↓'}
                      </th>
                      <th
                        onClick={() => setSortBy(sortBy === 'EXP_ASC' ? 'EXP_DESC' : 'EXP_ASC')}
                        className="px-3 py-3 font-semibold uppercase tracking-wider text-xs cursor-pointer hover:text-brand-blue transition-colors select-none"
                        title="Clicca per ordinare per Data di Scadenza (FEFO)"
                      >
                        <span className="inline-flex items-center gap-1">
                          Lotto / Scad
                          <ArrowUpDown size={12} className={sortBy.startsWith('EXP_') ? 'text-brand-blue' : 'text-slate-600'} />
                          {sortBy === 'EXP_ASC' && <span className="text-brand-blue">↑</span>}
                          {sortBy === 'EXP_DESC' && <span className="text-brand-blue">↓</span>}
                        </span>
                      </th>
                      <th className="px-3 py-3 font-semibold uppercase tracking-wider text-xs">Note / Flag</th>
                      <th className="px-3 py-3 font-semibold uppercase tracking-wider text-xs">Posizione</th>
                      <th className="px-3 py-3 font-semibold uppercase tracking-wider text-xs text-right">Azioni</th>
                    </tr>
                  </thead>
                  <tbody className="text-brand-white">
                    {currentPallets.length === 0 ? (
                      <tr><td colSpan="9" className="p-12 text-center text-slate-500 italic font-medium">Nessuna paletta trovata con i filtri selezionati.</td></tr>
                    ) : currentPallets.map(p => {
                      const expStatus = getExpirationStatus(p.expiration_date, expirationWarningValue, warningUnit);
                      const isExpiredRow = expStatus.category === 'EXPIRED';
                      const isWarningRow = expStatus.category === 'WARNING';
                      return (
                      <tr key={p.id} className={`border-b border-slate-800/50 transition-colors ${isExpiredRow ? 'bg-rose-950/15 hover:bg-rose-950/25' : isWarningRow ? 'bg-amber-950/10 hover:bg-amber-950/20' : 'hover:bg-slate-800/30'}`}>
                        <td className="p-4 text-center">
                          <div onClick={() => toggleSelect(p.id)} className={`w-5 h-5 mx-auto rounded border-2 flex items-center justify-center cursor-pointer transition-all ${selectedPallets.includes(p.id) ? 'bg-brand-blue border-brand-blue shadow-[0_0_10px_rgba(14,165,233,0.3)]' : 'bg-slate-900 border-slate-700 hover:border-brand-blue'}`}>{selectedPallets.includes(p.id) && <CheckCircle size={14} className="text-brand-black" strokeWidth={3} />}</div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-col gap-1 items-start">
                            <button onClick={() => setPrintModal({ show: true, code: p.pallet_code, copies: 1, format: 'THERMAL' })} className="font-mono text-brand-blue font-bold text-xs flex items-center gap-1 hover:underline" title="Ristampa Etichetta">
                              <Printer size={12} /> {formatPalletCode(p.pallet_code)}
                            </button>
                            {p.is_mixed === 1 && (
                              <span className="bg-amber-500/20 text-amber-500 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider" title="Paletta Frammentata">Mista</span>
                            )}
                          </div>
                          <div className={`mt-1 inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${p.warehouse === 'Settala' ? 'bg-brand-blue/10 text-brand-blue border border-brand-blue/30' : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'}`}>
                            {p.warehouse}
                          </div>
                        </td>
                        <td className="px-3 py-3">
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
                          {p.units_per_box > 1 && !(p.uom || '').toLowerCase().includes('scatol') && !(p.uom || '').toLowerCase().includes('bancal') ? (
                            <div className="flex flex-col items-center">
                              <span className="font-bold text-brand-blue">{formatQuantity(p.quantity, p.uom)} <span className="text-[10px] text-slate-500 uppercase">({formatUOM(p.uom || 'Pezzi')})</span></span>
                              <span className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider">
                                {Math.floor(p.quantity / p.units_per_box)} Scat.
                                {(p.quantity % p.units_per_box) > 0 && ` + ${(p.quantity % p.units_per_box)} Sfusi`}
                              </span>
                            </div>
                          ) : (
                            <span className="font-bold text-brand-blue">{formatQuantity(p.quantity, p.uom)} <span className="text-[10px] text-slate-500 uppercase">({formatUOM(p.uom || 'Pezzi')})</span></span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-slate-300 text-sm font-medium">
                          {new Date(p.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-3 py-3 text-slate-400 text-sm">
                          <div className="font-mono text-xs text-slate-300">Lotto: <span className="font-bold text-brand-white">{p.batch || '-'}</span></div>
                          {p.expiration_date ? (
                            <div className="mt-1.5 inline-flex flex-col gap-1 min-w-[170px]">
                              <div className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border ${expStatus.color} ${expStatus.bg}`}>
                                <div className="flex items-center justify-between gap-2">
                                  <span>Scad: {new Date(p.expiration_date).toLocaleDateString('it-IT')}</span>
                                  {expStatus.secondaryLabel && <span className="opacity-75 font-normal lowercase">{expStatus.secondaryLabel}</span>}
                                </div>
                                <div className="mt-0.5 text-[10.5px] font-black tracking-wide">
                                  {expStatus.label}
                                </div>
                              </div>
                              <div className="w-full h-1 bg-slate-950 rounded-full overflow-hidden">
                                <div className={`h-full ${expStatus.barColor} transition-all`} style={{ width: `${expStatus.progress}%` }} />
                              </div>
                            </div>
                          ) : (
                            <div className="mt-1 inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-slate-950 text-slate-500 border border-slate-800">
                              Senza Scadenza
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {p.notes || p.product_notes ? (
                            <div className="max-w-[150px] truncate text-slate-400 text-xs" title={`${p.product_notes ? `Pr: ${p.product_notes}\n` : ''}${p.notes ? `Pal: ${p.notes}` : ''}`}>
                              {p.notes || p.product_notes}
                            </div>
                          ) : <span className="text-slate-600 text-xs">-</span>}
                          {(() => {
                            const parsedFlags = p.flags && typeof p.flags === 'string' ? JSON.parse(p.flags) : p.flags || [];
                            if (parsedFlags.length === 0) return null;
                            return (
                              <div className="flex gap-1 mt-1 flex-wrap">
                                {parsedFlags.map(f => (
                                  <span key={f} className="bg-amber-500/10 text-amber-500 border border-amber-500/30 px-1.5 py-0.5 rounded uppercase tracking-wider text-[9px]">{f}</span>
                                ))}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-3 py-3">
                          {p.status === 'PENDING' ? (
                            <span className="text-slate-500 italic text-xs font-bold bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">⏳ IN ATTESA</span>
                          ) : String(p.location || '').startsWith('ZONA CARICO') ? (
                            <span
                              className="text-amber-400 font-bold bg-amber-500/15 px-2.5 py-1 rounded-lg border border-amber-500/40 flex items-center gap-1.5 w-max cursor-pointer hover:bg-amber-500/25 text-xs"
                              onClick={() => openHistory(p.pallet_code)}
                              title="Merce prelevata in picking e in attesa di conferma spedizione dal backoffice"
                            >
                              <Package size={14} /> {p.location}
                            </span>
                          ) : (
                            <span className="text-green-400 font-bold bg-green-500/10 px-2.5 py-1 rounded-lg border border-green-500/30 flex items-center gap-1 w-max cursor-pointer hover:bg-green-500/20 text-xs" onClick={() => openHistory(p.pallet_code)}>
                              <MapPin size={14} /> {p.location}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={() => setAdjustQtyModal({ show: true, pallet: p, newQuantity: p.quantity, error: null })} className="p-2 text-slate-400 hover:text-amber-500 hover:bg-amber-500/10 rounded-xl transition-colors" title="Modifica Quantità">
                              <Package size={17} />
                            </button>
                            <button onClick={() => setEditModal({ show: true, pallet: p, newLocation: p.location || '', notes: p.notes || '', client_pallet_number: p.client_pallet_number || '', client_article_number: p.client_article_number || '', expiration_date: p.expiration_date ? p.expiration_date.split('T')[0] : '', error: null })} className="p-2 text-slate-400 hover:text-brand-blue hover:bg-brand-blue/10 rounded-xl transition-colors" title="Modifica">
                              <Edit3 size={17} />
                            </button>
                            {canManageProducts && (
                              <button onClick={() => handleDeletePallet(p.pallet_code)} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-xl transition-colors" title="Elimina Paletta">
                                <Trash2 size={17} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </>
              ) : (
                <>
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                      <th className="px-4 py-3 font-semibold uppercase tracking-wider text-xs">SKU / Cod. Articolo</th>
                      <th className="px-4 py-3 font-semibold uppercase tracking-wider text-xs">Nome Prodotto</th>
                      <th className="px-4 py-3 font-semibold uppercase tracking-wider text-xs">Cliente</th>
                      <th className="px-4 py-3 font-semibold uppercase tracking-wider text-xs">Confezionamento</th>
                      <th className="px-4 py-3 font-semibold uppercase tracking-wider text-xs">Giacenza & Palette Attive</th>
                      <th className="px-4 py-3 font-semibold uppercase tracking-wider text-xs">Note / Flag</th>
                      {canManageProducts && <th className="px-4 py-3 font-semibold uppercase tracking-wider text-xs text-right">Azioni</th>}
                    </tr>
                  </thead>
                  <tbody className="text-brand-white">
                    {currentProducts.length === 0 ? (
                      <tr><td colSpan="7" className="p-12 text-center text-slate-500 italic font-medium">Nessun prodotto trovato.</td></tr>
                    ) : currentProducts.map(p => {
                      const st = stockByProduct.get(p.id) || { totalQty: 0, palletCount: 0 };
                      const totalStock = st.totalQty;
                      const upb = parseFloat(p.units_per_box) || 1;
                      const parsedFlags = p.flags && typeof p.flags === 'string' ? JSON.parse(p.flags) : p.flags || [];
                      return (
                      <tr key={p.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-mono text-brand-blue text-xs font-bold">{p.sku}</div>
                          {p.default_article_number && p.default_article_number !== p.sku && (
                            <div className="text-[10px] text-slate-500 font-mono">Art: {p.default_article_number}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 font-bold text-sm">{p.name}</td>
                        <td className="px-4 py-3 text-slate-300 text-xs font-semibold">{p.customer_name}</td>
                        <td className="px-4 py-3 text-slate-400 text-xs">
                          <span className="bg-slate-950 border border-slate-800 px-2 py-0.5 rounded-md font-mono">
                            UDM: <strong className="text-slate-200">{p.uom || 'Pezzi'}</strong>
                            {upb > 1 ? ` • ${upb} pz/scat` : ''}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {totalStock > 0 ? (
                            <button
                              type="button"
                              onClick={() => {
                                setSearchTerm(p.sku);
                                setActiveTab('pallets');
                              }}
                              className="group flex flex-col items-start bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-xl px-3 py-1.5 transition-all text-left"
                              title="Clicca per vedere le palette di questo prodotto nello Stock"
                            >
                              <div className="flex items-center gap-1.5">
                                <span className="font-black text-emerald-400 text-sm">
                                  {formatQuantity(totalStock, p.uom || 'Pezzi')} {formatUOM(p.uom || 'Pezzi')}
                                </span>
                                <ExternalLink size={12} className="text-emerald-400 opacity-60 group-hover:opacity-100" />
                              </div>
                              <span className="text-[10px] text-slate-400 font-semibold">
                                {st.palletCount} {st.palletCount === 1 ? 'paletta' : 'palette'}
                                {upb > 1 && !(p.uom || '').toLowerCase().includes('scatol') ? ` • ${Math.floor(totalStock / upb)} Scat.` : ''}
                              </span>
                            </button>
                          ) : (
                            <span className="inline-block px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-500 text-xs font-bold">
                              0 (Esaurito)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-400 text-xs">
                          <div className="mb-1 max-w-[180px] truncate" title={p.notes}>{p.notes || '-'}</div>
                          {parsedFlags.length > 0 && (
                            <div className="flex gap-1 flex-wrap">
                              {parsedFlags.map(f => (
                                <span key={f} className="bg-amber-500/10 text-amber-500 border border-amber-500/30 px-1.5 py-0.5 rounded uppercase tracking-wider text-[9px]">{f}</span>
                              ))}
                            </div>
                          )}
                        </td>
                        {canManageProducts && (
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button onClick={() => setEditProductModal({ show: true, product: { ...p, flags: parsedFlags.map(f => ({ label: f, value: f })), original_flags: parsedFlags } })} className="p-2 text-slate-400 hover:text-brand-blue hover:bg-brand-blue/10 rounded-xl transition-colors" title="Modifica Anagrafica">
                                <Edit3 size={17} />
                              </button>
                              <button onClick={() => handleDeleteProduct(p.id, p.name)} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-xl transition-colors" title="Elimina Anagrafica">
                                <Trash2 size={17} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                      );
                    })}
                  </tbody>
                </>
              )}
            </table>
            {activeTab === 'pallets' ? (
              <Pagination
                currentPage={palletsCurrentPage}
                totalPages={totalPalletPages}
                onPageChange={setPalletsCurrentPage}
                itemsPerPage={itemsPerPage}
                onItemsPerPageChange={setItemsPerPage}
                totalItems={filteredPallets.length}
              />
            ) : (
              <Pagination
                currentPage={productsCurrentPage}
                totalPages={totalProductPages}
                onPageChange={setProductsCurrentPage}
                itemsPerPage={itemsPerPage}
                onItemsPerPageChange={setItemsPerPage}
                totalItems={filteredProducts.length}
              />
            )}
          </div>
        </div>
      </div>

      {/* Modale Nuova Referenza */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-md w-full shadow-2xl animate-fade-in-up max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold text-brand-white mb-6 flex items-center gap-3">
              <span className="w-10 h-10 bg-brand-blue/20 flex items-center justify-center rounded-xl text-brand-blue"><Plus size={24} /></span>
              Registra Anagrafica
            </h2>
            <form onSubmit={handleCreateProduct} className="space-y-4">
              <div>
                <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Cliente Proprietario *</label>
                <select required value={newProduct.customer_id} onChange={e => setNewProduct({...newProduct, customer_id: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue">
                  <option value="" disabled>Seleziona cliente...</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.business_name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Codice Articolo (SKU) *</label>
                  <input required value={newProduct.sku} onChange={e => setNewProduct({...newProduct, sku: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue" placeholder="Es. ART-001" />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Unità Base (UDM) *</label>
                  <select required value={newProduct.uom} onChange={e => setNewProduct({...newProduct, uom: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue">
                    <option value="Pezzi">Pezzi</option>
                    <option value="Scatole">Scatole</option>
                    <option value="Bancali">Bancale Intero</option>
                    <option value="KG">KG</option>
                    <option value="Metro Cubo">Metro Cubo (m³)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Nome Prodotto *</label>
                <input required value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Unità per Scatola</label>
                  <input type="number" onWheel={(e) => e.target.blur()} min="1" value={newProduct.units_per_box} onChange={e => setNewProduct({...newProduct, units_per_box: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue" />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Num. Articolo Dft</label>
                  <input value={newProduct.default_article_number} onChange={e => setNewProduct({...newProduct, default_article_number: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue" placeholder="Es. ART-001" />
                </div>
              </div>
              <div>
                <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Flag di Default (es. ADR)</label>
                <CreatableSelect
                  isMulti
                  styles={selectStyles}
                  placeholder="Digita un flag e premi invio..."
                  noOptionsMessage={() => "Nessun flag trovato"}
                  formatCreateLabel={(val) => `Crea flag "${val}"`}
                  value={newProduct.flags}
                  options={availableFlagsOptions}
                  onChange={val => setNewProduct({...newProduct, flags: val})}
                />
              </div>
              <div>
                <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Note Generiche (Opzionale)</label>
                <textarea value={newProduct.notes} onChange={e => setNewProduct({...newProduct, notes: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue resize-none h-20"></textarea>
              </div>
              <div className="flex gap-3 mt-6 pt-5 border-t border-slate-800/80">
                <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 py-3.5 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-xl font-bold transition-colors">Annulla</button>
                <button type="submit" disabled={isProcessing} className="flex-1 py-3.5 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-xl font-bold transition-colors shadow-[0_0_20px_rgba(14,165,233,0.3)] disabled:opacity-50">Crea Prodotto</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editProductModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-md w-full shadow-2xl animate-fade-in-up max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold text-brand-white mb-6 flex items-center gap-3">
              <span className="w-10 h-10 bg-brand-blue/20 flex items-center justify-center rounded-xl text-brand-blue"><Edit3 size={24} /></span>
              Modifica Anagrafica
            </h2>
            <form onSubmit={handleUpdateProduct} className="space-y-4">
              <div>
                <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Codice Articolo (SKU) *</label>
                <input required value={editProductModal.product.sku} onChange={e => setEditProductModal({ ...editProductModal, product: { ...editProductModal.product, sku: e.target.value }})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue" />
              </div>
              <div>
                <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Nome Prodotto *</label>
                <input required value={editProductModal.product.name} onChange={e => setEditProductModal({ ...editProductModal, product: { ...editProductModal.product, name: e.target.value }})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Unità Base (UDM) *</label>
                  <select required value={editProductModal.product.uom} onChange={e => setEditProductModal({ ...editProductModal, product: { ...editProductModal.product, uom: e.target.value }})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue">
                    <option value="Pezzi">Pezzi</option>
                    <option value="Scatole">Scatole</option>
                    <option value="Bancali">Bancale Intero</option>
                    <option value="KG">KG</option>
                    <option value="Metro Cubo">Metro Cubo (m³)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Cliente Proprietario *</label>
                  <select required value={editProductModal.product.customer_id} onChange={e => setEditProductModal({ ...editProductModal, product: { ...editProductModal.product, customer_id: e.target.value }})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue">
                    <option value="" disabled>Seleziona cliente...</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.business_name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Unità per Scatola</label>
                  <input type="number" onWheel={(e) => e.target.blur()} min="1" value={editProductModal.product.units_per_box} onChange={e => setEditProductModal({ ...editProductModal, product: { ...editProductModal.product, units_per_box: e.target.value }})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue" />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Num. Articolo Dft</label>
                  <input value={editProductModal.product.default_article_number || ''} onChange={e => setEditProductModal({ ...editProductModal, product: { ...editProductModal.product, default_article_number: e.target.value }})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue" placeholder="Es. ART-001" />
                </div>
              </div>
              <div>
                <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Flag di Default (es. ADR)</label>
                <CreatableSelect
                  isMulti
                  styles={selectStyles}
                  placeholder="Digita un flag e premi invio..."
                  noOptionsMessage={() => "Nessun flag trovato"}
                  formatCreateLabel={(val) => `Crea flag "${val}"`}
                  value={editProductModal.product.flags || []}
                  options={availableFlagsOptions}
                  onChange={val => setEditProductModal({ ...editProductModal, product: { ...editProductModal.product, flags: val }})}
                />
              </div>
              <div>
                <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Note Generiche (Opzionale)</label>
                <textarea value={editProductModal.product.notes || ''} onChange={e => setEditProductModal({ ...editProductModal, product: { ...editProductModal.product, notes: e.target.value }})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue resize-none h-20"></textarea>
              </div>
              <div className="flex gap-3 mt-6 pt-5 border-t border-slate-800/80">
                <button type="button" onClick={() => setEditProductModal({ show: false, product: null })} className="flex-1 py-3.5 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-xl font-bold transition-colors">Annulla</button>
                <button type="submit" disabled={isProcessing} className="flex-1 py-3.5 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-xl font-bold transition-colors shadow-[0_0_20px_rgba(14,165,233,0.3)] disabled:opacity-50">Salva Modifiche</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modale Modifica Quantità con Preset Scatole/Pezzi */}
      {adjustQtyModal.show && adjustQtyModal.pallet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-7 max-w-md w-full shadow-2xl relative animate-fade-in-up">
            <h2 className="text-2xl font-bold text-brand-white mb-2 flex items-center gap-3">
              <Package className="text-amber-500" />
              Modifica Quantità Paletta
            </h2>
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3.5 mb-5 text-xs">
              <div className="flex justify-between items-center">
                <span className="font-mono font-bold text-brand-blue">{adjustQtyModal.pallet.pallet_code}</span>
                <span className="text-slate-400">Lotto: <strong className="text-white">{adjustQtyModal.pallet.batch || '-'}</strong></span>
              </div>
              <div className="font-bold text-brand-white mt-1">{adjustQtyModal.pallet.product_name}</div>
              {adjustQtyModal.pallet.units_per_box > 1 && (
                <div className="text-slate-400 mt-1">
                  Confezionamento: <strong className="text-amber-400">{adjustQtyModal.pallet.units_per_box} pz / scatola</strong>
                </div>
              )}
            </div>

            <form onSubmit={handleAdjustQty}>
              <div className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-slate-400 text-xs font-bold uppercase tracking-wider">
                    Nuova Quantità ({adjustQtyModal.pallet.uom || 'Pezzi'})
                  </label>
                  {adjustQtyModal.pallet.units_per_box > 1 && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          const upb = parseFloat(adjustQtyModal.pallet.units_per_box) || 1;
                          const cur = parseFloat(adjustQtyModal.newQuantity) || 0;
                          setAdjustQtyModal(prev => ({ ...prev, newQuantity: Math.max(0, cur - upb) }));
                        }}
                        className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] font-bold"
                      >
                        -1 Scat. (-{adjustQtyModal.pallet.units_per_box})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const upb = parseFloat(adjustQtyModal.pallet.units_per_box) || 1;
                          const cur = parseFloat(adjustQtyModal.newQuantity) || 0;
                          setAdjustQtyModal(prev => ({ ...prev, newQuantity: cur + upb }));
                        }}
                        className="px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded text-[11px] font-bold"
                      >
                        +1 Scat. (+{adjustQtyModal.pallet.units_per_box})
                      </button>
                    </div>
                  )}
                </div>
                <input
                  type="number"
                  onWheel={(e) => e.target.blur()}
                  min="0"
                  step="0.01"
                  className="w-full bg-slate-950 border border-slate-700 p-4 rounded-xl text-brand-white font-black text-xl focus:border-brand-blue"
                  value={adjustQtyModal.newQuantity}
                  onChange={e => setAdjustQtyModal(prev => ({ ...prev, newQuantity: e.target.value }))}
                  required
                />
                {adjustQtyModal.pallet.units_per_box > 1 && (
                  <div className="mt-2 text-xs text-slate-400">
                    Equivale a:{' '}
                    <strong className="text-brand-blue">
                      {Math.floor((parseFloat(adjustQtyModal.newQuantity) || 0) / adjustQtyModal.pallet.units_per_box)} Scatole
                      {((parseFloat(adjustQtyModal.newQuantity) || 0) % adjustQtyModal.pallet.units_per_box) > 0 &&
                        ` + ${(parseFloat(adjustQtyModal.newQuantity) || 0) % adjustQtyModal.pallet.units_per_box} Sfusi`}
                    </strong>
                  </div>
                )}
              </div>
              {adjustQtyModal.error && (
                <div className="mb-5 p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-3 text-rose-500 text-sm">
                  <XCircle size={18} />
                  <span className="font-semibold">{adjustQtyModal.error}</span>
                </div>
              )}
              <div className="flex gap-3">
                <button type="button" onClick={() => setAdjustQtyModal({ show: false, pallet: null, newQuantity: '', error: null })} className="flex-1 py-3.5 bg-slate-800 text-brand-white rounded-xl font-bold hover:bg-slate-700 transition-colors">
                  Annulla
                </button>
                <button type="submit" disabled={isProcessing} className="flex-1 py-3.5 bg-amber-500 text-brand-black rounded-xl font-black hover:bg-amber-400 transition-colors disabled:opacity-50">
                  {isProcessing ? 'Salvataggio...' : 'Salva Quantità'}
                </button>
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
                  {printModal.isBulk ? `Stampa Multipla (${selectedPallets.length} Etichette Selezionate)` : formatPalletCode(printModal.code)}
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
                <input type="number" onWheel={(e) => e.target.blur()} min="1" max="100" value={printModal.copies} onChange={e => setPrintModal({...printModal, copies: parseInt(e.target.value) || 1})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 focus:ring-brand-blue text-center font-bold text-lg" />
              </div>

              <div className="flex gap-4 border-t border-slate-800/80 pt-6">
                <button onClick={() => setPrintModal({ show: false, code: "", copies: 1, format: "A4", isBulk: false })} className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-xl font-bold transition-colors">
                  Annulla
                </button>
                <button onClick={() => {
                  if (printModal.isBulk) {
                    axios.post(`http://${window.location.hostname}:3000/api/pallets/print-bulk`, {
                      ids: selectedPallets,
                      paper_format: printModal.format,
                      print_mode: printModal.format === 'A4' ? 'GRID' : 'SINGLE_PAGE',
                      copies: printModal.copies
                    }, {
                      headers: { Authorization: `Bearer ${getToken()}` },
                      responseType: 'blob'
                    }).then(response => {
                      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
                      window.open(url, '_blank');
                      setPrintModal({ show: false, code: "", copies: 1, format: "A4", isBulk: false });
                      setSelectedPallets([]);
                    }).catch(err => {
                      appAlert("Errore durante la generazione della stampa bulk.");
                    });
                  } else {
                    window.open(`http://${window.location.hostname}:3000/api/pallets/${printModal.code}/print?token=${getToken()}&format=${printModal.format}&copies=${printModal.copies}`, '_blank');
                    setPrintModal({ show: false, code: "", copies: 1, format: "A4", isBulk: false });
                  }
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
