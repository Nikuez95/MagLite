const db = require('../config/db');

async function checkAndQuarantineExpiredBatches(io = null, logger = console) {
  try {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Trova palette attive con data scadenza superata e non ancora in quarantena
      const [expiredPallets] = await connection.query(`
        SELECT p.*, pr.name as product_name, pr.sku, COALESCE(p.pallet_uom, pr.uom) as uom, c.business_name as customer_name
        FROM PALLETS p
        JOIN PRODUCTS pr ON p.product_id = pr.id
        JOIN CUSTOMERS c ON p.customer_id = c.id
        WHERE (p.is_quarantined = FALSE OR p.is_quarantined IS NULL)
          AND p.status != 'SHIPPED'
          AND p.quantity > 0
          AND p.expiration_date IS NOT NULL
          AND p.expiration_date < CURDATE()
      `);

      if (expiredPallets.length === 0) {
        await connection.commit();
        return { count: 0, pallets: [] };
      }

      logger.info(`[GDP CRON] Rilevati ${expiredPallets.length} lotti scaduti in magazzino. Avvio procedura di auto-quarantena GDP...`);

      const ids = expiredPallets.map(p => p.id);
      await connection.query(
        `UPDATE PALLETS
         SET is_quarantined = TRUE,
             quarantine_reason = 'Prodotto Scaduto (Auto-FEFO)',
             quarantined_at = CURRENT_TIMESTAMP,
             quarantined_by = 'SISTEMA (Auto-FEFO)',
             quarantine_notes = 'Rilevata scadenza superata durante controllo automatico conformità GDP'
         WHERE id IN (?)`,
        [ids]
      );

      for (const pal of expiredPallets) {
        const expStr = pal.expiration_date ? new Date(pal.expiration_date).toLocaleDateString('it-IT') : 'N/D';
        await connection.query(
          `INSERT INTO QUARANTINE_LOGS
           (pallet_id, pallet_code, product_id, product_name, sku, customer_id, customer_name, batch, quantity, uom, location, status, block_reason, block_notes, blocked_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUARANTINED', 'Prodotto Scaduto (Auto-FEFO)', ?, 'SISTEMA (Auto-FEFO)')`,
          [
            pal.id,
            pal.pallet_code,
            pal.product_id,
            pal.product_name,
            pal.sku,
            pal.customer_id,
            pal.customer_name,
            pal.batch || null,
            pal.quantity,
            pal.uom || 'Pezzi',
            pal.location || 'IN ATTESA',
            `Scadenza superata il ${expStr}`
          ]
        );

        await connection.query(
          'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
          [
            'QUARANTINE_BLOCK',
            `Auto-blocco GDP: paletta ${pal.pallet_code} (Lotto: ${pal.batch || 'N/D'}, Prodotto: ${pal.product_name}) scaduta il ${expStr}`,
            'Sistema GDP',
            'SISTEMA (Auto-FEFO)'
          ]
        );
      }

      await connection.commit();

      if (io) {
        io.emit('quarantine_updated', { count: expiredPallets.length });
        io.emit('dashboard_update');
      }

      logger.info(`[GDP CRON] Bloccate con successo ${expiredPallets.length} palette scadute in Quarantena.`);
      return { count: expiredPallets.length, pallets: expiredPallets };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    logger.error('[GDP CRON] Errore durante l\'auto-quarantena dei lotti scaduti:', err);
    return { count: 0, error: err.message };
  }
}

function startGdpAutoQuarantineCron(io = null, logger = console) {
  // 1. Esegui subito all'avvio
  checkAndQuarantineExpiredBatches(io, logger).catch(() => {});

  // 2. Controllo periodico ogni ora
  const INTERVAL_MS = 60 * 60 * 1000;
  setInterval(() => {
    checkAndQuarantineExpiredBatches(io, logger).catch(() => {});
  }, INTERVAL_MS);
}

module.exports = {
  checkAndQuarantineExpiredBatches,
  startGdpAutoQuarantineCron
};
