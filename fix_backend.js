const fs = require("fs");

let content = fs.readFileSync("backend/src/routes/pallets.js", "utf8");

const oldStr = `  fastify.post('/print-bulk', async (request, reply) => {
    const { codes, paper_format = 'A4', print_mode = 'GRID' } = request.body;
    if (!codes || !Array.isArray(codes) || codes.length === 0) {
      return reply.code(400).send({ error: 'Nessun codice fornito' });
    }

    try {
      const generatedLabelsData = [];
      
      for (const code of codes) {
        // Fetch each pallet code. Note that if it's mixed, multiple rows have the same code. 
        // We handle mixed pallets the same way as single pallets: just print one label representing the mixed pallet?
        // Wait, if it's mixed, how did we print it in GET /:code/print?
        // Let's use the GET /:code logic:
        const [rows] = await db.query(\`
          SELECT p.*, pr.name as product_name, c.business_name as customer_name
          FROM PALLETS p
          JOIN PRODUCTS pr ON p.product_id = pr.id
          JOIN CUSTOMERS c ON p.customer_id = c.id
          WHERE p.pallet_code = ?
        \`, [code]);`;

const newStr = `  fastify.post('/print-bulk', async (request, reply) => {
    const { ids, paper_format = 'A4', print_mode = 'GRID', copies = 1 } = request.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return reply.code(400).send({ error: 'Nessun ID fornito' });
    }

    try {
      // Fetch distinct pallet_codes for the selected IDs
      const [codeRows] = await db.query(\`SELECT DISTINCT pallet_code FROM PALLETS WHERE id IN (?)\`, [ids]);
      const codes = codeRows.map(r => r.pallet_code);

      const generatedLabelsData = [];
      
      for (const code of codes) {
        const [rows] = await db.query(\`
          SELECT p.*, pr.name as product_name, c.business_name as customer_name
          FROM PALLETS p
          JOIN PRODUCTS pr ON p.product_id = pr.id
          JOIN CUSTOMERS c ON p.customer_id = c.id
          WHERE p.pallet_code = ?
        \`, [code]);`;

content = content.replace(oldStr, newStr);

fs.writeFileSync("backend/src/routes/pallets.js", content, "utf8");
console.log("Replaced backend successfully");
