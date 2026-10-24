const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');
const fs = require('fs');
const path = require('path');

const logoPath = path.join(__dirname, '../../../frontend/public/logo_scuro.png');

/**
 * Normalizza e valida una data di scadenza per il salvataggio su MySQL (YYYY-MM-DD) o restituisce null.
 * Gestisce anche giorni oltre fine mese (es. 31/04/2031 -> 2031-04-30), formati MM/YY o YY/MM (es. 33/01 -> 2033-01-01)
 * e valori sporchi (es. '??', '2027/30', '30/04/0202' -> null).
 */
function sanitizeExpirationDate(val) {
  if (val === undefined || val === null || val === '') return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    const y = val.getFullYear();
    if (y < 1900 || y > 2100) return null;
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const s = String(val).trim();
  if (!s) return null;

  let yNum = null;
  let mNum = null;
  let dNum = null;

  // YYYY-MM-DD o YYYY/MM/DD
  const ymd = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (ymd) {
    yNum = parseInt(ymd[1], 10);
    mNum = parseInt(ymd[2], 10);
    dNum = parseInt(ymd[3], 10);
  }

  // DD/MM/YYYY o DD-MM-YY
  if (yNum === null) {
    const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (dmy) {
      dNum = parseInt(dmy[1], 10);
      mNum = parseInt(dmy[2], 10);
      yNum = dmy[3].length === 2 ? 2000 + parseInt(dmy[3], 10) : parseInt(dmy[3], 10);
    }
  }

  // MM/YYYY
  if (yNum === null) {
    const my = s.match(/^(\d{1,2})[\/\-.](\d{4})$/);
    if (my) {
      mNum = parseInt(my[1], 10);
      yNum = parseInt(my[2], 10);
      dNum = 1;
    }
  }

  // YYYY/MM
  if (yNum === null) {
    const ym = s.match(/^(\d{4})[\/\-.](\d{1,2})$/);
    if (ym) {
      yNum = parseInt(ym[1], 10);
      mNum = parseInt(ym[2], 10);
      dNum = 1;
    }
  }

  // MM/YY o YY/MM (es. 01/33 o 33/01)
  if (yNum === null) {
    const shortMy = s.match(/^(\d{1,2})[\/\-.](\d{2})$/);
    if (shortMy) {
      const a = parseInt(shortMy[1], 10);
      const b = parseInt(shortMy[2], 10);
      if (a >= 1 && a <= 12) {
        mNum = a;
        yNum = 2000 + b;
        dNum = 1;
      } else if (b >= 1 && b <= 12 && a >= 20 && a <= 99) {
        yNum = 2000 + a;
        mNum = b;
        dNum = 1;
      }
    }
  }

  if (yNum === null || mNum === null || dNum === null) return null;
  if (yNum < 1900 || yNum > 2100) return null;
  if (mNum < 1 || mNum > 12) return null;
  if (dNum < 1 || dNum > 31) return null;

  // Limita il giorno al massimo reale del mese (es. 31/04/2031 -> 30/04/2031)
  const maxDay = new Date(yNum, mNum, 0).getDate();
  const safeDay = Math.min(dNum, maxDay);

  return `${String(yNum).padStart(4, '0')}-${String(mNum).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
}

/**
 * Disegna una singola etichetta paletta con pdfkit e bwip-js.
 */
async function drawLabel(doc, lbl, x, y, w, h) {
  // Bordo arrotondato moderno
  doc.roundedRect(x, y, w, h, 8).lineWidth(1).strokeOpacity(0.3).strokeColor('#000000').stroke();
  doc.strokeOpacity(1).strokeColor('black').lineWidth(1); // reset

  // HEADER (Logo, Warehouse & Posizione in piccolo se assegnata)
  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, x + 12, y + 12, { fit: [90, 25] });
    if (lbl.location) {
      doc.fontSize(8.5).font('Helvetica').fillColor('#64748b').text(`Magazzino: ${lbl.warehouse}`, x + 110, y + 11, { width: w - 122, align: 'right', lineBreak: false });
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#0f172a').text(`Posizione: ${lbl.location}`, x + 110, y + 23, { width: w - 122, align: 'right', lineBreak: false });
    } else {
      doc.fontSize(9).font('Helvetica').fillColor('#64748b').text(`Magazzino: ${lbl.warehouse}`, x + 110, y + 18, { width: w - 122, align: 'right', lineBreak: false });
    }
  } else {
    if (lbl.location) {
      doc.fontSize(8.5).font('Helvetica').fillColor('#64748b').text(`Magazzino: ${lbl.warehouse}`, x + 12, y + 11, { width: w - 24, align: 'right', lineBreak: false });
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#0f172a').text(`Posizione: ${lbl.location}`, x + 12, y + 23, { width: w - 24, align: 'right', lineBreak: false });
    } else {
      doc.fontSize(9).font('Helvetica').fillColor('#64748b').text(`Magazzino: ${lbl.warehouse}`, x + 12, y + 18, { width: w - 24, align: 'right', lineBreak: false });
    }
  }

  // Divider
  doc.moveTo(x + 10, y + 42).lineTo(x + w - 10, y + 42).lineWidth(0.5).strokeOpacity(0.2).strokeColor('#000000').stroke();
  doc.strokeOpacity(1).strokeColor('black').lineWidth(1); // reset

  // CLIENTE (Auto-shrink text per evitare a capo)
  let cName = (lbl.customer_name || '').toUpperCase();
  let maxFontSizeC = 11;
  doc.fontSize(maxFontSizeC).font('Helvetica-Bold');
  while (doc.widthOfString(cName) > (w - 24) && maxFontSizeC > 6) {
    maxFontSizeC -= 0.5;
    doc.fontSize(maxFontSizeC);
  }
  doc.fillColor('#334155').text(cName, x + 12, y + 50, { width: w - 24, align: 'left', lineBreak: false });

  // PRODOTTO (Auto-shrink text per evitare a capo)
  let pName = (lbl.product_name || '').toUpperCase();
  let maxFontSize = 18;
  doc.fontSize(maxFontSize).font('Helvetica-Bold');
  while (doc.widthOfString(pName) > (w - 24) && maxFontSize > 8) {
    maxFontSize -= 0.5;
    doc.fontSize(maxFontSize);
  }
  doc.fillColor('black').text(pName, x + 12, y + 68, { width: w - 24, align: 'left', lineBreak: false });

  // LOTTO & SCADENZA (Niente Q.tà stampata!)
  let metaY = y + 70 + maxFontSize + 8; // posiziona sotto al prodotto
  let batchStr = `Lotto: ${lbl.batch || '-'}`;
  const cleanExp = sanitizeExpirationDate(lbl.expiration_date);
  if (cleanExp) {
    const [ey, em, ed] = cleanExp.split('-');
    batchStr += `   |   Scad: ${ed}/${em}/${ey}`;
  }
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#475569').text(batchStr, x + 12, metaY, { width: w - 24, align: 'left', lineBreak: false });

  // DATI AGGIUNTIVI OPZIONALI (+ Posizione in piccolo sopra il barcode)
  if (lbl.client_pallet_number || lbl.client_article_number || lbl.location) {
    metaY += 14;
    let extras = [];
    if (lbl.location) extras.push(`Pos: ${lbl.location}`);
    if (lbl.client_pallet_number) extras.push(`Pal. Cliente: ${lbl.client_pallet_number}`);
    if (lbl.client_article_number && lbl.client_article_number !== '-') extras.push(`Art: ${lbl.client_article_number}`);
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#475569').text(extras.join('  |  '), x + 12, metaY, { width: w - 24, align: 'left', lineBreak: false });
  }

  doc.fillColor('black'); // reset colore testo per sicurezza

  // BARCODE (Ridimensiona per stare nel blocco rimanente senza sovrapporsi)
  const barcodeY = metaY + 18;
  const remainingHeight = h - (barcodeY - y) - 10;
  const finalBarcodeHeight = Math.max(25, remainingHeight);

  const pngBuffer = await bwipjs.toBuffer({
    bcid: 'code128',
    text: String(lbl.code || 'PAL-0000'),
    scale: 3,
    height: 12,
    includetext: true,
    textxalign: 'center',
  });

  const barcodeW = w - 40;
  doc.image(pngBuffer, x + 20, barcodeY, { fit: [barcodeW, finalBarcodeHeight], align: 'center', valign: 'top' });
}

/**
 * Genera l'intero PDF delle etichette in memoria (Buffer), evitando qualsiasi problema di backpressure
 * sugli stream di Fastify quando si generano centinaia di etichette in modo asincrono.
 */
async function generateLabelsPdfBuffer(labels, { paper_format = 'A4', print_mode = 'GRID' } = {}) {
  const docOptions = { margin: 20 };
  if (paper_format === 'THERMAL') {
    docOptions.size = [283, 425];
  } else {
    docOptions.size = 'A4';
  }

  const doc = new PDFDocument(docOptions);
  const chunks = [];
  doc.on('data', chunk => chunks.push(chunk));
  const endPromise = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  if (paper_format === 'THERMAL' || print_mode === 'SINGLE_PAGE') {
    for (let i = 0; i < labels.length; i++) {
      if (i > 0) doc.addPage();
      const lbl = labels[i];
      const w = doc.page.width - 40;
      const h = doc.page.height - 40;
      await drawLabel(doc, lbl, 20, 20, w, h);
    }
  } else {
    const labelsPerRow = 2;
    const labelWidth = 265;
    const labelHeight = 180;
    const startX = 25;
    let startY = 25;

    for (let i = 0; i < labels.length; i++) {
      const lbl = labels[i];
      const col = i % labelsPerRow;
      const row = Math.floor((i % 8) / labelsPerRow);

      if (i > 0 && i % 8 === 0) {
        doc.addPage();
        startY = 25;
      }

      const x = startX + (col * (labelWidth + 15));
      const y = startY + (row * (labelHeight + 15));
      await drawLabel(doc, lbl, x, y, labelWidth, labelHeight);
    }
  }

  doc.end();
  return endPromise;
}

module.exports = {
  drawLabel,
  generateLabelsPdfBuffer,
  sanitizeExpirationDate,
};
