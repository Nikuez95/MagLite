const fs = require('fs');
let code = fs.readFileSync('frontend/src/pages/desktop/Inbound.jsx', 'utf8');

// 1. Initial State
code = code.replace(
  /customer_id: null,\s*product_id: null,/,
  "customer_id: null,\n      product_id: null,\n      isNewProduct: false,\n      newProductName: '',"
);

// 2. Remove handleCreateProduct
const handleCreateProductRegex = /  const handleCreateProduct = async \(inputValue\) => \{[\s\S]*?\}\s*\}\s*};\n\n/m;
code = code.replace(handleCreateProductRegex, '');

// 3. CreatableSelect modifications
const creatableRegex = /<CreatableSelect[\s\S]*?onCreateOption=\{handleCreateProduct\}[\s\S]*?value=\{products\.find\(p => p\.value === formData\.product_id\)\}[\s\S]*?onChange=\{val => \{[\s\S]*?\}\}[\s\S]*?\/>/m;

const newCreatable = `<CreatableSelect 
                  styles={selectStyles}
                  options={filteredProducts}
                  placeholder={formData.customer_id ? "Seleziona o crea..." : "Seleziona prima il cliente"}
                  isDisabled={!formData.customer_id || isProcessing}
                  formatCreateLabel={(val) => \`Crea nuovo per questo cliente: "\${val}"\`}
                  value={formData.isNewProduct ? { label: formData.newProductName, value: formData.product_id } : products.find(p => p.value === formData.product_id)}
                  onChange={val => {
                    if (!val) {
                      setFormData({...formData, product_id: null, isNewProduct: false, newProductName: ''});
                      return;
                    }
                    if (val.__isNew__) {
                      setFormData({
                        ...formData,
                        product_id: 'NEW',
                        isNewProduct: true,
                        newProductName: val.value,
                        units_per_box: '',
                        boxes_per_pallet: ''
                      });
                    } else {
                      const prod = products.find(p => p.value === val.value);
                      setFormData({
                        ...formData, 
                        product_id: val.value,
                        isNewProduct: false,
                        newProductName: '',
                        units_per_box: prod?.raw?.units_per_box || '',
                        boxes_per_pallet: prod?.raw?.boxes_per_pallet || ''
                      });
                    }
                  }}
                />`;
code = code.replace(creatableRegex, newCreatable);

// 4. Modify handleAddToCart
const addToCartTarget = `const handleAddToCart = (e) => {
    e.preventDefault();
    if (!formData.customer_id || !formData.product_id || !formData.quantity || formData.num_pallets < 1) {
      appAlert('Compila tutti i campi obbligatori');
      return;
    }

    const customer = customers.find(c => c.value === formData.customer_id)?.label;
    const productObj = products.find(p => p.value === formData.product_id);
    const product = productObj?.label;`;

const addToCartReplacement = `const handleAddToCart = async (e) => {
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

code = code.replace(addToCartTarget, addToCartReplacement);

// 5. In handleAddToCart, replace all uses of `formData.product_id` with `finalProductId` after this point!
// Actually, `product_id: formData.product_id` is used when pushing to `newItem`:
code = code.replace(/product_id: formData\.product_id,\s*product_name: product,/g, "product_id: finalProductId,\n      product_name: product,");

// 6. Fix the "Reset partial form" in handleAddToCart
const resetFormRegex = /setFormData\(prev => \(\{ \s*\.\.\.prev, \s*quantity: '', \s*entry_uom: 'Base', \s*batch: '', \s*num_pallets: 1, \s*notes: '', \s*client_pallet_number: '', \s*client_article_number: '' \s*\}\)\);/g;
const resetFormReplacement = `setFormData(prev => ({ 
      ...prev, 
      quantity: '', 
      entry_uom: 'Base', 
      batch: '', 
      num_pallets: 1, 
      notes: '', 
      client_pallet_number: '', 
      client_article_number: '',
      isNewProduct: false,
      newProductName: ''
    }));`;
code = code.replace(resetFormRegex, resetFormReplacement);

fs.writeFileSync('frontend/src/pages/desktop/Inbound.jsx', code);
console.log("Done");
