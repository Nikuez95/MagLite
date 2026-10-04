const fs = require('fs');
let code = fs.readFileSync('backend/src/routes/inbound.js', 'utf8');

const pdfRoute = `
  // 6. Get DDT PDF
  fastify.get('/ddt/:identifier/pdf', async (request, reply) => {
    const { identifier } = request.params;
    try {
      const PDFDocument = require('pdfkit');
      
      const isId = !isNaN(identifier);
      const queryStr = isId ? 'SELECT d.*, c.business_name FROM INBOUND_DDTS d JOIN CUSTOMERS c ON d.customer_id = c.id WHERE d.id = ?' : 'SELECT d.*, c.business_name FROM INBOUND_DDTS d JOIN CUSTOMERS c ON d.customer_id = c.id WHERE d.ddt_number = ?';
      const [ddts] = await db.query(queryStr, [identifier]);
      
      if (ddts.length === 0) return reply.code(404).send({ error: 'DDT non trovato' });
      const ddt = ddts[0];

      const [items] = await db.query(\`
        SELECT i.*, p.sku, p.name as product_name, p.uom as product_uom
        FROM INBOUND_DDT_ITEMS i
        JOIN PRODUCTS p ON i.product_id = p.id
        WHERE i.inbound_ddt_id = ?
      \`, [ddt.id]);

      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', \`inline; filename="\${ddt.ddt_number}.pdf"\`);
      reply.send(doc);

      doc.fillColor('#0ea5e9').fontSize(24).font('Helvetica-Bold').text('MAGLITE', { align: 'center' });
      doc.fillColor('#94a3b8').fontSize(10).font('Helvetica').text('Logistica & Magazzino', { align: 'center' });
      doc.moveDown(2);

      doc.fillColor('#1e293b').fontSize(16).font('Helvetica-Bold').text('DDT ENTRATA MERCE (SPUNTA)', { align: 'center' });
      
      // We need a barcode for the DDT number!
      const bwipjs = require('bwip-js');
      try {
        const barcodeBuffer = await bwipjs.toBuffer({ bcid: 'code128', text: ddt.ddt_number, scale: 3, height: 10, includetext: false });
        doc.image(barcodeBuffer, 225, doc.y + 10, { width: 150 });
        doc.moveDown(4);
      } catch (e) {
        doc.moveDown(2);
      }
      
      doc.fontSize(12).text(\`DDT Numero: \${ddt.ddt_number}\`, { align: 'center' });
      doc.moveDown(1.5);
      
      doc.fontSize(12).font('Helvetica').text(\`Cliente: \${ddt.business_name}\`);
      doc.text(\`Data: \${new Date(ddt.created_at).toLocaleDateString('it-IT')}\`);
      doc.text(\`Stato: \${ddt.status}\`);
      if (ddt.notes) doc.text(\`Note: \${ddt.notes}\`);
      
      doc.moveDown(2);
      doc.font('Helvetica-Bold').text('RIGHE ATTESE:', { underline: true });
      doc.moveDown(0.5);

      items.forEach((item, idx) => {
        doc.font('Helvetica-Bold').fontSize(11).text(\`\${idx + 1}. \${item.product_name} (\${item.sku})\`);
        doc.font('Helvetica').fontSize(10).text(\`Q.ta Attesa: \${item.expected_quantity} \${item.product_uom} (Effettiva: \${item.actual_quantity})\`);
        if (item.batch) doc.text(\`Lotto: \${item.batch}\`);
        doc.moveDown(0.5);
      });

      doc.end();
      return reply;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore generazione PDF DDT' });
    }
  });
`;

code = code.replace('module.exports = inboundRoutes;', pdfRoute + '\nmodule.exports = inboundRoutes;');
fs.writeFileSync('backend/src/routes/inbound.js', code);
console.log("Added PDF generation");
