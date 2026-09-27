const db = require('../config/db');

async function financesRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  // --- INVOICES (PROFORME SALVATE) ---
  
  fastify.post('/invoices', async (request, reply) => {
    const { customer_id, period_month, period_year, base_total, vat_amount, grand_total } = request.body;
    try {
      await db.query(`
        INSERT INTO invoices (customer_id, period_month, period_year, base_total, vat_amount, grand_total)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
          base_total = VALUES(base_total),
          vat_amount = VALUES(vat_amount),
          grand_total = VALUES(grand_total)
      `, [customer_id, period_month, period_year, base_total, vat_amount, grand_total]);
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore salvataggio fattura' });
    }
  });

  fastify.get('/invoices', async (request, reply) => {
    try {
      const [rows] = await db.query(`
        SELECT i.*, c.business_name 
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

  // --- EXPENSES (USCITE) ---

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
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore salvataggio uscita' });
    }
  });

  fastify.delete('/expenses/:id', async (request, reply) => {
    try {
      await db.query('DELETE FROM expenses WHERE id = ?', [request.params.id]);
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore eliminazione uscita' });
    }
  });

  // --- ANALYTICS & FORECAST ---

  fastify.get('/analytics', async (request, reply) => {
    try {
      // 1. Entrate Mensili Storiche
      const [incomes] = await db.query(`
        SELECT period_year as year, period_month as month, SUM(base_total) as total_income
        FROM invoices
        GROUP BY period_year, period_month
        ORDER BY period_year ASC, period_month ASC
      `);

      // 2. Uscite Mensili Storiche
      const [expenses] = await db.query(`
        SELECT YEAR(expense_date) as year, MONTH(expense_date) as month, SUM(amount) as total_expense
        FROM expenses
        GROUP BY YEAR(expense_date), MONTH(expense_date)
        ORDER BY year ASC, month ASC
      `);

      // Merge Incomes and Expenses into a single timeline array
      const timelineMap = {};
      
      incomes.forEach(i => {
        const key = `${i.year}-${i.month.toString().padStart(2, '0')}`;
        timelineMap[key] = { monthLabel: key, income: parseFloat(i.total_income), expense: 0, profit: parseFloat(i.total_income) };
      });

      expenses.forEach(e => {
        const key = `${e.year}-${e.month.toString().padStart(2, '0')}`;
        if (!timelineMap[key]) {
          timelineMap[key] = { monthLabel: key, income: 0, expense: parseFloat(e.total_expense), profit: -parseFloat(e.total_expense) };
        } else {
          timelineMap[key].expense = parseFloat(e.total_expense);
          timelineMap[key].profit = timelineMap[key].income - timelineMap[key].expense;
        }
      });

      const timeline = Object.values(timelineMap).sort((a, b) => a.monthLabel.localeCompare(b.monthLabel));

      // 3. Customer Forecast (Previsione mese successivo per cliente)
      // Per ogni cliente prendiamo le ultime fatture emesse e facciamo una media mobile pesata
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
            history: [] // Ultime fatture (piu recenti all'inizio)
          };
        }
        customersMap[inv.customer_id].history.push(parseFloat(inv.base_total));
      });

      const customerForecasts = Object.values(customersMap).map(c => {
        const h = c.history;
        let lastMonth = h.length > 0 ? h[0] : 0;
        let prevMonth = h.length > 1 ? h[1] : 0;
        
        let forecast = 0;
        let trend = 0; // % var between last and prev
        if (prevMonth > 0) {
          trend = ((lastMonth - prevMonth) / prevMonth) * 100;
        } else if (lastMonth > 0) {
          trend = 100;
        }

        // Calcolo previsione: media mobile pesata sugli ultimi 3 mesi (3x mese corrente, 2x mese prima, 1x due mesi prima)
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
      }).sort((a, b) => b.lastMonth - a.lastMonth); // Ordina per chi spende di più
      
      return { timeline, customerForecasts };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore caricamento statistiche' });
    }
  });

}

module.exports = financesRoutes;
