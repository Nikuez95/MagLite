const zlib = require('zlib');
const crypto = require('crypto');
const https = require('https');

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';
const DEFAULT_QUOTA_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB Cloudflare R2 Always-Free Tier

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key, data, encoding) {
  return crypto.createHmac('sha256', key).update(data).digest(encoding);
}

function encodeObjectKey(key) {
  return String(key || '')
    .split('/')
    .map(seg => encodeURIComponent(seg))
    .join('/');
}

async function getR2Config(db) {
  const [rows] = await db.query(
    `SELECT setting_key, setting_value FROM settings
     WHERE setting_key IN ('cf_r2_token', 'cf_r2_account_id', 'cf_r2_bucket', 'cf_r2_quota_bytes', 'cf_r2_access_key_id', 'cf_r2_secret_access_key')`
  );
  const map = {};
  for (const r of rows) {
    map[r.setting_key] = r.setting_value;
  }

  const token = (process.env.CF_R2_TOKEN || map.cf_r2_token || '').trim();
  let accountId = (process.env.CF_R2_ACCOUNT_ID || map.cf_r2_account_id || '').trim();
  const bucket = (process.env.CF_R2_BUCKET || map.cf_r2_bucket || 'maglite-customer-files').trim();
  const quotaParsed = Number(process.env.CF_R2_QUOTA_BYTES || map.cf_r2_quota_bytes || DEFAULT_QUOTA_BYTES);
  const quotaBytes = Number.isFinite(quotaParsed) && quotaParsed > 0 ? quotaParsed : DEFAULT_QUOTA_BYTES;

  let accessKeyId = (process.env.CF_R2_ACCESS_KEY_ID || map.cf_r2_access_key_id || '').trim();
  let secretAccessKey = (process.env.CF_R2_SECRET_ACCESS_KEY || map.cf_r2_secret_access_key || '').trim();

  if (token && !accountId) {
    try {
      const res = await fetch(`${CF_API_BASE}/accounts`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      if (json?.success && Array.isArray(json.result) && json.result[0]?.id) {
        accountId = json.result[0].id;
        await db.query(
          'INSERT INTO settings (setting_key, setting_value) VALUES ("cf_r2_account_id", ?) ON DUPLICATE KEY UPDATE setting_value = ?',
          [accountId, accountId]
        );
      }
    } catch (_) {}
  }

  // Per R2 API Token (es. cfut_...): Access Key ID = token.id, Secret Access Key = SHA-256(token)
  if (token && (!accessKeyId || !secretAccessKey)) {
    try {
      const vRes = await fetch(`${CF_API_BASE}/user/tokens/verify`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const vJson = await vRes.json().catch(() => ({}));
      const tokId = vJson?.result?.id;
      if (vJson?.success && tokId) {
        accessKeyId = accessKeyId || tokId;
        secretAccessKey = secretAccessKey || sha256Hex(token);
      }
    } catch (_) {}
  }

  return { token, accountId, bucket, quotaBytes, accessKeyId, secretAccessKey };
}

function buildCfError(json, fallbackMsg, statusHint = 502) {
  const firstErr = Array.isArray(json?.errors) && json.errors[0] ? json.errors[0] : null;
  const code = firstErr?.code || null;
  const rawMsg = firstErr?.message || fallbackMsg;
  let friendly = rawMsg;

  if (code === 10042) {
    friendly = 'Cloudflare R2 non ancora attivato sul tuo account Cloudflare (errore 10042): accedi a dash.cloudflare.com → R2 → attiva R2.';
  } else if (code === 10000 || statusHint === 403) {
    friendly =
      'Permesso negato da Cloudflare R2 (403): il token attuale non ha i permessi di scrittura (es. è in sola lettura o è un User Token senza "Object Read & Write"). ' +
      'Vai su dash.cloudflare.com → R2 → Manage R2 API Tokens, crea un token con permesso "Object Read & Write" (o "Admin Read & Write") e inseriscilo in "Configura R2 / Token".';
  }

  const err = new Error(friendly);
  err.cfCode = code;
  err.statusCode = code === 10042 ? 503 : statusHint === 403 ? 403 : 502;
  return err;
}

function s3Request(cfg, { method, bucket, key = '', query = '', body = null, contentType = null }) {
  return new Promise((resolve, reject) => {
    if (!cfg.accountId || !cfg.accessKeyId || !cfg.secretAccessKey) {
      return reject(new Error('Credenziali S3 R2 mancanti.'));
    }

    const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
    const cleanBucket = encodeURIComponent(bucket || cfg.bucket);
    const encodedKey = key ? `/${encodeObjectKey(key)}` : '';
    const canonicalUri = `/${cleanBucket}${encodedKey}`;
    const canonicalQuerystring = query || '';

    const payload = body ? (Buffer.isBuffer(body) ? body : Buffer.from(body)) : Buffer.alloc(0);
    const payloadHash = sha256Hex(payload);

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);

    const headerMap = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate
    };
    if (contentType) headerMap['content-type'] = contentType;

    const sortedKeys = Object.keys(headerMap).sort();
    const canonicalHeaders = sortedKeys.map(k => `${k}:${headerMap[k]}\n`).join('');
    const signedHeaders = sortedKeys.join(';');

    const canonicalRequest = [
      method.toUpperCase(),
      canonicalUri,
      canonicalQuerystring,
      canonicalHeaders,
      signedHeaders,
      payloadHash
    ].join('\n');

    const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest)
    ].join('\n');

    const kDate = hmacSha256(`AWS4${cfg.secretAccessKey}`, dateStamp);
    const kRegion = hmacSha256(kDate, 'auto');
    const kService = hmacSha256(kRegion, 's3');
    const kSigning = hmacSha256(kService, 'aws4_request');
    const signature = hmacSha256(kSigning, stringToSign, 'hex');

    const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const reqHeaders = {
      Host: host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: authorization
    };
    if (contentType) reqHeaders['Content-Type'] = contentType;
    if (payload.length > 0 || method.toUpperCase() === 'PUT') {
      reqHeaders['Content-Length'] = payload.length;
    }

    const pathWithQuery = canonicalQuerystring ? `${canonicalUri}?${canonicalQuerystring}` : canonicalUri;
    const req = https.request(
      {
        hostname: host,
        port: 443,
        path: pathWithQuery,
        method: method.toUpperCase(),
        servername: host,
        headers: reqHeaders
      },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 500,
            headers: res.headers,
            body: Buffer.concat(chunks)
          });
        });
      }
    );

    req.on('error', reject);
    if (payload.length > 0) req.write(payload);
    req.end();
  });
}

async function ensureBucketExists(cfg) {
  if (!cfg.token && (!cfg.accessKeyId || !cfg.secretAccessKey)) {
    const err = new Error('Token Cloudflare R2 non configurato.');
    err.statusCode = 400;
    throw err;
  }
  if (!cfg.accountId) {
    const err = new Error('Account ID Cloudflare non rilevato. Verifica le credenziali Cloudflare.');
    err.statusCode = 400;
    throw err;
  }

  // 1. Verifica rapida S3 HEAD bucket (funziona anche con token Object Read & Write limitati al bucket)
  if (cfg.accessKeyId && cfg.secretAccessKey) {
    try {
      const headRes = await s3Request(cfg, { method: 'HEAD', bucket: cfg.bucket });
      if (headRes.status >= 200 && headRes.status < 300) return true;
    } catch (_) {}
  }

  if (!cfg.token) return true;

  // 2. Fallback REST API v4 per controllo / creazione automatica bucket
  const checkRes = await fetch(
    `${CF_API_BASE}/accounts/${cfg.accountId}/r2/buckets/${encodeURIComponent(cfg.bucket)}`,
    { headers: { Authorization: `Bearer ${cfg.token}` } }
  );
  let checkJson = null;
  try { checkJson = await checkRes.json(); } catch (_) {}

  if (checkRes.ok && checkJson?.success) {
    return true;
  }

  const errCode = checkJson?.errors?.[0]?.code;
  if (errCode === 10042) {
    throw buildCfError(checkJson, 'R2 non abilitato su Cloudflare');
  }

  if (checkRes.status === 404 || errCode === 10006) {
    const createRes = await fetch(`${CF_API_BASE}/accounts/${cfg.accountId}/r2/buckets`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: cfg.bucket })
    });
    const createJson = await createRes.json().catch(() => ({}));
    if (!createRes.ok || !createJson?.success) {
      throw buildCfError(createJson, `Impossibile creare il bucket R2 "${cfg.bucket}".`, createRes.status);
    }
    return true;
  }

  // Se il token ha permessi S3 solo sugli oggetti, il REST /buckets può dare 403/10000 anche se S3 funziona
  if (cfg.accessKeyId && cfg.secretAccessKey && (checkRes.status === 403 || errCode === 10000)) {
    return true;
  }

  throw buildCfError(checkJson, 'Errore verifica bucket Cloudflare R2.', checkRes.status);
}

async function compressAndUploadToR2(cfg, objectKey, rawBuffer) {
  await ensureBucketExists(cfg);
  const compressedBuffer = zlib.gzipSync(rawBuffer, { level: 9 });

  // 1. Tentativo principale tramite S3 SigV4 (endpoint standard per oggetti R2)
  let s3Denied = false;
  if (cfg.accessKeyId && cfg.secretAccessKey) {
    const s3Res = await s3Request(cfg, {
      method: 'PUT',
      bucket: cfg.bucket,
      key: objectKey,
      body: compressedBuffer,
      contentType: 'application/gzip'
    });
    if (s3Res.status >= 200 && s3Res.status < 300) {
      return {
        compression: 'gzip',
        originalSize: rawBuffer.length,
        compressedSize: compressedBuffer.length
      };
    }
    if (s3Res.status === 403) s3Denied = true;
  }

  // 2. Fallback REST API v4 (per User Token con permesso Workers R2 Storage Write)
  if (cfg.token) {
    const uploadRes = await fetch(
      `${CF_API_BASE}/accounts/${cfg.accountId}/r2/buckets/${encodeURIComponent(cfg.bucket)}/objects/${encodeObjectKey(objectKey)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          'Content-Type': 'application/gzip'
        },
        body: compressedBuffer
      }
    );

    if (uploadRes.ok) {
      return {
        compression: 'gzip',
        originalSize: rawBuffer.length,
        compressedSize: compressedBuffer.length
      };
    }

    let errJson = null;
    try { errJson = await uploadRes.json(); } catch (_) {}
    throw buildCfError(errJson, `Upload su Cloudflare R2 fallito (HTTP ${uploadRes.status}).`, s3Denied ? 403 : uploadRes.status);
  }

  throw buildCfError(null, 'Upload su Cloudflare R2 negato.', 403);
}

async function downloadAndDecompressFromR2(cfg, objectKey, compression = 'gzip') {
  if (!cfg.accountId || (!cfg.token && (!cfg.accessKeyId || !cfg.secretAccessKey))) {
    const err = new Error('Configurazione Cloudflare R2 incompleta.');
    err.statusCode = 400;
    throw err;
  }

  let rawBuf = null;

  if (cfg.accessKeyId && cfg.secretAccessKey) {
    const s3Res = await s3Request(cfg, {
      method: 'GET',
      bucket: cfg.bucket,
      key: objectKey
    });
    if (s3Res.status >= 200 && s3Res.status < 300) {
      rawBuf = s3Res.body;
    } else if (s3Res.status === 404 && !cfg.token) {
      const err = new Error('File non trovato su Cloudflare R2 (404).');
      err.statusCode = 404;
      throw err;
    }
  }

  if (!rawBuf && cfg.token) {
    const res = await fetch(
      `${CF_API_BASE}/accounts/${cfg.accountId}/r2/buckets/${encodeURIComponent(cfg.bucket)}/objects/${encodeObjectKey(objectKey)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${cfg.token}` }
      }
    );

    if (!res.ok) {
      let errJson = null;
      try { errJson = await res.json(); } catch (_) {}
      const err = buildCfError(errJson, `Impossibile scaricare il file da Cloudflare R2 (HTTP ${res.status}).`, res.status);
      if (res.status === 404) err.statusCode = 404;
      throw err;
    }

    const arrBuf = await res.arrayBuffer();
    rawBuf = Buffer.from(arrBuf);
  }

  if (!rawBuf) {
    const err = new Error('Impossibile leggere il file da Cloudflare R2.');
    err.statusCode = 502;
    throw err;
  }

  if (compression === 'gzip') {
    return zlib.gunzipSync(rawBuf);
  }
  return rawBuf;
}

async function deleteFromR2(cfg, objectKey) {
  if (!cfg.accountId || !objectKey) return false;

  if (cfg.accessKeyId && cfg.secretAccessKey) {
    const s3Res = await s3Request(cfg, {
      method: 'DELETE',
      bucket: cfg.bucket,
      key: objectKey
    });
    if ((s3Res.status >= 200 && s3Res.status < 300) || s3Res.status === 404) {
      return true;
    }
  }

  if (!cfg.token) return false;

  const res = await fetch(
    `${CF_API_BASE}/accounts/${cfg.accountId}/r2/buckets/${encodeURIComponent(cfg.bucket)}/objects/${encodeObjectKey(objectKey)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${cfg.token}` }
    }
  );
  if (res.status === 404) return true;
  if (!res.ok) {
    let errJson = null;
    try { errJson = await res.json(); } catch (_) {}
    throw buildCfError(errJson, `Errore eliminazione file su Cloudflare R2 (HTTP ${res.status}).`, res.status);
  }
  return true;
}

async function getR2QuotaSummary(db, cfg) {
  const [[dbAgg]] = await db.query(
    `SELECT COUNT(*) AS file_count,
            COALESCE(SUM(original_size), 0) AS total_original,
            COALESCE(SUM(compressed_size), 0) AS total_compressed
     FROM CUSTOMER_DOCUMENTS`
  );

  const fileCount = Number(dbAgg?.file_count) || 0;
  const originalBytesMaglite = Number(dbAgg?.total_original) || 0;
  const usedBytesMaglite = Number(dbAgg?.total_compressed) || 0;

  let r2Enabled = false;
  let r2ErrorCode = null;
  let r2ErrorMessage = null;
  let usedBytesCloudflare = null;
  let bucketExists = false;

  if (!cfg.token && (!cfg.accessKeyId || !cfg.secretAccessKey)) {
    r2ErrorMessage = 'Credenziali Cloudflare R2 non impostate.';
  } else if (!cfg.accountId) {
    r2ErrorMessage = 'Account ID Cloudflare non rilevato.';
  } else {
    try {
      if (cfg.token) {
        const mRes = await fetch(`${CF_API_BASE}/accounts/${cfg.accountId}/r2/metrics`, {
          headers: { Authorization: `Bearer ${cfg.token}` }
        });
        const mJson = await mRes.json().catch(() => ({}));
        if (mRes.ok && mJson?.success) {
          r2Enabled = true;
          const result = mJson.result || {};
          const pub = Number(result?.infrequentAccess?.published?.payloadSize || 0) + Number(result?.standard?.published?.payloadSize || 0);
          const upl = Number(result?.infrequentAccess?.uploaded?.payloadSize || 0) + Number(result?.standard?.uploaded?.payloadSize || 0);
          usedBytesCloudflare = Number.isFinite(pub + upl) ? pub + upl : 0;

          const bRes = await fetch(`${CF_API_BASE}/accounts/${cfg.accountId}/r2/buckets`, {
            headers: { Authorization: `Bearer ${cfg.token}` }
          });
          const bJson = await bRes.json().catch(() => ({}));
          const bucketsList = bJson?.result?.buckets || (Array.isArray(bJson?.result) ? bJson.result : []);
          bucketExists = bucketsList.some(b => b.name === cfg.bucket);
        } else {
          const firstErr = mJson?.errors?.[0];
          r2ErrorCode = firstErr?.code || mRes.status;
          r2ErrorMessage = firstErr?.code === 10042
            ? 'R2 non ancora attivato nella Cloudflare Dashboard (errore 10042).'
            : (firstErr?.message || 'Errore verifica Cloudflare R2.');
        }
      }

      // Se l'utente usa solo credenziali S3 o un token Object-level, controlliamo il bucket via S3 HEAD
      if (!bucketExists && cfg.accessKeyId && cfg.secretAccessKey) {
        const head = await s3Request(cfg, { method: 'HEAD', bucket: cfg.bucket }).catch(() => null);
        if (head && head.status >= 200 && head.status < 300) {
          r2Enabled = true;
          bucketExists = true;
          r2ErrorCode = null;
          r2ErrorMessage = null;
        }
      }
    } catch (e) {
      r2ErrorMessage = `Impossibile contattare Cloudflare R2: ${e.message}`;
    }
  }

  const usedBytesEffective = usedBytesCloudflare !== null
    ? Math.max(usedBytesCloudflare, usedBytesMaglite)
    : usedBytesMaglite;
  const remainingBytes = Math.max(0, cfg.quotaBytes - usedBytesEffective);

  return {
    configured: Boolean((cfg.token || (cfg.accessKeyId && cfg.secretAccessKey)) && cfg.accountId),
    r2Enabled,
    bucketExists,
    hasS3Keys: Boolean(cfg.accessKeyId && cfg.secretAccessKey),
    r2ErrorCode,
    r2ErrorMessage,
    accountId: cfg.accountId || null,
    bucket: cfg.bucket,
    tokenMasked: cfg.token ? `${cfg.token.slice(0, 9)}...${cfg.token.slice(-6)}` : null,
    accessKeyMasked: cfg.accessKeyId ? `${cfg.accessKeyId.slice(0, 8)}...${cfg.accessKeyId.slice(-4)}` : null,
    quotaBytes: cfg.quotaBytes,
    usedBytesCloudflare,
    usedBytesMaglite,
    originalBytesMaglite,
    fileCount,
    usedBytesEffective,
    remainingBytes
  };
}

module.exports = {
  getR2Config,
  ensureBucketExists,
  compressAndUploadToR2,
  downloadAndDecompressFromR2,
  deleteFromR2,
  getR2QuotaSummary
};
