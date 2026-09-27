const fs = require('fs');
let code = fs.readFileSync('frontend/src/pages/desktop/Products.jsx', 'utf8');

// The messed up part is:
// </tbody></table>
//                     <Pagination currentPage={palletsCurrentPage} totalPages={totalPalletPages} onPageChange={setPalletsCurrentPage} /></div>) : (
//                   <div className="bg-slate-900/50
// And:
// </tbody></table>
//                     <Pagination currentPage={productsCurrentPage} totalPages={totalProductPages} onPageChange={setProductsCurrentPage} /></div>)}
//               </div></div></div>

// Wait, looking at the code I applied:
// code.replace(/<\/tbody>([\s\S]*?)<\/table>([\s\S]*?)<\/div>([\s\S]*?)\)\s*:\s*\([\s\S]*?<div className="bg-slate-900\/50/, '</tbody>$1</table>\n                    <Pagination currentPage={palletsCurrentPage} totalPages={totalPalletPages} onPageChange={setPalletsCurrentPage} />$2</div>$3) : (\n                  <div className="bg-slate-900/50');
// BUT IT DIDN'T WORK! The log said NOT REPLACED for pallets when I checked it, and indeed the pallets table was intact.
// Did the products one match? Let's check!
console.log(code.includes("<Pagination currentPage={palletsCurrentPage}"));
console.log(code.includes("<Pagination currentPage={productsCurrentPage}"));
