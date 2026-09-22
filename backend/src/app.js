const fastify = require('fastify')({
  logger: true
});

const cors = require('@fastify/cors');
const jwt = require('@fastify/jwt');
require('dotenv').config();

// 1. Configurazione CORS
fastify.register(cors, {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
});

// 2. Configurazione JWT
fastify.register(jwt, {
  secret: process.env.JWT_SECRET || 'super_secret_jwt_key_maglite_2026'
});

// 3. Decoratore per proteggere le rotte
// Qualsiasi rotta che usa preValidation: [fastify.authenticate] verificherà il token
fastify.decorate('authenticate', async function (request, reply) {
  try {
    if (!request.headers.authorization && request.query.token) {
      request.headers.authorization = `Bearer ${request.query.token}`;
    }
    await request.jwtVerify();
  } catch (err) {
    reply.code(401).send({ error: 'Non autorizzato. Token mancante o non valido.' });
  }
});

// 4. Registrazione Rotte
fastify.register(require('./routes/auth'), { prefix: '/api/auth' });
fastify.register(require('./routes/pallets'), { prefix: '/api/pallets' });
fastify.register(require('./routes/users'), { prefix: '/api/users' });
fastify.register(require('./routes/customers'), { prefix: '/api/customers' });
fastify.register(require('./routes/products'), { prefix: '/api/products' });
fastify.register(require('./routes/locations'), { prefix: '/api/locations' });
fastify.register(require('./routes/dashboard'), { prefix: '/api/dashboard' });
fastify.register(require('./routes/audit'), { prefix: '/api/audit' });
fastify.register(require('./routes/outbound'), { prefix: '/api/outbound' });

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
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
