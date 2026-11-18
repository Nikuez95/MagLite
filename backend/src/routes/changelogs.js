const db = require('../config/db');
const { parseJsonSafe } = require('../utils/permissions');

function isSoftwareEngineer(user) {
  if (!user) return false;
  if (user.role === 'developer') return true;
  const rName = String(user.role_name || '').toLowerCase();
  return rName.includes('software engineer') || rName.includes('software engineering');
}

async function changelogsRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  // GET /api/changelogs - Canale storico completo di tutti i changelog con data
  fastify.get('/', async (request, reply) => {
    try {
      const isEng = isSoftwareEngineer(request.user);
      const includeDrafts = isEng && (request.query?.include_drafts === 'true' || request.query?.include_drafts === '1');

      const [rows] = await db.query(`
        SELECT c.id, c.version, c.title, c.summary, c.items, c.is_published, c.show_popup,
               c.created_by_id, c.created_by_username, c.published_at, c.created_at,
               IF(cv.changelog_id IS NOT NULL, 1, 0) AS is_seen
        FROM CHANGELOGS c
        LEFT JOIN CHANGELOG_VIEWS cv
          ON cv.changelog_id = c.id AND cv.user_id = ?
        ${includeDrafts ? '' : 'WHERE c.is_published = 1'}
        ORDER BY COALESCE(c.published_at, c.created_at) DESC, c.id DESC
        LIMIT 200
      `, [request.user.id]);

      return {
        changelogs: rows.map(r => ({
          ...r,
          is_published: Boolean(r.is_published),
          show_popup: Boolean(r.show_popup),
          is_seen: Boolean(r.is_seen),
          items: parseJsonSafe(r.items, [])
        })),
        is_software_engineer: isEng
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore nel recupero dei changelog' });
    }
  });

  // GET /api/changelogs/unseen - Changelog da mostrare 1 volta al prossimo accesso dell'utente
  fastify.get('/unseen', async (request, reply) => {
    try {
      const userId = request.user.id;
      const [[userRow]] = await db.query('SELECT created_at FROM USERS WHERE id = ?', [userId]);
      const userCreatedAt = userRow?.created_at || null;

      let sql = `
        SELECT c.id, c.version, c.title, c.summary, c.items, c.created_by_username, c.published_at, c.created_at
        FROM CHANGELOGS c
        LEFT JOIN CHANGELOG_VIEWS cv
          ON cv.changelog_id = c.id AND cv.user_id = ?
        WHERE c.is_published = 1
          AND c.show_popup = 1
          AND cv.changelog_id IS NULL
      `;
      const params = [userId];

      // Gli utenti appena creati vedono i changelog pubblicati dopo la loro creazione (o ultimi 5 min di tolleranza)
      if (userCreatedAt) {
        sql += ' AND COALESCE(c.published_at, c.created_at) >= DATE_SUB(?, INTERVAL 5 MINUTE)';
        params.push(userCreatedAt);
      }

      sql += ' ORDER BY COALESCE(c.published_at, c.created_at) DESC, c.id DESC LIMIT 5';

      const [rows] = await db.query(sql, params);

      return {
        unseen: rows.map(r => ({
          ...r,
          items: parseJsonSafe(r.items, [])
        }))
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore verifica changelog non letti' });
    }
  });

  // POST /api/changelogs/mark-seen - Marca come visti i changelog mostrati nel popup (non appariranno più)
  fastify.post('/mark-seen', async (request, reply) => {
    try {
      const { changelog_ids } = request.body || {};
      const ids = Array.isArray(changelog_ids)
        ? [...new Set(changelog_ids.map(Number).filter(n => Number.isInteger(n) && n > 0))]
        : [];

      if (ids.length > 0) {
        const values = ids.map(cid => [request.user.id, cid]);
        await db.query('INSERT IGNORE INTO CHANGELOG_VIEWS (user_id, changelog_id) VALUES ?', [values]);
      }

      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore salvataggio lettura changelog' });
    }
  });

  // POST /api/changelogs - Lancia un nuovo changelog (SOLO Software Engineering)
  fastify.post('/', async (request, reply) => {
    if (!isSoftwareEngineer(request.user)) {
      return reply.code(403).send({ error: 'Accesso negato: solo il ruolo Software Engineering può pubblicare changelog.' });
    }

    const { version, title, summary, items = [], show_popup = true, is_published = true } = request.body || {};
    if (!version || !String(version).trim() || !title || !String(title).trim() || !summary || !String(summary).trim()) {
      return reply.code(400).send({ error: 'Versione, titolo e riepilogo sono obbligatori' });
    }

    const cleanItems = Array.isArray(items)
      ? items
          .filter(it => it && String(it.text || '').trim() !== '')
          .map(it => ({
            type: String(it.type || 'NEW').toUpperCase(),
            text: String(it.text).trim()
          }))
      : [];

    try {
      const [res] = await db.query(
        `INSERT INTO CHANGELOGS
         (version, title, summary, items, is_published, show_popup, created_by_id, created_by_username, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          String(version).trim().slice(0, 50),
          String(title).trim().slice(0, 255),
          String(summary).trim(),
          JSON.stringify(cleanItems),
          is_published ? 1 : 0,
          show_popup ? 1 : 0,
          request.user.id,
          request.user.username,
          is_published ? new Date() : null
        ]
      );

      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        [
          'PUBLISH_CHANGELOG',
          `Pubblicato Changelog ${String(version).trim()}: ${String(title).trim()}`,
          'Software Engineering',
          request.user.username
        ]
      );

      if (fastify.io && is_published) {
        fastify.io.emit('changelog_published', {
          id: res.insertId,
          version: String(version).trim(),
          title: String(title).trim()
        });
      }

      return reply.code(201).send({ success: true, id: res.insertId });
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore nella pubblicazione del changelog' });
    }
  });

  // DELETE /api/changelogs/:id - Elimina un changelog (SOLO Software Engineering)
  fastify.delete('/:id', async (request, reply) => {
    if (!isSoftwareEngineer(request.user)) {
      return reply.code(403).send({ error: 'Accesso negato: solo il ruolo Software Engineering può eliminare changelog.' });
    }

    try {
      const [res] = await db.query('DELETE FROM CHANGELOGS WHERE id = ?', [Number(request.params.id)]);
      if (res.affectedRows === 0) return reply.code(404).send({ error: 'Changelog non trovato' });
      if (fastify.io) fastify.io.emit('changelog_published', { deleted: true });
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore eliminazione changelog' });
    }
  });
}

module.exports = changelogsRoutes;
