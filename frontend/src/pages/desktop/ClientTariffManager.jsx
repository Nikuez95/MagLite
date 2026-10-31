import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import Select from 'react-select';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Save, Loader2, Coins, GitBranch, Building2, Copy, ArrowLeft, ReceiptText, RotateCcw } from 'lucide-react';
import { appAlert } from '../../utils/alerts';
import { hasPerm } from '../../utils/permissions';

const ClientTariffManager = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [rawCustomers, setRawCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [tariffs, setTariffs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const getToken = () => localStorage.getItem('maglite_token');
  const canManageFinance = hasPerm('finance_manage');

  const fetchTariffs = async (clientId) => {
    if (!clientId) return;
    setIsLoading(true);
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/billing/tariffs/${clientId}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setTariffs(res.data || []);
    } catch (err) {
      appAlert('Errore caricamento listino cliente');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const fetchCustomers = async () => {
      try {
        const res = await axios.get(`http://${window.location.hostname}:3000/api/customers`, {
          headers: { Authorization: `Bearer ${getToken()}` }
        });
        const list = res.data || [];
        setRawCustomers(list);

        const paramClientId = searchParams.get('clientId');
        if (paramClientId) {
          const found = list.find(c => String(c.id) === String(paramClientId));
          if (found) {
            const option = formatOption(found);
            setSelectedCustomer(option);
            fetchTariffs(found.id);
          }
        }
      } catch (err) {
        appAlert('Errore caricamento clienti');
      }
    };
    fetchCustomers();
  }, []);

  const formatOption = (c) => ({
    value: c.id,
    label: c.parent_id
      ? `└─ ${c.business_name} (Frammentazione di ${c.parent_business_name || c.parent_name || 'Cliente Madre'})`
      : `${c.business_name} ${Number(c.children_count) > 0 ? `[Cliente Madre • ${c.children_count} Frammentazioni]` : '[Cliente Madre]'}`,
    raw: c
  });

  const customerOptions = useMemo(() => {
    const parents = rawCustomers.filter(c => !c.parent_id);
    const ordered = [];
    parents.forEach(p => {
      ordered.push(formatOption(p));
      rawCustomers
        .filter(ch => ch.parent_id === p.id)
        .forEach(ch => ordered.push(formatOption(ch)));
    });
    return ordered;
  }, [rawCustomers]);

  // Individuo la famiglia (Cliente Madre + tutte le sue frammentazioni) per navigazione rapida
  const familyMembers = useMemo(() => {
    if (!selectedCustomer?.raw) return [];
    const current = selectedCustomer.raw;
    const rootId = current.parent_id || current.id;
    const rootCustomer = rawCustomers.find(c => c.id === rootId);
    const children = rawCustomers.filter(c => c.parent_id === rootId);
    return rootCustomer ? [rootCustomer, ...children] : children;
  }, [selectedCustomer, rawCustomers]);

  const handleSelectCustomer = (opt) => {
    setSelectedCustomer(opt);
    if (opt?.value) {
      setSearchParams({ clientId: opt.value });
      fetchTariffs(opt.value);
    }
  };

  const handlePriceChange = (ruleCode, newPrice) => {
    setTariffs(prev => prev.map(t =>
      t.rule_code === ruleCode ? { ...t, final_price: newPrice } : t
    ));
  };

  const handleCopyFromParent = async () => {
    if (!selectedCustomer?.raw?.parent_id) return;
    try {
      const parentId = selectedCustomer.raw.parent_id;
      const res = await axios.get(`http://${window.location.hostname}:3000/api/billing/tariffs/${parentId}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setTariffs(res.data || []);
      appAlert(`Prezzi copiati da ${selectedCustomer.raw.parent_business_name}. Premi "Salva Listino" per confermare.`);
    } catch (err) {
      appAlert('Errore durante la copia dal Cliente Madre');
    }
  };

  const handleResetToDefault = () => {
    setTariffs(prev => prev.map(t => ({
      ...t,
      final_price: parseFloat(t.default_price) || 0
    })));
  };

  const handleSave = async () => {
    if (!canManageFinance) return appAlert('Permesso Gestione Finanza richiesto per salvare listini.');
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
      appAlert(`Listino prezzi per "${selectedCustomer.raw?.business_name || selectedCustomer.label}" aggiornato con successo!`, 'Successo', 'success');
    } catch (err) {
      appAlert('Errore salvataggio listino');
    } finally {
      setIsSaving(false);
    }
  };

  const selectStyles = {
    control: (base, state) => ({ ...base, backgroundColor: '#020617', borderColor: state.isFocused ? '#38bdf8' : '#1e293b', padding: '0.25rem', borderRadius: '0.75rem', color: '#f8fafc' }),
    menu: base => ({ ...base, backgroundColor: '#0f172a', border: '1px solid #1e293b', zIndex: 50 }),
    option: (base, state) => ({ ...base, backgroundColor: state.isFocused ? '#1e293b' : 'transparent', color: '#f8fafc' }),
    singleValue: base => ({ ...base, color: '#f8fafc' }),
    input: base => ({ ...base, color: '#f8fafc' })
  };

  const renderGroup = (type, title, subtitle) => {
    const groupTariffs = tariffs.filter(t => t.rule_type === type);
    if (groupTariffs.length === 0) return null;

    return (
      <div className="mb-6 bg-slate-950 p-6 rounded-2xl border border-slate-800">
        <div className="mb-4">
          <h3 className="text-brand-blue font-bold text-lg uppercase tracking-wider">{title}</h3>
          {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {groupTariffs.map(t => {
            const isDepositRule = t.rule_code === 'DEPOSITO_PALLET';
            return (
              <div
                key={t.rule_code}
                className={`p-4 rounded-xl flex items-center justify-between border transition-all ${
                  isDepositRule
                    ? 'bg-emerald-950/20 border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.08)]'
                    : 'bg-slate-900 border-slate-700'
                }`}
              >
                <div className="pr-3">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-200">{t.description}</span>
                    {isDepositRule && (
                      <span className="px-2 py-0.5 text-[10px] font-black uppercase rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        Deposito
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 font-mono mt-1">
                    {t.rule_code} • Base: € {parseFloat(t.default_price || 0).toFixed(2)}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-slate-400 font-bold">€</span>
                  <input
                    type="number"
                    step="0.01"
                    value={t.final_price}
                    onChange={e => handlePriceChange(t.rule_code, e.target.value)}
                    className="w-28 bg-slate-950 border border-slate-700 text-brand-white p-2.5 rounded-lg text-right font-bold focus:border-brand-blue outline-none"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-brand-black min-h-screen">
      <div className="max-w-5xl mx-auto animate-fade-in-up">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-brand-white mb-2 flex items-center gap-3">
              <Coins className="text-brand-blue" size={32} />
              Listini Prezzi per Cliente & Frammentazione
            </h1>
            <p className="text-slate-400">
              Ogni <b className="text-white">Cliente Madre</b> e ogni sua <b className="text-violet-300">Frammentazione / Reparto</b> possiede un proprio listino prezzi indipendente (incluso il costo di <b className="text-emerald-400">Deposito Paletta</b>).
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => navigate('/desktop/customers')}
              className="px-4 py-2.5 bg-slate-900 border border-slate-800 hover:border-slate-600 text-slate-300 rounded-xl text-xs font-bold flex items-center gap-2"
            >
              <ArrowLeft size={15} /> Anagrafica Clienti
            </button>
            {selectedCustomer && (
              <button
                onClick={() => {
                  const rootId = selectedCustomer.raw?.parent_id || selectedCustomer.value;
                  navigate(`/desktop/billing-dashboard?clientId=${rootId}`);
                }}
                className="px-4 py-2.5 bg-emerald-500/15 border border-emerald-500/30 hover:bg-emerald-500 text-emerald-300 hover:text-brand-black rounded-xl text-xs font-bold flex items-center gap-2 transition-all"
              >
                <ReceiptText size={15} /> Vai a Pre-Fattura
              </button>
            )}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-xl">
          <div className="mb-6">
            <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">
              Seleziona Cliente Madre o Frammentazione
            </label>
            <Select
              options={customerOptions}
              styles={selectStyles}
              placeholder="Cerca cliente o frammentazione (es. LOGISTICA REPARTO CARNE)..."
              value={selectedCustomer}
              onChange={handleSelectCustomer}
            />
          </div>

          {/* Barra di switch rapido tra Cliente Madre e le sue Frammentazioni */}
          {familyMembers.length > 1 && (
            <div className="mb-6 bg-slate-950/90 border border-violet-500/30 rounded-2xl p-4">
              <div className="text-xs font-bold uppercase tracking-wider text-violet-300 mb-3 flex items-center gap-2">
                <GitBranch size={15} />
                Passa rapidamente tra i listini del gruppo &ldquo;{familyMembers[0]?.business_name}&rdquo;:
              </div>
              <div className="flex flex-wrap gap-2">
                {familyMembers.map(member => {
                  const isActive = selectedCustomer?.value === member.id;
                  const isParent = !member.parent_id;
                  return (
                    <button
                      key={member.id}
                      onClick={() => handleSelectCustomer(formatOption(member))}
                      className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border ${
                        isActive
                          ? isParent
                            ? 'bg-brand-blue text-brand-black border-brand-blue shadow-lg'
                            : 'bg-violet-500 text-white border-violet-400 shadow-lg'
                          : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-600'
                      }`}
                    >
                      {isParent ? <Building2 size={14} /> : <GitBranch size={13} />}
                      {member.business_name}
                      {isParent && <span className="text-[10px] opacity-80">(Madre)</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {selectedCustomer?.raw && (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 bg-slate-950/60 border border-slate-800 rounded-2xl p-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-black text-white">{selectedCustomer.raw.business_name}</span>
                  {selectedCustomer.raw.parent_id ? (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-violet-500/20 text-violet-300 border border-violet-500/30">
                      Frammentazione di {selectedCustomer.raw.parent_business_name || selectedCustomer.raw.parent_name}
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-brand-blue/15 text-brand-blue border border-brand-blue/30">
                      Cliente Madre
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  I prezzi salvati qui vengono applicati esclusivamente alle palette e ai movimenti di <b className="text-slate-200">{selectedCustomer.raw.business_name}</b>.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedCustomer.raw.parent_id && (
                  <button
                    type="button"
                    onClick={handleCopyFromParent}
                    className="px-3.5 py-2 bg-violet-500/15 hover:bg-violet-500 text-violet-300 hover:text-white border border-violet-500/30 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                  >
                    <Copy size={14} /> Copia Tariffe da {selectedCustomer.raw.parent_business_name || selectedCustomer.raw.parent_name}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleResetToDefault}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                >
                  <RotateCcw size={14} /> Ripristina Prezzi Base
                </button>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center text-brand-blue">
              <Loader2 className="animate-spin mb-4" size={48} />
              <p className="font-bold">Caricamento listino in corso...</p>
            </div>
          ) : selectedCustomer && tariffs.length > 0 ? (
            <div className="animate-fade-in-up">
              {renderGroup('EVENT', 'Eventi (Movimentazione IN/OUT)', 'Addebitati all\'ingresso o all\'uscita delle palette nel mese.')}
              {renderGroup('STORAGE', 'Deposito, Giacenza e Soste', 'Include la tariffa di Deposito Paletta (per le palette rimaste in deposito) e le regole di sosta.')}
              {renderGroup('FLAG', 'Servizi Extra & Tag (ADR, Frigo, ecc.)', 'Addebitati quando la paletta presenta il relativo tag operativo.')}

              <div className="mt-8 border-t border-slate-800 pt-6">
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="w-full py-4 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-xl font-black text-lg transition-all shadow-[0_0_20px_rgba(14,165,233,0.3)] flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
                  {isSaving ? 'Salvataggio...' : `Salva Listino di ${selectedCustomer.raw?.business_name || ''}`}
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
