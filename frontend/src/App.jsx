import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Lock, ArrowLeft, Loader2 } from 'lucide-react';
import axios from 'axios';

// Centralizzazione API URL di base
export const API_BASE_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3000`;
axios.defaults.baseURL = API_BASE_URL;

// Mobile / Core Pages (static imports for instant performance on Zebra guns)
import ModeSelection from './pages/ModeSelection';
import ZebraApp from './zebra/ZebraApp';
import Login from './pages/Login';
import ForcePasswordChange from './pages/ForcePasswordChange';

// Desktop Pages (Code-splitting tramite React.lazy per alleggerire il bundle iniziale di Zebra)
const DesktopLayout = lazy(() => import('./pages/desktop/DesktopLayout'));
const UsersManagement = lazy(() => import('./pages/desktop/Users'));
const Customers = lazy(() => import('./pages/desktop/Customers'));
const Products = lazy(() => import('./pages/desktop/Products'));
const Inbound = lazy(() => import('./pages/desktop/Inbound'));
const CustomFormsManager = lazy(() => import('./pages/desktop/CustomFormsManager'));
const InboundDDTs = lazy(() => import('./pages/desktop/InboundDDTs'));
const Outbound = lazy(() => import('./pages/desktop/Outbound'));
const OutboundHistory = lazy(() => import('./pages/desktop/OutboundHistory'));
const OutboundReturns = lazy(() => import('./pages/desktop/OutboundReturns'));
const Quarantine = lazy(() => import('./pages/desktop/Quarantine'));
const Inventory = lazy(() => import('./pages/desktop/Inventory'));
const Locations = lazy(() => import('./pages/desktop/Locations'));
const ClientTariffManager = lazy(() => import('./pages/desktop/ClientTariffManager'));
const Settings = lazy(() => import('./pages/desktop/Settings'));
const RoutingManager = lazy(() => import('./pages/desktop/RoutingManager'));
const BillingRulesManager = lazy(() => import('./pages/desktop/BillingRulesManager'));
const PreBillingDashboard = lazy(() => import('./pages/desktop/PreBillingDashboard'));
const FinancesDashboard = lazy(() => import('./pages/desktop/FinancesDashboard'));
const TMSDashboard = lazy(() => import('./pages/desktop/TMSDashboard'));
const InvoicesHistory = lazy(() => import('./pages/desktop/InvoicesHistory'));
const ExpensesManager = lazy(() => import('./pages/desktop/ExpensesManager'));
const Dashboard = lazy(() => import('./pages/desktop/Dashboard'));
const AuditLogs = lazy(() => import('./pages/desktop/AuditLogs'));

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
  refreshUserProfile
} from './utils/permissions';

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

const ProtectedSection = ({ perm, sectionName, user, isIndex = false, children }) => {
  if (hasPerm(perm, user)) {
    return children;
  }
  if (isIndex) {
    const firstAllowed = getFirstAllowedDesktopRoute(user);
    if (firstAllowed && firstAllowed !== '/desktop') {
      return <Navigate to={firstAllowed} replace />;
    }
  }
  return <AccessDeniedView sectionName={sectionName} user={user} />;
};

function App() {
  const [token, setToken] = useState(localStorage.getItem('maglite_token'));
  const [userState, setUserState] = useState(() => {
    try { return JSON.parse(localStorage.getItem('maglite_user') || '{}'); } catch { return {}; }
  });

  const user = userState;
  const [needsPasswordChange, setNeedsPasswordChange] = useState(token && user.requires_password_change);

  const isDesktopAllowed = Boolean(token && canAccessDesktop(user));
  const isZebraAllowed = Boolean(token && canAccessZebra(user));

  useEffect(() => {
    const syncUser = () => {
      try {
        const u = JSON.parse(localStorage.getItem('maglite_user') || '{}');
        setUserState(u);
        setNeedsPasswordChange(Boolean(token && u.requires_password_change));
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
      refreshUserProfile();
    } else {
      localStorage.removeItem('maglite_token');
      setNeedsPasswordChange(false);
    }
  }, [token]);

  return (
    <>
      {needsPasswordChange && (
        <ForcePasswordChange 
          setToken={setToken} 
          onComplete={() => setNeedsPasswordChange(false)} 
        />
      )}
      <Router>
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
                <ProtectedSection perm="view_dashboard" sectionName="Dashboard" user={user} isIndex>
                  <Dashboard />
                </ProtectedSection>
              }
            />
            <Route
              path="inbound"
              element={
                <ProtectedSection perm="view_inbound" sectionName="Nuova Merce (Inbound)" user={user}>
                  <Inbound />
                </ProtectedSection>
              }
            />
            <Route
              path="custom-forms"
              element={
                <ProtectedSection perm={['view_custom_forms', 'manage_custom_forms']} sectionName="Moduli Dinamici & Check-in" user={user}>
                  <CustomFormsManager />
                </ProtectedSection>
              }
            />
            <Route
              path="documents"
              element={
                <ProtectedSection perm="view_documents" sectionName="DDT Entrata (Spunta)" user={user}>
                  <InboundDDTs />
                </ProtectedSection>
              }
            />
            <Route
              path="outbound"
              element={
                <ProtectedSection perm="view_outbound" sectionName="Spedizioni (Outbound)" user={user}>
                  <Outbound />
                </ProtectedSection>
              }
            />
            <Route
              path="outbound/history"
              element={
                <ProtectedSection perm="view_outbound" sectionName="Storico Uscite" user={user}>
                  <OutboundHistory />
                </ProtectedSection>
              }
            />
            <Route
              path="outbound/returns"
              element={
                <ProtectedSection perm={['view_outbound', 'outbound_return']} sectionName="Storico Resi" user={user}>
                  <OutboundReturns />
                </ProtectedSection>
              }
            />
            <Route
              path="quarantine"
              element={
                <ProtectedSection perm="view_quarantine" sectionName="Quarantena & Qualità" user={user}>
                  <Quarantine />
                </ProtectedSection>
              }
            />
            <Route
              path="inventory"
              element={
                <ProtectedSection perm="view_inventory" sectionName="Inventario Globale" user={user}>
                  <Inventory />
                </ProtectedSection>
              }
            />
            <Route
              path="customers"
              element={
                <ProtectedSection perm="view_customers" sectionName="Anagrafica Clienti" user={user}>
                  <Customers />
                </ProtectedSection>
              }
            />
            <Route
              path="products"
              element={
                <ProtectedSection perm="view_products" sectionName="Prodotti & Stock" user={user}>
                  <Products />
                </ProtectedSection>
              }
            />
            <Route
              path="locations"
              element={
                <ProtectedSection perm="view_locations" sectionName="Mappa Magazzino" user={user}>
                  <Locations />
                </ProtectedSection>
              }
            />
            <Route
              path="billing-tariffs"
              element={
                <ProtectedSection perm={['view_billing', 'finance_manage']} sectionName="Tariffe Clienti" user={user}>
                  <ClientTariffManager />
                </ProtectedSection>
              }
            />
            <Route
              path="billing-dashboard"
              element={
                <ProtectedSection perm={['view_billing', 'finance_manage']} sectionName="Pre-Fatturazione" user={user}>
                  <PreBillingDashboard />
                </ProtectedSection>
              }
            />
            <Route
              path="billing-rules"
              element={
                <ProtectedSection perm={['view_billing', 'finance_manage']} sectionName="Regole Base Fatturazione" user={user}>
                  <BillingRulesManager />
                </ProtectedSection>
              }
            />
            <Route
              path="finances"
              element={
                <ProtectedSection perm={['view_finances', 'finance_manage']} sectionName="Dashboard Finanza" user={user}>
                  <FinancesDashboard />
                </ProtectedSection>
              }
            />
            <Route
              path="invoices-history"
              element={
                <ProtectedSection perm={['view_finances', 'finance_manage']} sectionName="Archivio Proforme" user={user}>
                  <InvoicesHistory />
                </ProtectedSection>
              }
            />
            <Route
              path="expenses"
              element={
                <ProtectedSection perm={['view_finances', 'finance_manage']} sectionName="Gestione Uscite" user={user}>
                  <ExpensesManager />
                </ProtectedSection>
              }
            />
            <Route
              path="tms"
              element={
                <ProtectedSection perm={['view_tms', 'tms_manage']} sectionName="TMS (Trasporti)" user={user}>
                  <TMSDashboard />
                </ProtectedSection>
              }
            />
            <Route
              path="settings"
              element={
                <ProtectedSection perm={['view_settings', 'settings_manage']} sectionName="Impostazioni Aziendali" user={user}>
                  <Settings />
                </ProtectedSection>
              }
            />
            <Route
              path="settings/routing"
              element={
                <ProtectedSection perm={['view_settings', 'settings_manage', 'pallet_move']} sectionName="Regole di Prelievo" user={user}>
                  <RoutingManager />
                </ProtectedSection>
              }
            />
            <Route
              path="users"
              element={
                <ProtectedSection perm={['view_users', 'users_manage']} sectionName="Utenti & Ruoli (Team)" user={user}>
                  <UsersManagement />
                </ProtectedSection>
              }
            />
            <Route
              path="audit"
              element={
                <ProtectedSection perm="view_audit" sectionName="Audit Logs" user={user}>
                  <AuditLogs />
                </ProtectedSection>
              }
            />
          </Route>
        </Routes>
      </Router>
    </>
  );
}

export default App;
