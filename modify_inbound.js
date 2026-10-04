const fs = require('fs');
let code = fs.readFileSync('frontend/src/pages/desktop/Inbound.jsx', 'utf8');

// 1. Add abilitaSpunta state
code = code.replace(
  'const [printOptions, setPrintOptions] = useState({ isMixed: false, noBarcode: false, freeLocation: \'\' });',
  'const [printOptions, setPrintOptions] = useState({ isMixed: false, noBarcode: false, freeLocation: \'\' });\n  const [abilitaSpunta, setAbilitaSpunta] = useState(true);'
);

// 2. Modify handleGenerate
const newHandleGenerate = `
  const handleGenerate = async () => {
    if (cart.length === 0) return;

    if (abilitaSpunta) {
      setIsGenerating(true);
      try {
        const payload = { cart };
        const res = await axios.post(\`http://\${window.location.hostname}:3000/api/inbound/ddt\`, payload, {
          headers: { Authorization: \`Bearer \${getToken()}\` }
        });
        
        appAlert(\`DDT Inbound \${res.data.ddt_number} generato in attesa di spunta!\`);
        
        // Open PDF
        window.open(\`http://\${window.location.hostname}:3000/api/inbound/ddt/\${res.data.ddt_id}/pdf\`, '_blank');
        
        setCart([]);
        setFormData({...formData, customer_id: '', product_id: null, isNewProduct: false, newProductName: ''});
        setPrintOptions({ isMixed: false, noBarcode: false, freeLocation: '' });
      } catch (err) {
        appAlert('Errore durante la creazione del DDT Inbound.');
      } finally {
        setIsGenerating(false);
      }
      return;
    }

    if (printOptions.noBarcode && !printOptions.freeLocation.trim()) {
`;
code = code.replace(
  'const handleGenerate = async () => {\n    if (cart.length === 0) return;\n    if (printOptions.noBarcode && !printOptions.freeLocation.trim()) {',
  newHandleGenerate
);

// 3. Add the UI toggle
const uiToggle = `
                  <div className="mb-6 bg-brand-blue/10 border-2 border-brand-blue/20 rounded-2xl p-4">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={abilitaSpunta} onChange={e => setAbilitaSpunta(e.target.checked)} className="w-6 h-6 rounded bg-slate-900 border-brand-blue text-brand-blue focus:ring-brand-blue focus:ring-offset-slate-900" />
                      <div>
                        <div className="font-bold text-brand-blue text-sm">Abilita Spunta (DDT Entrata)</div>
                        <div className="text-xs text-slate-400">Le palette verranno generate e spuntate dall'operatore con il PDA (Zebra).</div>
                      </div>
                    </label>
                  </div>

                  {!abilitaSpunta && (
                    <>
`;
const closeToggle = `
                    </>
                  )}
                  
                  <button 
`;

// Find where to insert it in Pannello Stampa
code = code.replace(
  '<div className="mb-6 bg-amber-500/10 border-2 border-amber-500/20 rounded-2xl p-4">',
  uiToggle + '<div className="mb-6 bg-amber-500/10 border-2 border-amber-500/20 rounded-2xl p-4">'
);

code = code.replace(
  '                  <button \n                    onClick={handleGenerate}',
  closeToggle + '                  <button \n                    onClick={handleGenerate}'
);

fs.writeFileSync('frontend/src/pages/desktop/Inbound.jsx', code);
console.log("Inbound.jsx modified");
