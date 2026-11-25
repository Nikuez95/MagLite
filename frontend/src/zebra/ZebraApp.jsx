import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { io } from 'socket.io-client';
import { ArrowRightLeft, PackageMinus, LogOut, Scan, Download, ChevronRight, User, Radio, Monitor, Lock, Truck, ClipboardList, Box, Thermometer, ShieldAlert, Sparkles, X, Layers, FileText, AlertTriangle, Warehouse, MapPin, Sun, Moon } from 'lucide-react';
import useBarcodeScanner from '../hooks/useBarcodeScanner';
import { hasPerm, canAccessZebra, canAccessDesktop, refreshUserProfile } from '../utils/permissions';
import { useZebraWorkspace, getZebraWorkspace, saveZebraWorkspace } from '../utils/zebraWorkspace';
import { useTheme, getLogoSrc } from '../utils/theme';

const InboundZebra = lazy(() => import('./InboundZebra'));
const OutboundZebra = lazy(() => import('./OutboundZebra'));
const Handling = lazy(() => import('./Handling'));
const ZebraCheckinWizard = lazy(() => import('./ZebraCheckinWizard'));
const ZebraLoadVehicleWizard = lazy(() => import('./ZebraLoadVehicleWizard'));
const OptimizationZebra = lazy(() => import('./OptimizationZebra'));
const VerifyBarcodeZebra = lazy(() => import('./VerifyBarcodeZebra'));
const NonConformityZebra = lazy(() => import('./NonConformityZebra'));

const ZebraModuleFallback = () => (
  <div className="flex-1 flex flex-col items-center justify-center p-8 text-slate-400 gap-3">
    <div className="w-9 h-9 border-4 border-brand-blue border-t-transparent rounded-full animate-spin" />
    <span className="text-xs font-black uppercase tracking-wider">Caricamento modulo Zebra...</span>
  </div>
);

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

const TopBar = ({ user, workspace, onOpenWorkspacePicker }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, isLight, toggleTheme } = useTheme();
  const isHome = location.pathname === '/zebra' || location.pathname === '/zebra/';
  const allowDesktop = canAccessDesktop(user);

  return (
    <header className="bg-brand-black/95 backdrop-blur border-b border-slate-800 px-3 sm:px-4 py-3 flex justify-between items-center sticky top-0 z-20 shadow-lg gap-2">
      <div 
        className={`flex items-center gap-2.5 min-w-0 ${!isHome ? 'cursor-pointer active:scale-95 transition-transform' : ''}`} 
        onClick={() => !isHome && navigate('/zebra')}
      >
        <div className="h-9 w-11 flex items-center justify-center shrink-0">
          <img src={getLogoSrc(theme)} alt="Logistic Porcelli Logo" className="max-w-full max-h-full object-contain drop-shadow-[0_0_15px_rgba(169,218,255,0.4)]" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 className="text-brand-white font-black text-base leading-tight tracking-tight">MagLite</h1>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[9px] font-black uppercase shrink-0">
              <Radio size={9} className="animate-pulse" /> Zebra
            </span>
          </div>
          <p className="text-slate-400 text-[11px] font-bold flex items-center gap-1 mt-0.5 truncate">
            <User size={10} className="text-brand-blue shrink-0" />
            <span className="truncate">{user.username || 'Operatore'}</span>
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onOpenWorkspacePicker}
          className="px-2.5 py-1.5 rounded-xl bg-sky-500/15 border border-sky-500/40 text-sky-300 active:scale-95 text-[11px] font-black flex items-center gap-1 max-w-[140px]"
          title="Cambia Magazzino / Capannone"
        >
          <MapPin size={12} className="shrink-0 text-sky-400" />
          <span className="truncate">
            {workspace?.warehouseName || 'Scegli Sede'}
            {workspace?.divisionName ? ` · ${workspace.divisionName}` : ''}
          </span>
        </button>
        {allowDesktop && isHome && (
          <button
            onClick={() => navigate('/desktop')}
            className="px-2.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-black uppercase text-slate-300 hover:text-brand-white flex items-center gap-1"
            title="Passa al Gestionale Desktop"
          >
            <Monitor size={14} className="text-brand-blue" />
            PC
          </button>
        )}
        {!isHome && (
          <button
            onClick={() => navigate('/zebra')}
            className="px-2.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-black uppercase text-brand-blue active:bg-slate-800"
          >
            Home
          </button>
        )}
        <button
          type="button"
          onClick={toggleTheme}
          title={isLight ? 'Modalità Chiara — Passa a Scura' : 'Modalità Scura — Passa a Chiara'}
          className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 active:bg-slate-800 transition-colors"
        >
          {isLight ? <Moon size={16} className="text-brand-blue" /> : <Sun size={16} className="text-amber-400" />}
        </button>
        <button 
          onClick={() => {
            localStorage.removeItem('maglite_token');
            localStorage.removeItem('maglite_user');
            window.location.href = '/login';
          }}
          className="p-2.5 rounded-2xl bg-slate-900 border border-slate-800 text-rose-400 active:bg-slate-800 transition-colors"
          title="Esci"
        >
          <LogOut size={18} />
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

const Dashboard = ({ user, workspace }) => {
  const navigate = useNavigate();
  const [counts, setCounts] = useState({ inboundPending: 0, outboundActive: 0, outboundReady: 0, optimizeTasks: 0 });
  const [customForms, setCustomForms] = useState([]);
  const [showFormsModal, setShowFormsModal] = useState(false);

  const canInbound = hasPerm('inbound_create', user);
  const canHandling = hasPerm('pallet_move', user);
  const canPicking = hasPerm('outbound_pick', user);
  const canOptimize = hasPerm('zebra_optimize', user);
  const canVerify = hasPerm('zebra_verify', user);

  useEffect(() => {
    const token = localStorage.getItem('maglite_token');
    if (!token) return;
    const whQ = workspace?.warehouseId ? `?warehouse_id=${workspace.warehouseId}` : '';
    const fetchCounts = async () => {
      try {
        const reqs = [
          canInbound
            ? axios.get(`http://${window.location.hostname}:3000/api/inbound/ddt?active_only=true`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => ({ data: [] }))
            : Promise.resolve({ data: [] }),
          canPicking
            ? axios.get(`http://${window.location.hostname}:3000/api/outbound?active_only=true`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => ({ data: [] }))
            : Promise.resolve({ data: [] }),
          canPicking
            ? axios.get(`http://${window.location.hostname}:3000/api/outbound?ready_only=true`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => ({ data: [] }))
            : Promise.resolve({ data: [] }),
          canOptimize
            ? axios.get(`http://${window.location.hostname}:3000/api/pallets/optimization/tasks${whQ}`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => ({ data: { summary: { totalTasks: 0 } } }))
            : Promise.resolve({ data: { summary: { totalTasks: 0 } } })
        ];
        const [inRes, outRes, readyRes, optRes] = await Promise.all(reqs);
        const inboundPending = (inRes.data || []).filter(d => d.status === 'PENDING' || d.status === 'IN_PROGRESS').length;
        const outboundActive = (outRes.data || []).filter(o => o.status === 'PENDING' || o.status === 'PICKING' || o.status === 'PARTIAL').length;
        const outboundReady = (readyRes.data || []).length;
        const optimizeTasks = optRes.data?.summary?.totalTasks || 0;
        setCounts({ inboundPending, outboundActive, outboundReady, optimizeTasks });

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
  }, [canInbound, canPicking, canOptimize, workspace?.warehouseId]);

  // Se l'operatore spara direttamente un codice dalla Home, apriamo il modulo corrispondente se ha il permesso
  useBarcodeScanner((barcode) => {
    const code = (barcode || '').trim().toUpperCase();
    if (!code) return;
    if (code.startsWith('PAL-') && canHandling) {
      navigate('/zebra/handling', { state: { initialBarcode: code } });
    } else if (code.startsWith('PAL-') && canVerify) {
      navigate('/zebra/verify');
    } else if (code.startsWith('IN-') && canInbound) {
      navigate('/zebra/inbound');
    } else if ((code.startsWith('OUT-') || code.startsWith('BOL-')) && canPicking) {
      navigate('/zebra/outbound', { state: { initialCode: code } });
    }
  });

  return (
    <div className="flex-1 p-5 flex flex-col justify-between overflow-y-auto w-full max-w-md mx-auto">
      <div>

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
                onClick={() => canPicking && navigate('/zebra/outbound', { state: { defaultTab: 'PICKING' } })} 
              />
              <TouchCard
                icon={FileText}
                label="BOLLA & CARICO CAMION"
                subtitle="Scansiona bolla di uscita, ricontrolla e segna Spedito"
                badge={counts.outboundReady}
                accent="cyan"
                disabled={!canPicking}
                onClick={() => canPicking && navigate('/zebra/outbound', { state: { defaultTab: 'READY' } })}
              />

              {canOptimize && (
                <TouchCard
                  icon={Sparkles}
                  label="TASK OTTIMIZZAZIONE"
                  subtitle="Riordino frequenze ABC, unione lotti e accorpamento scatole"
                  badge={counts.optimizeTasks}
                  accent="purple"
                  onClick={() => navigate('/zebra/optimize')}
                />
              )}

              {canVerify && (
                <TouchCard
                  icon={Scan}
                  label="VERIFICA BARCODE"
                  subtitle="Controlla prodotto, scatole, posizione ottimale e discrepanze"
                  accent="cyan"
                  onClick={() => navigate('/zebra/verify')}
                />
              )}

              <TouchCard
                icon={AlertTriangle}
                label="SEGNALA NON CONFORMITÀ"
                subtitle="Scansiona paletta, vedi contenuto e segnala anomalie al gestionale"
                accent="rose"
                onClick={() => navigate('/zebra/non-conformity')}
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
  const workspace = useZebraWorkspace();
  const [warehouses, setWarehouses] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(() => !Boolean(getZebraWorkspace()?.warehouseId));
  const [pickerStepWh, setPickerStepWh] = useState(null);
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('maglite_user') || '{}'); } catch { return {}; }
  });

  const fetchWarehouses = async () => {
    const token = localStorage.getItem('maglite_token');
    if (!token) return;
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/warehouses`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const list = res.data || [];
      setWarehouses(list);
      if (!workspace?.warehouseId) {
        setPickerOpen(true);
      }
    } catch (_) {}
  };

  useEffect(() => {
    fetchWarehouses();
  }, []);

  useEffect(() => {
    if (!workspace?.warehouseId) {
      setPickerOpen(true);
    }
  }, [workspace?.warehouseId]);

  const chooseWarehouse = (wh) => {
    if (wh.divisions && wh.divisions.length > 0) {
      setPickerStepWh(wh);
    } else {
      saveZebraWorkspace({ warehouseId: wh.id, warehouseName: wh.name, divisionId: null, divisionName: null });
      setPickerStepWh(null);
      setPickerOpen(false);
    }
  };

  const chooseDivision = (wh, div = null) => {
    saveZebraWorkspace({
      warehouseId: wh.id,
      warehouseName: wh.name,
      divisionId: div ? div.id : null,
      divisionName: div ? div.name : null
    });
    setPickerStepWh(null);
    setPickerOpen(false);
  };

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
    socket.on('warehouses_updated', fetchWarehouses);
    return () => {
      window.removeEventListener('maglite_permissions_updated', sync);
      socket.off('warehouses_updated', fetchWarehouses);
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
      <TopBar
        user={user}
        workspace={workspace}
        onOpenWorkspacePicker={() => {
          setPickerStepWh(null);
          setPickerOpen(true);
        }}
      />

      {pickerOpen && (
        <div className="fixed inset-0 z-50 bg-brand-black/95 backdrop-blur-md flex flex-col justify-center p-5 animate-fade-in-up">
          <div className="max-w-sm w-full mx-auto bg-slate-900 border-2 border-brand-blue/50 rounded-3xl p-6 space-y-5 shadow-2xl">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-brand-blue flex items-center gap-1.5">
                  <Warehouse size={13} /> Area Operativa Zebra
                </span>
                <h2 className="text-xl font-black text-white mt-1">
                  {pickerStepWh ? `Reparto in ${pickerStepWh.name}` : 'In quale Magazzino lavori?'}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {pickerStepWh
                    ? 'Scegli il capannone / zona in cui ti trovi ora.'
                    : 'Zebra filtrerà palette, scaffali e task di questo magazzino.'}
                </p>
              </div>
              {workspace?.warehouseId && (
                <button
                  type="button"
                  onClick={() => { setPickerStepWh(null); setPickerOpen(false); }}
                  className="p-2 bg-slate-800 rounded-xl text-slate-400"
                >
                  <X size={18} />
                </button>
              )}
            </div>

            {!pickerStepWh ? (
              <div className="space-y-2.5">
                {warehouses.map(wh => {
                  const isCurr = Number(workspace?.warehouseId) === Number(wh.id);
                  return (
                    <button
                      key={wh.id}
                      type="button"
                      onClick={() => chooseWarehouse(wh)}
                      className={`w-full p-4 rounded-2xl border-2 text-left flex items-center justify-between transition-all active:scale-[0.98] ${
                        isCurr
                          ? 'bg-brand-blue/15 border-brand-blue text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-200 hover:border-slate-600'
                      }`}
                    >
                      <div>
                        <div className="text-lg font-black">{wh.name}</div>
                        {wh.city && <div className="text-xs text-slate-400">{wh.city}</div>}
                        {wh.divisions?.length > 0 && (
                          <div className="text-[11px] text-violet-300 font-bold mt-1">
                            {wh.divisions.length} capannoni / reparti disponibili
                          </div>
                        )}
                      </div>
                      <ChevronRight size={22} className="text-brand-blue" />
                    </button>
                  );
                })}
                {warehouses.length === 0 && (
                  <button
                    type="button"
                    onClick={() => chooseDivision({ id: 1, name: 'Settala' }, null)}
                    className="w-full p-4 rounded-2xl bg-brand-blue text-brand-black font-black"
                  >
                    Entra in Settala (Predefinito)
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={() => chooseDivision(pickerStepWh, null)}
                  className="w-full p-3.5 rounded-2xl bg-brand-blue text-brand-black font-black text-sm flex items-center justify-between"
                >
                  <span>Tutti i Reparti di {pickerStepWh.name}</span>
                  <ChevronRight size={18} />
                </button>
                {pickerStepWh.divisions.map(d => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => chooseDivision(pickerStepWh, d)}
                    className="w-full p-3.5 rounded-2xl bg-slate-950 border-2 border-violet-500/40 text-white font-bold text-sm flex items-center justify-between active:scale-[0.98]"
                  >
                    <span>{d.name}</span>
                    <ChevronRight size={18} className="text-violet-400" />
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPickerStepWh(null)}
                  className="w-full py-2.5 text-xs font-bold text-slate-400"
                >
                  ← Cambia Magazzino
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      
      <Suspense fallback={<ZebraModuleFallback />}>
        <Routes>
          <Route path="/" element={<Dashboard user={user} workspace={workspace} />} />
          <Route path="/checkin/CARICO_USCITA" element={<ZebraLoadVehicleWizard />} />
          <Route path="/form/CARICO_USCITA" element={<ZebraLoadVehicleWizard />} />
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
          <Route
            path="/optimize"
            element={hasPerm('zebra_optimize', user) ? <OptimizationZebra /> : <Navigate to="/zebra" replace />}
          />
          <Route
            path="/verify"
            element={hasPerm('zebra_verify', user) ? <VerifyBarcodeZebra /> : <Navigate to="/zebra" replace />}
          />
          <Route path="/non-conformity" element={<NonConformityZebra />} />
          <Route path="/out-stock" element={<ZebraOperationPage title="Picking" />} />
        </Routes>
      </Suspense>
    </div>
  );
};

export default ZebraApp;
