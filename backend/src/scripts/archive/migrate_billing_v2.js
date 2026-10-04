const db = require('../config/db');

async function migrateBillingV2() {
  const conn = await db.getConnection();
  try {
    // 1. SETTINGS table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS settings (
        setting_key VARCHAR(100) PRIMARY KEY,
        setting_value TEXT
      )
    `);

    // 2. Expand billing_rules enum
    // In MySQL, to expand ENUM you just modify the column.
    // We add 'DISCOUNT_PERCENT', 'DISCOUNT_FIXED', 'MANUAL'
    await conn.query(`
      ALTER TABLE billing_rules 
      MODIFY COLUMN rule_type ENUM('EVENT', 'STORAGE', 'FLAG', 'DISCOUNT_PERCENT', 'DISCOUNT_FIXED', 'MANUAL') NOT NULL
    `);

    console.log("Migrazione Billing V2 completata con successo!");
  } catch (err) {
    console.error("Errore migrazione billing v2:", err);
  } finally {
    conn.release();
    process.exit();
  }
}

migrateBillingV2();
