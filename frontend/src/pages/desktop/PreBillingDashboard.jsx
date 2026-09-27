import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Select from 'react-select';
import { Calculator, Download, Loader2, ReceiptText, Plus, Trash2, Edit2, Check, Eye, EyeOff, LayoutList, History } from 'lucide-react';
import { appAlert } from '../../utils/alerts';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const PreBillingDashboard = () => {
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [includeHistorical, setIncludeHistorical] = useState(true);
  const [vatRate, setVatRate] = useState(22);
  
  const [reportData, setReportData] = useState(null);
  const [invoiceItems, setInvoiceItems] = useState([]);
  const [palletDetails, setPalletDetails] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  // Manual Row
  const [rules, setRules] = useState([]);
  const [showAddRow, setShowAddRow] = useState(false);
  const [newRow, setNewRow] = useState({ type: 'SERVICE', description: '', qty: 1, price: 0 });
  
  const [companySettings, setCompanySettings] = useState({});

  const getToken = () => localStorage.getItem('maglite_token');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [custRes, setRes, rulesRes] = await Promise.all([
          axios.get(`http://${window.location.hostname}:3000/api/customers`, { headers: { Authorization: `Bearer ${getToken()}` } }),
          axios.get(`http://${window.location.hostname}:3000/api/settings`, { headers: { Authorization: `Bearer ${getToken()}` } }),
          axios.get(`http://${window.location.hostname}:3000/api/billing/rules`, { headers: { Authorization: `Bearer ${getToken()}` } })
        ]);
        setCustomers(custRes.data.map(c => ({ value: c.id, label: c.business_name, raw: c })));
        setCompanySettings(setRes.data);
        setRules(rulesRes.data.filter(r => ['MANUAL', 'DISCOUNT_PERCENT', 'DISCOUNT_FIXED'].includes(r.rule_type)));
      } catch (err) {
        console.error(err);
      }
    };
    fetchData();
  }, []);

  const handleCalculate = async () => {
    if (!selectedCustomer) return appAlert('Seleziona un cliente');
    setIsGenerating(true);
    try {
      const res = await axios.post(`http://${window.location.hostname}:3000/api/billing/calculate`, {
        clientId: selectedCustomer.value, month, year, includeHistorical
      }, { headers: { Authorization: `Bearer ${getToken()}` } });
      
      setReportData(res.data);
      setInvoiceItems(res.data.items.map(i => ({ ...i, visible: true, isEditing: false })));
      setPalletDetails((res.data.palletDetails || []).map(p => ({ ...p, visibleInPdf: false })));
      setShowDetails(false);
    } catch (err) {
      appAlert('Errore durante il calcolo del report');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleItemChange = (id, field, value) => {
    setInvoiceItems(prev => prev.map(item => {
      if (item.id === id) {
        const updated = { ...item, [field]: value };
        if (field === 'qty' || field === 'price') {
          updated.subtotal = parseFloat(updated.qty) * parseFloat(updated.price);
        }
        return updated;
      }
      return item;
    }));
  };

  const removeItem = (id) => setInvoiceItems(prev => prev.filter(i => i.id !== id));
  const toggleVisibility = (id) => setInvoiceItems(prev => prev.map(i => i.id === id ? { ...i, visible: !i.visible } : i));
  const toggleEdit = (id) => setInvoiceItems(prev => prev.map(i => i.id === id ? { ...i, isEditing: !i.isEditing } : i));
  const togglePalletPdf = (code) => setPalletDetails(prev => prev.map(p => p.pallet_code === code ? { ...p, visibleInPdf: !p.visibleInPdf } : p));
  const toggleAllPalletsPdf = (checked) => setPalletDetails(prev => prev.map(p => ({ ...p, visibleInPdf: checked })));

  const handleRuleSelect = (val) => {
    if (val === 'CUSTOM_SERVICE') setNewRow({ type: 'SERVICE', description: '', qty: 1, price: 0 });
    else if (val === 'CUSTOM_DISCOUNT_FIXED') setNewRow({ type: 'DISCOUNT_FIXED', description: '', qty: 1, price: 0 });
    else if (val === 'CUSTOM_DISCOUNT_PERCENT') setNewRow({ type: 'DISCOUNT_PERCENT', description: '', qty: 1, price: 0 });
    else {
        const r = rules.find(x => x.id === parseInt(val));
        if (r) setNewRow({ type: r.rule_type === 'MANUAL' ? 'SERVICE' : r.rule_type, description: r.description, qty: 1, price: r.default_price });
    }
  };

  const handleAddManualRow = () => {
    if (!newRow.description) return appAlert('Inserisci una descrizione');
    
    let subtotal = 0;
    let price = newRow.price;
    let qty = newRow.qty;
    let group = 'EXTRA';
    let code = 'MANUAL';

    if (newRow.type === 'DISCOUNT_PERCENT') {
        subtotal = 0;
        group = 'SCONTI';
        code = 'DISCOUNT_PERCENT';
    } else if (newRow.type === 'DISCOUNT_FIXED') {
        subtotal = Math.abs(qty * price) * -1;
        price = Math.abs(price) * -1;
        group = 'SCONTI';
        code = 'DISCOUNT_FIXED';
    } else {
        subtotal = qty * price;
    }

    setInvoiceItems(prev => [...prev, {
      id: Math.random().toString(36).substring(7),
      code,
      group,
      description: newRow.description,
      qty,
      price,
      subtotal,
      visible: true,
      isEditing: false
    }]);
    
    setShowAddRow(false);
    setNewRow({ type: 'SERVICE', description: '', qty: 1, price: 0 });
  };

  const { finalTotal, baseTotal, vatAmount, grandTotal } = React.useMemo(() => {
    let base = 0;
    invoiceItems.filter(i => i.visible && i.code !== 'DISCOUNT_PERCENT').forEach(i => {
        base += i.subtotal;
    });
    
    let final = base;
    const percentDiscounts = invoiceItems.filter(i => i.visible && i.code === 'DISCOUNT_PERCENT');
    percentDiscounts.forEach(discount => {
        const discountAmt = base * (Math.abs(discount.price) / 100);
        discount.subtotal = -discountAmt;
        final -= discountAmt;
    });

    const vat = final * (vatRate / 100);
    const grand = final + vat;

    return { finalTotal: final, baseTotal: base, vatAmount: vat, grandTotal: grand };
  }, [invoiceItems, vatRate]);

  const exportPDF = () => {
    if (!reportData) return;
    const doc = new jsPDF();
    const cust = selectedCustomer.raw;

    try {
      const img = document.querySelector('img[alt="Logo"]') || new Image();
      img.src = '/logo.png';
      doc.addImage(img, 'PNG', 14, 15, 20, 20);
    } catch(e) {}

    doc.setFontSize(22);
    doc.setFont("helvetica", "bold");
    doc.text(companySettings.company_name || 'La Mia Azienda', 38, 25);
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    let startY = 32;
    if (companySettings.company_address) { doc.text(companySettings.company_address, 38, startY); startY+=5; }
    if (companySettings.company_piva) { doc.text(`P.IVA: ${companySettings.company_piva}`, 38, startY); startY+=5; }
    if (companySettings.company_cf) { doc.text(`CF: ${companySettings.company_cf}`, 38, startY); startY+=5; }
    if (companySettings.company_email) { doc.text(`Email: ${companySettings.company_email}`, 38, startY); }

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text('Spett.le', 120, 25);
    doc.setFontSize(14);
    doc.text(cust.business_name || '', 120, 32);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    const addrLines = doc.splitTextToSize(cust.address || '', 70);
    doc.text(addrLines, 120, 38);
    doc.text(`P.IVA: ${cust.vat_number || ''}`, 120, 38 + (addrLines.length * 5));

    doc.setLineWidth(0.5);
    doc.line(14, 60, 196, 60);
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(`PROFORMA FATTURA - PERIODO ${reportData.period}`, 14, 70);

    const visibleItems = invoiceItems.filter(i => i.visible);
    const tableData = visibleItems.map(i => {
      let qtyStr = i.code === 'DISCOUNT_PERCENT' ? '-' : i.qty.toString();
      let priceStr = i.code === 'DISCOUNT_PERCENT' ? `${Math.abs(i.price)} %` : `${parseFloat(i.price).toFixed(2)} EUR`;
      return [
        i.description,
        qtyStr,
        priceStr,
        `${parseFloat(i.subtotal).toFixed(2)} EUR`
      ];
    });

    autoTable(doc, {
      startY: 75,
      head: [['Descrizione Servizio / Sconto', 'Q.ta', 'Prezzo / %', 'Importo']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [14, 165, 233], textColor: [255,255,255], fontStyle: 'bold' },
      styles: { fontSize: 10, cellPadding: 4 },
      columnStyles: { 
        1: { halign: 'center', cellWidth: 20 },
        2: { halign: 'right', cellWidth: 35 },
        3: { halign: 'right', cellWidth: 35 }
      }
    });

    const finalY = doc.lastAutoTable.finalY + 10;
    
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text('IMPONIBILE:', 150, finalY, { align: 'right' });
    doc.text(`${finalTotal.toFixed(2)} EUR`, 196, finalY, { align: 'right' });

    doc.setFont("helvetica", "normal");
    doc.text(`IVA (${vatRate}%):`, 150, finalY + 7, { align: 'right' });
    doc.text(`${vatAmount.toFixed(2)} EUR`, 196, finalY + 7, { align: 'right' });

    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text('TOTALE DOCUMENTO:', 150, finalY + 16, { align: 'right' });
    doc.text(`${grandTotal.toFixed(2)} EUR`, 196, finalY + 16, { align: 'right' });

    if (vatRate === 0) {
      doc.setFontSize(9);
      doc.setFont("helvetica", "italic");
      doc.text("* Operazione esente da IVA ai sensi della normativa vigente.", 14, finalY + 25);
    }

    const pageHeight = doc.internal.pageSize.height;
    if (companySettings.company_iban) {
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.text(`Coordinate Bancarie (IBAN): ${companySettings.company_iban}`, 14, pageHeight - 15);
    }

    const palletsToPrint = palletDetails.filter(p => p.visibleInPdf);
    if (palletsToPrint.length > 0) {
      doc.addPage();
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text(`DETTAGLIO PALETTE MOVIMENTATE / GIACENTI (${reportData.period})`, 14, 20);

      const palletTableData = palletsToPrint.map(p => [
        p.pallet_code,
        p.product_name || '-',
        p.batch || '-',
        `${p.quantity} ${p.pallet_uom}`,
        new Date(p.created_at).toLocaleDateString(),
        p.shipped_at ? new Date(p.shipped_at).toLocaleDateString() : 'In Giacenza',
        p.flags || '-'
      ]);

      autoTable(doc, {
        startY: 30,
        head: [['Codice Paletta', 'Articolo', 'Lotto', 'Quantita', 'Data Ingresso', 'Data Uscita', 'Flag']],
        body: palletTableData,
        theme: 'striped',
        headStyles: { fillColor: [51, 65, 85], textColor: [255,255,255] },
        styles: { fontSize: 8, cellPadding: 2 }
      });
    }

    doc.save(`Proforma_${cust.business_name.replace(/\s/g, '_')}_${reportData.period.replace('/', '_')}.pdf`);

    axios.post(`http://${window.location.hostname}:3000/api/finances/invoices`, { customer_id: selectedCustomer.value, period_month: month, period_year: year, base_total: baseTotal, vat_amount: vatAmount, grand_total: grandTotal }, { headers: { Authorization: `Bearer ${getToken()}` } }).then(() => appAlert('Proforma archiviata correttamente nel registro storico!')).catch(() => console.error('Impossibile archiviare la fattura'));
  };

  const selectStyles = {
    control: (base) => ({ ...base, backgroundColor: '#020617', borderColor: '#334155', color: '#f8fafc' }),
    menu: base => ({ ...base, backgroundColor: '#0f172a', border: '1px solid #1e293b' }),
    option: (base, state) => ({ ...base, backgroundColor: state.isFocused ? '#1e293b' : 'transparent', color: '#f8fafc' }),
    singleValue: base => ({ ...base, color: '#f8fafc' })
  };

  const months = Array.from({length: 12}, (_, i) => ({ value: i+1, label: new Date(2000, i, 1).toLocaleString('it-IT', {month:'long'}) }));
  const currentYear = new Date().getFullYear();
  const years = [currentYear - 1, currentYear, currentYear + 1].map(y => ({ value: y, label: y.toString() }));

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-brand-black min-h-screen">
      <div className="max-w-7xl mx-auto animate-fade-in-up">
        
        <div className="mb-8 flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-bold text-brand-white mb-2 flex items-center gap-3">
              <ReceiptText className="text-brand-blue" size={32} />
              Pre-Fatturazione Interattiva
            </h1>
            <p className="text-slate-400">Calcola, modifica i prezzi al volo, aggiungi sconti e genera la Proforma PDF con il dettaglio palette.</p>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl mb-8">
          <div className="flex flex-wrap gap-4 items-end mb-4">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-slate-400 font-bold mb-2 text-xs uppercase">Cliente</label>
              <Select options={customers} styles={selectStyles} placeholder="Cerca..." value={selectedCustomer} onChange={setSelectedCustomer} />
            </div>
            <div className="w-48">
              <label className="block text-slate-400 font-bold mb-2 text-xs uppercase">Mese</label>
              <Select options={months} styles={selectStyles} value={months.find(m => m.value === month)} onChange={v => setMonth(v.value)} />
            </div>
            <div className="w-32">
              <label className="block text-slate-400 font-bold mb-2 text-xs uppercase">Anno</label>
              <Select options={years} styles={selectStyles} value={years.find(y => y.value === year)} onChange={v => setYear(v.value)} />
            </div>
            <button onClick={handleCalculate} disabled={isGenerating || !selectedCustomer} className="px-6 py-2.5 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-xl font-bold transition-all disabled:opacity-50 flex items-center gap-2 h-10">
              {isGenerating ? <Loader2 className="animate-spin" /> : <Calculator size={18} />}
              Calcola
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="storico" checked={includeHistorical} onChange={e => setIncludeHistorical(e.target.checked)} className="rounded border-slate-700 bg-slate-800 text-brand-blue focus:ring-brand-blue" />
            <label htmlFor="storico" className="text-sm font-bold text-slate-400 flex items-center gap-2"><History size={16}/> Includi Storico Giacenze (Palette precedenti a questo mese)</label>
          </div>
        </div>

        {reportData && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 animate-fade-in-up">
            
            <div className="xl:col-span-2 space-y-6">
              
              <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
                <div className="p-4 bg-slate-950 flex flex-wrap gap-4 justify-between items-center border-b border-slate-800">
                  <h2 className="font-bold text-white flex items-center gap-2"><ReceiptText size={18}/> Voci Proforma</h2>
                  <div className="flex gap-2">
                    <button onClick={() => setShowAddRow(!showAddRow)} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-brand-blue rounded-lg text-xs font-bold flex items-center gap-2"><Plus size={14}/> Sconto / Servizio Extra</button>
                    <button onClick={() => setShowDetails(!showDetails)} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-500 rounded-lg text-xs font-bold flex items-center gap-2"><LayoutList size={14}/> Dettaglio Palette</button>
                  </div>
                </div>
                
                {showAddRow && (
                  <div className="p-4 bg-slate-800/50 border-b border-slate-800 grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-slate-400 mb-1">Seleziona Da Regole Salvate (o scrivi lib.)</label>
                      <select onChange={e => handleRuleSelect(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-brand-blue outline-none">
                        <option value="CUSTOM_SERVICE">-- Servizio Libero --</option>
                        <option value="CUSTOM_DISCOUNT_FIXED">-- Sconto Libero Fisso (EUR) --</option>
                        <option value="CUSTOM_DISCOUNT_PERCENT">-- Sconto Libero Perc. (%) --</option>
                        <optgroup label="Le tue regole in Anagrafica">
                          {rules.map(r => <option key={r.id} value={r.id}>{r.description}</option>)}
                        </optgroup>
                      </select>
                    </div>
                    <div className="md:col-span-3">
                      <label className="block text-xs font-bold text-slate-400 mb-1">Descrizione Voce in Fattura</label>
                      <input type="text" placeholder="Es. Scarico Manuale Container" value={newRow.description} onChange={e => setNewRow({...newRow, description: e.target.value})} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-sm text-white focus:border-brand-blue outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 mb-1">{newRow.type === 'DISCOUNT_PERCENT' ? '-' : 'Q.ta'}</label>
                      <input type="number" disabled={newRow.type === 'DISCOUNT_PERCENT'} value={newRow.type === 'DISCOUNT_PERCENT' ? 1 : newRow.qty} onChange={e => setNewRow({...newRow, qty: parseFloat(e.target.value)})} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-sm text-white text-center focus:border-brand-blue outline-none disabled:opacity-50" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 mb-1">{newRow.type === 'DISCOUNT_PERCENT' ? 'Percentuale %' : 'Prezzo Unitario'}</label>
                      <input type="number" step="0.01" placeholder="0.00" value={newRow.price} onChange={e => setNewRow({...newRow, price: parseFloat(e.target.value)})} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-sm text-white text-right focus:border-brand-blue outline-none" />
                    </div>
                    <div className="md:col-span-3 flex justify-end">
                      <button onClick={handleAddManualRow} className="bg-brand-blue hover:bg-sky-400 text-brand-black font-bold px-6 py-2 rounded-lg text-sm transition-colors">Conferma Aggiunta</button>
                    </div>
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-950/50 text-slate-400 uppercase">
                      <tr>
                        <th className="p-3">Descrizione</th>
                        <th className="p-3 text-center">Q.ta</th>
                        <th className="p-3 text-right">Prezzo Unit. / %</th>
                        <th className="p-3 text-right">Importo</th>
                        <th className="p-3 text-center">Azioni</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-200">
                      {invoiceItems.map((item) => (
                        <tr key={item.id} className={`border-b border-slate-800/50 ${!item.visible ? 'opacity-30 bg-slate-950' : 'hover:bg-slate-800/30'}`}>
                          <td className="p-3">
                            {item.isEditing ? (
                              <input type="text" value={item.description} onChange={e => handleItemChange(item.id, 'description', e.target.value)} className="w-full bg-slate-950 border border-brand-blue p-1 rounded outline-none" />
                            ) : (
                              <div className="font-semibold text-white">{item.description} <span className="text-[10px] text-slate-500 ml-2">[{item.code}]</span></div>
                            )}
                          </td>
                          <td className="p-3 text-center font-mono">
                            {item.code === 'DISCOUNT_PERCENT' ? '-' : (
                              item.isEditing ? (
                                <input type="number" value={item.qty} onChange={e => handleItemChange(item.id, 'qty', e.target.value)} className="w-16 bg-slate-950 border border-brand-blue p-1 rounded text-center outline-none" />
                              ) : item.qty
                            )}
                          </td>
                          <td className="p-3 text-right">
                            {item.isEditing ? (
                              <input type="number" step="0.01" value={item.price} onChange={e => handleItemChange(item.id, 'price', e.target.value)} className="w-20 bg-slate-950 border border-brand-blue p-1 rounded text-right outline-none" />
                            ) : (
                              item.code === 'DISCOUNT_PERCENT' ? `${Math.abs(item.price)}%` : `EUR ${parseFloat(item.price).toFixed(2)}`
                            )}
                          </td>
                          <td className={`p-3 text-right font-bold ${item.subtotal < 0 ? 'text-rose-400' : 'text-brand-blue'}`}>
                            EUR {parseFloat(item.subtotal).toFixed(2)}
                          </td>
                          <td className="p-3 flex justify-center gap-2">
                            <button onClick={() => toggleVisibility(item.id)} className="text-slate-400 hover:text-white" title="Mostra/Nascondi in PDF">
                              {item.visible ? <Eye size={16} /> : <EyeOff size={16} />}
                            </button>
                            <button onClick={() => toggleEdit(item.id)} className="text-slate-400 hover:text-sky-400" title="Modifica">
                              {item.isEditing ? <Check size={16} className="text-emerald-400"/> : <Edit2 size={16} />}
                            </button>
                            <button onClick={() => removeItem(item.id)} className="text-slate-400 hover:text-rose-500" title="Elimina">
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {showDetails && (
                <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl p-6 animate-fade-in-up">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-amber-500 font-bold flex items-center gap-2"><LayoutList size={18}/> Dettaglio Palette Coinvolte</h3>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" id="selectAllPdf" onChange={e => toggleAllPalletsPdf(e.target.checked)} className="rounded border-slate-700 bg-slate-800 text-brand-blue focus:ring-brand-blue" />
                      <label htmlFor="selectAllPdf" className="text-xs font-bold text-slate-300">Seleziona tutte per il PDF</label>
                    </div>
                  </div>
                  
                  <div className="max-h-96 overflow-y-auto text-xs text-slate-300 space-y-2 pr-2">
                    {palletDetails.map(p => (
                      <div key={p.pallet_code} className={`flex flex-col md:flex-row gap-4 justify-between p-3 rounded-lg border transition-colors ${p.visibleInPdf ? 'bg-slate-800/80 border-brand-blue/50' : 'bg-slate-950 border-slate-800'}`}>
                        <div className="flex items-center gap-3">
                          <input type="checkbox" checked={p.visibleInPdf} onChange={() => togglePalletPdf(p.pallet_code)} className="rounded border-slate-700 bg-slate-900 text-brand-blue focus:ring-brand-blue" />
                          <div>
                            <div className="font-mono text-brand-blue font-bold">{p.pallet_code}</div>
                            <div className="text-white font-semibold">{p.product_name || 'Articolo Sconosciuto'}</div>
                            <div className="text-slate-500">Lotto: {p.batch || '-'} | Q.ta: {p.quantity} {p.pallet_uom}</div>
                          </div>
                        </div>
                        <div className="text-right flex flex-col justify-center">
                          <div className="text-slate-400">IN: <span className="text-white">{new Date(p.created_at).toLocaleDateString()}</span></div>
                          <div className="text-slate-400">OUT: <span className="text-white">{p.shipped_at ? new Date(p.shipped_at).toLocaleDateString() : 'In Giacenza'}</span></div>
                          {p.flags && <div className="text-emerald-400 font-mono text-[10px] mt-1">{p.flags}</div>}
                        </div>
                      </div>
                    ))}
                    {palletDetails.length === 0 && <div className="text-slate-500 italic text-center py-4">Nessuna paletta movimentata o giacente nel periodo selezionato.</div>}
                  </div>
                </div>
              )}

            </div>

            <div className="space-y-6">
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl sticky top-8">
                <h3 className="text-xl font-bold text-white mb-6">Riepilogo Totali</h3>
                
                <div className="space-y-4 mb-6">
                  <div className="flex justify-between text-slate-400">
                    <span>Totale Servizi (Lordo)</span>
                    <span>EUR {baseTotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Totale Sconti</span>
                    <span className="text-rose-400">EUR {(baseTotal - finalTotal).toFixed(2)}</span>
                  </div>
                  <div className="pt-2 border-t border-slate-800 flex justify-between items-center">
                    <span className="text-lg font-bold text-slate-300">Imponibile</span>
                    <span className="text-xl font-bold text-white">EUR {finalTotal.toFixed(2)}</span>
                  </div>
                  
                  <div className="flex justify-between items-center bg-slate-950 p-2 rounded-lg">
                    <label className="text-slate-400 font-bold text-sm">Aliquota IVA (%)</label>
                    <select value={vatRate} onChange={e => setVatRate(parseFloat(e.target.value))} className="bg-slate-800 text-white font-bold rounded p-1 text-right">
                      <option value="22">22%</option>
                      <option value="10">10%</option>
                      <option value="4">4%</option>
                      <option value="0">0% (Esente)</option>
                    </select>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Imposta IVA</span>
                    <span>EUR {vatAmount.toFixed(2)}</span>
                  </div>

                  <div className="pt-4 border-t border-slate-800 flex justify-between items-center">
                    <span className="text-xl font-bold text-white">TOTALE</span>
                    <span className="text-3xl font-black text-emerald-400">EUR {grandTotal.toFixed(2)}</span>
                  </div>
                </div>

                <button onClick={exportPDF} className="w-full py-4 bg-slate-100 hover:bg-white text-slate-900 rounded-xl font-black text-lg transition-all shadow-lg flex items-center justify-center gap-2">
                  <Download size={24} /> Scarica Proforma PDF
                </button>
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  );
};

export default PreBillingDashboard;
