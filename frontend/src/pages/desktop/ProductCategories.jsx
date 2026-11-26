import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  FolderTree, Plus, Edit3, Trash2, Search, RotateCcw, Package, Tag, Layers,
  CheckSquare, Square, ArrowRight, Loader2, ExternalLink, X, Check
} from 'lucide-react';
import { appAlert, appConfirm } from '../../utils/alerts.js';
import { hasPerm } from '../../utils/permissions.js';

const PRESET_COLORS = [
  '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e',
  '#8b5cf6', '#ec4899', '#14b8a6', '#64748b'
];

const ProductCategories = () => {
  const navigate = useNavigate();
  const getToken = () => localStorage.getItem('maglite_token');

  const canManageCategories = hasPerm('product_categories_manage');
  const canAssignProducts = canManageCategories || hasPerm('product_manage');

  const [macros, setMacros] = useState([]);
  const [daIdentificareId, setDaIdentificareId] = useState(null);
  const [totalProductsCount, setTotalProductsCount] = useState(0);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Filtri visualizzazione
  const [selectedMacroId, setSelectedMacroId] = useState('ALL');
  const [selectedMicroId, setSelectedMicroId] = useState('ALL');
  const [filterCustomerId, setFilterCustomerId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Selezione multipla e assegnazione rapida prodotti
  const [selectedProductIds, setSelectedProductIds] = useState([]);
  const [assignMacroId, setAssignMacroId] = useState('');
  const [assignMicroId, setAssignMicroId] = useState('');

  // Modali creazione/modifica Macro & Micro
  const [macroModal, setMacroModal] = useState({
    show: false,
    mode: 'create',
    id: null,
    is_system: false,
    name: '',
    description: '',
    color: '#0ea5e9'
  });
  const [microModal, setMicroModal] = useState({
    show: false,
    mode: 'create',
    id: null,
    macro_category_id: '',
    name: '',
    description: ''
  });
  const [quickAssignModal, setQuickAssignModal] = useState({
    show: false,
    product: null,
    macro_category_id: '',
    micro_category_id: ''
  });

  const fetchTreeAndCustomers = useCallback(async () => {
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      const [catRes, custRes] = await Promise.all([
        axios.get(`http://${window.location.hostname}:3000/api/product-categories`, { headers }),
        axios.get(`http://${window.location.hostname}:3000/api/customers`, { headers }).catch(() => ({ data: [] }))
      ]);
      const macroList = catRes.data?.macros || [];
      setMacros(macroList);
      setDaIdentificareId(catRes.data?.da_identificare_id || null);
      setTotalProductsCount(catRes.data?.total_products || 0);
      setCustomers(Array.isArray(custRes.data) ? custRes.data : []);
      if (!assignMacroId && macroList.length > 0) {
        const firstNonSystem = macroList.find(m => !m.is_system) || macroList[0];
        setAssignMacroId(String(firstNonSystem.id));
      }
    } catch (err) {
      console.error(err);
      appAlert(err.response?.data?.error || 'Errore nel caricamento delle categorie');
    }
  }, [assignMacroId]);

  const fetchProductsList = useCallback(async () => {
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      const params = {};
      if (selectedMacroId && selectedMacroId !== 'ALL') params.macro_category_id = selectedMacroId;
      if (selectedMicroId && selectedMicroId !== 'ALL') params.micro_category_id = selectedMicroId;
      if (filterCustomerId) params.customer_id = filterCustomerId;
      if (searchTerm.trim()) params.search = searchTerm.trim();

      const res = await axios.get(`http://${window.location.hostname}:3000/api/product-categories/products`, {
        headers,
        params
      });
      setProducts(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error(err);
    }
  }, [selectedMacroId, selectedMicroId, filterCustomerId, searchTerm]);

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      setLoading(true);
      await fetchTreeAndCustomers();
      if (mounted) setLoading(false);
    };
    init();

    const socket = io(`http://${window.location.hostname}:3000`);
    const onRefresh = () => {
      fetchTreeAndCustomers();
      fetchProductsList();
    };
    socket.on('product_categories_updated', onRefresh);
    socket.on('inventory_updated', onRefresh);

    return () => {
      mounted = false;
      socket.off('product_categories_updated', onRefresh);
      socket.off('inventory_updated', onRefresh);
      socket.disconnect();
    };
  }, [fetchTreeAndCustomers, fetchProductsList]);

  useEffect(() => {
    fetchProductsList();
  }, [fetchProductsList]);

  // Pulisci selezione prodotti se cambia la lista filtrata
  useEffect(() => {
    const validIds = new Set(products.map(p => p.id));
    setSelectedProductIds(prev => prev.filter(id => validIds.has(id)));
  }, [products]);

  const activeMacroObj = useMemo(
    () => macros.find(m => String(m.id) === String(selectedMacroId)) || null,
    [macros, selectedMacroId]
  );

  const filterMicroOptions = useMemo(() => {
    if (activeMacroObj) return activeMacroObj.micros || [];
    return macros.flatMap(m => (m.micros || []).map(mic => ({ ...mic, macroName: m.name })));
  }, [macros, activeMacroObj]);

  const assignMicroOptions = useMemo(() => {
    const mac = macros.find(m => String(m.id) === String(assignMacroId));
    return mac ? mac.micros || [] : [];
  }, [macros, assignMacroId]);

  const quickAssignMicroOptions = useMemo(() => {
    const mac = macros.find(m => String(m.id) === String(quickAssignModal.macro_category_id));
    return mac ? mac.micros || [] : [];
  }, [macros, quickAssignModal.macro_category_id]);

  const handleSelectTreeMacro = (macroId) => {
    const strId = String(macroId);
    setSelectedMacroId(strId);
    setSelectedMicroId('ALL');
    if (canAssignProducts && strId !== 'ALL') {
      setAssignMacroId(strId);
      setAssignMicroId('');
    }
  };

  const handleSelectTreeMicro = (macroId, microId) => {
    const strMacro = String(macroId);
    const strMicro = String(microId);
    setSelectedMacroId(strMacro);
    setSelectedMicroId(strMicro);
    if (canAssignProducts) {
      setAssignMacroId(strMacro);
      setAssignMicroId(strMicro);
    }
  };

  const resetFilters = () => {
    setSelectedMacroId('ALL');
    setSelectedMicroId('ALL');
    setFilterCustomerId('');
    setSearchTerm('');
  };

  const hasActiveFilters =
    selectedMacroId !== 'ALL' || selectedMicroId !== 'ALL' || filterCustomerId !== '' || searchTerm.trim() !== '';

  const handleSaveMacro = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      const payload = {
        name: macroModal.name,
        description: macroModal.description,
        color: macroModal.color
      };
      if (macroModal.mode === 'create') {
        await axios.post(`http://${window.location.hostname}:3000/api/product-categories/macros`, payload, { headers });
      } else {
        await axios.put(`http://${window.location.hostname}:3000/api/product-categories/macros/${macroModal.id}`, payload, { headers });
      }
      setMacroModal({ show: false, mode: 'create', id: null, is_system: false, name: '', description: '', color: '#0ea5e9' });
      await Promise.all([fetchTreeAndCustomers(), fetchProductsList()]);
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore salvataggio Macro Categoria');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteMacro = async (mac) => {
    const confirmed = await appConfirm(
      `Vuoi eliminare la macro categoria "${mac.name}"?\nEventuali micro categorie interne verranno eliminate e i prodotti associati verranno spostati in "DA IDENTIFICARE".`,
      'Elimina Macro Categoria'
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      await axios.delete(`http://${window.location.hostname}:3000/api/product-categories/macros/${mac.id}`, { headers });
      if (String(selectedMacroId) === String(mac.id)) {
        setSelectedMacroId('ALL');
        setSelectedMicroId('ALL');
      }
      await Promise.all([fetchTreeAndCustomers(), fetchProductsList()]);
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore eliminazione Macro Categoria');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveMicro = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      const payload = {
        macro_category_id: microModal.macro_category_id,
        name: microModal.name,
        description: microModal.description
      };
      if (microModal.mode === 'create') {
        await axios.post(`http://${window.location.hostname}:3000/api/product-categories/micros`, payload, { headers });
      } else {
        await axios.put(`http://${window.location.hostname}:3000/api/product-categories/micros/${microModal.id}`, payload, { headers });
      }
      setMicroModal({ show: false, mode: 'create', id: null, macro_category_id: '', name: '', description: '' });
      await Promise.all([fetchTreeAndCustomers(), fetchProductsList()]);
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore salvataggio Micro Categoria');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteMicro = async (mic) => {
    const confirmed = await appConfirm(
      `Vuoi eliminare la micro categoria "${mic.name}"?\nI prodotti collegati resteranno nella loro macro categoria senza micro categoria.`,
      'Elimina Micro Categoria'
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      await axios.delete(`http://${window.location.hostname}:3000/api/product-categories/micros/${mic.id}`, { headers });
      if (String(selectedMicroId) === String(mic.id)) {
        setSelectedMicroId('ALL');
      }
      await Promise.all([fetchTreeAndCustomers(), fetchProductsList()]);
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore eliminazione Micro Categoria');
    } finally {
      setBusy(false);
    }
  };

  const toggleProductSelection = (id) => {
    setSelectedProductIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const toggleSelectAllVisible = () => {
    if (selectedProductIds.length === products.length && products.length > 0) {
      setSelectedProductIds([]);
    } else {
      setSelectedProductIds(products.map(p => p.id));
    }
  };

  const handleBulkAssign = async () => {
    if (selectedProductIds.length === 0) {
      return appAlert('Seleziona almeno un prodotto dalla tabella.');
    }
    if (!assignMacroId && !assignMicroId) {
      return appAlert('Seleziona la Macro o Micro Categoria di destinazione.');
    }
    setBusy(true);
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      await axios.put(
        `http://${window.location.hostname}:3000/api/product-categories/assign-products`,
        {
          product_ids: selectedProductIds,
          macro_category_id: assignMacroId || null,
          micro_category_id: assignMicroId || null
        },
        { headers }
      );
      setSelectedProductIds([]);
      await Promise.all([fetchTreeAndCustomers(), fetchProductsList()]);
      appAlert('Categorie aggiornate con successo!', 'Fatto', 'success');
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore assegnazione categoria');
    } finally {
      setBusy(false);
    }
  };

  const handleQuickAssignSave = async (e) => {
    e.preventDefault();
    if (!quickAssignModal.product || busy) return;
    setBusy(true);
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      await axios.put(
        `http://${window.location.hostname}:3000/api/product-categories/assign-products`,
        {
          product_ids: [quickAssignModal.product.id],
          macro_category_id: quickAssignModal.macro_category_id || daIdentificareId || null,
          micro_category_id: quickAssignModal.micro_category_id || null
        },
        { headers }
      );
      setQuickAssignModal({ show: false, product: null, macro_category_id: '', micro_category_id: '' });
      await Promise.all([fetchTreeAndCustomers(), fetchProductsList()]);
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore salvataggio categoria prodotto');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 p-8 flex items-center justify-center text-brand-blue">
        <Loader2 className="animate-spin" size={44} />
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-7xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-black text-brand-white flex items-center gap-2.5 sm:gap-3">
            <FolderTree className="text-brand-blue shrink-0" size={30} />
            <span className="truncate">Macro & Micro Categorie Prodotti</span>
          </h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">
            Organizza l&apos;anagrafica in categorie gerarchiche (es. Food → Integratore), filtra gli articoli e associa i prodotti rapidamente.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          <button
            type="button"
            onClick={() => navigate('/desktop/products')}
            className="px-4 py-2.5 bg-slate-900 border border-slate-700 hover:border-brand-blue text-brand-white font-bold rounded-xl text-xs sm:text-sm flex items-center gap-2 transition-colors"
          >
            <ExternalLink size={16} className="text-brand-blue" /> Vai a Prodotti & Stock
          </button>
          {canManageCategories && (
            <button
              type="button"
              onClick={() =>
                setMacroModal({
                  show: true,
                  mode: 'create',
                  id: null,
                  is_system: false,
                  name: '',
                  description: '',
                  color: '#0ea5e9'
                })
              }
              className="px-5 py-2.5 bg-brand-blue hover:bg-sky-400 text-brand-black font-black rounded-xl text-xs sm:text-sm flex items-center gap-2 shadow-[0_0_20px_rgba(14,165,233,0.25)] transition-all"
            >
              <Plus size={18} /> Nuova Macro Categoria
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Colonna Sinistra: Albero Macro & Micro Categorie */}
        <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h2 className="text-sm font-black uppercase tracking-wider text-brand-white flex items-center gap-2">
              <Layers size={16} className="text-brand-blue" /> Struttura Categorie
            </h2>
            <span className="text-xs font-bold text-slate-400">{macros.length} macro</span>
          </div>

          {/* Voce Tutte */}
          <button
            type="button"
            onClick={() => handleSelectTreeMacro('ALL')}
            className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl border text-left transition-all ${
              selectedMacroId === 'ALL'
                ? 'bg-brand-blue/15 border-brand-blue text-brand-white shadow-sm'
                : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
            }`}
          >
            <span className="font-bold text-sm flex items-center gap-2">
              <Package size={15} className="text-brand-blue" /> Tutte le Categorie
            </span>
            <span className="px-2 py-0.5 rounded-full text-xs font-black bg-slate-900 border border-slate-700 text-brand-white">
              {totalProductsCount}
            </span>
          </button>

          {/* Lista Macro */}
          <div className="space-y-2.5 max-h-[65vh] overflow-y-auto pr-1">
            {macros.map((mac) => {
              const isSelectedMacro = String(selectedMacroId) === String(mac.id);
              const isAllMicrosSelected = isSelectedMacro && selectedMicroId === 'ALL';
              return (
                <div
                  key={mac.id}
                  className={`rounded-2xl border transition-all overflow-hidden ${
                    isSelectedMacro
                      ? 'bg-slate-950 border-brand-blue/60 shadow-md'
                      : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="p-3 flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => handleSelectTreeMacro(mac.id)}
                      className="flex-1 text-left min-w-0"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: mac.color || '#0ea5e9' }}
                        />
                        <span className={`font-black text-sm truncate ${isAllMicrosSelected ? 'text-brand-blue' : 'text-brand-white'}`}>
                          {mac.name}
                        </span>
                        {mac.is_system && (
                          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                            Default
                          </span>
                        )}
                      </div>
                      {mac.description && (
                        <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">{mac.description}</p>
                      )}
                    </button>

                    <div className="flex items-center gap-1 shrink-0">
                      <span className="px-2 py-0.5 rounded-full text-xs font-black bg-slate-900 border border-slate-700 text-brand-white">
                        {mac.product_count}
                      </span>
                      {canManageCategories && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setMicroModal({
                                show: true,
                                mode: 'create',
                                id: null,
                                macro_category_id: String(mac.id),
                                name: '',
                                description: ''
                              })
                            }
                            className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-500/15 transition-colors"
                            title="Aggiungi Micro Categoria dentro questa Macro"
                          >
                            <Plus size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setMacroModal({
                                show: true,
                                mode: 'edit',
                                id: mac.id,
                                is_system: mac.is_system,
                                name: mac.name,
                                description: mac.description || '',
                                color: mac.color || '#0ea5e9'
                              })
                            }
                            className="p-1.5 rounded-lg text-slate-400 hover:text-brand-blue hover:bg-brand-blue/10 transition-colors"
                            title="Modifica Macro Categoria"
                          >
                            <Edit3 size={14} />
                          </button>
                          {!mac.is_system && (
                            <button
                              type="button"
                              onClick={() => handleDeleteMacro(mac)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                              title="Elimina Macro Categoria"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Micro Categorie figlie */}
                  {(mac.micros || []).length > 0 && (
                    <div className="border-t border-slate-800/80 bg-slate-900/40 px-2.5 py-2 space-y-1">
                      {mac.micros.map((mic) => {
                        const isMicActive =
                          String(selectedMacroId) === String(mac.id) &&
                          String(selectedMicroId) === String(mic.id);
                        return (
                          <div
                            key={mic.id}
                            className={`flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-xl transition-colors ${
                              isMicActive
                                ? 'bg-brand-blue/20 border border-brand-blue/40 text-brand-white'
                                : 'hover:bg-slate-800/60 text-slate-300'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => handleSelectTreeMicro(mac.id, mic.id)}
                              className="flex-1 flex items-center gap-2 text-left min-w-0 text-xs font-semibold"
                            >
                              <Tag size={12} className={isMicActive ? 'text-brand-blue shrink-0' : 'text-slate-400 shrink-0'} />
                              <span className="truncate">{mic.name}</span>
                            </button>
                            <div className="flex items-center gap-1 shrink-0">
                              <span className="text-[11px] font-bold text-slate-400 px-1.5">
                                {mic.product_count}
                              </span>
                              {canManageCategories && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setMicroModal({
                                        show: true,
                                        mode: 'edit',
                                        id: mic.id,
                                        macro_category_id: String(mic.macro_category_id),
                                        name: mic.name,
                                        description: mic.description || ''
                                      })
                                    }
                                    className="p-1 rounded text-slate-400 hover:text-brand-blue"
                                    title="Modifica Micro Categoria"
                                  >
                                    <Edit3 size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteMicro(mic)}
                                    className="p-1 rounded text-slate-400 hover:text-rose-400"
                                    title="Elimina Micro Categoria"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Colonna Destra: Filtri, Associazione e Tabella Prodotti */}
        <div className="lg:col-span-8 space-y-4 min-w-0">
          {/* Barra Filtri */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="relative">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Cerca SKU, nome o cliente..."
                  className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl py-2 pl-9 pr-7 text-xs font-medium focus:border-brand-blue outline-none"
                />
                <Search size={15} className="absolute left-3 top-2.5 text-slate-500" />
                {searchTerm && (
                  <button type="button" onClick={() => setSearchTerm('')} className="absolute right-2.5 top-2.5 text-slate-500 hover:text-white">
                    <X size={14} />
                  </button>
                )}
              </div>

              <select
                value={selectedMacroId}
                onChange={e => {
                  setSelectedMacroId(e.target.value);
                  setSelectedMicroId('ALL');
                }}
                className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-3 py-2 text-xs font-bold focus:border-brand-blue"
              >
                <option value="ALL">Tutte le Macro Categorie</option>
                {macros.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.product_count})
                  </option>
                ))}
              </select>

              <select
                value={selectedMicroId}
                onChange={e => setSelectedMicroId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-3 py-2 text-xs font-bold focus:border-brand-blue"
              >
                <option value="ALL">Tutte le Micro Categorie</option>
                <option value="NONE">Senza Micro Categoria</option>
                {filterMicroOptions.map(mic => (
                  <option key={mic.id} value={mic.id}>
                    {mic.macroName ? `${mic.macroName} → ${mic.name}` : mic.name} ({mic.product_count})
                  </option>
                ))}
              </select>

              <div className="flex gap-2">
                <select
                  value={filterCustomerId}
                  onChange={e => setFilterCustomerId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-3 py-2 text-xs font-bold focus:border-brand-blue"
                >
                  <option value="">Tutti i clienti</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.business_name}</option>
                  ))}
                </select>
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="px-3 py-2 bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 rounded-xl text-xs font-bold shrink-0"
                    title="Azzera filtri"
                  >
                    <RotateCcw size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Barra Associazione Massiva Prodotti */}
            {canAssignProducts && (
              <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs text-slate-400">
                  {selectedProductIds.length > 0 ? (
                    <span className="text-brand-blue font-black">
                      {selectedProductIds.length} prodott{selectedProductIds.length === 1 ? 'o selezionato' : 'i selezionati'}
                    </span>
                  ) : (
                    <span>Seleziona uno o più articoli sotto per assegnarli a una Macro / Micro categoria</span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={assignMacroId}
                    onChange={e => {
                      setAssignMacroId(e.target.value);
                      setAssignMicroId('');
                    }}
                    className="bg-slate-950 border border-slate-700 text-brand-white rounded-xl px-3 py-1.5 text-xs font-bold focus:border-brand-blue"
                  >
                    <option value="">Macro destinazione...</option>
                    {macros.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>

                  <select
                    value={assignMicroId}
                    onChange={e => setAssignMicroId(e.target.value)}
                    disabled={!assignMacroId || assignMicroOptions.length === 0}
                    className="bg-slate-950 border border-slate-700 text-brand-white rounded-xl px-3 py-1.5 text-xs font-bold focus:border-brand-blue disabled:opacity-40"
                  >
                    <option value="">Nessuna Micro (solo Macro)</option>
                    {assignMicroOptions.map(mic => (
                      <option key={mic.id} value={mic.id}>{mic.name}</option>
                    ))}
                  </select>

                  <button
                    type="button"
                    disabled={busy || selectedProductIds.length === 0}
                    onClick={handleBulkAssign}
                    className="px-4 py-1.5 bg-brand-blue hover:bg-sky-400 disabled:opacity-40 text-brand-black font-black rounded-xl text-xs flex items-center gap-1.5 transition-all"
                  >
                    <Check size={14} /> Collega ({selectedProductIds.length})
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Tabella Prodotti Filtrati */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Articoli Trovati: <strong className="text-brand-white">{products.length}</strong>
              </div>
              {activeMacroObj && (
                <div className="flex items-center gap-1.5 text-xs font-bold text-brand-white">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: activeMacroObj.color || '#0ea5e9' }} />
                  <span>{activeMacroObj.name}</span>
                  {selectedMicroId !== 'ALL' && selectedMicroId !== 'NONE' && (
                    <>
                      <ArrowRight size={13} className="text-slate-400" />
                      <span className="text-brand-blue">
                        {filterMicroOptions.find(x => String(x.id) === String(selectedMicroId))?.name || ''}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/30 text-[11px] uppercase tracking-wider">
                    {canAssignProducts && (
                      <th className="px-4 py-3 w-10">
                        <button type="button" onClick={toggleSelectAllVisible} className="text-slate-400 hover:text-brand-blue">
                          {products.length > 0 && selectedProductIds.length === products.length
                            ? <CheckSquare size={17} className="text-brand-blue" />
                            : <Square size={17} />}
                        </button>
                      </th>
                    )}
                    <th className="px-4 py-3 font-bold">SKU / Articolo</th>
                    <th className="px-4 py-3 font-bold">Prodotto</th>
                    <th className="px-4 py-3 font-bold">Cliente</th>
                    <th className="px-4 py-3 font-bold">Macro → Micro Categoria</th>
                    <th className="px-4 py-3 font-bold text-right">Giacenza</th>
                    {canAssignProducts && <th className="px-4 py-3 font-bold text-right">Assegna</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-sm">
                  {products.length === 0 ? (
                    <tr>
                      <td colSpan={canAssignProducts ? 7 : 5} className="p-10 text-center text-slate-500 italic">
                        Nessun prodotto corrisponde ai filtri selezionati.
                      </td>
                    </tr>
                  ) : products.map((p) => {
                    const checked = selectedProductIds.includes(p.id);
                    return (
                      <tr key={p.id} className={`hover:bg-slate-800/30 transition-colors ${checked ? 'bg-brand-blue/5' : ''}`}>
                        {canAssignProducts && (
                          <td className="px-4 py-3">
                            <button type="button" onClick={() => toggleProductSelection(p.id)} className="text-slate-400 hover:text-brand-blue">
                              {checked ? <CheckSquare size={17} className="text-brand-blue" /> : <Square size={17} />}
                            </button>
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <div className="font-mono text-xs font-bold text-brand-blue">{p.sku}</div>
                          {p.default_article_number && p.default_article_number !== p.sku && (
                            <div className="text-[10px] text-slate-500 font-mono">Art: {p.default_article_number}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 font-bold text-brand-white">{p.name}</td>
                        <td className="px-4 py-3 text-xs font-semibold text-slate-300">{p.customer_name}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border border-slate-700 bg-slate-950 text-brand-white"
                            >
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: p.macro_category_color || '#64748b' }}
                              />
                              {p.macro_category_name || 'DA IDENTIFICARE'}
                            </span>
                            {p.micro_category_name && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-brand-blue/15 text-brand-blue border border-brand-blue/30">
                                → {p.micro_category_name}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-xs font-mono">
                          {p.stock_quantity > 0 ? (
                            <span className="text-emerald-400 font-bold">
                              {p.stock_quantity} {p.uom} ({p.active_pallets} pal.)
                            </span>
                          ) : (
                            <span className="text-slate-500">0</span>
                          )}
                        </td>
                        {canAssignProducts && (
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                setQuickAssignModal({
                                  show: true,
                                  product: p,
                                  macro_category_id: String(p.macro_category_id || daIdentificareId || ''),
                                  micro_category_id: p.micro_category_id ? String(p.micro_category_id) : ''
                                })
                              }
                              className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-700 hover:border-brand-blue text-xs font-bold text-slate-200 hover:text-brand-blue transition-colors"
                            >
                              Cambia
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Modale Macro Categoria */}
      {macroModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-black text-brand-white mb-4 flex items-center gap-2">
              <Layers size={20} className="text-brand-blue" />
              {macroModal.mode === 'create' ? 'Nuova Macro Categoria' : 'Modifica Macro Categoria'}
            </h3>
            <form onSubmit={handleSaveMacro} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Nome Macro Categoria *
                </label>
                <input
                  required
                  disabled={macroModal.is_system}
                  value={macroModal.name}
                  onChange={e => setMacroModal({ ...macroModal, name: e.target.value })}
                  placeholder="Es. Food, Cosmetica, Farmaceutico..."
                  className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 text-sm disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Colore Badge
                </label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setMacroModal({ ...macroModal, color: c })}
                      className={`w-7 h-7 rounded-full border-2 transition-transform ${
                        macroModal.color === c ? 'border-white scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Descrizione (Opzionale)
                </label>
                <textarea
                  value={macroModal.description}
                  onChange={e => setMacroModal({ ...macroModal, description: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 text-sm h-20 resize-none"
                  placeholder="Note o criteri di classificazione..."
                />
              </div>
              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setMacroModal({ ...macroModal, show: false })}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-brand-white font-bold rounded-xl text-sm"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 py-2.5 bg-brand-blue hover:bg-sky-400 text-brand-black font-black rounded-xl text-sm disabled:opacity-50"
                >
                  Salva
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modale Micro Categoria */}
      {microModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-black text-brand-white mb-4 flex items-center gap-2">
              <Tag size={20} className="text-emerald-400" />
              {microModal.mode === 'create' ? 'Nuova Micro Categoria' : 'Modifica Micro Categoria'}
            </h3>
            <form onSubmit={handleSaveMicro} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Macro Categoria Padre *
                </label>
                <select
                  required
                  value={microModal.macro_category_id}
                  onChange={e => setMicroModal({ ...microModal, macro_category_id: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 text-sm"
                >
                  <option value="" disabled>Seleziona Macro...</option>
                  {macros.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Nome Micro Categoria *
                </label>
                <input
                  required
                  value={microModal.name}
                  onChange={e => setMicroModal({ ...microModal, name: e.target.value })}
                  placeholder="Es. Integratore, Barrette, Creme..."
                  className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Descrizione (Opzionale)
                </label>
                <textarea
                  value={microModal.description}
                  onChange={e => setMicroModal({ ...microModal, description: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 text-sm h-20 resize-none"
                />
              </div>
              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setMicroModal({ ...microModal, show: false })}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-brand-white font-bold rounded-xl text-sm"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 py-2.5 bg-brand-blue hover:bg-sky-400 text-brand-black font-black rounded-xl text-sm disabled:opacity-50"
                >
                  Salva
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modale Cambio Rapido Categoria Singolo Prodotto */}
      {quickAssignModal.show && quickAssignModal.product && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-lg font-black text-brand-white mb-1">Assegna Categoria Prodotto</h3>
            <p className="text-xs text-slate-400 mb-4">
              <strong className="text-brand-blue">{quickAssignModal.product.sku}</strong> — {quickAssignModal.product.name}
            </p>
            <form onSubmit={handleQuickAssignSave} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Macro Categoria
                </label>
                <select
                  value={quickAssignModal.macro_category_id}
                  onChange={e =>
                    setQuickAssignModal(prev => ({
                      ...prev,
                      macro_category_id: e.target.value,
                      micro_category_id: ''
                    }))
                  }
                  className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 text-sm font-bold"
                >
                  {macros.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Micro Categoria (Opzionale)
                </label>
                <select
                  value={quickAssignModal.micro_category_id}
                  onChange={e =>
                    setQuickAssignModal(prev => ({
                      ...prev,
                      micro_category_id: e.target.value
                    }))
                  }
                  disabled={quickAssignMicroOptions.length === 0}
                  className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 text-sm font-bold disabled:opacity-40"
                >
                  <option value="">Nessuna Micro Categoria</option>
                  {quickAssignMicroOptions.map(mic => (
                    <option key={mic.id} value={mic.id}>{mic.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setQuickAssignModal({ show: false, product: null, macro_category_id: '', micro_category_id: '' })}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-brand-white font-bold rounded-xl text-sm"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 py-2.5 bg-brand-blue hover:bg-sky-400 text-brand-black font-black rounded-xl text-sm disabled:opacity-50"
                >
                  Salva Categoria
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductCategories;
