const db = require('./backend/src/config/db');
async function run() {
  const connection = await db.getConnection();
  try {
    await connection.query('CREATE TABLE IF NOT EXISTS FREE_LOCATIONS (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
    console.log('FREE_LOCATIONS created');
  } catch (err) {
    console.error(err);
  } finally {
    connection.release();
    process.exit();
  }
}
run();
