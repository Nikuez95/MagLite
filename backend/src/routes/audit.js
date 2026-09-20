const db = require('../config/db');

async function auditRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/', async (request, reply) => {
    const { search = '', start_date, end_date } = request.query;

    try {
      let query = 'SELECT * FROM AUDIT_LOGS WHERE 1=1';
      const params = [];

      if (search) {
        query += ' AND (details LIKE ? OR action LIKE ? OR username LIKE ?)';
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }

      if (start_date) {
        query += ' AND DATE(created_at) >= ?';
        params.push(start_date);
      }

      if (end_date) {
        query += ' AND DATE(created_at) <= ?';
        params.push(end_date);
      }

      query += ' ORDER BY created_at DESC LIMIT 500';

      const [logs] = await db.query(query, params);
      return logs;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore recupero audit logs' });
    }
  });
}

module.exports = auditRoutes;
