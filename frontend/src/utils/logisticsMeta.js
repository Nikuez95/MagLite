export const TEMP_REGIMES = [
  { code: 'NONE', label: 'Senza temperatura (Ambiente)', shortLabel: 'Senza Temp.', pdfLabel: null },
  { code: '2_8', label: 'Temperatura Controllata (2 / 8 °C)', shortLabel: 'Temp. 2-8°C', pdfLabel: 'TEMPERATURA CONTROLLATA +2°C / +8°C' },
  { code: '15_25', label: 'Temperatura Controllata (15 / 25 °C)', shortLabel: 'Temp. 15-25°C', pdfLabel: 'TEMPERATURA CONTROLLATA +15°C / +25°C' },
  { code: 'LT_25', label: 'Temperatura Controllata (< 25 °C)', shortLabel: 'Temp. < 25°C', pdfLabel: 'TEMPERATURA CONTROLLATA < 25°C' }
];

export const TEMP_REGIME_MAP = Object.fromEntries(TEMP_REGIMES.map(t => [t.code, t]));

export const ADR_PRESETS = [
  {
    key: 'UN3077',
    label: 'UN3077 — Materia pericolosa ambiente, solida, N.A.S. (9, III)',
    un_number: 'UN3077',
    proper_shipping_name: "Materia pericolosa dal punto di vista dell'ambiente, solida, N.A.S.",
    technical_name: 'AOSA',
    adr_class: '9',
    packing_group: 'III',
    tunnel_code: '(-)'
  },
  {
    key: 'UN3082',
    label: 'UN3082 — Materia pericolosa ambiente, liquida, N.A.S. (9, III)',
    un_number: 'UN3082',
    proper_shipping_name: "Materia pericolosa dal punto di vista dell'ambiente, liquida, N.A.S.",
    technical_name: '',
    adr_class: '9',
    packing_group: 'III',
    tunnel_code: '(-)'
  },
  {
    key: 'UN1993_II',
    label: 'UN1993 — Liquido infiammabile, N.A.S. (Classe 3, II)',
    un_number: 'UN1993',
    proper_shipping_name: 'Liquido infiammabile, N.A.S.',
    technical_name: '',
    adr_class: '3',
    packing_group: 'II',
    tunnel_code: '(D/E)'
  },
  {
    key: 'UN1993_III',
    label: 'UN1993 — Liquido infiammabile, N.A.S. (Classe 3, III)',
    un_number: 'UN1993',
    proper_shipping_name: 'Liquido infiammabile, N.A.S.',
    technical_name: '',
    adr_class: '3',
    packing_group: 'III',
    tunnel_code: '(D/E)'
  },
  {
    key: 'UN1170',
    label: 'UN1170 — Etanolo / Alcool etilico (Classe 3, II)',
    un_number: 'UN1170',
    proper_shipping_name: 'Etanolo (Alcool etilico) o Etanolo in soluzione',
    technical_name: '',
    adr_class: '3',
    packing_group: 'II',
    tunnel_code: '(D/E)'
  },
  {
    key: 'UN1219',
    label: 'UN1219 — Isopropanolo (Classe 3, II)',
    un_number: 'UN1219',
    proper_shipping_name: 'Isopropanolo (Alcool isopropilico)',
    technical_name: '',
    adr_class: '3',
    packing_group: 'II',
    tunnel_code: '(D/E)'
  },
  {
    key: 'UN1760',
    label: 'UN1760 — Liquido corrosivo, N.A.S. (Classe 8, II)',
    un_number: 'UN1760',
    proper_shipping_name: 'Liquido corrosivo, N.A.S.',
    technical_name: '',
    adr_class: '8',
    packing_group: 'II',
    tunnel_code: '(E)'
  },
  {
    key: 'UN1789',
    label: 'UN1789 — Acido cloridrico (Classe 8, II)',
    un_number: 'UN1789',
    proper_shipping_name: 'Acido cloridrico',
    technical_name: '',
    adr_class: '8',
    packing_group: 'II',
    tunnel_code: '(E)'
  },
  {
    key: 'UN1791',
    label: 'UN1791 — Ipoclorito in soluzione (Classe 8, III)',
    un_number: 'UN1791',
    proper_shipping_name: 'Ipoclorito in soluzione',
    technical_name: '',
    adr_class: '8',
    packing_group: 'III',
    tunnel_code: '(E)'
  },
  {
    key: 'UN2014',
    label: 'UN2014 — Perossido di idrogeno in soluzione (5.1 (8), II)',
    un_number: 'UN2014',
    proper_shipping_name: 'Perossido di idrogeno in soluzione acquosa',
    technical_name: '',
    adr_class: '5.1 (8)',
    packing_group: 'II',
    tunnel_code: '(E)'
  },
  {
    key: 'UN1950',
    label: 'UN1950 — Aerosol (Classe 2)',
    un_number: 'UN1950',
    proper_shipping_name: 'Aerosol',
    technical_name: 'infiammabili',
    adr_class: '2',
    packing_group: '-',
    tunnel_code: '(D)'
  },
  {
    key: 'UN3480',
    label: 'UN3480 — Batterie al litio-ione (Classe 9)',
    un_number: 'UN3480',
    proper_shipping_name: 'Batterie al litio-ione',
    technical_name: '',
    adr_class: '9',
    packing_group: '-',
    tunnel_code: '(E)'
  }
];

export function normalizeTempRegime(val) {
  const clean = String(val || 'NONE').trim().toUpperCase();
  if (clean === '2_8' || clean === '2-8' || clean === '6_8') return '2_8';
  if (clean === '15_25' || clean === '15-25') return '15_25';
  if (clean === 'LT_25' || clean === '<25' || clean === 'UNDER_25') return 'LT_25';
  return 'NONE';
}

export function formatAdrDescription(adrRaw) {
  if (!adrRaw || typeof adrRaw !== 'object') return '';
  if (adrRaw.custom_full_text && String(adrRaw.custom_full_text).trim()) {
    return String(adrRaw.custom_full_text).trim();
  }
  const un = String(adrRaw.un_number || '').trim().toUpperCase();
  const name = String(adrRaw.proper_shipping_name || '').trim();
  const tech = String(adrRaw.technical_name || '').trim();
  const cls = String(adrRaw.adr_class || '').trim();
  const pg = String(adrRaw.packing_group || '').trim();
  const tunnel = String(adrRaw.tunnel_code || '').trim();
  const lq = Boolean(adrRaw.limited_quantity);

  const techPart = tech ? (tech.startsWith('(') ? ` ${tech}` : ` (${tech})`) : '';
  const mainTitle = [un, `${name}${techPart}`.trim()].filter(Boolean).join(' - ');
  const tail = [cls, pg && pg !== '-' ? pg : '', tunnel].filter(Boolean).join(', ');
  const base = [mainTitle, tail].filter(Boolean).join(', ');
  return lq && base ? `${base} [LQ - Quantità Limitata]` : base;
}

export function parseAdrData(raw) {
  if (!raw) return null;
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return null; }
  }
  if (!obj || typeof obj !== 'object') return null;
  const res = {
    preset_key: obj.preset_key || 'CUSTOM',
    un_number: obj.un_number || '',
    proper_shipping_name: obj.proper_shipping_name || '',
    technical_name: obj.technical_name || '',
    adr_class: obj.adr_class || '',
    packing_group: obj.packing_group || '',
    tunnel_code: obj.tunnel_code || '',
    limited_quantity: Boolean(obj.limited_quantity),
    custom_full_text: obj.custom_full_text || ''
  };
  res.formatted_description = obj.formatted_description || formatAdrDescription(res);
  return res;
}
