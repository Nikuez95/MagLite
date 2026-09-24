import React, { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, Box, Map, History, LogOut, Settings, FileText, Search, UserCog, PackagePlus, PackageMinus, PackageSearch, Menu, X } from 'lucide-react';

const DesktopLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const menu = [
    { name: 'Dashboard', path: '/desktop', icon: LayoutDashboard },
    { name: 'Nuova Merce (In)', path: '/desktop/inbound', icon: PackagePlus },
    { name: 'Spedizioni (Out)', path: '/desktop/outbound', icon: PackageMinus },
    { name: 'Inventario', path: '/desktop/inventory', icon: PackageSearch },
    { name: 'Clienti', path: '/desktop/customers', icon: Users },
    { name: 'Prodotti', path: '/desktop/products', icon: Box },
    { name: 'Magazzino', path: '/desktop/locations', icon: Map },
    { name: 'Documenti (DDT)', path: '/desktop/documents', icon: FileText },
    { name: 'Utenti (Team)', path: '/desktop/users', icon: UserCog },
    { name: 'Audit Logs', path: '/desktop/audit', icon: History },
  ];

  return (
    <div className="min-h-screen bg-brand-black flex flex-col md:flex-row text-brand-white font-sans selection:bg-brand-blue selection:text-brand-black">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 bg-slate-900 border-b border-slate-800">
        <div className="flex items-center gap-3" onClick={() => navigate('/')}>
          <img src="/logo.png" alt="Logo" className="w-8 h-8 object-contain" />
          <h1 className="font-bold text-lg leading-tight tracking-tight">MagLite</h1>
        </div>
        <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="p-2 bg-slate-800 rounded-lg text-brand-white">
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Sidebar Navigation */}
      <aside className={`${mobileMenuOpen ? 'flex' : 'hidden'} md:flex flex-col w-full md:w-72 bg-slate-900/95 md:bg-slate-900/50 border-r border-slate-800 backdrop-blur-md z-40 fixed md:sticky top-0 h-screen md:h-screen overflow-y-auto`}>
        
        {/* Header Sidebar (Desktop only) */}
        <div className="hidden md:flex p-6 items-center gap-4 border-b border-slate-800 cursor-pointer" onClick={() => navigate('/')}>
          <div className="w-12 h-12 flex items-center justify-center">
            <img src="/logo.png" alt="MagLite Logo" className="max-w-full max-h-full object-contain drop-shadow-[0_0_15px_rgba(169,218,255,0.4)]" />
          </div>
          <div>
            <h1 className="font-bold text-xl leading-tight tracking-tight">MagLite</h1>
            <p className="text-brand-blue text-xs uppercase font-bold tracking-[0.2em]">Gestionale</p>
          </div>
        </div>

        {/* Global Search Bar */}
        <div className="px-4 mt-6">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search size={18} className="text-slate-500" />
            </div>
            <input 
              type="text" 
              placeholder="Ricerca globale..." 
              className="w-full bg-slate-950 border border-slate-800 text-brand-white text-sm rounded-xl focus:ring-brand-blue focus:border-brand-blue block pl-10 p-3 transition-colors placeholder-slate-500"
            />
          </div>
        </div>

        {/* Menu Links */}
        <nav className="flex-1 p-4 flex flex-col gap-2 mt-4">
          <p className="px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Menu Principale</p>
          {menu.map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;
            return (
              <button
                key={item.name}
                onClick={() => {
                  navigate(item.path);
                  setMobileMenuOpen(false);
                }}
                className={`flex items-center gap-4 px-4 py-3.5 rounded-xl transition-all ${
                  isActive 
                    ? 'bg-brand-blue text-brand-black font-bold shadow-md' 
                    : 'text-slate-400 hover:bg-slate-800 hover:text-brand-white font-medium'
                }`}
              >
                <Icon size={22} className={isActive ? 'text-brand-black' : 'text-slate-400'} />
                <span className="text-sm">{item.name}</span>
              </button>
            );
          })}
        </nav>

        {/* Footer Sidebar */}
        <div className="p-4 border-t border-slate-800 flex flex-col gap-2">
          <button className="flex items-center gap-4 px-4 py-3 rounded-xl text-slate-400 hover:bg-slate-800 hover:text-brand-white w-full transition-all">
            <Settings size={20} />
            <span className="text-sm font-medium">Impostazioni</span>
          </button>
          <button 
            onClick={() => {
              localStorage.removeItem('maglite_token');
              localStorage.removeItem('maglite_user');
              window.location.href = '/login';
            }} 
            className="flex items-center gap-4 px-4 py-3 rounded-xl text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 w-full transition-all"
          >
            <LogOut size={20} />
            <span className="text-sm font-medium">Log Out Sicuro</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-full overflow-y-auto overflow-x-hidden bg-brand-black p-4 md:p-8">
        <Outlet />
      </main>
    </div>
  );
};

export default DesktopLayout;
