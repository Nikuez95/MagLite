const path = require('path');
const zlib = require('zlib');
const { PassThrough, Readable } = require('stream');
const SftpClient = require('ssh2-sftp-client');

const posixPath = path.posix;

const DEFAULT_IDLE_TIMEOUT_MS = 15000;
const DEFAULT_CONNECT_TIMEOUT_MS = 12000;

/**
 * Legge e valida la configurazione SFTP dalle variabili d'ambiente (.env).
 */
function getSftpConfig({ requireConfigured = true } = {}) {
  const driver = String(process.env.STORAGE_DRIVER || 'sftp').trim().toLowerCase();
  const host = String(process.env.NAS_SFTP_HOST || '').trim();
  const portRaw = String(process.env.NAS_SFTP_PORT || '22').trim();
  const port = parseInt(portRaw, 10);
  const username = String(process.env.NAS_SFTP_USER || '').trim();
  const password = String(process.env.NAS_SFTP_PASSWORD || '');
  const rawBasePath = String(process.env.NAS_SFTP_BASE_PATH || '').trim();
  const basePath = rawBasePath ? posixPath.normalize(rawBasePath).replace(/\/+$/, '') || '/' : '';
  const idleTimeoutMs = Math.max(3000, parseInt(process.env.NAS_SFTP_IDLE_TIMEOUT_MS || DEFAULT_IDLE_TIMEOUT_MS, 10) || DEFAULT_IDLE_TIMEOUT_MS);
  const readyTimeout = Math.max(3000, parseInt(process.env.NAS_SFTP_TIMEOUT_MS || DEFAULT_CONNECT_TIMEOUT_MS, 10) || DEFAULT_CONNECT_TIMEOUT_MS);

  const missing = [];
  if (driver !== 'sftp') missing.push('STORAGE_DRIVER=sftp');
  if (!host) missing.push('NAS_SFTP_HOST');
  if (!Number.isFinite(port) || port <= 0 || port > 65535) missing.push('NAS_SFTP_PORT');
  if (!username) missing.push('NAS_SFTP_USER');
  if (!password) missing.push('NAS_SFTP_PASSWORD');
  if (!basePath || !basePath.startsWith('/')) missing.push('NAS_SFTP_BASE_PATH (deve iniziare con /)');

  if (requireConfigured && missing.length > 0) {
    const err = new Error(`Configurazione storage SFTP non valida o incompleta in .env (${missing.join(', ')})`);
    err.statusCode = 500;
    err.code = 'SFTP_CONFIG_INVALID';
    throw err;
  }

  return {
    driver,
    host,
    port: Number.isFinite(port) && port > 0 ? port : 22,
    username,
    password,
    basePath,
    idleTimeoutMs,
    readyTimeout,
    isConfigured: missing.length === 0,
    missing
  };
}

/**
 * Converte e valida un percorso relativo all'interno di NAS_SFTP_BASE_PATH, prevenendo path traversal.
 */
function resolveRemotePath(relativePath, basePath = null) {
  const cfg = basePath ? { basePath: posixPath.normalize(basePath).replace(/\/+$/, '') || '/' } : getSftpConfig();
  const cleanRel = String(relativePath || '')
    .replace(/\\/g, '/')
    .replace(/\0/g, '')
    .replace(/^\/+/, '');

  if (!cleanRel) {
    const err = new Error('Percorso file relativo non specificato.');
    err.statusCode = 400;
    throw err;
  }

  const segments = cleanRel.split('/').filter(Boolean);
  if (segments.length === 0 || segments.some(seg => seg === '.' || seg === '..')) {
    const err = new Error('Percorso file non valido (rilevato path traversal).');
    err.statusCode = 400;
    throw err;
  }

  const safeRelative = segments.join('/');
  const remotePath = posixPath.join(cfg.basePath, safeRelative);

  const expectedPrefix = cfg.basePath === '/' ? '/' : `${cfg.basePath}/`;
  if (remotePath !== cfg.basePath && !remotePath.startsWith(expectedPrefix)) {
    const err = new Error('Percorso file fuori dalla directory base consentita.');
    err.statusCode = 400;
    throw err;
  }

  return { safeRelative, remotePath };
}

function isReadableStream(obj) {
  return Boolean(obj && typeof obj === 'object' && typeof obj.pipe === 'function');
}

async function streamToBuffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function isTransportOrSocketError(err) {
  if (!err) return false;
  const code = String(err.code || '').toUpperCase();
  const msg = String(err.message || '').toLowerCase();
  return (
    ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'ERR_NOT_CONNECTED', 'ECONNABORTED'].includes(code) ||
    msg.includes('no sftp connection') ||
    msg.includes('not connected') ||
    msg.includes('channel open failure') ||
    msg.includes('timed out') ||
    msg.includes('socket') ||
    msg.includes('connection closed')
  );
}

function normalizeSftpError(err, actionLabel = 'operazione SFTP') {
  if (!err) return new Error(`Errore sconosciuto durante ${actionLabel}`);
  if (err.statusCode && err.isNormalizedSftpError) return err;

  const code = String(err.code || '').toUpperCase();
  const msg = String(err.message || '');
  const lower = msg.toLowerCase();

  let statusCode = err.statusCode || 502;
  let friendly = msg;

  if (code === 'ENOENT' || code === 2 || lower.includes('no such file')) {
    statusCode = 404;
    friendly = 'File non trovato sullo storage NAS.';
  } else if (lower.includes('authentication') || lower.includes('all configured authentication methods failed') || code === 'EACCES') {
    statusCode = 502;
    friendly = 'Autenticazione SFTP fallita verso il NAS: verifica NAS_SFTP_USER e NAS_SFTP_PASSWORD in .env.';
  } else if (['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND'].includes(code) || lower.includes('timed out')) {
    statusCode = 503;
    friendly = `NAS SFTP temporaneamente irraggiungibile (${code || 'timeout'}): verifica host/porta e stato di rete del WD My Cloud.`;
  } else if (err.code === 'SFTP_CONFIG_INVALID') {
    statusCode = 500;
  } else if (statusCode < 400) {
    statusCode = 502;
  }

  const wrapped = new Error(friendly);
  wrapped.statusCode = statusCode;
  wrapped.code = err.code || 'SFTP_ERROR';
  wrapped.cause = err;
  wrapped.isNormalizedSftpError = true;
  return wrapped;
}

class SftpStorageService {
  constructor() {
    this._client = null;
    this._connectPromise = null;
    this._idleTimer = null;
    this._activeLeases = 0;
    this._ensuredDirs = new Set();
    this._lastConfigSignature = '';
  }

  _clearIdleTimer() {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  }

  _scheduleIdleClose(logger) {
    this._clearIdleTimer();
    if (this._activeLeases > 0 || !this._client) return;
    let idleMs = DEFAULT_IDLE_TIMEOUT_MS;
    try {
      idleMs = getSftpConfig({ requireConfigured: false }).idleTimeoutMs;
    } catch (_) {}

    this._idleTimer = setTimeout(() => {
      if (this._activeLeases === 0 && this._client) {
        this._disconnect(logger, 'timeout inattività socket').catch(() => {});
      }
    }, idleMs);
    if (typeof this._idleTimer.unref === 'function') {
      this._idleTimer.unref();
    }
  }

  async _disconnect(logger = console, reason = 'chiusura') {
    this._clearIdleTimer();
    this._ensuredDirs.clear();
    const client = this._client;
    this._client = null;
    if (!client) return;
    try {
      await client.end();
      logger?.info?.(`[SFTP NAS] Connessione SFTP chiusa (${reason}).`);
    } catch (err) {
      logger?.warn?.(`[SFTP NAS] Avviso durante chiusura connessione (${reason}): ${err.message}`);
    }
  }

  async _ensureConnected(logger = console) {
    const cfg = getSftpConfig({ requireConfigured: true });
    const sig = `${cfg.host}:${cfg.port}:${cfg.username}:${cfg.basePath}`;

    if (this._client && this._lastConfigSignature && this._lastConfigSignature !== sig) {
      await this._disconnect(logger, 'cambio configurazione');
    }

    if (this._client && this._client.sftp) {
      return { client: this._client, cfg };
    }

    if (this._connectPromise) {
      return this._connectPromise;
    }

    this._connectPromise = (async () => {
      const client = new SftpClient('maglite-nas-sftp');
      const onError = (err) => {
        logger?.error?.({ err }, `[SFTP NAS] Errore socket SSH/SFTP (${cfg.host}:${cfg.port})`);
        this._ensuredDirs.clear();
        if (this._client === client) {
          this._client = null;
        }
      };
      const onClose = () => {
        logger?.debug?.(`[SFTP NAS] Socket SSH/SFTP terminato (${cfg.host}:${cfg.port}).`);
        this._ensuredDirs.clear();
        if (this._client === client) {
          this._client = null;
        }
      };
      client.on('error', onError);
      client.on('close', onClose);
      client.on('end', onClose);

      try {
        logger?.info?.(`[SFTP NAS] Connessione verso ${cfg.host}:${cfg.port} (utente: ${cfg.username})...`);
        await client.connect({
          host: cfg.host,
          port: cfg.port,
          username: cfg.username,
          password: cfg.password,
          readyTimeout: cfg.readyTimeout,
          keepaliveInterval: 10000,
          keepaliveCountMax: 3,
          retries: 1,
          retry_minTimeout: 400
        });
        this._client = client;
        this._lastConfigSignature = sig;
        logger?.info?.(`[SFTP NAS] Connessione SFTP stabilita con ${cfg.host}:${cfg.port}.`);
        return { client, cfg };
      } catch (err) {
        try { await client.end(); } catch (_) {}
        logger?.error?.({ err }, `[SFTP NAS] Connessione SFTP fallita verso ${cfg.host}:${cfg.port}`);
        throw normalizeSftpError(err, 'connessione SFTP');
      } finally {
        this._connectPromise = null;
      }
    })();

    return this._connectPromise;
  }

  /**
   * Acquisisce una connessione SFTP attiva con lease tracking e riconnessione automatica su socket scaduto.
   */
  async _withClient(operation, { logger = console, actionLabel = 'operazione SFTP', retryOnTransportError = true } = {}) {
    this._clearIdleTimer();
    this._activeLeases += 1;
    try {
      const { client, cfg } = await this._ensureConnected(logger);
      try {
        return await operation(client, cfg);
      } catch (err) {
        if (retryOnTransportError && isTransportOrSocketError(err)) {
          logger?.warn?.(`[SFTP NAS] Socket SFTP instabile durante ${actionLabel}, tentativo di riconnessione: ${err.message}`);
          await this._disconnect(logger, 'riconnessione dopo errore trasporto');
          const { client: freshClient, cfg: freshCfg } = await this._ensureConnected(logger);
          return await operation(freshClient, freshCfg);
        }
        throw err;
      }
    } catch (err) {
      const normalized = normalizeSftpError(err, actionLabel);
      logger?.error?.({ err: normalized.cause || normalized, code: normalized.code }, `[SFTP NAS] Fallimento ${actionLabel}: ${normalized.message}`);
      throw normalized;
    } finally {
      this._activeLeases = Math.max(0, this._activeLeases - 1);
      this._scheduleIdleClose(logger);
    }
  }

  async _ensureDirectory(client, dirPath, logger = console) {
    const cleanDir = posixPath.normalize(dirPath).replace(/\/+$/, '') || '/';
    if (cleanDir === '/' || this._ensuredDirs.has(cleanDir)) return;
    await client.mkdir(cleanDir, true);
    this._ensuredDirs.add(cleanDir);
    logger?.debug?.(`[SFTP NAS] Directory verificata/creata: ${cleanDir}`);
  }

  /**
   * Carica un file sul NAS (accetta Buffer o ReadableStream) creando automaticamente le sottocartelle.
   */
  async uploadFile(relativePath, dataOrStream, { compress = false, logger = console } = {}) {
    const cfgCheck = getSftpConfig({ requireConfigured: true });
    const { safeRelative, remotePath } = resolveRemotePath(relativePath, cfgCheck.basePath);
    const parentDir = posixPath.dirname(remotePath);

    let payloadInput = dataOrStream;
    let originalSize = 0;

    if (Buffer.isBuffer(dataOrStream)) {
      originalSize = dataOrStream.length;
    } else if (isReadableStream(dataOrStream)) {
      if (compress) {
        const rawBuf = await streamToBuffer(dataOrStream);
        originalSize = rawBuf.length;
        payloadInput = rawBuf;
      }
    } else if (typeof dataOrStream === 'string' || dataOrStream instanceof Uint8Array) {
      payloadInput = Buffer.from(dataOrStream);
      originalSize = payloadInput.length;
    } else {
      const err = new Error('Input upload non valido: atteso Buffer o ReadableStream.');
      err.statusCode = 400;
      throw err;
    }

    let compression = 'none';
    let storedSize = originalSize;
    let finalPayload = payloadInput;

    if (compress && Buffer.isBuffer(payloadInput)) {
      finalPayload = zlib.gzipSync(payloadInput, { level: 9 });
      compression = 'gzip';
      storedSize = finalPayload.length;
    }

    // Stream upload diretto: se Buffer -> passiamo Buffer; se ReadableStream non compresso -> tracciamo i byte passanti via PassThrough
    let countedStreamBytes = 0;
    if (!Buffer.isBuffer(finalPayload) && isReadableStream(finalPayload)) {
      const tracker = new PassThrough();
      finalPayload.on('data', chunk => {
        countedStreamBytes += chunk.length;
      });
      finalPayload.on('error', err => tracker.destroy(err));
      finalPayload.pipe(tracker);
      finalPayload = tracker;
    }

    // Gli stream non sono riavvolgibili in caso di retry trasporto: disabilita retry automatico per ReadableStream
    const canRetry = Buffer.isBuffer(finalPayload);

    await this._withClient(
      async (client) => {
        await this._ensureDirectory(client, parentDir, logger);
        await client.put(finalPayload, remotePath);
        if (!Buffer.isBuffer(finalPayload)) {
          originalSize = countedStreamBytes;
          storedSize = countedStreamBytes;
        }
        logger?.info?.(`[SFTP NAS] Upload completato: ${remotePath} (${storedSize} bytes, compression=${compression})`);
      },
      { logger, actionLabel: `upload "${safeRelative}"`, retryOnTransportError: canRetry }
    );

    return {
      driver: 'sftp',
      storagePath: safeRelative,
      remotePath,
      compression,
      originalSize,
      storedSize
    };
  }

  /**
   * Recupera un file dal NAS come Buffer (decomprime automaticamente se archiviato con gzip legacy).
   */
  async getFileBuffer(relativePath, { compression = 'none', logger = console } = {}) {
    const cfgCheck = getSftpConfig({ requireConfigured: true });
    const { safeRelative, remotePath } = resolveRemotePath(relativePath, cfgCheck.basePath);

    const buf = await this._withClient(
      async (client) => {
        const result = await client.get(remotePath);
        return Buffer.isBuffer(result) ? result : Buffer.from(result);
      },
      { logger, actionLabel: `lettura buffer "${safeRelative}"` }
    );

    if (compression === 'gzip') {
      return zlib.gunzipSync(buf);
    }
    return buf;
  }

  /**
   * Restituisce uno stream leggibile dal NAS SFTP mantenendo attiva la lease SFTP fino a fine trasferimento HTTP.
   */
  async getFileStream(relativePath, { compression = 'none', logger = console } = {}) {
    const cfgCheck = getSftpConfig({ requireConfigured: true });
    const { safeRelative, remotePath } = resolveRemotePath(relativePath, cfgCheck.basePath);

    this._clearIdleTimer();
    this._activeLeases += 1;

    let released = false;
    const releaseLease = () => {
      if (released) return;
      released = true;
      this._activeLeases = Math.max(0, this._activeLeases - 1);
      this._scheduleIdleClose(logger);
    };

    try {
      let conn = await this._ensureConnected(logger);
      let stats;
      try {
        stats = await conn.client.stat(remotePath);
      } catch (statErr) {
        if (isTransportOrSocketError(statErr)) {
          logger?.warn?.(`[SFTP NAS] Socket instabile in stat("${safeRelative}"), riconnessione...`);
          await this._disconnect(logger, 'riconnessione stat');
          conn = await this._ensureConnected(logger);
          stats = await conn.client.stat(remotePath);
        } else {
          throw statErr;
        }
      }

      const rawReadStream = conn.client.createReadStream(remotePath, {
        autoClose: true,
        encoding: null
      });

      rawReadStream.once('end', releaseLease);
      rawReadStream.once('close', releaseLease);
      rawReadStream.once('error', (streamErr) => {
        logger?.error?.({ err: streamErr }, `[SFTP NAS] Errore stream lettura "${safeRelative}"`);
        releaseLease();
      });

      let outputStream = rawReadStream;
      if (compression === 'gzip') {
        const gunzip = zlib.createGunzip();
        rawReadStream.on('error', err => gunzip.destroy(err));
        outputStream = rawReadStream.pipe(gunzip);
        outputStream.once('close', () => {
          try { rawReadStream.destroy(); } catch (_) {}
          releaseLease();
        });
      }

      logger?.info?.(`[SFTP NAS] Streaming avviato: ${remotePath} (size=${stats?.size ?? 'unknown'})`);

      return {
        stream: outputStream,
        rawStream: rawReadStream,
        size: compression === 'gzip' ? null : (Number(stats?.size) || null),
        remotePath,
        storagePath: safeRelative
      };
    } catch (err) {
      releaseLease();
      const normalized = normalizeSftpError(err, `streaming "${safeRelative}"`);
      logger?.error?.({ err: normalized.cause || normalized }, `[SFTP NAS] Impossibile avviare stream "${safeRelative}": ${normalized.message}`);
      throw normalized;
    }
  }

  /**
   * Elimina un file dal NAS SFTP (ignora con sicurezza se il file non esiste più).
   */
  async deleteFile(relativePath, { logger = console } = {}) {
    if (!relativePath) return false;
    const cfgCheck = getSftpConfig({ requireConfigured: true });
    const { safeRelative, remotePath } = resolveRemotePath(relativePath, cfgCheck.basePath);

    return this._withClient(
      async (client) => {
        try {
          await client.delete(remotePath, true);
          logger?.info?.(`[SFTP NAS] File eliminato: ${remotePath}`);
          return true;
        } catch (err) {
          if (err?.code === 'ENOENT' || err?.code === 2 || String(err?.message || '').toLowerCase().includes('no such file')) {
            logger?.warn?.(`[SFTP NAS] File già assente durante eliminazione: ${remotePath}`);
            return false;
          }
          throw err;
        }
      },
      { logger, actionLabel: `eliminazione "${safeRelative}"` }
    );
  }

  async statFile(relativePath, { logger = console } = {}) {
    const cfgCheck = getSftpConfig({ requireConfigured: true });
    const { remotePath } = resolveRemotePath(relativePath, cfgCheck.basePath);
    return this._withClient(
      async (client) => client.stat(remotePath),
      { logger, actionLabel: `stat "${relativePath}"` }
    );
  }

  /**
   * Verifica configurazione, raggiungibilità NAS SFTP e presenza directory base NAS_SFTP_BASE_PATH.
   */
  async checkConnectionStatus({ logger = console } = {}) {
    const cfg = getSftpConfig({ requireConfigured: false });
    if (!cfg.isConfigured) {
      return {
        configured: false,
        connected: false,
        driver: cfg.driver,
        host: cfg.host || null,
        port: cfg.port,
        basePath: cfg.basePath || null,
        error: `Configurazione incompleta: ${cfg.missing.join(', ')}`
      };
    }

    try {
      await this._withClient(
        async (client) => {
          await this._ensureDirectory(client, cfg.basePath, logger);
        },
        { logger, actionLabel: 'verifica connessione NAS SFTP' }
      );
      return {
        configured: true,
        connected: true,
        driver: cfg.driver,
        host: cfg.host,
        port: cfg.port,
        basePath: cfg.basePath,
        error: null
      };
    } catch (err) {
      return {
        configured: true,
        connected: false,
        driver: cfg.driver,
        host: cfg.host,
        port: cfg.port,
        basePath: cfg.basePath,
        error: err.message
      };
    }
  }

  async close({ logger = console } = {}) {
    await this._disconnect(logger, 'shutdown applicazione');
  }
}

module.exports = new SftpStorageService();
module.exports.SftpStorageService = SftpStorageService;
module.exports.getSftpConfig = getSftpConfig;
module.exports.resolveRemotePath = resolveRemotePath;
