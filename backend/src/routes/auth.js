const bcrypt = require('bcrypt');
const db = require('../config/db');
const { resolveUserAccess } = require('../utils/permissions');

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

      const accessProfile = await resolveUserAccess(user.id, db);

      // Genera il token JWT includendo ruolo e ID (Senza scadenza)
      const token = fastify.jwt.sign({ 
        id: user.id, 
        username: user.username, 
        role: accessProfile.role,
        hierarchy_level: accessProfile.hierarchy_level,
        requires_password_change: !!user.requires_password_change
      });

      return {
        token,
        user: accessProfile
      };

    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore interno del server' });
    }
  });

  // GET /api/auth/me - Profilo e permessi aggiornati in tempo reale
  fastify.get('/me', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    try {
      const accessProfile = await resolveUserAccess(request.user.id, db);
      if (!accessProfile) {
        return reply.code(404).send({ error: 'Utente non trovato' });
      }
      return { user: accessProfile };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore recupero profilo' });
    }
  });

  // Endpoint di Supporto: Setup Admin iniziale (Pubblico per MVP)
  fastify.post('/setup-admin', async (request, reply) => {
    try {
      const [[{ count }]] = await db.query('SELECT COUNT(*) as count FROM USERS');
      if (count > 0) return reply.code(403).send({ error: 'Setup già completato' });

      const { username, password } = request.body || {};
      
      if (!username || !password) {
        return reply.code(400).send({ error: 'Username e password obbligatori' });
      }

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
      
      const accessProfile = await resolveUserAccess(request.user.id, db);
      const newToken = fastify.jwt.sign({ 
        id: request.user.id, 
        username: request.user.username, 
        role: accessProfile.role,
        hierarchy_level: accessProfile.hierarchy_level,
        requires_password_change: false
      });

      return { success: true, message: 'Password aggiornata con successo', token: newToken, user: accessProfile };
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
