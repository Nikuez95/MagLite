import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Archive, Search, Loader2, Trash2, FileText, CheckCircle, XCircle, GitBranch } from 'lucide-react';
import { appAlert } from '../../utils/alerts';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const InvoicesHistory = () => {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [companySettings, setCompanySettings] = useState({});
  const [filterStatus, setFilterStatus] = useState('ALL'); // ALL, PAID, UNPAID

  const getToken = () => localStorage.getItem('maglite_token');

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
  }, []);

  const handleDelete = async (id) => {
    if (!window.confirm("Sei sicuro di voler eliminare questa proforma? L'operazione aggiornerà la Dashboard Finanza.")) return;
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
      const { items = [], pallets = [], sections = [], vatRate = 22, period, includeNotesInPdf = true } = data;

      const doc = new jsPDF();

      try {
        const resp = await fetch('/logo_scuro.png');
        const blob = await resp.blob();
        const base64Logo = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
        doc.addImage(base64Logo, 'PNG', 12, 13, 28, 20);
      } catch (e) {}

      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      const companyName = companySettings.company_name || 'La Mia Azienda';
      const companyNameLines = doc.splitTextToSize(companyName, 75);
      doc.text(companyNameLines, 43, 22);

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      let startY = 22 + (companyNameLines.length * 6);
      if (companySettings.company_address) { doc.text(companySettings.company_address, 43, startY); startY += 5; }
      if (companySettings.company_piva) { doc.text(`P.IVA: ${companySettings.company_piva}`, 43, startY); startY += 5; }
      if (companySettings.company_cf) { doc.text(`CF: ${companySettings.company_cf}`, 43, startY); startY += 5; }
      if (companySettings.company_email) { doc.text(`Email: ${companySettings.company_email}`, 43, startY); }

      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text('Spett.le Cliente Madre:', 120, 24);
      doc.setFontSize(14);
      doc.text(inv.business_name || '', 120, 31);
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      const addrLines = doc.splitTextToSize(inv.address || '', 70);
      doc.text(addrLines, 120, 37);
      doc.text(`P.IVA: ${inv.vat_number || '-'}`, 120, 37 + (addrLines.length * 5));

      doc.setLineWidth(0.5);
      doc.line(14, 58, 196, 58);
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text(`PRE-FATTURA PER CLIENTE ${inv.business_name} - PERIODO ${period}`, 14, 67);

      let currentY = 74;

      if (sections && sections.length > 0) {
        for (const sec of sections) {
          const secItems = items.filter(i => String(i.sectionId) === String(sec.sectionId));
          const secLines = sec.descriptiveLines || [];
          const secPallets = sec.pallets || pallets.filter(p => String(p.sectionId) === String(sec.sectionId));
          if (secItems.length === 0 && secLines.length === 0 && secPallets.length === 0) continue;

          if (currentY > 235) {
            doc.addPage();
            currentY = 20;
          }

          doc.setFillColor(15, 23, 42);
          doc.rect(14, currentY - 5, 182, 8, 'F');
          doc.setFontSize(11);
          doc.setFont("helvetica", "bold");
          doc.setTextColor(255, 255, 255);
          doc.text(`"${sec.sectionName}" ${sec.isParent ? '(Cliente Madre)' : '(Frammentazione)'}:`, 17, currentY + 0.5);
          doc.setTextColor(0, 0, 0);
          currentY += 8;

          if (secLines.length > 0) {
            doc.setFontSize(9);
            doc.setFont("helvetica", "normal");
            secLines.forEach(line => {
              const splitLine = doc.splitTextToSize(`• ${line.text}`, 178);
              if (currentY + splitLine.length * 4.5 > 275) {
                doc.addPage();
                currentY = 20;
              }
              doc.text(splitLine, 16, currentY);
              currentY += splitLine.length * 4.5;
            });
            currentY += 2;
          }

          if (secPallets.length > 0) {
            const detailHeaders = includeNotesInPdf
              ? [['Cod. Articolo', 'Nome Prodotto', 'Lotto', 'Q.ta', 'Rif. Paletta Cl.', 'Movimento / Voci', 'Note', 'Prezzo']]
              : [['Cod. Articolo', 'Nome Prodotto', 'Lotto', 'Q.ta', 'Rif. Paletta Cl.', 'Movimento / Voci', 'Prezzo']];

            const detailBody = secPallets.map(p => {
              const chargesSummary = (p.charges || []).map(c => `${c.description} (${parseFloat(c.price || 0).toFixed(2)}€)`).join(' + ')
                || (p.shipped_at ? `Uscita ${new Date(p.shipped_at).toLocaleDateString('it-IT')}` : 'In Deposito');
              const noteVal = p.customNote !== undefined ? p.customNote : (p.notes || '');
              const row = [
                p.sku || '-',
                `${p.product_name || 'Articolo'}\n(${p.pallet_code})`,
                p.batch || '-',
                `${p.effective_quantity ?? p.quantity ?? 0} ${p.pallet_uom || 'PZ'}`,
                p.customer_pallet_ref ? `#${p.customer_pallet_ref}` : '-',
                chargesSummary
              ];
              if (includeNotesInPdf) {
                row.push(noteVal || '-');
              }
              row.push(`${parseFloat(p.totalPrice || 0).toFixed(2)} EUR`);
              return row;
            });

            autoTable(doc, {
              startY: currentY,
              head: detailHeaders,
              body: detailBody,
              theme: 'striped',
              headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
              styles: { fontSize: 7.5, cellPadding: 2.2, valign: 'middle' },
              columnStyles: includeNotesInPdf ? {
                0: { cellWidth: 22, fontStyle: 'bold' },
                1: { cellWidth: 34 },
                2: { cellWidth: 18 },
                3: { cellWidth: 16, halign: 'center' },
                4: { cellWidth: 20, halign: 'center' },
                5: { cellWidth: 32 },
                6: { cellWidth: 20 },
                7: { cellWidth: 20, halign: 'right', fontStyle: 'bold' }
              } : {
                0: { cellWidth: 24, fontStyle: 'bold' },
                1: { cellWidth: 40 },
                2: { cellWidth: 20 },
                3: { cellWidth: 18, halign: 'center' },
                4: { cellWidth: 22, halign: 'center' },
                5: { cellWidth: 36 },
                6: { cellWidth: 22, halign: 'right', fontStyle: 'bold' }
              }
            });
            currentY = doc.lastAutoTable.finalY + 4;
          }

          if (secItems.length > 0) {
            const tableData = secItems.map(i => {
              const qtyStr = i.code === 'DISCOUNT_PERCENT' ? '-' : i.qty.toString();
              const priceStr = i.code === 'DISCOUNT_PERCENT' ? `${Math.abs(i.price)} %` : `${parseFloat(i.price).toFixed(2)} EUR`;
              const labelsList = (i.palletLabels && i.palletLabels.length > 0) ? i.palletLabels : (i.palletCodes || []);
              const descWithCodes = labelsList.length > 0
                ? `${i.description} (${labelsList.join(' | ')})`
                : i.description;
              return [descWithCodes, qtyStr, priceStr, `${parseFloat(i.subtotal).toFixed(2)} EUR`];
            });

            autoTable(doc, {
              startY: currentY,
              head: [[`Riepilogo Voci Tariffarie - ${sec.sectionName}`, 'Q.ta', 'Prezzo Unit.', 'Importo']],
              body: tableData,
              theme: 'grid',
              headStyles: { fillColor: [14, 165, 233], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
              styles: { fontSize: 8, cellPadding: 2.5 },
              columnStyles: {
                1: { halign: 'center', cellWidth: 18 },
                2: { halign: 'right', cellWidth: 30 },
                3: { halign: 'right', cellWidth: 30 }
              }
            });
            currentY = doc.lastAutoTable.finalY + 5;
          }

          const secTot = secItems.reduce((acc, it) => acc + (parseFloat(it.subtotal) || 0), 0);
          doc.setFontSize(10.5);
          doc.setFont("helvetica", "bold");
          doc.text(`Totale ${sec.sectionName}: ${secTot.toFixed(2)} EUR`, 196, currentY, { align: 'right' });
          currentY += 9;
        }
      } else {
        const tableData = items.map(i => {
          let qtyStr = i.code === 'DISCOUNT_PERCENT' ? '-' : i.qty.toString();
          let priceStr = i.code === 'DISCOUNT_PERCENT' ? `${Math.abs(i.price)} %` : `${parseFloat(i.price).toFixed(2)} EUR`;
          return [i.description, qtyStr, priceStr, `${parseFloat(i.subtotal).toFixed(2)} EUR`];
        });

        autoTable(doc, {
          startY: 75,
          head: [['Descrizione Servizio / Sconto', 'Q.ta', 'Prezzo / %', 'Importo']],
          body: tableData,
          theme: 'grid',
          headStyles: { fillColor: [14, 165, 233], textColor: [255, 255, 255], fontStyle: 'bold' },
          styles: { fontSize: 10, cellPadding: 4 },
          columnStyles: { 1: { halign: 'center', cellWidth: 20 }, 2: { halign: 'right', cellWidth: 35 }, 3: { halign: 'right', cellWidth: 35 } }
        });
        currentY = doc.lastAutoTable.finalY + 10;
      }

      if (currentY > 240) {
        doc.addPage();
        currentY = 25;
      }

      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text(`Totale Cliente Madre (${inv.business_name}):`, 155, currentY, { align: 'right' });
      doc.text(`${parseFloat(inv.base_total).toFixed(2)} EUR`, 196, currentY, { align: 'right' });

      doc.setFont("helvetica", "normal");
      doc.text(`IVA (${vatRate}%):`, 155, currentY + 7, { align: 'right' });
      doc.text(`${parseFloat(inv.vat_amount).toFixed(2)} EUR`, 196, currentY + 7, { align: 'right' });

      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text('TOTALE FINALE DOCUMENTO:', 155, currentY + 16, { align: 'right' });
      doc.text(`${parseFloat(inv.grand_total).toFixed(2)} EUR`, 196, currentY + 16, { align: 'right' });

      if (vatRate === 0) {
        doc.setFontSize(9);
        doc.setFont("helvetica", "italic");
        doc.text("* Operazione esente da IVA ai sensi della normativa vigente.", 14, currentY + 25);
      }

      const pageHeight = doc.internal.pageSize.height;
      if (companySettings.company_iban) {
        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        doc.text(`Coordinate Bancarie (IBAN): ${companySettings.company_iban}`, 14, pageHeight - 15);
      }

      doc.save(`Proforma_${inv.business_name.replace(/\s/g, '_')}_${period.replace('/', '_')}.pdf`);
    } catch (e) {
      console.error(e);
      appAlert('Errore nella generazione del PDF: i dati storici potrebbero essere corrotti.');
    }
  };

  const filtered = invoices.filter(i => {
    const matchesSearch = (i.business_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                          `${i.period_month}/${i.period_year}`.includes(searchTerm);
    const matchesStatus = filterStatus === 'ALL' ||
                          (filterStatus === 'PAID' && i.is_paid) ||
                          (filterStatus === 'UNPAID' && !i.is_paid);
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-brand-black min-h-screen">
      <div className="max-w-7xl mx-auto animate-fade-in-up">
        <div className="mb-8 flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
              <Archive className="text-brand-blue" size={32} />
              Storico Proforme
            </h1>
            <p className="text-slate-400">Archivio delle proforme per Cliente Madre e relative Frammentazioni. Segnale come &apos;Pagate&apos; per alimentare le Entrate in Dashboard.</p>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl mb-8 flex flex-col md:flex-row gap-4 items-center">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-4 top-3 text-slate-500" size={20} />
            <input
              type="text"
              placeholder="Cerca per cliente o mese (es. 9/2026)..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-12 pr-4 py-3 text-white focus:border-brand-blue outline-none"
            />
          </div>
          <div className="flex bg-slate-950 rounded-xl border border-slate-800 p-1 w-full md:w-auto">
            <button onClick={() => setFilterStatus('ALL')} className={`flex-1 px-4 py-2 rounded-lg font-bold text-sm transition-colors ${filterStatus === 'ALL' ? 'bg-brand-blue text-brand-black' : 'text-slate-400 hover:text-white'}`}>Tutte</button>
            <button onClick={() => setFilterStatus('UNPAID')} className={`flex-1 px-4 py-2 rounded-lg font-bold text-sm transition-colors ${filterStatus === 'UNPAID' ? 'bg-amber-500 text-brand-black' : 'text-slate-400 hover:text-amber-500'}`}>Da Pagare</button>
            <button onClick={() => setFilterStatus('PAID')} className={`flex-1 px-4 py-2 rounded-lg font-bold text-sm transition-colors ${filterStatus === 'PAID' ? 'bg-emerald-500 text-brand-black' : 'text-slate-400 hover:text-emerald-500'}`}>Pagate</button>
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

                return (
                  <div key={inv.id} className={`bg-slate-950 border ${inv.is_paid ? 'border-emerald-500/50' : 'border-amber-500/50'} rounded-2xl p-5 hover:border-brand-blue transition-colors group flex flex-col justify-between`}>
                    <div>
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <div className="text-xs font-bold text-brand-blue mb-1">PERIODO {inv.period_month.toString().padStart(2, '0')}/{inv.period_year}</div>
                          <h3 className="text-lg font-bold text-white leading-tight">{inv.business_name}</h3>
                          {sectionsCount > 1 && (
                            <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded bg-violet-500/15 text-violet-300 text-[10px] font-bold">
                              <GitBranch size={11} /> {sectionsCount} Frammentazioni incluse
                            </span>
                          )}
                        </div>
                        <div className="text-right flex flex-col items-end">
                          {inv.is_paid ? (
                            <span className="inline-flex items-center gap-1 text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded text-xs font-bold mb-1"><CheckCircle size={12} /> PAGATO</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-500 bg-amber-500/10 px-2 py-1 rounded text-xs font-bold mb-1"><Loader2 size={12} /> DA PAGARE</span>
                          )}
                          <div className="text-xs text-slate-500">Del {new Date(inv.created_at).toLocaleDateString('it-IT')}</div>
                        </div>
                      </div>

                      <div className="space-y-2 mb-4 border-t border-slate-800/50 pt-4">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-400">Imponibile Cliente Madre</span>
                          <span className="text-white">EUR {parseFloat(inv.base_total).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-400">Imposta IVA</span>
                          <span className="text-white">EUR {parseFloat(inv.vat_amount).toFixed(2)}</span>
                        </div>
                      </div>

                      <div className="flex justify-between items-center bg-slate-900 rounded-lg p-3 mb-4">
                        <span className="font-bold text-slate-400">TOTALE</span>
                        <span className="text-xl font-black text-emerald-400">EUR {parseFloat(inv.grand_total).toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="flex justify-between items-center pt-4 border-t border-slate-800/50">
                      <div className="flex gap-2">
                        <button onClick={() => handleDelete(inv.id)} className="p-2 text-slate-500 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors" title="Elimina Proforma">
                          <Trash2 size={20} />
                        </button>
                        <button onClick={() => togglePayment(inv.id)} className={`p-2 rounded-lg transition-colors ${inv.is_paid ? 'text-amber-500 hover:bg-amber-500/10' : 'text-emerald-500 hover:bg-emerald-500/10'}`} title={inv.is_paid ? 'Segna come Da Pagare' : 'Segna come Pagato'}>
                          {inv.is_paid ? <XCircle size={20} /> : <CheckCircle size={20} />}
                        </button>
                      </div>
                      {inv.invoice_data ? (
                        <button onClick={() => downloadPDF(inv)} className="flex items-center gap-2 px-4 py-2 bg-brand-blue hover:bg-sky-400 text-brand-black font-bold rounded-lg transition-colors">
                          <FileText size={16} /> PDF
                        </button>
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
    </div>
  );
};

export default InvoicesHistory;
