/**
 * Executes `fn` while holding a MySQL session-level named lock (`GET_LOCK`).
 * Always releases the lock in `finally` on the same connection.
 * Used to serialize sequential code generation, order allocation, and board mutations
 * across simultaneous HTTP workers / operators without broad table locks.
 */
async function withNamedLock(connection, lockName, fn, timeoutSeconds = 10) {
  const [lockRows] = await connection.query('SELECT GET_LOCK(?, ?) AS acquired', [lockName, timeoutSeconds]);
  if (!lockRows || lockRows[0]?.acquired !== 1) {
    const err = new Error(`Operazione occupata su ${lockName}, riprova tra un istante.`);
    err.statusCode = 409;
    throw err;
  }
  try {
    return await fn();
  } finally {
    try {
      await connection.query('SELECT RELEASE_LOCK(?)', [lockName]);
    } catch (_) {
      // Ignore release errors if connection was already closed
    }
  }
}

module.exports = {
  withNamedLock
};
