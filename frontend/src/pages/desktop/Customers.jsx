import { appAlert } from "../../utils/alerts.js";
import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Building2, Trash2, Eye, MapPin, Mail, Phone, Hash, Edit2, Copy,
  GitBranch, Coins, ReceiptText, Search, Layers, Package, Boxes, ChevronDown,
  ChevronRight, Sparkles, X, CheckCircle2
} from 'lucide-react';

const CustomersManagement = () => {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('HIERARCHY'); // HIERARCHY, ALL, FRAGMENTS
  const [collapsedParents, setCollapsedParents] = useState({});

  const [showAddModal, setShowAddModal] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    unique_id: '',
    business_name: '',
    vat_number: '',
    address: '',
    phone: '',
    email: '',
    parent_id: ''
  });

  const [fragmentModal, setFragmentModal] = useState({
    show: false,
    parent: null,
    copy_tariffs: true,
    rows: [{ business_name: '', unique_id: '' }]
  });

  const [viewModal, setViewModal] = useState({ show: false, customer: null });
  const [editModal, setEditModal] = useState({ show: false, customer: null });
  const [deleteModal, setDeleteModal] = useState({ show: false, customer: null, confirmText: '' });
  const [isProcessing, setIsProcessing] = useState(false);

  const getToken = () => localStorage.getItem('maglite_token');
  const user = JSON.parse(localStorage.getItem('maglite_user') || '{}');
  const isDeveloperOrBackoffice = user.role === 'developer' || user.role === 'backoffice';

  const fetchCustomers = async () => {
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/customers`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setCustomers(res.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  const parentCustomers = useMemo(() => customers.filter(c => !c.parent_id), [customers]);
  const fragmentCustomers = useMemo(() => customers.filter(c => Boolean(c.parent_id)), [customers]);

  const kpis = useMemo(() => {
    const totalPallets = customers.reduce((acc, c) => acc + (Number(c.active_pallets_count) || 0), 0);
    const totalProducts = customers.reduce((acc, c) => acc + (Number(c.products_count) || 0), 0);
    return {
      parents: parentCustomers.length,
      fragments: fragmentCustomers.length,
      totalPallets,
      totalProducts
    };
  }, [customers, parentCustomers, fragmentCustomers]);

  const childrenByParent = useMemo(() => {
    const map = {};
    customers.forEach(c => {
      if (c.parent_id) {
        if (!map[c.parent_id]) map[c.parent_id] = [];
        map[c.parent_id].push(c);
      }
    });
    return map;
  }, [customers]);

  const filteredHierarchy = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return parentCustomers
      .map(parent => {
        const children = childrenByParent[parent.id] || [];
        if (!q) return { parent, children };

        const parentMatches =
          parent.business_name?.toLowerCase().includes(q) ||
          parent.unique_id?.toLowerCase().includes(q) ||
          parent.vat_number?.toLowerCase().includes(q);

        const matchingChildren = children.filter(ch =>
          ch.business_name?.toLowerCase().includes(q) ||
          ch.unique_id?.toLowerCase().includes(q) ||
          ch.vat_number?.toLowerCase().includes(q)
        );

        if (parentMatches) return { parent, children };
        if (matchingChildren.length > 0) return { parent, children: matchingChildren };
        return null;
      })
      .filter(Boolean);
  }, [parentCustomers, childrenByParent, searchTerm]);

  const filteredFlat = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return customers.filter(c => {
      if (viewMode === 'FRAGMENTS' && !c.parent_id) return false;
      if (!q) return true;
      return (
        c.business_name?.toLowerCase().includes(q) ||
        c.unique_id?.toLowerCase().includes(q) ||
        c.vat_number?.toLowerCase().includes(q) ||
        c.parent_business_name?.toLowerCase().includes(q)
      );
    });
  }, [customers, viewMode, searchTerm]);

  const toggleParentCollapse = (parentId) => {
    setCollapsedParents(prev => ({ ...prev, [parentId]: !prev[parentId] }));
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      await axios.post(`http://${window.location.hostname}:3000/api/customers`, {
        ...newCustomer,
        parent_id: newCustomer.parent_id ? Number(newCustomer.parent_id) : null
      }, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setShowAddModal(false);
      setNewCustomer({ unique_id: '', business_name: '', vat_number: '', address: '', phone: '', email: '', parent_id: '' });
      fetchCustomers();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante la creazione');
    } finally {
      setIsProcessing(false);
    }
  };

  const openFragmentModal = (parent) => {
    setFragmentModal({
      show: true,
      parent,
      copy_tariffs: true,
      rows: [{ business_name: `${parent.business_name} `, unique_id: '' }]
    });
  };

  const addFragmentPreset = (suffix) => {
    if (!fragmentModal.parent) return;
    const baseName = fragmentModal.parent.business_name.trim();
    const fullName = `${baseName} ${suffix}`;
    setFragmentModal(prev => {
      const emptyIdx = prev.rows.findIndex(r => !r.business_name.trim() || r.business_name.trim() === baseName);
      if (emptyIdx !== -1) {
        const updated = [...prev.rows];
        updated[emptyIdx] = { ...updated[emptyIdx], business_name: fullName };
        return { ...prev, rows: updated };
      }
      return {
        ...prev,
        rows: [...prev.rows, { business_name: fullName, unique_id: '' }]
      };
    });
  };

  const handleCreateFragments = async (e) => {
    e.preventDefault();
    if (isProcessing || !fragmentModal.parent) return;
    const validFragments = fragmentModal.rows
      .map(r => ({ business_name: r.business_name.trim(), unique_id: r.unique_id.trim() }))
      .filter(r => r.business_name.length > 0 && r.business_name !== fragmentModal.parent.business_name.trim());

    if (validFragments.length === 0) {
      return appAlert('Inserisci almeno un nome valido per la frammentazione (es. "' + fragmentModal.parent.business_name + ' REPARTO CARNE")');
    }

    setIsProcessing(true);
    try {
      const res = await axios.post(
        `http://${window.location.hostname}:3000/api/customers/${fragmentModal.parent.id}/fragments`,
        {
          fragments: validFragments,
          copy_tariffs: fragmentModal.copy_tariffs
        },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      setFragmentModal({ show: false, parent: null, copy_tariffs: true, rows: [{ business_name: '', unique_id: '' }] });
      await fetchCustomers();
      appAlert(`Create ${res.data.created?.length || validFragments.length} frammentazioni per ${fragmentModal.parent.business_name}! Ogni frammentazione dispone ora del proprio listino prezzi indipendente.`, 'Frammentazione Completata', 'success');
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante la creazione delle frammentazioni');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopyData = (customer) => {
    const data = `Ragione Sociale: ${customer.business_name}
Tipo: ${customer.parent_id ? `Frammentazione di ${customer.parent_business_name}` : 'Cliente Madre'}
Codice Univoco: ${customer.unique_id}
P.IVA/C.F.: ${customer.vat_number || 'Non specificata'}
Indirizzo: ${customer.address || 'Non specificato'}
Telefono: ${customer.phone || 'Non specificato'}
Email: ${customer.email || 'Non specificata'}`;
    navigator.clipboard.writeText(data).then(() => {
      appAlert('Dati copiati negli appunti!');
    }).catch(err => {
      console.error('Errore durante la copia:', err);
    });
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      await axios.put(`http://${window.location.hostname}:3000/api/customers/${editModal.customer.id}`, {
        ...editModal.customer,
        parent_id: editModal.customer.parent_id ? Number(editModal.customer.parent_id) : null
      }, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setEditModal({ show: false, customer: null });
      fetchCustomers();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async () => {
    if (deleteModal.confirmText !== deleteModal.customer.business_name || isProcessing) return;
    setIsProcessing(true);
    try {
      await axios.delete(`http://${window.location.hostname}:3000/api/customers/${deleteModal.customer.id}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      fetchCustomers();
    } catch (err) {
      if (err.response?.status !== 404) {
        appAlert(err.response?.data?.error || 'Errore durante l\'eliminazione');
      }
    } finally {
      setIsProcessing(false);
      setDeleteModal({ show: false, customer: null, confirmText: '' });
    }
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-brand-black min-h-screen">
      <div className="max-w-7xl mx-auto animate-fade-in-up">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-brand-white mb-2 flex items-center gap-3">
              <Building2 className="text-brand-blue" size={32} />
              Anagrafica Clienti & Frammentazioni
            </h1>
            <p className="text-slate-400">
              Gestisci i <span className="text-brand-white font-semibold">Clienti Madre</span> e suddividili in <span className="text-sky-400 font-semibold">Frammentazioni / Reparti</span> con listini prezzi dedicati e pre-fatturazione raggruppata.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => navigate('/desktop/billing-tariffs')}
              className="flex items-center gap-2 px-4 py-3 bg-slate-900 border border-slate-700 text-slate-200 font-bold rounded-xl hover:border-brand-blue hover:text-brand-blue transition-all"
            >
              <Coins size={18} />
              Listini Prezzi
            </button>
            <button
              onClick={() => {
                setNewCustomer({ unique_id: '', business_name: '', vat_number: '', address: '', phone: '', email: '', parent_id: '' });
                setShowAddModal(true);
              }}
              className="flex items-center gap-2 px-5 py-3 bg-brand-blue text-brand-black font-bold rounded-xl hover:bg-sky-400 transition-all shadow-[0_0_20px_rgba(14,165,233,0.2)] active:scale-95"
            >
              <Plus size={20} />
              Nuovo Cliente
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Clienti Madre</p>
              <p className="text-3xl font-black text-white mt-1">{kpis.parents}</p>
              <p className="text-xs text-slate-500 mt-1">Capogruppo fatturazione</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-brand-blue/10 border border-brand-blue/30 flex items-center justify-center text-brand-blue">
              <Building2 size={24} />
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-violet-400">Frammentazioni / Reparti</p>
              <p className="text-3xl font-black text-violet-300 mt-1">{kpis.fragments}</p>
              <p className="text-xs text-slate-500 mt-1">Listini autonomi collegati</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-violet-500/10 border border-violet-500/30 flex items-center justify-center text-violet-400">
              <GitBranch size={24} />
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-400">Palette in Deposito</p>
              <p className="text-3xl font-black text-emerald-300 mt-1">{kpis.totalPallets}</p>
              <p className="text-xs text-slate-500 mt-1">Bancali attivi a magazzino</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Boxes size={24} />
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-amber-400">Referenze / SKU</p>
              <p className="text-3xl font-black text-amber-300 mt-1">{kpis.totalProducts}</p>
              <p className="text-xs text-slate-500 mt-1">Prodotti totali associati</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Package size={24} />
            </div>
          </div>
        </div>

        {/* Search & View Switcher */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 mb-6 flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-4 top-3.5 text-slate-500" size={18} />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Cerca per ragione sociale, reparto/frammentazione, codice SDI o P.IVA..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-11 pr-4 py-3 text-sm text-white focus:border-brand-blue outline-none"
            />
          </div>
          <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 w-full md:w-auto">
            <button
              onClick={() => setViewMode('HIERARCHY')}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
                viewMode === 'HIERARCHY' ? 'bg-brand-blue text-brand-black shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Layers size={15} />
              Gerarchia Madre & Frammentazioni
            </button>
            <button
              onClick={() => setViewMode('ALL')}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                viewMode === 'ALL' ? 'bg-brand-blue text-brand-black shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Tutti ({customers.length})
            </button>
            <button
              onClick={() => setViewMode('FRAGMENTS')}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                viewMode === 'FRAGMENTS' ? 'bg-violet-500 text-white shadow' : 'text-slate-400 hover:text-violet-300'
              }`}
            >
              <GitBranch size={14} />
              Solo Frammentazioni ({fragmentCustomers.length})
            </button>
          </div>
        </div>

        {/* Tabella Clienti */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/60">
                  <th className="p-5 font-semibold uppercase tracking-wider text-xs">Cliente / Frammentazione</th>
                  <th className="p-5 font-semibold uppercase tracking-wider text-xs">Codice / P.IVA</th>
                  <th className="p-5 font-semibold uppercase tracking-wider text-xs">Stato Stock & Listino</th>
                  <th className="p-5 font-semibold uppercase tracking-wider text-xs text-right">Azioni & Fatturazione</th>
                </tr>
              </thead>
              <tbody className="text-brand-white">
                {viewMode === 'HIERARCHY' ? (
                  filteredHierarchy.length === 0 ? (
                    <tr>
                      <td colSpan="4" className="p-12 text-center text-slate-500 italic font-medium">
                        Nessun cliente trovato con i criteri selezionati.
                      </td>
                    </tr>
                  ) : (
                    filteredHierarchy.map(({ parent, children }) => {
                      const isCollapsed = Boolean(collapsedParents[parent.id]);
                      const groupPallets = (Number(parent.active_pallets_count) || 0) + children.reduce((s, c) => s + (Number(c.active_pallets_count) || 0), 0);
                      const groupProducts = (Number(parent.products_count) || 0) + children.reduce((s, c) => s + (Number(c.products_count) || 0), 0);

                      return (
                        <React.Fragment key={parent.id}>
                          {/* RIGA CLIENTE MADRE */}
                          <tr className="border-b border-slate-800/70 bg-slate-900/90 hover:bg-slate-800/40 transition-colors group">
                            <td className="p-5">
                              <div className="flex items-start gap-3">
                                {children.length > 0 ? (
                                  <button
                                    onClick={() => toggleParentCollapse(parent.id)}
                                    className="mt-1 p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-brand-blue transition-colors"
                                    title={isCollapsed ? 'Espandi frammentazioni' : 'Comprimi frammentazioni'}
                                  >
                                    {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                                  </button>
                                ) : (
                                  <div className="mt-1 w-6 h-6 rounded-lg bg-slate-800/60 flex items-center justify-center text-slate-500">
                                    <Building2 size={14} />
                                  </div>
                                )}
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-black text-lg text-white">{parent.business_name}</span>
                                    <span className="px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider rounded-full bg-brand-blue/15 text-brand-blue border border-brand-blue/30">
                                      Cliente Madre
                                    </span>
                                    {children.length > 0 && (
                                      <span className="px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30 flex items-center gap-1">
                                        <GitBranch size={11} /> {children.length} Frammentazion{children.length === 1 ? 'e' : 'i'}
                                      </span>
                                    )}
                                  </div>
                                  {parent.address && (
                                    <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                                      <MapPin size={12} className="text-slate-500" /> {parent.address}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </td>

                            <td className="p-5">
                              <div className="flex flex-col">
                                <span className="text-brand-blue font-mono text-sm font-bold">{parent.unique_id}</span>
                                {parent.vat_number && <span className="text-slate-400 text-xs mt-0.5">P.IVA {parent.vat_number}</span>}
                              </div>
                            </td>

                            <td className="p-5">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-bold">
                                  {Number(parent.active_pallets_count) || 0} Pal. proprie
                                  {children.length > 0 ? ` (${groupPallets} tot. gruppo)` : ''}
                                </span>
                                <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold">
                                  {groupProducts} SKU
                                </span>
                                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                                  Number(parent.custom_tariffs_count) > 0
                                    ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                    : 'bg-slate-800/80 text-slate-400'
                                }`}>
                                  {Number(parent.custom_tariffs_count) > 0 ? `Listino Custom (${parent.custom_tariffs_count})` : 'Listino Default'}
                                </span>
                              </div>
                            </td>

                            <td className="p-5 text-right">
                              <div className="flex flex-wrap justify-end items-center gap-2">
                                {isDeveloperOrBackoffice && (
                                  <button
                                    onClick={() => openFragmentModal(parent)}
                                    className="px-3 py-2 bg-violet-600/20 hover:bg-violet-500 text-violet-300 hover:text-white border border-violet-500/40 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                                    title="Frammenta questo Cliente Madre in più reparti/sotto-clienti"
                                  >
                                    <GitBranch size={14} />
                                    + Frammenta
                                  </button>
                                )}
                                <button
                                  onClick={() => navigate(`/desktop/billing-tariffs?clientId=${parent.id}`)}
                                  className="px-3 py-2 bg-slate-800 hover:bg-amber-500 hover:text-brand-black text-amber-400 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                                  title="Configura Listino Prezzi del Cliente Madre"
                                >
                                  <Coins size={14} />
                                  Listino
                                </button>
                                <button
                                  onClick={() => navigate(`/desktop/billing-dashboard?clientId=${parent.id}`)}
                                  className="px-3 py-2 bg-slate-800 hover:bg-emerald-500 hover:text-brand-black text-emerald-400 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                                  title="Apri Pre-Fatturazione per questo Cliente Madre (con suddivisione per frammentazioni)"
                                >
                                  <ReceiptText size={14} />
                                  Pre-Fattura
                                </button>
                                <button
                                  onClick={() => setViewModal({ show: true, customer: parent })}
                                  className="p-2 bg-slate-800 hover:bg-brand-blue hover:text-brand-black rounded-lg transition-colors text-slate-300"
                                  title="Dettagli Completi"
                                >
                                  <Eye size={16} />
                                </button>
                                {isDeveloperOrBackoffice && (
                                  <button
                                    onClick={() => setEditModal({ show: true, customer: parent })}
                                    className="p-2 bg-slate-800 hover:bg-brand-blue hover:text-brand-black rounded-lg transition-colors text-slate-300"
                                    title="Modifica Cliente"
                                  >
                                    <Edit2 size={16} />
                                  </button>
                                )}
                                {isDeveloperOrBackoffice && (
                                  <button
                                    onClick={() => setDeleteModal({ show: true, customer: parent, confirmText: '' })}
                                    className="p-2 bg-slate-800 hover:bg-rose-500 hover:text-brand-white rounded-lg transition-colors text-slate-300"
                                    title="Elimina Cliente"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>

                          {/* RIGHE FRAMMENTAZIONI FIGLIE */}
                          {!isCollapsed && children.map((child, idx) => (
                            <tr
                              key={child.id}
                              className="border-b border-slate-800/40 bg-slate-950/60 hover:bg-violet-950/20 transition-colors"
                            >
                              <td className="py-3.5 pl-12 pr-5">
                                <div className="flex items-center gap-3">
                                  <span className="text-violet-400 font-mono text-sm select-none">
                                    {idx === children.length - 1 ? '└─' : '├─'}
                                  </span>
                                  <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-bold text-sm text-violet-100">{child.business_name}</span>
                                      <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-md bg-violet-500/15 text-violet-300 border border-violet-500/30">
                                        Frammentazione di {parent.business_name}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </td>

                              <td className="py-3.5 px-5">
                                <span className="text-violet-300 font-mono text-xs font-bold">{child.unique_id}</span>
                              </td>

                              <td className="py-3.5 px-5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 text-xs font-bold">
                                    {Number(child.active_pallets_count) || 0} Palette in deposito
                                  </span>
                                  <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-xs">
                                    {Number(child.products_count) || 0} SKU
                                  </span>
                                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                    Number(child.custom_tariffs_count) > 0
                                      ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                      : 'bg-slate-800 text-slate-400'
                                  }`}>
                                    {Number(child.custom_tariffs_count) > 0
                                      ? `Listino Dedicato (${child.custom_tariffs_count} voci)`
                                      : 'Listino Ereditato / Base'}
                                  </span>
                                </div>
                              </td>

                              <td className="py-3.5 px-5 text-right">
                                <div className="flex justify-end items-center gap-2">
                                  <button
                                    onClick={() => navigate(`/desktop/billing-tariffs?clientId=${child.id}`)}
                                    className="px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500 text-amber-300 hover:text-brand-black border border-amber-500/30 rounded-lg text-xs font-bold transition-all flex items-center gap-1"
                                    title="Personalizza il Listino Prezzi specifico di questa frammentazione"
                                  >
                                    <Coins size={13} />
                                    Listino Reparto
                                  </button>
                                  <button
                                    onClick={() => setViewModal({ show: true, customer: child })}
                                    className="p-1.5 bg-slate-800 hover:bg-brand-blue hover:text-brand-black rounded-lg transition-colors text-slate-300"
                                    title="Dettagli"
                                  >
                                    <Eye size={15} />
                                  </button>
                                  {isDeveloperOrBackoffice && (
                                    <button
                                      onClick={() => setEditModal({ show: true, customer: child })}
                                      className="p-1.5 bg-slate-800 hover:bg-brand-blue hover:text-brand-black rounded-lg transition-colors text-slate-300"
                                      title="Modifica Frammentazione"
                                    >
                                      <Edit2 size={15} />
                                    </button>
                                  )}
                                  {isDeveloperOrBackoffice && (
                                    <button
                                      onClick={() => setDeleteModal({ show: true, customer: child, confirmText: '' })}
                                      className="p-1.5 bg-slate-800 hover:bg-rose-500 hover:text-brand-white rounded-lg transition-colors text-slate-300"
                                      title="Elimina Frammentazione"
                                    >
                                      <Trash2 size={15} />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })
                  )
                ) : (
                  /* VISTA FLAT (ALL / FRAGMENTS) */
                  filteredFlat.length === 0 ? (
                    <tr>
                      <td colSpan="4" className="p-12 text-center text-slate-500 italic font-medium">
                        Nessun elemento trovato.
                      </td>
                    </tr>
                  ) : (
                    filteredFlat.map(c => (
                      <tr key={c.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                        <td className="p-5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-base text-white">{c.business_name}</span>
                            {c.parent_id ? (
                              <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30">
                                Frammentazione di {c.parent_business_name || c.parent_name}
                              </span>
                            ) : (
                              <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase rounded-full bg-brand-blue/15 text-brand-blue border border-brand-blue/30">
                                Cliente Madre
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-5">
                          <div className="flex flex-col">
                            <span className="text-brand-blue font-mono text-sm">{c.unique_id}</span>
                            {c.vat_number && <span className="text-slate-400 text-xs mt-1">P.IVA {c.vat_number}</span>}
                          </div>
                        </td>
                        <td className="p-5">
                          <div className="flex flex-wrap gap-2">
                            <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-300 text-xs font-bold">
                              {Number(c.active_pallets_count) || 0} Palette
                            </span>
                            <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 text-xs">
                              {Number(c.products_count) || 0} SKU
                            </span>
                          </div>
                        </td>
                        <td className="p-5 text-right">
                          <div className="flex justify-end gap-2">
                            {!c.parent_id && isDeveloperOrBackoffice && (
                              <button
                                onClick={() => openFragmentModal(c)}
                                className="px-3 py-2 bg-violet-600/20 hover:bg-violet-500 text-violet-300 hover:text-white rounded-xl text-xs font-bold flex items-center gap-1"
                              >
                                <GitBranch size={14} /> + Frammenta
                              </button>
                            )}
                            <button
                              onClick={() => navigate(`/desktop/billing-tariffs?clientId=${c.id}`)}
                              className="px-3 py-2 bg-slate-800 hover:bg-amber-500 hover:text-brand-black text-amber-400 rounded-xl text-xs font-bold flex items-center gap-1"
                            >
                              <Coins size={14} /> Listino
                            </button>
                            <button onClick={() => setViewModal({ show: true, customer: c })} className="p-2 bg-slate-800 hover:bg-brand-blue hover:text-brand-black rounded-lg text-slate-300">
                              <Eye size={16} />
                            </button>
                            {isDeveloperOrBackoffice && (
                              <button onClick={() => setEditModal({ show: true, customer: c })} className="p-2 bg-slate-800 hover:bg-brand-blue hover:text-brand-black rounded-lg text-slate-300">
                                <Edit2 size={16} />
                              </button>
                            )}
                            {isDeveloperOrBackoffice && (
                              <button onClick={() => setDeleteModal({ show: true, customer: c, confirmText: '' })} className="p-2 bg-slate-800 hover:bg-rose-500 hover:text-brand-white rounded-lg text-slate-300">
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal Frammenta Cliente Madre */}
      {fragmentModal.show && fragmentModal.parent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md overflow-y-auto">
          <div className="bg-slate-900 border border-violet-500/40 rounded-3xl p-8 max-w-3xl w-full shadow-2xl relative my-8 animate-fade-in-up">
            <div className="flex justify-between items-start mb-6">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300 text-xs font-bold uppercase tracking-wider mb-2">
                  <GitBranch size={14} /> Frammentazione Cliente Madre
                </div>
                <h2 className="text-2xl font-black text-white">
                  Frammenta &ldquo;{fragmentModal.parent.business_name}&rdquo;
                </h2>
                <p className="text-sm text-slate-400 mt-1">
                  Crea una o più divisioni/reparti figli. Ogni frammentazione avrà un proprio <b className="text-amber-300">listino prezzi separato</b> e verrà riepilogata in modo distinto nella <b className="text-brand-blue">Pre-Fattura del Cliente Madre</b>.
                </p>
              </div>
              <button
                onClick={() => setFragmentModal({ show: false, parent: null, copy_tariffs: true, rows: [{ business_name: '', unique_id: '' }] })}
                className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateFragments} className="space-y-4">
              <div className="max-h-72 overflow-y-auto space-y-3 pr-1">
                {fragmentModal.rows.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center bg-slate-950/60 border border-slate-800 p-3 rounded-2xl">
                    <div className="md:col-span-7">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                        Nome Frammentazione / Reparto #{idx + 1} *
                      </label>
                      <input
                        type="text"
                        required
                        value={row.business_name}
                        onChange={e => {
                          const updated = [...fragmentModal.rows];
                          updated[idx].business_name = e.target.value;
                          setFragmentModal({ ...fragmentModal, rows: updated });
                        }}
                        placeholder={`Es. ${fragmentModal.parent.business_name} REPARTO CARNE`}
                        className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-sm font-bold focus:border-violet-400 outline-none"
                      />
                    </div>
                    <div className="md:col-span-4">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                        Codice Univoco (Opzionale - Auto)
                      </label>
                      <input
                        type="text"
                        value={row.unique_id}
                        onChange={e => {
                          const updated = [...fragmentModal.rows];
                          updated[idx].unique_id = e.target.value;
                          setFragmentModal({ ...fragmentModal, rows: updated });
                        }}
                        placeholder="Auto-generato se vuoto"
                        className="w-full bg-slate-900 border border-slate-700 text-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-mono focus:border-violet-400 outline-none"
                      />
                    </div>
                    <div className="md:col-span-1 flex justify-end pt-4">
                      {fragmentModal.rows.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            setFragmentModal({
                              ...fragmentModal,
                              rows: fragmentModal.rows.filter((_, i) => i !== idx)
                            });
                          }}
                          className="p-2 text-slate-500 hover:text-rose-400 rounded-lg"
                          title="Rimuovi riga"
                        >
                          <Trash2 size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-between items-center pt-2">
                <button
                  type="button"
                  onClick={() =>
                    setFragmentModal(prev => ({
                      ...prev,
                      rows: [...prev.rows, { business_name: `${prev.parent.business_name} `, unique_id: '' }]
                    }))
                  }
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-violet-300 rounded-xl text-xs font-bold flex items-center gap-1.5"
                >
                  <Plus size={15} /> Aggiungi un&apos;altra riga di frammentazione
                </button>

                <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 font-semibold">
                  <input
                    type="checkbox"
                    checked={fragmentModal.copy_tariffs}
                    onChange={e => setFragmentModal({ ...fragmentModal, copy_tariffs: e.target.checked })}
                    className="rounded border-slate-700 bg-slate-800 text-violet-500 focus:ring-violet-500"
                  />
                  Copia tariffe iniziali dal Cliente Madre (personalizzabili poi singolarmente)
                </label>
              </div>

              <div className="flex gap-4 mt-6 pt-6 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setFragmentModal({ show: false, parent: null, copy_tariffs: true, rows: [{ business_name: '', unique_id: '' }] })}
                  className="flex-1 py-3.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold transition-colors"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={isProcessing}
                  className="flex-1 py-3.5 bg-violet-500 hover:bg-violet-400 text-white rounded-xl font-black transition-all shadow-[0_0_20px_rgba(139,92,246,0.3)] flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <CheckCircle2 size={18} />
                  {isProcessing ? 'Creazione in corso...' : 'Salva Frammentazioni'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Aggiungi Nuovo Cliente */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-10 max-w-2xl w-full shadow-2xl relative my-8 animate-fade-in-up">
            <h2 className="text-2xl font-bold text-brand-white mb-8 flex items-center gap-3">
              <span className="w-10 h-10 bg-brand-blue/20 flex items-center justify-center rounded-xl text-brand-blue">
                <Plus size={24} />
              </span>
              Registra Nuovo Cliente o Frammentazione
            </h2>
            <form onSubmit={handleCreate} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">
                    Tipo Cliente / Appartenenza a Cliente Madre (Opzionale)
                  </label>
                  <select
                    value={newCustomer.parent_id || ''}
                    onChange={e => setNewCustomer({ ...newCustomer, parent_id: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue focus:border-brand-blue transition-all"
                  >
                    <option value="">-- Cliente Madre Principale --</option>
                    {parentCustomers.map(p => (
                      <option key={p.id} value={p.id}>
                        Frammentazione di: {p.business_name} ({p.unique_id})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Ragione Sociale / Nome Reparto *</label>
                  <input required value={newCustomer.business_name} onChange={e => setNewCustomer({ ...newCustomer, business_name: e.target.value })} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue focus:border-brand-blue transition-all" placeholder="Es. LOGISTICA oppure LOGISTICA REPARTO CARNE" />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Codice Univoco / SDI *</label>
                  <input required value={newCustomer.unique_id} onChange={e => setNewCustomer({ ...newCustomer, unique_id: e.target.value })} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue focus:border-brand-blue transition-all font-mono" placeholder="Es. LOG-001" />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Partita IVA / C.F.</label>
                  <input value={newCustomer.vat_number} onChange={e => setNewCustomer({ ...newCustomer, vat_number: e.target.value })} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue focus:border-brand-blue transition-all font-mono" placeholder="Es. IT0123456789" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Indirizzo e Città</label>
                  <input value={newCustomer.address} onChange={e => setNewCustomer({ ...newCustomer, address: e.target.value })} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue focus:border-brand-blue transition-all" placeholder="Via Roma 1, Milano (MI)" />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Telefono</label>
                  <input value={newCustomer.phone} onChange={e => setNewCustomer({ ...newCustomer, phone: e.target.value })} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue focus:border-brand-blue transition-all" placeholder="+39 333..." />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Email Aziendale</label>
                  <input type="email" value={newCustomer.email} onChange={e => setNewCustomer({ ...newCustomer, email: e.target.value })} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue focus:border-brand-blue transition-all" placeholder="info@azienda.it" />
                </div>
              </div>
              <div className="flex gap-4 mt-8 pt-8 border-t border-slate-800/80">
                <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 px-4 py-4 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-xl font-bold transition-colors">Annulla</button>
                <button type="submit" disabled={isProcessing} className="flex-1 px-4 py-4 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-xl font-bold transition-colors shadow-[0_0_20px_rgba(14,165,233,0.3)] disabled:opacity-50">{isProcessing ? 'Salvataggio in corso...' : 'Crea Cliente'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Modifica */}
      {editModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-10 max-w-2xl w-full shadow-2xl relative my-8 animate-fade-in-up">
            <h2 className="text-2xl font-bold text-brand-white mb-8 flex items-center gap-3">
              <span className="w-10 h-10 bg-brand-blue/20 flex items-center justify-center rounded-xl text-brand-blue">
                <Edit2 size={24} />
              </span>
              Modifica Cliente / Frammentazione
            </h2>
            <form onSubmit={handleUpdate} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">
                    Cliente Madre Associato (Lascia vuoto se è un Cliente Madre principale)
                  </label>
                  <select
                    value={editModal.customer?.parent_id || ''}
                    onChange={e => setEditModal({ ...editModal, customer: { ...editModal.customer, parent_id: e.target.value ? Number(e.target.value) : null } })}
                    className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue focus:border-brand-blue transition-all"
                  >
                    <option value="">-- Cliente Madre Principale (Nessun Padre) --</option>
                    {parentCustomers
                      .filter(p => p.id !== editModal.customer?.id)
                      .map(p => (
                        <option key={p.id} value={p.id}>
                          Frammentazione di: {p.business_name} ({p.unique_id})
                        </option>
                      ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Ragione Sociale *</label>
                  <input required value={editModal.customer?.business_name} onChange={e => setEditModal({ ...editModal, customer: { ...editModal.customer, business_name: e.target.value } })} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue focus:border-brand-blue transition-all" />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Codice Univoco / SDI *</label>
                  <input required value={editModal.customer?.unique_id} onChange={e => setEditModal({ ...editModal, customer: { ...editModal.customer, unique_id: e.target.value } })} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue focus:border-brand-blue transition-all font-mono" />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Partita IVA / C.F.</label>
                  <input value={editModal.customer?.vat_number || ''} onChange={e => setEditModal({ ...editModal, customer: { ...editModal.customer, vat_number: e.target.value } })} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue focus:border-brand-blue transition-all font-mono" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Indirizzo e Città</label>
                  <input value={editModal.customer?.address || ''} onChange={e => setEditModal({ ...editModal, customer: { ...editModal.customer, address: e.target.value } })} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue focus:border-brand-blue transition-all" />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Telefono</label>
                  <input value={editModal.customer?.phone || ''} onChange={e => setEditModal({ ...editModal, customer: { ...editModal.customer, phone: e.target.value } })} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue focus:border-brand-blue transition-all" />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Email Aziendale</label>
                  <input type="email" value={editModal.customer?.email || ''} onChange={e => setEditModal({ ...editModal, customer: { ...editModal.customer, email: e.target.value } })} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue focus:border-brand-blue transition-all" />
                </div>
              </div>
              <div className="flex gap-4 mt-8 pt-8 border-t border-slate-800/80">
                <button type="button" onClick={() => setEditModal({ show: false, customer: null })} className="flex-1 px-4 py-4 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-xl font-bold transition-colors">Annulla</button>
                <button type="submit" disabled={isProcessing} className="flex-1 px-4 py-4 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-xl font-bold transition-colors shadow-[0_0_20px_rgba(14,165,233,0.3)] disabled:opacity-50">{isProcessing ? 'Salvataggio in corso...' : 'Salva Modifiche'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal View Details */}
      {viewModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-10 max-w-md w-full shadow-2xl relative animate-fade-in-up">
            <div className="flex justify-between items-start mb-6">
              <div className="w-16 h-16 bg-slate-950 border border-brand-blue/30 rounded-2xl flex items-center justify-center text-brand-blue shadow-inner">
                <Building2 size={32} />
              </div>
              <button onClick={() => handleCopyData(viewModal.customer)} className="p-3 bg-slate-800 hover:bg-brand-blue hover:text-brand-black rounded-xl transition-colors text-slate-300 shadow-sm flex items-center gap-2 font-bold text-sm">
                <Copy size={16} /> Copia Dati
              </button>
            </div>
            <h2 className="text-2xl font-bold text-brand-white mb-2 leading-tight">{viewModal.customer?.business_name}</h2>
            <div className="flex flex-wrap gap-2 mb-6">
              <span className="px-3 py-1 bg-brand-blue/10 text-brand-blue rounded-full font-mono text-xs font-bold">
                ID: {viewModal.customer?.unique_id}
              </span>
              {viewModal.customer?.parent_business_name && (
                <span className="px-3 py-1 bg-violet-500/15 text-violet-300 rounded-full text-xs font-bold">
                  Madre: {viewModal.customer.parent_business_name}
                </span>
              )}
            </div>

            <div className="space-y-5 mb-8 bg-slate-950/50 p-6 rounded-2xl border border-slate-800/50">
              <div className="flex gap-4 text-slate-300">
                <Hash className="text-slate-500 shrink-0 mt-0.5" size={18} />
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Partita IVA / C.F.</p>
                  <p className="font-medium text-brand-white">{viewModal.customer?.vat_number || 'Non specificata'}</p>
                </div>
              </div>
              <div className="flex gap-4 text-slate-300">
                <MapPin className="text-slate-500 shrink-0 mt-0.5" size={18} />
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Indirizzo</p>
                  <p className="font-medium text-brand-white leading-relaxed">{viewModal.customer?.address || 'Non specificato'}</p>
                </div>
              </div>
              <div className="flex gap-4 text-slate-300">
                <Phone className="text-slate-500 shrink-0 mt-0.5" size={18} />
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Telefono</p>
                  <p className="font-medium text-brand-white">{viewModal.customer?.phone || 'Non specificato'}</p>
                </div>
              </div>
              <div className="flex gap-4 text-slate-300">
                <Mail className="text-slate-500 shrink-0 mt-0.5" size={18} />
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Email</p>
                  <p className="font-medium text-brand-white">{viewModal.customer?.email || 'Non specificata'}</p>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  const id = viewModal.customer.id;
                  setViewModal({ show: false, customer: null });
                  navigate(`/desktop/billing-tariffs?clientId=${id}`);
                }}
                className="flex-1 px-4 py-3.5 bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-brand-black rounded-xl font-bold transition-colors flex items-center justify-center gap-2 text-sm"
              >
                <Coins size={16} /> Apri Listino
              </button>
              <button onClick={() => setViewModal({ show: false, customer: null })} className="flex-1 px-4 py-3.5 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-xl font-bold transition-colors text-sm">
                Chiudi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Delete */}
      {deleteModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-10 max-w-sm w-full shadow-2xl border-t-4 border-t-rose-500 animate-fade-in-up">
            <div className="w-16 h-16 bg-rose-950/50 rounded-full flex items-center justify-center text-rose-500 mb-6 mx-auto">
              <Trash2 size={32} />
            </div>
            <h2 className="text-2xl font-bold text-brand-white mb-2 text-center">Elimina Cliente</h2>
            <p className="text-slate-400 text-sm mb-6 text-center leading-relaxed">
              Stai per eliminare <b className="text-rose-400">{deleteModal.customer?.business_name}</b> in modo definitivo.
            </p>
            <div className="bg-rose-950/20 p-4 rounded-xl mb-6 border border-rose-900/30">
              <p className="text-rose-400 text-xs font-bold text-center uppercase tracking-wider mb-2">Conferma di Sicurezza</p>
              <p className="text-rose-200 text-xs font-medium text-center">Digita esattamente il nome per procedere:</p>
            </div>

            <input
              type="text"
              placeholder={deleteModal.customer?.business_name}
              value={deleteModal.confirmText}
              onChange={e => setDeleteModal({ ...deleteModal, confirmText: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 mb-8 font-bold text-center transition-all"
            />

            <div className="flex gap-4">
              <button onClick={() => setDeleteModal({ show: false, customer: null, confirmText: '' })} className="flex-1 px-4 py-4 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-xl font-bold transition-colors">Annulla</button>
              <button
                onClick={handleDelete}
                disabled={deleteModal.confirmText !== deleteModal.customer?.business_name || isProcessing}
                className="flex-1 px-4 py-4 bg-rose-600 hover:bg-rose-500 text-brand-white rounded-xl font-bold disabled:opacity-30 disabled:hover:bg-rose-600 transition-all shadow-[0_0_20px_rgba(225,29,72,0.2)]"
              >
                {isProcessing ? 'Attendi...' : 'Conferma'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomersManagement;
