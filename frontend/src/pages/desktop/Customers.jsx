import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Plus, Building2, Trash2, Eye, MapPin, Mail, Phone, Hash } from 'lucide-react';

const CustomersManagement = () => {
  const [customers, setCustomers] = useState([]);
  
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ unique_id: '', business_name: '', vat_number: '', address: '', phone: '', email: '' });
  
  const [viewModal, setViewModal] = useState({ show: false, customer: null });
  const [deleteModal, setDeleteModal] = useState({ show: false, customer: null, confirmText: '' });
  const [isProcessing, setIsProcessing] = useState(false);

  const getToken = () => localStorage.getItem('maglite_token');
  const user = JSON.parse(localStorage.getItem('maglite_user') || '{}');
  const isDeveloper = user.role === 'developer';

  const fetchCustomers = async () => {
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/customers`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setCustomers(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      await axios.post(`http://${window.location.hostname}:3000/api/customers`, newCustomer, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setShowAddModal(false);
      setNewCustomer({ unique_id: '', business_name: '', vat_number: '', address: '', phone: '', email: '' });
      fetchCustomers();
    } catch (err) {
      alert(err.response?.data?.error || 'Errore');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async () => {
    if (deleteModal.confirmText !== deleteModal.customer.business_name || isProcessing) return;
    setIsProcessing(true);
    try {
      await axios.delete(`http://${window.location.hostname}:3000/api/customers/${deleteModal.customer.id}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      fetchCustomers();
    } catch (err) {
      if (err.response?.status !== 404) {
        alert(err.response?.data?.error || 'Errore durante l\'eliminazione');
      }
    } finally {
      setIsProcessing(false);
      setDeleteModal({ show: false, customer: null, confirmText: '' });
    }
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-brand-black min-h-screen">
      <div className="max-w-6xl mx-auto animate-fade-in-up">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-brand-white mb-2 flex items-center gap-3">
              <Building2 className="text-brand-blue" size={32} />
              Anagrafica Clienti
            </h1>
            <p className="text-slate-400">Gestisci i destinatari delle merci e i fornitori.</p>
          </div>
          <button 
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-5 py-3 bg-brand-blue text-brand-black font-bold rounded-xl hover:bg-sky-400 transition-all shadow-[0_0_20px_rgba(14,165,233,0.2)] active:scale-95"
          >
            <Plus size={20} />
            Nuovo Cliente
          </button>
        </div>

        {/* Tabella Clienti */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                  <th className="p-5 font-semibold uppercase tracking-wider text-xs">Ragione Sociale</th>
                  <th className="p-5 font-semibold uppercase tracking-wider text-xs">Codice / P.IVA</th>
                  <th className="p-5 font-semibold uppercase tracking-wider text-xs hidden md:table-cell">Indirizzo</th>
                  <th className="p-5 font-semibold uppercase tracking-wider text-xs text-right">Azioni</th>
                </tr>
              </thead>
              <tbody className="text-brand-white">
                {customers.length === 0 ? (
                  <tr><td colSpan="4" className="p-12 text-center text-slate-500 italic font-medium">Nessun cliente registrato nel gestionale.</td></tr>
                ) : customers.map(c => (
                  <tr key={c.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors group">
                    <td className="p-5 font-bold text-lg">{c.business_name}</td>
                    <td className="p-5">
                      <div className="flex flex-col">
                        <span className="text-brand-blue font-mono text-sm">{c.unique_id}</span>
                        {c.vat_number && <span className="text-slate-400 text-xs mt-1">P.IVA {c.vat_number}</span>}
                      </div>
                    </td>
                    <td className="p-5 text-slate-400 text-sm truncate max-w-[200px] hidden md:table-cell">{c.address || '-'}</td>
                    <td className="p-5 text-right">
                      <div className="flex justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setViewModal({ show: true, customer: c })} className="p-2.5 bg-slate-800 hover:bg-brand-blue hover:text-brand-black rounded-lg transition-colors text-slate-300 shadow-sm" title="Dettagli Completi">
                          <Eye size={18} />
                        </button>
                        {isDeveloper && (
                          <button onClick={() => setDeleteModal({ show: true, customer: c, confirmText: '' })} className="p-2.5 bg-slate-800 hover:bg-rose-500 hover:text-brand-white rounded-lg transition-colors text-slate-300 shadow-sm" title="Elimina Cliente">
                            <Trash2 size={18} />
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

      {/* Modal Aggiungi */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-10 max-w-2xl w-full shadow-2xl relative my-8 animate-fade-in-up">
            <h2 className="text-2xl font-bold text-brand-white mb-8 flex items-center gap-3">
              <span className="w-10 h-10 bg-brand-blue/20 flex items-center justify-center rounded-xl text-brand-blue">
                <Plus size={24} />
              </span>
              Registra Nuovo Cliente
            </h2>
            <form onSubmit={handleCreate} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Ragione Sociale *</label>
                  <input required value={newCustomer.business_name} onChange={e => setNewCustomer({...newCustomer, business_name: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue focus:border-brand-blue transition-all" placeholder="Es. Mario Rossi S.p.A." />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Codice Univoco / SDI *</label>
                  <input required value={newCustomer.unique_id} onChange={e => setNewCustomer({...newCustomer, unique_id: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue focus:border-brand-blue transition-all font-mono" placeholder="Es. MRO-001" />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Partita IVA / C.F.</label>
                  <input value={newCustomer.vat_number} onChange={e => setNewCustomer({...newCustomer, vat_number: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue focus:border-brand-blue transition-all font-mono" placeholder="Es. IT0123456789" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Indirizzo e Città</label>
                  <input value={newCustomer.address} onChange={e => setNewCustomer({...newCustomer, address: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue focus:border-brand-blue transition-all" placeholder="Via Roma 1, Milano (MI)" />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Telefono</label>
                  <input value={newCustomer.phone} onChange={e => setNewCustomer({...newCustomer, phone: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue focus:border-brand-blue transition-all" placeholder="+39 333..." />
                </div>
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Email Aziendale</label>
                  <input type="email" value={newCustomer.email} onChange={e => setNewCustomer({...newCustomer, email: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue focus:border-brand-blue transition-all" placeholder="info@azienda.it" />
                </div>
              </div>
              <div className="flex gap-4 mt-8 pt-8 border-t border-slate-800/80">
                <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 px-4 py-4 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-xl font-bold transition-colors">Annulla</button>
                <button type="submit" disabled={isProcessing} className="flex-1 px-4 py-4 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-xl font-bold transition-colors shadow-[0_0_20px_rgba(14,165,233,0.3)] disabled:opacity-50">{isProcessing ? 'Salvataggio in corso...' : 'Crea Cliente'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal View Details */}
      {viewModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-10 max-w-md w-full shadow-2xl relative animate-fade-in-up">
            <div className="w-20 h-20 bg-slate-950 border border-brand-blue/30 rounded-2xl flex items-center justify-center text-brand-blue mb-8 shadow-inner">
              <Building2 size={40} />
            </div>
            <h2 className="text-3xl font-bold text-brand-white mb-2 leading-tight">{viewModal.customer?.business_name}</h2>
            <div className="inline-block px-4 py-1.5 bg-brand-blue/10 text-brand-blue rounded-full font-mono text-sm mb-10 font-bold tracking-wider">
              ID: {viewModal.customer?.unique_id}
            </div>

            <div className="space-y-6 mb-10 bg-slate-950/50 p-6 rounded-2xl border border-slate-800/50">
              <div className="flex gap-4 text-slate-300">
                <Hash className="text-slate-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Partita IVA / C.F.</p>
                  <p className="font-medium text-brand-white">{viewModal.customer?.vat_number || 'Non specificata'}</p>
                </div>
              </div>
              <div className="flex gap-4 text-slate-300">
                <MapPin className="text-slate-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Indirizzo</p>
                  <p className="font-medium text-brand-white leading-relaxed">{viewModal.customer?.address || 'Non specificato'}</p>
                </div>
              </div>
              <div className="flex gap-4 text-slate-300">
                <Phone className="text-slate-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Telefono</p>
                  <p className="font-medium text-brand-white">{viewModal.customer?.phone || 'Non specificato'}</p>
                </div>
              </div>
              <div className="flex gap-4 text-slate-300">
                <Mail className="text-slate-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Email</p>
                  <p className="font-medium text-brand-white">{viewModal.customer?.email || 'Non specificata'}</p>
                </div>
              </div>
            </div>

            <button onClick={() => setViewModal({ show: false, customer: null })} className="w-full px-4 py-4 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-xl font-bold transition-colors">Chiudi Dettagli</button>
          </div>
        </div>
      )}

      {/* Modal Delete */}
      {deleteModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-10 max-w-sm w-full shadow-2xl border-t-4 border-t-rose-500 animate-fade-in-up">
            <div className="w-16 h-16 bg-rose-950/50 rounded-full flex items-center justify-center text-rose-500 mb-6 mx-auto">
              <Trash2 size={32} />
            </div>
            <h2 className="text-2xl font-bold text-brand-white mb-2 text-center">Elimina Cliente</h2>
            <p className="text-slate-400 text-sm mb-6 text-center leading-relaxed">
              Stai per eliminare il cliente <b className="text-rose-400">{deleteModal.customer?.business_name}</b> in modo definitivo.
            </p>
            <div className="bg-rose-950/20 p-4 rounded-xl mb-6 border border-rose-900/30">
              <p className="text-rose-400 text-xs font-bold text-center uppercase tracking-wider mb-2">Conferma di Sicurezza</p>
              <p className="text-rose-200 text-xs font-medium text-center">Digita esattamente il nome del cliente per procedere:</p>
            </div>
            
            <input 
              type="text" 
              placeholder={deleteModal.customer?.business_name}
              value={deleteModal.confirmText} 
              onChange={e => setDeleteModal({...deleteModal, confirmText: e.target.value})}
              className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 mb-8 font-bold text-center transition-all" 
            />

            <div className="flex gap-4">
              <button onClick={() => setDeleteModal({ show: false, customer: null, confirmText: '' })} className="flex-1 px-4 py-4 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-xl font-bold transition-colors">Annulla</button>
              <button 
                onClick={handleDelete} 
                disabled={deleteModal.confirmText !== deleteModal.customer?.business_name || isProcessing} 
                className="flex-1 px-4 py-4 bg-rose-600 hover:bg-rose-500 text-brand-white rounded-xl font-bold disabled:opacity-30 disabled:hover:bg-rose-600 transition-all shadow-[0_0_20px_rgba(225,29,72,0.2)]"
              >
                {isProcessing ? 'Attendi...' : 'Conferma'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomersManagement;
