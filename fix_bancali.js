const fs = require('fs');

const updateFile = (path) => {
  let code = fs.readFileSync(path, 'utf8');

  // Fix includes('Bancali') to includes('bancal')
  code = code.replace(/u\.includes\('Bancali'\)/g, "u.includes('bancal')");

  // Fix the ternary condition
  code = code.replace(
    /uom !== 'Scatole' && uom !== 'Bancali' && uom !== 'Bancali'/g,
    "!uom.toLowerCase().includes('scatol') && !uom.toLowerCase().includes('bancal')"
  );

  code = code.replace(
    /p\.uom !== 'Scatole' && p\.uom !== 'Bancali' && p\.uom !== 'Bancali'/g,
    "!(p.uom || '').toLowerCase().includes('scatol') && !(p.uom || '').toLowerCase().includes('bancal')"
  );

  // User specifically wants "Bancali" instead of "Bancali"
  code = code.replace(/return 'Bancali';/g, "return 'Bancali';");

  fs.writeFileSync(path, code);
};

updateFile('frontend/src/pages/desktop/Products.jsx');
updateFile('frontend/src/pages/desktop/Inventory.jsx');
