import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import Select from 'react-select';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Calculator, Download, Loader2, ReceiptText, Plus, Trash2, Edit2, Check,
  Eye, EyeOff, GitBranch, Boxes, Coins, Building2, Layers, SlidersHorizontal,
  ArrowUpRight, ArrowDownLeft, X, Package, MapPin, Calendar, Clock,
  FileText, User, Tag, Search, ExternalLink, MessageSquare, Sparkles, Archive
} from 'lucide-react';
import { appAlert } from '../../utils/alerts';
import { generateProformaPdf, formatDateIT, DEFAULT_PDF_OPTIONS } from '../../utils/invoicePdf';
import { io } from 'socket.io-client';
import FinanceAdminNav from '../../components/FinanceAdminNav';

const PDF_FIELDS_CONFIG = [
  { key: 'showSku', label: 'Cod. Articolo / SKU' },
  { key: 'showBatch', label: 'Lotto' },
  { key: 'showWeights', label: 'KG Netti / Lordi' },
  { key: 'showExpiration', label: 'Scadenza' },
  { key: 'showArrival', label: 'Data Arrivo (IN)' },
  { key: 'showDeparture', label: 'Uscita / Stato' },
  { key: 'showQtyDays', label: 'Q.tà & Gg Sosta' },
  { key: 'showCharges', label: 'Causali Addebiti' },
  { key: 'showNotes', label: 'Note Paletta' },
  { key: 'showLocation', label: 'Posizione Scaffale' },
  { key: 'showClientRef', label: 'Rif. Paletta Cliente' },
  { key: 'showTags', label: 'Tag / Flag' },
  { key: 'showSummaryLines', label: 'Barra Conteggi Rapidi' },
  { key: 'showGoodsTable', label: 'Tabella Dettaglio Bancali' },
  { key: 'showTariffSummary', label: 'Tabella Riepilogo Voci' }
];

const PreBillingDashboard = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [rawCustomers, setRawCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());

  // Opzioni personalizzazione PDF salvate in locale
  const [pdfOptions, setPdfOptions] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('maglite_billing_pdf_options') || 'null');
      return saved ? { ...DEFAULT_PDF_OPTIONS, ...saved } : { ...DEFAULT_PDF_OPTIONS };
    } catch {
      return { ...DEFAULT_PDF_OPTIONS };
    }
  });
  const [showPdfCustomizer, setShowPdfCustomizer] = useState(false);
  const [vatRate, setVatRate] = useState(22);

  const togglePdfOption = (key) => {
    setPdfOptions(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem('maglite_billing_pdf_options', JSON.stringify(next));
      } catch (_) {}
      return next;
    });
  };

  const [reportData, setReportData] = useState(null);
  const [invoiceItems, setInvoiceItems] = useState([]);
  const [palletDetails, setPalletDetails] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Pop-up Dettaglio & Storico Paletta Cliccabile
  const [palletModal, setPalletModal] = useState({
    show: false,
    loading: false,
    code: null,
    summary: null,
    historyData: null
  });

  // Manual Row
  const [rules, setRules] = useState([]);
  const [showAddRow, setShowAddRow] = useState(false);
  const [newRow, setNewRow] = useState({
    type: 'SERVICE',
    sectionId: '',
    description: '',
    qty: 1,
    price: 0
  });

  const [companySettings, setCompanySettings] = useState({});

  const getToken = () => localStorage.getItem('maglite_token');

  const formatCustomerOption = (c) => ({
    value: c.id,
    label: c.parent_id
      ? `└─ ${c.business_name} (Frammentazione di ${c.parent_business_name || c.parent_name || 'Cliente Madre'})`
      : `${c.business_name} ${Number(c.children_count) > 0 ? `[Cliente Madre • ${c.children_count} Frammentazioni]` : '[Cliente Madre]'}`,
    raw: c
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [custRes, setRes, rulesRes] = await Promise.all([
          axios.get(`http://${window.location.hostname}:3000/api/customers`, { headers: { Authorization: `Bearer ${getToken()}` } }),
          axios.get(`http://${window.location.hostname}:3000/api/settings`, { headers: { Authorization: `Bearer ${getToken()}` } }),
          axios.get(`http://${window.location.hostname}:3000/api/billing/rules`, { headers: { Authorization: `Bearer ${getToken()}` } })
        ]);
        const list = custRes.data || [];
        setRawCustomers(list);
        setCompanySettings(setRes.data || {});
        setRules((rulesRes.data || []).filter(r => ['MANUAL', 'DISCOUNT_PERCENT', 'DISCOUNT_FIXED'].includes(r.rule_type)));

        const paramClientId = searchParams.get('clientId');
        if (paramClientId) {
          const found = list.find(c => String(c.id) === String(paramClientId));
          if (found) {
            setSelectedCustomer(formatCustomerOption(found));
          }
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchData();

    const socket = io(`http://${window.location.hostname}:3000`);
    socket.on('billing_updated', fetchData);
    return () => socket.disconnect();
  }, []);

  const customerOptions = useMemo(() => {
    const parents = rawCustomers.filter(c => !c.parent_id);
    const ordered = [];
    parents.forEach(p => {
      ordered.push(formatCustomerOption(p));
      rawCustomers
        .filter(ch => ch.parent_id === p.id)
        .forEach(ch => ordered.push(formatCustomerOption(ch)));
    });
    return ordered;
  }, [rawCustomers]);

  const handleCalculate = async (overrideClientId) => {
    const targetId = overrideClientId || selectedCustomer?.value;
    if (!targetId) return appAlert('Seleziona un cliente');
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      const res = await axios.post(`http://${window.location.hostname}:3000/api/billing/calculate`, {
        clientId: targetId,
        month,
        year,
        storageMode: 'AUTO'
      }, { headers: { Authorization: `Bearer ${getToken()}` } });

      setReportData(res.data);
      setInvoiceItems((res.data.items || []).map(i => ({ ...i, visible: true, isEditing: false })));
      setPalletDetails((res.data.palletDetails || []).map(p => ({
        ...p,
        visibleInPdf: true,
        customNote: p.notes || '',
        customPrice: p.totalPrice !== undefined ? parseFloat(p.totalPrice) : 0
      })));
      if (res.data.sections?.length > 0) {
        setNewRow(prev => ({ ...prev, sectionId: res.data.sections[0].sectionId }));
      }
    } catch (err) {
      appAlert('Errore durante il calcolo del report');
    } finally {
      setIsGenerating(false);
    }
  };

  // Apre il pop-up con tutti i dettagli e lo storico completo della paletta
  const openPalletHistoryModal = async (palletCode, summaryObj = null) => {
    if (!palletCode) return;
    const foundPallet = palletDetails.find(p => p.pallet_code === palletCode) || summaryObj;
    setPalletModal({
      show: true,
      loading: true,
      code: palletCode,
      summary: foundPallet,
      historyData: null
    });
    try {
      const res = await axios.get(
        `http://${window.location.hostname}:3000/api/billing/pallet/${encodeURIComponent(palletCode)}/history`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      setPalletModal(prev => ({
        ...prev,
        loading: false,
        historyData: res.data
      }));
    } catch (err) {
      setPalletModal(prev => ({ ...prev, loading: false }));
    }
  };

  const updatePalletDetail = (sectionId, palletCode, updates) => {
    setPalletDetails(prev =>
      prev.map(p =>
        String(p.sectionId) === String(sectionId) && p.pallet_code === palletCode
          ? { ...p, ...updates }
          : p
      )
    );
  };

  const handleItemChange = (id, field, value) => {
    setInvoiceItems(prev => prev.map(item => {
      if (item.id === id) {
        const updated = { ...item, [field]: value };
        if (field === 'qty' || field === 'price') {
          updated.subtotal = (parseFloat(updated.qty) || 0) * (parseFloat(updated.price) || 0);
        }
        return updated;
      }
      return item;
    }));
  };

  const removeItem = (id) => setInvoiceItems(prev => prev.filter(i => i.id !== id));
  const toggleVisibility = (id) => setInvoiceItems(prev => prev.map(i => i.id === id ? { ...i, visible: !i.visible } : i));
  const toggleEdit = (id) => setInvoiceItems(prev => prev.map(i => i.id === id ? { ...i, isEditing: !i.isEditing } : i));

  const handleRuleSelect = async (val) => {
    if (val === 'CUSTOM_SERVICE') setNewRow(prev => ({ ...prev, type: 'SERVICE', description: '', qty: 1, price: 0 }));
    else if (val === 'CUSTOM_DISCOUNT_FIXED') setNewRow(prev => ({ ...prev, type: 'DISCOUNT_FIXED', description: '', qty: 1, price: 0 }));
    else if (val === 'CUSTOM_DISCOUNT_PERCENT') setNewRow(prev => ({ ...prev, type: 'DISCOUNT_PERCENT', description: '', qty: 1, price: 0 }));
    else {
      const r = rules.find(x => x.id === parseInt(val));
      if (r) {
        let resolvedPrice = r.default_price;
        const targetClientId = newRow.sectionId || selectedCustomer?.value;
        if (targetClientId) {
          try {
            const tRes = await axios.get(`http://${window.location.hostname}:3000/api/billing/tariffs/${targetClientId}`, {
              headers: { Authorization: `Bearer ${getToken()}` }
            });
            const match = (tRes.data || []).find(t => t.rule_code === r.rule_code);
            if (match && match.final_price !== undefined && match.final_price !== null) {
              resolvedPrice = match.final_price;
            }
          } catch {
            // fallback to default_price
          }
        }
        setNewRow(prev => ({
          ...prev,
          type: r.rule_type === 'MANUAL' ? 'SERVICE' : r.rule_type,
          description: r.description,
          qty: 1,
          price: resolvedPrice
        }));
      }
    }
  };

  const handleAddManualRow = () => {
    if (!newRow.description) return appAlert('Inserisci una descrizione');

    let subtotal = 0;
    let price = parseFloat(newRow.price) || 0;
    let qty = parseFloat(newRow.qty) || 1;
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

    const targetSection = reportData?.sections?.find(s => String(s.sectionId) === String(newRow.sectionId)) || reportData?.sections?.[0];

    setInvoiceItems(prev => [...prev, {
      id: Math.random().toString(36).substring(2, 9),
      sectionId: targetSection ? targetSection.sectionId : selectedCustomer?.value,
      sectionName: targetSection ? targetSection.sectionName : selectedCustomer?.raw?.business_name,
      code,
      group,
      description: newRow.description,
      palletCodes: [],
      palletsList: [],
      qty,
      price,
      subtotal,
      visible: true,
      isEditing: false,
      isManual: true
    }]);

    setShowAddRow(false);
    setNewRow(prev => ({ ...prev, type: 'SERVICE', description: '', qty: 1, price: 0 }));

    // Registra azione in Storico Fatturazioni
    try {
      const isDiscount = code === 'DISCOUNT_PERCENT' || code === 'DISCOUNT_FIXED';
      axios.post(`http://${window.location.hostname}:3000/api/billing/audit-logs`, {
        action: isDiscount ? 'PREBILLING_DISCOUNT' : 'PREBILLING_MANUAL_ITEM',
        customer_id: selectedCustomer?.value || null,
        customer_name: selectedCustomer?.raw?.business_name || targetSection?.sectionName || null,
        entity_ref: `${month}/${year}`,
        details: `${isDiscount ? 'Aggiunto sconto' : 'Aggiunta voce manuale'} in Pre-Fatturazione (${month}/${year}): "${newRow.description}" • Q.tà ${qty} × ${code === 'DISCOUNT_PERCENT' ? `${Math.abs(price)}%` : `€${price.toFixed(2)}`}`,
        metadata: { code, group, description: newRow.description, qty, price, subtotal }
      }, { headers: { Authorization: `Bearer ${getToken()}` } }).catch(() => {});
    } catch (_) {}
  };

  // Calcolo totali per singola Frammentazione e Totale Cliente Madre
  const { sectionTotalsMap, finalTotal, baseTotal, vatAmount, grandTotal } = useMemo(() => {
    const secMap = {};
    if (reportData?.sections) {
      reportData.sections.forEach(s => {
        secMap[s.sectionId] = 0;
      });
    }

    let base = 0;
    invoiceItems.filter(i => i.visible && i.code !== 'DISCOUNT_PERCENT').forEach(i => {
      const sub = parseFloat(i.subtotal) || 0;
      base += sub;
      if (i.sectionId !== undefined) {
        secMap[i.sectionId] = (secMap[i.sectionId] || 0) + sub;
      }
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

    return { sectionTotalsMap: secMap, finalTotal: final, baseTotal: base, vatAmount: vat, grandTotal: grand };
  }, [invoiceItems, vatRate, reportData]);

  const saveProformaArchive = async () => {
    const cust = selectedCustomer.raw;
    const storageModeLabel = 'Calcolo automatico per paletta in base al listino assegnato';
    const visibleItems = invoiceItems.filter(i => i.visible);
    const visiblePallets = palletDetails.filter(p => p.visibleInPdf);

    await axios.post(`http://${window.location.hostname}:3000/api/finances/invoices`, {
      customer_id: selectedCustomer.value,
      period_month: month,
      period_year: year,
      base_total: finalTotal,
      vat_amount: vatAmount,
      grand_total: grandTotal,
      invoice_data: {
        clientName: cust.business_name,
        includeNotesInPdf: pdfOptions.showNotes,
        pdfOptions,
        storageMode: 'AUTO',
        storageModeLabel,
        sections: (reportData.sections || []).map(sec => ({
          ...sec,
          sectionTotal: sectionTotalsMap[sec.sectionId] || 0
        })),
        items: visibleItems,
        pallets: visiblePallets,
        vatRate,
        period: reportData.period
      }
    }, { headers: { Authorization: `Bearer ${getToken()}` } });

    return { cust, storageModeLabel, visibleItems, visiblePallets };
  };

  const handleSaveArchiveOnly = async () => {
    if (!reportData || isExporting) return;
    setIsExporting(true);
    try {
      await saveProformaArchive();
      appAlert('Proforma salvata correttamente nella cartella cliente dell\'Archivio Proforme!', 'Archiviata', 'success');
    } catch (err) {
      console.error(err);
      appAlert(err.response?.data?.error || 'Errore durante il salvataggio della proforma in archivio');
    } finally {
      setIsExporting(false);
    }
  };

  const exportPDF = async () => {
    if (!reportData || isExporting) return;
    setIsExporting(true);
    try {
      // Prima salva in Archivio Proforme, poi genera/scarica il PDF
      const { cust, storageModeLabel, visibleItems, visiblePallets } = await saveProformaArchive();

      await generateProformaPdf({
        companySettings,
        customer: cust,
        period: reportData.period,
        storageModeLabel,
        sections: reportData.sections || [],
        items: visibleItems,
        pallets: visiblePallets,
        sectionTotalsMap,
        includeNotesInPdf: pdfOptions.showNotes,
        pdfOptions,
        vatRate,
        baseTotal: finalTotal,
        vatAmount,
        grandTotal
      });

      appAlert('Proforma salvata in Archivio e PDF generato con successo!', 'Successo', 'success');
    } catch (err) {
      console.error(err);
      appAlert(err.response?.data?.error || 'Errore durante il salvataggio o generazione PDF della proforma');
    } finally {
      setIsExporting(false);
    }
  };

  const selectStyles = {
    control: (base) => ({ ...base, backgroundColor: '#020617', borderColor: '#334155', color: '#f8fafc', borderRadius: '0.75rem' }),
    menu: base => ({ ...base, backgroundColor: '#0f172a', border: '1px solid #1e293b', zIndex: 50 }),
    option: (base, state) => ({ ...base, backgroundColor: state.isFocused ? '#1e293b' : 'transparent', color: '#f8fafc' }),
    singleValue: base => ({ ...base, color: '#f8fafc' })
  };

  const months = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: new Date(2000, i, 1).toLocaleString('it-IT', { month: 'long' }) }));
  const currentYear = new Date().getFullYear();
  const years = [currentYear - 1, currentYear, currentYear + 1].map(y => ({ value: y, label: y.toString() }));

  return (
    <div className="flex-1 p-6 md:p-8 overflow-y-auto bg-brand-black min-h-screen">
      <div className="max-w-7xl mx-auto animate-fade-in-up">
        <FinanceAdminNav />
        {/* Header */}
        <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <h1 className="text-3xl font-bold text-brand-white mb-2 flex items-center gap-3">
              <ReceiptText className="text-brand-blue" size={32} />
              Pre-Fatturazione per Deposito & Frammentazioni
            </h1>
            <p className="text-slate-400">
              Fattura sul <b className="text-white">Cliente Madre</b> con dettaglio completo di <b className="text-brand-blue">Cod. Articolo, Prodotto, Lotto, Quantità, Rif. Paletta e Prezzo</b> suddiviso per ogni <b className="text-violet-300">Frammentazione</b>.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => navigate('/desktop/customers')}
              className="px-4 py-2.5 bg-slate-900 border border-slate-800 hover:border-violet-500/50 text-slate-300 hover:text-violet-300 rounded-xl text-xs font-bold flex items-center gap-2 transition-all"
            >
              <GitBranch size={15} /> Gestisci Frammentazioni
            </button>
            <button
              onClick={() => navigate(`/desktop/billing-tariffs${selectedCustomer ? `?clientId=${selectedCustomer.value}` : ''}`)}
              className="px-4 py-2.5 bg-slate-900 border border-slate-800 hover:border-amber-500/50 text-amber-400 rounded-xl text-xs font-bold flex items-center gap-2 transition-all"
            >
              <Coins size={15} /> Listini Prezzi
            </button>
          </div>
        </div>

        {/* Barra di controllo calcolo */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl mb-8">
          <div className="flex flex-wrap gap-4 items-end mb-5">
            <div className="flex-1 min-w-[260px]">
              <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">
                Cliente Madre (o singola Frammentazione)
              </label>
              <Select
                options={customerOptions}
                styles={selectStyles}
                placeholder="Seleziona Cliente Madre (es. LOGISTICA)..."
                value={selectedCustomer}
                onChange={setSelectedCustomer}
              />
            </div>
            <div className="w-48">
              <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Mese</label>
              <Select options={months} styles={selectStyles} value={months.find(m => m.value === month)} onChange={v => setMonth(v.value)} />
            </div>
            <div className="w-32">
              <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Anno</label>
              <Select options={years} styles={selectStyles} value={years.find(y => y.value === year)} onChange={v => setYear(v.value)} />
            </div>
            <button
              onClick={() => handleCalculate()}
              disabled={isGenerating || !selectedCustomer}
              className="px-6 py-2.5 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-xl font-black transition-all disabled:opacity-50 flex items-center gap-2 h-10 shadow-[0_0_20px_rgba(14,165,233,0.3)]"
            >
              {isGenerating ? <Loader2 className="animate-spin" size={18} /> : <Calculator size={18} />}
              Calcola Pre-Fattura
            </button>
          </div>

          {/* Se l'utente ha selezionato una frammentazione figlia, suggeriamo con 1 click di passare al Cliente Madre */}
          {selectedCustomer?.raw?.parent_id && (
            <div className="mb-4 p-3.5 rounded-2xl bg-violet-950/30 border border-violet-500/40 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-violet-200 flex items-center gap-2">
                <GitBranch size={16} className="text-violet-400" />
                Hai selezionato la frammentazione <b>{selectedCustomer.raw.business_name}</b>. La pre-fatturazione completa si esegue sul Cliente Madre <b>{selectedCustomer.raw.parent_business_name || selectedCustomer.raw.parent_name}</b> (che includerà tutte le sue frammentazioni).
              </div>
              <button
                onClick={() => {
                  const parentCust = rawCustomers.find(c => c.id === selectedCustomer.raw.parent_id);
                  if (parentCust) {
                    const opt = formatCustomerOption(parentCust);
                    setSelectedCustomer(opt);
                    handleCalculate(parentCust.id);
                  }
                }}
                className="px-3.5 py-1.5 bg-violet-500 hover:bg-violet-400 text-white rounded-xl text-xs font-bold transition-all"
              >
                Passa al Cliente Madre &ldquo;{selectedCustomer.raw.parent_business_name || selectedCustomer.raw.parent_name}&rdquo;
              </button>
            </div>
          )}

          {/* Banner informativo calcolo automatico + Personalizza PDF */}
          <div className="pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-xs text-slate-300 bg-brand-blue/10 border border-brand-blue/25 px-3.5 py-2 rounded-xl">
              <Sparkles size={15} className="text-brand-blue shrink-0" />
              <span>
                <b className="text-white">Calcolo Automatico Multilistino:</b> ogni paletta viene calcolata in base al proprio listino assegnato su <b className="text-brand-blue">Nuova Merce In</b> e raggruppata per Frammentazione e Listino.
              </span>
            </div>

            <button
              type="button"
              onClick={() => setShowPdfCustomizer(!showPdfCustomizer)}
              className={`px-4 py-2 rounded-xl border text-xs font-bold transition-all flex items-center gap-2 ${
                showPdfCustomizer
                  ? 'bg-violet-500 text-white border-violet-400 shadow'
                  : 'bg-slate-950 hover:bg-slate-800 text-violet-300 border-slate-700'
              }`}
            >
              <SlidersHorizontal size={14} />
              Personalizza Colonne &amp; Sezioni PDF
            </button>
          </div>

          {showPdfCustomizer && (
            <div className="mt-3 p-4 rounded-2xl bg-slate-950/90 border border-violet-500/35 space-y-3 animate-fade-in-up">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-black uppercase tracking-wider text-violet-300 flex items-center gap-1.5">
                  <FileText size={14} /> Campi e Sezioni Visibili nella Fattura PDF
                </span>
                <span className="text-[11px] text-slate-400">Le preferenze vengono salvate automaticamente per i prossimi PDF.</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                {PDF_FIELDS_CONFIG.map(f => {
                  const active = Boolean(pdfOptions[f.key]);
                  return (
                    <label
                      key={f.key}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer text-xs font-semibold transition-all select-none ${
                        active
                          ? 'bg-violet-500/15 border-violet-500/40 text-violet-100'
                          : 'bg-slate-900/70 border-slate-800 text-slate-500 hover:border-slate-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() => togglePdfOption(f.key)}
                        className="rounded border-slate-700 bg-slate-900 text-violet-500"
                      />
                      <span className="truncate">{f.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {reportData && (
          <>
            {/* KPI Summary Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6 animate-fade-in-up">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Bancali Coinvolti</div>
                <div className="text-2xl font-black text-white mt-1">{palletDetails.length}</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">In Deposito</div>
                <div className="text-2xl font-black text-emerald-400 mt-1">{palletDetails.filter(p => p.in_deposit).length}</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <div className="text-[10px] font-bold uppercase tracking-wider text-rose-400">Usciti / Spediti</div>
                <div className="text-2xl font-black text-rose-400 mt-1">{palletDetails.filter(p => !p.in_deposit).length}</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Giorni Sosta Mese</div>
                <div className="text-2xl font-black text-amber-400 mt-1">
                  {palletDetails.reduce((s, p) => s + (Number(p.storageDays) || 0), 0)} <span className="text-xs font-bold">gg</span>
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <div className="text-[10px] font-bold uppercase tracking-wider text-sky-400">Imponibile</div>
                <div className="text-2xl font-black text-sky-400 mt-1">€{finalTotal.toFixed(2)}</div>
              </div>
              <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-4">
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">Totale c/IVA</div>
                <div className="text-2xl font-black text-emerald-400 mt-1">€{grandTotal.toFixed(2)}</div>
              </div>
            </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 animate-fade-in-up">
            {/* COLONNA PRINCIPALE: SUDDIVISIONE PER FRAMMENTAZIONI */}
            <div className="xl:col-span-2 space-y-6">
              {/* Barra Azioni Proforma */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-wrap gap-4 justify-between items-center shadow-lg">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-brand-blue">
                    Pre-Fattura Suddivisa per Frammentazioni
                  </div>
                  <h2 className="text-xl font-black text-white flex items-center gap-2">
                    <Building2 size={20} className="text-brand-blue" />
                    Pre-Fattura per cliente {reportData.clientName}
                    <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300">
                      {reportData.period}
                    </span>
                  </h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setShowAddRow(!showAddRow)}
                    className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-brand-blue rounded-xl text-xs font-bold flex items-center gap-1.5 border border-slate-700"
                  >
                    <Plus size={14} /> Aggiungi Voce / Sconto
                  </button>
                </div>
              </div>

              {/* Pannello Aggiunta Voce Manuale o Sconto */}
              {showAddRow && (
                <div className="p-5 bg-slate-900 border border-brand-blue/40 rounded-3xl grid grid-cols-1 md:grid-cols-6 gap-4 items-end shadow-xl">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-slate-400 mb-1">Reparto / Frammentazione</label>
                    <select
                      value={newRow.sectionId}
                      onChange={e => setNewRow({ ...newRow, sectionId: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-sm text-white focus:border-brand-blue outline-none"
                    >
                      {(reportData.sections || []).map(sec => (
                        <option key={sec.sectionId} value={sec.sectionId}>
                          {sec.sectionName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-slate-400 mb-1">Tipo Regola</label>
                    <select
                      onChange={e => handleRuleSelect(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-sm text-white focus:border-brand-blue outline-none"
                    >
                      <option value="CUSTOM_SERVICE">-- Servizio Libero --</option>
                      <option value="CUSTOM_DISCOUNT_FIXED">-- Sconto Libero Fisso (EUR) --</option>
                      <option value="CUSTOM_DISCOUNT_PERCENT">-- Sconto Libero Perc. (%) --</option>
                      <optgroup label="Regole Salvate">
                        {rules.map(r => <option key={r.id} value={r.id}>{r.description}</option>)}
                      </optgroup>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-slate-400 mb-1">Descrizione in Fattura</label>
                    <input
                      type="text"
                      placeholder="Es. Scarico Manuale Container"
                      value={newRow.description}
                      onChange={e => setNewRow({ ...newRow, description: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-sm text-white focus:border-brand-blue outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 mb-1">{newRow.type === 'DISCOUNT_PERCENT' ? '-' : 'Q.ta'}</label>
                    <input
                      type="number"
                      disabled={newRow.type === 'DISCOUNT_PERCENT'}
                      value={newRow.type === 'DISCOUNT_PERCENT' ? 1 : newRow.qty}
                      onChange={e => setNewRow({ ...newRow, qty: parseFloat(e.target.value) })}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-sm text-white text-center focus:border-brand-blue outline-none disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 mb-1">{newRow.type === 'DISCOUNT_PERCENT' ? 'Percentuale %' : 'Prezzo Unitario'}</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={newRow.price}
                      onChange={e => setNewRow({ ...newRow, price: parseFloat(e.target.value) })}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-sm text-white text-right focus:border-brand-blue outline-none"
                    />
                  </div>
                  <div className="md:col-span-4 flex justify-end gap-2">
                    <button
                      onClick={() => setShowAddRow(false)}
                      className="px-4 py-2.5 bg-slate-800 text-slate-300 rounded-xl text-xs font-bold"
                    >
                      Annulla
                    </button>
                    <button
                      onClick={handleAddManualRow}
                      className="bg-brand-blue hover:bg-sky-400 text-brand-black font-black px-6 py-2.5 rounded-xl text-xs transition-colors"
                    >
                      Conferma Aggiunta
                    </button>
                  </div>
                </div>
              )}

              {/* Card per ogni Frammentazione / Sezione, suddivisa per Listino Globale */}
              {(reportData.sections || []).map((sec) => {
                const secItems = invoiceItems.filter(i => String(i.sectionId) === String(sec.sectionId));
                const secPallets = palletDetails.filter(p => String(p.sectionId) === String(sec.sectionId));
                const secTotal = sectionTotalsMap[sec.sectionId] || 0;
                const planGroups = Array.isArray(sec.planGroups) && sec.planGroups.length > 0 ? sec.planGroups : null;

                const renderPalletTable = (palletsList, titleSuffix = '') => {
                  if (!palletsList || palletsList.length === 0) return null;
                  return (
                    <div className="border-b border-slate-800/80">
                      <div className="px-5 py-2.5 bg-slate-950/60 flex justify-between items-center">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-brand-blue">
                          Dettaglio Bancali {titleSuffix ? `— ${titleSuffix}` : ''} ({palletsList.length})
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-950/50 text-slate-400 uppercase text-[10px]">
                            <tr>
                              <th className="p-3">PDF</th>
                              <th className="p-3">Cod. Articolo</th>
                              <th className="p-3">Prodotto (Clicca per Storico)</th>
                              <th className="p-3">Lotto</th>
                              <th className="p-3 text-center">KG Netti / Lordi</th>
                              <th className="p-3 text-center">Scadenza</th>
                              <th className="p-3 text-center">Arrivo (IN)</th>
                              <th className="p-3 text-center">Uscita / Stato</th>
                              <th className="p-3 text-center">Q.tà &amp; Gg Sosta</th>
                              <th className="p-3">Rif. Cl. / Voci</th>
                              {pdfOptions.showNotes && <th className="p-3">Note PDF</th>}
                              <th className="p-3 text-right">Prezzo</th>
                            </tr>
                          </thead>
                          <tbody className="text-slate-200 divide-y divide-slate-800/50">
                            {palletsList.map(pal => (
                              <tr key={pal.pallet_code} className={`hover:bg-slate-800/30 transition-colors ${!pal.visibleInPdf ? 'opacity-40' : ''}`}>
                                <td className="p-3">
                                  <input
                                    type="checkbox"
                                    checked={pal.visibleInPdf}
                                    onChange={e => updatePalletDetail(sec.sectionId, pal.pallet_code, { visibleInPdf: e.target.checked })}
                                    className="rounded border-slate-700 bg-slate-900 text-brand-blue"
                                    title="Includi questa riga nel PDF Proforma"
                                  />
                                </td>
                                <td className="p-3 font-mono font-bold text-sky-400">
                                  {pal.sku || '-'}
                                </td>
                                <td className="p-3">
                                  <button
                                    type="button"
                                    onClick={() => openPalletHistoryModal(pal.pallet_code, pal)}
                                    className="text-left group flex items-center gap-1.5 font-bold text-white hover:text-brand-blue transition-colors"
                                  >
                                    <span className="underline decoration-slate-600 group-hover:decoration-brand-blue underline-offset-2">
                                      {pal.product_name}
                                    </span>
                                    <ExternalLink size={12} className="text-slate-500 group-hover:text-brand-blue shrink-0" />
                                  </button>
                                  <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                                    ID: {pal.pallet_code} {pal.location ? `• Pos: ${pal.location}` : ''}
                                  </div>
                                </td>
                                <td className="p-3 font-mono font-bold text-amber-300">
                                  {pal.batch || '-'}
                                </td>
                                <td className="p-3 text-center font-mono text-[11px] whitespace-nowrap">
                                  {Number(pal.net_weight_kg) > 0 || Number(pal.gross_weight_kg) > 0 ? (
                                    <div className="space-y-0.5">
                                      {Number(pal.net_weight_kg) > 0 && <div className="text-sky-300">N: {Number(pal.net_weight_kg)} kg</div>}
                                      {Number(pal.gross_weight_kg) > 0 && <div className="text-amber-300">L: {Number(pal.gross_weight_kg)} kg</div>}
                                    </div>
                                  ) : (
                                    <span className="text-slate-600">-</span>
                                  )}
                                </td>
                                <td className="p-3 text-center font-mono text-slate-300 whitespace-nowrap">
                                  {pal.expiration_date_str || (pal.expiration_date ? formatDateIT(pal.expiration_date) : '-')}
                                </td>
                                <td className="p-3 text-center font-mono text-sky-300 whitespace-nowrap">
                                  {formatDateIT(pal.created_at)}
                                </td>
                                <td className="p-3 text-center whitespace-nowrap">
                                  {pal.shipped_at ? (
                                    <span className="px-2 py-0.5 rounded bg-rose-950/40 text-rose-300 border border-rose-500/30 font-mono text-[10px] font-bold">
                                      OUT {formatDateIT(pal.shipped_at)}
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded bg-emerald-950/40 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
                                      In Deposito
                                    </span>
                                  )}
                                </td>
                                <td className="p-3 text-center">
                                  <div className="font-bold text-white whitespace-nowrap">{pal.quantity} {pal.pallet_uom}</div>
                                  <div className="text-[10px] font-mono text-amber-400 font-bold">
                                    {pal.storageDays || 0} gg sosta
                                  </div>
                                </td>
                                <td className="p-3">
                                  {pal.customer_pallet_ref && (
                                    <div className="text-[10px] font-mono text-violet-300 font-bold mb-1">
                                      Rif.Cl: {pal.customer_pallet_ref}
                                    </div>
                                  )}
                                  <div className="flex flex-wrap gap-1">
                                    {(pal.charges || []).map((ch, idx) => (
                                      <span key={idx} className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] text-slate-300">
                                        {ch.label}: <b className="text-brand-blue">€{parseFloat(ch.price).toFixed(2)}</b>
                                      </span>
                                    ))}
                                  </div>
                                </td>
                                {pdfOptions.showNotes && (
                                  <td className="p-3 min-w-[160px]">
                                    <input
                                      type="text"
                                      value={pal.customNote !== undefined ? pal.customNote : (pal.notes || '')}
                                      onChange={e => updatePalletDetail(sec.sectionId, pal.pallet_code, { customNote: e.target.value })}
                                      placeholder="Aggiungi nota..."
                                      className="w-full bg-slate-950 border border-slate-800 focus:border-violet-400 rounded-lg px-2 py-1 text-xs text-slate-200 outline-none"
                                    />
                                  </td>
                                )}
                                <td className="p-3 text-right font-mono font-black text-emerald-400 whitespace-nowrap">
                                  € {parseFloat(pal.customPrice !== undefined ? pal.customPrice : (pal.totalPrice || 0)).toFixed(2)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                };

                const renderItemsTable = (itemsList, headerLabel) => {
                  if (!itemsList || itemsList.length === 0) return null;
                  return (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-950/60 text-slate-400 uppercase text-xs">
                          <tr>
                            <th className="p-3.5">{headerLabel}</th>
                            <th className="p-3.5 text-center">Q.ta</th>
                            <th className="p-3.5 text-right">Tariffa Unit.</th>
                            <th className="p-3.5 text-right">Subtotale</th>
                            <th className="p-3.5 text-center">Azioni</th>
                          </tr>
                        </thead>
                        <tbody className="text-slate-200">
                          {itemsList.map((item) => (
                            <tr
                              key={item.id}
                              className={`border-b border-slate-800/50 ${
                                !item.visible ? 'opacity-30 bg-slate-950' : 'hover:bg-slate-800/30'
                              }`}
                            >
                              <td className="p-3.5">
                                {item.isEditing ? (
                                  <input
                                    type="text"
                                    value={item.description}
                                    onChange={e => handleItemChange(item.id, 'description', e.target.value)}
                                    className="w-full bg-slate-950 border border-brand-blue p-1.5 rounded-lg outline-none text-white"
                                  />
                                ) : (
                                  <div>
                                    <div className="font-bold text-white flex items-center gap-2">
                                      {item.description}
                                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                                        {item.code}
                                      </span>
                                    </div>
                                    {item.palletsList && item.palletsList.length > 0 && (
                                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                                        {item.palletsList.map(pl => (
                                          <button
                                            key={pl.pallet_code}
                                            type="button"
                                            onClick={() => openPalletHistoryModal(pl.pallet_code, pl)}
                                            className="text-[10px] px-2 py-0.5 rounded-md bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-brand-blue text-slate-300 hover:text-brand-blue transition-colors flex items-center gap-1"
                                          >
                                            <span>{pl.product_name}</span>
                                            {pl.batch && pl.batch !== '-' && <span className="text-amber-300">({pl.batch})</span>}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="p-3.5 text-center font-mono font-bold">
                                {item.code === 'DISCOUNT_PERCENT' ? '-' : (
                                  item.isEditing ? (
                                    <input
                                      type="number"
                                      value={item.qty}
                                      onChange={e => handleItemChange(item.id, 'qty', e.target.value)}
                                      className="w-16 bg-slate-950 border border-brand-blue p-1 rounded text-center outline-none"
                                    />
                                  ) : item.qty
                                )}
                              </td>
                              <td className="p-3.5 text-right font-mono">
                                {item.isEditing ? (
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={item.price}
                                    onChange={e => handleItemChange(item.id, 'price', e.target.value)}
                                    className="w-24 bg-slate-950 border border-brand-blue p-1 rounded text-right outline-none"
                                  />
                                ) : (
                                  item.code === 'DISCOUNT_PERCENT' ? `${Math.abs(item.price)}%` : `€ ${parseFloat(item.price).toFixed(2)}`
                                )}
                              </td>
                              <td className={`p-3.5 text-right font-black ${item.subtotal < 0 ? 'text-rose-400' : 'text-brand-blue'}`}>
                                € {parseFloat(item.subtotal).toFixed(2)}
                              </td>
                              <td className="p-3.5">
                                <div className="flex justify-center gap-2">
                                  <button onClick={() => toggleVisibility(item.id)} className="text-slate-400 hover:text-white" title="Mostra/Nascondi in PDF">
                                    {item.visible ? <Eye size={16} /> : <EyeOff size={16} />}
                                  </button>
                                  <button onClick={() => toggleEdit(item.id)} className="text-slate-400 hover:text-sky-400" title="Modifica tariffa">
                                    {item.isEditing ? <Check size={16} className="text-emerald-400" /> : <Edit2 size={16} />}
                                  </button>
                                  <button onClick={() => removeItem(item.id)} className="text-slate-400 hover:text-rose-500" title="Elimina riga">
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                };

                const renderDescriptiveLinesBlock = (linesList) => {
                  if (!linesList || linesList.length === 0) return null;
                  return (
                    <div className="p-4 bg-slate-950/40 border-b border-slate-800/70 space-y-2.5">
                      {linesList.map((line, lIdx) => (
                        <div
                          key={lIdx}
                          className={`p-3.5 rounded-2xl border ${
                            line.type === 'OUT'
                              ? 'bg-rose-950/15 border-rose-500/25 text-rose-200'
                              : line.type === 'IN'
                              ? 'bg-sky-950/15 border-sky-500/25 text-sky-200'
                              : line.type === 'DAILY_STORAGE'
                              ? 'bg-amber-950/20 border-amber-500/30 text-amber-200'
                              : 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200'
                          }`}
                        >
                          <div className="flex items-center gap-2 font-black text-sm mb-2">
                            {line.type === 'OUT' && <ArrowUpRight size={16} className="text-rose-400 shrink-0" />}
                            {line.type === 'IN' && <ArrowDownLeft size={16} className="text-sky-400 shrink-0" />}
                            {line.type === 'DAILY_STORAGE' && <Clock size={16} className="text-amber-400 shrink-0" />}
                            {line.type === 'DEPOSIT' && <Boxes size={16} className="text-emerald-400 shrink-0" />}
                            <span>{line.headerText || line.text}</span>
                          </div>

                          {line.pallets && line.pallets.length > 0 && (
                            <div className="flex flex-wrap gap-2 pl-6">
                              {line.pallets.map((pal) => (
                                <button
                                  key={pal.pallet_code}
                                  type="button"
                                  onClick={() => openPalletHistoryModal(pal.pallet_code, pal)}
                                  className="group text-left px-3 py-1.5 rounded-xl bg-slate-950/90 hover:bg-slate-900 border border-slate-700 hover:border-brand-blue transition-all flex items-center gap-2 shadow-sm"
                                  title={`Clicca per vedere tutti i dettagli e lo storico di ${pal.product_name} (${pal.pallet_code})`}
                                >
                                  <div>
                                    <div className="text-xs font-bold text-white group-hover:text-brand-blue flex items-center gap-1.5">
                                      <span>{pal.product_name}</span>
                                      {pal.sku && pal.sku !== '-' && (
                                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-sky-300">
                                          {pal.sku}
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[10px] text-slate-400 font-mono flex flex-wrap items-center gap-2 mt-0.5">
                                      <span>Lotto: <b className="text-amber-300">{pal.batch || '-'}</b></span>
                                      <span>• Q.tà: <b className="text-slate-200">{pal.quantity} {pal.pallet_uom}</b></span>
                                      {Number(pal.net_weight_kg) > 0 && <span>• Netti: <b className="text-sky-300">{Number(pal.net_weight_kg)}kg</b></span>}
                                      {Number(pal.gross_weight_kg) > 0 && <span>• Lordi: <b className="text-amber-300">{Number(pal.gross_weight_kg)}kg</b></span>}
                                      {pal.customer_pallet_ref && (
                                        <span>• Rif.Cl: <b className="text-violet-300">{pal.customer_pallet_ref}</b></span>
                                      )}
                                    </div>
                                  </div>
                                  <ExternalLink size={13} className="text-slate-500 group-hover:text-brand-blue shrink-0 ml-1" />
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                };

                const coveredItemIds = new Set();

                return (
                  <div
                    key={sec.sectionId}
                    className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl"
                  >
                    {/* Intestazione della Frammentazione */}
                    <div className="p-5 bg-slate-950 border-b border-slate-800 flex flex-wrap justify-between items-center gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2.5">
                          <span className="text-lg font-black text-white tracking-wide">
                            &ldquo;{sec.sectionName}&rdquo;:
                          </span>
                          {sec.isParent ? (
                            <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase rounded-full bg-brand-blue/15 text-brand-blue border border-brand-blue/30">
                              Cliente Madre
                            </span>
                          ) : (
                            <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30 flex items-center gap-1">
                              <GitBranch size={11} /> Frammentazione
                            </span>
                          )}
                          {planGroups && planGroups.length > 0 && (
                            <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                              <Layers size={11} /> {planGroups.length} {planGroups.length === 1 ? 'Listino' : 'Listini'}
                            </span>
                          )}
                          <span className="text-xs font-mono text-slate-500">({sec.uniqueId})</span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1">
                          Clicca su qualsiasi prodotto/paletta per aprire lo storico completo. Ogni listino mostra la sua dicitura dedicata in fattura.
                        </div>
                      </div>

                      <button
                        onClick={() => navigate(`/desktop/billing-tariffs?clientId=${sec.sectionId}`)}
                        className="px-3 py-1.5 bg-slate-900 hover:bg-amber-500 text-amber-400 hover:text-brand-black border border-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                      >
                        <Coins size={13} /> Listini {sec.sectionName}
                      </button>
                    </div>

                    {planGroups ? (
                      <div className="divide-y divide-slate-800">
                        {planGroups.map(pg => {
                          const pgPallets = secPallets.filter(p => (p.tariff_plan_id ? String(p.tariff_plan_id) : 'LEGACY') === pg.planKey);
                          const pgItems = secItems.filter(i => (i.tariffPlanId ? String(i.tariffPlanId) : 'LEGACY') === pg.planKey);
                          pgItems.forEach(i => coveredItemIds.add(i.id));
                          const pgLiveSubtotal = pgItems
                            .filter(i => i.visible && i.code !== 'DISCOUNT_PERCENT')
                            .reduce((acc, it) => acc + (parseFloat(it.subtotal) || 0), 0);

                          return (
                            <div key={pg.planKey} className="bg-slate-900/60">
                              <div className="px-5 py-3.5 bg-slate-950/70 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
                                <div className="flex flex-wrap items-center gap-2.5">
                                  <span className="px-2.5 py-1 rounded-xl bg-brand-blue/15 text-brand-blue border border-brand-blue/30 text-xs font-black flex items-center gap-1.5">
                                    <Layers size={13} />
                                    {pg.invoiceLabel || pg.planName}
                                  </span>
                                  {pg.invoiceLabel && pg.planName && pg.invoiceLabel !== pg.planName && (
                                    <span className="text-[11px] text-slate-500 font-semibold">({pg.planName})</span>
                                  )}
                                  {pg.isFlatRate ? (
                                    <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-violet-500/20 text-violet-300 border border-violet-500/30">
                                      Fisso Mensile (Escluso da calcolo)
                                    </span>
                                  ) : (
                                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400 font-mono">
                                      <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800">IN €{Number(pg.tariffsSummary?.inPallet || 0).toFixed(2)}</span>
                                      <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800">OUT €{Number(pg.tariffsSummary?.outPallet || 0).toFixed(2)}</span>
                                      {Number(pg.tariffsSummary?.sostaGiorno || 0) > 0 ? (
                                        <span className="px-1.5 py-0.5 rounded bg-amber-950/40 border border-amber-500/30 text-amber-300">SOSTA/GG €{Number(pg.tariffsSummary.sostaGiorno).toFixed(2)}</span>
                                      ) : Number(pg.tariffsSummary?.depositPallet || 0) > 0 ? (
                                        <span className="px-1.5 py-0.5 rounded bg-emerald-950/40 border border-emerald-500/30 text-emerald-300">DEP €{Number(pg.tariffsSummary.depositPallet).toFixed(2)}</span>
                                      ) : null}
                                    </div>
                                  )}
                                </div>
                                <div className="text-right">
                                  <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mr-2">Subtotale Listino:</span>
                                  <span className="font-mono font-black text-emerald-400 text-sm">
                                    € {pgLiveSubtotal.toFixed(2)}
                                  </span>
                                </div>
                              </div>

                              {renderDescriptiveLinesBlock(pg.descriptiveLines)}
                              {renderPalletTable(pgPallets, pg.invoiceLabel || pg.planName)}
                              {renderItemsTable(pgItems, `Voci Listino — ${pg.invoiceLabel || pg.planName}`)}
                            </div>
                          );
                        })}

                        {(() => {
                          const extraManualItems = secItems.filter(i => !coveredItemIds.has(i.id));
                          return renderItemsTable(extraManualItems, `Voci Aggiuntive & Sconti — ${sec.sectionName}`);
                        })()}
                      </div>
                    ) : (
                      <>
                        {renderDescriptiveLinesBlock(sec.descriptiveLines)}
                        {renderPalletTable(secPallets, sec.sectionName)}
                        {renderItemsTable(secItems, `Riepilogo Voce Listino (${sec.sectionName})`)}
                      </>
                    )}

                    {/* Totale della singola Frammentazione */}
                    <div className="p-4 bg-slate-950/90 flex justify-between items-center border-t border-slate-800">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                        Totale {sec.sectionName}:
                      </span>
                      <span className="text-lg font-black text-emerald-400">
                        € {secTotal.toFixed(2)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* COLONNA DESTRA: RIEPILOGO PER FRAMMENTAZIONI & TOTALE CLIENTE MADRE */}
            <div className="space-y-6">
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl sticky top-8">
                <h3 className="text-xl font-black text-white mb-1">Riepilogo Cliente Madre</h3>
                <p className="text-xs text-slate-400 mb-5">
                  Suddivisione importi per frammentazione e totale complessivo per <b className="text-white">{reportData.clientName}</b>.
                </p>

                {/* Elenco Totali per Frammentazione e per Listino */}
                <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 mb-5 space-y-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Suddivisione Reparti / Frammentazioni &amp; Listini
                  </div>
                  {(reportData.sections || []).map(sec => (
                    <div key={sec.sectionId} className="border-b border-slate-800/60 pb-2 last:border-0 last:pb-0 space-y-1">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-200 font-bold truncate pr-2">
                          {sec.sectionName}
                        </span>
                        <span className="font-mono font-bold text-brand-blue shrink-0">
                          € {(sectionTotalsMap[sec.sectionId] || 0).toFixed(2)}
                        </span>
                      </div>
                      {Array.isArray(sec.planGroups) && sec.planGroups.length > 0 && (
                        <div className="pl-3 space-y-0.5">
                          {sec.planGroups.map(pg => {
                            const pgSub = invoiceItems
                              .filter(i => i.visible && i.code !== 'DISCOUNT_PERCENT' && String(i.sectionId) === String(sec.sectionId) && (i.tariffPlanId ? String(i.tariffPlanId) : 'LEGACY') === pg.planKey)
                              .reduce((acc, it) => acc + (parseFloat(it.subtotal) || 0), 0);
                            return (
                              <div key={pg.planKey} className="flex justify-between items-center text-[11px] text-slate-400">
                                <span className="truncate pr-2">• {pg.invoiceLabel || pg.planName}</span>
                                <span className="font-mono shrink-0 text-slate-300">€ {pgSub.toFixed(2)}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="space-y-3.5 mb-6">
                  <div className="flex justify-between text-slate-300 font-bold">
                    <span>Totale Cliente Madre (Lordo)</span>
                    <span>€ {baseTotal.toFixed(2)}</span>
                  </div>
                  {baseTotal !== finalTotal && (
                    <div className="flex justify-between text-slate-400 text-sm">
                      <span>Totale Sconti</span>
                      <span className="text-rose-400">- € {(baseTotal - finalTotal).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="pt-3 border-t border-slate-800 flex justify-between items-center">
                    <span className="text-base font-bold text-slate-200">Imponibile Cliente Madre</span>
                    <span className="text-xl font-black text-white">€ {finalTotal.toFixed(2)}</span>
                  </div>

                  <div className="flex justify-between items-center bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                    <label className="text-slate-400 font-bold text-xs uppercase">Aliquota IVA (%)</label>
                    <select
                      value={vatRate}
                      onChange={e => setVatRate(parseFloat(e.target.value))}
                      className="bg-slate-800 text-white font-bold rounded-lg px-2.5 py-1 text-right text-sm outline-none"
                    >
                      <option value="22">22%</option>
                      <option value="10">10%</option>
                      <option value="4">4%</option>
                      <option value="0">0% (Esente)</option>
                    </select>
                  </div>
                  <div className="flex justify-between text-slate-400 text-sm">
                    <span>Imposta IVA</span>
                    <span>€ {vatAmount.toFixed(2)}</span>
                  </div>

                  <div className="pt-4 border-t border-slate-800 flex justify-between items-center">
                    <span className="text-lg font-black text-white">TOTALE DOCUMENTO</span>
                    <span className="text-3xl font-black text-emerald-400">€ {grandTotal.toFixed(2)}</span>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <button
                    onClick={exportPDF}
                    disabled={isExporting}
                    className="w-full py-4 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-xl font-black text-base transition-all shadow-[0_0_25px_rgba(14,165,233,0.3)] flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {isExporting ? <Loader2 className="animate-spin" size={22} /> : <Download size={22} />}
                    {isExporting ? 'Salvataggio & Generazione...' : 'Salva in Archivio & Scarica PDF'}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveArchiveOnly}
                    disabled={isExporting}
                    className="w-full py-2.5 bg-slate-950 hover:bg-slate-800 text-emerald-400 border border-emerald-500/35 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    <Archive size={15} /> Salva Solo in Archivio Proforme
                  </button>
                </div>
              </div>
            </div>
          </div>
          </>
        )}
      </div>

      {/* POP-UP DETTAGLIO COMPLETO & STORICO PALETTA A 360° */}
      {palletModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-7 max-w-4xl w-full shadow-2xl relative my-8 animate-fade-in-up max-h-[90vh] flex flex-col">
            {/* Header Pop-up */}
            <div className="flex justify-between items-start gap-4 pb-4 border-b border-slate-800 shrink-0">
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="px-2.5 py-0.5 rounded-full bg-brand-blue/15 text-brand-blue border border-brand-blue/30 font-mono text-xs font-black">
                    {palletModal.code}
                  </span>
                  {palletModal.summary?.customer_pallet_ref && (
                    <span className="px-2.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30 font-mono text-xs font-bold">
                      Rif. Paletta Cliente: {palletModal.summary.customer_pallet_ref}
                    </span>
                  )}
                  {palletModal.summary?.sectionName && (
                    <span className="px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 text-xs font-bold">
                      {palletModal.summary.sectionName}
                    </span>
                  )}
                </div>
                <h2 className="text-2xl font-black text-white">
                  {palletModal.summary?.product_name || palletModal.historyData?.rows?.[0]?.product_name || 'Dettaglio Bancale'}
                </h2>
              </div>
              <button
                onClick={() => setPalletModal({ show: false, loading: false, code: null, summary: null, historyData: null })}
                className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl"
              >
                <X size={20} />
              </button>
            </div>

            {palletModal.loading ? (
              <div className="py-16 flex flex-col items-center justify-center text-brand-blue">
                <Loader2 className="animate-spin mb-3" size={40} />
                <p className="font-bold text-sm">Caricamento dettagli e storico completo paletta...</p>
              </div>
            ) : (
              <div className="overflow-y-auto space-y-6 pt-5 pr-1 flex-1">
                {/* Scheda Tecnica Bancale */}
                {(() => {
                  const firstRow = palletModal.historyData?.rows?.[0] || {};
                  const sum = palletModal.summary || {};
                  return (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-950 p-4 rounded-2xl border border-slate-800">
                      <div>
                        <p className="text-[10px] font-bold uppercase text-slate-500">Cod. Articolo (SKU)</p>
                        <p className="text-sm font-mono font-bold text-sky-400 mt-0.5">
                          {sum.sku || firstRow.client_article_number || firstRow.product_sku || '-'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase text-slate-500">Lotto</p>
                        <p className="text-sm font-mono font-bold text-amber-300 mt-0.5">
                          {sum.batch || firstRow.batch || 'Nessun lotto'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase text-slate-500">Quantità</p>
                        <p className="text-sm font-black text-white mt-0.5">
                          {sum.quantity ?? firstRow.quantity} {sum.pallet_uom || firstRow.pallet_uom || firstRow.product_uom || 'Pezzi'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase text-slate-500">Ubicazione & Sede</p>
                        <p className="text-sm font-mono font-bold text-emerald-400 mt-0.5">
                          {firstRow.location || sum.location || (firstRow.status === 'SHIPPED' ? 'SPEDITA / USCITA' : 'In Attesa')} ({firstRow.warehouse || sum.warehouse || 'Settala'})
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase text-slate-500">Data Ingresso (IN)</p>
                        <p className="text-xs font-mono text-slate-200 mt-0.5">
                          {firstRow.created_at ? new Date(firstRow.created_at).toLocaleString('it-IT') : (sum.created_at ? new Date(sum.created_at).toLocaleDateString('it-IT') : '-')}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase text-slate-500">Stato / Data Uscita (OUT)</p>
                        <p className={`text-xs font-bold mt-0.5 ${firstRow.shipped_at || sum.shipped_at ? 'text-rose-400' : 'text-emerald-400'}`}>
                          {firstRow.shipped_at || sum.shipped_at
                            ? `Uscita il ${new Date(firstRow.shipped_at || sum.shipped_at).toLocaleString('it-IT')}`
                            : 'In Deposito Attivo'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase text-slate-500">Scadenza Prodotto</p>
                        <p className="text-xs font-mono text-slate-200 mt-0.5">
                          {firstRow.expiration_date ? new Date(firstRow.expiration_date).toLocaleDateString('it-IT') : 'Non specificata'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase text-slate-500">Bolla DDT Entrata</p>
                        <p className="text-xs font-mono text-brand-blue font-bold mt-0.5">
                          {firstRow.inbound_ddt_number || sum.inbound_ddt_number || 'Inserimento Diretto'}
                        </p>
                      </div>
                      {(Number(firstRow.net_weight_kg || sum.net_weight_kg) > 0 || Number(firstRow.gross_weight_kg || sum.gross_weight_kg) > 0) && (
                        <div>
                          <p className="text-[10px] font-bold uppercase text-slate-500">Pesi Registrati</p>
                          <p className="text-xs font-mono text-slate-200 mt-0.5">
                            {Number(firstRow.net_weight_kg || sum.net_weight_kg) > 0 ? `Netti: ${Number(firstRow.net_weight_kg || sum.net_weight_kg)} kg ` : ''}
                            {Number(firstRow.gross_weight_kg || sum.gross_weight_kg) > 0 ? `• Lordi: ${Number(firstRow.gross_weight_kg || sum.gross_weight_kg)} kg` : ''}
                          </p>
                        </div>
                      )}
                      {(sum.invoice_label || sum.tariff_plan_name) && (
                        <div>
                          <p className="text-[10px] font-bold uppercase text-slate-500">Listino Applicato</p>
                          <p className="text-xs font-bold text-amber-300 mt-0.5">
                            {sum.invoice_label || sum.tariff_plan_name}
                          </p>
                        </div>
                      )}
                      {(firstRow.notes || sum.notes) && (
                        <div className="col-span-2 sm:col-span-4 pt-2 border-t border-slate-800/80">
                          <p className="text-[10px] font-bold uppercase text-violet-400">Note Bancale</p>
                          <p className="text-xs text-slate-200 mt-0.5">{firstRow.notes || sum.notes}</p>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Dettaglio Costi Addebitati nella Pre-Fattura Corrente */}
                {palletModal.summary?.charges && palletModal.summary.charges.length > 0 && (
                  <div className="bg-slate-950/80 border border-brand-blue/30 rounded-2xl p-4">
                    <div className="text-xs font-bold uppercase tracking-wider text-brand-blue mb-2.5 flex items-center justify-between">
                      <span>Addebiti Calcolati nel Periodo per questa Paletta</span>
                      <span className="text-emerald-400 font-black text-sm">
                        Totale Paletta: € {parseFloat(palletModal.summary.totalPrice || 0).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {palletModal.summary.charges.map((c, idx) => (
                        <div key={idx} className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs flex items-center gap-2">
                          <span className="text-slate-300 font-semibold">{c.label}</span>
                          <span className="font-mono font-bold text-brand-blue">€ {parseFloat(c.price).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Prelievi & Uscite Outbound su questa Paletta */}
                {palletModal.historyData?.outboundPicks?.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-2.5 flex items-center gap-1.5">
                      <ArrowUpRight size={15} /> Prelievi e Spedizioni Outbound ({palletModal.historyData.outboundPicks.length})
                    </h4>
                    <div className="space-y-2">
                      {palletModal.historyData.outboundPicks.map(pk => (
                        <div key={pk.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex flex-wrap justify-between items-center gap-2 text-xs">
                          <div>
                            <div className="font-bold text-white flex items-center gap-2">
                              <span className="font-mono text-brand-blue">{pk.order_code}</span>
                              {pk.client_ddt && <span className="text-slate-400">• DDT Cl: {pk.client_ddt}</span>}
                              <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-bold uppercase text-emerald-400">
                                {pk.order_status}
                              </span>
                            </div>
                            <div className="text-slate-400 mt-0.5">
                              Articolo: <b className="text-slate-200">{pk.product_name}</b> • Q.tà Prelevata:{' '}
                              <b className="text-white">{pk.quantity_picked || pk.quantity_required} {pk.requested_uom || 'Pz'}</b>
                              {pk.picking_operator && ` • Operatore Zebra: ${pk.picking_operator}`}
                            </div>
                          </div>
                          <div className="text-right font-mono text-[11px] text-slate-400">
                            {pk.shipped_at
                              ? `Spedito: ${new Date(pk.shipped_at).toLocaleString('it-IT')}`
                              : pk.picked_at
                              ? `Prelevato: ${new Date(pk.picked_at).toLocaleString('it-IT')}`
                              : new Date(pk.order_created_at).toLocaleDateString('it-IT')}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Cronologia Completa Audit Logs della Paletta */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2.5 flex items-center gap-1.5">
                    <Clock size={15} className="text-brand-blue" /> Storico Completo Operazioni Bancale ({palletModal.historyData?.auditLogs?.length || 0} eventi)
                  </h4>
                  {palletModal.historyData?.auditLogs?.length > 0 ? (
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                      {palletModal.historyData.auditLogs.map(lg => (
                        <div key={lg.id} className="p-3 bg-slate-950 border border-slate-800/80 rounded-xl flex justify-between items-start gap-3 text-xs">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded bg-brand-blue/15 text-brand-blue font-mono font-bold text-[10px]">
                                {lg.action}
                              </span>
                              <span className="text-slate-400 font-semibold">
                                Operatore: <b className="text-white">{lg.username}</b> ({lg.source})
                              </span>
                            </div>
                            <p className="text-slate-200 mt-1">{lg.details}</p>
                          </div>
                          <span className="font-mono text-[11px] text-slate-500 shrink-0">
                            {new Date(lg.created_at).toLocaleString('it-IT')}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500 italic bg-slate-950 p-4 rounded-xl border border-slate-800">
                      Nessun log operativo aggiuntivo registrato per questo codice paletta.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PreBillingDashboard;
