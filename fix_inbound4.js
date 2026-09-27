const fs = require('fs');
let code = fs.readFileSync('frontend/src/pages/desktop/Inbound.jsx', 'utf8');

code = code.replace(/product_id: formData\.product_id,\s*product_name: product,/g, "product_id: finalProductId,\n        product_name: product,");

// And also replace `formData.product_id` with `finalProductId` in `products.find` inside renderQuantityHint? 
// Actually renderQuantityHint happens BEFORE adding to cart, so it uses `formData.product_id`, which is 'NEW' if new.
// So `productObj` will be undefined, and it falls back to 'Pezzi' or 'Scatole'.
// Let's modify renderQuantityHint to check if it's new:
const regexHint = /const productObj = products\.find\(p => p\.value === formData\.product_id\);\s*const baseProdUom = productObj\?\.raw\?\.uom \|\| 'Scatole';/;
const replacementHint = `const productObj = products.find(p => p.value === formData.product_id);
    let baseProdUom = productObj?.raw?.uom || 'Scatole';
    if (formData.isNewProduct) {
       // if they leave entry_uom as Base, we'll save it as Scatole anyway.
       // But if they selected something else, base unit shouldn't matter as much because they are defining it.
    }`;
// Not strictly necessary to change renderQuantityHint, it will say "Unita Base (Scatole)" when typing a new product, which is correct because the backend saves it as Scatole if entry_uom is Base.

fs.writeFileSync('frontend/src/pages/desktop/Inbound.jsx', code);
console.log("Done");
