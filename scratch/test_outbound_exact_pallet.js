const crypto = require('crypto');
const db = require('../backend/src/config/db');

const API_BASE = 'http://localhost:3000/api';
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_maglite_2026';

// Create a JWT token using HMAC-SHA256
function createToken(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + 3600 };
  const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

async function request(path, options = {}) {
  const token = options.token;
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const contentType = response.headers.get('content-type') || '';
  let data;
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.arrayBuffer();
  }

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return { status: response.status, data };
}

async function run() {
  console.log('--- TEST SELEZIONE PALETTA ESATTA SU OUTBOUND & ZEBRA ---');

  // Find a developer user
  const [users] = await db.query("SELECT id, username, role FROM USERS WHERE role = 'developer' LIMIT 1");
  const user = users[0] || { id: 1, username: 'admin', role: 'developer' };
  const token = createToken({ id: user.id, username: user.username, role: 'developer' });

  // 1. Get or create customer & product
  const { data: customers } = await request('/customers', { token });
  const customer = customers[0];
  if (!customer) throw new Error('Nessun cliente presente');

  const { data: products } = await request('/products', { token });
  const product = products.find(p => p.customer_id === customer.id) || products[0];
  if (!product) throw new Error('Nessun prodotto presente');

  const timestamp = Date.now();
  const testBatch = `LOT-EXACT-${timestamp}`;
  const highFloorRef = `PAL-HIGH-${timestamp}`;
  const groundFloorRef = `PAL-GND-${timestamp}`;

  // Direct insert 2 pallets to test allocation
  const [highPalRes] = await db.query(
    `INSERT INTO PALLETS (pallet_code, customer_id, product_id, quantity, batch, location, client_pallet_number, status)
     VALUES (?, ?, ?, 50, ?, 'Area1-A-21', ?, 'STOCKED')`,
    [`TEST-H-${timestamp}`, customer.id, product.id, testBatch, highFloorRef]
  );
  const highPalId = highPalRes.insertId;

  const [groundPalRes] = await db.query(
    `INSERT INTO PALLETS (pallet_code, customer_id, product_id, quantity, batch, location, client_pallet_number, status)
     VALUES (?, ?, ?, 50, ?, 'Area1-A-01', ?, 'STOCKED')`,
    [`TEST-G-${timestamp}`, customer.id, product.id, testBatch, groundFloorRef]
  );
  const groundPalId = groundPalRes.insertId;

  console.log(`Creati due bancali per lotto ${testBatch}:`);
  console.log(`- Paletta Piano Alto (Piano 2): ID ${highPalId}, Rif: ${highFloorRef}, Loc: Area1-A-21`);
  console.log(`- Paletta Piano Terra (Piano 0): ID ${groundPalId}, Rif: ${groundFloorRef}, Loc: Area1-A-01`);

  let orderId = null;
  let orderCode = null;

  try {
    // 2. Create outbound order specifying high floor pallet!
    console.log('\n2. Creazione Ordine Outbound richiedendo espressamente la paletta al Piano 2...');
    const { data: createRes } = await request('/outbound', {
      method: 'POST',
      token,
      body: {
        customer_id: customer.id,
        exit_date: new Date().toISOString().split('T')[0],
        items: [
          {
            product_id: product.id,
            batch: testBatch,
            pallet_id: highPalId,
            client_pallet_number: highFloorRef,
            quantity_required: 10,
            requested_uom: 'Pezzi'
          }
        ]
      }
    });

    orderId = createRes.order_id || createRes.id;
    orderCode = createRes.order_code;
    console.log(`Ordine creato: ID ${orderId}, Codice: ${orderCode}`);

    // 3. Verify order details
    const { data: detRes } = await request(`/outbound/${orderId}/details`, { token });
    const allocItem = detRes.items[0];
    console.log(`Allocazione riga: pallet_id=${allocItem.pallet_id}, is_specific=${allocItem.is_specific}, client_pallet_number=${allocItem.client_pallet_number}`);

    if (allocItem.pallet_id !== highPalId) {
      throw new Error(`ERRORE: L'ordine ha allocato la paletta ID ${allocItem.pallet_id} invece di ${highPalId}`);
    }
    if (!allocItem.is_specific) {
      throw new Error(`ERRORE: is_specific dovrebbe essere 1!`);
    }
    console.log('✅ Allocazione esatta riuscita: la paletta al Piano 2 è stata mantenuta e contrassegnata come specifica!');

    // 4. Request PDF (must NOT swap to ground floor!)
    console.log('\n4. Generazione Picking List PDF (verifica che non avvenga lo swap a piano terra)...');
    const { data: pdfData } = await request(`/outbound/${orderCode}/pdf`, { token });
    if (!pdfData || pdfData.byteLength === 0) {
      throw new Error('PDF vuoto!');
    }

    // Re-check order details to make sure PDF did not mutate the item to ground floor
    const { data: detAfterPdf } = await request(`/outbound/${orderId}/details`, { token });
    if (detAfterPdf.items[0].pallet_id !== highPalId) {
      throw new Error(`ERRORE: Il download del PDF ha sovrascritto la paletta con ${detAfterPdf.items[0].pallet_id}`);
    }
    console.log('✅ PDF verificato: nessun sovrascrittura o swap a piano terra!');

    // 5. Zebra Picking info
    console.log('\n5. Lettura dati Zebra (/outbound/zebra/:code)...');
    const { data: zebraGet } = await request(`/outbound/zebra/${orderCode}`, { token });
    const zItem = zebraGet.items[0];
    console.log(`Zebra item: Zone="${zItem.zone}", Col="${zItem.col}", Pos="${zItem.pos}", Rif="${zItem.client_pallet_number}", Specific=${zItem.is_specific}`);
    if (zItem.pallet_id !== highPalId) {
      throw new Error('Zebra item non punta alla paletta del piano alto!');
    }
    if (zItem.zone.toUpperCase() !== 'AREA1' || zItem.col !== 'A' || zItem.pos !== '21') {
      throw new Error(`Coordinate posizione Zebra errate: Zone=${zItem.zone}, Col=${zItem.col}, Pos=${zItem.pos}`);
    }
    console.log('✅ Zebra ha ricevuto correttamente le coordinate responsive e il riferimento paletta specifica!');

    // 6. Test Zebra Pick: try to scan a different pallet (swap attempt) -> MUST FAIL
    console.log('\n6. Tentativo di scansionare una paletta diversa (Piano Terra) durante il pick...');
    try {
      await request('/outbound/zebra/pick', {
        method: 'POST',
        token,
        body: {
          order_id: orderId,
          item_id: zItem.id,
          pallet_code: `TEST-G-${timestamp}`, // ground floor pallet code
          qty_picked: 10
        }
      });
      throw new Error('ERRORE: Lo swap doveva essere bloccato perché la riga è specifica!');
    } catch (swapErr) {
      if (swapErr.status === 400 && swapErr.data?.error?.includes('richiede specificamente la paletta')) {
        console.log(`✅ Blocco swap confermato: "${swapErr.data.error}"`);
      } else {
        throw swapErr;
      }
    }

    // 7. Pick with Pallet A's client_pallet_number -> MUST SUCCEED
    console.log('\n7. Scansione del Barcode Rif. Paletta Cliente corretta...');
    const { data: pickRes } = await request('/outbound/zebra/pick', {
      method: 'POST',
      token,
      body: {
        order_id: orderId,
        item_id: zItem.id,
        pallet_code: highFloorRef, // scanned client_pallet_number barcode
        qty_picked: 10
      }
    });
    console.log('✅ Prelievo Zebra confermato con successo!');

    // 8. Test Automatic Allocation (No Specific Pallet) -> MUST pick Ground Floor (Piano 0)!
    console.log('\n8. Test Allocazione Automatica (senza paletta specifica: deve scegliere il Piano Terra A-01)...');
    const { data: autoOrderRes } = await request('/outbound', {
      method: 'POST',
      token,
      body: {
        customer_id: customer.id,
        exit_date: new Date().toISOString().split('T')[0],
        items: [
          {
            product_id: product.id,
            batch: testBatch,
            quantity_required: 10,
            requested_uom: 'Pezzi'
          }
        ]
      }
    });

    const autoOrderId = autoOrderRes.order_id || autoOrderRes.id;
    const { data: autoDetRes } = await request(`/outbound/${autoOrderId}/details`, { token });
    const autoItem = autoDetRes.items[0];
    console.log(`Allocazione automatica: pallet_id=${autoItem.pallet_id}, is_specific=${autoItem.is_specific}`);
    if (autoItem.pallet_id !== groundPalId) {
      throw new Error(`Allocazione automatica doveva scegliere il piano terra (ID ${groundPalId}) invece di ${autoItem.pallet_id}`);
    }
    if (autoItem.is_specific) {
      throw new Error(`Allocazione automatica non doveva avere is_specific = 1!`);
    }
    console.log('✅ Allocazione automatica corretta: ha selezionato la paletta a piano terra!');

    await db.query('DELETE FROM OUTBOUND_ITEMS WHERE order_id = ?', [autoOrderId]);
    await db.query('DELETE FROM OUTBOUND_ORDERS WHERE id = ?', [autoOrderId]);

  } finally {
    console.log('\nPulizia record di test...');
    if (orderId) {
      await db.query('DELETE FROM OUTBOUND_ITEMS WHERE order_id = ?', [orderId]);
      await db.query('DELETE FROM OUTBOUND_ORDERS WHERE id = ?', [orderId]);
    }
    await db.query('DELETE FROM PALLETS WHERE id IN (?, ?)', [highPalId, groundPalId]);
    console.log('Pulizia completata.');
  }

  console.log('\n🎉 TUTTI I TEST SUPERATI CON SUCCESSO!');
  process.exit(0);
}

run().catch(err => {
  console.error('\n❌ TEST FALLITO:', err.data || err.message);
  process.exit(1);
});
