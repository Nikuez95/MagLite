const fs = require('fs');
let c = fs.readFileSync('frontend/src/pages/desktop/Locations.jsx', 'utf8');

const target = `const [resLoc, resFree] = await Promise.all([
        axios.get(\`http://\${window.location.hostname}:3000/api/locations\`, { headers: { Authorization: \`Bearer \${getToken()}\` } }),
        axios.get(\`http://\${window.location.hostname}:3000/api/locations/free\`, { headers: { Authorization: \`Bearer \${getToken()}\` } })
      ]);
      setLocations(resLoc.data);
      setFreeLocations(resFree.data);`.replace(/\r\n/g, '\n');

const replacement = `const [resLoc, resFree, resSettings] = await Promise.all([
        axios.get(\`http://\${window.location.hostname}:3000/api/locations\`, { headers: { Authorization: \`Bearer \${getToken()}\` } }),
        axios.get(\`http://\${window.location.hostname}:3000/api/locations/free\`, { headers: { Authorization: \`Bearer \${getToken()}\` } }),
        axios.get(\`http://\${window.location.hostname}:3000/api/settings\`, { headers: { Authorization: \`Bearer \${getToken()}\` } })
      ]);
      setLocations(resLoc.data);
      setFreeLocations(resFree.data);
      if (resSettings.data && resSettings.data.require_location_pins !== undefined) {
        setRequirePins(resSettings.data.require_location_pins === 'true');
      }`.replace(/\r\n/g, '\n');

// Convert content to \n before replacing to be safe
c = c.replace(/\r\n/g, '\n');
c = c.replace(target, replacement);

fs.writeFileSync('frontend/src/pages/desktop/Locations.jsx', c);
