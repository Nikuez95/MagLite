const fs = require('fs');
let code = fs.readFileSync('frontend/src/pages/desktop/Inbound.jsx', 'utf8');

// 1. Initial State
code = code.replace(
  /customer_id: null,\s*product_id: null,/,
  "customer_id: null,\n      product_id: null,\n      isNewProduct: false,\n      newProductName: '',"
);

// 2. handleCreateProduct (REMOVE IT ENTIRELY)
// The function goes from `const handleCreateProduct = async` to the closing `};` before `const handleAddToCart`
code = code.replace(
  /const handleCreateProduct = async \(inputValue\) => \{[\s\S]*?\}\s*catch \(err\) \{[\s\S]*?setIsProcessing\(false\);\s*\}\s*setIsProcessing\(false\);\s*\};\s*const handleAddToCart/m,
  "const handleAddToCart"
);

// Wait, the previous task modified `handleCreateProduct` with `appPrompt`.
// Let's use a more robust regex or just find the block to replace.
