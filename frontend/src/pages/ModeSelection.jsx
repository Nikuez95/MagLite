import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Monitor, Smartphone, LogOut, ShieldAlert } from 'lucide-react';
import { canAccessDesktop, canAccessZebra, refreshUserProfile } from '../utils/permissions';

const ModeSelection = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('maglite_user') || '{}');
    } catch {
      return {};
    }
  });

  useEffect(() => {
    refreshUserProfile().then(u => {
      if (u) setUser(u);
    });
    const sync = () => {
      try {
        setUser(JSON.parse(localStorage.getItem('maglite_user') || '{}'));
      } catch {
        // ignore
      }
    };
    window.addEventListener('maglite_permissions_updated', sync);
    return () => window.removeEventListener('maglite_permissions_updated', sync);
  }, []);

  const allowDesktop = canAccessDesktop(user);
  const allowZebra = canAccessZebra(user);

  useEffect(() => {
    if (!allowDesktop && allowZebra) {
      navigate('/zebra', { replace: true });
    }
  }, [allowDesktop, allowZebra, navigate]);

  const handleLogout = () => {
    localStorage.removeItem('maglite_token');
    localStorage.removeItem('maglite_user');
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen bg-brand-black flex flex-col items-center justify-center p-6 text-brand-white relative">
      <button 
        onClick={handleLogout}
        className="absolute top-6 right-6 flex items-center gap-2 px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 hover:text-brand-white hover:bg-slate-800 transition-colors"
      >
        <LogOut size={18} />
        <span className="text-sm font-bold">Logout</span>
      </button>

      <div className="text-center mb-12">
        <div className="w-60 h-32 flex items-center justify-center mx-auto mb-5">
          <img src="/logo.png" alt="Logistic Porcelli Logo" className="max-w-full max-h-full object-contain drop-shadow-[0_0_20px_rgba(169,218,255,0.4)]" />
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-2">MagLite <span className="text-brand-blue">x Porcelli</span></h1>
        <p className="text-slate-400 text-lg">Seleziona la modalità operativa per continuare</p>
      </div>

      {!allowDesktop && !allowZebra ? (
        <div className="max-w-md w-full bg-slate-900/90 border border-rose-500/30 rounded-3xl p-8 text-center shadow-2xl">
          <div className="w-16 h-16 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center mx-auto mb-4 text-rose-400">
            <ShieldAlert size={34} />
          </div>
          <h2 className="text-xl font-black text-brand-white mb-2">Nessuna Piattaforma Abilitata</h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-6">
            Il tuo profilo non dispone attualmente dei permessi di accesso né al Gestionale Desktop né al Terminale Zebra. Contatta un amministratore.
          </p>
          <button
            onClick={handleLogout}
            className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl transition-all text-sm"
          >
            Torna al Login
          </button>
        </div>
      ) : (
        <div className={`w-full max-w-4xl grid gap-8 ${allowZebra && allowDesktop ? 'md:grid-cols-2' : 'max-w-md grid-cols-1'}`}>
          {/* Card Zebra - visibile SOLO se l'utente ha il permesso access_zebra */}
          {allowZebra && (
            <button 
              onClick={() => navigate('/zebra')}
              className="group flex flex-col items-center justify-center p-12 bg-slate-900 border-2 border-slate-800 rounded-[2rem] hover:bg-slate-800/80 hover:border-brand-blue hover:shadow-[0_0_40px_rgba(14,165,233,0.15)] transition-all duration-300 active:scale-95"
            >
              <div className="w-28 h-28 bg-slate-950 rounded-full flex items-center justify-center mb-8 group-hover:bg-brand-blue/20 transition-colors shadow-inner">
                <Smartphone size={56} className="text-brand-white group-hover:text-brand-blue transition-colors" />
              </div>
              <h2 className="text-3xl font-bold text-brand-white mb-3">Terminale Zebra</h2>
              <p className="text-slate-400 text-center font-medium leading-relaxed">
                Interfaccia touch per gli operatori di magazzino. Focus su In-stock, out-stock e handling via laser.
              </p>
            </button>
          )}

          {/* Card Desktop - visibile SOLO se l'utente ha il permesso access_desktop */}
          {allowDesktop && (
            <button 
              onClick={() => navigate('/desktop')}
              className="group flex flex-col items-center justify-center p-12 bg-slate-900 border-2 border-slate-800 rounded-[2rem] hover:bg-slate-800/80 hover:border-brand-blue hover:shadow-[0_0_40px_rgba(14,165,233,0.15)] transition-all duration-300 active:scale-95"
            >
              <div className="w-28 h-28 bg-slate-950 rounded-full flex items-center justify-center mb-8 group-hover:bg-brand-blue/20 transition-colors shadow-inner">
                <Monitor size={56} className="text-brand-white group-hover:text-brand-blue transition-colors" />
              </div>
              <h2 className="text-3xl font-bold text-brand-white mb-3">Gestionale Desktop</h2>
              <p className="text-slate-400 text-center font-medium leading-relaxed">
                Pannello di controllo per amministratori. Anagrafiche, log storici, reportistica e mappa del magazzino.
              </p>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default ModeSelection;
