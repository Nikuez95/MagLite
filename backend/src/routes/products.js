const { hasPermission, canAccessCustomer } = require('../utils/permissions');
const { normalizeTempRegime, parseAdrData } = require('../utils/logisticsMeta');
const { resolveProductCategoryIds } = require('../utils/productCategories');
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
        SELECT p.*,
               c.business_name as customer_name,
               mc.name as macro_category_name,
               mc.color as macro_category_color,
               mc.is_system as macro_is_system,
               mic.name as micro_category_name
        FROM PRODUCTS p
        JOIN CUSTOMERS c ON p.customer_id = c.id
        LEFT JOIN PRODUCT_MACRO_CATEGORIES mc ON mc.id = p.macro_category_id
        LEFT JOIN PRODUCT_MICRO_CATEGORIES mic ON mic.id = p.micro_category_id
        ORDER BY p.name ASC
      `);
      return rows
        .filter(r => canAccessCustomer(request.user, r.customer_id))
        .map(r => ({
          ...r,
          macro_is_system: Boolean(r.macro_is_system),
          default_temp_regime: normalizeTempRegime(r.default_temp_regime),
          default_is_adr: Boolean(r.default_is_adr),
          default_adr_data: parseAdrData(r.default_adr_data, r.name)
        }));
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante il recupero dei prodotti' });
    }
  });

  // GET /api/products/tariff-plans (accessibile a tutti gli operatori autenticati, es. Nuova Merce In)
  fastify.get('/tariff-plans', async (request, reply) => {
    try {
      const [rows] = await db.query(
        `SELECT id, name, description, is_default, is_flat_rate
         FROM tariff_plans
         ORDER BY is_flat_rate DESC, is_default DESC, name ASC`
      );
      return rows.map(r => ({
        ...r,
        is_default: Boolean(r.is_default),
        is_flat_rate: Boolean(r.is_flat_rate)
      }));
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore recupero listini globali' });
    }
  });

  // GET /api/products/flags
  fastify.get('/flags', async (request, reply) => {
    try {
      const source = request.query?.source;
      const flagsSet = new Set();

      const [ruleRows] = await db.query(
        `SELECT rule_code FROM billing_rules WHERE rule_type = 'FLAG' ORDER BY rule_code ASC`
      );
      ruleRows.forEach(r => {
        if (r.rule_code) {
          const clean = String(r.rule_code).trim().toUpperCase().replace(/^FLAG_/, '');
          if (clean) flagsSet.add(clean);
        }
      });

      if (source !== 'rules') {
        const [prodRows] = await db.query(`SELECT flags FROM PRODUCTS WHERE flags IS NOT NULL AND flags != '[]'`);
        const [palRows] = await db.query(`SELECT flags FROM PALLETS WHERE flags IS NOT NULL AND flags != '[]'`);

        const processFlags = (rows) => {
          rows.forEach(r => {
            if (r.flags) {
              try {
                const parsed = typeof r.flags === 'string' ? JSON.parse(r.flags) : r.flags;
                if (Array.isArray(parsed)) {
                  parsed.forEach(f => {
                    const clean = String(f || '').trim().toUpperCase().replace(/^FLAG_/, '');
                    if (clean) flagsSet.add(clean);
                  });
                }
              } catch (e) {}
            }
          });
        };

        processFlags(prodRows);
        processFlags(palRows);
      }

      return Array.from(flagsSet).sort();
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore recupero flags' });
    }
  });

  // POST /api/products
  fastify.post('/', async (request, reply) => {
    const {
      sku, name, uom, customer_id, notes, units_per_box, boxes_per_pallet,
      kg_per_unit, default_article_number, flags,
      default_temp_regime, default_is_adr, default_adr_data,
      macro_category_id, micro_category_id
    } = request.body;
    
    const cleanArticle = default_article_number ? String(default_article_number).trim() : '';
    const rawSku = sku ? String(sku).trim() : '';
    const cleanSku = (cleanArticle && (!rawSku || rawSku.startsWith('PROD-'))) ? cleanArticle : rawSku;
    const cleanName = name ? String(name).trim() : '';

    if (!cleanSku || !cleanName || !customer_id) {
      return reply.code(400).send({ error: 'SKU, Nome e Cliente sono obbligatori' });
    }

    const finalDefaultArticle = cleanArticle || (!cleanSku.startsWith('PROD-') ? cleanSku : null);
    const flagsJson = flags ? JSON.stringify(flags) : null;
    const parsedKgPerUnit = (kg_per_unit !== undefined && kg_per_unit !== null && kg_per_unit !== '' && Number.isFinite(parseFloat(kg_per_unit)) && parseFloat(kg_per_unit) > 0)
      ? parseFloat(kg_per_unit)
      : null;
    const cleanDefTemp = default_temp_regime !== undefined ? normalizeTempRegime(default_temp_regime) : undefined;
    const cleanDefIsAdr = default_is_adr !== undefined ? Boolean(default_is_adr) : undefined;
    const cleanDefAdrJson = default_adr_data !== undefined
      ? (cleanDefIsAdr ? JSON.stringify(parseAdrData(default_adr_data, cleanName) || {}) : null)
      : undefined;

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const hasCategoryInput = macro_category_id !== undefined || micro_category_id !== undefined;
      const resolvedCategories = await resolveProductCategoryIds(
        connection,
        macro_category_id,
        micro_category_id,
        { fallbackToDefault: true }
      );

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
        const nextMacroId = hasCategoryInput
          ? resolvedCategories.macro_category_id
          : (target.macro_category_id || resolvedCategories.macro_category_id);
        const nextMicroId = hasCategoryInput
          ? resolvedCategories.micro_category_id
          : (target.micro_category_id || null);
        await connection.query(
          `UPDATE PRODUCTS
           SET name = ?, uom = COALESCE(?, uom), units_per_box = COALESCE(?, units_per_box), boxes_per_pallet = COALESCE(?, boxes_per_pallet),
               kg_per_unit = COALESCE(?, kg_per_unit),
               default_temp_regime = COALESCE(?, default_temp_regime),
               default_is_adr = COALESCE(?, default_is_adr),
               default_adr_data = CASE WHEN ? IS NOT NULL THEN ? ELSE default_adr_data END,
               default_article_number = COALESCE(?, default_article_number), flags = COALESCE(?, flags),
               macro_category_id = ?, micro_category_id = ?
           WHERE id = ?`,
          [
            cleanName, uom || null, units_per_box || null, boxes_per_pallet || null,
            parsedKgPerUnit,
            cleanDefTemp !== undefined ? cleanDefTemp : null,
            cleanDefIsAdr !== undefined ? (cleanDefIsAdr ? 1 : 0) : null,
            cleanDefAdrJson !== undefined ? 1 : null, cleanDefAdrJson ?? null,
            finalDefaultArticle, flagsJson,
            nextMacroId, nextMicroId,
            target.id
          ]
        );
        await connection.query('UPDATE INBOUND_DDT_ITEMS SET sku = ? WHERE product_id = ?', [cleanSku, target.id]);
        await connection.commit();
        if (fastify.io) fastify.io.emit('product_categories_updated');
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
        const nextMacroId = hasCategoryInput
          ? resolvedCategories.macro_category_id
          : (target.macro_category_id || resolvedCategories.macro_category_id);
        const nextMicroId = hasCategoryInput
          ? resolvedCategories.micro_category_id
          : (target.micro_category_id || null);
        await connection.query(
          `UPDATE PRODUCTS
           SET sku = ?, name = ?, uom = COALESCE(?, uom), units_per_box = COALESCE(?, units_per_box), boxes_per_pallet = COALESCE(?, boxes_per_pallet),
               kg_per_unit = COALESCE(?, kg_per_unit),
               default_temp_regime = COALESCE(?, default_temp_regime),
               default_is_adr = COALESCE(?, default_is_adr),
               default_adr_data = CASE WHEN ? IS NOT NULL THEN ? ELSE default_adr_data END,
               default_article_number = COALESCE(?, default_article_number), flags = COALESCE(?, flags),
               macro_category_id = ?, micro_category_id = ?
           WHERE id = ?`,
          [
            newSkuForTarget, cleanName, uom || null, units_per_box || null, boxes_per_pallet || null,
            parsedKgPerUnit,
            cleanDefTemp !== undefined ? cleanDefTemp : null,
            cleanDefIsAdr !== undefined ? (cleanDefIsAdr ? 1 : 0) : null,
            cleanDefAdrJson !== undefined ? 1 : null, cleanDefAdrJson ?? null,
            finalDefaultArticle, flagsJson,
            nextMacroId, nextMicroId,
            target.id
          ]
        );
        await connection.query('UPDATE INBOUND_DDT_ITEMS SET sku = ? WHERE product_id = ?', [newSkuForTarget, target.id]);
        await connection.commit();
        if (fastify.io) fastify.io.emit('product_categories_updated');
        return reply.code(200).send({ success: true, id: target.id, sku: newSkuForTarget });
      }

      const [result] = await connection.query(
        'INSERT INTO PRODUCTS (sku, name, uom, customer_id, notes, units_per_box, boxes_per_pallet, kg_per_unit, default_article_number, flags, default_temp_regime, default_is_adr, default_adr_data, macro_category_id, micro_category_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          cleanSku, cleanName, uom || 'Scatole', customer_id, notes || null, units_per_box || 1, boxes_per_pallet || 1,
          parsedKgPerUnit, finalDefaultArticle, flagsJson,
          cleanDefTemp || 'NONE', cleanDefIsAdr ? 1 : 0, cleanDefAdrJson || null,
          resolvedCategories.macro_category_id, resolvedCategories.micro_category_id
        ]
      );
      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['CREATE_PRODUCT', `Creato prodotto ${cleanName} (${cleanSku})`, 'Gestionale', request.user.username]
      );
      await connection.commit();
      if (fastify.io) fastify.io.emit('product_categories_updated');
      return reply.code(201).send({ success: true, id: result.insertId, sku: cleanSku });
    } catch (err) {
      await connection.rollback();
      if (err.statusCode === 400) {
        return reply.code(400).send({ error: err.message });
      }
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
    const {
      sku, name, uom, customer_id, notes, units_per_box, boxes_per_pallet,
      kg_per_unit, default_article_number, flags, updateExistingPallets,
      default_temp_regime, default_is_adr, default_adr_data,
      macro_category_id, micro_category_id
    } = request.body;
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
    const hasKgField = kg_per_unit !== undefined;
    const parsedKgPerUnit = (kg_per_unit !== undefined && kg_per_unit !== null && kg_per_unit !== '' && Number.isFinite(parseFloat(kg_per_unit)) && parseFloat(kg_per_unit) > 0)
      ? parseFloat(kg_per_unit)
      : null;
    const cleanDefTemp = default_temp_regime !== undefined ? normalizeTempRegime(default_temp_regime) : undefined;
    const cleanDefIsAdr = default_is_adr !== undefined ? Boolean(default_is_adr) : undefined;
    const cleanDefAdrJson = default_adr_data !== undefined
      ? (cleanDefIsAdr ? JSON.stringify(parseAdrData(default_adr_data, cleanName) || {}) : null)
      : undefined;

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

      const hasCategoryField = macro_category_id !== undefined || micro_category_id !== undefined;
      const resolvedCategories = hasCategoryField
        ? await resolveProductCategoryIds(connection, macro_category_id, micro_category_id, { fallbackToDefault: true })
        : null;

      await connection.query(
        `UPDATE PRODUCTS
         SET sku = ?, name = ?, uom = ?, customer_id = ?, notes = ?, units_per_box = ?, boxes_per_pallet = ?,
             kg_per_unit = CASE WHEN ? THEN ? ELSE kg_per_unit END,
             default_temp_regime = COALESCE(?, default_temp_regime),
             default_is_adr = COALESCE(?, default_is_adr),
             default_adr_data = CASE WHEN ? THEN ? ELSE default_adr_data END,
             default_article_number = ?, flags = ?,
             macro_category_id = CASE WHEN ? THEN ? ELSE macro_category_id END,
             micro_category_id = CASE WHEN ? THEN ? ELSE micro_category_id END
         WHERE id = ?`,
        [
          cleanSku, cleanName, uom || 'Scatole', customer_id, notes || null, units_per_box || 1, boxes_per_pallet || 1,
          hasKgField ? 1 : 0, parsedKgPerUnit,
          cleanDefTemp !== undefined ? cleanDefTemp : null,
          cleanDefIsAdr !== undefined ? (cleanDefIsAdr ? 1 : 0) : null,
          cleanDefAdrJson !== undefined ? 1 : 0, cleanDefAdrJson ?? null,
          finalDefaultArticle, flagsJson,
          hasCategoryField ? 1 : 0, resolvedCategories?.macro_category_id ?? null,
          hasCategoryField ? 1 : 0, resolvedCategories?.micro_category_id ?? null,
          targetId
        ]
      );

      await connection.query('UPDATE INBOUND_DDT_ITEMS SET sku = ? WHERE product_id = ?', [cleanSku, targetId]);
      
      if (updateExistingPallets) {
        await connection.query(
          `UPDATE PALLETS
           SET flags = ?,
               kg_per_unit = CASE WHEN ? THEN ? ELSE kg_per_unit END
           WHERE product_id = ?`,
          [flagsJson, hasKgField ? 1 : 0, parsedKgPerUnit, targetId]
        );
      }

      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['UPDATE_PRODUCT', `Aggiornato prodotto ${cleanName} (${cleanSku})`, 'Gestionale', request.user.username]
      );
      
      await connection.commit();
      if (fastify.io) fastify.io.emit('product_categories_updated');
      return { success: true, sku: cleanSku };
    } catch (err) {
      await connection.rollback();
      if (err.statusCode === 400) {
        return reply.code(400).send({ error: err.message });
      }
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
