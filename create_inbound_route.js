const fs = require('fs');
const content = `const db = require('../config/db');

async function inboundRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  // 1. Create Inbound DDT
  fastify.post('/ddt', async (request, reply) => {
    const { cart } = request.body;
    if (!cart || cart.length === 0) return reply.code(400).send({ error: 'Carrello vuoto' });

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const customer_id = cart[0].customer_id;
      
      // Generate DDT Number
      const [rows] = await connection.query('SELECT COUNT(*) as count FROM INBOUND_DDTS WHERE YEAR(created_at) = YEAR(CURRENT_DATE)');
      const nextId = rows[0].count + 1;
      const ddtNumber = \`IN-\${new Date().getFullYear()}-\${nextId.toString().padStart(4, '0')}\`;

      const [resDdt] = await connection.query(
        'INSERT INTO INBOUND_DDTS (ddt_number, customer_id, status) VALUES (?, ?, ?)',
        [ddtNumber, customer_id, 'PENDING']
      );
      const ddtId = resDdt.insertId;

      for (const item of cart) {
        await connection.query(\`
          INSERT INTO INBOUND_DDT_ITEMS 
          (inbound_ddt_id, product_id, expected_quantity, units_per_box, boxes_per_pallet, pallet_uom, batch, client_pallet_number, client_article_number, expiration_date, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        \`, [
          ddtId, item.product_id, item.quantity, item.units_per_box, item.boxes_per_pallet, 
          item.pallet_uom, item.batch, item.client_pallet_number, item.client_article_number, 
          item.expiration_date || null, item.notes
        ]);
      }

      await connection.commit();
      
      await db.query('INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)', [
        'CREATE_INBOUND_DDT', \`Creato DDT Inbound \${ddtNumber} per cliente \${customer_id}\`, 'Backoffice', request.user.username
      ]);

      return { success: true, ddt_id: ddtId, ddt_number: ddtNumber };
    } catch (err) {
      await connection.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore creazione DDT' });
    } finally {
      connection.release();
    }
  });

  // 2. Get all DDTs
  fastify.get('/ddt', async (request, reply) => {
    try {
      const [rows] = await db.query(\`
        SELECT d.*, c.business_name as customer_name,
        (SELECT COUNT(*) FROM INBOUND_DDT_ITEMS WHERE inbound_ddt_id = d.id) as total_lines
        FROM INBOUND_DDTS d
        JOIN CUSTOMERS c ON d.customer_id = c.id
        ORDER BY d.created_at DESC
      \`);
      return rows;
    } catch (err) {
      return reply.code(500).send({ error: 'Errore fetch DDTs' });
    }
  });

  // 3. Get DDT Details
  fastify.get('/ddt/:identifier', async (request, reply) => {
    try {
      const { identifier } = request.params;
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

      const [pallets] = await db.query(\`
        SELECT p.*, pr.name as product_name
        FROM PALLETS p
        JOIN PRODUCTS pr ON p.product_id = pr.id
        WHERE p.inbound_ddt_id = ?
      \`, [ddt.id]);

      return { ddt, items, pallets };
    } catch (err) {
      return reply.code(500).send({ error: 'Errore fetch DDT details' });
    }
  });

  // 4. Zebra: Generate Pallet for DDT Item
  fastify.post('/ddt/:id/scan', async (request, reply) => {
    const { ddt_id, item_id, quantity, warehouse, location } = request.body;
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Get item
      const [items] = await connection.query('SELECT * FROM INBOUND_DDT_ITEMS WHERE id = ? AND inbound_ddt_id = ?', [item_id, ddt_id]);
      if (items.length === 0) throw new Error('Item non trovato nel DDT');
      const item = items[0];

      const [ddts] = await connection.query('SELECT * FROM INBOUND_DDTS WHERE id = ?', [ddt_id]);
      if (ddts[0].status === 'PENDING') {
        await connection.query('UPDATE INBOUND_DDTS SET status = ? WHERE id = ?', ['IN_PROGRESS', ddt_id]);
      }

      // Generate pallet code
      const randStr = Math.random().toString(36).substring(2,6).toUpperCase();
      const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const palletCode = \`PAL-\${timestamp}-\${randStr}\`;

      // Insert Pallet
      await connection.query(\`
        INSERT INTO PALLETS 
        (pallet_code, customer_id, product_id, quantity, units_per_box, batch, warehouse, status, location, client_pallet_number, client_article_number, expiration_date, pallet_uom, inbound_ddt_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      \`, [
        palletCode, ddts[0].customer_id, item.product_id, quantity, item.units_per_box, item.batch,
        warehouse || 'Settala', 'STOCKED', location || null, item.client_pallet_number, item.client_article_number,
        item.expiration_date, item.pallet_uom, ddt_id
      ]);

      // Update actual quantity
      await connection.query('UPDATE INBOUND_DDT_ITEMS SET actual_quantity = actual_quantity + ? WHERE id = ?', [quantity, item_id]);

      await connection.commit();
      return { success: true, pallet_code: palletCode };
    } catch (err) {
      await connection.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: err.message || 'Errore scan' });
    } finally {
      connection.release();
    }
  });

  // 5. Complete DDT
  fastify.post('/ddt/:id/complete', async (request, reply) => {
    try {
      const [items] = await db.query('SELECT expected_quantity, actual_quantity FROM INBOUND_DDT_ITEMS WHERE inbound_ddt_id = ?', [request.params.id]);
      let discrepancy = false;
      let totalDiff = 0;
      for (const item of items) {
        if (parseFloat(item.expected_quantity) !== parseFloat(item.actual_quantity)) {
          discrepancy = true;
          totalDiff += (parseFloat(item.actual_quantity) - parseFloat(item.expected_quantity));
        }
      }

      const status = discrepancy ? 'DISCREPANCY' : 'COMPLETED';
      const notes = discrepancy ? \`Completato con discrepanza (\${totalDiff > 0 ? '+' : ''}\${totalDiff})\` : null;

      await db.query('UPDATE INBOUND_DDTS SET status = ?, closed_at = NOW(), notes = ? WHERE id = ?', [status, notes, request.params.id]);
      
      await db.query('INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)', [
        'COMPLETE_INBOUND_DDT', \`Completato DDT \${request.params.id} con stato \${status}\`, 'Zebra', request.user.username
      ]);

      return { success: true, status, notes };
    } catch (err) {
      return reply.code(500).send({ error: 'Errore completamento DDT' });
    }
  });
}

module.exports = inboundRoutes;
`;

fs.writeFileSync('backend/src/routes/inbound.js', content);
console.log("inbound.js created");
