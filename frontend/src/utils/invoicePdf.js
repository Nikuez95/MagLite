import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export const formatDateIT = (val) => {
  if (!val) return '-';
  const d = new Date(val);
  if (isNaN(d.getTime())) return String(val);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

/**
 * Generates and downloads a complete Proforma Invoice PDF.
 * Always includes the "Report Dettagliato Merce" table (Cod. Articolo, Nome Prodotto, Lotto, Scadenza,
 * Data Arrivo, Data Uscita / In Deposito, Quantità & Giorni di Sosta, Causali/Note, Importo)
 * regardless of the billing modality (Deposito, Giorni di Sosta, Quindicina, Flag, Eventi).
 */
export async function generateProformaPdf({
  companySettings = {},
  customer = {},
  period = '',
  storageModeLabel = '',
  sections = [],
  items = [],
  pallets = [],
  sectionTotalsMap = {},
  includeNotesInPdf = true,
  vatRate = 22,
  baseTotal = 0,
  vatAmount = 0,
  grandTotal = 0,
  fileName
}) {
  const doc = new jsPDF();

  // Logo header
  try {
    const resp = await fetch('/logo_scuro.png');
    if (resp.ok) {
      const blob = await resp.blob();
      const base64Logo = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
      doc.addImage(base64Logo, 'PNG', 12, 13, 28, 20);
    }
  } catch (_) {}

  // Company details (Left)
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  const companyName = companySettings.company_name || 'La Mia Azienda';
  const companyNameLines = doc.splitTextToSize(companyName, 75);
  doc.text(companyNameLines, 43, 21);

  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  let startY = 21 + (companyNameLines.length * 5.8);
  if (companySettings.company_address) { doc.text(companySettings.company_address, 43, startY); startY += 4.8; }
  if (companySettings.company_piva) { doc.text(`P.IVA: ${companySettings.company_piva}`, 43, startY); startY += 4.8; }
  if (companySettings.company_cf) { doc.text(`CF: ${companySettings.company_cf}`, 43, startY); startY += 4.8; }
  if (companySettings.company_email) { doc.text(`Email: ${companySettings.company_email}`, 43, startY); }

  // Customer details (Right)
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Spett.le Cliente:', 120, 23);
  doc.setFontSize(13.5);
  doc.text(String(customer.business_name || ''), 120, 30, { maxWidth: 76 });
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  const addrLines = doc.splitTextToSize(customer.address || '', 72);
  doc.text(addrLines, 120, 37);
  doc.text(`P.IVA: ${customer.vat_number || '-'}`, 120, 37 + (addrLines.length * 4.8));

  doc.setLineWidth(0.5);
  doc.line(14, 57, 196, 57);

  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(`PROFORMA FATTURA DETTAGLIATA - ${customer.business_name || ''} (${period})`, 14, 64, { maxWidth: 182 });

  if (storageModeLabel) {
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(`Modalità calcolo giacenza: ${storageModeLabel}`, 14, 70);
    doc.setTextColor(0, 0, 0);
  }

  let currentY = storageModeLabel ? 76 : 72;

  const renderGoodsReportTable = (goodsRows, sectionTitle = '') => {
    if (!goodsRows || goodsRows.length === 0) return;

    const headCols = [
      'Cod. Art.',
      'Prodotto / Bancale',
      'Lotto',
      'Scadenza',
      'Arrivo',
      'Uscita / Stato',
      'Q.tà / Sosta',
      'Causali / Note',
      'Importo'
    ];

    const bodyRows = goodsRows.map((p) => {
      const expStr = p.expiration_date_str || (p.expiration_date ? formatDateIT(p.expiration_date) : '-');
      const arrStr = p.created_at ? formatDateIT(p.created_at) : '-';
      const outStr = p.shipped_at ? formatDateIT(p.shipped_at) : 'In Deposito';
      const qtyNum = p.effective_quantity ?? p.quantity ?? 0;
      const qtyLine = `${qtyNum} ${p.pallet_uom || 'Pz'}`;
      const daysLine = p.storageDays > 0 ? `\n${p.storageDays} gg sosta` : '';

      const chargesDesc = (p.charges || [])
        .map(c => `${c.label || c.description || c.code}: €${parseFloat(c.price || 0).toFixed(2)}`)
        .join('\n');
      const noteVal = includeNotesInPdf ? ((p.customNote !== undefined ? p.customNote : p.notes) || '').trim() : '';
      const causaliCell = [
        chargesDesc || p.movementSummary || (p.in_deposit ? 'In Deposito' : '-'),
        noteVal ? `Nota: ${noteVal}` : ''
      ].filter(Boolean).join('\n');

      const prodDetails = [
        p.product_name || '-',
        p.pallet_code ? `BC: ${p.pallet_code}` : '',
        p.customer_pallet_ref ? `Rif: #${p.customer_pallet_ref}` : ''
      ].filter(Boolean).join('\n');

      const rowPrice = p.customPrice !== undefined ? parseFloat(p.customPrice) : parseFloat(p.totalPrice || 0);

      return [
        p.sku || '-',
        prodDetails,
        p.batch || '-',
        expStr,
        arrStr,
        outStr,
        `${qtyLine}${daysLine}`,
        causaliCell || '-',
        `${rowPrice.toFixed(2)} €`
      ];
    });

    if (currentY > 248) {
      doc.addPage();
      currentY = 20;
    }

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text(sectionTitle ? `Report Dettagliato Merce — ${sectionTitle} (${goodsRows.length})` : `Report Dettagliato Merce (${goodsRows.length})`, 14, currentY);
    doc.setTextColor(0, 0, 0);
    currentY += 2.5;

    autoTable(doc, {
      startY: currentY,
      head: [headCols],
      body: bodyRows,
      theme: 'grid',
      headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6.8, cellPadding: 1.6 },
      styles: { fontSize: 6.8, cellPadding: 1.6, valign: 'middle', overflow: 'linebreak' },
      columnStyles: {
        0: { cellWidth: 18, fontStyle: 'bold' },
        1: { cellWidth: 34 },
        2: { cellWidth: 16 },
        3: { cellWidth: 16, halign: 'center' },
        4: { cellWidth: 16, halign: 'center' },
        5: { cellWidth: 18, halign: 'center' },
        6: { cellWidth: 18, halign: 'center' },
        7: { cellWidth: 30 },
        8: { cellWidth: 16, halign: 'right', fontStyle: 'bold' }
      }
    });
    currentY = doc.lastAutoTable.finalY + 4;
  };

  if (sections && sections.length > 0) {
    for (const sec of sections) {
      const secPalletsFromTop = pallets.filter(p => String(p.sectionId) === String(sec.sectionId));
      const secPallets = secPalletsFromTop.length > 0 ? secPalletsFromTop : (sec.pallets || []);
      const secItems = items.filter(i => String(i.sectionId) === String(sec.sectionId));
      const secLines = sec.descriptiveLines || [];

      if (secPallets.length === 0 && secItems.length === 0 && secLines.length === 0) continue;

      if (currentY > 235) {
        doc.addPage();
        currentY = 20;
      }

      doc.setFillColor(15, 23, 42);
      doc.rect(14, currentY - 5, 182, 8.5, 'F');
      doc.setFontSize(10.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text(`"${sec.sectionName}"`, 17, currentY + 0.8);
      doc.setTextColor(0, 0, 0);
      currentY += 7.5;

      if (secLines.length > 0) {
        doc.setFontSize(8.2);
        doc.setFont('helvetica', 'normal');
        secLines.forEach((line) => {
          const splitLine = doc.splitTextToSize(`• ${line.text}`, 178);
          if (currentY + splitLine.length * 4 > 272) {
            doc.addPage();
            currentY = 20;
          }
          doc.text(splitLine, 16, currentY);
          currentY += splitLine.length * 4.1;
        });
        currentY += 2;
      }

      // Report dettagliato merce SEMPRE incluso per questa sezione
      renderGoodsReportTable(secPallets, sec.sectionName);

      // Riepilogo voci tariffarie / sconti / extra
      if (secItems.length > 0) {
        const summaryRows = secItems.map((i) => {
          const qtyStr = i.code === 'DISCOUNT_PERCENT' ? '-' : String(i.qty);
          const priceStr = i.code === 'DISCOUNT_PERCENT'
            ? `${Math.abs(i.price)} %`
            : `${parseFloat(i.price || 0).toFixed(2)} EUR`;
          return [
            i.description,
            qtyStr,
            priceStr,
            `${parseFloat(i.subtotal || 0).toFixed(2)} EUR`
          ];
        });

        if (currentY > 248) {
          doc.addPage();
          currentY = 20;
        }

        autoTable(doc, {
          startY: currentY,
          head: [[`Riepilogo Voci Tariffarie - ${sec.sectionName}`, 'Q.ta / Gg', 'Tariffa Unit.', 'Importo']],
          body: summaryRows,
          theme: 'striped',
          headStyles: { fillColor: [14, 165, 233], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.2 },
          styles: { fontSize: 7.8, cellPadding: 2.2 },
          columnStyles: {
            1: { halign: 'center', cellWidth: 20 },
            2: { halign: 'right', cellWidth: 28 },
            3: { halign: 'right', fontStyle: 'bold', cellWidth: 28 }
          }
        });
        currentY = doc.lastAutoTable.finalY + 4;
      }

      const secTot = sectionTotalsMap[sec.sectionId] !== undefined
        ? sectionTotalsMap[sec.sectionId]
        : secItems.reduce((acc, it) => acc + (parseFloat(it.subtotal) || 0), 0);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(`Totale ${sec.sectionName}: ${Number(secTot).toFixed(2)} EUR`, 196, currentY, { align: 'right' });
      currentY += 8.5;
    }
  } else {
    // Fallback anche se non ci sono sezioni: stampa sempre sia il Report Dettagliato Merce che le voci
    if (pallets && pallets.length > 0) {
      renderGoodsReportTable(pallets);
    }

    const tableData = (items || []).map((i) => {
      const qtyStr = i.code === 'DISCOUNT_PERCENT' ? '-' : String(i.qty);
      const priceStr = i.code === 'DISCOUNT_PERCENT' ? `${Math.abs(i.price)} %` : `${parseFloat(i.price || 0).toFixed(2)} EUR`;
      return [i.description, qtyStr, priceStr, `${parseFloat(i.subtotal || 0).toFixed(2)} EUR`];
    });

    if (tableData.length > 0) {
      autoTable(doc, {
        startY: currentY,
        head: [['Descrizione Servizio / Sconto', 'Q.ta / Gg', 'Prezzo / %', 'Importo']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [14, 165, 233], textColor: [255, 255, 255], fontStyle: 'bold' },
        styles: { fontSize: 9, cellPadding: 3 },
        columnStyles: { 1: { halign: 'center', cellWidth: 22 }, 2: { halign: 'right', cellWidth: 32 }, 3: { halign: 'right', cellWidth: 32 } }
      });
      currentY = doc.lastAutoTable.finalY + 8;
    }
  }

  if (currentY > 232) {
    doc.addPage();
    currentY = 24;
  }

  doc.setLineWidth(0.4);
  doc.line(14, currentY, 196, currentY);
  currentY += 6;

  if (sections.length > 1) {
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'bold');
    doc.text('RIEPILOGO PER FRAMMENTAZIONE:', 14, currentY);
    currentY += 5;
    doc.setFont('helvetica', 'normal');
    sections.forEach((sec) => {
      const sTot = sectionTotalsMap[sec.sectionId] !== undefined
        ? sectionTotalsMap[sec.sectionId]
        : items.filter(i => String(i.sectionId) === String(sec.sectionId)).reduce((acc, it) => acc + (parseFloat(it.subtotal) || 0), 0);
      doc.text(`• ${sec.sectionName}:`, 18, currentY);
      doc.text(`${Number(sTot).toFixed(2)} EUR`, 110, currentY, { align: 'right' });
      currentY += 4.8;
    });
    currentY += 3;
  }

  doc.setFontSize(11.5);
  doc.setFont('helvetica', 'bold');
  doc.text(`Totale Imponibile (${customer.business_name || ''}):`, 152, currentY, { align: 'right' });
  doc.text(`${Number(baseTotal).toFixed(2)} EUR`, 196, currentY, { align: 'right' });

  doc.setFontSize(10.5);
  doc.setFont('helvetica', 'normal');
  doc.text(`IVA (${vatRate}%):`, 152, currentY + 6, { align: 'right' });
  doc.text(`${Number(vatAmount).toFixed(2)} EUR`, 196, currentY + 6, { align: 'right' });

  doc.setFontSize(13.5);
  doc.setFont('helvetica', 'bold');
  doc.text('TOTALE FINALE DOCUMENTO:', 152, currentY + 14, { align: 'right' });
  doc.text(`${Number(grandTotal).toFixed(2)} EUR`, 196, currentY + 14, { align: 'right' });

  if (vatRate === 0) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.text('* Operazione esente da IVA ai sensi della normativa vigente.', 14, currentY + 22);
  }

  const pageHeight = doc.internal.pageSize.height;
  if (companySettings.company_iban) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Coordinate Bancarie (IBAN): ${companySettings.company_iban}`, 14, pageHeight - 14);
  }

  const safeName = fileName || `Proforma_${String(customer.business_name || 'Cliente').replace(/\s+/g, '_')}_${String(period || '').replace('/', '_')}.pdf`;
  doc.save(safeName);
}
