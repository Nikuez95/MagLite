import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  X, Plus, Save, Trash2, Copy, Layers, Sparkles, Loader2, CheckCircle2, Tag
} from 'lucide-react';
import { appAlert, appConfirm } from '../utils/alerts';

const RULE_GROUP_LABELS = {
  EVENT: 'Eventi (IN / OUT)',
  STORAGE: 'Deposito & Soste',
  FLAG: 'Flag Automatici',
  MANUAL: 'Servizi Globali Aggiuntivi',
  DISCOUNT_PERCENT: 'Sconti (%)',
  DISCOUNT_FIXED: 'Sconti Fissi (€)'
};

const RULE_GROUP_ORDER = ['EVENT', 'STORAGE', 'FLAG', 'MANUAL', 'DISCOUNT_PERCENT', 'DISCOUNT_FIXED'];

export const NewGlobalServiceModal = ({ show, onClose, onCreated }) => {
  const [ruleType, setRuleType] = useState('MANUAL');
  const [description, setDescription] = useState('');
  const [ruleCode, setRuleCode] = useState('');
  const [autoCode, setAutoCode] = useState(true);
  const [defaultPrice, setDefaultPrice] = useState('0.00');
  const [isSaving, setIsSaving] = useState(false);

  const getToken = () => localStorage.getItem('maglite_token');

  useEffect(() => {
    if (show) {
      setRuleType('MANUAL');
      setDescription('');
      setRuleCode('');
      setAutoCode(true);
      setDefaultPrice('0.00');
    }
  }, [show]);

  useEffect(() => {
    if (!autoCode) return;
    const slug = description
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 36);
    if (!slug) {
      setRuleCode('');
      return;
    }
    setRuleCode(ruleType === 'FLAG' ? `FLAG_${slug}` : `SRV_${slug}`);
  }, [description, ruleType, autoCode]);

  if (!show) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!description.trim() || isSaving) return;
    setIsSaving(true);
    try {
      await axios.post(
        `http://${window.location.hostname}:3000/api/billing/rules`,
        {
          rule_type: ruleType,
          description: description.trim(),
          rule_code: ruleCode.trim() || undefined,
          default_price: parseFloat(defaultPrice) || 0
        },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      appAlert(
        `Servizio globale "${description.trim()}" creato! Ora puoi personalizzarne il prezzo per ogni singolo cliente o frammentazione.`,
        'Servizio Globale Creato',
        'success'
      );
      onCreated?.();
      onClose();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante la creazione del servizio globale');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/90 backdrop-blur-md">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl p-7 max-w-lg w-full shadow-2xl animate-fade-in-up">
        <div className="flex items-start justify-between mb-5">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold uppercase tracking-wider mb-2">
              <Sparkles size={12} /> Nuovo Servizio Globale
            </div>
            <h2 className="text-xl font-black text-white">Crea Servizio Globale</h2>
            <p className="text-xs text-slate-400 mt-1">
              Viene aggiunto a tutti i clienti con prezzo di default <b className="text-emerald-400">€ 0,00</b>, poi modificabile per singolo cliente o frammentazione.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Tipologia Servizio
            </label>
            <select
              value={ruleType}
              onChange={e => setRuleType(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl p-3 text-sm font-semibold focus:border-brand-blue outline-none"
            >
              <option value="MANUAL">Servizio Extra / Manuale (Consigliato)</option>
              <option value="FLAG">Flag Automatico su Paletta (es. FLAG_X)</option>
              <option value="EVENT">Evento Movimentazione</option>
              <option value="STORAGE">Sosta / Deposito</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Nome / Descrizione Servizio *
            </label>
            <input
              type="text"
              required
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Es. Etichettatura Speciale, Fasciatura Extra, Controllo..."
              className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl p-3 text-sm font-semibold focus:border-brand-blue outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Codice Identificativo
              </label>
              <input
                type="text"
                value={ruleCode}
                onChange={e => {
                  setAutoCode(false);
                  setRuleCode(e.target.value.toUpperCase());
                }}
                placeholder="Auto-generato"
                className="w-full bg-slate-950 border border-slate-800 text-brand-blue font-mono rounded-xl p-3 text-xs font-bold focus:border-brand-blue outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Prezzo Base Globale (€)
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-3 text-slate-500 font-bold text-sm">€</span>
                <input
                  type="number"
                  step="0.01"
                  value={defaultPrice}
                  onChange={e => setDefaultPrice(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 text-emerald-400 rounded-xl p-3 pl-8 text-sm font-bold text-right focus:border-brand-blue outline-none"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold text-sm"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-400 text-brand-black rounded-xl font-black text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Crea Servizio (€{parseFloat(defaultPrice || 0).toFixed(2)})
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const GlobalPlansModal = ({ show, onClose, onUpdated }) => {
  const [plans, setPlans] = useState([]);
  const [rules, setRules] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [editingPlanId, setEditingPlanId] = useState(null); // null = new
  const [planName, setPlanName] = useState('');
  const [invoiceLabel, setInvoiceLabel] = useState('');
  const [planDesc, setPlanDesc] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [isFlatRate, setIsFlatRate] = useState(false);
  const [planItems, setPlanItems] = useState({});
  const [syncAssigned, setSyncAssigned] = useState(false);

  const getToken = () => localStorage.getItem('maglite_token');

  const fetchAll = async () => {
    setIsLoading(true);
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      const [plansRes, rulesRes] = await Promise.all([
        axios.get(`http://${window.location.hostname}:3000/api/billing/tariff-plans`, { headers }),
        axios.get(`http://${window.location.hostname}:3000/api/billing/rules`, { headers })
      ]);
      setPlans(plansRes.data || []);
      setRules(rulesRes.data || []);
    } catch (err) {
      appAlert('Errore caricamento listini globali');
    } finally {
      setIsLoading(false);
    }
  };

  const initNewPlan = (rulesList = rules, copyFromPlan = null) => {
    setEditingPlanId(null);
    setPlanName(copyFromPlan ? `${copyFromPlan.name} (Copia)` : '');
    setInvoiceLabel(copyFromPlan?.invoice_label || (copyFromPlan ? `${copyFromPlan.name} (Copia)` : ''));
    setPlanDesc(copyFromPlan?.description || '');
    setIsDefault(false);
    setIsFlatRate(Boolean(copyFromPlan?.is_flat_rate));
    setSyncAssigned(false);
    const items = {};
    (rulesList || []).forEach(r => {
      items[r.rule_code] = copyFromPlan?.items?.[r.rule_code] !== undefined
        ? copyFromPlan.items[r.rule_code]
        : (parseFloat(r.default_price) || 0);
    });
    setPlanItems(items);
  };

  useEffect(() => {
    if (show) {
      fetchAll().then(() => {});
    }
  }, [show]);

  useEffect(() => {
    if (show && rules.length > 0 && editingPlanId === null && !planName && Object.keys(planItems).length === 0) {
      initNewPlan(rules);
    }
  }, [show, rules]);

  const selectPlanForEdit = (plan) => {
    setEditingPlanId(plan.id);
    setPlanName(plan.name);
    setInvoiceLabel(plan.invoice_label || plan.name || '');
    setPlanDesc(plan.description || '');
    setIsDefault(Boolean(plan.is_default));
    setIsFlatRate(Boolean(plan.is_flat_rate));
    setSyncAssigned(false);
    const items = {};
    rules.forEach(r => {
      items[r.rule_code] = plan.items?.[r.rule_code] !== undefined
        ? plan.items[r.rule_code]
        : (parseFloat(r.default_price) || 0);
    });
    setPlanItems(items);
  };

  if (!show) return null;

  const handleSave = async (e) => {
    e.preventDefault();
    if (!planName.trim() || isSaving) return;
    setIsSaving(true);
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      const payload = {
        name: planName.trim(),
        invoice_label: invoiceLabel.trim() || planName.trim(),
        description: planDesc.trim(),
        is_default: isDefault,
        is_flat_rate: isFlatRate,
        items: planItems,
        sync_assigned: syncAssigned
      };
      if (editingPlanId) {
        await axios.put(`http://${window.location.hostname}:3000/api/billing/tariff-plans/${editingPlanId}`, payload, { headers });
        appAlert(`Listino globale "${planName.trim()}" aggiornato!`, 'Listino Aggiornato', 'success');
      } else {
        await axios.post(`http://${window.location.hostname}:3000/api/billing/tariff-plans`, payload, { headers });
        appAlert(`Nuovo listino globale "${planName.trim()}" creato!`, 'Listino Creato', 'success');
      }
      await fetchAll();
      onUpdated?.();
      if (!editingPlanId) initNewPlan(rules);
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore salvataggio listino globale');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeletePlan = async (plan) => {
    const ok = await appConfirm(`Eliminare il listino globale "${plan.name}"? I clienti già personalizzati manterranno i propri prezzi attuali.`);
    if (!ok) return;
    try {
      await axios.delete(`http://${window.location.hostname}:3000/api/billing/tariff-plans/${plan.id}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      await fetchAll();
      onUpdated?.();
      if (editingPlanId === plan.id) initNewPlan(rules);
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore eliminazione listino');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-brand-black/90 backdrop-blur-md overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-5xl w-full shadow-2xl my-auto flex flex-col max-h-[90vh] overflow-hidden animate-fade-in-up">
        <div className="px-7 py-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60 shrink-0">
          <div>
            <h2 className="text-xl font-black text-white flex items-center gap-2.5">
              <Layers className="text-brand-blue" size={22} />
              Gestione Listini Prezzi Globali
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Crea modelli di listino riutilizzabili da applicare con un click ai clienti e alle frammentazioni, poi personalizzabili singolarmente.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl"
          >
            <X size={20} />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 min-h-0 overflow-hidden">
          {/* Colonna sinistra: Lista piani */}
          <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-800 bg-slate-950/40 p-5 flex flex-col gap-3 overflow-y-auto min-h-0 max-h-[220px] lg:max-h-none">
            <button
              type="button"
              onClick={() => initNewPlan(rules)}
              className={`w-full py-2.5 px-3.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all border ${
                editingPlanId === null
                  ? 'bg-brand-blue text-brand-black border-brand-blue shadow'
                  : 'bg-slate-900 hover:bg-slate-800 text-brand-blue border-slate-700'
              }`}
            >
              <Plus size={15} /> Nuovo Listino Globale
            </button>

            <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 mt-2 px-1">
              Listini Salvati ({plans.length})
            </div>

            {isLoading ? (
              <div className="py-8 flex justify-center text-brand-blue">
                <Loader2 className="animate-spin" size={24} />
              </div>
            ) : plans.length === 0 ? (
              <div className="text-xs text-slate-500 bg-slate-900/60 border border-slate-800 rounded-2xl p-4 text-center">
                Nessun listino globale creato finora. Creane uno qui a destra!
              </div>
            ) : (
              <div className="space-y-2">
                {plans.map(plan => {
                  const isActive = editingPlanId === plan.id;
                  return (
                    <div
                      key={plan.id}
                      onClick={() => selectPlanForEdit(plan)}
                      className={`p-3.5 rounded-2xl border cursor-pointer transition-all ${
                        isActive
                          ? 'bg-brand-blue/10 border-brand-blue/50 shadow'
                          : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-sm text-white truncate">{plan.name}</span>
                            {plan.is_default && (
                              <span className="px-1.5 py-0.5 text-[9px] font-black uppercase rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                Default
                              </span>
                            )}
                            {plan.is_flat_rate && (
                              <span className="px-1.5 py-0.5 text-[9px] font-black uppercase rounded bg-violet-500/20 text-violet-300 border border-violet-500/30">
                                Fisso
                              </span>
                            )}
                          </div>
                          {plan.description && (
                            <p className="text-[11px] text-slate-400 truncate mt-0.5">{plan.description}</p>
                          )}
                          <div className="text-[10px] text-slate-500 mt-1.5">
                            Assegnato a <b className="text-slate-300">{plan.assigned_count || 0}</b> entità
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => initNewPlan(rules, plan)}
                            title="Duplica listino"
                            className="p-1.5 text-slate-400 hover:text-brand-blue hover:bg-slate-800 rounded-lg"
                          >
                            <Copy size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeletePlan(plan)}
                            title="Elimina listino"
                            className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Colonna destra: Editor prezzi del listino */}
          <form onSubmit={handleSave} className="lg:col-span-8 flex flex-col min-h-0 overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Nome Listino Globale *
                  </label>
                  <input
                    type="text"
                    required
                    value={planName}
                    onChange={e => setPlanName(e.target.value)}
                    placeholder="Es. Listino Standard 2026..."
                    className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-3.5 py-2.5 text-sm font-bold focus:border-brand-blue outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-amber-300 mb-1">
                    Dicitura in Fattura / PDF *
                  </label>
                  <input
                    type="text"
                    required
                    value={invoiceLabel}
                    onChange={e => setInvoiceLabel(e.target.value)}
                    placeholder="Es. Movimentazione Logistica Standard..."
                    className="w-full bg-slate-950 border border-amber-500/40 text-amber-100 rounded-xl px-3.5 py-2.5 text-sm font-bold focus:border-amber-400 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Descrizione / Note Interne
                  </label>
                  <input
                    type="text"
                    value={planDesc}
                    onChange={e => setPlanDesc(e.target.value)}
                    placeholder="Es. Tariffe dedicate ai grandi volumi"
                    className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-3.5 py-2.5 text-sm focus:border-brand-blue outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-5 px-1">
                <label className="flex items-center gap-2 text-xs text-slate-300 font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isDefault}
                    onChange={e => setIsDefault(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-800 text-brand-blue"
                  />
                  Imposta come listino predefinito suggerito
                </label>

                {!editingPlanId ? (
                  <label className="flex items-center gap-2 text-xs text-violet-300 font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isFlatRate}
                      onChange={e => setIsFlatRate(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-800 text-violet-500"
                    />
                    Listino Fisso Mensile (1 sola voce — nessun calcolo movimenti/palette)
                  </label>
                ) : isFlatRate ? (
                  <span className="px-2 py-0.5 text-[11px] font-bold rounded bg-violet-500/15 text-violet-300 border border-violet-500/30">
                    Modalità Fisso Mensile (1 voce senza calcoli a consumo)
                  </span>
                ) : null}

                {editingPlanId && (
                  <label className="flex items-center gap-2 text-xs text-amber-300 font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={syncAssigned}
                      onChange={e => setSyncAssigned(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-800 text-amber-500"
                    />
                    Propaga le modifiche ai clienti già collegati a questo listino
                  </label>
                )}
              </div>

              {isFlatRate ? (
                <div className="bg-violet-950/25 border border-violet-500/30 rounded-2xl p-5 space-y-3">
                  <div className="text-xs font-black uppercase tracking-wider text-violet-300">
                    Voce Unica — Listino Fisso Mensile (Nessun Calcolo Automatico)
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Le palette associate a questo listino non generano alcun costo su ingressi (IN), uscite (OUT), soste, depositi o flag. Utilizzato per clienti o movimentazioni incluse in un accordo fisso mensile.
                  </p>
                  {(() => {
                    const flatRule = rules.find(r => r.rule_code === 'CANONE_FISSO_MENSILE') || {
                      rule_code: 'CANONE_FISSO_MENSILE',
                      description: 'Nessun Calcolo (Canone Fisso Mensile)',
                      default_price: 0
                    };
                    return (
                      <div className="flex items-center justify-between gap-3 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-white">{flatRule.description}</div>
                          <div className="text-[11px] font-mono text-slate-500">{flatRule.rule_code}</div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-xs text-slate-400 font-bold">€</span>
                          <input
                            type="number"
                            step="0.01"
                            value={planItems['CANONE_FISSO_MENSILE'] ?? flatRule.default_price ?? 0}
                            onChange={e => setPlanItems(prev => ({ ...prev, CANONE_FISSO_MENSILE: e.target.value }))}
                            className="w-24 bg-slate-950 border border-slate-700 text-white rounded-lg px-2.5 py-1.5 text-right text-sm font-bold focus:border-violet-400 outline-none"
                          />
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="space-y-4">
                  {RULE_GROUP_ORDER.map(type => {
                    const groupRules = rules.filter(r => r.rule_type === type && r.rule_code !== 'CANONE_FISSO_MENSILE');
                    if (groupRules.length === 0) return null;
                    return (
                      <div key={type} className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4">
                        <div className="text-xs font-black uppercase tracking-wider text-brand-blue mb-3 flex items-center gap-1.5">
                          <Tag size={12} /> {RULE_GROUP_LABELS[type] || type}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {groupRules.map(r => (
                            <div
                              key={r.rule_code}
                              className="flex items-center justify-between gap-2 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2"
                            >
                              <div className="min-w-0">
                                <div className="text-xs font-bold text-slate-200 truncate">{r.description}</div>
                                <div className="text-[10px] font-mono text-slate-500">{r.rule_code}</div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <span className="text-xs text-slate-500 font-bold">
                                  {type === 'DISCOUNT_PERCENT' ? '%' : '€'}
                                </span>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={planItems[r.rule_code] ?? r.default_price ?? 0}
                                  onChange={e => setPlanItems(prev => ({ ...prev, [r.rule_code]: e.target.value }))}
                                  className="w-20 bg-slate-950 border border-slate-700 text-white rounded-lg px-2 py-1 text-right text-xs font-bold focus:border-brand-blue outline-none"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="shrink-0 px-6 py-4 border-t border-slate-800 bg-slate-900/95 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-bold"
              >
                Chiudi
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-6 py-2.5 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-xl text-sm font-black flex items-center gap-2 disabled:opacity-50"
              >
                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                {editingPlanId ? 'Salva Modifiche Listino' : 'Crea Listino Globale'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
