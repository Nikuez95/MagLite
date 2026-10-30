import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  RotateCcw,
  Search,
  ArrowLeft,
  Package,
  User,
  Calendar,
  Hash,
  AlertTriangle,
  FileText,
  Eye,
  X,
  ExternalLink,
  ShieldCheck,
  Truck
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const OutboundReturns = () => {
  const [returns, setReturns] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [reasonFilter, setReasonFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedReturn, setSelectedReturn] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchReturns();
  }, []);

  const fetchReturns = async () => {
    try {
      const token = localStorage.getItem('maglite_token');
      const res = await axios.get(`http://${window.location.hostname}:3000/api/outbound/returns`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setReturns(res.data || []);
    } catch (err) {
      console.error('Errore nel recupero storico resi:', err);
    } finally {
      setLoading(false);
    }
  };

  const getReasonBadgeClass = (reason) => {
    const r = (reason || '').toLowerCase();
    if (r.includes('rovinat') || r.includes('rott')) {
      return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
    }
    if (r.includes('non accettat') || r.includes('rifiutat')) {
      return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    }
    if (r.includes('indirizzo') || r.includes('sconosciuto') || r.includes('non trovato')) {
      return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
    }
    return 'bg-sky-500/20 text-sky-400 border-sky-500/30';
  };

  const filteredReturns = returns.filter((r) => {
    const s = searchTerm.toLowerCase();
    const matchesSearch =
      (r.order_code || '').toLowerCase().includes(s) ||
      (r.customer_name || '').toLowerCase().includes(s) ||
      (r.customer_name_current || '').toLowerCase().includes(s) ||
      (r.return_reason || '').toLowerCase().includes(s) ||
      (r.returned_by || '').toLowerCase().includes(s) ||
      (r.prepared_by || '').toLowerCase().includes(s) ||
      (r.shipped_by || '').toLowerCase().includes(s) ||
      (r.notes || '').toLowerCase().includes(s) ||
      (typeof r.items_snapshot === 'string' && r.items_snapshot.toLowerCase().includes(s));

    const matchesReason = !reasonFilter || (r.return_reason || '').includes(reasonFilter);
    return matchesSearch && matchesReason;
  });

  const parseItems = (raw) => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return [];
    }
  };

  return (
    <div className="p-8 pb-32 min-h-screen bg-brand-black text-brand-white">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/desktop/outbound')}
            className="p-3 bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors border border-slate-800"
            title="Torna alle Spedizioni"
          >
            <ArrowLeft size={24} />
          </button>
          <div>
            <h1 className="text-3xl md:text-4xl font-black flex items-center gap-3">
              <RotateCcw className="text-amber-400" size={36} />
              Storico Resi Spedizioni
            </h1>
            <p className="text-slate-400 mt-1 text-sm">
              Tracciabilità completa delle spedizioni rientrate in magazzino: motivo del reso, operatori e merce caricata in "IN ATTESA".
            </p>
          </div>
        </div>

        <button
          onClick={() => navigate('/desktop/outbound')}
          className="bg-brand-blue/15 hover:bg-brand-blue text-brand-blue hover:text-brand-black px-4 py-2.5 rounded-xl font-bold transition-all flex items-center gap-2 self-start md:self-auto border border-brand-blue/30"
        >
          <Truck size={18} />
          Gestione Spedizioni
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <span className="text-xs font-bold text-slate-400 uppercase">Totale Resi Registrati</span>
          <div className="text-3xl font-black text-brand-white mt-1">{returns.length}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <span className="text-xs font-bold text-rose-400 uppercase">Merce Rovinata / Rotta</span>
          <div className="text-3xl font-black text-rose-400 mt-1">
            {returns.filter((r) => (r.return_reason || '').toLowerCase().includes('rovinat') || (r.return_reason || '').toLowerCase().includes('rott')).length}
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <span className="text-xs font-bold text-amber-400 uppercase">Non Accettata da Cliente</span>
          <div className="text-3xl font-black text-amber-400 mt-1">
            {returns.filter((r) => (r.return_reason || '').toLowerCase().includes('non accettat')).length}
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <span className="text-xs font-bold text-purple-400 uppercase">Indirizzo Sconosciuto</span>
          <div className="text-3xl font-black text-purple-400 mt-1">
            {returns.filter((r) => (r.return_reason || '').toLowerCase().includes('indirizzo') || (r.return_reason || '').toLowerCase().includes('sconosciuto')).length}
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="flex-1 bg-slate-900 border border-slate-800 rounded-2xl p-3 relative shadow-xl">
          <input
            type="text"
            placeholder="Cerca per codice spedizione, cliente, motivo, operatore o prodotto..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl py-2.5 pl-11 pr-4 focus:ring-amber-400 text-sm"
          />
          <Search size={18} className="absolute left-6 top-6 text-slate-500" />
        </div>

        <select
          value={reasonFilter}
          onChange={(e) => setReasonFilter(e.target.value)}
          className="bg-slate-900 border border-slate-800 text-brand-white rounded-2xl px-4 py-3 text-sm focus:ring-amber-400"
        >
          <option value="">Tutti i motivi</option>
          <option value="Merce rovinata/rotta">Merce rovinata/rotta</option>
          <option value="Merce non accettata dal cliente">Merce non accettata dal cliente</option>
          <option value="Indirizzo sconosciuto o non trovato">Indirizzo sconosciuto o non trovato</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 uppercase text-xs tracking-wider">
                <th className="p-4 font-bold">Data & Spedizione</th>
                <th className="p-4 font-bold">Cliente</th>
                <th className="p-4 font-bold">Motivo Reso</th>
                <th className="p-4 font-bold">Operatori Coinvolti</th>
                <th className="p-4 font-bold">Cosa C'era Dentro (Giacenza: IN ATTESA)</th>
                <th className="p-4 font-bold text-right">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {loading ? (
                <tr>
                  <td colSpan="6" className="p-8 text-center text-slate-500">
                    Caricamento storico resi...
                  </td>
                </tr>
              ) : filteredReturns.length === 0 ? (
                <tr>
                  <td colSpan="6" className="p-8 text-center text-slate-500">
                    Nessun reso trovato.
                  </td>
                </tr>
              ) : (
                filteredReturns.map((r) => {
                  const items = parseItems(r.items_snapshot);
                  return (
                    <tr key={r.id} className="hover:bg-slate-800/40 transition-colors group">
                      {/* Data & Spedizione */}
                      <td className="p-4 whitespace-nowrap">
                        <div className="flex items-center gap-2 font-bold text-amber-400">
                          <RotateCcw size={15} />
                          {new Date(r.returned_at).toLocaleString('it-IT')}
                        </div>
                        <div className="text-xs font-mono text-slate-300 font-semibold mt-1">
                          {r.order_code}
                        </div>
                        {r.original_shipped_at && (
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            Spedito: {new Date(r.original_shipped_at).toLocaleDateString('it-IT')}
                          </div>
                        )}
                      </td>

                      {/* Cliente */}
                      <td className="p-4 font-bold text-slate-200">
                        {r.customer_name_current || r.customer_name || 'N/D'}
                      </td>

                      {/* Motivo Reso */}
                      <td className="p-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${getReasonBadgeClass(
                            r.return_reason
                          )}`}
                        >
                          <AlertTriangle size={13} />
                          {r.return_reason}
                        </span>
                        {r.notes && (
                          <div className="text-xs text-slate-400 mt-1 italic line-clamp-1">
                            "{r.notes}"
                          </div>
                        )}
                      </td>

                      {/* Operatori */}
                      <td className="p-4">
                        <div className="flex flex-col gap-1 text-xs">
                          <div className="flex items-center gap-1.5 text-amber-300">
                            <User size={13} className="text-amber-400" />
                            <span>Reso fatto da:</span>
                            <strong className="text-brand-white">{r.returned_by || 'Sistema'}</strong>
                          </div>
                          <div className="flex items-center gap-1.5 text-slate-400">
                            <span className="w-3 text-center">•</span>
                            <span>Preparato da:</span>
                            <strong className="text-slate-300">{r.prepared_by || 'N/D'}</strong>
                          </div>
                          {r.shipped_by && (
                            <div className="flex items-center gap-1.5 text-slate-400">
                              <span className="w-3 text-center">•</span>
                              <span>Spedito da:</span>
                              <strong className="text-slate-300">{r.shipped_by}</strong>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Merce Rientrata */}
                      <td className="p-4 max-w-xs">
                        <div className="flex flex-wrap gap-1.5">
                          {items.slice(0, 3).map((item, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1 bg-slate-950 border border-slate-700 text-slate-300 px-2 py-0.5 rounded-lg text-xs"
                              title={`Lotto: ${item.batch || 'N/D'} - Paletta: ${item.pallet_code || 'N/D'}`}
                            >
                              <Package size={11} className="text-amber-400" />
                              <span className="font-semibold">{item.quantity} {item.requested_uom}</span>
                              <span className="truncate max-w-[120px] text-slate-400">{item.product_name}</span>
                            </span>
                          ))}
                          {items.length > 3 && (
                            <span className="text-[11px] text-slate-400 self-center font-semibold">
                              +{items.length - 3} altri
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-emerald-400 font-semibold mt-1 flex items-center gap-1">
                          <ShieldCheck size={11} /> Rientrata in giacenza: <strong>IN ATTESA</strong>
                        </div>
                      </td>

                      {/* Azioni */}
                      <td className="p-4 text-right">
                        <div className="flex justify-end items-center gap-2">
                          <button
                            onClick={() => setSelectedReturn(r)}
                            className="p-2 bg-slate-800 hover:bg-slate-700 text-amber-400 rounded-xl transition-colors"
                            title="Vedi Dettagli Completi del Reso"
                          >
                            <Eye size={17} />
                          </button>
                          <button
                            onClick={() => navigate('/desktop/outbound')}
                            className="p-2 bg-slate-800 hover:bg-slate-700 text-brand-blue rounded-xl transition-colors"
                            title="Vai alla gestione Spedizioni"
                          >
                            <ExternalLink size={17} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Dettagli Reso */}
      {selectedReturn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-950">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-amber-500/20 text-amber-400 rounded-2xl border border-amber-500/30">
                  <RotateCcw size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-brand-white">Dettaglio Reso Spedizione</h3>
                  <p className="text-xs font-mono text-slate-400">{selectedReturn.order_code}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedReturn(null)}
                className="p-2 text-slate-400 hover:text-brand-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-sm">
              {/* Info Grid */}
              <div className="grid grid-cols-2 gap-4 bg-slate-950 p-4 rounded-2xl border border-slate-800/80">
                <div>
                  <span className="text-xs text-slate-500 uppercase font-bold">Cliente</span>
                  <p className="font-bold text-brand-white mt-0.5">
                    {selectedReturn.customer_name_current || selectedReturn.customer_name || 'N/D'}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-slate-500 uppercase font-bold">Data Reso</span>
                  <p className="font-bold text-amber-400 mt-0.5">
                    {new Date(selectedReturn.returned_at).toLocaleString('it-IT')}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-slate-500 uppercase font-bold">Motivo del Reso</span>
                  <div className="mt-1">
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${getReasonBadgeClass(
                        selectedReturn.return_reason
                      )}`}
                    >
                      <AlertTriangle size={13} />
                      {selectedReturn.return_reason}
                    </span>
                  </div>
                </div>
                <div>
                  <span className="text-xs text-slate-500 uppercase font-bold">Spedizione Originale</span>
                  <p className="text-slate-300 mt-0.5">
                    {selectedReturn.original_shipped_at
                      ? new Date(selectedReturn.original_shipped_at).toLocaleString('it-IT')
                      : 'N/D'}
                  </p>
                </div>
              </div>

              {/* Operatori */}
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/80 space-y-2">
                <span className="text-xs text-slate-500 uppercase font-bold">Tracciabilità Operatori</span>
                <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
                  <div>
                    <span className="text-slate-500 block">Reso registrato da:</span>
                    <strong className="text-amber-400 font-bold">{selectedReturn.returned_by || 'Sistema'}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Preparato da:</span>
                    <strong className="text-slate-200 font-bold">{selectedReturn.prepared_by || 'N/D'}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Spedito da:</span>
                    <strong className="text-slate-200 font-bold">{selectedReturn.shipped_by || 'N/D'}</strong>
                  </div>
                </div>
              </div>

              {/* Note */}
              {selectedReturn.notes && (
                <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/80">
                  <span className="text-xs text-slate-500 uppercase font-bold">Note Aggiuntive</span>
                  <p className="text-slate-300 mt-1 italic">"{selectedReturn.notes}"</p>
                </div>
              )}

              {/* Articoli Rientrati */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-400 uppercase font-bold">
                    Cosa c'era dentro (Articoli rientrati a magazzino)
                  </span>
                  <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                    <ShieldCheck size={13} /> Posizione attuale: <strong>IN ATTESA</strong>
                  </span>
                </div>

                <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 uppercase bg-slate-900/60">
                        <th className="p-3">Articolo / Prodotto</th>
                        <th className="p-3">Lotto</th>
                        <th className="p-3">Paletta</th>
                        <th className="p-3 text-right">Quantità Resa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                      {parseItems(selectedReturn.items_snapshot).map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-800/30">
                          <td className="p-3 font-bold text-brand-white">
                            <div>{item.product_name}</div>
                            {item.sku && <div className="text-[10px] text-slate-500 font-mono">SKU: {item.sku}</div>}
                          </td>
                          <td className="p-3 font-mono text-slate-300">{item.batch || '-'}</td>
                          <td className="p-3 font-mono text-slate-400">{item.pallet_code || '-'}</td>
                          <td className="p-3 text-right">
                            <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded font-bold">
                              {item.quantity} {item.requested_uom}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-800 bg-slate-950 flex justify-between items-center">
              <button
                onClick={() => {
                  setSelectedReturn(null);
                  navigate('/desktop/outbound');
                }}
                className="bg-brand-blue/15 hover:bg-brand-blue text-brand-blue hover:text-brand-black px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
              >
                <Truck size={14} />
                Vai a Gestione Spedizioni
              </button>
              <button
                onClick={() => setSelectedReturn(null)}
                className="bg-slate-800 hover:bg-slate-700 text-brand-white px-5 py-2 rounded-xl text-xs font-bold transition-colors"
              >
                Chiudi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OutboundReturns;
