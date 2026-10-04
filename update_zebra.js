const fs = require('fs');
let code = fs.readFileSync('frontend/src/zebra/ZebraApp.jsx', 'utf8');

// 1. Add import
code = code.replace(
  "import Stow from './Stow';",
  "import Stow from './Stow';\nimport InboundZebra from './InboundZebra';"
);
if (!code.includes("import { PackagePlus, ArrowRightLeft, PackageMinus, LogOut, Scan, Download }")) {
  code = code.replace(
    "import { PackagePlus, ArrowRightLeft, PackageMinus, LogOut, Scan } from 'lucide-react';",
    "import { PackagePlus, ArrowRightLeft, PackageMinus, LogOut, Scan, Download } from 'lucide-react';"
  );
}

// 2. Add button
const button = `
        <div className="grid grid-cols-1 gap-5">
          <TouchButton 
            icon={Download} 
            label="SPUNTA ENTRATA" 
            onClick={() => navigate('/zebra/inbound')} 
          />`;
code = code.replace('<div className="grid grid-cols-1 gap-5">', button);

// 3. Add Route
const route = `
      <Routes>
        <Route path="/inbound" element={<InboundZebra />} />`;
code = code.replace('<Routes>', route);

fs.writeFileSync('frontend/src/zebra/ZebraApp.jsx', code);
console.log("ZebraApp updated");
