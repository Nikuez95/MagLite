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
 * Adatta un testo su max 1 o 2 righe riducendo il font solo quanto serve e troncando con '...' se estremo.
 */
function fitTextLines(doc, text, maxWidth, startSize, minSize, maxLines = 2) {
  const clean = String(text || '').trim() || '-';
  let size = startSize;
  doc.font('Helvetica-Bold').fontSize(size);

  if (maxLines === 1) {
    while (doc.widthOfString(clean) > maxWidth && size > minSize) {
      size -= 0.5;
      doc.fontSize(size);
    }
    let output = clean;
    if (doc.widthOfString(output) > maxWidth) {
      while (output.length > 3 && doc.widthOfString(`${output}...`) > maxWidth) {
        output = output.slice(0, -1);
      }
      output = `${output}...`;
    }
    return { text: output, fontSize: size, height: size * 1.15 };
  }

  // Prova su 1 riga a dimensione iniziale; se non ci sta, consenti 2 righe
  if (doc.widthOfString(clean) <= maxWidth) {
    return { text: clean, fontSize: size, height: size * 1.15 };
  }

  size = Math.max(minSize, startSize - 1.5);
  doc.fontSize(size);
  let maxAllowedHeight = size * 1.18 * maxLines + 2;
  while (doc.heightOfString(clean, { width: maxWidth, lineGap: 1 }) > maxAllowedHeight && size > minSize) {
    size -= 0.5;
    doc.fontSize(size);
    maxAllowedHeight = size * 1.18 * maxLines + 2;
  }

  let output = clean;
  if (doc.heightOfString(output, { width: maxWidth, lineGap: 1 }) > maxAllowedHeight) {
    while (output.length > 6 && doc.heightOfString(`${output}...`, { width: maxWidth, lineGap: 1 }) > maxAllowedHeight) {
      output = output.slice(0, -1);
    }
    output = `${output.trim()}...`;
  }

  const measuredH = doc.heightOfString(output, { width: maxWidth, lineGap: 1 });
  return { text: output, fontSize: size, height: measuredH };
}

/**
 * Disegna una singola etichetta paletta moderna, pulita e responsive con pdfkit e bwip-js.
 */
async function drawLabel(doc, lbl, x, y, w, h, { showLogo = true } = {}) {
  const scale = Math.max(0.75, Math.min(w / 273, h / 192));
  const padX = Math.max(8, Math.round(10 * scale));
  const innerW = w - padX * 2;

  // HEADER: Logo opzionale a sinistra + Magazzino / Posizione
  const headerTop = y + 4 * scale;
  const effectiveShowLogo = lbl && lbl.show_logo !== undefined ? Boolean(lbl.show_logo) : Boolean(showLogo);
  const hasLogo = effectiveShowLogo && fs.existsSync(logoPath);
  const whText = String(lbl.warehouse || 'Settala').trim();
  const locText = lbl.location ? String(lbl.location).trim().toUpperCase() : '';
  const headerH = hasLogo ? Math.round(48 * scale) : Math.round((locText ? 26 : 24) * scale);

  if (hasLogo) {
    const logoBoxW = innerW * 0.54;
    const logoBoxH = headerH - 2 * scale;
    doc.image(logoPath, x + padX, headerTop, { fit: [logoBoxW, logoBoxH], valign: 'center' });

    const rightBoxX = x + padX + innerW * 0.52;
    const rightBoxW = innerW * 0.48;

    if (locText) {
      doc.font('Helvetica').fontSize(6.5 * scale).fillColor('#64748b')
        .text('MAGAZZINO', rightBoxX, headerTop + 2 * scale, { width: rightBoxW, align: 'right', lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(8.5 * scale).fillColor('#121e27')
        .text(whText, rightBoxX, headerTop + 9.5 * scale, { width: rightBoxW, align: 'right', lineBreak: false });

      // Badge posizione moderno e ad alto contrasto
      const badgeFontSize = 8 * scale;
      doc.font('Helvetica-Bold').fontSize(badgeFontSize);
      const badgeLabel = `POS: ${locText}`;
      const pillPadX = 6 * scale;
      const pillW = Math.min(rightBoxW, doc.widthOfString(badgeLabel) + pillPadX * 2);
      const pillH = 14 * scale;
      const pillX = rightBoxX + rightBoxW - pillW;
      const pillY = headerTop + 22 * scale;
      doc.roundedRect(pillX, pillY, pillW, pillH, 3 * scale).fillAndStroke('#e0f2fe', '#0284c7');
      doc.fillColor('#0c4a6e').text(badgeLabel, pillX + pillPadX * 0.5, pillY + 3 * scale, {
        width: pillW - pillPadX,
        align: 'center',
        lineBreak: false
      });
    } else {
      doc.font('Helvetica').fontSize(7 * scale).fillColor('#64748b')
        .text('MAGAZZINO', rightBoxX, headerTop + 10 * scale, { width: rightBoxW, align: 'right', lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(9.5 * scale).fillColor('#121e27')
        .text(whText, rightBoxX, headerTop + 19 * scale, { width: rightBoxW, align: 'right', lineBreak: false });
    }
  } else {
    // Layout compatto senza logo: Magazzino a sinistra + Posizione a destra
    const leftW = locText ? innerW * 0.54 : innerW;
    doc.font('Helvetica').fontSize(6.5 * scale).fillColor('#64748b')
      .text('MAGAZZINO', x + padX, headerTop + 1.5 * scale, { width: leftW, align: 'left', lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(9.5 * scale).fillColor('#121e27')
      .text(whText, x + padX, headerTop + 9.5 * scale, { width: leftW, align: 'left', lineBreak: false });

    if (locText) {
      const rightBoxX = x + padX + innerW * 0.52;
      const rightBoxW = innerW * 0.48;
      const badgeFontSize = 8.5 * scale;
      doc.font('Helvetica-Bold').fontSize(badgeFontSize);
      const badgeLabel = `POS: ${locText}`;
      const pillPadX = 7 * scale;
      const pillW = Math.min(rightBoxW, doc.widthOfString(badgeLabel) + pillPadX * 2);
      const pillH = 15.5 * scale;
      const pillX = rightBoxX + rightBoxW - pillW;
      const pillY = headerTop + 5 * scale;
      doc.roundedRect(pillX, pillY, pillW, pillH, 3 * scale).fillAndStroke('#e0f2fe', '#0284c7');
      doc.fillColor('#0c4a6e').text(badgeLabel, pillX + pillPadX * 0.5, pillY + 3.5 * scale, {
        width: pillW - pillPadX,
        align: 'center',
        lineBreak: false
      });
    }
  }

  // Linea separatrice pulita brand-blue (nessun tratto grigio sbiadito)
  const dividerY = headerTop + headerH + 2 * scale;
  doc.moveTo(x + padX, dividerY).lineTo(x + w - padX, dividerY).lineWidth(0.75 * scale).strokeColor('#bae6fd').stroke();

  // CLIENTE
  let cursorY = dividerY + 5 * scale;
  const cName = (lbl.customer_name || '-').toUpperCase();
  const fittedCustomer = fitTextLines(doc, cName, innerW, 9 * scale, 6.5 * scale, 1);
  doc.font('Helvetica-Bold').fontSize(fittedCustomer.fontSize).fillColor('#0369a1')
    .text(fittedCustomer.text, x + padX, cursorY, { width: innerW, align: 'left', lineBreak: false });
  cursorY += fittedCustomer.fontSize + 4 * scale;

  // PRODOTTO (fino a 2 righe responsive ben leggibili)
  const pName = (lbl.product_name || '-').toUpperCase();
  const fittedProduct = fitTextLines(doc, pName, innerW, 13.5 * scale, 8 * scale, 2);
  doc.font('Helvetica-Bold').fontSize(fittedProduct.fontSize).fillColor('#0f172a')
    .text(fittedProduct.text, x + padX, cursorY, { width: innerW, align: 'left', lineGap: 1 });
  cursorY += fittedProduct.height + 5 * scale;

  // STRIP METADATI (Lotto, Scadenza & Riferimenti Cliente)
  const cleanExp = sanitizeExpirationDate(lbl.expiration_date);
  let expFormatted = null;
  if (cleanExp) {
    const [ey, em, ed] = cleanExp.split('-');
    expFormatted = `${ed}/${em}/${ey}`;
  }

  const extras = [];
  if (lbl.client_pallet_number) extras.push(`Pal. Cliente: ${lbl.client_pallet_number}`);
  if (lbl.client_article_number && lbl.client_article_number !== '-') extras.push(`Art: ${lbl.client_article_number}`);
  const hasExtras = extras.length > 0;

  const stripH = (hasExtras ? 30 : 19) * scale;
  doc.roundedRect(x + padX, cursorY, innerW, stripH, 4 * scale).fill('#f1f5f9');
  doc.rect(x + padX, cursorY, 2.5 * scale, stripH).fill('#0284c7');

  const stripPadX = 7 * scale;
  const stripInnerW = innerW - stripPadX * 1.5;
  const row1Y = cursorY + 4.5 * scale;

  const batchLabel = `LOTTO: ${lbl.batch || '-'}`;
  const expLabel = expFormatted ? `SCAD: ${expFormatted}` : '';

  if (expLabel) {
    doc.font('Helvetica-Bold').fontSize(8.5 * scale);
    const expW = doc.widthOfString(expLabel) + 6 * scale;
    const batchFit = fitTextLines(doc, batchLabel, Math.max(40, stripInnerW - expW), 8.5 * scale, 6.5 * scale, 1);
    doc.font('Helvetica-Bold').fontSize(batchFit.fontSize).fillColor('#0f172a')
      .text(batchFit.text, x + padX + stripPadX, row1Y, { width: stripInnerW - expW, align: 'left', lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(8.5 * scale).fillColor('#be123c')
      .text(expLabel, x + padX + stripPadX, row1Y, { width: stripInnerW, align: 'right', lineBreak: false });
  } else {
    const batchFit = fitTextLines(doc, batchLabel, stripInnerW, 8.5 * scale, 6.5 * scale, 1);
    doc.font('Helvetica-Bold').fontSize(batchFit.fontSize).fillColor('#0f172a')
      .text(batchFit.text, x + padX + stripPadX, row1Y, { width: stripInnerW, align: 'left', lineBreak: false });
  }

  if (hasExtras) {
    const extraFit = fitTextLines(doc, extras.join('  •  '), stripInnerW, 7.5 * scale, 6 * scale, 1);
    doc.font('Helvetica-Bold').fontSize(extraFit.fontSize).fillColor('#475569')
      .text(extraFit.text, x + padX + stripPadX, cursorY + 16.5 * scale, { width: stripInnerW, align: 'left', lineBreak: false });
  }

  cursorY += stripH + 6 * scale;

  // BARCODE FOOTER (Responsive su spazio rimanente, codice vettoriale nitido sotto le barre)
  const codeStr = String(lbl.code || 'PAL-0000');
  const bottomPad = 5 * scale;
  const codeFontSize = Math.max(8, 9.5 * scale);
  const codeTextH = codeFontSize + 3 * scale;
  const availableFooterH = Math.max(30, (y + h - bottomPad) - cursorY);
  const maxBarcodeImgH = Math.min(availableFooterH - codeTextH, 110 * scale);
  const barcodeImgH = Math.max(22, maxBarcodeImgH);
  const barcodeW = Math.max(80, innerW - 16 * scale);

  // Centra verticalmente il blocco barcode+testo nello spazio disponibile
  const totalBarcodeBlockH = barcodeImgH + codeTextH;
  const barcodeStartY = cursorY + Math.max(0, (availableFooterH - totalBarcodeBlockH) / 2);

  const pngBuffer = await bwipjs.toBuffer({
    bcid: 'code128',
    text: codeStr,
    scale: 4,
    height: 14,
    includetext: false,
  });

  doc.image(pngBuffer, x + (w - barcodeW) / 2, barcodeStartY, {
    fit: [barcodeW, barcodeImgH],
    align: 'center',
    valign: 'center'
  });

  doc.font('Helvetica-Bold').fontSize(codeFontSize).fillColor('#0f172a')
    .text(codeStr, x + padX, barcodeStartY + barcodeImgH + 2 * scale, {
      width: innerW,
      align: 'center',
      lineBreak: false
    });
}

async function shouldShowPalletBarcodeLogo(db) {
  try {
    const [[row]] = await db.query(
      "SELECT setting_value FROM settings WHERE setting_key = 'pallet_barcode_show_logo' LIMIT 1"
    );
    if (!row || row.setting_value === null || row.setting_value === undefined || row.setting_value === '') {
      return true;
    }
    const normalized = String(row.setting_value).trim().toLowerCase();
    return !['false', '0', 'no', 'off'].includes(normalized);
  } catch (_) {
    return true;
  }
}

/**
 * Genera l'intero PDF delle etichette in memoria (Buffer), evitando qualsiasi problema di backpressure
 * sugli stream di Fastify quando si generano centinaia di etichette in modo asincrono.
 */
async function generateLabelsPdfBuffer(labels, { paper_format = 'A4', print_mode = 'GRID', show_logo = true } = {}) {
  const isThermal = paper_format === 'THERMAL';
  const docOptions = isThermal
    ? { size: [283, 425], margin: 12 }
    : { size: 'A4', margin: print_mode === 'SINGLE_PAGE' ? 24 : 18 };

  const doc = new PDFDocument(docOptions);
  const chunks = [];
  doc.on('data', chunk => chunks.push(chunk));
  const endPromise = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  if (isThermal || print_mode === 'SINGLE_PAGE') {
    const margin = isThermal ? 12 : 24;
    for (let i = 0; i < labels.length; i++) {
      if (i > 0) doc.addPage();
      const lbl = labels[i];
      const w = doc.page.width - margin * 2;
      const h = doc.page.height - margin * 2;
      await drawLabel(doc, lbl, margin, margin, w, h, { showLogo: show_logo });
    }
  } else {
    const labelsPerRow = 2;
    const rowsPerPage = 4;
    const perPage = labelsPerRow * rowsPerPage;
    const pageMarginX = 18;
    const pageMarginY = 18;
    const gapX = 14;
    const gapY = 12;
    const labelWidth = (doc.page.width - pageMarginX * 2 - gapX * (labelsPerRow - 1)) / labelsPerRow;
    const labelHeight = (doc.page.height - pageMarginY * 2 - gapY * (rowsPerPage - 1)) / rowsPerPage;

    for (let i = 0; i < labels.length; i++) {
      const lbl = labels[i];
      const pageSlot = i % perPage;
      const col = pageSlot % labelsPerRow;
      const row = Math.floor(pageSlot / labelsPerRow);

      if (i > 0 && pageSlot === 0) {
        doc.addPage();
      }

      const x = pageMarginX + col * (labelWidth + gapX);
      const y = pageMarginY + row * (labelHeight + gapY);
      await drawLabel(doc, lbl, x, y, labelWidth, labelHeight, { showLogo: show_logo });
    }
  }

  doc.end();
  return endPromise;
}

module.exports = {
  drawLabel,
  generateLabelsPdfBuffer,
  sanitizeExpirationDate,
  shouldShowPalletBarcodeLogo,
};
