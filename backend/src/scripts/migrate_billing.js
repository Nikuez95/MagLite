const db = require('../config/db');

async function migrateBilling() {
  const conn = await db.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS billing_rules (
        id INT AUTO_INCREMENT PRIMARY KEY,
        rule_code VARCHAR(50) NOT NULL UNIQUE,
        description VARCHAR(255) NOT NULL,
        default_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        rule_type ENUM('EVENT', 'STORAGE', 'FLAG') NOT NULL
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS client_tariffs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        customer_id INT NOT NULL,
        rule_code VARCHAR(50) NOT NULL,
        custom_price DECIMAL(10,2) NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY(customer_id, rule_code)
      )
    `);

    // Inserimento regole base
    const baseRules = [
      ['IN_PALLET', 'Ingresso Paletta', 20.00, 'EVENT'],
      ['OUT_PALLET', 'Uscita Paletta', 20.00, 'EVENT'],
      ['SOSTA_15', 'Sosta (Ingresso <= 15)', 4.00, 'STORAGE'],
      ['SOSTA_MAGGIORE_15', 'Sosta (Ingresso > 15)', 8.00, 'STORAGE']
    ];
    for (const rule of baseRules) {
      await conn.query('INSERT IGNORE INTO billing_rules (rule_code, description, default_price, rule_type) VALUES (?, ?, ?, ?)', rule);
    }

    try {
      await conn.query('ALTER TABLE PALLETS ADD COLUMN shipped_at DATETIME NULL');
    } catch(e) { /* Se la colonna esiste, ignora */ }

    console.log("Migrazione Billing completata con successo!");
  } catch (err) {
    console.error("Errore migrazione billing:", err);
  } finally {
    conn.release();
    process.exit();
  }
}

migrateBilling();
