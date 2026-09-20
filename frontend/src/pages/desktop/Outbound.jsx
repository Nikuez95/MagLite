import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Select from 'react-select';
import { Truck, Plus, Printer, CheckCircle, PackageSearch, X, Loader2, Trash2 } from 'lucide-react';
import { jwtDecode } from 'jwt-decode';

const Outbound = () => {
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Modale nuova spedizione
  const [showModal, setShowModal] = useState(false);
  const [newOrder, setNewOrder] = useState({ customer_id: '', exit_date: new Date().toISOString().split('T')[0] });
  const [cart, setCart] = useState([]); // { pallet_code, product_id, quantity_required, product_name, locStr }

  // Modale selezione paletta
  const [availablePallets, setAvailablePallets] = useState([]);
  const [palletSearchTerm, setPalletSearchTerm] = useState('');
  
  // Custom Pick Modal
  const [showPickModal, setShowPickModal] = useState(false);
  const [pickingPallet, setPickingPallet] = useState(null);
  const [pickQty, setPickQty] = useState('');
  const [pickUom, setPickUom] = useState('Bancale');

  // Custom Delete Modal
  const [deleteConfirm, setDeleteConfirm] = useState({show: false, id: null, code: '', expected: '', input: ''});

  const token = localStorage.getItem('maglite_token');
  const userRole = token ? jwtDecode(token).role : '';

  useEffect(() => {
    fetchOrders();
    fetchBaseData();
  }, []);

  const fetchOrders = async () => {
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/outbound`, { headers: { Authorization: `Bearer ${token}` }});
      setOrders(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const confirmDeleteOrder = async () => {
    if (deleteConfirm.input !== deleteConfirm.expected) {
      alert('Codice errato. Impossibile eliminare.');
      return;
    }
    try {
      await axios.delete(`http://${window.location.hostname}:3000/api/outbound/${deleteConfirm.id}`, { headers: { Authorization: `Bearer ${token}` }});
      setDeleteConfirm({show: false, id: null, code: '', expected: '', input: ''});
      fetchOrders();
    } catch (err) {
      alert(err.response?.data?.error || 'Errore durante l\'eliminazione');
    }
  };

  const editOrder = async (orderId) => {
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/outbound/${orderId}/details`, { headers: { Authorization: `Bearer ${token}` }});
      const { order, items } = res.data;
      setNewOrder({ id: order.id, customer_id: order.customer_id, exit_date: order.exit_date.split('T')[0] });
      setCart(items.map(i => ({
        pallet_code: i.pallet_code,
        product_id: i.product_id,
        quantity_required: i.quantity_required,
        product_name: i.product_name,
        locStr: i.zone ? `${i.zone} C:${i.col} L:${i.pos}` : 'NO POS.',
        batch: i.batch,
        requested_uom: i.requested_uom
      })));
      setPalletSearchTerm('');
      searchPalletsByCustomer(order.customer_id, order.id);
      setShowModal(true);
    } catch (err) {
      alert('Errore caricamento spedizione');
    }
  };

  const fetchBaseData = async () => {
    try {
      const resC = await axios.get(`http://${window.location.hostname}:3000/api/customers`, { headers: { Authorization: `Bearer ${token}` }});
      setCustomers(resC.data.map(c => ({ value: c.id, label: c.business_name })));
    } catch (err) {
      console.error(err);
    }
  };

  const searchPalletsByCustomer = async (customerId, excludeOrderId = null) => {
    if (!customerId) {
      setAvailablePallets([]);
      return;
    }
    try {
      const url = `http://${window.location.hostname}:3000/api/outbound/search-pallets?customer_id=${customerId}${excludeOrderId ? '&exclude_order_id=' + excludeOrderId : ''}`;
      const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` }});
      setAvailablePallets(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCustomerChange = (val) => {
    setNewOrder({...newOrder, customer_id: val.value}); 
    setPalletSearchTerm('');
    searchPalletsByCustomer(val.value);
  };

  const addPalletToCart = (pallet, qty, requestedUom) => {
    const maxQty = pallet.available_quantity ?? pallet.quantity;
    let actualRequested = qty;
    if (requestedUom === 'Scatole') {
      actualRequested *= (pallet.units_per_box || 1);
    }
    
    if (!qty || qty <= 0 || (requestedUom !== 'Bancale' && actualRequested > maxQty)) {
      alert('Quantità non valida o superiore alla disponibilità.');
      return;
    }
    
    // Check if already in cart
    if (cart.find(c => c.pallet_code === pallet.pallet_code)) {
      alert('Paletta già inserita nella lista');
      return;
    }

    const locStr = pallet.zone ? `${pallet.zone} C:${pallet.col} L:${pallet.pos}` : 'NESSUNA POS.';
    
    setCart([...cart, {
      pallet_code: pallet.pallet_code,
      product_id: pallet.product_id,
      quantity_required: qty,
      product_name: pallet.product_name || pallet.label,
      locStr,
      batch: pallet.batch,
      requested_uom: requestedUom
    }]);
  };

  const removeFromCart = (pallet_code) => {
    setCart(cart.filter(c => c.pallet_code !== pallet_code));
  };

  const handleCreateOrder = async () => {
    if (!newOrder.customer_id || cart.length === 0) {
      alert('Seleziona cliente e inserisci almeno un articolo.');
      return;
    }
    setIsProcessing(true);
    try {
      const payload = {
        customer_id: newOrder.customer_id,
        exit_date: newOrder.exit_date,
        items: cart.map(c => ({
          pallet_code: c.pallet_code,
          product_id: c.product_id,
          quantity_required: c.quantity_required,
          requested_uom: c.requested_uom
        }))
      };
      
      if (newOrder.id) {
        await axios.put(`http://${window.location.hostname}:3000/api/outbound/${newOrder.id}`, payload, { headers: { Authorization: `Bearer ${token}` }});
      } else {
        await axios.post(`http://${window.location.hostname}:3000/api/outbound`, payload, { headers: { Authorization: `Bearer ${token}` }});
      }
      
      setShowModal(false);
      setCart([]);
      setNewOrder({ customer_id: '', exit_date: new Date().toISOString().split('T')[0] });
      setAvailablePallets([]);
      setPalletSearchTerm('');
      fetchOrders();
    } catch (err) {
      alert(err.response?.data?.error || 'Errore durante il salvataggio');
    } finally {
      setIsProcessing(false);
    }
  };

  const confirmOrder = async (code) => {
    if (!window.confirm('Vuoi confermare la spedizione? Questo scaricherà la merce dal magazzino definitivamente.')) return;
    try {
      await axios.post(`http://${window.location.hostname}:3000/api/outbound/${code}/confirm`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchOrders();
      alert('Spedizione confermata e merce scaricata!');
    } catch (err) {
      alert(err.response?.data?.error || 'Errore');
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
    singleValue: base => ({ ...base, color: '#f8fafc', fontWeight: 'bold' }),
    input: base => ({ ...base, color: '#f8fafc' }),
    placeholder: base => ({ ...base, color: '#475569' })
  };

  return (
    <div className="p-8 max-w-7xl mx-auto animate-fade-in">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-4xl font-black text-brand-white flex items-center gap-3">
            <Truck className="text-brand-blue" size={40} />
            Uscite e Spedizioni
          </h1>
          <p className="text-slate-400 mt-2">Gestione DDT interni e picking guidato Zebra</p>
        </div>
        <button onClick={() => setShowModal(true)} className="bg-brand-blue hover:bg-sky-400 text-brand-black font-bold py-3 px-6 rounded-xl flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(14,165,233,0.3)]">
          <Plus size={20} /> Nuova Spedizione
        </button>
      </div>

      {/* Orders Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-950/50">
                <th className="p-4 text-slate-400 font-bold uppercase tracking-wider text-sm border-b border-slate-800">Codice Ordine</th>
                <th className="p-4 text-slate-400 font-bold uppercase tracking-wider text-sm border-b border-slate-800">Data Uscita</th>
                <th className="p-4 text-slate-400 font-bold uppercase tracking-wider text-sm border-b border-slate-800">Cliente</th>
                <th className="p-4 text-slate-400 font-bold uppercase tracking-wider text-sm border-b border-slate-800">Stato</th>
                <th className="p-4 text-slate-400 font-bold uppercase tracking-wider text-sm border-b border-slate-800 text-right">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan="5" className="p-8 text-center text-slate-500">Nessuna spedizione registrata</td>
                </tr>
              ) : orders.map(o => (
                <tr key={o.id} className="hover:bg-slate-800/50 transition-colors group">
                  <td className="p-4 font-mono font-bold text-brand-white">{o.order_code}</td>
                  <td className="p-4 text-slate-300">{new Date(o.exit_date).toLocaleDateString('it-IT')}</td>
                  <td className="p-4 font-bold text-brand-blue">{o.customer_name}</td>
                  <td className="p-4">
                    {o.status === 'PENDING' && <span className="bg-slate-500/20 text-slate-400 px-3 py-1 rounded-full text-xs font-bold border border-slate-500/30">ATTESA</span>}
                    {o.status === 'PICKING' && <span className="bg-amber-500/20 text-amber-400 px-3 py-1 rounded-full text-xs font-bold border border-amber-500/30">IN PRELIEVO (ZEBRA)</span>}
                    {o.status === 'READY' && <span className="bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full text-xs font-bold border border-emerald-500/30">PRONTO AL CARICO</span>}
                    {o.status === 'SHIPPED' && <span className="bg-sky-500/20 text-sky-400 px-3 py-1 rounded-full text-xs font-bold border border-sky-500/30">SPEDITO</span>}
                  </td>
                  <td className="p-4 text-right flex justify-end gap-2">
                    <div className="flex gap-2">
                      <button 
                        onClick={() => window.open(`http://${window.location.hostname}:3000/api/outbound/${o.order_code}/pdf?token=${token}`, '_blank')}
                        className="p-2 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-lg transition-colors"
                        title="Stampa DDT (Picking List)"
                      >
                        <Printer size={18} />
                      </button>
                      {(userRole === 'admin' || userRole === 'developer' || userRole === 'backoffice') && o.status !== 'SHIPPED' && (
                        <>
                          <button 
                            onClick={() => editOrder(o.id)}
                            className="bg-brand-blue/20 hover:bg-brand-blue text-brand-blue hover:text-brand-black p-2 rounded-xl transition-colors"
                            title="Modifica Spedizione"
                          >
                            ✏️
                          </button>
                          <button 
                            onClick={() => setDeleteConfirm({show: true, id: o.id, code: o.order_code, expected: Math.floor(1000 + Math.random() * 9000).toString(), input: ''})}
                            className="bg-rose-500/20 hover:bg-rose-500 text-rose-400 hover:text-white p-2 rounded-xl transition-colors"
                            title="Elimina Spedizione"
                          >
                            <Trash2 size={18} />
                          </button>
                        </>
                      )}
                    </div>
                    {o.status === 'READY' && (
                      <button 
                        onClick={() => confirmOrder(o.order_code)}
                        className="p-2 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 rounded-lg transition-colors font-bold"
                        title="Conferma spedizione ed evasione magazzino"
                      >
                        <CheckCircle size={18} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Order Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-4xl w-full shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-2xl font-bold text-brand-white flex items-center gap-2">
                <Truck className="text-brand-blue" /> Crea Spedizione
              </h3>
              <button onClick={() => setShowModal(false)} className="text-slate-500 hover:text-brand-white"><X size={24} /></button>
            </div>
            
            <div className="flex gap-4 mb-6">
              <div className="flex-1">
                <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Cliente (Proprietario Merce)</label>
                <Select 
                  styles={selectStyles}
                  options={customers}
                  onChange={handleCustomerChange}
                  placeholder="Seleziona Cliente..."
                />
              </div>
              <div>
                <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Data di Uscita</label>
                <input 
                  type="date" 
                  value={newOrder.exit_date} 
                  onChange={e => setNewOrder({...newOrder, exit_date: e.target.value})}
                  className="bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 focus:ring-brand-blue"
                />
              </div>
            </div>

            {newOrder.customer_id && (
              <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 mb-6 flex-1 flex flex-col min-h-0">
                <h4 className="text-brand-white font-bold mb-4 flex items-center gap-2"><PackageSearch size={18} className="text-brand-blue" /> Aggiungi Merce</h4>
                
                <div className="mb-4">
                  <input 
                    type="text" 
                    placeholder="Cerca per codice paletta, lotto o nome articolo..."
                    className="w-full bg-slate-900 border border-slate-800 text-brand-white text-sm rounded-xl focus:ring-brand-blue focus:border-brand-blue block p-4 transition-colors placeholder-slate-500"
                    value={palletSearchTerm}
                    onChange={e => setPalletSearchTerm(e.target.value)}
                  />
                </div>

                <div className="overflow-y-auto flex-1 border border-slate-800 rounded-xl mb-4 bg-slate-900/50">
                  {availablePallets.length === 0 && <p className="p-4 text-slate-500 text-center">Nessuna paletta disponibile per questo cliente.</p>}
                  {availablePallets.length > 0 && (
                    <table className="w-full text-left">
                      <thead className="bg-slate-900 sticky top-0 shadow-md z-10">
                        <tr>
                          <th className="p-3 text-xs text-slate-400 uppercase font-bold">Articolo</th>
                          <th className="p-3 text-xs text-slate-400 uppercase font-bold">Paletta / Lotto</th>
                          <th className="p-3 text-xs text-slate-400 uppercase font-bold">Posizione</th>
                          <th className="p-3 text-xs text-slate-400 uppercase font-bold text-center">Disp.</th>
                          <th className="p-3 text-xs text-slate-400 uppercase font-bold text-right">Azione</th>
                        </tr>
                      </thead>
                      <tbody>
                        {availablePallets.filter(p => 
                          (p.pallet_code || '').toLowerCase().includes(palletSearchTerm.toLowerCase()) ||
                          (p.batch || '').toLowerCase().includes(palletSearchTerm.toLowerCase()) ||
                          (p.product_name || '').toLowerCase().includes(palletSearchTerm.toLowerCase())
                        ).map(p => {
                          const isInCart = cart.some(c => c.pallet_code === p.pallet_code);
                          return (
                          <tr key={p.id} className="border-t border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                            <td className="p-3 text-sm font-bold text-brand-white">{p.product_name}</td>
                            <td className="p-3 text-sm text-slate-300">
                              <span className="font-mono text-brand-blue">{p.pallet_code}</span> <br/>
                              <span className="text-xs text-slate-400">{p.batch || 'Nessun lotto'}</span>
                              {p.expiration_date && <span className="text-xs text-rose-400 block">Scad: {new Date(p.expiration_date).toLocaleDateString()}</span>}
                            </td>
                            <td className="p-3 text-sm text-slate-300">
                              {p.zone ? <span className="bg-slate-800 px-2 py-1 rounded text-xs">{p.zone} C:{p.col} L:{p.pos}</span> : <span className="text-amber-500 text-xs">NO POS</span>}
                            </td>
                            <td className="p-3 text-sm text-center">
                              {p.units_per_box > 1 ? (
                                <div className="flex flex-col items-center">
                                  <span className="font-black text-emerald-400">{p.available_quantity ?? p.quantity}</span>
                                  <span className="text-[10px] text-slate-400 mt-0.5">
                                    {Math.floor((p.available_quantity ?? p.quantity) / p.units_per_box)} Scat.
                                    {((p.available_quantity ?? p.quantity) % p.units_per_box) > 0 && ` + ${((p.available_quantity ?? p.quantity) % p.units_per_box)} Sfusi`}
                                  </span>
                                </div>
                              ) : (
                                <span className="font-black text-emerald-400">{p.available_quantity ?? p.quantity}</span>
                              )}
                            </td>
                            <td className="p-3 text-right">
                              {isInCart ? (
                                <span className="text-emerald-500 text-xs font-bold uppercase flex items-center justify-end gap-1"><CheckCircle size={14}/>Aggiunta</span>
                              ) : (
                                <button onClick={() => {
                                  setPickingPallet({...p, label: p.product_name});
                                  setPickQty(1);
                                  setPickUom('Bancale');
                                  setShowPickModal(true);
                                }} className="bg-sky-500/20 text-sky-400 px-3 py-2 rounded-lg text-xs font-bold hover:bg-sky-500 hover:text-brand-black transition-colors">
                                  + Aggiungi
                                </button>
                              )}
                            </td>
                          </tr>
                        )})}
                      </tbody>
                    </table>
                  )}
                </div>

                <div className="border-t border-slate-800 pt-4">
                  <h5 className="text-sm font-bold text-slate-400 uppercase mb-3">Lista Prelievo ({cart.length})</h5>
                  <div className="flex flex-wrap gap-2">
                    {cart.map((c, i) => (
                      <div key={i} className="bg-brand-blue/10 border border-brand-blue/30 px-3 py-2 rounded-xl flex items-center gap-3">
                        <div>
                          <p className="text-brand-white font-bold text-sm">{c.pallet_code}</p>
                          <p className="text-slate-400 text-xs">Q.tà: {c.quantity_required} {c.requested_uom || ''}</p>
                        </div>
                        <button onClick={() => removeFromCart(c.pallet_code)} className="text-rose-400 hover:text-rose-300 p-1 bg-rose-500/10 rounded-lg"><Trash2 size={14}/></button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <button onClick={handleCreateOrder} disabled={isProcessing} className="w-full bg-brand-blue hover:bg-sky-400 text-brand-black font-bold py-4 rounded-xl transition-colors disabled:opacity-50">
              {isProcessing ? 'Salvataggio...' : 'Conferma e Crea Spedizione'}
            </button>
          </div>
        </div>
      )}

      {/* Pick Modal */}
      {showPickModal && pickingPallet && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-xl font-bold text-brand-white mb-4">Prelievo Paletta</h3>
            <p className="text-brand-blue font-mono mb-4 text-lg text-center">{pickingPallet.pallet_code}</p>

            <div className="flex gap-2 mb-4">
              {Array.from(new Set(['Bancale', 'Scatole', pickingPallet.uom === 'Bancali' ? 'Unità' : (pickingPallet.uom || 'Pezzi')])).map(u => (
                <button 
                  key={u}
                  onClick={() => {
                     setPickUom(u);
                     if (u === 'Bancale') setPickQty(1);
                     else setPickQty('');
                  }}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-colors ${pickUom === u ? 'bg-brand-blue text-brand-black border-brand-blue' : 'bg-slate-800 text-slate-400 border-slate-700'}`}
                >
                  {u}
                </button>
              ))}
            </div>

            {pickUom !== 'Bancale' && (
              <div className="mb-6">
                <label className="block text-slate-400 text-xs font-bold mb-2">Quantità ({pickUom})</label>
                <input 
                  type="number" 
                  autoFocus
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-brand-white focus:border-brand-blue"
                  value={pickQty}
                  onChange={e => setPickQty(e.target.value)}
                />
                <p className="text-xs text-slate-500 mt-1">Disp. max: {pickingPallet.available_quantity ?? pickingPallet.quantity}</p>
              </div>
            )}

            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowPickModal(false)} className="flex-1 py-3 text-slate-400 font-bold hover:text-brand-white transition-colors bg-slate-800 rounded-xl">Annulla</button>
              <button onClick={() => {
                 const maxQty = pickingPallet.available_quantity ?? pickingPallet.quantity;
                 if (!pickQty || parseFloat(pickQty) <= 0 || (pickUom !== 'Bancale' && parseFloat(pickQty) > maxQty)) {
                   alert('Quantità non valida o superiore alla disponibilità.');
                   return;
                 }
                 addPalletToCart(pickingPallet, parseFloat(pickQty), pickUom);
                 setShowPickModal(false);
              }} className="flex-1 py-3 bg-brand-blue text-brand-black font-bold rounded-xl hover:bg-sky-400 transition-colors">Conferma</button>
            </div>
          </div>
        </div>
      )}
      {/* Delete Confirm Modal */}
      {deleteConfirm.show && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl">
            <div className="text-rose-500 mb-4 flex justify-center"><Trash2 size={40}/></div>
            <h3 className="text-xl font-bold text-brand-white mb-2 text-center">Conferma Eliminazione</h3>
            <p className="text-slate-400 text-sm text-center mb-6">Stai per eliminare la spedizione <strong className="text-brand-white">{deleteConfirm.code}</strong>. Inserisci il codice a 4 cifre per confermare.</p>
            
            <div className="text-center bg-slate-950 border border-slate-800 rounded-xl p-4 mb-4">
              <span className="text-3xl font-mono text-brand-white tracking-widest font-black">{deleteConfirm.expected}</span>
            </div>
            
            <input 
              type="text" 
              autoFocus
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-brand-white text-center text-xl font-mono tracking-widest mb-6 focus:border-rose-500"
              value={deleteConfirm.input}
              onChange={e => setDeleteConfirm({...deleteConfirm, input: e.target.value})}
              placeholder="----"
              maxLength={4}
            />

            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm({show: false, id: null, code: '', expected: '', input: ''})} className="flex-1 py-3 text-slate-400 font-bold hover:text-brand-white transition-colors bg-slate-800 rounded-xl">Annulla</button>
              <button onClick={confirmDeleteOrder} className="flex-1 py-3 bg-rose-500 text-white font-bold rounded-xl hover:bg-rose-400 transition-colors">Elimina</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Outbound;
