const fastify = require('fastify')({
  logger: true
});

const cors = require('@fastify/cors');
const jwt = require('@fastify/jwt');
require('./config/env');
const { resolveUserAccess } = require('./utils/permissions');

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET mancante in backend/.env: imposta una chiave segreta prima di avviare il server.');
}

// 1. Configurazione CORS
fastify.register(cors, {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
});

// 1b. Supporto upload multipart (documenti e allegati archiviati su NAS SFTP)
fastify.register(require('@fastify/multipart'), {
  limits: {
    fileSize: 150 * 1024 * 1024 // 150 MB per file
  }
});

// 2. Configurazione JWT
fastify.register(jwt, {
  secret: process.env.JWT_SECRET
});

// 3. Decoratore per proteggere le rotte e arricchire il profilo permessi/gerarchia
fastify.decorate('authenticate', async function (request, reply) {
  try {
    if (!request.headers.authorization && request.query.token) {
      request.headers.authorization = `Bearer ${request.query.token}`;
    }
    await request.jwtVerify();
    if (request.user && request.user.id) {
      const access = await resolveUserAccess(request.user.id);
      if (access) {
        request.user = {
          ...request.user,
          role: access.role,
          role_name: access.role_name,
          hierarchy_level: access.hierarchy_level,
          permissions: access.permissions,
          restricted_customers: access.restricted_customers,
          customer_access_mode: access.customer_access_mode
        };
      }
    }
  } catch (err) {
    reply.code(401).send({ error: 'Non autorizzato. Token mancante o non valido.' });
  }
});

// 4. Registrazione Rotte
fastify.register(require('./routes/auth'), { prefix: '/api/auth' });
fastify.register(require('./routes/pallets'), { prefix: '/api/pallets' });
fastify.register(require('./routes/quarantine'), { prefix: '/api/quarantine' });
fastify.register(require('./routes/nonConformities'), { prefix: '/api/non-conformities' });
fastify.register(require('./routes/inbound'), { prefix: '/api/inbound' });
fastify.register(require('./routes/users'), { prefix: '/api/users' });
fastify.register(require('./routes/customers'), { prefix: '/api/customers' });
fastify.register(require('./routes/products'), { prefix: '/api/products' });
fastify.register(require('./routes/productCategories'), { prefix: '/api/product-categories' });
fastify.register(require('./routes/locations'), { prefix: '/api/locations' });
fastify.register(require('./routes/warehouses'), { prefix: '/api/warehouses' });
fastify.register(require('./routes/dashboard'), { prefix: '/api/dashboard' });
fastify.register(require('./routes/audit'), { prefix: '/api/audit' });
fastify.register(require('./routes/outbound'), { prefix: '/api/outbound' });
fastify.register(require('./routes/billing'), { prefix: '/api/billing' });
fastify.register(require('./routes/settings'), { prefix: '/api/settings' });
fastify.register(require('./routes/finances'), { prefix: '/api/finances' });
fastify.register(require('./routes/tms'), { prefix: '/api/tms' });
fastify.register(require('./routes/customForms'), { prefix: '/api/custom-forms' });
fastify.register(require('./routes/notifications'), { prefix: '/api/notifications' });
fastify.register(require('./routes/tickets'), { prefix: '/api/tickets' });
fastify.register(require('./routes/changelogs'), { prefix: '/api/changelogs' });
fastify.register(require('./routes/customerFiles'), { prefix: '/api/customer-files' });
fastify.register(require('./routes/files'), { prefix: '/api/files' });

const sftpStorageService = require('./services/sftpStorageService');
const { getSftpConfig } = require('./services/sftpStorageService');
const sftpBootCfg = getSftpConfig({ requireConfigured: false });
if (!sftpBootCfg.isConfigured) {
  fastify.log.warn(`[SFTP NAS] Configurazione incompleta in backend/.env: ${sftpBootCfg.missing.join(', ')}`);
} else {
  fastify.log.info(`[SFTP NAS] Storage configurato su ${sftpBootCfg.host}:${sftpBootCfg.port} (${sftpBootCfg.basePath})`);
}
fastify.addHook('onClose', async () => {
  await sftpStorageService.close({ logger: fastify.log });
});

// Health check endpoint (non protetto)
fastify.get('/api/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// 5. Avvio del server
const start = async () => {
  try {
    const port = process.env.PORT || 3000;
    const host = process.env.HOST || '0.0.0.0';
    
    // Inizializza Socket.io
    const io = require('socket.io')(fastify.server, {
      cors: { origin: '*', methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'] }
    });
    fastify.decorate('io', io);
    
    io.on('connection', (socket) => {
      fastify.log.info(`Socket Client Connected: ${socket.id}`);
    });

    // Run Migrations
    const runMigrations = require('./scripts/migrate');
    await runMigrations();

    await fastify.ready();
    await fastify.listen({ port, host });
    fastify.log.info(`🚀 MagLite Backend in ascolto su ${host}:${port}`);

    // Avvio Cron Job GDP Auto-Quarantena Lotti Scaduti (Startup + Mezzanotte/Orario)
    const { startGdpAutoQuarantineCron } = require('./utils/gdpCron');
    startGdpAutoQuarantineCron(fastify.io, fastify.log);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
