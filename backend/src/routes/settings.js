const db = require('../config/db');

async function settingsRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

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
