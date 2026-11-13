const db = require('../config/db');
const { hasPermission } = require('../utils/permissions');
const { withNamedLock } = require('../utils/concurrency');

function formatDateTimeForMysql(dtStr) {
    if (!dtStr) return null;
    if (String(dtStr).includes('T')) {
        return String(dtStr).replace('T', ' ').slice(0, 19);
    }
    return dtStr;
}

function parseTripNotes(trip) {
    if (trip.notes) {
        try {
            trip.notes = typeof trip.notes === 'string' ? JSON.parse(trip.notes) : trip.notes;
        } catch (e) {
            trip.notes = [];
        }
    } else {
        trip.notes = [];
    }
    return trip;
}

async function getTmsBoardData(connection) {
    const [drivers] = await connection.query('SELECT * FROM TMS_DRIVERS ORDER BY sort_order ASC, id ASC');
    const [trips] = await connection.query('SELECT * FROM TMS_TRIPS ORDER BY sort_order ASC, id ASC');
    const [metaRows] = await connection.query('SELECT version FROM TMS_META WHERE id = 1');
    const version = metaRows.length > 0 ? Number(metaRows[0].version) : 1;

    const columns = { unassigned: [] };
    drivers.forEach(d => { columns[d.id] = []; });

    trips.forEach(t => {
        parseTripNotes(t);
        if (!t.driver_id || t.driver_id === 'unassigned' || !columns[t.driver_id]) {
            columns.unassigned.push(t);
        } else {
            columns[t.driver_id].push(t);
        }
    });

    return { drivers, columns, version };
}

async function bumpTmsVersion(connection, username) {
    await connection.query(
        'INSERT INTO TMS_META (id, version, updated_by) VALUES (1, 1, ?) ON DUPLICATE KEY UPDATE version = version + 1, updated_by = VALUES(updated_by)',
        [username || 'Sistema']
    );
    const [[row]] = await connection.query('SELECT version FROM TMS_META WHERE id = 1');
    return row ? Number(row.version) : 1;
}

async function tmsRoutes(fastify, options) {
    const emitTmsUpdate = (version, actor, type, entityId = null) => {
        if (fastify.io) {
            fastify.io.emit('tms_updated', { version, actor, type, entityId });
            fastify.io.emit('dashboard_update');
        }
    };

    // GET all TMS data
    fastify.get('/', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        if (!hasPermission(request.user, 'view_tms') && !hasPermission(request.user, 'tms_manage')) {
            return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di visualizzare il modulo TMS.' });
        }

        try {
            return await getTmsBoardData(db);
        } catch (error) {
            fastify.log.error(error);
            reply.code(500).send({ error: error.message });
        }
    });

    // POST /api/tms/drivers - Crea singolo autista (concurrency-safe)
    fastify.post('/drivers', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        if (!hasPermission(request.user, 'tms_manage')) {
            return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di gestire gli autisti TMS.' });
        }
        const { id, name, vehicle, phone } = request.body || {};
        if (!name || !String(name).trim()) {
            return reply.code(400).send({ error: 'Nome autista obbligatorio' });
        }
        const driverId = id || `drv-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const [[maxRow]] = await connection.query('SELECT COALESCE(MAX(sort_order), -1) AS maxSort FROM TMS_DRIVERS');
            const sortOrder = Number(maxRow?.maxSort ?? -1) + 1;
            await connection.query(
                'INSERT INTO TMS_DRIVERS (id, name, vehicle, phone, sort_order) VALUES (?, ?, ?, ?, ?)',
                [driverId, String(name).trim(), vehicle ? String(vehicle).trim() : 'Furgone', phone ? String(phone).trim() : null, sortOrder]
            );
            const version = await bumpTmsVersion(connection, request.user?.username);
            await connection.commit();
            emitTmsUpdate(version, request.user?.username, 'DRIVER_CREATED', driverId);
            return { success: true, id: driverId, version };
        } catch (error) {
            await connection.rollback();
            fastify.log.error(error);
            return reply.code(500).send({ error: error.message });
        } finally {
            connection.release();
        }
    });

    // PUT /api/tms/drivers/:id - Aggiorna autista
    fastify.put('/drivers/:id', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        if (!hasPermission(request.user, 'tms_manage')) {
            return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di gestire gli autisti TMS.' });
        }
        const { id } = request.params;
        const { name, vehicle, phone } = request.body || {};
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const [res] = await connection.query(
                'UPDATE TMS_DRIVERS SET name = COALESCE(?, name), vehicle = COALESCE(?, vehicle), phone = ? WHERE id = ?',
                [name ? String(name).trim() : null, vehicle ? String(vehicle).trim() : null, phone ? String(phone).trim() : null, id]
            );
            if (res.affectedRows === 0) {
                await connection.rollback();
                return reply.code(404).send({ error: 'Autista non trovato (potrebbe essere stato rimosso da un altro utente).' });
            }
            const version = await bumpTmsVersion(connection, request.user?.username);
            await connection.commit();
            emitTmsUpdate(version, request.user?.username, 'DRIVER_UPDATED', id);
            return { success: true, version };
        } catch (error) {
            await connection.rollback();
            fastify.log.error(error);
            return reply.code(500).send({ error: error.message });
        } finally {
            connection.release();
        }
    });

    // DELETE /api/tms/drivers/:id - Rimuovi autista e rimetti i suoi viaggi in "Da Assegnare"
    fastify.delete('/drivers/:id', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        if (!hasPermission(request.user, 'tms_manage')) {
            return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di gestire gli autisti TMS.' });
        }
        const { id } = request.params;
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const [drv] = await connection.query('SELECT id FROM TMS_DRIVERS WHERE id = ? FOR UPDATE', [id]);
            if (drv.length === 0) {
                await connection.rollback();
                return reply.code(404).send({ error: 'Autista già rimosso da un altro operatore.' });
            }
            await connection.query(
                "UPDATE TMS_TRIPS SET driver_id = 'unassigned', status = 'UNASSIGNED', version = version + 1 WHERE driver_id = ?",
                [id]
            );
            await connection.query('DELETE FROM TMS_DRIVERS WHERE id = ?', [id]);
            const version = await bumpTmsVersion(connection, request.user?.username);
            await connection.commit();
            emitTmsUpdate(version, request.user?.username, 'DRIVER_DELETED', id);
            return { success: true, version };
        } catch (error) {
            await connection.rollback();
            fastify.log.error(error);
            return reply.code(500).send({ error: error.message });
        } finally {
            connection.release();
        }
    });

    // POST /api/tms/trips - Crea singolo viaggio (atomicamente)
    fastify.post('/trips', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        if (!hasPermission(request.user, 'tms_manage')) {
            return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di creare viaggi TMS.' });
        }
        const t = request.body || {};
        if (!t.customer || !String(t.customer).trim()) {
            return reply.code(400).send({ error: 'Nome cliente obbligatorio' });
        }
        const tripId = t.id || `trp-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const targetDriver = t.driver_id || 'unassigned';

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            if (targetDriver !== 'unassigned') {
                const [drv] = await connection.query('SELECT id FROM TMS_DRIVERS WHERE id = ?', [targetDriver]);
                if (drv.length === 0) {
                    await connection.rollback();
                    return reply.code(409).send({ error: 'L\'autista selezionato non esiste più. Lavagna aggiornata.' });
                }
            }
            const [[maxRow]] = await connection.query(
                'SELECT COALESCE(MAX(sort_order), -1) AS maxSort FROM TMS_TRIPS WHERE COALESCE(driver_id, "unassigned") = ?',
                [targetDriver]
            );
            const sortOrder = Number(maxRow?.maxSort ?? -1) + 1;
            const initialStatus = targetDriver === 'unassigned' ? 'UNASSIGNED' : (t.status && t.status !== 'UNASSIGNED' ? t.status : 'ASSIGNED');

            await connection.query(
                `INSERT INTO TMS_TRIPS
                 (id, driver_id, customer, ref, pickup, pickupTime, delivery, deliveryTime, revenue, cost, status, title, notes, sort_order, version)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
                [
                    tripId,
                    targetDriver,
                    String(t.customer).trim(),
                    t.ref || '',
                    t.pickup || '',
                    formatDateTimeForMysql(t.pickupTime),
                    t.delivery || '',
                    formatDateTimeForMysql(t.deliveryTime),
                    parseFloat(t.revenue) || 0,
                    parseFloat(t.cost) || 0,
                    initialStatus,
                    t.title || `${t.customer} (${t.ref || 'Senza Rif.'})`,
                    JSON.stringify(Array.isArray(t.notes) ? t.notes : []),
                    sortOrder
                ]
            );
            const version = await bumpTmsVersion(connection, request.user?.username);
            await connection.commit();
            emitTmsUpdate(version, request.user?.username, 'TRIP_CREATED', tripId);
            return { success: true, id: tripId, version };
        } catch (error) {
            await connection.rollback();
            fastify.log.error(error);
            return reply.code(500).send({ error: error.message });
        } finally {
            connection.release();
        }
    });

    // PUT /api/tms/trips/:id - Aggiorna viaggio con optimistic locking (expected_version)
    fastify.put('/trips/:id', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        if (!hasPermission(request.user, 'tms_manage')) {
            return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di modificare i viaggi TMS.' });
        }
        const { id } = request.params;
        const t = request.body || {};
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const [existing] = await connection.query('SELECT * FROM TMS_TRIPS WHERE id = ? FOR UPDATE', [id]);
            if (existing.length === 0) {
                await connection.rollback();
                return reply.code(404).send({ error: 'Viaggio non trovato (rimosso da un altro operatore).' });
            }
            const curr = existing[0];
            if (t.expected_version !== undefined && t.expected_version !== null && Number(curr.version || 1) !== Number(t.expected_version)) {
                await connection.rollback();
                return reply.code(409).send({
                    error: 'Questo viaggio è stato modificato contemporaneamente da un altro operatore. Ricarico la lavagna aggiornata.'
                });
            }

            const nextDriver = t.driver_id !== undefined ? (t.driver_id || 'unassigned') : curr.driver_id;
            const nextStatus = t.status !== undefined
                ? t.status
                : (nextDriver === 'unassigned' ? 'UNASSIGNED' : (curr.status === 'UNASSIGNED' ? 'ASSIGNED' : curr.status));

            await connection.query(
                `UPDATE TMS_TRIPS
                 SET driver_id = ?, customer = ?, ref = ?, pickup = ?, pickupTime = ?, delivery = ?, deliveryTime = ?,
                     revenue = ?, cost = ?, status = ?, title = ?, notes = ?, version = version + 1
                 WHERE id = ?`,
                [
                    nextDriver,
                    t.customer !== undefined ? String(t.customer).trim() : curr.customer,
                    t.ref !== undefined ? t.ref : curr.ref,
                    t.pickup !== undefined ? t.pickup : curr.pickup,
                    t.pickupTime !== undefined ? formatDateTimeForMysql(t.pickupTime) : curr.pickupTime,
                    t.delivery !== undefined ? t.delivery : curr.delivery,
                    t.deliveryTime !== undefined ? formatDateTimeForMysql(t.deliveryTime) : curr.deliveryTime,
                    t.revenue !== undefined ? (parseFloat(t.revenue) || 0) : curr.revenue,
                    t.cost !== undefined ? (parseFloat(t.cost) || 0) : curr.cost,
                    nextStatus,
                    t.title !== undefined ? t.title : `${t.customer ?? curr.customer} (${(t.ref ?? curr.ref) || 'Senza Rif.'})`,
                    t.notes !== undefined ? JSON.stringify(Array.isArray(t.notes) ? t.notes : []) : curr.notes,
                    id
                ]
            );
            const version = await bumpTmsVersion(connection, request.user?.username);
            await connection.commit();
            emitTmsUpdate(version, request.user?.username, 'TRIP_UPDATED', id);
            return { success: true, version };
        } catch (error) {
            await connection.rollback();
            fastify.log.error(error);
            return reply.code(500).send({ error: error.message });
        } finally {
            connection.release();
        }
    });

    // PATCH /api/tms/trips/:id/move - Spostamento / assegnazione viaggio (drag & drop o "+")
    fastify.patch('/trips/:id/move', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        if (!hasPermission(request.user, 'tms_manage')) {
            return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di spostare i viaggi TMS.' });
        }
        const { id } = request.params;
        const { driver_id, sort_order, expected_version } = request.body || {};
        const targetDriver = driver_id || 'unassigned';

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const [existing] = await connection.query('SELECT * FROM TMS_TRIPS WHERE id = ? FOR UPDATE', [id]);
            if (existing.length === 0) {
                await connection.rollback();
                return reply.code(404).send({ error: 'Viaggio non più disponibile (eliminato da un altro utente).' });
            }
            const curr = existing[0];
            if (expected_version !== undefined && expected_version !== null && Number(curr.version || 1) !== Number(expected_version)) {
                await connection.rollback();
                return reply.code(409).send({ error: 'Questo viaggio è stato spostato o modificato da un altro operatore.' });
            }

            if (targetDriver !== 'unassigned') {
                const [drv] = await connection.query('SELECT id FROM TMS_DRIVERS WHERE id = ?', [targetDriver]);
                if (drv.length === 0) {
                    await connection.rollback();
                    return reply.code(409).send({ error: 'Autista di destinazione non trovato.' });
                }
            }

            const newStatus = targetDriver === 'unassigned'
                ? 'UNASSIGNED'
                : (curr.status === 'UNASSIGNED' ? 'ASSIGNED' : curr.status);

            await connection.query(
                'UPDATE TMS_TRIPS SET driver_id = ?, status = ?, sort_order = COALESCE(?, sort_order), version = version + 1 WHERE id = ?',
                [targetDriver, newStatus, sort_order !== undefined ? Number(sort_order) : null, id]
            );
            const version = await bumpTmsVersion(connection, request.user?.username);
            await connection.commit();
            emitTmsUpdate(version, request.user?.username, 'TRIP_MOVED', id);
            return { success: true, version };
        } catch (error) {
            await connection.rollback();
            fastify.log.error(error);
            return reply.code(500).send({ error: error.message });
        } finally {
            connection.release();
        }
    });

    // PATCH /api/tms/trips/:id/status - Avanzamento rapido stato viaggio
    fastify.patch('/trips/:id/status', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        if (!hasPermission(request.user, 'tms_manage')) {
            return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di cambiare lo stato del viaggio.' });
        }
        const { id } = request.params;
        const { status } = request.body || {};
        if (!status) return reply.code(400).send({ error: 'Stato richiesto' });

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const [res] = await connection.query(
                'UPDATE TMS_TRIPS SET status = ?, version = version + 1 WHERE id = ?',
                [status, id]
            );
            if (res.affectedRows === 0) {
                await connection.rollback();
                return reply.code(404).send({ error: 'Viaggio non trovato.' });
            }
            const version = await bumpTmsVersion(connection, request.user?.username);
            await connection.commit();
            emitTmsUpdate(version, request.user?.username, 'TRIP_STATUS', id);
            return { success: true, version };
        } catch (error) {
            await connection.rollback();
            fastify.log.error(error);
            return reply.code(500).send({ error: error.message });
        } finally {
            connection.release();
        }
    });

    // DELETE /api/tms/trips/:id - Elimina singolo viaggio
    fastify.delete('/trips/:id', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        if (!hasPermission(request.user, 'tms_manage')) {
            return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di eliminare i viaggi TMS.' });
        }
        const { id } = request.params;
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const [res] = await connection.query('DELETE FROM TMS_TRIPS WHERE id = ?', [id]);
            if (res.affectedRows === 0) {
                await connection.rollback();
                return reply.code(404).send({ error: 'Viaggio già eliminato.' });
            }
            const version = await bumpTmsVersion(connection, request.user?.username);
            await connection.commit();
            emitTmsUpdate(version, request.user?.username, 'TRIP_DELETED', id);
            return { success: true, version };
        } catch (error) {
            await connection.rollback();
            fastify.log.error(error);
            return reply.code(500).send({ error: error.message });
        } finally {
            connection.release();
        }
    });

    // POST sync TMS state (optimistic-locked fallback)
    fastify.post('/sync', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        if (!hasPermission(request.user, 'tms_manage')) {
            return reply.code(403).send({ error: 'Accesso negato: non hai il permesso di modificare i viaggi o gli autisti TMS.' });
        }

        const { drivers, columns, baseVersion } = request.body || {};
        const connection = await db.getConnection();
        try {
            const outcome = await withNamedLock(connection, 'maglite_tms_sync', async () => {
                await connection.beginTransaction();
                try {
                    const [metaRows] = await connection.query('SELECT version FROM TMS_META WHERE id = 1 FOR UPDATE');
                    const currentVersion = metaRows.length > 0 ? Number(metaRows[0].version) : 1;
                    if (baseVersion !== undefined && baseVersion !== null && Number(baseVersion) !== currentVersion) {
                        await connection.rollback();
                        return {
                            status: 409,
                            body: {
                                error: 'La lavagna TMS è stata aggiornata da un altro operatore. Ricarico i dati più recenti per evitare sovrascritture.',
                                currentVersion
                            }
                        };
                    }

                    // 1. Process Drivers
                    if (drivers && drivers.length > 0) {
                        const driverIds = drivers.map(d => d.id);
                        await connection.query('DELETE FROM TMS_DRIVERS WHERE id NOT IN (?)', [driverIds]);
                        for (let i = 0; i < drivers.length; i++) {
                            const d = drivers[i];
                            await connection.query(
                                `INSERT INTO TMS_DRIVERS (id, name, vehicle, phone, sort_order) 
                                 VALUES (?, ?, ?, ?, ?) 
                                 ON DUPLICATE KEY UPDATE name=VALUES(name), vehicle=VALUES(vehicle), phone=VALUES(phone), sort_order=VALUES(sort_order)`,
                                [d.id, d.name, d.vehicle || 'Furgone', d.phone || null, i]
                            );
                        }
                    } else {
                        await connection.query('DELETE FROM TMS_DRIVERS');
                    }

                    // 2. Process Trips
                    const allTrips = [];
                    if (columns) {
                        Object.keys(columns).forEach(colId => {
                            const colTrips = columns[colId] || [];
                            colTrips.forEach((t, idx) => {
                                allTrips.push({
                                    ...t,
                                    driver_id: colId,
                                    sort_order: idx
                                });
                            });
                        });
                    }

                    if (allTrips.length > 0) {
                        const tripIds = allTrips.map(t => t.id);
                        await connection.query('DELETE FROM TMS_TRIPS WHERE id NOT IN (?)', [tripIds]);
                        for (const t of allTrips) {
                            await connection.query(
                                `INSERT INTO TMS_TRIPS (id, driver_id, customer, ref, pickup, pickupTime, delivery, deliveryTime, revenue, cost, status, title, notes, sort_order) 
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                 ON DUPLICATE KEY UPDATE 
                                 driver_id=VALUES(driver_id), customer=VALUES(customer), ref=VALUES(ref), 
                                 pickup=VALUES(pickup), pickupTime=VALUES(pickupTime), delivery=VALUES(delivery), deliveryTime=VALUES(deliveryTime),
                                 revenue=VALUES(revenue), cost=VALUES(cost), status=VALUES(status), title=VALUES(title), notes=VALUES(notes), sort_order=VALUES(sort_order), version=version+1`,
                                [
                                    t.id,
                                    t.driver_id || 'unassigned',
                                    t.customer || '',
                                    t.ref || '',
                                    t.pickup || '',
                                    formatDateTimeForMysql(t.pickupTime),
                                    t.delivery || '',
                                    formatDateTimeForMysql(t.deliveryTime),
                                    parseFloat(t.revenue) || 0,
                                    parseFloat(t.cost) || 0,
                                    t.status || 'UNASSIGNED',
                                    t.title || `${t.customer || ''} (${t.ref || ''})`,
                                    JSON.stringify(t.notes || []),
                                    t.sort_order || 0
                                ]
                            );
                        }
                    } else {
                        await connection.query('DELETE FROM TMS_TRIPS');
                    }

                    const version = await bumpTmsVersion(connection, request.user?.username);
                    await connection.commit();
                    return { status: 200, body: { success: true, version } };
                } catch (txErr) {
                    await connection.rollback();
                    throw txErr;
                }
            });

            if (outcome.status !== 200) {
                return reply.code(outcome.status).send(outcome.body);
            }

            emitTmsUpdate(outcome.body.version, request.user?.username, 'BOARD_SYNC');
            return outcome.body;
        } catch (error) {
            fastify.log.error(error);
            return reply.code(error.statusCode || 500).send({ error: error.message });
        } finally {
            connection.release();
        }
    });
}

module.exports = tmsRoutes;
