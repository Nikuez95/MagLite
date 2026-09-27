const fs = require('fs');
let code = fs.readFileSync('frontend/src/pages/desktop/Products.jsx', 'utf8');

const stateInjection = `  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  // Paginazione
  const [palletsCurrentPage, setPalletsCurrentPage] = useState(1);
  const [productsCurrentPage, setProductsCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    setPalletsCurrentPage(1);
    setProductsCurrentPage(1);
  }, [searchTerm, filterWarehouse, filterStatus, filterStartDate, filterEndDate]);
`;
code = code.replace(/  const \[filterStartDate, setFilterStartDate\] = useState\(''\);\r?\n  const \[filterEndDate, setFilterEndDate\] = useState\(''\);/, stateInjection);

const paginationComponent = `
const Pagination = ({ currentPage, totalPages, onPageChange }) => {
  if (totalPages <= 1) return null;
  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
      pages.push(i);
    } else if (i === currentPage - 3 || i === currentPage + 3) {
      pages.push('...');
    }
  }
  const uniquePages = pages.filter((p, index) => pages.indexOf(p) === index);

  return (
    <div className="flex items-center justify-center gap-2 mt-6 pb-4">
      <button onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1} className="px-3 py-1.5 bg-slate-900 border border-slate-700 text-slate-400 rounded-lg disabled:opacity-50 hover:bg-slate-800 transition-colors">Prec</button>
      {uniquePages.map((p, idx) => (
        <button key={idx} onClick={() => p !== '...' && onPageChange(p)} disabled={p === '...'} className={\`px-3.5 py-1.5 border rounded-lg transition-colors \${p === currentPage ? 'bg-brand-blue text-brand-black border-brand-blue font-bold shadow-md' : p === '...' ? 'bg-transparent border-transparent text-slate-500' : 'bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white'}\`}>{p}</button>
      ))}
      <button onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages} className="px-3 py-1.5 bg-slate-900 border border-slate-700 text-slate-400 rounded-lg disabled:opacity-50 hover:bg-slate-800 transition-colors">Succ</button>
    </div>
  );
};

const ProductsManagement = () => {`;
code = code.replace(/const ProductsManagement = \(\) => {/, paginationComponent);

const slicingLogic = `
  const indexOfLastPallet = palletsCurrentPage * itemsPerPage;
  const indexOfFirstPallet = indexOfLastPallet - itemsPerPage;
  const currentPallets = filteredPallets.slice(indexOfFirstPallet, indexOfLastPallet);
  const totalPalletPages = Math.ceil(filteredPallets.length / itemsPerPage);

  const indexOfLastProduct = productsCurrentPage * itemsPerPage;
  const indexOfFirstProduct = indexOfLastProduct - itemsPerPage;
  const currentProducts = filteredProducts.slice(indexOfFirstProduct, indexOfLastProduct);
  const totalProductPages = Math.ceil(filteredProducts.length / itemsPerPage);

  return (
`;
code = code.replace(/  return \(\s+<div className="flex-1/, slicingLogic + '  <div className="flex-1');

code = code.replace(/onClick=\{\(\) => toggleSelectAll\(filteredPallets\)\}/g, "onClick={() => toggleSelectAll(currentPallets)}");
code = code.replace(/selectedPallets\.length === filteredPallets\.length/g, "selectedPallets.length > 0 && selectedPallets.length === currentPallets.length");

code = code.replace(/filteredPallets\.map\(/g, "currentPallets.map(");
code = code.replace(/\{filteredPallets\.length === 0 \?/g, "{currentPallets.length === 0 ?");

code = code.replace(/filteredProducts\.map\(/g, "currentProducts.map(");
code = code.replace(/\{filteredProducts\.length === 0 \?/g, "{currentProducts.length === 0 ?");

code = code.replace(/<\/tbody>([\s\S]*?)<\/table>([\s\S]*?)<\/div>([\s\S]*?)\)\s*:\s*\([\s\S]*?<div className="bg-slate-900\/50/, '</tbody>$1</table>\n                    <Pagination currentPage={palletsCurrentPage} totalPages={totalPalletPages} onPageChange={setPalletsCurrentPage} />$2</div>$3) : (\n                  <div className="bg-slate-900/50');
code = code.replace(/<\/tbody>([\s\S]*?)<\/table>([\s\S]*?)<\/div>([\s\S]*?)\)\}[\s\S]*?<\/div>([\s\S]*?)<\/div>([\s\S]*?)<\/div>/, '</tbody>$1</table>\n                    <Pagination currentPage={productsCurrentPage} totalPages={totalProductPages} onPageChange={setProductsCurrentPage} />$2</div>$3)}\n              </div>$4</div>$5</div>');

fs.writeFileSync('frontend/src/pages/desktop/Products.jsx', code);
