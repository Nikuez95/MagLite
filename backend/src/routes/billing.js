const { hasPermission, canAccessCustomer } = require('../utils/permissions');
const db = require('../config/db');

async function billingRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('preHandler', async (request, reply) => {
    const isRead = request.method === 'GET' || request.url.includes('/calculate');
    if (isRead) {
      if (
        !hasPermission(request.user, 'view_billing') &&
        !hasPermission(request.user, 'finance_manage') &&
        !hasPermission(request.user, 'tariff_plans_manage') &&
        !hasPermission(request.user, 'client_tariffs_manage')
      ) {
        return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di accedere al modulo Amministrazione/Fatturazione.' });
      }
    } else if (request.url.includes('/tariff-plans')) {
      if (!hasPermission(request.user, 'tariff_plans_manage') && !hasPermission(request.user, 'finance_manage')) {
        return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di aggiungere o modificare i Listini Globali.' });
      }
    } else if (request.url.includes('/tariffs/')) {
      if (!hasPermission(request.user, 'client_tariffs_manage') && !hasPermission(request.user, 'finance_manage')) {
        return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di personalizzare i listini dei singoli clienti.' });
      }
    } else {
      if (!hasPermission(request.user, 'finance_manage') && !hasPermission(request.user, 'tariff_plans_manage')) {
        return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di modificare regole o listini di fatturazione.' });
      }
    }
  });

  // GET Rules
  fastify.get('/rules', async (request, reply) => {
    try {
      const [rows] = await db.query('SELECT * FROM billing_rules ORDER BY rule_type, rule_code');
      return rows;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore fetch regole' });
    }
  });

  // POST Rule (supporta anche creazione rapida Servizio Globale con default 0€)
  fastify.post('/rules', async (request, reply) => {
    const { rule_code, description, default_price, rule_type } = request.body || {};
    const finalType = rule_type || 'MANUAL';
    const cleanDesc = String(description || '').trim();
    let normalizedCode = String(rule_code || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');

    if (!normalizedCode && cleanDesc) {
      const slug = cleanDesc
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 36);
      const prefix = finalType === 'FLAG' ? 'FLAG_' : 'SRV_';
      normalizedCode = `${prefix}${slug || Date.now()}`.slice(0, 50);
    }

    if (finalType === 'FLAG' && normalizedCode && !normalizedCode.startsWith('FLAG_')) {
      normalizedCode = `FLAG_${normalizedCode}`.slice(0, 50);
    }
    if (!normalizedCode || !cleanDesc) {
      return reply.code(400).send({ error: 'Descrizione e codice regola sono obbligatori' });
    }
    try {
      const priceVal = default_price !== undefined && default_price !== '' && !isNaN(parseFloat(default_price))
        ? parseFloat(default_price)
        : 0;
      const [result] = await db.query(
        'INSERT INTO billing_rules (rule_code, description, default_price, rule_type) VALUES (?, ?, ?, ?)',
        [normalizedCode, cleanDesc, priceVal, finalType]
      );
      if (fastify.io) fastify.io.emit('billing_updated');
      return { success: true, id: result.insertId, rule_code: normalizedCode, description: cleanDesc, default_price: priceVal, rule_type: finalType };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore creazione regola, forse il codice esiste già?' });
    }
  });

  // PUT Rule
  fastify.put('/rules/:id', async (request, reply) => {
    const { description, default_price, rule_type } = request.body;
    try {
      await db.query(
        'UPDATE billing_rules SET description = ?, default_price = ?, rule_type = ? WHERE id = ?',
        [description, default_price, rule_type, request.params.id]
      );
      if (fastify.io) fastify.io.emit('billing_updated');
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore modifica regola' });
    }
  });

  // DELETE Rule
  fastify.delete('/rules/:id', async (request, reply) => {
    try {
      await db.query('DELETE FROM billing_rules WHERE id = ?', [request.params.id]);
      if (fastify.io) fastify.io.emit('billing_updated');
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore eliminazione regola (forse in uso da client_tariffs?)' });
    }
  });

  // GET Tariffs (supporta ?planId=X per personalizzare i prezzi di ciascun Listino Globale per singolo cliente / frammentazione)
  fastify.get('/tariffs/:clientId', async (request, reply) => {
    const { clientId } = request.params;
    const requestedPlanId = request.query?.planId ? parseInt(request.query.planId, 10) : null;
    try {
      const [[cust]] = await db.query(
        `SELECT c.id, c.parent_id, c.tariff_plan_id, tp.name AS tariff_plan_name
         FROM CUSTOMERS c
         LEFT JOIN tariff_plans tp ON c.tariff_plan_id = tp.id
         WHERE c.id = ?`,
        [clientId]
      );
      const parentId = cust?.parent_id || null;
      const effectivePlanId = requestedPlanId || cust?.tariff_plan_id || null;

      let activePlan = null;
      if (effectivePlanId) {
        const [[pRow]] = await db.query('SELECT * FROM tariff_plans WHERE id = ?', [effectivePlanId]);
        activePlan = pRow || null;
      }

      if (requestedPlanId) {
        const [rows] = await db.query(`
          SELECT 
            br.rule_code, 
            br.description, 
            br.default_price, 
            br.rule_type,
            cpt.custom_price,
            pcpt.custom_price AS parent_custom_price,
            tpi.price AS plan_price
          FROM billing_rules br
          LEFT JOIN customer_plan_tariffs cpt ON br.rule_code = cpt.rule_code AND cpt.customer_id = ? AND cpt.plan_id = ?
          LEFT JOIN customer_plan_tariffs pcpt ON br.rule_code = pcpt.rule_code AND pcpt.customer_id = ? AND pcpt.plan_id = ?
          LEFT JOIN tariff_plan_items tpi ON br.rule_code = tpi.rule_code AND tpi.plan_id = ?
          ORDER BY br.rule_type, br.rule_code
        `, [clientId, requestedPlanId, parentId, requestedPlanId, requestedPlanId]);

        const isFlat = Boolean(activePlan?.is_flat_rate);
        const filteredRows = isFlat
          ? rows.filter(r => r.rule_code === 'CANONE_FISSO_MENSILE')
          : rows.filter(r => r.rule_code !== 'CANONE_FISSO_MENSILE');

        return filteredRows.map(r => {
          let effective = parseFloat(r.default_price) || 0;
          let source = 'default';
          if (r.custom_price !== null && r.custom_price !== undefined) {
            effective = parseFloat(r.custom_price);
            source = 'custom';
          } else if (r.parent_custom_price !== null && r.parent_custom_price !== undefined) {
            effective = parseFloat(r.parent_custom_price);
            source = 'parent';
          } else if (r.plan_price !== null && r.plan_price !== undefined) {
            effective = parseFloat(r.plan_price);
            source = 'plan';
          }
          return {
            ...r,
            tariff_plan_id: requestedPlanId,
            tariff_plan_name: activePlan?.name || null,
            is_flat_rate: isFlat,
            is_customer_default_plan: Number(cust?.tariff_plan_id) === Number(requestedPlanId),
            source,
            final_price: effective
          };
        });
      }

      const [rows] = await db.query(`
        SELECT 
          br.rule_code, 
          br.description, 
          br.default_price, 
          br.rule_type,
          COALESCE(cpt.custom_price, ct.custom_price) AS custom_price,
          COALESCE(pcpt.custom_price, pct.custom_price) AS parent_custom_price,
          tpi.price as plan_price
        FROM billing_rules br
        LEFT JOIN customer_plan_tariffs cpt ON br.rule_code = cpt.rule_code AND cpt.customer_id = ? AND cpt.plan_id = ?
        LEFT JOIN customer_plan_tariffs pcpt ON br.rule_code = pcpt.rule_code AND pcpt.customer_id = ? AND pcpt.plan_id = ?
        LEFT JOIN client_tariffs ct ON br.rule_code = ct.rule_code AND ct.customer_id = ?
        LEFT JOIN client_tariffs pct ON br.rule_code = pct.rule_code AND pct.customer_id = ?
        LEFT JOIN tariff_plan_items tpi ON br.rule_code = tpi.rule_code AND tpi.plan_id = ?
        ORDER BY br.rule_type, br.rule_code
      `, [clientId, effectivePlanId, parentId, effectivePlanId, clientId, parentId, effectivePlanId]);

      const isFlat = Boolean(activePlan?.is_flat_rate);
      const filteredRows = isFlat
        ? rows.filter(r => r.rule_code === 'CANONE_FISSO_MENSILE')
        : rows.filter(r => r.rule_code !== 'CANONE_FISSO_MENSILE');

      return filteredRows.map(r => {
        let effective = parseFloat(r.default_price) || 0;
        let source = 'default';
        if (r.custom_price !== null && r.custom_price !== undefined) {
          effective = parseFloat(r.custom_price);
          source = 'custom';
        } else if (r.parent_custom_price !== null && r.parent_custom_price !== undefined) {
          effective = parseFloat(r.parent_custom_price);
          source = 'parent';
        } else if (r.plan_price !== null && r.plan_price !== undefined) {
          effective = parseFloat(r.plan_price);
          source = 'plan';
        }
        return {
          ...r,
          tariff_plan_id: effectivePlanId,
          tariff_plan_name: activePlan?.name || cust?.tariff_plan_name || null,
          is_flat_rate: isFlat,
          is_customer_default_plan: Boolean(effectivePlanId && Number(cust?.tariff_plan_id) === Number(effectivePlanId)),
          source,
          final_price: effective
        };
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore fetch tariffe' });
    }
  });

  // POST Tariffs (Upsert per listino globale specifico o legacy)
  fastify.post('/tariffs/:clientId', async (request, reply) => {
    const { clientId } = request.params;
    const { tariffs, plan_id = null } = request.body || {}; // [{ rule_code, custom_price }]
    
    if (!tariffs || !Array.isArray(tariffs)) {
      return reply.code(400).send({ error: 'Formato tariffe non valido' });
    }

    const parsedPlanId = plan_id ? parseInt(plan_id, 10) : null;
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [[cust]] = await conn.query('SELECT tariff_plan_id FROM CUSTOMERS WHERE id = ?', [clientId]);

      if (parsedPlanId) {
        for (const t of tariffs) {
          const val = parseFloat(t.custom_price) || 0;
          await conn.query(`
            INSERT INTO customer_plan_tariffs (customer_id, plan_id, rule_code, custom_price)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE custom_price = ?
          `, [clientId, parsedPlanId, t.rule_code, val, val]);

          if (cust && Number(cust.tariff_plan_id) === parsedPlanId) {
            await conn.query(`
              INSERT INTO client_tariffs (customer_id, rule_code, custom_price) 
              VALUES (?, ?, ?)
              ON DUPLICATE KEY UPDATE custom_price = ?
            `, [clientId, t.rule_code, val, val]);
          }
        }
      } else {
        for (const t of tariffs) {
          const val = parseFloat(t.custom_price) || 0;
          await conn.query(`
            INSERT INTO client_tariffs (customer_id, rule_code, custom_price) 
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE custom_price = ?
          `, [clientId, t.rule_code, val, val]);
        }
      }
      await conn.commit();
      if (fastify.io) fastify.io.emit('billing_updated', { clientId });
      return { success: true };
    } catch (err) {
      await conn.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore salvataggio tariffe' });
    } finally {
      conn.release();
    }
  });

  // POST /api/billing/tariffs/:clientId/reset-plan - Rimuove le personalizzazioni locali del cliente su un listino globale
  fastify.post('/tariffs/:clientId/reset-plan', async (request, reply) => {
    const clientId = parseInt(request.params.clientId, 10);
    const planId = parseInt(request.body?.plan_id, 10);
    if (!planId) return reply.code(400).send({ error: 'plan_id richiesto' });
    try {
      await db.query('DELETE FROM customer_plan_tariffs WHERE customer_id = ? AND plan_id = ?', [clientId, planId]);
      if (fastify.io) fastify.io.emit('billing_updated', { clientId });
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore ripristino listino' });
    }
  });

  // ==========================================
  // LISTINI GLOBALI (TARIFF PLANS)
  // ==========================================

  // GET /api/billing/tariff-plans
  fastify.get('/tariff-plans', async (request, reply) => {
    try {
      const [plans] = await db.query(`
        SELECT tp.*, COALESCE(c_agg.cnt, 0) AS assigned_count
        FROM tariff_plans tp
        LEFT JOIN (
          SELECT tariff_plan_id, COUNT(*) AS cnt
          FROM CUSTOMERS
          WHERE tariff_plan_id IS NOT NULL
          GROUP BY tariff_plan_id
        ) c_agg ON c_agg.tariff_plan_id = tp.id
        ORDER BY tp.is_flat_rate DESC, tp.is_default DESC, tp.name ASC
      `);
      const [items] = await db.query('SELECT plan_id, rule_code, price FROM tariff_plan_items');
      const itemsByPlan = new Map();
      items.forEach(it => {
        if (!itemsByPlan.has(it.plan_id)) itemsByPlan.set(it.plan_id, {});
        itemsByPlan.get(it.plan_id)[it.rule_code] = parseFloat(it.price) || 0;
      });

      return plans.map(p => ({
        ...p,
        is_default: Boolean(p.is_default),
        is_flat_rate: Boolean(p.is_flat_rate),
        items: itemsByPlan.get(p.id) || {}
      }));
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore caricamento listini globali' });
    }
  });

  // POST /api/billing/tariff-plans
  fastify.post('/tariff-plans', async (request, reply) => {
    const { name, invoice_label, description, is_default = false, is_flat_rate = false, items = {} } = request.body || {};
    const cleanName = String(name || '').trim();
    if (!cleanName) {
      return reply.code(400).send({ error: 'Il nome del listino globale è obbligatorio' });
    }
    const cleanInvoiceLabel = String(invoice_label || '').trim() || cleanName;

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      if (is_default) {
        await conn.query('UPDATE tariff_plans SET is_default = FALSE');
      }
      const [res] = await conn.query(
        'INSERT INTO tariff_plans (name, invoice_label, description, is_default, is_flat_rate) VALUES (?, ?, ?, ?, ?)',
        [cleanName, cleanInvoiceLabel, description ? String(description).trim() : null, Boolean(is_default), Boolean(is_flat_rate)]
      );
      const planId = res.insertId;

      const entries = Boolean(is_flat_rate)
        ? [['CANONE_FISSO_MENSILE', parseFloat(items?.CANONE_FISSO_MENSILE) || 0]]
        : (Array.isArray(items)
            ? items.map(i => [i.rule_code, parseFloat(i.price) || 0])
            : Object.entries(items || {}).map(([code, val]) => [code, parseFloat(val) || 0]));

      for (const [ruleCode, price] of entries) {
        if (!ruleCode) continue;
        await conn.query(
          'INSERT INTO tariff_plan_items (plan_id, rule_code, price) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE price = ?',
          [planId, ruleCode, price, price]
        );
      }

      await conn.commit();
      if (fastify.io) fastify.io.emit('billing_updated');
      return reply.code(201).send({ success: true, id: planId, name: cleanName, invoice_label: cleanInvoiceLabel });
    } catch (err) {
      await conn.rollback();
      if (err.code === 'ER_DUP_ENTRY') {
        return reply.code(400).send({ error: 'Esiste già un listino globale con questo nome' });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore creazione listino globale' });
    } finally {
      conn.release();
    }
  });

  // PUT /api/billing/tariff-plans/:id
  fastify.put('/tariff-plans/:id', async (request, reply) => {
    const planId = parseInt(request.params.id, 10);
    const { name, invoice_label, description, is_default = false, items = {}, sync_assigned = false } = request.body || {};
    const cleanName = String(name || '').trim();
    if (!cleanName) {
      return reply.code(400).send({ error: 'Il nome del listino globale è obbligatorio' });
    }
    const cleanInvoiceLabel = String(invoice_label || '').trim() || cleanName;

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [existingRows] = await conn.query('SELECT id, is_flat_rate FROM tariff_plans WHERE id = ?', [planId]);
      if (existingRows.length === 0) {
        await conn.rollback();
        return reply.code(404).send({ error: 'Listino globale non trovato' });
      }
      const isFlatRate = Boolean(existingRows[0].is_flat_rate);

      if (is_default) {
        await conn.query('UPDATE tariff_plans SET is_default = FALSE WHERE id != ?', [planId]);
      }
      await conn.query(
        'UPDATE tariff_plans SET name = ?, invoice_label = ?, description = ?, is_default = ? WHERE id = ?',
        [cleanName, cleanInvoiceLabel, description ? String(description).trim() : null, Boolean(is_default), planId]
      );

      const entries = isFlatRate
        ? [['CANONE_FISSO_MENSILE', parseFloat(items?.CANONE_FISSO_MENSILE) || 0]]
        : (Array.isArray(items)
            ? items.map(i => [i.rule_code, parseFloat(i.price) || 0])
            : Object.entries(items || {}).map(([code, val]) => [code, parseFloat(val) || 0]));

      for (const [ruleCode, price] of entries) {
        if (!ruleCode) continue;
        await conn.query(
          'INSERT INTO tariff_plan_items (plan_id, rule_code, price) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE price = ?',
          [planId, ruleCode, price, price]
        );
      }

      if (sync_assigned) {
        const [assignedCustomers] = await conn.query('SELECT id FROM CUSTOMERS WHERE tariff_plan_id = ?', [planId]);
        for (const c of assignedCustomers) {
          for (const [ruleCode, price] of entries) {
            if (!ruleCode) continue;
            await conn.query(
              'INSERT INTO customer_plan_tariffs (customer_id, plan_id, rule_code, custom_price) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE custom_price = ?',
              [c.id, planId, ruleCode, price, price]
            );
            await conn.query(
              'INSERT INTO client_tariffs (customer_id, rule_code, custom_price) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE custom_price = ?',
              [c.id, ruleCode, price, price]
            );
          }
        }
      }

      await conn.commit();
      if (fastify.io) fastify.io.emit('billing_updated');
      return { success: true };
    } catch (err) {
      await conn.rollback();
      if (err.code === 'ER_DUP_ENTRY') {
        return reply.code(400).send({ error: 'Esiste già un listino globale con questo nome' });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore aggiornamento listino globale' });
    } finally {
      conn.release();
    }
  });

  // DELETE /api/billing/tariff-plans/:id
  fastify.delete('/tariff-plans/:id', async (request, reply) => {
    const planId = parseInt(request.params.id, 10);
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [planRows] = await conn.query('SELECT id, name, is_flat_rate, is_default FROM tariff_plans WHERE id = ?', [planId]);
      if (planRows.length === 0) {
        await conn.rollback();
        return reply.code(404).send({ error: 'Listino globale non trovato' });
      }
      if (planRows[0].is_flat_rate && (planRows[0].is_default || String(planRows[0].name).toLowerCase() === 'fisso mensile')) {
        await conn.rollback();
        return reply.code(400).send({ error: 'Il listino predefinito "Fisso Mensile" non può essere eliminato' });
      }
      await conn.query('UPDATE CUSTOMERS SET tariff_plan_id = NULL WHERE tariff_plan_id = ?', [planId]);
      await conn.query('DELETE FROM tariff_plans WHERE id = ?', [planId]);
      await conn.commit();
      if (fastify.io) fastify.io.emit('billing_updated');
      return { success: true };
    } catch (err) {
      await conn.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore eliminazione listino globale' });
    } finally {
      conn.release();
    }
  });

  // POST /api/billing/tariffs/:clientId/apply-plan - Applica un Listino Globale a un cliente (o anche alle sue frammentazioni)
  fastify.post('/tariffs/:clientId/apply-plan', async (request, reply) => {
    const clientId = parseInt(request.params.clientId, 10);
    const { plan_id, apply_to_fragments = false } = request.body || {};
    const planId = parseInt(plan_id, 10);

    if (!planId) {
      return reply.code(400).send({ error: 'Seleziona un listino globale valido' });
    }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [[plan]] = await conn.query('SELECT * FROM tariff_plans WHERE id = ?', [planId]);
      if (!plan) {
        await conn.rollback();
        return reply.code(404).send({ error: 'Listino globale non trovato' });
      }

      const [rules] = await conn.query('SELECT rule_code, default_price FROM billing_rules');
      const [planItems] = await conn.query('SELECT rule_code, price FROM tariff_plan_items WHERE plan_id = ?', [planId]);
      const itemMap = new Map(planItems.map(i => [i.rule_code, parseFloat(i.price) || 0]));

      const targetIds = [clientId];
      if (apply_to_fragments) {
        const [children] = await conn.query('SELECT id FROM CUSTOMERS WHERE parent_id = ?', [clientId]);
        children.forEach(ch => targetIds.push(ch.id));
      }

      for (const tid of targetIds) {
        await conn.query('UPDATE CUSTOMERS SET tariff_plan_id = ? WHERE id = ?', [planId, tid]);
        for (const r of rules) {
          const price = itemMap.has(r.rule_code) ? itemMap.get(r.rule_code) : (parseFloat(r.default_price) || 0);
          await conn.query(
            `INSERT INTO customer_plan_tariffs (customer_id, plan_id, rule_code, custom_price)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE custom_price = VALUES(custom_price)`,
            [tid, planId, r.rule_code, price]
          );
          await conn.query(
            `INSERT INTO client_tariffs (customer_id, rule_code, custom_price)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE custom_price = ?`,
            [tid, r.rule_code, price, price]
          );
        }
      }

      await conn.commit();
      if (fastify.io) fastify.io.emit('billing_updated', { clientId });
      return { success: true, appliedCount: targetIds.length, planName: plan.name };
    } catch (err) {
      await conn.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore applicazione listino globale' });
    } finally {
      conn.release();
    }
  });

  // GET /api/billing/pallet/:code/history - Dettaglio completo e storico a 360° di una paletta (per pop-up in Pre-Fatturazione)
  fastify.get('/pallet/:code/history', async (request, reply) => {
    const { code } = request.params;
    try {
      const [palletRows] = await db.query(`
        SELECT p.*,
               pr.name AS product_name,
               pr.sku AS product_sku,
               pr.uom AS product_uom,
               COALESCE(p.units_per_box, pr.units_per_box, 1) AS effective_units_per_box,
               COALESCE(pr.boxes_per_pallet, 1) AS effective_boxes_per_pallet,
               c.business_name AS customer_name,
               c.unique_id AS customer_unique_id,
               pc.business_name AS parent_customer_name,
               d.ddt_number AS inbound_ddt_number,
               d.status AS inbound_ddt_status,
               d.created_at AS inbound_ddt_created_at,
               d.closed_at AS inbound_ddt_closed_at,
               d.discrepancy_reason,
               d.discrepancy_resolved_by
        FROM PALLETS p
        LEFT JOIN PRODUCTS pr ON p.product_id = pr.id
        LEFT JOIN CUSTOMERS c ON p.customer_id = c.id
        LEFT JOIN CUSTOMERS pc ON c.parent_id = pc.id
        LEFT JOIN INBOUND_DDTS d ON p.inbound_ddt_id = d.id
        WHERE p.pallet_code = ?
        ORDER BY p.id ASC
      `, [code]);

      if (palletRows.length === 0) {
        return reply.code(404).send({ error: 'Paletta non trovata' });
      }

      const palletIds = palletRows.map(r => r.id);

      const [outboundPicks] = await db.query(`
        SELECT oi.*,
               o.order_code,
               o.client_ddt,
               o.notes AS order_notes,
               o.exit_date,
               o.status AS order_status,
               o.picking_operator,
               o.start_picking_at,
               o.end_picking_at,
               o.shipped_at,
               o.shipped_by,
               o.created_by,
               o.created_at AS order_created_at,
               pr.name AS product_name,
               pr.sku AS product_sku
        FROM OUTBOUND_ITEMS oi
        JOIN OUTBOUND_ORDERS o ON oi.order_id = o.id
        LEFT JOIN PRODUCTS pr ON oi.product_id = pr.id
        WHERE oi.pallet_code = ? OR oi.pallet_id IN (?)
        ORDER BY COALESCE(oi.picked_at, o.shipped_at, o.created_at) DESC
      `, [code, palletIds]);

      const [auditLogs] = await db.query(`
        SELECT * FROM AUDIT_LOGS
        WHERE details LIKE ?
        ORDER BY created_at DESC
        LIMIT 150
      `, [`%${code}%`]);

      return {
        pallet_code: code,
        rows: palletRows,
        outboundPicks,
        auditLogs
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore caricamento storico paletta' });
    }
  });

  // POST Calculate (Supporta Sosta Giornaliera Pro-Rata Mensile + Pre-Fatturazione per Deposito + Suddivisione per Frammentazioni + Dettaglio Completo Articolo/Lotto/Scadenza/Arrivo/Uscita)
  fastify.post('/calculate', async (request, reply) => {
    let {
      clientId,
      month,
      year,
      includeHistorical = true,
      includeDeposit = true,
      includeStorage = true,
      includeDailyStorage = false,
      capToToday = false,
      storageMode // 'GIORNALIERO' | 'DEPOSITO_FINE_MESE' | 'QUINDICINA' | 'ENTRAMBI' | 'NESSUNO'
    } = request.body;

    // Regola anti-doppio addebito stoccaggio / selezione modalità:
    if (storageMode === 'GIORNALIERO') {
      includeDailyStorage = true;
      includeStorage = false;
      includeDeposit = false;
    } else if (storageMode === 'DEPOSITO_FINE_MESE') {
      includeDailyStorage = false;
      includeStorage = false;
      includeDeposit = true;
    } else if (storageMode === 'QUINDICINA') {
      includeDailyStorage = false;
      includeStorage = true;
      includeDeposit = false;
    } else if (storageMode === 'NESSUNO') {
      includeDailyStorage = false;
      includeStorage = false;
      includeDeposit = false;
    } else if (storageMode === 'ENTRAMBI') {
      includeDailyStorage = false;
      includeStorage = true;
      includeDeposit = true;
    } else if (includeDeposit && includeStorage) {
      // Se entrambi sono lasciati a true, privilegiamo DEPOSITO_PALLET fine mese per evitare doppio addebito con SOSTA_15
      includeStorage = false;
    }
    
    if (!clientId || !month || !year) {
      return reply.code(400).send({ error: 'Client, mese e anno richiesti' });
    }

    try {
      // 1. Recupero il cliente selezionato e le sue eventuali frammentazioni
      const [[mainCustomer]] = await db.query(
        `SELECT c.*, p.business_name as parent_business_name
         FROM CUSTOMERS c
         LEFT JOIN CUSTOMERS p ON c.parent_id = p.id
         WHERE c.id = ?`,
        [clientId]
      );

      if (!mainCustomer) {
        return reply.code(404).send({ error: 'Cliente non trovato' });
      }

      const [childFragments] = await db.query(
        'SELECT * FROM CUSTOMERS WHERE parent_id = ? ORDER BY business_name ASC',
        [clientId]
      );

      const entitiesToProcess = [mainCustomer, ...childFragments];
      const hasFragments = childFragments.length > 0;

      // Calcolo date del mese selezionato (se il mese è in corso, conta i giorni solo fino ad oggi automaticamente)
      const startDate = new Date(year, month - 1, 1, 0, 0, 0);
      const endDate = new Date(year, month, 0, 23, 59, 59);
      const now = new Date();
      const isAutoMode = !storageMode || storageMode === 'AUTO';
      const effectiveMonthEnd = ((isAutoMode || capToToday) && now >= startDate && now <= endDate) ? now : endDate;

      const toDayIndex = (dt) => {
        const d = new Date(dt);
        return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
      };
      const monthStartDay = toDayIndex(startDate);
      const monthEndDay = toDayIndex(effectiveMonthEnd);

      const formatDateIT = (d) => {
        if (!d) return '';
        const dt = new Date(d);
        return isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
      };

      const allItems = [];
      const allPalletDetails = [];
      const sections = [];
      let grandBaseTotal = 0;

      // Precaricamento Listini Globali e Regole Base per risoluzione per-paletta (multilistino cliente/frammentazione)
      const [allPlansRows] = await db.query('SELECT id, name, invoice_label, is_default, is_flat_rate FROM tariff_plans');
      const planMap = new Map();
      let defaultGlobalPlan = null;
      allPlansRows.forEach(p => {
        const obj = {
          id: p.id,
          name: p.name,
          invoice_label: (p.invoice_label && String(p.invoice_label).trim()) || p.name,
          is_default: Boolean(p.is_default),
          is_flat_rate: Boolean(p.is_flat_rate)
        };
        planMap.set(p.id, obj);
        if (obj.is_default && !defaultGlobalPlan) defaultGlobalPlan = obj;
      });

      const [allRulesRows] = await db.query('SELECT rule_code, description, rule_type, default_price FROM billing_rules');
      const [allPlanItemsRows] = await db.query('SELECT plan_id, rule_code, price FROM tariff_plan_items');
      const globalPlanItemsMap = new Map(); // plan_id -> Map<rule_code, price>
      allPlanItemsRows.forEach(item => {
        if (!globalPlanItemsMap.has(item.plan_id)) globalPlanItemsMap.set(item.plan_id, new Map());
        globalPlanItemsMap.get(item.plan_id).set(String(item.rule_code).trim().toUpperCase(), parseFloat(item.price) || 0);
      });

      for (const entity of entitiesToProcess) {
        // Carico personalizzazioni per listino globale (frammentazione -> cliente madre) e fallback legacy client_tariffs
        const entityIdsForLookup = entity.parent_id ? [entity.id, entity.parent_id] : [entity.id];
        const placeholders = entityIdsForLookup.map(() => '?').join(',');
        const [cptRows] = await db.query(
          `SELECT customer_id, plan_id, rule_code, custom_price FROM customer_plan_tariffs WHERE customer_id IN (${placeholders})`,
          entityIdsForLookup
        );
        const [legacyRows] = await db.query(
          `SELECT customer_id, rule_code, custom_price FROM client_tariffs WHERE customer_id IN (${placeholders})`,
          entityIdsForLookup
        );

        const entityCptMap = new Map(); // `${plan_id}||${rule_code}` -> price
        const parentCptMap = new Map();
        cptRows.forEach(r => {
          const k = `${r.plan_id}||${String(r.rule_code).trim().toUpperCase()}`;
          if (r.customer_id === entity.id) entityCptMap.set(k, parseFloat(r.custom_price) || 0);
          else if (entity.parent_id && r.customer_id === entity.parent_id) parentCptMap.set(k, parseFloat(r.custom_price) || 0);
        });

        const entityLegacyMap = new Map();
        const parentLegacyMap = new Map();
        legacyRows.forEach(r => {
          const rc = String(r.rule_code).trim().toUpperCase();
          if (r.customer_id === entity.id) entityLegacyMap.set(rc, parseFloat(r.custom_price) || 0);
          else if (entity.parent_id && r.customer_id === entity.parent_id) parentLegacyMap.set(rc, parseFloat(r.custom_price) || 0);
        });

        const planTariffsCache = new Map();
        const getTariffsForPlan = (requestedPlanId) => {
          const parsedReq = requestedPlanId ? parseInt(requestedPlanId, 10) : null;
          const effectivePlanId = parsedReq || entity.tariff_plan_id || defaultGlobalPlan?.id || null;
          const cacheKey = effectivePlanId ? String(effectivePlanId) : 'LEGACY';
          if (planTariffsCache.has(cacheKey)) return planTariffsCache.get(cacheKey);

          const planInfo = effectivePlanId ? planMap.get(effectivePlanId) : null;
          const planItems = effectivePlanId ? globalPlanItemsMap.get(effectivePlanId) : null;
          const useLegacyClientFallback = !effectivePlanId || effectivePlanId === entity.tariff_plan_id;

          const rules = {};
          allRulesRows.forEach(br => {
            const rc = String(br.rule_code).trim().toUpperCase();
            let resolvedPrice = null;
            if (effectivePlanId) {
              const key = `${effectivePlanId}||${rc}`;
              if (entityCptMap.has(key)) resolvedPrice = entityCptMap.get(key);
              else if (parentCptMap.has(key)) resolvedPrice = parentCptMap.get(key);
            }
            if (resolvedPrice === null && useLegacyClientFallback) {
              if (entityLegacyMap.has(rc)) resolvedPrice = entityLegacyMap.get(rc);
              else if (parentLegacyMap.has(rc)) resolvedPrice = parentLegacyMap.get(rc);
            }
            if (resolvedPrice === null && planItems && planItems.has(rc)) {
              resolvedPrice = planItems.get(rc);
            }
            if (resolvedPrice === null) {
              resolvedPrice = parseFloat(br.default_price) || 0;
            }
            rules[rc] = { price: resolvedPrice, desc: br.description };
          });

          if (!rules['DEPOSITO_PALLET']) {
            rules['DEPOSITO_PALLET'] = {
              price: rules['SOSTA_15']?.price || 10.0,
              desc: 'Deposito Paletta (Giacenza Rimasta)'
            };
          }
          if (!rules['SOSTA_GIORNO']) {
            rules['SOSTA_GIORNO'] = {
              price: 0.50,
              desc: 'Sosta Giornaliera (Prezzo al Giorno per Paletta)'
            };
          }

          const planName = planInfo?.name || (effectivePlanId ? `Listino #${effectivePlanId}` : 'Listino Standard');
          const invoiceLabel = planInfo?.invoice_label || planName;
          const bundle = {
            planId: effectivePlanId,
            planName,
            invoiceLabel,
            isFlatRate: Boolean(planInfo?.is_flat_rate),
            rules
          };
          planTariffsCache.set(cacheKey, bundle);
          return bundle;
        };

        const defaultEntityBundle = getTariffsForPlan(entity.tariff_plan_id || defaultGlobalPlan?.id || null);
        const tariffs = defaultEntityBundle.rules;

        // Trovo le palette di questa specifica entità con tutti i dettagli prodotto, codice articolo, lotto, rif. paletta cliente, note, pesi, listino e quantità storica se spedita
        const [pallets] = await db.query(`
          SELECT p.id, p.pallet_code,
                 p.tariff_plan_id,
                 p.net_weight_kg,
                 p.gross_weight_kg,
                 p.client_pallet_number AS customer_pallet_ref,
                 p.client_pallet_number,
                 COALESCE(NULLIF(p.client_article_number, ''), pr.sku) AS sku,
                 p.created_at,
                 COALESCE(p.shipped_at, IF(p.status = 'SHIPPED', p.created_at, NULL)) as shipped_at,
                 p.flags,
                 p.quantity AS current_quantity,
                 COALESCE(
                   NULLIF(p.quantity, 0),
                   (SELECT SUM(COALESCE(NULLIF(oi.quantity_picked, 0), oi.quantity_required))
                    FROM OUTBOUND_ITEMS oi
                    WHERE oi.pallet_id = p.id OR (oi.pallet_id IS NULL AND oi.pallet_code = p.pallet_code AND oi.product_id = p.product_id)),
                   p.quantity
                 ) AS effective_quantity,
                 COALESCE(p.pallet_uom, pr.uom, 'Pezzi') AS pallet_uom,
                 p.batch,
                 p.notes,
                 p.location,
                 p.warehouse,
                 p.expiration_date,
                 p.status,
                 pr.name as product_name,
                 pr.id as product_id,
                 d.ddt_number as inbound_ddt_number
          FROM PALLETS p
          LEFT JOIN PRODUCTS pr ON p.product_id = pr.id
          LEFT JOIN INBOUND_DDTS d ON p.inbound_ddt_id = d.id
          WHERE p.customer_id = ? 
          AND p.created_at <= ? 
          AND (
            COALESCE(p.shipped_at, IF(p.status = 'SHIPPED', p.created_at, NULL)) IS NULL
            OR COALESCE(p.shipped_at, IF(p.status = 'SHIPPED', p.created_at, NULL)) >= ?
          )
          AND (
            p.inbound_ddt_id IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM INBOUND_DDTS d2 WHERE d2.id = p.inbound_ddt_id AND d2.status != 'COMPLETED'
            )
          )
          ORDER BY p.created_at ASC, p.pallet_code ASC
        `, [entity.id, endDate, startDate]);

        const sectionItems = [];
        const sectionPallets = [];
        let sectionTotal = 0;

        const planGroupsMap = new Map();
        const getOrCreatePlanGroup = (bundle) => {
          const pKey = bundle.planId ? String(bundle.planId) : 'LEGACY';
          if (!planGroupsMap.has(pKey)) {
            planGroupsMap.set(pKey, {
              planKey: pKey,
              planId: bundle.planId || null,
              planName: bundle.planName || 'Listino Standard',
              invoiceLabel: bundle.invoiceLabel || bundle.planName || 'Listino Standard',
              isFlatRate: Boolean(bundle.isFlatRate),
              tariffsSummary: {
                inPallet: bundle.rules['IN_PALLET']?.price || 0,
                outPallet: bundle.rules['OUT_PALLET']?.price || 0,
                depositPallet: bundle.rules['DEPOSITO_PALLET']?.price || 0,
                sosta15: bundle.rules['SOSTA_15']?.price || 0,
                sostaGiorno: bundle.rules['SOSTA_GIORNO']?.price || 0
              },
              inboundByDayAndTag: new Map(),
              outboundByDayAndTag: new Map(),
              depositByTag: new Map(),
              dailyStorageSummary: { palletCount: 0, totalDays: 0, totalAmount: 0, pallets: [] },
              pallets: [],
              subtotal: 0
            });
          }
          return planGroupsMap.get(pKey);
        };

        const inboundByDayAndTag = new Map();
        const outboundByDayAndTag = new Map();
        const depositByTag = new Map();
        const dailyStorageSummary = { palletCount: 0, totalDays: 0, totalAmount: 0, pallets: [] };

        const addSectionCost = (group, code, desc, qty, palletSummaryObj, priceOverride, activeTariffs = tariffs, planMeta = null) => {
          const price = priceOverride !== undefined ? priceOverride : (activeTariffs[code]?.price || 0);
          if (price === 0) return 0;
          const pPlanId = planMeta?.planId || null;
          const pPlanKey = pPlanId ? String(pPlanId) : 'LEGACY';
          const existing = sectionItems.find(i => i.code === code && i.price === price && (i.tariffPlanId || null) === pPlanId);
          if (existing) {
            existing.qty += qty;
            existing.subtotal += (qty * price);
            if (palletSummaryObj && !existing.palletCodes.includes(palletSummaryObj.pallet_code)) {
              existing.palletCodes.push(palletSummaryObj.pallet_code);
              existing.palletsList.push(palletSummaryObj);
            }
          } else {
            sectionItems.push({
              id: Math.random().toString(36).substring(2, 9),
              sectionId: entity.id,
              sectionName: entity.business_name,
              isParent: !entity.parent_id,
              tariffPlanId: pPlanId,
              tariffPlanName: planMeta?.planName || null,
              invoiceLabel: planMeta?.invoiceLabel || planMeta?.planName || null,
              group,
              code,
              description: desc || activeTariffs[code]?.desc || code,
              palletCodes: palletSummaryObj ? [palletSummaryObj.pallet_code] : [],
              palletsList: palletSummaryObj ? [palletSummaryObj] : [],
              qty,
              price,
              subtotal: qty * price
            });
          }
          sectionTotal += (qty * price);
          if (planGroupsMap.has(pPlanKey)) {
            planGroupsMap.get(pPlanKey).subtotal += (qty * price);
          }
          return qty * price;
        };

        const addedFlatFeePlanKeys = new Set();

        // Raggruppo per pallet_code per evitare sovrafatturazione sulle palette miste
        const groupedPalletsMap = new Map();
        pallets.forEach(p => {
          const code = p.pallet_code;
          if (!groupedPalletsMap.has(code)) {
            groupedPalletsMap.set(code, []);
          }
          groupedPalletsMap.get(code).push(p);
        });

        groupedPalletsMap.forEach((rows, code) => {
          const createdTimes = rows.map(r => new Date(r.created_at).getTime()).filter(t => !isNaN(t));
          const inDate = createdTimes.length > 0 ? new Date(Math.min(...createdTimes)) : new Date(rows[0].created_at);

          const allShipped = rows.every(r => Boolean(r.shipped_at));
          const shippedTimes = allShipped ? rows.map(r => new Date(r.shipped_at).getTime()).filter(t => !isNaN(t)) : [];
          const outDate = (allShipped && shippedTimes.length > 0) ? new Date(Math.max(...shippedTimes)) : null;

          // Risolvo il Listino Globale assegnato a questa paletta (con fallback al listino dell'entità)
          const rowPlanId = rows.find(r => r.tariff_plan_id)?.tariff_plan_id || null;
          const palletPlanBundle = getTariffsForPlan(rowPlanId);
          const pTariffs = palletPlanBundle.rules;
          const isFlatRatePallet = palletPlanBundle.isFlatRate;
          const pGroupBucket = getOrCreatePlanGroup(palletPlanBundle);

          const netWeights = rows.map(r => parseFloat(r.net_weight_kg)).filter(w => !isNaN(w) && w > 0);
          const grossWeights = rows.map(r => parseFloat(r.gross_weight_kg)).filter(w => !isNaN(w) && w > 0);
          const totalNetWeightKg = netWeights.length > 0 ? Number(netWeights.reduce((a, b) => a + b, 0).toFixed(3)) : null;
          const totalGrossWeightKg = grossWeights.length > 0 ? Number(grossWeights.reduce((a, b) => a + b, 0).toFixed(3)) : null;

          const uniqueFlagsSet = new Set();
          rows.forEach(r => {
            let parsed = [];
            try {
              parsed = r.flags ? (typeof r.flags === 'string' ? JSON.parse(r.flags) : r.flags) : [];
            } catch (e) {
              parsed = [];
            }
            if (Array.isArray(parsed)) {
              parsed.forEach(f => {
                if (f) uniqueFlagsSet.add(String(f).trim().toUpperCase());
              });
            }
          });
          const uniqueFlags = Array.from(uniqueFlagsSet);
          const tagLabel = uniqueFlags.length > 0 ? uniqueFlags.join(', ') : '';

          const custRef = rows.find(r => r.client_pallet_number)?.client_pallet_number || null;
          const uniqueSkus = [...new Set(rows.map(r => r.sku).filter(Boolean))];
          const uniqueProducts = [...new Set(rows.map(r => r.product_name).filter(Boolean))];
          const uniqueBatches = [...new Set(rows.map(r => r.batch).filter(Boolean))];
          const uniqueNotes = [...new Set(rows.map(r => r.notes && String(r.notes).trim()).filter(Boolean))];
          const totalQty = rows.reduce((sum, r) => sum + (parseFloat(r.effective_quantity) || 0), 0);
          const uniqueUoms = [...new Set(rows.map(r => r.pallet_uom || 'Pezzi'))];

          const skuStr = uniqueSkus.join(', ') || '-';
          const prodNameStr = rows.length === 1
            ? (rows[0].product_name || 'Articolo')
            : (uniqueProducts.length > 1
                ? `Paletta Mista (${uniqueProducts.join(' + ')})`
                : `${uniqueProducts[0] || 'Articolo'} (${rows.length} lotti)`);
          const batchStr = uniqueBatches.join(', ') || '-';
          const uomStr = uniqueUoms.join('/');
          const notesStr = uniqueNotes.join(' | ') || '';

          const humanLabel = `${prodNameStr}${batchStr !== '-' ? ` (Lotto: ${batchStr})` : ''}${custRef ? ` • Rif.Pal: ${custRef}` : ''}`;

          const isEnteredInMonth = inDate >= startDate && inDate <= endDate;
          const isExitedInMonth = Boolean(outDate && outDate >= startDate && outDate <= endDate);
          const isRemainingInDeposit = !outDate || outDate > endDate;

          const isHistoricalPallet = inDate < startDate;
          if (!isAutoMode && isHistoricalPallet && !isExitedInMonth && !includeHistorical) {
            return;
          }

          // Giorni esatti di sosta ricadenti esclusivamente nel mese selezionato (pro-rata mensile)
          const inDay = toDayIndex(inDate);
          const outDay = outDate ? toDayIndex(outDate) : null;
          const effectiveStartDay = Math.max(inDay, monthStartDay);
          const effectiveEndDay = outDay !== null ? Math.min(outDay, monthEndDay) : monthEndDay;
          const storageDays = (effectiveEndDay >= effectiveStartDay) ? (effectiveEndDay - effectiveStartDay + 1) : 0;

          const uniqueExpDates = [...new Set(
            rows.map(r => (r.expiration_date ? formatDateIT(r.expiration_date) : '')).filter(Boolean)
          )];
          const expDateStr = uniqueExpDates.join(', ') || '-';
          const rawFirstExpDate = rows.find(r => r.expiration_date)?.expiration_date || null;

          const palletCharges = [];
          let palletTotalPrice = 0;

          const palletSummaryObj = {
            pallet_code: code,
            humanLabel,
            sku: skuStr,
            product_name: prodNameStr,
            batch: batchStr,
            quantity: totalQty,
            pallet_uom: uomStr,
            net_weight_kg: totalNetWeightKg,
            gross_weight_kg: totalGrossWeightKg,
            tariff_plan_id: palletPlanBundle.planId,
            tariff_plan_name: palletPlanBundle.planName,
            invoice_label: palletPlanBundle.invoiceLabel,
            is_flat_rate: isFlatRatePallet,
            customer_pallet_ref: custRef,
            notes: notesStr,
            expiration_date: rawFirstExpDate,
            expiration_date_str: expDateStr,
            created_at: inDate,
            shipped_at: outDate,
            storageDays
          };

          // Helper locale per pushare sia nella mappa sezione sia nel gruppo Listino
          const pushTagEntry = (secMap, grpMap, key, factory) => {
            if (!secMap.has(key)) secMap.set(key, factory());
            secMap.get(key).pallets.push(palletSummaryObj);
            if (!grpMap.has(key)) grpMap.set(key, factory());
            grpMap.get(key).pallets.push(palletSummaryObj);
          };

          // 1. INBOUND
          if (isEnteredInMonth) {
            if (!isFlatRatePallet) {
              const c = addSectionCost('EVENTI', 'IN_PALLET', pTariffs['IN_PALLET']?.desc || 'Ingresso Paletta (IN)', 1, palletSummaryObj, undefined, pTariffs, palletPlanBundle);
              if (c > 0) {
                palletCharges.push({ code: 'IN_PALLET', label: `Ingresso (${formatDateIT(inDate)})`, price: c });
                palletTotalPrice += c;
              }
            }
            const dateStr = formatDateIT(inDate);
            const key = `${dateStr}||${tagLabel}`;
            pushTagEntry(inboundByDayAndTag, pGroupBucket.inboundByDayAndTag, key, () => ({ dateStr, tagLabel, pallets: [] }));
          }

          // 2. OUTBOUND
          if (isExitedInMonth) {
            if (!isFlatRatePallet) {
              const c = addSectionCost('EVENTI', 'OUT_PALLET', pTariffs['OUT_PALLET']?.desc || 'Uscita Paletta (OUT)', 1, palletSummaryObj, undefined, pTariffs, palletPlanBundle);
              if (c > 0) {
                palletCharges.push({ code: 'OUT_PALLET', label: `Uscita (${formatDateIT(outDate)})`, price: c });
                palletTotalPrice += c;
              }
            }
            const dateStr = formatDateIT(outDate);
            const key = `${dateStr}||${tagLabel}`;
            pushTagEntry(outboundByDayAndTag, pGroupBucket.outboundByDayAndTag, key, () => ({ dateStr, tagLabel, pallets: [] }));
          }

          // 3. GIACENZA / SOSTA AUTOMATICA (o modalità legacy se forzata)
          const dailyRate = isFlatRatePallet ? 0 : (pTariffs['SOSTA_GIORNO']?.price ?? 0);
          const depositRate = isFlatRatePallet ? 0 : (pTariffs['DEPOSITO_PALLET']?.price ?? 0);
          const sosta15Rate = isFlatRatePallet ? 0 : (pTariffs['SOSTA_15']?.price ?? 0);
          const sostaMag15Rate = isFlatRatePallet ? 0 : (pTariffs['SOSTA_MAGGIORE_15']?.price ?? 0);

          const autoUseDaily = isAutoMode && dailyRate > 0;
          const autoUseDeposit = isAutoMode && !autoUseDaily && depositRate > 0;
          const autoUseQuindicina = isAutoMode && !autoUseDaily && !autoUseDeposit && (sosta15Rate > 0 || sostaMag15Rate > 0);

          const shouldRunDaily = autoUseDaily || (!isAutoMode && includeDailyStorage);
          const shouldRunQuindicina = autoUseQuindicina || (!isAutoMode && includeStorage);
          const shouldRunDeposit = autoUseDeposit || (!isAutoMode && includeDeposit);

          if (!isFlatRatePallet && shouldRunQuindicina && inDate <= endDate && (!outDate || outDate >= startDate)) {
            if (inDate < startDate) {
              if (isAutoMode || includeHistorical) {
                const c = addSectionCost('GIACENZA', 'SOSTA_15', pTariffs['SOSTA_15']?.desc, 1, palletSummaryObj, undefined, pTariffs, palletPlanBundle);
                if (c > 0) {
                  palletCharges.push({ code: 'SOSTA_15', label: pTariffs['SOSTA_15']?.desc || 'Sosta', price: c });
                  palletTotalPrice += c;
                }
              }
            } else {
              if (inDate.getDate() <= 15) {
                const c = addSectionCost('GIACENZA', 'SOSTA_15', pTariffs['SOSTA_15']?.desc, 1, palletSummaryObj, undefined, pTariffs, palletPlanBundle);
                if (c > 0) {
                  palletCharges.push({ code: 'SOSTA_15', label: pTariffs['SOSTA_15']?.desc || 'Sosta <=15gg', price: c });
                  palletTotalPrice += c;
                }
              } else {
                const c = addSectionCost('GIACENZA', 'SOSTA_MAGGIORE_15', pTariffs['SOSTA_MAGGIORE_15']?.desc, 1, palletSummaryObj, undefined, pTariffs, palletPlanBundle);
                if (c > 0) {
                  palletCharges.push({ code: 'SOSTA_MAGGIORE_15', label: pTariffs['SOSTA_MAGGIORE_15']?.desc || 'Sosta >15gg', price: c });
                  palletTotalPrice += c;
                }
              }
            }
          }

          if (!isFlatRatePallet && shouldRunDaily && storageDays > 0) {
            const c = addSectionCost(
              'GIACENZA',
              'SOSTA_GIORNO',
              `${pTariffs['SOSTA_GIORNO']?.desc || 'Sosta Giornaliera'} (Giorni-Paletta)`,
              storageDays,
              palletSummaryObj,
              dailyRate,
              pTariffs,
              palletPlanBundle
            );
            if (c > 0) {
              palletCharges.push({
                code: 'SOSTA_GIORNO',
                label: `Sosta ${storageDays} gg (x €${dailyRate.toFixed(2)}/gg)`,
                price: c,
                days: storageDays,
                rate: dailyRate
              });
              palletTotalPrice += c;
              dailyStorageSummary.palletCount += 1;
              dailyStorageSummary.totalDays += storageDays;
              dailyStorageSummary.totalAmount += c;
              dailyStorageSummary.pallets.push(palletSummaryObj);

              pGroupBucket.dailyStorageSummary.palletCount += 1;
              pGroupBucket.dailyStorageSummary.totalDays += storageDays;
              pGroupBucket.dailyStorageSummary.totalAmount += c;
              pGroupBucket.dailyStorageSummary.pallets.push(palletSummaryObj);
            }
          }

          if (isRemainingInDeposit) {
            const key = tagLabel || 'NO_TAG';
            pushTagEntry(depositByTag, pGroupBucket.depositByTag, key, () => ({ tagLabel, pallets: [] }));

            if (!isFlatRatePallet && shouldRunDeposit) {
              const c = addSectionCost(
                'DEPOSITO',
                'DEPOSITO_PALLET',
                pTariffs['DEPOSITO_PALLET']?.desc || 'Deposito Paletta (Giacenza Rimasta)',
                1,
                palletSummaryObj,
                undefined,
                pTariffs,
                palletPlanBundle
              );
              if (c > 0) {
                palletCharges.push({ code: 'DEPOSITO_PALLET', label: 'In Deposito', price: c });
                palletTotalPrice += c;
              }
            }
          }

          // 5. FLAGS (EXTRA es. ADR, FRIGO, ecc.)
          if (!isFlatRatePallet) {
            uniqueFlags.forEach(f => {
              const cleanF = String(f).trim().toUpperCase().replace(/^FLAG_/, '');
              const prefixedCode = `FLAG_${cleanF}`;
              const ruleCode = pTariffs[prefixedCode] ? prefixedCode : (pTariffs[cleanF] ? cleanF : null);
              if (ruleCode && pTariffs[ruleCode]) {
                const c = addSectionCost('SERVIZI EXTRA', ruleCode, pTariffs[ruleCode].desc, 1, palletSummaryObj, undefined, pTariffs, palletPlanBundle);
                if (c > 0) {
                  palletCharges.push({ code: ruleCode, label: `Tag ${cleanF}`, price: c });
                  palletTotalPrice += c;
                }
              }
            });
          } else if (!addedFlatFeePlanKeys.has(pGroupBucket.planKey)) {
            addedFlatFeePlanKeys.add(pGroupBucket.planKey);
            const flatFee = pTariffs['CANONE_FISSO_MENSILE']?.price || 0;
            if (flatFee > 0) {
              addSectionCost(
                'CANONE FISSO',
                'CANONE_FISSO_MENSILE',
                pTariffs['CANONE_FISSO_MENSILE']?.desc || palletPlanBundle.invoiceLabel,
                1,
                null,
                flatFee,
                pTariffs,
                palletPlanBundle
              );
            }
          }

          palletSummaryObj.totalPrice = palletTotalPrice;
          palletSummaryObj.charges = palletCharges;

          const movementParts = [];
          if (isEnteredInMonth) movementParts.push(`Entrata ${formatDateIT(inDate)}`);
          else movementParts.push(`Giacenza da ${formatDateIT(inDate)}`);
          if (isExitedInMonth) movementParts.push(`Uscita ${formatDateIT(outDate)}`);
          else if (outDate) movementParts.push(`Uscita ${formatDateIT(outDate)}`);
          if (isRemainingInDeposit) movementParts.push('In Deposito');
          if (storageDays > 0) movementParts.push(`${storageDays} gg nel mese`);
          if (tagLabel) movementParts.push(`Tag: ${tagLabel}`);
          if (isFlatRatePallet) movementParts.push(`Listino: ${palletPlanBundle.invoiceLabel} (Esclusa da calcolo)`);
          else if (palletPlanBundle.invoiceLabel) movementParts.push(`Listino: ${palletPlanBundle.invoiceLabel}`);

          const palletRecord = {
            pallet_code: code,
            humanLabel,
            sku: skuStr,
            customer_pallet_ref: custRef,
            sectionId: entity.id,
            sectionName: entity.business_name,
            tariff_plan_id: palletPlanBundle.planId,
            tariff_plan_name: palletPlanBundle.planName,
            invoice_label: palletPlanBundle.invoiceLabel,
            is_flat_rate: isFlatRatePallet,
            net_weight_kg: totalNetWeightKg,
            gross_weight_kg: totalGrossWeightKg,
            product_name: prodNameStr,
            quantity: totalQty,
            pallet_uom: uomStr,
            batch: batchStr,
            notes: notesStr,
            location: rows[0].location || null,
            warehouse: rows[0].warehouse || 'Settala',
            expiration_date: rawFirstExpDate,
            expiration_date_str: expDateStr,
            inbound_ddt_number: rows[0].inbound_ddt_number || null,
            created_at: inDate,
            shipped_at: outDate,
            in_deposit: isRemainingInDeposit,
            storageDays,
            dailyRate,
            flags: uniqueFlags.length > 0 ? JSON.stringify(uniqueFlags) : null,
            tagLabel,
            movementSummary: movementParts.join(' • '),
            charges: palletCharges,
            totalPrice: palletTotalPrice
          };

          sectionPallets.push(palletRecord);
          pGroupBucket.pallets.push(palletRecord);
          allPalletDetails.push(palletRecord);
        });

        const buildDescriptiveLines = ({ inboundByDayAndTag: inMap, outboundByDayAndTag: outMap, depositByTag: depMap, dailyStorageSummary: dailySum }, activeRate = 0) => {
          const lines = [];
          outMap.forEach(({ dateStr, tagLabel, pallets: pList }) => {
            const count = pList.length;
            const noun = count === 1 ? 'Paletta' : 'Palette';
            const verb = count === 1 ? 'andata via' : 'andate via';
            const tagPart = tagLabel ? ` con tag ${tagLabel}` : '';
            const namesStr = pList.map(p => p.humanLabel).join('; ');
            lines.push({
              type: 'OUT',
              count,
              pallets: pList,
              date: dateStr,
              tags: tagLabel,
              headerText: `${count} - ${noun} ${verb}${tagPart} il giorno ${dateStr}:`,
              text: `${count} - ${noun} (${namesStr}) ${verb}${tagPart} il giorno ${dateStr}`
            });
          });
          inMap.forEach(({ dateStr, tagLabel, pallets: pList }) => {
            const count = pList.length;
            const noun = count === 1 ? 'Paletta' : 'Palette';
            const verb = count === 1 ? 'entrata' : 'entrate';
            const tagPart = tagLabel ? ` con tag ${tagLabel}` : '';
            const namesStr = pList.map(p => p.humanLabel).join('; ');
            lines.push({
              type: 'IN',
              count,
              pallets: pList,
              date: dateStr,
              tags: tagLabel,
              headerText: `${count} - ${noun} ${verb}${tagPart} il giorno ${dateStr}:`,
              text: `${count} - ${noun} (${namesStr}) ${verb}${tagPart} il giorno ${dateStr}`
            });
          });
          depMap.forEach(({ tagLabel, pallets: pList }) => {
            const count = pList.length;
            const noun = count === 1 ? 'Paletta' : 'Palette';
            const tagPart = tagLabel ? ` con tag ${tagLabel}` : '';
            const namesStr = pList.map(p => p.humanLabel).join('; ');
            lines.push({
              type: 'DEPOSIT',
              count,
              pallets: pList,
              tags: tagLabel,
              headerText: `${count} - ${noun}${tagPart} in deposito:`,
              text: `${count} - ${noun} (${namesStr})${tagPart} in deposito`
            });
          });
          if (dailySum.palletCount > 0) {
            lines.push({
              type: 'DAILY_STORAGE',
              count: dailySum.palletCount,
              totalDays: dailySum.totalDays,
              pallets: dailySum.pallets,
              headerText: `${dailySum.palletCount} ${dailySum.palletCount === 1 ? 'Paletta' : 'Palette'} per ${dailySum.totalDays} giorni totali di sosta nel mese (€${activeRate.toFixed(2)}/gg):`,
              text: `${dailySum.palletCount} palette × ${dailySum.totalDays} gg totali nel mese`
            });
          }
          return lines;
        };

        const descriptiveLines = buildDescriptiveLines(
          { inboundByDayAndTag, outboundByDayAndTag, depositByTag, dailyStorageSummary },
          tariffs['SOSTA_GIORNO']?.price ?? 0
        );

        const planGroups = Array.from(planGroupsMap.values()).map(pg => ({
          planKey: pg.planKey,
          planId: pg.planId,
          planName: pg.planName,
          invoiceLabel: pg.invoiceLabel,
          isFlatRate: pg.isFlatRate,
          tariffsSummary: pg.tariffsSummary,
          descriptiveLines: buildDescriptiveLines(pg, pg.tariffsSummary.sostaGiorno || 0),
          pallets: pg.pallets,
          items: sectionItems.filter(it => (it.tariffPlanId ? String(it.tariffPlanId) : 'LEGACY') === pg.planKey),
          palletsCount: pg.pallets.length,
          subtotal: pg.subtotal
        }));

        if (!hasFragments || entity.parent_id || sectionPallets.length > 0 || sectionItems.length > 0) {
          sections.push({
            sectionId: entity.id,
            sectionName: entity.business_name,
            uniqueId: entity.unique_id,
            isParent: !entity.parent_id,
            tariffsSummary: {
              inPallet: tariffs['IN_PALLET']?.price || 0,
              outPallet: tariffs['OUT_PALLET']?.price || 0,
              depositPallet: tariffs['DEPOSITO_PALLET']?.price || 0,
              sosta15: tariffs['SOSTA_15']?.price || 0,
              sostaGiorno: tariffs['SOSTA_GIORNO']?.price || 0
            },
            planGroups,
            descriptiveLines,
            pallets: sectionPallets,
            items: sectionItems,
            palletsCount: sectionPallets.length,
            depositCount: sectionPallets.filter(p => p.in_deposit).length,
            sectionTotal
          });
        }

        sectionItems.forEach(item => allItems.push(item));
        grandBaseTotal += sectionTotal;
      }

      return {
        clientId: mainCustomer.id,
        clientName: mainCustomer.business_name,
        hasFragments,
        fragmentsCount: childFragments.length,
        period: `${month.toString().padStart(2, '0')}/${year}`,
        sections,
        items: allItems,
        palletDetails: allPalletDetails,
        total: grandBaseTotal
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante il calcolo della pre-fattura' });
    }
  });
}

module.exports = billingRoutes;
