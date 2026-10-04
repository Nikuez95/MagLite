const fs = require('fs');
const code = fs.readFileSync('src/pages/desktop/Inbound.jsx', 'utf8');

try {
  const babel = require('@babel/parser');
  babel.parse(code, {
    sourceType: 'module',
    plugins: ['jsx']
  });
  console.log("No Babel parse errors");
} catch(e) {
  console.log("Babel parse error:", e.message);
}
