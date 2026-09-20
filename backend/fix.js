const fs = require('fs');
let c = fs.readFileSync('src/routes/outbound.js', 'utf8');
c = c.replace(/\\`/g, '`');
c = c.replace(/\\\$/g, '$');
c = c.replace(/\\'/g, "'");
fs.writeFileSync('src/routes/outbound.js', c);
