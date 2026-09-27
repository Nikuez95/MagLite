const fs = require('fs');
let code = fs.readFileSync('frontend/src/pages/desktop/Inventory.jsx', 'utf8');

if (!code.includes('const formatUOM')) {
  const helpers = `
const formatUOM = (uom) => {
  const u = (uom || '').toLowerCase();
  if (u.includes('Bancali')) return 'Bancali';
  if (u === 'kg') return 'KG';
  if (u.includes('metr')) return 'Metri Cubi';
  if (u === 'scatole') return 'Scatole';
  if (u === 'pezzi') return 'Pezzi';
  return uom;
};

const formatQuantity = (qty, uom) => {
  const q = parseFloat(qty || 0);
  const u = (uom || '').toLowerCase();
  if (u.includes('pezzi') || u.includes('scatole') || u.includes('Bancali')) {
    return q.toFixed(0);
  }
  return q.toFixed(2);
};

const formatPalletCode = (code) => {
  if (!code) return '';
  if (code === 'MULTIPLI' || code.includes('Palette')) return code;
  const parts = code.split('-');
  if (parts.length >= 3) {
    return parts.slice(2).join('-');
  }
  return code;
};
`;
  code = code.replace('const Inventory = () => {', helpers + '\nconst Inventory = () => {');
}

// 1. pallet_code rendering
code = code.replace(
  '<span className="font-mono text-sm text-brand-blue font-bold whitespace-nowrap">{row.pallet_code}</span>',
  '<span className="font-mono text-sm text-brand-blue font-bold whitespace-nowrap">{formatPalletCode(row.pallet_code)}</span>'
);

// 2. format uom in quantity display
code = code.replace(
  '<span className="font-bold text-brand-blue text-lg">{qty}</span>',
  '<span className="font-bold text-brand-blue text-lg">{formatQuantity(qty, uom)}</span>'
);
code = code.replace(
  '<span className="text-[10px] text-slate-500 uppercase">{uom || \'Pezzi\'}</span>',
  '<span className="text-[10px] text-slate-500 uppercase">{formatUOM(uom || \'Pezzi\')}</span>'
);

// Also replace simple ones
code = code.replace(
  "return `${row.quantity} ${row.uom}`;",
  "return `${formatQuantity(row.quantity, row.uom)} ${formatUOM(row.uom)}`;"
);

fs.writeFileSync('frontend/src/pages/desktop/Inventory.jsx', code);
