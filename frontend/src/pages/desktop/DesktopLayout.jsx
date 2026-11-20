import React, { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { io } from 'socket.io-client';
import {
  Settings2,
  LayoutDashboard,
  Users,
  Box,
  Map as MapIcon,
  History,
  LogOut,
  Settings,
  FileText,
  Search,
  UserCog,
  PackagePlus,
  PackageMinus,
  PackageSearch,
  Menu,
  X,
  ChevronDown,
  ChevronRight,
  Package,
  Calculator,
  ReceiptText,
  Coins,
  DollarSign,
  RotateCcw,
  ShieldAlert,
  Activity,
  TrendingDown,
  Archive,
  Truck,
  Smartphone,
  MapPin,
  ArrowUpRight,
  ClipboardList,
  Ticket as TicketIcon,
  Megaphone,
  Star,
  GripVertical,
  SlidersHorizontal,
  Check
} from 'lucide-react';
import { hasPerm, refreshUserProfile } from '../../utils/permissions';
import NotificationCenter from '../../components/NotificationCenter';

const DEFAULT_SIDEBAR_PREFS = {
  favorites: [],
  categoryOrder: [],
  itemOrder: {}
};

function mergeOrder(savedOrder = [], defaultIds = []) {
  const safeSaved = Array.isArray(savedOrder) ? savedOrder : [];
  const validSet = new Set(defaultIds);
  const result = [];
  const seen = new Set();
  for (const id of safeSaved) {
    if (validSet.has(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  for (const id of defaultIds) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

function reorderList(list, fromId, toId) {
  const fromIdx = list.indexOf(fromId);
  const toIdx = list.indexOf(toId);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return list;
  const copy = [...list];
  const [moved] = copy.splice(fromIdx, 1);
  copy.splice(toIdx, 0, moved);
  return copy;
}

const DesktopLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [socketConnected, setSocketConnected] = useState(true);
  const [socketInstance, setSocketInstance] = useState(null);
  const [openTicketsCount, setOpenTicketsCount] = useState(0);

  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('maglite_user') || '{}');
    } catch {
      return {};
    }
  });

  const [sidebarPrefs, setSidebarPrefs] = useState(() => {
    try {
      const u = JSON.parse(localStorage.getItem('maglite_user') || '{}');
      return u?.preferences?.desktopSidebar || DEFAULT_SIDEBAR_PREFS;
    } catch {
      return DEFAULT_SIDEBAR_PREFS;
    }
  });

  const [isCustomizingMenu, setIsCustomizingMenu] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState('');
  const [dragState, setDragState] = useState(null); // { kind: 'FAV'|'TOP'|'SUB', id, catId? }
  const [dragOverId, setDragOverId] = useState(null);

  const [openSubmenus, setOpenSubmenus] = useState({
    cat_merce: ['/desktop/inbound', '/desktop/custom-forms', '/desktop/outbound', '/desktop/inventory', '/desktop/products', '/desktop/outbound/history', '/desktop/outbound/returns', '/desktop/quarantine'].includes(location.pathname),
    cat_finanza: ['/desktop/finances', '/desktop/expenses', '/desktop/invoices-history'].includes(location.pathname),
    cat_amministrazione: ['/desktop/billing-rules', '/desktop/billing-tariffs', '/desktop/billing-dashboard'].includes(location.pathname),
    cat_config: ['/desktop/settings', '/desktop/settings/routing'].includes(location.pathname)
  });

  // Global Search / Command Palette state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState({ pallets: [], products: [], customers: [], orders: [] });
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef = useRef(null);
  const searchContainerRef = useRef(null);

  const rawMenu = useMemo(() => [
    { id: 'dashboard', name: 'Dashboard', path: '/desktop', icon: LayoutDashboard, perm: 'view_dashboard' },
    {
      id: 'cat_merce',
      name: 'Merce',
      icon: Package,
      submenu: [
        { id: 'inbound', name: 'Nuova Merce (In)', path: '/desktop/inbound', icon: PackagePlus, perm: 'view_inbound' },
        { id: 'custom_forms', name: 'Moduli & Check-in', path: '/desktop/custom-forms', icon: ClipboardList, perm: ['view_custom_forms', 'manage_custom_forms'] },
        { id: 'outbound', name: 'Spedizioni (Out)', path: '/desktop/outbound', icon: PackageMinus, perm: 'view_outbound' },
        { id: 'outbound_returns', name: 'Storico Resi', path: '/desktop/outbound/returns', icon: RotateCcw, perm: ['view_outbound', 'outbound_return'] },
        { id: 'products', name: 'Prodotti & Stock', path: '/desktop/products', icon: Box, perm: 'view_products' },
        { id: 'quarantine', name: 'Quarantena & Qualità', path: '/desktop/quarantine', icon: ShieldAlert, perm: 'view_quarantine' },
        { id: 'inventory', name: 'Inventario', path: '/desktop/inventory', icon: PackageSearch, perm: 'view_inventory' }
      ]
    },
    { id: 'customers', name: 'Cartelle Clienti', path: '/desktop/customers', icon: Users, perm: 'view_customers' },
    { id: 'locations', name: 'Magazzino', path: '/desktop/locations', icon: MapIcon, perm: 'view_locations' },
    { id: 'documents', name: 'DDT Entrata (Spunta)', path: '/desktop/documents', icon: FileText, perm: 'view_documents' },
    { id: 'tms', name: 'TMS (Trasporti)', path: '/desktop/tms', icon: Truck, perm: ['view_tms', 'tms_manage'] },
    {
      id: 'cat_finanza',
      name: 'Finanza',
      icon: DollarSign,
      perm: ['view_finances', 'finance_manage'],
      submenu: [
        { id: 'finances', name: 'Dashboard Finanza', path: '/desktop/finances', icon: Activity, perm: ['view_finances', 'finance_manage'] },
        { id: 'expenses', name: 'Gestione Uscite', path: '/desktop/expenses', icon: TrendingDown, perm: ['view_finances', 'finance_manage'] },
        { id: 'invoices_history', name: 'Archivio Proforme', path: '/desktop/invoices-history', icon: Archive, perm: ['view_finances', 'finance_manage'] }
      ]
    },
    {
      id: 'cat_amministrazione',
      name: 'Amministrazione',
      icon: Calculator,
      perm: ['view_billing', 'finance_manage'],
      submenu: [
        { id: 'billing_rules', name: 'Regole Base', path: '/desktop/billing-rules', icon: Settings2, perm: ['view_billing', 'finance_manage'] },
        { id: 'billing_tariffs', name: 'Tariffe Clienti', path: '/desktop/billing-tariffs', icon: Coins, perm: ['view_billing', 'finance_manage'] },
        { id: 'billing_dashboard', name: 'Pre-Fatturazione', path: '/desktop/billing-dashboard', icon: ReceiptText, perm: ['view_billing', 'finance_manage'] }
      ]
    },
    { id: 'users', name: 'Utenti (Team)', path: '/desktop/users', icon: UserCog, perm: ['view_users', 'users_manage'] },
    { id: 'audit', name: 'Audit Logs', path: '/desktop/audit', icon: History, perm: 'view_audit' },
    { id: 'tickets', name: 'Supporto & Ticket', path: '/desktop/tickets', icon: TicketIcon, badge: openTicketsCount },
    { id: 'changelogs', name: 'Changelog & Novità', path: '/desktop/changelogs', icon: Megaphone },
    {
      id: 'cat_config',
      name: 'Configurazione',
      icon: Settings,
      perm: ['view_settings', 'settings_manage', 'pallet_move'],
      submenu: [
        { id: 'settings', name: 'Impostazioni Aziendali', path: '/desktop/settings', icon: Settings, perm: ['view_settings', 'settings_manage', 'pallet_move'] },
        { id: 'routing', name: 'Regole di Prelievo', path: '/desktop/settings/routing', icon: MapIcon, perm: ['view_settings', 'settings_manage', 'pallet_move'] }
      ]
    }
  ], [openTicketsCount]);

  useEffect(() => {
    setOpenSubmenus(prev => {
      const next = { ...prev };
      rawMenu.forEach(cat => {
        if (cat.submenu && cat.submenu.some(s => s.path === location.pathname)) {
          next[cat.id] = true;
        }
      });
      return next;
    });
  }, [location.pathname, rawMenu]);

  useEffect(() => {
    refreshUserProfile().then(u => {
      if (u) {
        setUser(u);
        if (u.preferences?.desktopSidebar) {
          setSidebarPrefs(u.preferences.desktopSidebar);
        }
      }
    });
    const handlePermSync = () => {
      try {
        const u = JSON.parse(localStorage.getItem('maglite_user') || '{}');
        setUser(u);
        if (u?.preferences?.desktopSidebar) {
          setSidebarPrefs(u.preferences.desktopSidebar);
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener('maglite_permissions_updated', handlePermSync);
    return () => window.removeEventListener('maglite_permissions_updated', handlePermSync);
  }, []);

  // WebSocket status indicator in top bar & live permissions sync + ticket counter
  useEffect(() => {
    const fetchOpenTicketsCount = () => {
      const tk = localStorage.getItem('maglite_token');
      if (!tk) return;
      axios.get('/api/tickets', {
        params: { status: 'OPEN' },
        headers: { Authorization: `Bearer ${tk}` }
      }).then(res => {
        const st = res.data?.stats || {};
        setOpenTicketsCount((st.open || 0) + (st.in_progress || 0));
      }).catch(() => {});
    };

    fetchOpenTicketsCount();
    const socket = io(`http://${window.location.hostname}:3000`);
    setSocketInstance(socket);
    socket.on('connect', () => setSocketConnected(true));
    socket.on('disconnect', () => setSocketConnected(false));
    socket.on('connect_error', () => setSocketConnected(false));
    socket.on('ticket_updated', fetchOpenTicketsCount);
    socket.on('permissions_updated', () => {
      refreshUserProfile().then(u => {
        if (u) setUser(u);
      });
    });
    return () => {
      setSocketInstance(null);
      socket.disconnect();
    };
  }, []);

  // Keyboard shortcut Ctrl+K / Cmd+K to focus global search
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      } else if (e.key === 'Escape') {
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults({ pallets: [], products: [], customers: [], orders: [] });
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const token = localStorage.getItem('maglite_token');
        const res = await axios.get(`http://${window.location.hostname}:3000/api/dashboard/search`, {
          params: { q },
          headers: { Authorization: `Bearer ${token}` }
        });
        setSearchResults(res.data || { pallets: [], products: [], customers: [], orders: [] });
      } catch {
        // ignore
      } finally {
        setSearchLoading(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Persist sidebar preferences per user profile
  const persistSidebarPrefs = async (nextPrefs) => {
    setSidebarPrefs(nextPrefs);
    try {
      const currentUser = JSON.parse(localStorage.getItem('maglite_user') || '{}');
      const updatedUser = {
        ...currentUser,
        preferences: {
          ...(currentUser.preferences || {}),
          desktopSidebar: nextPrefs
        }
      };
      localStorage.setItem('maglite_user', JSON.stringify(updatedUser));
      setUser(updatedUser);
    } catch {
      // ignore
    }

    try {
      const token = localStorage.getItem('maglite_token');
      if (token) {
        await axios.put(
          `http://${window.location.hostname}:3000/api/auth/preferences`,
          { preferences: { desktopSidebar: nextPrefs } },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setSaveFeedback('Salvato');
        setTimeout(() => setSaveFeedback(''), 1800);
      }
    } catch {
      // ignore offline error
    }
  };

  // Permitted menu items + user custom ordering
  const permittedMenu = useMemo(() => {
    return rawMenu
      .map(item => {
        if (item.submenu) {
          if (item.perm && !hasPerm(item.perm, user)) return null;
          const filteredSub = item.submenu.filter(s => !s.perm || hasPerm(s.perm, user));
          if (filteredSub.length === 0) return null;
          return { ...item, submenu: filteredSub };
        }
        if (item.perm && !hasPerm(item.perm, user)) return null;
        return item;
      })
      .filter(Boolean);
  }, [rawMenu, user]);

  const orderedMenu = useMemo(() => {
    const topIds = permittedMenu.map(i => i.id);
    const orderedTopIds = mergeOrder(sidebarPrefs.categoryOrder || [], topIds);
    const byId = new Map(permittedMenu.map(i => [i.id, i]));

    return orderedTopIds.map(id => {
      const entry = byId.get(id);
      if (!entry) return null;
      if (entry.submenu) {
        const subIds = entry.submenu.map(s => s.id);
        const orderedSubIds = mergeOrder(sidebarPrefs.itemOrder?.[entry.id] || [], subIds);
        const subMap = new Map(entry.submenu.map(s => [s.id, s]));
        return {
          ...entry,
          submenu: orderedSubIds.map(sid => subMap.get(sid)).filter(Boolean)
        };
      }
      return entry;
    }).filter(Boolean);
  }, [permittedMenu, sidebarPrefs]);

  // Flat lookup of all navigable items for Favorites + Search
  const navigableItemsMap = useMemo(() => {
    const map = new Map();
    permittedMenu.forEach(item => {
      if (item.submenu) {
        item.submenu.forEach(sub => map.set(sub.id, { ...sub, groupName: item.name }));
      } else {
        map.set(item.id, { ...item, groupName: 'Menu' });
      }
    });
    return map;
  }, [permittedMenu]);

  const favoriteItems = useMemo(() => {
    const favIds = Array.isArray(sidebarPrefs.favorites) ? sidebarPrefs.favorites : [];
    return favIds.map(id => navigableItemsMap.get(id)).filter(Boolean);
  }, [sidebarPrefs.favorites, navigableItemsMap]);

  const favoriteIdSet = useMemo(() => new Set(sidebarPrefs.favorites || []), [sidebarPrefs.favorites]);

  const toggleFavorite = (e, itemId) => {
    e.stopPropagation();
    const current = Array.isArray(sidebarPrefs.favorites) ? sidebarPrefs.favorites : [];
    const nextFavs = current.includes(itemId)
      ? current.filter(id => id !== itemId)
      : [...current, itemId];
    persistSidebarPrefs({ ...sidebarPrefs, favorites: nextFavs });
  };

  const handleResetMenuLayout = () => {
    persistSidebarPrefs({
      favorites: sidebarPrefs.favorites || [],
      categoryOrder: [],
      itemOrder: {}
    });
  };

  // Drag & Drop handlers
  const handleDropOnFavorite = (e, targetFavId) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverId(null);
    if (!dragState || dragState.kind !== 'FAV' || dragState.id === targetFavId) {
      setDragState(null);
      return;
    }
    const currentFavs = favoriteItems.map(f => f.id);
    const nextFavs = reorderList(currentFavs, dragState.id, targetFavId);
    setDragState(null);
    persistSidebarPrefs({ ...sidebarPrefs, favorites: nextFavs });
  };

  const handleDropOnTopItem = (e, targetTopId) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverId(null);
    if (!dragState || dragState.kind !== 'TOP' || dragState.id === targetTopId) {
      setDragState(null);
      return;
    }
    const allDefaultIds = rawMenu.map(m => m.id);
    const currentFullOrder = mergeOrder(sidebarPrefs.categoryOrder || [], allDefaultIds);
    const nextOrder = reorderList(currentFullOrder, dragState.id, targetTopId);
    setDragState(null);
    persistSidebarPrefs({ ...sidebarPrefs, categoryOrder: nextOrder });
  };

  const handleDropOnSubItem = (e, catId, targetSubId) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverId(null);
    if (!dragState || dragState.kind !== 'SUB' || dragState.catId !== catId || dragState.id === targetSubId) {
      setDragState(null);
      return;
    }
    const rawCat = rawMenu.find(m => m.id === catId);
    if (!rawCat?.submenu) {
      setDragState(null);
      return;
    }
    const allSubIds = rawCat.submenu.map(s => s.id);
    const currentSubOrder = mergeOrder(sidebarPrefs.itemOrder?.[catId] || [], allSubIds);
    const nextSubOrder = reorderList(currentSubOrder, dragState.id, targetSubId);
    setDragState(null);
    persistSidebarPrefs({
      ...sidebarPrefs,
      itemOrder: {
        ...(sidebarPrefs.itemOrder || {}),
        [catId]: nextSubOrder
      }
    });
  };

  const toggleSubmenu = (catId) => {
    setOpenSubmenus(prev => ({ ...prev, [catId]: !prev[catId] }));
  };

  const allFlatPages = [
    { name: 'Dashboard Control Center', path: '/desktop', icon: LayoutDashboard, group: 'Generale', perm: 'view_dashboard' },
    { name: 'Nuova Merce (Inbound)', path: '/desktop/inbound', icon: PackagePlus, group: 'Merce', perm: 'view_inbound' },
    { name: 'Moduli Dinamici & Check-in', path: '/desktop/custom-forms', icon: ClipboardList, group: 'Merce', perm: ['view_custom_forms', 'manage_custom_forms'] },
    { name: 'Spedizioni (Outbound)', path: '/desktop/outbound', icon: PackageMinus, group: 'Merce', perm: 'view_outbound' },
    { name: 'Storico Spedizioni', path: '/desktop/outbound/history', icon: History, group: 'Merce', perm: 'view_outbound' },
    { name: 'Storico Resi', path: '/desktop/outbound/returns', icon: RotateCcw, group: 'Merce', perm: ['view_outbound', 'outbound_return'] },
    { name: 'Prodotti & Stock Palette', path: '/desktop/products', icon: Box, group: 'Merce', perm: 'view_products' },
    { name: 'Quarantena & Qualità', path: '/desktop/quarantine', icon: ShieldAlert, group: 'Merce', perm: 'view_quarantine' },
    { name: 'Inventario Globale', path: '/desktop/inventory', icon: PackageSearch, group: 'Merce', perm: 'view_inventory' },
    { name: 'Cartelle Clienti', path: '/desktop/customers', icon: Users, group: 'Anagrafiche', perm: 'view_customers' },
    { name: 'Mappa Magazzino & Scaffali', path: '/desktop/locations', icon: MapIcon, group: 'Magazzino', perm: 'view_locations' },
    { name: 'DDT Entrata (Spunta)', path: '/desktop/documents', icon: FileText, group: 'Merce', perm: 'view_documents' },
    { name: 'TMS (Trasporti)', path: '/desktop/tms', icon: Truck, group: 'Logistica', perm: ['view_tms', 'tms_manage'] },
    { name: 'Dashboard Finanza', path: '/desktop/finances', icon: Activity, group: 'Finanza', perm: ['view_finances', 'finance_manage'] },
    { name: 'Gestione Uscite', path: '/desktop/expenses', icon: TrendingDown, group: 'Finanza', perm: ['view_finances', 'finance_manage'] },
    { name: 'Archivio Proforme', path: '/desktop/invoices-history', icon: Archive, group: 'Finanza', perm: ['view_finances', 'finance_manage'] },
    { name: 'Regole Base Fatturazione', path: '/desktop/billing-rules', icon: Settings2, group: 'Amministrazione', perm: ['view_billing', 'finance_manage'] },
    { name: 'Tariffe Clienti', path: '/desktop/billing-tariffs', icon: Coins, group: 'Amministrazione', perm: ['view_billing', 'finance_manage'] },
    { name: 'Pre-Fatturazione Mensile', path: '/desktop/billing-dashboard', icon: ReceiptText, group: 'Amministrazione', perm: ['view_billing', 'finance_manage'] },
    { name: 'Utenti (Team)', path: '/desktop/users', icon: UserCog, group: 'Sistema', perm: ['view_users', 'users_manage'] },
    { name: 'Audit Logs', path: '/desktop/audit', icon: History, group: 'Sistema', perm: 'view_audit' },
    { name: 'Supporto & Ticket', path: '/desktop/tickets', icon: TicketIcon, group: 'Sistema' },
    { name: 'Changelog & Novità', path: '/desktop/changelogs', icon: Megaphone, group: 'Sistema' },
    { name: 'Impostazioni Aziendali', path: '/desktop/settings', icon: Settings, group: 'Configurazione', perm: 'view_settings' },
    { name: 'Regole di Prelievo (Routing)', path: '/desktop/settings/routing', icon: MapIcon, group: 'Configurazione', perm: 'view_settings' }
  ].filter(p => !p.perm || hasPerm(p.perm, user));

  const currentPageMeta = allFlatPages.find(p => p.path === location.pathname) || { name: 'Gestionale', group: 'MagLite' };

  const matchingPages = searchQuery.trim()
    ? allFlatPages.filter(p =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.group.toLowerCase().includes(searchQuery.toLowerCase())
      ).slice(0, 4)
    : [];

  const hasAnySearchResults =
    matchingPages.length > 0 ||
    searchResults.pallets.length > 0 ||
    searchResults.products.length > 0 ||
    searchResults.orders.length > 0 ||
    searchResults.customers.length > 0;

  return (
    <div className="min-h-screen bg-brand-black flex flex-col md:flex-row text-brand-white font-sans selection:bg-brand-blue selection:text-brand-black">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800 sticky top-0 z-50">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/')}>
          <img src="/logo.png" alt="Logistic Porcelli Logo" className="h-9 w-auto object-contain" />
        </div>
        <div className="flex items-center gap-2">
          <NotificationCenter socket={socketInstance} />
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="p-2 bg-slate-800 rounded-lg text-brand-white">
            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Modern Sidebar Navigation */}
      <aside className={`${mobileMenuOpen ? 'flex' : 'hidden'} md:flex flex-col w-full md:w-72 bg-gradient-to-b from-slate-900/95 via-slate-900/90 to-slate-950 border-r border-slate-800/90 backdrop-blur-xl z-40 fixed md:sticky top-0 h-screen shrink-0`}>
        {/* Header Sidebar */}
        <div
          className="hidden md:flex px-5 py-4 items-center gap-3.5 border-b border-slate-800/80 cursor-pointer hover:bg-slate-800/30 transition-colors group shrink-0"
          onClick={() => navigate('/')}
          title="Torna alla selezione modalità"
        >
          <div className="h-11 w-16 flex items-center justify-center shrink-0">
            <img
              src="/logo.png"
              alt="Logistic Porcelli Logo"
              className="max-w-full max-h-full object-contain drop-shadow-[0_0_15px_rgba(169,218,255,0.35)] group-hover:scale-105 transition-transform"
            />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-black text-lg leading-tight tracking-tight text-brand-white truncate">MagLite</h1>
            <p className="text-brand-blue text-[10px] uppercase font-extrabold tracking-[0.18em] truncate">Logistic Porcelli</p>
          </div>
        </div>

        {/* Global Search Bar with Ctrl+K */}
        <div className="px-3.5 pt-3.5 pb-2 relative shrink-0" ref={searchContainerRef}>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search size={15} className="text-slate-500" />
            </div>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onFocus={() => setSearchOpen(true)}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchOpen(true);
              }}
              placeholder="Cerca paletta, cliente, pagina..."
              className="w-full bg-slate-950/90 border border-slate-800 text-brand-white text-xs rounded-xl focus:ring-1 focus:ring-brand-blue focus:border-brand-blue block pl-9 pr-12 py-2.5 transition-all placeholder-slate-500 outline-none"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => { setSearchQuery(''); setSearchOpen(false); }}
                className="absolute inset-y-0 right-2 flex items-center text-slate-500 hover:text-brand-white px-1"
              >
                <X size={14} />
              </button>
            ) : (
              <span className="absolute inset-y-0 right-2.5 flex items-center pointer-events-none">
                <kbd className="text-[10px] font-mono font-bold text-slate-500 bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5">Ctrl+K</kbd>
              </span>
            )}
          </div>

          {/* Global Search Results Dropdown */}
          {searchOpen && searchQuery.trim().length >= 1 && (
            <div className="absolute left-3.5 right-3.5 top-full mt-2 bg-slate-950 border border-slate-700 rounded-2xl shadow-2xl z-50 max-h-[70vh] overflow-y-auto divide-y divide-slate-800/80">
              {matchingPages.length > 0 && (
                <div className="p-2">
                  <div className="px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Pagine</div>
                  {matchingPages.map((pg) => {
                    const PgIcon = pg.icon;
                    return (
                      <button
                        key={pg.path}
                        type="button"
                        onClick={() => {
                          navigate(pg.path);
                          setSearchOpen(false);
                          setSearchQuery('');
                          setMobileMenuOpen(false);
                        }}
                        className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-slate-800/80 text-left transition-colors group"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <PgIcon size={15} className="text-brand-blue shrink-0" />
                          <span className="text-xs font-bold text-brand-white truncate">{pg.name}</span>
                        </div>
                        <ArrowUpRight size={13} className="text-slate-500 group-hover:text-brand-blue shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}

              {searchResults.pallets.length > 0 && (
                <div className="p-2">
                  <div className="px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-brand-blue">Palette in Giacenza</div>
                  {searchResults.pallets.map((pal) => (
                    <button
                      key={pal.id}
                      type="button"
                      onClick={() => {
                        navigate('/desktop/products');
                        setSearchOpen(false);
                        setSearchQuery('');
                        setMobileMenuOpen(false);
                      }}
                      className="w-full flex flex-col gap-0.5 px-2.5 py-2 rounded-xl hover:bg-slate-800/80 text-left transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-black text-brand-blue">{pal.pallet_code}</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                          <MapPin size={10} /> {pal.location || 'IN ATTESA'}
                        </span>
                      </div>
                      <div className="text-xs font-bold text-brand-white truncate">{pal.product_name}</div>
                      <div className="text-[10px] text-slate-400 truncate">
                        Lotto: <span className="text-slate-300 font-semibold">{pal.batch || '-'}</span> • Q.tà: <span className="text-slate-300 font-semibold">{parseFloat(pal.quantity)}</span> • {pal.customer_name}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {searchResults.orders.length > 0 && (
                <div className="p-2">
                  <div className="px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-amber-400">Spedizioni Outbound</div>
                  {searchResults.orders.map((ord) => (
                    <button
                      key={ord.id}
                      type="button"
                      onClick={() => {
                        navigate('/desktop/outbound');
                        setSearchOpen(false);
                        setSearchQuery('');
                        setMobileMenuOpen(false);
                      }}
                      className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-slate-800/80 text-left transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-xs font-bold text-brand-white">{ord.order_code}</div>
                        <div className="text-[10px] text-slate-400 truncate">{ord.customer_name}</div>
                      </div>
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                        {ord.status}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {searchResults.products.length > 0 && (
                <div className="p-2">
                  <div className="px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Prodotti</div>
                  {searchResults.products.map((pr) => (
                    <button
                      key={pr.id}
                      type="button"
                      onClick={() => {
                        navigate('/desktop/products');
                        setSearchOpen(false);
                        setSearchQuery('');
                        setMobileMenuOpen(false);
                      }}
                      className="w-full flex flex-col px-2.5 py-1.5 rounded-xl hover:bg-slate-800/80 text-left transition-colors"
                    >
                      <span className="text-xs font-bold text-brand-white truncate">{pr.name}</span>
                      <span className="text-[10px] font-mono text-slate-400">SKU: {pr.sku} • {pr.customer_name || '-'}</span>
                    </button>
                  ))}
                </div>
              )}

              {searchResults.customers.length > 0 && (
                <div className="p-2">
                  <div className="px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Cartelle Clienti</div>
                  {searchResults.customers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        navigate(`/desktop/customers?customerId=${c.id}`);
                        setSearchOpen(false);
                        setSearchQuery('');
                        setMobileMenuOpen(false);
                      }}
                      className="w-full flex flex-col px-2.5 py-1.5 rounded-xl hover:bg-slate-800/80 text-left transition-colors"
                    >
                      <span className="text-xs font-bold text-brand-white truncate">{c.business_name}</span>
                      <span className="text-[10px] text-slate-400">P.IVA: {c.vat_number || '-'}</span>
                    </button>
                  ))}
                </div>
              )}

              {!searchLoading && !hasAnySearchResults && (
                <div className="p-4 text-center text-xs text-slate-500">
                  Nessun risultato per &ldquo;{searchQuery}&rdquo;
                </div>
              )}
            </div>
          )}
        </div>

        {/* Scrollable Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-3">
          {/* Toolbar Personalizzazione Menu & Preferiti */}
          <div className="flex items-center justify-between px-1.5 pt-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              Navigazione
            </span>
            <div className="flex items-center gap-1.5">
              {saveFeedback && (
                <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-0.5">
                  <Check size={11} /> {saveFeedback}
                </span>
              )}
              {isCustomizingMenu && (
                <button
                  type="button"
                  onClick={handleResetMenuLayout}
                  className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-slate-300 transition-colors"
                  title="Ripristina ordine predefinito"
                >
                  Ripristina
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsCustomizingMenu(prev => !prev)}
                className={`px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all border ${
                  isCustomizingMenu
                    ? 'bg-brand-blue text-brand-black border-brand-blue shadow'
                    : 'bg-slate-900/80 hover:bg-slate-800 text-slate-400 hover:text-white border-slate-800'
                }`}
                title="Personalizza ordine menu e preferiti (Drag & Drop)"
              >
                <SlidersHorizontal size={11} />
                {isCustomizingMenu ? 'Fine' : 'Personalizza'}
              </button>
            </div>
          </div>

          {isCustomizingMenu && (
            <div className="mx-1 px-3 py-2 rounded-xl bg-brand-blue/10 border border-brand-blue/30 text-[11px] text-sky-200 leading-snug">
              Trascina le <b>macro-categorie</b> o le <b>singole caselle</b> per riordinarle. Clicca la <b>★</b> per i preferiti.
            </div>
          )}

          {/* Sezione Preferiti */}
          {(favoriteItems.length > 0 || isCustomizingMenu) && (
            <div className="bg-slate-950/60 border border-amber-500/20 rounded-2xl p-2 space-y-1">
              <div className="px-2 py-1 flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-amber-400 flex items-center gap-1.5">
                  <Star size={11} className="fill-amber-400 text-amber-400" />
                  Preferiti ({favoriteItems.length})
                </span>
              </div>

              {favoriteItems.length === 0 ? (
                <div className="px-2.5 py-2.5 text-[11px] text-slate-500 text-center border border-dashed border-slate-800 rounded-xl">
                  Clicca la ★ su qualsiasi voce sotto per aggiungerla qui
                </div>
              ) : (
                <div className="space-y-1">
                  {favoriteItems.map(fav => {
                    const FavIcon = fav.icon;
                    const isActive = location.pathname === fav.path;
                    const isOver = dragOverId === `FAV:${fav.id}`;
                    return (
                      <div
                        key={`fav-${fav.id}`}
                        draggable
                        onDragStart={e => {
                          e.stopPropagation();
                          setDragState({ kind: 'FAV', id: fav.id });
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragOver={e => {
                          if (dragState?.kind === 'FAV') {
                            e.preventDefault();
                            e.stopPropagation();
                            setDragOverId(`FAV:${fav.id}`);
                          }
                        }}
                        onDragLeave={() => {
                          if (dragOverId === `FAV:${fav.id}`) setDragOverId(null);
                        }}
                        onDrop={e => handleDropOnFavorite(e, fav.id)}
                        onDragEnd={() => { setDragState(null); setDragOverId(null); }}
                        className={`group flex items-center gap-1.5 rounded-xl transition-all ${
                          isOver ? 'ring-2 ring-amber-400 bg-amber-500/10' : ''
                        }`}
                      >
                        {isCustomizingMenu && (
                          <span className="pl-1.5 text-slate-600 cursor-grab active:cursor-grabbing shrink-0">
                            <GripVertical size={13} />
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            navigate(fav.path);
                            setMobileMenuOpen(false);
                          }}
                          className={`flex-1 min-w-0 flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl transition-all text-left ${
                            isActive
                              ? 'bg-amber-400 text-brand-black font-black shadow-[0_0_15px_rgba(251,191,36,0.25)]'
                              : 'text-slate-200 hover:bg-slate-800/80 font-semibold'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <FavIcon size={15} className={isActive ? 'text-brand-black shrink-0' : 'text-amber-400 shrink-0'} />
                            <span className="text-xs truncate">{fav.name}</span>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={e => toggleFavorite(e, fav.id)}
                          title="Rimuovi dai preferiti"
                          className={`p-1.5 rounded-lg transition-all shrink-0 ${
                            isCustomizingMenu
                              ? 'opacity-100 text-amber-400 hover:bg-slate-800'
                              : 'opacity-0 group-hover:opacity-100 text-amber-400 hover:bg-slate-800'
                          }`}
                        >
                          <Star size={13} className="fill-amber-400" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Lista Macro-Categorie & Voci Principali (Drag & Drop) */}
          <div className="flex flex-col gap-1 pb-4">
            {orderedMenu.map((item) => {
              const isTopOver = dragOverId === `TOP:${item.id}`;
              const isDraggingThis = dragState?.kind === 'TOP' && dragState.id === item.id;

              if (item.submenu) {
                const isOpen = Boolean(openSubmenus[item.id]);
                const isChildActive = item.submenu.some(subItem => location.pathname === subItem.path);
                const Icon = item.icon;

                return (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={e => {
                      setDragState({ kind: 'TOP', id: item.id });
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={e => {
                      if (dragState?.kind === 'TOP') {
                        e.preventDefault();
                        setDragOverId(`TOP:${item.id}`);
                      }
                    }}
                    onDragLeave={() => {
                      if (dragOverId === `TOP:${item.id}`) setDragOverId(null);
                    }}
                    onDrop={e => handleDropOnTopItem(e, item.id)}
                    onDragEnd={() => { setDragState(null); setDragOverId(null); }}
                    className={`flex flex-col gap-1 rounded-2xl transition-all ${
                      isTopOver ? 'ring-2 ring-brand-blue bg-brand-blue/5' : ''
                    } ${isDraggingThis ? 'opacity-40' : ''}`}
                  >
                    <div className="group flex items-center gap-1">
                      <span
                        title="Trascina per spostare la macro-categoria"
                        className={`pl-1.5 text-slate-600 hover:text-brand-blue cursor-grab active:cursor-grabbing transition-opacity shrink-0 ${
                          isCustomizingMenu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        }`}
                      >
                        <GripVertical size={14} />
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleSubmenu(item.id)}
                        className={`flex-1 flex items-center justify-between px-3 py-2.5 rounded-xl transition-all ${
                          isChildActive
                            ? 'bg-brand-blue/12 text-brand-blue font-bold border border-brand-blue/25'
                            : 'text-slate-300 hover:bg-slate-800/70 hover:text-brand-white font-semibold border border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Icon size={18} className={isChildActive ? 'text-brand-blue shrink-0' : 'text-slate-400 shrink-0'} />
                          <span className="text-sm truncate">{item.name}</span>
                        </div>
                        {isOpen ? (
                          <ChevronDown size={15} className={isChildActive ? 'text-brand-blue shrink-0' : 'text-slate-500 shrink-0'} />
                        ) : (
                          <ChevronRight size={15} className={isChildActive ? 'text-brand-blue shrink-0' : 'text-slate-500 shrink-0'} />
                        )}
                      </button>
                    </div>

                    {isOpen && (
                      <div className="flex flex-col gap-1 pl-7 pr-1 py-0.5 ml-3 border-l border-slate-800/90">
                        {item.submenu.map((subItem) => {
                          const isSubActive = location.pathname === subItem.path;
                          const SubIcon = subItem.icon;
                          const isFav = favoriteIdSet.has(subItem.id);
                          const isSubOver = dragOverId === `SUB:${item.id}:${subItem.id}`;
                          const isSubDragging = dragState?.kind === 'SUB' && dragState.id === subItem.id;

                          return (
                            <div
                              key={subItem.id}
                              draggable
                              onDragStart={e => {
                                e.stopPropagation();
                                setDragState({ kind: 'SUB', catId: item.id, id: subItem.id });
                                e.dataTransfer.effectAllowed = 'move';
                              }}
                              onDragOver={e => {
                                if (dragState?.kind === 'SUB' && dragState.catId === item.id) {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setDragOverId(`SUB:${item.id}:${subItem.id}`);
                                }
                              }}
                              onDragLeave={() => {
                                if (dragOverId === `SUB:${item.id}:${subItem.id}`) setDragOverId(null);
                              }}
                              onDrop={e => handleDropOnSubItem(e, item.id, subItem.id)}
                              onDragEnd={e => { e.stopPropagation(); setDragState(null); setDragOverId(null); }}
                              className={`group/sub flex items-center gap-1 rounded-xl transition-all ${
                                isSubOver ? 'ring-2 ring-brand-blue bg-brand-blue/10' : ''
                              } ${isSubDragging ? 'opacity-40' : ''}`}
                            >
                              <span
                                title="Trascina per riordinare nella categoria"
                                className={`text-slate-600 hover:text-brand-blue cursor-grab active:cursor-grabbing shrink-0 transition-opacity ${
                                  isCustomizingMenu ? 'opacity-100' : 'opacity-0 group-hover/sub:opacity-100'
                                }`}
                              >
                                <GripVertical size={12} />
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  navigate(subItem.path);
                                  setMobileMenuOpen(false);
                                }}
                                className={`flex-1 min-w-0 flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-all text-left ${
                                  isSubActive
                                    ? 'bg-brand-blue text-brand-black font-bold shadow-[0_0_15px_rgba(14,165,233,0.25)]'
                                    : 'text-slate-400 hover:bg-slate-800/70 hover:text-brand-white font-medium'
                                }`}
                              >
                                <SubIcon size={15} className={isSubActive ? 'text-brand-black shrink-0' : 'text-slate-400 shrink-0'} />
                                <span className="text-xs truncate">{subItem.name}</span>
                              </button>
                              <button
                                type="button"
                                onClick={e => toggleFavorite(e, subItem.id)}
                                title={isFav ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
                                className={`p-1 rounded-lg transition-all shrink-0 ${
                                  isFav
                                    ? 'opacity-100 text-amber-400 hover:bg-slate-800'
                                    : isCustomizingMenu
                                      ? 'opacity-100 text-slate-600 hover:text-amber-300'
                                      : 'opacity-0 group-hover/sub:opacity-100 text-slate-500 hover:text-amber-300'
                                }`}
                              >
                                <Star size={12} className={isFav ? 'fill-amber-400' : ''} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              // Standalone top-level item
              const isActive = location.pathname === item.path;
              const Icon = item.icon;
              const isFav = favoriteIdSet.has(item.id);

              return (
                <div
                  key={item.id}
                  draggable
                  onDragStart={e => {
                    setDragState({ kind: 'TOP', id: item.id });
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={e => {
                    if (dragState?.kind === 'TOP') {
                      e.preventDefault();
                      setDragOverId(`TOP:${item.id}`);
                    }
                  }}
                  onDragLeave={() => {
                    if (dragOverId === `TOP:${item.id}`) setDragOverId(null);
                  }}
                  onDrop={e => handleDropOnTopItem(e, item.id)}
                  onDragEnd={() => { setDragState(null); setDragOverId(null); }}
                  className={`group flex items-center gap-1 rounded-xl transition-all ${
                    isTopOver ? 'ring-2 ring-brand-blue bg-brand-blue/10' : ''
                  } ${isDraggingThis ? 'opacity-40' : ''}`}
                >
                  <span
                    title="Trascina per spostare"
                    className={`pl-1.5 text-slate-600 hover:text-brand-blue cursor-grab active:cursor-grabbing transition-opacity shrink-0 ${
                      isCustomizingMenu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    <GripVertical size={14} />
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigate(item.path);
                      setMobileMenuOpen(false);
                    }}
                    className={`flex-1 min-w-0 flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl transition-all ${
                      isActive
                        ? 'bg-brand-blue text-brand-black font-bold shadow-[0_0_15px_rgba(14,165,233,0.25)]'
                        : 'text-slate-300 hover:bg-slate-800/70 hover:text-brand-white font-semibold'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Icon size={18} className={isActive ? 'text-brand-black shrink-0' : 'text-slate-400 shrink-0'} />
                      <span className="text-sm truncate">{item.name}</span>
                    </div>
                    {item.badge > 0 && (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black shrink-0 ${
                        isActive ? 'bg-brand-black text-brand-blue' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}>
                        {item.badge}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={e => toggleFavorite(e, item.id)}
                    title={isFav ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
                    className={`p-1.5 rounded-lg transition-all shrink-0 ${
                      isFav
                        ? 'opacity-100 text-amber-400 hover:bg-slate-800'
                        : isCustomizingMenu
                          ? 'opacity-100 text-slate-600 hover:text-amber-300'
                          : 'opacity-0 group-hover:opacity-100 text-slate-500 hover:text-amber-300'
                    }`}
                  >
                    <Star size={13} className={isFav ? 'fill-amber-400' : ''} />
                  </button>
                </div>
              );
            })}
          </div>
        </nav>

        {/* Footer Sidebar: Profilo Utente & Logout */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-950/70 shrink-0">
          <div className="flex items-center justify-between gap-2 px-2 py-1">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="w-9 h-9 rounded-xl border flex items-center justify-center font-black text-xs shrink-0 uppercase"
                style={{
                  backgroundColor: `${user.role_color || '#38bdf8'}20`,
                  borderColor: `${user.role_color || '#38bdf8'}55`,
                  color: user.role_color || '#38bdf8'
                }}
              >
                {(user.username || 'U').slice(0, 2)}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-brand-white truncate">{user.username || 'Utente'}</div>
                <div
                  className="text-[10px] font-bold uppercase tracking-wider truncate"
                  style={{ color: user.role_color || '#38bdf8' }}
                >
                  {user.role_name || user.role || 'admin'}
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem('maglite_token');
                localStorage.removeItem('maglite_user');
                window.location.href = '/login';
              }}
              title="Log Out Sicuro"
              className="p-2 rounded-xl text-rose-400 hover:bg-rose-500/15 hover:text-rose-300 transition-all shrink-0"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area + Top Context Bar */}
      <div className="flex-1 flex flex-col min-w-0 bg-brand-black">
        <header className="hidden md:flex items-center justify-between px-8 py-3.5 bg-slate-900/50 border-b border-slate-800/80 backdrop-blur-md sticky top-0 z-30">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500 font-semibold">{currentPageMeta.group}</span>
            <ChevronRight size={14} className="text-slate-600" />
            <span className="text-brand-white font-bold">{currentPageMeta.name}</span>
          </div>

          <div className="flex items-center gap-2.5">
            {hasPerm('view_inbound', user) && (
              <button
                type="button"
                onClick={() => navigate('/desktop/inbound')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                  location.pathname === '/desktop/inbound'
                    ? 'bg-brand-blue text-brand-black border-brand-blue'
                    : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-800 hover:border-brand-blue/40'
                }`}
              >
                <PackagePlus size={14} className={location.pathname === '/desktop/inbound' ? 'text-brand-black' : 'text-brand-blue'} />
                Nuova Merce
              </button>
            )}
            {hasPerm('view_outbound', user) && (
              <button
                type="button"
                onClick={() => navigate('/desktop/outbound')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                  location.pathname === '/desktop/outbound'
                    ? 'bg-brand-blue text-brand-black border-brand-blue'
                    : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-800 hover:border-brand-blue/40'
                }`}
              >
                <PackageMinus size={14} className={location.pathname === '/desktop/outbound' ? 'text-brand-black' : 'text-brand-blue'} />
                Spedizioni
              </button>
            )}
            {hasPerm('view_products', user) && (
              <button
                type="button"
                onClick={() => navigate('/desktop/products')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                  location.pathname === '/desktop/products'
                    ? 'bg-brand-blue text-brand-black border-brand-blue'
                    : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-800 hover:border-brand-blue/40'
                }`}
              >
                <Box size={14} className={location.pathname === '/desktop/products' ? 'text-brand-black' : 'text-brand-blue'} />
                Stock Palette
              </button>
            )}
            {hasPerm('view_quarantine', user) && (
              <button
                type="button"
                onClick={() => navigate('/desktop/quarantine')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                  location.pathname === '/desktop/quarantine'
                    ? 'bg-rose-500 text-brand-black border-rose-500'
                    : 'bg-slate-900 hover:bg-slate-800 text-rose-400 border-slate-800 hover:border-rose-500/40'
                }`}
              >
                <ShieldAlert size={14} className={location.pathname === '/desktop/quarantine' ? 'text-brand-black' : 'text-rose-400'} />
                Quarantena
              </button>
            )}
            {hasPerm('access_zebra', user) && (
              <button
                type="button"
                onClick={() => navigate('/zebra')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-brand-white border border-slate-800 transition-all"
                title="Passa all'interfaccia Terminale Zebra"
              >
                <Smartphone size={14} className="text-brand-blue" />
                Zebra
              </button>
            )}

            <NotificationCenter socket={socketInstance} />

            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${
              socketConnected
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
            }`}>
              <span className={`w-2 h-2 rounded-full ${socketConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
              {socketConnected ? 'Real-Time' : 'Offline'}
            </div>
          </div>
        </header>

        <main className="flex-1 w-full max-w-full overflow-y-auto overflow-x-hidden bg-brand-black p-4 md:p-8">
          <Suspense fallback={
            <div className="min-h-[50vh] flex flex-col items-center justify-center text-slate-400 gap-3">
              <div className="w-8 h-8 border-3 border-brand-blue border-t-transparent rounded-full animate-spin"></div>
              <div className="text-xs font-bold text-slate-400">Caricamento modulo...</div>
            </div>
          }>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
};

export default DesktopLayout;
