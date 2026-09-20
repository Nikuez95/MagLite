const mysql = require('mysql2/promise');
require('dotenv').config();

// Configurazione del Pool di connessioni per MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'maglite_user',
  password: process.env.DB_PASSWORD || 'maglite_pass',
  database: process.env.DB_NAME || 'maglite_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test della connessione all'avvio
pool.getConnection()
  .then(conn => {
    console.log('✅ Connesso al database MySQL con successo!');
    conn.release();
  })
  .catch(err => {
    console.error('❌ Errore critico: impossibile connettersi a MySQL:', err.message);
  });

module.exports = pool;
