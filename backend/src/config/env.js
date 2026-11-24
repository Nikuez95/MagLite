const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const BACKEND_DIR = path.resolve(__dirname, '..', '..');
const ENV_PATH = path.join(BACKEND_DIR, '.env');

// Carica sempre MagLite/backend/.env indipendentemente dalla working directory
dotenv.config({ path: ENV_PATH });

function formatEnvValue(val) {
  const s = String(val ?? '');
  if (!s) return '';
  if (/[\s#"']/.test(s)) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

/**
 * Aggiorna in sicurezza una o più variabili dentro backend/.env e in process.env.
 */
function updateEnvVars(updates = {}) {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const lines = content ? content.split(/\r?\n/) : [];
  const handled = new Set();

  const updatedLines = lines.map(line => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!m) return line;
    const key = m[1];
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      handled.add(key);
      const val = updates[key];
      process.env[key] = val == null ? '' : String(val);
      return `${key}=${formatEnvValue(process.env[key])}`;
    }
    return line;
  });

  for (const [key, rawVal] of Object.entries(updates)) {
    if (handled.has(key)) continue;
    const val = rawVal == null ? '' : String(rawVal);
    process.env[key] = val;
    updatedLines.push(`${key}=${formatEnvValue(val)}`);
  }

  const finalContent = updatedLines.join('\n').replace(/\n+$/, '') + '\n';
  fs.writeFileSync(ENV_PATH, finalContent, { encoding: 'utf8', mode: 0o600 });
  return ENV_PATH;
}

module.exports = {
  ENV_PATH,
  updateEnvVars
};
