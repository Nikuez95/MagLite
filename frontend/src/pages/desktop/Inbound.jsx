import { appAlert, appConfirm, appPrompt } from "../../utils/alerts.js";
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import Select from 'react-select';
import CreatableSelect from 'react-select/creatable';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { Download, Upload, PackagePlus, FileText, Trash2, Plus, Printer } from 'lucide-react';

const Inbound = () => {
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [serverFlags, setServerFlags] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // Carrello locale
  const [cart, setCart] = useState([]);

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
      setCustomers(custRes.data.map(c => ({ value: c.id, label: c.business_name })));
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

  const handleCreateProduct = async (inputValue) => {
    if (!formData.customer_id) {
      appAlert('Seleziona prima il Cliente Proprietario!');
      return;
    }
    const uom = await appPrompt('Inserisci unit di misura (es. Scatole, Bancali, Pezzi, KG, Metro Cubo):', 'Unit Base');
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

  const filteredProducts = products.filter(p => p.raw.customer_id === formData.customer_id);


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
      { wch: 18 }, // Codice Articolo
      { wch: 28 }, // Prodotto
      { wch: 12 }, // Quantità
      { wch: 18 }, // Unità di Misura
      { wch: 18 }, // Pezzi per Scatola
      { wch: 20 }, // Scatole per Bancale
      { wch: 15 }, // Lotto
      { wch: 14 }, // Scadenza
      { wch: 14 }, // Posizione
      { wch: 22 }, // Moltiplicatore Palette
      { wch: 14 }, // Magazzino
      { wch: 16 }, // Paletta Cliente
      { wch: 48 }  // Note
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

        // Rileva automaticamente la riga di intestazione (anche se ci sono righe vuote o titoli in alto)
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

          // Salta righe completamente vuote
          const isRowEmpty = Object.values(row).every(v => String(v ?? '').trim() === '');
          if (isRowEmpty) continue;

          // Normalizza le chiavi della riga
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

          // Cerca eventuale prodotto esistente per SKU / Codice Articolo o per Nome
          let existingProd = null;
          if (articoloCliente) {
            existingProd = currentProducts.find(p =>
              p.raw.sku?.trim().toLowerCase() === articoloCliente.toLowerCase() ||
              (p.raw.customer_id === formData.customer_id && p.raw.default_article_number?.trim().toLowerCase() === articoloCliente.toLowerCase())
            );
          }
          const existingByName = prodName
            ? currentProducts.find(p =>
                p.raw.customer_id === formData.customer_id &&
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

            // Se è presente un Codice Articolo reale, sostituisci ed elimina il vecchio SKU generato (es. PROD-XXXX)
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
            expiration_date: scadenza,
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
        
        await fetchData(); // refresh products list
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

        // Se è presente un Codice Articolo, sostituisci ed elimina il vecchio SKU generato (es. PROD-XXXX) con il Codice Articolo
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
    
    // Reset partial form for quick entry
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

  const handleGenerate = async () => {
    if (cart.length === 0) return;

    if (abilitaSpunta) {
      setIsGenerating(true);
      try {
        const payload = { cart };
        const res = await axios.post(`http://${window.location.hostname}:3000/api/inbound/ddt`, payload, {
          headers: { Authorization: `Bearer ${getToken()}` }
        });
        
        appAlert(`DDT Inbound ${res.data.ddt_number} generato in attesa di spunta!`);
        
        // Open PDF
        window.open(`http://${window.location.hostname}:3000/api/inbound/ddt/${res.data.ddt_id}/pdf?token=${getToken()}`, '_blank');
        
        setCart([]);
        setFormData({...formData, customer_id: '', product_id: null, isNewProduct: false, newProductName: ''});
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

      // Clear cart
      setCart([]);
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
      padding: '0.25rem',
      boxShadow: 'none',
      '&:hover': { borderColor: '#38bdf8' }
    }),
    menu: base => ({ ...base, backgroundColor: '#0f172a', zIndex: 50, border: '1px solid #1e293b' }),
    option: (base, state) => ({ ...base, backgroundColor: state.isFocused ? '#1e293b' : 'transparent', color: '#f8fafc', cursor: 'pointer' }),
    singleValue: base => ({ ...base, color: '#f8fafc' }),
    input: base => ({ ...base, color: '#f8fafc' }),
    multiValue: base => ({ ...base, backgroundColor: '#1e293b', borderRadius: '0.375rem', border: '1px solid #334155' }),
    multiValueLabel: base => ({ ...base, color: '#38bdf8', fontWeight: 'bold', fontSize: '0.75rem', textTransform: 'uppercase' }),
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
        <div className="mt-2 text-xs font-bold text-slate-400">
          Totale base: <span className="text-brand-blue">{actualQtyForHint} {prodUom}</span> 
          <span className="ml-2 font-normal text-[10px] uppercase tracking-wider text-slate-500">
            [{scatole} Scat.{sfusi > 0 ? ` + ${sfusi} Sfusi` : ''}]
          </span>
        </div>
      );
    } else {
      return (
        <div className="mt-2 text-xs font-bold text-slate-400">
          Totale base: <span className="text-brand-blue">{actualQtyForHint} {prodUom}</span>
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
  }, [cart]);

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-brand-black min-h-screen relative">
      {isProcessing && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
          <div className="w-16 h-16 border-4 border-brand-blue border-t-transparent rounded-full animate-spin mb-4"></div>
          <h2 className="text-2xl font-bold text-white">Elaborazione in corso...</h2>
          <p className="text-slate-400 mt-2">Attendere prego, potrebbe richiedere qualche istante.</p>
        </div>
      )}
      <div className="max-w-7xl mx-auto animate-fade-in-up">
        
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-brand-white mb-2 flex items-center gap-3">
            <PackagePlus className="text-brand-blue" size={32} />
            Nuova Merce (In-bound)
          </h1>
          <p className="text-slate-400">Architettura a Carrello: accumula le richieste e stampa le etichette in blocco.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* Form */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-xl">
            <h2 className="text-xl font-bold text-brand-white mb-6">Inserimento Merce</h2>
              <div className="flex gap-2 mb-6">
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
                  className="flex-1 py-2 bg-brand-blue/10 text-brand-blue border border-brand-blue/30 rounded-xl font-bold hover:bg-brand-blue hover:text-brand-black transition-colors flex items-center justify-center gap-2 text-sm"
                >
                  <Upload size={16} />
                  Carica Excel / CSV
                </button>
                <button 
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="flex-1 py-2 bg-slate-800 text-slate-300 border border-slate-700 rounded-xl font-bold hover:bg-slate-700 transition-colors flex items-center justify-center gap-2 text-sm"
                >
                  <Download size={16} />
                  Template
                </button>
              </div>
            
            <form onSubmit={handleAddToCart} className="space-y-6">
              
              <div>
                <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Cliente Proprietario *</label>
                <Select 
                  styles={selectStyles}
                  options={customers}
                  placeholder="Seleziona cliente..."
                  value={customers.find(c => c.value === formData.customer_id)}
                  onChange={val => {
                    setFormData({...formData, customer_id: val.value, product_id: null});
                  }}
                />
              </div>

              <div>
                <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Prodotto / SKU *</label>
                <CreatableSelect 
                  styles={selectStyles}
                  options={filteredProducts}
                  placeholder={formData.customer_id ? "Seleziona o crea..." : "Seleziona prima il cliente"}
                  isDisabled={!formData.customer_id || isProcessing}
                  formatCreateLabel={(val) => `Crea nuovo per questo cliente: "${val}"`}
                  value={formData.isNewProduct ? { label: formData.newProductName, value: formData.product_id } : products.find(p => p.value === formData.product_id)}
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

              <div className="grid grid-cols-2 gap-6 items-end">
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-[10px] uppercase tracking-wider">Unità/Pezzi per Scatola (su questa paletta)</label>
                  <input type="number" onWheel={(e) => e.target.blur()} min="0" value={formData.units_per_box} onChange={e => setFormData({...formData, units_per_box: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue" />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-[10px] uppercase tracking-wider">Scatole per Paletta</label>
                  <input type="number" onWheel={(e) => e.target.blur()} min="0" value={formData.boxes_per_pallet} onChange={e => setFormData({...formData, boxes_per_pallet: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-6">
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Quantità *</label>
                  <input required type="number" onWheel={(e) => e.target.blur()} step="0.01" value={formData.quantity} onChange={e => setFormData({...formData, quantity: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue" placeholder="Es. 50" />
                  {renderQuantityHint()}
                </div>
                <div className="md:col-span-1">
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Unità</label>
                  <select value={formData.entry_uom} onChange={e => setFormData({...formData, entry_uom: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue">
                    <option value="Base">Unità Base ({products.find(p => p.value === formData.product_id)?.raw?.uom || 'Pezzi'})</option>
                    <option value="Scatole">Scatole</option>
                    <option value="Bancali">Intero Bancali</option>
                    <option value="KG">KG</option>
                    <option value="Metro Cubo">Metro Cubo (m³)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Lotto (Opzionale)</label>
                  <input value={formData.batch} onChange={e => setFormData({...formData, batch: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue" placeholder="Es. L-2026/A" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Num. Paletta Cliente (Opz.)</label>
                  <input value={formData.client_pallet_number} onChange={e => setFormData({...formData, client_pallet_number: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue" placeholder="Es. PAL-CLI-123" />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Codice Articolo (Opz.)</label>
                  <input value={formData.client_article_number} onChange={e => setFormData({...formData, client_article_number: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue" placeholder="Es. ART-001" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Scadenza (Opzionale)</label>
                  <input type="date" value={formData.expiration_date} onChange={e => setFormData({...formData, expiration_date: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue [color-scheme:dark]" />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Data di Arrivo *</label>
                  <input type="datetime-local" required value={formData.arrival_date} onChange={e => setFormData({...formData, arrival_date: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue [color-scheme:dark]" />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Flag (es. ADR) - Opzionale</label>
                <CreatableSelect
                  isMulti
                  styles={selectStyles}
                  placeholder="Digita un flag e premi invio..."
                  noOptionsMessage={() => "Nessun flag trovato"}
                  formatCreateLabel={(val) => `Crea flag "${val}"`}
                  value={formData.flags}
                  options={availableFlagsOptions}
                  onChange={val => setFormData({...formData, flags: val})}
                />
              </div>

              <div>
                <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Destinazione Magazzino</label>
                <div className="flex gap-4">
                  <label className={`flex-1 flex items-center justify-center p-3 rounded-xl border-2 cursor-pointer transition-all ${formData.warehouse === 'Settala' ? 'border-brand-blue bg-brand-blue/10' : 'border-slate-800 bg-slate-950'}`}>
                    <input type="radio" name="wh" className="hidden" checked={formData.warehouse === 'Settala'} onChange={() => setFormData({...formData, warehouse: 'Settala'})} />
                    <span className={`font-bold text-sm ${formData.warehouse === 'Settala' ? 'text-brand-blue' : 'text-slate-500'}`}>Settala</span>
                  </label>
                  <label className={`flex-1 flex items-center justify-center p-3 rounded-xl border-2 cursor-pointer transition-all ${formData.warehouse === 'Caleppio' ? 'border-amber-500 bg-amber-500/10' : 'border-slate-800 bg-slate-950'}`}>
                    <input type="radio" name="wh" className="hidden" checked={formData.warehouse === 'Caleppio'} onChange={() => setFormData({...formData, warehouse: 'Caleppio'})} />
                    <span className={`font-bold text-sm ${formData.warehouse === 'Caleppio' ? 'text-amber-500' : 'text-slate-500'}`}>Caleppio</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Note Paletta (Opzionale)</label>
                <textarea value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue resize-none h-20" placeholder="Es. Scatola danneggiata, priorità alta..."></textarea>
              </div>

              <div>
                <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Posizione (Opzionale - assegna già alla paletta)</label>
                <CreatableSelect
                  isClearable
                  styles={selectStyles}
                  options={allLocationsOptions}
                  placeholder="Seleziona o digita posizione (es. A-01-01)... Lascia vuoto per standard"
                  formatCreateLabel={(val) => `Assegna posizione "${val.toUpperCase().trim()}"`}
                  value={
                    formData.location
                      ? (allLocationsOptions.find(o => o.value === formData.location) || { value: formData.location, label: formData.location })
                      : null
                  }
                  onChange={val => setFormData({ ...formData, location: val ? String(val.value).toUpperCase().trim() : '' })}
                />
              </div>

              <div className="pt-4 border-t border-slate-800">
                <div className="bg-brand-blue/10 border border-brand-blue/30 rounded-2xl p-4 flex items-center justify-between">
                  <div>
                    <label className="block text-brand-blue font-black mb-1 text-xs uppercase tracking-wider">Moltiplicatore Etichette</label>
                    <span className="text-slate-400 text-sm">Quante palette uguali?</span>
                  </div>
                  <input type="number" onWheel={(e) => e.target.blur()} min="1" max="50" required value={formData.num_pallets} onChange={e => setFormData({...formData, num_pallets: parseInt(e.target.value)})} className="w-20 bg-slate-900 border-2 border-brand-blue text-brand-white rounded-xl p-2 text-center text-xl font-bold focus:ring-brand-blue" />
                </div>
              </div>

              <button type="submit" disabled={isProcessing} className="w-full py-4 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-2xl font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                <Plus size={20} />
                Aggiungi alla Lista
              </button>

            </form>
          </div>

          {/* Carrello e Opzioni Stampa */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-xl flex flex-col h-[800px]">
            <h2 className="text-xl font-bold text-brand-white mb-6 flex items-center gap-2">
              <FileText className="text-slate-400" size={24} />
              Lista di Lavoro (Carrello)
              <span className="ml-auto bg-brand-blue text-brand-black px-3 py-1 rounded-full text-sm">{cart.length} voci</span>
            </h2>
            
            <div className="flex-1 overflow-y-auto pr-2 space-y-3">
              {cart.length === 0 ? (
                <div className="text-center p-8 text-slate-500 italic">Lista vuota. Aggiungi prodotti dal form.</div>
              ) : cart.map((item, idx) => {
                const isSharedLocation = item.location && cart.filter(c => c.location && c.location.toUpperCase() === item.location.toUpperCase()).length > 1;
                return (
                <div key={item.id} className="bg-slate-950 border border-slate-800 rounded-2xl p-4 flex gap-4 items-center group relative overflow-hidden">
                  <div className={`absolute left-0 top-0 bottom-0 w-1 ${item.warehouse === 'Settala' ? 'bg-brand-blue' : 'bg-amber-500'}`}></div>
                  <div className="flex-1 pl-2">
                    <div className="font-bold text-slate-300 text-sm mb-1 truncate">{item.product_name}</div>
                    <div className="text-xs text-slate-500 flex items-center flex-wrap gap-2">
                      <span>Q.tà: <strong className="text-emerald-400">{item.quantity}</strong></span>
                      {item.units_per_box > 1 && (
                        <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-300">
                          {Math.floor(item.quantity / item.units_per_box)} Scat.
                          {(item.quantity % item.units_per_box) > 0 && ` + ${(item.quantity % item.units_per_box)} Sfusi`}
                        </span>
                      )}
                      <span className="text-slate-600">|</span>
                      <span>{item.warehouse}</span>
                      {item.batch && (
                        <>
                          <span className="text-slate-600">|</span>
                          <span className="text-amber-400 font-mono">Lotto: {item.batch}</span>
                        </>
                      )}
                      {item.location && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${isSharedLocation ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'}`}>
                          Pos: {item.location}{isSharedLocation ? ' (Frammentata)' : ''}
                        </span>
                      )}
                    </div>
                    {(item.client_pallet_number || item.client_article_number) && (
                      <div className="text-xs text-slate-400 mt-1">
                        {item.client_pallet_number && <span className="mr-2">Paletta C.: {item.client_pallet_number}</span>}
                        {item.client_article_number && <span>Articolo C.: {item.client_article_number}</span>}
                      </div>
                    )}
                    {item.notes && <div className="text-xs text-brand-blue mt-1 truncate">Note: {item.notes}</div>}
                  </div>
                  <div className="text-center px-4 bg-slate-900 rounded-xl py-2">
                    <div className="text-[10px] uppercase font-bold tracking-widest text-brand-blue">Moltiplica</div>
                    <div className="text-xl font-black text-brand-white">x{item.num_pallets}</div>
                  </div>
                  <button onClick={() => removeFromCart(item.id)} className="p-3 text-slate-600 hover:text-rose-500 hover:bg-rose-500/10 rounded-xl transition-colors">
                    <Trash2 size={20} />
                  </button>
                </div>
                );
              })}
            </div>
            
            {/* Pannello Stampa */}
            {cart.length > 0 && (
              <div className="mt-6 pt-6 border-t border-slate-800 animate-fade-in-up">
                
                  <div className="mb-6 bg-brand-blue/10 border-2 border-brand-blue/20 rounded-2xl p-4">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={abilitaSpunta} onChange={e => setAbilitaSpunta(e.target.checked)} className="w-6 h-6 rounded bg-slate-900 border-brand-blue text-brand-blue focus:ring-brand-blue focus:ring-offset-slate-900" />
                      <div>
                        <div className="font-bold text-brand-blue text-sm">Abilita Spunta (DDT Entrata)</div>
                        <div className="text-xs text-slate-400">Le palette verranno generate e spuntate dall'operatore con il PDA (Zebra).</div>
                      </div>
                    </label>
                  </div>

                  {!abilitaSpunta && (
                    <>
<div className="mb-6 bg-amber-500/10 border-2 border-amber-500/20 rounded-2xl p-4">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={printOptions.isMixed} onChange={e => setPrintOptions({...printOptions, isMixed: e.target.checked})} className="w-6 h-6 rounded bg-slate-900 border-amber-500 text-amber-500 focus:ring-amber-500 focus:ring-offset-slate-900" />
                    <div>
                      <div className="font-bold text-amber-500 text-sm">Frammenta Paletta (Unica Etichetta)</div>
                      <div className="text-xs text-slate-400">Raggruppa tutto il carrello in una singola paletta mista con 1 solo codice a barre. (Ignora i moltiplicatori)</div>
                    </div>
                  </label>
                </div>
                
                <div className="mb-6 bg-emerald-500/10 border-2 border-emerald-500/20 rounded-2xl p-4">
                  <label className="flex items-center gap-3 cursor-pointer mb-2">
                    <input type="checkbox" checked={printOptions.noBarcode} onChange={e => setPrintOptions({...printOptions, noBarcode: e.target.checked})} className="w-6 h-6 rounded bg-slate-900 border-emerald-500 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-slate-900" />
                    <div>
                      <div className="font-bold text-emerald-500 text-sm">Senza Etichetta / Stoccaggio Libero</div>
                      <div className="text-xs text-slate-400">Inserisci i prodotti senza generare etichette. Utile per merce in scaffali liberi, FCR o altro. </div>
                    </div>
                  </label>
                  {printOptions.noBarcode && (
                    <div className="mt-4 pl-9 animate-fade-in-up">
                      <Select 
                        options={freeLocations}
                        placeholder="Seleziona la posizione libera (da Magazzino)..."
                        noOptionsMessage={() => "Nessuna posizione libera definita in Magazzino"}
                        value={freeLocations.find(fl => fl.value === printOptions.freeLocation) || null}
                        onChange={selected => setPrintOptions({...printOptions, freeLocation: selected ? selected.value : ''})}
                        styles={{
                          control: (base) => ({ ...base, backgroundColor: '#020617', borderColor: '#334155', color: '#F8FAFC', padding: '2px', borderRadius: '0.75rem' }),
                          singleValue: (base) => ({ ...base, color: '#F8FAFC' }),
                          input: (base) => ({ ...base, color: '#F8FAFC' }),
                          menu: (base) => ({ ...base, backgroundColor: '#020617', zIndex: 50, border: '1px solid #334155' }),
                          option: (base, state) => ({ ...base, backgroundColor: state.isFocused ? '#0f172a' : 'transparent', color: '#F8FAFC', cursor: 'pointer' })
                        }}
                      />
                    </div>
                  )}
                </div>

                <h3 className="text-sm font-bold text-slate-400 mb-4 uppercase tracking-wider flex items-center gap-2">
                  <Printer size={16} /> Impostazioni Stampa PDF
                </h3>
                
                <div className="space-y-4 mb-6">
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setPrintOptions({...printOptions, paper_format: 'A4', print_mode: 'GRID'})}
                      className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${printOptions.paper_format === 'A4' ? 'bg-brand-blue/10 border-brand-blue text-brand-blue' : 'bg-slate-950 border-slate-800 text-slate-400'}`}
                    >
                      A4 Standard
                    </button>
                    <button 
                      onClick={() => setPrintOptions({...printOptions, paper_format: 'THERMAL', print_mode: 'SINGLE_PAGE'})}
                      className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${printOptions.paper_format === 'THERMAL' ? 'bg-brand-blue/10 border-brand-blue text-brand-blue' : 'bg-slate-950 border-slate-800 text-slate-400'}`}
                    >
                      Termica 100x150
                    </button>
                  </div>
                  
                  {printOptions.paper_format === 'A4' && (
                    <div className="flex gap-2">
                      <button 
                        onClick={() => setPrintOptions({...printOptions, print_mode: 'GRID'})}
                        className={`flex-1 py-2 px-3 rounded-lg border text-xs font-medium transition-colors ${printOptions.print_mode === 'GRID' ? 'bg-slate-800 border-slate-600 text-brand-white' : 'bg-slate-950 border-slate-800 text-slate-500'}`}
                      >
                        Griglia (8x foglio)
                      </button>
                      <button 
                        onClick={() => setPrintOptions({...printOptions, print_mode: 'SINGLE_PAGE'})}
                        className={`flex-1 py-2 px-3 rounded-lg border text-xs font-medium transition-colors ${printOptions.print_mode === 'SINGLE_PAGE' ? 'bg-slate-800 border-slate-600 text-brand-white' : 'bg-slate-950 border-slate-800 text-slate-500'}`}
                      >
                        1 per foglio
                      </button>
                    </div>
                  )}
                </div>

                </>)}
                <button 
                  onClick={handleGenerate} 
                  disabled={isGenerating} 
                  className="w-full py-4 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-2xl font-black text-lg transition-all shadow-[0_0_30px_rgba(14,165,233,0.3)] disabled:opacity-50 flex items-center justify-center gap-3"
                >
                  <Download size={24} />
                  {isGenerating ? 'Generazione in corso...' : `Genera ${totalPalletsToGenerate} Etichett${totalPalletsToGenerate > 1 ? 'e' : 'a'}`}
                </button>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
};

export default Inbound;







