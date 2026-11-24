import React from 'react';
import { Thermometer, AlertTriangle } from 'lucide-react';
import { TEMP_REGIMES, ADR_PRESETS, formatAdrDescription } from '../utils/logisticsMeta';

export const DEFAULT_ADR_DRAFT = {
  preset_key: 'UN3077',
  un_number: 'UN3077',
  proper_shipping_name: "Materia pericolosa dal punto di vista dell'ambiente, solida, N.A.S.",
  technical_name: 'AOSA',
  adr_class: '9',
  packing_group: 'III',
  tunnel_code: '(-)',
  limited_quantity: false,
  custom_full_text: ''
};

const LogisticsMetaFields = ({
  tempRegime = 'NONE',
  onTempChange,
  isAdr = false,
  onAdrToggle,
  adrData = DEFAULT_ADR_DRAFT,
  onAdrDataChange,
  defaultTechnicalName = '',
  compact = false
}) => {
  const safeAdr = { ...DEFAULT_ADR_DRAFT, ...(adrData || {}) };

  const handlePresetSelect = (presetKey) => {
    if (presetKey === 'CUSTOM') {
      onAdrDataChange?.({ ...safeAdr, preset_key: 'CUSTOM' });
      return;
    }
    const found = ADR_PRESETS.find(p => p.key === presetKey);
    if (!found) return;
    onAdrDataChange?.({
      ...safeAdr,
      preset_key: found.key,
      un_number: found.un_number,
      proper_shipping_name: found.proper_shipping_name,
      technical_name: defaultTechnicalName ? defaultTechnicalName : (found.technical_name || ''),
      adr_class: found.adr_class,
      packing_group: found.packing_group,
      tunnel_code: found.tunnel_code,
      custom_full_text: ''
    });
  };

  const previewText = formatAdrDescription(safeAdr);

  return (
    <div className={`space-y-3 ${compact ? 'bg-slate-950/60 p-3 rounded-2xl border border-slate-800' : 'bg-slate-950/70 border border-slate-800 rounded-2xl p-3.5'}`}>
      {/* Temperatura Controllata (4 opzioni esclusive) */}
      <div>
        <label className="block text-slate-300 font-bold mb-1.5 text-[10px] uppercase tracking-wider flex items-center gap-1.5">
          <Thermometer size={12} className="text-sky-400" />
          Regime Temperatura (Metadata Paletta & Bolla)
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          {TEMP_REGIMES.map(tr => {
            const active = tempRegime === tr.code;
            const activeColor =
              tr.code === '2_8'
                ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                : tr.code === '15_25'
                  ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                  : tr.code === 'LT_25'
                    ? 'bg-sky-500/20 border-sky-400 text-sky-200'
                    : 'bg-slate-800 border-slate-600 text-white';
            return (
              <button
                key={tr.code}
                type="button"
                onClick={() => onTempChange?.(tr.code)}
                className={`px-2.5 py-2 rounded-xl border text-[11px] font-bold text-left transition-all flex items-center gap-1.5 ${
                  active ? activeColor : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 border ${active ? 'bg-current border-current' : 'border-slate-600'}`} />
                <span className="truncate">{tr.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Spunta ADR & Dati UN */}
      <div className="pt-2 border-t border-slate-800/80">
        <label className="flex items-center justify-between cursor-pointer select-none">
          <span className="flex items-center gap-2 text-xs font-black text-rose-300">
            <AlertTriangle size={14} className="text-rose-400" />
            Merce Pericolosa ADR (Dati UN per Bolla)
          </span>
          <input
            type="checkbox"
            checked={Boolean(isAdr)}
            onChange={e => {
              const checked = e.target.checked;
              onAdrToggle?.(checked);
              if (checked && defaultTechnicalName && (!adrData?.technical_name || adrData?.technical_name === 'AOSA')) {
                onAdrDataChange?.({ ...safeAdr, technical_name: defaultTechnicalName });
              }
            }}
            className="w-4 h-4 rounded border-rose-500/60 bg-slate-900 text-rose-500 cursor-pointer"
          />
        </label>

        {isAdr && (
          <div className="mt-3 space-y-2.5 pt-2.5 border-t border-rose-500/25 bg-rose-950/15 p-3 rounded-xl border border-rose-500/25">
            <div>
              <label className="block text-[10px] font-bold uppercase text-rose-300 mb-1">
                Preselezione Rapida UN ADR
              </label>
              <select
                value={safeAdr.preset_key || 'CUSTOM'}
                onChange={e => handlePresetSelect(e.target.value)}
                className="w-full bg-slate-950 border border-rose-500/40 text-white rounded-xl px-2.5 py-2 text-xs font-bold outline-none"
              >
                {ADR_PRESETS.map(p => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
                <option value="CUSTOM">-- Personalizzato manualmente --</option>
              </select>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5">Numero UN *</label>
                <input
                  value={safeAdr.un_number}
                  onChange={e => onAdrDataChange?.({ ...safeAdr, preset_key: 'CUSTOM', un_number: e.target.value.toUpperCase() })}
                  placeholder="UN3077"
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-2 py-1.5 text-xs font-mono font-bold uppercase"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5">Classe</label>
                <input
                  value={safeAdr.adr_class}
                  onChange={e => onAdrDataChange?.({ ...safeAdr, preset_key: 'CUSTOM', adr_class: e.target.value })}
                  placeholder="9"
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-2 py-1.5 text-xs font-bold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5">Gruppo Imb.</label>
                <input
                  value={safeAdr.packing_group}
                  onChange={e => onAdrDataChange?.({ ...safeAdr, preset_key: 'CUSTOM', packing_group: e.target.value.toUpperCase() })}
                  placeholder="III"
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-2 py-1.5 text-xs font-bold uppercase"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5">Galleria</label>
                <input
                  value={safeAdr.tunnel_code}
                  onChange={e => onAdrDataChange?.({ ...safeAdr, preset_key: 'CUSTOM', tunnel_code: e.target.value })}
                  placeholder="(-)"
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-2 py-1.5 text-xs font-bold"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="sm:col-span-2">
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5">Designazione Ufficiale di Trasporto</label>
                <input
                  value={safeAdr.proper_shipping_name}
                  onChange={e => onAdrDataChange?.({ ...safeAdr, preset_key: 'CUSTOM', proper_shipping_name: e.target.value })}
                  placeholder="Materia pericolosa..."
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-2.5 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5">Nome Tecnico (opz.)</label>
                <input
                  value={safeAdr.technical_name || ''}
                  onChange={e => onAdrDataChange?.({ ...safeAdr, preset_key: 'CUSTOM', technical_name: e.target.value })}
                  placeholder="Es. AOSA"
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-2.5 py-1.5 text-xs"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-[11px] font-semibold text-amber-200 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(safeAdr.limited_quantity)}
                onChange={e => onAdrDataChange?.({ ...safeAdr, limited_quantity: e.target.checked })}
                className="rounded border-slate-600 bg-slate-900 text-amber-400"
              />
              Quantità Limitata (LQ)
            </label>

            {previewText && (
              <div className="bg-slate-950/90 border border-rose-500/30 rounded-lg px-2.5 py-2 text-[11px] text-rose-200">
                <span className="font-black text-rose-400 uppercase text-[9px] block mb-0.5">Dicitura automatica su Bolla PDF:</span>
                {previewText}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default LogisticsMetaFields;
