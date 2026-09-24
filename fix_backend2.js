const fs = require('fs');

let content = fs.readFileSync('backend/src/routes/pallets.js', 'utf8');

// Replace codes with ids
content = content.replace(
  /const { codes, paper_format = 'A4', print_mode = 'GRID' } = request\.body;\s+if \(!codes \|\| !Array\.isArray\(codes\) \|\| codes\.length === 0\) \{\s+return reply\.code\(400\)\.send\(\{ error: 'Nessun codice fornito' \}\);\s+\}/,
  \const { ids, paper_format = 'A4', print_mode = 'GRID', copies = 1 } = request.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return reply.code(400).send({ error: 'Nessun ID fornito' });
    }\
);

// Replace for loop
content = content.replace(
  /for \(const code of codes\) \{[\s\S]*?const \[rows\] = await db\.query\(\\s+SELECT p\.\*, pr\.name as product_name, c\.business_name as customer_name\s+FROM PALLETS p\s+JOIN PRODUCTS pr ON p\.product_id = pr\.id\s+JOIN CUSTOMERS c ON p\.customer_id = c\.id\s+WHERE p\.pallet_code = \?\s+\, \[code\]\);/,
  \// Fetch distinct pallet_codes for the selected IDs
      const [codeRows] = await db.query('SELECT DISTINCT pallet_code FROM PALLETS WHERE id IN (?)', [ids]);
      const codes = codeRows.map(r => r.pallet_code);

      for (const code of codes) {
        const [rows] = await db.query('SELECT p.*, pr.name as product_name, c.business_name as customer_name FROM PALLETS p JOIN PRODUCTS pr ON p.product_id = pr.id JOIN CUSTOMERS c ON p.customer_id = c.id WHERE p.pallet_code = ?', [code]);\
);

// Apply copies logic
content = content.replace(
  /const generatedLabelsData = \[\];/g,
  \const generatedLabelsData = [];\
);

// Expand labels with copies
content = content.replace(
  /expiration_date: pallet\.expiration_date\s+\}\);\s+\}/g,
  \expiration_date: pallet.expiration_date
          });
        }
        
        const finalLabels = [];
        for (const lbl of generatedLabelsData) {
          for (let i = 0; i < copies; i++) {
            finalLabels.push(lbl);
          }
        }
\
);

// Change generatedLabelsData to finalLabels
content = content.replace(/for \(let i = 0; i < generatedLabelsData\.length; i\+\+\) \{/g, 'for (let i = 0; i < finalLabels.length; i++) {');
content = content.replace(/generatedLabelsData\[i\]/g, 'finalLabels[i]');

fs.writeFileSync('backend/src/routes/pallets.js', content, 'utf8');
