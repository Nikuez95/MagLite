import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Loader2, TrendingUp, TrendingDown, DollarSign, Activity, Users } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';

const FinancesDashboard = () => {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);

  const getToken = () => localStorage.getItem('maglite_token');

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const res = await axios.get(`http://${window.location.hostname}:3000/api/finances/analytics`, {
          headers: { Authorization: `Bearer ${getToken()}` }
        });
        setAnalytics(res.data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchAnalytics();
  }, []);

  if (loading) {
    return <div className="flex-1 flex items-center justify-center bg-brand-black min-h-screen"><Loader2 className="animate-spin text-brand-blue" size={48} /></div>;
  }

  if (!analytics) return <div className="p-8 text-white">Errore caricamento dati.</div>;

  const { timeline, customerForecasts } = analytics;

  // Calculate totals from timeline
  const totalIncome = timeline.reduce((acc, curr) => acc + curr.income, 0);
  const totalExpense = timeline.reduce((acc, curr) => acc + curr.expense, 0);
  const totalProfit = totalIncome - totalExpense;

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-brand-black min-h-screen">
      <div className="max-w-7xl mx-auto animate-fade-in-up space-y-8">
        
        <div>
          <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
            <Activity className="text-brand-blue" size={32} />
            Dashboard Finanziaria & Statistiche
          </h1>
          <p className="text-slate-400">Analisi entrate, uscite, utile netto e previsioni di spesa dei clienti.</p>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl relative overflow-hidden group">
            <div className="absolute -right-6 -top-6 text-brand-blue/10 group-hover:text-brand-blue/20 transition-colors"><TrendingUp size={120} /></div>
            <h3 className="text-slate-400 font-bold mb-1">Fatturato Globale (Entrate)</h3>
            <div className="text-3xl font-black text-brand-blue">EUR {totalIncome.toLocaleString('it-IT', {minimumFractionDigits:2})}</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl relative overflow-hidden group">
            <div className="absolute -right-6 -top-6 text-rose-500/10 group-hover:text-rose-500/20 transition-colors"><TrendingDown size={120} /></div>
            <h3 className="text-slate-400 font-bold mb-1">Totale Uscite (Spese)</h3>
            <div className="text-3xl font-black text-rose-500">EUR {totalExpense.toLocaleString('it-IT', {minimumFractionDigits:2})}</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl relative overflow-hidden group">
            <div className="absolute -right-6 -top-6 text-emerald-500/10 group-hover:text-emerald-500/20 transition-colors"><DollarSign size={120} /></div>
            <h3 className="text-slate-400 font-bold mb-1">Utile Lordo (Profitto)</h3>
            <div className={`text-3xl font-black ${totalProfit >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>EUR {totalProfit.toLocaleString('it-IT', {minimumFractionDigits:2})}</div>
          </div>
        </div>

        {/* Charts */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
          <h2 className="text-xl font-bold text-white mb-6">Andamento Entrate vs Uscite (Mensile)</h2>
          <div className="h-[400px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeline} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorExpense" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="monthLabel" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <RechartsTooltip 
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f8fafc' }}
                  itemStyle={{ color: '#f8fafc' }}
                />
                <Legend />
                <Area type="monotone" name="Entrate" dataKey="income" stroke="#0ea5e9" fillOpacity={1} fill="url(#colorIncome)" />
                <Area type="monotone" name="Uscite" dataKey="expense" stroke="#f43f5e" fillOpacity={1} fill="url(#colorExpense)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Customer Forecast Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-white flex items-center gap-2"><Users className="text-amber-500"/> Analisi e Previsioni Clienti</h2>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-950/50 text-slate-400 uppercase">
                <tr>
                  <th className="p-3">Cliente</th>
                  <th className="p-3 text-right">Spesa Mese Precedente</th>
                  <th className="p-3 text-right">Spesa Mese Corrente</th>
                  <th className="p-3 text-center">Trend Var. %</th>
                  <th className="p-3 text-right">Previsione Prossimo Mese</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {customerForecasts.map(c => (
                  <tr key={c.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="p-3 font-bold text-white">{c.name}</td>
                    <td className="p-3 text-right text-slate-400">EUR {parseFloat(c.prevMonth).toFixed(2)}</td>
                    <td className="p-3 text-right font-semibold">EUR {parseFloat(c.lastMonth).toFixed(2)}</td>
                    <td className="p-3 text-center">
                      {parseFloat(c.trend) > 0 ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded font-bold"><TrendingUp size={14}/> +{c.trend}%</span>
                      ) : parseFloat(c.trend) < 0 ? (
                        <span className="inline-flex items-center gap-1 text-rose-400 bg-rose-400/10 px-2 py-1 rounded font-bold"><TrendingDown size={14}/> {c.trend}%</span>
                      ) : (
                        <span className="text-slate-500 font-bold">0.00%</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <span className="text-brand-blue font-black text-base">EUR {parseFloat(c.forecast).toFixed(2)}</span>
                    </td>
                  </tr>
                ))}
                {customerForecasts.length === 0 && (
                  <tr>
                    <td colSpan="5" className="text-center py-8 text-slate-500">Dati insufficienti. Genera proforme per elaborare le previsioni.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-4 italic">* La previsione del prossimo mese è calcolata tramite un algoritmo di Media Mobile Ponderata sulle ultime 3 fatturazioni.</p>
        </div>

      </div>
    </div>
  );
};

export default FinancesDashboard;
