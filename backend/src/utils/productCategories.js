/**
 * Ensures the system fallback macro category "DA IDENTIFICARE" exists and returns its row.
 */
async function ensureDefaultMacroCategory(connection) {
  await connection.query(
    `INSERT IGNORE INTO PRODUCT_MACRO_CATEGORIES (name, description, color, is_system)
     VALUES ('DA IDENTIFICARE', 'Categoria predefinita per articoli non ancora classificati', '#64748b', TRUE)`
  );
  const [[row]] = await connection.query(
    `SELECT id, name, color, is_system
     FROM PRODUCT_MACRO_CATEGORIES
     WHERE UPPER(name) = 'DA IDENTIFICARE'
     LIMIT 1`
  );
  return row || null;
}

/**
 * Resolves consistent (macro_category_id, micro_category_id) pair for a product.
 * - If micro_category_id is provided, validates it exists and enforces its real parent macro_category_id.
 * - If only macro_category_id is provided, validates it exists and clears micro_category_id.
 * - If neither is provided and fallbackToDefault is true, returns "DA IDENTIFICARE".
 */
async function resolveProductCategoryIds(connection, rawMacroId, rawMicroId, { fallbackToDefault = true } = {}) {
  const parsedMicro =
    rawMicroId !== undefined && rawMicroId !== null && rawMicroId !== ''
      ? parseInt(rawMicroId, 10)
      : null;
  const parsedMacro =
    rawMacroId !== undefined && rawMacroId !== null && rawMacroId !== ''
      ? parseInt(rawMacroId, 10)
      : null;

  if (parsedMicro && Number.isFinite(parsedMicro)) {
    const [[micro]] = await connection.query(
      'SELECT id, macro_category_id FROM PRODUCT_MICRO_CATEGORIES WHERE id = ? LIMIT 1',
      [parsedMicro]
    );
    if (!micro) {
      const err = new Error('Micro categoria non trovata');
      err.statusCode = 400;
      throw err;
    }
    if (parsedMacro && Number(parsedMacro) !== Number(micro.macro_category_id)) {
      const err = new Error('La micro categoria selezionata non appartiene alla macro categoria indicata');
      err.statusCode = 400;
      throw err;
    }
    return {
      macro_category_id: Number(micro.macro_category_id),
      micro_category_id: Number(micro.id)
    };
  }

  if (parsedMacro && Number.isFinite(parsedMacro)) {
    const [[macro]] = await connection.query(
      'SELECT id FROM PRODUCT_MACRO_CATEGORIES WHERE id = ? LIMIT 1',
      [parsedMacro]
    );
    if (!macro) {
      const err = new Error('Macro categoria non trovata');
      err.statusCode = 400;
      throw err;
    }
    return {
      macro_category_id: Number(macro.id),
      micro_category_id: null
    };
  }

  if (fallbackToDefault) {
    const defMacro = await ensureDefaultMacroCategory(connection);
    return {
      macro_category_id: defMacro ? Number(defMacro.id) : null,
      micro_category_id: null
    };
  }

  return {
    macro_category_id: null,
    micro_category_id: null
  };
}

module.exports = {
  ensureDefaultMacroCategory,
  resolveProductCategoryIds
};
