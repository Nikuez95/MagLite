import { appAlert, appConfirm, appPrompt } from "../../utils/alerts.js";
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import Select from 'react-select';
import CreatableSelect from 'react-select/creatable';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import {
  Download,
  Upload,
  PackagePlus,
  FileText,
  Trash2,
  Plus,
  Printer,
  Search,
  Maximize2,
  Minimize2,
  MapPin,
  Layers,
  Calendar,
  Hash,
  X,
  GitBranch,
  Building2
} from 'lucide-react';

const Inbound = () => {
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [serverFlags, setServerFlags] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // Carrello locale + UX controls
  const [cart, setCart] = useState([]);
  const [cartSearch, setCartSearch] = useState('');
  const [expandCart, setExpandCart] = useState(false);

  // Opzioni di Stampa
  const [abilitaSpunta, setAbilitaSpunta] = useState(true);
  const [printOptions, setPrintOptions] = useState({
    paper_format: 'A4', // 'A4' o 'THERMAL'
    print_mode: 'GRID',  // 'GRID' (solo per A4) o 'SINGLE_PAGE'
    isMixed: false,
    noBarcode: false,
    freeLocation: ''
  });

  const [formData, setFormData] = useState({
    parent_customer_id: null,
    fragment_id: null,
    customer_id: null,
    product_id: null,
    isNewProduct: false,
    newProductName: '',
    quantity: '',
    entry_uom: 'Base',
    units_per_box: '',
    boxes_per_pallet: '',
    batch: '',
    client_pallet_number: '',
    client_article_number: '',
    flags: [],
    warehouse: 'Settala',
    num_pallets: 1,
    notes: '',
    location: '',
    expiration_date: '',
    arrival_date: new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  });

  const getToken = () => localStorage.getItem('maglite_token');

  const [freeLocations, setFreeLocations] = useState([]);
  const [mappedLocations, setMappedLocations] = useState([]);

  const fetchData = async () => {
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      const [custRes, prodRes, freeRes, locRes, flagsRes] = await Promise.all([
        axios.get(`http://${window.location.hostname}:3000/api/customers`, { headers }),
        axios.get(`http://${window.location.hostname}:3000/api/products`, { headers }),
        axios.get(`http://${window.location.hostname}:3000/api/locations/free`, { headers }),
        axios.get(`http://${window.location.hostname}:3000/api/locations`, { headers }).catch(() => ({ data: [] })),
        axios.get(`http://${window.location.hostname}:3000/api/products/flags`, { headers }).catch(() => ({ data: [] }))
      ]);
      setCustomers(custRes.data.map(c => ({ value: c.id, label: c.business_name, raw: c })));
      setProducts(prodRes.data.map(p => ({ value: p.id, label: `${p.sku} - ${p.name}`, raw: p })));
      setFreeLocations(freeRes.data.map(fl => ({ value: fl.name, label: fl.name })));
      setMappedLocations(locRes.data || []);
      setServerFlags(flagsRes.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    // Auto-calcolo quantità
    const upb = parseFloat(formData.units_per_box) || 0;
    const bpp = parseFloat(formData.boxes_per_pallet) || 0;

    if (bpp > 0) {
      if (formData.entry_uom === 'Base' && upb > 0) {
        setFormData(prev => ({ ...prev, quantity: (upb * bpp).toString() }));
      } else if (formData.entry_uom === 'Scatole') {
        setFormData(prev => ({ ...prev, quantity: bpp.toString() }));
      } else if (formData.entry_uom === 'Bancali') {
        setFormData(prev => ({ ...prev, quantity: '1' }));
      }
    }
  }, [formData.units_per_box, formData.boxes_per_pallet, formData.entry_uom]);

  // Modifica inline di qualsiasi campo di una riga del carrello
  const updateCartItem = (id, updates) => {
    setCart(prev =>
      prev.map(item => {
        if (item.id !== id) return item;
        const updated = { ...item, ...updates };
        if (updates.location !== undefined) {
          updated.location = String(updates.location || '').toUpperCase().trim();
        }
        return updated;
      })
    );
    if (updates.location && String(updates.location).trim() !== '') {
      setAbilitaSpunta(false);
    }
  };

  const handleCreateProduct = async (inputValue) => {
    if (!formData.customer_id) {
      appAlert('Seleziona prima il Cliente Proprietario!');
      return;
    }
    const uom = await appPrompt('Inserisci unità di misura (es. Scatole, Bancali, Pezzi, KG, Metro Cubo):', 'Unità Base');
    if (!uom) return;
    setIsProcessing(true);
    try {
      const articleCode = (formData.client_article_number || '').trim();
      const sku = articleCode || ("PROD-" + Math.random().toString(36).substring(2,6).toUpperCase());
      const payload = { 
        sku, 
        name: inputValue, 
        uom: uom, 
        customer_id: formData.customer_id,
        default_article_number: articleCode || null
      };
      
      const res = await axios.post(`http://${window.location.hostname}:3000/api/products`, payload, { 
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      const finalSku = res.data.sku || sku;
      
      const newOption = { value: res.data.id, label: `${finalSku} - ${inputValue}`, raw: { id: res.data.id, sku: finalSku, name: inputValue, customer_id: formData.customer_id, uom, default_article_number: articleCode || '' } };
      setProducts(prev => [...prev, newOption]);
      setFormData(prev => ({ ...prev, product_id: newOption.value }));
    } catch (err) {
      appAlert('Errore creazione prodotto al volo');
    } finally {
      setIsProcessing(false);
    }
  };

  // Opzioni Clienti Madre (primo menu a tendina)
  const parentCustomerOptions = React.useMemo(() => {
    return customers
      .filter(c => !c.raw?.parent_id)
      .map(c => ({
        value: c.value,
        label: Number(c.raw?.children_count) > 0
          ? `${c.raw.business_name} (${c.raw.children_count} Frammentazioni)`
          : c.raw?.business_name || c.label,
        raw: c.raw
      }));
  }, [customers]);

  // Frammentazioni disponibili per il Cliente Madre selezionato
  const availableFragments = React.useMemo(() => {
    if (!formData.parent_customer_id) return [];
    return customers
      .filter(c => c.raw?.parent_id === formData.parent_customer_id)
      .map(c => ({
        value: c.value,
        label: c.raw?.business_name || c.label,
        raw: c.raw
      }));
  }, [customers, formData.parent_customer_id]);

  // Cambia la frammentazione attiva (oppure vuoto = direttamente al Cliente Madre)
  const handleFragmentChange = (fragId) => {
    const effectiveCustomerId = fragId || formData.parent_customer_id;
    const effectiveCustomerName = customers.find(c => c.value === effectiveCustomerId)?.label || '';
    const familyIds = new Set([
      formData.parent_customer_id,
      ...availableFragments.map(f => f.value)
    ]);

    setFormData(prev => ({
      ...prev,
      fragment_id: fragId || null,
      customer_id: effectiveCustomerId
    }));

    // Se nel carrello ci sono già righe appartenenti a questo stesso gruppo Cliente Madre, aggiorniamo la destinazione
    if (cart.length > 0 && effectiveCustomerId) {
      setCart(prev =>
        prev.map(item =>
          familyIds.has(item.customer_id)
            ? { ...item, customer_id: effectiveCustomerId, customer_name: effectiveCustomerName }
            : item
        )
      );
    }
  };

  // Mostra sia i prodotti della frammentazione selezionata sia quelli condivisi del Cliente Madre
  const filteredProducts = React.useMemo(() => {
    if (!formData.customer_id) return [];
    return products.filter(p =>
      p.raw.customer_id === formData.customer_id ||
      (formData.parent_customer_id && p.raw.customer_id === formData.parent_customer_id)
    );
  }, [products, formData.customer_id, formData.parent_customer_id]);

  const fileInputRef = useRef(null);

  const handleDownloadTemplate = () => {
    const templateRows = [
      {
        "Codice Articolo": "ART-ACQ-15",
        "Prodotto": "Acqua Naturale 1.5L",
        "Quantità": 1,
        "Unità di Misura": "Bancali",
        "Pezzi per Scatola": 6,
        "Scatole per Bancale": 84,
        "Lotto": "L-2026-01",
        "Scadenza": "2027-12-31",
        "Posizione": "A-01-01",
        "Moltiplicatore Palette": 1,
        "Magazzino": "Settala",
        "Paletta Cliente": "PAL-001",
        "Note": "Bancale intero assegnato in A-01-01"
      },
      {
        "Codice Articolo": "BISC-FROL-500",
        "Prodotto": "Biscotti Frollini 500g",
        "Quantità": 30,
        "Unità di Misura": "Scatole",
        "Pezzi per Scatola": 12,
        "Scatole per Bancale": 60,
        "Lotto": "L-999A",
        "Scadenza": "2027-06-30",
        "Posizione": "A-02-01",
        "Moltiplicatore Palette": 1,
        "Magazzino": "Settala",
        "Paletta Cliente": "PAL-002",
        "Note": "Stessa posizione A-02-01 (verrà frammentata automaticamente)"
      },
      {
        "Codice Articolo": "BISC-FROL-500",
        "Prodotto": "Biscotti Frollini 500g",
        "Quantità": 20,
        "Unità di Misura": "Scatole",
        "Pezzi per Scatola": 12,
        "Scatole per Bancale": 60,
        "Lotto": "L-999B",
        "Scadenza": "2027-08-15",
        "Posizione": "A-02-01",
        "Moltiplicatore Palette": 1,
        "Magazzino": "Settala",
        "Paletta Cliente": "PAL-002",
        "Note": "Lotto diverso nella stessa posizione A-02-01 (frammentata)"
      },
      {
        "Codice Articolo": "FAR-00-1KG",
        "Prodotto": "Farina Tipo 00 1Kg",
        "Quantità": 200,
        "Unità di Misura": "Pezzi",
        "Pezzi per Scatola": 10,
        "Scatole per Bancale": 50,
        "Lotto": "L-FAR-10",
        "Scadenza": "2027-03-15",
        "Posizione": "",
        "Moltiplicatore Palette": 1,
        "Magazzino": "Settala",
        "Paletta Cliente": "",
        "Note": "Senza posizione (in attesa di stivaggio)"
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateRows);
    worksheet['!cols'] = [
      { wch: 18 },
      { wch: 28 },
      { wch: 12 },
      { wch: 18 },
      { wch: 18 },
      { wch: 20 },
      { wch: 15 },
      { wch: 14 },
      { wch: 14 },
      { wch: 22 },
      { wch: 14 },
      { wch: 16 },
      { wch: 48 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Template Inbound");
    XLSX.writeFile(workbook, "template_inbound.xlsx");
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!formData.customer_id) {
      appAlert('Seleziona prima il Cliente Proprietario a cui associare il file!');
      e.target.value = null;
      return;
    }

    const normalizeKey = (k) =>
      String(k || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/['’`".\-()\/]/g, ' ')
        .trim()
        .replace(/[\s_]+/g, '_');

    const getCol = (normRow, exactKeys, fallbackPredicate) => {
      for (const key of exactKeys) {
        if (normRow[key] !== undefined && normRow[key] !== null && String(normRow[key]).trim() !== '') {
          return normRow[key];
        }
      }
      if (fallbackPredicate) {
        for (const [k, v] of Object.entries(normRow)) {
          if (v !== undefined && v !== null && String(v).trim() !== '' && fallbackPredicate(k)) {
            return v;
          }
        }
      }
      return '';
    };

    const normalizeUom = (val) => {
      const v = String(val ?? '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      if (!v || v === 'base' || v === 'unita base' || v === 'pz' || v === 'pezzi' || v === 'pezzo' || v === 'unita' || v === 'nr' || v === 'num') {
        return 'Base';
      }
      if (v.includes('scatol') || v.includes('carton') || v.includes('colli') || v.includes('collo') || v === 'ct' || v === 'sc' || v === 'box') {
        return 'Scatole';
      }
      if (v.includes('bancal') || v.includes('palet') || v.includes('plt') || v.includes('pedan')) {
        return 'Bancali';
      }
      if (v === 'kg' || v.includes('chil') || v.includes('kilo')) {
        return 'KG';
      }
      if (v.includes('metr') || v.includes('cub') || v === 'm3' || v === 'm³' || v === 'mc') {
        return 'Metro Cubo';
      }
      return 'Base';
    };

    const normalizeDate = (val) => {
      if (val === undefined || val === null || val === '') return null;
      if (val instanceof Date && !isNaN(val)) {
        const y = val.getFullYear();
        if (y < 1900 || y > 2100) return null;
        const m = String(val.getMonth() + 1).padStart(2, '0');
        const d = String(val.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
      if (typeof val === 'number' && val > 20000 && val < 100000 && XLSX.SSF?.parse_date_code) {
        const parsed = XLSX.SSF.parse_date_code(val);
        if (parsed && parsed.y && parsed.m && parsed.d) {
          if (parsed.y < 1900 || parsed.y > 2100) return null;
          return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
        }
      }
      const s = String(val).trim();
      if (!s) return null;

      let yNum = null;
      let mNum = null;
      let dNum = null;

      const ymd = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
      if (ymd) {
        yNum = parseInt(ymd[1], 10);
        mNum = parseInt(ymd[2], 10);
        dNum = parseInt(ymd[3], 10);
      }

      if (yNum === null) {
        const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
        if (dmy) {
          dNum = parseInt(dmy[1], 10);
          mNum = parseInt(dmy[2], 10);
          yNum = dmy[3].length === 2 ? 2000 + parseInt(dmy[3], 10) : parseInt(dmy[3], 10);
        }
      }

      if (yNum === null) {
        const my = s.match(/^(\d{1,2})[\/\-.](\d{4})$/);
        if (my) {
          mNum = parseInt(my[1], 10);
          yNum = parseInt(my[2], 10);
          dNum = 1;
        }
      }

      if (yNum === null) {
        const ym = s.match(/^(\d{4})[\/\-.](\d{1,2})$/);
        if (ym) {
          yNum = parseInt(ym[1], 10);
          mNum = parseInt(ym[2], 10);
          dNum = 1;
        }
      }

      if (yNum === null) {
        const shortMy = s.match(/^(\d{1,2})[\/\-.](\d{2})$/);
        if (shortMy) {
          const a = parseInt(shortMy[1], 10);
          const b = parseInt(shortMy[2], 10);
          if (a >= 1 && a <= 12) {
            mNum = a;
            yNum = 2000 + b;
            dNum = 1;
          } else if (b >= 1 && b <= 12 && a >= 20 && a <= 99) {
            yNum = 2000 + a;
            mNum = b;
            dNum = 1;
          }
        }
      }

      if (yNum === null || mNum === null || dNum === null) return null;
      if (yNum < 1900 || yNum > 2100) return null;
      if (mNum < 1 || mNum > 12) return null;
      if (dNum < 1 || dNum > 31) return null;

      const maxDay = new Date(yNum, mNum, 0).getDate();
      const safeDay = Math.min(dNum, maxDay);

      return `${String(yNum).padStart(4, '0')}-${String(mNum).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
    };

    const parseNum = (val, fallback = 0) => {
      if (val === undefined || val === null || val === '') return fallback;
      if (typeof val === 'number') return isNaN(val) ? fallback : val;
      const cleaned = String(val).trim().replace(',', '.');
      const n = parseFloat(cleaned);
      return isNaN(n) ? fallback : n;
    };

    const reader = new FileReader();
    reader.onload = async (evt) => {
      setIsProcessing(true);
      try {
        const isCsv = file.name.toLowerCase().endsWith('.csv');
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true, raw: isCsv });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        const headerKeywords = ['prodotto', 'descrizione', 'articolo', 'codice', 'sku', 'quantit', 'qta', 'qty', 'lotto', 'scad', 'unita', 'udm', 'um', 'scatol', 'bancal', 'palett', 'magazzin', 'posizion', 'ubicazion', 'scaffal', 'note', 'pezzi'];
        let headerRowIndex = 0;
        for (let r = 0; r < Math.min(matrix.length, 10); r++) {
          const rowCells = Array.isArray(matrix[r]) ? matrix[r] : [];
          const matchCount = rowCells.filter(cell => {
            const nk = normalizeKey(cell);
            return nk && headerKeywords.some(kw => nk.includes(kw));
          }).length;
          if (matchCount >= 2) {
            headerRowIndex = r;
            break;
          }
        }

        const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '', range: headerRowIndex });
        const newCartItems = [];
        const errorLines = [];
        const currentProducts = [...products];
        const customerName = customers.find(c => c.value === formData.customer_id)?.label || '';

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const lineNum = i + headerRowIndex + 2;

          const isRowEmpty = Object.values(row).every(v => String(v ?? '').trim() === '');
          if (isRowEmpty) continue;

          const normRow = {};
          for (const [k, v] of Object.entries(row)) {
            const nk = normalizeKey(k);
            if (nk && (normRow[nk] === undefined || String(normRow[nk]).trim() === '')) {
              normRow[nk] = v;
            }
          }

          const rawProdName = getCol(
            normRow,
            ['prodotto', 'nome_prodotto', 'descrizione', 'descrizione_prodotto', 'descrizione_articolo', 'desc_articolo', 'desc_prodotto', 'nome_articolo', 'merce', 'articolo', 'nome'],
            k => (k.includes('prodott') && !k.includes('cod')) || k.includes('descriz')
          );

          let rawArticolo = getCol(
            normRow,
            ['codice_articolo', 'articolo_cliente', 'cod_articolo', 'cod_art', 'codice_art', 'sku', 'codice_sku', 'codice_prodotto', 'cod_prodotto', 'codice_cliente', 'item_code', 'codice'],
            k => (k.includes('cod') && (k.includes('art') || k.includes('prod') || k.includes('sku'))) || k.includes('articolo_cliente') || k === 'sku'
          );
          if (!rawArticolo && normRow.descrizione && normRow.articolo) {
            rawArticolo = normRow.articolo;
          }

          const rawQty = getCol(
            normRow,
            ['quantita', 'qta', 'q_ta', 'qty', 'quantity', 'quantita_totale', 'qta_totale', 'totale_pezzi', 'pezzi', 'colli'],
            k => k.includes('quantit') || k === 'qta' || k.startsWith('qta_') || k.startsWith('q_ta')
          );

          const articoloCliente = String(rawArticolo ?? '').trim();
          let prodName = String(rawProdName ?? '').trim();
          const qtyStr = String(rawQty ?? '').trim();

          let existingProd = null;
          if (articoloCliente) {
            existingProd = currentProducts.find(p =>
              p.raw.sku?.trim().toLowerCase() === articoloCliente.toLowerCase() ||
              ((p.raw.customer_id === formData.customer_id || p.raw.customer_id === formData.parent_customer_id) &&
                p.raw.default_article_number?.trim().toLowerCase() === articoloCliente.toLowerCase())
            );
          }
          const existingByName = prodName
            ? currentProducts.find(p =>
                (p.raw.customer_id === formData.customer_id || p.raw.customer_id === formData.parent_customer_id) &&
                (p.raw.name?.trim().toLowerCase() === prodName.toLowerCase() || p.label?.trim().toLowerCase() === prodName.toLowerCase())
              )
            : null;
          if (!existingProd && existingByName) {
            existingProd = existingByName;
          }

          if (!prodName && existingProd?.raw?.name) {
            prodName = existingProd.raw.name;
          }

          if (!prodName || !qtyStr) {
            errorLines.push(`Riga ${lineNum}: Prodotto o Quantità mancante`);
            continue;
          }

          const qty = parseNum(qtyStr, NaN);
          if (isNaN(qty) || qty <= 0) {
            errorLines.push(`Riga ${lineNum}: Quantità non valida (${qtyStr})`);
            continue;
          }

          const rawUom = getCol(
            normRow,
            ['unita_misura', 'unita_di_misura', 'udm', 'u_d_m', 'um', 'u_m', 'unita', 'misura'],
            k => (k.includes('unita') && !k.includes('scatol') && !k.includes('bancal') && !k.includes('palett')) || k === 'udm' || k === 'um'
          );
          const entryUom = normalizeUom(rawUom);

          const rawUpb = getCol(
            normRow,
            ['pezzi_per_scatola', 'pz_per_scatola', 'pezzi_scatola', 'pz_scatola', 'unita_per_scatola', 'pezzi_x_scatola', 'pz_x_scatola', 'pezzi_per_cartone', 'pezzi_per_collo'],
            k => (k.includes('pezz') || k.includes('pz') || k.includes('unita')) && (k.includes('scatol') || k.includes('carton') || k.includes('coll'))
          );
          const upb = parseNum(rawUpb, 1) || 1;

          const rawBpp = getCol(
            normRow,
            ['scatole_per_bancale', 'scatole_per_paletta', 'scatole_bancale', 'scatole_paletta', 'scatole_x_bancale', 'scatole_x_paletta', 'cartoni_per_bancale', 'colli_per_bancale', 'colli_per_paletta'],
            k => (k.includes('scatol') || k.includes('carton') || k.includes('coll')) && (k.includes('bancal') || k.includes('palett') || k.includes('plt'))
          );
          const bpp = parseNum(rawBpp, 1) || 1;

          const rawLotto = getCol(
            normRow,
            ['lotto', 'n_lotto', 'num_lotto', 'numero_lotto', 'codice_lotto', 'cod_lotto', 'batch', 'partita'],
            k => k.includes('lotto') || k.includes('batch')
          );
          const lotto = String(rawLotto ?? '').trim();

          const rawScadenza = getCol(
            normRow,
            ['scadenza', 'data_scadenza', 'data_di_scadenza', 'scad', 'tmc', 'expiration', 'expiration_date', 'exp'],
            k => k.includes('scad') || k === 'tmc' || k.includes('expir')
          );
          const scadenza = normalizeDate(rawScadenza);

          const rawPalletsCount = getCol(
            normRow,
            ['moltiplicatore_palette', 'moltiplicatore', 'numero_palette', 'num_palette', 'n_palette', 'nr_palette', 'palette', 'numero_bancali', 'num_bancali', 'n_bancali', 'qta_palette', 'quantita_palette'],
            k => k.includes('moltiplic') || ((k.includes('num') || k.startsWith('n_') || k.includes('qta')) && (k.includes('palett') || k.includes('bancal')))
          );
          const palletsCount = Math.max(1, parseInt(parseNum(rawPalletsCount, 1), 10) || 1);

          const rawMagazzino = getCol(
            normRow,
            ['magazzino', 'deposito', 'sede', 'warehouse', 'destinazione'],
            k => k.includes('magazzin') || k.includes('deposit')
          );
          const magStr = String(rawMagazzino ?? '').trim();
          const magazzino = magStr.toLowerCase().includes('caleppio') ? 'Caleppio' : 'Settala';

          const rawPalletCliente = getCol(
            normRow,
            ['paletta_cliente', 'num_paletta_cliente', 'n_paletta_cliente', 'numero_paletta_cliente', 'codice_paletta', 'cod_paletta', 'id_paletta', 'pallet_cliente', 'sscc'],
            k => (k.includes('palett') || k.includes('pallet')) && (k.includes('client') || k.includes('cod') || k.includes('id'))
          );
          const palletCliente = String(rawPalletCliente ?? '').trim();

          const rawNote = getCol(
            normRow,
            ['note', 'nota', 'annotazioni', 'osservazioni', 'commenti', 'note_paletta'],
            k => k.startsWith('not') || k.includes('annotaz')
          );
          const note = String(rawNote ?? '').trim();

          const rawPosizione = getCol(
            normRow,
            ['posizione', 'ubicazione', 'location', 'scaffale', 'locazione', 'posto', 'cella', 'coordinate'],
            k => k.includes('posizion') || k.includes('ubicazion') || k === 'location' || k.includes('scaffal')
          );
          const posizione = String(rawPosizione ?? '').trim().toUpperCase();

          let uomToSave = entryUom;
          if (uomToSave === 'Base') {
            const rawUomLower = String(rawUom ?? '').trim().toLowerCase();
            uomToSave = (rawUomLower === 'pezzi' || rawUomLower === 'pz') ? 'Pezzi' : 'Scatole';
          }

          let finalProductId = null;
          let finalSku = '';

          if (!existingProd) {
            try {
              const sku = articoloCliente || ("PROD-" + Math.random().toString(36).substring(2,6).toUpperCase());
              const payload = { 
                sku, 
                name: prodName, 
                uom: uomToSave, 
                customer_id: formData.customer_id,
                units_per_box: upb,
                boxes_per_pallet: bpp,
                default_article_number: articoloCliente || null
              };
              
              const res = await axios.post(`http://${window.location.hostname}:3000/api/products`, payload, { 
                headers: { Authorization: `Bearer ${getToken()}` }
              });
              finalProductId = res.data.id;
              finalSku = res.data.sku || sku;
              
              const newOption = {
                value: finalProductId,
                label: `${finalSku} - ${prodName}`,
                raw: {
                  id: finalProductId,
                  sku: finalSku,
                  name: prodName,
                  customer_id: formData.customer_id,
                  uom: uomToSave,
                  units_per_box: upb,
                  boxes_per_pallet: bpp,
                  default_article_number: articoloCliente || ''
                }
              };
              currentProducts.push(newOption);
            } catch (err) {
              console.error("Failed to create product", prodName, err);
              errorLines.push(`Riga ${lineNum}: Errore creazione prodotto '${prodName}'`);
              continue;
            }
          } else {
            finalProductId = existingProd.value;
            finalSku = existingProd.raw.sku;

            if (articoloCliente && (existingProd.raw.sku !== articoloCliente || existingProd.raw.default_article_number !== articoloCliente)) {
              try {
                const parsedFlags = existingProd.raw.flags
                  ? (typeof existingProd.raw.flags === 'string' ? JSON.parse(existingProd.raw.flags) : existingProd.raw.flags)
                  : [];
                await axios.put(`http://${window.location.hostname}:3000/api/products/${existingProd.value}`, {
                  sku: articoloCliente,
                  name: existingProd.raw.name || prodName,
                  uom: existingProd.raw.uom || uomToSave,
                  customer_id: formData.customer_id,
                  notes: existingProd.raw.notes || null,
                  units_per_box: upb || existingProd.raw.units_per_box || 1,
                  boxes_per_pallet: bpp || existingProd.raw.boxes_per_pallet || 1,
                  default_article_number: articoloCliente,
                  flags: parsedFlags
                }, {
                  headers: { Authorization: `Bearer ${getToken()}` }
                });
                finalSku = articoloCliente;
                existingProd.raw.sku = articoloCliente;
                existingProd.raw.default_article_number = articoloCliente;
                existingProd.label = `${articoloCliente} - ${existingProd.raw.name || prodName}`;
              } catch (updateErr) {
                console.error("Failed to update product SKU", prodName, updateErr);
              }
            }
          }

          let actualQty = qty;
          let pallet_uom = null;
          
          if (entryUom === 'Scatole') {
            actualQty *= upb;
          } else if (entryUom === 'Bancali') {
            actualQty *= (upb * bpp);
          } else if (entryUom === 'KG' || entryUom === 'Metro Cubo') {
            pallet_uom = entryUom === 'KG' ? 'KG' : 'Metro Cubo';
          }

          newCartItems.push({
            id: Date.now() + Math.random(),
            customer_id: formData.customer_id,
            customer_name: customerName,
            product_id: finalProductId,
            sku: finalSku,
            product_name: `${finalSku} - ${prodName}`,
            quantity: actualQty,
            units_per_box: upb,
            boxes_per_pallet: bpp,
            pallet_uom: pallet_uom,
            uom: entryUom === 'Base' ? 'Pezzi' : (entryUom || 'Pezzi'),
            batch: lotto,
            warehouse: magazzino,
            num_pallets: palletsCount,
            notes: note,
            client_pallet_number: palletCliente,
            client_article_number: articoloCliente || finalSku,
            location: posizione,
            expiration_date: scadenza || '',
            arrival_date: new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
          });
        }

        await fetchData();

        if (newCartItems.length > 0) {
          if (newCartItems.some(item => item.location)) {
            setAbilitaSpunta(false);
          }
          setCart(prev => [...prev, ...newCartItems]);
        }
        
        setIsProcessing(false);
        e.target.value = null; 
        
        if (errorLines.length > 0) {
          const maxErrorsToShow = 10;
          const errorList = errorLines.slice(0, maxErrorsToShow).join('\n');
          const moreErrors = errorLines.length > maxErrorsToShow ? `\n... e altre ${errorLines.length - maxErrorsToShow} righe.` : '';
          appAlert(`Caricamento completato con ${errorLines.length} righe saltate.\nElementi aggiunti: ${newCartItems.length}\n\nDettaglio:\n${errorList}${moreErrors}`);
        } else {
          appAlert(`Caricamento completato! Aggiunti ${newCartItems.length} elementi alla lista.`, 'Successo', 'success');
        }
      } catch (error) {
        setIsProcessing(false);
        appAlert('Errore nella lettura del file: ' + (error.message || 'Formato non valido'));
        e.target.value = null;
      }
    };
    reader.onerror = () => {
      setIsProcessing(false);
      appAlert('Errore nella lettura del file.');
      e.target.value = null;
    };
    reader.readAsArrayBuffer(file);
  };

  const handleAddToCart = async (e) => {
    e.preventDefault();
    if (!formData.customer_id || !formData.product_id || !formData.quantity || formData.num_pallets < 1) {
      appAlert('Compila tutti i campi obbligatori');
      return;
    }

    const customer = customers.find(c => c.value === formData.customer_id)?.label;
    const articleCode = (formData.client_article_number || '').trim();
    let finalProductId = formData.product_id;
    let finalProductName = '';
    let finalSku = '';

    if (formData.isNewProduct) {
      setIsProcessing(true);
      try {
        const sku = articleCode || ("PROD-" + Math.random().toString(36).substring(2,6).toUpperCase());
        let uomToSave = formData.entry_uom;
        if (uomToSave === 'Base') uomToSave = 'Pezzi';
        
        const payload = { 
          sku, 
          name: formData.newProductName, 
          uom: uomToSave, 
          customer_id: formData.customer_id,
          units_per_box: parseFloat(formData.units_per_box) || 1,
          boxes_per_pallet: parseFloat(formData.boxes_per_pallet) || 1,
          default_article_number: articleCode || null,
          flags: formData.flags ? formData.flags.map(f => f.value) : []
        };
        
        const res = await axios.post(`http://${window.location.hostname}:3000/api/products`, payload, { 
          headers: { Authorization: `Bearer ${getToken()}` }
        });
        finalProductId = res.data.id;
        finalSku = res.data.sku || sku;
        finalProductName = `${finalSku} - ${formData.newProductName}`;
        
        await fetchData();
      } catch (err) {
        appAlert(err.response?.data?.error || 'Errore creazione prodotto al volo');
        setIsProcessing(false);
        return;
      }
      setIsProcessing(false);
    } else {
      const selectedProd = products.find(p => p.value === formData.product_id);
      if (selectedProd) {
        finalSku = selectedProd.raw.sku;
        finalProductName = selectedProd.label;

        if (articleCode && (selectedProd.raw.sku !== articleCode || selectedProd.raw.default_article_number !== articleCode)) {
          setIsProcessing(true);
          try {
            const uomToSave = selectedProd.raw.uom || (formData.entry_uom === 'Base' ? 'Pezzi' : formData.entry_uom) || 'Pezzi';
            await axios.put(`http://${window.location.hostname}:3000/api/products/${selectedProd.value}`, {
              sku: articleCode,
              name: selectedProd.raw.name,
              uom: uomToSave,
              customer_id: formData.customer_id,
              notes: selectedProd.raw.notes || null,
              units_per_box: parseFloat(formData.units_per_box) || selectedProd.raw.units_per_box || 1,
              boxes_per_pallet: parseFloat(formData.boxes_per_pallet) || selectedProd.raw.boxes_per_pallet || 1,
              default_article_number: articleCode,
              flags: formData.flags ? formData.flags.map(f => f.value) : []
            }, {
              headers: { Authorization: `Bearer ${getToken()}` }
            });
            finalSku = articleCode;
            finalProductName = `${articleCode} - ${selectedProd.raw.name}`;
            setCart(prev => prev.map(item =>
              item.product_id === selectedProd.value
                ? { ...item, sku: articleCode, product_name: `${articleCode} - ${selectedProd.raw.name}`, client_article_number: item.client_article_number || articleCode }
                : item
            ));
            await fetchData();
          } catch (err) {
            appAlert(err.response?.data?.error || 'Errore aggiornamento SKU prodotto');
            setIsProcessing(false);
            return;
          }
          setIsProcessing(false);
        }
      }
    }
    const product = finalProductName;

    let actualQty = parseFloat(formData.quantity);
    const upb = parseFloat(formData.units_per_box) || 1;
    const bpp = parseFloat(formData.boxes_per_pallet) || 1;

    let pallet_uom = null;

    if (formData.entry_uom === 'Scatole') {
      actualQty *= upb;
    } else if (formData.entry_uom === 'Bancali') {
      actualQty *= (upb * bpp);
    } else if (formData.entry_uom === 'KG' || formData.entry_uom === 'Metro Cubo') {
      pallet_uom = formData.entry_uom === 'KG' ? 'KG' : 'Metro Cubo';
    }

    const cleanLocation = (formData.location || '').trim().toUpperCase();

    const newItem = {
      id: Date.now(),
      customer_id: formData.customer_id,
      customer_name: customer,
      product_id: finalProductId,
      sku: finalSku,
      product_name: product,
      quantity: actualQty,
      units_per_box: upb,
      boxes_per_pallet: bpp,
      pallet_uom: pallet_uom,
      uom: formData.entry_uom === 'Base' ? 'Pezzi' : (formData.entry_uom || 'Pezzi'),
      batch: formData.batch,
      warehouse: formData.warehouse,
      num_pallets: formData.num_pallets,
      notes: formData.notes,
      client_pallet_number: formData.client_pallet_number,
      client_article_number: articleCode || finalSku,
      location: cleanLocation,
      expiration_date: formData.expiration_date,
      arrival_date: formData.arrival_date,
      flags: formData.flags ? formData.flags.map(f => f.value) : []
    };

    if (cleanLocation) {
      setAbilitaSpunta(false);
    }

    setCart(prev => [...prev, newItem]);
    
    setFormData(prev => ({ 
      ...prev, 
      quantity: '', 
      entry_uom: 'Base', 
      batch: '', 
      num_pallets: 1, 
      notes: '', 
      location: '',
      client_pallet_number: '', 
      client_article_number: '', 
      expiration_date: '',
      arrival_date: new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16),
      isNewProduct: false,
      newProductName: '',
      flags: []
    }));
  };

  const removeFromCart = (id) => {
    setCart(prev => prev.filter(item => item.id !== id));
  };

  const handleClearCart = async () => {
    if (cart.length === 0) return;
    if (await appConfirm(`Vuoi svuotare completamente il carrello (${cart.length} righe)?`)) {
      setCart([]);
      setCartSearch('');
    }
  };

  const handleGenerate = async () => {
    if (cart.length === 0) return;

    const invalidRow = cart.find(item => !item.quantity || isNaN(parseFloat(item.quantity)) || parseFloat(item.quantity) <= 0);
    if (invalidRow) {
      appAlert(`Attenzione: la riga "${invalidRow.product_name}" ha una quantità non valida.`);
      return;
    }

    if (abilitaSpunta) {
      setIsGenerating(true);
      try {
        const payload = { cart };
        const res = await axios.post(`http://${window.location.hostname}:3000/api/inbound/ddt`, payload, {
          headers: { Authorization: `Bearer ${getToken()}` }
        });
        
        appAlert(`DDT Inbound ${res.data.ddt_number} generato in attesa di spunta!`);
        
        window.open(`http://${window.location.hostname}:3000/api/inbound/ddt/${res.data.ddt_id}/pdf?token=${getToken()}`, '_blank');
        
        setCart([]);
        setCartSearch('');
        setFormData({...formData, parent_customer_id: null, fragment_id: null, customer_id: null, product_id: null, isNewProduct: false, newProductName: ''});
        setPrintOptions({ paper_format: 'A4', print_mode: 'GRID', isMixed: false, noBarcode: false, freeLocation: '' });
      } catch (err) {
        appAlert('Errore durante la creazione del DDT Inbound.');
      } finally {
        setIsGenerating(false);
      }
      return;
    }

    if (printOptions.noBarcode && !printOptions.freeLocation.trim()) {
      appAlert("Inserisci l'ubicazione / stoccaggio libero!");
      return;
    }
    setIsGenerating(true);
    try {
      const payload = {
        cart,
        printOptions
      };

      const res = await axios.post(`http://${window.location.hostname}:3000/api/pallets/generate`, payload, {
        headers: { Authorization: `Bearer ${getToken()}` },
        responseType: printOptions.noBarcode ? 'json' : 'blob' 
      });
      
      if (!printOptions.noBarcode) {
        const pdfBlob = new Blob([res.data], { type: 'application/pdf' });
        const pdfUrl = URL.createObjectURL(pdfBlob);
        window.open(pdfUrl, '_blank');
      } else {
        appAlert(res.data.message || 'Inserimento completato con successo (senza etichetta).');
      }

      setCart([]);
      setCartSearch('');
    } catch (err) {
      appAlert('Errore durante la generazione del PDF.');
    } finally {
      setIsGenerating(false);
    }
  };

  const selectStyles = {
    control: (base, state) => ({
      ...base,
      backgroundColor: '#020617', 
      borderColor: state.isFocused ? '#38bdf8' : '#1e293b', 
      borderRadius: '0.75rem',
      padding: '0.15rem',
      minHeight: '42px',
      boxShadow: 'none',
      '&:hover': { borderColor: '#38bdf8' }
    }),
    menu: base => ({ ...base, backgroundColor: '#0f172a', zIndex: 50, border: '1px solid #1e293b' }),
    option: (base, state) => ({ ...base, backgroundColor: state.isFocused ? '#1e293b' : 'transparent', color: '#f8fafc', cursor: 'pointer', fontSize: '0.875rem' }),
    singleValue: base => ({ ...base, color: '#f8fafc', fontSize: '0.875rem' }),
    input: base => ({ ...base, color: '#f8fafc', fontSize: '0.875rem' }),
    multiValue: base => ({ ...base, backgroundColor: '#1e293b', borderRadius: '0.375rem', border: '1px solid #334155' }),
    multiValueLabel: base => ({ ...base, color: '#38bdf8', fontWeight: 'bold', fontSize: '0.7rem', textTransform: 'uppercase' }),
    multiValueRemove: base => ({ ...base, color: '#94a3b8', ':hover': { backgroundColor: '#f43f5e', color: '#fff' } })
  };

  const renderQuantityHint = () => {
    if (!formData.quantity) return null;
    let actualQtyForHint = parseFloat(formData.quantity) || 0;
    const upb = parseFloat(formData.units_per_box) || 1;
    const bpp = parseFloat(formData.boxes_per_pallet) || 1;

    if (formData.entry_uom === 'Scatole') actualQtyForHint *= upb;
    else if (formData.entry_uom === 'Bancali') actualQtyForHint *= (upb * bpp);

    const productObj = products.find(p => p.value === formData.product_id);
    const baseProdUom = productObj?.raw?.uom || 'Pezzi';
    const prodUom = (formData.entry_uom === 'KG' || formData.entry_uom === 'Metro Cubo') ? formData.entry_uom : baseProdUom;

    if (upb > 1 && prodUom !== 'Scatole' && prodUom !== 'Bancali' && prodUom !== 'KG' && prodUom !== 'Metro Cubo') {
      const scatole = Math.floor(actualQtyForHint / upb);
      const sfusi = actualQtyForHint % upb;
      return (
        <div className="mt-1 text-[11px] font-bold text-slate-400">
          Totale: <span className="text-brand-blue">{actualQtyForHint} {prodUom}</span> 
          <span className="ml-1.5 font-normal text-[10px] uppercase tracking-wider text-slate-500">
            [{scatole} Scat.{sfusi > 0 ? ` + ${sfusi} Sfusi` : ''}]
          </span>
        </div>
      );
    } else {
      return (
        <div className="mt-1 text-[11px] font-bold text-slate-400">
          Totale: <span className="text-brand-blue">{actualQtyForHint} {prodUom}</span>
        </div>
      );
    }
  };

  const availableFlagsOptions = React.useMemo(() => {
    const flagsSet = new Set(serverFlags);
    products.forEach(p => {
      const pf = typeof p.raw.flags === 'string' ? JSON.parse(p.raw.flags) : (p.raw.flags || []);
      if (Array.isArray(pf)) pf.forEach(f => flagsSet.add(f));
    });
    return Array.from(flagsSet).map(f => ({ label: f, value: f }));
  }, [products, serverFlags]);

  const allLocationsOptions = React.useMemo(() => {
    const opts = [];
    const seen = new Set();
    mappedLocations.forEach(l => {
      if (l.barcode && !seen.has(l.barcode.toUpperCase())) {
        seen.add(l.barcode.toUpperCase());
        opts.push({
          value: l.barcode.toUpperCase(),
          label: l.pallet_code ? `${l.barcode} (Occupata: ${l.pallet_code})` : `${l.barcode} (Libera)`
        });
      }
    });
    freeLocations.forEach(fl => {
      if (fl.value && !seen.has(fl.value.toUpperCase())) {
        seen.add(fl.value.toUpperCase());
        opts.push({
          value: fl.value.toUpperCase(),
          label: `${fl.label} (Zona Libera)`
        });
      }
    });
    return opts;
  }, [mappedLocations, freeLocations]);

  const totalPalletsToGenerate = React.useMemo(() => {
    if (printOptions.isMixed && cart.length > 0) return 1;
    const uniqueLocations = new Set();
    let unlocatedCount = 0;
    cart.forEach(item => {
      if (item.location) {
        uniqueLocations.add(item.location.toUpperCase());
      } else {
        unlocatedCount += (parseInt(item.num_pallets, 10) || 1);
      }
    });
    return uniqueLocations.size + unlocatedCount;
  }, [cart, printOptions.isMixed]);

  const filteredCart = React.useMemo(() => {
    const q = cartSearch.trim().toLowerCase();
    if (!q) return cart.map((item, idx) => ({ item, originalIndex: idx }));
    return cart
      .map((item, idx) => ({ item, originalIndex: idx }))
      .filter(({ item }) =>
        (item.product_name || '').toLowerCase().includes(q) ||
        (item.sku || '').toLowerCase().includes(q) ||
        (item.batch || '').toLowerCase().includes(q) ||
        (item.location || '').toLowerCase().includes(q) ||
        (item.notes || '').toLowerCase().includes(q)
      );
  }, [cart, cartSearch]);

  return (
    <div className="flex-1 overflow-y-auto bg-brand-black relative">
      {isProcessing && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
          <div className="w-16 h-16 border-4 border-brand-blue border-t-transparent rounded-full animate-spin mb-4"></div>
          <h2 className="text-2xl font-bold text-white">Elaborazione in corso...</h2>
          <p className="text-slate-400 mt-2">Attendere prego, potrebbe richiedere qualche istante.</p>
        </div>
      )}

      {/* Datalist per autocompletamento posizioni inline nel carrello */}
      <datalist id="inbound-locations-datalist">
        {allLocationsOptions.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </datalist>

      <div className="max-w-[1600px] mx-auto animate-fade-in-up">
        
        {/* Header con Import Excel/CSV sempre in evidenza */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-black text-brand-white flex items-center gap-3">
              <PackagePlus className="text-brand-blue" size={32} />
              Nuova Merce (In-bound)
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Carica da file Excel/CSV o inserisci manualmente.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <input 
              type="file" 
              accept=".csv,.xlsx,.xls" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              className="hidden" 
            />
            <button 
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2.5 bg-brand-blue/15 text-brand-blue border border-brand-blue/40 rounded-xl font-bold hover:bg-brand-blue hover:text-brand-black transition-all flex items-center gap-2 text-sm shadow-lg"
            >
              <Upload size={17} />
              Carica Excel / CSV
            </button>
            <button 
              type="button"
              onClick={handleDownloadTemplate}
              className="px-4 py-2.5 bg-slate-900 text-slate-300 border border-slate-700 rounded-xl font-bold hover:bg-slate-800 transition-all flex items-center gap-2 text-sm"
            >
              <Download size={17} />
              Scarica Template
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          
          {/* COLONNA SINISTRA: FORM COMPATTO DI INSERIMENTO (5/12) */}
          {!expandCart && (
            <div className="xl:col-span-5 bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
              <div className="flex items-center justify-between mb-5 pb-3 border-b border-slate-800">
                <h2 className="text-lg font-extrabold text-brand-white flex items-center gap-2">
                  <Plus size={20} className="text-brand-blue" />
                  Inserimento Articolo / Paletta
                </h2>
                <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
                  {['Settala', 'Caleppio'].map(wh => (
                    <button
                      key={wh}
                      type="button"
                      onClick={() => setFormData({ ...formData, warehouse: wh })}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                        formData.warehouse === wh
                          ? wh === 'Settala'
                            ? 'bg-brand-blue text-brand-black shadow'
                            : 'bg-amber-500 text-brand-black shadow'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {wh}
                    </button>
                  ))}
                </div>
              </div>
              
              <form onSubmit={handleAddToCart} className="space-y-4">
                
                {/* Cliente Madre & Eventuale Frammentazione */}
                <div>
                  <label className="block text-slate-400 font-bold mb-1.5 text-[11px] uppercase tracking-wider">
                    Cliente Proprietario (Cliente Madre) *
                  </label>
                  <Select 
                    styles={selectStyles}
                    options={parentCustomerOptions}
                    placeholder="Seleziona cliente..."
                    value={parentCustomerOptions.find(c => c.value === formData.parent_customer_id) || null}
                    onChange={val => {
                      const parentId = val ? val.value : null;
                      setFormData({
                        ...formData,
                        parent_customer_id: parentId,
                        fragment_id: null,
                        customer_id: parentId,
                        product_id: null
                      });
                    }}
                  />
                </div>

                {/* Se il Cliente Madre selezionato è frammentato, mostra la scelta della Frammentazione (o vuoto per Cliente Madre) */}
                {formData.parent_customer_id && availableFragments.length > 0 && (
                  <div className="bg-violet-950/20 border border-violet-500/35 rounded-2xl p-3.5 space-y-2.5 animate-fade-in-up">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-violet-300 font-extrabold text-[11px] uppercase tracking-wider flex items-center gap-1.5">
                        <GitBranch size={14} className="text-violet-400" />
                        Frammentazione / Reparto (Opzionale)
                      </label>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700 text-slate-300">
                        {formData.fragment_id
                          ? `Destinazione: ${availableFragments.find(f => f.value === formData.fragment_id)?.label}`
                          : `Diretto a Cliente Madre (${customers.find(c => c.value === formData.parent_customer_id)?.label})`}
                      </span>
                    </div>

                    <Select
                      isClearable
                      styles={selectStyles}
                      options={availableFragments}
                      placeholder={`-- Vuoto: invia direttamente a ${customers.find(c => c.value === formData.parent_customer_id)?.label || 'Cliente Madre'} --`}
                      value={availableFragments.find(f => f.value === formData.fragment_id) || null}
                      onChange={val => handleFragmentChange(val ? val.value : null)}
                    />

                    {/* Scelta rapida con 1 click */}
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      <button
                        type="button"
                        onClick={() => handleFragmentChange(null)}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 border ${
                          !formData.fragment_id
                            ? 'bg-brand-blue text-brand-black border-brand-blue shadow'
                            : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                        }`}
                      >
                        <Building2 size={11} />
                        Diretto a {customers.find(c => c.value === formData.parent_customer_id)?.label} (Madre)
                      </button>
                      {availableFragments.map(frag => (
                        <button
                          key={frag.value}
                          type="button"
                          onClick={() => handleFragmentChange(frag.value)}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 border ${
                            formData.fragment_id === frag.value
                              ? 'bg-violet-500 text-white border-violet-400 shadow'
                              : 'bg-slate-900 text-violet-300 border-slate-800 hover:border-violet-500/50'
                          }`}
                        >
                          <GitBranch size={11} />
                          {frag.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-slate-400 font-bold mb-1.5 text-[11px] uppercase tracking-wider">Prodotto / SKU *</label>
                  <CreatableSelect 
                    styles={selectStyles}
                    options={filteredProducts}
                    placeholder={formData.customer_id ? "Seleziona o digita nuovo prodotto..." : "Seleziona prima il cliente"}
                    isDisabled={!formData.customer_id || isProcessing}
                    formatCreateLabel={(val) => `+ Crea nuovo prodotto: "${val}"`}
                    value={formData.isNewProduct ? { label: formData.newProductName, value: formData.product_id } : (products.find(p => p.value === formData.product_id) || null)}
                    onChange={val => {
                      if (!val) {
                        setFormData({...formData, product_id: null, isNewProduct: false, newProductName: ''});
                        return;
                      }
                      if (val.__isNew__) {
                        setFormData({
                          ...formData,
                          product_id: 'NEW',
                          isNewProduct: true,
                          newProductName: val.value,
                          units_per_box: '',
                          boxes_per_pallet: '',
                          client_article_number: '',
                          flags: []
                        });
                      } else {
                        const prod = products.find(p => p.value === val.value);
                        const defaultArticle = prod?.raw?.default_article_number || (prod?.raw?.sku && !prod.raw.sku.startsWith('PROD-') ? prod.raw.sku : '');
                        const parsedFlags = prod?.raw?.flags ? (typeof prod.raw.flags === 'string' ? JSON.parse(prod.raw.flags) : prod.raw.flags) : [];
                        setFormData({
                          ...formData, 
                          product_id: val.value,
                          isNewProduct: false,
                          newProductName: '',
                          units_per_box: prod?.raw?.units_per_box || '',
                          boxes_per_pallet: prod?.raw?.boxes_per_pallet || '',
                          client_article_number: defaultArticle,
                          flags: parsedFlags.map(f => ({ label: f, value: f }))
                        });
                      }
                    }}
                  />
                </div>

                {/* Confezionamento & Quantità */}
                <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-400 font-bold mb-1 text-[10px] uppercase tracking-wider">Pezzi per Scatola</label>
                      <input type="number" onWheel={(e) => e.target.blur()} min="0" value={formData.units_per_box} onChange={e => setFormData({...formData, units_per_box: e.target.value})} className="w-full bg-slate-900 border border-slate-800 text-brand-white rounded-xl px-3 py-2 text-sm focus:ring-brand-blue" placeholder="Es. 12" />
                    </div>
                    <div>
                      <label className="block text-slate-400 font-bold mb-1 text-[10px] uppercase tracking-wider">Scatole per Paletta</label>
                      <input type="number" onWheel={(e) => e.target.blur()} min="0" value={formData.boxes_per_pallet} onChange={e => setFormData({...formData, boxes_per_pallet: e.target.value})} className="w-full bg-slate-900 border border-slate-800 text-brand-white rounded-xl px-3 py-2 text-sm focus:ring-brand-blue" placeholder="Es. 60" />
                    </div>
                  </div>

                  <div className="grid grid-cols-12 gap-3">
                    <div className="col-span-4">
                      <label className="block text-slate-300 font-bold mb-1 text-[11px] uppercase tracking-wider">Quantità *</label>
                      <input required type="number" onWheel={(e) => e.target.blur()} step="0.01" value={formData.quantity} onChange={e => setFormData({...formData, quantity: e.target.value})} className="w-full bg-slate-900 border border-slate-700 text-brand-white font-bold rounded-xl px-3 py-2 text-sm focus:ring-brand-blue" placeholder="Es. 50" />
                    </div>
                    <div className="col-span-4">
                      <label className="block text-slate-400 font-bold mb-1 text-[11px] uppercase tracking-wider">Unità</label>
                      <select value={formData.entry_uom} onChange={e => setFormData({...formData, entry_uom: e.target.value})} className="w-full bg-slate-900 border border-slate-800 text-brand-white rounded-xl px-2.5 py-2 text-sm focus:ring-brand-blue">
                        <option value="Base">{products.find(p => p.value === formData.product_id)?.raw?.uom || 'Pezzi'}</option>
                        <option value="Scatole">Scatole</option>
                        <option value="Bancali">Bancali</option>
                        <option value="KG">KG</option>
                        <option value="Metro Cubo">m³</option>
                      </select>
                    </div>
                    <div className="col-span-4">
                      <label className="block text-slate-400 font-bold mb-1 text-[11px] uppercase tracking-wider">Lotto (Opz.)</label>
                      <input value={formData.batch} onChange={e => setFormData({...formData, batch: e.target.value})} className="w-full bg-slate-900 border border-slate-800 text-brand-white rounded-xl px-3 py-2 text-sm focus:ring-brand-blue" placeholder="Es. L-2026/A" />
                    </div>
                  </div>
                  {renderQuantityHint()}
                </div>

                {/* Scadenza e Posizione Scaffale */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-400 font-bold mb-1 text-[11px] uppercase tracking-wider">Scadenza (Opzionale)</label>
                    <input type="date" value={formData.expiration_date} onChange={e => setFormData({...formData, expiration_date: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-3 py-2.5 text-sm focus:ring-brand-blue [color-scheme:dark]" />
                  </div>
                  <div>
                    <label className="block text-slate-400 font-bold mb-1 text-[11px] uppercase tracking-wider">Posizione (Opz. - Stiva subito)</label>
                    <CreatableSelect
                      isClearable
                      styles={selectStyles}
                      options={allLocationsOptions}
                      placeholder="Es. A-01-01..."
                      formatCreateLabel={(val) => `Assegna "${val.toUpperCase().trim()}"`}
                      value={
                        formData.location
                          ? (allLocationsOptions.find(o => o.value === formData.location) || { value: formData.location, label: formData.location })
                          : null
                      }
                      onChange={val => setFormData({ ...formData, location: val ? String(val.value).toUpperCase().trim() : '' })}
                    />
                  </div>
                </div>

                {/* Codici Cliente & Arrivo */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-400 font-bold mb-1 text-[10px] uppercase tracking-wider">Codice Articolo (SKU)</label>
                    <input value={formData.client_article_number} onChange={e => setFormData({...formData, client_article_number: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-3 py-2 text-sm focus:ring-brand-blue" placeholder="Es. ART-001" />
                  </div>
                  <div>
                    <label className="block text-slate-400 font-bold mb-1 text-[10px] uppercase tracking-wider">Rif. Paletta Cliente</label>
                    <input value={formData.client_pallet_number} onChange={e => setFormData({...formData, client_pallet_number: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-3 py-2 text-sm focus:ring-brand-blue" placeholder="Es. Longlife" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-400 font-bold mb-1 text-[10px] uppercase tracking-wider">Data di Arrivo *</label>
                    <input type="datetime-local" required value={formData.arrival_date} onChange={e => setFormData({...formData, arrival_date: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-2.5 py-2 text-xs focus:ring-brand-blue [color-scheme:dark]" />
                  </div>
                  <div>
                    <label className="block text-slate-400 font-bold mb-1 text-[10px] uppercase tracking-wider">Flag (es. ADR)</label>
                    <CreatableSelect
                      isMulti
                      styles={selectStyles}
                      placeholder="Flag..."
                      noOptionsMessage={() => "Nessun flag"}
                      formatCreateLabel={(val) => `+ "${val}"`}
                      value={formData.flags}
                      options={availableFlagsOptions}
                      onChange={val => setFormData({...formData, flags: val})}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 font-bold mb-1 text-[10px] uppercase tracking-wider">Note Paletta (Opzionale)</label>
                  <input type="text" value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl px-3 py-2 text-sm focus:ring-brand-blue" placeholder="Es. Scatola danneggiata, nome per paletta generica, ecct..." />
                </div>

                <button type="submit" disabled={isProcessing} className="w-full py-3.5 bg-brand-blue/15 hover:bg-brand-blue text-brand-blue hover:text-brand-black border border-brand-blue/40 rounded-2xl font-black transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg">
                  <Plus size={20} />
                  Aggiungi alla Lista (Carrello)
                </button>

              </form>
            </div>
          )}

          {/* COLONNA DESTRA: CARRELLO AD ALTA VISIBILITÀ CON MODIFICA INLINE (7/12 o 12/12 se espanso) */}
          <div className={`${expandCart ? 'xl:col-span-12' : 'xl:col-span-7'} bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-col`}>
            
            {/* Header Carrello + Ricerca + Azioni */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-brand-blue/15 border border-brand-blue/30 flex items-center justify-center text-brand-blue shrink-0">
                  <FileText size={20} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-extrabold text-brand-white">Lista di Lavoro (Carrello)</h2>
                    <span className="bg-brand-blue text-brand-black font-black px-2.5 py-0.5 rounded-full text-xs">
                      {cart.length} {cart.length === 1 ? 'riga' : 'righe'}
                    </span>
                    {cart.length > 0 && (
                      <span className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-bold px-2.5 py-0.5 rounded-full text-xs">
                        {totalPalletsToGenerate} {totalPalletsToGenerate === 1 ? 'etichetta' : 'etichette'}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Clicca direttamente su <strong>Quantità</strong>, <strong>Lotto</strong>, <strong>Posizione</strong> o <strong>Scadenza</strong> per modificarli inline.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {cart.length > 0 && (
                  <div className="relative">
                    <Search size={14} className="text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={cartSearch}
                      onChange={e => setCartSearch(e.target.value)}
                      placeholder="Filtra nel carrello..."
                      className="bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-7 py-1.5 text-xs text-brand-white focus:border-brand-blue w-44"
                    />
                    {cartSearch && (
                      <button
                        type="button"
                        onClick={() => setCartSearch('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setExpandCart(!expandCart)}
                  className="p-2 bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-xl transition-colors"
                  title={expandCart ? "Mostra anche il form di inserimento" : "Espandi il carrello a tutto schermo"}
                >
                  {expandCart ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>

                {cart.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearCart}
                    className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-xl text-xs font-bold transition-colors"
                    title="Svuota tutto il carrello"
                  >
                    Svuota
                  </button>
                )}
              </div>
            </div>

            {/* Lista Scorrevole Ampia delle Righe del Carrello con Editing Inline */}
            <div className="flex-1 min-h-[460px] max-h-[65vh] overflow-y-auto py-4 pr-1 space-y-2.5">
              {cart.length === 0 ? (
                <div className="h-[420px] flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-slate-800/80 rounded-2xl text-slate-500">
                  <PackagePlus size={44} className="text-slate-700 mb-3" />
                  <p className="font-bold text-slate-400 text-base">Il carrello è vuoto</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm">
                    Seleziona un cliente e carica un file <strong>Excel / CSV</strong> oppure aggiungi gli articoli dal modulo a sinistra.
                  </p>
                </div>
              ) : filteredCart.length === 0 ? (
                <div className="text-center p-8 text-slate-500 italic text-sm">
                  Nessuna riga del carrello corrisponde a "{cartSearch}".
                </div>
              ) : (
                filteredCart.map(({ item, originalIndex }) => {
                  const isSharedLocation =
                    item.location &&
                    cart.filter(c => c.location && c.location.toUpperCase() === item.location.toUpperCase()).length > 1;
                  const upb = parseFloat(item.units_per_box) || 1;
                  const qtyNum = parseFloat(item.quantity) || 0;

                  return (
                    <div
                      key={item.id}
                      className="bg-slate-950/90 border border-slate-800 hover:border-slate-700 rounded-2xl p-3.5 transition-all relative overflow-hidden"
                    >
                      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${item.warehouse === 'Settala' ? 'bg-brand-blue' : 'bg-amber-500'}`} />

                      {/* Riga Superiore: Numero progressivo, Nome Prodotto, Magazzino, Elimina */}
                      <div className="flex items-center justify-between gap-2 pl-2 mb-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[11px] font-mono font-black px-2 py-0.5 rounded-lg bg-slate-900 border border-slate-800 text-brand-blue shrink-0">
                            #{originalIndex + 1}
                          </span>
                          <span className="font-bold text-brand-white text-sm truncate" title={item.product_name}>
                            {item.product_name}
                          </span>
                          {item.customer_name && (
                            <span className="text-[10px] font-bold bg-violet-500/15 border border-violet-500/30 px-2 py-0.5 rounded-md text-violet-300 shrink-0">
                              {item.customer_name}
                            </span>
                          )}
                          {upb > 1 && (
                            <span className="text-[10px] font-bold bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-md text-slate-300 shrink-0">
                              {Math.floor(qtyNum / upb)} Scat.
                              {qtyNum % upb > 0 ? ` + ${qtyNum % upb} Sfusi` : ''}
                            </span>
                          )}
                          {isSharedLocation && (
                            <span className="text-[10px] font-extrabold bg-amber-500/15 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-md shrink-0">
                              Paletta Frammentata ({item.location})
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => updateCartItem(item.id, { warehouse: item.warehouse === 'Settala' ? 'Caleppio' : 'Settala' })}
                            className={`px-2 py-0.5 rounded-lg text-[10px] font-extrabold uppercase tracking-wider border transition-colors ${
                              item.warehouse === 'Settala'
                                ? 'bg-brand-blue/10 text-brand-blue border-brand-blue/30 hover:bg-brand-blue/20'
                                : 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20'
                            }`}
                            title="Clicca per cambiare magazzino (Settala / Caleppio)"
                          >
                            {item.warehouse}
                          </button>

                          <button
                            type="button"
                            onClick={() => removeFromCart(item.id)}
                            className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                            title="Rimuovi riga dal carrello"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>

                      {/* Griglia Campi Modificabili Inline */}
                      <div className="grid grid-cols-2 sm:grid-cols-12 gap-2 pl-2 items-center">
                        
                        {/* 1. Quantità Inline */}
                        <div className="sm:col-span-3">
                          <label className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-500 mb-0.5">
                            Quantità ({item.pallet_uom || item.uom || 'Pezzi'})
                          </label>
                          <input
                            type="number"
                            min="0.01"
                            step="any"
                            onWheel={(e) => e.target.blur()}
                            value={item.quantity}
                            onChange={(e) => updateCartItem(item.id, { quantity: e.target.value === '' ? '' : parseFloat(e.target.value) || 0 })}
                            className="w-full bg-slate-900 border border-slate-700 focus:border-emerald-400 text-emerald-400 font-black text-sm rounded-lg px-2.5 py-1.5 focus:outline-none"
                          />
                        </div>

                        {/* 2. Lotto Inline */}
                        <div className="sm:col-span-3">
                          <label className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-500 mb-0.5">
                            Lotto
                          </label>
                          <input
                            type="text"
                            value={item.batch || ''}
                            placeholder="Nessun lotto"
                            onChange={(e) => updateCartItem(item.id, { batch: e.target.value })}
                            className="w-full bg-slate-900 border border-slate-800 focus:border-amber-400 text-amber-300 font-mono font-bold text-xs rounded-lg px-2.5 py-1.5 focus:outline-none placeholder-slate-600"
                          />
                        </div>

                        {/* 3. Posizione Inline */}
                        <div className="sm:col-span-3">
                          <label className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-500 mb-0.5">
                            Posizione Scaffale
                          </label>
                          <input
                            type="text"
                            list="inbound-locations-datalist"
                            value={item.location || ''}
                            placeholder="In attesa..."
                            onChange={(e) => updateCartItem(item.id, { location: e.target.value })}
                            className={`w-full bg-slate-900 border font-mono font-bold text-xs rounded-lg px-2.5 py-1.5 focus:outline-none placeholder-slate-600 uppercase ${
                              item.location
                                ? isSharedLocation
                                  ? 'border-amber-500/50 text-amber-400 focus:border-amber-400'
                                  : 'border-emerald-500/50 text-emerald-400 focus:border-emerald-400'
                                : 'border-slate-800 text-slate-300 focus:border-brand-blue'
                            }`}
                          />
                        </div>

                        {/* 4. Scadenza Inline */}
                        <div className="sm:col-span-3">
                          <label className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-500 mb-0.5">
                            Scadenza
                          </label>
                          <input
                            type="date"
                            value={item.expiration_date || ''}
                            onChange={(e) => updateCartItem(item.id, { expiration_date: e.target.value })}
                            className="w-full bg-slate-900 border border-slate-800 focus:border-brand-blue text-slate-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none [color-scheme:dark]"
                          />
                        </div>

                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* BARRA COMPATTA OPZIONI DI STAMPA E GENERAZIONE */}
            {cart.length > 0 && (
              <div className="pt-4 border-t border-slate-800 space-y-3">
                
                {/* Riga 1: 3 Switch Modalità compatti */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <label
                    className={`flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-all select-none ${
                      abilitaSpunta
                        ? 'bg-brand-blue/15 border-brand-blue text-brand-blue'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={abilitaSpunta}
                      onChange={e => setAbilitaSpunta(e.target.checked)}
                      className="w-4 h-4 rounded bg-slate-900 border-brand-blue text-brand-blue focus:ring-0"
                    />
                    <div className="min-w-0">
                      <div className="font-bold text-xs leading-tight">Spunta DDT (Zebra)</div>
                      <div className="text-[10px] text-slate-400 truncate">Genera bolla da spuntare</div>
                    </div>
                  </label>

                  {!abilitaSpunta && (
                    <>
                      <label
                        className={`flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-all select-none ${
                          printOptions.isMixed
                            ? 'bg-amber-500/15 border-amber-500 text-amber-400'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={printOptions.isMixed}
                          onChange={e => setPrintOptions({ ...printOptions, isMixed: e.target.checked })}
                          className="w-4 h-4 rounded bg-slate-900 border-amber-500 text-amber-500 focus:ring-0"
                        />
                        <div className="min-w-0">
                          <div className="font-bold text-xs leading-tight">Unica Paletta Mista</div>
                          <div className="text-[10px] text-slate-400 truncate">1 solo barcode per tutto</div>
                        </div>
                      </label>

                      <label
                        className={`flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-all select-none ${
                          printOptions.noBarcode
                            ? 'bg-emerald-500/15 border-emerald-500 text-emerald-400'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={printOptions.noBarcode}
                          onChange={e => setPrintOptions({ ...printOptions, noBarcode: e.target.checked })}
                          className="w-4 h-4 rounded bg-slate-900 border-emerald-500 text-emerald-500 focus:ring-0"
                        />
                        <div className="min-w-0">
                          <div className="font-bold text-xs leading-tight">Senza Etichetta</div>
                          <div className="text-[10px] text-slate-400 truncate">Stoccaggio in zona libera</div>
                        </div>
                      </label>
                    </>
                  )}
                </div>

                {/* Se Senza Etichetta -> Selettore Posizione Libera */}
                {!abilitaSpunta && printOptions.noBarcode && (
                  <div className="animate-fade-in-up">
                    <Select 
                      options={freeLocations}
                      placeholder="Seleziona la posizione libera (da Magazzino)..."
                      noOptionsMessage={() => "Nessuna posizione libera definita in Magazzino"}
                      value={freeLocations.find(fl => fl.value === printOptions.freeLocation) || null}
                      onChange={selected => setPrintOptions({...printOptions, freeLocation: selected ? selected.value : ''})}
                      styles={selectStyles}
                    />
                  </div>
                )}

                {/* Riga 2: Formato Stampa Compatto + Pulsante Genera */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  {!abilitaSpunta && !printOptions.noBarcode && (
                    <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 gap-1 shrink-0">
                      <Printer size={14} className="text-slate-500 ml-2 mr-1" />
                      <button
                        type="button"
                        onClick={() => setPrintOptions({ ...printOptions, paper_format: 'A4', print_mode: 'GRID' })}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          printOptions.paper_format === 'A4' && printOptions.print_mode === 'GRID'
                            ? 'bg-brand-blue text-brand-black shadow'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        A4 (8x)
                      </button>
                      <button
                        type="button"
                        onClick={() => setPrintOptions({ ...printOptions, paper_format: 'A4', print_mode: 'SINGLE_PAGE' })}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          printOptions.paper_format === 'A4' && printOptions.print_mode === 'SINGLE_PAGE'
                            ? 'bg-brand-blue text-brand-black shadow'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        A4 (1x)
                      </button>
                      <button
                        type="button"
                        onClick={() => setPrintOptions({ ...printOptions, paper_format: 'THERMAL', print_mode: 'SINGLE_PAGE' })}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          printOptions.paper_format === 'THERMAL'
                            ? 'bg-brand-blue text-brand-black shadow'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Termica 100x150
                      </button>
                    </div>
                  )}

                  <button 
                    type="button"
                    onClick={handleGenerate} 
                    disabled={isGenerating} 
                    className="flex-1 py-3.5 px-6 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-2xl font-black text-base transition-all shadow-[0_0_25px_rgba(14,165,233,0.3)] disabled:opacity-50 flex items-center justify-center gap-2.5"
                  >
                    <Download size={20} />
                    {isGenerating
                      ? 'Generazione in corso...'
                      : abilitaSpunta
                      ? `Genera DDT Entrata (${cart.length} righe)`
                      : printOptions.noBarcode
                      ? `Registra in Zona Libera (${cart.length} righe)`
                      : `Genera e Stampa ${totalPalletsToGenerate} Etichett${totalPalletsToGenerate > 1 ? 'e' : 'a'}`}
                  </button>
                </div>

              </div>
            )}

          </div>

        </div>
      </div>
    </div>
  );
};

export default Inbound;
