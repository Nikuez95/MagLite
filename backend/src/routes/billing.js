const db = require('../config/db');

async function billingRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  
  // GET Rules
  fastify.get('/rules', async (request, reply) => {
    try {
      const [rows] = await db.query('SELECT * FROM billing_rules ORDER BY rule_type, rule_code');
      return rows;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore fetch regole' });
    }
  });

  // POST Rule
  fastify.post('/rules', async (request, reply) => {
    const { rule_code, description, default_price, rule_type } = request.body;
    try {
      const [result] = await db.query(
        'INSERT INTO billing_rules (rule_code, description, default_price, rule_type) VALUES (?, ?, ?, ?)',
        [rule_code, description, default_price || 0, rule_type]
      );
      return { success: true, id: result.insertId };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore creazione regola, forse il codice esiste già?' });
    }
  });

  // PUT Rule
  fastify.put('/rules/:id', async (request, reply) => {
    const { description, default_price, rule_type } = request.body;
    try {
      await db.query(
        'UPDATE billing_rules SET description = ?, default_price = ?, rule_type = ? WHERE id = ?',
        [description, default_price, rule_type, request.params.id]
      );
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore modifica regola' });
    }
  });

  // DELETE Rule
  fastify.delete('/rules/:id', async (request, reply) => {
    try {
      await db.query('DELETE FROM billing_rules WHERE id = ?', [request.params.id]);
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore eliminazione regola (forse in uso da client_tariffs?)' });
    }
  });


  // GET Tariffs
  fastify.get('/tariffs/:clientId', async (request, reply) => {
    const { clientId } = request.params;
    try {
      const [rows] = await db.query(`
        SELECT 
          br.rule_code, 
          br.description, 
          br.default_price, 
          br.rule_type,
          ct.custom_price 
        FROM billing_rules br
        LEFT JOIN client_tariffs ct ON br.rule_code = ct.rule_code AND ct.customer_id = ?
        ORDER BY br.rule_type, br.rule_code
      `, [clientId]);
      return rows.map(r => ({
        ...r,
        final_price: r.custom_price !== null ? parseFloat(r.custom_price) : parseFloat(r.default_price)
      }));
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore fetch tariffe' });
    }
  });

  // POST Tariffs (Upsert)
  fastify.post('/tariffs/:clientId', async (request, reply) => {
    const { clientId } = request.params;
    const { tariffs } = request.body; // [{ rule_code, custom_price }]
    
    if (!tariffs || !Array.isArray(tariffs)) {
      return reply.code(400).send({ error: 'Formato tariffe non valido' });
    }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      for (const t of tariffs) {
        await conn.query(`
          INSERT INTO client_tariffs (customer_id, rule_code, custom_price) 
          VALUES (?, ?, ?)
          ON DUPLICATE KEY UPDATE custom_price = ?
        `, [clientId, t.rule_code, t.custom_price, t.custom_price]);
      }
      await conn.commit();
      return { success: true };
    } catch (err) {
      await conn.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore salvataggio tariffe' });
    } finally {
      conn.release();
    }
  });

  // POST Calculate
  fastify.post('/calculate', async (request, reply) => {
    const { clientId, month, year, includeHistorical = true } = request.body;
    
    if (!clientId || !month || !year) {
      return reply.code(400).send({ error: 'Client, mese e anno richiesti' });
    }

    try {
      // Carico listino finale del cliente
      const [tariffRows] = await db.query(`
        SELECT br.rule_code, br.description, br.rule_type, COALESCE(ct.custom_price, br.default_price) as price
        FROM billing_rules br
        LEFT JOIN client_tariffs ct ON br.rule_code = ct.rule_code AND ct.customer_id = ?
      `, [clientId]);
      
      const tariffs = {};
      tariffRows.forEach(t => {
        tariffs[t.rule_code] = { price: parseFloat(t.price), desc: t.description };
      });

      // Calcolo date del mese selezionato
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59);

      // Trovo le palette entrate, uscite e giacenti
      // IN: created_at nel mese.
      // OUT: shipped_at nel mese.
      // STORAGE: created_at <= endDate AND (shipped_at IS NULL OR shipped_at >= startDate)
      
      const [pallets] = await db.query(`
        SELECT p.pallet_code, p.created_at, p.shipped_at, p.flags, p.quantity, p.pallet_uom, p.batch, pr.name as product_name
        FROM PALLETS p
        LEFT JOIN PRODUCTS pr ON p.product_id = pr.id
        WHERE p.customer_id = ? 
        AND p.created_at <= ? 
        AND (p.shipped_at IS NULL OR p.shipped_at >= ?)
      `, [clientId, endDate, startDate]);

      const items = [];
      const palletDetails = [];
      let total = 0;

      const addCost = (group, code, desc, qty, priceOverride) => {
        const price = priceOverride !== undefined ? priceOverride : (tariffs[code]?.price || 0);
        if (price === 0) return;
        const existing = items.find(i => i.code === code && i.price === price);
        if (existing) {
          existing.qty += qty;
          existing.subtotal += (qty * price);
        } else {
          items.push({ id: Math.random().toString(36).substring(7), group, code, description: desc || tariffs[code]?.desc || code, qty, price, subtotal: qty * price });
        }
        total += (qty * price);
      };

      pallets.forEach(p => {
        palletDetails.push({
          pallet_code: p.pallet_code,
          product_name: p.product_name,
          quantity: p.quantity,
          pallet_uom: p.pallet_uom || 'Pezzi',
          batch: p.batch,
          created_at: p.created_at,
          shipped_at: p.shipped_at,
          flags: p.flags
        });
        const inDate = new Date(p.created_at);
        const outDate = p.shipped_at ? new Date(p.shipped_at) : null;
        
        // 1. INBOUND
        if (inDate >= startDate && inDate <= endDate) {
          addCost('EVENTI', 'IN_PALLET', tariffs['IN_PALLET']?.desc, 1);
        }
        
        // 2. OUTBOUND
        if (outDate && outDate >= startDate && outDate <= endDate) {
          addCost('EVENTI', 'OUT_PALLET', tariffs['OUT_PALLET']?.desc, 1);
        }

        // 3. STORAGE (Regola Quindicina)
        if (inDate <= endDate && (!outDate || outDate >= startDate)) {
          // Se la paletta è entrata PRIMA di questo mese, si conta per intero.
          if (inDate < startDate) {
            if (includeHistorical) {
              addCost('GIACENZA', 'SOSTA_15', tariffs['SOSTA_15']?.desc, 1);
            }
          } else {
            // Se è entrata in QUESTO mese
            if (inDate.getDate() <= 15) {
              addCost('GIACENZA', 'SOSTA_15', tariffs['SOSTA_15']?.desc, 1);
            } else {
              addCost('GIACENZA', 'SOSTA_MAGGIORE_15', tariffs['SOSTA_MAGGIORE_15']?.desc, 1);
            }
          }
        }

        // 4. FLAGS (EXTRA)
        const flags = p.flags ? (typeof p.flags === 'string' ? JSON.parse(p.flags) : p.flags) : [];
        if (Array.isArray(flags)) {
          flags.forEach(f => {
            const ruleCode = `FLAG_${f.toUpperCase()}`;
            // Usa il prezzo da tariffe se esiste
            if (tariffs[ruleCode]) {
              // I flag vengono addebitati solo per le palette a giacenza o eventi in quel mese
              // Se la paletta è movimentata o stoccata, paga l'extra.
              addCost('SERVIZI EXTRA', ruleCode, tariffs[ruleCode].desc, 1);
            }
          });
        }
      });

      // Raggruppo per risposta
      
      // Aggiungo anche eventuali sconti automatici se presenti in client_tariffs
      // ma il calcolo di sconti lo farà dinamicamente il Frontend con le regole manuali e sconti selezionati dall'utente.
      
      return {
        clientId,
        period: `${month.toString().padStart(2, '0')}/${year}`,
        items: items.sort((a, b) => a.group.localeCompare(b.group)),
        palletDetails,
        total
      };

    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante il calcolo' });
    }
  });
}

module.exports = billingRoutes;
