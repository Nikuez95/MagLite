import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { Plus, Trash2, Calendar, DollarSign, Tag, TrendingDown, Loader2, Search } from 'lucide-react';
import { appAlert, appConfirm } from '../../utils/alerts';
import { hasPerm } from '../../utils/permissions';
import FinanceAdminNav from '../../components/FinanceAdminNav';

const ExpensesManager = () => {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  
  const [newExpense, setNewExpense] = useState({
    description: '',
    amount: '',
    expense_date: new Date().toISOString().split('T')[0],
    category: 'Generale'
  });

  const categories = ['Generale', 'Affitto', 'Utenze', 'Personale', 'Manutenzione', 'Attrezzature', 'Marketing', 'Tasse'];

  const getToken = () => localStorage.getItem('maglite_token');
  const canManageFinance = hasPerm('finance_manage');

  const fetchExpenses = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/finances/expenses`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setExpenses(res.data || []);
    } catch (err) {
      console.error(err);
      appAlert('Errore caricamento uscite');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExpenses();
  }, []);

  const filteredExpenses = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return expenses.filter(exp => {
      if (categoryFilter !== 'ALL' && exp.category !== categoryFilter) return false;
      if (q) {
        const hit =
          (exp.description || '').toLowerCase().includes(q) ||
          (exp.category || '').toLowerCase().includes(q) ||
          String(exp.amount || '').includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [expenses, searchTerm, categoryFilter]);

  const kpi = useMemo(() => {
    const now = new Date();
    const curMonth = now.getMonth();
    const curYear = now.getFullYear();
    let totalAll = 0;
    let totalCurrentMonth = 0;
    expenses.forEach(exp => {
      const val = parseFloat(exp.amount) || 0;
      totalAll += val;
      const d = new Date(exp.expense_date);
      if (!isNaN(d.getTime()) && d.getMonth() === curMonth && d.getFullYear() === curYear) {
        totalCurrentMonth += val;
      }
    });
    return {
      totalAll,
      totalCurrentMonth,
      filteredSum: filteredExpenses.reduce((acc, e) => acc + (parseFloat(e.amount) || 0), 0),
      count: filteredExpenses.length
    };
  }, [expenses, filteredExpenses]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!canManageFinance) return appAlert('Permesso Gestione Finanza richiesto.');
    if (!newExpense.description || !newExpense.amount || !newExpense.expense_date) {
      return appAlert('Compila tutti i campi obbligatori');
    }
    
    try {
      await axios.post(`http://${window.location.hostname}:3000/api/finances/expenses`, newExpense, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setNewExpense({ description: '', amount: '', expense_date: new Date().toISOString().split('T')[0], category: 'Generale' });
      fetchExpenses();
      appAlert('Uscita registrata con successo!');
    } catch (err) {
      console.error(err);
      appAlert('Errore salvataggio uscita');
    }
  };

  const handleDelete = async (id) => {
    if (!canManageFinance) return appAlert('Permesso Gestione Finanza richiesto.');
    if (!await appConfirm('Sei sicuro di voler eliminare questa uscita?')) return;
    try {
      await axios.delete(`http://${window.location.hostname}:3000/api/finances/expenses/${id}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      fetchExpenses();
    } catch (err) {
      console.error(err);
      appAlert('Errore eliminazione uscita');
    }
  };

  return (
    <div className="flex-1 p-6 md:p-8 overflow-y-auto bg-brand-black min-h-screen">
      <div className="max-w-7xl mx-auto animate-fade-in-up">
        <FinanceAdminNav />

        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <TrendingDown className="text-rose-500" size={32} />
            <div>
              <h1 className="text-3xl font-black text-white">Gestione Uscite (Expenses)</h1>
              <p className="text-slate-400 text-sm">Registra e filtra le spese aziendali per calcolare il margine operativo netto.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl px-4 py-2.5 text-right">
              <div className="text-[10px] font-bold uppercase text-slate-400">Mese Corrente</div>
              <div className="text-lg font-black text-rose-400">€ {kpi.totalCurrentMonth.toFixed(2)}</div>
            </div>
            <div className="bg-slate-900 border border-rose-500/30 rounded-2xl px-4 py-2.5 text-right">
              <div className="text-[10px] font-bold uppercase text-rose-300">Totale Complessivo</div>
              <div className="text-lg font-black text-white">€ {kpi.totalAll.toFixed(2)}</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          <div className="lg:col-span-1">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl sticky top-8">
              <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2"><Plus size={20} className="text-rose-500"/> Nuova Uscita</h2>
              
              <form onSubmit={handleAdd} className="space-y-4">
                <div>
                  <label className="block text-slate-400 text-sm font-bold mb-2">Data Scadenza / Pagamento</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-3 text-slate-500" size={18} />
                    <input type="date" value={newExpense.expense_date} onChange={e => setNewExpense({...newExpense, expense_date: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-white focus:border-brand-blue outline-none [color-scheme:dark]" required />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 text-sm font-bold mb-2">Importo (EUR)</label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-3 text-slate-500" size={18} />
                    <input type="number" step="0.01" value={newExpense.amount} onChange={e => setNewExpense({...newExpense, amount: e.target.value})} placeholder="0.00" className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-white focus:border-brand-blue outline-none" required />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 text-sm font-bold mb-2">Categoria</label>
                  <div className="relative">
                    <Tag className="absolute left-3 top-3 text-slate-500" size={18} />
                    <select value={newExpense.category} onChange={e => setNewExpense({...newExpense, category: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-white focus:border-brand-blue outline-none appearance-none">
                      {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 text-sm font-bold mb-2">Descrizione</label>
                  <input type="text" value={newExpense.description} onChange={e => setNewExpense({...newExpense, description: e.target.value})} placeholder="Es. Acquisto materiale ufficio" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white focus:border-brand-blue outline-none" required />
                </div>

                <button type="submit" className="w-full mt-4 py-3 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors">
                  <Plus size={18}/> Registra Spesa
                </button>
              </form>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-bold text-white">Storico Uscite ({kpi.count})</h2>
                <div className="text-xs font-mono text-rose-400 font-bold">
                  Totale filtrato: € {kpi.filteredSum.toFixed(2)}
                </div>
              </div>

              <div className="flex flex-wrap gap-2.5">
                <div className="relative flex-1 min-w-[200px]">
                  <Search size={15} className="absolute left-3 top-2.5 text-slate-500" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Cerca descrizione o importo..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white focus:border-brand-blue outline-none"
                  />
                </div>
                <select
                  value={categoryFilter}
                  onChange={e => setCategoryFilter(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-200 focus:border-brand-blue outline-none"
                >
                  <option value="ALL">Tutte le Categorie</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              
              {loading ? (
                <div className="flex justify-center p-8"><Loader2 className="animate-spin text-brand-blue" size={32} /></div>
              ) : filteredExpenses.length === 0 ? (
                <div className="text-slate-500 text-center py-8 text-sm">Nessuna uscita trovata con i filtri selezionati.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-950/50 text-slate-400 uppercase text-xs">
                      <tr>
                        <th className="p-3">Data</th>
                        <th className="p-3">Categoria</th>
                        <th className="p-3">Descrizione</th>
                        <th className="p-3 text-right">Importo</th>
                        <th className="p-3 text-center">Azioni</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-200">
                      {filteredExpenses.map((exp) => (
                        <tr key={exp.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                          <td className="p-3 font-mono text-xs">{new Date(exp.expense_date).toLocaleDateString('it-IT')}</td>
                          <td className="p-3">
                            <span className="px-2 py-1 bg-slate-800 rounded-lg text-xs font-bold text-slate-300">{exp.category}</span>
                          </td>
                          <td className="p-3 font-semibold">{exp.description}</td>
                          <td className="p-3 text-right text-rose-400 font-black font-mono">€ {parseFloat(exp.amount).toFixed(2)}</td>
                          <td className="p-3 text-center">
                            <button onClick={() => handleDelete(exp.id)} className="text-slate-500 hover:text-rose-500 transition-colors">
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default ExpensesManager;
