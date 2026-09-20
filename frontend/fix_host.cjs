const fs = require('fs');
const path = require('path');

function replaceInFiles(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            replaceInFiles(fullPath);
        } else if (fullPath.endsWith('.jsx') || fullPath.endsWith('.js')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes('http://localhost:3000')) {
                // 1. single quotes
                content = content.replace(/'http:\/\/localhost:3000\/([^']*)'/g, '`http://${window.location.hostname}:3000/$1`');
                content = content.replace(/'http:\/\/localhost:3000'/g, '`http://${window.location.hostname}:3000`');
                
                // 2. double quotes
                content = content.replace(/"http:\/\/localhost:3000\/([^"]*)"/g, '`http://${window.location.hostname}:3000/$1`');
                content = content.replace(/"http:\/\/localhost:3000"/g, '`http://${window.location.hostname}:3000`');
                
                // 3. backticks
                content = content.replace(/http:\/\/localhost:3000/g, 'http://${window.location.hostname}:3000');
                
                fs.writeFileSync(fullPath, content, 'utf8');
                console.log('Updated', fullPath);
            }
        }
    }
}

replaceInFiles(path.join(__dirname, 'src'));
