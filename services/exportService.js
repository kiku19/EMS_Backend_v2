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

// ─── STREAMED EXPORT (cursor-based, bounded memory) ─────────────────────────

// Cap on the number of rows written to a single xlsx export. The OOXML
// format exceljs produces cannot be streamed row-by-row — the workbook is
// serialized whole at the end of `workbook.xlsx.write(res)`, so without a cap
// a 100k-row export would hold every row in memory. CSV and PDF stream truly
// incrementally (one row → one res.write()), so they need no cap. When an xlsx
// export hits this cap, the response carries `X-Export-Truncated: true` so the
// client can prompt the user to narrow filters or switch to CSV.
const XLSX_ROW_CAP = 20000;

/**
 * Stream-based export that processes a MongoDB cursor in batches instead of
 * loading the entire result set into memory.
 *
 * CSV and PDF stream one row at a time (genuinely bounded memory). xlsx cannot
 * be row-streamed by exceljs, so it is capped at XLSX_ROW_CAP rows and flagged
 * via the `X-Export-Truncated` header when exceeded — large xlsx exports should
 * be narrowed or switched to CSV.
 *
 * @param {import('express').Response} res
 * @param {object} opts
 * @param {'csv'|'xlsx'|'pdf'} opts.format
 * @param {string} opts.filename
 * @param {string} opts.title
 * @param {string} [opts.sheetName]
 * @param {Array<{key:string,label:string,width?:number}>} opts.headers
 * @param {import('mongoose').Cursor} opts.cursor - A Mongoose query cursor (.cursor())
 * @param {(doc: object) => object} opts.transform - Maps a raw document to a row object
 */
export async function sendStreamedExport(
  res,
  { format, filename, title, sheetName, headers, cursor, transform }
) {
  if (format === 'xlsx') {
    await streamExcel(res, filename, sheetName || title, headers, cursor, transform);
  } else if (format === 'pdf') {
    await streamPDF(res, filename, title, headers, cursor, transform);
  } else {
    await streamCSV(res, filename, headers, cursor, transform);
  }
}

/**
 * Stream CSV rows from a cursor directly to the HTTP response.
 */
async function streamCSV(res, filename, headers, cursor, transform) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);

  // Write header line
  res.write(headers.map((h) => escapeCSV(h.label)).join(',') + '\n');

  let doc;
  while ((doc = await cursor.next())) {
    const row = transform(doc);
    const line = headers.map((h) => escapeCSV(row[h.key] ?? '')).join(',');
    res.write(line + '\n');
  }

  res.end();
}

/**
 * Stream Excel rows from a cursor. exceljs cannot row-stream the OOXML output
 * (the workbook is serialized whole in `workbook.xlsx.write`), so to keep
 * memory bounded we cap the sheet at XLSX_ROW_CAP rows. When the cursor holds
 * more rows than the cap, we drain the remainder (so the cursor is fully
 * consumed and no server resources leak) and set `X-Export-Truncated: true` so
 * the client can prompt the user to narrow filters or export as CSV, which
 * streams with no cap. (D8)
 */
async function streamExcel(res, filename, sheetName, headers, cursor, transform) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'EMS';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(sheetName);

  sheet.columns = headers.map((h) => ({
    header: h.label,
    key: h.key,
    width: h.width || 18,
  }));

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

  let idx = 0;
  let truncated = false;
  let doc;
  while ((doc = await cursor.next())) {
    if (idx < XLSX_ROW_CAP) {
      const row = transform(doc);
      const rowData = {};
      headers.forEach((h) => {
        rowData[h.key] = row[h.key] ?? '';
      });
      const excelRow = sheet.addRow(rowData);
      if (idx % 2 === 1) {
        excelRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8F9FA' },
        };
      }
    } else {
      // Past the cap — stop writing rows but keep draining the cursor so it is
      // fully consumed (no dangling server-side cursor / memory leak).
      truncated = true;
    }
    idx++;
  }

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  if (truncated) {
    res.setHeader('X-Export-Truncated', 'true');
    res.setHeader('X-Export-Row-Cap', String(XLSX_ROW_CAP));
  }
  await workbook.xlsx.write(res);
  res.end();
}

/**
 * Stream PDF rows from a cursor, adding pages as needed.
 */
async function streamPDF(res, filename, title, headers, cursor, transform) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, layout: 'landscape' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  doc.pipe(res);

  doc.fontSize(16).font('Helvetica-Bold').text(title, { align: 'center' });
  doc.moveDown(0.3);
  doc
    .fontSize(8)
    .font('Helvetica')
    .fillColor('#666666')
    .text(`Generated: ${new Date().toLocaleString()}`, { align: 'right' });
  doc.fillColor('black');
  doc.moveDown(0.5);

  const pageWidth = doc.page.width - 80;
  const colWidth = pageWidth / headers.length;
  const rowH = 18;
  let y = doc.y;
  const startX = 40;

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

  let rowIdx = 0;
  let record;
  while ((record = await cursor.next())) {
    const row = transform(record);
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
    rowIdx++;
  }

  doc.end();
}
