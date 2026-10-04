const db = require('../config/db');

async function migrateFinancesV2() {
  const conn = await db.getConnection();
  try {
    console.log("Adding is_paid to invoices...");
    try {
      await conn.query('ALTER TABLE invoices ADD COLUMN is_paid BOOLEAN DEFAULT FALSE');
    } catch(e) {
      if(e.code !== 'ER_DUP_FIELDNAME') throw e;
    }

    console.log("Adding invoice_data to invoices...");
    try {
      await conn.query('ALTER TABLE invoices ADD COLUMN invoice_data JSON DEFAULT NULL');
    } catch(e) {
      if(e.code !== 'ER_DUP_FIELDNAME') throw e;
    }

    console.log("Migrazione Finanze V2 completata con successo sul database!");
  } catch (err) {
    console.error("Errore migrazione finanze v2:", err);
  } finally {
    conn.release();
    process.exit();
  }
}

migrateFinancesV2();
