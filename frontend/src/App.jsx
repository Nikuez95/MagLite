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
import Outbound from './pages/desktop/Outbound';
import Locations from './pages/desktop/Locations';
import Dashboard from './pages/desktop/Dashboard';
import AuditLogs from './pages/desktop/AuditLogs';

function App() {
  const [token, setToken] = useState(localStorage.getItem('maglite_token'));
  
  const user = JSON.parse(localStorage.getItem('maglite_user') || '{}');
  const [needsPasswordChange, setNeedsPasswordChange] = useState(token && user.requires_password_change);
  
  const isDesktopAllowed = token && (user.role === 'developer' || user.role === 'backoffice');

  useEffect(() => {
    if (token) {
      localStorage.setItem('maglite_token', token);
      const updatedUser = JSON.parse(localStorage.getItem('maglite_user') || '{}');
      setNeedsPasswordChange(updatedUser.requires_password_change);
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
          <Route path="customers" element={<Customers />} />
          <Route path="products" element={<Products />} />
          <Route path="locations" element={<Locations />} />
          <Route path="documents" element={<div className="text-3xl font-bold text-brand-white">Fatture e DDT</div>} />
          <Route path="users" element={<UsersManagement />} />
          <Route path="audit" element={<AuditLogs />} />
        </Route>
      </Routes>
    </Router>
    </>
  );
}

export default App;
