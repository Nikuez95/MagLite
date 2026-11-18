const db = require('../config/db');

/**
 * Crea una notifica persistente su DB ed emette un evento Socket.io in tempo reale.
 * Eventuali errori di notifica non devono mai bloccare il flusso operativo principale.
 */
async function createNotification(connectionOrDb, fastifyIo, payload) {
  const runner = connectionOrDb || db;
  try {
    const {
      type = 'SYSTEM',
      title,
      message,
      customer_id = null,
      customer_name = null,
      entity_type = null,
      entity_code = null,
      link_path = null,
      actor_username = null
    } = payload || {};

    if (!title || !message) return null;

    let resolvedCustomerName = customer_name;
    if (customer_id && !resolvedCustomerName) {
      const [cRows] = await runner.query('SELECT business_name FROM CUSTOMERS WHERE id = ? LIMIT 1', [customer_id]);
      if (cRows.length > 0) resolvedCustomerName = cRows[0].business_name;
    }

    const [res] = await runner.query(
      `INSERT INTO NOTIFICATIONS
       (type, title, message, customer_id, customer_name, entity_type, entity_code, link_path, actor_username)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        type,
        String(title).slice(0, 255),
        String(message),
        customer_id || null,
        resolvedCustomerName || null,
        entity_type || null,
        entity_code || null,
        link_path || null,
        actor_username || null
      ]
    );

    const created = {
      id: res.insertId,
      type,
      title,
      message,
      customer_id: customer_id || null,
      customer_name: resolvedCustomerName || null,
      entity_type: entity_type || null,
      entity_code: entity_code || null,
      link_path: link_path || null,
      actor_username: actor_username || null,
      created_at: new Date().toISOString()
    };

    if (fastifyIo) {
      fastifyIo.emit('notification_created', created);
    }

    return created;
  } catch (err) {
    console.warn('[NOTIFICATION WARNING]', err.message);
    return null;
  }
}

module.exports = { createNotification };
