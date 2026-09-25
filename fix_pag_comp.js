const fs = require('fs');
let code = fs.readFileSync('frontend/src/pages/desktop/Products.jsx', 'utf8');

const target = `<Pagination currentPage={productsCurrentPage} totalPages={totalProductPages} onPageChange={setProductsCurrentPage} />`;
const replacement = `{activeTab === 'pallets' ? (
              <Pagination currentPage={palletsCurrentPage} totalPages={totalPalletPages} onPageChange={setPalletsCurrentPage} />
            ) : (
              <Pagination currentPage={productsCurrentPage} totalPages={totalProductPages} onPageChange={setProductsCurrentPage} />
            )}`;

code = code.replace(target, replacement);

// Wait, looking at currentPallets mapping:
// Is it rendering currentPallets or filteredPallets?
// Let's replace filteredPallets.map(p => ( ... )) with currentPallets.map if it wasn't already.
// I already did: code = code.replace(/filteredPallets\.map\(/g, "currentPallets.map(");
// And code = code.replace(/\{filteredPallets\.length === 0 \?/g, "{currentPallets.length === 0 ?");
// Let's check if it's there.
fs.writeFileSync('frontend/src/pages/desktop/Products.jsx', code);
console.log("Fixed Pagination component placement");
