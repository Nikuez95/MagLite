import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  Calculator,
  Archive,
  TrendingDown,
  Coins,
  Settings2
} from 'lucide-react';
import { hasPerm } from '../utils/permissions';

const NAV_ITEMS = [
  {
    path: '/desktop/finances',
    label: 'Dashboard Finanza',
    Icon: Activity,
    perm: ['view_finances', 'finance_manage'],
    accent: 'sky'
  },
  {
    path: '/desktop/billing-dashboard',
    label: 'Pre-Fatturazione',
    Icon: Calculator,
    perm: ['view_billing', 'finance_manage'],
    accent: 'blue'
  },
  {
    path: '/desktop/invoices-history',
    label: 'Archivio Proforme',
    Icon: Archive,
    perm: ['view_finances', 'finance_manage', 'view_billing'],
    accent: 'emerald'
  },
  {
    path: '/desktop/expenses',
    label: 'Gestione Uscite',
    Icon: TrendingDown,
    perm: ['view_finances', 'finance_manage'],
    accent: 'rose'
  },
  {
    path: '/desktop/billing-tariffs',
    label: 'Listini & Tariffe Clienti',
    Icon: Coins,
    perm: ['view_billing', 'finance_manage', 'tariff_plans_manage', 'client_tariffs_manage'],
    accent: 'amber'
  },
  {
    path: '/desktop/billing-rules',
    label: 'Regole Base & Flag',
    Icon: Settings2,
    perm: ['view_billing', 'finance_manage', 'tariff_plans_manage'],
    accent: 'violet'
  }
];

const FinanceAdminNav = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const visibleItems = NAV_ITEMS.filter(item => hasPerm(item.perm));
  if (visibleItems.length <= 1) return null;

  return (
    <div className="mb-6 bg-slate-900/85 border border-slate-800 rounded-2xl p-1.5 flex flex-wrap items-center gap-1.5 shadow-lg">
      {visibleItems.map(item => {
        const isActive = location.pathname === item.path;
        const Icon = item.Icon;
        return (
          <button
            key={item.path}
            type="button"
            onClick={() => navigate(item.path)}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              isActive
                ? 'bg-brand-blue text-brand-black shadow-[0_0_15px_rgba(14,165,233,0.3)] font-black'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/80'
            }`}
          >
            <Icon size={15} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default FinanceAdminNav;
