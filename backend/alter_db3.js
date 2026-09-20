const mysql = require('mysql2/promise');
async function run() {
  const connection = await mysql.createConnection({
    host: '127.0.0.1', user: 'maglite_user', password: 'maglite_pass', database: 'maglite_db'
  });
  try {
    await connection.query("ALTER TABLE PALLETS ADD COLUMN expiration_date DATE;");
    console.log("Colonna expiration_date aggiunta.");
  } catch (err) {
    console.log(err.message);
  }
  await connection.end();
}
run();
