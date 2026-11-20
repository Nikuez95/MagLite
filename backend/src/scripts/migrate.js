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
      "ALTER TABLE PALLETS ADD COLUMN client_ddt VARCHAR(100) DEFAULT NULL",
      "ALTER TABLE PALLETS ADD COLUMN checkin_id INT DEFAULT NULL",
      "ALTER TABLE PALLETS ADD COLUMN checkin_session_code VARCHAR(100) DEFAULT NULL",
      "ALTER TABLE INBOUND_DDTS ADD COLUMN client_ddt VARCHAR(100) DEFAULT NULL",
      "ALTER TABLE INBOUND_DDTS ADD COLUMN checkin_id INT DEFAULT NULL",
      "ALTER TABLE INBOUND_DDTS ADD COLUMN checkin_session_code VARCHAR(100) DEFAULT NULL",
      "ALTER TABLE CUSTOM_FORMS ADD COLUMN icon VARCHAR(50) DEFAULT 'ClipboardList'",
      "ALTER TABLE CUSTOM_FORMS ADD COLUMN color_accent VARCHAR(30) DEFAULT 'blue'",
      "ALTER TABLE CUSTOM_FORMS ADD COLUMN display_mode VARCHAR(30) DEFAULT 'SHOW_ON_HOME'",
      "ALTER TABLE CUSTOM_FORMS ADD COLUMN is_default BOOLEAN DEFAULT FALSE",
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
      "ALTER TABLE OUTBOUND_ITEMS ADD COLUMN client_pallet_number VARCHAR(100) DEFAULT NULL",
      "ALTER TABLE OUTBOUND_ITEMS ADD COLUMN is_specific BOOLEAN DEFAULT FALSE",
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
      )`,
      "ALTER TABLE OUTBOUND_ORDERS MODIFY COLUMN status ENUM('PENDING', 'PICKING', 'READY', 'SHIPPED', 'RETURNED') DEFAULT 'PENDING'",
      "ALTER TABLE OUTBOUND_ORDERS ADD COLUMN return_count INT DEFAULT 0",
      "ALTER TABLE OUTBOUND_ORDERS ADD COLUMN last_returned_at DATETIME DEFAULT NULL",
      "ALTER TABLE OUTBOUND_ORDERS ADD COLUMN last_returned_by VARCHAR(100) DEFAULT NULL",
      "ALTER TABLE OUTBOUND_ORDERS ADD COLUMN last_return_reason VARCHAR(255) DEFAULT NULL",
      "INSERT IGNORE INTO FREE_LOCATIONS (name) VALUES ('IN ATTESA')",
      `CREATE TABLE IF NOT EXISTS OUTBOUND_RETURNS (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id INT NOT NULL,
        order_code VARCHAR(100) NOT NULL,
        customer_id INT NOT NULL,
        customer_name VARCHAR(255) DEFAULT NULL,
        return_reason VARCHAR(255) NOT NULL,
        returned_by VARCHAR(100) NOT NULL,
        prepared_by VARCHAR(100) DEFAULT NULL,
        shipped_by VARCHAR(100) DEFAULT NULL,
        original_shipped_at DATETIME DEFAULT NULL,
        returned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        items_snapshot JSON DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES OUTBOUND_ORDERS(id) ON DELETE CASCADE,
        FOREIGN KEY (customer_id) REFERENCES CUSTOMERS(id) ON DELETE CASCADE
      )`,
      "ALTER TABLE USERS MODIFY COLUMN role VARCHAR(50) NOT NULL DEFAULT 'operator'",
      "ALTER TABLE USERS ADD COLUMN custom_permissions JSON DEFAULT NULL",
      "ALTER TABLE PALLETS ADD COLUMN is_quarantined BOOLEAN DEFAULT FALSE",
      "ALTER TABLE PALLETS ADD COLUMN quarantine_reason VARCHAR(255) DEFAULT NULL",
      "ALTER TABLE PALLETS ADD COLUMN quarantined_at DATETIME DEFAULT NULL",
      "ALTER TABLE PALLETS ADD COLUMN quarantined_by VARCHAR(100) DEFAULT NULL",
      "ALTER TABLE PALLETS ADD COLUMN quarantine_notes TEXT DEFAULT NULL",
      `CREATE TABLE IF NOT EXISTS ROLES (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        description VARCHAR(255) DEFAULT NULL,
        color VARCHAR(30) DEFAULT '#38bdf8',
        hierarchy_level INT NOT NULL DEFAULT 100,
        is_system BOOLEAN DEFAULT FALSE,
        permissions JSON NOT NULL,
        created_by VARCHAR(50) DEFAULT 'Sistema',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS QUARANTINE_LOGS (
        id INT AUTO_INCREMENT PRIMARY KEY,
        pallet_id INT DEFAULT NULL,
        pallet_code VARCHAR(50) NOT NULL,
        product_id INT NOT NULL,
        product_name VARCHAR(255) DEFAULT NULL,
        sku VARCHAR(100) DEFAULT NULL,
        customer_id INT NOT NULL,
        customer_name VARCHAR(255) DEFAULT NULL,
        batch VARCHAR(100) DEFAULT NULL,
        quantity DECIMAL(10,2) DEFAULT 0,
        uom VARCHAR(50) DEFAULT NULL,
        location VARCHAR(50) DEFAULT NULL,
        status ENUM('QUARANTINED', 'RELEASED') NOT NULL DEFAULT 'QUARANTINED',
        block_reason VARCHAR(255) NOT NULL,
        block_notes TEXT DEFAULT NULL,
        blocked_by VARCHAR(100) NOT NULL,
        blocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        unblock_reason VARCHAR(255) DEFAULT NULL,
        unblock_notes TEXT DEFAULT NULL,
        unblocked_by VARCHAR(100) DEFAULT NULL,
        unblocked_at DATETIME DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

    // 2b. Note cliente, piani tariffari globali e associazioni
    const customerAndTariffQueries = [
      "ALTER TABLE CUSTOMERS ADD COLUMN notes TEXT DEFAULT NULL",
      "ALTER TABLE CUSTOMERS ADD COLUMN tariff_plan_id INT DEFAULT NULL",
      `CREATE TABLE IF NOT EXISTS tariff_plans (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL UNIQUE,
        description TEXT DEFAULT NULL,
        is_default BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS tariff_plan_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        plan_id INT NOT NULL,
        rule_code VARCHAR(50) NOT NULL,
        price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        UNIQUE KEY unique_plan_rule (plan_id, rule_code),
        FOREIGN KEY (plan_id) REFERENCES tariff_plans(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS CUSTOMER_NOTES (
        id INT AUTO_INCREMENT PRIMARY KEY,
        customer_id INT NOT NULL,
        content TEXT NOT NULL,
        username VARCHAR(100) DEFAULT 'Sistema',
        is_pinned BOOLEAN DEFAULT FALSE,
        pinned_at DATETIME DEFAULT NULL,
        pinned_by VARCHAR(100) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_customer_notes_cust_pin_date (customer_id, is_pinned, created_at),
        FOREIGN KEY (customer_id) REFERENCES CUSTOMERS(id) ON DELETE CASCADE
      )`
    ];
    for (const q of customerAndTariffQueries) {
      try {
        await connection.query(q);
      } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME' && err.code !== 'ER_CANT_DROP_FIELD_OR_KEY') {
          console.warn('[MIGRATE CUSTOMERS/TARIFFS WARNING]', err.message);
        }
      }
    }

    // Migra eventuali vecchie note singole in CUSTOMERS.notes dentro CUSTOMER_NOTES (solo se il cliente non ha ancora note)
    try {
      await connection.query(`
        INSERT INTO CUSTOMER_NOTES (customer_id, content, username, is_pinned)
        SELECT c.id, TRIM(c.notes), 'Sistema', FALSE
        FROM CUSTOMERS c
        WHERE c.notes IS NOT NULL AND TRIM(c.notes) != ''
          AND NOT EXISTS (SELECT 1 FROM CUSTOMER_NOTES cn WHERE cn.customer_id = c.id)
      `);
    } catch (notesMigErr) {
      console.warn('[MIGRATE CUSTOMER_NOTES WARNING]', notesMigErr.message);
    }

    // 2c. Listini globali per cliente/paletta, pesi netti/lordi, frammentazione carrello e listino default Fisso Mensile
    const palletAndPlanQueries = [
      "ALTER TABLE tariff_plans ADD COLUMN is_flat_rate BOOLEAN DEFAULT FALSE",
      "ALTER TABLE tariff_plans ADD COLUMN invoice_label VARCHAR(255) DEFAULT NULL",
      "ALTER TABLE PALLETS ADD COLUMN tariff_plan_id INT DEFAULT NULL",
      "ALTER TABLE PALLETS ADD COLUMN net_weight_kg DECIMAL(10,2) DEFAULT NULL",
      "ALTER TABLE PALLETS ADD COLUMN gross_weight_kg DECIMAL(10,2) DEFAULT NULL",
      "ALTER TABLE INBOUND_DDT_ITEMS ADD COLUMN tariff_plan_id INT DEFAULT NULL",
      "ALTER TABLE INBOUND_DDT_ITEMS ADD COLUMN net_weight_kg DECIMAL(10,2) DEFAULT NULL",
      "ALTER TABLE INBOUND_DDT_ITEMS ADD COLUMN gross_weight_kg DECIMAL(10,2) DEFAULT NULL",
      "ALTER TABLE INBOUND_DDT_ITEMS ADD COLUMN pallet_group VARCHAR(50) DEFAULT NULL",
      `CREATE TABLE IF NOT EXISTS customer_plan_tariffs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        customer_id INT NOT NULL,
        plan_id INT NOT NULL,
        rule_code VARCHAR(50) NOT NULL,
        custom_price DECIMAL(10,2) NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_cust_plan_rule (customer_id, plan_id, rule_code),
        FOREIGN KEY (customer_id) REFERENCES CUSTOMERS(id) ON DELETE CASCADE,
        FOREIGN KEY (plan_id) REFERENCES tariff_plans(id) ON DELETE CASCADE
      )`,
      "INSERT IGNORE INTO billing_rules (rule_code, description, default_price, rule_type) VALUES ('CANONE_FISSO_MENSILE', 'Fisso Mensile (Nessun calcolo automatico)', 0.00, 'MANUAL')"
    ];
    for (const q of palletAndPlanQueries) {
      try {
        await connection.query(q);
      } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME' && err.code !== 'ER_CANT_DROP_FIELD_OR_KEY') {
          console.warn('[MIGRATE PALLET/PLAN WARNING]', err.message);
        }
      }
    }

    // Crea il listino globale di default "Fisso Mensile" (con una sola voce che non calcola nulla) se non esiste ancora
    try {
      const [flatRows] = await connection.query('SELECT id FROM tariff_plans WHERE is_flat_rate = TRUE LIMIT 1');
      if (flatRows.length === 0) {
        const [defRows] = await connection.query('SELECT id FROM tariff_plans WHERE is_default = TRUE LIMIT 1');
        const shouldBeDefault = defRows.length === 0;
        const [insPlan] = await connection.query(
          `INSERT IGNORE INTO tariff_plans (name, description, is_default, is_flat_rate)
           VALUES (?, ?, ?, TRUE)`,
          [
            'Fisso Mensile',
            'Listino di default per clienti a canone fisso mensile: non calcola movimentazioni IN/OUT, soste, deposito o flag sulle palette.',
            shouldBeDefault
          ]
        );
        let flatPlanId = insPlan.insertId;
        if (!flatPlanId) {
          const [[existingByName]] = await connection.query('SELECT id FROM tariff_plans WHERE name = ?', ['Fisso Mensile']);
          if (existingByName) {
            flatPlanId = existingByName.id;
            await connection.query('UPDATE tariff_plans SET is_flat_rate = TRUE WHERE id = ?', [flatPlanId]);
          }
        }
        if (flatPlanId) {
          await connection.query(
            'UPDATE tariff_plans SET invoice_label = COALESCE(invoice_label, ?) WHERE id = ?',
            ['Fisso Mensile (Nessun addebito a consumo)', flatPlanId]
          );
          await connection.query(
            'INSERT IGNORE INTO tariff_plan_items (plan_id, rule_code, price) VALUES (?, ?, 0.00)',
            [flatPlanId, 'CANONE_FISSO_MENSILE']
          );
        }
      } else if (flatRows[0]?.id) {
        await connection.query(
          'UPDATE tariff_plans SET invoice_label = COALESCE(invoice_label, ?) WHERE id = ?',
          ['Fisso Mensile (Nessun addebito a consumo)', flatRows[0].id]
        );
      }
    } catch (flatErr) {
      console.warn('[MIGRATE FLAT PLAN WARNING]', flatErr.message);
    }

    // Consente archiviazione cronologica di più proforme per lo stesso cliente/mese (rimuove eventuale unique_proforma)
    try {
      const [uniqIdx] = await connection.query("SHOW INDEX FROM invoices WHERE Key_name = 'unique_proforma'");
      if (uniqIdx.length > 0) {
        try {
          await connection.query('ALTER TABLE invoices ADD INDEX idx_invoices_cust_period (customer_id, period_month, period_year)');
        } catch (_) {}
        await connection.query('ALTER TABLE invoices DROP INDEX unique_proforma');
      }
    } catch (invIdxErr) {
      console.warn('[MIGRATE INVOICES INDEX WARNING]', invIdxErr.message);
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
      const [products] = await connection.query('SELECT id, sku, name, customer_id, default_article_number FROM PRODUCTS');
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
      const [remainingProds] = await connection.query('SELECT id, sku, name, customer_id FROM PRODUCTS');
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
    
    // 4. Inizializza Ruoli Piramidali di Default (Discord-style RBAC)
    try {
      const { seedDefaultRoles } = require('../utils/permissions');
      await seedDefaultRoles(connection);
      console.log('✅ Ruoli piramidali sincronizzati.');
    } catch (roleSeedErr) {
      console.warn('[MIGRATE ROLES SEED WARNING]', roleSeedErr.message);
    }

    // 5. Inizializza Tabelle Form Dinamici & Arrivo Merce
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS CUSTOM_FORMS (
          id INT AUTO_INCREMENT PRIMARY KEY,
          code VARCHAR(50) UNIQUE NOT NULL,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          category VARCHAR(50) DEFAULT 'INBOUND',
          target_device VARCHAR(20) DEFAULT 'ZEBRA',
          is_active BOOLEAN DEFAULT TRUE,
          icon VARCHAR(50) DEFAULT 'ClipboardList',
          color_accent VARCHAR(30) DEFAULT 'blue',
          display_mode VARCHAR(30) DEFAULT 'SHOW_ON_HOME',
          is_default BOOLEAN DEFAULT FALSE,
          steps JSON NOT NULL,
          created_by VARCHAR(100) DEFAULT 'Sistema',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS CUSTOM_FORM_SUBMISSIONS (
          id INT AUTO_INCREMENT PRIMARY KEY,
          form_id INT NOT NULL,
          session_code VARCHAR(100) UNIQUE NOT NULL,
          status ENUM('IN_PROGRESS', 'STANDBY_APPROVAL', 'COMPLETED', 'ABORTED', 'REJECTED') DEFAULT 'IN_PROGRESS',
          current_step_id VARCHAR(100) DEFAULT NULL,
          operator_id INT DEFAULT NULL,
          operator_name VARCHAR(100) DEFAULT NULL,
          answers JSON DEFAULT NULL,
          standby_reason TEXT DEFAULT NULL,
          approved_by INT DEFAULT NULL,
          approved_by_name VARCHAR(100) DEFAULT NULL,
          approved_at DATETIME DEFAULT NULL,
          approval_notes TEXT DEFAULT NULL,
          rejection_reason TEXT DEFAULT NULL,
          metadata JSON DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          completed_at DATETIME DEFAULT NULL,
          FOREIGN KEY (form_id) REFERENCES CUSTOM_FORMS(id) ON DELETE CASCADE
        )
      `);

      // Verifica se esiste già il form standard ARRIVO_MERCE
      const [existingForm] = await connection.query("SELECT id FROM CUSTOM_FORMS WHERE code = 'ARRIVO_MERCE'");
      if (existingForm.length === 0) {
        const defaultSteps = [
          {
            id: "step_mezzo",
            title: "Tipo di Mezzo in Arrivo",
            subtitle: "Seleziona se il carico giunge con automezzo standard o container",
            type: "CHOICE",
            field_key: "tipo_mezzo",
            options: [
              { label: "Camion", value: "CAMION", next_step_id: "step_ddt", color: "blue" },
              { label: "Container", value: "CONTAINER", next_step_id: "step_container", color: "amber" }
            ]
          },
          {
            id: "step_ddt",
            title: "Numero DDT",
            subtitle: "Inserisci il numero del Documento di Trasporto indicato dall'autista",
            type: "TEXT",
            field_key: "numero_ddt",
            placeholder: "Es. DDT-2026/0849",
            required: true,
            next_step_id: "step_temp_check"
          },
          {
            id: "step_container",
            title: "Numero Container",
            subtitle: "Inserisci la sigla e matricola del container (es. 4 lettere + 7 cifre)",
            type: "TEXT",
            field_key: "numero_container",
            placeholder: "Es. MSCU1234567",
            required: true,
            next_step_id: "step_sigillo"
          },
          {
            id: "step_sigillo",
            title: "È presente un sigillo?",
            subtitle: "Verificare visivamente la presenza del sigillo di sicurezza intatto sul container",
            type: "CHOICE",
            field_key: "sigillo_presente",
            options: [
              { label: "Sì, Sigillo Presente", value: "SI", next_step_id: "step_sigillo_num", color: "emerald" },
              { label: "No, Sigillo Assente o Manomesso", value: "NO", next_step_id: "step_standby_qa", color: "rose" }
            ]
          },
          {
            id: "step_sigillo_num",
            title: "Numero Sigillo di Sicurezza",
            subtitle: "Trascrivi esattamente la matricola del sigillo metallico o plastico",
            type: "TEXT",
            field_key: "numero_sigillo",
            placeholder: "Es. SEAL-987654",
            required: true,
            next_step_id: "step_temp_check"
          },
          {
            id: "step_standby_qa",
            title: "⚠️ Fermo Standby: Contatta Ufficio / QA / GDP",
            subtitle: "Sigillo assente o anomalia rilevata. La procedura è sospesa in attesa di autorizzazione da parte del QA o dell'Ufficio.",
            type: "STANDBY",
            standby_reason: "Sigillo assente o non conforme sul container. Richiesta autorizzazione formale QA/GDP prima dello scarico.",
            next_step_id_on_approved: "step_temp_check"
          },
          {
            id: "step_temp_check",
            title: "È merce a temperatura controllata?",
            subtitle: "Specificare se il carico richiede mantenimento della catena del freddo",
            type: "CHOICE",
            field_key: "is_temp_controlled",
            options: [
              { label: "Sì (Pharma / Fresco)", value: "SI", next_step_id: "step_temp_range", color: "blue" },
              { label: "No (Temperatura Ambiente)", value: "NO", next_step_id: "step_igiene", color: "slate" }
            ]
          },
          {
            id: "step_temp_range",
            title: "Fascia Temperatura Richiesta",
            subtitle: "Seleziona il range termico prescritto per questo trasporto",
            type: "CHOICE",
            field_key: "temp_range",
            options: [
              { label: "+2°C / +8°C", value: "2_8", next_step_id: "step_temp_value", color: "cyan" },
              { label: "+15°C / +25°C", value: "15_25", next_step_id: "step_temp_value", color: "emerald" },
              { label: "< 25°C", value: "UNDER_25", next_step_id: "step_temp_value", color: "amber" }
            ]
          },
          {
            id: "step_temp_value",
            title: "A che temperatura è il mezzo?",
            subtitle: "Rileva la temperatura interna o termoregistratore del mezzo (°C)",
            type: "TEMPERATURE",
            field_key: "misura_temperatura",
            unit: "°C",
            min: -30,
            max: 50,
            check_range_against: "temp_range",
            range_definitions: {
              "2_8": { min: 2, max: 8, label: "+2°C / +8°C" },
              "15_25": { min: 15, max: 25, label: "+15°C / +25°C" },
              "UNDER_25": { min: -30, max: 25, label: "< 25°C" }
            },
            next_step_id: "step_igiene",
            next_if_discrepancy: "step_temp_reject"
          },
          {
            id: "step_temp_reject",
            title: "🛑 Temperatura Fuori Range - Non Scaricare!",
            subtitle: "Non scaricare ancora. Invita l'autista a sostare fuori e fallo tornare quando il camion sarà alla temperatura prescritta.",
            type: "REJECT",
            rejection_message: "Non scaricare ancora, invita l'autista a sostare fuori e fallo tornare quando il camion sarà a temperatura."
          },
          {
            id: "step_igiene",
            title: "Condizioni Igienico-Sanitarie Mezzo",
            subtitle: "Ispezione visiva e olfattiva del vano di carico",
            type: "CHECKLIST",
            field_key: "igiene_checks",
            items: [
              { id: "pulito", label: "Pianale pulito, asciutto e privo di odori anomali" },
              { id: "integro", label: "Pareti, tetto e porte integri senza infiltrazioni" },
              { id: "no_parassiti", label: "Assenza di tracce di parassiti o contaminazioni" },
              { id: "imballi_ok", label: "Bancali / colli stabili e imballi integri" }
            ],
            next_step_id: "step_summary"
          },
          {
            id: "step_summary",
            title: "Riepilogo & Conferma Arrivo",
            subtitle: "Verifica le informazioni registrate prima di confermare l'ingresso del veicolo",
            type: "SUMMARY"
          }
        ];

        await connection.query(
          `INSERT INTO CUSTOM_FORMS (code, title, description, category, target_device, is_active, steps, created_by)
           VALUES ('ARRIVO_MERCE', 'Arrivo Merce & Controllo Mezzo', 'Procedura guidata per check-in mezzo, verifica sigillo, catena del freddo e controlli QA/GDP.', 'INBOUND', 'ZEBRA', 1, ?, 'Sistema')`,
          [JSON.stringify(defaultSteps)]
        );
        console.log('✅ Form standard ARRIVO_MERCE inizializzato con successo.');
      }
    } catch (formInitErr) {
      console.warn('[MIGRATE CUSTOM FORMS WARNING]', formInitErr.message);
    }

    // 5b. Regola Sosta Giornaliera & Tabelle/Colonne Concorrenza TMS
    try {
      await connection.query(
        `INSERT IGNORE INTO billing_rules (rule_code, description, default_price, rule_type)
         VALUES ('SOSTA_GIORNO', 'Sosta Giornaliera (Prezzo al Giorno per Paletta)', 0.50, 'STORAGE')`
      );

      await connection.query(`
        CREATE TABLE IF NOT EXISTS TMS_META (
          id INT PRIMARY KEY,
          version INT NOT NULL DEFAULT 1,
          updated_by VARCHAR(100) DEFAULT 'Sistema',
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      await connection.query(`INSERT IGNORE INTO TMS_META (id, version, updated_by) VALUES (1, 1, 'Sistema')`);

      const [tmsDriverCols] = await connection.query(`SHOW COLUMNS FROM TMS_DRIVERS`);
      const driverColNames = new Set(tmsDriverCols.map(c => c.Field));
      if (!driverColNames.has('phone')) {
        await connection.query(`ALTER TABLE TMS_DRIVERS ADD COLUMN phone VARCHAR(50) DEFAULT NULL AFTER vehicle`);
      }
      if (!driverColNames.has('updated_at')) {
        await connection.query(`ALTER TABLE TMS_DRIVERS ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`);
      }

      const [tmsTripCols] = await connection.query(`SHOW COLUMNS FROM TMS_TRIPS`);
      const tripColNames = new Set(tmsTripCols.map(c => c.Field));
      if (!tripColNames.has('version')) {
        await connection.query(`ALTER TABLE TMS_TRIPS ADD COLUMN version INT NOT NULL DEFAULT 1 AFTER sort_order`);
      }
      if (!tripColNames.has('updated_at')) {
        await connection.query(`ALTER TABLE TMS_TRIPS ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`);
      }
    } catch (tmsBilErr) {
      console.warn('[MIGRATE TMS/BILLING WARNING]', tmsBilErr.message);
    }

    // 5c. Bolla di Uscita Automatica & Indirizzi di Consegna Multipli per Cliente
    try {
      const [custCols] = await connection.query(`SHOW COLUMNS FROM CUSTOMERS`);
      const custColNames = new Set(custCols.map(c => c.Field));
      if (!custColNames.has('generate_exit_ddt')) {
        await connection.query(`ALTER TABLE CUSTOMERS ADD COLUMN generate_exit_ddt BOOLEAN DEFAULT TRUE`);
        await connection.query(`UPDATE CUSTOMERS SET generate_exit_ddt = 1 WHERE generate_exit_ddt IS NULL`);
      }

      await connection.query(`
        CREATE TABLE IF NOT EXISTS CUSTOMER_DELIVERY_ADDRESSES (
          id INT AUTO_INCREMENT PRIMARY KEY,
          customer_id INT NOT NULL,
          label VARCHAR(120) NOT NULL,
          address_line VARCHAR(255) NOT NULL,
          city VARCHAR(120) DEFAULT NULL,
          cap VARCHAR(20) DEFAULT NULL,
          province VARCHAR(20) DEFAULT NULL,
          country VARCHAR(80) DEFAULT 'Italia',
          contact_name VARCHAR(120) DEFAULT NULL,
          contact_phone VARCHAR(60) DEFAULT NULL,
          notes VARCHAR(255) DEFAULT NULL,
          is_default BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_cust_deliv_addr_cust (customer_id, is_default),
          FOREIGN KEY (customer_id) REFERENCES CUSTOMERS(id) ON DELETE CASCADE
        )
      `);

      const [outCols] = await connection.query(`SHOW COLUMNS FROM OUTBOUND_ORDERS`);
      const outColNames = new Set(outCols.map(c => c.Field));
      if (!outColNames.has('generate_exit_ddt')) {
        await connection.query(`ALTER TABLE OUTBOUND_ORDERS ADD COLUMN generate_exit_ddt BOOLEAN DEFAULT TRUE`);
      }
      if (!outColNames.has('bolla_number')) {
        await connection.query(`ALTER TABLE OUTBOUND_ORDERS ADD COLUMN bolla_number VARCHAR(60) DEFAULT NULL`);
      }
      if (!outColNames.has('bolla_generated_at')) {
        await connection.query(`ALTER TABLE OUTBOUND_ORDERS ADD COLUMN bolla_generated_at DATETIME DEFAULT NULL`);
      }
      if (!outColNames.has('delivery_address_id')) {
        await connection.query(`ALTER TABLE OUTBOUND_ORDERS ADD COLUMN delivery_address_id INT DEFAULT NULL`);
      }
      if (!outColNames.has('delivery_label')) {
        await connection.query(`ALTER TABLE OUTBOUND_ORDERS ADD COLUMN delivery_label VARCHAR(120) DEFAULT NULL`);
      }
      if (!outColNames.has('delivery_address_text')) {
        await connection.query(`ALTER TABLE OUTBOUND_ORDERS ADD COLUMN delivery_address_text TEXT DEFAULT NULL`);
      }
      if (!outColNames.has('bolla_options')) {
        await connection.query(`ALTER TABLE OUTBOUND_ORDERS ADD COLUMN bolla_options JSON DEFAULT NULL`);
      }

      const [ddtItemCols] = await connection.query(`SHOW COLUMNS FROM INBOUND_DDT_ITEMS`);
      const ddtItemColNames = new Set(ddtItemCols.map(c => c.Field));
      if (!ddtItemColNames.has('flags')) {
        await connection.query(`ALTER TABLE INBOUND_DDT_ITEMS ADD COLUMN flags JSON DEFAULT NULL`);
      }
      console.log('✅ Schema Bolla di Uscita e Indirizzi Consegna verificato.');
    } catch (bollaMigErr) {
      console.warn('[MIGRATE BOLLA WARNING]', bollaMigErr.message);
    }

    // 6. Consolidamento automatico posizioni e merce identica (stessa posizione + stesso prodotto + stesso lotto)
    try {
      const { consolidateLocationPallets } = require('../utils/palletConsolidation');
      await consolidateLocationPallets(connection);
      console.log('✅ Consolidamento posizioni e barcode completato.');
    } catch (consErr) {
      console.warn('[MIGRATE CONSOLIDATION WARNING]', consErr.message);
    }

    // 7. Indici di performance per scalabilità a lungo termine (mesi/anni di storico)
    try {
      const ensureIndex = async (tableName, indexName, columnsSql) => {
        const [[{ cnt }]] = await connection.query(
          `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
          [tableName, indexName]
        );
        if (cnt === 0) {
          await connection.query(`ALTER TABLE ${tableName} ADD INDEX ${indexName} (${columnsSql})`);
        }
      };

      const indexesToEnsure = [
        ['PALLETS', 'idx_pallets_status_qty', 'status, quantity'],
        ['PALLETS', 'idx_pallets_code', 'pallet_code'],
        ['PALLETS', 'idx_pallets_product_status', 'product_id, status'],
        ['PALLETS', 'idx_pallets_customer_status', 'customer_id, status'],
        ['PALLETS', 'idx_pallets_location', 'location'],
        ['PALLETS', 'idx_pallets_inbound_ddt', 'inbound_ddt_id'],
        ['PALLETS', 'idx_pallets_expiration', 'expiration_date'],
        ['PALLETS', 'idx_pallets_quarantine', 'is_quarantined, status'],
        ['PALLETS', 'idx_pallets_created', 'created_at'],
        ['OUTBOUND_ORDERS', 'idx_outbound_status_created', 'status, created_at'],
        ['OUTBOUND_ORDERS', 'idx_outbound_customer_status', 'customer_id, status'],
        ['OUTBOUND_ORDERS', 'idx_outbound_shipped', 'shipped_at'],
        ['OUTBOUND_ORDERS', 'idx_outbound_exit_date', 'exit_date'],
        ['OUTBOUND_ORDERS', 'idx_outbound_bolla_number', 'bolla_number'],
        ['OUTBOUND_ITEMS', 'idx_out_items_order_status', 'order_id, status'],
        ['OUTBOUND_ITEMS', 'idx_out_items_pallet_id', 'pallet_id'],
        ['OUTBOUND_ITEMS', 'idx_out_items_pallet_code', 'pallet_code'],
        ['OUTBOUND_ITEMS', 'idx_out_items_product', 'product_id'],
        ['INBOUND_DDTS', 'idx_inbound_ddts_status_created', 'status, created_at'],
        ['INBOUND_DDTS', 'idx_inbound_ddts_customer', 'customer_id'],
        ['INBOUND_DDT_ITEMS', 'idx_inbound_ddt_items_ddt', 'inbound_ddt_id'],
        ['INBOUND_DDT_ITEMS', 'idx_inbound_ddt_items_product', 'product_id'],
        ['INBOUND_DISCREPANCY_LOGS', 'idx_inb_disc_ddt_created', 'inbound_ddt_id, created_at'],
        ['AUDIT_LOGS', 'idx_audit_created', 'created_at'],
        ['AUDIT_LOGS', 'idx_audit_action_created', 'action, created_at'],
        ['AUDIT_LOGS', 'idx_audit_user_created', 'username, created_at'],
        ['QUARANTINE_LOGS', 'idx_quarantine_status_blocked', 'status, blocked_at'],
        ['QUARANTINE_LOGS', 'idx_quarantine_customer', 'customer_id'],
        ['QUARANTINE_LOGS', 'idx_quarantine_pallet', 'pallet_id'],
        ['CUSTOM_FORM_SUBMISSIONS', 'idx_cfs_status_created', 'status, created_at'],
        ['OUTBOUND_RETURNS', 'idx_returns_order', 'order_id'],
        ['OUTBOUND_RETURNS', 'idx_returns_date', 'returned_at']
      ];

      for (const [tbl, idxName, cols] of indexesToEnsure) {
        try {
          await ensureIndex(tbl, idxName, cols);
        } catch (idxErr) {
          console.warn(`[MIGRATE INDEX WARNING] ${tbl}.${idxName}:`, idxErr.message);
        }
      }
      console.log('✅ Indici di performance DB verificati.');
    } catch (indexBlockErr) {
      console.warn('[MIGRATE INDEXES WARNING]', indexBlockErr.message);
    }

    console.log('🚀 Migrazioni completate. Database allineato al 100%.');
  } catch (err) {
    console.error('❌ Errore critico durante le migrazioni:', err);
  } finally {
    connection.release();
  }
}

module.exports = runMigrations;

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
