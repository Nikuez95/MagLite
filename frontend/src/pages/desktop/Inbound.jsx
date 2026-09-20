import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Select from 'react-select';
import CreatableSelect from 'react-select/creatable';
import { Download, PackagePlus, FileText, Trash2, Plus, Printer } from 'lucide-react';

const Inbound = () => {
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // Carrello locale
  const [cart, setCart] = useState([]);

  // Opzioni di Stampa
  const [printOptions, setPrintOptions] = useState({
    paper_format: 'A4', // 'A4' o 'THERMAL'
    print_mode: 'GRID'  // 'GRID' (solo per A4) o 'SINGLE_PAGE'
  });

  const [formData, setFormData] = useState({
    customer_id: null,
    product_id: null,
    quantity: '',
    entry_uom: 'Base',
    units_per_box: '',
    boxes_per_pallet: '',
    batch: '',
    client_pallet_number: '',
    client_article_number: '',
    warehouse: 'Settala',
    num_pallets: 1,
    notes: '',
    expiration_date: ''
  });

  const getToken = () => localStorage.getItem('maglite_token');

  const fetchData = async () => {
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      const [custRes, prodRes] = await Promise.all([
        axios.get(`http://${window.location.hostname}:3000/api/customers`, { headers }),
        axios.get(`http://${window.location.hostname}:3000/api/products`, { headers })
      ]);
      setCustomers(custRes.data.map(c => ({ value: c.id, label: c.business_name })));
      setProducts(prodRes.data.map(p => ({ value: p.id, label: `${p.sku} - ${p.name}`, raw: p })));
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateProduct = async (inputValue) => {
    if (!formData.customer_id) {
      alert('Seleziona prima il Cliente Proprietario!');
      return;
    }
    setIsProcessing(true);
    try {
      const sku = `PROD-${Math.random().toString(36).substring(2,6).toUpperCase()}`;
      const payload = { 
        sku, 
        name: inputValue, 
        uom: 'Scatole', 
        customer_id: formData.customer_id 
      };
      
      const res = await axios.post(`http://${window.location.hostname}:3000/api/products`, payload, { 
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      
      const newOption = { value: res.data.id, label: `${sku} - ${inputValue}`, raw: { customer_id: formData.customer_id } };
      setProducts(prev => [...prev, newOption]);
      setFormData(prev => ({ ...prev, product_id: newOption.value }));
    } catch (err) {
      alert('Errore creazione prodotto al volo');
    } finally {
      setIsProcessing(false);
    }
  };

  const filteredProducts = products.filter(p => p.raw.customer_id === formData.customer_id);

  const handleAddToCart = (e) => {
    e.preventDefault();
    if (!formData.customer_id || !formData.product_id || !formData.quantity || formData.num_pallets < 1) {
      alert('Compila tutti i campi obbligatori');
      return;
    }

    const customer = customers.find(c => c.value === formData.customer_id)?.label;
    const productObj = products.find(p => p.value === formData.product_id);
    const product = productObj?.label;

    let actualQty = parseFloat(formData.quantity);
    const upb = parseFloat(formData.units_per_box) || 1;
    const bpp = parseFloat(formData.boxes_per_pallet) || 1;

    if (formData.entry_uom === 'Scatole') {
      actualQty *= upb;
    } else if (formData.entry_uom === 'Bancale') {
      actualQty *= (upb * bpp);
    }

    const newItem = {
      id: Date.now(),
      customer_id: formData.customer_id,
      customer_name: customer,
      product_id: formData.product_id,
      product_name: product,
      quantity: actualQty,
      units_per_box: upb,
      batch: formData.batch,
      warehouse: formData.warehouse,
      num_pallets: formData.num_pallets,
      notes: formData.notes,
      client_pallet_number: formData.client_pallet_number,
      client_article_number: formData.client_article_number,
      expiration_date: formData.expiration_date
    };

    setCart(prev => [...prev, newItem]);
    
    // Reset partial form for quick entry
    setFormData(prev => ({ ...prev, quantity: '', entry_uom: 'Base', batch: '', num_pallets: 1, notes: '', client_pallet_number: '', client_article_number: '', expiration_date: '' }));
  };

  const removeFromCart = (id) => {
    setCart(prev => prev.filter(item => item.id !== id));
  };

  const handleGenerate = async () => {
    if (cart.length === 0) return;
    setIsGenerating(true);
    try {
      const payload = {
        cart,
        printOptions
      };

      const res = await axios.post(`http://${window.location.hostname}:3000/api/pallets/generate`, payload, {
        headers: { Authorization: `Bearer ${getToken()}` },
        responseType: 'blob' 
      });
      
      const pdfBlob = new Blob([res.data], { type: 'application/pdf' });
      const pdfUrl = URL.createObjectURL(pdfBlob);
      window.open(pdfUrl, '_blank');

      // Clear cart
      setCart([]);
    } catch (err) {
      alert('Errore durante la generazione del PDF.');
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
    input: base => ({ ...base, color: '#f8fafc' })
  };

  const totalPalletsToGenerate = cart.reduce((acc, curr) => acc + curr.num_pallets, 0);

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-brand-black min-h-screen">
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
                  onCreateOption={handleCreateProduct}
                  value={products.find(p => p.value === formData.product_id)}
                  onChange={val => {
                    const prod = products.find(p => p.value === val.value);
                    setFormData({
                      ...formData, 
                      product_id: val.value,
                      units_per_box: prod?.raw?.units_per_box || 1,
                      boxes_per_pallet: prod?.raw?.boxes_per_pallet || 1
                    });
                  }}
                />
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Unità per Scatola (su questa paletta)</label>
                  <input type="number" min="1" value={formData.units_per_box} onChange={e => setFormData({...formData, units_per_box: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue" />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Scatole per Paletta</label>
                  <input type="number" min="1" value={formData.boxes_per_pallet} onChange={e => setFormData({...formData, boxes_per_pallet: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-6">
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Quantità *</label>
                  <input required type="number" step="0.01" value={formData.quantity} onChange={e => setFormData({...formData, quantity: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue" placeholder="Es. 50" />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">UDM Inserimento</label>
                  <select value={formData.entry_uom} onChange={e => setFormData({...formData, entry_uom: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue">
                    <option value="Base">Pezzi ({products.find(p => p.value === formData.product_id)?.raw?.uom || 'Pezzi'})</option>
                    <option value="Scatole">Scatole</option>
                    <option value="Bancale">Paletta Intera</option>
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
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Num. Articolo (Opzionale)</label>
                  <input value={formData.client_article_number} onChange={e => setFormData({...formData, client_article_number: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue" placeholder="Es. ART-001" />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Scadenza (Opzionale)</label>
                <input type="date" value={formData.expiration_date} onChange={e => setFormData({...formData, expiration_date: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3.5 focus:ring-brand-blue [color-scheme:dark]" />
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

              <div className="pt-4 border-t border-slate-800">
                <div className="bg-brand-blue/10 border border-brand-blue/30 rounded-2xl p-4 flex items-center justify-between">
                  <div>
                    <label className="block text-brand-blue font-black mb-1 text-xs uppercase tracking-wider">Moltiplicatore Etichette</label>
                    <span className="text-slate-400 text-sm">Quante palette uguali?</span>
                  </div>
                  <input type="number" min="1" max="50" required value={formData.num_pallets} onChange={e => setFormData({...formData, num_pallets: parseInt(e.target.value)})} className="w-20 bg-slate-900 border-2 border-brand-blue text-brand-white rounded-xl p-2 text-center text-xl font-bold focus:ring-brand-blue" />
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
              ) : cart.map((item, idx) => (
                <div key={item.id} className="bg-slate-950 border border-slate-800 rounded-2xl p-4 flex gap-4 items-center group relative overflow-hidden">
                  <div className={`absolute left-0 top-0 bottom-0 w-1 ${item.warehouse === 'Settala' ? 'bg-brand-blue' : 'bg-amber-500'}`}></div>
                  <div className="flex-1 pl-2">
                    <div className="font-bold text-slate-300 text-sm mb-1 truncate">{item.product_name}</div>
                    <div className="text-xs text-slate-500 flex items-center gap-2">
                      <span>Q.tà: <strong className="text-emerald-400">{item.quantity}</strong></span>
                      {item.units_per_box > 1 && (
                        <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-300">
                          {Math.floor(item.quantity / item.units_per_box)} Scat.
                          {(item.quantity % item.units_per_box) > 0 && ` + ${(item.quantity % item.units_per_box)} Sfusi`}
                        </span>
                      )}
                      <span className="text-slate-600">|</span>
                      <span>{item.warehouse}</span>
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
              ))}
            </div>
            
            {/* Pannello Stampa */}
            {cart.length > 0 && (
              <div className="mt-6 pt-6 border-t border-slate-800 animate-fade-in-up">
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
