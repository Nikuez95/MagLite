const db = require('../config/db');

async function customerRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.addHook('preHandler', async (request, reply) => {
    if (request.user.role !== 'developer' && request.user.role !== 'backoffice') {
      return reply.code(403).send({ error: 'Accesso negato.' });
    }
  });

  // GET /api/customers
  fastify.get('/', async (request, reply) => {
    try {
      const [rows] = await db.query(`
        SELECT c.*,
               pc.business_name AS parent_name,
               pc.business_name AS parent_business_name,
               pc.unique_id AS parent_unique_id,
               (SELECT COUNT(*) FROM CUSTOMERS ch WHERE ch.parent_id = c.id) AS children_count,
               (SELECT COUNT(*) FROM PRODUCTS pr WHERE pr.customer_id = c.id) AS products_count,
               (SELECT COUNT(DISTINCT p.pallet_code) FROM PALLETS p 
                WHERE p.customer_id = c.id AND p.status != 'SHIPPED' AND p.quantity > 0
                  AND (p.inbound_ddt_id IS NULL OR NOT EXISTS (SELECT 1 FROM INBOUND_DDTS d WHERE d.id = p.inbound_ddt_id AND d.status != 'COMPLETED'))
               ) AS active_pallets_count,
               (SELECT COUNT(*) FROM client_tariffs ct WHERE ct.customer_id = c.id) AS custom_tariffs_count
        FROM CUSTOMERS c
        LEFT JOIN CUSTOMERS pc ON c.parent_id = pc.id
        ORDER BY COALESCE(pc.business_name, c.business_name) ASC, (c.parent_id IS NOT NULL) ASC, c.business_name ASC
      `);
      return rows;
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
      parent_id = null,
      copy_parent_tariffs = true
    } = request.body;

    if (!business_name || !String(business_name).trim()) {
      return reply.code(400).send({ error: 'La Ragione Sociale / Nome è obbligatoria' });
    }

    const cleanParentId = parent_id ? parseInt(parent_id, 10) : null;
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      let parentRow = null;
      if (cleanParentId) {
        const [[pRow]] = await connection.query('SELECT * FROM CUSTOMERS WHERE id = ?', [cleanParentId]);
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

      const [result] = await connection.query(
        'INSERT INTO CUSTOMERS (unique_id, business_name, vat_number, address, phone, email, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [finalUniqueId, String(business_name).trim(), finalVat, finalAddress, finalPhone, finalEmail, cleanParentId]
      );
      const newCustomerId = result.insertId;

      // Se è una frammentazione e copy_parent_tariffs è attivo, inizializza il suo listino prezzi dedicato copiando le tariffe base della madre
      if (cleanParentId && copy_parent_tariffs) {
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

      const [[parentRow]] = await connection.query('SELECT * FROM CUSTOMERS WHERE id = ?', [parentId]);
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

        const [res] = await connection.query(
          'INSERT INTO CUSTOMERS (unique_id, business_name, vat_number, address, phone, email, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [
            code,
            name,
            (typeof frag === 'object' && frag.vat_number) || parentRow.vat_number,
            (typeof frag === 'object' && frag.address) || parentRow.address,
            (typeof frag === 'object' && frag.phone) || parentRow.phone,
            (typeof frag === 'object' && frag.email) || parentRow.email,
            parentId
          ]
        );
        const fragId = res.insertId;

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
    const { unique_id, business_name, vat_number, address, phone, email, parent_id = null } = request.body;
    
    if (!unique_id || !business_name) {
      return reply.code(400).send({ error: 'Codice Cliente e Ragione Sociale sono obbligatori' });
    }

    const cleanParentId = (parent_id && Number(parent_id) !== Number(id)) ? parseInt(parent_id, 10) : null;

    try {
      const [result] = await db.query(
        'UPDATE CUSTOMERS SET unique_id = ?, business_name = ?, vat_number = ?, address = ?, phone = ?, email = ?, parent_id = ? WHERE id = ?',
        [unique_id, business_name, vat_number, address, phone, email, cleanParentId, id]
      );
      if (result.affectedRows === 0) {
        return reply.code(404).send({ error: 'Cliente non trovato' });
      }

      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['UPDATE_CUSTOMER', `Modificato cliente ${business_name} (${unique_id})`, 'Gestionale', request.user.username]
      );

      return { success: true };
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return reply.code(400).send({ error: 'Codice Cliente già in uso' });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore interno' });
    }
  });
}

module.exports = customerRoutes;
