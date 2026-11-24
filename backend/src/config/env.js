const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const BACKEND_DIR = path.resolve(__dirname, '..', '..');
const ROOT_DIR = path.resolve(BACKEND_DIR, '..');
const ENV_PATH = path.join(BACKEND_DIR, '.env');

// Carica .env cercando in backend/.env, root/.env e CWD/.env (senza sovrascrivere env di sistema/Docker)
for (const candidate of [ENV_PATH, path.join(ROOT_DIR, '.env'), path.resolve(process.cwd(), '.env')]) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
  }
}

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
