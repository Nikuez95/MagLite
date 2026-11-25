import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import Select from 'react-select';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Coins, GitBranch, Building2, ArrowLeft, ReceiptText, Layers, Sparkles
} from 'lucide-react';
import { appAlert } from '../../utils/alerts';
import { hasPerm } from '../../utils/permissions';
import { themedSelectStyles } from '../../utils/theme';
import CustomerTariffEditor from '../../components/CustomerTariffEditor';
import { GlobalPlansModal, NewGlobalServiceModal } from '../../components/GlobalTariffModals';
import FinanceAdminNav from '../../components/FinanceAdminNav';

const ClientTariffManager = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [rawCustomers, setRawCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showGlobalPlansModal, setShowGlobalPlansModal] = useState(false);
  const [showNewServiceModal, setShowNewServiceModal] = useState(false);

  const getToken = () => localStorage.getItem('maglite_token');
  const canManageGlobalPlans = hasPerm(['tariff_plans_manage', 'finance_manage']);
  const canManageClientTariffs = hasPerm(['client_tariffs_manage', 'finance_manage']);
  const canManageFinance = canManageClientTariffs || canManageGlobalPlans;
  const canViewBilling = hasPerm(['view_billing', 'finance_manage', 'tariff_plans_manage', 'client_tariffs_manage']);

  const formatOption = (c) => ({
    value: c.id,
    label: c.parent_id
      ? `└─ ${c.business_name} (Frammentazione di ${c.parent_business_name || c.parent_name || 'Cliente Madre'})`
      : `${c.business_name} ${Number(c.children_count) > 0 ? `[Cliente Madre • ${c.children_count} Frammentazioni]` : '[Cliente Madre]'}`,
    raw: c
  });

  const fetchCustomers = async () => {
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/customers`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      const list = res.data || [];
      setRawCustomers(list);

      const paramClientId = searchParams.get('clientId') || selectedCustomer?.value;
      if (paramClientId) {
        const found = list.find(c => String(c.id) === String(paramClientId));
        if (found) {
          setSelectedCustomer(formatOption(found));
        }
      }
    } catch (err) {
      appAlert('Errore caricamento clienti');
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

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
    }
  };

  const selectStyles = themedSelectStyles;

  return (
    <div className="flex-1 p-6 md:p-8 overflow-y-auto bg-brand-black min-h-screen">
      <div className="max-w-7xl mx-auto animate-fade-in-up">
        <FinanceAdminNav />
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-brand-white mb-2 flex items-center gap-3">
              <Coins className="text-brand-blue" size={32} />
              Listini Prezzi per Cliente & Frammentazione
            </h1>
            <p className="text-slate-400">
              Assegna un <b className="text-brand-blue">Listino Globale</b>, aggiungi <b className="text-emerald-400">Servizi Globali (default €0)</b> e personalizza ogni voce per <b className="text-white">Cliente Madre</b> o <b className="text-violet-300">Frammentazione</b>.
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {canManageFinance && (
              <>
                <button
                  onClick={() => setShowNewServiceModal(true)}
                  className="px-4 py-2.5 bg-emerald-500/15 border border-emerald-500/30 hover:bg-emerald-500 text-emerald-300 hover:text-brand-black rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all"
                >
                  <Sparkles size={15} /> + Servizio Globale (€0)
                </button>
                <button
                  onClick={() => setShowGlobalPlansModal(true)}
                  className="px-4 py-2.5 bg-brand-blue/15 border border-brand-blue/30 hover:bg-brand-blue text-brand-blue hover:text-brand-black rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all"
                >
                  <Layers size={15} /> Listini Globali
                </button>
              </>
            )}
            <button
              onClick={() => navigate('/desktop/customers')}
              className="px-4 py-2.5 bg-slate-900 border border-slate-800 hover:border-slate-600 text-slate-300 rounded-xl text-xs font-bold flex items-center gap-2"
            >
              <ArrowLeft size={15} /> Cartelle Clienti
            </button>
            {selectedCustomer && (
              <button
                onClick={() => {
                  const rootId = selectedCustomer.raw?.parent_id || selectedCustomer.value;
                  navigate(`/desktop/billing-dashboard?clientId=${rootId}`);
                }}
                className="px-4 py-2.5 bg-slate-900 border border-emerald-500/30 hover:bg-emerald-500 text-emerald-300 hover:text-brand-black rounded-xl text-xs font-bold flex items-center gap-2 transition-all"
              >
                <ReceiptText size={15} /> Pre-Fattura
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

          {selectedCustomer?.raw ? (
            <CustomerTariffEditor
              customer={selectedCustomer.raw}
              canManageFinance={canManageClientTariffs}
              canManageGlobalPlans={canManageGlobalPlans}
              canViewBilling={canViewBilling}
              hasFragments={!selectedCustomer.raw.parent_id && familyMembers.length > 1}
              onUpdated={fetchCustomers}
              onOpenGlobalPlans={canManageGlobalPlans ? () => setShowGlobalPlansModal(true) : null}
              onOpenNewService={canManageFinance ? () => setShowNewServiceModal(true) : null}
            />
          ) : (
            <div className="text-center py-14 text-slate-500 text-sm">
              Seleziona un cliente o una frammentazione dal menu sopra per visualizzare e modificare il listino prezzi.
            </div>
          )}
        </div>
      </div>

      <GlobalPlansModal
        show={showGlobalPlansModal}
        onClose={() => setShowGlobalPlansModal(false)}
        onUpdated={fetchCustomers}
      />
      <NewGlobalServiceModal
        show={showNewServiceModal}
        onClose={() => setShowNewServiceModal(false)}
        onCreated={fetchCustomers}
      />
    </div>
  );
};

export default ClientTariffManager;
