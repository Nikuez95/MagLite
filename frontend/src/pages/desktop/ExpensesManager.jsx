import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Plus, Trash2, Calendar, DollarSign, Tag, TrendingDown, Loader2 } from 'lucide-react';
import { appAlert } from '../../utils/alerts';

const ExpensesManager = () => {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [newExpense, setNewExpense] = useState({
    description: '',
    amount: '',
    expense_date: new Date().toISOString().split('T')[0],
    category: 'Generale'
  });

  const categories = ['Generale', 'Affitto', 'Utenze', 'Personale', 'Manutenzione', 'Attrezzature', 'Marketing', 'Tasse'];

  const getToken = () => localStorage.getItem('maglite_token');

  const fetchExpenses = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/finances/expenses`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setExpenses(res.data);
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

  const handleAdd = async (e) => {
    e.preventDefault();
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
    if (!window.confirm('Sei sicuro di voler eliminare questa uscita?')) return;
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
    <div className="flex-1 p-8 overflow-y-auto bg-brand-black min-h-screen">
      <div className="max-w-7xl mx-auto animate-fade-in-up">
        
        <div className="mb-8 flex items-center gap-3">
          <TrendingDown className="text-rose-500" size={32} />
          <div>
            <h1 className="text-3xl font-bold text-white">Gestione Uscite (Expenses)</h1>
            <p className="text-slate-400">Registra le spese aziendali per calcolare l'utile netto.</p>
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
                    <input type="date" value={newExpense.expense_date} onChange={e => setNewExpense({...newExpense, expense_date: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-white focus:border-brand-blue outline-none" required />
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
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
              <h2 className="text-xl font-bold text-white mb-6">Storico Uscite</h2>
              
              {loading ? (
                <div className="flex justify-center p-8"><Loader2 className="animate-spin text-brand-blue" size={32} /></div>
              ) : expenses.length === 0 ? (
                <div className="text-slate-500 text-center py-8">Nessuna uscita registrata.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-950/50 text-slate-400 uppercase">
                      <tr>
                        <th className="p-3">Data</th>
                        <th className="p-3">Categoria</th>
                        <th className="p-3">Descrizione</th>
                        <th className="p-3 text-right">Importo</th>
                        <th className="p-3 text-center">Azioni</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-200">
                      {expenses.map((exp) => (
                        <tr key={exp.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                          <td className="p-3">{new Date(exp.expense_date).toLocaleDateString()}</td>
                          <td className="p-3">
                            <span className="px-2 py-1 bg-slate-800 rounded-lg text-xs font-bold text-slate-300">{exp.category}</span>
                          </td>
                          <td className="p-3 font-semibold">{exp.description}</td>
                          <td className="p-3 text-right text-rose-400 font-bold">EUR {parseFloat(exp.amount).toFixed(2)}</td>
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
