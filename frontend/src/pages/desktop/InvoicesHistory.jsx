import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Archive, Download, Search, Loader2 } from 'lucide-react';

const InvoicesHistory = () => {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const getToken = () => localStorage.getItem('maglite_token');

  useEffect(() => {
    const fetchInvoices = async () => {
      try {
        const res = await axios.get(`http://${window.location.hostname}:3000/api/finances/invoices`, {
          headers: { Authorization: `Bearer ${getToken()}` }
        });
        setInvoices(res.data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchInvoices();
  }, []);

  const filtered = invoices.filter(i => 
    i.business_name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    `${i.period_month}/${i.period_year}`.includes(searchTerm)
  );

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-brand-black min-h-screen">
      <div className="max-w-7xl mx-auto animate-fade-in-up">
        
        <div className="mb-8 flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
              <Archive className="text-brand-blue" size={32} />
              Storico Proforme
            </h1>
            <p className="text-slate-400">Archivio delle proforme generate. I dati qui salvati alimentano i grafici finanziari.</p>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl mb-8">
          <div className="relative">
            <Search className="absolute left-4 top-3 text-slate-500" size={20} />
            <input 
              type="text" 
              placeholder="Cerca per cliente o mese (es. 9/2026)..." 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-12 pr-4 py-3 text-white focus:border-brand-blue outline-none"
            />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="animate-spin text-brand-blue" size={40} /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-500">Nessuna fattura salvata trovata. Genera e scarica una Proforma PDF per salvarla qui.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {filtered.map(inv => (
                <div key={inv.id} className="bg-slate-950 border border-slate-800 rounded-2xl p-5 hover:border-brand-blue transition-colors group">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="text-xs font-bold text-brand-blue mb-1">PERIODO {inv.period_month.toString().padStart(2, '0')}/{inv.period_year}</div>
                      <h3 className="text-lg font-bold text-white leading-tight">{inv.business_name}</h3>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-500">Emessa il</div>
                      <div className="text-sm font-semibold text-slate-300">{new Date(inv.created_at).toLocaleDateString()}</div>
                    </div>
                  </div>
                  
                  <div className="space-y-2 mb-4 border-t border-slate-800/50 pt-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Imponibile</span>
                      <span className="text-white">EUR {parseFloat(inv.base_total).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Imposta IVA</span>
                      <span className="text-white">EUR {parseFloat(inv.vat_amount).toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="flex justify-between items-center bg-slate-900 rounded-lg p-3">
                    <span className="font-bold text-slate-400">TOTALE</span>
                    <span className="text-xl font-black text-emerald-400">EUR {parseFloat(inv.grand_total).toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default InvoicesHistory;
