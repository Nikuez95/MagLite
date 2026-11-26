import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Save, Loader2, Building, Building2, MapPin, FileText, Warehouse, Plus, Trash2, Edit2, Layers, Check, X } from 'lucide-react';
import { appAlert, appConfirm } from '../../utils/alerts';
import { hasPerm } from '../../utils/permissions';

const Settings = () => {
  const [settings, setSettings] = useState({
    company_name: '',
    company_address: '',
    company_piva: '',
    company_cf: '',
    company_iban: '',
    company_phone: '',
    company_email: '',
    pallet_barcode_show_logo: 'true'
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Gestione Magazzini & Capannoni / Frammentazioni
  const [warehouses, setWarehouses] = useState([]);
  const [newWh, setNewWh] = useState({ name: '', address: '', cap: '', city: '', province: '' });
  const [editingWhId, setEditingWhId] = useState(null);
  const [editWhDraft, setEditWhDraft] = useState({ name: '', address: '', cap: '', city: '', province: '' });
  const [newDivNames, setNewDivNames] = useState({});
  const [whBusy, setWhBusy] = useState(false);

  const getToken = () => localStorage.getItem('maglite_token');
  const canManageSettings = hasPerm('settings_manage');

  const fetchWarehouses = async () => {
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/warehouses`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setWarehouses(res.data || []);
    } catch (err) {
      console.error(err);
    }
  };

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
    fetchWarehouses();
  }, []);

  const handleAddWarehouse = async (e) => {
    e.preventDefault();
    if (!canManageSettings) return appAlert('Permesso Gestione Impostazioni richiesto.');
    if (!newWh.name.trim() || whBusy) return;
    setWhBusy(true);
    try {
      await axios.post(`http://${window.location.hostname}:3000/api/warehouses`, newWh, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setNewWh({ name: '', address: '', cap: '', city: '', province: '' });
      await fetchWarehouses();
      appAlert(`Magazzino "${newWh.name.trim()}" aggiunto con successo!`, 'Magazzino Creato', 'success');
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore creazione magazzino');
    } finally {
      setWhBusy(false);
    }
  };

  const handleSaveWarehouse = async (whId) => {
    if (!canManageSettings || whBusy) return;
    setWhBusy(true);
    try {
      await axios.put(`http://${window.location.hostname}:3000/api/warehouses/${whId}`, editWhDraft, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setEditingWhId(null);
      await fetchWarehouses();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore aggiornamento magazzino');
    } finally {
      setWhBusy(false);
    }
  };

  const handleDeleteWarehouse = async (wh) => {
    if (!canManageSettings || whBusy) return;
    const ok = await appConfirm(`Eliminare il magazzino "${wh.name}"?`);
    if (!ok) return;
    setWhBusy(true);
    try {
      await axios.delete(`http://${window.location.hostname}:3000/api/warehouses/${wh.id}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      await fetchWarehouses();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore eliminazione magazzino');
    } finally {
      setWhBusy(false);
    }
  };

  const handleAddDivision = async (whId) => {
    if (!canManageSettings || whBusy) return;
    const divName = String(newDivNames[whId] || '').trim();
    if (!divName) return;
    setWhBusy(true);
    try {
      await axios.post(`http://${window.location.hostname}:3000/api/warehouses/${whId}/divisions`, { name: divName }, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setNewDivNames(prev => ({ ...prev, [whId]: '' }));
      await fetchWarehouses();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore aggiunta reparto/capannone');
    } finally {
      setWhBusy(false);
    }
  };

  const handleDeleteDivision = async (div) => {
    if (!canManageSettings || whBusy) return;
    const ok = await appConfirm(`Rimuovere il reparto/capannone "${div.name}"? Le posizioni associate verranno scollegate dal reparto.`);
    if (!ok) return;
    setWhBusy(true);
    try {
      await axios.delete(`http://${window.location.hostname}:3000/api/warehouses/divisions/${div.id}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      await fetchWarehouses();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore rimozione reparto');
    } finally {
      setWhBusy(false);
    }
  };

  const handleChange = (e) => {
    setSettings({ ...settings, [e.target.name]: e.target.value });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!canManageSettings) return appAlert('Permesso Gestione Impostazioni richiesto.');
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

            <div className="md:col-span-2 pt-4 mt-2 border-t border-slate-800">
              <label className="flex items-start gap-3.5 p-4 rounded-2xl bg-slate-950 border border-slate-800 hover:border-brand-blue/40 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={String(settings.pallet_barcode_show_logo ?? 'true').toLowerCase() !== 'false'}
                  onChange={(e) => setSettings(prev => ({
                    ...prev,
                    pallet_barcode_show_logo: e.target.checked ? 'true' : 'false'
                  }))}
                  className="mt-1 w-5 h-5 rounded border-slate-600 text-brand-blue focus:ring-brand-blue bg-slate-900 shrink-0"
                />
                <div className="min-w-0">
                  <div className="text-sm font-black text-brand-white">
                    Stampa Logo Aziendale sui Barcode Paletta
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Se attivo (default), le etichette barcode delle palette mostrano il logo aziendale nell'intestazione. Se disattivato, il logo viene nascosto solo sulle etichette barcode paletta (fatture, DDT e altri PDF restano invariati).
                  </p>
                </div>
              </label>
            </div>

          </div>

          <div className="mt-8 pt-6 border-t border-slate-800">
            <button type="submit" disabled={isSaving} className="w-full py-4 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-xl font-black text-lg transition-all shadow-[0_0_20px_rgba(14,165,233,0.3)] flex items-center justify-center gap-2 disabled:opacity-50">
              {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
              {isSaving ? 'Salvataggio...' : 'Salva Impostazioni'}
            </button>
          </div>
        </form>

        {/* Sezione Sedi Magazzini & Frammentazione Capannoni */}
        <div className="mt-10 bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6">
          <div>
            <h2 className="text-2xl font-black text-brand-white flex items-center gap-3">
              <Warehouse className="text-emerald-400" size={26} />
              Sedi Operative Magazzini & Capannoni / Reparti
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              Configura gli indirizzi reali dei magazzini operativi (es. Settala, Caleppio) usati per localizzare la merce, la Bolla di Uscita e il terminale Zebra. Puoi anche dividere ogni magazzino in reparti o capannoni custom (es. Capannone 1, Capannone 5, Piazzale Fuori).
            </p>
          </div>

          <div className="space-y-4">
            {warehouses.map(wh => {
              const isEditing = editingWhId === wh.id;
              return (
                <div key={wh.id} className="bg-slate-950/80 border border-slate-800 rounded-2xl p-5 space-y-4">
                  {isEditing ? (
                    <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
                      <div className="sm:col-span-2">
                        <label className="text-[10px] font-bold uppercase text-slate-400">Nome Sede *</label>
                        <input
                          value={editWhDraft.name}
                          onChange={e => setEditWhDraft(p => ({ ...p, name: e.target.value }))}
                          className="w-full mt-1 bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2 text-sm font-bold"
                        />
                      </div>
                      <div className="sm:col-span-4">
                        <label className="text-[10px] font-bold uppercase text-slate-400">Indirizzo (Via / Civico)</label>
                        <input
                          value={editWhDraft.address || ''}
                          onChange={e => setEditWhDraft(p => ({ ...p, address: e.target.value }))}
                          className="w-full mt-1 bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2 text-sm"
                          placeholder="Via Logistica 10"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="text-[10px] font-bold uppercase text-slate-400">CAP</label>
                        <input
                          value={editWhDraft.cap || ''}
                          onChange={e => setEditWhDraft(p => ({ ...p, cap: e.target.value }))}
                          className="w-full mt-1 bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2 text-sm"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="text-[10px] font-bold uppercase text-slate-400">Città</label>
                        <input
                          value={editWhDraft.city || ''}
                          onChange={e => setEditWhDraft(p => ({ ...p, city: e.target.value }))}
                          className="w-full mt-1 bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2 text-sm"
                        />
                      </div>
                      <div className="sm:col-span-1">
                        <label className="text-[10px] font-bold uppercase text-slate-400">Prov.</label>
                        <input
                          maxLength={4}
                          value={editWhDraft.province || ''}
                          onChange={e => setEditWhDraft(p => ({ ...p, province: e.target.value.toUpperCase() }))}
                          className="w-full mt-1 bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2 text-sm uppercase"
                        />
                      </div>
                      <div className="sm:col-span-1 flex items-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleSaveWarehouse(wh.id)}
                          disabled={whBusy}
                          className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-400 text-brand-black rounded-xl font-black text-xs flex items-center justify-center"
                        >
                          <Check size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingWhId(null)}
                          className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold text-xs flex items-center justify-center"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-lg font-black text-white">{wh.name}</span>
                          <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] font-mono text-slate-400">
                            ID #{wh.id}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
                          <MapPin size={12} className="text-brand-blue shrink-0" />
                          {[wh.address, [wh.cap, wh.city, wh.province ? `(${wh.province})` : ''].filter(Boolean).join(' ')].filter(Boolean).join(' - ') || 'Indirizzo non ancora compilato (clicca Modifica per inserirlo)'}
                        </p>
                      </div>
                      {canManageSettings && (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingWhId(wh.id);
                              setEditWhDraft({
                                name: wh.name || '',
                                address: wh.address || '',
                                cap: wh.cap || '',
                                city: wh.city || '',
                                province: wh.province || ''
                              });
                            }}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold flex items-center gap-1.5"
                          >
                            <Edit2 size={13} /> Modifica Indirizzo
                          </button>
                          {wh.id > 2 && (
                            <button
                              type="button"
                              onClick={() => handleDeleteWarehouse(wh)}
                              className="p-2 bg-rose-500/15 hover:bg-rose-500 text-rose-400 hover:text-white rounded-xl transition-colors"
                              title="Elimina Magazzino"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Frammentazioni / Capannoni del magazzino */}
                  <div className="pt-3 border-t border-slate-800/80">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                      <Layers size={12} className="text-violet-400" /> Capannoni / Reparti in {wh.name} ({wh.divisions?.length || 0})
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {(wh.divisions || []).map(div => (
                        <span
                          key={div.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-violet-500/15 border border-violet-500/30 text-violet-200 text-xs font-bold"
                        >
                          {div.name}
                          {canManageSettings && (
                            <button
                              type="button"
                              onClick={() => handleDeleteDivision(div)}
                              className="text-violet-300 hover:text-rose-400 ml-0.5"
                              title="Rimuovi reparto"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </span>
                      ))}
                      {(wh.divisions || []).length === 0 && (
                        <span className="text-xs text-slate-500 italic">Nessuna frammentazione interna configurata.</span>
                      )}
                    </div>
                    {canManageSettings && (
                      <div className="mt-3 flex gap-2 max-w-md">
                        <input
                          type="text"
                          value={newDivNames[wh.id] || ''}
                          onChange={e => setNewDivNames(prev => ({ ...prev, [wh.id]: e.target.value }))}
                          placeholder="Es. Capannone 1, Capannone 5, Fuori..."
                          className="flex-1 bg-slate-900 border border-slate-800 text-white rounded-xl px-3 py-1.5 text-xs focus:border-violet-400 outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => handleAddDivision(wh.id)}
                          disabled={whBusy}
                          className="px-3 py-1.5 bg-violet-500/20 hover:bg-violet-500 text-violet-200 hover:text-white border border-violet-500/40 rounded-xl text-xs font-bold flex items-center gap-1"
                        >
                          <Plus size={13} /> Aggiungi Reparto
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {canManageSettings && (
            <form onSubmit={handleAddWarehouse} className="pt-4 border-t border-slate-800 space-y-3">
              <div className="text-xs font-black uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <Plus size={14} /> Aggiungi Nuovo Magazzino Fisico
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
                <input
                  required
                  value={newWh.name}
                  onChange={e => setNewWh(p => ({ ...p, name: e.target.value }))}
                  placeholder="Nome Sede (es. Lodi)*"
                  className="sm:col-span-2 bg-slate-950 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-sm font-bold"
                />
                <input
                  value={newWh.address}
                  onChange={e => setNewWh(p => ({ ...p, address: e.target.value }))}
                  placeholder="Indirizzo (Via / Civico)"
                  className="sm:col-span-2 bg-slate-950 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-sm"
                />
                <input
                  value={newWh.cap}
                  onChange={e => setNewWh(p => ({ ...p, cap: e.target.value }))}
                  placeholder="CAP"
                  className="bg-slate-950 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-sm"
                />
                <div className="flex gap-2">
                  <input
                    value={newWh.city}
                    onChange={e => setNewWh(p => ({ ...p, city: e.target.value }))}
                    placeholder="Città"
                    className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3 py-2.5 text-sm"
                  />
                  <input
                    maxLength={4}
                    value={newWh.province}
                    onChange={e => setNewWh(p => ({ ...p, province: e.target.value.toUpperCase() }))}
                    placeholder="PR"
                    className="w-16 bg-slate-950 border border-slate-700 text-white rounded-xl px-2 py-2.5 text-sm uppercase text-center"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={whBusy}
                className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-brand-black rounded-xl font-black text-xs flex items-center gap-2 disabled:opacity-50"
              >
                <Plus size={15} /> Crea Sede Magazzino
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;
