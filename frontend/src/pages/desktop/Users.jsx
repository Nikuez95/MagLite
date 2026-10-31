import { appAlert } from "../../utils/alerts.js";
import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import {
  UserPlus, Shield, User, Trash2, Key, Plus, Check, X, Slash, Lock, Unlock,
  Crown, Sliders, Search, Building2, Eye, Layers, Sparkles, AlertTriangle,
  ChevronRight, Save, RotateCcw, Users as UsersIcon, ShieldAlert, ShieldCheck
} from 'lucide-react';
import { refreshUserProfile, hasPerm } from '../../utils/permissions';

const DISCORD_COLORS = [
  '#a855f7', // Purple (Developer)
  '#f59e0b', // Amber/Gold (Direzione)
  '#0ea5e9', // Sky Blue (Backoffice)
  '#10b981', // Emerald (Qualità)
  '#6366f1', // Indigo (Responsabile)
  '#f43f5e', // Rose
  '#ec4899', // Pink
  '#14b8a6', // Teal
  '#eab308', // Yellow
  '#64748b'  // Slate (Operatore)
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

  // Create User Modal / Panel state
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRoleCode, setNewRoleCode] = useState('operator');
  const [newUserOverrides, setNewUserOverrides] = useState({});
  const [newUserRestrictedCustomers, setNewUserRestrictedCustomers] = useState([]);
  const [showNewUserAdvanced, setShowNewUserAdvanced] = useState(false);

  // Edit Single User Access Modal (Discord 3-state overrides)
  const [editingUser, setEditingUser] = useState(null);
  const [editUserRole, setEditUserRole] = useState('');
  const [editUserOverrides, setEditUserOverrides] = useState({});
  const [editUserRestrictedCustomers, setEditUserRestrictedCustomers] = useState([]);
  const [editUserUnlockedCustomers, setEditUserUnlockedCustomers] = useState([]);
  const [editUserPermSearch, setEditUserPermSearch] = useState('');

  // Role Editor state (Discord tab)
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
    hierarchy_level: 400,
    template: 'full'
  });

  // Delete & Reset Password Modals
  const [confirmDeleteUser, setConfirmDeleteUser] = useState({ show: false, user: null });
  const [confirmDeleteRole, setConfirmDeleteRole] = useState({ show: false, role: null });
  const [resetModal, setResetModal] = useState({ show: false, user: null, newPwd: '' });
  const [isProcessing, setIsProcessing] = useState(false);

  const getToken = () => localStorage.getItem('maglite_token');

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

      // Seleziona il primo ruolo modificabile o il primo in assoluto
      if (fetchedRoles.length > 0) {
        const currentSelected = fetchedRoles.find(r => r.id === selectedRoleId) || fetchedRoles[0];
        setSelectedRoleId(currentSelected.id);
        setRoleDraft(JSON.parse(JSON.stringify(currentSelected)));
        setHasRoleUnsavedChanges(false);
      }

      // Imposta ruolo di default per creazione utente (il più basso disponibile sotto il proprio livello)
      const assignable = fetchedRoles.filter(r =>
        caller?.role === 'developer' ? r.code !== 'developer' : r.hierarchy_level < (caller?.hierarchy_level || 0)
      );
      if (assignable.length > 0) {
        const defaultOp = assignable.find(r => r.code === 'operator') || assignable[assignable.length - 1];
        setNewRoleCode(defaultOp.code);
      }
    } catch (err) {
      console.error(err);
      appAlert(err.response?.data?.error || 'Errore nel caricamento di Utenti e Ruoli');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  const myLevel = currentUser?.role === 'developer' ? 1000 : (currentUser?.hierarchy_level || 100);
  const isDeveloper = currentUser?.role === 'developer';
  const canManageUsers = isDeveloper || hasPerm('users_manage', currentUser);

  // Ruoli che l'utente corrente può assegnare o modificare (piramide: strettamente inferiori al proprio livello, salvo developer)
  const assignableRoles = useMemo(() => {
    return roles.filter(r => {
      if (r.code === 'developer') return false;
      if (isDeveloper) return true;
      return r.hierarchy_level < myLevel;
    });
  }, [roles, isDeveloper, myLevel]);

  const canModifyRole = (roleObj) => {
    if (!roleObj || !canManageUsers) return false;
    if (roleObj.code === 'developer') return false; // Developer ha i poteri massimi ed è immutabile
    if (isDeveloper) return true;
    return roleObj.hierarchy_level < myLevel;
  };

  const canModifyUser = (targetUser) => {
    if (!targetUser || !canManageUsers) return false;
    if (targetUser.role === 'developer') return false; // Nessuno può eliminare o degradare il developer
    if (isDeveloper) return true;
    return targetUser.hierarchy_level < myLevel;
  };

  const allPermKeys = useMemo(() => {
    return catalog.flatMap(cat => cat.items.map(i => i.key));
  }, [catalog]);

  // Costruisce un template di permessi
  const buildTemplatePermissions = (tplName) => {
    const map = {};
    for (const k of allPermKeys) {
      if (tplName === 'full') {
        map[k] = isDeveloper ? true : Boolean(currentUser?.permissions?.[k]);
      } else if (tplName === 'view_only') {
        map[k] = k === 'access_desktop' || (k.startsWith('view_') && k !== 'view_finances' && k !== 'view_billing' && k !== 'view_users' && k !== 'view_settings');
      } else if (tplName === 'quality') {
        map[k] = [
          'access_desktop', 'access_zebra', 'view_dashboard', 'view_inbound', 'view_documents',
          'view_outbound', 'view_products', 'view_inventory', 'view_quarantine', 'view_customers',
          'view_locations', 'view_audit', 'inbound_create', 'pallet_edit', 'pallet_move',
          'product_manage', 'quarantine_manage', 'outbound_return'
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
    setRoleDraft(prev => ({
      ...prev,
      permissions: {
        ...(prev.permissions || {}),
        [permKey]: !prev.permissions?.[permKey]
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
          hierarchy_level: Number(roleDraft.hierarchy_level),
          permissions: roleDraft.permissions
        },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      setHasRoleUnsavedChanges(false);
      await refreshUserProfile();
      await fetchAllData();
      appAlert(`Ruolo "${roleDraft.name}" aggiornato con successo!`);
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante il salvataggio del ruolo');
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
          hierarchy_level: Number(newRoleForm.hierarchy_level),
          permissions: initialPerms
        },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      setShowCreateRoleModal(false);
      setNewRoleForm({ name: '', description: '', color: '#10b981', hierarchy_level: Math.min(400, myLevel - 10), template: 'full' });
      await fetchAllData();
      if (res.data?.role_id) {
        setSelectedRoleId(res.data.role_id);
      }
      setActiveTab('roles');
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante la creazione del ruolo');
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
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante l\'eliminazione del ruolo');
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
      appAlert('Utente creato con successo!');
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore nella creazione dell\'utente');
    } finally {
      setIsProcessing(false);
    }
  };

  // Apertura Modal Modifica Permessi Singolo Utente (3-stati Discord)
  const openEditUserAccessModal = (u) => {
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
        editUserUnlockedCustomers.length > 0;

      const custom_permissions = hasAnyCustom
        ? {
            overrides: cleanOverrides,
            restricted_customers: editUserRestrictedCustomers,
            unlocked_customers: editUserUnlockedCustomers
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
      appAlert(`Accessi e permessi di "${editingUser.username}" aggiornati!`);
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore salvataggio permessi utente');
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
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante l\'eliminazione');
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
      appAlert('Password resettata! Al prossimo accesso dovrà obbligatoriamente cambiarla.');
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante il reset');
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
                  Team & Piramide Permessi
                </h1>
                <p className="text-slate-400 text-sm">
                  Gestione gerarchica dei ruoli in stile Discord, permessi granulari e restrizioni per singolo cliente.
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
                    hierarchy_level: Math.max(50, Math.min(850, myLevel - 100)),
                    template: 'full'
                  });
                  setShowCreateRoleModal(true);
                }}
                className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-brand-white border border-slate-700 font-bold rounded-2xl text-sm flex items-center gap-2 transition-all"
              >
                <Shield size={17} className="text-amber-400" />
                <span>+ Nuovo Ruolo</span>
              </button>
              <button
                onClick={() => setShowCreateUserModal(true)}
                className="px-5 py-3 bg-brand-blue hover:bg-sky-400 text-brand-black font-black rounded-2xl text-sm flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(14,165,233,0.3)]"
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
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Il Tuo Grado Piramide</div>
            <div className="flex items-center gap-2 mt-1.5">
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: currentUser?.role_color || '#a855f7' }}
              />
              <span className="text-lg font-black text-brand-white truncate">
                {currentUser?.role_name || currentUser?.role}
              </span>
            </div>
            <div className="text-xs font-mono text-brand-blue mt-1">
              Livello Gerarchico: <strong>{myLevel}</strong> {isDeveloper && '👑 (Massimo)'}
            </div>
          </div>

          <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Utenti Attivi</div>
            <div className="text-2xl font-black text-brand-white mt-1">{users.length}</div>
            <div className="text-xs text-slate-500 mt-1">
              {users.filter(u => countUserOverrides(u) > 0 || (u.restricted_customers?.length > 0)).length} con permessi personalizzati
            </div>
          </div>

          <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Ruoli Configurati</div>
            <div className="text-2xl font-black text-amber-400 mt-1">{roles.length}</div>
            <div className="text-xs text-slate-500 mt-1">
              {assignableRoles.length} gestibili dal tuo livello
            </div>
          </div>

          <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Protezione Root</div>
            <div className="flex items-center gap-1.5 text-purple-400 font-black text-sm mt-2">
              <Crown size={16} /> Developer Protetto
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Immutabile e non eliminabile da nessuno
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
            <span>Piramide Ruoli & Permessi ({roles.length})</span>
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
              {roles.map(r => (
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
                  <span>{r.name}</span>
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
                const overrideCount = countUserOverrides(u);
                const restrictedCount = u.restricted_customers?.length || 0;
                const enabledPermsCount = Object.values(u.effective_permissions || {}).filter(Boolean).length;

                return (
                  <div
                    key={u.id}
                    className={`bg-slate-950/80 border rounded-2xl p-5 flex flex-col justify-between gap-4 transition-all ${
                      isTargetDev
                        ? 'border-purple-500/40 shadow-[0_0_20px_rgba(168,85,247,0.08)]'
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
                            <span className="text-[11px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                              Lv. {u.hierarchy_level}
                            </span>
                          </div>
                        </div>
                      </div>

                      {isTargetDev ? (
                        <span className="px-2.5 py-1 rounded-xl bg-purple-500/15 border border-purple-500/40 text-purple-300 text-[10px] font-black uppercase tracking-wider flex items-center gap-1 shrink-0">
                          <Lock size={11} /> Protetto (Root)
                        </span>
                      ) : !editable ? (
                        <span className="px-2.5 py-1 rounded-xl bg-slate-900 border border-slate-800 text-slate-500 text-[10px] font-bold uppercase flex items-center gap-1 shrink-0">
                          <Lock size={11} /> Livello Superiore/Pari
                        </span>
                      ) : null}
                    </div>

                    {/* Pills riepilogo permessi effettivi */}
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-900">
                      <span className="text-[11px] font-semibold text-slate-400 bg-slate-900/90 px-2.5 py-1 rounded-lg border border-slate-800">
                        Permessi attivi: <strong className="text-emerald-400">{isTargetDev ? 'TUTTI (Root)' : `${enabledPermsCount}/${allPermKeys.length}`}</strong>
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
                        {editable && (
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
                            {Number(u.id) !== Number(currentUser?.id) && (
                              <button
                                onClick={() => setConfirmDeleteUser({ show: true, user: u })}
                                className="p-2 rounded-xl bg-rose-950/40 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-900/50 transition-colors"
                                title="Elimina Utente"
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </>
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
      {/* TAB 2: PIRAMIDE RUOLI & PERMESSI (STILE DISCORD)                  */}
      {/* ================================================================= */}
      {activeTab === 'roles' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Colonna Sinistra: La Piramide dei Ruoli */}
          <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black text-brand-white flex items-center gap-2">
                  <Layers size={18} className="text-brand-blue" /> Piramide Gerarchica
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Ogni ruolo può gestire solo i ruoli posti sotto il proprio livello.
                </p>
              </div>
              {canManageUsers && (
                <button
                  onClick={() => setShowCreateRoleModal(true)}
                  className="p-2 rounded-xl bg-brand-blue text-brand-black hover:bg-sky-400 transition-colors"
                  title="Crea Nuovo Ruolo"
                >
                  <Plus size={18} />
                </button>
              )}
            </div>

            <div className="space-y-2">
              {roles.map((r, idx) => {
                const isSelected = roleDraft && r.id === roleDraft.id;
                const modifiable = canModifyRole(r);

                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => handleSelectRole(r)}
                    className={`w-full text-left p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                      isSelected
                        ? 'bg-slate-800/90 border-brand-blue shadow-[0_0_20px_rgba(14,165,233,0.15)]'
                        : 'bg-slate-950/70 border-slate-800/80 hover:bg-slate-900 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex flex-col items-center">
                        <span
                          className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm"
                          style={{ backgroundColor: r.color || '#38bdf8' }}
                        />
                        {idx < roles.length - 1 && (
                          <div className="w-0.5 h-3 bg-slate-800 mt-1" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-black text-sm text-brand-white truncate">{r.name}</span>
                          {r.code === 'developer' && <Crown size={13} className="text-purple-400 shrink-0" />}
                        </div>
                        <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                          <span className="font-mono text-brand-blue font-bold">Lv. {r.hierarchy_level}</span>
                          <span>•</span>
                          <span>{r.member_count || 0} utent{r.member_count === 1 ? 'e' : 'i'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {!modifiable && (
                        <Lock size={14} className="text-slate-500" title="Ruolo protetto o di grado pari/superiore al tuo" />
                      )}
                      <ChevronRight size={16} className={isSelected ? 'text-brand-blue' : 'text-slate-600'} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Colonna Destra: Configurazione Granulare del Ruolo Selezionato */}
          <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 shadow-xl space-y-6">
            {roleDraft ? (
              <>
                {/* Banner informativo se non modificabile */}
                {!canModifyRole(roleDraft) && (
                  <div className="p-4 rounded-2xl bg-purple-950/40 border border-purple-500/40 text-purple-200 text-xs font-bold flex items-center gap-3">
                    <Lock size={18} className="text-purple-400 shrink-0" />
                    <div>
                      {roleDraft.code === 'developer'
                        ? 'Il ruolo Developer (Root) possiede i poteri massimi assoluti di sistema: ha accesso a tutto e non può essere modificato o eliminato da nessuno.'
                        : `Questo ruolo ha un livello gerarchico (${roleDraft.hierarchy_level}) pari o superiore al tuo (${myLevel}). Puoi consultarlo in sola lettura.`}
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
                      <p className="text-xs text-slate-400 font-mono">Codice: {roleDraft.code} • Livello Piramide: {roleDraft.hierarchy_level}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {canModifyRole(roleDraft) && !roleDraft.is_system && (
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

                {/* Campi Nome, Livello Piramide, Colore, Descrizione */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                      Nome del Ruolo
                    </label>
                    <input
                      type="text"
                      disabled={!canModifyRole(roleDraft)}
                      value={roleDraft.name || ''}
                      onChange={e => updateRoleDraftField('name', e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-brand-white font-bold text-sm disabled:opacity-60"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                      Grado Piramide (1 - {isDeveloper ? 999 : myLevel - 1})
                    </label>
                    <input
                      type="number"
                      min="1"
                      max={isDeveloper ? 999 : myLevel - 1}
                      disabled={!canModifyRole(roleDraft)}
                      value={roleDraft.hierarchy_level || 100}
                      onChange={e => updateRoleDraftField('hierarchy_level', e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-brand-blue font-mono font-black text-sm disabled:opacity-60"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                      Descrizione Mansioni
                    </label>
                    <input
                      type="text"
                      disabled={!canModifyRole(roleDraft)}
                      value={roleDraft.description || ''}
                      onChange={e => updateRoleDraftField('description', e.target.value)}
                      placeholder="Es. Accesso a tutto tranne Finanza e Amministrazione..."
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
                      <Sparkles size={14} className="text-amber-400" /> Preset Rapidi Stile Discord:
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => applyPresetToRoleDraft('full')}
                        className="px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-bold transition-colors"
                      >
                        ✅ Accesso Completo (Tutto)
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
                    placeholder="Filtra permessi (es. quarantena, elimina, spedizioni, finanza, clienti)..."
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
                            const isEnabled = roleDraft.code === 'developer' ? true : Boolean(roleDraft.permissions?.[item.key]);
                            const callerHasIt = isDeveloper || hasPerm(item.key, currentUser);
                            const switchDisabled = !canModifyRole(roleDraft) || !callerHasIt;

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
                  <div className="mb-4">
                    <h3 className="text-sm font-black uppercase tracking-wider text-amber-400 flex items-center gap-2">
                      <Building2 size={16} /> Accesso Merce per Singolo Cliente
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Clicca su un cliente per bloccare o consentire a questo ruolo di toccare (aggiungere, spostare, spedire, modificare o eliminare) la merce di quel cliente.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                    {customers.map(c => {
                      const isBlocked =
                        roleDraft.code !== 'developer' &&
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
              <div className="text-slate-500 text-center py-12">Seleziona un ruolo dalla piramide a sinistra</div>
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
              Panoramica immediata di quali utenti o ruoli hanno blocchi operativi sulla merce di determinati clienti. Clicca su un utente per modificarne le restrizioni.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-400">
                  <th className="py-3 px-4">Utente / Ruolo</th>
                  <th className="py-3 px-4">Grado Piramide</th>
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

                  return (
                    <tr key={u.id} className="hover:bg-slate-800/30">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-brand-white">{u.username}</div>
                        <div className="text-xs" style={{ color: u.role_color }}>{u.role_name}</div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs text-slate-400">Lv. {u.hierarchy_level}</td>
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
                          <span className="text-xs text-slate-500">Protetto</span>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/90 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-brand-blue/15 text-brand-blue">
                  <UserPlus size={22} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-brand-white">Crea Nuovo Membro del Team</h2>
                  <p className="text-xs text-slate-400">Assegna un ruolo piramidale e, se vuoi, personalizza subito gli accessi singoli.</p>
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
                  Seleziona Ruolo Piramidale (Sotto il tuo livello {myLevel})
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {assignableRoles.map(r => {
                    const isSel = newRoleCode === r.code;
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
                          <span className="text-[10px] font-mono text-brand-blue font-bold">Lv. {r.hierarchy_level}</span>
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
                        Eccezioni Permessi Singoli rispetto al ruolo "{newUserRoleObj?.name}":
                      </div>
                      <div className="space-y-1.5">
                        {catalog.flatMap(c => c.items).map(it => {
                          const roleDefault = Boolean(newUserRoleObj?.permissions?.[it.key]);
                          const currentOv = newUserOverrides[it.key]; // 'ALLOW' | 'DENY' | undefined
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
      {/* MODAL CREAZIONE NUOVO RUOLO PIRAMIDALE                            */}
      {/* ================================================================= */}
      {showCreateRoleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/90 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 max-w-lg w-full shadow-2xl">
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
                  placeholder="Es. Capo Turno, Responsabile Logistica, Auditor..."
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

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                    Livello Piramide (Max {isDeveloper ? 999 : myLevel - 1})
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={isDeveloper ? 999 : myLevel - 1}
                    required
                    value={newRoleForm.hierarchy_level}
                    onChange={e => setNewRoleForm({ ...newRoleForm, hierarchy_level: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-brand-blue font-mono font-black"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Colore Badge</label>
                  <div className="flex items-center gap-1.5 flex-wrap bg-slate-950 border border-slate-800 rounded-xl p-3">
                    {DISCORD_COLORS.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setNewRoleForm({ ...newRoleForm, color: c })}
                        className={`w-5 h-5 rounded-full ${newRoleForm.color === c ? 'scale-125 ring-2 ring-white' : 'opacity-70'}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Modello Permessi di Partenza</label>
                <select
                  value={newRoleForm.template}
                  onChange={e => setNewRoleForm({ ...newRoleForm, template: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-brand-white text-sm font-bold"
                >
                  <option value="full">🌟 Accesso Completo (come Direzione Generale)</option>
                  <option value="view_only">👁️ Solo Visualizzazione Gestionale (come Responsabile)</option>
                  <option value="quality">🛡️ Controllo Qualità & Quarantena</option>
                  <option value="operator">📱 Operatore Terminale Zebra</option>
                  <option value="none">⚙️ Vuoto (Configura manualmente dopo)</option>
                </select>
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
      {/* MODAL DISCORD OVERRIDE SINGOLO UTENTE                             */}
      {/* ================================================================= */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/90 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 max-w-4xl w-full max-h-[92vh] overflow-y-auto shadow-2xl space-y-6">
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
                Ruolo Piramidale Assegnato
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {assignableRoles.map(r => (
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
                      <span className="text-[10px] font-mono text-brand-blue">Lv.{r.hierarchy_level}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Restrizioni Clienti per questo singolo utente */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider text-amber-400 flex items-center gap-2">
                    <Building2 size={16} /> Accesso ai Clienti per {editingUser.username}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Clicca per bloccare o sbloccare l'operatività di questo singolo utente sulla merce di ciascun cliente.
                  </p>
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
                          // Sblocca per questo utente
                          setEditUserRestrictedCustomers(prev => prev.filter(id => id !== cid));
                          if (roleBlocksIt) {
                            setEditUserUnlockedCustomers(prev => [...new Set([...prev, cid])]);
                          }
                        } else {
                          // Blocca per questo utente
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

            {/* Override Singoli Permessi Stile Discord (Nega / Eredita / Consenti) */}
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider text-brand-blue">
                    Permessi Singoli Utente (Override Stile Discord)
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
                  Ripristina tutti a "Eredita dal Ruolo"
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
                          const roleHas = Boolean(editingUserRoleObj?.permissions?.[it.key]);
                          const ov = editUserOverrides[it.key]; // 'ALLOW' | 'DENY' | undefined
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

                              {/* 3-State Discord Button Group */}
                              <div className="inline-flex rounded-xl bg-slate-900 p-1 border border-slate-800 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => setEditUserOverrides(prev => ({ ...prev, [it.key]: 'DENY' }))}
                                  className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all flex items-center gap-1 ${
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-brand-black/90 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-sm w-full shadow-2xl">
            <h2 className="text-xl font-bold text-brand-white mb-2">Conferma Eliminazione Utente</h2>
            <p className="text-slate-400 text-sm mb-6">
              Sei sicuro di voler eliminare l'utente <b className="text-rose-400">{confirmDeleteUser.user?.username}</b>? Questa azione è irreversibile.
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-brand-black/90 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-md w-full shadow-2xl">
            <h2 className="text-xl font-bold text-brand-white mb-2">Elimina Ruolo "{confirmDeleteRole.role?.name}"</h2>
            <p className="text-slate-400 text-sm mb-6">
              Sei sicuro di voler eliminare questo ruolo dalla piramide? Gli eventuali utenti associati passeranno automaticamente al ruolo base Operatore.
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-brand-black/90 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-sm w-full shadow-2xl">
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
