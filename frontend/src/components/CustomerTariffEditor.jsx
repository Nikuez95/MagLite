import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import {
  Save, Loader2, Copy, RotateCcw, Layers, Plus, Sparkles, CheckCircle2, Lock, TrendingUp, TrendingDown, CheckSquare, Square
} from 'lucide-react';
import { appAlert, appConfirm } from '../utils/alerts';

const TARIFF_GROUPS = [
  {
    type: 'EVENT',
    title: 'Eventi (Movimentazione IN / OUT)',
    subtitle: 'Addebitati all\'ingresso o all\'uscita delle palette nel mese.'
  },
  {
    type: 'STORAGE',
    title: 'Deposito, Giacenza e Soste',
    subtitle: 'Include Deposito Paletta, Sosta Quindicinale e Sosta Giornaliera.'
  },
  {
    type: 'FLAG',
    title: 'Flag & Tag Automatici (ADR, Frigo, ecc.)',
    subtitle: 'Addebitati automaticamente quando la paletta presenta il relativo flag.'
  },
  {
    type: 'MANUAL',
    title: 'Servizi Globali Aggiuntivi (Default € 0,00)',
    subtitle: 'Servizi globali personalizzabili per singolo cliente o frammentazione.'
  },
  {
    type: 'DISCOUNT_PERCENT',
    title: 'Sconti Percentuali (%)',
    subtitle: 'Sconti applicati sul totale.'
  },
  {
    type: 'DISCOUNT_FIXED',
    title: 'Sconti Fissi (€)',
    subtitle: 'Sconti a importo fisso.'
  }
];

const SOURCE_BADGES = {
  custom: { label: 'Personalizzato', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  parent: { label: 'Da Madre', cls: 'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  plan: { label: 'Da Listino', cls: 'bg-brand-blue/15 text-brand-blue border-brand-blue/30' },
  default: { label: 'Base', cls: 'bg-slate-800 text-slate-400 border-slate-700' }
};

const CustomerTariffEditor = ({
  customer,
  canManageFinance = false,
  canManageGlobalPlans = false,
  canViewBilling = true,
  hasFragments = false,
  onUpdated,
  onOpenGlobalPlans,
  onOpenNewService
}) => {
  const [tariffs, setTariffs] = useState([]);
  const [plans, setPlans] = useState([]);
  const [viewingPlanId, setViewingPlanId] = useState('');
  const [applyToFragments, setApplyToFragments] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isApplyingPlan, setIsApplyingPlan] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [selectedRuleCodes, setSelectedRuleCodes] = useState([]);
  const [bulkPercent, setBulkPercent] = useState('10');
  const [pendingAuditNote, setPendingAuditNote] = useState('');

  const getToken = () => localStorage.getItem('maglite_token');

  const fetchData = async (explicitPlanId = null) => {
    if (!customer?.id || !canViewBilling) return;
    setIsLoading(true);
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      const plansRes = await axios.get(`http://${window.location.hostname}:3000/api/billing/tariff-plans`, { headers }).catch(() => ({ data: [] }));
      const pList = plansRes.data || [];
      setPlans(pList);

      const fallbackPlanId = customer.tariff_plan_id
        || pList.find(p => p.is_default)?.id
        || pList[0]?.id
        || '';
      const targetPlanId = explicitPlanId !== null && explicitPlanId !== ''
        ? String(explicitPlanId)
        : (fallbackPlanId ? String(fallbackPlanId) : '');

      const queryStr = targetPlanId ? `?planId=${targetPlanId}` : '';
      const tarRes = await axios.get(
        `http://${window.location.hostname}:3000/api/billing/tariffs/${customer.id}${queryStr}`,
        { headers }
      );
      const tList = tarRes.data || [];
      setTariffs(tList);
      setViewingPlanId(targetPlanId);
      setHasUnsavedChanges(false);
      setSelectedRuleCodes([]);
      setPendingAuditNote('');
    } catch (err) {
      console.error(err);
      appAlert('Errore caricamento listino cliente');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setViewingPlanId('');
    fetchData(null);
  }, [customer?.id, canViewBilling]);

  useEffect(() => {
    if (!canViewBilling) return;
    const socket = io(`http://${window.location.hostname}:3000`);
    const onBillingUpdated = () => fetchData(viewingPlanId || null);
    socket.on('billing_updated', onBillingUpdated);
    return () => {
      socket.off('billing_updated', onBillingUpdated);
      socket.disconnect();
    };
  }, [customer?.id, canViewBilling, viewingPlanId]);

  if (!canViewBilling) {
    return (
      <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-8 text-center">
        <Lock className="mx-auto text-slate-500 mb-3" size={28} />
        <p className="text-sm font-bold text-slate-300">Accesso Listini Limitato</p>
        <p className="text-xs text-slate-500 mt-1">
          Il tuo profilo non dispone dei permessi Amministrazione/Fatturazione per visualizzare i listini prezzi.
        </p>
      </div>
    );
  }

  const handlePriceChange = (ruleCode, newPrice) => {
    if (!canManageFinance) return;
    setHasUnsavedChanges(true);
    setTariffs(prev =>
      prev.map(t => (t.rule_code === ruleCode ? { ...t, final_price: newPrice, source: 'custom' } : t))
    );
  };

  const toggleRuleSelected = (ruleCode) => {
    if (!canManageFinance) return;
    setSelectedRuleCodes(prev =>
      prev.includes(ruleCode) ? prev.filter(c => c !== ruleCode) : [...prev, ruleCode]
    );
  };

  const applyBulkPercent = (direction) => {
    if (!canManageFinance || selectedRuleCodes.length === 0) return;
    const pct = parseFloat(String(bulkPercent).replace(',', '.'));
    if (isNaN(pct) || pct <= 0) {
      return appAlert('Inserisci una percentuale maggiore di zero.');
    }
    const mult = direction === 'UP' ? (1 + pct / 100) : Math.max(0, 1 - pct / 100);
    const selSet = new Set(selectedRuleCodes);
    setTariffs(prev =>
      prev.map(t => {
        if (!selSet.has(t.rule_code)) return t;
        const curr = parseFloat(t.final_price) || 0;
        const nextVal = Math.max(0, Math.round(curr * mult * 100) / 100);
        return { ...t, final_price: nextVal, source: 'custom' };
      })
    );
    setHasUnsavedChanges(true);
    const sign = direction === 'UP' ? '+' : '-';
    setPendingAuditNote(`Variazione massiva ${sign}${pct}% su ${selectedRuleCodes.length} voci selezionate (${selectedRuleCodes.join(', ')})`);
  };

  const handleSelectPlanTab = async (newPlanId) => {
    if (String(newPlanId) === String(viewingPlanId)) return;
    if (hasUnsavedChanges) {
      const ok = await appConfirm('Hai modifiche non salvate su questo listino. Vuoi cambiare listino perdendo le modifiche correnti?');
      if (!ok) return;
    }
    await fetchData(String(newPlanId));
  };

  const handleApplyPlan = async () => {
    if (!canManageFinance) return appAlert('Permesso Gestione Finanza richiesto.');
    if (!viewingPlanId) return appAlert('Seleziona un listino globale da impostare come predefinito.');
    const chosen = plans.find(p => String(p.id) === String(viewingPlanId));
    const ok = await appConfirm(
      `Impostare "${chosen?.name || ''}" come listino predefinito di "${customer.business_name}"${applyToFragments && hasFragments ? ' e di tutte le sue frammentazioni' : ''}? I prezzi personalizzati già salvati per questo listino restano preservati.`
    );
    if (!ok) return;

    setIsApplyingPlan(true);
    try {
      await axios.post(
        `http://${window.location.hostname}:3000/api/billing/tariffs/${customer.id}/apply-plan`,
        { plan_id: Number(viewingPlanId), apply_to_fragments: Boolean(applyToFragments && hasFragments), reset_overrides: false },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      await fetchData(viewingPlanId);
      onUpdated?.();
      appAlert(`"${chosen?.name}" impostato come listino predefinito!`, 'Listino Predefinito Aggiornato', 'success');
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore impostazione listino predefinito');
    } finally {
      setIsApplyingPlan(false);
    }
  };

  const handleCopyFromParent = async () => {
    if (!canManageFinance || !customer?.parent_id) return;
    try {
      const q = viewingPlanId ? `?planId=${viewingPlanId}` : '';
      const res = await axios.get(
        `http://${window.location.hostname}:3000/api/billing/tariffs/${customer.parent_id}${q}`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      setTariffs(res.data || []);
      setHasUnsavedChanges(true);
      appAlert(`Prezzi copiati da ${customer.parent_business_name || 'Cliente Madre'}. Premi "Salva Listino" per confermare.`);
    } catch (err) {
      appAlert('Errore durante la copia dal Cliente Madre');
    }
  };

  const handleResetToDefault = async () => {
    if (!canManageFinance) return;
    const currentPlan = plans.find(p => String(p.id) === String(viewingPlanId));
    const ok = await appConfirm(
      viewingPlanId
        ? `Ripristinare i prezzi di "${customer?.business_name}" ai valori originali del listino globale "${currentPlan?.name || ''}"?`
        : 'Ripristinare tutte le tariffe ai valori base del sistema?'
    );
    if (!ok) return;

    if (viewingPlanId) {
      try {
        await axios.post(
          `http://${window.location.hostname}:3000/api/billing/tariffs/${customer.id}/reset-plan`,
          { plan_id: Number(viewingPlanId) },
          { headers: { Authorization: `Bearer ${getToken()}` } }
        );
        await fetchData(viewingPlanId);
        onUpdated?.();
        appAlert(`Prezzi ripristinati ai valori del listino globale "${currentPlan?.name}".`, 'Ripristinato', 'success');
      } catch (err) {
        appAlert('Errore durante il ripristino del listino');
      }
      return;
    }

    setHasUnsavedChanges(true);
    setTariffs(prev =>
      prev.map(t => ({
        ...t,
        final_price: parseFloat(t.default_price) || 0,
        source: 'default'
      }))
    );
  };

  const handleSave = async () => {
    if (!canManageFinance) return appAlert('Permesso Gestione Finanza richiesto per salvare listini.');
    if (!customer?.id) return;
    setIsSaving(true);
    try {
      const payload = {
        plan_id: viewingPlanId ? Number(viewingPlanId) : null,
        audit_note: pendingAuditNote || undefined,
        tariffs: tariffs.map(t => ({
          rule_code: t.rule_code,
          custom_price: parseFloat(t.final_price) || 0
        }))
      };
      await axios.post(
        `http://${window.location.hostname}:3000/api/billing/tariffs/${customer.id}`,
        payload,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      setHasUnsavedChanges(false);
      setPendingAuditNote('');
      await fetchData(viewingPlanId || null);
      onUpdated?.();
      const currentPlanName = plans.find(p => String(p.id) === String(viewingPlanId))?.name;
      appAlert(
        `Prezzi custom ${currentPlanName ? `per "${currentPlanName}" ` : ''}salvati per "${customer.business_name}"!`,
        'Successo',
        'success'
      );
    } catch (err) {
      appAlert('Errore salvataggio listino');
    } finally {
      setIsSaving(false);
    }
  };

  const currentPlanObj = plans.find(p => String(p.id) === String(viewingPlanId)) || null;
  const activePlanName = currentPlanObj?.name || tariffs[0]?.tariff_plan_name || customer?.tariff_plan_name || null;
  const isCurrentPlanFlatRate = Boolean(currentPlanObj?.is_flat_rate || tariffs[0]?.is_flat_rate);
  const isCustomerDefaultPlan = Boolean(viewingPlanId && String(customer?.tariff_plan_id || '') === String(viewingPlanId));

  return (
    <div className="space-y-5">
      {/* Barra Selettore Listini Globali per questo Cliente / Frammentazione */}
      <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
              Listini Globali Disponibili ({plans.length}):
            </span>
            {activePlanName ? (
              <span className={`px-2.5 py-1 rounded-lg border text-xs font-bold flex items-center gap-1.5 ${
                isCurrentPlanFlatRate
                  ? 'bg-violet-500/15 text-violet-300 border-violet-500/30'
                  : 'bg-brand-blue/15 text-brand-blue border-brand-blue/30'
              }`}>
                <Layers size={13} /> {activePlanName}
                {isCustomerDefaultPlan && <span className="text-[10px] text-emerald-300 font-black ml-1">• Predefinito Cliente</span>}
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-400 text-xs font-semibold">
                Nessun listino globale creato
              </span>
            )}
          </div>

          {(canManageFinance || canManageGlobalPlans) && (
            <div className="flex flex-wrap gap-2">
              {canManageFinance && onOpenNewService && (
                <button
                  type="button"
                  onClick={onOpenNewService}
                  className="px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500 text-emerald-300 hover:text-brand-black border border-emerald-500/30 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                >
                  <Sparkles size={13} /> + Servizio Globale (€0)
                </button>
              )}
              {canManageGlobalPlans && onOpenGlobalPlans && (
                <button
                  type="button"
                  onClick={onOpenGlobalPlans}
                  className="px-3 py-1.5 bg-brand-blue/15 hover:bg-brand-blue text-brand-blue hover:text-brand-black border border-brand-blue/30 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                >
                  <Layers size={13} /> Gestisci Listini Globali
                </button>
              )}
            </div>
          )}
        </div>

        {/* Pills per selezionare e personalizzare qualsiasi Listino Globale su questo cliente/frammentazione */}
        {plans.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {plans.map(p => {
              const isSelected = String(p.id) === String(viewingPlanId);
              const isEntityDefault = String(customer?.tariff_plan_id || '') === String(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectPlanTab(p.id)}
                  className={`px-3 py-2 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5 ${
                    isSelected
                      ? (p.is_flat_rate
                          ? 'bg-violet-500/20 text-violet-200 border-violet-400 shadow'
                          : 'bg-brand-blue text-brand-black border-brand-blue shadow')
                      : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700'
                  }`}
                >
                  <Layers size={12} />
                  <span>{p.name}</span>
                  {p.is_flat_rate && (
                    <span className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase ${
                      isSelected ? 'bg-black/25 text-violet-200' : 'bg-violet-500/20 text-violet-300'
                    }`}>
                      Fisso
                    </span>
                  )}
                  {isEntityDefault && (
                    <span className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase ${
                      isSelected ? 'bg-black/25 text-white' : 'bg-emerald-500/20 text-emerald-300'
                    }`}>
                      Predefinito
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {canManageFinance && (
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 pt-2 border-t border-slate-800/80">
            <div className="flex flex-wrap items-center gap-2">
              {viewingPlanId && !isCustomerDefaultPlan && (
                <button
                  type="button"
                  disabled={isApplyingPlan}
                  onClick={handleApplyPlan}
                  className="px-3.5 py-2 bg-emerald-500/20 hover:bg-emerald-500 text-emerald-300 hover:text-brand-black border border-emerald-500/40 rounded-xl text-xs font-black transition-all disabled:opacity-40 flex items-center gap-1.5"
                >
                  {isApplyingPlan ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  Imposta "{currentPlanObj?.name}" come Predefinito
                </button>
              )}
              {!customer?.parent_id && hasFragments && viewingPlanId && (
                <label className="flex items-center gap-1.5 text-[11px] text-violet-300 font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applyToFragments}
                    onChange={e => setApplyToFragments(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-800 text-violet-500"
                  />
                  Applica predefinito anche alle frammentazioni
                </label>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {customer?.parent_id && (
                <button
                  type="button"
                  onClick={handleCopyFromParent}
                  className="px-3 py-2 bg-violet-500/15 hover:bg-violet-500 text-violet-300 hover:text-white border border-violet-500/30 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                >
                  <Copy size={13} /> Copia da Madre
                </button>
              )}
              <button
                type="button"
                onClick={handleResetToDefault}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
              >
                <RotateCcw size={13} /> {viewingPlanId ? 'Ripristina Valori Listino Globale' : 'Ripristina Base'}
              </button>
            </div>
          </div>
        )}
      </div>

      {isCurrentPlanFlatRate && !isLoading && (
        <div className="bg-violet-950/30 border border-violet-500/40 rounded-2xl p-4 text-xs text-violet-200 flex items-start gap-3">
          <Layers size={18} className="text-violet-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-black text-sm text-white">Modalità Fisso Mensile — Nessun calcolo su palette/movimenti</p>
            <p className="text-slate-300 mt-1">
              Le palette associate al listino <b>{activePlanName}</b> non vengono addebitate su ingressi, uscite, soste, depositi o flag. Utilizza la voce unica qui sotto (di default € 0,00).
            </p>
          </div>
        </div>
      )}

      {/* Lista Tariffe Editabili */}
      {isLoading ? (
        <div className="py-12 flex flex-col items-center justify-center text-brand-blue">
          <Loader2 className="animate-spin mb-3" size={32} />
          <p className="text-xs font-bold">Caricamento listino prezzi...</p>
        </div>
      ) : tariffs.length === 0 ? (
        <div className="text-center py-10 text-slate-500 text-sm italic">
          Nessuna regola tariffaria trovata nel sistema base.
        </div>
      ) : (
        <div className="space-y-4">
          {canManageFinance && (
            <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    const allCodes = tariffs.map(t => t.rule_code);
                    setSelectedRuleCodes(selectedRuleCodes.length === allCodes.length ? [] : allCodes);
                  }}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-bold flex items-center gap-1.5"
                >
                  {selectedRuleCodes.length === tariffs.length && tariffs.length > 0 ? <CheckSquare size={14} className="text-brand-blue" /> : <Square size={14} />}
                  {selectedRuleCodes.length === tariffs.length && tariffs.length > 0 ? 'Deseleziona Tutto' : 'Seleziona Tutte le Voci'}
                </button>
                <span className="text-xs text-slate-400">
                  {selectedRuleCodes.length > 0
                    ? <><b className="text-brand-blue">{selectedRuleCodes.length}</b> voci selezionate</>
                    : 'Spunta una o più voci per variare i prezzi in %'}
                </span>
              </div>

              {selectedRuleCodes.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1">
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={bulkPercent}
                      onChange={e => setBulkPercent(e.target.value)}
                      className="w-14 bg-transparent text-white text-right text-xs font-black outline-none"
                    />
                    <span className="text-xs font-bold text-slate-400">%</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => applyBulkPercent('UP')}
                    className="px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500 text-emerald-300 hover:text-brand-black border border-emerald-500/40 rounded-lg text-xs font-black flex items-center gap-1.5 transition-all"
                  >
                    <TrendingUp size={13} /> Aumenta in percentuale (+{bulkPercent || 0}%)
                  </button>
                  <button
                    type="button"
                    onClick={() => applyBulkPercent('DOWN')}
                    className="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500 text-rose-300 hover:text-white border border-rose-500/40 rounded-lg text-xs font-black flex items-center gap-1.5 transition-all"
                  >
                    <TrendingDown size={13} /> Diminuisci in percentuale (-{bulkPercent || 0}%)
                  </button>
                </div>
              )}
            </div>
          )}

          {TARIFF_GROUPS.map(grp => {
            const groupTariffs = tariffs.filter(t => t.rule_type === grp.type);
            if (groupTariffs.length === 0) return null;

            return (
              <div key={grp.type} className="bg-slate-950/80 border border-slate-800 rounded-2xl p-5">
                <div className="mb-3.5 flex items-center justify-between gap-2">
                  <div>
                    <h4 className="text-brand-blue font-black text-sm uppercase tracking-wider">{grp.title}</h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">{grp.subtitle}</p>
                  </div>
                  <span className="text-[11px] font-bold text-slate-500">{groupTariffs.length} voci</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {groupTariffs.map(t => {
                    const isDepositRule = t.rule_code === 'DEPOSITO_PALLET';
                    const isSelected = selectedRuleCodes.includes(t.rule_code);
                    const badge = SOURCE_BADGES[t.source] || SOURCE_BADGES.default;
                    return (
                      <div
                        key={t.rule_code}
                        className={`p-3.5 rounded-xl flex items-center justify-between gap-3 border transition-all ${
                          isSelected
                            ? 'bg-sky-950/35 border-brand-blue shadow-[0_0_12px_rgba(14,165,233,0.18)]'
                            : isDepositRule
                              ? 'bg-emerald-950/20 border-emerald-500/40'
                              : 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          {canManageFinance && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleRuleSelected(t.rule_code)}
                              className="mt-1 rounded border-slate-600 bg-slate-800 text-brand-blue cursor-pointer shrink-0"
                            />
                          )}
                          <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-sm text-slate-100">{t.description}</span>
                            <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase rounded border ${badge.cls}`}>
                              {badge.label}
                            </span>
                            {t.rule_code === 'SOSTA_GIORNO' && (
                              <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                30gg ≈ €{(parseFloat(t.final_price || 0) * 30).toFixed(2)}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono mt-1">
                            {t.rule_code} • Base: {grp.type === 'DISCOUNT_PERCENT' ? `${parseFloat(t.default_price || 0).toFixed(2)}%` : `€ ${parseFloat(t.default_price || 0).toFixed(2)}`}
                          </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-slate-400 font-bold text-xs">
                            {grp.type === 'DISCOUNT_PERCENT' ? '%' : '€'}
                          </span>
                          <input
                            type="number"
                            step="0.01"
                            disabled={!canManageFinance}
                            value={t.final_price}
                            onChange={e => handlePriceChange(t.rule_code, e.target.value)}
                            className="w-24 bg-slate-950 border border-slate-700 text-brand-white px-2.5 py-2 rounded-lg text-right font-bold text-sm focus:border-brand-blue outline-none disabled:opacity-60"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {canManageFinance && (
            <div className="pt-2 flex items-center justify-between gap-4 sticky bottom-0 bg-slate-900/95 backdrop-blur-sm py-3 border-t border-slate-800 rounded-b-2xl">
              <div className="text-xs text-slate-400">
                {hasUnsavedChanges ? (
                  <span className="text-amber-400 font-bold">Modifiche ai prezzi non ancora salvate</span>
                ) : (
                  <span>Prezzi allineati per <b className="text-slate-200">{customer?.business_name}</b></span>
                )}
              </div>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="px-6 py-3 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-xl font-black text-sm transition-all shadow-[0_0_20px_rgba(14,165,233,0.25)] flex items-center gap-2 disabled:opacity-50"
              >
                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {isSaving ? 'Salvataggio...' : `Salva Listino di ${customer?.business_name || ''}`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CustomerTariffEditor;
