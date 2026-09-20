const fs = require('fs');
let c = fs.readFileSync('src/zebra/OutboundZebra.jsx', 'utf8');
c = c.replace(/\\`/g, '`');
c = c.replace(/\\\$/g, '$');
c = c.replace(/\\'/g, "'");
fs.writeFileSync('src/zebra/OutboundZebra.jsx', c);
