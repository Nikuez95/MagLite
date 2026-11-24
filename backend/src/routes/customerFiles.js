const db = require('../config/db');
const { hasPermission, canAccessCustomer } = require('../utils/permissions');
const {
  getR2Config,
  compressAndUploadToR2,
  downloadAndDecompressFromR2,
  deleteFromR2,
  getR2QuotaSummary
} = require('../utils/r2Storage');

function sanitizeFileName(name) {
  return String(name || 'documento')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .trim()
    .slice(0, 220) || 'documento';
}

function isPreviewableMime(mime, filename = '') {
  const m = String(mime || '').toLowerCase();
  const ext = String(filename || '').toLowerCase();
  if (m === 'application/pdf' || ext.endsWith('.pdf')) return true;
  if (m.startsWith('image/')) return true;
  if (m.startsWith('text/') || m === 'application/json' || ext.endsWith('.txt') || ext.endsWith('.csv') || ext.endsWith('.log') || ext.endsWith('.json')) return true;
  if (m.startsWith('video/') || m.startsWith('audio/')) return true;
  return false;
}

async function customerFilesRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  // 1. GET /api/customer-files/storage/status - Stato connessione Cloudflare R2 & spazio occupato/disponibile
  fastify.get('/storage/status', async (request, reply) => {
    if (!hasPermission(request.user, 'view_customers') && !hasPermission(request.user, 'customer_manage')) {
      return reply.code(403).send({ error: 'Accesso negato: permesso clienti richiesto.' });
    }
    try {
      const cfg = await getR2Config(db);
      return await getR2QuotaSummary(db, cfg);
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore lettura stato spazio Cloudflare R2.' });
    }
  });

  // 2. PUT /api/customer-files/storage/config - Aggiorna token/bucket/quota R2 (solo ruolo admin/settings o software engineer)
  fastify.put('/storage/config', async (request, reply) => {
    const isAllowed =
      request.user?.role === 'developer' ||
      hasPermission(request.user, 'settings_manage');
    if (!isAllowed) {
      return reply.code(403).send({ error: 'Solo Software Engineer o Impostazioni possono modificare le credenziali R2.' });
    }
    const {
      cf_r2_token,
      cf_r2_account_id,
      cf_r2_bucket,
      cf_r2_quota_gb,
      cf_r2_access_key_id,
      cf_r2_secret_access_key
    } = request.body || {};
    try {
      if (cf_r2_token !== undefined && String(cf_r2_token).trim()) {
        await db.query(
          'INSERT INTO settings (setting_key, setting_value) VALUES ("cf_r2_token", ?) ON DUPLICATE KEY UPDATE setting_value = ?',
          [String(cf_r2_token).trim(), String(cf_r2_token).trim()]
        );
      }
      if (cf_r2_access_key_id !== undefined && String(cf_r2_access_key_id).trim()) {
        await db.query(
          'INSERT INTO settings (setting_key, setting_value) VALUES ("cf_r2_access_key_id", ?) ON DUPLICATE KEY UPDATE setting_value = ?',
          [String(cf_r2_access_key_id).trim(), String(cf_r2_access_key_id).trim()]
        );
      }
      if (cf_r2_secret_access_key !== undefined && String(cf_r2_secret_access_key).trim()) {
        await db.query(
          'INSERT INTO settings (setting_key, setting_value) VALUES ("cf_r2_secret_access_key", ?) ON DUPLICATE KEY UPDATE setting_value = ?',
          [String(cf_r2_secret_access_key).trim(), String(cf_r2_secret_access_key).trim()]
        );
      }
      if (cf_r2_account_id !== undefined) {
        await db.query(
          'INSERT INTO settings (setting_key, setting_value) VALUES ("cf_r2_account_id", ?) ON DUPLICATE KEY UPDATE setting_value = ?',
          [String(cf_r2_account_id || '').trim(), String(cf_r2_account_id || '').trim()]
        );
      }
      if (cf_r2_bucket !== undefined && String(cf_r2_bucket).trim()) {
        const cleanBucket = String(cf_r2_bucket).trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
        await db.query(
          'INSERT INTO settings (setting_key, setting_value) VALUES ("cf_r2_bucket", ?) ON DUPLICATE KEY UPDATE setting_value = ?',
          [cleanBucket, cleanBucket]
        );
      }
      if (cf_r2_quota_gb !== undefined && Number(cf_r2_quota_gb) > 0) {
        const qBytes = String(Math.round(Number(cf_r2_quota_gb) * 1024 * 1024 * 1024));
        await db.query(
          'INSERT INTO settings (setting_key, setting_value) VALUES ("cf_r2_quota_bytes", ?) ON DUPLICATE KEY UPDATE setting_value = ?',
          [qBytes, qBytes]
        );
      }

      const cfg = await getR2Config(db);
      const status = await getR2QuotaSummary(db, cfg);
      return { success: true, status };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore salvataggio configurazione Cloudflare R2.' });
    }
  });

  // 3. GET /api/customer-files/customers/:customerId - Lista cartelle & file separati per cliente
  fastify.get('/customers/:customerId', async (request, reply) => {
    if (!hasPermission(request.user, 'view_customers') && !hasPermission(request.user, 'customer_manage')) {
      return reply.code(403).send({ error: 'Accesso negato.' });
    }
    const customerId = parseInt(request.params.customerId, 10);
    if (!Number.isFinite(customerId) || customerId <= 0) {
      return reply.code(400).send({ error: 'ID cliente non valido.' });
    }
    if (!canAccessCustomer(request.user, customerId)) {
      return reply.code(403).send({ error: 'Accesso negato per questo cliente.' });
    }

    try {
      const [folders] = await db.query(
        `SELECT f.*, COUNT(d.id) AS files_count,
                COALESCE(SUM(d.original_size), 0) AS total_original_size,
                COALESCE(SUM(d.compressed_size), 0) AS total_compressed_size
         FROM CUSTOMER_DOCUMENT_FOLDERS f
         LEFT JOIN CUSTOMER_DOCUMENTS d ON d.folder_id = f.id
         WHERE f.customer_id = ?
         GROUP BY f.id
         ORDER BY f.name ASC`,
        [customerId]
      );

      const [files] = await db.query(
        `SELECT d.*, f.name AS folder_name, f.color AS folder_color
         FROM CUSTOMER_DOCUMENTS d
         LEFT JOIN CUSTOMER_DOCUMENT_FOLDERS f ON f.id = d.folder_id
         WHERE d.customer_id = ?
         ORDER BY d.created_at DESC, d.id DESC`,
        [customerId]
      );

      const mappedFiles = files.map(file => ({
        ...file,
        is_previewable: isPreviewableMime(file.mime_type, file.original_name)
      }));

      const totalOriginal = mappedFiles.reduce((s, f) => s + (Number(f.original_size) || 0), 0);
      const totalCompressed = mappedFiles.reduce((s, f) => s + (Number(f.compressed_size) || 0), 0);

      return {
        customer_id: customerId,
        folders,
        files: mappedFiles,
        stats: {
          total_files: mappedFiles.length,
          total_original_bytes: totalOriginal,
          total_compressed_bytes: totalCompressed
        }
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore recupero documenti cliente.' });
    }
  });

  // 4. POST /api/customer-files/customers/:customerId/folders - Crea cartella personalizzata (o preset)
  fastify.post('/customers/:customerId/folders', async (request, reply) => {
    if (!hasPermission(request.user, 'customer_manage')) {
      return reply.code(403).send({ error: 'Accesso negato: permesso Gestione Clienti richiesto.' });
    }
    const customerId = parseInt(request.params.customerId, 10);
    if (!canAccessCustomer(request.user, customerId)) {
      return reply.code(403).send({ error: 'Accesso negato per questo cliente.' });
    }

    const { name, color = 'sky', preset_defaults = false } = request.body || {};
    const username = request.user?.username || 'Operatore';

    try {
      if (preset_defaults) {
        const defaults = [
          ['Archivio DDT', 'sky'],
          ['Foto Palette', 'amber'],
          ['Contratti & Listini', 'emerald'],
          ['Documenti & Certificati', 'violet']
        ];
        for (const [fName, fCol] of defaults) {
          await db.query(
            'INSERT IGNORE INTO CUSTOMER_DOCUMENT_FOLDERS (customer_id, name, color, created_by) VALUES (?, ?, ?, ?)',
            [customerId, fName, fCol, username]
          );
        }
        return { success: true };
      }

      const cleanName = String(name || '').trim().slice(0, 120);
      if (!cleanName) {
        return reply.code(400).send({ error: 'Inserisci il nome della cartella.' });
      }
      const [ins] = await db.query(
        'INSERT INTO CUSTOMER_DOCUMENT_FOLDERS (customer_id, name, color, created_by) VALUES (?, ?, ?, ?)',
        [customerId, cleanName, String(color || 'sky').slice(0, 30), username]
      );
      return { success: true, id: ins.insertId, name: cleanName, color };
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return reply.code(400).send({ error: 'Esiste già una cartella con questo nome per il cliente.' });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore creazione cartella cliente.' });
    }
  });

  // 5. PUT /api/customer-files/folders/:folderId - Rinomina / cambia colore cartella
  fastify.put('/folders/:folderId', async (request, reply) => {
    if (!hasPermission(request.user, 'customer_manage')) {
      return reply.code(403).send({ error: 'Accesso negato: permesso Gestione Clienti richiesto.' });
    }
    const folderId = parseInt(request.params.folderId, 10);
    const { name, color } = request.body || {};
    const cleanName = String(name || '').trim().slice(0, 120);
    if (!cleanName) {
      return reply.code(400).send({ error: 'Il nome della cartella è obbligatorio.' });
    }

    try {
      const [[folder]] = await db.query('SELECT * FROM CUSTOMER_DOCUMENT_FOLDERS WHERE id = ?', [folderId]);
      if (!folder) return reply.code(404).send({ error: 'Cartella non trovata.' });
      if (!canAccessCustomer(request.user, folder.customer_id)) {
        return reply.code(403).send({ error: 'Accesso negato.' });
      }
      await db.query(
        'UPDATE CUSTOMER_DOCUMENT_FOLDERS SET name = ?, color = COALESCE(?, color) WHERE id = ?',
        [cleanName, color ? String(color).slice(0, 30) : null, folderId]
      );
      return { success: true };
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return reply.code(400).send({ error: 'Esiste già una cartella con questo nome.' });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore modifica cartella.' });
    }
  });

  // 6. DELETE /api/customer-files/folders/:folderId - Elimina cartella (sposta file a Root o elimina anche i file)
  fastify.delete('/folders/:folderId', async (request, reply) => {
    if (!hasPermission(request.user, 'customer_manage')) {
      return reply.code(403).send({ error: 'Accesso negato: permesso Gestione Clienti richiesto.' });
    }
    const folderId = parseInt(request.params.folderId, 10);
    const deleteFiles = request.query?.delete_files === 'true';

    try {
      const [[folder]] = await db.query('SELECT * FROM CUSTOMER_DOCUMENT_FOLDERS WHERE id = ?', [folderId]);
      if (!folder) return reply.code(404).send({ error: 'Cartella non trovata.' });
      if (!canAccessCustomer(request.user, folder.customer_id)) {
        return reply.code(403).send({ error: 'Accesso negato.' });
      }

      if (deleteFiles) {
        const [docs] = await db.query('SELECT id, r2_key, r2_bucket FROM CUSTOMER_DOCUMENTS WHERE folder_id = ?', [folderId]);
        const cfg = await getR2Config(db);
        for (const docRow of docs) {
          await deleteFromR2({ ...cfg, bucket: docRow.r2_bucket || cfg.bucket }, docRow.r2_key).catch(() => {});
        }
        await db.query('DELETE FROM CUSTOMER_DOCUMENTS WHERE folder_id = ?', [folderId]);
      } else {
        await db.query('UPDATE CUSTOMER_DOCUMENTS SET folder_id = NULL WHERE folder_id = ?', [folderId]);
      }

      await db.query('DELETE FROM CUSTOMER_DOCUMENT_FOLDERS WHERE id = ?', [folderId]);
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore eliminazione cartella.' });
    }
  });

  // 7. POST /api/customer-files/customers/:customerId/upload - Carica uno o più file, comprime gzip e archivia su R2
  fastify.post('/customers/:customerId/upload', async (request, reply) => {
    if (!hasPermission(request.user, 'customer_manage')) {
      return reply.code(403).send({ error: 'Accesso negato: permesso Gestione Clienti richiesto.' });
    }
    const customerId = parseInt(request.params.customerId, 10);
    if (!canAccessCustomer(request.user, customerId)) {
      return reply.code(403).send({ error: 'Accesso negato per questo cliente.' });
    }

    try {
      const parts = request.parts();
      let folderId = null;
      let notes = null;
      const fileEntries = [];

      for await (const part of parts) {
        if (part.type === 'file') {
          const buf = await part.toBuffer();
          fileEntries.push({
            filename: sanitizeFileName(part.filename),
            mimetype: part.mimetype || 'application/octet-stream',
            buffer: buf
          });
        } else if (part.fieldname === 'folder_id') {
          const parsedF = parseInt(part.value, 10);
          folderId = Number.isFinite(parsedF) && parsedF > 0 ? parsedF : null;
        } else if (part.fieldname === 'notes') {
          notes = part.value ? String(part.value).trim().slice(0, 500) : null;
        }
      }

      if (fileEntries.length === 0) {
        return reply.code(400).send({ error: 'Nessun file ricevuto.' });
      }

      if (folderId) {
        const [[validFolder]] = await db.query(
          'SELECT id FROM CUSTOMER_DOCUMENT_FOLDERS WHERE id = ? AND customer_id = ?',
          [folderId, customerId]
        );
        if (!validFolder) folderId = null;
      }

      const cfg = await getR2Config(db);
      const uploaded = [];
      const username = request.user?.username || 'Operatore';

      for (const entry of fileEntries) {
        const uniquePrefix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const r2Key = `customers/${customerId}/${folderId || 'root'}/${uniquePrefix}_${entry.filename}.gz`;

        const r2Res = await compressAndUploadToR2(cfg, r2Key, entry.buffer);

        const [ins] = await db.query(
          `INSERT INTO CUSTOMER_DOCUMENTS
           (customer_id, folder_id, original_name, mime_type, r2_bucket, r2_key, compression, original_size, compressed_size, notes, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            customerId,
            folderId,
            entry.filename,
            entry.mimetype,
            cfg.bucket,
            r2Key,
            r2Res.compression,
            r2Res.originalSize,
            r2Res.compressedSize,
            notes,
            username
          ]
        );

        uploaded.push({
          id: ins.insertId,
          original_name: entry.filename,
          mime_type: entry.mimetype,
          original_size: r2Res.originalSize,
          compressed_size: r2Res.compressedSize,
          is_previewable: isPreviewableMime(entry.mimetype, entry.filename)
        });
      }

      try {
        await db.query(
          'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
          [
            'UPLOAD_CUSTOMER_FILE',
            `Caricati ${uploaded.length} file compressi su Cloudflare R2 per cliente #${customerId} (${uploaded.map(u => u.original_name).join(', ')})`,
            'Gestionale',
            username
          ]
        );
      } catch (_) {}

      return { success: true, uploaded };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(err.statusCode || 500).send({ error: err.message || 'Errore upload file su Cloudflare R2.' });
    }
  });

  // 8. GET /api/customer-files/files/:fileId/content - Decomprime da R2 e apre inline oppure scarica
  fastify.get('/files/:fileId/content', async (request, reply) => {
    if (!hasPermission(request.user, 'view_customers') && !hasPermission(request.user, 'customer_manage')) {
      return reply.code(403).send({ error: 'Accesso negato.' });
    }
    const fileId = parseInt(request.params.fileId, 10);
    const mode = request.query?.mode === 'download' ? 'download' : 'inline';

    try {
      const [[docRow]] = await db.query('SELECT * FROM CUSTOMER_DOCUMENTS WHERE id = ?', [fileId]);
      if (!docRow) return reply.code(404).send({ error: 'File non trovato.' });
      if (!canAccessCustomer(request.user, docRow.customer_id)) {
        return reply.code(403).send({ error: 'Accesso negato.' });
      }

      const cfg = await getR2Config(db);
      const decompressedBuffer = await downloadAndDecompressFromR2(
        { ...cfg, bucket: docRow.r2_bucket || cfg.bucket },
        docRow.r2_key,
        docRow.compression
      );

      const safeFilename = sanitizeFileName(docRow.original_name);
      const canInline = mode === 'inline' && isPreviewableMime(docRow.mime_type, safeFilename);
      const disp = canInline ? 'inline' : 'attachment';

      reply.header('Content-Type', docRow.mime_type || 'application/octet-stream');
      reply.header('Content-Disposition', `${disp}; filename="${encodeURIComponent(safeFilename)}"`);
      reply.header('Content-Length', decompressedBuffer.length);
      return reply.send(decompressedBuffer);
    } catch (err) {
      fastify.log.error(err);
      return reply.code(err.statusCode || 500).send({ error: err.message || 'Errore apertura file da Cloudflare R2.' });
    }
  });

  // 9. DELETE /api/customer-files/files/:fileId - Elimina file da R2 & DB
  fastify.delete('/files/:fileId', async (request, reply) => {
    if (!hasPermission(request.user, 'customer_manage')) {
      return reply.code(403).send({ error: 'Accesso negato: permesso Gestione Clienti richiesto.' });
    }
    const fileId = parseInt(request.params.fileId, 10);

    try {
      const [[docRow]] = await db.query('SELECT * FROM CUSTOMER_DOCUMENTS WHERE id = ?', [fileId]);
      if (!docRow) return reply.code(404).send({ error: 'File non trovato.' });
      if (!canAccessCustomer(request.user, docRow.customer_id)) {
        return reply.code(403).send({ error: 'Accesso negato.' });
      }

      const cfg = await getR2Config(db);
      await deleteFromR2({ ...cfg, bucket: docRow.r2_bucket || cfg.bucket }, docRow.r2_key);
      await db.query('DELETE FROM CUSTOMER_DOCUMENTS WHERE id = ?', [fileId]);

      try {
        await db.query(
          'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
          [
            'DELETE_CUSTOMER_FILE',
            `Eliminato file "${docRow.original_name}" da Cloudflare R2 (Cliente #${docRow.customer_id})`,
            'Gestionale',
            request.user?.username || 'Operatore'
          ]
        );
      } catch (_) {}

      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(err.statusCode || 500).send({ error: err.message || 'Errore eliminazione file.' });
    }
  });

  // 10. PUT /api/customer-files/files/:fileId/move - Sposta file in un'altra cartella dello stesso cliente
  fastify.put('/files/:fileId/move', async (request, reply) => {
    if (!hasPermission(request.user, 'customer_manage')) {
      return reply.code(403).send({ error: 'Accesso negato.' });
    }
    const fileId = parseInt(request.params.fileId, 10);
    const folderId = request.body?.folder_id ? parseInt(request.body.folder_id, 10) : null;

    try {
      const [[docRow]] = await db.query('SELECT * FROM CUSTOMER_DOCUMENTS WHERE id = ?', [fileId]);
      if (!docRow) return reply.code(404).send({ error: 'File non trovato.' });
      if (!canAccessCustomer(request.user, docRow.customer_id)) {
        return reply.code(403).send({ error: 'Accesso negato.' });
      }
      if (folderId) {
        const [[validFolder]] = await db.query(
          'SELECT id FROM CUSTOMER_DOCUMENT_FOLDERS WHERE id = ? AND customer_id = ?',
          [folderId, docRow.customer_id]
        );
        if (!validFolder) return reply.code(400).send({ error: 'Cartella di destinazione non trovata per questo cliente.' });
      }
      await db.query('UPDATE CUSTOMER_DOCUMENTS SET folder_id = ? WHERE id = ?', [folderId || null, fileId]);
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore spostamento file.' });
    }
  });
}

module.exports = customerFilesRoutes;
