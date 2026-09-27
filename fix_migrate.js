const fs = require('fs');
let code = fs.readFileSync('backend/src/scripts/migrate.js', 'utf8');
code = code.replace('"ALTER TABLE PALLETS ADD COLUMN pallet_uom VARCHAR(50) DEFAULT NULL;",
      "ALTER TABLE PRODUCTS MODIFY uom VARCHAR(50) NOT NULL DEFAULT \'Scatole\';",', '"ALTER TABLE PALLETS ADD COLUMN pallet_uom VARCHAR(50) DEFAULT NULL;",\n      "ALTER TABLE PRODUCTS MODIFY uom VARCHAR(50) NOT NULL DEFAULT \'Scatole\';",');
fs.writeFileSync('backend/src/scripts/migrate.js', code);
