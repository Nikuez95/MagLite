const db = require('../config/db');

async function productRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  // Solo backoffice e developer
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.user.role !== 'developer' && request.user.role !== 'backoffice') {
      return reply.code(403).send({ error: 'Accesso negato.' });
    }
  });

  // GET /api/products
  fastify.get('/', async (request, reply) => {
    try {
      const [rows] = await db.query(`
        SELECT p.*, c.business_name as customer_name 
        FROM PRODUCTS p 
        JOIN CUSTOMERS c ON p.customer_id = c.id 
        ORDER BY p.name ASC
      `);
      return rows;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante il recupero dei prodotti' });
    }
  });

  // GET /api/products/flags
  fastify.get('/flags', async (request, reply) => {
    try {
      const [prodRows] = await db.query(`SELECT flags FROM PRODUCTS WHERE flags IS NOT NULL AND flags != '[]'`);
      const [palRows] = await db.query(`SELECT flags FROM PALLETS WHERE flags IS NOT NULL AND flags != '[]'`);
      
      const flagsSet = new Set();
      
      const processFlags = (rows) => {
        rows.forEach(r => {
          if (r.flags) {
            try {
              const parsed = typeof r.flags === 'string' ? JSON.parse(r.flags) : r.flags;
              if (Array.isArray(parsed)) parsed.forEach(f => flagsSet.add(f));
            } catch(e) {}
          }
        });
      };
      
      processFlags(prodRows);
      processFlags(palRows);
      
      return Array.from(flagsSet);
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore recupero flags' });
    }
  });

  // POST /api/products
  fastify.post('/', async (request, reply) => {
    const { sku, name, uom, customer_id, notes, units_per_box, boxes_per_pallet, default_article_number, flags } = request.body;
    
    if (!sku || !name || !customer_id) {
      return reply.code(400).send({ error: 'SKU, Nome e Cliente sono obbligatori' });
    }

    try {
      const flagsJson = flags ? JSON.stringify(flags) : null;
      
      const [result] = await db.query(
        'INSERT INTO PRODUCTS (sku, name, uom, customer_id, notes, units_per_box, boxes_per_pallet, default_article_number, flags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [sku, name, uom || 'Scatole', customer_id, notes || null, units_per_box || 1, boxes_per_pallet || 1, default_article_number || null, flagsJson]
      );
      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['CREATE_PRODUCT', `Creato prodotto ${name} (${sku})`, 'Gestionale', request.user.username]
      );
      return reply.code(201).send({ success: true, id: result.insertId });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return reply.code(400).send({ error: 'Codice Articolo (SKU) già esistente' });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore interno' });
    }
  });

  // PUT /api/products/:id
  fastify.put('/:id', async (request, reply) => {
    const { sku, name, uom, customer_id, notes, units_per_box, boxes_per_pallet, default_article_number, flags, updateExistingPallets } = request.body;
    
    if (!sku || !name || !customer_id) {
      return reply.code(400).send({ error: 'SKU, Nome e Cliente sono obbligatori' });
    }

    try {
      const flagsJson = flags ? JSON.stringify(flags) : null;
      
      await db.query(
        'UPDATE PRODUCTS SET sku = ?, name = ?, uom = ?, customer_id = ?, notes = ?, units_per_box = ?, boxes_per_pallet = ?, default_article_number = ?, flags = ? WHERE id = ?',
        [sku, name, uom || 'Scatole', customer_id, notes || null, units_per_box || 1, boxes_per_pallet || 1, default_article_number || null, flagsJson, request.params.id]
      );
      
      if (updateExistingPallets) {
        await db.query('UPDATE PALLETS SET flags = ? WHERE product_id = ?', [flagsJson, request.params.id]);
      }

      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['UPDATE_PRODUCT', `Aggiornato prodotto ${name} (${sku})`, 'Gestionale', request.user.username]
      );
      
      return { success: true };
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return reply.code(400).send({ error: 'Codice Articolo (SKU) già esistente' });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore interno' });
    }
  });
  fastify.delete('/:id', async (request, reply) => {
    if (request.user.role !== 'developer' && request.user.role !== 'backoffice') {
      return reply.code(403).send({ error: 'Solo developer e backoffice possono eliminare anagrafiche' });
    }
    try {
      const [[product]] = await db.query('SELECT name FROM PRODUCTS WHERE id = ?', [request.params.id]);
      await db.query('DELETE FROM PRODUCTS WHERE id = ?', [request.params.id]);
      if (product) {
        await db.query(
          'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
          ['DELETE', `Eliminata anagrafica prodotto: ${product.name}`, 'Gestionale', request.user.username]
        );
      }
      return { success: true };
    } catch (err) {
      return reply.code(400).send({ error: 'Impossibile eliminare, il prodotto è usato in alcune giacenze?' });
    }
  });
}

module.exports = productRoutes;
