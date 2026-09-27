const fs = require('fs');
let code = fs.readFileSync('frontend/src/pages/desktop/Products.jsx', 'utf8');

const regex = /<input required value=\{newProduct\.sku\} onChange=\{e => setNewProduct\(\{\.\.\.newProduct, sku: e\.target\.value\}\)\}\s*<\/div>/;
const replacement = `<input required value={newProduct.sku} onChange={e => setNewProduct({...newProduct, sku: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue" />
                </div>`;

code = code.replace(regex, replacement);
fs.writeFileSync('frontend/src/pages/desktop/Products.jsx', code);
console.log(regex.test(fs.readFileSync('frontend/src/pages/desktop/Products.jsx', 'utf8')));
