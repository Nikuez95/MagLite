const db = require('../config/db');

const PERMISSION_CATALOG = [
  {
    category: 'platform',
    title: 'Accesso Piattaforme',
    description: 'Definisce a quali interfacce del sistema l\'utente può accedere dopo il login.',
    items: [
      { key: 'access_desktop', label: 'Accesso Gestionale Desktop', desc: 'Consente di entrare nel pannello di controllo Desktop.' },
      { key: 'access_zebra', label: 'Accesso Terminale Zebra', desc: 'Consente di utilizzare l\'interfaccia mobile per pistole laser Zebra.' }
    ]
  },
  {
    category: 'views',
    title: 'Visibilità Sezioni & Menu (Lettura)',
    description: 'Controlla quali pagine e moduli sono visibili nella barra laterale del gestionale.',
    items: [
      { key: 'view_dashboard', label: 'Visualizza Dashboard', desc: 'Accesso alla panoramica KPI e attività in tempo reale.' },
      { key: 'view_inbound', label: 'Visualizza Nuova Merce (Inbound)', desc: 'Accesso alla pagina di ingresso merce e generazione etichette.' },
      { key: 'view_documents', label: 'Visualizza DDT Entrata (Spunta)', desc: 'Accesso alla lista DDT in ingresso e controllo discrepanze.' },
      { key: 'view_outbound', label: 'Visualizza Spedizioni & Resi', desc: 'Accesso alla lista spedizioni, storico uscite e storico resi.' },
      { key: 'view_products', label: 'Visualizza Prodotti & Stock', desc: 'Accesso al catalogo articoli e alle palette in giacenza.' },
      { key: 'view_inventory', label: 'Visualizza Inventario Globale', desc: 'Accesso alla tabella inventario avanzata ed esportazioni PDF.' },
      { key: 'view_quarantine', label: 'Visualizza Registro Quarantene', desc: 'Accesso alla sezione merce bloccata e storico motivi di blocco/sblocco.' },
      { key: 'view_customers', label: 'Visualizza Anagrafica Clienti', desc: 'Accesso alla scheda clienti e sottoreparti.' },
      { key: 'view_locations', label: 'Visualizza Mappa Magazzino', desc: 'Accesso alla mappa scaffali, corridoi e posizioni.' },
      { key: 'view_tms', label: 'Visualizza TMS (Trasporti)', desc: 'Accesso alla pianificazione trasporti e autisti.' },
      { key: 'view_custom_forms', label: 'Visualizza Moduli & Arrivi', desc: 'Accesso alla sezione Moduli & Check-in e storico arrivi merce.' },
      { key: 'view_finances', label: 'Visualizza Finanza', desc: 'Accesso a Dashboard Finanza, Spese e Archivio Proforme.' },
      { key: 'view_billing', label: 'Visualizza Amministrazione', desc: 'Accesso a Regole Base, Tariffe Clienti e Pre-Fatturazione.' },
      { key: 'view_users', label: 'Visualizza Utenti & Ruoli (Team)', desc: 'Accesso alla pagina di gestione del team e della piramide ruoli.' },
      { key: 'view_audit', label: 'Visualizza Audit Logs', desc: 'Accesso al registro storico di tutte le operazioni di sistema.' },
      { key: 'view_settings', label: 'Visualizza Impostazioni & Routing', desc: 'Accesso alle impostazioni aziendali e regole di prelievo.' }
    ]
  },
  {
    category: 'warehouse',
    title: 'Operatività Merce & Magazzino',
    description: 'Permessi operativi su ingressi, modifiche giacenze, spostamenti ed eliminazioni.',
    items: [
      { key: 'inbound_create', label: 'Aggiungere Merce & Creare DDT', desc: 'Permette di caricare nuovi bancali, generare barcode e confermare DDT entrata.' },
      { key: 'delete_inbound_ddt', label: 'Eliminare DDT Entrata (Spunta)', desc: 'Permette di cancellare definitivamente registrazioni e spunte DDT in ingresso.' },
      { key: 'pallet_edit', label: 'Modificare Quantità e Note Palette', desc: 'Permette di rettificare quantità, scadenze, lotti e metadati delle palette.' },
      { key: 'pallet_move', label: 'Spostare / Stivare Palette e Scaffali', desc: 'Permette di stivare, spostare o unire palette e creare posizioni.' },
      { key: 'product_manage', label: 'Gestire Anagrafica Prodotti', desc: 'Permette di creare e modificare gli articoli a catalogo.' },
      { key: 'manage_custom_forms', label: 'Gestione Moduli & Form Dinamici', desc: 'Permette di creare, modificare e disattivare form e sequenze guidate.' },
      { key: 'delete_custom_forms', label: 'Eliminare Moduli & Form Dinamici', desc: 'Permette l\'eliminazione definitiva di template e moduli configurati.' },
      { key: 'delete_checkin', label: 'Eliminare Arrivi & Check-in', desc: 'Permette di cancellare definitivamente registrazioni di arrivo o check-in.' },
      { key: 'pallet_delete', label: 'Eliminare Palette e Prodotti', desc: 'Permette l\'eliminazione fisica definitiva di palette o prodotti dal gestionale.' }
    ]
  },
  {
    category: 'quarantine',
    title: 'Quarantena & Controllo Qualità',
    description: 'Gestione del blocco cautelativo merce e relativo sblocco con tracciamento motivi.',
    items: [
      { key: 'quarantine_manage', label: 'Bloccare e Sbloccare Merce in Quarantena', desc: 'Permette di mettere prodotti/palette in quarantena e di sbloccarli.' },
      { key: 'approve_custom_forms', label: 'Sblocco Standby QA / GDP', desc: 'Permette di autorizzare e sbloccare le sequenze guidate in standby (es. sigillo mancante o controlli QA).' }
    ]
  },
  {
    category: 'outbound',
    title: 'Spedizioni, Picking & Resi',
    description: 'Controllo sulle operazioni di uscita merce, preparazione ordini e rientri.',
    items: [
      { key: 'outbound_create', label: 'Creare e Modificare Spedizioni', desc: 'Permette di creare nuove liste di prelievo e modificare ordini in uscita.' },
      { key: 'outbound_pick', label: 'Effettuare Picking & Confermare Uscita', desc: 'Permette di prelevare merce (Zebra) e confermare la spedizione definitiva.' },
      { key: 'outbound_return', label: 'Registrare Resi Merce Spedita', desc: 'Permette di far rientrare una spedizione in magazzino registrando il motivo del reso.' },
      { key: 'outbound_delete', label: 'Eliminare Spedizioni', desc: 'Permette di cancellare ordini di spedizione dal sistema.' }
    ]
  },
  {
    category: 'admin',
    title: 'Clienti, Finanza, TMS & Sistema',
    description: 'Permessi amministrativi, gestionali e di configurazione del team.',
    items: [
      { key: 'customer_manage', label: 'Gestire Anagrafica Clienti', desc: 'Permette di creare, modificare ed eliminare clienti e reparti.' },
      { key: 'tms_manage', label: 'Gestire Viaggi e Autisti (TMS)', desc: 'Permette di creare e modificare viaggi, tratte e autisti.' },
      { key: 'finance_manage', label: 'Gestire Finanza, Spese e Fatturazione', desc: 'Permette di modificare tariffe, emettere proforme e registrare uscite.' },
      { key: 'users_manage', label: 'Gestire Utenti e Ruoli Sottostanti', desc: 'Permette di creare/modificare utenti e ruoli di livello inferiore nella piramide.' },
      { key: 'settings_manage', label: 'Modificare Impostazioni e Routing', desc: 'Permette di alterare i parametri generali e le priorità di prelievo.' }
    ]
  }
];

const ALL_PERMISSION_KEYS = PERMISSION_CATALOG.flatMap(cat => cat.items.map(i => i.key));

function buildPermMap(enabledKeys = []) {
  const set = new Set(enabledKeys);
  const map = {};
  for (const k of ALL_PERMISSION_KEYS) {
    map[k] = set.has(k);
  }
  return map;
}

const FULL_PERMISSIONS = buildPermMap(ALL_PERMISSION_KEYS);

const VIEW_ONLY_PERMISSIONS = buildPermMap([
  'access_desktop',
  'view_dashboard',
  'view_inbound',
  'view_documents',
  'view_outbound',
  'view_products',
  'view_inventory',
  'view_quarantine',
  'view_customers',
  'view_locations',
  'view_tms',
  'view_custom_forms',
  'view_audit'
]);

const QUALITY_PERMISSIONS = buildPermMap([
  'access_desktop',
  'access_zebra',
  'view_dashboard',
  'view_inbound',
  'view_documents',
  'view_outbound',
  'view_products',
  'view_inventory',
  'view_quarantine',
  'view_customers',
  'view_locations',
  'view_custom_forms',
  'view_audit',
  'inbound_create',
  'pallet_edit',
  'pallet_move',
  'product_manage',
  'quarantine_manage',
  'approve_custom_forms',
  'outbound_return'
]);

const OPERATOR_PERMISSIONS = buildPermMap([
  'access_zebra',
  'inbound_create',
  'pallet_move',
  'outbound_pick'
]);

const DEFAULT_ROLES = [
  {
    code: 'developer',
    name: 'Software Engineer',
    description: 'Grado massimo del sistema. Accesso totale, resta sempre in cima alla gerarchia e non può essere eliminato.',
    color: '#f59e0b',
    hierarchy_level: 10000,
    is_system: true,
    permissions: { ...FULL_PERMISSIONS, restricted_customers: [] }
  },
  {
    code: 'operator',
    name: 'Operatore Magazzino (Zebra)',
    description: 'Accesso dedicato ai terminali laser Zebra per stivaggio, movimentazione e picking.',
    color: '#64748b',
    hierarchy_level: 100,
    is_system: true,
    permissions: { ...OPERATOR_PERMISSIONS, restricted_customers: [] }
  }
];

async function seedDefaultRoles(connection = db) {
  for (const r of DEFAULT_ROLES) {
    await connection.query(
      `INSERT IGNORE INTO ROLES (code, name, description, color, hierarchy_level, is_system, permissions, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Sistema')`,
      [r.code, r.name, r.description, r.color, r.hierarchy_level, r.is_system ? 1 : 0, JSON.stringify(r.permissions)]
    );
  }
  // Assicura che il ruolo developer sia sempre Software Engineer con grado massimo 10000
  await connection.query(
    `UPDATE ROLES SET name = 'Software Engineer', hierarchy_level = 10000, is_system = 1 WHERE code = 'developer'`
  );

  // Normalizza i livelli dei ruoli sotto il Software Engineer se ci sono duplicati o valori >= 10000
  const [otherRoles] = await connection.query(
    `SELECT id, code, hierarchy_level FROM ROLES WHERE code != 'developer' ORDER BY hierarchy_level DESC, id ASC`
  );
  const seenLevels = new Set();
  let needsNormalization = false;
  for (const role of otherRoles) {
    const lvl = Number(role.hierarchy_level) || 0;
    if (lvl >= 10000 || lvl <= 0 || seenLevels.has(lvl)) {
      needsNormalization = true;
      break;
    }
    seenLevels.add(lvl);
  }
  if (needsNormalization && otherRoles.length > 0) {
    const total = otherRoles.length;
    for (let i = 0; i < total; i++) {
      const cleanLevel = (total - i) * 100;
      await connection.query('UPDATE ROLES SET hierarchy_level = ? WHERE id = ?', [cleanLevel, otherRoles[i].id]);
    }
  }
}

function parseJsonSafe(val, fallback = {}) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

const userAccessCache = new Map();
const ACCESS_CACHE_TTL_MS = 30 * 1000; // 30s cache

function clearUserAccessCache(userId = null) {
  if (userId) {
    userAccessCache.delete(Number(userId));
    userAccessCache.delete(String(userId));
  } else {
    userAccessCache.clear();
  }
}

async function resolveUserAccess(userIdOrUsername, connection = db) {
  // Mini-cache in memoria di 30 secondi (se usiamo la connessione db standard)
  if (connection === db) {
    const cacheKey = (typeof userIdOrUsername === 'object' && userIdOrUsername) ? userIdOrUsername.id : userIdOrUsername;
    if (cacheKey) {
      const cached = userAccessCache.get(cacheKey) || userAccessCache.get(Number(cacheKey));
      if (cached && cached.expiresAt > Date.now()) {
        return cached.access;
      }
    }
  }

  let userRow = null;
  if (typeof userIdOrUsername === 'number' || /^\d+$/.test(String(userIdOrUsername))) {
    const [rows] = await connection.query('SELECT * FROM USERS WHERE id = ?', [userIdOrUsername]);
    userRow = rows[0];
  } else if (typeof userIdOrUsername === 'string') {
    const [rows] = await connection.query('SELECT * FROM USERS WHERE username = ?', [userIdOrUsername]);
    userRow = rows[0];
  } else if (userIdOrUsername && typeof userIdOrUsername === 'object') {
    const [rows] = await connection.query('SELECT * FROM USERS WHERE id = ?', [userIdOrUsername.id]);
    userRow = rows[0] || userIdOrUsername;
  }

  if (!userRow) return null;

  const roleCode = userRow.role || 'operator';
  const isDeveloper = roleCode === 'developer';

  const [roleRows] = await connection.query('SELECT * FROM ROLES WHERE code = ?', [roleCode]);
  const roleRow = roleRows[0] || DEFAULT_ROLES.find(r => r.code === roleCode) || DEFAULT_ROLES[DEFAULT_ROLES.length - 1];

  const rawRolePerms = parseJsonSafe(roleRow.permissions, {});
  const rawUserCustom = parseJsonSafe(userRow.custom_permissions, null);

  // Costruisci mappa permessi effettivi: parte dal ruolo e applica eventuali override singoli dell'utente
  const effectivePermissions = {};
  for (const key of ALL_PERMISSION_KEYS) {
    if (isDeveloper) {
      effectivePermissions[key] = typeof rawRolePerms[key] === 'boolean' ? rawRolePerms[key] : true;
    } else {
      effectivePermissions[key] = Boolean(rawRolePerms[key]);
    }
  }

  const userOverrides = rawUserCustom?.overrides || {};
  for (const key of ALL_PERMISSION_KEYS) {
    if (userOverrides[key] === true || userOverrides[key] === 'ALLOW') {
      effectivePermissions[key] = true;
    } else if (userOverrides[key] === false || userOverrides[key] === 'DENY') {
      effectivePermissions[key] = false;
    }
  }

  // Il Software Engineer mantiene sempre accesso alla gestione utenti/ruoli per non auto-bloccarsi mai
  if (isDeveloper) {
    effectivePermissions.view_users = true;
    effectivePermissions.users_manage = true;
  }

  // Calcola restrizioni clienti effettive
  const roleRestricted = Array.isArray(rawRolePerms.restricted_customers)
    ? rawRolePerms.restricted_customers.map(Number).filter(Boolean)
    : [];

  let effectiveRestrictedCustomers = [...roleRestricted];
  if (rawUserCustom && Array.isArray(rawUserCustom.restricted_customers)) {
    const userRestricted = rawUserCustom.restricted_customers.map(Number).filter(Boolean);
    const unlockedByUser = Array.isArray(rawUserCustom.unlocked_customers)
      ? rawUserCustom.unlocked_customers.map(Number).filter(Boolean)
      : [];
    const combined = new Set([...roleRestricted, ...userRestricted]);
    for (const uid of unlockedByUser) {
      combined.delete(uid);
    }
    effectiveRestrictedCustomers = Array.from(combined);
  }

  const customerAccessMode = (
    rawUserCustom?.customer_access_mode ||
    rawRolePerms?.customer_access_mode ||
    'BLACKLIST'
  ).toUpperCase();

  const accessResult = {
    id: userRow.id,
    username: userRow.username,
    role: roleCode,
    role_name: isDeveloper ? (roleRow.name || 'Software Engineer') : (roleRow.name || roleCode),
    role_color: roleRow.color || (isDeveloper ? '#f59e0b' : '#38bdf8'),
    hierarchy_level: isDeveloper ? 10000 : (Number(roleRow.hierarchy_level) || 100),
    requires_password_change: Boolean(userRow.requires_password_change),
    preferences: parseJsonSafe(userRow.preferences, null),
    permissions: effectivePermissions,
    restricted_customers: effectiveRestrictedCustomers,
    customer_access_mode: customerAccessMode,
    custom_permissions: rawUserCustom
  };

  if (connection === db) {
    const expiresAt = Date.now() + ACCESS_CACHE_TTL_MS;
    userAccessCache.set(Number(userRow.id), { access: accessResult, expiresAt });
    userAccessCache.set(userRow.username, { access: accessResult, expiresAt });
  }

  return accessResult;
}

function hasPermission(userContext, permKey) {
  if (!userContext) return false;
  if (userContext.permissions && typeof userContext.permissions[permKey] === 'boolean') {
    return userContext.permissions[permKey];
  }
  if (userContext.role === 'developer') return true;
  return false;
}

function canAccessCustomer(userContext, customerId) {
  if (!userContext || !customerId) return true;
  if (userContext.role === 'developer') return true;

  const mode = (userContext.customer_access_mode || 'BLACKLIST').toUpperCase();
  const list = Array.isArray(userContext.restricted_customers)
    ? userContext.restricted_customers.map(Number)
    : [];

  if (mode === 'WHITELIST' || mode === 'WHITELIST_ONLY' || mode === 'CLIENT_PORTAL') {
    // Portale Clienti: accesso consentito ESCLUSIVAMENTE ai clienti autorizzati
    return list.includes(Number(customerId));
  }

  // Modalità Standard Blacklist: accesso consentito a tutti tranne quelli bloccati
  if (list.length === 0) return true;
  return !list.includes(Number(customerId));
}

module.exports = {
  PERMISSION_CATALOG,
  ALL_PERMISSION_KEYS,
  FULL_PERMISSIONS,
  VIEW_ONLY_PERMISSIONS,
  QUALITY_PERMISSIONS,
  OPERATOR_PERMISSIONS,
  DEFAULT_ROLES,
  seedDefaultRoles,
  resolveUserAccess,
  hasPermission,
  canAccessCustomer,
  parseJsonSafe,
  clearUserAccessCache
};
