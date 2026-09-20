const db = require('./src/config/db');
async function test() {
  try {
    const [[{ total }]] = await db.query('SELECT COUNT(*) as total FROM LOCATIONS');
    const [[{ occupied }]] = await db.query('SELECT COUNT(DISTINCT location) as occupied FROM PALLETS WHERE status = "STOCKED" AND location IS NOT NULL AND location != ""');
    const [recent_logs] = await db.query('SELECT id, action, details, source, username, created_at FROM AUDIT_LOGS ORDER BY created_at DESC LIMIT 10');
    for (let log of recent_logs) {
      const match = log.details.match(/paletta (PAL-[A-Z0-9\-]+)/i);
      if (match) {
        log.pallet_code = match[1];
        const [[p]] = await db.query('SELECT pr.name as product_name FROM PALLETS p JOIN PRODUCTS pr ON p.product_id = pr.id WHERE p.pallet_code = ?', [log.pallet_code]);
        if (p) {
          log.product_name = p.product_name;
        }
      }
    }
    console.log("SUCCESS!");
    console.log(total, occupied);
  } catch (err) {
    console.error("ERROR!");
    console.error(err);
  } finally {
    process.exit();
  }
}
test();
