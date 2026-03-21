/**
 * Generic export service — CSV, Excel (exceljs), PDF (pdfkit) formatters.
 * Each formatter accepts a common { filename, title, sheetName, headers, rows } descriptor.
 *
 * headers: Array<{ key: string, label: string, width?: number }>
 * rows:    Array<Record<string, any>>
 */

import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

// ─── CSV ─────────────────────────────────────────────────────────────────────

function escapeCSV(val) {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCSV(headers, rows) {
  const headerLine = headers.map((h) => escapeCSV(h.label)).join(',');
  const dataLines = rows.map((row) => headers.map((h) => escapeCSV(row[h.key] ?? '')).join(','));
  return [headerLine, ...dataLines].join('\n');
}

function sendCSV(res, filename, headers, rows) {
  const csv = toCSV(headers, rows);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  res.send(csv);
}

// ─── EXCEL ───────────────────────────────────────────────────────────────────

async function sendExcel(res, filename, sheetName, headers, rows) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'EMS';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sheetName);

  sheet.columns = headers.map((h) => ({
    header: h.label,
    key: h.key,
    width: h.width || 18,
  }));

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE2EEFF' },
  };
  headerRow.border = {
    bottom: { style: 'thin', color: { argb: 'FFB8CCEE' } },
  };

  rows.forEach((row, idx) => {
    const rowData = {};
    headers.forEach((h) => {
      rowData[h.key] = row[h.key] ?? '';
    });
    const excelRow = sheet.addRow(rowData);
    // Alternate row shading
    if (idx % 2 === 1) {
      excelRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF8F9FA' },
      };
    }
  });

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ─── PDF (simple landscape table) ────────────────────────────────────────────

function sendPDF(res, filename, title, headers, rows) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, layout: 'landscape' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  doc.pipe(res);

  // Title
  doc.fontSize(16).font('Helvetica-Bold').text(title, { align: 'center' });
  doc.moveDown(0.3);
  doc
    .fontSize(8)
    .font('Helvetica')
    .fillColor('#666666')
    .text(`Generated: ${new Date().toLocaleString()}`, { align: 'right' });
  doc.fillColor('black');
  doc.moveDown(0.5);

  const pageWidth = doc.page.width - 80; // left + right margin
  const colWidth = pageWidth / headers.length;
  const rowH = 18;
  let y = doc.y;
  const startX = 40;

  // Draw header row background
  doc.rect(startX, y, pageWidth, rowH).fill('#E2EEFF');
  doc.fillColor('black').fontSize(8).font('Helvetica-Bold');

  headers.forEach((h, i) => {
    doc.text(h.label, startX + i * colWidth + 3, y + 5, {
      width: colWidth - 6,
      lineBreak: false,
    });
  });
  y += rowH;

  doc.font('Helvetica').fontSize(7);

  rows.forEach((row, rowIdx) => {
    if (y + rowH > doc.page.height - 50) {
      doc.addPage();
      y = 40;
    }

    if (rowIdx % 2 === 1) {
      doc.rect(startX, y, pageWidth, rowH).fill('#F8F9FA');
      doc.fillColor('black');
    }

    headers.forEach((h, i) => {
      const val = row[h.key] ?? '';
      doc.text(String(val), startX + i * colWidth + 3, y + 5, {
        width: colWidth - 6,
        lineBreak: false,
      });
    });

    y += rowH;
  });

  doc.end();
}

// ─── DISPATCHER ──────────────────────────────────────────────────────────────

/**
 * @param {import('express').Response} res
 * @param {{ format: 'csv'|'xlsx'|'pdf', filename: string, title: string, sheetName?: string, headers: Array<{key:string,label:string,width?:number}>, rows: object[] }} opts
 */
export async function sendExport(res, { format, filename, title, sheetName, headers, rows }) {
  if (format === 'xlsx') {
    await sendExcel(res, filename, sheetName || title, headers, rows);
  } else if (format === 'pdf') {
    sendPDF(res, filename, title, headers, rows);
  } else {
    sendCSV(res, filename, headers, rows);
  }
}
