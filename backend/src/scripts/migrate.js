const db = require('../config/db');

async function runMigrations() {
  const connection = await db.getConnection();
  try {
    console.log('Running automatic database migrations...');
    
    const queries = [

      "CREATE TABLE IF NOT EXISTS INBOUND_DDTS (id INT AUTO_INCREMENT PRIMARY KEY, ddt_number VARCHAR(50) NOT NULL UNIQUE, customer_id INT NOT NULL, status ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'DISCREPANCY') DEFAULT 'PENDING', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, closed_at DATETIME DEFAULT NULL, notes TEXT);",
      "CREATE TABLE IF NOT EXISTS INBOUND_DDT_ITEMS (id INT AUTO_INCREMENT PRIMARY KEY, inbound_ddt_id INT NOT NULL, product_id INT NOT NULL, expected_quantity DECIMAL(10,2) NOT NULL, actual_quantity DECIMAL(10,2) DEFAULT 0, units_per_box INT, boxes_per_pallet INT, pallet_uom VARCHAR(50), batch VARCHAR(50), client_pallet_number VARCHAR(100), client_article_number VARCHAR(100), expiration_date DATE, notes TEXT, FOREIGN KEY (inbound_ddt_id) REFERENCES INBOUND_DDTS(id) ON DELETE CASCADE);",
      "ALTER TABLE PALLETS ADD COLUMN inbound_ddt_id INT DEFAULT NULL;",

      "CREATE TABLE IF NOT EXISTS FREE_LOCATIONS (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);",
      "ALTER TABLE PALLETS DROP INDEX pallet_code;",
      "ALTER TABLE OUTBOUND_ORDERS ADD COLUMN client_ddt VARCHAR(100) DEFAULT NULL;",
      "ALTER TABLE OUTBOUND_ORDERS ADD COLUMN start_picking_at DATETIME DEFAULT NULL;",
      "ALTER TABLE OUTBOUND_ORDERS ADD COLUMN end_picking_at DATETIME DEFAULT NULL;",
      "ALTER TABLE OUTBOUND_ORDERS ADD COLUMN shipped_at DATETIME DEFAULT NULL;",
      "ALTER TABLE OUTBOUND_ORDERS ADD COLUMN picking_operator VARCHAR(100) DEFAULT NULL;",
      "ALTER TABLE OUTBOUND_ITEMS ADD COLUMN picked_at DATETIME DEFAULT NULL;",
      "ALTER TABLE PALLETS ADD COLUMN pallet_uom VARCHAR(50) DEFAULT NULL;",
      "ALTER TABLE PRODUCTS MODIFY uom VARCHAR(50) NOT NULL DEFAULT 'Scatole';",
      "ALTER TABLE USERS ADD COLUMN preferences JSON DEFAULT NULL;",
      "ALTER TABLE PRODUCTS ADD COLUMN default_article_number VARCHAR(100) DEFAULT NULL;",
      "ALTER TABLE PRODUCTS ADD COLUMN flags JSON DEFAULT NULL;",
      "ALTER TABLE PALLETS ADD COLUMN flags JSON DEFAULT NULL;",
      "ALTER TABLE invoices ADD COLUMN invoice_data JSON DEFAULT NULL;",
      "ALTER TABLE invoices ADD COLUMN is_paid BOOLEAN DEFAULT FALSE;"
    ];

    for (const query of queries) {
      try {
        await connection.query(query);
      } catch (err) {
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

