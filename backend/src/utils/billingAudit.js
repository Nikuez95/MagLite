const db = require('../config/db');

/**
 * Registra un evento nello Storico Separato Fatturazione (BILLING_AUDIT_LOGS).
 * Non deve mai interrompere il flusso chiamante in caso di errore secondario.
 */
async function logBillingAudit(connectionOrDb, payload) {
  const runner = connectionOrDb || db;
  try {
    const {
      action,
      customer_id = null,
      customer_name = null,
      entity_ref = null,
      details,
      metadata = null,
      username = 'Sistema',
      source = 'Fatturazione'
    } = payload || {};

    if (!action || !details) return null;

    let resolvedCustName = customer_name;
    if (customer_id && !resolvedCustName) {
      const [cRows] = await runner.query('SELECT business_name FROM CUSTOMERS WHERE id = ? LIMIT 1', [customer_id]);
      if (cRows.length > 0) resolvedCustName = cRows[0].business_name;
    }

    const [res] = await runner.query(
      `INSERT INTO BILLING_AUDIT_LOGS
       (action, customer_id, customer_name, entity_ref, details, metadata, username, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(action).slice(0, 80),
        customer_id ? Number(customer_id) : null,
        resolvedCustName ? String(resolvedCustName).slice(0, 255) : null,
        entity_ref ? String(entity_ref).slice(0, 120) : null,
        String(details),
        metadata ? JSON.stringify(metadata) : null,
        String(username || 'Sistema').slice(0, 100),
        String(source || 'Fatturazione').slice(0, 50)
      ]
    );
    return res.insertId;
  } catch (err) {
    console.warn('[BILLING AUDIT WARNING]', err.message);
    return null;
  }
}

module.exports = { logBillingAudit };
