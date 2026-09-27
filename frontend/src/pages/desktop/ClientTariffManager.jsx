import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Select from 'react-select';
import { Save, Loader2, Coins, Receipt } from 'lucide-react';
import { appAlert } from '../../utils/alerts';

const ClientTariffManager = () => {
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [tariffs, setTariffs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const getToken = () => localStorage.getItem('maglite_token');

  useEffect(() => {
    const fetchCustomers = async () => {
      try {
        const res = await axios.get(`http://${window.location.hostname}:3000/api/customers`, {
          headers: { Authorization: `Bearer ${getToken()}` }
        });
        setCustomers(res.data.map(c => ({ value: c.id, label: c.business_name })));
      } catch (err) {
        appAlert('Errore caricamento clienti');
      }
    };
    fetchCustomers();
  }, []);

  const fetchTariffs = async (clientId) => {
    if (!clientId) return;
    setIsLoading(true);
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/billing/tariffs/${clientId}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setTariffs(res.data);
    } catch (err) {
      appAlert('Errore caricamento listino cliente');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePriceChange = (ruleCode, newPrice) => {
    setTariffs(prev => prev.map(t => 
      t.rule_code === ruleCode ? { ...t, final_price: newPrice } : t
    ));
  };

  const handleSave = async () => {
    if (!selectedCustomer) return;
    setIsSaving(true);
    try {
      const payload = {
        tariffs: tariffs.map(t => ({
          rule_code: t.rule_code,
          custom_price: parseFloat(t.final_price) || 0
        }))
      };
      await axios.post(`http://${window.location.hostname}:3000/api/billing/tariffs/${selectedCustomer.value}`, payload, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      appAlert('Listino cliente aggiornato con successo!', 'Successo', 'success');
    } catch (err) {
      appAlert('Errore salvataggio listino');
    } finally {
      setIsSaving(false);
    }
  };

  const selectStyles = {
    control: (base, state) => ({ ...base, backgroundColor: '#020617', borderColor: state.isFocused ? '#38bdf8' : '#1e293b', padding: '0.25rem', borderRadius: '0.75rem', color: '#f8fafc' }),
    menu: base => ({ ...base, backgroundColor: '#0f172a', border: '1px solid #1e293b' }),
    option: (base, state) => ({ ...base, backgroundColor: state.isFocused ? '#1e293b' : 'transparent', color: '#f8fafc' }),
    singleValue: base => ({ ...base, color: '#f8fafc' }),
    input: base => ({ ...base, color: '#f8fafc' })
  };

  const renderGroup = (type, title) => {
    const groupTariffs = tariffs.filter(t => t.rule_type === type);
    if (groupTariffs.length === 0) return null;

    return (
      <div className="mb-6 bg-slate-950 p-6 rounded-2xl border border-slate-800">
        <h3 className="text-brand-blue font-bold text-lg mb-4 uppercase tracking-wider">{title}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {groupTariffs.map(t => (
            <div key={t.rule_code} className="bg-slate-900 border border-slate-700 p-4 rounded-xl flex items-center justify-between">
              <div>
                <div className="font-bold text-slate-200">{t.description}</div>
                <div className="text-xs text-slate-500 font-mono mt-1">{t.rule_code}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-400 font-bold">€</span>
                <input 
                  type="number" 
                  step="0.01" 
                  value={t.final_price} 
                  onChange={e => handlePriceChange(t.rule_code, e.target.value)}
                  className="w-24 bg-slate-950 border border-slate-700 text-brand-white p-2 rounded-lg text-right font-bold focus:border-brand-blue outline-none"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-brand-black min-h-screen">
      <div className="max-w-4xl mx-auto animate-fade-in-up">
        
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-brand-white mb-2 flex items-center gap-3">
            <Coins className="text-brand-blue" size={32} />
            Gestione Listini Clienti
          </h1>
          <p className="text-slate-400">Personalizza i prezzi delle regole base o aggiungi costi per i flag extra.</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-xl">
          <div className="mb-8">
            <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Seleziona Cliente</label>
            <Select 
              options={customers} 
              styles={selectStyles}
              placeholder="Cerca cliente..."
              value={selectedCustomer}
              onChange={val => {
                setSelectedCustomer(val);
                fetchTariffs(val.value);
              }}
            />
          </div>

          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center text-brand-blue">
              <Loader2 className="animate-spin mb-4" size={48} />
              <p className="font-bold">Caricamento listino in corso...</p>
            </div>
          ) : selectedCustomer && tariffs.length > 0 ? (
            <div className="animate-fade-in-up">
              {renderGroup('EVENT', 'Eventi (Movimentazione IN/OUT)')}
              {renderGroup('STORAGE', 'Giacenza e Soste')}
              {renderGroup('FLAG', 'Servizi Extra (Flag)')}

              <div className="mt-8 border-t border-slate-800 pt-6">
                <button 
                  onClick={handleSave} 
                  disabled={isSaving}
                  className="w-full py-4 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-xl font-black text-lg transition-all shadow-[0_0_20px_rgba(14,165,233,0.3)] flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
                  {isSaving ? 'Salvataggio...' : 'Salva Listino'}
                </button>
              </div>
            </div>
          ) : selectedCustomer && (
            <div className="text-center py-12 text-slate-500 italic">
              Nessuna regola tariffaria trovata nel sistema base.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClientTariffManager;
