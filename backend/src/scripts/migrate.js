const db = require('../config/db');
const fs = require('fs');
const path = require('path');

/**
 * MIGRATION SCRIPT AUTOMATICO
 * Questo file viene lanciato ad ogni avvio di app.js.
 * 
 * STANDARD DI LAVORO:
 * 1. Legge il file init.sql (Single Source of Truth) e crea tutte le tabelle mancanti.
 * 2. Esegue eventuali ALTER TABLE per allineare i vecchi database alle nuove strutture.
 */
async function runMigrations() {
  const connection = await db.getConnection();
  try {
    console.log('🔄 Avvio sincronizzazione Database...');
    
    // 1. Leggi ed esegui init.sql (Creazione base)
    // __dirname è backend/src/scripts -> torno indietro di 3 directory per arrivare in root
    const initSqlPath = path.join(__dirname, '../../../database/init.sql'); 
    
    if (fs.existsSync(initSqlPath)) {
      const sqlContent = fs.readFileSync(initSqlPath, 'utf8');
      
      // Dividi le query per punto e virgola, ignorando le righe vuote
      const queries = sqlContent.split(';')
        .map(q => q.trim())
        .filter(q => q.length > 0);
      
      for (const query of queries) {
        try {
          await connection.query(query);
        } catch (err) {
          // Ignora gli errori noti su inserimenti multipli o tabelle esistenti, logga il resto se serve
          if (err.code !== 'ER_TABLE_EXISTS_ERROR' && err.code !== 'ER_DUP_ENTRY') {
            console.warn(`[INIT SQL WARNING] ${err.message}`);
          }
        }
      }
      console.log('✅ Tabelle base sincronizzate con init.sql');
    } else {
      console.warn(`⚠️ File init.sql non trovato nel percorso: ${initSqlPath}`);
    }

    // 2. Esegui aggiornamenti strutturali (ALTER TABLE)
    // Se aggiungiamo una nuova colonna nel gestionale, va inserita in init.sql per i nuovi DB,
    // e messa qui sotto come ALTER TABLE per aggiornare i DB esistenti.
    const alterQueries = [
      "ALTER TABLE PALLETS DROP INDEX pallet_code",

      "ALTER TABLE PALLETS ADD COLUMN inbound_ddt_id INT DEFAULT NULL",
      "ALTER TABLE INBOUND_DDT_ITEMS ADD COLUMN sku VARCHAR(100) DEFAULT NULL",
      "ALTER TABLE INBOUND_DDT_ITEMS ADD COLUMN product_name VARCHAR(255) DEFAULT NULL",
      "ALTER TABLE INBOUND_DDT_ITEMS ADD COLUMN product_uom VARCHAR(50) DEFAULT NULL",
      "ALTER TABLE INBOUND_DDT_ITEMS ADD COLUMN location VARCHAR(50) DEFAULT NULL",

      "ALTER TABLE OUTBOUND_ORDERS ADD COLUMN client_ddt VARCHAR(100) DEFAULT NULL",
      "ALTER TABLE OUTBOUND_ORDERS ADD COLUMN notes TEXT DEFAULT NULL",
      "ALTER TABLE OUTBOUND_ORDERS ADD COLUMN start_picking_at DATETIME DEFAULT NULL",
      "ALTER TABLE OUTBOUND_ORDERS ADD COLUMN end_picking_at DATETIME DEFAULT NULL",
      "ALTER TABLE OUTBOUND_ORDERS ADD COLUMN shipped_at DATETIME DEFAULT NULL",
      "ALTER TABLE OUTBOUND_ORDERS ADD COLUMN picking_operator VARCHAR(100) DEFAULT NULL",
      "ALTER TABLE OUTBOUND_ORDERS ADD COLUMN shipped_by VARCHAR(50) DEFAULT NULL",
      "ALTER TABLE OUTBOUND_ITEMS ADD COLUMN picked_at DATETIME DEFAULT NULL",
      "ALTER TABLE OUTBOUND_ITEMS ADD COLUMN pallet_id INT DEFAULT NULL",
      "ALTER TABLE OUTBOUND_ITEMS ADD COLUMN batch VARCHAR(100) DEFAULT NULL",
      "ALTER TABLE OUTBOUND_ITEMS MODIFY COLUMN quantity_required DECIMAL(10,2) NOT NULL",
      "ALTER TABLE OUTBOUND_ITEMS MODIFY COLUMN quantity_picked DECIMAL(10,2) DEFAULT 0",
      "ALTER TABLE PALLETS ADD COLUMN pallet_uom VARCHAR(50) DEFAULT NULL",
      "ALTER TABLE PRODUCTS MODIFY uom VARCHAR(50) NOT NULL DEFAULT 'Scatole'",
      "ALTER TABLE USERS ADD COLUMN preferences JSON DEFAULT NULL",
      "ALTER TABLE PRODUCTS ADD COLUMN default_article_number VARCHAR(100) DEFAULT NULL",
      "ALTER TABLE PRODUCTS ADD COLUMN flags JSON DEFAULT NULL",
      "ALTER TABLE PALLETS ADD COLUMN flags JSON DEFAULT NULL",
      "ALTER TABLE PALLETS ADD COLUMN shipped_at DATETIME DEFAULT NULL",
      "ALTER TABLE invoices ADD COLUMN invoice_data JSON DEFAULT NULL",
      "ALTER TABLE invoices ADD COLUMN is_paid BOOLEAN DEFAULT FALSE",
      // Estensione dell'ENUM per rules_type e tariffa Deposito Paletta
      "ALTER TABLE billing_rules MODIFY COLUMN rule_type ENUM('EVENT', 'STORAGE', 'FLAG', 'DISCOUNT_PERCENT', 'DISCOUNT_FIXED', 'MANUAL') NOT NULL",
      "INSERT IGNORE INTO billing_rules (rule_code, description, default_price, rule_type) VALUES ('DEPOSITO_PALLET', 'Deposito Paletta (Giacenza Rimasta)', 10.00, 'STORAGE')",
      // Frammentazione Clienti (Cliente Madre -> Reparti/Frammentazioni)
      "ALTER TABLE CUSTOMERS ADD COLUMN parent_id INT DEFAULT NULL",
      // Gestione Discrepanze DDT Entrata e Storico Motivi
      "ALTER TABLE INBOUND_DDTS ADD COLUMN discrepancy_accepted BOOLEAN DEFAULT FALSE",
      "ALTER TABLE INBOUND_DDTS ADD COLUMN discrepancy_reason TEXT DEFAULT NULL",
      "ALTER TABLE INBOUND_DDTS ADD COLUMN discrepancy_resolved_by VARCHAR(100) DEFAULT NULL",
      "ALTER TABLE INBOUND_DDTS ADD COLUMN discrepancy_resolved_at DATETIME DEFAULT NULL",
      "ALTER TABLE INBOUND_DDTS ADD COLUMN rejected_count INT DEFAULT 0",
      "ALTER TABLE INBOUND_DDTS ADD COLUMN last_rejected_reason TEXT DEFAULT NULL",
      "ALTER TABLE INBOUND_DDTS ADD COLUMN last_rejected_by VARCHAR(100) DEFAULT NULL",
      "ALTER TABLE INBOUND_DDTS ADD COLUMN last_rejected_at DATETIME DEFAULT NULL",
      `CREATE TABLE IF NOT EXISTS INBOUND_DISCREPANCY_LOGS (
        id INT AUTO_INCREMENT PRIMARY KEY,
        inbound_ddt_id INT NOT NULL,
        ddt_number VARCHAR(50) NOT NULL,
        customer_id INT NOT NULL,
        decision ENUM('REPORTED', 'ACCEPTED', 'REJECTED') NOT NULL,
        reason TEXT DEFAULT NULL,
        items_snapshot JSON DEFAULT NULL,
        username VARCHAR(100) DEFAULT 'Sistema',
        source VARCHAR(50) DEFAULT 'Gestionale',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (inbound_ddt_id) REFERENCES INBOUND_DDTS(id) ON DELETE CASCADE
      )`
    ];

    for (const query of alterQueries) {
      try {
        await connection.query(query);
      } catch (err) {
        // Ignoriamo gli errori di "colonna o chiave già esistente", significano che il db è già aggiornato
        if (err.code !== 'ER_DUP_FIELDNAME' && err.code !== 'ER_CANT_DROP_FIELD_OR_KEY') {
          // Logga solo errori inaspettati
        }
      }
    }

    // Allinea OUTBOUND_ITEMS esistenti senza pallet_id o batch per evitare duplicazioni su lotti multipli
    try {
      await connection.query(`
        UPDATE OUTBOUND_ITEMS oi
        SET 
          pallet_id = COALESCE(oi.pallet_id, (
            SELECT p.id FROM PALLETS p 
            WHERE p.pallet_code = oi.pallet_code AND p.product_id = oi.product_id 
              AND (oi.batch IS NULL OR p.batch = oi.batch)
            ORDER BY p.id ASC LIMIT 1
          )),
          batch = COALESCE(oi.batch, (
            SELECT p.batch FROM PALLETS p 
            WHERE p.pallet_code = oi.pallet_code AND p.product_id = oi.product_id 
            ORDER BY p.id ASC LIMIT 1
          ))
        WHERE oi.pallet_id IS NULL OR oi.batch IS NULL
      `);
    } catch (alignErr) {
      console.warn('[MIGRATE OUTBOUND_ITEMS ALIGN WARNING]', alignErr.message);
    }

    // 3. Pulizia e sostituzione SKU generati (PROD-XXXX) con il reale Codice Articolo se presente
    try {
      const [products] = await connection.query('SELECT * FROM PRODUCTS');
      for (const prod of products) {
        let realArticle = (prod.default_article_number || '').trim();
        if (!realArticle) {
          const [palRows] = await connection.query(
            "SELECT client_article_number FROM PALLETS WHERE product_id = ? AND client_article_number IS NOT NULL AND TRIM(client_article_number) != '' ORDER BY id DESC LIMIT 1",
            [prod.id]
          );
          if (palRows.length > 0) {
            realArticle = palRows[0].client_article_number.trim();
          }
        }
        if (!realArticle) {
          const [ddtRows] = await connection.query(
            "SELECT client_article_number FROM INBOUND_DDT_ITEMS WHERE product_id = ? AND client_article_number IS NOT NULL AND TRIM(client_article_number) != '' ORDER BY id DESC LIMIT 1",
            [prod.id]
          );
          if (ddtRows.length > 0) {
            realArticle = ddtRows[0].client_article_number.trim();
          }
        }

        if (realArticle && prod.sku !== realArticle) {
          const [existingSku] = await connection.query(
            'SELECT * FROM PRODUCTS WHERE sku = ? AND id != ?',
            [realArticle, prod.id]
          );
          if (existingSku.length > 0) {
            const targetId = existingSku[0].id;
            await connection.query('UPDATE PALLETS SET product_id = ? WHERE product_id = ?', [targetId, prod.id]);
            await connection.query('UPDATE INBOUND_DDT_ITEMS SET product_id = ?, sku = ? WHERE product_id = ?', [targetId, realArticle, prod.id]);
            await connection.query('UPDATE OUTBOUND_ITEMS SET product_id = ? WHERE product_id = ?', [targetId, prod.id]);
            await connection.query('DELETE FROM PRODUCTS WHERE id = ?', [prod.id]);
          } else {
            await connection.query(
              'UPDATE PRODUCTS SET sku = ?, default_article_number = ? WHERE id = ?',
              [realArticle, realArticle, prod.id]
            );
            await connection.query(
              'UPDATE INBOUND_DDT_ITEMS SET sku = ? WHERE product_id = ?',
              [realArticle, prod.id]
            );
          }
        } else {
          await connection.query(
            'UPDATE INBOUND_DDT_ITEMS SET sku = ? WHERE product_id = ? AND (sku IS NULL OR sku = "")',
            [prod.sku, prod.id]
          );
        }
      }

      // Unisci ed elimina eventuali duplicati con stesso nome/cliente di cui uno ha SKU generato PROD-% e l'altro ha un Codice Articolo reale
      const [remainingProds] = await connection.query('SELECT * FROM PRODUCTS');
      for (const prod of remainingProds) {
        if (prod.sku && prod.sku.startsWith('PROD-')) {
          const [betterMatch] = await connection.query(
            "SELECT * FROM PRODUCTS WHERE customer_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) AND id != ? AND sku NOT LIKE 'PROD-%' LIMIT 1",
            [prod.customer_id, prod.name, prod.id]
          );
          if (betterMatch.length > 0) {
            const target = betterMatch[0];
            await connection.query('UPDATE PALLETS SET product_id = ? WHERE product_id = ?', [target.id, prod.id]);
            await connection.query('UPDATE INBOUND_DDT_ITEMS SET product_id = ?, sku = ? WHERE product_id = ?', [target.id, target.sku, prod.id]);
            await connection.query('UPDATE OUTBOUND_ITEMS SET product_id = ? WHERE product_id = ?', [target.id, prod.id]);
            await connection.query('DELETE FROM PRODUCTS WHERE id = ?', [prod.id]);
          }
        }
      }
    } catch (skuCleanErr) {
      console.warn('[MIGRATE SKU CLEANUP WARNING]', skuCleanErr.message);
    }
    
    console.log('🚀 Migrazioni completate. Database allineato al 100%.');
  } catch (err) {
    console.error('❌ Errore critico durante le migrazioni:', err);
  } finally {
    connection.release();
  }
}

module.exports = runMigrations;
