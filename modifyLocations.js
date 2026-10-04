const fs = require('fs');
let content = fs.readFileSync('frontend/src/pages/desktop/Locations.jsx', 'utf8');

if (!content.includes('const [requirePins')) {
  content = content.replace(
    "const [activeTab, setActiveTab] = useState('mapped');",
    "const [activeTab, setActiveTab] = useState('mapped');\n  const [requirePins, setRequirePins] = useState(true);"
  );
}

const findStr = "const [resLoc, resFree] = await Promise.all([";
if (content.includes(findStr)) {
  content = content.replace(
    findStr + "\n        axios.get(`http://${window.location.hostname}:3000/api/locations`, { headers: { Authorization: `Bearer ${getToken()}` } }),\n        axios.get(`http://${window.location.hostname}:3000/api/locations/free`, { headers: { Authorization: `Bearer ${getToken()}` } })\n      ]);",
    "const [resLoc, resFree, resSettings] = await Promise.all([\n        axios.get(`http://${window.location.hostname}:3000/api/locations`, { headers: { Authorization: `Bearer ${getToken()}` } }),\n        axios.get(`http://${window.location.hostname}:3000/api/locations/free`, { headers: { Authorization: `Bearer ${getToken()}` } }),\n        axios.get(`http://${window.location.hostname}:3000/api/settings`, { headers: { Authorization: `Bearer ${getToken()}` } })\n      ]);\n      if (resSettings.data.require_location_pins) {\n        setRequirePins(resSettings.data.require_location_pins === 'true');\n      }"
  );
}

if (!content.includes('const togglePins')) {
  content = content.replace(
    'const handleBulkGenerate = async (e) => {',
    `const togglePins = async () => {
    const newValue = !requirePins;
    try {
      await axios.post(\`http://\${window.location.hostname}:3000/api/settings\`, { require_location_pins: newValue.toString() }, { headers: { Authorization: \`Bearer \${getToken()}\` } });
      setRequirePins(newValue);
      appAlert(\`Richiesta PIN \${newValue ? 'attivata' : 'disattivata'} con successo!\`, 'Successo', 'success');
    } catch (err) {
      appAlert('Errore nel salvataggio impostazioni');
    }
  };

  const handleBulkGenerate = async (e) => {`
  );
}

if (!content.includes('Richiedi PIN Scaffale (Zebra)')) {
  content = content.replace(
    '<div className="flex gap-2 p-1 bg-slate-900 border border-slate-800 rounded-xl">',
    `<div className="flex items-center gap-4">
            <label className="flex items-center cursor-pointer gap-2 bg-slate-900 border border-slate-800 px-4 py-2 rounded-xl transition-all hover:border-brand-blue">
              <span className="text-sm font-bold text-slate-300">Richiedi PIN Scaffale (Zebra)</span>
              <div className="relative">
                <input type="checkbox" className="sr-only" checked={requirePins} onChange={togglePins} />
                <div className={\`block w-10 h-6 rounded-full transition-colors \${requirePins ? 'bg-brand-blue' : 'bg-slate-700'}\`}></div>
                <div className={\`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform \${requirePins ? 'transform translate-x-4' : ''}\`}></div>
              </div>
            </label>
            <div className="flex gap-2 p-1 bg-slate-900 border border-slate-800 rounded-xl">`
  );
  content = content.replace(
    '</button>\n          </div>\n        </div>',
    '</button>\n          </div>\n          </div>\n        </div>'
  );
}

fs.writeFileSync('frontend/src/pages/desktop/Locations.jsx', content);
