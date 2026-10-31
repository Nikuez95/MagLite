const db = require('../config/db');
const bcrypt = require('bcrypt');
const { hasPermission, resolveUserAccess } = require('../utils/permissions');

function parseJsonSafe(val, fallback = null) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

function generateSessionCode(prefix = 'ARR') {
  const d = new Date();
  const dateStr = d.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${dateStr}-${rand}`;
}

async function customFormsRoutes(fastify, options) {
  fastify.addHook('onRequest', fastify.authenticate);

  // 1. GET /api/custom-forms - Lista di tutti i form
  fastify.get('/', async (request, reply) => {
    try {
      const { target, active_only } = request.query || {};
      let query = 'SELECT * FROM CUSTOM_FORMS WHERE 1=1';
      const params = [];

      if (active_only === 'true' || active_only === '1') {
        query += ' AND is_active = 1';
      }
      if (target) {
        query += ' AND (target_device = ? OR target_device = "BOTH")';
        params.push(target);
      }
      query += ' ORDER BY id ASC';

      const [rows] = await db.query(query, params);
      const forms = rows.map(f => ({
        ...f,
        is_active: Boolean(f.is_active),
        is_default: Boolean(f.is_default),
        icon: f.icon || 'ClipboardList',
        color_accent: f.color_accent || 'blue',
        display_mode: f.display_mode || 'SHOW_ON_HOME',
        steps: parseJsonSafe(f.steps, [])
      }));

      return forms;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore nel recupero dei form dinamici.' });
    }
  });

  // 2. GET /api/custom-forms/lookup-checkin - Ricerca rapida check-in per numero DDT o Container
  fastify.get('/lookup-checkin', async (request, reply) => {
    try {
      const { query } = request.query || {};
      const q = String(query || '').trim();
      if (!q) return [];

      const [rows] = await db.query(`
        SELECT s.id, s.session_code, s.status, s.operator_name, s.answers, s.created_at, s.approved_by_name,
               f.title as form_title
        FROM CUSTOM_FORM_SUBMISSIONS s
        JOIN CUSTOM_FORMS f ON s.form_id = f.id
        WHERE s.session_code LIKE ?
           OR JSON_UNQUOTE(JSON_EXTRACT(s.answers, '$.step_ddt')) LIKE ?
           OR JSON_UNQUOTE(JSON_EXTRACT(s.answers, '$.step_container')) LIKE ?
           OR JSON_UNQUOTE(JSON_EXTRACT(s.answers, '$.step_sigillo_num')) LIKE ?
        ORDER BY s.id DESC
        LIMIT 6
      `, [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`]);

      return rows.map(r => {
        const ans = parseJsonSafe(r.answers, {});
        return {
          id: r.id,
          session_code: r.session_code,
          status: r.status,
          operator_name: r.operator_name,
          created_at: r.created_at,
          vehicle_type: ans.step_mezzo || null,
          ddt: ans.step_ddt || null,
          container: ans.step_container || null,
          seal: ans.step_sigillo === 'SI' ? (ans.step_sigillo_num || 'Presente') : (ans.step_sigillo ? 'Assente / QA' : null),
          temperature: ans.step_temp_value !== undefined ? ans.step_temp_value : null,
          temp_range: ans.step_temp_range || null,
          approved_by_name: r.approved_by_name || null
        };
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante la ricerca del check-in.' });
    }
  });

  // 3. GET /api/custom-forms/:id - Dettaglio singolo form
  fastify.get('/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      let rows;
      if (/^\d+$/.test(id)) {
        [rows] = await db.query('SELECT * FROM CUSTOM_FORMS WHERE id = ?', [Number(id)]);
      } else {
        [rows] = await db.query('SELECT * FROM CUSTOM_FORMS WHERE code = ?', [id]);
      }

      if (!rows || rows.length === 0) {
        return reply.code(404).send({ error: 'Form non trovato.' });
      }

      const form = {
        ...rows[0],
        is_active: Boolean(rows[0].is_active),
        is_default: Boolean(rows[0].is_default),
        icon: rows[0].icon || 'ClipboardList',
        color_accent: rows[0].color_accent || 'blue',
        display_mode: rows[0].display_mode || 'SHOW_ON_HOME',
        steps: parseJsonSafe(rows[0].steps, [])
      };
      return form;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore nel recupero del form.' });
    }
  });

  // 4. POST /api/custom-forms - Creazione nuovo form
  fastify.post('/', async (request, reply) => {
    if (!hasPermission(request.user, 'manage_custom_forms')) {
      return reply.code(403).send({ error: 'Accesso negato: permesso manage_custom_forms richiesto.' });
    }

    const { code, title, description, category, target_device, is_active, steps, icon, color_accent, display_mode, is_default } = request.body || {};
    const cleanCode = String(code || '').trim().toUpperCase();
    const cleanTitle = String(title || '').trim();
    const cleanIcon = String(icon || 'ClipboardList').trim();
    const cleanColor = String(color_accent || 'blue').trim();
    const cleanMode = String(display_mode || 'SHOW_ON_HOME').trim();
    const isDefault = Boolean(is_default);

    if (!cleanCode || !cleanTitle) {
      return reply.code(400).send({ error: 'Codice e Titolo del form sono obbligatori.' });
    }

    try {
      const [existing] = await db.query('SELECT id FROM CUSTOM_FORMS WHERE code = ?', [cleanCode]);
      if (existing.length > 0) {
        return reply.code(409).send({ error: `Un modulo con codice "${cleanCode}" esiste già.` });
      }

      if (isDefault) {
        await db.query('UPDATE CUSTOM_FORMS SET is_default = 0');
      }

      const stepsJson = JSON.stringify(Array.isArray(steps) ? steps : []);
      const [res] = await db.query(
        `INSERT INTO CUSTOM_FORMS (code, title, description, category, target_device, is_active, steps, icon, color_accent, display_mode, is_default, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          cleanCode,
          cleanTitle,
          description || null,
          category || 'INBOUND',
          target_device || 'ZEBRA',
          is_active !== false ? 1 : 0,
          stepsJson,
          cleanIcon,
          cleanColor,
          cleanMode,
          isDefault ? 1 : 0,
          request.user?.username || 'Sistema'
        ]
      );

      // Audit log
      try {
        await db.query(
          'INSERT INTO AUDIT_LOGS (user_id, username, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)',
          [request.user?.id, request.user?.username, 'CREATE_CUSTOM_FORM', 'CUSTOM_FORMS', res.insertId, JSON.stringify({ code: cleanCode, title: cleanTitle })]
        );
      } catch (logErr) {}

      return {
        id: res.insertId,
        code: cleanCode,
        title: cleanTitle,
        message: 'Modulo personalizzato creato con successo.'
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante la creazione del modulo.' });
    }
  });

  // 5. PUT /api/custom-forms/:id - Modifica form esistente
  fastify.put('/:id', async (request, reply) => {
    if (!hasPermission(request.user, 'manage_custom_forms')) {
      return reply.code(403).send({ error: 'Accesso negato: permesso manage_custom_forms richiesto.' });
    }

    const { id } = request.params;
    const { title, description, category, target_device, is_active, steps, icon, color_accent, display_mode, is_default } = request.body || {};

    try {
      const [existing] = await db.query('SELECT * FROM CUSTOM_FORMS WHERE id = ?', [Number(id)]);
      if (existing.length === 0) {
        return reply.code(404).send({ error: 'Modulo non trovato.' });
      }

      const current = existing[0];
      const newTitle = title !== undefined ? String(title).trim() : current.title;
      const newDesc = description !== undefined ? description : current.description;
      const newCat = category !== undefined ? category : current.category;
      const newTarget = target_device !== undefined ? target_device : current.target_device;
      const newActive = is_active !== undefined ? (is_active ? 1 : 0) : current.is_active;
      const newSteps = steps !== undefined ? JSON.stringify(steps) : current.steps;
      const newIcon = icon !== undefined ? String(icon).trim() : (current.icon || 'ClipboardList');
      const newColor = color_accent !== undefined ? String(color_accent).trim() : (current.color_accent || 'blue');
      const newMode = display_mode !== undefined ? String(display_mode).trim() : (current.display_mode || 'SHOW_ON_HOME');
      const newIsDefault = is_default !== undefined ? (is_default ? 1 : 0) : current.is_default;

      if (newIsDefault) {
        await db.query('UPDATE CUSTOM_FORMS SET is_default = 0 WHERE id != ?', [Number(id)]);
      }

      await db.query(
        `UPDATE CUSTOM_FORMS
         SET title = ?, description = ?, category = ?, target_device = ?, is_active = ?, steps = ?, icon = ?, color_accent = ?, display_mode = ?, is_default = ?
         WHERE id = ?`,
        [newTitle, newDesc, newCat, newTarget, newActive, newSteps, newIcon, newColor, newMode, newIsDefault, Number(id)]
      );

      // Audit log
      try {
        await db.query(
          'INSERT INTO AUDIT_LOGS (user_id, username, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)',
          [request.user?.id, request.user?.username, 'UPDATE_CUSTOM_FORM', 'CUSTOM_FORMS', Number(id), JSON.stringify({ title: newTitle, is_active: newActive })]
        );
      } catch (logErr) {}

      return { success: true, message: 'Modulo aggiornato con successo.' };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante l\'aggiornamento del modulo.' });
    }
  });

  // 6. DELETE /api/custom-forms/:id - Eliminazione o disattivazione form
  fastify.delete('/:id', async (request, reply) => {
    if (!hasPermission(request.user, 'delete_custom_forms') && !hasPermission(request.user, 'manage_custom_forms')) {
      return reply.code(403).send({ error: 'Accesso negato: permesso delete_custom_forms richiesto per eliminare moduli.' });
    }

    const { id } = request.params;
    try {
      const [existing] = await db.query('SELECT * FROM CUSTOM_FORMS WHERE id = ?', [Number(id)]);
      if (existing.length === 0) {
        return reply.code(404).send({ error: 'Modulo non trovato.' });
      }

      // Il modulo base ARRIVO_MERCE non può essere eliminato fisicamente (solo disattivato)
      if (existing[0].code === 'ARRIVO_MERCE') {
        await db.query('UPDATE CUSTOM_FORMS SET is_active = 0 WHERE id = ?', [Number(id)]);
        return { success: true, message: 'Modulo base disattivato (non eliminabile fisicamente).' };
      }

      await db.query('DELETE FROM CUSTOM_FORMS WHERE id = ?', [Number(id)]);
      return { success: true, message: 'Modulo eliminato definitivamente dal catalogo.' };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante l\'eliminazione del modulo.' });
    }
  });

  // 7. DELETE /api/custom-forms/submissions/:id - Eliminazione arrivo/check-in
  fastify.delete('/submissions/:id', async (request, reply) => {
    if (!hasPermission(request.user, 'delete_checkin')) {
      return reply.code(403).send({ error: 'Accesso negato: permesso delete_checkin richiesto per eliminare registrazioni arrivi.' });
    }

    const { id } = request.params;
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query('SELECT * FROM CUSTOM_FORM_SUBMISSIONS WHERE id = ?', [Number(id)]);
      if (rows.length === 0) {
        connection.release();
        return reply.code(404).send({ error: 'Registrazione arrivo non trovata.' });
      }

      const sub = rows[0];

      // Scollega eventuali palette o DDT legati a questo check-in
      await connection.query('UPDATE PALLETS SET checkin_id = NULL, checkin_session_code = NULL WHERE checkin_id = ?', [sub.id]);
      await connection.query('UPDATE INBOUND_DDTS SET checkin_id = NULL, checkin_session_code = NULL WHERE checkin_id = ?', [sub.id]);

      // Elimina la submission
      await connection.query('DELETE FROM CUSTOM_FORM_SUBMISSIONS WHERE id = ?', [sub.id]);

      // Audit log
      try {
        await connection.query(
          'INSERT INTO AUDIT_LOGS (user_id, username, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)',
          [request.user?.id, request.user?.username, 'DELETE_CHECKIN_SUBMISSION', 'CUSTOM_FORM_SUBMISSIONS', sub.id, JSON.stringify({ session_code: sub.session_code, operator: sub.operator_name })]
        );
      } catch (logErr) {}

      await connection.commit();
      return { success: true, message: `Registrazione arrivo ${sub.session_code} eliminata con successo.` };
    } catch (err) {
      await connection.rollback();
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante l\'eliminazione della registrazione arrivo.' });
    } finally {
      connection.release();
    }
  });

  // 8. POST /api/custom-forms/sessions/start - Avvia una nuova compilazione / sessione arrivo
  fastify.post('/sessions/start', async (request, reply) => {
    const { form_code, form_id, metadata } = request.body || {};
    try {
      let formRow;
      if (form_id) {
        const [rows] = await db.query('SELECT * FROM CUSTOM_FORMS WHERE id = ? AND is_active = 1', [form_id]);
        formRow = rows[0];
      } else if (form_code && String(form_code).trim()) {
        const code = String(form_code).trim().toUpperCase();
        const [rows] = await db.query('SELECT * FROM CUSTOM_FORMS WHERE code = ? AND is_active = 1', [code]);
        formRow = rows[0];
      } else {
        const [rows] = await db.query('SELECT * FROM CUSTOM_FORMS WHERE is_default = 1 AND is_active = 1 LIMIT 1');
        if (rows.length > 0) {
          formRow = rows[0];
        } else {
          const [defRows] = await db.query("SELECT * FROM CUSTOM_FORMS WHERE code = 'ARRIVO_MERCE' AND is_active = 1");
          formRow = defRows[0];
        }
      }

      if (!formRow) {
        return reply.code(404).send({ error: 'Modulo non attivo o inesistente.' });
      }

      const steps = parseJsonSafe(formRow.steps, []);
      const initialStepId = steps.length > 0 ? steps[0].id : null;
      const sessionCode = generateSessionCode(formRow.code === 'ARRIVO_MERCE' ? 'ARR' : 'CHK');

      const [res] = await db.query(
        `INSERT INTO CUSTOM_FORM_SUBMISSIONS (
          form_id, session_code, status, current_step_id, operator_id, operator_name, answers, metadata
        ) VALUES (?, ?, 'IN_PROGRESS', ?, ?, ?, ?, ?)`,
        [
          formRow.id,
          sessionCode,
          initialStepId,
          request.user?.id || null,
          request.user?.username || 'Operatore',
          JSON.stringify({}),
          JSON.stringify(metadata || {})
        ]
      );

      return {
        submission_id: res.insertId,
        session_code: sessionCode,
        form: {
          id: formRow.id,
          code: formRow.code,
          title: formRow.title,
          description: formRow.description,
          steps
        },
        current_step_id: initialStepId
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore nell\'avvio della sessione.' });
    }
  });

  // 9. POST /api/custom-forms/sessions/:session_code/step - Salva step e avanza
  fastify.post('/sessions/:session_code/step', async (request, reply) => {
    const { session_code } = request.params;
    const { step_id, answer, next_step_id, is_standby, standby_reason, is_completed, is_rejected, rejection_reason } = request.body || {};

    try {
      const [subRows] = await db.query('SELECT * FROM CUSTOM_FORM_SUBMISSIONS WHERE session_code = ?', [session_code]);
      if (subRows.length === 0) {
        return reply.code(404).send({ error: 'Sessione non trovata.' });
      }

      const sub = subRows[0];
      if (sub.status === 'COMPLETED' || sub.status === 'ABORTED') {
        return reply.code(400).send({ error: `La sessione è già conclusa con stato ${sub.status}.` });
      }

      const currentAnswers = parseJsonSafe(sub.answers, {});
      if (step_id) {
        currentAnswers[step_id] = answer;
      }

      let newStatus = sub.status;
      let newStandbyReason = sub.standby_reason;
      let newRejectionReason = sub.rejection_reason;
      let completedAt = sub.completed_at;

      if (is_standby) {
        newStatus = 'STANDBY_APPROVAL';
        newStandbyReason = standby_reason || 'In attesa di sblocco QA/Ufficio';
      } else if (is_rejected) {
        newStatus = 'REJECTED';
        newRejectionReason = rejection_reason || 'Non conforme allo scarico';
        completedAt = new Date();
      } else if (is_completed) {
        newStatus = 'COMPLETED';
        completedAt = new Date();
      }

      await db.query(
        `UPDATE CUSTOM_FORM_SUBMISSIONS
         SET answers = ?, current_step_id = ?, status = ?, standby_reason = ?, rejection_reason = ?, completed_at = ?
         WHERE id = ?`,
        [
          JSON.stringify(currentAnswers),
          next_step_id || sub.current_step_id,
          newStatus,
          newStandbyReason,
          newRejectionReason,
          completedAt,
          sub.id
        ]
      );

      // Notifica in tempo reale via WebSocket se lo stato è andato in STANDBY
      if (is_standby && fastify.io) {
        fastify.io.emit('custom_form_standby_alert', {
          session_code,
          operator_name: sub.operator_name,
          standby_reason: newStandbyReason,
          timestamp: new Date().toISOString()
        });
      }

      return {
        session_code,
        status: newStatus,
        current_step_id: next_step_id || sub.current_step_id,
        answers: currentAnswers
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante il salvataggio dello step.' });
    }
  });

  // 10. POST /api/custom-forms/sessions/:session_code/approve - Sblocca standby (Desktop o Zebra con supervisore)
  fastify.post('/sessions/:session_code/approve', async (request, reply) => {
    const { session_code } = request.params;
    const { supervisor_username, supervisor_password, approval_notes, next_step_id } = request.body || {};

    try {
      const [subRows] = await db.query('SELECT * FROM CUSTOM_FORM_SUBMISSIONS WHERE session_code = ?', [session_code]);
      if (subRows.length === 0) {
        return reply.code(404).send({ error: 'Sessione non trovata.' });
      }

      const sub = subRows[0];
      let approverUser = null;

      // Se fornito supervisore su terminale Zebra, verifichiamo le sue credenziali
      if (supervisor_username && supervisor_password) {
        const [userRows] = await db.query('SELECT * FROM USERS WHERE username = ?', [supervisor_username]);
        if (userRows.length === 0) {
          return reply.code(401).send({ error: 'Utente supervisore non trovato.' });
        }
        const match = await bcrypt.compare(supervisor_password, userRows[0].password_hash);
        if (!match) {
          return reply.code(401).send({ error: 'Password supervisore non valida.' });
        }
        const access = await resolveUserAccess(userRows[0].id, db);
        if (!hasPermission(access, 'approve_custom_forms') && access.role !== 'developer') {
          return reply.code(403).send({ error: 'Questo utente non possiede il permesso di sblocco QA/GDP.' });
        }
        approverUser = access;
      } else {
        // Altrimenti verifica i permessi dell'utente che sta chiamando l'API (es. da desktop)
        if (!hasPermission(request.user, 'approve_custom_forms') && request.user.role !== 'developer') {
          return reply.code(403).send({ error: 'Non hai i permessi per sbloccare la procedura in standby (approve_custom_forms richiesto).' });
        }
        approverUser = request.user;
      }

      // Risolvi prossimo step se fornito o cerca nel form
      const [formRows] = await db.query('SELECT steps FROM CUSTOM_FORMS WHERE id = ?', [sub.form_id]);
      const steps = formRows.length > 0 ? parseJsonSafe(formRows[0].steps, []) : [];
      const currentStepObj = steps.find(s => s.id === sub.current_step_id);
      const targetNextStep = next_step_id || currentStepObj?.next_step_id_on_approved || 'step_temp_check';

      await db.query(
        `UPDATE CUSTOM_FORM_SUBMISSIONS
         SET status = 'IN_PROGRESS',
             current_step_id = ?,
             approved_by = ?,
             approved_by_name = ?,
             approved_at = NOW(),
             approval_notes = ?
         WHERE id = ?`,
        [
          targetNextStep,
          approverUser.id,
          approverUser.username,
          approval_notes || 'Autorizzato da supervisore/ufficio',
          sub.id
        ]
      );

      // Notifica WebSocket per sbloccare istantaneamente lo Zebra
      if (fastify.io) {
        fastify.io.emit('custom_form_approval', {
          session_code,
          status: 'APPROVED',
          approved_by_name: approverUser.username,
          approval_notes: approval_notes || 'Autorizzato',
          next_step_id: targetNextStep,
          timestamp: new Date().toISOString()
        });
      }

      // Audit log
      try {
        await db.query(
          'INSERT INTO AUDIT_LOGS (user_id, username, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)',
          [approverUser.id, approverUser.username, 'APPROVE_CUSTOM_FORM_STANDBY', 'CUSTOM_FORM_SUBMISSIONS', sub.id, JSON.stringify({ session_code, notes: approval_notes })]
        );
      } catch (logErr) {}

      return {
        success: true,
        message: `Sessione ${session_code} sbloccata da ${approverUser.username}.`,
        next_step_id: targetNextStep
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore nello sblocco della procedura in standby.' });
    }
  });

  // 11. POST /api/custom-forms/sessions/:session_code/abort - Annulla arrivo
  fastify.post('/sessions/:session_code/abort', async (request, reply) => {
    const { session_code } = request.params;
    const { reason } = request.body || {};

    try {
      const [subRows] = await db.query('SELECT * FROM CUSTOM_FORM_SUBMISSIONS WHERE session_code = ?', [session_code]);
      if (subRows.length === 0) {
        return reply.code(404).send({ error: 'Sessione non trovata.' });
      }

      const sub = subRows[0];
      const currentAnswers = parseJsonSafe(sub.answers, {});

      // Se non è stato completato nemmeno il primo step (0 risposte registrate),
      // eliminiamo fisicamente il record per non intasare il database con aperture accidentali.
      if (Object.keys(currentAnswers).length === 0) {
        await db.query('DELETE FROM CUSTOM_FORM_SUBMISSIONS WHERE id = ?', [sub.id]);
        return { success: true, message: `Sessione ${session_code} eliminata (nessun dato registrato).` };
      }

      await db.query(
        `UPDATE CUSTOM_FORM_SUBMISSIONS
         SET status = 'ABORTED', rejection_reason = ?, completed_at = NOW()
         WHERE id = ?`,
        [reason || 'Annullato dall\'operatore o ufficio', sub.id]
      );

      if (fastify.io) {
        fastify.io.emit('custom_form_aborted', {
          session_code,
          reason: reason || 'Annullato',
          timestamp: new Date().toISOString()
        });
      }

      return { success: true, message: `Sessione ${session_code} annullata.` };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore nell\'annullamento della sessione.' });
    }
  });

  // 11.b GET /api/custom-forms/sessions/:session_code - Recupero dettagli e stato sessione
  fastify.get('/sessions/:session_code', async (request, reply) => {
    try {
      const { session_code } = request.params;
      const [rows] = await db.query(`
        SELECT s.*, f.title as form_title, f.code as form_code, f.steps as form_steps, f.icon as form_icon, f.color_accent as form_color, f.steps as form_steps, f.icon as form_icon, f.color_accent as form_color
        FROM CUSTOM_FORM_SUBMISSIONS s
        JOIN CUSTOM_FORMS f ON s.form_id = f.id
        WHERE s.session_code = ?
      `, [session_code]);

      if (rows.length === 0) {
        return reply.code(404).send({ error: 'Sessione non trovata.' });
      }

      const row = rows[0];
      return {
        ...row,
        answers: parseJsonSafe(row.answers, {}),
        metadata: parseJsonSafe(row.metadata, {}),
        form: {
          id: row.form_id,
          code: row.form_code,
          title: row.form_title,
          icon: row.form_icon || 'ClipboardList',
          color_accent: row.form_color || 'blue',
          steps: parseJsonSafe(row.form_steps, [])
        }
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore nel recupero della sessione.' });
    }
  });

  // 11.c POST /api/custom-forms/sessions/check-duplicate - Controllo duplicati DDT / Container & Ripresa
  fastify.post('/sessions/check-duplicate', async (request, reply) => {
    try {
      const { query, current_session_code, type } = request.body || {};
      const cleanQuery = String(query || '').trim();
      if (!cleanQuery) {
        return { found: false };
      }

      let sql = `
        SELECT s.*, f.title as form_title, f.code as form_code, f.steps as form_steps, f.icon as form_icon, f.color_accent as form_color, f.steps as form_steps, f.icon as form_icon, f.color_accent as form_color
        FROM CUSTOM_FORM_SUBMISSIONS s
        JOIN CUSTOM_FORMS f ON s.form_id = f.id
        WHERE (
          JSON_SEARCH(s.answers, 'one', ?) IS NOT NULL
          OR JSON_UNQUOTE(JSON_EXTRACT(s.answers, '$.step_ddt')) = ?
          OR JSON_UNQUOTE(JSON_EXTRACT(s.answers, '$.step_container')) = ?
          OR JSON_UNQUOTE(JSON_EXTRACT(s.answers, '$.numero_ddt')) = ?
          OR JSON_UNQUOTE(JSON_EXTRACT(s.answers, '$.numero_container')) = ?
        )
      `;
      const params = [cleanQuery, cleanQuery, cleanQuery, cleanQuery, cleanQuery];

      if (current_session_code) {
        sql += ' AND s.session_code != ?';
        params.push(current_session_code);
      }

      sql += ' ORDER BY s.id DESC LIMIT 1';

      const [rows] = await db.query(sql, params);
      if (rows.length === 0) {
        return { found: false };
      }

      const existing = rows[0];
      const answers = parseJsonSafe(existing.answers, {});

      const eventDate = existing.completed_at ? new Date(existing.completed_at) : new Date(existing.created_at);
      const today = new Date();
      const isSameDay = (
        eventDate.getFullYear() === today.getFullYear() &&
        eventDate.getMonth() === today.getMonth() &&
        eventDate.getDate() === today.getDate()
      );

      const ddtVal = answers.step_ddt || answers.numero_ddt || null;
      const containerVal = answers.step_container || answers.numero_container || null;

      return {
        found: true,
        submission: {
          id: existing.id,
          session_code: existing.session_code,
          status: existing.status,
          current_step_id: existing.current_step_id,
          operator_name: existing.operator_name,
          answers,
          created_at: existing.created_at,
          completed_at: existing.completed_at,
          standby_reason: existing.standby_reason,
          vehicle_type: answers.step_mezzo || (containerVal ? 'Container' : 'Camion'),
          ddt: ddtVal,
          container: containerVal,
          is_same_day: isSameDay,
          event_date_formatted: eventDate.toLocaleDateString('it-IT'),
          event_time_formatted: eventDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
        }
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore durante la verifica dei duplicati.' });
    }
  });

  // 12. GET /api/custom-forms/submissions - Storico registrazioni arrivi con merce scaricata
  fastify.get('/submissions', async (request, reply) => {
    if (!hasPermission(request.user, 'view_custom_forms') && !hasPermission(request.user, 'manage_custom_forms')) {
      return reply.code(403).send({ error: 'Accesso negato: permesso view_custom_forms richiesto.' });
    }

    try {
      const { status, form_id, search, limit = 100 } = request.query || {};
      let query = `
        SELECT s.*, f.title as form_title, f.code as form_code, f.steps as form_steps, f.icon as form_icon, f.color_accent as form_color
        FROM CUSTOM_FORM_SUBMISSIONS s
        JOIN CUSTOM_FORMS f ON s.form_id = f.id
        WHERE 1=1
      `;
      const params = [];

      if (status && status !== 'ALL') {
        query += ' AND s.status = ?';
        params.push(status);
      }
      if (form_id) {
        query += ' AND s.form_id = ?';
        params.push(form_id);
      }
      if (search && String(search).trim()) {
        const s = `%${String(search).trim()}%`;
        query += ' AND (s.session_code LIKE ? OR s.operator_name LIKE ? OR s.answers LIKE ?)';
        params.push(s, s, s);
      }

      query += ' ORDER BY s.id DESC LIMIT ?';
      params.push(Number(limit) || 100);

      const [rows] = await db.query(query, params);

      // Carica per ogni check-in le palette / merce effettivamente scaricata
      const parsed = await Promise.all(rows.map(async (r) => {
        const answers = parseJsonSafe(r.answers, {});
        const ddtVal = answers.step_ddt && String(answers.step_ddt).trim() ? String(answers.step_ddt).trim() : null;
        const contVal = answers.step_container && String(answers.step_container).trim() ? String(answers.step_container).trim() : null;

        let unloadedGoods = [];
        try {
          const [pallets] = await db.query(`
            SELECT p.id, p.pallet_code, p.quantity, COALESCE(p.pallet_uom, pr.uom) as uom, p.batch, p.location,
                   p.status, p.created_at, pr.sku, pr.name as product_name, c.business_name as customer_name
            FROM PALLETS p
            JOIN PRODUCTS pr ON p.product_id = pr.id
            JOIN CUSTOMERS c ON p.customer_id = c.id
            WHERE p.checkin_id = ?
               OR p.checkin_session_code = ?
               OR (? IS NOT NULL AND p.client_ddt = ?)
               OR (? IS NOT NULL AND p.client_ddt = ?)
            ORDER BY p.id ASC
          `, [r.id, r.session_code, ddtVal, ddtVal, contVal, contVal]);
          unloadedGoods = pallets;
        } catch (e) {}

        return {
          ...r,
          answers,
          metadata: parseJsonSafe(r.metadata, {}),
          form_steps: parseJsonSafe(r.form_steps, []),
          form_icon: r.form_icon || 'ClipboardList',
          form_color: r.form_color || 'blue',
          unloaded_goods: unloadedGoods,
          unloaded_pallets_count: unloadedGoods.length
        };
      }));

      return parsed;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore nel recupero delle registrazioni.' });
    }
  });

  // 13. GET /api/custom-forms/submissions/pending-standby - Conta e lista arrivi in attesa di sblocco
  fastify.get('/submissions/pending-standby', async (request, reply) => {
    try {
      const [rows] = await db.query(`
        SELECT s.*, f.title as form_title, f.code as form_code, f.steps as form_steps, f.icon as form_icon, f.color_accent as form_color
        FROM CUSTOM_FORM_SUBMISSIONS s
        JOIN CUSTOM_FORMS f ON s.form_id = f.id
        WHERE s.status = 'STANDBY_APPROVAL'
        ORDER BY s.id DESC
      `);

      return {
        count: rows.length,
        items: rows.map(r => ({
          ...r,
          answers: parseJsonSafe(r.answers, {}),
          metadata: parseJsonSafe(r.metadata, {})
        }))
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Errore nel recupero degli arrivi in standby.' });
    }
  });
}

module.exports = customFormsRoutes;
