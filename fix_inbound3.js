const fs = require('fs');
let code = fs.readFileSync('frontend/src/pages/desktop/Inbound.jsx', 'utf8');

const regexAddToCart = /const handleAddToCart = \(e\) => \{[\s\S]*?const productObj = products\.find\(p => p\.value === formData\.product_id\);\s*const product = productObj\?\.label;/;
const replacementAddToCart = `const handleAddToCart = async (e) => {
    e.preventDefault();
    if (!formData.customer_id || !formData.product_id || !formData.quantity || formData.num_pallets < 1) {
      appAlert('Compila tutti i campi obbligatori');
      return;
    }

    const customer = customers.find(c => c.value === formData.customer_id)?.label;
    let finalProductId = formData.product_id;
    let finalProductName = '';

    if (formData.isNewProduct) {
      setIsProcessing(true);
      try {
        const sku = "PROD-" + Math.random().toString(36).substring(2,6).toUpperCase();
        let uomToSave = formData.entry_uom;
        if (uomToSave === 'Base') uomToSave = 'Scatole';
        
        const payload = { 
          sku, 
          name: formData.newProductName, 
          uom: uomToSave, 
          customer_id: formData.customer_id,
          units_per_box: parseFloat(formData.units_per_box) || 1,
          boxes_per_pallet: parseFloat(formData.boxes_per_pallet) || 1
        };
        
        const res = await axios.post(\`http://\${window.location.hostname}:3000/api/products\`, payload, { 
          headers: { Authorization: \`Bearer \${getToken()}\` }
        });
        finalProductId = res.data.id;
        finalProductName = \`\${sku} - \${formData.newProductName}\`;
        
        await fetchData(); // refresh products list
      } catch (err) {
        appAlert(err.response?.data?.error || 'Errore creazione prodotto al volo');
        setIsProcessing(false);
        return;
      }
      setIsProcessing(false);
    } else {
      finalProductName = products.find(p => p.value === formData.product_id)?.label;
    }
    const product = finalProductName;`;

code = code.replace(regexAddToCart, replacementAddToCart);
fs.writeFileSync('frontend/src/pages/desktop/Inbound.jsx', code);
console.log(regexAddToCart.test(code) ? "NOT REPLACED" : "REPLACED");
