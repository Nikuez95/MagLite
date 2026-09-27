const fs = require('fs');
let code = fs.readFileSync('frontend/src/pages/desktop/Products.jsx', 'utf8');

let newCode = code.replace(
  /<\/tbody>\s*<\/table>\s*<\/div>\s*\)\s*:\s*activeTab === 'products'/g, 
  '</tbody>\n                  </table>\n                  <Pagination currentPage={palletsCurrentPage} totalPages={totalPalletPages} onPageChange={setPalletsCurrentPage} />\n                </div>\n              ) : activeTab === \'products\''
);

if (newCode === code) {
  // try another regex if it didn't match
  newCode = code.replace(
    /<\/tbody>\s*<\/table>\s*<\/div>\s*\)\s*:\s*\(\s*<div className="bg-slate-900\/50/g,
    '</tbody>\n                  </table>\n                  <Pagination currentPage={palletsCurrentPage} totalPages={totalPalletPages} onPageChange={setPalletsCurrentPage} />\n                </div>\n              ) : (\n                <div className="bg-slate-900/50'
  );
}

fs.writeFileSync('frontend/src/pages/desktop/Products.jsx', newCode);
console.log(newCode === code ? "NOT REPLACED" : "REPLACED");
