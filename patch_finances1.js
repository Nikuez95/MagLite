const fs = require('fs');
let c = fs.readFileSync('backend/src/routes/finances.js', 'utf8');

c = c.replace(/const { customer_id, period_month, period_year, base_total, vat_amount, grand_total } = request.body;/,
`const { customer_id, period_month, period_year, base_total, vat_amount, grand_total, invoice_data } = request.body;`);

c = c.replace(/INSERT INTO invoices \(customer_id, period_month, period_year, base_total, vat_amount, grand_total\)/,
`INSERT INTO invoices (customer_id, period_month, period_year, base_total, vat_amount, grand_total, invoice_data)`);

c = c.replace(/VALUES \(\?, \?, \?, \?, \?, \?\)/,
`VALUES (?, ?, ?, ?, ?, ?, ?)`);

c = c.replace(/grand_total = VALUES\(grand_total\)/,
`grand_total = VALUES(grand_total),
          invoice_data = VALUES(invoice_data)`);

c = c.replace(/\[customer_id, period_month, period_year, base_total, vat_amount, grand_total\]/,
`[customer_id, period_month, period_year, base_total, vat_amount, grand_total, invoice_data ? JSON.stringify(invoice_data) : null]`);

c = c.replace(/return { success: true };/g, `// Replaced later`);

fs.writeFileSync('backend/src/routes/finances.js', c, 'utf8');
