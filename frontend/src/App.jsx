import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

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
import { canAccessDesktop, refreshUserProfile } from './utils/permissions';

function App() {
  const [token, setToken] = useState(localStorage.getItem('maglite_token'));
  const [userState, setUserState] = useState(() => {
    try { return JSON.parse(localStorage.getItem('maglite_user') || '{}'); } catch { return {}; }
  });

  const user = userState;
  const [needsPasswordChange, setNeedsPasswordChange] = useState(token && user.requires_password_change);

  const isDesktopAllowed = Boolean(token && canAccessDesktop(user));

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
        
        {/* Ramo Zebra / Mobile Protetto */}
        <Route path="/zebra/*" element={token ? <ZebraApp /> : <Navigate to="/login" />} />
        
        {/* Desktop Application */}
        <Route path="/desktop" element={isDesktopAllowed ? <DesktopLayout /> : <Navigate to="/zebra" />}>
          <Route index element={<Dashboard />} />
          <Route path="inbound" element={<Inbound />} />
          <Route path="outbound" element={<Outbound />} />
          <Route path="outbound/history" element={<OutboundHistory />} />
          <Route path="outbound/returns" element={<OutboundReturns />} />
          <Route path="quarantine" element={<Quarantine />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="customers" element={<Customers />} />
          <Route path="products" element={<Products />} />
          <Route path="locations" element={<Locations />} />
          <Route path="billing-tariffs" element={<ClientTariffManager />} />
          <Route path="billing-dashboard" element={<PreBillingDashboard />} />
          
          <Route path="finances" element={<FinancesDashboard />} />
          <Route path="tms" element={<TMSDashboard />} />

          <Route path="invoices-history" element={<InvoicesHistory />} />
          <Route path="expenses" element={<ExpensesManager />} />
          <Route path="settings" element={<Settings />} />
          <Route path="settings/routing" element={<RoutingManager />} />
          <Route path="billing-rules" element={<BillingRulesManager />} />
          <Route path="documents" element={<InboundDDTs />} />
          <Route path="users" element={<UsersManagement />} />
          <Route path="audit" element={<AuditLogs />} />
        </Route>
      </Routes>
    </Router>
    </>
  );
}

export default App;
