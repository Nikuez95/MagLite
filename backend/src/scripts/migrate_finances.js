const db = require('../config/db');

async function migrateFinances() {
  const conn = await db.getConnection();
  try {
    // 1. INVOICES table (saved proformas)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id INT AUTO_INCREMENT PRIMARY KEY,
        customer_id INT NOT NULL,
        period_month INT NOT NULL,
        period_year INT NOT NULL,
        base_total DECIMAL(10, 2) NOT NULL,
        vat_amount DECIMAL(10, 2) NOT NULL,
        grand_total DECIMAL(10, 2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY \`unique_proforma\` (customer_id, period_month, period_year)
      )
    `);

    // 2. EXPENSES table (uscite aziendali)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        description VARCHAR(255) NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        expense_date DATE NOT NULL,
        category VARCHAR(100) DEFAULT 'Generale',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log("Migrazione Finanze completata con successo!");
  } catch (err) {
    console.error("Errore migrazione finanze:", err);
  } finally {
    conn.release();
    process.exit();
  }
}

migrateFinances();
