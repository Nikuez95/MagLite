const { hasPermission, canAccessCustomer } = require('../utils/permissions');
const db = require('../config/db');

async function billingRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('preHandler', async (request, reply) => {
    const isRead = request.method === 'GET' || request.url.includes('/calculate');
    if (isRead) {
      if (!hasPermission(request.user, 'view_billing') && !hasPermission(request.user, 'finance_manage')) {
        return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di accedere al modulo Amministrazione/Fatturazione.' });
      }
    } else {
      if (!hasPermission(request.user, 'finance_manage')) {
        return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di modificare regole o listini di fatturazione.' });
      }
    }
  });

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

  // GET Tariffs (supporta ereditarietà da Cliente Madre se la frammentazione non ha ancora sovrascritto una voce)
  fastify.get('/tariffs/:clientId', async (request, reply) => {
    const { clientId } = request.params;
    try {
      const [[cust]] = await db.query('SELECT id, parent_id FROM CUSTOMERS WHERE id = ?', [clientId]);
      const parentId = cust?.parent_id || null;

      const [rows] = await db.query(`
        SELECT 
          br.rule_code, 
          br.description, 
          br.default_price, 
          br.rule_type,
          ct.custom_price,
          pct.custom_price as parent_custom_price
        FROM billing_rules br
        LEFT JOIN client_tariffs ct ON br.rule_code = ct.rule_code AND ct.customer_id = ?
        LEFT JOIN client_tariffs pct ON br.rule_code = pct.rule_code AND pct.customer_id = ?
        ORDER BY br.rule_type, br.rule_code
      `, [clientId, parentId]);

      return rows.map(r => {
        const effective = r.custom_price !== null && r.custom_price !== undefined
          ? parseFloat(r.custom_price)
          : (r.parent_custom_price !== null && r.parent_custom_price !== undefined
              ? parseFloat(r.parent_custom_price)
              : parseFloat(r.default_price));
        return {
          ...r,
          final_price: effective
        };
      });
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

  // GET /api/billing/pallet/:code/history - Dettaglio completo e storico a 360° di una paletta (per pop-up in Pre-Fatturazione)
  fastify.get('/pallet/:code/history', async (request, reply) => {
    const { code } = request.params;
    try {
      const [palletRows] = await db.query(`
        SELECT p.*,
               pr.name AS product_name,
               pr.sku AS product_sku,
               pr.uom AS product_uom,
               COALESCE(p.units_per_box, pr.units_per_box, 1) AS effective_units_per_box,
               COALESCE(pr.boxes_per_pallet, 1) AS effective_boxes_per_pallet,
               c.business_name AS customer_name,
               c.unique_id AS customer_unique_id,
               pc.business_name AS parent_customer_name,
               d.ddt_number AS inbound_ddt_number,
               d.status AS inbound_ddt_status,
               d.created_at AS inbound_ddt_created_at,
               d.closed_at AS inbound_ddt_closed_at,
               d.discrepancy_reason,
               d.discrepancy_resolved_by
        FROM PALLETS p
        LEFT JOIN PRODUCTS pr ON p.product_id = pr.id
        LEFT JOIN CUSTOMERS c ON p.customer_id = c.id
        LEFT JOIN CUSTOMERS pc ON c.parent_id = pc.id
        LEFT JOIN INBOUND_DDTS d ON p.inbound_ddt_id = d.id
        WHERE p.pallet_code = ?
        ORDER BY p.id ASC
      `, [code]);

      if (palletRows.length === 0) {
        return reply.code(404).send({ error: 'Paletta non trovata' });
      }

      const palletIds = palletRows.map(r => r.id);

      const [outboundPicks] = await db.query(`
        SELECT oi.*,
               o.order_code,
               o.client_ddt,
               o.notes AS order_notes,
               o.exit_date,
               o.status AS order_status,
               o.picking_operator,
               o.start_picking_at,
               o.end_picking_at,
               o.shipped_at,
               o.shipped_by,
               o.created_by,
               o.created_at AS order_created_at,
               pr.name AS product_name,
               pr.sku AS product_sku
        FROM OUTBOUND_ITEMS oi
        JOIN OUTBOUND_ORDERS o ON oi.order_id = o.id
        LEFT JOIN PRODUCTS pr ON oi.product_id = pr.id
        WHERE oi.pallet_code = ? OR oi.pallet_id IN (?)
        ORDER BY COALESCE(oi.picked_at, o.shipped_at, o.created_at) DESC
      `, [code, palletIds]);

      const [auditLogs] = await db.query(`
        SELECT * FROM AUDIT_LOGS
        WHERE details LIKE ?
        ORDER BY created_at DESC
        LIMIT 150
      `, [`%${code}%`]);

      return {
        pallet_code: code,
        rows: palletRows,
        outboundPicks,
        auditLogs
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore caricamento storico paletta' });
    }
  });

  // POST Calculate (Supporta Pre-Fatturazione per Deposito + Suddivisione per Frammentazioni + Dettaglio Completo Articolo/Lotto/Rif/Note/Prezzo)
  fastify.post('/calculate', async (request, reply) => {
    const {
      clientId,
      month,
      year,
      includeHistorical = true,
      includeDeposit = true,
      includeStorage = true
    } = request.body;
    
    if (!clientId || !month || !year) {
      return reply.code(400).send({ error: 'Client, mese e anno richiesti' });
    }

    try {
      // 1. Recupero il cliente selezionato e le sue eventuali frammentazioni
      const [[mainCustomer]] = await db.query(
        `SELECT c.*, p.business_name as parent_business_name
         FROM CUSTOMERS c
         LEFT JOIN CUSTOMERS p ON c.parent_id = p.id
         WHERE c.id = ?`,
        [clientId]
      );

      if (!mainCustomer) {
        return reply.code(404).send({ error: 'Cliente non trovato' });
      }

      const [childFragments] = await db.query(
        'SELECT * FROM CUSTOMERS WHERE parent_id = ? ORDER BY business_name ASC',
        [clientId]
      );

      const entitiesToProcess = [mainCustomer, ...childFragments];
      const hasFragments = childFragments.length > 0;

      // Calcolo date del mese selezionato
      const startDate = new Date(year, month - 1, 1, 0, 0, 0);
      const endDate = new Date(year, month, 0, 23, 59, 59);

      const formatDateIT = (d) => {
        if (!d) return '';
        const dt = new Date(d);
        return dt.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
      };

      const allItems = [];
      const allPalletDetails = [];
      const sections = [];
      let grandBaseTotal = 0;

      for (const entity of entitiesToProcess) {
        // Carico il listino specifico di questa entità (frammentazione o cliente madre)
        const [tariffRows] = await db.query(`
          SELECT 
            br.rule_code, 
            br.description, 
            br.rule_type, 
            COALESCE(ct.custom_price, pct.custom_price, br.default_price) as price
          FROM billing_rules br
          LEFT JOIN client_tariffs ct ON br.rule_code = ct.rule_code AND ct.customer_id = ?
          LEFT JOIN client_tariffs pct ON br.rule_code = pct.rule_code AND pct.customer_id = ?
        `, [entity.id, entity.parent_id || null]);

        const tariffs = {};
        tariffRows.forEach(t => {
          tariffs[t.rule_code] = { price: parseFloat(t.price) || 0, desc: t.description };
        });

        if (!tariffs['DEPOSITO_PALLET']) {
          tariffs['DEPOSITO_PALLET'] = {
            price: tariffs['SOSTA_15']?.price || 10.0,
            desc: 'Deposito Paletta (Giacenza Rimasta)'
          };
        }

        // Trovo le palette di questa specifica entità con tutti i dettagli prodotto, codice articolo, lotto, rif. paletta cliente, note e quantità storica se spedita
        const [pallets] = await db.query(`
          SELECT p.id, p.pallet_code,
                 p.client_pallet_number AS customer_pallet_ref,
                 p.client_pallet_number,
                 COALESCE(NULLIF(p.client_article_number, ''), pr.sku) AS sku,
                 p.created_at,
                 COALESCE(p.shipped_at, IF(p.status = 'SHIPPED', p.created_at, NULL)) as shipped_at,
                 p.flags,
                 p.quantity AS current_quantity,
                 COALESCE(
                   NULLIF(p.quantity, 0),
                   (SELECT SUM(COALESCE(NULLIF(oi.quantity_picked, 0), oi.quantity_required))
                    FROM OUTBOUND_ITEMS oi
                    WHERE oi.pallet_id = p.id OR (oi.pallet_id IS NULL AND oi.pallet_code = p.pallet_code AND oi.product_id = p.product_id)),
                   p.quantity
                 ) AS effective_quantity,
                 COALESCE(p.pallet_uom, pr.uom, 'Pezzi') AS pallet_uom,
                 p.batch,
                 p.notes,
                 p.location,
                 p.warehouse,
                 p.expiration_date,
                 p.status,
                 pr.name as product_name,
                 pr.id as product_id,
                 d.ddt_number as inbound_ddt_number
          FROM PALLETS p
          LEFT JOIN PRODUCTS pr ON p.product_id = pr.id
          LEFT JOIN INBOUND_DDTS d ON p.inbound_ddt_id = d.id
          WHERE p.customer_id = ? 
          AND p.created_at <= ? 
          AND (
            COALESCE(p.shipped_at, IF(p.status = 'SHIPPED', p.created_at, NULL)) IS NULL
            OR COALESCE(p.shipped_at, IF(p.status = 'SHIPPED', p.created_at, NULL)) >= ?
          )
          AND (
            p.inbound_ddt_id IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM INBOUND_DDTS d2 WHERE d2.id = p.inbound_ddt_id AND d2.status != 'COMPLETED'
            )
          )
          ORDER BY p.created_at ASC, p.pallet_code ASC
        `, [entity.id, endDate, startDate]);

        const sectionItems = [];
        const sectionPallets = [];
        let sectionTotal = 0;

        const inboundByDayAndTag = new Map();
        const outboundByDayAndTag = new Map();
        const depositByTag = new Map();

        const addSectionCost = (group, code, desc, qty, palletSummaryObj, priceOverride) => {
          const price = priceOverride !== undefined ? priceOverride : (tariffs[code]?.price || 0);
          if (price === 0) return 0;
          const existing = sectionItems.find(i => i.code === code && i.price === price);
          if (existing) {
            existing.qty += qty;
            existing.subtotal += (qty * price);
            if (palletSummaryObj && !existing.palletCodes.includes(palletSummaryObj.pallet_code)) {
              existing.palletCodes.push(palletSummaryObj.pallet_code);
              existing.palletsList.push(palletSummaryObj);
            }
          } else {
            sectionItems.push({
              id: Math.random().toString(36).substring(2, 9),
              sectionId: entity.id,
              sectionName: entity.business_name,
              isParent: !entity.parent_id,
              group,
              code,
              description: desc || tariffs[code]?.desc || code,
              palletCodes: palletSummaryObj ? [palletSummaryObj.pallet_code] : [],
              palletsList: palletSummaryObj ? [palletSummaryObj] : [],
              qty,
              price,
              subtotal: qty * price
            });
          }
          sectionTotal += (qty * price);
          return qty * price;
        };

        // Raggruppo per pallet_code per evitare sovrafatturazione sulle palette miste
        const groupedPalletsMap = new Map();
        pallets.forEach(p => {
          const code = p.pallet_code;
          if (!groupedPalletsMap.has(code)) {
            groupedPalletsMap.set(code, []);
          }
          groupedPalletsMap.get(code).push(p);
        });

        groupedPalletsMap.forEach((rows, code) => {
          const createdTimes = rows.map(r => new Date(r.created_at).getTime()).filter(t => !isNaN(t));
          const inDate = createdTimes.length > 0 ? new Date(Math.min(...createdTimes)) : new Date(rows[0].created_at);

          const allShipped = rows.every(r => Boolean(r.shipped_at));
          const shippedTimes = allShipped ? rows.map(r => new Date(r.shipped_at).getTime()).filter(t => !isNaN(t)) : [];
          const outDate = (allShipped && shippedTimes.length > 0) ? new Date(Math.max(...shippedTimes)) : null;

          const uniqueFlagsSet = new Set();
          rows.forEach(r => {
            let parsed = [];
            try {
              parsed = r.flags ? (typeof r.flags === 'string' ? JSON.parse(r.flags) : r.flags) : [];
            } catch (e) {
              parsed = [];
            }
            if (Array.isArray(parsed)) {
              parsed.forEach(f => {
                if (f) uniqueFlagsSet.add(String(f).trim().toUpperCase());
              });
            }
          });
          const uniqueFlags = Array.from(uniqueFlagsSet);
          const tagLabel = uniqueFlags.length > 0 ? uniqueFlags.join(', ') : '';

          const custRef = rows.find(r => r.client_pallet_number)?.client_pallet_number || null;
          const uniqueSkus = [...new Set(rows.map(r => r.sku).filter(Boolean))];
          const uniqueProducts = [...new Set(rows.map(r => r.product_name).filter(Boolean))];
          const uniqueBatches = [...new Set(rows.map(r => r.batch).filter(Boolean))];
          const uniqueNotes = [...new Set(rows.map(r => r.notes && String(r.notes).trim()).filter(Boolean))];
          const totalQty = rows.reduce((sum, r) => sum + (parseFloat(r.effective_quantity) || 0), 0);
          const uniqueUoms = [...new Set(rows.map(r => r.pallet_uom || 'Pezzi'))];

          const skuStr = uniqueSkus.join(', ') || '-';
          const prodNameStr = rows.length === 1
            ? (rows[0].product_name || 'Articolo')
            : (uniqueProducts.length > 1
                ? `Paletta Mista (${uniqueProducts.join(' + ')})`
                : `${uniqueProducts[0] || 'Articolo'} (${rows.length} lotti)`);
          const batchStr = uniqueBatches.join(', ') || '-';
          const uomStr = uniqueUoms.join('/');
          const notesStr = uniqueNotes.join(' | ') || '';

          // Etichetta parlante e comprensibile per l'operatore (Nome Prodotto + Lotto + eventuale Rif. Paletta Cliente)
          const humanLabel = `${prodNameStr}${batchStr !== '-' ? ` (Lotto: ${batchStr})` : ''}${custRef ? ` • Rif.Pal: ${custRef}` : ''}`;

          const isEnteredInMonth = inDate >= startDate && inDate <= endDate;
          const isExitedInMonth = Boolean(outDate && outDate >= startDate && outDate <= endDate);
          const isRemainingInDeposit = !outDate || outDate > endDate;

          const isHistoricalPallet = inDate < startDate;
          if (isHistoricalPallet && !isExitedInMonth && !includeHistorical) {
            return;
          }

          const palletCharges = [];
          let palletTotalPrice = 0;

          const palletSummaryObj = {
            pallet_code: code,
            humanLabel,
            sku: skuStr,
            product_name: prodNameStr,
            batch: batchStr,
            quantity: totalQty,
            pallet_uom: uomStr,
            customer_pallet_ref: custRef,
            notes: notesStr
          };

          // 1. INBOUND
          if (isEnteredInMonth) {
            const c = addSectionCost('EVENTI', 'IN_PALLET', tariffs['IN_PALLET']?.desc || 'Ingresso Paletta (IN)', 1, palletSummaryObj);
            if (c > 0) {
              palletCharges.push({ code: 'IN_PALLET', label: `Ingresso (${formatDateIT(inDate)})`, price: c });
              palletTotalPrice += c;
            }
            const dateStr = formatDateIT(inDate);
            const key = `${dateStr}||${tagLabel}`;
            if (!inboundByDayAndTag.has(key)) inboundByDayAndTag.set(key, { dateStr, tagLabel, pallets: [] });
            inboundByDayAndTag.get(key).pallets.push(palletSummaryObj);
          }

          // 2. OUTBOUND
          if (isExitedInMonth) {
            const c = addSectionCost('EVENTI', 'OUT_PALLET', tariffs['OUT_PALLET']?.desc || 'Uscita Paletta (OUT)', 1, palletSummaryObj);
            if (c > 0) {
              palletCharges.push({ code: 'OUT_PALLET', label: `Uscita (${formatDateIT(outDate)})`, price: c });
              palletTotalPrice += c;
            }
            const dateStr = formatDateIT(outDate);
            const key = `${dateStr}||${tagLabel}`;
            if (!outboundByDayAndTag.has(key)) outboundByDayAndTag.set(key, { dateStr, tagLabel, pallets: [] });
            outboundByDayAndTag.get(key).pallets.push(palletSummaryObj);
          }

          // 3. STORAGE (Sosta Quindicina)
          if (includeStorage && inDate <= endDate && (!outDate || outDate >= startDate)) {
            if (inDate < startDate) {
              if (includeHistorical) {
                const c = addSectionCost('GIACENZA', 'SOSTA_15', tariffs['SOSTA_15']?.desc, 1, palletSummaryObj);
                if (c > 0) {
                  palletCharges.push({ code: 'SOSTA_15', label: tariffs['SOSTA_15']?.desc || 'Sosta', price: c });
                  palletTotalPrice += c;
                }
              }
            } else {
              if (inDate.getDate() <= 15) {
                const c = addSectionCost('GIACENZA', 'SOSTA_15', tariffs['SOSTA_15']?.desc, 1, palletSummaryObj);
                if (c > 0) {
                  palletCharges.push({ code: 'SOSTA_15', label: tariffs['SOSTA_15']?.desc || 'Sosta <=15gg', price: c });
                  palletTotalPrice += c;
                }
              } else {
                const c = addSectionCost('GIACENZA', 'SOSTA_MAGGIORE_15', tariffs['SOSTA_MAGGIORE_15']?.desc, 1, palletSummaryObj);
                if (c > 0) {
                  palletCharges.push({ code: 'SOSTA_MAGGIORE_15', label: tariffs['SOSTA_MAGGIORE_15']?.desc || 'Sosta >15gg', price: c });
                  palletTotalPrice += c;
                }
              }
            }
          }

          // 4. PRE-FATTURAZIONE PER DEPOSITO (Tutte le palette rimaste in deposito)
          if (isRemainingInDeposit) {
            const key = tagLabel || 'NO_TAG';
            if (!depositByTag.has(key)) depositByTag.set(key, { tagLabel, pallets: [] });
            depositByTag.get(key).pallets.push(palletSummaryObj);

            if (includeDeposit) {
              const c = addSectionCost(
                'DEPOSITO',
                'DEPOSITO_PALLET',
                tariffs['DEPOSITO_PALLET']?.desc || 'Deposito Paletta (Giacenza Rimasta)',
                1,
                palletSummaryObj
              );
              if (c > 0) {
                palletCharges.push({ code: 'DEPOSITO_PALLET', label: 'In Deposito', price: c });
                palletTotalPrice += c;
              }
            }
          }

          // 5. FLAGS (EXTRA es. ADR, FRIGO, ecc.)
          uniqueFlags.forEach(f => {
            const ruleCode = `FLAG_${f.toUpperCase()}`;
            if (tariffs[ruleCode]) {
              const c = addSectionCost('SERVIZI EXTRA', ruleCode, tariffs[ruleCode].desc, 1, palletSummaryObj);
              if (c > 0) {
                palletCharges.push({ code: ruleCode, label: `Tag ${f.toUpperCase()}`, price: c });
                palletTotalPrice += c;
              }
            }
          });

          palletSummaryObj.totalPrice = palletTotalPrice;
          palletSummaryObj.charges = palletCharges;

          const movementParts = [];
          if (isEnteredInMonth) movementParts.push(`Entrata ${formatDateIT(inDate)}`);
          if (isExitedInMonth) movementParts.push(`Uscita ${formatDateIT(outDate)}`);
          if (isRemainingInDeposit) movementParts.push('In Deposito');
          if (tagLabel) movementParts.push(`Tag: ${tagLabel}`);

          const palletRecord = {
            pallet_code: code,
            humanLabel,
            sku: skuStr,
            customer_pallet_ref: custRef,
            sectionId: entity.id,
            sectionName: entity.business_name,
            product_name: prodNameStr,
            quantity: totalQty,
            pallet_uom: uomStr,
            batch: batchStr,
            notes: notesStr,
            location: rows[0].location || null,
            warehouse: rows[0].warehouse || 'Settala',
            expiration_date: rows[0].expiration_date || null,
            inbound_ddt_number: rows[0].inbound_ddt_number || null,
            created_at: inDate,
            shipped_at: outDate,
            in_deposit: isRemainingInDeposit,
            flags: uniqueFlags.length > 0 ? JSON.stringify(uniqueFlags) : null,
            tagLabel,
            movementSummary: movementParts.join(' • '),
            charges: palletCharges,
            totalPrice: palletTotalPrice
          };

          sectionPallets.push(palletRecord);
          allPalletDetails.push(palletRecord);
        });

        // Costruzione delle righe descrittive parlanti per questa Frammentazione / Cliente
        // Ogni riga contiene sia il testo sia l'array strutturato `pallets` (cliccabili nel frontend!)
        const descriptiveLines = [];

        outboundByDayAndTag.forEach(({ dateStr, tagLabel, pallets: pList }) => {
          const count = pList.length;
          const noun = count === 1 ? 'Paletta' : 'Palette';
          const verb = count === 1 ? 'andata via' : 'andate via';
          const tagPart = tagLabel ? ` con tag ${tagLabel}` : '';
          const namesStr = pList.map(p => p.humanLabel).join('; ');
          descriptiveLines.push({
            type: 'OUT',
            count,
            pallets: pList,
            date: dateStr,
            tags: tagLabel,
            headerText: `${count} - ${noun} ${verb}${tagPart} il giorno ${dateStr}:`,
            text: `${count} - ${noun} (${namesStr}) ${verb}${tagPart} il giorno ${dateStr}`
          });
        });

        inboundByDayAndTag.forEach(({ dateStr, tagLabel, pallets: pList }) => {
          const count = pList.length;
          const noun = count === 1 ? 'Paletta' : 'Palette';
          const verb = count === 1 ? 'entrata' : 'entrate';
          const tagPart = tagLabel ? ` con tag ${tagLabel}` : '';
          const namesStr = pList.map(p => p.humanLabel).join('; ');
          descriptiveLines.push({
            type: 'IN',
            count,
            pallets: pList,
            date: dateStr,
            tags: tagLabel,
            headerText: `${count} - ${noun} ${verb}${tagPart} il giorno ${dateStr}:`,
            text: `${count} - ${noun} (${namesStr}) ${verb}${tagPart} il giorno ${dateStr}`
          });
        });

        depositByTag.forEach(({ tagLabel, pallets: pList }) => {
          const count = pList.length;
          const noun = count === 1 ? 'Paletta' : 'Palette';
          const tagPart = tagLabel ? ` con tag ${tagLabel}` : '';
          const namesStr = pList.map(p => p.humanLabel).join('; ');
          descriptiveLines.push({
            type: 'DEPOSIT',
            count,
            pallets: pList,
            tags: tagLabel,
            headerText: `${count} - ${noun}${tagPart} in deposito:`,
            text: `${count} - ${noun} (${namesStr})${tagPart} in deposito`
          });
        });

        if (!hasFragments || entity.parent_id || sectionPallets.length > 0 || sectionItems.length > 0) {
          sections.push({
            sectionId: entity.id,
            sectionName: entity.business_name,
            uniqueId: entity.unique_id,
            isParent: !entity.parent_id,
            tariffsSummary: {
              inPallet: tariffs['IN_PALLET']?.price || 0,
              outPallet: tariffs['OUT_PALLET']?.price || 0,
              depositPallet: tariffs['DEPOSITO_PALLET']?.price || 0,
              sosta15: tariffs['SOSTA_15']?.price || 0
            },
            descriptiveLines,
            pallets: sectionPallets,
            items: sectionItems,
            palletsCount: sectionPallets.length,
            depositCount: sectionPallets.filter(p => p.in_deposit).length,
            sectionTotal
          });
        }

        sectionItems.forEach(item => allItems.push(item));
        grandBaseTotal += sectionTotal;
      }

      return {
        clientId: mainCustomer.id,
        clientName: mainCustomer.business_name,
        hasFragments,
        fragmentsCount: childFragments.length,
        period: `${month.toString().padStart(2, '0')}/${year}`,
        sections,
        items: allItems,
        palletDetails: allPalletDetails,
        total: grandBaseTotal
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante il calcolo della pre-fattura' });
    }
  });
}

module.exports = billingRoutes;
