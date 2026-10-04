const fs = require('fs');
let palletsCode = fs.readFileSync('backend/src/routes/pallets.js', 'utf8');

// extract drawLabel
const drawLabelRegex = /async function drawLabel.*?}\n\n/s;
const match = palletsCode.match(/async function drawLabel[\s\S]*?(?=async function)/);
let drawLabelStr = "";
if (match) {
  drawLabelStr = match[0];
} else {
  console.log("Could not find drawLabel");
}

let inboundCode = fs.readFileSync('backend/src/routes/inbound.js', 'utf8');

const barcodesRoute = `
  // 7. Get Barcodes for generated pallets
  fastify.get('/ddt/:identifier/barcodes', async (request, reply) => {
    const { identifier } = request.params;
    try {
      const PDFDocument = require('pdfkit');
      const bwipjs = require('bwip-js');
      const path = require('path');
      const fsModule = require('fs');
      const logoPath = path.join(__dirname, '../../../logo_xs.png');
      
      const isId = !isNaN(identifier);
      const queryStr = isId ? 'SELECT d.id FROM INBOUND_DDTS d WHERE d.id = ?' : 'SELECT d.id FROM INBOUND_DDTS d WHERE d.ddt_number = ?';
      const [ddts] = await db.query(queryStr, [identifier]);
      if (ddts.length === 0) return reply.code(404).send({ error: 'DDT non trovato' });

      const [pallets] = await db.query(\`
        SELECT p.*, pr.name as product_name, pr.uom as product_uom, c.business_name
        FROM PALLETS p
        JOIN PRODUCTS pr ON p.product_id = pr.id
        JOIN CUSTOMERS c ON p.customer_id = c.id
        WHERE p.inbound_ddt_id = ?
        ORDER BY p.id ASC
      \`, [ddts[0].id]);

      if (pallets.length === 0) return reply.code(400).send({ error: 'Nessuna paletta generata per questo DDT' });

      const generatedLabels = pallets.map(p => ({
        barcode: p.pallet_code,
        customer: p.business_name,
        product: p.product_name,
        qty: p.quantity,
        uom: p.pallet_uom || pr?.product_uom || 'Pezzi',
        batch: p.batch || 'N/A',
        warehouse: p.warehouse,
        clientPallet: p.client_pallet_number,
        clientArticle: p.client_article_number,
        expiration: p.expiration_date,
        flags: p.flags
      }));

      ` + drawLabelStr.replace(/fs\.existsSync/g, 'fsModule.existsSync') + `

      const doc = new PDFDocument({ size: 'A4', margin: 20 });
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', 'inline; filename="barcodes.pdf"');
      reply.send(doc);

      const margin = 20;
      const spacingX = 15;
      const spacingY = 15;
      const w = (595.28 - margin * 2 - spacingX) / 2;
      const h = (841.89 - margin * 2 - spacingY * 3) / 4;

      for (let i = 0; i < generatedLabels.length; i++) {
        if (i > 0 && i % 8 === 0) doc.addPage();
        const posOnPage = i % 8;
        const col = posOnPage % 2;
        const row = Math.floor(posOnPage / 2);

        const x = margin + col * (w + spacingX);
        const y = margin + row * (h + spacingY);

        await drawLabel(doc, generatedLabels[i], x, y, w, h);
      }
      doc.end();
      return reply;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore generazione barcodes' });
    }
  });
`;

inboundCode = inboundCode.replace('module.exports = inboundRoutes;', barcodesRoute + '\nmodule.exports = inboundRoutes;');
fs.writeFileSync('backend/src/routes/inbound.js', inboundCode);
console.log("Added barcodes generation route");
