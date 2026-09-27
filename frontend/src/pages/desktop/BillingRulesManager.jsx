import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Settings2, Plus, Save, Trash2, Loader2, Flag } from 'lucide-react';
import { appAlert, appConfirm } from '../../utils/alerts';
import Select from 'react-select';
import CreatableSelect from 'react-select/creatable';

const BillingRulesManager = () => {
  const [rules, setRules] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [existingFlags, setExistingFlags] = useState([]);

  const getToken = () => localStorage.getItem('maglite_token');

  const fetchRules = async () => {
    setIsLoading(true);
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/billing/rules`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setRules(res.data);
    } catch (err) {
      appAlert('Errore caricamento regole');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchFlags = async () => {
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/products/flags`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setExistingFlags(res.data.map(f => ({ label: f, value: `FLAG_${f.toUpperCase()}` })));
    } catch(err) {}
  };

  useEffect(() => {
    fetchRules();
    fetchFlags();
  }, []);

  const handleCreateRule = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const payload = {
      rule_code: formData.get('rule_code'),
      description: formData.get('description'),
      rule_type: formData.get('rule_type'),
      default_price: parseFloat(formData.get('default_price')) || 0
    };
    if (!payload.rule_code || !payload.description) {
      return appAlert('Codice e Descrizione sono obbligatori');
    }
    setIsProcessing(true);
    try {
      await axios.post(`http://${window.location.hostname}:3000/api/billing/rules`, payload, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      appAlert('Regola creata con successo!', 'Successo', 'success');
      e.target.reset();
      fetchRules();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore creazione regola');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async (id, code) => {
    const ok = await appConfirm(`Vuoi davvero eliminare la regola ${code}?`);
    if (!ok) return;
    try {
      await axios.delete(`http://${window.location.hostname}:3000/api/billing/rules/${id}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      fetchRules();
    } catch (err) {
      appAlert('Impossibile eliminare, la regola è in uso da un cliente?');
    }
  };

  const selectStyles = {
    control: (base) => ({ ...base, backgroundColor: '#020617', borderColor: '#334155', color: '#f8fafc' }),
    menu: base => ({ ...base, backgroundColor: '#0f172a', border: '1px solid #1e293b' }),
    option: (base, state) => ({ ...base, backgroundColor: state.isFocused ? '#1e293b' : 'transparent', color: '#f8fafc' }),
    singleValue: base => ({ ...base, color: '#f8fafc' }),
    input: base => ({ ...base, color: '#f8fafc' })
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-brand-black min-h-screen">
      <div className="max-w-6xl mx-auto animate-fade-in-up">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-brand-white mb-2 flex items-center gap-3">
            <Settings2 className="text-brand-blue" size={32} />
            Regole e Tariffe Base
          </h1>
          <p className="text-slate-400">Crea nuove regole globali (sconti, servizi manuali) o associa un prezzo base ai Flag.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Form Creazione */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl h-fit sticky top-8">
            <h2 className="text-xl font-bold text-white mb-4">Nuova Regola</h2>
            <form onSubmit={handleCreateRule} className="space-y-4">
              <div>
                <label className="block text-slate-400 text-xs font-bold mb-1">Tipo di Regola</label>
                <select name="rule_type" required className="w-full bg-slate-950 border border-slate-700 text-white p-3 rounded-xl focus:border-brand-blue">
                  <option value="FLAG">Flag (Servizio Extra automatico)</option>
                  <option value="MANUAL">Servizio Manuale / Una tantum</option>
                  <option value="DISCOUNT_PERCENT">Sconto in Percentuale (%)</option>
                  <option value="DISCOUNT_FIXED">Sconto Fisso (€)</option>
                  <option value="EVENT">Evento (In/Out) - Avanzato</option>
                  <option value="STORAGE">Sosta (Giacenza) - Avanzato</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-400 text-xs font-bold mb-1 flex justify-between">
                  <span>ID Regola (Senza spazi)</span>
                  <span className="text-brand-blue cursor-pointer" onClick={() => appAlert('Usa FLAG_NOMEFLAG per agganciare in automatico il prezzo al flag sulle palette. Esempio: FLAG_ADR')}>Info</span>
                </label>
                <input required name="rule_code" type="text" placeholder="Es. FLAG_ADR o SCONTO_10" className="w-full bg-slate-950 border border-slate-700 text-white p-3 rounded-xl focus:border-brand-blue uppercase" />
              </div>
              <div>
                <label className="block text-slate-400 text-xs font-bold mb-1">Descrizione in Fattura</label>
                <input required name="description" type="text" placeholder="Es. Sconto Commerciale 10%" className="w-full bg-slate-950 border border-slate-700 text-white p-3 rounded-xl focus:border-brand-blue" />
              </div>
              <div>
                <label className="block text-slate-400 text-xs font-bold mb-1">Prezzo/Valore di Default</label>
                <div className="relative">
                  <span className="absolute left-4 top-3.5 text-slate-500 font-bold">€/%</span>
                  <input required name="default_price" type="number" step="0.01" placeholder="0.00" className="w-full bg-slate-950 border border-slate-700 text-white p-3 pl-12 rounded-xl focus:border-brand-blue" />
                </div>
              </div>
              <button type="submit" disabled={isProcessing} className="w-full py-3 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-xl font-bold transition-all flex items-center justify-center gap-2">
                {isProcessing ? <Loader2 className="animate-spin" /> : <Plus />}
                Aggiungi Regola
              </button>
            </form>

            <div className="mt-8 pt-6 border-t border-slate-800">
              <h3 className="text-sm font-bold text-slate-300 mb-2 flex items-center gap-2"><Flag size={16}/> Flag Trovati nel DB</h3>
              <div className="flex flex-wrap gap-2">
                {existingFlags.length === 0 ? <span className="text-xs text-slate-500">Nessun flag usato finora.</span> : existingFlags.map(f => (
                  <span key={f.value} className="bg-slate-800 text-brand-blue text-xs px-2 py-1 rounded-md font-mono">{f.value}</span>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 mt-2">Usa questi ID come "ID Regola" per dar loro un prezzo.</p>
            </div>
          </div>

          {/* Lista Regole */}
          <div className="lg:col-span-2 space-y-6">
            {isLoading ? <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-brand-blue" size={32} /></div> : (
              ['EVENT', 'STORAGE', 'FLAG', 'MANUAL', 'DISCOUNT_PERCENT', 'DISCOUNT_FIXED'].map(type => {
                const filtered = rules.filter(r => r.rule_type === type);
                if (filtered.length === 0) return null;
                return (
                  <div key={type} className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-md">
                    <h3 className="text-brand-blue font-bold mb-4 uppercase tracking-wider">{type}</h3>
                    <div className="space-y-3">
                      {filtered.map(r => (
                        <div key={r.id} className="bg-slate-950 border border-slate-800 p-4 rounded-xl flex items-center justify-between hover:border-slate-700 transition-colors">
                          <div>
                            <div className="font-bold text-white">{r.description}</div>
                            <div className="text-xs text-slate-500 font-mono mt-1">{r.rule_code}</div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="font-bold text-emerald-400">
                              {type === 'DISCOUNT_PERCENT' ? '-' : ''}{r.default_price} {type === 'DISCOUNT_PERCENT' ? '%' : '€'}
                            </div>
                            <button onClick={() => handleDelete(r.id, r.rule_code)} className="p-2 text-slate-600 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors">
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BillingRulesManager;
