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
      const [rows] = await db.query('SELECT * FROM CUSTOMERS ORDER BY business_name ASC');
      return rows;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante il recupero dei clienti' });
    }
  });

  // POST /api/customers
  fastify.post('/', async (request, reply) => {
    const { unique_id, business_name, vat_number, address, phone, email } = request.body;
    
    if (!unique_id || !business_name) {
      return reply.code(400).send({ error: 'Codice Cliente e Ragione Sociale sono obbligatori' });
    }

    try {
      const [result] = await db.query(
        'INSERT INTO CUSTOMERS (unique_id, business_name, vat_number, address, phone, email) VALUES (?, ?, ?, ?, ?, ?)',
        [unique_id, business_name, vat_number, address, phone, email]
      );
      
      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['CREATE_CUSTOMER', `Creato cliente ${business_name} (${unique_id})`, 'Gestionale', request.user.username]
      );

      return reply.code(201).send({ success: true, id: result.insertId });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return reply.code(400).send({ error: 'Codice Cliente già in uso' });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore interno' });
    }
  });

  // DELETE /api/customers/:id
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const [[customer]] = await db.query('SELECT business_name FROM CUSTOMERS WHERE id = ?', [id]);
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
    const { unique_id, business_name, vat_number, address, phone, email } = request.body;
    
    if (!unique_id || !business_name) {
      return reply.code(400).send({ error: 'Codice Cliente e Ragione Sociale sono obbligatori' });
    }

    try {
      const [result] = await db.query(
        'UPDATE CUSTOMERS SET unique_id = ?, business_name = ?, vat_number = ?, address = ?, phone = ?, email = ? WHERE id = ?',
        [unique_id, business_name, vat_number, address, phone, email, id]
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
