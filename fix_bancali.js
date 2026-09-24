const fs = require('fs');

const updateFile = (path) => {
  let code = fs.readFileSync(path, 'utf8');

  // Fix includes('bancale') to includes('bancal')
  code = code.replace(/u\.includes\('bancale'\)/g, "u.includes('bancal')");

  // Fix the ternary condition
  code = code.replace(
    /uom !== 'Scatole' && uom !== 'Bancali' && uom !== 'Bancale'/g,
    "!uom.toLowerCase().includes('scatol') && !uom.toLowerCase().includes('bancal')"
  );

  code = code.replace(
    /p\.uom !== 'Scatole' && p\.uom !== 'Bancali' && p\.uom !== 'Bancale'/g,
    "!(p.uom || '').toLowerCase().includes('scatol') && !(p.uom || '').toLowerCase().includes('bancal')"
  );

  // User specifically wants "Bancale" instead of "Bancali"
  code = code.replace(/return 'Bancali';/g, "return 'Bancale';");

  fs.writeFileSync(path, code);
};

updateFile('frontend/src/pages/desktop/Products.jsx');
updateFile('frontend/src/pages/desktop/Inventory.jsx');
