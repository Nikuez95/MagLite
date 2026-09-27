const fs = require('fs');
let code = fs.readFileSync('frontend/src/pages/desktop/Inbound.jsx', 'utf8');

const regexReset = /setFormData\(prev => \(\{\s*\.\.\.prev,\s*quantity: '',\s*entry_uom: 'Base',\s*batch: '',\s*num_pallets: 1,\s*notes: '',\s*client_pallet_number: '',\s*client_article_number: '',\s*expiration_date: '',\s*arrival_date: new Date.*?slice\(0, 16\)\s*\}\)\);/g;

const replacementReset = `setFormData(prev => ({ 
      ...prev, 
      quantity: '', 
      entry_uom: 'Base', 
      batch: '', 
      num_pallets: 1, 
      notes: '', 
      client_pallet_number: '', 
      client_article_number: '', 
      expiration_date: '',
      arrival_date: new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16),
      isNewProduct: false,
      newProductName: ''
    }));`;

code = code.replace(regexReset, replacementReset);
fs.writeFileSync('frontend/src/pages/desktop/Inbound.jsx', code);
console.log(regexReset.test(fs.readFileSync('frontend/src/pages/desktop/Inbound.jsx', 'utf8')));
