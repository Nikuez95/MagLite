const fs = require('fs');

function updateFile(file) {
  let c = fs.readFileSync(file, 'utf8');

  // Add state
  if (!c.includes('const [occupyingPallet')) {
    c = c.replace(
      'const [targetLocation, setTargetLocation] = useState(null);', 
      'const [targetLocation, setTargetLocation] = useState(null);\n  const [occupyingPallet, setOccupyingPallet] = useState(null);'
    );
  }

  // Modify checkOccupiedAndStow
  const oldCheck = `setStatus('WARNING_OCCUPIED');\n        return;\n      }\n    }`;
  const newCheck = `setOccupyingPallet(existingPallets[0]);\n        setStatus('WARNING_OCCUPIED');\n        return;\n      }\n    }`;
  c = c.replace(oldCheck, newCheck);

  // Modify executeStow catch 409
  const old409 = `if (err.response?.status === 409) {\n        setStatus('WARNING_OCCUPIED');`;
  const new409 = `if (err.response?.status === 409) {\n        setOccupyingPallet(err.response.data.occupying_pallet);\n        setStatus('WARNING_OCCUPIED');`;
  c = c.replace(old409, new409);

  // Add executeMerge function
  const executeMergeStr = `
  const executeMerge = async () => {
    try {
      await axios.post(\`http://\${window.location.hostname}:3000/api/pallets/merge\`, {
        source_code: pallet.pallet_code,
        target_code: occupyingPallet
      }, {
        headers: { Authorization: \`Bearer \${getToken()}\` }
      });
      
      await axios.post(\`http://\${window.location.hostname}:3000/api/pallets/stow\`, {
        pallet_code: occupyingPallet,
        location: targetLocation,
        pin: pinInput,
        source: 'Zebra',
        force: true
      }, {
        headers: { Authorization: \`Bearer \${getToken()}\` }
      });

      setStatus('SUCCESS');
      setMessage(\`Unita e Spostata in: \${targetLocation}\`);
      setPallet(null);
      setPinInput('');
      setTargetLocation(null);
      setTimeout(() => setStatus('WAITING_PALLET'), 2000);
    } catch (err) {
      setStatus('ERROR');
      setMessage(err.response?.data?.error || 'Errore durante frammentazione');
      setTimeout(() => {
        setPinInput('');
        if (requirePins) setStatus('WAITING_PIN');
        else setStatus('SELECT_ZONE');
      }, 3000);
    }
  };
`;
  if (!c.includes('const executeMerge')) {
    c = c.replace('const executeStow = async', executeMergeStr + '\n  const executeStow = async');
  }

  // Modify WARNING_OCCUPIED screen
  const warnStr = `La posizione <span className="text-white bg-rose-900/50 px-2 py-1 rounded mx-1">{targetLocation}</span> è già occupata.`;
  const warnStrNew = `La posizione <span className="text-white bg-rose-900/50 px-2 py-1 rounded mx-1">{targetLocation}</span> è già occupata dalla paletta <span className="text-white font-mono bg-amber-900/80 px-2 py-1 rounded mx-1">{occupyingPallet}</span>.`;
  c = c.replace(warnStr, warnStrNew);

  const btnStr = `<button 
            onClick={() => executeStow(targetLocation, pinInput, true)}
            className="w-full py-4 bg-rose-600 text-white text-xl font-black rounded-2xl active:bg-rose-500 mb-4"
          >
            FORZA COMUNQUE
          </button>`;
  const btnStrNew = `<button 
            onClick={executeMerge}
            className="w-full py-4 bg-amber-500 text-amber-950 text-xl font-black rounded-2xl active:bg-amber-400 mb-3 shadow-[0_0_15px_rgba(245,158,11,0.3)]"
          >
            UNISCI / FRAMMENTA
          </button>
          
          <button 
            onClick={() => executeStow(targetLocation, pinInput, true)}
            className="w-full py-4 bg-rose-600 text-white text-xl font-black rounded-2xl active:bg-rose-500 mb-3"
          >
            FORZA COMUNQUE
          </button>`;
  c = c.replace(btnStr, btnStrNew);

  fs.writeFileSync(file, c);
}

updateFile('frontend/src/zebra/Handling.jsx');
updateFile('frontend/src/zebra/Stow.jsx');
