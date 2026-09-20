import React, { useState } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { PackagePlus, ArrowRightLeft, PackageMinus, LogOut, Scan } from 'lucide-react';
import useBarcodeScanner from '../hooks/useBarcodeScanner';
import Stow from './Stow';

const TouchButton = ({ icon: Icon, label, onClick }) => (
  <button 
    onClick={onClick}
    className="flex flex-col items-center justify-center p-6 rounded-3xl border-2 border-slate-800 shadow-xl transition-all active:scale-95 bg-slate-900 text-brand-white hover:border-brand-blue"
  >
    <Icon size={56} className="mb-4 text-brand-blue" />
    <span className="text-xl font-bold tracking-wide">{label}</span>
  </button>
);

const TopBar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isHome = location.pathname === '/zebra';

  return (
    <header className="bg-brand-black border-b border-slate-800 p-5 flex justify-between items-center sticky top-0 z-10 shadow-lg">
      <div 
        className={`flex items-center gap-4 ${!isHome ? 'cursor-pointer active:scale-95 transition-transform' : ''}`} 
        onClick={() => !isHome && navigate('/zebra')}
      >
        <div className="w-12 h-12 bg-brand-blue rounded-xl flex items-center justify-center text-brand-black font-bold text-2xl shadow-[0_0_15px_rgba(14,165,233,0.5)]">
          M
        </div>
        <div>
          <h1 className="text-brand-white font-bold text-xl leading-tight tracking-tight">MagLite</h1>
          <p className="text-brand-blue text-[11px] uppercase font-bold tracking-[0.2em]">Operatore</p>
        </div>
      </div>
      <button 
        onClick={() => {
          localStorage.removeItem('maglite_token');
          localStorage.removeItem('maglite_user');
          window.location.href = '/login';
        }}
        className="p-4 rounded-full bg-slate-900 border border-slate-800 text-brand-white active:bg-slate-800 transition-colors"
      >
        <LogOut size={24} />
      </button>
    </header>
  );
};

const Dashboard = () => {
  const navigate = useNavigate();

  return (
    <div className="flex-1 p-6 flex flex-col gap-6 overflow-y-auto w-full max-w-md mx-auto">
      <div className="mb-2 mt-4">
        <h2 className="text-4xl font-extrabold text-brand-white tracking-tight">Scanner</h2>
        <p className="text-brand-blue text-base font-medium mt-1">Seleziona l'azione da eseguire</p>
      </div>
      
      <div className="grid grid-cols-1 gap-5">
        <TouchButton 
          icon={PackagePlus} 
          label="STIVAGGIO (Messa a dimora)" 
          onClick={() => navigate('/zebra/stow')} 
        />
        <TouchButton 
          icon={ArrowRightLeft} 
          label="HANDLING (Spostamento)" 
          onClick={() => navigate('/zebra/handling')} 
        />
        <TouchButton 
          icon={PackageMinus} 
          label="PICKING (Prelievo)" 
          onClick={() => navigate('/zebra/outbound')} 
        />
      </div>
    </div>
  );
};

const ZebraOperationPage = ({ title }) => {
  const [lastScan, setLastScan] = useState(null);
  const [flash, setFlash] = useState(false);

  useBarcodeScanner((barcode) => {
    setLastScan(barcode);
    setFlash(true);
    setTimeout(() => setFlash(false), 300);
  });

  return (
    <div className={`flex-1 p-6 flex flex-col items-center justify-center text-center transition-colors duration-300 ${flash ? 'bg-brand-blue/20' : 'bg-brand-black'}`}>
      <div className="relative mb-8">
        <Scan size={96} className="text-brand-blue opacity-80" />
        <div className="absolute inset-0 bg-brand-blue opacity-20 blur-2xl rounded-full animate-pulse"></div>
      </div>
      <h2 className="text-4xl font-extrabold text-brand-white mb-4 uppercase">{title}</h2>
      <p className="text-slate-400 mb-10 max-w-[280px] text-lg leading-relaxed">
        Punta il laser del terminale Zebra e premi il grilletto per scansionare.
      </p>
      {lastScan ? (
        <div className="bg-brand-blue text-brand-black px-8 py-5 rounded-3xl shadow-[0_0_30px_rgba(14,165,233,0.4)] animate-[bounce_0.5s_ease-in-out]">
          <p className="text-sm uppercase font-extrabold tracking-widest mb-1 opacity-80">Codice Rilevato</p>
          <p className="text-4xl font-black">{lastScan}</p>
        </div>
      ) : (
        <div className="border-2 border-slate-800 border-dashed rounded-3xl px-8 py-6 text-slate-500 font-semibold text-lg">
          In attesa di scansione...
        </div>
      )}
    </div>
  );
};

import OutboundZebra from './OutboundZebra';

const ZebraApp = () => {
  return (
    <div className="min-h-screen bg-brand-black flex flex-col font-sans text-brand-white antialiased selection:bg-brand-blue selection:text-brand-black">
      <TopBar />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/stow" element={<Stow />} />
        <Route path="/outbound" element={<OutboundZebra />} />
        <Route path="/handling" element={<ZebraOperationPage title="Handling" />} />
        <Route path="/out-stock" element={<ZebraOperationPage title="Picking" />} />
      </Routes>
    </div>
  );
};

export default ZebraApp;
