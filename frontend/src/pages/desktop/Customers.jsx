import { appAlert, appConfirm } from "../../utils/alerts.js";
import { hasPerm } from "../../utils/permissions.js";
import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, Building2, Trash2, MapPin, Mail, Phone, Hash, Edit2, Copy,
  GitBranch, Coins, ReceiptText, Search, Layers, Package, Boxes,
  X, CheckCircle2, Folder, FolderOpen, StickyNote, Loader2,
  LayoutGrid, PanelLeft, Sparkles, ArrowRight, Pin, PinOff, Send, Clock, User,
  FileText, Star, Truck, Cloud
} from 'lucide-react';
import CustomerTariffEditor from '../../components/CustomerTariffEditor';
import CustomerDocumentsTab from '../../components/CustomerDocumentsTab';
import { GlobalPlansModal, NewGlobalServiceModal } from '../../components/GlobalTariffModals';

const CustomersManagement = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [customers, setCustomers] = useState([]);
  const [tariffPlans, setTariffPlans] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState('ALL'); // ALL, WITH_FRAGMENTS, WITH_NOTES
  const [layoutMode, setLayoutMode] = useState('SPLIT'); // SPLIT (cartella aperta) | GRID (griglia cartelle)

  // Cartella aperta (Cliente Madre) ed Entità attiva (Madre o una sua Frammentazione)
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [activeEntityId, setActiveEntityId] = useState(null);
  const [folderTab, setFolderTab] = useState('OVERVIEW'); // OVERVIEW | TARIFFS | FRAGMENTS

  // Note separate con autore, data/ora e pin
  const [entityNotes, setEntityNotes] = useState([]);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);
  const [newNoteText, setNewNoteText] = useState('');
  const [newNotePinned, setNewNotePinned] = useState(false);
  const [isSendingNote, setIsSendingNote] = useState(false);

  // Indirizzi di Consegna multipli + Bolla di Uscita automatica
  const [deliveryAddresses, setDeliveryAddresses] = useState([]);
  const [isLoadingAddresses, setIsLoadingAddresses] = useState(false);
  const [togglingExitDdt, setTogglingExitDdt] = useState(false);
  const [addressModal, setAddressModal] = useState({
    show: false,
    editingId: null,
    label: '',
    address_line: '',
    cap: '',
    city: '',
    province: '',
    country: 'Italia',
    contact_name: '',
    contact_phone: '',
    notes: '',
    is_default: false
  });
  const [savingAddress, setSavingAddress] = useState(false);

  // Modali Globali
  const [showGlobalPlansModal, setShowGlobalPlansModal] = useState(false);
  const [showNewServiceModal, setShowNewServiceModal] = useState(false);

  // Modali Anagrafica
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    unique_id: '',
    business_name: '',
    vat_number: '',
    address: '',
    phone: '',
    email: '',
    notes: '',
    tariff_plan_id: '',
    parent_id: '',
    generate_exit_ddt: true
  });

  const [fragmentModal, setFragmentModal] = useState({
    show: false,
    parent: null,
    copy_tariffs: true,
    rows: [{ business_name: '', unique_id: '', notes: '' }]
  });

  const [editModal, setEditModal] = useState({ show: false, customer: null });
  const [deleteModal, setDeleteModal] = useState({ show: false, customer: null, confirmText: '' });
  const [isProcessing, setIsProcessing] = useState(false);

  const getToken = () => localStorage.getItem('maglite_token');
  const canManageCustomers = hasPerm('customer_manage');
  const canManageGlobalPlans = hasPerm(['tariff_plans_manage', 'finance_manage']);
  const canManageClientTariffs = hasPerm(['client_tariffs_manage', 'finance_manage']);
  const canManageFinance = canManageClientTariffs || canManageGlobalPlans;
  const canViewBilling = hasPerm(['view_billing', 'finance_manage', 'tariff_plans_manage', 'client_tariffs_manage']);

  const fetchAllData = async () => {
    setIsLoading(true);
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      const [custRes, plansRes] = await Promise.all([
        axios.get(`http://${window.location.hostname}:3000/api/customers`, { headers }),
        canViewBilling
          ? axios.get(`http://${window.location.hostname}:3000/api/billing/tariff-plans`, { headers }).catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] })
      ]);
      const list = custRes.data || [];
      setCustomers(list);
      setTariffPlans(plansRes.data || []);

      const paramId = searchParams.get('customerId') || searchParams.get('clientId');
      if (paramId) {
        const target = list.find(c => String(c.id) === String(paramId));
        if (target) {
          setSelectedFolderId(target.parent_id || target.id);
          setActiveEntityId(target.id);
          return;
        }
      }

      const firstParent = list.find(c => !c.parent_id) || list[0];
      setSelectedFolderId(prev => {
        if (prev && list.some(c => c.id === prev && !c.parent_id)) return prev;
        return firstParent ? (firstParent.parent_id || firstParent.id) : null;
      });
      setActiveEntityId(prev => {
        if (prev && list.some(c => c.id === prev)) return prev;
        return firstParent ? firstParent.id : null;
      });
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  const parentCustomers = useMemo(() => customers.filter(c => !c.parent_id), [customers]);
  const fragmentCustomers = useMemo(() => customers.filter(c => Boolean(c.parent_id)), [customers]);

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

  const kpis = useMemo(() => {
    const totalPallets = customers.reduce((acc, c) => acc + (Number(c.active_pallets_count) || 0), 0);
    const totalNotes = customers.reduce((acc, c) => acc + (Number(c.notes_count) || 0), 0);
    return {
      parents: parentCustomers.length,
      fragments: fragmentCustomers.length,
      totalPallets,
      plansCount: tariffPlans.length,
      totalNotes
    };
  }, [customers, parentCustomers, fragmentCustomers, tariffPlans]);

  const filteredFolders = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return parentCustomers
      .map(parent => {
        const children = childrenByParent[parent.id] || [];
        const hasGroupNotes =
          Number(parent.notes_count) > 0 ||
          Boolean(parent.notes?.trim()) ||
          children.some(ch => Number(ch.notes_count) > 0 || Boolean(ch.notes?.trim()));

        if (filterMode === 'WITH_FRAGMENTS' && children.length === 0) return null;
        if (filterMode === 'WITH_NOTES' && !hasGroupNotes) return null;

        if (!q) return { parent, children };

        const parentMatches =
          parent.business_name?.toLowerCase().includes(q) ||
          parent.unique_id?.toLowerCase().includes(q) ||
          parent.vat_number?.toLowerCase().includes(q) ||
          parent.latest_note_preview?.toLowerCase().includes(q) ||
          parent.notes?.toLowerCase().includes(q);

        const matchingChildren = children.filter(ch =>
          ch.business_name?.toLowerCase().includes(q) ||
          ch.unique_id?.toLowerCase().includes(q) ||
          ch.vat_number?.toLowerCase().includes(q) ||
          ch.latest_note_preview?.toLowerCase().includes(q) ||
          ch.notes?.toLowerCase().includes(q)
        );

        if (parentMatches) return { parent, children };
        if (matchingChildren.length > 0) return { parent, children: matchingChildren };
        return null;
      })
      .filter(Boolean);
  }, [parentCustomers, childrenByParent, searchTerm, filterMode]);

  const selectedFolder = useMemo(
    () => parentCustomers.find(p => p.id === selectedFolderId) || null,
    [parentCustomers, selectedFolderId]
  );

  const folderFragments = useMemo(
    () => (selectedFolder ? (childrenByParent[selectedFolder.id] || []) : []),
    [selectedFolder, childrenByParent]
  );

  const activeEntity = useMemo(() => {
    if (!selectedFolder) return null;
    if (activeEntityId && activeEntityId !== selectedFolder.id) {
      const frag = folderFragments.find(f => f.id === activeEntityId);
      if (frag) return frag;
    }
    return selectedFolder;
  }, [selectedFolder, folderFragments, activeEntityId]);

  const fetchEntityNotes = async (entityId) => {
    if (!entityId) {
      setEntityNotes([]);
      return;
    }
    setIsLoadingNotes(true);
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/customers/${entityId}/notes`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setEntityNotes(res.data || []);
    } catch (err) {
      console.error(err);
      setEntityNotes([]);
    } finally {
      setIsLoadingNotes(false);
    }
  };

  const fetchDeliveryAddresses = async (entityId) => {
    if (!entityId) {
      setDeliveryAddresses([]);
      return;
    }
    setIsLoadingAddresses(true);
    try {
      const res = await axios.get(
        `http://${window.location.hostname}:3000/api/customers/${entityId}/delivery-addresses?include_parent=false`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      setDeliveryAddresses(res.data || []);
    } catch (err) {
      console.error(err);
      setDeliveryAddresses([]);
    } finally {
      setIsLoadingAddresses(false);
    }
  };

  useEffect(() => {
    setNewNoteText('');
    setNewNotePinned(false);
    fetchEntityNotes(activeEntity?.id);
    fetchDeliveryAddresses(activeEntity?.id);
  }, [activeEntity?.id]);

  const handleToggleExitDdt = async () => {
    if (!canManageCustomers || !activeEntity || togglingExitDdt) return;
    const nextVal = !(activeEntity.generate_exit_ddt !== undefined ? Boolean(activeEntity.generate_exit_ddt) : true);
    setTogglingExitDdt(true);
    try {
      await axios.put(
        `http://${window.location.hostname}:3000/api/customers/${activeEntity.id}/exit-ddt`,
        { generate_exit_ddt: nextVal },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      setCustomers(prev => prev.map(c => (c.id === activeEntity.id ? { ...c, generate_exit_ddt: nextVal ? 1 : 0 } : c)));
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore aggiornamento impostazione Bolla di Uscita');
    } finally {
      setTogglingExitDdt(false);
    }
  };

  const openNewAddressModal = (copyLegal = false) => {
    setAddressModal({
      show: true,
      editingId: null,
      label: copyLegal ? 'Sede Principale' : '',
      address_line: copyLegal ? (activeEntity?.address || '') : '',
      cap: '',
      city: '',
      province: '',
      country: 'Italia',
      contact_name: '',
      contact_phone: activeEntity?.phone || '',
      notes: '',
      is_default: deliveryAddresses.length === 0
    });
  };

  const openEditAddressModal = (addr) => {
    setAddressModal({
      show: true,
      editingId: addr.id,
      label: addr.label || '',
      address_line: addr.address_line || '',
      cap: addr.cap || '',
      city: addr.city || '',
      province: addr.province || '',
      country: addr.country || 'Italia',
      contact_name: addr.contact_name || '',
      contact_phone: addr.contact_phone || '',
      notes: addr.notes || '',
      is_default: Boolean(addr.is_default)
    });
  };

  const handleSaveAddress = async (e) => {
    e.preventDefault();
    if (!activeEntity || savingAddress) return;
    setSavingAddress(true);
    try {
      const payload = {
        label: addressModal.label,
        address_line: addressModal.address_line,
        cap: addressModal.cap,
        city: addressModal.city,
        province: addressModal.province,
        country: addressModal.country || 'Italia',
        contact_name: addressModal.contact_name,
        contact_phone: addressModal.contact_phone,
        notes: addressModal.notes,
        is_default: addressModal.is_default
      };
      if (addressModal.editingId) {
        await axios.put(
          `http://${window.location.hostname}:3000/api/customers/${activeEntity.id}/delivery-addresses/${addressModal.editingId}`,
          payload,
          { headers: { Authorization: `Bearer ${getToken()}` } }
        );
      } else {
        await axios.post(
          `http://${window.location.hostname}:3000/api/customers/${activeEntity.id}/delivery-addresses`,
          payload,
          { headers: { Authorization: `Bearer ${getToken()}` } }
        );
      }
      setAddressModal(prev => ({ ...prev, show: false }));
      await Promise.all([fetchDeliveryAddresses(activeEntity.id), fetchAllData()]);
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore salvataggio indirizzo di consegna');
    } finally {
      setSavingAddress(false);
    }
  };

  const handleSetDefaultAddress = async (addr) => {
    if (!activeEntity || !addr) return;
    try {
      await axios.put(
        `http://${window.location.hostname}:3000/api/customers/${activeEntity.id}/delivery-addresses/${addr.id}`,
        { is_default: true },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      await fetchDeliveryAddresses(activeEntity.id);
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore aggiornamento predefinito');
    }
  };

  const handleDeleteAddress = async (addr) => {
    if (!activeEntity || !addr) return;
    if (!(await appConfirm(`Eliminare l'indirizzo "${addr.label}"?`))) return;
    try {
      await axios.delete(
        `http://${window.location.hostname}:3000/api/customers/${activeEntity.id}/delivery-addresses/${addr.id}`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      await Promise.all([fetchDeliveryAddresses(activeEntity.id), fetchAllData()]);
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore eliminazione indirizzo');
    }
  };

  const openFolder = (parentId, entityId = null, targetTab = null) => {
    setSelectedFolderId(parentId);
    setActiveEntityId(entityId || parentId);
    if (targetTab) setFolderTab(targetTab);
    setLayoutMode('SPLIT');
    setSearchParams({ customerId: entityId || parentId });
  };

  const handleAddNote = async (e) => {
    if (e) e.preventDefault();
    if (!canManageCustomers || !activeEntity || isSendingNote) return;
    const trimmed = newNoteText.trim();
    if (!trimmed) return;

    setIsSendingNote(true);
    try {
      await axios.post(
        `http://${window.location.hostname}:3000/api/customers/${activeEntity.id}/notes`,
        { content: trimmed, is_pinned: newNotePinned },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      setNewNoteText('');
      setNewNotePinned(false);
      await Promise.all([fetchEntityNotes(activeEntity.id), fetchAllData()]);
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante l\'invio della nota');
    } finally {
      setIsSendingNote(false);
    }
  };

  const handleTogglePinNote = async (note) => {
    if (!canManageCustomers || !activeEntity || !note) return;
    try {
      await axios.put(
        `http://${window.location.hostname}:3000/api/customers/${activeEntity.id}/notes/${note.id}/pin`,
        { is_pinned: !note.is_pinned },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      await Promise.all([fetchEntityNotes(activeEntity.id), fetchAllData()]);
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante l\'aggiornamento del pin');
    }
  };

  const handleDeleteNote = async (note) => {
    if (!canManageCustomers || !activeEntity || !note) return;
    const ok = await appConfirm('Eliminare definitivamente questa nota dalla cartella?');
    if (!ok) return;
    try {
      await axios.delete(
        `http://${window.location.hostname}:3000/api/customers/${activeEntity.id}/notes/${note.id}`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      await Promise.all([fetchEntityNotes(activeEntity.id), fetchAllData()]);
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante l\'eliminazione della nota');
    }
  };

  const formatNoteTimestamp = (dt) => {
    if (!dt) return '';
    const d = new Date(dt);
    if (isNaN(d.getTime())) return '';
    const dateStr = d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    return `${dateStr} • ${timeStr}`;
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      const res = await axios.post(
        `http://${window.location.hostname}:3000/api/customers`,
        {
          ...newCustomer,
          parent_id: newCustomer.parent_id ? Number(newCustomer.parent_id) : null,
          tariff_plan_id: newCustomer.tariff_plan_id ? Number(newCustomer.tariff_plan_id) : null
        },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      setShowAddModal(false);
      const createdParentId = newCustomer.parent_id ? Number(newCustomer.parent_id) : res.data?.id;
      const createdId = res.data?.id;
      setNewCustomer({
        unique_id: '',
        business_name: '',
        vat_number: '',
        address: '',
        phone: '',
        email: '',
        notes: '',
        tariff_plan_id: '',
        parent_id: '',
        generate_exit_ddt: true
      });
      await fetchAllData();
      if (createdParentId) {
        openFolder(createdParentId, createdId);
      }
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
      rows: [{ business_name: `${parent.business_name} `, unique_id: '', notes: '' }]
    });
  };

  const handleCreateFragments = async (e) => {
    e.preventDefault();
    if (isProcessing || !fragmentModal.parent) return;
    const validFragments = fragmentModal.rows
      .map(r => ({
        business_name: r.business_name.trim(),
        unique_id: r.unique_id.trim(),
        notes: r.notes?.trim() || ''
      }))
      .filter(r => r.business_name.length > 0 && r.business_name !== fragmentModal.parent.business_name.trim());

    if (validFragments.length === 0) {
      return appAlert(`Inserisci almeno un nome valido per la frammentazione (es. "${fragmentModal.parent.business_name} REPARTO CARNE")`);
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
      const parentId = fragmentModal.parent.id;
      const firstCreatedId = res.data?.created?.[0]?.id;
      setFragmentModal({ show: false, parent: null, copy_tariffs: true, rows: [{ business_name: '', unique_id: '', notes: '' }] });
      await fetchAllData();
      openFolder(parentId, firstCreatedId || parentId);
      appAlert(
        `Create ${res.data.created?.length || validFragments.length} frammentazioni nella cartella di ${fragmentModal.parent.business_name}!`,
        'Frammentazione Completata',
        'success'
      );
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante la creazione delle frammentazioni');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopyData = (customer) => {
    if (!customer) return;
    const data = `Ragione Sociale: ${customer.business_name}
Tipo: ${customer.parent_id ? `Frammentazione di ${customer.parent_business_name}` : 'Cliente Madre'}
Codice Univoco: ${customer.unique_id}
P.IVA/C.F.: ${customer.vat_number || 'Non specificata'}
Indirizzo: ${customer.address || 'Non specificato'}
Telefono: ${customer.phone || 'Non specificato'}
Email: ${customer.email || 'Non specificata'}
Note: ${customer.notes || 'Nessuna'}`;
    navigator.clipboard.writeText(data).then(() => {
      appAlert('Dati copiati negli appunti!', 'Copiato', 'success');
    }).catch(() => {});
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    if (isProcessing || !editModal.customer) return;
    setIsProcessing(true);
    try {
      await axios.put(
        `http://${window.location.hostname}:3000/api/customers/${editModal.customer.id}`,
        {
          ...editModal.customer,
          parent_id: editModal.customer.parent_id ? Number(editModal.customer.parent_id) : null
        },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      setEditModal({ show: false, customer: null });
      await fetchAllData();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante la modifica');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteModal.customer || deleteModal.confirmText !== deleteModal.customer.business_name || isProcessing) return;
    setIsProcessing(true);
    const deletedWasParent = !deleteModal.customer.parent_id;
    const parentId = deleteModal.customer.parent_id;
    try {
      await axios.delete(`http://${window.location.hostname}:3000/api/customers/${deleteModal.customer.id}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setDeleteModal({ show: false, customer: null, confirmText: '' });
      if (deletedWasParent && selectedFolderId === deleteModal.customer.id) {
        setSelectedFolderId(null);
        setActiveEntityId(null);
      } else if (!deletedWasParent && activeEntityId === deleteModal.customer.id) {
        setActiveEntityId(parentId);
      }
      await fetchAllData();
    } catch (err) {
      if (err.response?.status !== 404) {
        appAlert(err.response?.data?.error || 'Errore durante l\'eliminazione');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-brand-black min-h-screen">
      <div className="max-w-[1600px] mx-auto animate-fade-in-up">
        {/* Header Principale */}
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-black text-brand-white flex items-center gap-3">
              <span className="w-11 h-11 rounded-2xl bg-brand-blue/15 border border-brand-blue/30 flex items-center justify-center text-brand-blue">
                <FolderOpen size={24} />
              </span>
              Cartelle Clienti, Frammentazioni & Listini
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Ogni <b className="text-white">Cartella Cliente</b> racchiude anagrafica, <b className="text-amber-300">note operative</b>, <b className="text-violet-300">frammentazioni</b> e <b className="text-emerald-400">listini prezzi dedicati</b>.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {canManageFinance && (
              <>
                <button
                  onClick={() => setShowNewServiceModal(true)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500 hover:text-brand-black font-bold rounded-xl text-xs transition-all"
                >
                  <Sparkles size={15} />
                  + Servizio Globale (€0)
                </button>
                <button
                  onClick={() => setShowGlobalPlansModal(true)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 border border-slate-700 text-brand-blue hover:border-brand-blue font-bold rounded-xl text-xs transition-all"
                >
                  <Layers size={15} />
                  Listini Globali ({kpis.plansCount})
                </button>
              </>
            )}

            <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1">
              <button
                onClick={() => setLayoutMode('SPLIT')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                  layoutMode === 'SPLIT' ? 'bg-brand-blue text-brand-black shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                <PanelLeft size={14} /> Cartella Aperta
              </button>
              <button
                onClick={() => setLayoutMode('GRID')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                  layoutMode === 'GRID' ? 'bg-brand-blue text-brand-black shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                <LayoutGrid size={14} /> Tutte le Cartelle
              </button>
            </div>

            {canManageCustomers && (
              <button
                onClick={() => {
                  const defPlan = tariffPlans.find(p => p.is_default);
                  setNewCustomer({
                    unique_id: '',
                    business_name: '',
                    vat_number: '',
                    address: '',
                    phone: '',
                    email: '',
                    notes: '',
                    tariff_plan_id: defPlan ? String(defPlan.id) : '',
                    parent_id: ''
                  });
                  setShowAddModal(true);
                }}
                className="flex items-center gap-2 px-5 py-2.5 bg-brand-blue text-brand-black font-black rounded-xl text-xs hover:bg-sky-400 transition-all shadow-[0_0_20px_rgba(14,165,233,0.25)] active:scale-95"
              >
                <Plus size={17} />
                Nuova Cartella Cliente
              </button>
            )}
          </div>
        </div>

        {/* KPI Bar compatta */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl px-4 py-3.5 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Cartelle Clienti</p>
              <p className="text-2xl font-black text-white mt-0.5">{kpis.parents}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-brand-blue/10 border border-brand-blue/30 flex items-center justify-center text-brand-blue">
              <Folder size={20} />
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl px-4 py-3.5 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-violet-400">Frammentazioni</p>
              <p className="text-2xl font-black text-violet-300 mt-0.5">{kpis.fragments}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/30 flex items-center justify-center text-violet-400">
              <GitBranch size={20} />
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl px-4 py-3.5 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Palette in Deposito</p>
              <p className="text-2xl font-black text-emerald-300 mt-0.5">{kpis.totalPallets}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Boxes size={20} />
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl px-4 py-3.5 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Note & Listini</p>
              <p className="text-2xl font-black text-amber-300 mt-0.5">{kpis.totalNotes} <span className="text-xs font-semibold text-slate-400">note • {kpis.plansCount} listini</span></p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <StickyNote size={20} />
            </div>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 mb-5 flex flex-col md:flex-row gap-3 items-center justify-between">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3.5 top-3 text-slate-500" size={17} />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Cerca cartella cliente, frammentazione, codice SDI, P.IVA o testo nelle note..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white focus:border-brand-blue outline-none"
            />
          </div>
          <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 w-full md:w-auto">
            {[
              { id: 'ALL', label: `Tutte (${parentCustomers.length})` },
              { id: 'WITH_FRAGMENTS', label: 'Con Frammentazioni' },
              { id: 'WITH_NOTES', label: 'Con Note' }
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setFilterMode(f.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  filterMode === f.id ? 'bg-slate-800 text-brand-blue' : 'text-slate-400 hover:text-white'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="py-20 flex flex-col items-center justify-center text-brand-blue">
            <Loader2 className="animate-spin mb-3" size={36} />
            <p className="text-sm font-bold">Caricamento cartelle clienti...</p>
          </div>
        ) : layoutMode === 'GRID' ? (
          /* ================= VISTA GRIGLIA CARTELLE ================= */
          filteredFolders.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-16 text-center text-slate-500">
              Nessuna cartella cliente trovata.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {filteredFolders.map(({ parent, children }) => {
                const groupPallets = (Number(parent.active_pallets_count) || 0) + children.reduce((s, c) => s + (Number(c.active_pallets_count) || 0), 0);
                const groupProducts = (Number(parent.products_count) || 0) + children.reduce((s, c) => s + (Number(c.products_count) || 0), 0);
                const groupNotesCount = (Number(parent.notes_count) || 0) + children.reduce((s, c) => s + (Number(c.notes_count) || 0), 0);
                const hasAnyNotes = groupNotesCount > 0 || Boolean(parent.notes?.trim()) || children.some(c => Boolean(c.notes?.trim()));
                const cardNotePreview = parent.latest_note_preview || parent.notes;

                return (
                  <div
                    key={parent.id}
                    onClick={() => openFolder(parent.id, parent.id, 'OVERVIEW')}
                    className="group cursor-pointer relative bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-brand-blue/60 rounded-3xl p-5 transition-all shadow-lg hover:shadow-[0_0_25px_rgba(14,165,233,0.12)] flex flex-col justify-between"
                  >
                    {/* Folder top tab accent */}
                    <div className="absolute -top-2.5 left-6 px-3 py-0.5 rounded-t-xl bg-slate-800 group-hover:bg-brand-blue text-slate-300 group-hover:text-brand-black text-[10px] font-black uppercase tracking-wider border border-b-0 border-slate-700 group-hover:border-brand-blue transition-colors">
                      {parent.unique_id}
                    </div>

                    <div className="pt-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="w-11 h-11 rounded-2xl bg-brand-blue/10 border border-brand-blue/30 flex items-center justify-center text-brand-blue shrink-0 group-hover:scale-105 transition-transform">
                            <Folder size={22} />
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-black text-base text-white truncate group-hover:text-brand-blue transition-colors">
                              {parent.business_name}
                            </h3>
                            <div className="text-xs text-slate-400 truncate">
                              {parent.vat_number ? `P.IVA ${parent.vat_number}` : (parent.address || 'Cliente Madre')}
                            </div>
                          </div>
                        </div>
                        <ArrowRight size={17} className="text-slate-600 group-hover:text-brand-blue shrink-0 mt-1 transition-colors" />
                      </div>

                      {/* Badges */}
                      <div className="flex flex-wrap gap-1.5 mt-4">
                        <span className="px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-[11px] font-bold">
                          {groupPallets} Palette
                        </span>
                        <span className="px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300 text-[11px] font-semibold">
                          {groupProducts} SKU
                        </span>
                        {children.length > 0 && (
                          <span className="px-2 py-0.5 rounded-lg bg-violet-500/15 border border-violet-500/30 text-violet-300 text-[11px] font-bold flex items-center gap-1">
                            <GitBranch size={11} /> {children.length} Frammentaz.
                          </span>
                        )}
                        {parent.tariff_plan_name && (
                          <span className="px-2 py-0.5 rounded-lg bg-brand-blue/15 border border-brand-blue/30 text-brand-blue text-[11px] font-bold">
                            {parent.tariff_plan_name}
                          </span>
                        )}
                        {hasAnyNotes && (
                          <span className="px-2 py-0.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] font-bold flex items-center gap-1">
                            <StickyNote size={11} /> {groupNotesCount > 0 ? `${groupNotesCount} Note` : 'Note'}
                          </span>
                        )}
                      </div>

                      {cardNotePreview && (
                        <p className="mt-3 text-xs text-slate-400 bg-slate-950/60 border border-slate-800/80 rounded-xl px-3 py-2 line-clamp-2">
                          {cardNotePreview}
                        </p>
                      )}

                      {children.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-slate-800/80 flex flex-wrap gap-1.5">
                          {children.slice(0, 4).map(ch => (
                            <button
                              key={ch.id}
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                openFolder(parent.id, ch.id, 'OVERVIEW');
                              }}
                              className="px-2 py-1 rounded-lg bg-slate-950 hover:bg-violet-500/20 border border-slate-800 hover:border-violet-500/40 text-[11px] text-violet-200 font-semibold truncate max-w-[160px]"
                            >
                              └ {ch.business_name}
                            </button>
                          ))}
                          {children.length > 4 && (
                            <span className="px-2 py-1 text-[11px] text-slate-500 font-bold">
                              +{children.length - 4} altre
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          /* ================= VISTA CARTELLA APERTA (MASTER-DETAIL) ================= */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Sidebar Directory Cartelle (4/12) */}
            <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-3xl p-4 shadow-xl lg:sticky lg:top-6 max-h-[82vh] flex flex-col">
              <div className="flex items-center justify-between px-2 pb-3 mb-3 border-b border-slate-800">
                <span className="text-xs font-black uppercase tracking-wider text-slate-400">
                  Elenco Cartelle ({filteredFolders.length})
                </span>
                <span className="text-[11px] text-slate-500">Seleziona per aprire</span>
              </div>

              <div className="space-y-2 overflow-y-auto pr-1 flex-1">
                {filteredFolders.length === 0 ? (
                  <div className="py-10 text-center text-xs text-slate-500">Nessuna cartella trovata.</div>
                ) : (
                  filteredFolders.map(({ parent, children }) => {
                    const isOpen = selectedFolder?.id === parent.id;
                    const groupPallets = (Number(parent.active_pallets_count) || 0) + children.reduce((s, c) => s + (Number(c.active_pallets_count) || 0), 0);
                    const hasNotes = Number(parent.notes_count) > 0 || Boolean(parent.notes?.trim()) || children.some(ch => Number(ch.notes_count) > 0 || Boolean(ch.notes?.trim()));

                    return (
                      <div
                        key={parent.id}
                        className={`rounded-2xl border transition-all overflow-hidden ${
                          isOpen
                            ? 'bg-brand-blue/10 border-brand-blue/50 shadow-[0_0_20px_rgba(14,165,233,0.1)]'
                            : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => openFolder(parent.id, parent.id)}
                          className="w-full text-left p-3.5 flex items-start gap-3"
                        >
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                            isOpen
                              ? 'bg-brand-blue text-brand-black border-brand-blue'
                              : 'bg-slate-900 text-brand-blue border-slate-800'
                          }`}>
                            {isOpen ? <FolderOpen size={18} /> : <Folder size={18} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-sm text-white truncate">{parent.business_name}</span>
                              {hasNotes && <StickyNote size={13} className="text-amber-400 shrink-0" title="Contiene note" />}
                            </div>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <span className="text-[10px] font-mono font-bold text-brand-blue">{parent.unique_id}</span>
                              <span className="text-[10px] text-emerald-400 font-bold">{groupPallets} pal.</span>
                              {children.length > 0 && (
                                <span className="text-[10px] text-violet-300 font-bold flex items-center gap-0.5">
                                  <GitBranch size={10} /> {children.length}
                                </span>
                              )}
                              {parent.tariff_plan_name && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-sky-300 font-semibold truncate max-w-[110px]">
                                  {parent.tariff_plan_name}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>

                        {/* Sotto-voci frammentazioni rapide quando la cartella è aperta */}
                        {isOpen && children.length > 0 && (
                          <div className="px-3 pb-3 pt-1 border-t border-slate-800/60 space-y-1 bg-slate-950/50">
                            {children.map(ch => {
                              const isFragActive = activeEntity?.id === ch.id;
                              return (
                                <button
                                  key={ch.id}
                                  type="button"
                                  onClick={() => openFolder(parent.id, ch.id)}
                                  className={`w-full text-left px-2.5 py-1.5 rounded-xl text-xs flex items-center justify-between gap-2 transition-all ${
                                    isFragActive
                                      ? 'bg-violet-500 text-white font-bold shadow'
                                      : 'text-slate-300 hover:bg-slate-800/80'
                                  }`}
                                >
                                  <span className="truncate flex items-center gap-1.5">
                                    <GitBranch size={11} className={isFragActive ? 'text-white' : 'text-violet-400'} />
                                    {ch.business_name}
                                  </span>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {ch.notes?.trim() && <StickyNote size={11} className={isFragActive ? 'text-amber-200' : 'text-amber-400'} />}
                                    <span className={`text-[10px] font-mono ${isFragActive ? 'text-violet-100' : 'text-slate-500'}`}>
                                      {Number(ch.active_pallets_count) || 0}p
                                    </span>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Pannello Cartella Aperta (8/12) */}
            <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-3xl shadow-xl overflow-hidden">
              {!selectedFolder || !activeEntity ? (
                <div className="p-16 text-center text-slate-500">
                  <FolderOpen size={44} className="mx-auto mb-3 text-slate-700" />
                  <p className="font-bold text-slate-300">Nessuna cartella selezionata</p>
                  <p className="text-xs mt-1">Seleziona un cliente dall&apos;elenco a sinistra oppure crea una nuova cartella cliente.</p>
                </div>
              ) : (
                <>
                  {/* Header Cartella */}
                  <div className="p-6 border-b border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950">
                    <div className="flex flex-col md:flex-row justify-between items-start gap-4">
                      <div className="flex items-start gap-4 min-w-0">
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 border ${
                          activeEntity.parent_id
                            ? 'bg-violet-500/15 border-violet-500/40 text-violet-300'
                            : 'bg-brand-blue/15 border-brand-blue/40 text-brand-blue'
                        }`}>
                          {activeEntity.parent_id ? <GitBranch size={26} /> : <FolderOpen size={26} />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="text-2xl font-black text-white truncate">{activeEntity.business_name}</h2>
                            {activeEntity.parent_id ? (
                              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-violet-500/20 text-violet-300 border border-violet-500/30">
                                Frammentazione di {selectedFolder.business_name}
                              </span>
                            ) : (
                              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-brand-blue/15 text-brand-blue border border-brand-blue/30">
                                Cliente Madre
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-slate-400">
                            <span className="font-mono font-bold text-brand-blue">COD: {activeEntity.unique_id}</span>
                            {activeEntity.vat_number && <span>P.IVA: <b className="text-slate-200">{activeEntity.vat_number}</b></span>}
                            {activeEntity.tariff_plan_name && (
                              <span className="px-2 py-0.5 rounded-md bg-brand-blue/10 text-brand-blue border border-brand-blue/25 font-bold text-[11px]">
                                Listino: {activeEntity.tariff_plan_name}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleCopyData(activeEntity)}
                          className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-colors"
                          title="Copia dati negli appunti"
                        >
                          <Copy size={16} />
                        </button>
                        {canViewBilling && (
                          <button
                            onClick={() => navigate(`/desktop/billing-dashboard?clientId=${selectedFolder.id}`)}
                            className="px-3.5 py-2 bg-emerald-500/15 hover:bg-emerald-500 text-emerald-300 hover:text-brand-black border border-emerald-500/30 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                          >
                            <ReceiptText size={14} /> Pre-Fattura
                          </button>
                        )}
                        {canManageCustomers && (
                          <>
                            <button
                              onClick={() => setEditModal({ show: true, customer: { ...activeEntity } })}
                              className="px-3.5 py-2 bg-slate-800 hover:bg-brand-blue hover:text-brand-black text-slate-200 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                            >
                              <Edit2 size={14} /> Modifica
                            </button>
                            <button
                              onClick={() => setDeleteModal({ show: true, customer: activeEntity, confirmText: '' })}
                              className="p-2.5 bg-slate-800 hover:bg-rose-500 text-slate-400 hover:text-white rounded-xl transition-colors"
                              title="Elimina"
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Switcher Rapido Madre + Frammentazioni dentro la Cartella */}
                    <div className="mt-5 pt-4 border-t border-slate-800/80 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openFolder(selectedFolder.id, selectedFolder.id)}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border ${
                          activeEntity.id === selectedFolder.id
                            ? 'bg-brand-blue text-brand-black border-brand-blue shadow'
                            : 'bg-slate-950/70 text-slate-300 border-slate-800 hover:border-slate-600'
                        }`}
                      >
                        <Building2 size={14} />
                        {selectedFolder.business_name} (Madre)
                      </button>

                      {folderFragments.map(frag => {
                        const isActive = activeEntity.id === frag.id;
                        return (
                          <button
                            key={frag.id}
                            type="button"
                            onClick={() => openFolder(selectedFolder.id, frag.id)}
                            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border ${
                              isActive
                                ? 'bg-violet-500 text-white border-violet-400 shadow'
                                : 'bg-slate-950/70 text-violet-200 border-slate-800 hover:border-violet-500/40'
                            }`}
                          >
                            <GitBranch size={13} />
                            {frag.business_name}
                            {(Number(frag.notes_count) > 0 || frag.notes?.trim()) && (
                              <StickyNote size={11} className={isActive ? 'text-amber-200' : 'text-amber-400'} />
                            )}
                          </button>
                        );
                      })}

                      {canManageCustomers && (
                        <button
                          type="button"
                          onClick={() => openFragmentModal(selectedFolder)}
                          className="px-3 py-2 rounded-xl text-xs font-bold bg-violet-500/15 hover:bg-violet-500 text-violet-300 hover:text-white border border-violet-500/30 transition-all flex items-center gap-1"
                        >
                          <Plus size={14} /> Frammenta
                        </button>
                      )}
                    </div>

                    {/* Tab Navigation dentro la Cartella */}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setFolderTab('OVERVIEW')}
                        className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${
                          folderTab === 'OVERVIEW'
                            ? 'bg-white text-brand-black shadow'
                            : 'bg-slate-950/60 text-slate-400 hover:text-white border border-slate-800'
                        }`}
                      >
                        <StickyNote size={14} />
                        Anagrafica & Note
                        {entityNotes.length > 0 && (
                          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-black ${
                            folderTab === 'OVERVIEW' ? 'bg-amber-500 text-brand-black' : 'bg-amber-500/20 text-amber-300'
                          }`}>
                            {entityNotes.length}
                          </span>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => setFolderTab('TARIFFS')}
                        className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${
                          folderTab === 'TARIFFS'
                            ? 'bg-amber-400 text-brand-black shadow'
                            : 'bg-slate-950/60 text-slate-400 hover:text-white border border-slate-800'
                        }`}
                      >
                        <Coins size={14} />
                        Listino Prezzi & Servizi
                      </button>

                      <button
                        type="button"
                        onClick={() => setFolderTab('FRAGMENTS')}
                        className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${
                          folderTab === 'FRAGMENTS'
                            ? 'bg-violet-500 text-white shadow'
                            : 'bg-slate-950/60 text-slate-400 hover:text-white border border-slate-800'
                        }`}
                      >
                        <GitBranch size={14} />
                        Frammentazioni ({folderFragments.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setFolderTab('FILES')}
                        className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${
                          folderTab === 'FILES'
                            ? 'bg-sky-500 text-brand-black shadow'
                            : 'bg-slate-950/60 text-slate-400 hover:text-white border border-slate-800'
                        }`}
                      >
                        <Cloud size={14} />
                        File & Documenti (R2)
                      </button>
                    </div>
                  </div>

                  {/* Corpo Tab Selezionato */}
                  <div className="p-6">
                    {folderTab === 'OVERVIEW' && (
                      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
                        {/* Anagrafica & Stock */}
                        <div className="xl:col-span-6 space-y-4">
                          <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-5 space-y-4">
                            <div className="flex items-center justify-between">
                              <h3 className="text-xs font-black uppercase tracking-wider text-slate-400">
                                Dati Aziendali & Contatti
                              </h3>
                              {canManageCustomers && (
                                <button
                                  type="button"
                                  onClick={() => setEditModal({ show: true, customer: { ...activeEntity } })}
                                  className="text-xs font-bold text-brand-blue hover:underline flex items-center gap-1"
                                >
                                  <Edit2 size={12} /> Modifica
                                </button>
                              )}
                            </div>

                            <div className="space-y-3 text-sm">
                              <div className="flex items-start gap-3">
                                <Hash size={16} className="text-slate-500 mt-0.5 shrink-0" />
                                <div>
                                  <div className="text-[10px] uppercase font-bold text-slate-500">Partita IVA / C.F.</div>
                                  <div className="text-white font-semibold">{activeEntity.vat_number || 'Non specificata'}</div>
                                </div>
                              </div>
                              <div className="flex items-start gap-3">
                                <MapPin size={16} className="text-slate-500 mt-0.5 shrink-0" />
                                <div>
                                  <div className="text-[10px] uppercase font-bold text-slate-500">Indirizzo</div>
                                  <div className="text-white font-semibold">{activeEntity.address || 'Non specificato'}</div>
                                </div>
                              </div>
                              <div className="flex items-start gap-3">
                                <Phone size={16} className="text-slate-500 mt-0.5 shrink-0" />
                                <div>
                                  <div className="text-[10px] uppercase font-bold text-slate-500">Telefono</div>
                                  <div className="text-white font-semibold">{activeEntity.phone || 'Non specificato'}</div>
                                </div>
                              </div>
                              <div className="flex items-start gap-3">
                                <Mail size={16} className="text-slate-500 mt-0.5 shrink-0" />
                                <div>
                                  <div className="text-[10px] uppercase font-bold text-slate-500">Email</div>
                                  <div className="text-white font-semibold">{activeEntity.email || 'Non specificata'}</div>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Statistiche Rapide */}
                          <div className="grid grid-cols-3 gap-3">
                            <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4">
                              <div className="text-[10px] font-bold uppercase text-slate-500">Palette Attive</div>
                              <div className="text-2xl font-black text-emerald-400 mt-1">{Number(activeEntity.active_pallets_count) || 0}</div>
                            </div>
                            <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4">
                              <div className="text-[10px] font-bold uppercase text-slate-500">Prodotti / SKU</div>
                              <div className="text-2xl font-black text-amber-300 mt-1">{Number(activeEntity.products_count) || 0}</div>
                            </div>
                            <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4">
                              <div className="text-[10px] font-bold uppercase text-slate-500">Voci Custom</div>
                              <div className="text-2xl font-black text-brand-blue mt-1">{Number(activeEntity.custom_tariffs_count) || 0}</div>
                            </div>
                          </div>

                          {/* Opzione Bolla di Uscita Automatica */}
                          <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 flex items-center justify-between gap-4">
                            <div className="flex items-start gap-3 min-w-0">
                              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                                (activeEntity.generate_exit_ddt === undefined || activeEntity.generate_exit_ddt === null || Boolean(activeEntity.generate_exit_ddt))
                                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                                  : 'bg-slate-900 border-slate-800 text-slate-500'
                              }`}>
                                <FileText size={18} />
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-black text-white flex items-center gap-2">
                                  Genera Bolla di Uscita
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-black uppercase ${
                                    (activeEntity.generate_exit_ddt === undefined || activeEntity.generate_exit_ddt === null || Boolean(activeEntity.generate_exit_ddt))
                                      ? 'bg-emerald-500/20 text-emerald-300'
                                      : 'bg-slate-800 text-slate-400'
                                  }`}>
                                    {(activeEntity.generate_exit_ddt === undefined || activeEntity.generate_exit_ddt === null || Boolean(activeEntity.generate_exit_ddt)) ? 'Attiva' : 'Disattiva'}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                                  Crea automaticamente il DDT / Bolla di trasporto con barcode Zebra quando una spedizione è pronta.
                                </p>
                              </div>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer shrink-0">
                              <input
                                type="checkbox"
                                disabled={!canManageCustomers || togglingExitDdt}
                                checked={activeEntity.generate_exit_ddt === undefined || activeEntity.generate_exit_ddt === null ? true : Boolean(activeEntity.generate_exit_ddt)}
                                onChange={handleToggleExitDdt}
                                className="sr-only peer"
                              />
                              <div className="w-11 h-6 bg-slate-800 rounded-full peer peer-checked:bg-emerald-500 transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full peer-disabled:opacity-50" />
                            </label>
                          </div>

                          {/* Indirizzi di Consegna Multipli */}
                          <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-5 space-y-3">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <h3 className="text-xs font-black uppercase tracking-wider text-sky-300 flex items-center gap-2">
                                <Truck size={15} />
                                Indirizzi di Consegna ({deliveryAddresses.length})
                              </h3>
                              {canManageCustomers && (
                                <div className="flex items-center gap-2">
                                  {deliveryAddresses.length === 0 && activeEntity.address && (
                                    <button
                                      type="button"
                                      onClick={() => openNewAddressModal(true)}
                                      className="px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-[11px] font-bold transition-colors"
                                    >
                                      Copia da Sede
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => openNewAddressModal(false)}
                                    className="px-3 py-1.5 rounded-xl bg-brand-blue/15 hover:bg-brand-blue text-brand-blue hover:text-brand-black border border-brand-blue/30 text-xs font-black transition-all flex items-center gap-1"
                                  >
                                    <Plus size={13} /> Nuovo Indirizzo
                                  </button>
                                </div>
                              )}
                            </div>

                            {isLoadingAddresses ? (
                              <div className="py-6 flex justify-center text-brand-blue">
                                <Loader2 className="animate-spin" size={22} />
                              </div>
                            ) : deliveryAddresses.length === 0 ? (
                              <div className="py-5 px-4 text-center bg-slate-900/50 border border-dashed border-slate-800 rounded-xl text-xs text-slate-500">
                                Nessun indirizzo di consegna specifico configurato. In spedizione verrà usata la sede in anagrafica ({activeEntity.address || 'non impostata'}).
                              </div>
                            ) : (
                              <div className="space-y-2 max-h-[260px] overflow-y-auto no-scrollbar">
                                {deliveryAddresses.map(addr => (
                                  <div
                                    key={addr.id}
                                    className={`p-3.5 rounded-xl border transition-all flex items-start justify-between gap-3 ${
                                      addr.is_default
                                        ? 'bg-sky-950/20 border-sky-500/40'
                                        : 'bg-slate-900/70 border-slate-800 hover:border-slate-700'
                                    }`}
                                  >
                                    <div className="min-w-0 space-y-1">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-bold text-xs text-white">{addr.label}</span>
                                        {addr.is_default && (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-500/20 border border-sky-500/40 text-sky-300 text-[10px] font-black uppercase">
                                            <Star size={9} className="fill-sky-300" /> Predefinito
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-xs text-slate-300 leading-snug">
                                        {addr.address_line}
                                        {(addr.cap || addr.city || addr.province) && (
                                          <span className="text-slate-400">
                                            {' — '}{[addr.cap, addr.city, addr.province ? `(${addr.province})` : ''].filter(Boolean).join(' ')}
                                          </span>
                                        )}
                                      </p>
                                      {(addr.contact_name || addr.contact_phone || addr.notes) && (
                                        <p className="text-[11px] text-slate-500">
                                          {[addr.contact_name ? `Ref: ${addr.contact_name}` : '', addr.contact_phone ? `Tel: ${addr.contact_phone}` : '', addr.notes || ''].filter(Boolean).join(' • ')}
                                        </p>
                                      )}
                                    </div>

                                    {canManageCustomers && (
                                      <div className="flex items-center gap-1 shrink-0">
                                        {!addr.is_default && (
                                          <button
                                            type="button"
                                            onClick={() => handleSetDefaultAddress(addr)}
                                            title="Imposta come predefinito"
                                            className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-sky-300 hover:border-sky-500/40 transition-colors"
                                          >
                                            <Star size={13} />
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => openEditAddressModal(addr)}
                                          title="Modifica indirizzo"
                                          className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-brand-blue hover:border-brand-blue/40 transition-colors"
                                        >
                                          <Edit2 size={13} />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteAddress(addr)}
                                          title="Elimina indirizzo"
                                          className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-rose-400 hover:border-rose-500/40 transition-colors"
                                        >
                                          <Trash2 size={13} />
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Feed Note Separate per Cliente / Frammentazione (con Autore, Data/Ora e Pin) */}
                        <div className="xl:col-span-6 bg-slate-950/70 border border-amber-500/25 rounded-2xl p-5 flex flex-col gap-4">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="text-xs font-black uppercase tracking-wider text-amber-300 flex items-center gap-2">
                              <StickyNote size={15} />
                              Bacheca Note — {activeEntity.business_name}
                            </h3>
                            <span className="text-[11px] font-bold text-slate-400">
                              {entityNotes.length} {entityNotes.length === 1 ? 'nota' : 'note'}
                              {entityNotes.filter(n => n.is_pinned).length > 0 && (
                                <span className="text-amber-400 ml-1">
                                  ({entityNotes.filter(n => n.is_pinned).length} pinnat{entityNotes.filter(n => n.is_pinned).length === 1 ? 'a' : 'e'})
                                </span>
                              )}
                            </span>
                          </div>

                          {/* Nuova Nota Composer */}
                          {canManageCustomers && (
                            <form onSubmit={handleAddNote} className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 space-y-3">
                              <textarea
                                rows={3}
                                value={newNoteText}
                                onChange={e => setNewNoteText(e.target.value)}
                                onKeyDown={e => {
                                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                                    e.preventDefault();
                                    handleAddNote();
                                  }
                                }}
                                placeholder={`Scrivi una nuova nota per ${activeEntity.business_name}... (Ctrl+Invio per inviare)`}
                                className="w-full bg-slate-950 border border-slate-800 text-slate-100 rounded-xl p-3 text-sm leading-relaxed focus:border-amber-400 outline-none resize-y"
                              />
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => setNewNotePinned(prev => !prev)}
                                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-all ${
                                    newNotePinned
                                      ? 'bg-amber-500/20 text-amber-300 border-amber-400/50'
                                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                                  }`}
                                >
                                  <Pin size={13} className={newNotePinned ? 'fill-amber-400 text-amber-300' : ''} />
                                  {newNotePinned ? 'Pinna in alto: Sì' : 'Pinna in alto'}
                                </button>

                                <button
                                  type="submit"
                                  disabled={!newNoteText.trim() || isSendingNote}
                                  className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-brand-black rounded-xl font-black text-xs transition-all flex items-center gap-1.5 disabled:opacity-40"
                                >
                                  {isSendingNote ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                                  Invia Nota
                                </button>
                              </div>
                            </form>
                          )}

                          {/* Elenco Note Separate */}
                          <div className="space-y-2.5 max-h-[295px] overflow-y-auto no-scrollbar">
                            {isLoadingNotes ? (
                              <div className="py-8 flex justify-center text-amber-400">
                                <Loader2 className="animate-spin" size={24} />
                              </div>
                            ) : entityNotes.length === 0 ? (
                              <div className="py-8 px-4 text-center bg-slate-900/50 border border-dashed border-slate-800 rounded-2xl text-xs text-slate-500">
                                Nessuna nota presente per {activeEntity.business_name}. Scrivi la prima nota qui sopra!
                              </div>
                            ) : (
                              entityNotes.map(note => (
                                <div
                                  key={note.id}
                                  className={`rounded-2xl p-4 border transition-all ${
                                    note.is_pinned
                                      ? 'bg-amber-950/20 border-amber-400/50 shadow-[0_0_15px_rgba(251,191,36,0.08)]'
                                      : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                                  }`}
                                >
                                  <div className="flex items-start justify-between gap-2 mb-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-bold text-brand-blue">
                                        <User size={11} />
                                        {note.username || 'Sistema'}
                                      </span>
                                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 font-medium">
                                        <Clock size={11} className="text-slate-500" />
                                        {formatNoteTimestamp(note.created_at)}
                                      </span>
                                      {note.is_pinned && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400/20 border border-amber-400/40 text-amber-300 text-[10px] font-black uppercase tracking-wider">
                                          <Pin size={10} className="fill-amber-300" /> Fissata in alto
                                        </span>
                                      )}
                                    </div>

                                    {canManageCustomers && (
                                      <div className="flex items-center gap-1 shrink-0">
                                        <button
                                          type="button"
                                          onClick={() => handleTogglePinNote(note)}
                                          title={note.is_pinned ? 'Rimuovi pin (sposta in cronologia)' : 'Pinna nota in alto'}
                                          className={`p-1.5 rounded-lg transition-colors ${
                                            note.is_pinned
                                              ? 'bg-amber-400/20 text-amber-300 hover:bg-amber-400/30'
                                              : 'text-slate-400 hover:text-amber-300 hover:bg-slate-800'
                                          }`}
                                        >
                                          {note.is_pinned ? <PinOff size={14} /> : <Pin size={14} />}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteNote(note)}
                                          title="Elimina nota"
                                          className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      </div>
                                    )}
                                  </div>

                                  <p className="text-sm text-slate-100 whitespace-pre-wrap leading-relaxed break-words">
                                    {note.content}
                                  </p>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {folderTab === 'TARIFFS' && (
                      <CustomerTariffEditor
                        customer={activeEntity}
                        canManageFinance={canManageClientTariffs}
                        canManageGlobalPlans={canManageGlobalPlans}
                        canViewBilling={canViewBilling}
                        hasFragments={!activeEntity.parent_id && folderFragments.length > 0}
                        onUpdated={fetchAllData}
                        onOpenGlobalPlans={canManageGlobalPlans ? () => setShowGlobalPlansModal(true) : null}
                        onOpenNewService={canManageFinance ? () => setShowNewServiceModal(true) : null}
                      />
                    )}

                    {folderTab === 'FRAGMENTS' && (
                      <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-black text-white flex items-center gap-2">
                              <GitBranch size={16} className="text-violet-400" />
                              Frammentazioni / Reparti di {selectedFolder.business_name}
                            </h3>
                            <p className="text-xs text-slate-400 mt-0.5">
                              Ogni frammentazione ha anagrafica, note, giacenze e listino prezzi personalizzabile, ma confluisce nella pre-fattura del Cliente Madre.
                            </p>
                          </div>
                          {canManageCustomers && (
                            <button
                              type="button"
                              onClick={() => openFragmentModal(selectedFolder)}
                              className="px-4 py-2 bg-violet-500 hover:bg-violet-400 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow"
                            >
                              <Plus size={15} /> Aggiungi Frammentazione
                            </button>
                          )}
                        </div>

                        {folderFragments.length === 0 ? (
                          <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-10 text-center">
                            <GitBranch size={28} className="mx-auto text-slate-600 mb-2" />
                            <p className="text-sm font-bold text-slate-300">Nessuna frammentazione creata</p>
                            <p className="text-xs text-slate-500 mt-1">
                              Suddividi questo cliente in reparti o divisioni (es. Frigo, Secco, Reparto Carne) per gestire note e listini separati.
                            </p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                            {folderFragments.map(frag => {
                              const isCurrent = activeEntity.id === frag.id;
                              return (
                                <div
                                  key={frag.id}
                                  className={`p-4 rounded-2xl border transition-all flex flex-col justify-between gap-3 ${
                                    isCurrent
                                      ? 'bg-violet-950/25 border-violet-500/60'
                                      : 'bg-slate-950/70 border-slate-800 hover:border-violet-500/40'
                                  }`}
                                >
                                  <div>
                                    <div className="flex items-start justify-between gap-2">
                                      <div>
                                        <div className="font-black text-base text-white">{frag.business_name}</div>
                                        <div className="text-xs font-mono text-violet-300 mt-0.5">{frag.unique_id}</div>
                                      </div>
                                      {frag.tariff_plan_name && (
                                        <span className="px-2 py-0.5 rounded bg-brand-blue/15 text-brand-blue border border-brand-blue/30 text-[10px] font-bold">
                                          {frag.tariff_plan_name}
                                        </span>
                                      )}
                                    </div>

                                    <div className="flex flex-wrap gap-2 mt-3">
                                      <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 text-[11px] font-bold">
                                        {Number(frag.active_pallets_count) || 0} Palette
                                      </span>
                                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[11px]">
                                        {Number(frag.products_count) || 0} SKU
                                      </span>
                                      <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 text-[11px] font-semibold">
                                        {Number(frag.custom_tariffs_count) > 0
                                          ? `${frag.custom_tariffs_count} tariffe custom`
                                          : 'Tariffe ereditate'}
                                      </span>
                                    </div>

                                    {(frag.latest_note_preview || frag.notes?.trim()) && (
                                      <div className="mt-2.5 text-xs text-slate-400 bg-slate-900/90 border border-slate-800 rounded-xl p-2.5 line-clamp-2">
                                        <span className="text-amber-300 font-bold">
                                          {Number(frag.notes_count) > 0 ? `Note (${frag.notes_count}):` : 'Nota:'}
                                        </span>{' '}
                                        {frag.latest_note_preview || frag.notes}
                                      </div>
                                    )}
                                  </div>

                                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                                    <div className="flex gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => openFolder(selectedFolder.id, frag.id, 'OVERVIEW')}
                                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-bold"
                                      >
                                        Note & Dati
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => openFolder(selectedFolder.id, frag.id, 'TARIFFS')}
                                        className="px-2.5 py-1.5 bg-amber-500/15 hover:bg-amber-500 text-amber-300 hover:text-brand-black border border-amber-500/30 rounded-lg text-xs font-bold flex items-center gap-1"
                                      >
                                        <Coins size={12} /> Listino
                                      </button>
                                    </div>

                                    {canManageCustomers && (
                                      <div className="flex gap-1">
                                        <button
                                          type="button"
                                          onClick={() => setEditModal({ show: true, customer: { ...frag } })}
                                          className="p-1.5 bg-slate-800 hover:bg-brand-blue hover:text-brand-black text-slate-300 rounded-lg"
                                          title="Modifica"
                                        >
                                          <Edit2 size={14} />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setDeleteModal({ show: true, customer: frag, confirmText: '' })}
                                          className="p-1.5 bg-slate-800 hover:bg-rose-500 text-slate-400 hover:text-white rounded-lg"
                                          title="Elimina"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {folderTab === 'FILES' && (
                      <CustomerDocumentsTab
                        customer={activeEntity}
                        canManage={canManageCustomers}
                      />
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
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
                  Crea una o più divisioni/reparti figli con note e listino prezzi personalizzabile.
                </p>
              </div>
              <button
                onClick={() => setFragmentModal({ show: false, parent: null, copy_tariffs: true, rows: [{ business_name: '', unique_id: '', notes: '' }] })}
                className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateFragments} className="space-y-4">
              <div className="max-h-80 overflow-y-auto space-y-3 pr-1">
                {fragmentModal.rows.map((row, idx) => (
                  <div key={idx} className="bg-slate-950/60 border border-slate-800 p-3.5 rounded-2xl space-y-2.5">
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
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
                          Codice Univoco (Auto se vuoto)
                        </label>
                        <input
                          type="text"
                          value={row.unique_id}
                          onChange={e => {
                            const updated = [...fragmentModal.rows];
                            updated[idx].unique_id = e.target.value;
                            setFragmentModal({ ...fragmentModal, rows: updated });
                          }}
                          placeholder="Auto-generato"
                          className="w-full bg-slate-900 border border-slate-700 text-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-mono focus:border-violet-400 outline-none"
                        />
                      </div>
                      <div className="md:col-span-1 flex justify-end pt-4">
                        {fragmentModal.rows.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setFragmentModal({ ...fragmentModal, rows: fragmentModal.rows.filter((_, i) => i !== idx) })}
                            className="p-2 text-slate-500 hover:text-rose-400 rounded-lg"
                          >
                            <Trash2 size={18} />
                          </button>
                        )}
                      </div>
                    </div>

                    <div>
                      <input
                        type="text"
                        value={row.notes || ''}
                        onChange={e => {
                          const updated = [...fragmentModal.rows];
                          updated[idx].notes = e.target.value;
                          setFragmentModal({ ...fragmentModal, rows: updated });
                        }}
                        placeholder="Note opzionali per questa frammentazione..."
                        className="w-full bg-slate-900/70 border border-slate-800 text-slate-300 rounded-xl px-3.5 py-2 text-xs focus:border-amber-400 outline-none"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap justify-between items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() =>
                    setFragmentModal(prev => ({
                      ...prev,
                      rows: [...prev.rows, { business_name: `${prev.parent.business_name} `, unique_id: '', notes: '' }]
                    }))
                  }
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-violet-300 rounded-xl text-xs font-bold flex items-center gap-1.5"
                >
                  <Plus size={15} /> Aggiungi riga
                </button>

                <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 font-semibold">
                  <input
                    type="checkbox"
                    checked={fragmentModal.copy_tariffs}
                    onChange={e => setFragmentModal({ ...fragmentModal, copy_tariffs: e.target.checked })}
                    className="rounded border-slate-700 bg-slate-800 text-violet-500 focus:ring-violet-500"
                  />
                  Copia tariffe iniziali dal Cliente Madre
                </label>
              </div>

              <div className="flex gap-4 mt-6 pt-6 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setFragmentModal({ show: false, parent: null, copy_tariffs: true, rows: [{ business_name: '', unique_id: '', notes: '' }] })}
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
                  {isProcessing ? 'Creazione...' : 'Salva Frammentazioni'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Nuova Cartella Cliente */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-2xl w-full shadow-2xl relative my-8 animate-fade-in-up">
            <h2 className="text-2xl font-bold text-brand-white mb-6 flex items-center gap-3">
              <span className="w-10 h-10 bg-brand-blue/20 flex items-center justify-center rounded-xl text-brand-blue">
                <Plus size={24} />
              </span>
              Nuova Cartella Cliente o Frammentazione
            </h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">
                    Tipo (Cartella Madre o Frammentazione)
                  </label>
                  <select
                    value={newCustomer.parent_id || ''}
                    onChange={e => setNewCustomer({ ...newCustomer, parent_id: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:border-brand-blue outline-none"
                  >
                    <option value="">-- Nuova Cartella Cliente Madre --</option>
                    {parentCustomers.map(p => (
                      <option key={p.id} value={p.id}>
                        Frammentazione di: {p.business_name} ({p.unique_id})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Ragione Sociale / Nome Reparto *</label>
                  <input required value={newCustomer.business_name} onChange={e => setNewCustomer({ ...newCustomer, business_name: e.target.value })} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:border-brand-blue outline-none" placeholder="Es. LOGISTICA SRL" />
                </div>

                <div>
                  <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Codice Univoco / SDI {newCustomer.parent_id ? '(Auto se vuoto)' : '*'}</label>
                  <input required={!newCustomer.parent_id} value={newCustomer.unique_id} onChange={e => setNewCustomer({ ...newCustomer, unique_id: e.target.value })} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:border-brand-blue outline-none font-mono" placeholder="Es. LOG-001" />
                </div>

                <div>
                  <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Partita IVA / C.F.</label>
                  <input value={newCustomer.vat_number} onChange={e => setNewCustomer({ ...newCustomer, vat_number: e.target.value })} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:border-brand-blue outline-none font-mono" placeholder="Es. IT0123456789" />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Indirizzo e Città</label>
                  <input value={newCustomer.address} onChange={e => setNewCustomer({ ...newCustomer, address: e.target.value })} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:border-brand-blue outline-none" placeholder="Via Roma 1, Milano (MI)" />
                </div>

                <div>
                  <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Telefono</label>
                  <input value={newCustomer.phone} onChange={e => setNewCustomer({ ...newCustomer, phone: e.target.value })} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:border-brand-blue outline-none" placeholder="+39 333..." />
                </div>

                <div>
                  <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Email Aziendale</label>
                  <input type="email" value={newCustomer.email} onChange={e => setNewCustomer({ ...newCustomer, email: e.target.value })} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:border-brand-blue outline-none" placeholder="info@azienda.it" />
                </div>

                {canViewBilling && tariffPlans.length > 0 && (
                  <div className="md:col-span-2">
                    <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Listino Globale Iniziale (Opzionale)</label>
                    <select
                      value={newCustomer.tariff_plan_id || ''}
                      onChange={e => setNewCustomer({ ...newCustomer, tariff_plan_id: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:border-brand-blue outline-none"
                    >
                      <option value="">-- Tariffe Base / Ereditate --</option>
                      {tariffPlans.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name}{p.is_default ? ' (Default)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="md:col-span-2">
                  <label className="flex items-center gap-3 p-3.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer hover:border-emerald-500/40 transition-colors">
                    <input
                      type="checkbox"
                      checked={newCustomer.generate_exit_ddt !== false}
                      onChange={e => setNewCustomer({ ...newCustomer, generate_exit_ddt: e.target.checked })}
                      className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
                    />
                    <div>
                      <div className="text-sm font-bold text-white">Genera Bolla di Uscita (Default Attiva)</div>
                      <div className="text-[11px] text-slate-400">Genera automaticamente la bolla/DDT con barcode quando la spedizione è pronta.</div>
                    </div>
                  </label>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Note Cliente / Frammentazione</label>
                  <textarea
                    rows={3}
                    value={newCustomer.notes}
                    onChange={e => setNewCustomer({ ...newCustomer, notes: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:border-amber-400 outline-none resize-none"
                    placeholder="Istruzioni operative, accordi commerciali, note di fatturazione..."
                  />
                </div>
              </div>

              <div className="flex gap-4 mt-6 pt-6 border-t border-slate-800/80">
                <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 px-4 py-3.5 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-xl font-bold transition-colors">Annulla</button>
                <button type="submit" disabled={isProcessing} className="flex-1 px-4 py-3.5 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-xl font-black transition-colors shadow-[0_0_20px_rgba(14,165,233,0.3)] disabled:opacity-50">{isProcessing ? 'Salvataggio...' : 'Crea Cartella'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Modifica */}
      {editModal.show && editModal.customer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-2xl w-full shadow-2xl relative my-8 animate-fade-in-up">
            <h2 className="text-2xl font-bold text-brand-white mb-6 flex items-center gap-3">
              <span className="w-10 h-10 bg-brand-blue/20 flex items-center justify-center rounded-xl text-brand-blue">
                <Edit2 size={24} />
              </span>
              Modifica Cliente / Frammentazione
            </h2>
            <form onSubmit={handleUpdate} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">
                    Cliente Madre Associato (Vuoto = Cartella Cliente Madre)
                  </label>
                  <select
                    value={editModal.customer.parent_id || ''}
                    onChange={e => setEditModal({ ...editModal, customer: { ...editModal.customer, parent_id: e.target.value ? Number(e.target.value) : null } })}
                    className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:border-brand-blue outline-none"
                  >
                    <option value="">-- Cliente Madre Principale (Nessun Padre) --</option>
                    {parentCustomers
                      .filter(p => p.id !== editModal.customer.id)
                      .map(p => (
                        <option key={p.id} value={p.id}>
                          Frammentazione di: {p.business_name} ({p.unique_id})
                        </option>
                      ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Ragione Sociale *</label>
                  <input required value={editModal.customer.business_name} onChange={e => setEditModal({ ...editModal, customer: { ...editModal.customer, business_name: e.target.value } })} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:border-brand-blue outline-none" />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Codice Univoco / SDI *</label>
                  <input required value={editModal.customer.unique_id} onChange={e => setEditModal({ ...editModal, customer: { ...editModal.customer, unique_id: e.target.value } })} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:border-brand-blue outline-none font-mono" />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Partita IVA / C.F.</label>
                  <input value={editModal.customer.vat_number || ''} onChange={e => setEditModal({ ...editModal, customer: { ...editModal.customer, vat_number: e.target.value } })} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:border-brand-blue outline-none font-mono" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Indirizzo e Città</label>
                  <input value={editModal.customer.address || ''} onChange={e => setEditModal({ ...editModal, customer: { ...editModal.customer, address: e.target.value } })} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:border-brand-blue outline-none" />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Telefono</label>
                  <input value={editModal.customer.phone || ''} onChange={e => setEditModal({ ...editModal, customer: { ...editModal.customer, phone: e.target.value } })} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:border-brand-blue outline-none" />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-1.5 text-xs uppercase tracking-wider">Email Aziendale</label>
                  <input type="email" value={editModal.customer.email || ''} onChange={e => setEditModal({ ...editModal, customer: { ...editModal.customer, email: e.target.value } })} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:border-brand-blue outline-none" />
                </div>
                <div className="md:col-span-2">
                  <label className="flex items-center gap-3 p-3.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer hover:border-emerald-500/40 transition-colors">
                    <input
                      type="checkbox"
                      checked={editModal.customer.generate_exit_ddt === undefined || editModal.customer.generate_exit_ddt === null ? true : Boolean(editModal.customer.generate_exit_ddt)}
                      onChange={e => setEditModal({ ...editModal, customer: { ...editModal.customer, generate_exit_ddt: e.target.checked } })}
                      className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
                    />
                    <div>
                      <div className="text-sm font-bold text-white">Genera Bolla di Uscita automatica</div>
                      <div className="text-[11px] text-slate-400">Genera il DDT/Bolla valido per il trasporto quando l&apos;ordine passa a Pronto.</div>
                    </div>
                  </label>
                </div>
              </div>
              <div className="flex gap-4 mt-6 pt-6 border-t border-slate-800/80">
                <button type="button" onClick={() => setEditModal({ show: false, customer: null })} className="flex-1 px-4 py-3.5 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-xl font-bold transition-colors">Annulla</button>
                <button type="submit" disabled={isProcessing} className="flex-1 px-4 py-3.5 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-xl font-black transition-colors shadow-[0_0_20px_rgba(14,165,233,0.3)] disabled:opacity-50">{isProcessing ? 'Salvataggio...' : 'Salva Modifiche'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Delete */}
      {deleteModal.show && deleteModal.customer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-sm w-full shadow-2xl border-t-4 border-t-rose-500 animate-fade-in-up">
            <div className="w-16 h-16 bg-rose-950/50 rounded-full flex items-center justify-center text-rose-500 mb-5 mx-auto">
              <Trash2 size={32} />
            </div>
            <h2 className="text-2xl font-bold text-brand-white mb-2 text-center">Elimina Cliente</h2>
            <p className="text-slate-400 text-sm mb-5 text-center leading-relaxed">
              Stai per eliminare <b className="text-rose-400">{deleteModal.customer.business_name}</b> in modo definitivo.
            </p>
            <div className="bg-rose-950/20 p-4 rounded-xl mb-5 border border-rose-900/30">
              <p className="text-rose-400 text-xs font-bold text-center uppercase tracking-wider mb-1">Conferma di Sicurezza</p>
              <p className="text-rose-200 text-xs font-medium text-center">Digita esattamente il nome per procedere:</p>
            </div>

            <input
              type="text"
              placeholder={deleteModal.customer.business_name}
              value={deleteModal.confirmText}
              onChange={e => setDeleteModal({ ...deleteModal, confirmText: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:border-rose-500 mb-6 font-bold text-center outline-none"
            />

            <div className="flex gap-3">
              <button onClick={() => setDeleteModal({ show: false, customer: null, confirmText: '' })} className="flex-1 px-4 py-3.5 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-xl font-bold transition-colors">Annulla</button>
              <button
                onClick={handleDelete}
                disabled={deleteModal.confirmText !== deleteModal.customer.business_name || isProcessing}
                className="flex-1 px-4 py-3.5 bg-rose-600 hover:bg-rose-500 text-brand-white rounded-xl font-bold disabled:opacity-30 transition-all"
              >
                {isProcessing ? 'Attendi...' : 'Conferma'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Indirizzo di Consegna */}
      {addressModal.show && activeEntity && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-7 max-w-xl w-full shadow-2xl relative my-8 animate-fade-in-up">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-black text-white flex items-center gap-2.5">
                <span className="w-9 h-9 bg-sky-500/20 flex items-center justify-center rounded-xl text-sky-400">
                  <Truck size={20} />
                </span>
                {addressModal.editingId ? 'Modifica Indirizzo di Consegna' : 'Nuovo Indirizzo di Consegna'}
              </h2>
              <button
                type="button"
                onClick={() => setAddressModal(prev => ({ ...prev, show: false }))}
                className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveAddress} className="space-y-3.5">
              <div>
                <label className="block text-slate-400 font-bold mb-1 text-xs uppercase tracking-wider">Etichetta / Nome Sede *</label>
                <input
                  required
                  value={addressModal.label}
                  onChange={e => setAddressModal({ ...addressModal, label: e.target.value })}
                  placeholder="Es. Deposito Nord, Negozio Milano, Magazzino 2..."
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl p-3 text-sm focus:border-brand-blue outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-bold mb-1 text-xs uppercase tracking-wider">Indirizzo (Via / Piazza / Civico) *</label>
                <input
                  required
                  value={addressModal.address_line}
                  onChange={e => setAddressModal({ ...addressModal, address_line: e.target.value })}
                  placeholder="Es. Via dell'Industria 45"
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl p-3 text-sm focus:border-brand-blue outline-none"
                />
              </div>

              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-3">
                  <label className="block text-slate-400 font-bold mb-1 text-xs uppercase tracking-wider">CAP</label>
                  <input
                    value={addressModal.cap}
                    onChange={e => setAddressModal({ ...addressModal, cap: e.target.value })}
                    placeholder="20100"
                    className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl p-3 text-sm focus:border-brand-blue outline-none font-mono"
                  />
                </div>
                <div className="col-span-6">
                  <label className="block text-slate-400 font-bold mb-1 text-xs uppercase tracking-wider">Città</label>
                  <input
                    value={addressModal.city}
                    onChange={e => setAddressModal({ ...addressModal, city: e.target.value })}
                    placeholder="Milano"
                    className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl p-3 text-sm focus:border-brand-blue outline-none"
                  />
                </div>
                <div className="col-span-3">
                  <label className="block text-slate-400 font-bold mb-1 text-xs uppercase tracking-wider">Prov.</label>
                  <input
                    value={addressModal.province}
                    onChange={e => setAddressModal({ ...addressModal, province: e.target.value.toUpperCase() })}
                    placeholder="MI"
                    maxLength={4}
                    className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl p-3 text-sm focus:border-brand-blue outline-none font-mono uppercase"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-bold mb-1 text-xs uppercase tracking-wider">Referente Scarico</label>
                  <input
                    value={addressModal.contact_name}
                    onChange={e => setAddressModal({ ...addressModal, contact_name: e.target.value })}
                    placeholder="Nome referente"
                    className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl p-3 text-sm focus:border-brand-blue outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-1 text-xs uppercase tracking-wider">Telefono Consegna</label>
                  <input
                    value={addressModal.contact_phone}
                    onChange={e => setAddressModal({ ...addressModal, contact_phone: e.target.value })}
                    placeholder="+39 333..."
                    className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl p-3 text-sm focus:border-brand-blue outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-bold mb-1 text-xs uppercase tracking-wider">Note di Consegna (Orari / Ribalta / Accesso)</label>
                <input
                  value={addressModal.notes}
                  onChange={e => setAddressModal({ ...addressModal, notes: e.target.value })}
                  placeholder="Es. Scarico sponda idraulica 08:00-12:00"
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl p-3 text-sm focus:border-brand-blue outline-none"
                />
              </div>

              <label className="flex items-center gap-2.5 pt-1 cursor-pointer text-xs font-bold text-slate-200">
                <input
                  type="checkbox"
                  checked={addressModal.is_default}
                  onChange={e => setAddressModal({ ...addressModal, is_default: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-sky-400 focus:ring-sky-400"
                />
                Imposta come Indirizzo di Consegna Predefinito per {activeEntity.business_name}
              </label>

              <div className="flex gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setAddressModal(prev => ({ ...prev, show: false }))}
                  className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold text-sm transition-colors"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={savingAddress}
                  className="flex-1 py-3 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-xl font-black text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {savingAddress ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  Salva Indirizzo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modali Listini Globali e Servizi Globali */}
      <GlobalPlansModal
        show={showGlobalPlansModal}
        onClose={() => setShowGlobalPlansModal(false)}
        onUpdated={fetchAllData}
      />
      <NewGlobalServiceModal
        show={showNewServiceModal}
        onClose={() => setShowNewServiceModal(false)}
        onCreated={fetchAllData}
      />
    </div>
  );
};

export default CustomersManagement;
