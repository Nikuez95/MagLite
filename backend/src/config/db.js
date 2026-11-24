const mysql = require('mysql2/promise');
require('./env');

if (!process.env.DB_HOST || !process.env.DB_USER || process.env.DB_PASSWORD === undefined || !process.env.DB_NAME) {
  throw new Error('Configurazione DB mancante in backend/.env (copia backend/.env.example in backend/.env e imposta DB_HOST, DB_USER, DB_PASSWORD, DB_NAME).');
}

// Configurazione del Pool di connessioni per MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  timezone: '+00:00', // FIXED: Ensures Node parses DB time correctly as UTC instead of Local
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
});

// Test della connessione all'avvio
pool.getConnection()
  .then(conn => {
    console.log('✅ Connesso al database MySQL con successo!');
    conn.release();
  })
  .catch(err => {
    console.error(
      `❌ Errore critico: impossibile connettersi a MySQL (${process.env.DB_USER}@${process.env.DB_HOST}:${process.env.DB_PORT || 3306}/${process.env.DB_NAME}):`,
      err.code || '',
      err.message
    );
  });

module.exports = pool;
