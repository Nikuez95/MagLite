import React, { useState, useEffect, useRef, Suspense } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { io } from 'socket.io-client';
import {
  Settings2,
  LayoutDashboard,
  Users,
  Box,
  Map,
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
  ChevronUp,
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
  ClipboardList
} from 'lucide-react';
import { hasPerm, refreshUserProfile } from '../../utils/permissions';

const DesktopLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [socketConnected, setSocketConnected] = useState(true);

  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('maglite_user') || '{}');
    } catch {
      return {};
    }
  });

  const [openSubmenus, setOpenSubmenus] = useState({
    Merce: ['/desktop/inbound', '/desktop/outbound', '/desktop/inventory', '/desktop/products', '/desktop/outbound/history', '/desktop/outbound/returns', '/desktop/quarantine'].includes(location.pathname),
    Finanza: ['/desktop/finances', '/desktop/expenses', '/desktop/invoices-history'].includes(location.pathname),
    Amministrazione: ['/desktop/billing-rules', '/desktop/billing-tariffs', '/desktop/billing-dashboard'].includes(location.pathname)
  });

  // Global Search / Command Palette state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState({ pallets: [], products: [], customers: [], orders: [] });
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef = useRef(null);
  const searchContainerRef = useRef(null);

  useEffect(() => {
    setOpenSubmenus(prev => ({
      ...prev,
      Merce: prev.Merce || ['/desktop/inbound', '/desktop/outbound', '/desktop/inventory', '/desktop/products', '/desktop/outbound/history', '/desktop/outbound/returns', '/desktop/quarantine'].includes(location.pathname),
      Finanza: prev.Finanza || ['/desktop/finances', '/desktop/expenses', '/desktop/invoices-history'].includes(location.pathname),
      Amministrazione: prev.Amministrazione || ['/desktop/billing-rules', '/desktop/billing-tariffs', '/desktop/billing-dashboard'].includes(location.pathname)
    }));
  }, [location.pathname]);

  useEffect(() => {
    refreshUserProfile().then(u => {
      if (u) setUser(u);
    });
    const handlePermSync = () => {
      try {
        setUser(JSON.parse(localStorage.getItem('maglite_user') || '{}'));
      } catch {
        // ignore
      }
    };
    window.addEventListener('maglite_permissions_updated', handlePermSync);
    return () => window.removeEventListener('maglite_permissions_updated', handlePermSync);
  }, []);

  // WebSocket status indicator in top bar & live permissions sync
  useEffect(() => {
    const socket = io(`http://${window.location.hostname}:3000`);
    socket.on('connect', () => setSocketConnected(true));
    socket.on('disconnect', () => setSocketConnected(false));
    socket.on('connect_error', () => setSocketConnected(false));
    socket.on('permissions_updated', () => {
      refreshUserProfile().then(u => {
        if (u) setUser(u);
      });
    });
    return () => socket.disconnect();
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

  // Click outside search dropdown to close
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Live debounced search
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

  const toggleSubmenu = (name) => {
    setOpenSubmenus(prev => ({ ...prev, [name]: !prev[name] }));
  };

  const rawMenu = [
    { name: 'Dashboard', path: '/desktop', icon: LayoutDashboard, perm: 'view_dashboard' },
    { 
      name: 'Merce', 
      icon: Package, 
      submenu: [
        { name: 'Nuova Merce (In)', path: '/desktop/inbound', icon: PackagePlus, perm: 'view_inbound' },
        { name: 'Moduli & Check-in', path: '/desktop/custom-forms', icon: ClipboardList, perm: ['view_custom_forms', 'manage_custom_forms'] },
        { name: 'Spedizioni (Out)', path: '/desktop/outbound', icon: PackageMinus, perm: 'view_outbound' },
        { name: 'Storico Resi', path: '/desktop/outbound/returns', icon: RotateCcw, perm: ['view_outbound', 'outbound_return'] },
        { name: 'Prodotti & Stock', path: '/desktop/products', icon: Box, perm: 'view_products' },
        { name: 'Quarantena & Qualità', path: '/desktop/quarantine', icon: ShieldAlert, perm: 'view_quarantine' },
        { name: 'Inventario', path: '/desktop/inventory', icon: PackageSearch, perm: 'view_inventory' },
      ]
    },
    { name: 'Clienti', path: '/desktop/customers', icon: Users, perm: 'view_customers' },
    { name: 'Magazzino', path: '/desktop/locations', icon: Map, perm: 'view_locations' },
    { name: 'DDT Entrata (Spunta)', path: '/desktop/documents', icon: FileText, perm: 'view_documents' },
    { name: 'TMS (Trasporti)', path: '/desktop/tms', icon: Truck, perm: ['view_tms', 'tms_manage'] },
    {
      name: 'Finanza',
      icon: DollarSign,
      perm: ['view_finances', 'finance_manage'],
      submenu: [
        { name: 'Dashboard Finanza', path: '/desktop/finances', icon: Activity, perm: ['view_finances', 'finance_manage'] },
        { name: 'Gestione Uscite', path: '/desktop/expenses', icon: TrendingDown, perm: ['view_finances', 'finance_manage'] },
        { name: 'Archivio Proforme', path: '/desktop/invoices-history', icon: Archive, perm: ['view_finances', 'finance_manage'] }
      ]
    },
    {
      name: 'Amministrazione',
      icon: Calculator,
      perm: ['view_billing', 'finance_manage'],
      submenu: [
        { name: 'Regole Base', path: '/desktop/billing-rules', icon: Settings2, perm: ['view_billing', 'finance_manage'] },
        { name: 'Tariffe Clienti', path: '/desktop/billing-tariffs', icon: Coins, perm: ['view_billing', 'finance_manage'] },
        { name: 'Pre-Fatturazione', path: '/desktop/billing-dashboard', icon: ReceiptText, perm: ['view_billing', 'finance_manage'] }
      ]
    },
    { name: 'Utenti (Team)', path: '/desktop/users', icon: UserCog, perm: ['view_users', 'users_manage'] },
    { name: 'Audit Logs', path: '/desktop/audit', icon: History, perm: 'view_audit' },
  ];

  const menu = rawMenu
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
    { name: 'Anagrafica Clienti', path: '/desktop/customers', icon: Users, group: 'Anagrafiche', perm: 'view_customers' },
    { name: 'Mappa Magazzino & Scaffali', path: '/desktop/locations', icon: Map, group: 'Magazzino', perm: 'view_locations' },
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
    { name: 'Impostazioni Aziendali', path: '/desktop/settings', icon: Settings, group: 'Configurazione', perm: 'view_settings' },
    { name: 'Regole di Prelievo (Routing)', path: '/desktop/settings/routing', icon: Map, group: 'Configurazione', perm: 'view_settings' }
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
        <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="p-2 bg-slate-800 rounded-lg text-brand-white">
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Sidebar Navigation */}
      <aside className={`${mobileMenuOpen ? 'flex' : 'hidden'} md:flex flex-col w-full md:w-72 bg-slate-900/95 md:bg-slate-900/70 border-r border-slate-800/90 backdrop-blur-md z-40 fixed md:sticky top-0 h-screen overflow-y-auto shrink-0`}>
        
        {/* Header Sidebar (Desktop only) - Light Logo */}
        <div
          className="hidden md:flex px-5 py-5 items-center gap-3.5 border-b border-slate-800/80 cursor-pointer hover:bg-slate-800/30 transition-colors group"
          onClick={() => navigate('/')}
          title="Torna alla selezione modalità"
        >
          <div className="h-12 w-20 flex items-center justify-center shrink-0">
            <img
              src="/logo.png"
              alt="Logistic Porcelli Logo"
              className="max-w-full max-h-full object-contain drop-shadow-[0_0_15px_rgba(169,218,255,0.35)] group-hover:scale-105 transition-transform"
            />
          </div>
          <div className="min-w-0">
            <h1 className="font-black text-lg leading-tight tracking-tight text-brand-white truncate">MagLite</h1>
            <p className="text-brand-blue text-[10px] uppercase font-extrabold tracking-[0.18em] truncate">Logistic Porcelli</p>
          </div>
        </div>

        {/* Global Search Bar with Ctrl+K */}
        <div className="px-4 mt-4 relative" ref={searchContainerRef}>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search size={16} className="text-slate-500" />
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
              placeholder="Cerca paletta, lotto, pagina..." 
              className="w-full bg-slate-950/90 border border-slate-800 text-brand-white text-xs rounded-xl focus:ring-1 focus:ring-brand-blue focus:border-brand-blue block pl-9 pr-12 py-2.5 transition-all placeholder-slate-500"
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
            <div className="absolute left-4 right-4 top-full mt-2 bg-slate-950 border border-slate-700 rounded-2xl shadow-2xl z-50 max-h-[70vh] overflow-y-auto divide-y divide-slate-800/80">
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
                  <div className="px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Clienti</div>
                  {searchResults.customers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        navigate('/desktop/customers');
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
                  Nessun risultato per "{searchQuery}"
                </div>
              )}
            </div>
          )}
        </div>

        {/* Menu Links */}
        <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
          <p className="px-3 text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">Menu Principale</p>
          {menu.map((item) => {
            if (item.submenu) {
              const isOpen = openSubmenus[item.name];
              const isChildActive = item.submenu.some(subItem => location.pathname === subItem.path);
              const Icon = item.icon;
              return (
                <div key={item.name} className="flex flex-col gap-1">
                  <button
                    onClick={() => toggleSubmenu(item.name)}
                    className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-all ${
                      isChildActive
                        ? 'bg-brand-blue/10 text-brand-blue font-bold border border-brand-blue/25'
                        : 'text-slate-400 hover:bg-slate-800/70 hover:text-brand-white font-medium border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon size={19} className={isChildActive ? 'text-brand-blue' : 'text-slate-400'} />
                      <span className="text-sm">{item.name}</span>
                    </div>
                    {isOpen ? <ChevronUp size={16} className={isChildActive ? 'text-brand-blue' : 'text-slate-400'} /> : <ChevronDown size={16} className={isChildActive ? 'text-brand-blue' : 'text-slate-400'} />}
                  </button>
                  {isOpen && (
                    <div className="flex flex-col gap-1 pl-9 pr-1 py-0.5">
                      {item.submenu.map((subItem) => {
                        const isSubActive = location.pathname === subItem.path;
                        const SubIcon = subItem.icon;
                        return (
                          <button
                            key={subItem.name}
                            onClick={() => {
                              navigate(subItem.path);
                              setMobileMenuOpen(false);
                            }}
                            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all ${
                              isSubActive
                                ? 'bg-brand-blue text-brand-black font-bold shadow-[0_0_15px_rgba(14,165,233,0.25)]'
                                : 'text-slate-400 hover:bg-slate-800/70 hover:text-brand-white font-medium'
                            }`}
                          >
                            <SubIcon size={16} className={isSubActive ? 'text-brand-black' : 'text-slate-400'} />
                            <span className="text-xs">{subItem.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            const isActive = location.pathname === item.path;
            const Icon = item.icon;
            return (
              <button
                key={item.name}
                onClick={() => {
                  navigate(item.path);
                  setMobileMenuOpen(false);
                }}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-all ${
                  isActive 
                    ? 'bg-brand-blue text-brand-black font-bold shadow-[0_0_15px_rgba(14,165,233,0.25)]' 
                    : 'text-slate-400 hover:bg-slate-800/70 hover:text-brand-white font-medium'
                }`}
              >
                <Icon size={19} className={isActive ? 'text-brand-black' : 'text-slate-400'} />
                <span className="text-sm">{item.name}</span>
              </button>
            );
          })}
        </nav>

        {/* Footer Sidebar */}
        <div className="p-3 border-t border-slate-800/80 flex flex-col gap-1.5 bg-slate-950/40">
          {hasPerm(['view_settings', 'settings_manage', 'pallet_move'], user) && (
            <>
              <button
                onClick={() => { navigate('/desktop/settings'); setMobileMenuOpen(false); }}
                className={`flex items-center gap-3 px-3.5 py-2 rounded-xl w-full transition-all text-xs font-semibold ${
                  location.pathname === '/desktop/settings'
                    ? 'bg-brand-blue text-brand-black font-bold'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-brand-white'
                }`}
              >
                <Settings size={17} />
                <span>Impostazioni Aziendali</span>
              </button>
              <button
                onClick={() => { navigate('/desktop/settings/routing'); setMobileMenuOpen(false); }}
                className={`flex items-center gap-3 px-3.5 py-2 rounded-xl w-full transition-all text-xs font-semibold ${
                  location.pathname === '/desktop/settings/routing'
                    ? 'bg-brand-blue text-brand-black font-bold'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-brand-white'
                }`}
              >
                <Map size={17} />
                <span>Regole di Prelievo</span>
              </button>
            </>
          )}

          {/* User Profile & Logout Bar */}
          <div className="mt-1 pt-2 border-t border-slate-800/70 flex items-center justify-between gap-2 px-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="w-8 h-8 rounded-xl border flex items-center justify-center font-black text-xs shrink-0 uppercase"
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
        {/* Desktop Top Quick-Action & Breadcrumb Bar */}
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
