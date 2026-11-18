const db = require('../config/db');
const { createNotification } = require('../utils/notifications');

function isSoftwareEngineer(user) {
  if (!user) return false;
  if (user.role === 'developer') return true;
  const rName = String(user.role_name || '').toLowerCase();
  return rName.includes('software engineer') || rName.includes('software engineering');
}

const VALID_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_INFO', 'RESOLVED', 'CLOSED', 'REJECTED'];
const VALID_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const STATUS_LABELS = {
  OPEN: 'Aperto',
  IN_PROGRESS: 'In Corso',
  WAITING_INFO: 'In Attesa Info',
  RESOLVED: 'Sistemato',
  CLOSED: 'Chiuso',
  REJECTED: 'Respinto'
};

async function ticketsRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  // GET /api/tickets - Lista ticket con filtri e statistiche
  fastify.get('/', async (request, reply) => {
    try {
      const { status = 'ALL', priority = 'ALL', category = 'ALL', mine = 'false', search = '' } = request.query || {};
      const onlyMine = mine === 'true' || mine === '1';

      let whereClause = 'WHERE 1=1';
      const params = [];

      if (status && status !== 'ALL') {
        whereClause += ' AND t.status = ?';
        params.push(status);
      }
      if (priority && priority !== 'ALL') {
        whereClause += ' AND t.priority = ?';
        params.push(priority);
      }
      if (category && category !== 'ALL') {
        whereClause += ' AND t.category = ?';
        params.push(category);
      }
      if (onlyMine) {
        whereClause += ' AND t.created_by_id = ?';
        params.push(request.user.id);
      }
      if (search && String(search).trim()) {
        const like = `%${String(search).trim()}%`;
        whereClause += ' AND (t.ticket_code LIKE ? OR t.title LIKE ? OR t.description LIKE ? OR t.created_by_username LIKE ? OR t.area LIKE ?)';
        params.push(like, like, like, like, like);
      }

      const [[tickets], [[kpi]]] = await Promise.all([
        db.query(`
          SELECT t.id, t.ticket_code, t.title, t.description, t.category, t.priority, t.status, t.area,
                 t.created_by_id, t.created_by_username, t.assigned_to_username, t.resolution_notes,
                 t.resolved_at, t.created_at, t.updated_at,
                 COALESCE(msg_agg.messages_count, 0) AS messages_count,
                 msg_agg.last_message_at,
                 msg_agg.last_author_username
          FROM TICKETS t
          LEFT JOIN (
            SELECT ticket_id,
                   COUNT(*) AS messages_count,
                   MAX(created_at) AS last_message_at,
                   SUBSTRING_INDEX(GROUP_CONCAT(author_username ORDER BY created_at DESC, id DESC), ',', 1) AS last_author_username
            FROM TICKET_MESSAGES
            GROUP BY ticket_id
          ) msg_agg ON msg_agg.ticket_id = t.id
          ${whereClause}
          ORDER BY FIELD(t.status, 'OPEN', 'IN_PROGRESS', 'WAITING_INFO', 'RESOLVED', 'CLOSED', 'REJECTED'),
                   FIELD(t.priority, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'),
                   t.updated_at DESC
          LIMIT 300
        `, params),
        db.query(`
          SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) AS open_count,
            SUM(CASE WHEN status = 'IN_PROGRESS' THEN 1 ELSE 0 END) AS in_progress_count,
            SUM(CASE WHEN status = 'WAITING_INFO' THEN 1 ELSE 0 END) AS waiting_info_count,
            SUM(CASE WHEN status IN ('RESOLVED', 'CLOSED') THEN 1 ELSE 0 END) AS resolved_count,
            SUM(CASE WHEN priority = 'CRITICAL' AND status IN ('OPEN', 'IN_PROGRESS', 'WAITING_INFO') THEN 1 ELSE 0 END) AS critical_open_count
          FROM TICKETS
        `)
      ]);

      return {
        tickets,
        stats: {
          total: Number(kpi?.total) || 0,
          open: Number(kpi?.open_count) || 0,
          in_progress: Number(kpi?.in_progress_count) || 0,
          waiting_info: Number(kpi?.waiting_info_count) || 0,
          resolved: Number(kpi?.resolved_count) || 0,
          critical_open: Number(kpi?.critical_open_count) || 0
        },
        is_software_engineer: isSoftwareEngineer(request.user)
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore nel recupero dei ticket' });
    }
  });

  // GET /api/tickets/:id - Dettaglio ticket con cronologia messaggi
  fastify.get('/:id', async (request, reply) => {
    try {
      const ticketId = Number(request.params.id);
      const [[ticket]] = await db.query(
        `SELECT id, ticket_code, title, description, category, priority, status, area,
                created_by_id, created_by_username, assigned_to_username, resolution_notes,
                resolved_at, created_at, updated_at
         FROM TICKETS WHERE id = ?`,
        [ticketId]
      );
      if (!ticket) {
        return reply.code(404).send({ error: 'Ticket non trovato' });
      }

      const [messages] = await db.query(
        `SELECT id, ticket_id, author_id, author_username, author_role, message, status_change_to, created_at
         FROM TICKET_MESSAGES
         WHERE ticket_id = ?
         ORDER BY created_at ASC, id ASC`,
        [ticketId]
      );

      return {
        ticket,
        messages,
        is_software_engineer: isSoftwareEngineer(request.user)
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore recupero dettaglio ticket' });
    }
  });

  // POST /api/tickets - Crea un nuovo ticket (disponibile a tutti gli utenti autenticati)
  fastify.post('/', async (request, reply) => {
    const { title, description, category = 'BUG', priority = 'MEDIUM', area = 'Generale' } = request.body || {};

    if (!title || !String(title).trim() || !description || !String(description).trim()) {
      return reply.code(400).send({ error: 'Titolo e descrizione del problema sono obbligatori' });
    }

    const cleanPriority = VALID_PRIORITIES.includes(String(priority).toUpperCase())
      ? String(priority).toUpperCase()
      : 'MEDIUM';

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const year = new Date().getFullYear();
      const prefix = `TKT-${year}-`;
      const [seqRows] = await connection.query(
        'SELECT ticket_code FROM TICKETS WHERE ticket_code LIKE ?',
        [`${prefix}%`]
      );
      let maxSeq = 0;
      for (const r of seqRows) {
        const num = parseInt(String(r.ticket_code || '').replace(prefix, ''), 10);
        if (!isNaN(num) && num > maxSeq) maxSeq = num;
      }
      const ticketCode = `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;

      const [res] = await connection.query(
        `INSERT INTO TICKETS
         (ticket_code, title, description, category, priority, status, area, created_by_id, created_by_username)
         VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`,
        [
          ticketCode,
          String(title).trim().slice(0, 255),
          String(description).trim(),
          String(category || 'BUG').trim().toUpperCase().slice(0, 50),
          cleanPriority,
          area ? String(area).trim().slice(0, 100) : 'Generale',
          request.user.id,
          request.user.username
        ]
      );

      const ticketId = res.insertId;

      await connection.query(
        'INSERT INTO AUDIT_LOGS (action, details, source, username) VALUES (?, ?, ?, ?)',
        [
          'CREATE_TICKET',
          `Aperto ticket ${ticketCode} (${cleanPriority}): ${String(title).trim().slice(0, 120)}`,
          'Ticket',
          request.user.username
        ]
      );

      await createNotification(connection, fastify.io, {
        type: 'TICKET_CREATED',
        title: `Nuovo Ticket ${ticketCode} (${cleanPriority})`,
        message: `${request.user.username} ha segnalato: "${String(title).trim()}" (${area || 'Generale'})`,
        entity_type: 'TICKET',
        entity_code: ticketCode,
        link_path: '/desktop/tickets',
        actor_username: request.user.username
      });

      await connection.commit();

      if (fastify.io) {
        fastify.io.emit('ticket_updated', { id: ticketId, ticket_code: ticketCode });
      }

      return reply.code(201).send({ success: true, id: ticketId, ticket_code: ticketCode });
    } catch (err) {
      await connection.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore nella creazione del ticket' });
    } finally {
      connection.release();
    }
  });

  // POST /api/tickets/:id/messages - Aggiunge una risposta (e per Software Engineer anche eventuale cambio stato)
  fastify.post('/:id/messages', async (request, reply) => {
    const ticketId = Number(request.params.id);
    const { message, status, priority, resolution_notes } = request.body || {};
    const isEng = isSoftwareEngineer(request.user);

    if ((!message || !String(message).trim()) && !(isEng && status)) {
      return reply.code(400).send({ error: 'Inserisci un messaggio di risposta' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [[ticket]] = await connection.query(
        'SELECT id, ticket_code, title, status, priority, created_by_username FROM TICKETS WHERE id = ? FOR UPDATE',
        [ticketId]
      );
      if (!ticket) {
        await connection.rollback();
        return reply.code(404).send({ error: 'Ticket non trovato' });
      }

      let nextStatus = null;
      if (status && VALID_STATUSES.includes(String(status).toUpperCase())) {
        if (!isEng) {
          await connection.rollback();
          return reply.code(403).send({ error: 'Solo il ruolo Software Engineering può cambiare lo stato del ticket.' });
        }
        const cand = String(status).toUpperCase();
        if (cand !== ticket.status) nextStatus = cand;
      }

      const finalMsg = (message && String(message).trim())
        ? String(message).trim()
        : `Stato aggiornato a ${STATUS_LABELS[nextStatus] || nextStatus}`;

      await connection.query(
        `INSERT INTO TICKET_MESSAGES
         (ticket_id, author_id, author_username, author_role, message, status_change_to)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          ticketId,
          request.user.id,
          request.user.username,
          request.user.role || 'operator',
          finalMsg,
          nextStatus
        ]
      );

      const updates = ['updated_at = CURRENT_TIMESTAMP'];
      const updParams = [];

      if (nextStatus) {
        updates.push('status = ?');
        updParams.push(nextStatus);
        if (nextStatus === 'RESOLVED' || nextStatus === 'CLOSED') {
          updates.push('resolved_at = CURRENT_TIMESTAMP');
        } else if (nextStatus === 'OPEN' || nextStatus === 'IN_PROGRESS') {
          updates.push('resolved_at = NULL');
        }
      }

      if (isEng) {
        updates.push('assigned_to_username = COALESCE(assigned_to_username, ?)');
        updParams.push(request.user.username);

        if (priority && VALID_PRIORITIES.includes(String(priority).toUpperCase())) {
          updates.push('priority = ?');
          updParams.push(String(priority).toUpperCase());
        }
        if (resolution_notes !== undefined) {
          updates.push('resolution_notes = ?');
          updParams.push(resolution_notes ? String(resolution_notes).trim() : null);
        }
      }

      updParams.push(ticketId);
      await connection.query(`UPDATE TICKETS SET ${updates.join(', ')} WHERE id = ?`, updParams);

      await createNotification(connection, fastify.io, {
        type: 'TICKET_UPDATE',
        title: nextStatus
          ? `Ticket ${ticket.ticket_code}: ${STATUS_LABELS[nextStatus] || nextStatus}`
          : `Nuova risposta su ${ticket.ticket_code}`,
        message: `${request.user.username}: ${finalMsg.slice(0, 140)}`,
        entity_type: 'TICKET',
        entity_code: ticket.ticket_code,
        link_path: '/desktop/tickets',
        actor_username: request.user.username
      });

      await connection.commit();

      if (fastify.io) {
        fastify.io.emit('ticket_updated', { id: ticketId, ticket_code: ticket.ticket_code });
      }

      return { success: true };
    } catch (err) {
      await connection.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore invio risposta ticket' });
    } finally {
      connection.release();
    }
  });

  // PUT /api/tickets/:id/status - Aggiorna stato/priorità/assegnazione (SOLO Software Engineering)
  fastify.put('/:id/status', async (request, reply) => {
    if (!isSoftwareEngineer(request.user)) {
      return reply.code(403).send({ error: 'Accesso negato: solo il ruolo Software Engineering può gestire lo stato dei ticket.' });
    }

    const ticketId = Number(request.params.id);
    const { status, priority, assigned_to_username, resolution_notes, note_message } = request.body || {};

    if (status && !VALID_STATUSES.includes(String(status).toUpperCase())) {
      return reply.code(400).send({ error: 'Stato ticket non valido' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [[ticket]] = await connection.query(
        'SELECT id, ticket_code, title, status FROM TICKETS WHERE id = ? FOR UPDATE',
        [ticketId]
      );
      if (!ticket) {
        await connection.rollback();
        return reply.code(404).send({ error: 'Ticket non trovato' });
      }

      const nextStatus = status ? String(status).toUpperCase() : ticket.status;
      const statusChanged = nextStatus !== ticket.status;

      const updates = ['status = ?'];
      const params = [nextStatus];

      if (nextStatus === 'RESOLVED' || nextStatus === 'CLOSED') {
        updates.push('resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP)');
      } else if (nextStatus === 'OPEN' || nextStatus === 'IN_PROGRESS') {
        updates.push('resolved_at = NULL');
      }

      if (priority && VALID_PRIORITIES.includes(String(priority).toUpperCase())) {
        updates.push('priority = ?');
        params.push(String(priority).toUpperCase());
      }

      if (assigned_to_username !== undefined) {
        updates.push('assigned_to_username = ?');
        params.push(assigned_to_username || null);
      } else {
        updates.push('assigned_to_username = COALESCE(assigned_to_username, ?)');
        params.push(request.user.username);
      }

      if (resolution_notes !== undefined) {
        updates.push('resolution_notes = ?');
        params.push(resolution_notes ? String(resolution_notes).trim() : null);
      }

      params.push(ticketId);
      await connection.query(`UPDATE TICKETS SET ${updates.join(', ')} WHERE id = ?`, params);

      if (statusChanged || (note_message && String(note_message).trim())) {
        const msgText = (note_message && String(note_message).trim())
          ? String(note_message).trim()
          : `Stato cambiato da ${STATUS_LABELS[ticket.status] || ticket.status} a ${STATUS_LABELS[nextStatus] || nextStatus}${resolution_notes ? ` — Note: ${String(resolution_notes).trim()}` : ''}`;

        await connection.query(
          `INSERT INTO TICKET_MESSAGES
           (ticket_id, author_id, author_username, author_role, message, status_change_to)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            ticketId,
            request.user.id,
            request.user.username,
            request.user.role || 'developer',
            msgText,
            statusChanged ? nextStatus : null
          ]
        );
      }

      if (statusChanged) {
        await createNotification(connection, fastify.io, {
          type: 'TICKET_UPDATE',
          title: `Ticket ${ticket.ticket_code}: ${STATUS_LABELS[nextStatus] || nextStatus}`,
          message: `${request.user.username} ha impostato "${ticket.title}" come ${STATUS_LABELS[nextStatus] || nextStatus}`,
          entity_type: 'TICKET',
          entity_code: ticket.ticket_code,
          link_path: '/desktop/tickets',
          actor_username: request.user.username
        });
      }

      await connection.commit();

      if (fastify.io) {
        fastify.io.emit('ticket_updated', { id: ticketId, ticket_code: ticket.ticket_code });
      }

      return { success: true, status: nextStatus };
    } catch (err) {
      await connection.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore aggiornamento stato ticket' });
    } finally {
      connection.release();
    }
  });

  // DELETE /api/tickets/:id
  fastify.delete('/:id', async (request, reply) => {
    const ticketId = Number(request.params.id);
    try {
      const [[ticket]] = await db.query('SELECT id, ticket_code, created_by_id, status FROM TICKETS WHERE id = ?', [ticketId]);
      if (!ticket) return reply.code(404).send({ error: 'Ticket non trovato' });

      const isEng = isSoftwareEngineer(request.user);
      const isCreatorOpen = ticket.created_by_id === request.user.id && ticket.status === 'OPEN';
      if (!isEng && !isCreatorOpen) {
        return reply.code(403).send({ error: 'Non hai i permessi per eliminare questo ticket.' });
      }

      await db.query('DELETE FROM TICKETS WHERE id = ?', [ticketId]);
      if (fastify.io) {
        fastify.io.emit('ticket_updated', { id: ticketId, deleted: true });
      }
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore eliminazione ticket' });
    }
  });
}

module.exports = ticketsRoutes;
