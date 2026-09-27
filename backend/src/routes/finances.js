const db = require('../config/db');

async function financesRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  // --- INVOICES (PROFORME SALVATE) ---
  
  fastify.post('/invoices', async (request, reply) => {
    const { customer_id, period_month, period_year, base_total, vat_amount, grand_total, invoice_data } = request.body;
    try {
      await db.query(`
        INSERT INTO invoices (customer_id, period_month, period_year, base_total, vat_amount, grand_total, invoice_data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
          base_total = VALUES(base_total),
          vat_amount = VALUES(vat_amount),
          grand_total = VALUES(grand_total),
          invoice_data = VALUES(invoice_data)
      `, [customer_id, period_month, period_year, base_total, vat_amount, grand_total, invoice_data ? JSON.stringify(invoice_data) : null]);
      
      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['SAVE_INVOICE', `Salvata proforma per cliente ID: ${customer_id}, Periodo: ${period_month}/${period_year}`, 'Gestionale Finanza', request.user.username]
      );

      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore salvataggio fattura' });
    }
  });

  fastify.get('/invoices', async (request, reply) => {
    try {
      const [rows] = await db.query(`
        SELECT i.*, c.business_name, c.address, c.vat_number, c.unique_id
        FROM invoices i
        JOIN CUSTOMERS c ON i.customer_id = c.id
        ORDER BY i.period_year DESC, i.period_month DESC, i.created_at DESC
      `);
      return rows;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore fetch fatture' });
    }
  });

  fastify.delete('/invoices/:id', async (request, reply) => {
    try {
      await db.query('DELETE FROM invoices WHERE id = ?', [request.params.id]);
      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['DELETE_INVOICE', `Eliminata proforma ID: ${request.params.id}`, 'Gestionale Finanza', request.user.username]
      );
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore eliminazione proforma' });
    }
  });

  // --- EXPENSES (USCITE) ---

  
  fastify.put('/invoices/:id/payment', async (request, reply) => {
    try {
      const [rows] = await db.query('SELECT is_paid FROM invoices WHERE id = ?', [request.params.id]);
      if (rows.length === 0) return reply.code(404).send({ error: 'Fattura non trovata' });
      
      const newStatus = rows[0].is_paid ? 0 : 1;
      await db.query('UPDATE invoices SET is_paid = ? WHERE id = ?', [newStatus, request.params.id]);
      
      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['TOGGLE_PAYMENT', `Impostato stato ${newStatus ? 'PAGATO' : 'DA PAGARE'} su proforma ID: ${request.params.id}`, 'Gestionale Finanza', request.user.username]
      );
      
      return { success: true, is_paid: newStatus };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore aggiornamento stato pagamento' });
    }
  });

  fastify.get('/expenses', async (request, reply) => {
    try {
      const [rows] = await db.query('SELECT * FROM expenses ORDER BY expense_date DESC');
      return rows;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore fetch uscite' });
    }
  });

  fastify.post('/expenses', async (request, reply) => {
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

      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore salvataggio uscita' });
    }
  });

  fastify.delete('/expenses/:id', async (request, reply) => {
    try {
      await db.query('DELETE FROM expenses WHERE id = ?', [request.params.id]);
      
      await db.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        ['DELETE_EXPENSE', `Eliminata spesa ID: ${request.params.id}`, 'Gestionale Finanza', request.user.username]
      );

      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore eliminazione uscita' });
    }
  });

  // --- ANALYTICS & FORECAST ---

  fastify.get('/analytics', async (request, reply) => {
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
      invoices.forEach(inv => {
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
