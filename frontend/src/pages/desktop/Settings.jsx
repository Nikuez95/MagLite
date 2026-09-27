import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Save, Loader2, Building, Building2, MapPin, FileText } from 'lucide-react';
import { appAlert } from '../../utils/alerts';

const Settings = () => {
  const [settings, setSettings] = useState({
    company_name: '',
    company_address: '',
    company_piva: '',
    company_cf: '',
    company_iban: '',
    company_phone: '',
    company_email: ''
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const getToken = () => localStorage.getItem('maglite_token');

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await axios.get(`http://${window.location.hostname}:3000/api/settings`, {
          headers: { Authorization: `Bearer ${getToken()}` }
        });
        setSettings(prev => ({ ...prev, ...res.data }));
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleChange = (e) => {
    setSettings({ ...settings, [e.target.name]: e.target.value });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await axios.post(`http://${window.location.hostname}:3000/api/settings`, settings, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      appAlert('Dati aziendali salvati con successo!', 'Salvato', 'success');
    } catch (err) {
      appAlert('Errore durante il salvataggio');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="flex-1 p-8 flex items-center justify-center text-brand-blue"><Loader2 className="animate-spin" size={48} /></div>;
  }

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-brand-black min-h-screen">
      <div className="max-w-4xl mx-auto animate-fade-in-up">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-brand-white mb-2 flex items-center gap-3">
            <Building className="text-brand-blue" size={32} />
            Impostazioni Aziendali
          </h1>
          <p className="text-slate-400">Questi dati verranno utilizzati come intestazione nei PDF generati dal sistema (es. Fatture).</p>
        </div>

        <form onSubmit={handleSave} className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            <div className="md:col-span-2">
              <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider flex items-center gap-2"><Building2 size={16}/> Ragione Sociale *</label>
              <input required type="text" name="company_name" value={settings.company_name || ''} onChange={handleChange} className="w-full bg-slate-950 border border-slate-700 text-brand-white p-4 rounded-xl focus:border-brand-blue outline-none" placeholder="Es. Logistica Trasporti S.r.l." />
            </div>

            <div className="md:col-span-2">
              <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider flex items-center gap-2"><MapPin size={16}/> Indirizzo Completo</label>
              <input type="text" name="company_address" value={settings.company_address || ''} onChange={handleChange} className="w-full bg-slate-950 border border-slate-700 text-brand-white p-4 rounded-xl focus:border-brand-blue outline-none" placeholder="Via Roma 1, 20100 Milano (MI)" />
            </div>

            <div>
              <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Partita IVA *</label>
              <input required type="text" name="company_piva" value={settings.company_piva || ''} onChange={handleChange} className="w-full bg-slate-950 border border-slate-700 text-brand-white p-4 rounded-xl focus:border-brand-blue outline-none" />
            </div>

            <div>
              <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Codice Fiscale</label>
              <input type="text" name="company_cf" value={settings.company_cf || ''} onChange={handleChange} className="w-full bg-slate-950 border border-slate-700 text-brand-white p-4 rounded-xl focus:border-brand-blue outline-none" />
            </div>

            <div className="md:col-span-2">
              <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider flex items-center gap-2"><FileText size={16}/> IBAN / Coordinate Bancarie</label>
              <input type="text" name="company_iban" value={settings.company_iban || ''} onChange={handleChange} className="w-full bg-slate-950 border border-slate-700 text-brand-white p-4 rounded-xl focus:border-brand-blue outline-none" placeholder="IT00 X000 0000 0000 0000 0000 000" />
            </div>

            <div>
              <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Telefono / Cellulare</label>
              <input type="text" name="company_phone" value={settings.company_phone || ''} onChange={handleChange} className="w-full bg-slate-950 border border-slate-700 text-brand-white p-4 rounded-xl focus:border-brand-blue outline-none" />
            </div>

            <div>
              <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Email o PEC</label>
              <input type="email" name="company_email" value={settings.company_email || ''} onChange={handleChange} className="w-full bg-slate-950 border border-slate-700 text-brand-white p-4 rounded-xl focus:border-brand-blue outline-none" />
            </div>

          </div>

          <div className="mt-8 pt-6 border-t border-slate-800">
            <button type="submit" disabled={isSaving} className="w-full py-4 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-xl font-black text-lg transition-all shadow-[0_0_20px_rgba(14,165,233,0.3)] flex items-center justify-center gap-2 disabled:opacity-50">
              {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
              {isSaving ? 'Salvataggio...' : 'Salva Impostazioni'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Settings;
