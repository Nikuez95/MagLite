import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import {
  Archive, Search, Loader2, Trash2, FileText, CheckCircle, XCircle,
  GitBranch, Eye, X, Boxes, Euro, Clock
} from 'lucide-react';
import { appAlert, appConfirm } from '../../utils/alerts';
import { hasPerm } from '../../utils/permissions';
import { generateProformaPdf, formatDateIT } from '../../utils/invoicePdf';
import { io } from 'socket.io-client';

const InvoicesHistory = () => {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [companySettings, setCompanySettings] = useState({});
  const [filterStatus, setFilterStatus] = useState('ALL'); // ALL, PAID, UNPAID
  const [previewInvoice, setPreviewInvoice] = useState(null);

  const getToken = () => localStorage.getItem('maglite_token');
  const canManageFinance = hasPerm('finance_manage');

  const fetchInvoices = async () => {
    setLoading(true);
    try {
      const [invRes, setRes] = await Promise.all([
        axios.get(`http://${window.location.hostname}:3000/api/finances/invoices`, { headers: { Authorization: `Bearer ${getToken()}` } }),
        axios.get(`http://${window.location.hostname}:3000/api/settings`, { headers: { Authorization: `Bearer ${getToken()}` } })
      ]);
      setInvoices(invRes.data || []);
      setCompanySettings(setRes.data || {});
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoices();
    const socket = io(`http://${window.location.hostname}:3000`);
    socket.on('finances_updated', fetchInvoices);
    return () => socket.disconnect();
  }, []);

  const handleDelete = async (id) => {
    if (!canManageFinance) return appAlert("Permesso Gestione Finanza richiesto per eliminare proforme.");
    if (!await appConfirm("Sei sicuro di voler eliminare questa proforma? L'operazione aggiornerà la Dashboard Finanza.")) return;
    try {
      await axios.delete(`http://${window.location.hostname}:3000/api/finances/invoices/${id}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      appAlert('Fattura eliminata con successo');
      fetchInvoices();
    } catch (err) {
      console.error(err);
      appAlert("Errore durante l'eliminazione");
    }
  };

  const togglePayment = async (id) => {
    if (!canManageFinance) return appAlert('Permesso Gestione Finanza richiesto per cambiare lo stato di pagamento.');
    try {
      await axios.put(`http://${window.location.hostname}:3000/api/finances/invoices/${id}/payment`, {}, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      fetchInvoices();
    } catch (err) {
      console.error(err);
      appAlert("Errore aggiornamento stato");
    }
  };

  const downloadPDF = async (inv) => {
    if (!inv.invoice_data) {
      return appAlert('Questa proforma non contiene i dati di dettaglio storici per ricreare il PDF.');
    }

    try {
      const data = typeof inv.invoice_data === 'string' ? JSON.parse(inv.invoice_data) : inv.invoice_data;
      const {
        items = [],
        pallets = [],
        sections = [],
        vatRate = 22,
        period,
        includeNotesInPdf = true,
        storageModeLabel = ''
      } = data;

      await generateProformaPdf({
        companySettings,
        customer: {
          business_name: inv.business_name,
          address: inv.address,
          vat_number: inv.vat_number
        },
        period: period || `${String(inv.period_month).padStart(2, '0')}/${inv.period_year}`,
        storageModeLabel,
        sections,
        items,
        pallets,
        includeNotesInPdf,
        vatRate,
        baseTotal: parseFloat(inv.base_total || 0),
        vatAmount: parseFloat(inv.vat_amount || 0),
        grandTotal: parseFloat(inv.grand_total || 0)
      });
    } catch (e) {
      console.error(e);
      appAlert('Errore nella generazione del PDF: i dati storici potrebbero essere corrotti.');
    }
  };

  const kpi = useMemo(() => {
    let paidSum = 0;
    let unpaidSum = 0;
    let paidCount = 0;
    let unpaidCount = 0;
    invoices.forEach(i => {
      const val = parseFloat(i.grand_total) || 0;
      if (i.is_paid) {
        paidSum += val;
        paidCount++;
      } else {
        unpaidSum += val;
        unpaidCount++;
      }
    });
    return {
      totalCount: invoices.length,
      paidSum,
      unpaidSum,
      totalSum: paidSum + unpaidSum,
      paidCount,
      unpaidCount
    };
  }, [invoices]);

  const filtered = invoices.filter(i => {
    const matchesSearch = (i.business_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                          `${i.period_month}/${i.period_year}`.includes(searchTerm) ||
                          `${String(i.period_month).padStart(2, '0')}/${i.period_year}`.includes(searchTerm);
    const matchesStatus = filterStatus === 'ALL' ||
                          (filterStatus === 'PAID' && i.is_paid) ||
                          (filterStatus === 'UNPAID' && !i.is_paid);
    return matchesSearch && matchesStatus;
  });

  const openGoodsPreview = (inv) => {
    if (!inv.invoice_data) return appAlert('Nessun dato di dettaglio disponibile per questa proforma.');
    try {
      const data = typeof inv.invoice_data === 'string' ? JSON.parse(inv.invoice_data) : inv.invoice_data;
      const flatPallets = (data.pallets && data.pallets.length > 0)
        ? data.pallets
        : (data.sections || []).flatMap(s => s.pallets || []);
      setPreviewInvoice({ inv, data, pallets: flatPallets });
    } catch (e) {
      appAlert('Impossibile leggere i dettagli merce di questa proforma.');
    }
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-brand-black min-h-screen">
      <div className="max-w-7xl mx-auto animate-fade-in-up">
        <div className="mb-6 flex flex-wrap justify-between items-end gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
              <Archive className="text-brand-blue" size={32} />
              Storico Proforme &amp; Report Merce
            </h1>
            <p className="text-slate-400">
              Archivio completo delle proforme con report dettagliato della merce, incassi e stato pagamenti.
            </p>
          </div>
        </div>

        {/* KPI Bar */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <FileText size={13} className="text-brand-blue" /> Totale Proforme
            </div>
            <div className="text-2xl font-black text-white mt-1">{kpi.totalCount}</div>
            <div className="text-xs text-slate-500 mt-0.5">Valore: € {kpi.totalSum.toFixed(2)}</div>
          </div>
          <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
              <CheckCircle size={13} /> Incassato ({kpi.paidCount})
            </div>
            <div className="text-2xl font-black text-emerald-400 mt-1">€ {kpi.paidSum.toFixed(2)}</div>
          </div>
          <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              <Clock size={13} /> Da Incassare ({kpi.unpaidCount})
            </div>
            <div className="text-2xl font-black text-amber-400 mt-1">€ {kpi.unpaidSum.toFixed(2)}</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
              <Euro size={13} /> Tasso Incasso
            </div>
            <div className="text-2xl font-black text-sky-400 mt-1">
              {kpi.totalSum > 0 ? Math.round((kpi.paidSum / kpi.totalSum) * 100) : 0}%
            </div>
          </div>
        </div>

        {/* Search & Filter */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl mb-8 flex flex-col md:flex-row gap-4 items-center">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-4 top-3 text-slate-500" size={20} />
            <input
              type="text"
              placeholder="Cerca per cliente o mese (es. 10/2026)..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-12 pr-4 py-3 text-white focus:border-brand-blue outline-none"
            />
          </div>
          <div className="flex bg-slate-950 rounded-xl border border-slate-800 p-1 w-full md:w-auto">
            <button onClick={() => setFilterStatus('ALL')} className={`flex-1 px-4 py-2 rounded-lg font-bold text-sm transition-colors ${filterStatus === 'ALL' ? 'bg-brand-blue text-brand-black' : 'text-slate-400 hover:text-white'}`}>Tutte ({kpi.totalCount})</button>
            <button onClick={() => setFilterStatus('UNPAID')} className={`flex-1 px-4 py-2 rounded-lg font-bold text-sm transition-colors ${filterStatus === 'UNPAID' ? 'bg-amber-500 text-brand-black' : 'text-slate-400 hover:text-amber-500'}`}>Da Pagare ({kpi.unpaidCount})</button>
            <button onClick={() => setFilterStatus('PAID')} className={`flex-1 px-4 py-2 rounded-lg font-bold text-sm transition-colors ${filterStatus === 'PAID' ? 'bg-emerald-500 text-brand-black' : 'text-slate-400 hover:text-emerald-500'}`}>Pagate ({kpi.paidCount})</button>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="animate-spin text-brand-blue" size={40} /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-500">Nessuna fattura salvata trovata. Genera e scarica una Proforma PDF per salvarla qui.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {filtered.map(inv => {
                const parsedData = inv.invoice_data
                  ? (typeof inv.invoice_data === 'string' ? JSON.parse(inv.invoice_data) : inv.invoice_data)
                  : null;
                const sectionsCount = parsedData?.sections?.length || 0;
                const palletsCount = parsedData?.pallets?.length || (parsedData?.sections || []).reduce((acc, s) => acc + (s.pallets?.length || 0), 0);

                return (
                  <div key={inv.id} className={`bg-slate-950 border ${inv.is_paid ? 'border-emerald-500/40' : 'border-amber-500/40'} rounded-2xl p-5 hover:border-brand-blue transition-colors group flex flex-col justify-between`}>
                    <div>
                      <div className="flex justify-between items-start mb-4 gap-2">
                        <div>
                          <div className="text-xs font-bold text-brand-blue mb-1">
                            PERIODO {inv.period_month.toString().padStart(2, '0')}/{inv.period_year}
                          </div>
                          <h3 className="text-lg font-bold text-white leading-tight">{inv.business_name}</h3>
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {sectionsCount > 1 && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-violet-500/15 text-violet-300 text-[10px] font-bold">
                                <GitBranch size={11} /> {sectionsCount} Framm.
                              </span>
                            )}
                            {palletsCount > 0 && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-bold">
                                <Boxes size={11} className="text-brand-blue" /> {palletsCount} Bancali
                              </span>
                            )}
                            {parsedData?.storageModeLabel && (
                              <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 text-[10px] font-bold">
                                {parsedData.storageModeLabel}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right flex flex-col items-end shrink-0">
                          {inv.is_paid ? (
                            <span className="inline-flex items-center gap-1 text-emerald-400 bg-emerald-400/10 px-2.5 py-1 rounded-lg text-xs font-bold mb-1"><CheckCircle size={12} /> PAGATO</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-lg text-xs font-bold mb-1"><Clock size={12} /> DA PAGARE</span>
                          )}
                          <div className="text-[11px] text-slate-500">Del {new Date(inv.created_at).toLocaleDateString('it-IT')}</div>
                        </div>
                      </div>

                      <div className="space-y-1.5 mb-4 border-t border-slate-800/50 pt-3">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-400">Imponibile</span>
                          <span className="text-slate-200 font-mono">€ {parseFloat(inv.base_total).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-400">IVA</span>
                          <span className="text-slate-200 font-mono">€ {parseFloat(inv.vat_amount).toFixed(2)}</span>
                        </div>
                      </div>

                      <div className="flex justify-between items-center bg-slate-900 rounded-xl p-3 mb-4 border border-slate-800/70">
                        <span className="font-bold text-slate-400 text-xs uppercase">Totale</span>
                        <span className="text-xl font-black text-emerald-400">€ {parseFloat(inv.grand_total).toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="flex justify-between items-center pt-3 border-t border-slate-800/50 gap-2">
                      <div className="flex gap-1.5">
                        <button onClick={() => handleDelete(inv.id)} className="p-2 text-slate-500 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors" title="Elimina Proforma">
                          <Trash2 size={18} />
                        </button>
                        <button onClick={() => togglePayment(inv.id)} className={`p-2 rounded-lg transition-colors ${inv.is_paid ? 'text-amber-500 hover:bg-amber-500/10' : 'text-emerald-500 hover:bg-emerald-500/10'}`} title={inv.is_paid ? 'Segna come Da Pagare' : 'Segna come Pagato'}>
                          {inv.is_paid ? <XCircle size={18} /> : <CheckCircle size={18} />}
                        </button>
                      </div>
                      {inv.invoice_data ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openGoodsPreview(inv)}
                            className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 font-bold text-xs rounded-lg transition-colors"
                            title="Anteprima Report Dettagliato Merce"
                          >
                            <Eye size={14} /> Merce
                          </button>
                          <button onClick={() => downloadPDF(inv)} className="flex items-center gap-1.5 px-3.5 py-2 bg-brand-blue hover:bg-sky-400 text-brand-black font-black text-xs rounded-lg transition-colors">
                            <FileText size={14} /> PDF
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500 italic">No Dettagli</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Modal Anteprima Report Merce */}
      {previewInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 max-w-6xl w-full shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center pb-4 border-b border-slate-800">
              <div>
                <h2 className="text-xl font-black text-white">
                  Report Dettagliato Merce — {previewInvoice.inv.business_name} ({String(previewInvoice.inv.period_month).padStart(2, '0')}/{previewInvoice.inv.period_year})
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {previewInvoice.pallets.length} bancali registrati • {previewInvoice.data.storageModeLabel || 'Archivio'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => downloadPDF(previewInvoice.inv)}
                  className="px-4 py-2 bg-brand-blue hover:bg-sky-400 text-brand-black font-black text-xs rounded-xl flex items-center gap-1.5"
                >
                  <FileText size={14} /> Scarica PDF
                </button>
                <button
                  onClick={() => setPreviewInvoice(null)}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="overflow-auto flex-1 mt-4 rounded-2xl border border-slate-800">
              {previewInvoice.pallets.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-sm">
                  Nessun bancale collegato a questa proforma storica.
                </div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] sticky top-0">
                    <tr>
                      <th className="p-3">Cod. Art.</th>
                      <th className="p-3">Prodotto / Paletta</th>
                      <th className="p-3">Lotto</th>
                      <th className="p-3 text-center">Scadenza</th>
                      <th className="p-3 text-center">Arrivo</th>
                      <th className="p-3 text-center">Uscita / Stato</th>
                      <th className="p-3 text-center">Q.tà &amp; Gg Sosta</th>
                      <th className="p-3">Causali / Note</th>
                      <th className="p-3 text-right">Importo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-200">
                    {previewInvoice.pallets.map((p, idx) => (
                      <tr key={`${p.pallet_code}-${idx}`} className="hover:bg-slate-800/30">
                        <td className="p-3 font-mono font-bold text-sky-400">{p.sku || '-'}</td>
                        <td className="p-3">
                          <div className="font-bold text-white">{p.product_name || '-'}</div>
                          <div className="text-[10px] font-mono text-slate-500">{p.pallet_code} {p.customer_pallet_ref ? `• Rif: #${p.customer_pallet_ref}` : ''}</div>
                        </td>
                        <td className="p-3 font-mono text-amber-300 font-bold">{p.batch || '-'}</td>
                        <td className="p-3 text-center font-mono">{p.expiration_date_str || formatDateIT(p.expiration_date)}</td>
                        <td className="p-3 text-center font-mono text-sky-300">{formatDateIT(p.created_at)}</td>
                        <td className="p-3 text-center">
                          {p.shipped_at ? (
                            <span className="px-2 py-0.5 rounded bg-rose-950/40 text-rose-300 border border-rose-500/30 font-mono text-[10px]">
                              OUT {formatDateIT(p.shipped_at)}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-emerald-950/40 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
                              In Deposito
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          <div className="font-bold">{p.effective_quantity ?? p.quantity ?? 0} {p.pallet_uom || 'Pz'}</div>
                          {p.storageDays > 0 && <div className="text-[10px] font-mono text-amber-400">{p.storageDays} gg sosta</div>}
                        </td>
                        <td className="p-3 text-[11px] text-slate-300">
                          {(p.charges || []).map(c => c.label || c.description).join(' • ') || p.movementSummary || '-'}
                        </td>
                        <td className="p-3 text-right font-mono font-black text-emerald-400">
                          € {parseFloat(p.customPrice !== undefined ? p.customPrice : (p.totalPrice || 0)).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InvoicesHistory;
