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
  if (user.role === 'developer') return true;

  if (user.permissions && typeof user.permissions[permKey] === 'boolean') {
    return user.permissions[permKey];
  }

  // Fallback di compatibilità per sessioni prima del refresh /api/auth/me
  if (user.role === 'backoffice' || user.role === 'direzione_generale' || user.role === 'admin') {
    return true;
  }
  if (user.role === 'operator') {
    return ['access_zebra', 'inbound_create', 'pallet_move', 'outbound_pick'].includes(permKey);
  }
  return false;
}

export function canTouchCustomer(customerId, customUser = null) {
  if (!customerId) return true;
  const user = customUser || getCurrentUser();
  if (!user || user.role === 'developer') return true;
  const restricted = user.restricted_customers;
  if (!Array.isArray(restricted) || restricted.length === 0) return true;
  return !restricted.map(Number).includes(Number(customerId));
}

export function canAccessDesktop(customUser = null) {
  return hasPerm('access_desktop', customUser);
}

export function canAccessZebra(customUser = null) {
  return hasPerm('access_zebra', customUser);
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
