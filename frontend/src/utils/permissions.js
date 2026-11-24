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

  if (
    (permKey === 'view_non_conformities' || permKey === 'non_conformities_manage') &&
    user.permissions?.access_desktop === true
  ) {
    return true;
  }

  if (
    permKey === 'view_warehouse_signs' &&
    user.permissions?.view_warehouse_signs === undefined &&
    (user.permissions?.view_locations === true || user.permissions?.locations_manage === true)
  ) {
    return true;
  }

  if (
    permKey === 'scarico_container' &&
    user.permissions?.scarico_container === undefined &&
    (user.permissions?.inbound_create === true || user.permissions?.zebra_verify === true)
  ) {
    return true;
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
  { path: '/desktop/non-conformities', perm: ['view_non_conformities', 'non_conformities_manage', 'access_desktop'], label: 'Non Conformità' },
  { path: '/desktop/customers', perm: 'view_customers', label: 'Anagrafica Clienti' },
  { path: '/desktop/locations', perm: 'view_locations', label: 'Mappa Magazzino' },
  { path: '/desktop/warehouse-signs', perm: 'view_warehouse_signs', label: 'Cartelli Magazzino' },
  { path: '/desktop/container-simulator', perm: ['view_outbound', 'tms_manage', 'view_tms', 'view_locations'], label: 'Simulatore Container' },
  { path: '/desktop/tms', perm: ['view_tms', 'tms_manage'], label: 'TMS (Trasporti)' },
  { path: '/desktop/finances', perm: ['view_finances', 'finance_manage'], label: 'Dashboard Finanza' },
  { path: '/desktop/expenses', perm: ['view_finances', 'finance_manage'], label: 'Gestione Uscite' },
  { path: '/desktop/invoices-history', perm: ['view_finances', 'finance_manage', 'view_billing'], label: 'Archivio Proforme' },
  { path: '/desktop/billing-rules', perm: ['view_billing', 'finance_manage', 'tariff_plans_manage'], label: 'Regole Base Fatturazione' },
  { path: '/desktop/billing-audit', perm: ['view_billing', 'finance_manage', 'view_finances'], label: 'Storico Fatturazioni' },
  { path: '/desktop/billing-tariffs', perm: ['view_billing', 'finance_manage', 'tariff_plans_manage', 'client_tariffs_manage'], label: 'Tariffe Clienti' },
  { path: '/desktop/billing-dashboard', perm: ['view_billing', 'finance_manage'], label: 'Pre-Fatturazione' },
  { path: '/desktop/users', perm: ['view_users', 'users_manage'], label: 'Utenti & Ruoli (Team)' },
  { path: '/desktop/audit', perm: 'view_audit', label: 'Audit Logs' },
  { path: '/desktop/settings', perm: ['view_settings', 'settings_manage'], label: 'Impostazioni Aziendali' },
  { path: '/desktop/settings/routing', perm: ['view_settings', 'settings_manage', 'pallet_move'], label: 'Regole di Prelievo' }
];

export const LOCKABLE_SECTIONS = [
  { key: 'dashboard', path: '/desktop', label: 'Dashboard', group: 'Generale' },
  { key: 'inbound', path: '/desktop/inbound', label: 'Nuova Merce (In)', group: 'Merce' },
  { key: 'custom_forms', path: '/desktop/custom-forms', label: 'Moduli & Check-in', group: 'Merce' },
  { key: 'outbound', path: '/desktop/outbound', label: 'Spedizioni (Out)', group: 'Merce' },
  { key: 'outbound_history', path: '/desktop/outbound/history', label: 'Storico Articoli Usciti', group: 'Merce' },
  { key: 'outbound_returns', path: '/desktop/outbound/returns', label: 'Storico Resi', group: 'Merce' },
  { key: 'products', path: '/desktop/products', label: 'Prodotti & Stock', group: 'Merce' },
  { key: 'quarantine', path: '/desktop/quarantine', label: 'Quarantena & Qualità', group: 'Merce' },
  { key: 'non_conformities', path: '/desktop/non-conformities', label: 'Non Conformità', group: 'Merce' },
  { key: 'inventory', path: '/desktop/inventory', label: 'Inventario Globale', group: 'Merce' },
  { key: 'customers', path: '/desktop/customers', label: 'Cartelle Clienti', group: 'Operativo' },
  { key: 'locations', path: '/desktop/locations', label: 'Mappa Magazzino', group: 'Operativo' },
  { key: 'warehouse_signs', path: '/desktop/warehouse-signs', label: 'Cartelli Magazzino', group: 'Operativo' },
  { key: 'container_simulator', path: '/desktop/container-simulator', label: 'Simulatore Container', group: 'Operativo' },
  { key: 'documents', path: '/desktop/documents', label: 'DDT Entrata (Spunta)', group: 'Operativo' },
  { key: 'tms', path: '/desktop/tms', label: 'TMS (Trasporti)', group: 'Operativo' },
  { key: 'finances', path: '/desktop/finances', label: 'Dashboard Finanza', group: 'Finanza' },
  { key: 'expenses', path: '/desktop/expenses', label: 'Gestione Uscite', group: 'Finanza' },
  { key: 'invoices_history', path: '/desktop/invoices-history', label: 'Archivio Proforme', group: 'Finanza' },
  { key: 'billing_rules', path: '/desktop/billing-rules', label: 'Regole Base Fatturazione', group: 'Amministrazione' },
  { key: 'billing_audit', path: '/desktop/billing-audit', label: 'Storico Fatturazioni', group: 'Amministrazione' },
  { key: 'billing_tariffs', path: '/desktop/billing-tariffs', label: 'Tariffe Clienti', group: 'Amministrazione' },
  { key: 'billing_dashboard', path: '/desktop/billing-dashboard', label: 'Pre-Fatturazione', group: 'Amministrazione' },
  { key: 'users', path: '/desktop/users', label: 'Utenti & Ruoli (Team)', group: 'Sistema' },
  { key: 'audit', path: '/desktop/audit', label: 'Audit Logs', group: 'Sistema' },
  { key: 'tickets', path: '/desktop/tickets', label: 'Supporto & Ticket', group: 'Sistema' },
  { key: 'changelogs', path: '/desktop/changelogs', label: 'Changelog & Novità', group: 'Sistema' },
  { key: 'settings', path: '/desktop/settings', label: 'Impostazioni Aziendali', group: 'Configurazione' },
  { key: 'routing', path: '/desktop/settings/routing', label: 'Regole di Prelievo', group: 'Configurazione' }
];

export function isSoftwareEngineer(customUser = null) {
  const user = customUser || getCurrentUser();
  if (!user) return false;
  const rCode = String(user.role || '').trim().toLowerCase();
  const rName = String(user.role_name || '').trim().toLowerCase();
  return rCode === 'developer' || rName === 'software engineer';
}

export function getSectionKeyForPath(pathname) {
  const clean = String(pathname || '').replace(/\/+$/, '') || '/desktop';
  const hit = LOCKABLE_SECTIONS.find(s => s.path === clean);
  return hit ? hit.key : null;
}

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
