import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Activity, Search, Calendar, User, Monitor } from 'lucide-react';

const AuditLogs = () => {
  const [logs, setLogs] = useState([]);
  const [filters, setFilters] = useState({ search: '', start_date: '', end_date: '' });
  const [isLoading, setIsLoading] = useState(false);

  const getToken = () => localStorage.getItem('maglite_token');

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const query = new URLSearchParams();
      if (filters.search) query.append('search', filters.search);
      if (filters.start_date) query.append('start_date', filters.start_date);
      if (filters.end_date) query.append('end_date', filters.end_date);

      const res = await axios.get(`http://${window.location.hostname}:3000/api/audit?${query.toString()}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setLogs(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [filters]);

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-brand-black min-h-screen">
      <div className="max-w-7xl mx-auto animate-fade-in-up">
        
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-brand-white mb-2 flex items-center gap-3">
            <Activity className="text-rose-500" size={32} />
            Audit Logs
          </h1>
          <p className="text-slate-400">Tracciamento completo di tutte le operazioni a sistema.</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 mb-8 shadow-xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input 
                type="text" 
                placeholder="Cerca lotto, paletta, nome, utente..." 
                value={filters.search}
                onChange={e => setFilters({...filters, search: e.target.value})}
                className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl pl-12 pr-4 py-3 focus:ring-brand-blue"
              />
            </div>
            <div className="relative">
              <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input 
                type="date" 
                value={filters.start_date}
                onChange={e => setFilters({...filters, start_date: e.target.value})}
                className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl pl-12 pr-4 py-3 focus:ring-brand-blue [color-scheme:dark]"
              />
              <span className="absolute -top-2.5 left-4 bg-slate-900 px-1 text-[10px] text-slate-400 uppercase tracking-wider font-bold">Da Data</span>
            </div>
            <div className="relative">
              <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input 
                type="date" 
                value={filters.end_date}
                onChange={e => setFilters({...filters, end_date: e.target.value})}
                className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl pl-12 pr-4 py-3 focus:ring-brand-blue [color-scheme:dark]"
              />
              <span className="absolute -top-2.5 left-4 bg-slate-900 px-1 text-[10px] text-slate-400 uppercase tracking-wider font-bold">A Data</span>
            </div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap md:whitespace-normal">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                  <th className="px-3 py-3 font-semibold uppercase tracking-wider text-xs">Data & Ora</th>
                  <th className="px-3 py-3 font-semibold uppercase tracking-wider text-xs">Azione</th>
                  <th className="px-3 py-3 font-semibold uppercase tracking-wider text-xs">Dettagli</th>
                  <th className="px-3 py-3 font-semibold uppercase tracking-wider text-xs">Utente</th>
                  <th className="px-3 py-3 font-semibold uppercase tracking-wider text-xs">Sorgente</th>
                </tr>
              </thead>
              <tbody className="text-brand-white">
                {isLoading ? (
                  <tr><td colSpan="5" className="p-12 text-center text-brand-blue">Caricamento...</td></tr>
                ) : logs.length === 0 ? (
                  <tr><td colSpan="5" className="p-12 text-center text-slate-500 italic">Nessun log trovato.</td></tr>
                ) : logs.map(log => (
                  <tr key={log.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                    <td className="px-3 py-3 text-xs font-mono text-brand-blue whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString('it-IT')}
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-xs font-bold px-2 py-1 rounded uppercase tracking-wider bg-slate-800 text-slate-300">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-sm">{log.details}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1 text-slate-400 text-xs">
                        <User size={14} /> {log.username}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1 text-slate-400 text-xs">
                        <Monitor size={14} /> {log.source}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
};

export default AuditLogs;





