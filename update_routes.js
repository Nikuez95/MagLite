const fs = require('fs');

// 1. App.jsx
let appCode = fs.readFileSync('frontend/src/App.jsx', 'utf8');
appCode = appCode.replace(
  "import Inbound from './pages/desktop/Inbound';",
  "import Inbound from './pages/desktop/Inbound';\nimport InboundDDTs from './pages/desktop/InboundDDTs';"
);
appCode = appCode.replace(
  '<Route path="documents" element={<div className="text-3xl font-bold text-brand-white">Fatture e DDT</div>} />',
  '<Route path="documents" element={<InboundDDTs />} />'
);
fs.writeFileSync('frontend/src/App.jsx', appCode);

// 2. DesktopLayout.jsx
let layoutCode = fs.readFileSync('frontend/src/pages/desktop/DesktopLayout.jsx', 'utf8');
layoutCode = layoutCode.replace(
  "{ name: 'Documenti (DDT)', path: '/desktop/documents', icon: FileText },",
  "{ name: 'DDT Entrata (Spunta)', path: '/desktop/documents', icon: FileText },"
);
fs.writeFileSync('frontend/src/pages/desktop/DesktopLayout.jsx', layoutCode);

console.log("App and Layout updated");
