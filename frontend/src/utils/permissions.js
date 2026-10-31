import axios from 'axios';

export function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('maglite_user') || '{}');
  } catch {
    return {};
  }
}

export function hasPerm(permKey, customUser = null) {
  const user = customUser || getCurrentUser();
  if (!user || !user.role) return false;

  if (Array.isArray(permKey)) {
    return permKey.some(k => hasPerm(k, user));
  }

  // Il Software Engineer mantiene sempre accesso alla pagina Team & Permessi per non auto-bloccarsi mai
  if (user.role === 'developer' && (permKey === 'view_users' || permKey === 'users_manage')) {
    return true;
  }

  if (user.permissions && typeof user.permissions[permKey] === 'boolean') {
    return user.permissions[permKey];
  }

  if (user.role === 'developer') return true;
  return false;
}

export function canTouchCustomer(customerId, customUser = null) {
  if (!customerId) return true;
  const user = customUser || getCurrentUser();
  if (!user || !user.role) return false;
  if (user.role === 'developer') return true;

  const mode = (user.customer_access_mode || 'BLACKLIST').toUpperCase();
  const list = Array.isArray(user.restricted_customers)
    ? user.restricted_customers.map(Number)
    : [];

  if (mode === 'WHITELIST' || mode === 'WHITELIST_ONLY' || mode === 'CLIENT_PORTAL') {
    return list.includes(Number(customerId));
  }

  if (list.length === 0) return true;
  return !list.includes(Number(customerId));
}

export const canAccessCustomer = canTouchCustomer;

export function canAccessDesktop(customUser = null) {
  const user = customUser || getCurrentUser();
  // Il Software Engineer può sempre accedere al Desktop per gestire i permessi se anche disattivasse access_zebra
  if (user?.role === 'developer' && hasPerm('access_desktop', user)) return true;
  return hasPerm('access_desktop', user);
}

export function canAccessZebra(customUser = null) {
  return hasPerm('access_zebra', customUser);
}

export const DESKTOP_ROUTE_RULES = [
  { path: '/desktop', perm: 'view_dashboard', label: 'Dashboard' },
  { path: '/desktop/inbound', perm: 'view_inbound', label: 'Nuova Merce (Inbound)' },
  { path: '/desktop/custom-forms', perm: ['view_custom_forms', 'manage_custom_forms'], label: 'Moduli & Arrivi' },
  { path: '/desktop/documents', perm: 'view_documents', label: 'DDT Entrata (Spunta)' },
  { path: '/desktop/outbound', perm: 'view_outbound', label: 'Spedizioni (Outbound)' },
  { path: '/desktop/outbound/history', perm: 'view_outbound', label: 'Storico Uscite' },
  { path: '/desktop/outbound/returns', perm: ['view_outbound', 'outbound_return'], label: 'Storico Resi' },
  { path: '/desktop/products', perm: 'view_products', label: 'Prodotti & Stock' },
  { path: '/desktop/inventory', perm: 'view_inventory', label: 'Inventario Globale' },
  { path: '/desktop/quarantine', perm: 'view_quarantine', label: 'Quarantena & Qualità' },
  { path: '/desktop/customers', perm: 'view_customers', label: 'Anagrafica Clienti' },
  { path: '/desktop/locations', perm: 'view_locations', label: 'Mappa Magazzino' },
  { path: '/desktop/tms', perm: ['view_tms', 'tms_manage'], label: 'TMS (Trasporti)' },
  { path: '/desktop/finances', perm: ['view_finances', 'finance_manage'], label: 'Dashboard Finanza' },
  { path: '/desktop/expenses', perm: ['view_finances', 'finance_manage'], label: 'Gestione Uscite' },
  { path: '/desktop/invoices-history', perm: ['view_finances', 'finance_manage'], label: 'Archivio Proforme' },
  { path: '/desktop/billing-rules', perm: ['view_billing', 'finance_manage'], label: 'Regole Base Fatturazione' },
  { path: '/desktop/billing-tariffs', perm: ['view_billing', 'finance_manage'], label: 'Tariffe Clienti' },
  { path: '/desktop/billing-dashboard', perm: ['view_billing', 'finance_manage'], label: 'Pre-Fatturazione' },
  { path: '/desktop/users', perm: ['view_users', 'users_manage'], label: 'Utenti & Ruoli (Team)' },
  { path: '/desktop/audit', perm: 'view_audit', label: 'Audit Logs' },
  { path: '/desktop/settings', perm: ['view_settings', 'settings_manage'], label: 'Impostazioni Aziendali' },
  { path: '/desktop/settings/routing', perm: ['view_settings', 'settings_manage', 'pallet_move'], label: 'Regole di Prelievo' }
];

export function getFirstAllowedDesktopRoute(customUser = null) {
  const user = customUser || getCurrentUser();
  for (const rule of DESKTOP_ROUTE_RULES) {
    if (hasPerm(rule.perm, user)) {
      return rule.path;
    }
  }
  return null;
}

export async function refreshUserProfile() {
  const token = localStorage.getItem('maglite_token');
  if (!token) return null;
  try {
    const res = await axios.get(`http://${window.location.hostname}:3000/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.data?.user) {
      localStorage.setItem('maglite_user', JSON.stringify(res.data.user));
      window.dispatchEvent(new Event('maglite_permissions_updated'));
      return res.data.user;
    }
  } catch (err) {
    // ignore network/auth error
  }
  return null;
}
