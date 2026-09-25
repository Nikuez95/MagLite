const fs = require('fs');
const path = require('path');

function searchDir(dir) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      searchDir(filePath);
    } else if (filePath.endsWith('.jsx')) {
      const code = fs.readFileSync(filePath, 'utf8');
      const matches = code.match(/className=\{`([^`]+)`\}/g);
      if (matches) {
        matches.forEach(m => {
          if (m.includes('${')) {
               console.log(`${filePath}: ${m}`);
          }
        });
      }
    }
  });
}

searchDir('frontend/src/pages/desktop');
