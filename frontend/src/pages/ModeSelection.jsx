import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Monitor, Smartphone, LogOut } from 'lucide-react';

const ModeSelection = () => {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('maglite_user') || '{}');
  const isOperator = user.role === 'operator';

  useEffect(() => {
    if (isOperator) {
      navigate('/zebra');
    }
  }, [isOperator, navigate]);

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
        <div className="w-20 h-20 bg-brand-blue rounded-2xl flex items-center justify-center text-brand-black font-bold text-4xl shadow-[0_0_30px_rgba(14,165,233,0.4)] mx-auto mb-6">
          M
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-2">MagLite <span className="text-brand-blue">x Porcelli</span></h1>
        <p className="text-slate-400 text-lg">Seleziona la modalità operativa per continuare</p>
      </div>

      <div className="w-full max-w-4xl grid md:grid-cols-2 gap-8">
        {/* Card Zebra */}
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

        {/* Card Desktop */}
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
      </div>
    </div>
  );
};

export default ModeSelection;
