const db = require('../config/db');

async function dashboardRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/stats', async (request, reply) => {
    try {
      // Calcolo Saturazione Posizioni
      const [[{ total }]] = await db.query('SELECT COUNT(*) as total FROM LOCATIONS');
      const [[{ occupied }]] = await db.query(
        "SELECT COUNT(DISTINCT location) as occupied FROM PALLETS WHERE status = 'STOCKED' AND quantity > 0 AND location IS NOT NULL AND location != '' AND location NOT LIKE 'ZONA CARICO%'"
      );
      
      const saturation_percentage = total > 0 ? Math.round((occupied / total) * 100) : 0;

      // KPI Operativi Real-Time
      const [[{ active_pallets }]] = await db.query(
        "SELECT COUNT(DISTINCT pallet_code) as active_pallets FROM PALLETS WHERE status IN ('STOCKED', 'PENDING') AND quantity > 0"
      );
      const [[{ pending_stow }]] = await db.query(
        "SELECT COUNT(DISTINCT pallet_code) as pending_stow FROM PALLETS WHERE status = 'PENDING' AND quantity > 0"
      );
      const [[{ loading_zone_pallets }]] = await db.query(
        "SELECT COUNT(DISTINCT pallet_code) as loading_zone_pallets FROM PALLETS WHERE status = 'STOCKED' AND quantity > 0 AND location LIKE 'ZONA CARICO%'"
      );
      const [[{ active_outbound }]] = await db.query(
        "SELECT COUNT(*) as active_outbound FROM OUTBOUND_ORDERS WHERE status != 'SHIPPED'"
      );
      const [[{ ready_outbound }]] = await db.query(
        "SELECT COUNT(*) as ready_outbound FROM OUTBOUND_ORDERS WHERE status = 'READY'"
      );
      const [[{ expired_pallets }]] = await db.query(
        "SELECT COUNT(*) as expired_pallets FROM PALLETS WHERE status IN ('STOCKED', 'PENDING') AND quantity > 0 AND expiration_date IS NOT NULL AND expiration_date < CURDATE()"
      );
      const [[{ expiring_30d_pallets }]] = await db.query(
        "SELECT COUNT(*) as expiring_30d_pallets FROM PALLETS WHERE status IN ('STOCKED', 'PENDING') AND quantity > 0 AND expiration_date IS NOT NULL AND expiration_date >= CURDATE() AND expiration_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)"
      );
      const [[{ total_customers }]] = await db.query('SELECT COUNT(*) as total_customers FROM CUSTOMERS');
      const [[{ total_products }]] = await db.query('SELECT COUNT(*) as total_products FROM PRODUCTS');

      // Ultimi Logs
      const [recent_logs] = await db.query(`
        SELECT id, action, details, source, username, created_at
        FROM AUDIT_LOGS
        ORDER BY created_at DESC
        LIMIT 15
      `);

      for (let log of recent_logs) {
        const match = log.details.match(/paletta (PAL-[A-Z0-9\-]+|NOBAR-[A-Z0-9\-]+)/i);
        if (match) {
          log.pallet_code = match[1];
          const [pRows] = await db.query(`
            SELECT pr.name as product_name
            FROM PALLETS p JOIN PRODUCTS pr ON p.product_id = pr.id
            WHERE p.pallet_code = ?
          `, [log.pallet_code]);
          if (pRows.length > 1) {
            const uniqueNames = [...new Set(pRows.map(r => r.product_name))];
            log.product_name = uniqueNames.length === 1 ? `${uniqueNames[0]} (${pRows.length} Lotti)` : `Paletta Mista (${pRows.length} Art.)`;
          } else if (pRows.length === 1) {
            log.product_name = pRows[0].product_name;
          }
        }
      }

      return {
        total_locations: total,
        occupied_locations: occupied,
        saturation_percentage,
        active_pallets,
        pending_stow,
        loading_zone_pallets,
        active_outbound,
        ready_outbound,
        expired_pallets,
        expiring_30d_pallets,
        total_customers,
        total_products,
        recent_logs
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore recupero statistiche dashboard' });
    }
  });

  // GET /api/dashboard/search?q=... - Ricerca Globale Rapida (Command Palette)
  fastify.get('/search', async (request, reply) => {
    const q = String(request.query.q || '').trim();
    if (q.length < 2) return { pallets: [], products: [], customers: [], orders: [] };
    const like = `%${q}%`;

    try {
      const [pallets] = await db.query(`
        SELECT p.id, p.pallet_code, p.batch, p.location, p.quantity, p.status,
               pr.name as product_name, c.business_name as customer_name
        FROM PALLETS p
        JOIN PRODUCTS pr ON p.product_id = pr.id
        JOIN CUSTOMERS c ON p.customer_id = c.id
        WHERE p.status != 'SHIPPED' AND p.quantity > 0
          AND (p.pallet_code LIKE ? OR p.batch LIKE ? OR p.location LIKE ? OR pr.name LIKE ? OR p.client_article_number LIKE ?)
        ORDER BY p.created_at DESC
        LIMIT 6
      `, [like, like, like, like, like]);

      const [products] = await db.query(`
        SELECT pr.id, pr.sku, pr.name, pr.uom, c.business_name as customer_name
        FROM PRODUCTS pr
        LEFT JOIN CUSTOMERS c ON pr.customer_id = c.id
        WHERE pr.sku LIKE ? OR pr.name LIKE ?
        LIMIT 5
      `, [like, like]);

      const [customers] = await db.query(`
        SELECT id, business_name, vat_number, address
        FROM CUSTOMERS
        WHERE business_name LIKE ? OR vat_number LIKE ?
        LIMIT 4
      `, [like, like]);

      const [orders] = await db.query(`
        SELECT o.id, o.order_code, o.status, o.client_ddt, c.business_name as customer_name
        FROM OUTBOUND_ORDERS o
        LEFT JOIN CUSTOMERS c ON o.customer_id = c.id
        WHERE o.order_code LIKE ? OR o.client_ddt LIKE ? OR c.business_name LIKE ?
        ORDER BY o.created_at DESC
        LIMIT 4
      `, [like, like, like]);

      return { pallets, products, customers, orders };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore ricerca globale' });
    }
  });
}

module.exports = dashboardRoutes;
