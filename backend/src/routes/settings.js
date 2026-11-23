const db = require('../config/db');
const { hasPermission } = require('../utils/permissions');
const bwipjs = require('bwip-js');

function isSoftwareEngineer(user) {
  if (!user) return false;
  const roleCode = String(user.role || '').trim().toLowerCase();
  const roleName = String(user.role_name || '').trim().toLowerCase();
  return roleCode === 'developer' || roleName === 'software engineer';
}

async function settingsRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/section-locks', async (request, reply) => {
    try {
      const [rows] = await db.query(
        'SELECT setting_value FROM settings WHERE setting_key = "section_locks" LIMIT 1'
      );
      if (rows.length === 0 || !rows[0].setting_value) return {};
      try {
        const parsed = JSON.parse(rows[0].setting_value);
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch (_) {
        return {};
      }
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore recupero blocchi sezioni' });
    }
  });

  fastify.put('/section-locks', async (request, reply) => {
    if (!isSoftwareEngineer(request.user)) {
      return reply.code(403).send({ error: 'Solo il ruolo Software Engineer può bloccare o sbloccare le sezioni del gestionale.' });
    }

    const incoming = request.body?.locks !== undefined ? request.body.locks : request.body;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return reply.code(400).send({ error: 'Formato blocchi non valido.' });
    }

    const sanitized = {};
    for (const [secKey, val] of Object.entries(incoming)) {
      if (!val || typeof val !== 'object') continue;
      const reason = val.reason === 'INVALID_LICENSE' ? 'INVALID_LICENSE' : 'MAINTENANCE';
      sanitized[String(secKey).trim()] = {
        reason,
        note: val.note ? String(val.note).trim().slice(0, 240) : '',
        lockedBy: val.lockedBy || request.user?.username || 'Software Engineer',
        lockedAt: val.lockedAt || new Date().toISOString()
      };
    }

    try {
      const jsonStr = JSON.stringify(sanitized);
      await db.query(
        'INSERT INTO settings (setting_key, setting_value) VALUES ("section_locks", ?) ON DUPLICATE KEY UPDATE setting_value = ?',
        [jsonStr, jsonStr]
      );

      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        [
          'UPDATE_SECTION_LOCKS',
          `Aggiornati blocchi sezioni (${Object.keys(sanitized).length} sezioni bloccate)`,
          'Sistema',
          request.user?.username || 'Software Engineer'
        ]
      );

      if (fastify.io) {
        fastify.io.emit('section_locks_updated', sanitized);
      }
      return { success: true, locks: sanitized };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore salvataggio blocchi sezioni' });
    }
  });

  fastify.get('/barcode', async (request, reply) => {
    const text = String(request.query?.text || '').trim();
    if (!text) return reply.code(400).send({ error: 'Parametro text obbligatorio' });
    try {
      const png = await bwipjs.toBuffer({
        bcid: 'code128',
        text: text.slice(0, 80),
        scale: 3,
        height: 12,
        includetext: false
      });
      reply.header('Content-Type', 'image/png');
      return reply.send(png);
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore generazione barcode' });
    }
  });

  fastify.get('/', async (request, reply) => {
    try {
      const [rows] = await db.query('SELECT setting_key, setting_value FROM settings');
      const settingsObj = {};
      rows.forEach(r => {
        settingsObj[r.setting_key] = r.setting_value;
      });
      return settingsObj;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore recupero impostazioni' });
    }
  });

  fastify.post('/', async (request, reply) => {
    if (!hasPermission(request.user, 'settings_manage') && !hasPermission(request.user, 'pallet_move')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di modificare le impostazioni.' });
    }

    const settings = request.body; // Object of key-value pairs
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      for (const [key, value] of Object.entries(settings)) {
        await conn.query(
          'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
          [key, value, value]
        );
      }
      await conn.commit();
      return { success: true };
    } catch (err) {
      await conn.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore salvataggio impostazioni' });
    } finally {
      conn.release();
    }
  });
}

module.exports = settingsRoutes;
