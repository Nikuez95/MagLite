const bcrypt = require('bcrypt');
const db = require('../config/db');
const {
  PERMISSION_CATALOG,
  ALL_PERMISSION_KEYS,
  FULL_PERMISSIONS,
  seedDefaultRoles,
  resolveUserAccess,
  hasPermission,
  parseJsonSafe,
  clearUserAccessCache
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

/**
 * Ricalcola i livelli gerarchici in base all'ordine (dall'alto verso il basso).
 * Il ruolo 'developer' (Software Engineer) resta SEMPRE in prima posizione con livello 10000.
 */
async function syncRoleHierarchyOrder(orderedIds = null, connection = db) {
  const [allRoles] = await connection.query('SELECT * FROM ROLES ORDER BY hierarchy_level DESC, id ASC');
  const devRole = allRoles.find(r => r.code === 'developer');
  const otherRoles = allRoles.filter(r => r.code !== 'developer');

  let finalOthers = otherRoles;
  if (Array.isArray(orderedIds) && orderedIds.length > 0) {
    const idMap = new Map(otherRoles.map(r => [Number(r.id), r]));
    const reordered = [];
    for (const rawId of orderedIds) {
      const numId = Number(rawId);
      if (idMap.has(numId)) {
        reordered.push(idMap.get(numId));
        idMap.delete(numId);
      }
    }
    for (const remaining of idMap.values()) {
      reordered.push(remaining);
    }
    finalOthers = reordered;
  }

  if (devRole) {
    await connection.query(
      `UPDATE ROLES SET name = 'Software Engineer', hierarchy_level = 10000, is_system = 1 WHERE id = ?`,
      [devRole.id]
    );
  }

  const total = finalOthers.length;
  for (let i = 0; i < total; i++) {
    const level = (total - i) * 100;
    await connection.query('UPDATE ROLES SET hierarchy_level = ? WHERE id = ?', [level, finalOthers[i].id]);
  }
}

async function userRoutes(fastify, options) {
  // Proteggiamo tutte le rotte con JWT
  fastify.addHook('onRequest', fastify.authenticate);

  // Middleware locale: verifica accesso alla sezione utenti
  fastify.addHook('preHandler', async (request, reply) => {
    // Usa direttamente request.user arricchito da fastify.authenticate per azzerare chiamate duplicate al DB
    const caller = request.user;
    request.callerAccess = caller;

    // Il Software Engineer ha sempre accesso alla gestione utenti/ruoli
    if (caller.role === 'developer') return;

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

  // GET /api/users - Ritorna utenti, ruoli ordinati per gerarchia e catalogo permessi
  fastify.get('/', async (request, reply) => {
    try {
      await seedDefaultRoles(db);
      await syncRoleHierarchyOrder(null, db);

      // Ricarica il caller dopo eventuale normalizzazione livelli
      const caller = await resolveUserAccess(request.user.id, db);
      request.callerAccess = caller;
      const isCallerDeveloper = caller.role === 'developer';

      const [roleRows] = await db.query('SELECT * FROM ROLES ORDER BY hierarchy_level DESC, id ASC');
      const [userRows] = await db.query('SELECT id, username, role, requires_password_change, custom_permissions, created_at FROM USERS ORDER BY created_at DESC');

      const rolesMap = new Map();
      const formattedRoles = roleRows.map((r, idx) => {
        const rawPerms = parseJsonSafe(r.permissions, {});
        const perms = {};
        for (const k of ALL_PERMISSION_KEYS) {
          perms[k] = r.code === 'developer'
            ? (typeof rawPerms[k] === 'boolean' ? rawPerms[k] : true)
            : Boolean(rawPerms[k]);
        }
        if (r.code === 'developer') {
          perms.view_users = true;
          perms.users_manage = true;
        }
        perms.restricted_customers = Array.isArray(rawPerms.restricted_customers)
          ? rawPerms.restricted_customers.map(Number).filter(Boolean)
          : [];

        const level = r.code === 'developer' ? 10000 : (Number(r.hierarchy_level) || 100);
        // Regola di blocco ruolo:
        // - Software Engineer può modificare qualsiasi ruolo (incluso se stesso, ma non può spostarlo né eliminarlo)
        // - Utente X con ruolo Y NON può modificare il proprio ruolo Y né quelli sopra di lui (solo quelli strettamente sotto)
        const isLockedForCaller = !isCallerDeveloper && (r.code === 'developer' || r.code === caller.role || level >= caller.hierarchy_level);
        const canDragRole = r.code !== 'developer' && (isCallerDeveloper || level < caller.hierarchy_level);
        const canDeleteRole = r.code !== 'developer' && r.code !== 'operator' && (isCallerDeveloper || level < caller.hierarchy_level);

        const roleObj = {
          ...r,
          name: r.code === 'developer' ? 'Software Engineer' : r.name,
          hierarchy_level: level,
          rank: idx + 1,
          is_system: Boolean(r.is_system),
          is_locked: isLockedForCaller,
          can_drag: canDragRole,
          can_delete: canDeleteRole,
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

        const userLevel = resolved?.hierarchy_level || 100;
        const isLockedUser = !isCallerDeveloper && (u.role === 'developer' || u.role === caller.role || userLevel >= caller.hierarchy_level);
        const canDeleteUser = u.role !== 'developer' && Number(u.id) !== Number(caller.id) && (isCallerDeveloper || userLevel < caller.hierarchy_level);

        enrichedUsers.push({
          id: u.id,
          username: u.username,
          role: u.role,
          role_name: resolved?.role_name || u.role,
          role_color: resolved?.role_color || '#38bdf8',
          hierarchy_level: userLevel,
          rank: roleObj ? roleObj.rank : 999,
          is_locked: isLockedUser,
          can_delete: canDeleteUser,
          requires_password_change: Boolean(u.requires_password_change),
          custom_permissions: parseJsonSafe(u.custom_permissions, null),
          effective_permissions: resolved?.permissions || {},
          restricted_customers: resolved?.restricted_customers || [],
          created_at: u.created_at
        });
      }

      // Ordina utenti per gerarchia (rank crescente / hierarchy_level decrescente) e poi username
      enrichedUsers.sort((a, b) => {
        if (b.hierarchy_level !== a.hierarchy_level) return b.hierarchy_level - a.hierarchy_level;
        return a.username.localeCompare(b.username);
      });

      return {
        users: enrichedUsers,
        roles: formattedRoles,
        catalog: PERMISSION_CATALOG,
        currentUser: caller
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
    const isCallerDeveloper = caller.role === 'developer';

    if (!username || !password || !role) {
      return reply.code(400).send({ error: 'Username, password e ruolo sono obbligatori' });
    }

    try {
      const [roleRows] = await db.query('SELECT * FROM ROLES WHERE code = ?', [role]);
      if (roleRows.length === 0) {
        return reply.code(400).send({ error: 'Il ruolo selezionato non esiste' });
      }
      const targetRole = roleRows[0];
      const targetLevel = targetRole.code === 'developer' ? 10000 : Number(targetRole.hierarchy_level) || 100;

      // Regola Gerarchica:
      // - Il Software Engineer può creare utenti anche con ruolo pari al suo (Software Engineer) o qualsiasi altro ruolo.
      // - Chi non è Software Engineer può assegnare SOLO ruoli strettamente sotto il proprio.
      if (!isCallerDeveloper) {
        if (targetRole.code === 'developer' || targetRole.code === caller.role || targetLevel >= caller.hierarchy_level) {
          return reply.code(403).send({
            error: `Gerarchia Ruoli: non puoi assegnare il ruolo "${targetRole.name}" perché è pari o superiore al tuo grado.`
          });
        }
      }

      const cleanCustomPerms = custom_permissions && typeof custom_permissions === 'object'
        ? JSON.stringify(custom_permissions)
        : null;

      const hash = await bcrypt.hash(password, 10);
      const [userRes] = await db.query(
        'INSERT INTO USERS (username, password_hash, role, requires_password_change, custom_permissions) VALUES (?, ?, ?, TRUE, ?)',
        [username.trim(), hash, targetRole.code, cleanCustomPerms]
      );

      clearUserAccessCache(userRes.insertId);

      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['CREATE_USER', `Creato utente ${username.trim()} (Ruolo: ${targetRole.name})`, 'Gestionale', caller.username]
      );

      if (fastify.io) fastify.io.emit('permissions_updated');

      return reply.code(201).send({ success: true, id: userRes.insertId, message: 'Utente creato con successo' });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return reply.code(400).send({ error: 'Lo username scelto è già in uso' });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore interno del server' });
    }
  });

  // PUT /api/users/:id/access - Aggiorna ruolo e/o permessi singoli di un utente
  fastify.put('/:id/access', async (request, reply) => {
    const { id } = request.params;
    const { role, custom_permissions } = request.body;
    const caller = request.callerAccess;
    const isCallerDeveloper = caller.role === 'developer';

    try {
      const targetUser = await resolveUserAccess(id, db);
      if (!targetUser) {
        return reply.code(404).send({ error: 'Utente non trovato' });
      }

      // Regola Gerarchica sull'utente bersaglio:
      // - Il Software Engineer può modificare se stesso e chiunque altro.
      // - Utente X con ruolo Y NON può modificare se stesso né utenti con ruolo pari o superiore al suo (sono bloccati).
      if (!isCallerDeveloper) {
        if (
          Number(targetUser.id) === Number(caller.id) ||
          targetUser.role === 'developer' ||
          targetUser.role === caller.role ||
          targetUser.hierarchy_level >= caller.hierarchy_level
        ) {
          return reply.code(403).send({
            error: `Accesso Bloccato: non puoi modificare l'utente "${targetUser.username}" perché appartiene a un ruolo pari o superiore al tuo.`
          });
        }
      }

      let nextRoleCode = targetUser.role;
      if (role && role !== targetUser.role) {
        const [roleRows] = await db.query('SELECT * FROM ROLES WHERE code = ?', [role]);
        if (roleRows.length === 0) {
          return reply.code(400).send({ error: 'Ruolo non trovato' });
        }
        const newRole = roleRows[0];
        const newLevel = newRole.code === 'developer' ? 10000 : Number(newRole.hierarchy_level) || 100;

        if (!isCallerDeveloper && (newRole.code === 'developer' || newRole.code === caller.role || newLevel >= caller.hierarchy_level)) {
          return reply.code(403).send({
            error: `Gerarchia Ruoli: non puoi assegnare il ruolo "${newRole.name}" perché è pari o superiore al tuo grado.`
          });
        }

        // Impedisci che l'ultimo Software Engineer si degradi lasciando il sistema senza Software Engineer
        if (targetUser.role === 'developer' && newRole.code !== 'developer') {
          const [devCountRows] = await db.query('SELECT COUNT(*) AS cnt FROM USERS WHERE role = "developer"');
          if ((devCountRows[0]?.cnt || 0) <= 1) {
            return reply.code(400).send({
              error: 'Impossibile cambiare ruolo: deve rimanere almeno un Software Engineer attivo nel sistema.'
            });
          }
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
    const isCallerDeveloper = caller.role === 'developer';

    try {
      const targetUser = await resolveUserAccess(id, db);
      if (!targetUser) {
        return reply.code(404).send({ error: 'Utente non trovato' });
      }

      // Il Software Engineer non può essere eliminato da nessuno, nemmeno da se stesso!
      if (targetUser.role === 'developer') {
        return reply.code(403).send({
          error: 'Il Software Engineer non può essere eliminato da nessuno, nemmeno da se stesso!'
        });
      }

      if (Number(id) === Number(caller.id)) {
        return reply.code(400).send({ error: 'Non puoi cancellare il tuo stesso account.' });
      }

      // Regola Gerarchica: puoi eliminare solo utenti appartenenti a ruoli strettamente inferiori al tuo
      if (!isCallerDeveloper && (targetUser.role === caller.role || targetUser.hierarchy_level >= caller.hierarchy_level)) {
        return reply.code(403).send({
          error: `Accesso Bloccato: non puoi eliminare "${targetUser.username}" perché appartiene a un ruolo di grado pari o superiore al tuo.`
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

      return { success: true, message: 'Utente eliminato con successo' };
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
    const isCallerDeveloper = caller.role === 'developer';

    if (!newPassword) {
      return reply.code(400).send({ error: 'La nuova password è obbligatoria' });
    }

    try {
      const targetUser = await resolveUserAccess(id, db);
      if (!targetUser) {
        return reply.code(404).send({ error: 'Utente non trovato' });
      }

      if (!isCallerDeveloper && (Number(targetUser.id) === Number(caller.id) || targetUser.role === 'developer' || targetUser.role === caller.role || targetUser.hierarchy_level >= caller.hierarchy_level)) {
        return reply.code(403).send({
          error: 'Accesso Bloccato: non puoi resettare la password di un utente di grado pari o superiore al tuo.'
        });
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
  // GESTIONE RUOLI E GERARCHIA DRAG & DROP (/api/users/roles)
  // ==========================================

  // PUT /api/users/roles/reorder - Riordina la gerarchia dei ruoli via Drag & Drop
  fastify.put('/roles/reorder', async (request, reply) => {
    const { orderedIds } = request.body;
    const caller = request.callerAccess;
    const isCallerDeveloper = caller.role === 'developer';

    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return reply.code(400).send({ error: 'Ordine ruoli non valido.' });
    }

    try {
      const [currentRoles] = await db.query('SELECT * FROM ROLES ORDER BY hierarchy_level DESC, id ASC');
      const devRole = currentRoles.find(r => r.code === 'developer');

      // Verifica che Software Engineer resti sempre in prima posizione assoluta
      if (devRole && Number(orderedIds[0]) !== Number(devRole.id)) {
        return reply.code(403).send({
          error: 'Il ruolo Software Engineer non può essere spostato: rimane sempre in cima alla gerarchia.'
        });
      }

      // Se l'utente non è Software Engineer, tutti i ruoli dal top fino al proprio ruolo incluso NON possono cambiare posizione
      if (!isCallerDeveloper) {
        const callerRoleIdx = currentRoles.findIndex(r => r.code === caller.role);
        const lockedSlice = callerRoleIdx >= 0
          ? currentRoles.slice(0, callerRoleIdx + 1)
          : currentRoles.filter(r => (Number(r.hierarchy_level) || 100) >= caller.hierarchy_level);

        for (let i = 0; i < lockedSlice.length; i++) {
          if (Number(orderedIds[i]) !== Number(lockedSlice[i].id)) {
            return reply.code(403).send({
              error: 'Puoi modificare la gerarchia solo al di sotto del tuo ruolo attuale.'
            });
          }
        }
      }

      const nonDevIds = orderedIds.filter(id => !devRole || Number(id) !== Number(devRole.id));
      await syncRoleHierarchyOrder(nonDevIds, db);

      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['REORDER_ROLES', 'Aggiornato ordine gerarchico dei ruoli (Drag & Drop)', 'Gestionale', caller.username]
      );

      if (fastify.io) fastify.io.emit('permissions_updated');

      return { success: true, message: 'Ordine gerarchico aggiornato con successo' };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante il riordino della gerarchia ruoli' });
    }
  });

  // POST /api/users/roles - Crea un nuovo ruolo nella gerarchia
  fastify.post('/roles', async (request, reply) => {
    const { name, code, description, color, permissions } = request.body;
    const caller = request.callerAccess;
    const isCallerDeveloper = caller.role === 'developer';

    if (!name || String(name).trim() === '') {
      return reply.code(400).send({ error: 'Il nome del ruolo è obbligatorio' });
    }

    const roleCode = sanitizeRoleCode(code || name);
    if (!roleCode || roleCode === 'developer') {
      return reply.code(400).send({ error: 'Codice ruolo non valido o riservato a Software Engineer' });
    }

    try {
      const cleanPerms = {};
      for (const k of ALL_PERMISSION_KEYS) {
        // Sia il Software Engineer sia un ruolo superiore con users_manage possono configurare i permessi dei ruoli sottostanti
        cleanPerms[k] = Boolean(permissions?.[k]);
      }
      cleanPerms.restricted_customers = Array.isArray(permissions?.restricted_customers)
        ? permissions.restricted_customers.map(Number).filter(Boolean)
        : [];

      // Posiziona il nuovo ruolo subito sotto il ruolo di chi lo crea (sotto Software Engineer se creato da Software Engineer)
      const [existingRoles] = await db.query('SELECT * FROM ROLES ORDER BY hierarchy_level DESC, id ASC');

      const [res] = await db.query(
        `INSERT INTO ROLES (code, name, description, color, hierarchy_level, is_system, permissions, created_by)
         VALUES (?, ?, ?, ?, ?, FALSE, ?, ?)`,
        [
          roleCode,
          String(name).trim(),
          description ? String(description).trim() : null,
          color || '#38bdf8',
          100,
          JSON.stringify(cleanPerms),
          caller.username
        ]
      );

      const newRoleId = res.insertId;
      const nonDevRoles = existingRoles.filter(r => r.code !== 'developer');
      let orderedNonDevIds = [];

      if (isCallerDeveloper) {
        // Inserito subito sotto il Software Engineer (in cima ai ruoli non-developer)
        orderedNonDevIds = [newRoleId, ...nonDevRoles.map(r => r.id)];
      } else {
        const callerIdx = nonDevRoles.findIndex(r => r.code === caller.role);
        if (callerIdx >= 0) {
          orderedNonDevIds = [
            ...nonDevRoles.slice(0, callerIdx + 1).map(r => r.id),
            newRoleId,
            ...nonDevRoles.slice(callerIdx + 1).map(r => r.id)
          ];
        } else {
          orderedNonDevIds = [...nonDevRoles.map(r => r.id), newRoleId];
        }
      }

      await syncRoleHierarchyOrder(orderedNonDevIds, db);

      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['CREATE_ROLE', `Creato nuovo ruolo "${name}"`, 'Gestionale', caller.username]
      );

      if (fastify.io) fastify.io.emit('permissions_updated');

      return reply.code(201).send({
        success: true,
        role_id: newRoleId,
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
    const { name, description, color, permissions } = request.body;
    const caller = request.callerAccess;
    const isCallerDeveloper = caller.role === 'developer';

    try {
      const [rows] = await db.query('SELECT * FROM ROLES WHERE id = ?', [id]);
      if (rows.length === 0) {
        return reply.code(404).send({ error: 'Ruolo non trovato' });
      }
      const targetRole = rows[0];
      const currentTargetLevel = targetRole.code === 'developer' ? 10000 : (Number(targetRole.hierarchy_level) || 100);

      // Regola Gerarchica:
      // - Il Software Engineer può modificare qualsiasi ruolo (incluso il proprio)
      // - Utente X con ruolo Y NON può modificare il proprio ruolo Y né quelli sopra di lui (solo quelli strettamente sotto)
      if (!isCallerDeveloper) {
        if (targetRole.code === 'developer' || targetRole.code === caller.role || currentTargetLevel >= caller.hierarchy_level) {
          return reply.code(403).send({
            error: `Accesso Bloccato: non puoi modificare il ruolo "${targetRole.name}" perché è pari o superiore al tuo grado.`
          });
        }
      }

      const existingPerms = parseJsonSafe(targetRole.permissions, {});
      const cleanPerms = {};
      for (const k of ALL_PERMISSION_KEYS) {
        cleanPerms[k] = permissions !== undefined ? Boolean(permissions[k]) : Boolean(existingPerms[k]);
      }
      if (targetRole.code === 'developer') {
        cleanPerms.view_users = true;
        cleanPerms.users_manage = true;
      }
      cleanPerms.restricted_customers = Array.isArray(permissions?.restricted_customers)
        ? permissions.restricted_customers.map(Number).filter(Boolean)
        : (Array.isArray(existingPerms.restricted_customers) ? existingPerms.restricted_customers : []);

      const finalName = targetRole.code === 'developer'
        ? 'Software Engineer'
        : (name ? String(name).trim() : targetRole.name);

      await db.query(
        `UPDATE ROLES
         SET name = ?, description = ?, color = ?, permissions = ?
         WHERE id = ?`,
        [
          finalName,
          description !== undefined ? (description ? String(description).trim() : null) : targetRole.description,
          color || targetRole.color || '#38bdf8',
          JSON.stringify(cleanPerms),
          id
        ]
      );

      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['UPDATE_ROLE', `Aggiornato ruolo "${finalName}"`, 'Gestionale', caller.username]
      );

      if (fastify.io) fastify.io.emit('permissions_updated');

      return { success: true, message: `Ruolo "${finalName}" salvato con successo` };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore salvataggio ruolo' });
    }
  });

  // DELETE /api/users/roles/:id - Elimina un ruolo
  fastify.delete('/roles/:id', async (request, reply) => {
    const { id } = request.params;
    const caller = request.callerAccess;
    const isCallerDeveloper = caller.role === 'developer';

    try {
      const [rows] = await db.query('SELECT * FROM ROLES WHERE id = ?', [id]);
      if (rows.length === 0) {
        return reply.code(404).send({ error: 'Ruolo non trovato' });
      }
      const targetRole = rows[0];

      if (targetRole.code === 'developer') {
        return reply.code(403).send({
          error: 'Il ruolo Software Engineer non può essere eliminato da nessuno, nemmeno da se stesso!'
        });
      }
      if (targetRole.code === 'operator') {
        return reply.code(400).send({ error: 'Il ruolo base Operatore non può essere eliminato.' });
      }

      const targetLevel = Number(targetRole.hierarchy_level) || 100;
      if (!isCallerDeveloper && (targetRole.code === caller.role || targetLevel >= caller.hierarchy_level)) {
        return reply.code(403).send({
          error: `Accesso Bloccato: non puoi eliminare il ruolo "${targetRole.name}" perché è di grado pari o superiore al tuo.`
        });
      }

      // Sposta eventuali utenti associati a questo ruolo sul ruolo base 'operator'
      await db.query('UPDATE USERS SET role = ? WHERE role = ?', ['operator', targetRole.code]);
      await db.query('DELETE FROM ROLES WHERE id = ?', [id]);
      await syncRoleHierarchyOrder(null, db);

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
