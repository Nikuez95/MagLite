const mysql = require('mysql2/promise');

async function run() {
  const connection = await mysql.createConnection({
    host: '127.0.0.1',
    user: 'maglite_user',
    password: 'maglite_pass',
    database: 'maglite_db'
  });
  
  try {
    await connection.query("ALTER TABLE PALLETS ADD COLUMN client_pallet_number VARCHAR(100);");
  } catch (err) {}
  
  try {
    await connection.query("ALTER TABLE PALLETS ADD COLUMN client_article_number VARCHAR(100);");
  } catch (err) {}

  await connection.end();
}

run();
