const { hasPermission, canAccessCustomer } = require('../utils/permissions');
const db = require('../config/db');

async function productRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.addHook('preHandler', async (request, reply) => {
    if (request.method === 'GET') return;
    if (request.method === 'DELETE') {
      if (!hasPermission(request.user, 'pallet_delete')) {
        return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di eliminare articoli.' });
      }
    } else if (!hasPermission(request.user, 'product_manage')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di creare o modificare articoli.' });
    }
    if (request.body?.customer_id && !canAccessCustomer(request.user, request.body.customer_id)) {
      return reply.code(403).send({ error: 'Accesso negato: non puoi operare sulla merce di questo cliente.' });
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
      return rows.filter(r => canAccessCustomer(request.user, r.customer_id));
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
    
    const cleanArticle = default_article_number ? String(default_article_number).trim() : '';
    const rawSku = sku ? String(sku).trim() : '';
    const cleanSku = (cleanArticle && (!rawSku || rawSku.startsWith('PROD-'))) ? cleanArticle : rawSku;
    const cleanName = name ? String(name).trim() : '';

    if (!cleanSku || !cleanName || !customer_id) {
      return reply.code(400).send({ error: 'SKU, Nome e Cliente sono obbligatori' });
    }

    const finalDefaultArticle = cleanArticle || (!cleanSku.startsWith('PROD-') ? cleanSku : null);
    const flagsJson = flags ? JSON.stringify(flags) : null;

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Verifica se esiste già un prodotto con questo SKU o con lo stesso nome (ed eventuale vecchio SKU PROD-XXXX)
      const [bySkuRows] = await connection.query('SELECT * FROM PRODUCTS WHERE sku = ?', [cleanSku]);
      const [byNameRows] = await connection.query(
        'SELECT * FROM PRODUCTS WHERE customer_id = ? AND (LOWER(TRIM(name)) = LOWER(?) OR (default_article_number IS NOT NULL AND default_article_number != "" AND LOWER(TRIM(default_article_number)) = LOWER(?)))',
        [customer_id, cleanName, cleanSku]
      );

      if (bySkuRows.length > 0) {
        const target = bySkuRows[0];
        // Elimina e unisci eventuali vecchi duplicati con SKU generato PROD-XXXX per lo stesso prodotto
        for (const dup of byNameRows) {
          if (dup.id !== target.id && dup.sku && dup.sku.startsWith('PROD-')) {
            await connection.query('UPDATE PALLETS SET product_id = ? WHERE product_id = ?', [target.id, dup.id]);
            await connection.query('UPDATE INBOUND_DDT_ITEMS SET product_id = ?, sku = ? WHERE product_id = ?', [target.id, cleanSku, dup.id]);
            await connection.query('UPDATE OUTBOUND_ITEMS SET product_id = ? WHERE product_id = ?', [target.id, dup.id]);
            await connection.query('DELETE FROM PRODUCTS WHERE id = ?', [dup.id]);
          }
        }
        await connection.query(
          'UPDATE PRODUCTS SET name = ?, uom = COALESCE(?, uom), units_per_box = COALESCE(?, units_per_box), boxes_per_pallet = COALESCE(?, boxes_per_pallet), default_article_number = COALESCE(?, default_article_number), flags = COALESCE(?, flags) WHERE id = ?',
          [cleanName, uom || null, units_per_box || null, boxes_per_pallet || null, finalDefaultArticle, flagsJson, target.id]
        );
        await connection.query('UPDATE INBOUND_DDT_ITEMS SET sku = ? WHERE product_id = ?', [cleanSku, target.id]);
        await connection.commit();
        return reply.code(200).send({ success: true, id: target.id, sku: cleanSku });
      }

      if (byNameRows.length > 0 && (!cleanSku.startsWith('PROD-') || byNameRows.some(r => r.sku && r.sku.startsWith('PROD-')))) {
        const target = byNameRows[0];
        const newSkuForTarget = !cleanSku.startsWith('PROD-') ? cleanSku : target.sku;
        for (const dup of byNameRows) {
          if (dup.id !== target.id && dup.sku && dup.sku.startsWith('PROD-')) {
            await connection.query('UPDATE PALLETS SET product_id = ? WHERE product_id = ?', [target.id, dup.id]);
            await connection.query('UPDATE INBOUND_DDT_ITEMS SET product_id = ?, sku = ? WHERE product_id = ?', [target.id, newSkuForTarget, dup.id]);
            await connection.query('UPDATE OUTBOUND_ITEMS SET product_id = ? WHERE product_id = ?', [target.id, dup.id]);
            await connection.query('DELETE FROM PRODUCTS WHERE id = ?', [dup.id]);
          }
        }
        await connection.query(
          'UPDATE PRODUCTS SET sku = ?, name = ?, uom = COALESCE(?, uom), units_per_box = COALESCE(?, units_per_box), boxes_per_pallet = COALESCE(?, boxes_per_pallet), default_article_number = COALESCE(?, default_article_number), flags = COALESCE(?, flags) WHERE id = ?',
          [newSkuForTarget, cleanName, uom || null, units_per_box || null, boxes_per_pallet || null, finalDefaultArticle, flagsJson, target.id]
        );
        await connection.query('UPDATE INBOUND_DDT_ITEMS SET sku = ? WHERE product_id = ?', [newSkuForTarget, target.id]);
        await connection.commit();
        return reply.code(200).send({ success: true, id: target.id, sku: newSkuForTarget });
      }

      const [result] = await connection.query(
        'INSERT INTO PRODUCTS (sku, name, uom, customer_id, notes, units_per_box, boxes_per_pallet, default_article_number, flags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [cleanSku, cleanName, uom || 'Scatole', customer_id, notes || null, units_per_box || 1, boxes_per_pallet || 1, finalDefaultArticle, flagsJson]
      );
      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['CREATE_PRODUCT', `Creato prodotto ${cleanName} (${cleanSku})`, 'Gestionale', request.user.username]
      );
      await connection.commit();
      return reply.code(201).send({ success: true, id: result.insertId, sku: cleanSku });
    } catch (err) {
      await connection.rollback();
      if (err.code === 'ER_DUP_ENTRY') {
        return reply.code(400).send({ error: 'Codice Articolo (SKU) già esistente' });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore interno' });
    } finally {
      connection.release();
    }
  });

  // PUT /api/products/:id
  fastify.put('/:id', async (request, reply) => {
    const { sku, name, uom, customer_id, notes, units_per_box, boxes_per_pallet, default_article_number, flags, updateExistingPallets } = request.body;
    const targetId = parseInt(request.params.id, 10);
    
    const cleanArticle = default_article_number ? String(default_article_number).trim() : '';
    const rawSku = sku ? String(sku).trim() : '';
    const cleanSku = (cleanArticle && (!rawSku || rawSku.startsWith('PROD-'))) ? cleanArticle : rawSku;
    const cleanName = name ? String(name).trim() : '';

    if (!cleanSku || !cleanName || !customer_id) {
      return reply.code(400).send({ error: 'SKU, Nome e Cliente sono obbligatori' });
    }

    const finalDefaultArticle = cleanArticle || (!cleanSku.startsWith('PROD-') ? cleanSku : null);
    const flagsJson = flags ? JSON.stringify(flags) : null;

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Se esiste un altro prodotto con lo stesso SKU o stesso nome e SKU generato PROD-%, uniscilo ed eliminalo
      const [conflictRows] = await connection.query(
        'SELECT * FROM PRODUCTS WHERE id != ? AND (sku = ? OR (customer_id = ? AND LOWER(TRIM(name)) = LOWER(?) AND sku LIKE "PROD-%"))',
        [targetId, cleanSku, customer_id, cleanName]
      );
      for (const dup of conflictRows) {
        await connection.query('UPDATE PALLETS SET product_id = ? WHERE product_id = ?', [targetId, dup.id]);
        await connection.query('UPDATE INBOUND_DDT_ITEMS SET product_id = ?, sku = ? WHERE product_id = ?', [targetId, cleanSku, dup.id]);
        await connection.query('UPDATE OUTBOUND_ITEMS SET product_id = ? WHERE product_id = ?', [targetId, dup.id]);
        await connection.query('DELETE FROM PRODUCTS WHERE id = ?', [dup.id]);
      }

      await connection.query(
        'UPDATE PRODUCTS SET sku = ?, name = ?, uom = ?, customer_id = ?, notes = ?, units_per_box = ?, boxes_per_pallet = ?, default_article_number = ?, flags = ? WHERE id = ?',
        [cleanSku, cleanName, uom || 'Scatole', customer_id, notes || null, units_per_box || 1, boxes_per_pallet || 1, finalDefaultArticle, flagsJson, targetId]
      );

      await connection.query('UPDATE INBOUND_DDT_ITEMS SET sku = ? WHERE product_id = ?', [cleanSku, targetId]);
      
      if (updateExistingPallets) {
        await connection.query('UPDATE PALLETS SET flags = ? WHERE product_id = ?', [flagsJson, targetId]);
      }

      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['UPDATE_PRODUCT', `Aggiornato prodotto ${cleanName} (${cleanSku})`, 'Gestionale', request.user.username]
      );
      
      await connection.commit();
      return { success: true, sku: cleanSku };
    } catch (err) {
      await connection.rollback();
      if (err.code === 'ER_DUP_ENTRY') {
        return reply.code(400).send({ error: 'Codice Articolo (SKU) già esistente' });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore interno' });
    } finally {
      connection.release();
    }
  });

  fastify.delete('/:id', async (request, reply) => {
    if (!hasPermission(request.user, 'pallet_delete')) {
      return reply.code(403).send({ error: 'Non hai il permesso di eliminare anagrafiche prodotto.' });
    }
    const [[quarCheck]] = await db.query('SELECT COUNT(*) as cnt FROM PALLETS WHERE product_id = ? AND is_quarantined = TRUE AND status != "SHIPPED"', [request.params.id]);
    if (quarCheck && quarCheck.cnt > 0) {
      return reply.code(403).send({ error: 'BLOCCO QUARANTENA: Impossibile eliminare un prodotto che ha palette in quarantena.' });
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
