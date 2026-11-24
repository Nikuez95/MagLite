const db = require('../config/db');
const { hasPermission, canAccessCustomer } = require('../utils/permissions');
const { logBillingAudit } = require('../utils/billingAudit');

async function financesRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  // --- INVOICES (PROFORME SALVATE) ---
  
  fastify.post('/invoices', async (request, reply) => {
    if (
      !hasPermission(request.user, 'finance_manage') &&
      !hasPermission(request.user, 'view_billing') &&
      !hasPermission(request.user, 'view_finances')
    ) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di emettere o salvare proforme.' });
    }

    const { customer_id, period_month, period_year, base_total, vat_amount, grand_total, invoice_data } = request.body || {};
    const custIdNum = parseInt(customer_id, 10);
    const monthNum = parseInt(period_month, 10);
    const yearNum = parseInt(period_year, 10);

    if (!custIdNum || !monthNum || !yearNum) {
      return reply.code(400).send({ error: 'Cliente, mese e anno sono obbligatori per salvare la proforma.' });
    }
    if (!canAccessCustomer(request.user, custIdNum)) {
      return reply.code(403).send({ error: 'Accesso negato: cliente limitato per il tuo profilo.' });
    }

    const baseVal = Number.isFinite(Number(base_total)) ? Number(base_total) : 0;
    const vatVal = Number.isFinite(Number(vat_amount)) ? Number(vat_amount) : 0;
    const grandVal = Number.isFinite(Number(grand_total)) ? Number(grand_total) : 0;

    try {
      const [res] = await db.query(`
        INSERT INTO invoices (customer_id, period_month, period_year, base_total, vat_amount, grand_total, invoice_data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [custIdNum, monthNum, yearNum, baseVal, vatVal, grandVal, invoice_data ? JSON.stringify(invoice_data) : null]);
      
      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['SAVE_INVOICE', `Salvata proforma #${res.insertId} per cliente ID: ${custIdNum}, Periodo: ${monthNum}/${yearNum}`, 'Gestionale Finanza', request.user.username]
      );

      const discountCount = Array.isArray(invoice_data?.customAdjustments)
        ? invoice_data.customAdjustments.filter(a => Number(a.price) < 0 || String(a.type || '').includes('DISCOUNT')).length
        : 0;
      await logBillingAudit(db, {
        action: 'CREATE_PROFORMA',
        customer_id: custIdNum,
        customer_name: invoice_data?.clientName || null,
        entity_ref: `PROFORMA-#${res.insertId} (${String(monthNum).padStart(2, '0')}/${yearNum})`,
        details: `Emessa proforma #${res.insertId} (${String(monthNum).padStart(2, '0')}/${yearNum}) — Imponibile: €${baseVal.toFixed(2)}, IVA: €${vatVal.toFixed(2)}, Totale: €${grandVal.toFixed(2)}${discountCount > 0 ? ` • ${discountCount} sconti/rettifiche` : ''}`,
        metadata: { invoice_id: res.insertId, period_month: monthNum, period_year: yearNum, base_total: baseVal, vat_amount: vatVal, grand_total: grandVal },
        username: request.user.username,
        source: 'Pre-Fatturazione'
      });

      if (fastify.io) {
        fastify.io.emit('finances_updated');
        fastify.io.emit('dashboard_update');
      }

      return { success: true, id: res.insertId };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore salvataggio fattura' });
    }
  });

  fastify.get('/invoices', async (request, reply) => {
    if (
      !hasPermission(request.user, 'view_finances') &&
      !hasPermission(request.user, 'finance_manage') &&
      !hasPermission(request.user, 'view_billing')
    ) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di visualizzare le proforme.' });
    }

    try {
      const [rows] = await db.query(`
        SELECT i.id, i.customer_id, i.period_month, i.period_year, i.base_total, i.vat_amount, i.grand_total,
               IF(i.invoice_data IS NOT NULL, 1, 0) AS has_invoice_data, i.is_paid, i.created_at,
               c.business_name, c.address, c.vat_number, c.unique_id, c.parent_id,
               p.business_name AS parent_business_name
        FROM invoices i
        JOIN CUSTOMERS c ON i.customer_id = c.id
        LEFT JOIN CUSTOMERS p ON c.parent_id = p.id
        ORDER BY i.created_at DESC, i.period_year DESC, i.period_month DESC, i.id DESC
      `);
      return rows.filter(r => canAccessCustomer(request.user, r.customer_id));
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore fetch fatture' });
    }
  });

  fastify.get('/invoices/:id', async (request, reply) => {
    if (
      !hasPermission(request.user, 'view_finances') &&
      !hasPermission(request.user, 'finance_manage') &&
      !hasPermission(request.user, 'view_billing')
    ) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di visualizzare la proforma.' });
    }

    try {
      const [rows] = await db.query(`
        SELECT i.id, i.customer_id, i.period_month, i.period_year, i.base_total, i.vat_amount, i.grand_total,
               i.invoice_data, i.is_paid, i.created_at,
               c.business_name, c.address, c.vat_number, c.unique_id, c.parent_id,
               p.business_name AS parent_business_name
        FROM invoices i
        JOIN CUSTOMERS c ON i.customer_id = c.id
        LEFT JOIN CUSTOMERS p ON c.parent_id = p.id
        WHERE i.id = ?
      `, [request.params.id]);
      if (rows.length === 0) return reply.code(404).send({ error: 'Proforma non trovata' });
      if (!canAccessCustomer(request.user, rows[0].customer_id)) {
        return reply.code(403).send({ error: 'Accesso negato per questo cliente.' });
      }
      return rows[0];
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore caricamento dettaglio proforma' });
    }
  });

  fastify.delete('/invoices/:id', async (request, reply) => {
    if (!hasPermission(request.user, 'finance_manage')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di eliminare proforme.' });
    }

    try {
      const [[invRow]] = await db.query('SELECT id, customer_id, period_month, period_year, grand_total FROM invoices WHERE id = ?', [request.params.id]);
      await db.query('DELETE FROM invoices WHERE id = ?', [request.params.id]);
      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['DELETE_INVOICE', `Eliminata proforma ID: ${request.params.id}`, 'Gestionale Finanza', request.user.username]
      );
      await logBillingAudit(db, {
        action: 'DELETE_PROFORMA',
        customer_id: invRow?.customer_id || null,
        entity_ref: `PROFORMA-#${request.params.id}`,
        details: `Eliminata proforma #${request.params.id}${invRow ? ` (${invRow.period_month}/${invRow.period_year} • €${Number(invRow.grand_total || 0).toFixed(2)})` : ''}`,
        username: request.user.username,
        source: 'Archivio Proforme'
      });
      if (fastify.io) {
        fastify.io.emit('finances_updated');
        fastify.io.emit('dashboard_update');
      }
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore eliminazione proforma' });
    }
  });

  // --- EXPENSES (USCITE) ---
  
  fastify.put('/invoices/:id/payment', async (request, reply) => {
    if (!hasPermission(request.user, 'finance_manage')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di modificare lo stato pagamento.' });
    }

    try {
      const [rows] = await db.query('SELECT customer_id, period_month, period_year, grand_total, is_paid FROM invoices WHERE id = ?', [request.params.id]);
      if (rows.length === 0) return reply.code(404).send({ error: 'Fattura non trovata' });
      
      const newStatus = rows[0].is_paid ? 0 : 1;
      await db.query('UPDATE invoices SET is_paid = ? WHERE id = ?', [newStatus, request.params.id]);
      
      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['TOGGLE_PAYMENT', `Impostato stato ${newStatus ? 'PAGATO' : 'DA PAGARE'} su proforma ID: ${request.params.id}`, 'Gestionale Finanza', request.user.username]
      );
      await logBillingAudit(db, {
        action: 'PAYMENT_STATUS',
        customer_id: rows[0].customer_id,
        entity_ref: `PROFORMA-#${request.params.id}`,
        details: `Proforma #${request.params.id} (${rows[0].period_month}/${rows[0].period_year} • €${Number(rows[0].grand_total || 0).toFixed(2)}) contrassegnata come ${newStatus ? 'PAGATA' : 'DA PAGARE'}`,
        username: request.user.username,
        source: 'Finanza'
      });
      
      if (fastify.io) {
        fastify.io.emit('finances_updated');
        fastify.io.emit('dashboard_update');
      }
      return { success: true, is_paid: newStatus };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore aggiornamento stato pagamento' });
    }
  });

  fastify.get('/expenses', async (request, reply) => {
    if (!hasPermission(request.user, 'view_finances') && !hasPermission(request.user, 'finance_manage')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di visualizzare le uscite.' });
    }

    try {
      const [rows] = await db.query(
        'SELECT id, description, amount, expense_date, category, created_at FROM expenses ORDER BY expense_date DESC LIMIT 1000'
      );
      return rows;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore fetch uscite' });
    }
  });

  fastify.post('/expenses', async (request, reply) => {
    if (!hasPermission(request.user, 'finance_manage')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di registrare uscite.' });
    }

    const { description, amount, expense_date, category } = request.body;
    try {
      await db.query(`
        INSERT INTO expenses (description, amount, expense_date, category)
        VALUES (?, ?, ?, ?)
      `, [description, amount, expense_date, category || 'Generale']);
      
      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['CREATE_EXPENSE', `Registrata spesa: ${description} di EUR ${amount}`, 'Gestionale Finanza', request.user.username]
      );

      if (fastify.io) {
        fastify.io.emit('finances_updated');
        fastify.io.emit('dashboard_update');
      }

      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore salvataggio uscita' });
    }
  });

  fastify.delete('/expenses/:id', async (request, reply) => {
    if (!hasPermission(request.user, 'finance_manage')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di eliminare uscite.' });
    }

    try {
      await db.query('DELETE FROM expenses WHERE id = ?', [request.params.id]);
      
      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['DELETE_EXPENSE', `Eliminata spesa ID: ${request.params.id}`, 'Gestionale Finanza', request.user.username]
      );

      if (fastify.io) {
        fastify.io.emit('finances_updated');
        fastify.io.emit('dashboard_update');
      }

      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore eliminazione uscita' });
    }
  });

  // --- ANALYTICS & FORECAST ---

  fastify.get('/analytics', async (request, reply) => {
    if (!hasPermission(request.user, 'view_finances') && !hasPermission(request.user, 'finance_manage')) {
      return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di visualizzare la Dashboard Finanza.' });
    }

    try {
      const [incomes] = await db.query(`
        SELECT period_year as year, period_month as month, 
               SUM(CASE WHEN is_paid = TRUE THEN base_total ELSE 0 END) as total_income,
               SUM(CASE WHEN is_paid = FALSE THEN base_total ELSE 0 END) as unpaid_income
        FROM invoices
        GROUP BY period_year, period_month
        ORDER BY period_year ASC, period_month ASC
      `);

      const [expenses] = await db.query(`
        SELECT YEAR(expense_date) as year, MONTH(expense_date) as month, SUM(amount) as total_expense
        FROM expenses
        GROUP BY YEAR(expense_date), MONTH(expense_date)
        ORDER BY year ASC, month ASC
      `);

      const timelineMap = {};
      
      incomes.forEach(i => {
        const key = `${i.year}-${i.month.toString().padStart(2, '0')}`;
        timelineMap[key] = { monthLabel: key, income: parseFloat(i.total_income), unpaid: parseFloat(i.unpaid_income), expense: 0, profit: parseFloat(i.total_income) };
      });

      expenses.forEach(e => {
        const key = `${e.year}-${e.month.toString().padStart(2, '0')}`;
        if (!timelineMap[key]) {
          timelineMap[key] = { monthLabel: key, income: 0, unpaid: 0, expense: parseFloat(e.total_expense), profit: -parseFloat(e.total_expense) };
        } else {
          timelineMap[key].expense = parseFloat(e.total_expense);
          timelineMap[key].profit = timelineMap[key].income - timelineMap[key].expense;
        }
      });

      const timeline = Object.values(timelineMap).sort((a, b) => a.monthLabel.localeCompare(b.monthLabel));

      const [invoices] = await db.query(`
        SELECT i.customer_id, c.business_name, i.period_year, i.period_month, i.base_total
        FROM invoices i
        JOIN CUSTOMERS c ON i.customer_id = c.id
        ORDER BY i.customer_id, i.period_year DESC, i.period_month DESC
      `);

      const customersMap = {};
      invoices.filter(inv => canAccessCustomer(request.user, inv.customer_id)).forEach(inv => {
        if (!customersMap[inv.customer_id]) {
          customersMap[inv.customer_id] = {
            id: inv.customer_id,
            name: inv.business_name,
            history: []
          };
        }
        customersMap[inv.customer_id].history.push(parseFloat(inv.base_total));
      });

      const customerForecasts = Object.values(customersMap).map(c => {
        const h = c.history;
        let lastMonth = h.length > 0 ? h[0] : 0;
        let prevMonth = h.length > 1 ? h[1] : 0;
        
        let forecast = 0;
        let trend = 0;
        if (prevMonth > 0) {
          trend = ((lastMonth - prevMonth) / prevMonth) * 100;
        } else if (lastMonth > 0) {
          trend = 100;
        }

        if (h.length >= 3) {
          forecast = ((h[0] * 3) + (h[1] * 2) + (h[2] * 1)) / 6;
        } else if (h.length === 2) {
          forecast = ((h[0] * 2) + (h[1] * 1)) / 3;
        } else if (h.length === 1) {
          forecast = h[0];
        }

        return {
          id: c.id,
          name: c.name,
          lastMonth,
          prevMonth,
          trend: trend.toFixed(2),
          forecast: forecast.toFixed(2)
        };
      }).sort((a, b) => b.lastMonth - a.lastMonth);
      
      return { timeline, customerForecasts };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore caricamento statistiche' });
    }
  });

}

module.exports = financesRoutes;
