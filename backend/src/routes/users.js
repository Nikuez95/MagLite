const bcrypt = require('bcrypt');
const db = require('../config/db');
const {
  PERMISSION_CATALOG,
  ALL_PERMISSION_KEYS,
  FULL_PERMISSIONS,
  seedDefaultRoles,
  resolveUserAccess,
  hasPermission,
  parseJsonSafe
} = require('../utils/permissions');

function sanitizeRoleCode(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 45);
}

async function userRoutes(fastify, options) {
  // Proteggiamo tutte le rotte con JWT
  fastify.addHook('onRequest', fastify.authenticate);

  // Middleware locale: verifica accesso alla sezione utenti
  fastify.addHook('preHandler', async (request, reply) => {
    const caller = await resolveUserAccess(request.user.id, db);
    if (!caller) {
      return reply.code(401).send({ error: 'Utente non valido' });
    }
    request.callerAccess = caller;

    const isReadMethod = request.method === 'GET';
    if (isReadMethod) {
      if (!hasPermission(caller, 'view_users') && !hasPermission(caller, 'users_manage')) {
        return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di visualizzare il Team e i Ruoli.' });
      }
    } else {
      if (!hasPermission(caller, 'users_manage')) {
        return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di gestire utenti o ruoli.' });
      }
    }
  });

  // GET /api/users - Ritorna utenti, ruoli piramidali e catalogo permessi
  fastify.get('/', async (request, reply) => {
    try {
      await seedDefaultRoles(db);

      const [roleRows] = await db.query('SELECT * FROM ROLES ORDER BY hierarchy_level DESC, id ASC');
      const [userRows] = await db.query('SELECT id, username, role, requires_password_change, custom_permissions, created_at FROM USERS ORDER BY created_at DESC');

      const rolesMap = new Map();
      const formattedRoles = roleRows.map(r => {
        const perms = r.code === 'developer'
          ? { ...FULL_PERMISSIONS, restricted_customers: [] }
          : parseJsonSafe(r.permissions, {});
        const roleObj = {
          ...r,
          hierarchy_level: r.code === 'developer' ? 1000 : Number(r.hierarchy_level) || 100,
          is_system: Boolean(r.is_system),
          permissions: perms,
          member_count: 0
        };
        rolesMap.set(r.code, roleObj);
        return roleObj;
      });

      const enrichedUsers = [];
      for (const u of userRows) {
        const resolved = await resolveUserAccess(u.id, db);
        const roleObj = rolesMap.get(u.role);
        if (roleObj) roleObj.member_count += 1;

        enrichedUsers.push({
          id: u.id,
          username: u.username,
          role: u.role,
          role_name: resolved?.role_name || u.role,
          role_color: resolved?.role_color || '#38bdf8',
          hierarchy_level: resolved?.hierarchy_level || 100,
          requires_password_change: Boolean(u.requires_password_change),
          custom_permissions: parseJsonSafe(u.custom_permissions, null),
          effective_permissions: resolved?.permissions || {},
          restricted_customers: resolved?.restricted_customers || [],
          created_at: u.created_at
        });
      }

      // Ordina utenti per livello gerarchico decrescente e poi data
      enrichedUsers.sort((a, b) => {
        if (b.hierarchy_level !== a.hierarchy_level) return b.hierarchy_level - a.hierarchy_level;
        return a.username.localeCompare(b.username);
      });

      return {
        users: enrichedUsers,
        roles: formattedRoles,
        catalog: PERMISSION_CATALOG,
        currentUser: request.callerAccess
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore interno del server' });
    }
  });

  // POST /api/users - Crea un nuovo utente con ruolo e permessi personalizzati opzionali
  fastify.post('/', async (request, reply) => {
    const { username, password, role, custom_permissions } = request.body;
    const caller = request.callerAccess;

    if (!username || !password || !role) {
      return reply.code(400).send({ error: 'Username, password e ruolo sono obbligatori' });
    }

    try {
      const [roleRows] = await db.query('SELECT * FROM ROLES WHERE code = ?', [role]);
      if (roleRows.length === 0) {
        return reply.code(400).send({ error: 'Il ruolo selezionato non esiste' });
      }
      const targetRole = roleRows[0];
      const targetLevel = targetRole.code === 'developer' ? 1000 : Number(targetRole.hierarchy_level) || 100;

      // Regola Piramidale: solo il developer può assegnare qualsiasi ruolo; gli altri possono assegnare SOLO ruoli strettamente inferiori al proprio
      if (caller.role !== 'developer') {
        if (targetRole.code === 'developer' || targetLevel >= caller.hierarchy_level) {
          return reply.code(403).send({
            error: `Gerarchia Piramidale: non puoi assegnare il ruolo "${targetRole.name}" (Livello ${targetLevel}) perché è pari o superiore al tuo livello (${caller.hierarchy_level}).`
          });
        }
      }

      const cleanCustomPerms = custom_permissions && typeof custom_permissions === 'object'
        ? JSON.stringify(custom_permissions)
        : null;

      const hash = await bcrypt.hash(password, 10);
      await db.query(
        'INSERT INTO USERS (username, password_hash, role, requires_password_change, custom_permissions) VALUES (?, ?, ?, TRUE, ?)',
        [username.trim(), hash, targetRole.code, cleanCustomPerms]
      );

      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['CREATE_USER', `Creato utente ${username.trim()} (Ruolo: ${targetRole.name})`, 'Gestionale', caller.username]
      );

      if (fastify.io) fastify.io.emit('permissions_updated');

      return reply.code(201).send({ success: true, message: 'Utente creato con successo' });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return reply.code(400).send({ error: 'Lo username scelto è già in uso' });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore interno del server' });
    }
  });

  // PUT /api/users/:id/access - Aggiorna ruolo e/o permessi singoli (override Discord) di un utente
  fastify.put('/:id/access', async (request, reply) => {
    const { id } = request.params;
    const { role, custom_permissions } = request.body;
    const caller = request.callerAccess;

    try {
      const targetUser = await resolveUserAccess(id, db);
      if (!targetUser) {
        return reply.code(404).send({ error: 'Utente non trovato' });
      }

      // L'account Developer ha i poteri massimi e non può essere degradato o limitato da nessuno
      if (targetUser.role === 'developer') {
        return reply.code(403).send({ error: 'Il ruolo Developer possiede i poteri massimi e non può essere modificato o limitato.' });
      }

      // Regola Piramidale sull'utente bersaglio
      if (caller.role !== 'developer' && targetUser.hierarchy_level >= caller.hierarchy_level) {
        return reply.code(403).send({
          error: `Gerarchia Piramidale: non puoi modificare l'utente "${targetUser.username}" perché ha un ruolo di livello pari o superiore al tuo.`
        });
      }

      let nextRoleCode = targetUser.role;
      if (role && role !== targetUser.role) {
        const [roleRows] = await db.query('SELECT * FROM ROLES WHERE code = ?', [role]);
        if (roleRows.length === 0) {
          return reply.code(400).send({ error: 'Ruolo non trovato' });
        }
        const newRole = roleRows[0];
        const newLevel = newRole.code === 'developer' ? 1000 : Number(newRole.hierarchy_level) || 100;

        if (caller.role !== 'developer' && (newRole.code === 'developer' || newLevel >= caller.hierarchy_level)) {
          return reply.code(403).send({
            error: `Gerarchia Piramidale: non puoi assegnare il ruolo "${newRole.name}" perché è pari o superiore al tuo livello.`
          });
        }
        nextRoleCode = newRole.code;
      }

      const cleanCustom = custom_permissions && typeof custom_permissions === 'object'
        ? JSON.stringify(custom_permissions)
        : null;

      await db.query(
        'UPDATE USERS SET role = ?, custom_permissions = ? WHERE id = ?',
        [nextRoleCode, cleanCustom, id]
      );

      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['UPDATE_USER_ACCESS', `Aggiornati permessi/ruolo per ${targetUser.username} (Ruolo: ${nextRoleCode})`, 'Gestionale', caller.username]
      );

      if (fastify.io) {
        fastify.io.emit('permissions_updated', { userId: Number(id) });
      }

      return { success: true, message: 'Permessi e ruolo utente aggiornati con successo' };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore aggiornamento accessi utente' });
    }
  });

  // DELETE /api/users/:id - Elimina un utente
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params;
    const caller = request.callerAccess;

    if (Number(id) === Number(caller.id)) {
      return reply.code(400).send({ error: 'Non puoi cancellare il tuo stesso account' });
    }

    try {
      const targetUser = await resolveUserAccess(id, db);
      if (!targetUser) {
        return reply.code(404).send({ error: 'Utente non trovato' });
      }

      // Il ruolo developer non può essere eliminato da nessuno!
      if (targetUser.role === 'developer') {
        return reply.code(403).send({ error: 'Il ruolo Developer ha i poteri massimi e non può essere eliminato da nessuno!' });
      }

      // Regola Piramidale
      if (caller.role !== 'developer' && targetUser.hierarchy_level >= caller.hierarchy_level) {
        return reply.code(403).send({
          error: `Gerarchia Piramidale: non puoi eliminare "${targetUser.username}" perché ricopre un ruolo di livello pari o superiore al tuo.`
        });
      }

      const [result] = await db.query('DELETE FROM USERS WHERE id = ?', [id]);
      if (result.affectedRows === 0) {
        return reply.code(404).send({ error: 'Utente non trovato' });
      }

      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['DELETE_USER', `Eliminato utente ${targetUser.username} (Ruolo: ${targetUser.role_name})`, 'Gestionale', caller.username]
      );

      if (fastify.io) fastify.io.emit('permissions_updated', { userId: Number(id) });

      return { success: true, message: 'Utente eliminato' };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante l\'eliminazione' });
    }
  });

  // PUT /api/users/:id/reset-password - Forza una nuova password per l'utente
  fastify.put('/:id/reset-password', async (request, reply) => {
    const { id } = request.params;
    const { newPassword } = request.body;
    const caller = request.callerAccess;

    if (!newPassword) {
      return reply.code(400).send({ error: 'La nuova password è obbligatoria' });
    }

    try {
      const targetUser = await resolveUserAccess(id, db);
      if (!targetUser) {
        return reply.code(404).send({ error: 'Utente non trovato' });
      }

      if (targetUser.role === 'developer' && Number(caller.id) !== Number(targetUser.id)) {
        return reply.code(403).send({ error: 'L\'account Developer non può essere modificato da altri' });
      }

      if (caller.role !== 'developer' && targetUser.hierarchy_level >= caller.hierarchy_level) {
        return reply.code(403).send({ error: 'Non puoi resettare la password di un utente di grado pari o superiore al tuo.' });
      }

      const hash = await bcrypt.hash(newPassword, 10);
      await db.query('UPDATE USERS SET password_hash = ?, requires_password_change = TRUE WHERE id = ?', [hash, id]);

      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['RESET_PASSWORD', `Forzato reset password per utente ${targetUser.username}`, 'Gestionale', caller.username]
      );

      return { success: true, message: 'Password resettata. Al prossimo login l\'utente dovrà cambiarla.' };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante il reset della password' });
    }
  });

  // ==========================================
  // GESTIONE RUOLI PIRAMIDALI (/api/users/roles)
  // ==========================================

  // POST /api/users/roles - Crea un nuovo ruolo nella piramide
  fastify.post('/roles', async (request, reply) => {
    const { name, code, description, color, hierarchy_level, permissions } = request.body;
    const caller = request.callerAccess;

    if (!name || String(name).trim() === '') {
      return reply.code(400).send({ error: 'Il nome del ruolo è obbligatorio' });
    }

    const roleCode = sanitizeRoleCode(code || name);
    if (!roleCode || roleCode === 'developer') {
      return reply.code(400).send({ error: 'Codice ruolo non valido o riservato' });
    }

    const requestedLevel = Math.max(1, Math.min(999, parseInt(hierarchy_level, 10) || 200));

    // Regola Piramidale: chi non è developer può creare solo ruoli sotto il proprio livello
    if (caller.role !== 'developer' && requestedLevel >= caller.hierarchy_level) {
      return reply.code(403).send({
        error: `Gerarchia Piramidale: puoi creare solo ruoli con livello inferiore al tuo (massimo consentito: ${caller.hierarchy_level - 1}).`
      });
    }

    try {
      const cleanPerms = {};
      for (const k of ALL_PERMISSION_KEYS) {
        // Se chi crea non è developer, non può attivare permessi che lui stesso non possiede
        const wanted = Boolean(permissions?.[k]);
        cleanPerms[k] = caller.role === 'developer' ? wanted : (wanted && hasPermission(caller, k));
      }
      cleanPerms.restricted_customers = Array.isArray(permissions?.restricted_customers)
        ? permissions.restricted_customers.map(Number).filter(Boolean)
        : [];

      const [res] = await db.query(
        `INSERT INTO ROLES (code, name, description, color, hierarchy_level, is_system, permissions, created_by)
         VALUES (?, ?, ?, ?, ?, FALSE, ?, ?)`,
        [
          roleCode,
          String(name).trim(),
          description ? String(description).trim() : null,
          color || '#38bdf8',
          requestedLevel,
          JSON.stringify(cleanPerms),
          caller.username
        ]
      );

      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['CREATE_ROLE', `Creato nuovo ruolo "${name}" (Livello piramide: ${requestedLevel})`, 'Gestionale', caller.username]
      );

      if (fastify.io) fastify.io.emit('permissions_updated');

      return reply.code(201).send({
        success: true,
        role_id: res.insertId,
        code: roleCode,
        message: `Ruolo "${name}" creato con successo`
      });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return reply.code(400).send({ error: 'Esiste già un ruolo con questo nome o codice identificativo' });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante la creazione del ruolo' });
    }
  });

  // PUT /api/users/roles/:id - Aggiorna un ruolo esistente
  fastify.put('/roles/:id', async (request, reply) => {
    const { id } = request.params;
    const { name, description, color, hierarchy_level, permissions } = request.body;
    const caller = request.callerAccess;

    try {
      const [rows] = await db.query('SELECT * FROM ROLES WHERE id = ?', [id]);
      if (rows.length === 0) {
        return reply.code(404).send({ error: 'Ruolo non trovato' });
      }
      const targetRole = rows[0];

      if (targetRole.code === 'developer') {
        return reply.code(403).send({ error: 'Il ruolo Developer ha i poteri massimi ed è immutabile.' });
      }

      const currentTargetLevel = Number(targetRole.hierarchy_level) || 100;
      if (caller.role !== 'developer' && currentTargetLevel >= caller.hierarchy_level) {
        return reply.code(403).send({
          error: `Gerarchia Piramidale: non puoi modificare il ruolo "${targetRole.name}" perché è di livello pari o superiore al tuo.`
        });
      }

      const nextLevel = hierarchy_level !== undefined
        ? Math.max(1, Math.min(999, parseInt(hierarchy_level, 10) || currentTargetLevel))
        : currentTargetLevel;

      if (caller.role !== 'developer' && nextLevel >= caller.hierarchy_level) {
        return reply.code(403).send({
          error: `Gerarchia Piramidale: non puoi portare un ruolo a un livello pari o superiore al tuo (${caller.hierarchy_level}).`
        });
      }

      const existingPerms = parseJsonSafe(targetRole.permissions, {});
      const cleanPerms = {};
      for (const k of ALL_PERMISSION_KEYS) {
        const wanted = permissions !== undefined ? Boolean(permissions[k]) : Boolean(existingPerms[k]);
        cleanPerms[k] = caller.role === 'developer' ? wanted : (wanted && hasPermission(caller, k));
      }
      cleanPerms.restricted_customers = Array.isArray(permissions?.restricted_customers)
        ? permissions.restricted_customers.map(Number).filter(Boolean)
        : (Array.isArray(existingPerms.restricted_customers) ? existingPerms.restricted_customers : []);

      await db.query(
        `UPDATE ROLES
         SET name = ?, description = ?, color = ?, hierarchy_level = ?, permissions = ?
         WHERE id = ?`,
        [
          name ? String(name).trim() : targetRole.name,
          description !== undefined ? (description ? String(description).trim() : null) : targetRole.description,
          color || targetRole.color || '#38bdf8',
          nextLevel,
          JSON.stringify(cleanPerms),
          id
        ]
      );

      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['UPDATE_ROLE', `Aggiornato ruolo "${name || targetRole.name}" (Livello: ${nextLevel})`, 'Gestionale', caller.username]
      );

      if (fastify.io) fastify.io.emit('permissions_updated');

      return { success: true, message: `Ruolo "${name || targetRole.name}" salvato con successo` };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore salvataggio ruolo' });
    }
  });

  // DELETE /api/users/roles/:id - Elimina un ruolo
  fastify.delete('/roles/:id', async (request, reply) => {
    const { id } = request.params;
    const caller = request.callerAccess;

    try {
      const [rows] = await db.query('SELECT * FROM ROLES WHERE id = ?', [id]);
      if (rows.length === 0) {
        return reply.code(404).send({ error: 'Ruolo non trovato' });
      }
      const targetRole = rows[0];

      if (targetRole.code === 'developer') {
        return reply.code(403).send({ error: 'Il ruolo Developer non può essere eliminato da nessuno!' });
      }
      if (targetRole.code === 'operator') {
        return reply.code(400).send({ error: 'Il ruolo base Operatore non può essere eliminato.' });
      }

      const targetLevel = Number(targetRole.hierarchy_level) || 100;
      if (caller.role !== 'developer' && targetLevel >= caller.hierarchy_level) {
        return reply.code(403).send({
          error: `Gerarchia Piramidale: non puoi eliminare il ruolo "${targetRole.name}" perché è di livello pari o superiore al tuo.`
        });
      }

      // Sposta eventuali utenti associati a questo ruolo sul ruolo base 'operator'
      await db.query('UPDATE USERS SET role = ? WHERE role = ?', ['operator', targetRole.code]);
      await db.query('DELETE FROM ROLES WHERE id = ?', [id]);

      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['DELETE_ROLE', `Eliminato ruolo "${targetRole.name}" (${targetRole.code})`, 'Gestionale', caller.username]
      );

      if (fastify.io) fastify.io.emit('permissions_updated');

      return { success: true, message: `Ruolo "${targetRole.name}" eliminato` };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore eliminazione ruolo' });
    }
  });
}

module.exports = userRoutes;
