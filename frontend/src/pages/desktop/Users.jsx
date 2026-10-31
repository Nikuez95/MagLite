import { appAlert, appToast } from "../../utils/alerts.js";
import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import {
  UserPlus, Shield, Trash2, Key, Plus, Check, X, Lock, Unlock,
  Crown, Sliders, Search, Building2, Layers, Sparkles, AlertTriangle,
  ChevronRight, ChevronUp, ChevronDown, GripVertical, Save, Users as UsersIcon
} from 'lucide-react';
import { refreshUserProfile, hasPerm } from '../../utils/permissions';

// Colori ruoli selezionabili
const DISCORD_COLORS = [
  '#a855f7', // Purple
  '#f59e0b', // Amber/Gold
  '#0ea5e9', // Sky Blue
  '#3b82f6', // Blue
  '#ef4444', // Red
  '#f97316', // Orange
  '#10b981', // Emerald
  '#6366f1', // Indigo
  '#f43f5e', // Rose
  '#ec4899', // Pink
  '#8b5cf6', // Violet
  '#14b8a6', // Teal
  '#f472b6', // Fuchsia
  '#64748b'  // Slate
];

const UsersManagement = () => {
  const [activeTab, setActiveTab] = useState('users'); // 'users' | 'roles' | 'customers_matrix'
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Filters for users tab
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');

  // Create User Modal state
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRoleCode, setNewRoleCode] = useState('operator');
  const [newUserOverrides, setNewUserOverrides] = useState({});
  const [newUserRestrictedCustomers, setNewUserRestrictedCustomers] = useState([]);
  const [showNewUserAdvanced, setShowNewUserAdvanced] = useState(false);

  // Edit Single User Access Modal (3-state overrides)
  const [editingUser, setEditingUser] = useState(null);
  const [editUserRole, setEditUserRole] = useState('');
  const [editUserOverrides, setEditUserOverrides] = useState({});
  const [editUserRestrictedCustomers, setEditUserRestrictedCustomers] = useState([]);
  const [editUserUnlockedCustomers, setEditUserUnlockedCustomers] = useState([]);
  const [editUserAccessMode, setEditUserAccessMode] = useState('BLACKLIST');
  const [editUserPermSearch, setEditUserPermSearch] = useState('');

  // Role Editor state
  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [roleDraft, setRoleDraft] = useState(null);
  const [rolePermSearch, setRolePermSearch] = useState('');
  const [hasRoleUnsavedChanges, setHasRoleUnsavedChanges] = useState(false);

  // Create New Role Modal
  const [showCreateRoleModal, setShowCreateRoleModal] = useState(false);
  const [newRoleForm, setNewRoleForm] = useState({
    name: '',
    description: '',
    color: '#10b981',
    template: 'full'
  });

  // Delete & Reset Password Modals
  const [confirmDeleteUser, setConfirmDeleteUser] = useState({ show: false, user: null });
  const [confirmDeleteRole, setConfirmDeleteRole] = useState({ show: false, role: null });
  const [resetModal, setResetModal] = useState({ show: false, user: null, newPwd: '' });
  const [isProcessing, setIsProcessing] = useState(false);

  const getToken = () => localStorage.getItem('maglite_token');

  // Close active modals on Escape key
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape' && !isProcessing) {
        if (confirmDeleteUser.show) setConfirmDeleteUser({ show: false, user: null });
        else if (confirmDeleteRole.show) setConfirmDeleteRole({ show: false, role: null });
        else if (resetModal.show) setResetModal({ show: false, user: null, newPwd: '' });
        else if (editingUser) setEditingUser(null);
        else if (showCreateUserModal) setShowCreateUserModal(false);
        else if (showCreateRoleModal) setShowCreateRoleModal(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isProcessing, confirmDeleteUser.show, confirmDeleteRole.show, resetModal.show, editingUser, showCreateUserModal, showCreateRoleModal]);

  const fetchAllData = async () => {
    setLoading(true);
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      const [usersRes, custRes] = await Promise.all([
        axios.get(`http://${window.location.hostname}:3000/api/users`, { headers }),
        axios.get(`http://${window.location.hostname}:3000/api/customers`, { headers }).catch(() => ({ data: [] }))
      ]);

      const fetchedUsers = usersRes.data.users || [];
      const fetchedRoles = usersRes.data.roles || [];
      const fetchedCatalog = usersRes.data.catalog || [];
      const caller = usersRes.data.currentUser || null;

      setUsers(fetchedUsers);
      setRoles(fetchedRoles);
      setCatalog(fetchedCatalog);
      setCurrentUser(caller);
      setCustomers(Array.isArray(custRes.data) ? custRes.data : []);

      if (fetchedRoles.length > 0) {
        const currentSelected = fetchedRoles.find(r => r.id === selectedRoleId) || fetchedRoles[0];
        setSelectedRoleId(currentSelected.id);
        setRoleDraft(JSON.parse(JSON.stringify(currentSelected)));
        setHasRoleUnsavedChanges(false);
      }

      // Imposta ruolo di default per creazione utente
      const callerIdx = fetchedRoles.findIndex(r => r.code === caller?.role);
      const assignable = fetchedRoles.filter((r, idx) =>
        caller?.role === 'developer' ? true : (callerIdx >= 0 ? idx > callerIdx : r.hierarchy_level < (caller?.hierarchy_level || 0))
      );
      if (assignable.length > 0) {
        const defaultOp = assignable.find(r => r.code === 'operator') || assignable[assignable.length - 1];
        setNewRoleCode(defaultOp.code);
      }
    } catch (err) {
      console.error(err);
      appAlert(err.response?.data?.error || 'Errore nel caricamento di Utenti e Ruoli', 'Errore', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  const isDeveloper = currentUser?.role === 'developer';
  const canManageUsers = isDeveloper || hasPerm('users_manage', currentUser);

  // Indice nella lista gerarchica (0 = Software Engineer in cima, 1 = secondo, ecc.)
  const callerRoleIndex = useMemo(() => {
    if (!currentUser) return 999;
    if (currentUser.role === 'developer') return 0;
    const idx = roles.findIndex(r => r.code === currentUser.role);
    return idx >= 0 ? idx : 999;
  }, [roles, currentUser]);

  // Regola di modifica Ruolo:
  // - Software Engineer può modificare qualsiasi ruolo (incluso se stesso, ma non può spostarlo né eliminarlo)
  // - Utente X con ruolo Y NON può modificare il proprio ruolo Y né quelli sopra di lui (solo quelli strettamente sotto)
  const canModifyRole = (roleObj) => {
    if (!roleObj || !canManageUsers) return false;
    if (isDeveloper) return true;
    const targetIdx = roles.findIndex(r => r.id === roleObj.id || r.code === roleObj.code);
    if (targetIdx >= 0 && callerRoleIndex < 999) {
      return targetIdx > callerRoleIndex;
    }
    return (roleObj.hierarchy_level || 0) < (currentUser?.hierarchy_level || 0);
  };

  // Regola di Drag & Drop Ruolo:
  // - Software Engineer non può MAI essere spostato (resta sempre in cima #1)
  // - Si può cambiare la gerarchia solo al di sotto del proprio ruolo
  const canDragRole = (roleObj, idx) => {
    if (!roleObj || !canManageUsers) return false;
    if (roleObj.code === 'developer' || idx === 0) return false;
    if (isDeveloper) return true;
    return idx > callerRoleIndex;
  };

  // Minimo indice in cui è permesso rilasciare un ruolo trascinato
  const minDroppableIndex = isDeveloper ? 1 : callerRoleIndex + 1;

  // Regola di modifica Utente:
  // - Software Engineer può modificare anche se stesso e chiunque altro
  // - Utente X con ruolo Y può modificare liberamente tutti gli utenti con ruolo sotto di lui; quelli con ruolo pari o superiore sono bloccati
  const canModifyUser = (targetUser) => {
    if (!targetUser || !canManageUsers) return false;
    if (isDeveloper) return true;
    if (Number(targetUser.id) === Number(currentUser?.id)) return false;
    if (targetUser.role === 'developer' || targetUser.role === currentUser?.role) return false;
    const targetRoleIdx = roles.findIndex(r => r.code === targetUser.role);
    if (targetRoleIdx >= 0 && callerRoleIndex < 999) {
      return targetRoleIdx > callerRoleIndex;
    }
    return (targetUser.hierarchy_level || 0) < (currentUser?.hierarchy_level || 0);
  };

  // Regola di eliminazione Utente:
  // - Il Software Engineer non può essere eliminato da nessuno, nemmeno da se stesso
  // - Nessuno può eliminare se stesso
  const canDeleteUserAccount = (targetUser) => {
    if (!targetUser || !canManageUsers) return false;
    if (targetUser.role === 'developer') return false;
    if (Number(targetUser.id) === Number(currentUser?.id)) return false;
    return canModifyUser(targetUser);
  };

  // Ruoli che l'utente corrente può assegnare:
  // - Software Engineer può assegnare qualsiasi ruolo (anche pari al suo)
  // - Gli altri possono assegnare solo ruoli strettamente sotto il proprio
  const assignableRoles = useMemo(() => {
    return roles.filter((r, idx) => {
      if (isDeveloper) return true;
      return idx > callerRoleIndex;
    });
  }, [roles, isDeveloper, callerRoleIndex]);

  const allPermKeys = useMemo(() => {
    return catalog.flatMap(cat => cat.items.map(i => i.key));
  }, [catalog]);

  // Costruisce un template di permessi
  const buildTemplatePermissions = (tplName) => {
    const map = {};
    for (const k of allPermKeys) {
      if (tplName === 'full') {
        map[k] = true;
      } else if (tplName === 'view_only') {
        map[k] = k === 'access_desktop' || (k.startsWith('view_') && k !== 'view_finances' && k !== 'view_billing' && k !== 'view_users' && k !== 'view_settings');
      } else if (tplName === 'quality') {
        map[k] = [
          'access_desktop', 'access_zebra', 'view_dashboard', 'view_inbound', 'view_documents',
          'view_outbound', 'view_products', 'view_inventory', 'view_quarantine', 'view_customers',
          'view_locations', 'view_custom_forms', 'view_audit', 'inbound_create', 'pallet_edit', 'pallet_move',
          'product_manage', 'quarantine_manage', 'approve_custom_forms', 'outbound_return'
        ].includes(k);
      } else if (tplName === 'operator') {
        map[k] = ['access_zebra', 'inbound_create', 'pallet_move', 'outbound_pick'].includes(k);
      } else {
        map[k] = false;
      }
    }
    map.restricted_customers = [];
    return map;
  };

  // Persistenza ordine ruoli dopo Drag & Drop o frecce Su/Giù
  const persistRoleOrder = async (newRolesArray) => {
    const previousRoles = [...roles];
    const reindexed = newRolesArray.map((r, i) => ({ ...r, rank: i + 1 }));
    setRoles(reindexed);

    try {
      await axios.put(
        `http://${window.location.hostname}:3000/api/users/roles/reorder`,
        { orderedIds: reindexed.map(r => r.id) },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      await refreshUserProfile();
      await fetchAllData();
      appToast('Gerarchia ruoli aggiornata');
    } catch (err) {
      setRoles(previousRoles);
      appAlert(err.response?.data?.error || 'Impossibile spostare il ruolo in questa posizione.', 'Gerarchia Bloccata', 'warning');
    }
  };

  const handleRoleDragEnd = (result) => {
    if (!result.destination) return;
    const srcIdx = result.source.index;
    const destIdx = result.destination.index;
    if (srcIdx === destIdx) return;

    const movedRole = roles[srcIdx];
    if (!canDragRole(movedRole, srcIdx)) return;

    if (destIdx < minDroppableIndex) {
      appAlert(
        isDeveloper
          ? 'Il ruolo Software Engineer non può essere superato e rimane sempre al 1° posto.'
          : 'Puoi cambiare la gerarchia solo al di sotto del tuo ruolo.',
        'Posizione Bloccata',
        'warning'
      );
      return;
    }

    const updated = Array.from(roles);
    const [removed] = updated.splice(srcIdx, 1);
    updated.splice(destIdx, 0, removed);
    persistRoleOrder(updated);
  };

  const handleMoveRoleStep = (idx, direction) => {
    const targetIdx = idx + direction;
    if (targetIdx < minDroppableIndex || targetIdx >= roles.length) return;
    if (!canDragRole(roles[idx], idx)) return;

    const updated = Array.from(roles);
    const [removed] = updated.splice(idx, 1);
    updated.splice(targetIdx, 0, removed);
    persistRoleOrder(updated);
  };

  // Seleziona un ruolo nella tab Ruoli
  const handleSelectRole = (roleObj) => {
    if (hasRoleUnsavedChanges) {
      if (!window.confirm('Hai modifiche non salvate sul ruolo corrente. Vuoi scartarle?')) return;
    }
    setSelectedRoleId(roleObj.id);
    setRoleDraft(JSON.parse(JSON.stringify(roleObj)));
    setHasRoleUnsavedChanges(false);
  };

  const updateRoleDraftField = (field, value) => {
    setRoleDraft(prev => ({ ...prev, [field]: value }));
    setHasRoleUnsavedChanges(true);
  };

  const toggleRoleDraftPermission = (permKey) => {
    if (!canModifyRole(roleDraft)) return;
    if (roleDraft.code === 'developer' && (permKey === 'view_users' || permKey === 'users_manage')) {
      return; // Software Engineer mantiene sempre accesso alla gestione team
    }
    setRoleDraft(prev => ({
      ...prev,
      permissions: {
        ...(prev.permissions || {}),
        [permKey]: !prev.permissions?.[permKey]
      }
    }));
    setHasRoleUnsavedChanges(true);
  };

  const setRoleDraftAccessMode = (mode) => {
    if (!canModifyRole(roleDraft)) return;
    setRoleDraft(prev => ({
      ...prev,
      permissions: {
        ...(prev.permissions || {}),
        customer_access_mode: mode
      }
    }));
    setHasRoleUnsavedChanges(true);
  };

  const toggleRoleDraftCustomerRestriction = (customerId) => {
    if (!canModifyRole(roleDraft)) return;
    const cid = Number(customerId);
    const currentList = Array.isArray(roleDraft?.permissions?.restricted_customers)
      ? roleDraft.permissions.restricted_customers.map(Number)
      : [];
    const nextList = currentList.includes(cid)
      ? currentList.filter(id => id !== cid)
      : [...currentList, cid];

    setRoleDraft(prev => ({
      ...prev,
      permissions: {
        ...(prev.permissions || {}),
        restricted_customers: nextList
      }
    }));
    setHasRoleUnsavedChanges(true);
  };

  const applyPresetToRoleDraft = (presetType) => {
    if (!canModifyRole(roleDraft)) return;
    const currentRestricted = roleDraft?.permissions?.restricted_customers || [];
    const nextPerms = buildTemplatePermissions(presetType);
    if (roleDraft.code === 'developer') {
      nextPerms.view_users = true;
      nextPerms.users_manage = true;
    }
    nextPerms.restricted_customers = currentRestricted;
    setRoleDraft(prev => ({
      ...prev,
      permissions: nextPerms
    }));
    setHasRoleUnsavedChanges(true);
  };

  const handleSaveRoleDraft = async () => {
    if (!roleDraft || !canModifyRole(roleDraft) || isProcessing) return;
    setIsProcessing(true);
    try {
      await axios.put(
        `http://${window.location.hostname}:3000/api/users/roles/${roleDraft.id}`,
        {
          name: roleDraft.name,
          description: roleDraft.description,
          color: roleDraft.color,
          permissions: roleDraft.permissions
        },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      setHasRoleUnsavedChanges(false);
      await refreshUserProfile();
      await fetchAllData();
      appAlert(`Ruolo "${roleDraft.name}" aggiornato con successo!`, 'Salvato', 'success');
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante il salvataggio del ruolo', 'Errore', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCreateNewRole = async (e) => {
    e.preventDefault();
    if (!newRoleForm.name.trim() || isProcessing) return;
    setIsProcessing(true);
    try {
      const initialPerms = buildTemplatePermissions(newRoleForm.template);
      const res = await axios.post(
        `http://${window.location.hostname}:3000/api/users/roles`,
        {
          name: newRoleForm.name.trim(),
          description: newRoleForm.description.trim(),
          color: newRoleForm.color,
          permissions: initialPerms
        },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      setShowCreateRoleModal(false);
      setNewRoleForm({ name: '', description: '', color: '#10b981', template: 'full' });
      await fetchAllData();
      if (res.data?.role_id) {
        setSelectedRoleId(res.data.role_id);
      }
      setActiveTab('roles');
      appAlert(`Ruolo "${newRoleForm.name.trim()}" creato! Puoi trascinarlo nella lista per regolarne la gerarchia.`, 'Completato', 'success');
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante la creazione del ruolo', 'Errore', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteRole = async () => {
    if (!confirmDeleteRole.role || isProcessing) return;
    setIsProcessing(true);
    try {
      await axios.delete(
        `http://${window.location.hostname}:3000/api/users/roles/${confirmDeleteRole.role.id}`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      setConfirmDeleteRole({ show: false, role: null });
      await fetchAllData();
      appAlert('Ruolo eliminato con successo', 'Completato', 'success');
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante l\'eliminazione del ruolo', 'Errore', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Creazione Nuovo Utente
  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword || !newRoleCode || isProcessing) return;
    setIsProcessing(true);
    try {
      const hasCustomOverrides = Object.keys(newUserOverrides).length > 0 || newUserRestrictedCustomers.length > 0;
      const custom_permissions = hasCustomOverrides
        ? {
            overrides: newUserOverrides,
            restricted_customers: newUserRestrictedCustomers
          }
        : null;

      await axios.post(
        `http://${window.location.hostname}:3000/api/users`,
        {
          username: newUsername.trim(),
          password: newPassword,
          role: newRoleCode,
          custom_permissions
        },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      setNewUsername('');
      setNewPassword('');
      setNewUserOverrides({});
      setNewUserRestrictedCustomers([]);
      setShowNewUserAdvanced(false);
      setShowCreateUserModal(false);
      await fetchAllData();
      appAlert('Utente creato con successo!', 'Completato', 'success');
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore nella creazione dell\'utente', 'Errore', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Apertura Modal Modifica Permessi Singolo Utente
  const openEditUserAccessModal = (u) => {
    if (!canModifyUser(u)) return;
    setEditingUser(u);
    setEditUserRole(u.role);
    setEditUserOverrides(u.custom_permissions?.overrides ? { ...u.custom_permissions.overrides } : {});
    setEditUserRestrictedCustomers(
      Array.isArray(u.custom_permissions?.restricted_customers)
        ? u.custom_permissions.restricted_customers.map(Number)
        : []
    );
    setEditUserUnlockedCustomers(
      Array.isArray(u.custom_permissions?.unlocked_customers)
        ? u.custom_permissions.unlocked_customers.map(Number)
        : []
    );
    setEditUserAccessMode(u.customer_access_mode || u.custom_permissions?.customer_access_mode || 'BLACKLIST');
    setEditUserPermSearch('');
  };

  const handleSaveUserAccess = async () => {
    if (!editingUser || isProcessing) return;
    setIsProcessing(true);
    try {
      const cleanOverrides = {};
      for (const [k, v] of Object.entries(editUserOverrides)) {
        if (v === 'ALLOW' || v === true) cleanOverrides[k] = 'ALLOW';
        else if (v === 'DENY' || v === false) cleanOverrides[k] = 'DENY';
      }

      const hasAnyCustom =
        Object.keys(cleanOverrides).length > 0 ||
        editUserRestrictedCustomers.length > 0 ||
        editUserUnlockedCustomers.length > 0 ||
        editUserAccessMode === 'WHITELIST';

      const custom_permissions = hasAnyCustom
        ? {
            overrides: cleanOverrides,
            restricted_customers: editUserRestrictedCustomers,
            unlocked_customers: editUserUnlockedCustomers,
            customer_access_mode: editUserAccessMode
          }
        : null;

      await axios.put(
        `http://${window.location.hostname}:3000/api/users/${editingUser.id}/access`,
        {
          role: editUserRole,
          custom_permissions
        },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );

      setEditingUser(null);
      await refreshUserProfile();
      await fetchAllData();
      appAlert(`Accessi e permessi di "${editingUser.username}" aggiornati!`, 'Salvato', 'success');
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore salvataggio permessi utente', 'Errore', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!confirmDeleteUser.user || isProcessing) return;
    setIsProcessing(true);
    try {
      await axios.delete(`http://${window.location.hostname}:3000/api/users/${confirmDeleteUser.user.id}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setConfirmDeleteUser({ show: false, user: null });
      await fetchAllData();
      appAlert('Utente eliminato con successo', 'Completato', 'success');
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante l\'eliminazione', 'Errore', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetModal.user || !resetModal.newPwd || isProcessing) return;
    setIsProcessing(true);
    try {
      await axios.put(
        `http://${window.location.hostname}:3000/api/users/${resetModal.user.id}/reset-password`,
        { newPassword: resetModal.newPwd },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      setResetModal({ show: false, user: null, newPwd: '' });
      appAlert('Password resettata! Al prossimo accesso dovrà obbligatoriamente cambiarla.', 'Completato', 'success');
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante il reset', 'Errore', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
      if (userSearch.trim()) {
        const q = userSearch.toLowerCase();
        return (
          u.username.toLowerCase().includes(q) ||
          (u.role_name || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [users, roleFilter, userSearch]);

  const countUserOverrides = (u) => {
    const ov = u.custom_permissions?.overrides || {};
    return Object.values(ov).filter(v => v === 'ALLOW' || v === 'DENY' || typeof v === 'boolean').length;
  };

  const editingUserRoleObj = useMemo(() => {
    return roles.find(r => r.code === editUserRole) || null;
  }, [roles, editUserRole]);

  const newUserRoleObj = useMemo(() => {
    return roles.find(r => r.code === newRoleCode) || null;
  }, [roles, newRoleCode]);

  return (
    <div className="max-w-7xl mx-auto pb-16 space-y-6">
      {/* Top Header & KPI Bar */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border border-slate-800 rounded-3xl p-6 md:p-8 shadow-2xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 rounded-2xl bg-brand-blue/15 border border-brand-blue/30 text-brand-blue">
                <Shield size={26} />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-black text-brand-white tracking-tight">
                  Team & Gerarchia Ruoli
                </h1>
                <p className="text-slate-400 text-sm">
                  Ordina i ruoli con Drag & Drop: chi sta più in alto gestisce i ruoli e le persone sotto di sé.
                </p>
              </div>
            </div>
          </div>

          {canManageUsers && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => {
                  setNewRoleForm({
                    name: '',
                    description: '',
                    color: '#10b981',
                    template: 'full'
                  });
                  setShowCreateRoleModal(true);
                }}
                className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-brand-white border border-slate-700 font-bold rounded-2xl text-sm flex items-center gap-2 transition-all active:scale-95"
              >
                <Shield size={17} className="text-amber-400" />
                <span>+ Nuovo Ruolo</span>
              </button>
              <button
                onClick={() => setShowCreateUserModal(true)}
                className="px-5 py-3 bg-brand-blue hover:bg-sky-400 text-brand-black font-black rounded-2xl text-sm flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(14,165,233,0.3)] active:scale-95"
              >
                <UserPlus size={18} />
                <span>+ Nuovo Utente</span>
              </button>
            </div>
          )}
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-slate-800/80">
          <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Il Tuo Ruolo Attuale</div>
            <div className="flex items-center gap-2 mt-1.5">
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: currentUser?.role_color || '#f59e0b' }}
              />
              <span className="text-lg font-black text-brand-white truncate">
                {currentUser?.role_name || currentUser?.role}
              </span>
            </div>
            <div className="text-xs font-bold text-brand-blue mt-1">
              Posizione Gerarchica: <strong>#{callerRoleIndex + 1}</strong> {isDeveloper && '👑 (Grado Massimo)'}
            </div>
          </div>

          <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Membri del Team</div>
            <div className="text-2xl font-black text-brand-white mt-1">{users.length}</div>
            <div className="text-xs text-slate-500 mt-1">
              {users.filter(u => canModifyUser(u)).length} gestibili dal tuo grado
            </div>
          </div>

          <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Ruoli in Gerarchia</div>
            <div className="text-2xl font-black text-amber-400 mt-1">{roles.length}</div>
            <div className="text-xs text-slate-500 mt-1">
              {roles.filter(r => canModifyRole(r)).length} modificabili sotto di te
            </div>
          </div>

          <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Vertice Sistema</div>
            <div className="flex items-center gap-1.5 text-amber-400 font-black text-sm mt-2">
              <Crown size={16} /> Software Engineer
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Fisso al #1 • Non eliminabile
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-2 mt-6">
          <button
            onClick={() => setActiveTab('users')}
            className={`px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all ${
              activeTab === 'users'
                ? 'bg-brand-blue text-brand-black shadow-[0_0_15px_rgba(14,165,233,0.3)]'
                : 'bg-slate-950 text-slate-400 hover:text-brand-white border border-slate-800'
            }`}
          >
            <UsersIcon size={16} />
            <span>Membri del Team ({users.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('roles')}
            className={`px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all ${
              activeTab === 'roles'
                ? 'bg-brand-blue text-brand-black shadow-[0_0_15px_rgba(14,165,233,0.3)]'
                : 'bg-slate-950 text-slate-400 hover:text-brand-white border border-slate-800'
            }`}
          >
            <Layers size={16} />
            <span>Gerarchia Ruoli & Permessi ({roles.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('customers_matrix')}
            className={`px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all ${
              activeTab === 'customers_matrix'
                ? 'bg-brand-blue text-brand-black shadow-[0_0_15px_rgba(14,165,233,0.3)]'
                : 'bg-slate-950 text-slate-400 hover:text-brand-white border border-slate-800'
            }`}
          >
            <Building2 size={16} />
            <span>Restrizioni Clienti ({customers.length})</span>
          </button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* TAB 1: MEMBRI DEL TEAM (UTENTI)                                   */}
      {/* ================================================================= */}
      {activeTab === 'users' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 shadow-xl">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div className="relative flex-1 max-w-md">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                placeholder="Cerca membro per username o ruolo..."
                className="w-full bg-slate-950 border border-slate-800 text-brand-white text-sm rounded-xl pl-10 pr-4 py-2.5 focus:border-brand-blue"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setRoleFilter('ALL')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  roleFilter === 'ALL'
                    ? 'bg-brand-blue text-brand-black'
                    : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-white'
                }`}
              >
                Tutti ({users.length})
              </button>
              {roles.map((r, idx) => (
                <button
                  key={r.code}
                  onClick={() => setRoleFilter(r.code)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all border ${
                    roleFilter === r.code
                      ? 'bg-slate-800 text-brand-white border-brand-blue'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: r.color }} />
                  <span>#{idx + 1} {r.name}</span>
                  <span className="text-[10px] opacity-70">({r.member_count || 0})</span>
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="text-slate-500 py-12 text-center animate-pulse font-bold">Caricamento team in corso...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredUsers.map(u => {
                const isTargetDev = u.role === 'developer';
                const editable = canModifyUser(u);
                const deletable = canDeleteUserAccount(u);
                const overrideCount = countUserOverrides(u);
                const restrictedCount = u.restricted_customers?.length || 0;
                const enabledPermsCount = Object.values(u.effective_permissions || {}).filter(Boolean).length;
                const roleRank = roles.findIndex(r => r.code === u.role) + 1;

                return (
                  <div
                    key={u.id}
                    className={`bg-slate-950/80 border rounded-2xl p-5 flex flex-col justify-between gap-4 transition-all ${
                      !editable
                        ? 'border-slate-800/70 opacity-85'
                        : isTargetDev
                          ? 'border-amber-500/40 shadow-[0_0_20px_rgba(245,158,11,0.08)]'
                          : 'border-slate-800/90 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div
                          className="w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg shrink-0 border"
                          style={{
                            backgroundColor: `${u.role_color || '#38bdf8'}20`,
                            borderColor: `${u.role_color || '#38bdf8'}50`,
                            color: u.role_color || '#38bdf8'
                          }}
                        >
                          {isTargetDev ? <Crown size={22} /> : u.username.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-lg font-black text-brand-white truncate">{u.username}</h3>
                            {Number(u.id) === Number(currentUser?.id) && (
                              <span className="px-2 py-0.5 rounded-md bg-brand-blue/15 text-brand-blue border border-brand-blue/30 text-[10px] font-black uppercase">
                                Tu
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span
                              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border"
                              style={{
                                backgroundColor: `${u.role_color || '#38bdf8'}18`,
                                borderColor: `${u.role_color || '#38bdf8'}45`,
                                color: u.role_color || '#38bdf8'
                              }}
                            >
                              <Shield size={12} />
                              {u.role_name}
                            </span>
                            {roleRank > 0 && (
                              <span className="text-[11px] font-bold text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                                Grado #{roleRank}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {!editable ? (
                        <span className="px-2.5 py-1 rounded-xl bg-slate-900 border border-slate-700 text-slate-400 text-[10px] font-black uppercase flex items-center gap-1 shrink-0">
                          <Lock size={11} className="text-amber-400" /> Bloccato
                        </span>
                      ) : isTargetDev ? (
                        <span className="px-2.5 py-1 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[10px] font-black uppercase tracking-wider flex items-center gap-1 shrink-0">
                          <Crown size={11} /> Grado Massimo
                        </span>
                      ) : null}
                    </div>

                    {/* Pills riepilogo permessi effettivi */}
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-900">
                      <span className="text-[11px] font-semibold text-slate-400 bg-slate-900/90 px-2.5 py-1 rounded-lg border border-slate-800">
                        Permessi attivi: <strong className="text-emerald-400">{enabledPermsCount}/{allPermKeys.length}</strong>
                      </span>

                      {overrideCount > 0 && (
                        <span className="text-[11px] font-bold text-amber-300 bg-amber-500/15 px-2.5 py-1 rounded-lg border border-amber-500/30 flex items-center gap-1">
                          <Sparkles size={11} /> {overrideCount} Override Singoli
                        </span>
                      )}

                      {restrictedCount > 0 ? (
                        <span className="text-[11px] font-bold text-rose-300 bg-rose-500/15 px-2.5 py-1 rounded-lg border border-rose-500/30 flex items-center gap-1">
                          <Lock size={11} /> {restrictedCount} Client{restrictedCount === 1 ? 'e Bloccato' : 'i Bloccati'}
                        </span>
                      ) : (
                        <span className="text-[11px] font-semibold text-slate-400 bg-slate-900/90 px-2.5 py-1 rounded-lg border border-slate-800">
                          Clienti: <strong className="text-sky-400">Tutti</strong>
                        </span>
                      )}
                    </div>

                    {/* Footer card: Data & Azioni */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-900">
                      <span className="text-xs text-slate-500">
                        Creato il {new Date(u.created_at).toLocaleDateString('it-IT')}
                      </span>

                      <div className="flex items-center gap-2">
                        {editable ? (
                          <>
                            <button
                              onClick={() => openEditUserAccessModal(u)}
                              className="px-3 py-1.5 rounded-xl bg-brand-blue/15 hover:bg-brand-blue text-brand-blue hover:text-brand-black border border-brand-blue/30 text-xs font-bold flex items-center gap-1.5 transition-all"
                              title="Personalizza Ruolo, Permessi Singoli e Restrizioni Clienti"
                            >
                              <Sliders size={14} />
                              <span>Permessi & Ruolo</span>
                            </button>
                            <button
                              onClick={() => setResetModal({ show: true, user: u, newPwd: '' })}
                              className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-brand-blue border border-slate-800 transition-colors"
                              title="Forza Reset Password"
                            >
                              <Key size={15} />
                            </button>
                            {deletable && (
                              <button
                                onClick={() => setConfirmDeleteUser({ show: true, user: u })}
                                className="p-2 rounded-xl bg-rose-950/40 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-900/50 transition-colors"
                                title="Elimina Utente"
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </>
                        ) : (
                          <span className="text-[11px] text-slate-500 font-semibold flex items-center gap-1">
                            <Lock size={12} /> Non modificabile dal tuo ruolo
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 2: GERARCHIA RUOLI DRAG & DROP E PERMESSI                     */}
      {/* ================================================================= */}
      {activeTab === 'roles' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Colonna Sinistra: Gerarchia Ruoli Drag & Drop */}
          <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black text-brand-white flex items-center gap-2">
                  <Layers size={18} className="text-brand-blue" /> Gerarchia Ruoli
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Trascina i ruoli sotto il tuo grado per cambiare chi ha più potere. Il ruolo più in alto comanda su quelli sotto.
                </p>
              </div>
              {canManageUsers && (
                <button
                  onClick={() => setShowCreateRoleModal(true)}
                  className="p-2 rounded-xl bg-brand-blue text-brand-black hover:bg-sky-400 transition-colors shrink-0"
                  title="Crea Nuovo Ruolo"
                >
                  <Plus size={18} />
                </button>
              )}
            </div>

            <DragDropContext onDragEnd={handleRoleDragEnd}>
              <Droppable droppableId="roles-hierarchy-list">
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="space-y-2"
                  >
                    {roles.map((r, idx) => {
                      const isSelected = roleDraft && r.id === roleDraft.id;
                      const modifiable = canModifyRole(r);
                      const draggable = canDragRole(r, idx);
                      const isCallerOwnRole = r.code === currentUser?.role;

                      return (
                        <Draggable
                          key={String(r.id)}
                          draggableId={String(r.id)}
                          index={idx}
                          isDragDisabled={!draggable}
                        >
                          {(dragProvided, snapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              onClick={() => handleSelectRole(r)}
                              className={`w-full text-left p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-2 cursor-pointer select-none ${
                                snapshot.isDragging
                                  ? 'bg-slate-800 border-brand-blue shadow-2xl scale-[1.02] z-30'
                                  : isSelected
                                    ? 'bg-slate-800/90 border-brand-blue shadow-[0_0_20px_rgba(14,165,233,0.15)]'
                                    : 'bg-slate-950/70 border-slate-800/80 hover:bg-slate-900 hover:border-slate-700'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                {/* Drag Handle o Lucchetto */}
                                <div
                                  {...dragProvided.dragHandleProps}
                                  onClick={e => e.stopPropagation()}
                                  className={`p-1.5 rounded-lg flex items-center justify-center shrink-0 ${
                                    draggable
                                      ? 'text-slate-400 hover:text-brand-blue hover:bg-slate-800 cursor-grab active:cursor-grabbing'
                                      : 'text-slate-600 cursor-not-allowed'
                                  }`}
                                  title={
                                    r.code === 'developer'
                                      ? 'Il Software Engineer rimane sempre in cima (#1)'
                                      : draggable
                                        ? 'Trascina per cambiare ordine gerarchico'
                                        : 'Bloccato: puoi riordinare solo i ruoli sotto il tuo'
                                  }
                                >
                                  {draggable ? <GripVertical size={16} /> : <Lock size={14} />}
                                </div>

                                <span
                                  className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm"
                                  style={{ backgroundColor: r.color || '#38bdf8' }}
                                />

                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[11px] font-mono font-black text-slate-400">
                                      #{idx + 1}
                                    </span>
                                    <span className="font-black text-sm text-brand-white truncate">{r.name}</span>
                                    {r.code === 'developer' && (
                                      <Crown size={13} className="text-amber-400 shrink-0" title="Grado Massimo" />
                                    )}
                                    {isCallerOwnRole && (
                                      <span className="px-1.5 py-0.5 rounded bg-brand-blue/15 text-brand-blue text-[9px] font-black uppercase">
                                        Tuo Ruolo
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                                    <span>{r.member_count || 0} utent{r.member_count === 1 ? 'e' : 'i'}</span>
                                    {!modifiable && (
                                      <>
                                        <span>•</span>
                                        <span className="text-amber-400/90 font-semibold">Bloccato</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                {draggable && (
                                  <div className="flex flex-col gap-0.5 mr-1" onClick={e => e.stopPropagation()}>
                                    <button
                                      type="button"
                                      disabled={idx <= minDroppableIndex}
                                      onClick={() => handleMoveRoleStep(idx, -1)}
                                      className="p-0.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white disabled:opacity-20"
                                      title="Sposta più in alto"
                                    >
                                      <ChevronUp size={13} />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={idx >= roles.length - 1}
                                      onClick={() => handleMoveRoleStep(idx, 1)}
                                      className="p-0.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white disabled:opacity-20"
                                      title="Sposta più in basso"
                                    >
                                      <ChevronDown size={13} />
                                    </button>
                                  </div>
                                )}
                                <ChevronRight size={16} className={isSelected ? 'text-brand-blue' : 'text-slate-600'} />
                              </div>
                            </div>
                          )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          </div>

          {/* Colonna Destra: Configurazione Granulare del Ruolo Selezionato */}
          <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 shadow-xl space-y-6">
            {roleDraft ? (
              <>
                {/* Banner informativo se bloccato */}
                {!canModifyRole(roleDraft) && (
                  <div className="p-4 rounded-2xl bg-amber-950/30 border border-amber-500/40 text-amber-200 text-xs font-bold flex items-center gap-3">
                    <Lock size={18} className="text-amber-400 shrink-0" />
                    <div>
                      {roleDraft.code === currentUser?.role
                        ? `Questo è il tuo ruolo attuale (${roleDraft.name}). Per sicurezza gerarchica non puoi modificare il tuo stesso ruolo, ma solo quelli posizionati sotto di te.`
                        : `Il ruolo "${roleDraft.name}" si trova sopra il tuo grado nella gerarchia ed è bloccato. Puoi consultarlo in sola lettura.`}
                    </div>
                  </div>
                )}

                {roleDraft.code === 'developer' && isDeveloper && (
                  <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs font-bold flex items-center gap-3">
                    <Crown size={18} className="text-amber-400 shrink-0" />
                    <div>
                      <strong>Software Engineer (Grado Massimo #1):</strong> Rimane sempre in cima alla gerarchia e non può essere eliminato nemmeno da te stesso. Puoi personalizzarne i dettagli e creare anche ruoli pari per capacità.
                    </div>
                  </div>
                )}

                {/* Intestazione e Identità Ruolo */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800">
                  <div className="flex items-center gap-3">
                    <span
                      className="w-5 h-5 rounded-full shrink-0"
                      style={{ backgroundColor: roleDraft.color || '#38bdf8' }}
                    />
                    <div>
                      <h2 className="text-2xl font-black text-brand-white">{roleDraft.name}</h2>
                      <p className="text-xs text-slate-400 font-mono">
                        Posizione Gerarchia: #{roles.findIndex(r => r.id === roleDraft.id) + 1} • Codice: {roleDraft.code}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {canModifyRole(roleDraft) && roleDraft.code !== 'developer' && roleDraft.code !== 'operator' && (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteRole({ show: true, role: roleDraft })}
                        className="px-3.5 py-2 rounded-xl bg-rose-950/50 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-800/50 text-xs font-bold flex items-center gap-1.5 transition-colors"
                      >
                        <Trash2 size={14} /> Elimina Ruolo
                      </button>
                    )}
                    {canModifyRole(roleDraft) && (
                      <button
                        type="button"
                        onClick={handleSaveRoleDraft}
                        disabled={!hasRoleUnsavedChanges || isProcessing}
                        className="px-5 py-2.5 rounded-xl bg-brand-blue hover:bg-sky-400 disabled:opacity-40 text-brand-black font-black text-xs flex items-center gap-2 transition-all shadow-lg"
                      >
                        <Save size={15} />
                        <span>{isProcessing ? 'Salvataggio...' : 'Salva Ruolo'}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Campi Nome, Descrizione, Colore */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                      Nome del Ruolo
                    </label>
                    <input
                      type="text"
                      disabled={!canModifyRole(roleDraft) || roleDraft.code === 'developer'}
                      value={roleDraft.name || ''}
                      onChange={e => updateRoleDraftField('name', e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-brand-white font-bold text-sm disabled:opacity-60"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                      Descrizione Mansioni
                    </label>
                    <input
                      type="text"
                      disabled={!canModifyRole(roleDraft)}
                      value={roleDraft.description || ''}
                      onChange={e => updateRoleDraftField('description', e.target.value)}
                      placeholder="Es. Accesso completo tranne Finanza..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-200 text-sm disabled:opacity-60"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                      Colore Distintivo
                    </label>
                    <div className="flex items-center gap-1.5 flex-wrap bg-slate-950 border border-slate-800 rounded-xl p-2.5">
                      {DISCORD_COLORS.map(c => (
                        <button
                          key={c}
                          type="button"
                          disabled={!canModifyRole(roleDraft)}
                          onClick={() => updateRoleDraftField('color', c)}
                          className={`w-5 h-5 rounded-full transition-transform ${
                            roleDraft.color === c ? 'scale-125 ring-2 ring-white' : 'opacity-70 hover:opacity-100'
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Preset Rapidi Permessi */}
                {canModifyRole(roleDraft) && (
                  <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
                      <Sparkles size={14} className="text-amber-400" /> Preset Rapidi:
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => applyPresetToRoleDraft('full')}
                        className="px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-bold transition-colors"
                      >
                        ✅ Tutti i Permessi (Grado Pieno)
                      </button>
                      <button
                        type="button"
                        onClick={() => applyPresetToRoleDraft('view_only')}
                        className="px-3 py-1.5 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 text-xs font-bold transition-colors"
                      >
                        👁️ Solo Visualizzazione Gestionale
                      </button>
                      <button
                        type="button"
                        onClick={() => applyPresetToRoleDraft('quality')}
                        className="px-3 py-1.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 text-xs font-bold transition-colors"
                      >
                        🛡️ Qualità & Quarantena
                      </button>
                      <button
                        type="button"
                        onClick={() => applyPresetToRoleDraft('operator')}
                        className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-colors"
                      >
                        📱 Solo Zebra
                      </button>
                      <button
                        type="button"
                        onClick={() => applyPresetToRoleDraft('none')}
                        className="px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-bold transition-colors"
                      >
                        ❌ Azzera Tutto
                      </button>
                    </div>
                  </div>
                )}

                {/* Ricerca Permessi */}
                <div className="relative">
                  <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={rolePermSearch}
                    onChange={e => setRolePermSearch(e.target.value)}
                    placeholder="Filtra permessi (es. zebra, nuova merce, quarantena, elimina, spedizioni, finanza)..."
                    className="w-full bg-slate-950 border border-slate-800 text-brand-white text-sm rounded-xl pl-10 pr-4 py-2.5 focus:border-brand-blue"
                  />
                </div>

                {/* Lista Categorie e Switch Permessi */}
                <div className="space-y-6">
                  {catalog.map(cat => {
                    const visibleItems = cat.items.filter(it => {
                      if (!rolePermSearch.trim()) return true;
                      const q = rolePermSearch.toLowerCase();
                      return it.label.toLowerCase().includes(q) || it.desc.toLowerCase().includes(q);
                    });
                    if (visibleItems.length === 0) return null;

                    return (
                      <div key={cat.category} className="bg-slate-950/60 border border-slate-800/90 rounded-2xl p-5">
                        <div className="mb-4">
                          <h3 className="text-sm font-black uppercase tracking-wider text-brand-blue">{cat.title}</h3>
                          <p className="text-xs text-slate-400 mt-0.5">{cat.description}</p>
                        </div>

                        <div className="divide-y divide-slate-800/60">
                          {visibleItems.map(item => {
                            const isAlwaysOnForDev = roleDraft.code === 'developer' && (item.key === 'view_users' || item.key === 'users_manage');
                            const isEnabled = isAlwaysOnForDev ? true : Boolean(roleDraft.permissions?.[item.key]);
                            const switchDisabled = !canModifyRole(roleDraft) || isAlwaysOnForDev;

                            return (
                              <div key={item.key} className="py-3.5 flex items-center justify-between gap-4">
                                <div className="min-w-0">
                                  <div className="text-sm font-bold text-brand-white flex items-center gap-2">
                                    <span>{item.label}</span>
                                    {item.key === 'quarantine_manage' && (
                                      <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-black uppercase">
                                        Quarantena
                                      </span>
                                    )}
                                    {(item.key === 'pallet_delete' || item.key === 'outbound_delete') && (
                                      <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-black uppercase">
                                        Critico
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-slate-400 mt-0.5">{item.desc}</p>
                                </div>

                                <button
                                  type="button"
                                  disabled={switchDisabled}
                                  onClick={() => toggleRoleDraftPermission(item.key)}
                                  className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed ${
                                    isEnabled ? 'bg-emerald-500' : 'bg-slate-800'
                                  }`}
                                >
                                  <span
                                    className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out flex items-center justify-center ${
                                      isEnabled ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                                  >
                                    {isEnabled ? (
                                      <Check size={13} className="text-emerald-600 stroke-[3]" />
                                    ) : (
                                      <X size={13} className="text-slate-500 stroke-[3]" />
                                    )}
                                  </span>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Sezione Restrizioni per Cliente sul Ruolo */}
                <div className="bg-slate-950/60 border border-slate-800/90 rounded-2xl p-5">
                  <div className="mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-black uppercase tracking-wider text-amber-400 flex items-center gap-2">
                        <Building2 size={16} /> Accesso Merce per Cliente / Client Portal
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {roleDraft.permissions?.customer_access_mode === 'WHITELIST'
                          ? 'Modalità Whitelist (Client Portal): gli utenti vedranno ESCLUSIVAMENTE i clienti selezionati.'
                          : 'Modalità Standard (Magazzino): tutti i clienti sono operativi tranne quelli contrassegnati in rosso.'}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 p-1 bg-slate-900 border border-slate-800 rounded-xl text-xs font-bold shrink-0">
                      <button
                        type="button"
                        disabled={!canModifyRole(roleDraft)}
                        onClick={() => setRoleDraftAccessMode('BLACKLIST')}
                        className={`px-3 py-1.5 rounded-lg transition-all ${(roleDraft.permissions?.customer_access_mode || 'BLACKLIST') !== 'WHITELIST' ? 'bg-brand-blue text-brand-black font-black' : 'text-slate-400 hover:text-white'}`}
                      >
                        Blacklist (Escludi)
                      </button>
                      <button
                        type="button"
                        disabled={!canModifyRole(roleDraft)}
                        onClick={() => setRoleDraftAccessMode('WHITELIST')}
                        className={`px-3 py-1.5 rounded-lg transition-all ${roleDraft.permissions?.customer_access_mode === 'WHITELIST' ? 'bg-amber-400 text-slate-950 font-black' : 'text-slate-400 hover:text-white'}`}
                      >
                        Whitelist (Client Portal)
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                    {customers.map(c => {
                      const isBlocked =
                        Array.isArray(roleDraft.permissions?.restricted_customers) &&
                        roleDraft.permissions.restricted_customers.map(Number).includes(Number(c.id));

                      return (
                        <button
                          key={c.id}
                          type="button"
                          disabled={!canModifyRole(roleDraft)}
                          onClick={() => toggleRoleDraftCustomerRestriction(c.id)}
                          className={`p-3 rounded-xl border text-left flex items-center justify-between gap-2 transition-all disabled:opacity-50 ${
                            isBlocked
                              ? 'bg-rose-950/40 border-rose-500/40 text-rose-300'
                              : 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300 hover:bg-emerald-950/40'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-black truncate">{c.business_name}</div>
                            <div className="text-[10px] opacity-80">
                              {isBlocked ? '🔒 Bloccato (Non può toccare)' : '✅ Operativo'}
                            </div>
                          </div>
                          {isBlocked ? <Lock size={15} className="shrink-0" /> : <Unlock size={15} className="shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Sticky Unsaved Bar */}
                {hasRoleUnsavedChanges && canModifyRole(roleDraft) && (
                  <div className="sticky bottom-4 z-30 bg-slate-950/95 border-2 border-brand-blue rounded-2xl p-4 shadow-2xl flex items-center justify-between gap-4 backdrop-blur-md">
                    <div className="text-xs md:text-sm font-bold text-brand-white flex items-center gap-2">
                      <AlertTriangle size={18} className="text-amber-400 shrink-0" />
                      <span>Hai modifiche non salvate per il ruolo <strong className="text-brand-blue">{roleDraft.name}</strong>!</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const orig = roles.find(r => r.id === roleDraft.id);
                          if (orig) setRoleDraft(JSON.parse(JSON.stringify(orig)));
                          setHasRoleUnsavedChanges(false);
                        }}
                        className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
                      >
                        Annulla
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveRoleDraft}
                        disabled={isProcessing}
                        className="px-5 py-2 rounded-xl bg-brand-blue hover:bg-sky-400 text-brand-black font-black text-xs flex items-center gap-1.5"
                      >
                        <Save size={14} /> Salva Ora
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-slate-500 text-center py-12">Seleziona un ruolo dalla gerarchia a sinistra</div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 3: MATRICE RESTRIZIONI CLIENTI                                */}
      {/* ================================================================= */}
      {activeTab === 'customers_matrix' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 shadow-xl space-y-6">
          <div>
            <h2 className="text-xl font-black text-brand-white flex items-center gap-2">
              <Building2 className="text-brand-blue" /> Matrice Accesso Merce Clienti
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              Panoramica immediata di quali utenti hanno blocchi operativi sulla merce di determinati clienti.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-400">
                  <th className="py-3 px-4">Utente / Ruolo</th>
                  <th className="py-3 px-4">Posizione Gerarchia</th>
                  <th className="py-3 px-4">Clienti Bloccati (Non può toccare la merce)</th>
                  <th className="py-3 px-4 text-right">Azione</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-sm">
                {users.map(u => {
                  const blockedIds = u.restricted_customers || [];
                  const blockedNames = customers
                    .filter(c => blockedIds.map(Number).includes(Number(c.id)))
                    .map(c => c.business_name);
                  const rRank = roles.findIndex(r => r.code === u.role) + 1;

                  return (
                    <tr key={u.id} className="hover:bg-slate-800/30">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-brand-white">{u.username}</div>
                        <div className="text-xs font-bold" style={{ color: u.role_color }}>{u.role_name}</div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs text-slate-400">
                        {rRank > 0 ? `Grado #${rRank}` : '-'}
                      </td>
                      <td className="py-3.5 px-4">
                        {blockedNames.length === 0 ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-xs font-bold">
                            <Check size={12} /> Può operare su tutti i clienti
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {blockedNames.map(name => (
                              <span key={name} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/15 text-rose-300 border border-rose-500/30 text-xs font-bold">
                                <Lock size={11} /> {name}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {canModifyUser(u) ? (
                          <button
                            onClick={() => openEditUserAccessModal(u)}
                            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-brand-blue hover:text-brand-black text-brand-blue text-xs font-bold transition-colors"
                          >
                            Configura Clienti
                          </button>
                        ) : (
                          <span className="text-xs text-slate-500 inline-flex items-center gap-1">
                            <Lock size={12} /> Bloccato
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL CREAZIONE NUOVO UTENTE INTERATTIVA                          */}
      {/* ================================================================= */}
      {showCreateUserModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/80 backdrop-blur-md"
          onClick={() => !isProcessing && setShowCreateUserModal(false)}
        >
          <div
            className="bg-slate-900 border border-slate-700/80 rounded-3xl p-6 md:p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-brand-blue/15 text-brand-blue">
                  <UserPlus size={22} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-brand-white">Crea Nuovo Membro del Team</h2>
                  <p className="text-xs text-slate-400">Assegna un ruolo della gerarchia e personalizza subito gli accessi singoli.</p>
                </div>
              </div>
              <button onClick={() => setShowCreateUserModal(false)} className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Username *</label>
                  <input
                    type="text"
                    required
                    value={newUsername}
                    onChange={e => setNewUsername(e.target.value)}
                    placeholder="Es. Marco.Qualita"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-brand-white font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Password Iniziale *</label>
                  <input
                    type="password"
                    required
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="Minimo 6 caratteri"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-brand-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Seleziona Ruolo {isDeveloper ? '(Tutti i ruoli disponibili, incluso pari grado)' : '(Ruoli sotto il tuo grado)'}
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {assignableRoles.map(r => {
                    const isSel = newRoleCode === r.code;
                    const rankPos = roles.findIndex(x => x.code === r.code) + 1;
                    return (
                      <button
                        key={r.code}
                        type="button"
                        onClick={() => setNewRoleCode(r.code)}
                        className={`p-3.5 rounded-2xl border text-left transition-all ${
                          isSel
                            ? 'bg-slate-800 border-brand-blue shadow-[0_0_15px_rgba(14,165,233,0.2)]'
                            : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-black text-sm text-brand-white flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                            {r.name}
                          </span>
                          <span className="text-[10px] font-mono text-brand-blue font-bold">#{rankPos}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{r.description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Toggle Personalizzazione Singola immediata */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewUserAdvanced(!showNewUserAdvanced)}
                  className="w-full p-3.5 rounded-2xl bg-slate-950 border border-slate-800 hover:border-brand-blue/50 flex items-center justify-between text-xs font-bold text-brand-blue transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <Sliders size={15} />
                    Personalizza accessi singoli o blocca clienti specifici per questo utente (Opzionale)
                  </span>
                  <span>{showNewUserAdvanced ? 'Nascondi ▲' : 'Espandi ▼'}</span>
                </button>

                {showNewUserAdvanced && (
                  <div className="mt-3 p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-4 max-h-72 overflow-y-auto">
                    <div>
                      <div className="text-xs font-black uppercase text-amber-400 mb-2">
                        Clienti che questo utente NON può toccare:
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {customers.map(c => {
                          const blocked = newUserRestrictedCustomers.includes(Number(c.id));
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => {
                                const cid = Number(c.id);
                                setNewUserRestrictedCustomers(prev =>
                                  prev.includes(cid) ? prev.filter(x => x !== cid) : [...prev, cid]
                                );
                              }}
                              className={`px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 ${
                                blocked
                                  ? 'bg-rose-500/20 border-rose-500 text-rose-300'
                                  : 'bg-slate-900 border-slate-800 text-slate-300'
                              }`}
                            >
                              {blocked ? <Lock size={12} /> : <Unlock size={12} />}
                              {c.business_name}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-black uppercase text-brand-blue mb-2">
                        Eccezioni Permessi Singoli rispetto al ruolo &quot;{newUserRoleObj?.name}&quot;:
                      </div>
                      <div className="space-y-1.5">
                        {catalog.flatMap(c => c.items).map(it => {
                          const roleDefault = Boolean(newUserRoleObj?.permissions?.[it.key]);
                          const currentOv = newUserOverrides[it.key];
                          return (
                            <div key={it.key} className="flex items-center justify-between py-1.5 border-b border-slate-900 text-xs">
                              <span className="text-slate-300 font-semibold">{it.label}</span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => setNewUserOverrides(p => ({ ...p, [it.key]: 'DENY' }))}
                                  className={`px-2 py-1 rounded font-bold ${currentOv === 'DENY' ? 'bg-rose-600 text-white' : 'bg-slate-900 text-slate-500'}`}
                                >
                                  Nega
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const copy = { ...newUserOverrides };
                                    delete copy[it.key];
                                    setNewUserOverrides(copy);
                                  }}
                                  className={`px-2 py-1 rounded font-bold ${!currentOv ? 'bg-slate-700 text-white' : 'bg-slate-900 text-slate-500'}`}
                                >
                                  Ruolo ({roleDefault ? 'Sì' : 'No'})
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setNewUserOverrides(p => ({ ...p, [it.key]: 'ALLOW' }))}
                                  className={`px-2 py-1 rounded font-bold ${currentOv === 'ALLOW' ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-slate-500'}`}
                                >
                                  Consenti
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCreateUserModal(false)}
                  className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-brand-white font-bold rounded-xl"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={isProcessing}
                  className="flex-1 py-3 bg-brand-blue hover:bg-sky-400 text-brand-black font-black rounded-xl"
                >
                  {isProcessing ? 'Creazione...' : 'Crea Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL CREAZIONE NUOVO RUOLO (SENZA PUNTI POTERE)                  */}
      {/* ================================================================= */}
      {showCreateRoleModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/80 backdrop-blur-md"
          onClick={() => !isProcessing && setShowCreateRoleModal(false)}
        >
          <div
            className="bg-slate-900 border border-slate-700/80 rounded-3xl p-6 md:p-8 max-w-lg w-full shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-6">
              <h2 className="text-xl font-black text-brand-white flex items-center gap-2">
                <Shield className="text-amber-400" /> Crea Nuovo Ruolo
              </h2>
              <button onClick={() => setShowCreateRoleModal(false)} className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateNewRole} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Nome del Ruolo *</label>
                <input
                  type="text"
                  required
                  value={newRoleForm.name}
                  onChange={e => setNewRoleForm({ ...newRoleForm, name: e.target.value })}
                  placeholder="Es. Direzione, Responsabile Logistica, Capo Turno..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-brand-white font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Descrizione</label>
                <input
                  type="text"
                  value={newRoleForm.description}
                  onChange={e => setNewRoleForm({ ...newRoleForm, description: e.target.value })}
                  placeholder="Breve descrizione delle responsabilità..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-brand-white text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Colore Badge</label>
                <div className="flex items-center gap-2 flex-wrap bg-slate-950 border border-slate-800 rounded-xl p-3">
                  {DISCORD_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewRoleForm({ ...newRoleForm, color: c })}
                      className={`w-6 h-6 rounded-full transition-transform ${newRoleForm.color === c ? 'scale-125 ring-2 ring-white' : 'opacity-70 hover:opacity-100'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Modello Permessi di Partenza</label>
                <select
                  value={newRoleForm.template}
                  onChange={e => setNewRoleForm({ ...newRoleForm, template: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-brand-white text-sm font-bold"
                >
                  <option value="full">🌟 Accesso Completo (Tutti i permessi abilitati)</option>
                  <option value="view_only">👁️ Solo Visualizzazione Gestionale</option>
                  <option value="quality">🛡️ Controllo Qualità & Quarantena</option>
                  <option value="operator">📱 Operatore Terminale Zebra</option>
                  <option value="none">⚙️ Vuoto (Configura manualmente dopo)</option>
                </select>
                <p className="text-[11px] text-slate-400 mt-2">
                  Il nuovo ruolo verrà posizionato subito sotto il tuo grado attuale e potrai spostarlo liberamente con il <strong>Drag &amp; Drop</strong>.
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setShowCreateRoleModal(false)} className="flex-1 py-3 bg-slate-800 text-brand-white font-bold rounded-xl">
                  Annulla
                </button>
                <button type="submit" disabled={isProcessing} className="flex-1 py-3 bg-brand-blue text-brand-black font-black rounded-xl">
                  {isProcessing ? 'Creazione...' : 'Crea e Configura'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL OVERRIDE SINGOLO UTENTE                                     */}
      {/* ================================================================= */}
      {editingUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/80 backdrop-blur-md"
          onClick={() => !isProcessing && setEditingUser(null)}
        >
          <div
            className="bg-slate-900 border border-slate-700/80 rounded-3xl p-6 md:p-8 max-w-4xl w-full max-h-[92vh] overflow-y-auto shadow-2xl space-y-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <h2 className="text-xl md:text-2xl font-black text-brand-white flex items-center gap-2">
                  <Sliders className="text-brand-blue" /> Permessi & Accessi Singoli: <span className="text-brand-blue">{editingUser.username}</span>
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Modifica il ruolo assegnato o crea eccezioni individuali (Consenti / Eredita dal Ruolo / Nega) e blocchi specifici per cliente.
                </p>
              </div>
              <button onClick={() => setEditingUser(null)} className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            {/* Scelta Ruolo Base */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4">
              <label className="block text-xs font-black uppercase tracking-wider text-slate-400 mb-2">
                Ruolo Gerarchico Assegnato
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {assignableRoles.map(r => {
                  const rPos = roles.findIndex(x => x.code === r.code) + 1;
                  return (
                    <button
                      key={r.code}
                      type="button"
                      onClick={() => setEditUserRole(r.code)}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        editUserRole === r.code
                          ? 'bg-slate-800 border-brand-blue'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-brand-white flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                          {r.name}
                        </span>
                        <span className="text-[10px] font-mono text-brand-blue">#{rPos}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Restrizioni Clienti per questo singolo utente */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider text-amber-400 flex items-center gap-2">
                    <Building2 size={16} /> Accesso ai Clienti per {editingUser.username}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {editUserAccessMode === 'WHITELIST'
                      ? 'Modalità Whitelist (Client Portal): questo utente vedrà SOLTANTO i clienti attivi contrassegnati in verde.'
                      : 'Modalità Blacklist: l\'operatività è consentita su tutti i clienti tranne quelli bloccati in rosso.'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 p-1 bg-slate-900 border border-slate-800 rounded-xl text-xs font-bold shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditUserAccessMode('BLACKLIST')}
                    className={`px-3 py-1 rounded-lg transition-all ${editUserAccessMode !== 'WHITELIST' ? 'bg-brand-blue text-brand-black font-black' : 'text-slate-400 hover:text-white'}`}
                  >
                    Blacklist
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditUserAccessMode('WHITELIST')}
                    className={`px-3 py-1 rounded-lg transition-all ${editUserAccessMode === 'WHITELIST' ? 'bg-amber-400 text-slate-950 font-black' : 'text-slate-400 hover:text-white'}`}
                  >
                    Client Portal (Whitelist)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {customers.map(c => {
                  const cid = Number(c.id);
                  const roleBlocksIt = Array.isArray(editingUserRoleObj?.permissions?.restricted_customers) &&
                    editingUserRoleObj.permissions.restricted_customers.map(Number).includes(cid);
                  const userBlocksIt = editUserRestrictedCustomers.includes(cid);
                  const userUnlocksIt = editUserUnlockedCustomers.includes(cid);
                  const isEffectivelyBlocked = (roleBlocksIt && !userUnlocksIt) || userBlocksIt;

                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        if (isEffectivelyBlocked) {
                          setEditUserRestrictedCustomers(prev => prev.filter(id => id !== cid));
                          if (roleBlocksIt) {
                            setEditUserUnlockedCustomers(prev => [...new Set([...prev, cid])]);
                          }
                        } else {
                          setEditUserUnlockedCustomers(prev => prev.filter(id => id !== cid));
                          setEditUserRestrictedCustomers(prev => [...new Set([...prev, cid])]);
                        }
                      }}
                      className={`p-2.5 rounded-xl border text-left flex items-center justify-between gap-2 text-xs font-bold transition-all ${
                        isEffectivelyBlocked
                          ? 'bg-rose-950/50 border-rose-500/40 text-rose-300'
                          : 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                      }`}
                    >
                      <span className="truncate">{c.business_name}</span>
                      <span className="shrink-0 flex items-center gap-1 text-[10px]">
                        {isEffectivelyBlocked ? <><Lock size={12} /> Bloccato</> : <><Unlock size={12} /> Attivo</>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Override Singoli Permessi (Nega / Eredita / Consenti) */}
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider text-brand-blue">
                    Permessi Singoli Utente
                  </h3>
                  <p className="text-xs text-slate-400">
                    Il tasto centrale <strong>⎯</strong> eredita il valore del ruolo ({editingUserRoleObj?.name}). Usa <strong>❌</strong> per negare o <strong>✅</strong> per concedere un permesso solo a {editingUser.username}.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditUserOverrides({})}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 shrink-0"
                >
                  Ripristina tutti a &quot;Eredita dal Ruolo&quot;
                </button>
              </div>

              <input
                type="text"
                value={editUserPermSearch}
                onChange={e => setEditUserPermSearch(e.target.value)}
                placeholder="Cerca permesso da personalizzare..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-brand-white"
              />

              <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
                {catalog.map(cat => {
                  const items = cat.items.filter(it =>
                    !editUserPermSearch.trim() ||
                    it.label.toLowerCase().includes(editUserPermSearch.toLowerCase()) ||
                    it.desc.toLowerCase().includes(editUserPermSearch.toLowerCase())
                  );
                  if (items.length === 0) return null;

                  return (
                    <div key={cat.category} className="bg-slate-950 border border-slate-800 rounded-2xl p-4">
                      <div className="text-xs font-black uppercase tracking-wider text-brand-blue mb-3">{cat.title}</div>
                      <div className="divide-y divide-slate-900">
                        {items.map(it => {
                          const isProtectedDevPerm = editUserRole === 'developer' && (it.key === 'view_users' || it.key === 'users_manage');
                          const roleHas = Boolean(editingUserRoleObj?.permissions?.[it.key]);
                          const ov = isProtectedDevPerm ? 'ALLOW' : editUserOverrides[it.key];
                          const effective = ov === 'ALLOW' ? true : ov === 'DENY' ? false : roleHas;

                          return (
                            <div key={it.key} className="py-2.5 flex items-center justify-between gap-4">
                              <div className="min-w-0">
                                <div className="text-xs font-bold text-brand-white flex items-center gap-2">
                                  <span>{it.label}</span>
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                                    effective ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-800 text-slate-500'
                                  }`}>
                                    {effective ? 'ATTIVO' : 'NEGATO'}
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-500 truncate">{it.desc}</div>
                              </div>

                              <div className="inline-flex rounded-xl bg-slate-900 p-1 border border-slate-800 shrink-0">
                                <button
                                  type="button"
                                  disabled={isProtectedDevPerm}
                                  onClick={() => setEditUserOverrides(prev => ({ ...prev, [it.key]: 'DENY' }))}
                                  className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all flex items-center gap-1 disabled:opacity-30 ${
                                    ov === 'DENY'
                                      ? 'bg-rose-600 text-white shadow'
                                      : 'text-slate-500 hover:text-rose-400'
                                  }`}
                                  title="Nega esplicitamente a questo utente"
                                >
                                  <X size={13} />
                                </button>
                                <button
                                  type="button"
                                  disabled={isProtectedDevPerm}
                                  onClick={() => {
                                    const copy = { ...editUserOverrides };
                                    delete copy[it.key];
                                    setEditUserOverrides(copy);
                                  }}
                                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                                    !ov
                                      ? 'bg-slate-700 text-white shadow'
                                      : 'text-slate-500 hover:text-slate-300'
                                  }`}
                                  title={`Eredita dal ruolo (${roleHas ? 'Attivo' : 'Disattivo'})`}
                                >
                                  ⎯ Ruolo ({roleHas ? 'Sì' : 'No'})
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditUserOverrides(prev => ({ ...prev, [it.key]: 'ALLOW' }))}
                                  className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all flex items-center gap-1 ${
                                    ov === 'ALLOW'
                                      ? 'bg-emerald-600 text-white shadow'
                                      : 'text-slate-500 hover:text-emerald-400'
                                  }`}
                                  title="Consenti esplicitamente a questo utente"
                                >
                                  <Check size={13} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-3 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-brand-white font-bold rounded-xl"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={handleSaveUserAccess}
                disabled={isProcessing}
                className="flex-1 py-3 bg-brand-blue hover:bg-sky-400 text-brand-black font-black rounded-xl shadow-lg"
              >
                {isProcessing ? 'Salvataggio...' : 'Salva Permessi Utente'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL CONFERMA ELIMINAZIONE UTENTE                                */}
      {/* ================================================================= */}
      {confirmDeleteUser.show && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-brand-black/80 backdrop-blur-md"
          onClick={() => !isProcessing && setConfirmDeleteUser({ show: false, user: null })}
        >
          <div className="bg-slate-900 border border-slate-700/80 rounded-3xl p-8 max-w-sm w-full shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-brand-white mb-2">Conferma Eliminazione Utente</h2>
            <p className="text-slate-400 text-sm mb-6">
              Sei sicuro di voler eliminare l&apos;utente <b className="text-rose-400">{confirmDeleteUser.user?.username}</b>? Questa azione è irreversibile.
            </p>
            <div className="flex gap-4">
              <button onClick={() => setConfirmDeleteUser({ show: false, user: null })} className="flex-1 px-4 py-3 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-xl font-bold">
                Annulla
              </button>
              <button onClick={handleDeleteUser} disabled={isProcessing} className="flex-1 px-4 py-3 bg-rose-600 hover:bg-rose-500 text-brand-white rounded-xl font-bold">
                {isProcessing ? 'Eliminazione...' : 'Elimina'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL CONFERMA ELIMINAZIONE RUOLO                                 */}
      {/* ================================================================= */}
      {confirmDeleteRole.show && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-brand-black/80 backdrop-blur-md"
          onClick={() => !isProcessing && setConfirmDeleteRole({ show: false, role: null })}
        >
          <div className="bg-slate-900 border border-slate-700/80 rounded-3xl p-8 max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-brand-white mb-2">Elimina Ruolo &quot;{confirmDeleteRole.role?.name}&quot;</h2>
            <p className="text-slate-400 text-sm mb-6">
              Sei sicuro di voler eliminare questo ruolo dalla gerarchia? Gli eventuali utenti associati passeranno automaticamente al ruolo base Operatore.
            </p>
            <div className="flex gap-4">
              <button onClick={() => setConfirmDeleteRole({ show: false, role: null })} className="flex-1 px-4 py-3 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-xl font-bold">
                Annulla
              </button>
              <button onClick={handleDeleteRole} disabled={isProcessing} className="flex-1 px-4 py-3 bg-rose-600 hover:bg-rose-500 text-brand-white rounded-xl font-bold">
                {isProcessing ? 'Eliminazione...' : 'Conferma Elimina'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL RESET PASSWORD                                              */}
      {/* ================================================================= */}
      {resetModal.show && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-brand-black/80 backdrop-blur-md"
          onClick={() => !isProcessing && setResetModal({ show: false, user: null, newPwd: '' })}
        >
          <div className="bg-slate-900 border border-slate-700/80 rounded-3xl p-8 max-w-sm w-full shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-brand-white mb-2">Reset Password</h2>
            <p className="text-slate-400 text-sm mb-6">
              Inserisci la nuova password provvisoria per <b className="text-brand-blue">{resetModal.user?.username}</b>. Al prossimo accesso dovrà cambiarla obbligatoriamente.
            </p>
            <input
              type="password"
              value={resetModal.newPwd}
              onChange={e => setResetModal({ ...resetModal, newPwd: e.target.value })}
              placeholder="Nuova password"
              className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 mb-6"
            />
            <div className="flex gap-4">
              <button onClick={() => setResetModal({ show: false, user: null, newPwd: '' })} className="flex-1 px-4 py-3 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-xl font-bold">
                Annulla
              </button>
              <button onClick={handleResetPassword} disabled={!resetModal.newPwd || isProcessing} className="flex-1 px-4 py-3 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-xl font-bold">
                {isProcessing ? 'Attendere...' : 'Applica'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UsersManagement;
