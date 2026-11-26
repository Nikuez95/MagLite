const path = require('path');
const db = require('../config/db');
const sftpStorageService = require('../services/sftpStorageService');
const { hasPermission, canAccessCustomer } = require('../utils/permissions');

const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg'
};

function sanitizeSegment(seg) {
  return String(seg || '')
    .replace(/[\\:*?"<>|\x00-\x1f]/g, '_')
    .trim();
}

function inferMimeType(filename, fallback = 'application/octet-stream') {
  const ext = path.posix.extname(String(filename || '')).toLowerCase();
  return MIME_BY_EXT[ext] || fallback;
}

function isPreviewableMime(mime, filename = '') {
  const m = String(mime || '').toLowerCase();
  const ext = String(filename || '').toLowerCase();
  if (m === 'application/pdf' || ext.endsWith('.pdf')) return true;
  if (m.startsWith('image/')) return true;
  if (m.startsWith('text/') || m.includes('application/json') || ext.endsWith('.txt') || ext.endsWith('.csv') || ext.endsWith('.log') || ext.endsWith('.json')) return true;
  if (m.startsWith('video/') || m.startsWith('audio/')) return true;
  return false;
}

async function filesRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);

  // POST /api/files/upload - Upload generico in streaming su NAS SFTP (ddt, pallets, signatures, attachments)
  fastify.post('/upload', async (request, reply) => {
    if (!hasPermission(request.user, 'access_desktop') && !hasPermission(request.user, 'access_zebra')) {
      return reply.code(403).send({ error: 'Accesso negato.' });
    }

    try {
      const parts = request.parts();
      let category = 'attachments';
      let uploadedFile = null;

      for await (const part of parts) {
        if (part.type === 'file') {
          if (uploadedFile) {
            part.file.resume();
            continue;
          }
          const cleanCat = sanitizeSegment(category).replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase() || 'attachments';
          const cleanName = sanitizeSegment(path.posix.basename(part.filename || 'file')).slice(0, 220) || 'file';
          const uniquePrefix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const relativePath = `${cleanCat}/${uniquePrefix}_${cleanName}`;

          const result = await sftpStorageService.uploadFile(relativePath, part.file, {
            compress: false,
            logger: request.log
          });

          uploadedFile = {
            filename: cleanName,
            mime_type: part.mimetype || inferMimeType(cleanName),
            storage_path: result.storagePath,
            size: result.originalSize,
            url: `/api/files/${result.storagePath.split('/').map(encodeURIComponent).join('/')}`
          };
        } else if (part.fieldname === 'category' || part.fieldname === 'folder') {
          category = String(part.value || 'attachments');
        }
      }

      if (!uploadedFile) {
        return reply.code(400).send({ error: 'Nessun file ricevuto nella richiesta multipart.' });
      }

      return { success: true, file: uploadedFile };
    } catch (err) {
      request.log.error({ err }, '[FILES API] Errore upload file su NAS SFTP');
      return reply.code(err.statusCode || 500).send({ error: err.message || 'Errore upload file su NAS SFTP.' });
    }
  });

  // GET /api/files/* (copre anche GET /api/files/:filename) - Legge in streaming dal NAS SFTP
  fastify.get('/*', async (request, reply) => {
    const rawWildcard = decodeURIComponent(String(request.params['*'] || '')).replace(/^\/+/, '');
    if (!rawWildcard) {
      return reply.code(400).send({ error: 'Nome file o percorso non specificato.' });
    }

    const mode = request.query?.mode === 'download' || request.query?.download === '1' ? 'download' : 'inline';

    try {
      let targetPath = rawWildcard;
      let mimeType = inferMimeType(targetPath);
      let displayFilename = sanitizeSegment(path.posix.basename(targetPath)) || 'documento';
      let compression = 'none';

      // Controlla se corrisponde a un documento cliente in DB per applicare permessi per-cliente e MIME originale
      const [[docRow]] = await db.query(
        'SELECT * FROM CUSTOMER_DOCUMENTS WHERE storage_path = ? OR r2_key = ? LIMIT 1',
        [rawWildcard, rawWildcard]
      );

      if (docRow) {
        if (!hasPermission(request.user, 'view_customers') && !hasPermission(request.user, 'customer_manage')) {
          return reply.code(403).send({ error: 'Accesso negato: permesso clienti richiesto.' });
        }
        if (!canAccessCustomer(request.user, docRow.customer_id)) {
          return reply.code(403).send({ error: 'Accesso negato per questo cliente.' });
        }
        targetPath = docRow.storage_path || docRow.r2_key;
        mimeType = docRow.mime_type || mimeType;
        displayFilename = sanitizeSegment(docRow.original_name || displayFilename);
        compression = docRow.compression || 'none';
      } else if (!hasPermission(request.user, 'access_desktop') && !hasPermission(request.user, 'access_zebra')) {
        return reply.code(403).send({ error: 'Accesso negato.' });
      }

      const { stream, size } = await sftpStorageService.getFileStream(targetPath, {
        compression,
        logger: request.log
      });

      const canInline = mode === 'inline' && isPreviewableMime(mimeType, displayFilename);
      const disp = canInline ? 'inline' : 'attachment';

      reply.header('Content-Type', mimeType || 'application/octet-stream');
      reply.header('Content-Disposition', `${disp}; filename="${encodeURIComponent(displayFilename)}"`);
      if (size !== null && size !== undefined) {
        reply.header('Content-Length', size);
      }
      return reply.send(stream);
    } catch (err) {
      request.log.error({ err, path: rawWildcard }, '[FILES API] Errore lettura stream dal NAS SFTP');
      return reply.code(err.statusCode || 500).send({ error: err.message || 'Errore recupero file dal NAS.' });
    }
  });

  // DELETE /api/files/* - Eliminazione file dal NAS SFTP
  fastify.delete('/*', async (request, reply) => {
    const rawWildcard = decodeURIComponent(String(request.params['*'] || '')).replace(/^\/+/, '');
    if (!rawWildcard) {
      return reply.code(400).send({ error: 'Percorso file non specificato.' });
    }

    try {
      const [[docRow]] = await db.query(
        'SELECT * FROM CUSTOMER_DOCUMENTS WHERE storage_path = ? OR r2_key = ? LIMIT 1',
        [rawWildcard, rawWildcard]
      );

      if (docRow) {
        if (!hasPermission(request.user, 'customer_manage')) {
          return reply.code(403).send({ error: 'Accesso negato: permesso Gestione Clienti richiesto.' });
        }
        if (!canAccessCustomer(request.user, docRow.customer_id)) {
          return reply.code(403).send({ error: 'Accesso negato per questo cliente.' });
        }
        await sftpStorageService.deleteFile(docRow.storage_path || docRow.r2_key, { logger: request.log });
        await db.query('DELETE FROM CUSTOMER_DOCUMENTS WHERE id = ?', [docRow.id]);
        return { success: true };
      }

      if (!hasPermission(request.user, 'settings_manage') && !hasPermission(request.user, 'customer_manage')) {
        return reply.code(403).send({ error: 'Accesso negato.' });
      }

      await sftpStorageService.deleteFile(rawWildcard, { logger: request.log });
      return { success: true };
    } catch (err) {
      request.log.error({ err, path: rawWildcard }, '[FILES API] Errore eliminazione file dal NAS SFTP');
      return reply.code(err.statusCode || 500).send({ error: err.message || 'Errore eliminazione file dal NAS.' });
    }
  });
}

module.exports = filesRoutes;
