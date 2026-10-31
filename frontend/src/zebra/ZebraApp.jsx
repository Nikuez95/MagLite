import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { io } from 'socket.io-client';
import { ArrowRightLeft, PackageMinus, LogOut, Scan, Download, ChevronRight, User, Radio, Monitor, Lock, Truck, ClipboardList, Box, Thermometer, ShieldAlert, Sparkles, X, Layers } from 'lucide-react';
import useBarcodeScanner from '../hooks/useBarcodeScanner';
import InboundZebra from './InboundZebra';
import OutboundZebra from './OutboundZebra';
import Handling from './Handling';
import ZebraCheckinWizard from './ZebraCheckinWizard';
import { hasPerm, canAccessZebra, canAccessDesktop, refreshUserProfile } from '../utils/permissions';

const TouchCard = ({ icon: Icon, label, subtitle, badge, accent = 'blue', disabled = false, onClick }) => {
  const accentStyles = {
    blue: {
      border: 'border-slate-800 hover:border-brand-blue active:border-brand-blue',
      iconBg: 'bg-brand-blue/15 text-brand-blue border-brand-blue/30',
      badgeBg: 'bg-brand-blue text-brand-black'
    },
    amber: {
      border: 'border-slate-800 hover:border-amber-400 active:border-amber-400',
      iconBg: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
      badgeBg: 'bg-amber-400 text-brand-black'
    },
    emerald: {
      border: 'border-slate-800 hover:border-emerald-400 active:border-emerald-400',
      iconBg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
      badgeBg: 'bg-emerald-400 text-brand-black'
    },
    cyan: {
      border: 'border-slate-800 hover:border-cyan-400 active:border-cyan-400',
      iconBg: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
      badgeBg: 'bg-cyan-400 text-brand-black'
    },
    purple: {
      border: 'border-slate-800 hover:border-purple-400 active:border-purple-400',
      iconBg: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
      badgeBg: 'bg-purple-400 text-brand-black'
    },
    rose: {
      border: 'border-slate-800 hover:border-rose-400 active:border-rose-400',
      iconBg: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
      badgeBg: 'bg-rose-400 text-brand-black'
    }
  }[accent] || {
    border: 'border-slate-800 hover:border-brand-blue active:border-brand-blue',
    iconBg: 'bg-brand-blue/15 text-brand-blue border-brand-blue/30',
    badgeBg: 'bg-brand-blue text-brand-black'
  };

  if (disabled) {
    return (
      <div className="w-full flex items-center justify-between p-5 rounded-3xl border-2 border-slate-800/60 bg-slate-900/40 text-slate-500 opacity-60 cursor-not-allowed">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-16 h-16 rounded-2xl border border-slate-800 bg-slate-950 flex items-center justify-center shrink-0 text-slate-600">
            <Lock size={28} />
          </div>
          <div className="min-w-0">
            <span className="text-lg font-black tracking-wide leading-tight block">{label}</span>
            <p className="text-xs text-slate-500 font-semibold mt-1 leading-snug">
              Permesso operativo non abilitato sul tuo profilo
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between p-5 rounded-3xl border-2 shadow-xl transition-all active:scale-[0.98] bg-slate-900/95 text-brand-white text-left ${accentStyles.border}`}
    >
      <div className="flex items-center gap-4 min-w-0">
        <div className={`w-16 h-16 rounded-2xl border flex items-center justify-center shrink-0 ${accentStyles.iconBg}`}>
          <Icon size={34} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xl font-black tracking-wide leading-tight">{label}</span>
            {badge !== undefined && badge !== null && badge > 0 && (
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-black ${accentStyles.badgeBg}`}>
                {badge}
              </span>
            )}
          </div>
          {subtitle && (
            <p className="text-xs text-slate-400 font-semibold mt-1 leading-snug">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      <div className="w-10 h-10 rounded-xl bg-slate-800/80 flex items-center justify-center text-slate-400 shrink-0 ml-2">
        <ChevronRight size={22} />
      </div>
    </button>
  );
};

const TopBar = ({ user }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const isHome = location.pathname === '/zebra' || location.pathname === '/zebra/';
  const allowDesktop = canAccessDesktop(user);

  return (
    <header className="bg-brand-black/95 backdrop-blur border-b border-slate-800 px-4 py-3.5 flex justify-between items-center sticky top-0 z-20 shadow-lg">
      <div 
        className={`flex items-center gap-3 ${!isHome ? 'cursor-pointer active:scale-95 transition-transform' : ''}`} 
        onClick={() => !isHome && navigate('/zebra')}
      >
        <div className="h-10 w-14 flex items-center justify-center shrink-0">
          <img src="/logo.png" alt="Logistic Porcelli Logo" className="max-w-full max-h-full object-contain drop-shadow-[0_0_15px_rgba(169,218,255,0.4)]" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-brand-white font-black text-lg leading-tight tracking-tight">MagLite</h1>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-black uppercase">
              <Radio size={10} className="animate-pulse" /> Zebra
            </span>
          </div>
          <p className="text-slate-400 text-[11px] font-bold flex items-center gap-1 mt-0.5">
            <User size={11} className="text-brand-blue" />
            <span>{user.username || 'Operatore'}</span>
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {allowDesktop && isHome && (
          <button
            onClick={() => navigate('/desktop')}
            className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-black uppercase text-slate-300 hover:text-brand-white flex items-center gap-1.5"
            title="Passa al Gestionale Desktop"
          >
            <Monitor size={14} className="text-brand-blue" />
            PC
          </button>
        )}
        {!isHome && (
          <button
            onClick={() => navigate('/zebra')}
            className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-black uppercase text-brand-blue active:bg-slate-800"
          >
            Home
          </button>
        )}
        <button 
          onClick={() => {
            localStorage.removeItem('maglite_token');
            localStorage.removeItem('maglite_user');
            window.location.href = '/login';
          }}
          className="p-3 rounded-2xl bg-slate-900 border border-slate-800 text-rose-400 active:bg-slate-800 transition-colors"
          title="Esci"
        >
          <LogOut size={20} />
        </button>
      </div>
    </header>
  );
};

const iconComponentMap = {
  Truck: Truck,
  Box: Box,
  ClipboardList: ClipboardList,
  Thermometer: Thermometer,
  ShieldAlert: ShieldAlert,
  Sparkles: Sparkles,
  Smartphone: Scan,
  Download: Download
};

const Dashboard = ({ user }) => {
  const navigate = useNavigate();
  const [counts, setCounts] = useState({ inboundPending: 0, outboundActive: 0 });
  const [customForms, setCustomForms] = useState([]);
  const [showFormsModal, setShowFormsModal] = useState(false);

  const canInbound = hasPerm('inbound_create', user);
  const canHandling = hasPerm('pallet_move', user);
  const canPicking = hasPerm('outbound_pick', user);

  useEffect(() => {
    const token = localStorage.getItem('maglite_token');
    if (!token) return;
    const fetchCounts = async () => {
      try {
        const reqs = [
          canInbound
            ? axios.get(`http://${window.location.hostname}:3000/api/inbound/ddt`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => ({ data: [] }))
            : Promise.resolve({ data: [] }),
          canPicking
            ? axios.get(`http://${window.location.hostname}:3000/api/outbound`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => ({ data: [] }))
            : Promise.resolve({ data: [] })
        ];
        const [inRes, outRes] = await Promise.all(reqs);
        const inboundPending = (inRes.data || []).filter(d => d.status === 'PENDING' || d.status === 'IN_PROGRESS').length;
        const outboundActive = (outRes.data || []).filter(o => o.status === 'PENDING' || o.status === 'PICKING' || o.status === 'PARTIAL').length;
        setCounts({ inboundPending, outboundActive });

        // Recupera moduli attivi per Zebra
        try {
          const formsRes = await axios.get(`http://${window.location.hostname}:3000/api/custom-forms?target=ZEBRA&active_only=true`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          setCustomForms(formsRes.data || []);
        } catch (fErr) {}
      } catch (e) {
        // Ignora errori di rete silenziosi sulla home
      }
    };
    fetchCounts();
  }, [canInbound, canPicking]);

  // Se l'operatore spara direttamente un codice dalla Home, apriamo il modulo corrispondente se ha il permesso
  useBarcodeScanner((barcode) => {
    const code = (barcode || '').trim().toUpperCase();
    if (!code) return;
    if (code.startsWith('PAL-') && canHandling) {
      navigate('/zebra/handling', { state: { initialBarcode: code } });
    } else if (code.startsWith('IN-') && canInbound) {
      navigate('/zebra/inbound');
    } else if (code.startsWith('OUT-') && canPicking) {
      navigate('/zebra/outbound');
    }
  });

  return (
    <div className="flex-1 p-5 flex flex-col justify-between overflow-y-auto w-full max-w-md mx-auto">
      <div>
        <div className="mb-5 mt-1 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border border-slate-800 rounded-3xl p-4 shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[11px] font-black uppercase tracking-widest text-brand-blue">Terminale Operativo</span>
              <h2 className="text-2xl font-black text-brand-white tracking-tight mt-0.5">Cosa devi fare?</h2>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-brand-blue/10 border border-brand-blue/20 flex items-center justify-center text-brand-blue">
              <Scan size={26} />
            </div>
          </div>
          <p className="text-slate-400 text-xs font-medium mt-2">
            Tocca un&apos;operazione oppure spara direttamente una paletta <span className="font-mono text-brand-blue font-bold">PAL-...</span> per stivarla o spostarla.
          </p>
        </div>

        {/* Calcolo form predefinito di arrivo e form extra */}
        {(() => {
          const defaultArrivalForm = customForms.find(f => f.is_default) || customForms.find(f => f.code === 'ARRIVO_MERCE') || customForms[0];
          const homeExtraForms = customForms.filter(f => f.display_mode === 'SHOW_ON_HOME' && f.code !== defaultArrivalForm?.code && f.code !== 'ARRIVO_MERCE');
          const DefaultIcon = iconComponentMap[defaultArrivalForm?.icon] || Truck;

          return (
            <div className="flex flex-col gap-4">
              {/* Form Principale Arrivo Merce */}
              <TouchCard 
                icon={DefaultIcon} 
                label={defaultArrivalForm ? defaultArrivalForm.title.toUpperCase() : "ARRIVO MERCE"} 
                subtitle={defaultArrivalForm?.description || "Check-in camion/container, sigillo e temperatura"}
                accent={defaultArrivalForm?.color_accent || "cyan"}
                onClick={() => navigate(defaultArrivalForm ? `/zebra/checkin/${defaultArrivalForm.code}` : '/zebra/checkin')} 
              />

              {/* Eventuali altri Moduli personalizzati impostati su SHOW_ON_HOME */}
              {homeExtraForms.map(f => {
                const IconComp = iconComponentMap[f.icon] || ClipboardList;
                return (
                  <TouchCard
                    key={f.id}
                    icon={IconComp}
                    label={f.title.toUpperCase()}
                    subtitle={f.description || "Modulo operativo guidato"}
                    accent={f.color_accent || "blue"}
                    onClick={() => navigate(`/zebra/checkin/${f.code}`)}
                  />
                );
              })}

              {/* Se ci sono più moduli disponibili, mostra TouchCard per aprirli tutti */}
              {customForms.length > 1 && (
                <TouchCard
                  icon={ClipboardList}
                  label="TUTTI I MODULI & CHECK-IN"
                  subtitle="Sfoglia e compila tutti i moduli personalizzati attivi"
                  badge={customForms.length}
                  accent="purple"
                  onClick={() => setShowFormsModal(true)}
                />
              )}

              <TouchCard 
                icon={Download} 
                label="SPUNTA ENTRATA" 
                subtitle="Controlla DDT in arrivo e genera bancali"
                badge={counts.inboundPending}
                accent="blue"
                disabled={!canInbound}
                onClick={() => canInbound && navigate('/zebra/inbound')} 
              />
              <TouchCard 
                icon={ArrowRightLeft} 
                label="HANDLING (Spostamento)" 
                subtitle="Stiva nuove palette, sposta o unisci sugli scaffali"
                accent="amber"
                disabled={!canHandling}
                onClick={() => canHandling && navigate('/zebra/handling')} 
              />
              <TouchCard 
                icon={PackageMinus} 
                label="PICKING (Prelievo)" 
                subtitle="Preleva bancali e scatole per le spedizioni"
                badge={counts.outboundActive}
                accent="emerald"
                disabled={!canPicking}
                onClick={() => canPicking && navigate('/zebra/outbound')} 
              />
            </div>
          );
        })()}

        {/* Modal Tattile a Schermo Intero per Scelta Modulo su Zebra */}
        {showFormsModal && (
          <div className="fixed inset-0 z-50 bg-brand-black/95 backdrop-blur-md flex flex-col p-4 animate-fade-in-up">
            <div className="flex justify-between items-center pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <ClipboardList size={24} className="text-brand-blue" />
                <div>
                  <h2 className="text-lg font-black text-brand-white leading-tight">Moduli & Check-in Disponibili</h2>
                  <p className="text-[11px] text-slate-400">Tocca un modulo per avviarne la compilazione</p>
                </div>
              </div>
              <button 
                onClick={() => setShowFormsModal(false)}
                className="p-2.5 rounded-2xl bg-slate-900 border border-slate-800 text-slate-400 active:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-3">
              {customForms.map(f => {
                const IconComp = iconComponentMap[f.icon] || ClipboardList;
                return (
                  <button
                    key={f.id}
                    onClick={() => {
                      setShowFormsModal(false);
                      navigate(`/zebra/checkin/${f.code}`);
                    }}
                    className="w-full p-4 rounded-3xl bg-slate-900/95 border-2 border-slate-800 active:border-brand-blue text-left flex items-center justify-between gap-3 shadow-xl active:scale-[0.98] transition-all"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-14 h-14 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-center text-brand-blue shrink-0">
                        <IconComp size={28} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-black text-base text-brand-white block truncate">{f.title}</span>
                          {f.is_default && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                              Predefinito
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-slate-400 block truncate mt-0.5">{f.description || 'Modulo operativo guidato'}</span>
                      </div>
                    </div>
                    <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 shrink-0">
                      <ChevronRight size={18} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 pt-3 border-t border-slate-900 text-center">
        <p className="text-[11px] text-slate-500 font-semibold">
          Suggerimento: clicca il logo in alto per tornare sempre alla Home
        </p>
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

const ZebraApp = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('maglite_user') || '{}'); } catch { return {}; }
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
    const socket = io(`http://${window.location.hostname}:3000`);
    socket.on('permissions_updated', () => {
      refreshUserProfile().then(u => {
        if (u) setUser(u);
      });
    });
    return () => {
      window.removeEventListener('maglite_permissions_updated', sync);
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!canAccessZebra(user)) {
      navigate(canAccessDesktop(user) ? '/desktop' : '/', { replace: true });
    }
  }, [user, navigate]);

  return (
    <div className="min-h-screen bg-brand-black flex flex-col font-sans text-brand-white antialiased selection:bg-brand-blue selection:text-brand-black">
      <TopBar user={user} />
      
      <Routes>
        <Route path="/" element={<Dashboard user={user} />} />
        <Route path="/checkin" element={<ZebraCheckinWizard />} />
        <Route path="/checkin/:formCode" element={<ZebraCheckinWizard />} />
        <Route path="/form/:formCode" element={<ZebraCheckinWizard />} />
        <Route path="/arrival" element={<ZebraCheckinWizard />} />
        <Route
          path="/inbound"
          element={hasPerm('inbound_create', user) ? <InboundZebra /> : <Navigate to="/zebra" replace />}
        />
        <Route path="/stow" element={<Navigate to="/zebra/handling" replace />} />
        <Route
          path="/handling"
          element={hasPerm('pallet_move', user) ? <Handling /> : <Navigate to="/zebra" replace />}
        />
        <Route
          path="/outbound"
          element={hasPerm('outbound_pick', user) ? <OutboundZebra /> : <Navigate to="/zebra" replace />}
        />
        <Route path="/out-stock" element={<ZebraOperationPage title="Picking" />} />
      </Routes>
    </div>
  );
};

export default ZebraApp;
