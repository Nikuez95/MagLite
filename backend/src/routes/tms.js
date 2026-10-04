const db = require('../config/db');

async function tmsRoutes(fastify, options) {
    
    // GET all TMS data
    fastify.get('/', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        try {
            const [drivers] = await db.query('SELECT * FROM TMS_DRIVERS ORDER BY sort_order ASC');
            const [trips] = await db.query('SELECT * FROM TMS_TRIPS ORDER BY sort_order ASC');
            
            // Map notes from JSON string back to array
            trips.forEach(t => {
                if (t.notes) {
                    try { t.notes = JSON.parse(t.notes); } catch(e) { t.notes = []; }
                } else {
                    t.notes = [];
                }
            });

            // Group trips by driver_id
            const columns = { unassigned: [] };
            drivers.forEach(d => columns[d.id] = []);

            trips.forEach(t => {
                if (!t.driver_id || t.driver_id === 'unassigned' || !columns[t.driver_id]) {
                    columns.unassigned.push(t);
                } else {
                    columns[t.driver_id].push(t);
                }
            });

            return { drivers, columns };
        } catch (error) {
            fastify.log.error(error);
            reply.code(500).send({ error: error.message });
        }
    });

    // POST sync TMS state
    fastify.post('/sync', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        const { drivers, columns } = request.body;
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            // 1. Process Drivers
            if (drivers && drivers.length > 0) {
                const driverIds = drivers.map(d => d.id);
                await connection.query('DELETE FROM TMS_DRIVERS WHERE id NOT IN (?)', [driverIds]);

                for (let i = 0; i < drivers.length; i++) {
                    const d = drivers[i];
                    await connection.query(
                        `INSERT INTO TMS_DRIVERS (id, name, vehicle, sort_order) 
                         VALUES (?, ?, ?, ?) 
                         ON DUPLICATE KEY UPDATE name=VALUES(name), vehicle=VALUES(vehicle), sort_order=VALUES(sort_order)`,
                        [d.id, d.name, d.vehicle, i]
                    );
                }
            } else {
                await connection.query('DELETE FROM TMS_DRIVERS');
            }

            // 2. Process Trips
            const allTrips = [];
            for (const colId in columns) {
                const tripsInCol = columns[colId];
                if (Array.isArray(tripsInCol)) {
                    tripsInCol.forEach((t, i) => {
                        t.driver_id = colId === 'unassigned' ? null : colId;
                        t.sort_order = i;
                        allTrips.push(t);
                    });
                }
            }

            if (allTrips.length > 0) {
                const tripIds = allTrips.map(t => t.id);
                await connection.query('DELETE FROM TMS_TRIPS WHERE id NOT IN (?)', [tripIds]);

                for (const t of allTrips) {
                    const notesStr = JSON.stringify(t.notes || []);
                    // Formatting dates safely for MySQL
                    const pTime = (t.pickupTime && t.pickupTime.trim() !== '') ? new Date(t.pickupTime).toISOString().slice(0, 19).replace('T', ' ') : null;
                    const dTime = (t.deliveryTime && t.deliveryTime.trim() !== '') ? new Date(t.deliveryTime).toISOString().slice(0, 19).replace('T', ' ') : null;

                    await connection.query(
                        `INSERT INTO TMS_TRIPS (id, driver_id, customer, ref, pickup, pickupTime, delivery, deliveryTime, revenue, cost, status, title, notes, sort_order)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                         ON DUPLICATE KEY UPDATE 
                         driver_id=VALUES(driver_id), customer=VALUES(customer), ref=VALUES(ref), pickup=VALUES(pickup), pickupTime=VALUES(pickupTime), delivery=VALUES(delivery), deliveryTime=VALUES(deliveryTime), revenue=VALUES(revenue), cost=VALUES(cost), status=VALUES(status), title=VALUES(title), notes=VALUES(notes), sort_order=VALUES(sort_order)`,
                        [
                            t.id, 
                            t.driver_id, 
                            t.customer || '', 
                            t.ref || '', 
                            t.pickup || '', 
                            pTime, 
                            t.delivery || '', 
                            dTime, 
                            t.revenue || 0, 
                            t.cost || 0, 
                            t.status, 
                            t.title || '', 
                            notesStr, 
                            t.sort_order
                        ]
                    );
                }
            } else {
                 await connection.query('DELETE FROM TMS_TRIPS');
            }

            await connection.commit();
            return { success: true };
        } catch (error) {
            await connection.rollback();
            fastify.log.error(error);
            reply.code(500).send({ error: error.message });
        } finally {
            connection.release();
        }
    });
}

module.exports = tmsRoutes;
