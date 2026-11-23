CREATE DATABASE IF NOT EXISTS maglite_db;
USE maglite_db;

CREATE TABLE IF NOT EXISTS USERS (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'operator',
    requires_password_change BOOLEAN DEFAULT TRUE,
    preferences JSON DEFAULT NULL,
    custom_permissions JSON DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS CUSTOMERS (
    id INT AUTO_INCREMENT PRIMARY KEY,
    unique_id VARCHAR(100) NOT NULL UNIQUE,
    business_name VARCHAR(255) NOT NULL,
    vat_number VARCHAR(50),
    address TEXT,
    phone VARCHAR(50),
    email VARCHAR(100),
    parent_id INT DEFAULT NULL,
    notes TEXT DEFAULT NULL,
    tariff_plan_id INT DEFAULT NULL,
    generate_exit_ddt BOOLEAN DEFAULT TRUE
);

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
);

CREATE TABLE IF NOT EXISTS CUSTOMER_NOTES (
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
);

CREATE TABLE IF NOT EXISTS PRODUCTS (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sku VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    uom VARCHAR(50) NOT NULL DEFAULT 'Scatole',
    units_per_box INT DEFAULT 1,
    boxes_per_pallet INT DEFAULT 1,
    customer_id INT NOT NULL,
    notes TEXT,
    default_article_number VARCHAR(100) DEFAULT NULL,
    flags JSON DEFAULT NULL,
    FOREIGN KEY (customer_id) REFERENCES CUSTOMERS(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS LOCATIONS (
    id INT AUTO_INCREMENT PRIMARY KEY,
    zone VARCHAR(10) NOT NULL,
    col VARCHAR(10) NOT NULL,
    pos VARCHAR(10) NOT NULL,
    barcode VARCHAR(50) NOT NULL UNIQUE,
    pin VARCHAR(5) NOT NULL
);

CREATE TABLE IF NOT EXISTS FREE_LOCATIONS (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS PALLETS (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pallet_code VARCHAR(50) NOT NULL,
    customer_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity DECIMAL(10,2) NOT NULL,
    units_per_box INT DEFAULT 1,
    pallet_uom VARCHAR(50) DEFAULT NULL,
    batch VARCHAR(100),
    warehouse VARCHAR(50),
    status ENUM('PENDING', 'STOCKED', 'SHIPPED') DEFAULT 'PENDING',
    inbound_ddt_id INT DEFAULT NULL,
    client_ddt VARCHAR(100) DEFAULT NULL,
    checkin_id INT DEFAULT NULL,
    checkin_session_code VARCHAR(100) DEFAULT NULL,
    location VARCHAR(50),
    notes TEXT,
    client_pallet_number VARCHAR(100),
    client_article_number VARCHAR(100),
    expiration_date DATE,
    shipped_at DATETIME DEFAULT NULL,
    flags JSON DEFAULT NULL,
    is_quarantined BOOLEAN DEFAULT FALSE,
    quarantine_reason VARCHAR(255) DEFAULT NULL,
    quarantined_at DATETIME DEFAULT NULL,
    quarantined_by VARCHAR(100) DEFAULT NULL,
    quarantine_notes TEXT DEFAULT NULL,
    tariff_plan_id INT DEFAULT NULL,
    net_weight_kg DECIMAL(10,2) DEFAULT NULL,
    gross_weight_kg DECIMAL(10,2) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_pallets_status_qty (status, quantity),
    INDEX idx_pallets_code (pallet_code),
    INDEX idx_pallets_product_status (product_id, status),
    INDEX idx_pallets_customer_status (customer_id, status),
    INDEX idx_pallets_location (location),
    INDEX idx_pallets_inbound_ddt (inbound_ddt_id),
    INDEX idx_pallets_expiration (expiration_date),
    INDEX idx_pallets_quarantine (is_quarantined, status),
    INDEX idx_pallets_created (created_at),
    FOREIGN KEY (customer_id) REFERENCES CUSTOMERS(id) ON DELETE RESTRICT,
    FOREIGN KEY (product_id) REFERENCES PRODUCTS(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS OUTBOUND_ORDERS (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_code VARCHAR(50) NOT NULL UNIQUE,
  customer_id INT NOT NULL,
  exit_date DATE NOT NULL,
  status ENUM('PENDING', 'PICKING', 'READY', 'SHIPPED', 'RETURNED') DEFAULT 'PENDING',
  client_ddt VARCHAR(100) DEFAULT NULL,
  notes TEXT DEFAULT NULL,
  picking_operator VARCHAR(100) DEFAULT NULL,
  shipped_by VARCHAR(50) DEFAULT NULL,
  start_picking_at DATETIME DEFAULT NULL,
  end_picking_at DATETIME DEFAULT NULL,
  shipped_at DATETIME DEFAULT NULL,
  return_count INT DEFAULT 0,
  last_returned_at DATETIME DEFAULT NULL,
  last_returned_by VARCHAR(100) DEFAULT NULL,
  last_return_reason VARCHAR(255) DEFAULT NULL,
  generate_exit_ddt BOOLEAN DEFAULT TRUE,
  bolla_number VARCHAR(60) DEFAULT NULL,
  bolla_generated_at DATETIME DEFAULT NULL,
  delivery_address_id INT DEFAULT NULL,
  delivery_label VARCHAR(120) DEFAULT NULL,
  delivery_address_text TEXT DEFAULT NULL,
  bolla_options JSON DEFAULT NULL,
  created_by VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_outbound_status_created (status, created_at),
  INDEX idx_outbound_customer_status (customer_id, status),
  INDEX idx_outbound_shipped (shipped_at),
  INDEX idx_outbound_exit_date (exit_date),
  INDEX idx_outbound_bolla_number (bolla_number),
  FOREIGN KEY (customer_id) REFERENCES CUSTOMERS(id)
);

CREATE TABLE IF NOT EXISTS OUTBOUND_ITEMS (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  pallet_id INT DEFAULT NULL,
  pallet_code VARCHAR(50) NOT NULL,
  product_id INT NOT NULL,
  batch VARCHAR(100) DEFAULT NULL,
  quantity_required DECIMAL(10,2) NOT NULL,
  quantity_picked DECIMAL(10,2) DEFAULT 0,
  requested_uom VARCHAR(50) DEFAULT NULL,
  client_pallet_number VARCHAR(100) DEFAULT NULL,
  is_specific BOOLEAN DEFAULT FALSE,
  status ENUM('PENDING', 'PICKED') DEFAULT 'PENDING',
  picked_at DATETIME DEFAULT NULL,
  INDEX idx_out_items_order_status (order_id, status),
  INDEX idx_out_items_pallet_id (pallet_id),
  INDEX idx_out_items_pallet_code (pallet_code),
  INDEX idx_out_items_product (product_id),
  FOREIGN KEY (order_id) REFERENCES OUTBOUND_ORDERS(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES PRODUCTS(id)
);

CREATE TABLE IF NOT EXISTS AUDIT_LOGS (
    id INT AUTO_INCREMENT PRIMARY KEY,
    action VARCHAR(50) NOT NULL,
    details TEXT NOT NULL,
    source VARCHAR(50) NOT NULL,
    username VARCHAR(50) DEFAULT 'Sistema',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_audit_created (created_at),
    INDEX idx_audit_action_created (action, created_at),
    INDEX idx_audit_user_created (username, created_at)
);

CREATE TABLE IF NOT EXISTS billing_rules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    rule_code VARCHAR(50) NOT NULL UNIQUE,
    description VARCHAR(255) NOT NULL,
    default_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    rule_type ENUM('EVENT', 'STORAGE', 'FLAG', 'DISCOUNT_PERCENT', 'DISCOUNT_FIXED', 'MANUAL') NOT NULL
);

INSERT IGNORE INTO billing_rules (rule_code, description, default_price, rule_type) VALUES 
('IN_PALLET', 'Ingresso Paletta', 20.00, 'EVENT'),
('OUT_PALLET', 'Uscita Paletta', 20.00, 'EVENT'),
('SOSTA_15', 'Sosta (Ingresso <= 15)', 4.00, 'STORAGE'),
('SOSTA_MAGGIORE_15', 'Sosta (Ingresso > 15)', 8.00, 'STORAGE'),
('DEPOSITO_PALLET', 'Deposito Paletta (Giacenza Rimasta)', 10.00, 'STORAGE'),
('SOSTA_GIORNO', 'Sosta Giornaliera (Prezzo al Giorno per Paletta)', 0.50, 'STORAGE'),
('CANONE_FISSO_MENSILE', 'Fisso Mensile (Nessun calcolo automatico)', 0.00, 'MANUAL');

CREATE TABLE IF NOT EXISTS client_tariffs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    rule_code VARCHAR(50) NOT NULL,
    custom_price DECIMAL(10,2) NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY(customer_id, rule_code)
);

CREATE TABLE IF NOT EXISTS tariff_plans (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL UNIQUE,
    description TEXT DEFAULT NULL,
    is_default BOOLEAN DEFAULT FALSE,
    is_flat_rate BOOLEAN DEFAULT FALSE,
    invoice_label VARCHAR(255) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tariff_plan_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    plan_id INT NOT NULL,
    rule_code VARCHAR(50) NOT NULL,
    price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    UNIQUE KEY unique_plan_rule (plan_id, rule_code),
    FOREIGN KEY (plan_id) REFERENCES tariff_plans(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_plan_tariffs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    plan_id INT NOT NULL,
    rule_code VARCHAR(50) NOT NULL,
    custom_price DECIMAL(10,2) NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_cust_plan_rule (customer_id, plan_id, rule_code),
    FOREIGN KEY (customer_id) REFERENCES CUSTOMERS(id) ON DELETE CASCADE,
    FOREIGN KEY (plan_id) REFERENCES tariff_plans(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
    setting_key VARCHAR(100) PRIMARY KEY,
    setting_value TEXT
);

CREATE TABLE IF NOT EXISTS invoices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    period_month INT NOT NULL,
    period_year INT NOT NULL,
    base_total DECIMAL(10, 2) NOT NULL,
    vat_amount DECIMAL(10, 2) NOT NULL,
    grand_total DECIMAL(10, 2) NOT NULL,
    invoice_data JSON DEFAULT NULL,
    is_paid BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_invoices_cust_period (customer_id, period_month, period_year)
);

CREATE TABLE IF NOT EXISTS expenses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    description VARCHAR(255) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    expense_date DATE NOT NULL,
    category VARCHAR(100) DEFAULT 'Generale',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS INBOUND_DDTS (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ddt_number VARCHAR(50) NOT NULL UNIQUE,
    customer_id INT NOT NULL,
    status ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'DISCREPANCY') DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME DEFAULT NULL,
    notes TEXT,
    discrepancy_accepted BOOLEAN DEFAULT FALSE,
    discrepancy_reason TEXT DEFAULT NULL,
    discrepancy_resolved_by VARCHAR(100) DEFAULT NULL,
    discrepancy_resolved_at DATETIME DEFAULT NULL,
    rejected_count INT DEFAULT 0,
    last_rejected_reason TEXT DEFAULT NULL,
    last_rejected_by VARCHAR(100) DEFAULT NULL,
    last_rejected_at DATETIME DEFAULT NULL,
    client_ddt VARCHAR(100) DEFAULT NULL,
    checkin_id INT DEFAULT NULL,
    checkin_session_code VARCHAR(100) DEFAULT NULL,
    FOREIGN KEY (customer_id) REFERENCES CUSTOMERS(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS INBOUND_DISCREPANCY_LOGS (
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
);

CREATE TABLE IF NOT EXISTS INBOUND_DDT_ITEMS (
    id INT AUTO_INCREMENT PRIMARY KEY,
    inbound_ddt_id INT NOT NULL,
    product_id INT NOT NULL,
    sku VARCHAR(100) DEFAULT NULL,
    product_name VARCHAR(255) DEFAULT NULL,
    product_uom VARCHAR(50) DEFAULT NULL,
    expected_quantity DECIMAL(10,2) NOT NULL,
    actual_quantity DECIMAL(10,2) DEFAULT 0,
    units_per_box INT,
    boxes_per_pallet INT,
    pallet_uom VARCHAR(50),
    batch VARCHAR(100),
    client_pallet_number VARCHAR(100),
    client_article_number VARCHAR(100),
    expiration_date DATE,
    location VARCHAR(50) DEFAULT NULL,
    tariff_plan_id INT DEFAULT NULL,
    net_weight_kg DECIMAL(10,2) DEFAULT NULL,
    gross_weight_kg DECIMAL(10,2) DEFAULT NULL,
    pallet_group VARCHAR(50) DEFAULT NULL,
    flags JSON DEFAULT NULL,
    arrival_date DATETIME DEFAULT NULL,
    notes TEXT,
    FOREIGN KEY (inbound_ddt_id) REFERENCES INBOUND_DDTS(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES PRODUCTS(id)
);

-- TMS TABLES
CREATE TABLE IF NOT EXISTS TMS_DRIVERS (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    vehicle VARCHAR(255) NOT NULL,
    phone VARCHAR(50) DEFAULT NULL,
    sort_order INT DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS TMS_TRIPS (
    id VARCHAR(50) PRIMARY KEY,
    driver_id VARCHAR(50) DEFAULT NULL,
    customer VARCHAR(255),
    ref VARCHAR(100),
    pickup VARCHAR(255),
    pickupTime DATETIME,
    delivery VARCHAR(255),
    deliveryTime DATETIME,
    revenue DECIMAL(10,2) DEFAULT 0,
    cost DECIMAL(10,2) DEFAULT 0,
    status VARCHAR(50) DEFAULT 'UNASSIGNED',
    title VARCHAR(255),
    notes TEXT,
    sort_order INT DEFAULT 0,
    version INT NOT NULL DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS TMS_META (
    id INT PRIMARY KEY,
    version INT NOT NULL DEFAULT 1,
    updated_by VARCHAR(100) DEFAULT 'Sistema',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT IGNORE INTO TMS_META (id, version, updated_by) VALUES (1, 1, 'Sistema');


CREATE TABLE IF NOT EXISTS OUTBOUND_RETURNS (
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
);


CREATE TABLE IF NOT EXISTS ROLES (
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
);

CREATE TABLE IF NOT EXISTS QUARANTINE_LOGS (
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
);


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
);

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
);

CREATE TABLE IF NOT EXISTS NOTIFICATIONS (
    id INT AUTO_INCREMENT PRIMARY KEY,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    customer_id INT DEFAULT NULL,
    customer_name VARCHAR(255) DEFAULT NULL,
    entity_type VARCHAR(50) DEFAULT NULL,
    entity_code VARCHAR(100) DEFAULT NULL,
    link_path VARCHAR(255) DEFAULT NULL,
    actor_username VARCHAR(100) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_notifications_created (created_at),
    INDEX idx_notifications_customer (customer_id, created_at),
    INDEX idx_notifications_type (type, created_at)
);

CREATE TABLE IF NOT EXISTS NOTIFICATION_READS (
    user_id INT NOT NULL,
    notification_id INT NOT NULL,
    read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, notification_id),
    INDEX idx_notif_reads_notif (notification_id),
    FOREIGN KEY (notification_id) REFERENCES NOTIFICATIONS(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS USER_NOTIFICATION_CUSTOMER_SETTINGS (
    user_id INT NOT NULL,
    customer_id INT NOT NULL,
    is_muted BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, customer_id),
    INDEX idx_user_notif_cust_muted (user_id, is_muted)
);

CREATE TABLE IF NOT EXISTS TICKETS (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ticket_code VARCHAR(30) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(50) NOT NULL DEFAULT 'BUG',
    priority ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL DEFAULT 'MEDIUM',
    status ENUM('OPEN', 'IN_PROGRESS', 'WAITING_INFO', 'RESOLVED', 'CLOSED', 'REJECTED') NOT NULL DEFAULT 'OPEN',
    area VARCHAR(100) DEFAULT NULL,
    created_by_id INT NOT NULL,
    created_by_username VARCHAR(100) NOT NULL,
    assigned_to_username VARCHAR(100) DEFAULT NULL,
    resolution_notes TEXT DEFAULT NULL,
    resolved_at DATETIME DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tickets_status_updated (status, updated_at),
    INDEX idx_tickets_creator (created_by_id, created_at),
    INDEX idx_tickets_priority (priority, status)
);

CREATE TABLE IF NOT EXISTS TICKET_MESSAGES (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ticket_id INT NOT NULL,
    author_id INT NOT NULL,
    author_username VARCHAR(100) NOT NULL,
    author_role VARCHAR(50) NOT NULL DEFAULT 'operator',
    message TEXT NOT NULL,
    status_change_to VARCHAR(30) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ticket_msgs_ticket (ticket_id, created_at),
    FOREIGN KEY (ticket_id) REFERENCES TICKETS(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS CHANGELOGS (
    id INT AUTO_INCREMENT PRIMARY KEY,
    version VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    summary TEXT NOT NULL,
    items JSON DEFAULT NULL,
    is_published BOOLEAN DEFAULT TRUE,
    show_popup BOOLEAN DEFAULT TRUE,
    created_by_id INT DEFAULT NULL,
    created_by_username VARCHAR(100) NOT NULL,
    published_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_changelogs_pub (is_published, published_at)
);

CREATE TABLE IF NOT EXISTS CHANGELOG_VIEWS (
    user_id INT NOT NULL,
    changelog_id INT NOT NULL,
    seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, changelog_id),
    FOREIGN KEY (changelog_id) REFERENCES CHANGELOGS(id) ON DELETE CASCADE
);
