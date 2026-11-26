const db = require('../config/db');
const { hasPermission, canAccessCustomer } = require('../utils/permissions');
const { ensureDefaultMacroCategory, resolveProductCategoryIds } = require('../utils/productCategories');

const ALLOWED_HEX_RE = /^#[0-9a-fA-F]{6}$/;

function sanitizeColor(raw) {
  const s = String(raw || '').trim();
  return ALLOWED_HEX_RE.test(s) ? s.toLowerCase() : '#0ea5e9';
}

function parseOptionalInt(val) {
  if (val === undefined || val === null || val === '') return null;
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : null;
}

module.exports = async function productCategoryRoutes(fastify, options) {
  const canRead = (user) =>
    hasPermission(user, 'view_product_categories') ||
    hasPermission(user, 'product_categories_manage') ||
    hasPermission(user, 'view_products') ||
    hasPermission(user, 'product_manage');

  const canManage = (user) =>
    hasPermission(user, 'product_categories_manage');

  fastify.addHook('preHandler', async (request, reply) => {
    await fastify.authenticate(request, reply);
    if (request.method === 'GET') {
      if (!canRead(request.user)) {
        return reply.code(403).send({ error: 'Accesso negato: non puoi visualizzare le categorie prodotti.' });
      }
    } else if (request.url.includes('/assign-products')) {
      if (!canManage(request.user) && !hasPermission(request.user, 'product_manage')) {
        return reply.code(403).send({ error: 'Accesso negato: non puoi associare prodotti alle categorie.' });
      }
    } else if (!canManage(request.user)) {
      return reply.code(403).send({ error: 'Accesso negato: permesso Gestione Macro & Micro Categorie richiesto.' });
    }
  });

  // GET /api/product-categories - Albero completo Macro -> Micro + conteggi prodotti accessibili
  fastify.get('/', async (request, reply) => {
    try {
      await ensureDefaultMacroCategory(db);

      const [macros] = await db.query(
        `SELECT id, name, description, color, is_system, created_at
         FROM PRODUCT_MACRO_CATEGORIES
         ORDER BY is_system DESC, name ASC`
      );
      const [micros] = await db.query(
        `SELECT id, macro_category_id, name, description, created_at
         FROM PRODUCT_MICRO_CATEGORIES
         ORDER BY name ASC`
      );
      const [products] = await db.query(
        `SELECT id, customer_id, macro_category_id, micro_category_id FROM PRODUCTS`
      );

      const accessibleProducts = products.filter(p => canAccessCustomer(request.user, p.customer_id));
      const macroCounts = new Map();
      const microCounts = new Map();

      for (const p of accessibleProducts) {
        if (p.macro_category_id) {
          macroCounts.set(p.macro_category_id, (macroCounts.get(p.macro_category_id) || 0) + 1);
        }
        if (p.micro_category_id) {
          microCounts.set(p.micro_category_id, (microCounts.get(p.micro_category_id) || 0) + 1);
        }
      }

      const microsByMacro = new Map();
      for (const m of micros) {
        if (!microsByMacro.has(m.macro_category_id)) microsByMacro.set(m.macro_category_id, []);
        microsByMacro.get(m.macro_category_id).push({
          ...m,
          product_count: microCounts.get(m.id) || 0
        });
      }

      const tree = macros.map(mac => ({
        ...mac,
        is_system: Boolean(mac.is_system),
        product_count: macroCounts.get(mac.id) || 0,
        micros: microsByMacro.get(mac.id) || []
      }));

      const daIdentificare = tree.find(m => m.is_system || String(m.name).toUpperCase() === 'DA IDENTIFICARE');
      return {
        macros: tree,
        da_identificare_id: daIdentificare ? daIdentificare.id : null,
        total_products: accessibleProducts.length
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore recupero macro e micro categorie' });
    }
  });

  // GET /api/product-categories/products - Prodotti filtrati per macro, micro, cliente, ricerca
  fastify.get('/products', async (request, reply) => {
    try {
      const { macro_category_id, micro_category_id, customer_id, search } = request.query || {};

      let sql = `
        SELECT p.*,
               c.business_name AS customer_name,
               mc.name AS macro_category_name,
               mc.color AS macro_category_color,
               mc.is_system AS macro_is_system,
               mic.name AS micro_category_name,
               COALESCE(stk.total_qty, 0) AS stock_quantity,
               COALESCE(stk.pallet_count, 0) AS active_pallets
        FROM PRODUCTS p
        JOIN CUSTOMERS c ON c.id = p.customer_id
        LEFT JOIN PRODUCT_MACRO_CATEGORIES mc ON mc.id = p.macro_category_id
        LEFT JOIN PRODUCT_MICRO_CATEGORIES mic ON mic.id = p.micro_category_id
        LEFT JOIN (
          SELECT product_id,
                 SUM(quantity) AS total_qty,
                 COUNT(DISTINCT pallet_code) AS pallet_count
          FROM PALLETS
          WHERE status != 'SHIPPED' AND quantity > 0
          GROUP BY product_id
        ) stk ON stk.product_id = p.id
        WHERE 1=1
      `;
      const params = [];

      if (macro_category_id === 'NONE') {
        sql += ' AND p.macro_category_id IS NULL';
      } else {
        const macroId = parseOptionalInt(macro_category_id);
        if (macroId) {
          sql += ' AND p.macro_category_id = ?';
          params.push(macroId);
        }
      }

      if (micro_category_id === 'NONE') {
        sql += ' AND p.micro_category_id IS NULL';
      } else {
        const microId = parseOptionalInt(micro_category_id);
        if (microId) {
          sql += ' AND p.micro_category_id = ?';
          params.push(microId);
        }
      }

      const custId = parseOptionalInt(customer_id);
      if (custId) {
        sql += ' AND p.customer_id = ?';
        params.push(custId);
      }

      if (search && String(search).trim()) {
        const like = `%${String(search).trim()}%`;
        sql += ' AND (p.sku LIKE ? OR p.name LIKE ? OR p.default_article_number LIKE ? OR c.business_name LIKE ?)';
        params.push(like, like, like, like);
      }

      sql += ' ORDER BY p.name ASC';
      const [rows] = await db.query(sql, params);

      return rows
        .filter(r => canAccessCustomer(request.user, r.customer_id))
        .map(r => ({
          ...r,
          macro_is_system: Boolean(r.macro_is_system),
          stock_quantity: Number(r.stock_quantity) || 0,
          active_pallets: Number(r.active_pallets) || 0
        }));
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore recupero prodotti filtrati per categoria' });
    }
  });

  // POST /api/product-categories/macros
  fastify.post('/macros', async (request, reply) => {
    const cleanName = String(request.body?.name || '').trim();
    const cleanDesc = request.body?.description ? String(request.body.description).trim() : null;
    const cleanColor = sanitizeColor(request.body?.color);

    if (!cleanName) {
      return reply.code(400).send({ error: 'Il nome della Macro Categoria è obbligatorio.' });
    }

    try {
      const [res] = await db.query(
        `INSERT INTO PRODUCT_MACRO_CATEGORIES (name, description, color, is_system) VALUES (?, ?, ?, FALSE)`,
        [cleanName, cleanDesc, cleanColor]
      );
      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['CREATE_MACRO_CATEGORY', `Creata macro categoria "${cleanName}"`, 'Gestionale', request.user.username]
      );
      if (fastify.io) fastify.io.emit('product_categories_updated');
      return reply.code(201).send({
        success: true,
        macro: {
          id: res.insertId,
          name: cleanName,
          description: cleanDesc,
          color: cleanColor,
          is_system: false,
          product_count: 0,
          micros: []
        }
      });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return reply.code(400).send({ error: 'Esiste già una Macro Categoria con questo nome.' });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore creazione macro categoria' });
    }
  });

  // PUT /api/product-categories/macros/:id
  fastify.put('/macros/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const cleanName = String(request.body?.name || '').trim();
    const cleanDesc = request.body?.description !== undefined ? (String(request.body.description || '').trim() || null) : undefined;
    const cleanColor = request.body?.color ? sanitizeColor(request.body.color) : undefined;

    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'ID non valido' });

    try {
      const [[existing]] = await db.query('SELECT * FROM PRODUCT_MACRO_CATEGORIES WHERE id = ?', [id]);
      if (!existing) return reply.code(404).send({ error: 'Macro Categoria non trovata' });

      const finalName = existing.is_system ? existing.name : (cleanName || existing.name);
      if (existing.is_system && cleanName && cleanName.toUpperCase() !== existing.name.toUpperCase()) {
        return reply.code(400).send({ error: 'La categoria di sistema "DA IDENTIFICARE" non può essere rinominata.' });
      }

      await db.query(
        `UPDATE PRODUCT_MACRO_CATEGORIES
         SET name = ?,
             description = COALESCE(?, description),
             color = COALESCE(?, color)
         WHERE id = ?`,
        [
          finalName,
          cleanDesc !== undefined ? cleanDesc : existing.description,
          cleanColor || existing.color,
          id
        ]
      );
      if (fastify.io) fastify.io.emit('product_categories_updated');
      return { success: true };
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return reply.code(400).send({ error: 'Esiste già una Macro Categoria con questo nome.' });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore aggiornamento macro categoria' });
    }
  });

  // DELETE /api/product-categories/macros/:id
  fastify.delete('/macros/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'ID non valido' });

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [[existing]] = await connection.query('SELECT * FROM PRODUCT_MACRO_CATEGORIES WHERE id = ?', [id]);
      if (!existing) {
        await connection.rollback();
        return reply.code(404).send({ error: 'Macro Categoria non trovata' });
      }
      if (existing.is_system || String(existing.name).toUpperCase() === 'DA IDENTIFICARE') {
        await connection.rollback();
        return reply.code(400).send({ error: 'La macro categoria predefinita "DA IDENTIFICARE" non può essere eliminata.' });
      }

      const defMacro = await ensureDefaultMacroCategory(connection);
      if (defMacro?.id) {
        await connection.query(
          `UPDATE PRODUCTS
           SET macro_category_id = ?, micro_category_id = NULL
           WHERE macro_category_id = ?`,
          [defMacro.id, id]
        );
      }

      await connection.query('DELETE FROM PRODUCT_MACRO_CATEGORIES WHERE id = ?', [id]);
      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['DELETE_MACRO_CATEGORY', `Eliminata macro categoria "${existing.name}" (articoli spostati in DA IDENTIFICARE)`, 'Gestionale', request.user.username]
      );
      await connection.commit();
      if (fastify.io) {
        fastify.io.emit('product_categories_updated');
        fastify.io.emit('inventory_updated');
      }
      return { success: true };
    } catch (err) {
      await connection.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore eliminazione macro categoria' });
    } finally {
      connection.release();
    }
  });

  // POST /api/product-categories/micros
  fastify.post('/micros', async (request, reply) => {
    const macroId = parseInt(request.body?.macro_category_id, 10);
    const cleanName = String(request.body?.name || '').trim();
    const cleanDesc = request.body?.description ? String(request.body.description).trim() : null;

    if (!Number.isFinite(macroId) || !cleanName) {
      return reply.code(400).send({ error: 'Macro categoria e nome della Micro Categoria sono obbligatori.' });
    }

    try {
      const [[macro]] = await db.query('SELECT id, name, is_system FROM PRODUCT_MACRO_CATEGORIES WHERE id = ?', [macroId]);
      if (!macro) return reply.code(404).send({ error: 'Macro Categoria non trovata' });

      const [res] = await db.query(
        `INSERT INTO PRODUCT_MICRO_CATEGORIES (macro_category_id, name, description) VALUES (?, ?, ?)`,
        [macroId, cleanName, cleanDesc]
      );
      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['CREATE_MICRO_CATEGORY', `Creata micro categoria "${cleanName}" in "${macro.name}"`, 'Gestionale', request.user.username]
      );
      if (fastify.io) fastify.io.emit('product_categories_updated');
      return reply.code(201).send({
        success: true,
        micro: {
          id: res.insertId,
          macro_category_id: macroId,
          name: cleanName,
          description: cleanDesc,
          product_count: 0
        }
      });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return reply.code(400).send({ error: 'Esiste già una Micro Categoria con questo nome nella Macro Categoria selezionata.' });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore creazione micro categoria' });
    }
  });

  // PUT /api/product-categories/micros/:id
  fastify.put('/micros/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const cleanName = String(request.body?.name || '').trim();
    const cleanDesc = request.body?.description !== undefined ? (String(request.body.description || '').trim() || null) : undefined;
    const newMacroId = parseOptionalInt(request.body?.macro_category_id);

    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'ID non valido' });

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [[existing]] = await connection.query('SELECT * FROM PRODUCT_MICRO_CATEGORIES WHERE id = ?', [id]);
      if (!existing) {
        await connection.rollback();
        return reply.code(404).send({ error: 'Micro Categoria non trovata' });
      }

      const targetMacroId = newMacroId || existing.macro_category_id;
      if (newMacroId && newMacroId !== existing.macro_category_id) {
        const [[targetMacro]] = await connection.query('SELECT id FROM PRODUCT_MACRO_CATEGORIES WHERE id = ?', [newMacroId]);
        if (!targetMacro) {
          await connection.rollback();
          return reply.code(404).send({ error: 'Macro Categoria di destinazione non trovata' });
        }
      }

      await connection.query(
        `UPDATE PRODUCT_MICRO_CATEGORIES
         SET macro_category_id = ?,
             name = ?,
             description = ?
         WHERE id = ?`,
        [
          targetMacroId,
          cleanName || existing.name,
          cleanDesc !== undefined ? cleanDesc : existing.description,
          id
        ]
      );

      if (targetMacroId !== existing.macro_category_id) {
        await connection.query(
          'UPDATE PRODUCTS SET macro_category_id = ? WHERE micro_category_id = ?',
          [targetMacroId, id]
        );
      }

      await connection.commit();
      if (fastify.io) {
        fastify.io.emit('product_categories_updated');
        fastify.io.emit('inventory_updated');
      }
      return { success: true };
    } catch (err) {
      await connection.rollback();
      if (err.code === 'ER_DUP_ENTRY') {
        return reply.code(400).send({ error: 'Esiste già una Micro Categoria con questo nome in quella Macro Categoria.' });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore aggiornamento micro categoria' });
    } finally {
      connection.release();
    }
  });

  // DELETE /api/product-categories/micros/:id
  fastify.delete('/micros/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'ID non valido' });

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [[existing]] = await connection.query('SELECT * FROM PRODUCT_MICRO_CATEGORIES WHERE id = ?', [id]);
      if (!existing) {
        await connection.rollback();
        return reply.code(404).send({ error: 'Micro Categoria non trovata' });
      }

      await connection.query('UPDATE PRODUCTS SET micro_category_id = NULL WHERE micro_category_id = ?', [id]);
      await connection.query('DELETE FROM PRODUCT_MICRO_CATEGORIES WHERE id = ?', [id]);
      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['DELETE_MICRO_CATEGORY', `Eliminata micro categoria "${existing.name}"`, 'Gestionale', request.user.username]
      );
      await connection.commit();
      if (fastify.io) {
        fastify.io.emit('product_categories_updated');
        fastify.io.emit('inventory_updated');
      }
      return { success: true };
    } catch (err) {
      await connection.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore eliminazione micro categoria' });
    } finally {
      connection.release();
    }
  });

  // PUT /api/product-categories/assign-products - Collega uno o più prodotti a Macro/Micro categoria
  fastify.put('/assign-products', async (request, reply) => {
    const rawIds = Array.isArray(request.body?.product_ids) ? request.body.product_ids : [];
    const productIds = [...new Set(rawIds.map(v => parseInt(v, 10)).filter(n => Number.isFinite(n) && n > 0))];

    if (productIds.length === 0) {
      return reply.code(400).send({ error: 'Seleziona almeno un prodotto da assegnare.' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [prodRows] = await connection.query(
        'SELECT id, customer_id FROM PRODUCTS WHERE id IN (?)',
        [productIds]
      );
      if (prodRows.length === 0) {
        await connection.rollback();
        return reply.code(404).send({ error: 'Nessun prodotto valido trovato.' });
      }
      for (const p of prodRows) {
        if (!canAccessCustomer(request.user, p.customer_id)) {
          await connection.rollback();
          return reply.code(403).send({ error: 'Accesso negato su uno o più prodotti selezionati.' });
        }
      }

      const resolved = await resolveProductCategoryIds(
        connection,
        request.body?.macro_category_id,
        request.body?.micro_category_id,
        { fallbackToDefault: true }
      );

      await connection.query(
        'UPDATE PRODUCTS SET macro_category_id = ?, micro_category_id = ? WHERE id IN (?)',
        [resolved.macro_category_id, resolved.micro_category_id, productIds]
      );

      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        [
          'ASSIGN_PRODUCT_CATEGORIES',
          `Aggiornata categoria per ${prodRows.length} prodott${prodRows.length === 1 ? 'o' : 'i'} (Macro #${resolved.macro_category_id || '-'}, Micro #${resolved.micro_category_id || '-'})`,
          'Gestionale',
          request.user.username
        ]
      );

      await connection.commit();
      if (fastify.io) {
        fastify.io.emit('product_categories_updated');
        fastify.io.emit('inventory_updated');
      }
      return {
        success: true,
        updated_count: prodRows.length,
        macro_category_id: resolved.macro_category_id,
        micro_category_id: resolved.micro_category_id
      };
    } catch (err) {
      await connection.rollback();
      if (err.statusCode === 400) {
        return reply.code(400).send({ error: err.message });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore assegnazione categorie ai prodotti' });
    } finally {
      connection.release();
    }
  });
};
