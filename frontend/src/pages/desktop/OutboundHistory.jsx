import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { History, Search, ArrowLeft, Package, User, Calendar, Hash } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const OutboundHistory = () => {
  const [items, setItems] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const token = localStorage.getItem('maglite_token');
      const res = await axios.get(`http://${window.location.hostname}:3000/api/outbound/history/items`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setItems(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const filteredItems = items.filter(i => {
    const s = searchTerm.toLowerCase();
    return (
      (i.product_name || '').toLowerCase().includes(s) ||
      (i.batch || '').toLowerCase().includes(s) ||
      (i.pallet_code || '').toLowerCase().includes(s) ||
      (i.customer_name || '').toLowerCase().includes(s) ||
      (i.order_code || '').toLowerCase().includes(s)
    );
  });

  return (
    <div className="p-8 pb-32 min-h-screen bg-brand-black text-brand-white">
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => navigate('/desktop/outbound')} className="p-3 bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors">
          <ArrowLeft size={24} />
        </button>
        <div>
          <h1 className="text-4xl font-black flex items-center gap-3">
            <History className="text-brand-blue" size={40} />
            Storico Dettagliato Uscite
          </h1>
          <p className="text-slate-400 mt-2">Tracciabilità completa di lotti, quantità e operatori.</p>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 mb-6 relative shadow-xl">
        <input 
          type="text" 
          placeholder="Cerca per prodotto, lotto, cliente o DDT..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl py-3 pl-12 pr-4 focus:ring-brand-blue"
        />
        <Search size={20} className="absolute left-8 top-7 text-slate-500" />
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 uppercase text-xs tracking-wider">
                <th className="p-4 font-bold">Data Spedizione</th>
                <th className="p-4 font-bold">Cliente</th>
                <th className="p-4 font-bold">Prodotto</th>
                <th className="p-4 font-bold">Lotto / Paletta</th>
                <th className="p-4 font-bold text-right">Quantità Uscita</th>
                <th className="p-4 font-bold">Operatori</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {loading ? (
                <tr><td colSpan="6" className="p-8 text-center text-slate-500">Caricamento...</td></tr>
              ) : filteredItems.length === 0 ? (
                <tr><td colSpan="6" className="p-8 text-center text-slate-500">Nessun movimento trovato.</td></tr>
              ) : (
                filteredItems.map(item => (
                  <tr key={item.id} className="hover:bg-slate-800/50 transition-colors group">
                    <td className="p-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Calendar size={16} className="text-slate-500" />
                        {new Date(item.shipped_at).toLocaleString('it-IT')}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">{item.order_code}</div>
                    </td>
                    <td className="p-4 font-bold">{item.customer_name}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-2 text-brand-blue font-bold">
                        <Package size={16} />
                        {item.product_name}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="font-bold">{item.batch || '-'}</div>
                      <div className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                        <Hash size={12}/> {item.pallet_code}
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <span className="bg-brand-blue/10 text-brand-blue border border-brand-blue/20 px-3 py-1 rounded-lg font-bold">
                        {item.quantity_picked} <span className="text-[10px] uppercase">{item.uom}</span>
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-col gap-1 text-sm">
                        <div className="flex items-center gap-2 text-slate-300">
                          <User size={14} className="text-slate-500"/>
                          <span className="text-xs">Prep:</span> <span className="font-bold">{item.operator_prep}</span>
                        </div>
                        <div className="flex items-center gap-2 text-slate-300">
                          <User size={14} className="text-slate-500"/>
                          <span className="text-xs">Uscita:</span> <span className="font-bold">{item.operator_ship || item.operator_prep}</span>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default OutboundHistory;
