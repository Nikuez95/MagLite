const bcrypt = require('bcrypt');
const db = require('../config/db');

async function userRoutes(fastify, options) {
  
  // Proteggiamo tutte le rotte con JWT
  fastify.addHook('onRequest', fastify.authenticate);

  // Middleware locale: solo chi ha ruolo 'developer' o 'backoffice' può usare queste API
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.user.role !== 'developer' && request.user.role !== 'backoffice') {
      return reply.code(403).send({ error: 'Accesso negato: richiesti privilegi di backoffice o sviluppatore.' });
    }
  });

  // GET /api/users - Ritorna tutti gli utenti
  fastify.get('/', async (request, reply) => {
    try {
      const [rows] = await db.query('SELECT id, username, role, created_at FROM USERS ORDER BY created_at DESC');
      return { users: rows };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore interno del server' });
    }
  });

  // POST /api/users - Crea un nuovo utente (Admin o Operator)
  fastify.post('/', async (request, reply) => {
    const { username, password, role } = request.body;
    
    if (!username || !password || !role) {
      return reply.code(400).send({ error: 'Tutti i campi sono obbligatori' });
    }

    if (role !== 'backoffice' && role !== 'operator') {
      return reply.code(400).send({ error: 'Il ruolo deve essere "backoffice" o "operator"' });
    }

    try {
      const hash = await bcrypt.hash(password, 10);
      await db.query('INSERT INTO USERS (username, password_hash, role, requires_password_change) VALUES (?, ?, ?, TRUE)', [username, hash, role]);
      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['CREATE_USER', `Creato utente ${username} (Ruolo: ${role})`, 'Gestionale', request.user.username]
      );
      
      return reply.code(201).send({ success: true, message: 'Utente creato con successo' });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return reply.code(400).send({ error: 'Lo username scelto è già in uso' });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore interno del server' });
    }
  });

  // DELETE /api/users/:id - Elimina un utente
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params;
    
    // Evitiamo che l'admin cancelli se stesso
    if (id == request.user.id) {
      return reply.code(400).send({ error: 'Non puoi cancellare il tuo stesso account' });
    }

    try {
      const [userCheck] = await db.query('SELECT username, role FROM USERS WHERE id = ?', [id]);
      if (userCheck[0]?.role === 'developer') {
        return reply.code(403).send({ error: 'L\'account sviluppatore non può essere eliminato' });
      }

      const [result] = await db.query('DELETE FROM USERS WHERE id = ?', [id]);
      if (result.affectedRows === 0) {
        return reply.code(404).send({ error: 'Utente non trovato' });
      }
      if (userCheck[0]) {
        await db.query(
          'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
          ['DELETE_USER', `Eliminato utente ${userCheck[0].username}`, 'Gestionale', request.user.username]
        );
      }
      return { success: true, message: 'Utente eliminato' };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante l\'eliminazione' });
    }
  });

  // PUT /api/users/:id/reset-password - Admin forza una nuova password per l'utente
  fastify.put('/:id/reset-password', async (request, reply) => {
    const { id } = request.params;
    const { newPassword } = request.body;

    if (!newPassword) {
      return reply.code(400).send({ error: 'La nuova password è obbligatoria' });
    }

    try {
      const [userCheck] = await db.query('SELECT username, role FROM USERS WHERE id = ?', [id]);
      if (userCheck[0]?.role === 'developer') {
        return reply.code(403).send({ error: 'L\'account sviluppatore non può essere modificato da altri' });
      }

      const hash = await bcrypt.hash(newPassword, 10);
      // Impostiamo la password e forziamo il reset al prossimo login
      const [result] = await db.query('UPDATE USERS SET password_hash = ?, requires_password_change = TRUE WHERE id = ?', [hash, id]);
      
      if (result.affectedRows === 0) {
        return reply.code(404).send({ error: 'Utente non trovato' });
      }
      
      if (userCheck[0]) {
        await db.query(
          'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
          ['RESET_PASSWORD', `Forzato reset password per utente ${userCheck[0].username}`, 'Gestionale', request.user.username]
        );
      }
      return { success: true, message: 'Password resettata. Al prossimo login l\'utente dovrà cambiarla.' };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante il reset della password' });
    }
  });
}

module.exports = userRoutes;
