const db = require('../config/db');
const { hasPermission, canAccessCustomer } = require('../utils/permissions');
const sftpStorageService = require('../services/sftpStorageService');

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

async function customerFilesRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);

  // 1. GET /api/customer-files/storage/status - Stato connessione NAS SFTP & statistiche spazio archivio
  fastify.get('/storage/status', async (request, reply) => {
    if (!hasPermission(request.user, 'view_customers') && !hasPermission(request.user, 'customer_manage')) {
      return reply.code(403).send({ error: 'Accesso negato: permesso clienti richiesto.' });
    }
    try {
      const [[dbAgg]] = await db.query(
        `SELECT COUNT(*) AS file_count,
                COALESCE(SUM(original_size), 0) AS total_original,
                COALESCE(SUM(compressed_size), 0) AS total_compressed
         FROM CUSTOMER_DOCUMENTS`
      );
      const sftpStatus = await sftpStorageService.checkConnectionStatus({ logger: request.log });

      const fileCount = Number(dbAgg?.file_count) || 0;
      const originalBytesMaglite = Number(dbAgg?.total_original) || 0;
      const usedBytesMaglite = Number(dbAgg?.total_compressed) || originalBytesMaglite;

      return {
        driver: sftpStatus.driver,
        configured: sftpStatus.configured,
        connected: sftpStatus.connected,
        // Alias di compatibilità per eventuali client precedenti
        r2Enabled: sftpStatus.connected,
        host: sftpStatus.host,
        port: sftpStatus.port,
        basePath: sftpStatus.basePath,
        errorMessage: sftpStatus.error,
        fileCount,
        originalBytesMaglite,
        usedBytesMaglite,
        usedBytesEffective: usedBytesMaglite
      };
    } catch (err) {
      request.log.error({ err }, '[CUSTOMER FILES] Errore verifica stato NAS SFTP');
      return reply.code(500).send({ error: 'Errore lettura stato connessione NAS SFTP.' });
    }
  });

  // 2. GET /api/customer-files/customers/:customerId - Lista cartelle & file separati per cliente
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

      const mappedFiles = files.map(file => {
        const storagePath = file.storage_path || file.r2_key || '';
        return {
          ...file,
          storage_driver: file.storage_driver || 'sftp',
          storage_path: storagePath,
          download_url: `/api/customer-files/files/${file.id}/content?mode=download`,
          preview_url: `/api/customer-files/files/${file.id}/content?mode=inline`,
          is_previewable: isPreviewableMime(file.mime_type, file.original_name)
        };
      });

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
      request.log.error({ err, customerId }, '[CUSTOMER FILES] Errore recupero documenti cliente');
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
      request.log.error({ err, customerId }, '[CUSTOMER FILES] Errore creazione cartella');
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
      request.log.error({ err, folderId }, '[CUSTOMER FILES] Errore modifica cartella');
      return reply.code(500).send({ error: 'Errore modifica cartella.' });
    }
  });

  // 6. DELETE /api/customer-files/folders/:folderId - Elimina cartella (sposta file a Root o elimina anche i file da NAS)
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
        const [docs] = await db.query('SELECT id, storage_path, r2_key FROM CUSTOMER_DOCUMENTS WHERE folder_id = ?', [folderId]);
        for (const docRow of docs) {
          const remoteRelPath = docRow.storage_path || docRow.r2_key;
          if (remoteRelPath) {
            await sftpStorageService.deleteFile(remoteRelPath, { logger: request.log }).catch((delErr) => {
              request.log.warn({ err: delErr, remoteRelPath }, '[CUSTOMER FILES] Errore non bloccante rimozione file da NAS SFTP');
            });
          }
        }
        await db.query('DELETE FROM CUSTOMER_DOCUMENTS WHERE folder_id = ?', [folderId]);
      } else {
        await db.query('UPDATE CUSTOMER_DOCUMENTS SET folder_id = NULL WHERE folder_id = ?', [folderId]);
      }

      await db.query('DELETE FROM CUSTOMER_DOCUMENT_FOLDERS WHERE id = ?', [folderId]);
      return { success: true };
    } catch (err) {
      request.log.error({ err, folderId }, '[CUSTOMER FILES] Errore eliminazione cartella');
      return reply.code(500).send({ error: 'Errore eliminazione cartella.' });
    }
  });

  // 7. POST /api/customer-files/customers/:customerId/upload - Carica uno o più file sul NAS via SFTP
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

      const uploaded = [];
      const username = request.user?.username || 'Operatore';

      for (const entry of fileEntries) {
        const uniquePrefix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const relativeStoragePath = `customers/${customerId}/${folderId || 'root'}/${uniquePrefix}_${entry.filename}`;

        const sftpRes = await sftpStorageService.uploadFile(relativeStoragePath, entry.buffer, {
          compress: false,
          logger: request.log
        });

        const [ins] = await db.query(
          `INSERT INTO CUSTOMER_DOCUMENTS
           (customer_id, folder_id, original_name, mime_type, r2_bucket, r2_key, storage_driver, storage_path, compression, original_size, compressed_size, notes, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            customerId,
            folderId,
            entry.filename,
            entry.mimetype,
            'nas-sftp',
            sftpRes.storagePath,
            'sftp',
            sftpRes.storagePath,
            sftpRes.compression,
            sftpRes.originalSize,
            sftpRes.storedSize,
            notes,
            username
          ]
        );

        uploaded.push({
          id: ins.insertId,
          original_name: entry.filename,
          mime_type: entry.mimetype,
          storage_path: sftpRes.storagePath,
          original_size: sftpRes.originalSize,
          compressed_size: sftpRes.storedSize,
          is_previewable: isPreviewableMime(entry.mimetype, entry.filename)
        });
      }

      try {
        await db.query(
          'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
          [
            'UPLOAD_CUSTOMER_FILE',
            `Caricati ${uploaded.length} file su NAS SFTP per cliente #${customerId} (${uploaded.map(u => u.original_name).join(', ')})`,
            'Gestionale',
            username
          ]
        );
      } catch (_) {}

      return { success: true, uploaded };
    } catch (err) {
      request.log.error({ err, customerId }, '[CUSTOMER FILES] Errore upload file su NAS SFTP');
      return reply.code(err.statusCode || 500).send({ error: err.message || 'Errore upload file su NAS SFTP.' });
    }
  });

  // 8. GET /api/customer-files/files/:fileId/content - Legge in streaming dal NAS SFTP e serve inline o download
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

      const targetPath = docRow.storage_path || docRow.r2_key;
      const { stream, size } = await sftpStorageService.getFileStream(targetPath, {
        compression: docRow.compression || 'none',
        logger: request.log
      });

      const safeFilename = sanitizeFileName(docRow.original_name);
      const canInline = mode === 'inline' && isPreviewableMime(docRow.mime_type, safeFilename);
      const disp = canInline ? 'inline' : 'attachment';

      reply.header('Content-Type', docRow.mime_type || 'application/octet-stream');
      reply.header('Content-Disposition', `${disp}; filename="${encodeURIComponent(safeFilename)}"`);
      if (size !== null && size !== undefined) {
        reply.header('Content-Length', size);
      }
      return reply.send(stream);
    } catch (err) {
      request.log.error({ err, fileId }, '[CUSTOMER FILES] Errore apertura/download file da NAS SFTP');
      return reply.code(err.statusCode || 500).send({ error: err.message || 'Errore apertura file da NAS SFTP.' });
    }
  });

  // 9. DELETE /api/customer-files/files/:fileId - Elimina file da NAS SFTP & DB
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

      const targetPath = docRow.storage_path || docRow.r2_key;
      await sftpStorageService.deleteFile(targetPath, { logger: request.log });
      await db.query('DELETE FROM CUSTOMER_DOCUMENTS WHERE id = ?', [fileId]);

      try {
        await db.query(
          'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
          [
            'DELETE_CUSTOMER_FILE',
            `Eliminato file "${docRow.original_name}" da NAS SFTP (Cliente #${docRow.customer_id})`,
            'Gestionale',
            request.user?.username || 'Operatore'
          ]
        );
      } catch (_) {}

      return { success: true };
    } catch (err) {
      request.log.error({ err, fileId }, '[CUSTOMER FILES] Errore eliminazione file da NAS SFTP');
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
      request.log.error({ err, fileId }, '[CUSTOMER FILES] Errore spostamento file');
      return reply.code(500).send({ error: 'Errore spostamento file.' });
    }
  });
}

module.exports = customerFilesRoutes;
