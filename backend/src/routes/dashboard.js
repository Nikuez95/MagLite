const db = require('../config/db');

async function dashboardRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/stats', async (request, reply) => {
    try {
      // Calcolo Saturazione Posizioni
      const [[{ total }]] = await db.query('SELECT COUNT(*) as total FROM LOCATIONS');
      const [[{ occupied }]] = await db.query('SELECT COUNT(DISTINCT location) as occupied FROM PALLETS WHERE status = "STOCKED" AND location IS NOT NULL AND location != ""');
      
      const saturation_percentage = total > 0 ? Math.round((occupied / total) * 100) : 0;

      // Ultimi Logs
      const [recent_logs] = await db.query(`
        SELECT id, action, details, source, username, created_at
        FROM AUDIT_LOGS
        ORDER BY created_at DESC
        LIMIT 10
      `);

      for (let log of recent_logs) {
        const match = log.details.match(/paletta (PAL-[A-Z0-9\-]+)/i);
        if (match) {
          log.pallet_code = match[1];
          const [[p]] = await db.query(`
            SELECT pr.name as product_name
            FROM PALLETS p JOIN PRODUCTS pr ON p.product_id = pr.id
            WHERE p.pallet_code = ?
          `, [log.pallet_code]);
          if (p) {
            log.product_name = p.product_name;
          }
        }
      }

      return {
        total_locations: total,
        occupied_locations: occupied,
        saturation_percentage,
        recent_logs
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore recupero statistiche dashboard' });
    }
  });
}

module.exports = dashboardRoutes;
