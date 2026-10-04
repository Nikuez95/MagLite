const fs = require('fs');
let code = fs.readFileSync('backend/src/scripts/migrate.js', 'utf8');

const queriesToAdd = `
      "CREATE TABLE IF NOT EXISTS INBOUND_DDTS (id INT AUTO_INCREMENT PRIMARY KEY, ddt_number VARCHAR(50) NOT NULL UNIQUE, customer_id INT NOT NULL, status ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'DISCREPANCY') DEFAULT 'PENDING', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, closed_at DATETIME DEFAULT NULL, notes TEXT);",
      "CREATE TABLE IF NOT EXISTS INBOUND_DDT_ITEMS (id INT AUTO_INCREMENT PRIMARY KEY, inbound_ddt_id INT NOT NULL, product_id INT NOT NULL, expected_quantity DECIMAL(10,2) NOT NULL, actual_quantity DECIMAL(10,2) DEFAULT 0, units_per_box INT, boxes_per_pallet INT, pallet_uom VARCHAR(50), batch VARCHAR(50), client_pallet_number VARCHAR(100), client_article_number VARCHAR(100), expiration_date DATE, notes TEXT, FOREIGN KEY (inbound_ddt_id) REFERENCES INBOUND_DDTS(id) ON DELETE CASCADE);",
      "ALTER TABLE PALLETS ADD COLUMN inbound_ddt_id INT DEFAULT NULL;",
`;

if (!code.includes('INBOUND_DDTS')) {
  code = code.replace(
    'const queries = [',
    'const queries = [\n' + queriesToAdd
  );
  fs.writeFileSync('backend/src/scripts/migrate.js', code);
  console.log("Migrations added");
} else {
  console.log("Already added");
}
