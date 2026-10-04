const fs = require('fs');

const content = `import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Package, Search, Printer, CheckCircle, Clock, FileText, AlertTriangle } from 'lucide-react';
import { appAlert } from '../../utils/alerts';

const InboundDDTs = () => {
  const [ddts, setDdts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const getToken = () => localStorage.getItem('token');

  const fetchDdts = async () => {
    try {
      const res = await axios.get(\`http://\${window.location.hostname}:3000/api/inbound/ddt\`, {
        headers: { Authorization: \`Bearer \${getToken()}\` }
      });
      setDdts(res.data);
    } catch (err) {
      console.error(err);
      appAlert('Errore caricamento DDT');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDdts();
    const interval = setInterval(fetchDdts, 15000); // refresh every 15s
    return () => clearInterval(interval);
  }, []);

  const getStatusBadge = (status) => {
    switch (status) {
      case 'PENDING':
        return <span className="bg-slate-800 text-slate-300 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 w-max"><Clock size={14}/> In Attesa</span>;
      case 'IN_PROGRESS':
        return <span className="bg-brand-blue/20 text-brand-blue px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 w-max"><Clock size={14}/> In Spunta</span>;
      case 'COMPLETED':
        return <span className="bg-emerald-500/20 text-emerald-500 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 w-max"><CheckCircle size={14}/> Completato</span>;
      case 'DISCREPANCY':
        return <span className="bg-amber-500/20 text-amber-500 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 w-max"><AlertTriangle size={14}/> Discrepanza</span>;
      default:
        return <span className="bg-slate-700 text-slate-300 px-3 py-1 rounded-full text-xs font-bold">{status}</span>;
    }
  };

  const filtered = ddts.filter(d => 
    d.ddt_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (d.customer_name && d.customer_name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="p-8 h-full flex flex-col">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <FileText className="text-brand-blue" /> Archivio DDT Entrata (Spunta)
          </h1>
          <p className="text-slate-400 mt-1">Storico dei Documenti di Trasporto Inbound per lo spacchettamento tramite Zebra.</p>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl flex-1 flex flex-col">
        <div className="mb-4">
          <div className="relative w-64">
            <Search className="absolute left-3 top-3 text-slate-500" size={18} />
            <input 
              type="text" 
              placeholder="Cerca DDT o Cliente..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl py-2 pl-10 pr-4 focus:ring-brand-blue focus:border-brand-blue"
            />
          </div>
        </div>

        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left">
            <thead className="bg-slate-950/50 text-slate-400 text-sm uppercase">
              <tr>
                <th className="p-4 font-bold border-b border-slate-800">Numero DDT</th>
                <th className="p-4 font-bold border-b border-slate-800">Data Creazione</th>
                <th className="p-4 font-bold border-b border-slate-800">Cliente</th>
                <th className="p-4 font-bold border-b border-slate-800">Stato</th>
                <th className="p-4 font-bold border-b border-slate-800 text-right">Azioni</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {loading ? (
                <tr><td colSpan="5" className="p-8 text-center">Caricamento...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan="5" className="p-8 text-center text-slate-500 italic">Nessun DDT trovato.</td></tr>
              ) : filtered.map(d => (
                <tr key={d.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                  <td className="p-4 font-bold text-white font-mono">{d.ddt_number}</td>
                  <td className="p-4">{new Date(d.created_at).toLocaleString('it-IT')}</td>
                  <td className="p-4 font-bold">{d.customer_name}</td>
                  <td className="p-4">
                    {getStatusBadge(d.status)}
                    {d.notes && <div className="text-xs text-slate-500 mt-1">{d.notes}</div>}
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={() => window.open(\`http://\${window.location.hostname}:3000/api/inbound/ddt/\${d.id}/pdf\`, '_blank')}
                        className="p-2 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-lg transition-colors flex items-center gap-2"
                        title="Vedi PDF DDT"
                      >
                        <FileText size={18} />
                      </button>
                      {(d.status === 'COMPLETED' || d.status === 'DISCREPANCY') && (
                        <button 
                          onClick={() => window.open(\`http://\${window.location.hostname}:3000/api/inbound/ddt/\${d.id}/barcodes\`, '_blank')}
                          className="p-2 bg-brand-blue hover:bg-sky-400 text-brand-black font-bold rounded-lg transition-colors flex items-center gap-2"
                          title="Stampa Barcode Palette Generate"
                        >
                          <Printer size={18} /> Barcode
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default InboundDDTs;
`;

fs.writeFileSync('frontend/src/pages/desktop/InboundDDTs.jsx', content);
console.log("InboundDDTs.jsx created");
