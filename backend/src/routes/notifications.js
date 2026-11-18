const db = require('../config/db');
const { canAccessCustomer, parseJsonSafe, clearUserAccessCache } = require('../utils/permissions');

const NOTIFICATION_TYPES = [
  { key: 'ORDER_COMPLETED', label: 'Completamento Ordini / Spedizioni' },
  { key: 'ORDER_CREATED', label: 'Nuovi Ordini Outbound' },
  { key: 'ORDER_RETURNED', label: 'Resi Spedizioni' },
  { key: 'INBOUND_COMPLETED', label: 'DDT Entrata Completati' },
  { key: 'INBOUND_DISCREPANCY', label: 'Discrepanze DDT Entrata' },
  { key: 'QUARANTINE_BLOCKED', label: 'Blocchi Quarantena' },
  { key: 'TICKET_UPDATE', label: 'Aggiornamenti Ticket' },
  { key: 'TICKET_CREATED', label: 'Nuovi Ticket Segnalazione' }
];

async function getUserNotificationPrefs(userId) {
  const [[userRow]] = await db.query('SELECT preferences FROM USERS WHERE id = ?', [userId]);
  const prefs = parseJsonSafe(userRow?.preferences, {});
  const mutedTypes = Array.isArray(prefs?.notifications?.muted_types)
    ? prefs.notifications.muted_types
    : [];

  const [custRows] = await db.query(
    'SELECT customer_id FROM USER_NOTIFICATION_CUSTOMER_SETTINGS WHERE user_id = ? AND is_muted = 1',
    [userId]
  );
  const mutedCustomerIds = custRows.map(r => Number(r.customer_id));

  return { prefs, mutedTypes, mutedCustomerIds };
}

async function notificationsRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  // GET /api/notifications - Lista notifiche filtrate per cliente e preferenze utente
  fastify.get('/', async (request, reply) => {
    try {
      const userId = request.user.id;
      const {
        limit = 50,
        unread_only = 'false',
        type = 'ALL',
        customer_id = 'ALL',
        include_muted = 'false'
      } = request.query || {};

      const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
      const onlyUnread = unread_only === 'true' || unread_only === '1';
      const showMuted = include_muted === 'true' || include_muted === '1';

      const { mutedTypes, mutedCustomerIds } = await getUserNotificationPrefs(userId);
      const mutedCustSet = new Set(mutedCustomerIds);
      const mutedTypeSet = new Set(mutedTypes);

      const params = [userId];
      let whereClause = 'WHERE 1=1';

      if (type && type !== 'ALL') {
        whereClause += ' AND n.type = ?';
        params.push(type);
      }

      if (customer_id && customer_id !== 'ALL') {
        whereClause += ' AND n.customer_id = ?';
        params.push(Number(customer_id));
      }

      if (onlyUnread) {
        whereClause += ' AND nr.notification_id IS NULL';
      }

      // Recuperiamo fino a 250 recenti e poi applichiamo filtro accessi cliente & mute per calcolo esatto
      const [rawRows] = await db.query(`
        SELECT n.id, n.type, n.title, n.message, n.customer_id, n.customer_name,
               n.entity_type, n.entity_code, n.link_path, n.actor_username, n.created_at,
               IF(nr.notification_id IS NOT NULL, 1, 0) AS is_read
        FROM NOTIFICATIONS n
        LEFT JOIN NOTIFICATION_READS nr
          ON nr.notification_id = n.id AND nr.user_id = ?
        ${whereClause}
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT 250
      `, params);

      const permittedRows = rawRows.filter(n => !n.customer_id || canAccessCustomer(request.user, n.customer_id));

      const visibleRows = permittedRows.filter(n => {
        if (showMuted) return true;
        if (n.customer_id && mutedCustSet.has(Number(n.customer_id))) return false;
        if (mutedTypeSet.has(n.type)) return false;
        return true;
      });

      const unreadCount = visibleRows.filter(n => !n.is_read).length;

      return {
        notifications: visibleRows.slice(0, safeLimit).map(n => ({
          ...n,
          is_read: Boolean(n.is_read),
          is_customer_muted: n.customer_id ? mutedCustSet.has(Number(n.customer_id)) : false
        })),
        unread_count: unreadCount,
        muted_customer_ids: mutedCustomerIds,
        muted_types: mutedTypes,
        available_types: NOTIFICATION_TYPES
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore nel recupero delle notifiche' });
    }
  });

  // GET /api/notifications/preferences - Stato preferenze notifiche per cliente e tipologia
  fastify.get('/preferences', async (request, reply) => {
    try {
      const userId = request.user.id;
      const { mutedTypes, mutedCustomerIds } = await getUserNotificationPrefs(userId);
      const mutedSet = new Set(mutedCustomerIds);

      const [customers] = await db.query(
        'SELECT id, unique_id, business_name, parent_id FROM CUSTOMERS ORDER BY business_name ASC'
      );

      const accessibleCustomers = customers
        .filter(c => canAccessCustomer(request.user, c.id))
        .map(c => ({
          id: c.id,
          unique_id: c.unique_id,
          business_name: c.business_name,
          parent_id: c.parent_id,
          is_muted: mutedSet.has(Number(c.id))
        }));

      return {
        customers: accessibleCustomers,
        muted_customer_ids: mutedCustomerIds,
        muted_types: mutedTypes,
        available_types: NOTIFICATION_TYPES
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore recupero preferenze notifiche' });
    }
  });

  // PUT /api/notifications/preferences - Salva clienti disabilitati e tipi notifiche disabilitati
  fastify.put('/preferences', async (request, reply) => {
    const userId = request.user.id;
    const { muted_customer_ids, muted_types } = request.body || {};

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      if (Array.isArray(muted_customer_ids)) {
        await connection.query('DELETE FROM USER_NOTIFICATION_CUSTOMER_SETTINGS WHERE user_id = ?', [userId]);
        const uniqueIds = [...new Set(muted_customer_ids.map(Number).filter(n => Number.isInteger(n) && n > 0))];
        for (const cid of uniqueIds) {
          await connection.query(
            `INSERT INTO USER_NOTIFICATION_CUSTOMER_SETTINGS (user_id, customer_id, is_muted)
             VALUES (?, ?, 1)`,
            [userId, cid]
          );
        }
      }

      if (Array.isArray(muted_types)) {
        const [[userRow]] = await connection.query('SELECT preferences FROM USERS WHERE id = ?', [userId]);
        const currentPrefs = parseJsonSafe(userRow?.preferences, {});
        const updatedPrefs = {
          ...(currentPrefs && typeof currentPrefs === 'object' ? currentPrefs : {}),
          notifications: {
            ...(currentPrefs?.notifications || {}),
            muted_types: [...new Set(muted_types.map(String))]
          }
        };
        await connection.query('UPDATE USERS SET preferences = ? WHERE id = ?', [JSON.stringify(updatedPrefs), userId]);
        clearUserAccessCache(userId);
      }

      await connection.commit();
      return { success: true };
    } catch (err) {
      await connection.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore salvataggio preferenze notifiche' });
    } finally {
      connection.release();
    }
  });

  // POST /api/notifications/customer/:customerId/toggle - Disattiva/riattiva notifiche per un singolo cliente
  fastify.post('/customer/:customerId/toggle', async (request, reply) => {
    const userId = request.user.id;
    const customerId = Number(request.params.customerId);
    const { mute } = request.body || {};

    if (!customerId || isNaN(customerId)) {
      return reply.code(400).send({ error: 'Cliente non valido' });
    }

    try {
      const [[existing]] = await db.query(
        'SELECT is_muted FROM USER_NOTIFICATION_CUSTOMER_SETTINGS WHERE user_id = ? AND customer_id = ?',
        [userId, customerId]
      );

      const nextMuted = mute !== undefined ? Boolean(mute) : !(existing?.is_muted);

      if (nextMuted) {
        await db.query(
          `INSERT INTO USER_NOTIFICATION_CUSTOMER_SETTINGS (user_id, customer_id, is_muted)
           VALUES (?, ?, 1)
           ON DUPLICATE KEY UPDATE is_muted = 1`,
          [userId, customerId]
        );
      } else {
        await db.query(
          'DELETE FROM USER_NOTIFICATION_CUSTOMER_SETTINGS WHERE user_id = ? AND customer_id = ?',
          [userId, customerId]
        );
      }

      return { success: true, customer_id: customerId, is_muted: nextMuted };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore aggiornamento filtro cliente' });
    }
  });

  // POST /api/notifications/:id/read - Segna una notifica come letta
  fastify.post('/:id/read', async (request, reply) => {
    try {
      await db.query(
        'INSERT IGNORE INTO NOTIFICATION_READS (user_id, notification_id) VALUES (?, ?)',
        [request.user.id, Number(request.params.id)]
      );
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore aggiornamento lettura notifica' });
    }
  });

  // POST /api/notifications/read-all - Segna tutte le notifiche visibili come lette
  fastify.post('/read-all', async (request, reply) => {
    try {
      const userId = request.user.id;
      const { mutedTypes, mutedCustomerIds } = await getUserNotificationPrefs(userId);
      const mutedCustSet = new Set(mutedCustomerIds);
      const mutedTypeSet = new Set(mutedTypes);

      const [unread] = await db.query(`
        SELECT n.id, n.customer_id, n.type
        FROM NOTIFICATIONS n
        LEFT JOIN NOTIFICATION_READS nr
          ON nr.notification_id = n.id AND nr.user_id = ?
        WHERE nr.notification_id IS NULL
        ORDER BY n.id DESC
        LIMIT 300
      `, [userId]);

      const toMark = unread
        .filter(n => !n.customer_id || canAccessCustomer(request.user, n.customer_id))
        .filter(n => !(n.customer_id && mutedCustSet.has(Number(n.customer_id))))
        .filter(n => !mutedTypeSet.has(n.type))
        .map(n => [userId, n.id]);

      if (toMark.length > 0) {
        await db.query('INSERT IGNORE INTO NOTIFICATION_READS (user_id, notification_id) VALUES ?', [toMark]);
      }

      return { success: true, marked: toMark.length };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore segnatura notifiche come lette' });
    }
  });
}

module.exports = notificationsRoutes;
