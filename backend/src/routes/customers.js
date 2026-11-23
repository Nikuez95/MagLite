const { hasPermission, canAccessCustomer } = require('../utils/permissions');
const db = require('../config/db');

async function customerRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.addHook('preHandler', async (request, reply) => {
    if (request.method === 'GET') {
      return;
    }
    if (!hasPermission(request.user, 'customer_manage')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di modificare o eliminare clienti.' });
    }
    if (request.params?.id && !canAccessCustomer(request.user, request.params.id)) {
      return reply.code(403).send({ error: 'Accesso negato: questo cliente è bloccato per il tuo profilo.' });
    }
  });

  // GET /api/customers
  fastify.get('/', async (request, reply) => {
    try {
      const [rows] = await db.query(`
        SELECT c.id, c.unique_id, c.business_name, c.vat_number, c.address, c.phone, c.email, c.parent_id,
               c.notes, c.tariff_plan_id, COALESCE(c.generate_exit_ddt, 1) AS generate_exit_ddt,
               tp.name AS tariff_plan_name,
               pc.business_name AS parent_name,
               pc.business_name AS parent_business_name,
               pc.unique_id AS parent_unique_id,
               COALESCE(ch_agg.cnt, 0) AS children_count,
               COALESCE(pr_agg.cnt, 0) AS products_count,
               COALESCE(pal_agg.cnt, 0) AS active_pallets_count,
               COALESCE(tar_agg.cnt, 0) AS custom_tariffs_count,
               COALESCE(notes_agg.cnt, 0) AS notes_count,
               COALESCE(notes_agg.pinned_cnt, 0) AS pinned_notes_count,
               COALESCE(deliv_agg.cnt, 0) AS delivery_addresses_count,
               (
                 SELECT cn.content
                 FROM CUSTOMER_NOTES cn
                 WHERE cn.customer_id = c.id
                 ORDER BY cn.is_pinned DESC, cn.created_at DESC, cn.id DESC
                 LIMIT 1
               ) AS latest_note_preview
        FROM CUSTOMERS c
        LEFT JOIN tariff_plans tp ON c.tariff_plan_id = tp.id
        LEFT JOIN CUSTOMERS pc ON c.parent_id = pc.id
        LEFT JOIN (
          SELECT parent_id, COUNT(*) AS cnt FROM CUSTOMERS WHERE parent_id IS NOT NULL GROUP BY parent_id
        ) ch_agg ON ch_agg.parent_id = c.id
        LEFT JOIN (
          SELECT customer_id, COUNT(*) AS cnt FROM PRODUCTS GROUP BY customer_id
        ) pr_agg ON pr_agg.customer_id = c.id
        LEFT JOIN (
          SELECT p.customer_id, COUNT(DISTINCT p.pallet_code) AS cnt
          FROM PALLETS p
          LEFT JOIN INBOUND_DDTS d ON d.id = p.inbound_ddt_id
          WHERE p.status != 'SHIPPED' AND p.quantity > 0
            AND (p.inbound_ddt_id IS NULL OR d.status = 'COMPLETED')
          GROUP BY p.customer_id
        ) pal_agg ON pal_agg.customer_id = c.id
        LEFT JOIN (
          SELECT customer_id, COUNT(*) AS cnt FROM client_tariffs GROUP BY customer_id
        ) tar_agg ON tar_agg.customer_id = c.id
        LEFT JOIN (
          SELECT customer_id, COUNT(*) AS cnt, SUM(CASE WHEN is_pinned THEN 1 ELSE 0 END) AS pinned_cnt
          FROM CUSTOMER_NOTES
          GROUP BY customer_id
        ) notes_agg ON notes_agg.customer_id = c.id
        LEFT JOIN (
          SELECT customer_id, COUNT(*) AS cnt
          FROM CUSTOMER_DELIVERY_ADDRESSES
          GROUP BY customer_id
        ) deliv_agg ON deliv_agg.customer_id = c.id
        ORDER BY COALESCE(pc.business_name, c.business_name) ASC, (c.parent_id IS NOT NULL) ASC, c.business_name ASC
      `);
      return rows.filter(r => canAccessCustomer(request.user, r.id));
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante il recupero dei clienti' });
    }
  });

  // Helper per generare un codice univoco automatico per una frammentazione
  async function generateFragmentUniqueId(connection, parent, fragmentName, indexHint = 1) {
    const baseCode = (parent?.unique_id || 'CLI').trim().toUpperCase();
    const slug = String(fragmentName || '')
      .replace(new RegExp(`^${parent?.business_name || ''}`, 'i'), '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase()
      .slice(0, 6);
    const candidate = `${baseCode}-${slug || String(indexHint).padStart(2, '0')}`;
    const [existing] = await connection.query('SELECT id FROM CUSTOMERS WHERE unique_id = ?', [candidate]);
    if (existing.length === 0) return candidate;
    return `${baseCode}-${slug || 'F'}-${Math.floor(100 + Math.random() * 900)}`;
  }

  // POST /api/customers
  fastify.post('/', async (request, reply) => {
    const {
      unique_id,
      business_name,
      vat_number,
      address,
      phone,
      email,
      notes = null,
      tariff_plan_id = null,
      parent_id = null,
      copy_parent_tariffs = true,
      generate_exit_ddt = true
    } = request.body;

    if (!business_name || !String(business_name).trim()) {
      return reply.code(400).send({ error: 'La Ragione Sociale / Nome è obbligatoria' });
    }

    const cleanParentId = parent_id ? parseInt(parent_id, 10) : null;
    const cleanPlanId = tariff_plan_id ? parseInt(tariff_plan_id, 10) : null;
    const cleanNotes = notes !== undefined && notes !== null ? String(notes).trim() || null : null;
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      let parentRow = null;
      if (cleanParentId) {
        const [[pRow]] = await connection.query(
          'SELECT id, unique_id, business_name, vat_number, address, phone, email, tariff_plan_id FROM CUSTOMERS WHERE id = ?',
          [cleanParentId]
        );
        parentRow = pRow || null;
      }

      let finalUniqueId = unique_id ? String(unique_id).trim() : '';
      if (!finalUniqueId && parentRow) {
        finalUniqueId = await generateFragmentUniqueId(connection, parentRow, business_name, 1);
      }

      if (!finalUniqueId) {
        await connection.rollback();
        return reply.code(400).send({ error: 'Codice Cliente e Ragione Sociale sono obbligatori' });
      }

      const finalVat = vat_number || (parentRow ? parentRow.vat_number : null);
      const finalAddress = address || (parentRow ? parentRow.address : null);
      const finalPhone = phone || (parentRow ? parentRow.phone : null);
      const finalEmail = email || (parentRow ? parentRow.email : null);
      const effectivePlanId = cleanPlanId || (cleanParentId && copy_parent_tariffs ? (parentRow?.tariff_plan_id || null) : null);
      const exitDdtFlag = generate_exit_ddt === false || generate_exit_ddt === 0 || generate_exit_ddt === 'false' ? 0 : 1;

      const [result] = await connection.query(
        'INSERT INTO CUSTOMERS (unique_id, business_name, vat_number, address, phone, email, notes, tariff_plan_id, parent_id, generate_exit_ddt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [finalUniqueId, String(business_name).trim(), finalVat, finalAddress, finalPhone, finalEmail, cleanNotes, effectivePlanId, cleanParentId, exitDdtFlag]
      );
      const newCustomerId = result.insertId;

      if (cleanNotes) {
        await connection.query(
          'INSERT INTO CUSTOMER_NOTES (customer_id, content, username, is_pinned) VALUES (?, ?, ?, FALSE)',
          [newCustomerId, cleanNotes, request.user.username || 'Sistema']
        );
      }

      if (cleanPlanId) {
        const [planItems] = await connection.query(
          'SELECT rule_code, price FROM tariff_plan_items WHERE plan_id = ?',
          [cleanPlanId]
        );
        for (const item of planItems) {
          await connection.query(
            'INSERT IGNORE INTO client_tariffs (customer_id, rule_code, custom_price) VALUES (?, ?, ?)',
            [newCustomerId, item.rule_code, item.price]
          );
        }
      } else if (cleanParentId && copy_parent_tariffs) {
        // Se è una frammentazione e copy_parent_tariffs è attivo, inizializza il suo listino prezzi dedicato copiando le tariffe base della madre
        const [parentTariffs] = await connection.query(
          'SELECT rule_code, custom_price FROM client_tariffs WHERE customer_id = ?',
          [cleanParentId]
        );
        for (const t of parentTariffs) {
          await connection.query(
            'INSERT IGNORE INTO client_tariffs (customer_id, rule_code, custom_price) VALUES (?, ?, ?)',
            [newCustomerId, t.rule_code, t.custom_price]
          );
        }
      }

      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        [
          cleanParentId ? 'CREATE_CUSTOMER_FRAGMENT' : 'CREATE_CUSTOMER',
          cleanParentId
            ? `Creata frammentazione cliente "${business_name}" (${finalUniqueId}) sotto cliente madre "${parentRow?.business_name || cleanParentId}"`
            : `Creato cliente "${business_name}" (${finalUniqueId})`,
          'Gestionale',
          request.user.username
        ]
      );

      await connection.commit();
      return reply.code(201).send({ success: true, id: newCustomerId, unique_id: finalUniqueId });
    } catch (err) {
      await connection.rollback();
      if (err.code === 'ER_DUP_ENTRY') {
        return reply.code(400).send({ error: 'Codice Cliente già in uso' });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore interno' });
    } finally {
      connection.release();
    }
  });

  // POST /api/customers/:id/fragments - Crea una o più frammentazioni rapidamente per un Cliente Madre
  fastify.post('/:id/fragments', async (request, reply) => {
    const parentId = parseInt(request.params.id, 10);
    const { fragments = [], copy_parent_tariffs, copy_tariffs } = request.body || {};
    const shouldCopyTariffs = copy_tariffs !== undefined ? Boolean(copy_tariffs) : (copy_parent_tariffs !== undefined ? Boolean(copy_parent_tariffs) : true);

    if (!Array.isArray(fragments) || fragments.length === 0) {
      return reply.code(400).send({ error: 'Specifica almeno una frammentazione da creare' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [[parentRow]] = await connection.query(
        'SELECT id, unique_id, business_name, vat_number, address, phone, email, tariff_plan_id FROM CUSTOMERS WHERE id = ?',
        [parentId]
      );
      if (!parentRow) {
        await connection.rollback();
        return reply.code(404).send({ error: 'Cliente Madre non trovato' });
      }

      const [parentTariffs] = await connection.query(
        'SELECT rule_code, custom_price FROM client_tariffs WHERE customer_id = ?',
        [parentId]
      );

      const created = [];
      let idx = 1;
      for (const frag of fragments) {
        const name = (typeof frag === 'string' ? frag : frag.business_name || '').trim();
        if (!name) continue;

        let code = (typeof frag === 'object' && frag.unique_id ? String(frag.unique_id).trim() : '');
        if (!code) {
          code = await generateFragmentUniqueId(connection, parentRow, name, idx);
        }
        const fragNotes = (typeof frag === 'object' && frag.notes !== undefined && frag.notes !== null)
          ? (String(frag.notes).trim() || null)
          : null;

        const [res] = await connection.query(
          'INSERT INTO CUSTOMERS (unique_id, business_name, vat_number, address, phone, email, notes, tariff_plan_id, parent_id, generate_exit_ddt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            code,
            name,
            (typeof frag === 'object' && frag.vat_number) || parentRow.vat_number,
            (typeof frag === 'object' && frag.address) || parentRow.address,
            (typeof frag === 'object' && frag.phone) || parentRow.phone,
            (typeof frag === 'object' && frag.email) || parentRow.email,
            fragNotes,
            shouldCopyTariffs ? (parentRow.tariff_plan_id || null) : null,
            parentId,
            parentRow.generate_exit_ddt !== undefined && parentRow.generate_exit_ddt !== null ? Number(Boolean(parentRow.generate_exit_ddt)) : 1
          ]
        );
        const fragId = res.insertId;

        if (fragNotes) {
          await connection.query(
            'INSERT INTO CUSTOMER_NOTES (customer_id, content, username, is_pinned) VALUES (?, ?, ?, FALSE)',
            [fragId, fragNotes, request.user.username || 'Sistema']
          );
        }

        if (shouldCopyTariffs && parentTariffs.length > 0) {
          for (const t of parentTariffs) {
            await connection.query(
              'INSERT IGNORE INTO client_tariffs (customer_id, rule_code, custom_price) VALUES (?, ?, ?)',
              [fragId, t.rule_code, t.custom_price]
            );
          }
        }

        created.push({ id: fragId, business_name: name, unique_id: code });
        idx += 1;
      }

      if (created.length > 0) {
        await connection.query(
          'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
          [
            'CREATE_CUSTOMER_FRAGMENT',
            `Create ${created.length} frammentazioni per cliente madre "${parentRow.business_name}": ${created.map(c => c.business_name).join(', ')}`,
            'Gestionale',
            request.user.username
          ]
        );
      }

      await connection.commit();
      return reply.code(201).send({ success: true, created });
    } catch (err) {
      await connection.rollback();
      if (err.code === 'ER_DUP_ENTRY') {
        return reply.code(400).send({ error: 'Uno dei codici univoci è già in uso' });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore creazione frammentazioni' });
    } finally {
      connection.release();
    }
  });

  // DELETE /api/customers/:id
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const [[customer]] = await db.query('SELECT business_name FROM CUSTOMERS WHERE id = ?', [id]);
      // Scollega eventuali sotto-clienti se si elimina la madre
      await db.query('UPDATE CUSTOMERS SET parent_id = NULL WHERE parent_id = ?', [id]);
      const [result] = await db.query('DELETE FROM CUSTOMERS WHERE id = ?', [id]);
      if (result.affectedRows === 0) {
        return reply.code(404).send({ error: 'Cliente non trovato' });
      }
      
      if (customer) {
        await db.query(
          'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
          ['DELETE_CUSTOMER', `Eliminato cliente ${customer.business_name} (ID: ${id})`, 'Gestionale', request.user.username]
        );
      }
      
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Impossibile eliminare (potrebbe avere movimenti o referenze associate)' });
    }
  });

  // PUT /api/customers/:id
  fastify.put('/:id', async (request, reply) => {
    const { id } = request.params;
    const { unique_id, business_name, vat_number, address, phone, email, notes, parent_id = null, generate_exit_ddt } = request.body;
    
    if (!unique_id || !business_name) {
      return reply.code(400).send({ error: 'Codice Cliente e Ragione Sociale sono obbligatori' });
    }

    const cleanParentId = (parent_id && Number(parent_id) !== Number(id)) ? parseInt(parent_id, 10) : null;

    try {
      const [[existing]] = await db.query('SELECT notes, generate_exit_ddt FROM CUSTOMERS WHERE id = ?', [id]);
      if (!existing) {
        return reply.code(404).send({ error: 'Cliente non trovato' });
      }
      const nextNotes = notes !== undefined ? (notes !== null ? (String(notes).trim() || null) : null) : existing.notes;
      const nextExitDdt = generate_exit_ddt !== undefined
        ? (generate_exit_ddt === false || generate_exit_ddt === 0 || generate_exit_ddt === 'false' ? 0 : 1)
        : (existing.generate_exit_ddt !== undefined && existing.generate_exit_ddt !== null ? Number(Boolean(existing.generate_exit_ddt)) : 1);

      const [result] = await db.query(
        'UPDATE CUSTOMERS SET unique_id = ?, business_name = ?, vat_number = ?, address = ?, phone = ?, email = ?, notes = ?, parent_id = ?, generate_exit_ddt = ? WHERE id = ?',
        [unique_id, business_name, vat_number, address, phone, email, nextNotes, cleanParentId, nextExitDdt, id]
      );
      if (result.affectedRows === 0) {
        return reply.code(404).send({ error: 'Cliente non trovato' });
      }

      await db.query(
        'UPDATE OUTBOUND_ORDERS SET generate_exit_ddt = ? WHERE customer_id = ? AND status != "SHIPPED"',
        [nextExitDdt, id]
      );

      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['UPDATE_CUSTOMER', `Modificato cliente ${business_name} (${unique_id})`, 'Gestionale', request.user.username]
      );

      if (fastify.io) {
        fastify.io.emit('customers_updated');
        fastify.io.emit('outbound_updated');
      }

      return { success: true };
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return reply.code(400).send({ error: 'Codice Cliente già in uso' });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore interno' });
    }
  });

  // ==========================================
  // NOTE DEDICATE PER CLIENTE / FRAMMENTAZIONE
  // ==========================================

  // GET /api/customers/:id/notes - Elenco note ordinate (pinnate in alto, poi più recenti)
  fastify.get('/:id/notes', async (request, reply) => {
    const customerId = parseInt(request.params.id, 10);
    if (!canAccessCustomer(request.user, customerId)) {
      return reply.code(403).send({ error: 'Accesso negato: questo cliente è bloccato per il tuo profilo.' });
    }
    try {
      const [rows] = await db.query(
        `SELECT id, customer_id, content, username, is_pinned, pinned_at, pinned_by, created_at, updated_at
         FROM CUSTOMER_NOTES
         WHERE customer_id = ?
         ORDER BY is_pinned DESC, pinned_at DESC, created_at DESC, id DESC`,
        [customerId]
      );
      return rows.map(r => ({ ...r, is_pinned: Boolean(r.is_pinned) }));
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore recupero note cliente' });
    }
  });

  // POST /api/customers/:id/notes - Aggiunge una nuova nota separata con autore, data, ora e pin opzionale
  fastify.post('/:id/notes', async (request, reply) => {
    const customerId = parseInt(request.params.id, 10);
    const rawContent = request.body?.content;
    const content = rawContent !== undefined && rawContent !== null ? String(rawContent).trim() : '';
    const isPinned = Boolean(request.body?.is_pinned);

    if (!content) {
      return reply.code(400).send({ error: 'Il testo della nota è obbligatorio' });
    }

    try {
      const [[existing]] = await db.query('SELECT id, business_name, unique_id FROM CUSTOMERS WHERE id = ?', [customerId]);
      if (!existing) {
        return reply.code(404).send({ error: 'Cliente non trovato' });
      }

      const username = request.user?.username || 'Sistema';
      const [res] = await db.query(
        `INSERT INTO CUSTOMER_NOTES (customer_id, content, username, is_pinned, pinned_at, pinned_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [customerId, content, username, isPinned, isPinned ? new Date() : null, isPinned ? username : null]
      );

      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['CREATE_CUSTOMER_NOTE', `Aggiunta nota per ${existing.business_name} (${existing.unique_id})`, 'Gestionale', username]
      );

      const [[created]] = await db.query('SELECT * FROM CUSTOMER_NOTES WHERE id = ?', [res.insertId]);
      return reply.code(201).send({ ...created, is_pinned: Boolean(created.is_pinned) });
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore creazione nota' });
    }
  });

  // PUT /api/customers/:id/notes/:noteId/pin - Pinna o unpinna una nota specifica
  fastify.put('/:id/notes/:noteId/pin', async (request, reply) => {
    const customerId = parseInt(request.params.id, 10);
    const noteId = parseInt(request.params.noteId, 10);
    try {
      const [[existing]] = await db.query(
        'SELECT * FROM CUSTOMER_NOTES WHERE id = ? AND customer_id = ?',
        [noteId, customerId]
      );
      if (!existing) {
        return reply.code(404).send({ error: 'Nota non trovata' });
      }
      const nextPinned = typeof request.body?.is_pinned === 'boolean'
        ? request.body.is_pinned
        : !Boolean(existing.is_pinned);
      const username = request.user?.username || 'Sistema';

      await db.query(
        `UPDATE CUSTOMER_NOTES
         SET is_pinned = ?, pinned_at = ?, pinned_by = ?
         WHERE id = ? AND customer_id = ?`,
        [nextPinned, nextPinned ? new Date() : null, nextPinned ? username : null, noteId, customerId]
      );

      const [[updated]] = await db.query('SELECT * FROM CUSTOMER_NOTES WHERE id = ?', [noteId]);
      return { success: true, note: { ...updated, is_pinned: Boolean(updated.is_pinned) } };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore aggiornamento pin nota' });
    }
  });

  // DELETE /api/customers/:id/notes/:noteId - Elimina una nota specifica
  fastify.delete('/:id/notes/:noteId', async (request, reply) => {
    const customerId = parseInt(request.params.id, 10);
    const noteId = parseInt(request.params.noteId, 10);
    try {
      const [del] = await db.query(
        'DELETE FROM CUSTOMER_NOTES WHERE id = ? AND customer_id = ?',
        [noteId, customerId]
      );
      if (del.affectedRows === 0) {
        return reply.code(404).send({ error: 'Nota non trovata' });
      }
      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['DELETE_CUSTOMER_NOTE', `Eliminata nota #${noteId} del cliente #${customerId}`, 'Gestionale', request.user?.username || 'Sistema']
      );
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore eliminazione nota' });
    }
  });

  // PUT /api/customers/:id/notes - Compatibilità aggiornamento nota singola
  fastify.put('/:id/notes', async (request, reply) => {
    const { id } = request.params;
    const rawNotes = request.body?.notes;
    const cleanNotes = rawNotes !== undefined && rawNotes !== null ? (String(rawNotes).trim() || null) : null;

    try {
      const [[existing]] = await db.query('SELECT id, business_name, unique_id FROM CUSTOMERS WHERE id = ?', [id]);
      if (!existing) {
        return reply.code(404).send({ error: 'Cliente non trovato' });
      }

      await db.query('UPDATE CUSTOMERS SET notes = ? WHERE id = ?', [cleanNotes, id]);
      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['UPDATE_CUSTOMER_NOTES', `Aggiornate note per ${existing.business_name} (${existing.unique_id})`, 'Gestionale', request.user.username]
      );

      return { success: true, notes: cleanNotes };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante il salvataggio delle note' });
    }
  });

  // PUT /api/customers/:id/exit-ddt - Toggle rapido Genera Bolla di Uscita
  fastify.put('/:id/exit-ddt', async (request, reply) => {
    const { id } = request.params;
    const enabled = request.body?.generate_exit_ddt === false || request.body?.generate_exit_ddt === 0 || request.body?.generate_exit_ddt === 'false' ? 0 : 1;
    try {
      const [[cust]] = await db.query('SELECT id, business_name FROM CUSTOMERS WHERE id = ?', [id]);
      if (!cust) return reply.code(404).send({ error: 'Cliente non trovato' });

      await db.query('UPDATE CUSTOMERS SET generate_exit_ddt = ? WHERE id = ?', [enabled, id]);
      await db.query(
        'UPDATE OUTBOUND_ORDERS SET generate_exit_ddt = ? WHERE customer_id = ? AND status != "SHIPPED"',
        [enabled, id]
      );
      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['UPDATE_CUSTOMER_EXIT_DDT', `Bolla di Uscita automatica ${enabled ? 'ATTIVATA' : 'DISATTIVATA'} per ${cust.business_name}`, 'Gestionale', request.user?.username || 'Sistema']
      );
      if (fastify.io) {
        fastify.io.emit('customers_updated');
        fastify.io.emit('outbound_updated');
      }
      return { success: true, generate_exit_ddt: Boolean(enabled) };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore aggiornamento opzione Bolla di Uscita' });
    }
  });

  // ==========================================
  // INDIRIZZI DI CONSEGNA MULTIPLI PER CLIENTE
  // ==========================================

  fastify.get('/:id/delivery-addresses', async (request, reply) => {
    const customerId = parseInt(request.params.id, 10);
    if (!canAccessCustomer(request.user, customerId)) {
      return reply.code(403).send({ error: 'Accesso negato per questo cliente.' });
    }
    const includeParent = request.query?.include_parent !== 'false';
    try {
      const [[cust]] = await db.query('SELECT id, parent_id FROM CUSTOMERS WHERE id = ?', [customerId]);
      if (!cust) return reply.code(404).send({ error: 'Cliente non trovato' });

      const targetIds = [customerId];
      if (includeParent && cust.parent_id) targetIds.push(cust.parent_id);

      const [rows] = await db.query(
        `SELECT da.*, c.business_name AS owner_name
         FROM CUSTOMER_DELIVERY_ADDRESSES da
         JOIN CUSTOMERS c ON c.id = da.customer_id
         WHERE da.customer_id IN (?)
         ORDER BY (da.customer_id = ?) DESC, da.is_default DESC, da.label ASC, da.id ASC`,
        [targetIds, customerId]
      );
      return rows.map(r => ({
        ...r,
        is_default: Boolean(r.is_default),
        is_inherited: Number(r.customer_id) !== customerId
      }));
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore recupero indirizzi di consegna' });
    }
  });

  fastify.post('/:id/delivery-addresses', async (request, reply) => {
    const customerId = parseInt(request.params.id, 10);
    const {
      label,
      address_line,
      city = '',
      cap = '',
      province = '',
      country = 'Italia',
      contact_name = '',
      contact_phone = '',
      notes = '',
      is_default = false
    } = request.body || {};

    if (!label || !String(label).trim() || !address_line || !String(address_line).trim()) {
      return reply.code(400).send({ error: 'Nome sede/etichetta e indirizzo sono obbligatori.' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [[existingCount]] = await connection.query(
        'SELECT COUNT(*) AS cnt FROM CUSTOMER_DELIVERY_ADDRESSES WHERE customer_id = ?',
        [customerId]
      );
      const makeDefault = Boolean(is_default) || Number(existingCount?.cnt || 0) === 0;
      if (makeDefault) {
        await connection.query('UPDATE CUSTOMER_DELIVERY_ADDRESSES SET is_default = 0 WHERE customer_id = ?', [customerId]);
      }

      const [res] = await connection.query(
        `INSERT INTO CUSTOMER_DELIVERY_ADDRESSES
         (customer_id, label, address_line, city, cap, province, country, contact_name, contact_phone, notes, is_default)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          customerId,
          String(label).trim(),
          String(address_line).trim(),
          city ? String(city).trim() : null,
          cap ? String(cap).trim() : null,
          province ? String(province).trim().toUpperCase() : null,
          country ? String(country).trim() : 'Italia',
          contact_name ? String(contact_name).trim() : null,
          contact_phone ? String(contact_phone).trim() : null,
          notes ? String(notes).trim() : null,
          makeDefault ? 1 : 0
        ]
      );

      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['CREATE_DELIVERY_ADDRESS', `Aggiunto indirizzo consegna "${String(label).trim()}" per cliente #${customerId}`, 'Gestionale', request.user?.username || 'Sistema']
      );
      await connection.commit();
      return reply.code(201).send({ success: true, id: res.insertId });
    } catch (err) {
      await connection.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore salvataggio indirizzo di consegna' });
    } finally {
      connection.release();
    }
  });

  fastify.put('/:id/delivery-addresses/:addressId', async (request, reply) => {
    const customerId = parseInt(request.params.id, 10);
    const addressId = parseInt(request.params.addressId, 10);
    const body = request.body || {};

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [[existing]] = await connection.query(
        'SELECT * FROM CUSTOMER_DELIVERY_ADDRESSES WHERE id = ? AND customer_id = ?',
        [addressId, customerId]
      );
      if (!existing) {
        await connection.rollback();
        return reply.code(404).send({ error: 'Indirizzo di consegna non trovato' });
      }

      const makeDefault = body.is_default !== undefined ? Boolean(body.is_default) : Boolean(existing.is_default);
      if (makeDefault) {
        await connection.query('UPDATE CUSTOMER_DELIVERY_ADDRESSES SET is_default = 0 WHERE customer_id = ?', [customerId]);
      }

      await connection.query(
        `UPDATE CUSTOMER_DELIVERY_ADDRESSES
         SET label = ?, address_line = ?, city = ?, cap = ?, province = ?, country = ?,
             contact_name = ?, contact_phone = ?, notes = ?, is_default = ?
         WHERE id = ? AND customer_id = ?`,
        [
          body.label !== undefined ? String(body.label).trim() : existing.label,
          body.address_line !== undefined ? String(body.address_line).trim() : existing.address_line,
          body.city !== undefined ? (String(body.city).trim() || null) : existing.city,
          body.cap !== undefined ? (String(body.cap).trim() || null) : existing.cap,
          body.province !== undefined ? (String(body.province).trim().toUpperCase() || null) : existing.province,
          body.country !== undefined ? (String(body.country).trim() || 'Italia') : existing.country,
          body.contact_name !== undefined ? (String(body.contact_name).trim() || null) : existing.contact_name,
          body.contact_phone !== undefined ? (String(body.contact_phone).trim() || null) : existing.contact_phone,
          body.notes !== undefined ? (String(body.notes).trim() || null) : existing.notes,
          makeDefault ? 1 : 0,
          addressId,
          customerId
        ]
      );

      await connection.commit();
      return { success: true };
    } catch (err) {
      await connection.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore aggiornamento indirizzo di consegna' });
    } finally {
      connection.release();
    }
  });

  fastify.delete('/:id/delivery-addresses/:addressId', async (request, reply) => {
    const customerId = parseInt(request.params.id, 10);
    const addressId = parseInt(request.params.addressId, 10);
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [[existing]] = await connection.query(
        'SELECT is_default, label FROM CUSTOMER_DELIVERY_ADDRESSES WHERE id = ? AND customer_id = ?',
        [addressId, customerId]
      );
      if (!existing) {
        await connection.rollback();
        return reply.code(404).send({ error: 'Indirizzo non trovato' });
      }
      await connection.query('DELETE FROM CUSTOMER_DELIVERY_ADDRESSES WHERE id = ? AND customer_id = ?', [addressId, customerId]);
      if (existing.is_default) {
        const [[nextRow]] = await connection.query(
          'SELECT id FROM CUSTOMER_DELIVERY_ADDRESSES WHERE customer_id = ? ORDER BY id ASC LIMIT 1',
          [customerId]
        );
        if (nextRow) {
          await connection.query('UPDATE CUSTOMER_DELIVERY_ADDRESSES SET is_default = 1 WHERE id = ?', [nextRow.id]);
        }
      }
      await connection.commit();
      return { success: true };
    } catch (err) {
      await connection.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore eliminazione indirizzo' });
    } finally {
      connection.release();
    }
  });
}

module.exports = customerRoutes;
