import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Lock, ArrowLeft } from 'lucide-react';

// Pages
import ModeSelection from './pages/ModeSelection';
import DesktopLayout from './pages/desktop/DesktopLayout';
import ZebraApp from './zebra/ZebraApp';
import Login from './pages/Login';
import UsersManagement from './pages/desktop/Users';
import ForcePasswordChange from './pages/ForcePasswordChange';
import Customers from './pages/desktop/Customers';
import Products from './pages/desktop/Products';
import Inbound from './pages/desktop/Inbound';
import InboundDDTs from './pages/desktop/InboundDDTs';
import Outbound from './pages/desktop/Outbound';
import OutboundHistory from './pages/desktop/OutboundHistory';
import OutboundReturns from './pages/desktop/OutboundReturns';
import Quarantine from './pages/desktop/Quarantine';
import Inventory from './pages/desktop/Inventory';
import Locations from './pages/desktop/Locations';
import ClientTariffManager from './pages/desktop/ClientTariffManager';
import Settings from './pages/desktop/Settings';
import RoutingManager from './pages/desktop/RoutingManager';
import BillingRulesManager from './pages/desktop/BillingRulesManager';
import PreBillingDashboard from './pages/desktop/PreBillingDashboard';
import FinancesDashboard from './pages/desktop/FinancesDashboard';
import TMSDashboard from './pages/desktop/TMSDashboard';
import InvoicesHistory from './pages/desktop/InvoicesHistory';
import ExpensesManager from './pages/desktop/ExpensesManager';
import Dashboard from './pages/desktop/Dashboard';
import AuditLogs from './pages/desktop/AuditLogs';
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
                  ? <DesktopLayout />
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
