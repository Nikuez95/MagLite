import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Lock, Unlock, Wrench, ShieldOff, ArrowLeft, Loader2, Eye } from 'lucide-react';
import axios from 'axios';
import { io } from 'socket.io-client';

// Centralizzazione API URL di base
export const API_BASE_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3000`;
axios.defaults.baseURL = API_BASE_URL;

// Core & Mobile Pages (lazy-loaded per mantenere il bundle iniziale snello)
const ModeSelection = lazy(() => import('./pages/ModeSelection'));
const ZebraApp = lazy(() => import('./zebra/ZebraApp'));
const Login = lazy(() => import('./pages/Login'));
const ForcePasswordChange = lazy(() => import('./pages/ForcePasswordChange'));

// Desktop Pages (Code-splitting tramite React.lazy per alleggerire il bundle iniziale di Zebra)
const DesktopLayout = lazy(() => import('./pages/desktop/DesktopLayout'));
const UsersManagement = lazy(() => import('./pages/desktop/Users'));
const Customers = lazy(() => import('./pages/desktop/Customers'));
const Products = lazy(() => import('./pages/desktop/Products'));
const ProductCategories = lazy(() => import('./pages/desktop/ProductCategories'));
const Inbound = lazy(() => import('./pages/desktop/Inbound'));
const CustomFormsManager = lazy(() => import('./pages/desktop/CustomFormsManager'));
const InboundDDTs = lazy(() => import('./pages/desktop/InboundDDTs'));
const Outbound = lazy(() => import('./pages/desktop/Outbound'));
const OutboundHistory = lazy(() => import('./pages/desktop/OutboundHistory'));
const OutboundReturns = lazy(() => import('./pages/desktop/OutboundReturns'));
const Quarantine = lazy(() => import('./pages/desktop/Quarantine'));
const NonConformities = lazy(() => import('./pages/desktop/NonConformities'));
const Inventory = lazy(() => import('./pages/desktop/Inventory'));
const Locations = lazy(() => import('./pages/desktop/Locations'));
const WarehouseSigns = lazy(() => import('./pages/desktop/WarehouseSigns'));
const ContainerSimulator = lazy(() => import('./pages/desktop/ContainerSimulator'));
const ClientTariffManager = lazy(() => import('./pages/desktop/ClientTariffManager'));
const Settings = lazy(() => import('./pages/desktop/Settings'));
const RoutingManager = lazy(() => import('./pages/desktop/RoutingManager'));
const BillingRulesManager = lazy(() => import('./pages/desktop/BillingRulesManager'));
const BillingAuditLogs = lazy(() => import('./pages/desktop/BillingAuditLogs'));
const PreBillingDashboard = lazy(() => import('./pages/desktop/PreBillingDashboard'));
const FinancesDashboard = lazy(() => import('./pages/desktop/FinancesDashboard'));
const TMSDashboard = lazy(() => import('./pages/desktop/TMSDashboard'));
const InvoicesHistory = lazy(() => import('./pages/desktop/InvoicesHistory'));
const ExpensesManager = lazy(() => import('./pages/desktop/ExpensesManager'));
const Dashboard = lazy(() => import('./pages/desktop/Dashboard'));
const AuditLogs = lazy(() => import('./pages/desktop/AuditLogs'));
const Tickets = lazy(() => import('./pages/desktop/Tickets'));
const Changelogs = lazy(() => import('./pages/desktop/Changelogs'));
const ChangelogPopupModal = lazy(() => import('./components/ChangelogPopupModal'));

const ChangelogPopupHost = ({ token, isDesktopAllowed }) => {
  const navigate = useNavigate();
  if (!token) return null;
  return (
    <Suspense fallback={null}>
      <ChangelogPopupModal
        token={token}
        onOpenChannel={isDesktopAllowed ? () => navigate('/desktop/changelogs') : null}
      />
    </Suspense>
  );
};

const DesktopShellFallback = () => (
  <div className="min-h-screen bg-brand-black flex flex-col items-center justify-center text-slate-400 gap-3">
    <div className="w-10 h-10 border-4 border-brand-blue border-t-transparent rounded-full animate-spin"></div>
    <div className="text-xs font-black uppercase tracking-wider text-slate-300">Caricamento Gestionale Desktop...</div>
  </div>
);
import {
  canAccessDesktop,
  canAccessZebra,
  hasPerm,
  getFirstAllowedDesktopRoute,
  refreshUserProfile,
  isSoftwareEngineer,
  getSectionKeyForPath
} from './utils/permissions';
import { applyTheme, getUserTheme, THEME_DARK } from './utils/theme';

const SectionLockedView = ({ sectionName, lockInfo, user, sectionKey, sectionLocks, onUnlockSection, onBypassOnce }) => {
  const navigate = useNavigate();
  const isMaintenance = lockInfo?.reason !== 'INVALID_LICENSE';
  const fallbackRoute = getFirstAllowedDesktopRoute(user);
  const canUnlock = isSoftwareEngineer(user);

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4 sm:p-6">
      <div className={`max-w-xl w-full bg-slate-900/95 border rounded-3xl p-6 sm:p-8 text-center shadow-2xl backdrop-blur-xl ${
        isMaintenance ? 'border-amber-500/40' : 'border-rose-500/40'
      }`}>
        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 border shadow-inner ${
          isMaintenance
            ? 'bg-amber-500/15 border-amber-500/35 text-amber-400'
            : 'bg-rose-500/15 border-rose-500/35 text-rose-400'
        }`}>
          {isMaintenance ? <Wrench size={32} /> : <ShieldOff size={32} />}
        </div>

        <span className={`inline-block px-3.5 py-1 rounded-full text-[11px] font-black uppercase tracking-widest mb-3 border ${
          isMaintenance
            ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
            : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
        }`}>
          {isMaintenance ? 'Sezione Bloccata • Manutenzione' : 'Sezione Bloccata • Licenza'}
        </span>

        <h2 className="text-2xl sm:text-3xl font-black text-brand-white mb-2">
          {isMaintenance ? 'Sezione in manutenzione' : 'Licenza non valida per questa sezione'}
        </h2>

        {sectionName && (
          <p className="text-sm font-bold text-slate-300 mb-2">
            Modulo: <span className="text-brand-blue">{sectionName}</span>
          </p>
        )}

        <p className="text-sm text-slate-400 leading-relaxed mb-5">
          {isMaintenance
            ? 'Questa sezione del gestionale è temporaneamente sospesa per interventi tecnici di manutenzione.'
            : 'La licenza attiva per questo modulo non risulta valida o è scaduta. Contatta il reparto tecnico o l\'amministratore di sistema.'}
        </p>

        {lockInfo?.note && (
          <div className="mb-6 p-3.5 rounded-2xl bg-slate-950/90 border border-slate-800 text-xs text-slate-300 text-left">
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Dettaglio / Nota Tecnica</div>
            <div className="whitespace-pre-wrap">{lockInfo.note}</div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row flex-wrap items-center justify-center gap-3">
          {fallbackRoute && !sectionLocks?.[getSectionKeyForPath(fallbackRoute)] && (
            <button
              type="button"
              onClick={() => navigate(fallbackRoute, { replace: true })}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl text-sm transition-all border border-slate-700"
            >
              <ArrowLeft size={16} />
              Torna al Gestionale
            </button>
          )}

          {canUnlock && (
            <>
              <button
                type="button"
                onClick={() => onUnlockSection?.(sectionKey)}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-black rounded-xl text-sm transition-all shadow-lg"
              >
                <Unlock size={16} />
                Sblocca Sezione per Tutti
              </button>
              <button
                type="button"
                onClick={() => onBypassOnce?.(sectionKey)}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-blue/15 hover:bg-brand-blue text-brand-blue hover:text-brand-black border border-brand-blue/40 font-bold rounded-xl text-xs transition-all"
              >
                <Eye size={15} />
                Entra come Software Engineer
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const AccessDeniedView = ({ sectionName, user }) => {
  const navigate = useNavigate();
  const fallbackRoute = getFirstAllowedDesktopRoute(user);

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6">
      <div className="max-w-lg w-full bg-slate-900/90 border border-rose-500/30 rounded-3xl p-8 text-center shadow-2xl backdrop-blur-xl">
        <div className="w-16 h-16 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center mx-auto mb-5 text-rose-400 shadow-inner">
          <Lock size={32} />
        </div>
        <span className="inline-block px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400 text-[11px] font-black uppercase tracking-widest mb-3">
          Permesso Mancante
        </span>
        <h2 className="text-2xl font-black text-brand-white mb-2">
          Accesso Negato{sectionName ? `: ${sectionName}` : ''}
        </h2>
        <p className="text-sm text-slate-400 leading-relaxed mb-6">
          Il tuo ruolo o profilo utente non dispone dei permessi necessari per visualizzare o interagire con questa sezione.
        </p>
        {fallbackRoute && (
          <button
            type="button"
            onClick={() => navigate(fallbackRoute, { replace: true })}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-blue hover:bg-sky-400 text-brand-black font-black rounded-xl text-sm transition-all shadow-lg"
          >
            <ArrowLeft size={16} />
            Torna a una sezione autorizzata
          </button>
        )}
      </div>
    </div>
  );
};

const ProtectedSection = ({
  perm,
  sectionName,
  user,
  isIndex = false,
  sectionLocks = {},
  bypassedSections = {},
  onUnlockSection,
  onBypassSection,
  children
}) => {
  const location = useLocation();
  if (perm && !hasPerm(perm, user)) {
    if (isIndex) {
      const firstAllowed = getFirstAllowedDesktopRoute(user);
      if (firstAllowed && firstAllowed !== '/desktop') {
        return <Navigate to={firstAllowed} replace />;
      }
    }
    return <AccessDeniedView sectionName={sectionName} user={user} />;
  }

  const sectionKey = getSectionKeyForPath(location.pathname);
  const lockInfo = sectionKey ? sectionLocks?.[sectionKey] : null;
  if (lockInfo && !(isSoftwareEngineer(user) && bypassedSections?.[sectionKey])) {
    return (
      <SectionLockedView
        sectionName={sectionName}
        lockInfo={lockInfo}
        user={user}
        sectionKey={sectionKey}
        sectionLocks={sectionLocks}
        onUnlockSection={onUnlockSection}
        onBypassOnce={onBypassSection}
      />
    );
  }

  return children;
};

function App() {
  const [token, setToken] = useState(localStorage.getItem('maglite_token'));
  const [userState, setUserState] = useState(() => {
    try { return JSON.parse(localStorage.getItem('maglite_user') || '{}'); } catch { return {}; }
  });

  const user = userState;
  const [needsPasswordChange, setNeedsPasswordChange] = useState(token && user.requires_password_change);
  const [sectionLocks, setSectionLocks] = useState({});
  const [bypassedSections, setBypassedSections] = useState({});

  const isDesktopAllowed = Boolean(token && canAccessDesktop(user));
  const isZebraAllowed = Boolean(token && canAccessZebra(user));

  const fetchSectionLocks = async (tok) => {
    if (!tok) return;
    try {
      const res = await axios.get('/api/settings/section-locks', {
        headers: { Authorization: `Bearer ${tok}` }
      });
      setSectionLocks(res.data || {});
    } catch (_) {}
  };

  useEffect(() => {
    if (!token) {
      setSectionLocks({});
      return;
    }
    fetchSectionLocks(token);
    const socket = io(API_BASE_URL);
    const onLocksUpdated = (nextLocks) => {
      if (nextLocks && typeof nextLocks === 'object') {
        setSectionLocks(nextLocks);
      } else {
        fetchSectionLocks(token);
      }
    };
    const onWindowSync = (e) => {
      if (e?.detail && typeof e.detail === 'object') setSectionLocks(e.detail);
      else fetchSectionLocks(token);
    };
    socket.on('section_locks_updated', onLocksUpdated);
    window.addEventListener('maglite_section_locks_updated', onWindowSync);
    return () => {
      socket.off('section_locks_updated', onLocksUpdated);
      window.removeEventListener('maglite_section_locks_updated', onWindowSync);
      socket.disconnect();
    };
  }, [token]);

  const handleUnlockSection = async (secKey) => {
    if (!secKey || !token) return;
    try {
      const next = { ...sectionLocks };
      delete next[secKey];
      const res = await axios.put('/api/settings/section-locks', { locks: next }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const updated = res.data?.locks || next;
      setSectionLocks(updated);
      window.dispatchEvent(new CustomEvent('maglite_section_locks_updated', { detail: updated }));
    } catch (err) {
      console.error(err);
    }
  };

  const handleBypassSection = (secKey) => {
    if (!secKey) return;
    setBypassedSections(prev => ({ ...prev, [secKey]: true }));
  };

  const guardProps = {
    user,
    sectionLocks,
    bypassedSections,
    onUnlockSection: handleUnlockSection,
    onBypassSection: handleBypassSection
  };

  useEffect(() => {
    const syncUser = () => {
      try {
        const u = JSON.parse(localStorage.getItem('maglite_user') || '{}');
        setUserState(u);
        setNeedsPasswordChange(Boolean(token && u.requires_password_change));
        if (token) {
          applyTheme(getUserTheme(u));
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener('maglite_permissions_updated', syncUser);
    return () => window.removeEventListener('maglite_permissions_updated', syncUser);
  }, [token]);

  useEffect(() => {
    if (token) {
      localStorage.setItem('maglite_token', token);
      const updatedUser = JSON.parse(localStorage.getItem('maglite_user') || '{}');
      setUserState(updatedUser);
      setNeedsPasswordChange(updatedUser.requires_password_change);
      applyTheme(getUserTheme(updatedUser));
      refreshUserProfile();
    } else {
      localStorage.removeItem('maglite_token');
      setNeedsPasswordChange(false);
      applyTheme(THEME_DARK);
    }
  }, [token]);

  return (
    <>
      {needsPasswordChange && (
        <Suspense fallback={<DesktopShellFallback />}>
          <ForcePasswordChange 
            setToken={setToken} 
            onComplete={() => setNeedsPasswordChange(false)} 
          />
        </Suspense>
      )}
      <Router>
        <ChangelogPopupHost token={token} isDesktopAllowed={isDesktopAllowed} />
        <Suspense fallback={<DesktopShellFallback />}>
          <Routes>
          <Route path="/login" element={<Login setToken={setToken} />} />
          
          {/* Schermata Iniziale Protetta */}
          <Route path="/" element={token ? <ModeSelection /> : <Navigate to="/login" />} />
          
          {/* Ramo Zebra / Mobile Protetto dal permesso access_zebra */}
          <Route
            path="/zebra/*"
            element={
              !token
                ? <Navigate to="/login" />
                : isZebraAllowed
                  ? <ZebraApp />
                  : <Navigate to={isDesktopAllowed ? '/desktop' : '/'} replace />
            }
          />
          
          {/* Desktop Application Protetta dal permesso access_desktop e permessi per singola rotta */}
          <Route
            path="/desktop"
            element={
              !token
                ? <Navigate to="/login" />
                : isDesktopAllowed
                  ? (
                    <Suspense fallback={<DesktopShellFallback />}>
                      <DesktopLayout />
                    </Suspense>
                  )
                  : <Navigate to={isZebraAllowed ? '/zebra' : '/'} replace />
            }
          >
            <Route
              index
              element={
                <ProtectedSection perm="view_dashboard" sectionName="Dashboard" isIndex {...guardProps}>
                  <Dashboard />
                </ProtectedSection>
              }
            />
            <Route
              path="inbound"
              element={
                <ProtectedSection perm="view_inbound" sectionName="Nuova Merce (Inbound)" {...guardProps}>
                  <Inbound />
                </ProtectedSection>
              }
            />
            <Route
              path="custom-forms"
              element={
                <ProtectedSection perm={['view_custom_forms', 'manage_custom_forms']} sectionName="Moduli Dinamici & Check-in" {...guardProps}>
                  <CustomFormsManager />
                </ProtectedSection>
              }
            />
            <Route
              path="documents"
              element={
                <ProtectedSection perm="view_documents" sectionName="DDT Entrata (Spunta)" {...guardProps}>
                  <InboundDDTs />
                </ProtectedSection>
              }
            />
            <Route
              path="outbound"
              element={
                <ProtectedSection perm="view_outbound" sectionName="Spedizioni (Outbound)" {...guardProps}>
                  <Outbound />
                </ProtectedSection>
              }
            />
            <Route
              path="outbound/history"
              element={
                <ProtectedSection perm="view_outbound" sectionName="Storico Uscite" {...guardProps}>
                  <OutboundHistory />
                </ProtectedSection>
              }
            />
            <Route
              path="outbound/returns"
              element={
                <ProtectedSection perm={['view_outbound', 'outbound_return']} sectionName="Storico Resi" {...guardProps}>
                  <OutboundReturns />
                </ProtectedSection>
              }
            />
            <Route
              path="quarantine"
              element={
                <ProtectedSection perm="view_quarantine" sectionName="Quarantena & Qualità" {...guardProps}>
                  <Quarantine />
                </ProtectedSection>
              }
            />
            <Route
              path="non-conformities"
              element={
                <ProtectedSection perm={['view_non_conformities', 'non_conformities_manage', 'access_desktop']} sectionName="Non Conformità" {...guardProps}>
                  <NonConformities />
                </ProtectedSection>
              }
            />
            <Route
              path="inventory"
              element={
                <ProtectedSection perm="view_inventory" sectionName="Inventario Globale" {...guardProps}>
                  <Inventory />
                </ProtectedSection>
              }
            />
            <Route
              path="customers"
              element={
                <ProtectedSection perm="view_customers" sectionName="Anagrafica Clienti" {...guardProps}>
                  <Customers />
                </ProtectedSection>
              }
            />
            <Route
              path="products"
              element={
                <ProtectedSection perm="view_products" sectionName="Prodotti & Stock" {...guardProps}>
                  <Products />
                </ProtectedSection>
              }
            />
            <Route
              path="product-categories"
              element={
                <ProtectedSection perm={['view_product_categories', 'product_categories_manage']} sectionName="Categorie Prodotti" {...guardProps}>
                  <ProductCategories />
                </ProtectedSection>
              }
            />
            <Route
              path="locations"
              element={
                <ProtectedSection perm="view_locations" sectionName="Mappa Magazzino" {...guardProps}>
                  <Locations />
                </ProtectedSection>
              }
            />
            <Route
              path="warehouse-signs"
              element={
                <ProtectedSection perm="view_warehouse_signs" sectionName="Cartelli Magazzino" {...guardProps}>
                  <WarehouseSigns />
                </ProtectedSection>
              }
            />
            <Route
              path="container-simulator"
              element={
                <ProtectedSection perm={['view_outbound', 'tms_manage', 'view_tms', 'view_locations']} sectionName="Simulatore Container" {...guardProps}>
                  <ContainerSimulator />
                </ProtectedSection>
              }
            />
            <Route
              path="billing-tariffs"
              element={
                <ProtectedSection perm={['view_billing', 'finance_manage', 'tariff_plans_manage', 'client_tariffs_manage']} sectionName="Tariffe Clienti" {...guardProps}>
                  <ClientTariffManager />
                </ProtectedSection>
              }
            />
            <Route
              path="billing-dashboard"
              element={
                <ProtectedSection perm={['view_billing', 'finance_manage']} sectionName="Pre-Fatturazione" {...guardProps}>
                  <PreBillingDashboard />
                </ProtectedSection>
              }
            />
            <Route
              path="billing-rules"
              element={
                <ProtectedSection perm={['view_billing', 'finance_manage', 'tariff_plans_manage']} sectionName="Regole Base Fatturazione" {...guardProps}>
                  <BillingRulesManager />
                </ProtectedSection>
              }
            />
            <Route
              path="billing-audit"
              element={
                <ProtectedSection perm={['view_billing', 'finance_manage', 'view_finances']} sectionName="Storico Fatturazioni" {...guardProps}>
                  <BillingAuditLogs />
                </ProtectedSection>
              }
            />
            <Route
              path="finances"
              element={
                <ProtectedSection perm={['view_finances', 'finance_manage']} sectionName="Dashboard Finanza" {...guardProps}>
                  <FinancesDashboard />
                </ProtectedSection>
              }
            />
            <Route
              path="invoices-history"
              element={
                <ProtectedSection perm={['view_finances', 'finance_manage', 'view_billing']} sectionName="Archivio Proforme" {...guardProps}>
                  <InvoicesHistory />
                </ProtectedSection>
              }
            />
            <Route
              path="expenses"
              element={
                <ProtectedSection perm={['view_finances', 'finance_manage']} sectionName="Gestione Uscite" {...guardProps}>
                  <ExpensesManager />
                </ProtectedSection>
              }
            />
            <Route
              path="tms"
              element={
                <ProtectedSection perm={['view_tms', 'tms_manage']} sectionName="TMS (Trasporti)" {...guardProps}>
                  <TMSDashboard />
                </ProtectedSection>
              }
            />
            <Route
              path="settings"
              element={
                <ProtectedSection perm={['view_settings', 'settings_manage']} sectionName="Impostazioni Aziendali" {...guardProps}>
                  <Settings />
                </ProtectedSection>
              }
            />
            <Route
              path="settings/routing"
              element={
                <ProtectedSection perm={['view_settings', 'settings_manage', 'pallet_move']} sectionName="Regole di Prelievo" {...guardProps}>
                  <RoutingManager />
                </ProtectedSection>
              }
            />
            <Route
              path="users"
              element={
                <ProtectedSection perm={['view_users', 'users_manage']} sectionName="Utenti & Ruoli (Team)" {...guardProps}>
                  <UsersManagement />
                </ProtectedSection>
              }
            />
            <Route
              path="audit"
              element={
                <ProtectedSection perm="view_audit" sectionName="Audit Logs" {...guardProps}>
                  <AuditLogs />
                </ProtectedSection>
              }
            />
            <Route
              path="tickets"
              element={
                <ProtectedSection perm={null} sectionName="Supporto & Ticket" {...guardProps}>
                  <Tickets />
                </ProtectedSection>
              }
            />
            <Route
              path="changelogs"
              element={
                <ProtectedSection perm={null} sectionName="Changelog & Novità" {...guardProps}>
                  <Changelogs />
                </ProtectedSection>
              }
            />
          </Route>
        </Routes>
        </Suspense>
      </Router>
    </>
  );
}

export default App;
