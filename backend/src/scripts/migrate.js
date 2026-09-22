const db = require('../config/db');

async function runMigrations() {
  const connection = await db.getConnection();
  try {
    console.log('Running automatic database migrations...');
    
    const queries = [
      "ALTER TABLE OUTBOUND_ORDERS ADD COLUMN client_ddt VARCHAR(100) DEFAULT NULL;",
      "ALTER TABLE OUTBOUND_ORDERS ADD COLUMN start_picking_at DATETIME DEFAULT NULL;",
      "ALTER TABLE OUTBOUND_ORDERS ADD COLUMN end_picking_at DATETIME DEFAULT NULL;",
      "ALTER TABLE OUTBOUND_ORDERS ADD COLUMN shipped_at DATETIME DEFAULT NULL;",
      "ALTER TABLE OUTBOUND_ORDERS ADD COLUMN picking_operator VARCHAR(100) DEFAULT NULL;",
      "ALTER TABLE OUTBOUND_ITEMS ADD COLUMN picked_at DATETIME DEFAULT NULL;",
      "ALTER TABLE PALLETS ADD COLUMN pallet_uom VARCHAR(50) DEFAULT NULL;"
    ];

    for (const query of queries) {
      try {
        await connection.query(query);
      } catch (err) {
        // Ignora l'errore se la colonna esiste già (ER_DUP_FIELDNAME)
        if (err.code !== 'ER_DUP_FIELDNAME' && err.code !== 'ER_DUP_KEY') {
          console.warn(`Migration note for query [${query}]:`, err.message);
        }
      }
    }
    console.log('Migrations completed successfully.');
  } catch (err) {
    console.error('Error during migrations:', err);
  } finally {
    connection.release();
  }
}

module.exports = runMigrations;
