import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export const formatDateIT = (val) => {
  if (!val) return '-';
  const d = new Date(val);
  if (isNaN(d.getTime())) return String(val);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export const DEFAULT_PDF_OPTIONS = {
  showSummaryLines: true,
  showGoodsTable: true,
  showTariffSummary: true,
  showSku: true,
  showBatch: true,
  showWeights: true,
  showExpiration: true,
  showArrival: true,
  showDeparture: true,
  showQtyDays: true,
  showCharges: true,
  showNotes: true,
  showLocation: true,
  showTags: true,
  showClientRef: true
};

/**
 * Generates and downloads a complete Proforma Invoice PDF.
 * Supports dividing by Fragmentation and by Global Price List (using each list's invoice_label),
 * and customizing which columns/sections appear in the generated PDF.
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
  pdfOptions = null,
  vatRate = 22,
  baseTotal = 0,
  vatAmount = 0,
  grandTotal = 0,
  fileName
}) {
  const opts = {
    ...DEFAULT_PDF_OPTIONS,
    showNotes: includeNotesInPdf,
    ...(pdfOptions || {})
  };

  const doc = new jsPDF();

  // Accent top stripe
  doc.setFillColor(14, 165, 233);
  doc.rect(0, 0, 210, 4.5, 'F');

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
      doc.addImage(base64Logo, 'PNG', 14, 10, 38, 26);
    }
  } catch (_) {}

  // Company details (Left)
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  const companyName = companySettings.company_name || 'La Mia Azienda';
  const companyNameLines = doc.splitTextToSize(companyName, 56);
  doc.text(companyNameLines, 55, 15);

  doc.setFontSize(8.2);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  let startY = 15 + (companyNameLines.length * 4.8);
  if (companySettings.company_address) {
    const compAddrLines = doc.splitTextToSize(companySettings.company_address, 56);
    doc.text(compAddrLines, 55, startY);
    startY += compAddrLines.length * 3.9;
  }
  if (companySettings.company_piva) { doc.text(`P.IVA: ${companySettings.company_piva}`, 55, startY); startY += 4.0; }
  if (companySettings.company_cf) { doc.text(`CF: ${companySettings.company_cf}`, 55, startY); startY += 4.0; }
  if (companySettings.company_email) { doc.text(`Email: ${companySettings.company_email}`, 55, startY, { maxWidth: 56 }); }

  // Customer Card Box (Right)
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(114, 11, 82, 34, 2.5, 2.5, 'FD');

  doc.setFontSize(7.8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(14, 165, 233);
  doc.text('SPETT.LE CLIENTE', 118, 16.5);

  doc.setFontSize(11.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  const custNameLines = doc.splitTextToSize(String(customer.business_name || '-'), 74);
  doc.text(custNameLines, 118, 22.5);

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  let custY = 22.5 + (custNameLines.length * 4.8);
  const addrLines = doc.splitTextToSize(customer.address || '', 74);
  if (addrLines.length > 0 && addrLines[0]) {
    doc.text(addrLines, 118, custY);
    custY += addrLines.length * 4.2;
  }
  doc.text(`P.IVA / CF: ${customer.vat_number || '-'}`, 118, Math.min(custY, 41.5));

  // Metadata Strip
  const todayStr = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  doc.setFillColor(15, 23, 42);
  doc.roundedRect(14, 49, 182, 13.5, 2, 2, 'F');

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(`PROFORMA FATTURA`, 18, 55.5);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text(storageModeLabel || 'Calcolo automatico per paletta e listino', 18, 60);

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(56, 189, 248);
  doc.text(`PERIODO: ${period}`, 192, 55.2, { align: 'right' });
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(203, 213, 225);
  doc.text(`Emessa il: ${todayStr}`, 192, 60, { align: 'right' });
  doc.setTextColor(0, 0, 0);

  let currentY = 69;

  const renderGoodsReportTable = (goodsRows, sectionTitle = '') => {
    if (!opts.showGoodsTable || !goodsRows || goodsRows.length === 0) return;

    const colsSpec = [];
    if (opts.showSku) colsSpec.push({ key: 'sku', label: 'Cod. Art.', halign: 'left', fontStyle: 'bold' });
    colsSpec.push({ key: 'product', label: 'Prodotto / Bancale', halign: 'left' });
    if (opts.showBatch) colsSpec.push({ key: 'batch', label: 'Lotto', halign: 'left' });
    if (opts.showWeights) colsSpec.push({ key: 'weights', label: 'KG Netti / Lordi', halign: 'center' });
    if (opts.showExpiration) colsSpec.push({ key: 'exp', label: 'Scadenza', halign: 'center' });
    if (opts.showArrival) colsSpec.push({ key: 'arr', label: 'Arrivo', halign: 'center' });
    if (opts.showDeparture) colsSpec.push({ key: 'dep', label: 'Uscita / Stato', halign: 'center' });
    if (opts.showQtyDays) colsSpec.push({ key: 'qty', label: 'Q.tà / Sosta', halign: 'center' });
    if (opts.showCharges || opts.showNotes) colsSpec.push({ key: 'causali', label: 'Causali / Note', halign: 'left' });
    colsSpec.push({ key: 'price', label: 'Importo', halign: 'right', fontStyle: 'bold' });

    const bodyRows = goodsRows.map((p) => {
      const expStr = p.expiration_date_str || (p.expiration_date ? formatDateIT(p.expiration_date) : '-');
      const arrStr = p.created_at ? formatDateIT(p.created_at) : '-';
      const outStr = p.shipped_at ? formatDateIT(p.shipped_at) : 'In Deposito';
      const qtyNum = p.effective_quantity ?? p.quantity ?? 0;
      const qtyLine = `${qtyNum} ${p.pallet_uom || 'Pz'}`;
      const daysLine = p.storageDays > 0 ? `\n${p.storageDays} gg sosta` : '';

      const weightLines = [];
      if (Number(p.net_weight_kg) > 0) weightLines.push(`N: ${Number(p.net_weight_kg)} kg`);
      if (Number(p.gross_weight_kg) > 0) weightLines.push(`L: ${Number(p.gross_weight_kg)} kg`);
      const weightsCell = weightLines.length > 0 ? weightLines.join('\n') : '-';

      const chargesDesc = opts.showCharges
        ? (p.charges || []).map(c => `${c.label || c.description || c.code}: €${parseFloat(c.price || 0).toFixed(2)}`).join('\n')
        : '';
      const noteVal = opts.showNotes ? ((p.customNote !== undefined ? p.customNote : p.notes) || '').trim() : '';
      const causaliParts = [];
      if (opts.showCharges) {
        causaliParts.push(chargesDesc || p.movementSummary || (p.in_deposit ? 'In Deposito' : '-'));
      }
      if (noteVal) causaliParts.push(`Nota: ${noteVal}`);
      const causaliCell = causaliParts.filter(Boolean).join('\n');

      const prodDetails = [
        p.product_name || '-',
        p.pallet_code ? `BC: ${p.pallet_code}` : '',
        opts.showLocation && p.location ? `Pos: ${p.location}` : '',
        opts.showClientRef && p.customer_pallet_ref ? `Rif: #${p.customer_pallet_ref}` : '',
        opts.showTags && p.tagLabel ? `Tag: ${p.tagLabel}` : ''
      ].filter(Boolean).join('\n');

      const rowPrice = p.customPrice !== undefined ? parseFloat(p.customPrice) : parseFloat(p.totalPrice || 0);

      return colsSpec.map(col => {
        switch (col.key) {
          case 'sku': return p.sku || '-';
          case 'product': return prodDetails;
          case 'batch': return p.batch || '-';
          case 'weights': return weightsCell;
          case 'exp': return expStr;
          case 'arr': return arrStr;
          case 'dep': return outStr;
          case 'qty': return `${qtyLine}${daysLine}`;
          case 'causali': return causaliCell || '-';
          case 'price': return `${rowPrice.toFixed(2)} €`;
          default: return '';
        }
      });
    });

    if (currentY > 248) {
      doc.addPage();
      currentY = 20;
    }

    doc.setFontSize(8.2);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text(sectionTitle ? `Report Dettagliato Merce — ${sectionTitle} (${goodsRows.length})` : `Report Dettagliato Merce (${goodsRows.length})`, 14, currentY);
    doc.setTextColor(0, 0, 0);
    currentY += 2.5;

    const columnStyles = {};
    colsSpec.forEach((col, idx) => {
      columnStyles[idx] = { halign: col.halign };
      if (col.fontStyle) columnStyles[idx].fontStyle = col.fontStyle;
      if (col.key === 'sku') columnStyles[idx].cellWidth = 17;
      if (col.key === 'exp') columnStyles[idx].cellWidth = 15;
      if (col.key === 'arr') columnStyles[idx].cellWidth = 15;
      if (col.key === 'dep') columnStyles[idx].cellWidth = 17;
      if (col.key === 'price') columnStyles[idx].cellWidth = 16;
    });

    autoTable(doc, {
      startY: currentY,
      head: [colsSpec.map(c => c.label)],
      body: bodyRows,
      theme: 'striped',
      tableWidth: 182,
      margin: { left: 14, right: 14, bottom: 20 },
      headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6.7, cellPadding: 1.8 },
      styles: { fontSize: 6.6, cellPadding: 1.7, valign: 'middle', overflow: 'linebreak', lineColor: [226, 232, 240], lineWidth: 0.15 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles
    });
    currentY = doc.lastAutoTable.finalY + 4;
  };

  const renderTariffItemsTable = (itemsList, titleLabel) => {
    if (!opts.showTariffSummary || !itemsList || itemsList.length === 0) return;
    const summaryRows = itemsList.map((i) => {
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
      head: [[titleLabel, 'Q.ta / Gg', 'Tariffa Unit.', 'Importo']],
      body: summaryRows,
      theme: 'striped',
      tableWidth: 182,
      margin: { left: 14, right: 14 },
      headStyles: { fillColor: [14, 165, 233], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.2 },
      styles: { fontSize: 7.8, cellPadding: 2.2 },
      columnStyles: {
        1: { halign: 'center', cellWidth: 20 },
        2: { halign: 'right', cellWidth: 28 },
        3: { halign: 'right', fontStyle: 'bold', cellWidth: 28 }
      }
    });
    currentY = doc.lastAutoTable.finalY + 4;
  };

  // Barra sintetica a 1 riga con soli conteggi numerici (mai elenchi testuali illeggibili)
  const renderCompactStatsStrip = (palletsList) => {
    if (!opts.showSummaryLines || !palletsList || palletsList.length === 0) return;
    if (currentY > 266) {
      doc.addPage();
      currentY = 20;
    }
    const totalCount = palletsList.length;
    const inDepCount = palletsList.filter(p => p.in_deposit).length;
    const outCount = palletsList.filter(p => Boolean(p.shipped_at)).length;
    const totalDays = palletsList.reduce((acc, p) => acc + (Number(p.storageDays) || 0), 0);
    const totalNet = palletsList.reduce((acc, p) => acc + (parseFloat(p.net_weight_kg) || 0), 0);
    const totalGross = palletsList.reduce((acc, p) => acc + (parseFloat(p.gross_weight_kg) || 0), 0);

    const statParts = [
      `Bancali: ${totalCount}`,
      `In Deposito: ${inDepCount}`,
      `Usciti: ${outCount}`,
      `Gg Sosta tot: ${totalDays}`
    ];
    if (opts.showWeights && totalNet > 0) statParts.push(`KG Netti tot: ${totalNet.toFixed(1)}`);
    if (opts.showWeights && totalGross > 0) statParts.push(`KG Lordi tot: ${totalGross.toFixed(1)}`);

    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(14, currentY - 3, 182, 6, 1.2, 1.2, 'FD');
    doc.setFontSize(7.4);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text(statParts.join('   •   '), 17, currentY + 1);
    doc.setTextColor(0, 0, 0);
    currentY += 6;
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

      // Raggruppo i contenuti della sezione per Listino Globale (usando la Dicitura in Fattura)
      const secPlanGroups = Array.isArray(sec.planGroups) && sec.planGroups.length > 0 ? sec.planGroups : null;

      if (secPlanGroups) {
        const coveredItemIds = new Set();
        for (const pg of secPlanGroups) {
          const pgPallets = secPallets.filter(p => (p.tariff_plan_id ? String(p.tariff_plan_id) : 'LEGACY') === pg.planKey);
          const pgItems = secItems.filter(i => (i.tariffPlanId ? String(i.tariffPlanId) : 'LEGACY') === pg.planKey);
          pgItems.forEach(i => coveredItemIds.add(i.id));

          if (pgPallets.length === 0 && pgItems.length === 0) continue;

          if (currentY > 248) {
            doc.addPage();
            currentY = 20;
          }

          const pgSub = pgItems.reduce((acc, it) => acc + (parseFloat(it.subtotal) || 0), 0);
          const headerText = pg.invoiceLabel || pg.planName || 'Listino Standard';
          doc.setFillColor(226, 232, 240);
          doc.rect(14, currentY - 4, 182, 6.5, 'F');
          doc.setFontSize(9);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(15, 23, 42);
          doc.text(headerText, 17, currentY + 0.4);
          doc.text(pg.isFlatRate && pgSub === 0 ? 'Fisso Mensile (Escluso da calcolo)' : `${pgSub.toFixed(2)} EUR`, 193, currentY + 0.4, { align: 'right' });
          doc.setTextColor(0, 0, 0);
          currentY += 5.5;

          renderCompactStatsStrip(pgPallets);
          renderGoodsReportTable(pgPallets, `${sec.sectionName} · ${headerText}`);
          renderTariffItemsTable(pgItems, `Voci Listino — ${headerText}`);
        }

        // Eventuali righe manuali / sconti generali della sezione non associate a uno specifico planKey
        const extraManualItems = secItems.filter(i => !coveredItemIds.has(i.id));
        if (extraManualItems.length > 0) {
          renderTariffItemsTable(extraManualItems, `Voci Aggiuntive & Sconti — ${sec.sectionName}`);
        }
      } else {
        renderCompactStatsStrip(secPallets);
        renderGoodsReportTable(secPallets, sec.sectionName);
        renderTariffItemsTable(secItems, `Riepilogo Voci Tariffarie - ${sec.sectionName}`);
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
    // Fallback anche se non ci sono sezioni
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

  if (currentY > 224) {
    doc.addPage();
    currentY = 22;
  }

  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.4);
  doc.line(14, currentY, 196, currentY);
  currentY += 6;

  // Left: Summary per Fragmentation & Listini if multiple; Right: Clean Boxed Totals Card
  const totalsStartY = currentY;
  let leftY = currentY;

  if (sections.length >= 1) {
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('RIEPILOGO PER FRAMMENTAZIONE & LISTINO:', 14, leftY);
    leftY += 4.8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.2);
    sections.forEach((sec) => {
      const sTot = sectionTotalsMap[sec.sectionId] !== undefined
        ? sectionTotalsMap[sec.sectionId]
        : items.filter(i => String(i.sectionId) === String(sec.sectionId)).reduce((acc, it) => acc + (parseFloat(it.subtotal) || 0), 0);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text(`• ${sec.sectionName}`, 16, leftY);
      doc.text(`${Number(sTot).toFixed(2)} EUR`, 108, leftY, { align: 'right' });
      leftY += 4.2;

      if (Array.isArray(sec.planGroups) && sec.planGroups.length > 0) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.6);
        doc.setTextColor(100, 116, 139);
        sec.planGroups.forEach(pg => {
          const pgSub = items
            .filter(i => i.code !== 'DISCOUNT_PERCENT' && String(i.sectionId) === String(sec.sectionId) && (i.tariffPlanId ? String(i.tariffPlanId) : 'LEGACY') === pg.planKey)
            .reduce((acc, it) => acc + (parseFloat(it.subtotal) || 0), 0);
          doc.text(`  - ${pg.invoiceLabel || pg.planName}`, 19, leftY, { maxWidth: 65 });
          doc.text(`${pgSub.toFixed(2)} EUR`, 108, leftY, { align: 'right' });
          leftY += 3.8;
        });
        doc.setFontSize(8.2);
      }
    });
  }

  // Right Totals Card
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(116, totalsStartY - 1, 80, 29, 2.5, 2.5, 'FD');

  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(51, 65, 85);
  doc.text('Imponibile:', 121, totalsStartY + 5.5);
  doc.text(`${Number(baseTotal).toFixed(2)} EUR`, 192, totalsStartY + 5.5, { align: 'right' });

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(`IVA (${vatRate}%):`, 121, totalsStartY + 11.5);
  doc.text(`${Number(vatAmount).toFixed(2)} EUR`, 192, totalsStartY + 11.5, { align: 'right' });

  doc.setFillColor(15, 23, 42);
  doc.roundedRect(116, totalsStartY + 15.5, 80, 12.5, 2, 2, 'F');
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('TOTALE PROFORMA:', 121, totalsStartY + 23.2);
  doc.setTextColor(56, 189, 248);
  doc.text(`${Number(grandTotal).toFixed(2)} EUR`, 192, totalsStartY + 23.2, { align: 'right' });
  doc.setTextColor(0, 0, 0);

  if (vatRate === 0) {
    const exemptY = Math.max(leftY + 4, totalsStartY + 34);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(71, 85, 105);
    doc.text('* Operazione esente da IVA ai sensi della normativa vigente.', 14, exemptY);
  }

  // Footer with IBAN & Page Number on EVERY page
  const totalPages = doc.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.height;
  for (let pIdx = 1; pIdx <= totalPages; pIdx++) {
    doc.setPage(pIdx);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(14, pageHeight - 16, 196, pageHeight - 16);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    if (companySettings.company_iban) {
      doc.text(`Coordinate Bancarie (IBAN): ${companySettings.company_iban}`, 14, pageHeight - 10.5);
    }
    doc.text(`Pagina ${pIdx} di ${totalPages}`, 196, pageHeight - 10.5, { align: 'right' });
  }

  const safeName = fileName || `Proforma_${String(customer.business_name || 'Cliente').replace(/\s+/g, '_')}_${String(period || '').replace('/', '_')}.pdf`;
  doc.save(safeName);
}
