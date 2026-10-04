const fs = require('fs');
let code = fs.readFileSync('backend/src/routes/pallets.js', 'utf8');

const mergeRoute = `
  // Unisci paletta a un'altra (Frammenta)
  fastify.post('/merge', async (request, reply) => {
    const { source_code, target_code } = request.body;
    if (!source_code || !target_code) return reply.code(400).send({ error: 'Codici mancanti' });
    if (source_code === target_code) return reply.code(400).send({ error: 'I codici sono identici' });
    
    try {
      const [rows] = await db.query('SELECT id FROM PALLETS WHERE pallet_code = ?', [target_code]);
      if (rows.length === 0) return reply.code(404).send({ error: 'Paletta di destinazione non trovata' });
      
      await db.query('UPDATE PALLETS SET pallet_code = ? WHERE pallet_code = ?', [target_code, source_code]);
      
      await db.query('INSERT INTO HISTORY (pallet_code, action, source, note) VALUES (?, ?, ?, ?)', [
        target_code, 'MERGE', 'Gestionale', \`Paletta \${source_code} frammentata e unita a questa.\`
      ]);
      
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore unione palette' });
    }
  });
  
  fastify.post('/stow',`;

code = code.replace("  fastify.post('/stow',", mergeRoute);
fs.writeFileSync('backend/src/routes/pallets.js', code);
console.log(code.includes('/merge') ? 'Route added' : 'Route failed');
