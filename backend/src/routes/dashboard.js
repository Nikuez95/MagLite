const { hasPermission } = require('../utils/permissions');
const db = require('../config/db');

async function dashboardRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/stats', async (request, reply) => {
    if (!hasPermission(request.user, 'view_dashboard')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di visualizzare la Dashboard.' });
    }
    try {
      // Esecuzione parallela di aggregazioni condizionali invece di 11 query sequenziali
      const [
        [[locCounts]],
        [[palletStats]],
        [[outboundStats]],
        [[custProdCounts]],
        [recent_logs]
      ] = await Promise.all([
        db.query('SELECT COUNT(*) as total FROM LOCATIONS'),
        db.query(`
          SELECT
            COUNT(DISTINCT CASE WHEN status = 'STOCKED' AND quantity > 0 AND location IS NOT NULL AND location != '' AND location NOT LIKE 'ZONA CARICO%' THEN location END) AS occupied,
            COUNT(DISTINCT CASE WHEN status IN ('STOCKED', 'PENDING') AND quantity > 0 THEN pallet_code END) AS active_pallets,
            COUNT(DISTINCT CASE WHEN status = 'PENDING' AND quantity > 0 THEN pallet_code END) AS pending_stow,
            COUNT(DISTINCT CASE WHEN status = 'STOCKED' AND quantity > 0 AND location LIKE 'ZONA CARICO%' THEN pallet_code END) AS loading_zone_pallets,
            SUM(CASE WHEN status IN ('STOCKED', 'PENDING') AND quantity > 0 AND expiration_date IS NOT NULL AND expiration_date < CURDATE() THEN 1 ELSE 0 END) AS expired_pallets,
            SUM(CASE WHEN status IN ('STOCKED', 'PENDING') AND quantity > 0 AND expiration_date IS NOT NULL AND expiration_date >= CURDATE() AND expiration_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS expiring_30d_pallets
          FROM PALLETS
          WHERE status IN ('STOCKED', 'PENDING') AND quantity > 0
        `),
        db.query(`
          SELECT
            COUNT(*) AS active_outbound,
            SUM(CASE WHEN status = 'READY' THEN 1 ELSE 0 END) AS ready_outbound
          FROM OUTBOUND_ORDERS
          WHERE status != 'SHIPPED'
        `),
        db.query(`
          SELECT
            (SELECT COUNT(*) FROM CUSTOMERS) AS total_customers,
            (SELECT COUNT(*) FROM PRODUCTS) AS total_products
        `),
        db.query(`
          SELECT id, action, details, source, username, created_at
          FROM AUDIT_LOGS
          ORDER BY created_at DESC
          LIMIT 15
        `)
      ]);

      const total = Number(locCounts?.total) || 0;
      const occupied = Number(palletStats?.occupied) || 0;
      const saturation_percentage = total > 0 ? Math.round((occupied / total) * 100) : 0;

      // Batch lookup per i codici paletta nei log recenti (elimina N+1 query loop)
      const palletCodesInLogs = new Set();
      for (const log of recent_logs) {
        const match = String(log.details || '').match(/paletta (PAL-[A-Z0-9\-]+|NOBAR-[A-Z0-9\-]+)/i);
        if (match) {
          log.pallet_code = match[1];
          palletCodesInLogs.add(match[1]);
        }
      }

      if (palletCodesInLogs.size > 0) {
        const [pRows] = await db.query(`
          SELECT p.pallet_code, pr.name as product_name
          FROM PALLETS p
          JOIN PRODUCTS pr ON p.product_id = pr.id
          WHERE p.pallet_code IN (?)
        `, [Array.from(palletCodesInLogs)]);

        const namesByCode = new Map();
        for (const r of pRows) {
          if (!namesByCode.has(r.pallet_code)) namesByCode.set(r.pallet_code, []);
          namesByCode.get(r.pallet_code).push(r.product_name);
        }
        for (const log of recent_logs) {
          if (!log.pallet_code) continue;
          const names = namesByCode.get(log.pallet_code) || [];
          if (names.length > 1) {
            const uniqueNames = [...new Set(names)];
            log.product_name = uniqueNames.length === 1
              ? `${uniqueNames[0]} (${names.length} Lotti)`
              : `Paletta Mista (${names.length} Art.)`;
          } else if (names.length === 1) {
            log.product_name = names[0];
          }
        }
      }

      return {
        total_locations: total,
        occupied_locations: occupied,
        saturation_percentage,
        active_pallets: Number(palletStats?.active_pallets) || 0,
        pending_stow: Number(palletStats?.pending_stow) || 0,
        loading_zone_pallets: Number(palletStats?.loading_zone_pallets) || 0,
        active_outbound: Number(outboundStats?.active_outbound) || 0,
        ready_outbound: Number(outboundStats?.ready_outbound) || 0,
        expired_pallets: Number(palletStats?.expired_pallets) || 0,
        expiring_30d_pallets: Number(palletStats?.expiring_30d_pallets) || 0,
        total_customers: Number(custProdCounts?.total_customers) || 0,
        total_products: Number(custProdCounts?.total_products) || 0,
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
      const [[pallets], [products], [customers], [orders]] = await Promise.all([
        db.query(`
          SELECT p.id, p.pallet_code, p.batch, p.location, p.quantity, p.status,
                 pr.name as product_name, c.business_name as customer_name
          FROM PALLETS p
          JOIN PRODUCTS pr ON p.product_id = pr.id
          JOIN CUSTOMERS c ON p.customer_id = c.id
          WHERE p.status != 'SHIPPED' AND p.quantity > 0
            AND (p.pallet_code LIKE ? OR p.batch LIKE ? OR p.location LIKE ? OR pr.name LIKE ? OR p.client_article_number LIKE ?)
          ORDER BY p.created_at DESC
          LIMIT 6
        `, [like, like, like, like, like]),
        db.query(`
          SELECT pr.id, pr.sku, pr.name, pr.uom, c.business_name as customer_name
          FROM PRODUCTS pr
          LEFT JOIN CUSTOMERS c ON pr.customer_id = c.id
          WHERE pr.sku LIKE ? OR pr.name LIKE ?
          LIMIT 5
        `, [like, like]),
        db.query(`
          SELECT id, business_name, vat_number, address
          FROM CUSTOMERS
          WHERE business_name LIKE ? OR vat_number LIKE ?
          LIMIT 4
        `, [like, like]),
        db.query(`
          SELECT o.id, o.order_code, o.status, o.client_ddt, c.business_name as customer_name
          FROM OUTBOUND_ORDERS o
          LEFT JOIN CUSTOMERS c ON o.customer_id = c.id
          WHERE o.order_code LIKE ? OR o.client_ddt LIKE ? OR c.business_name LIKE ?
          ORDER BY o.created_at DESC
          LIMIT 4
        `, [like, like, like])
      ]);

      return { pallets, products, customers, orders };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore ricerca globale' });
    }
  });
}

module.exports = dashboardRoutes;
