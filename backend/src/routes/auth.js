const bcrypt = require('bcrypt');
const db = require('../config/db');

async function authRoutes(fastify, options) {
  
  // Endpoint di Login (Pubblico)
  fastify.post('/login', async (request, reply) => {
    const { username, password } = request.body;
    
    if (!username || !password) {
      return reply.code(400).send({ error: 'Username e password sono obbligatori' });
    }

    try {
      const [rows] = await db.query('SELECT * FROM USERS WHERE username = ?', [username]);
      const user = rows[0];

      if (!user) {
        return reply.code(401).send({ error: 'Credenziali non valide' });
      }

      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        return reply.code(401).send({ error: 'Credenziali non valide' });
      }

      // Genera il token JWT includendo ruolo e ID
      const token = fastify.jwt.sign({ 
        id: user.id, 
        username: user.username, 
        role: user.role,
        requires_password_change: !!user.requires_password_change
      }, { expiresIn: '12h' }); // Scade in 12 ore, ideale per un turno logistico

      return {
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          requires_password_change: !!user.requires_password_change,
          preferences: user.preferences ? (typeof user.preferences === 'string' ? JSON.parse(user.preferences) : user.preferences) : null
        }
      };

    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore interno del server' });
    }
  });

  // Endpoint di Supporto: Setup Admin iniziale (Pubblico per MVP)
  // Utilizzato per creare il primissimo utente admin per poter testare il login
  fastify.post('/setup-admin', async (request, reply) => {
    const { username, password } = request.body;
    
    if (!username || !password) {
      return reply.code(400).send({ error: 'Username e password obbligatori' });
    }

    try {
      // Cifra la password prima di salvarla nel DB
      const hash = await bcrypt.hash(password, 10);
      await db.query('INSERT INTO USERS (username, password_hash, role, requires_password_change) VALUES (?, ?, ?, FALSE)', [username, hash, 'developer']);
      
      return { success: true, message: `Utente developer '${username}' creato con successo!` };
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return reply.code(400).send({ error: 'Utente già esistente' });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore interno del server' });
    }
  });

  // Endpoint per l'utente che deve cambiare la propria password (Protetto)
  fastify.post('/change-password', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { newPassword } = request.body;
    
    if (!newPassword || newPassword.length < 6) {
      return reply.code(400).send({ error: 'La nuova password deve contenere almeno 6 caratteri' });
    }

    try {
      const hash = await bcrypt.hash(newPassword, 10);
      
      await db.query('UPDATE USERS SET password_hash = ?, requires_password_change = FALSE WHERE id = ?', [hash, request.user.id]);
      
      // Rigeneriamo il token per rimuovere il flag requires_password_change
      const newToken = fastify.jwt.sign({ 
        id: request.user.id, 
        username: request.user.username, 
        role: request.user.role,
        requires_password_change: false
      }, { expiresIn: '12h' });

      return { success: true, message: 'Password aggiornata con successo', token: newToken };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore interno del server' });
    }
  });

  fastify.put('/preferences', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    try {
      const preferences = JSON.stringify(request.body.preferences);
      await db.query('UPDATE USERS SET preferences = ? WHERE id = ?', [preferences, request.user.id]);
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante il salvataggio delle preferenze' });
    }
  });
}

module.exports = authRoutes;
