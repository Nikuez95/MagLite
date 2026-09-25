const fs = require('fs');
let code = fs.readFileSync('frontend/src/pages/desktop/Products.jsx', 'utf8');

// Insert helpers before the component definition
if (!code.includes('const formatUOM')) {
  const helpers = \
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
  const parts = code.split('-');
  if (parts.length >= 3) {
    return parts.slice(2).join('-');
  }
  return code;
};
\;
  code = code.replace('const Products = () => {', helpers + '\nconst Products = () => {');
}

// Fix totalStock
code = code.replace(
  "reduce((acc, curr) => acc + curr.quantity, 0);",
  "reduce((acc, curr) => acc + parseFloat(curr.quantity || 0), 0);"
);

// Fix totalStock rendering
code = code.replace(
  "{totalStock} <span className=\\"text-[10px] text-slate-500 uppercase\\">({p.uom || 'Pezzi'})</span>",
  "{formatQuantity(totalStock, p.uom || 'Pezzi')} <span className=\\"text-[10px] text-slate-500 uppercase\\">({formatUOM(p.uom || 'Pezzi')})</span>"
);

// Fix pallet code rendering in Stock Palette
code = code.replace(
  "<Printer size={12} /> {p.pallet_code}",
  "<Printer size={12} /> {formatPalletCode(p.pallet_code)}"
);

// Fix print button pallet code in modal
code = code.replace(
  ": printModal.code}",
  ": formatPalletCode(printModal.code)}"
);

// Fix quantity rendering in Stock Palette
// Need to find how it's rendered in pallets tab
fs.writeFileSync('frontend/src/pages/desktop/Products.jsx', code);
