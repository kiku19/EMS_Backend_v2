import PDFDocument from 'pdfkit';
import { Student, StudentFeeStructure, FeePayment, School } from '../database.js';
import { resolveAcademicYear } from '../utils/academicYear.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('FeeInvoice');

// ─── Design tokens ───────────────────────────────────────────────────────────
// A restrained, receipt-grade palette. One accent (indigo) for the header band
// and totals; semantic colors only for the status badge and balance.
const COLOR = {
  ink: '#111827', // primary text
  inkSoft: '#374151', // secondary text
  muted: '#6b7280', // labels / captions
  faint: '#9ca3af', // footnotes
  line: '#e5e7eb', // hairlines
  lineStrong: '#d1d5db', // stronger hairlines
  surface: '#f9fafb', // zebra / panel fill
  accent: '#4f46e5', // brand accent (header band, totals)
  accentSoft: '#eef2ff', // accent tint
  ok: '#15803d',
  okSoft: '#dcfce7',
  warn: '#b45309',
  warnSoft: '#fef3c7',
  danger: '#b91c1c',
  dangerSoft: '#fee2e2',
};

const PAGE = { w: 595.28, h: 841.89, margin: 48 }; // A4 in points
const CONTENT_W = PAGE.w - PAGE.margin * 2;

const inr = (n) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);

const inrPlain = (n) => new Intl.NumberFormat('en-IN').format(Number(n) || 0);

const fmtDate = (d) => {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

/**
 * Build the canonical fee-invoice data object for a student+year. Mirrors the
 * shape of GET /students/:id/fee-invoice so the FE print view and the PDF
 * renderer share one source of truth. If a `paymentId` is supplied the data is
 * scoped to highlight that single payment on the receipt.
 */
export async function buildFeeInvoiceData({ studentId, schoolId, academicYear, paymentId }) {
  const year = await resolveAcademicYear(academicYear, schoolId);

  const student = await Student.findOne({
    _id: studentId,
    schoolId,
    isDeleted: { $ne: true },
  })
    .populate('classId', 'name section')
    .lean();
  if (!student) {
    const err = new Error('Student not found');
    err.status = 404;
    throw err;
  }

  const [feeStructure, payments, school] = await Promise.all([
    StudentFeeStructure.findOne({ studentId, schoolId, academicYear: year })
      .populate('feeHeads.feeHeadId')
      .lean(),
    FeePayment.find({
      studentId,
      schoolId,
      academicYear: year,
      status: { $ne: 'cancelled' },
    })
      .sort({ paymentDate: -1 })
      .lean(),
    School.findById(schoolId).select('name code contactEmail contactPhone').lean(),
  ]);

  const invoiceNumber = `INV-${student.admissionId || String(student._id).slice(-6).toUpperCase()}-${year.replace('-', '')}`;

  const focusedPayment = paymentId
    ? payments.find((p) => String(p._id) === String(paymentId))
    : null;

  return {
    invoice: {
      invoiceNumber: focusedPayment?.receiptNumber
        ? `RCP-${focusedPayment.receiptNumber.replace(/^RCP-/, '')}`
        : invoiceNumber,
      invoiceDate: new Date().toISOString(),
      academicYear: year,
    },
    school: school || { name: 'School', code: '' },
    student: {
      _id: student._id,
      name: student.name,
      admissionId: student.admissionId,
      rollNo: student.rollNo,
      className: student.classId
        ? `${student.classId.name}${student.classId.section ? ' ' + student.classId.section : ''}`
        : '',
    },
    feeStructure: feeStructure
      ? {
          feeHeads: (feeStructure.feeHeads || []).map((fh) => ({
            name: fh.name || fh.feeHeadId?.name || 'Fee',
            category: fh.category || fh.feeHeadId?.category || 'general',
            amount: fh.amount || 0,
            paidAmount: fh.paidAmount || 0,
            balanceAmount: fh.balanceAmount || 0,
            status: fh.status || 'pending',
          })),
          totalFee: feeStructure.totalFee || 0,
          totalPaid: feeStructure.totalPaid || 0,
          totalBalance: feeStructure.totalBalance || 0,
          discountApplied: feeStructure.discountApplied || 0,
          overallStatus: feeStructure.overallStatus || 'pending',
        }
      : {
          feeHeads: [],
          totalFee: 0,
          totalPaid: 0,
          totalBalance: 0,
          discountApplied: 0,
          overallStatus: 'pending',
        },
    payments: payments.map((p) => ({
      _id: p._id,
      receiptNumber: p.receiptNumber,
      paymentDate: p.paymentDate,
      amount: p.amount,
      paymentMode: p.paymentMode,
      feeHeads: p.feeHeads || [],
      transactionId: p.transactionId,
      status: p.status,
    })),
    focusedPaymentId: focusedPayment?._id ? String(focusedPayment._id) : null,
  };
}

// ─── Low-level layout helpers ────────────────────────────────────────────────

/**
 * Render a status pill (rounded rect + label) at (x, y). Returns the y after
 * the pill. Used for the overall status + per-payment status.
 */
function statusPill(doc, x, y, status) {
  const map = {
    paid: { label: 'PAID', fg: COLOR.ok, bg: COLOR.okSoft },
    partial: { label: 'PARTIAL', fg: COLOR.warn, bg: COLOR.warnSoft },
    pending: { label: 'PENDING', fg: COLOR.warn, bg: COLOR.warnSoft },
    overdue: { label: 'OVERDUE', fg: COLOR.danger, bg: COLOR.dangerSoft },
  };
  const { label, fg, bg } = map[String(status || 'pending').toLowerCase()] || map.pending;
  doc.save();
  doc.roundedRect(x, y, 60, 14, 7).fill(bg);
  doc
    .fillColor(fg)
    .font('Helvetica-Bold')
    .fontSize(7)
    .text(label, x, y + 3.5, { width: 60, align: 'center' });
  doc.restore();
  return y + 14;
}

/**
 * Render a clean column-header row for a table.
 */
function tableHeader(doc, y, cols) {
  doc.save();
  doc.fontSize(8).font('Helvetica-Bold').fillColor(COLOR.muted);
  for (const c of cols) {
    doc.text(c.label.toUpperCase(), c.x, y, { width: c.width, align: c.align || 'left' });
  }
  doc.restore();
  // Hairline under headers
  doc
    .moveTo(PAGE.margin, y + 12)
    .lineTo(PAGE.w - PAGE.margin, y + 12)
    .strokeColor(COLOR.line)
    .lineWidth(0.5)
    .stroke();
  return y + 12 + 6;
}

/**
 * Render one table row with vertical padding + optional zebra fill + optional
 * row fill (for highlighting the focused payment).
 */
function tableRow(doc, y, cols, { fill, font = 'Helvetica', minH = 16 } = {}) {
  // Compute the row height needed for wrapped text (first column only wraps).
  let rowH = minH;
  const firstCol = cols[0];
  if (firstCol) {
    const txtH = doc.heightOfString(String(firstCol.text), {
      width: firstCol.width,
      font,
      fontSize: 8.5,
      lineGap: 0,
    });
    rowH = Math.max(rowH, txtH + 8);
  }

  // Optional background fill (zebra / highlight).
  if (fill) {
    doc.save();
    doc.rect(PAGE.margin, y, CONTENT_W, rowH).fill(fill);
    doc.restore();
  }

  doc.font(font).fontSize(8.5).fillColor(COLOR.inkSoft);
  for (const c of cols) {
    doc.text(String(c.text), c.x, y + (rowH - minH) / 2 + 4, {
      width: c.width,
      align: c.align || 'left',
      ellipsis: true,
    });
  }
  return y + rowH;
}

function ensureSpace(doc, needed) {
  if (doc.y + needed > PAGE.h - PAGE.margin - 70) {
    doc.addPage();
    doc.y = PAGE.margin;
    return true;
  }
  return false;
}

/**
 * Render a fee invoice/receipt as a pdfkit document stream.
 * @param {Object} data - output of buildFeeInvoiceData()
 * @returns {PDFDocument} (caller pipes to res)
 */
export function renderFeeInvoicePdf(data) {
  const { invoice, school, student, feeStructure, payments, focusedPaymentId } = data;
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
  let y = PAGE.margin;

  // ── Header band ─────────────────────────────────────────────────────────
  doc.save();
  doc.rect(0, 0, PAGE.w, 96).fill(COLOR.accent);
  doc.restore();
  // School name
  doc
    .fillColor('#ffffff')
    .font('Helvetica-Bold')
    .fontSize(20)
    .text(school?.name || 'School', PAGE.margin, 32, {
      width: CONTENT_W - 130,
    });
  doc.font('Helvetica').fontSize(9).fillColor('#e0e7ff');
  const subLine = [
    school?.code && `Code: ${school.code}`,
    school?.contactPhone,
    school?.contactEmail,
  ]
    .filter(Boolean)
    .join('   ·   ');
  if (subLine) doc.text(subLine, PAGE.margin, 60, { width: CONTENT_W - 130 });

  // "FEE RECEIPT" badge (top-right of band)
  doc.save();
  doc.roundedRect(PAGE.w - PAGE.margin - 110, 30, 110, 38, 6).fill('#ffffff');
  doc.restore();
  doc
    .fillColor(COLOR.accent)
    .font('Helvetica-Bold')
    .fontSize(13)
    .text('FEE RECEIPT', PAGE.w - PAGE.margin - 110, 36, {
      width: 110,
      align: 'center',
    });
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(COLOR.muted)
    .text(`AY ${invoice.academicYear}`, PAGE.w - PAGE.margin - 110, 54, {
      width: 110,
      align: 'center',
    });

  y = 116;

  // ── Receipt meta + status (two-column) ──────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLOR.muted);
  doc.text('RECEIPT NO', PAGE.margin, y);
  doc.text('DATE', PAGE.margin + 170, y);
  doc.fillColor(COLOR.ink).font('Helvetica-Bold').fontSize(11);
  doc.text(invoice.invoiceNumber, PAGE.margin, y + 12);
  doc.text(fmtDate(invoice.invoiceDate), PAGE.margin + 170, y + 12);

  // Status pill on the right
  statusPill(doc, PAGE.w - PAGE.margin - 70, y + 8, feeStructure.overallStatus);

  // Hairline divider
  y += 36;
  doc
    .moveTo(PAGE.margin, y)
    .lineTo(PAGE.w - PAGE.margin, y)
    .strokeColor(COLOR.line)
    .lineWidth(0.5)
    .stroke();
  y += 14;

  // ── Student card ────────────────────────────────────────────────────────
  doc.save();
  doc.roundedRect(PAGE.margin, y, CONTENT_W, 46, 6).fill(COLOR.surface);
  doc.restore();

  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLOR.muted);
  doc.text('STUDENT', PAGE.margin + 14, y + 10);
  doc
    .fillColor(COLOR.ink)
    .font('Helvetica-Bold')
    .fontSize(12)
    .text(student.name || '—', PAGE.margin + 14, y + 22);

  const meta = [
    student.className && `Class: ${student.className}`,
    student.rollNo && `Roll: ${student.rollNo}`,
    student.admissionId && `Adm: ${student.admissionId}`,
  ].filter(Boolean);
  doc.font('Helvetica').fontSize(8.5).fillColor(COLOR.inkSoft);
  doc.text(meta.join('   ·   '), PAGE.margin + 200, y + 22, { width: CONTENT_W - 214 });

  y += 46 + 16;

  // ── Fee breakdown table ─────────────────────────────────────────────────
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(COLOR.ink)
    .text('Fee Breakdown', PAGE.margin, y);
  y += 16;

  const amtX = PAGE.w - PAGE.margin - 200;
  const paidX = PAGE.w - PAGE.margin - 130;
  const balX = PAGE.w - PAGE.margin - 60;
  const nameW = amtX - PAGE.margin;

  y = tableHeader(doc, y, [
    { label: 'Fee Head', x: PAGE.margin, width: nameW },
    { label: 'Amount', x: amtX, width: 70, align: 'right' },
    { label: 'Paid', x: paidX, width: 70, align: 'right' },
    { label: 'Balance', x: balX, width: 60, align: 'right' },
  ]);

  doc.lineWidth(0);
  feeStructure.feeHeads.forEach((head, i) => {
    ensureSpace(doc, 22);
    if (i % 2 === 1) {
      doc.save();
      doc.rect(PAGE.margin, y, CONTENT_W, 18).fill(COLOR.surface);
      doc.restore();
    }
    y = tableRow(
      doc,
      y,
      [
        { text: head.name, x: PAGE.margin, width: nameW },
        { text: inrPlain(head.amount), x: amtX, width: 70, align: 'right' },
        { text: inrPlain(head.paidAmount), x: paidX, width: 70, align: 'right' },
        { text: inrPlain(head.balanceAmount), x: balX, width: 60, align: 'right' },
      ],
      { minH: 18 }
    );
  });

  // Bottom hairline of the table
  doc
    .moveTo(PAGE.margin, y)
    .lineTo(PAGE.w - PAGE.margin, y)
    .strokeColor(COLOR.lineStrong)
    .lineWidth(0.75)
    .stroke();
  y += 12;

  // ── Totals box (right-aligned summary) ──────────────────────────────────
  const boxW = 240;
  const boxX = PAGE.w - PAGE.margin - boxW;
  const boxH = 86;
  ensureSpace(doc, boxH + 10);
  doc.save();
  doc.roundedRect(boxX, y, boxW, boxH, 6).fillAndStroke(COLOR.accentSoft, COLOR.accent);
  doc.restore();

  const labelX = boxX + 14;
  const valX = boxX + boxW - 14;
  let ty = y + 14;
  doc.font('Helvetica').fontSize(9).fillColor(COLOR.inkSoft);
  doc.text('Total Fee', labelX, ty);
  doc
    .font('Helvetica-Bold')
    .fillColor(COLOR.ink)
    .text(inr(feeStructure.totalFee), labelX, ty, { width: boxW - 28, align: 'right' });
  ty += 16;
  doc.font('Helvetica').fillColor(COLOR.inkSoft).text('Discount', labelX, ty);
  doc
    .font('Helvetica-Bold')
    .fillColor(COLOR.ink)
    .text(`– ${inr(feeStructure.discountApplied)}`, labelX, ty, {
      width: boxW - 28,
      align: 'right',
    });
  ty += 16;
  doc.font('Helvetica').fillColor(COLOR.inkSoft).text('Total Paid', labelX, ty);
  doc
    .font('Helvetica-Bold')
    .fillColor(COLOR.ok)
    .text(inr(feeStructure.totalPaid), labelX, ty, { width: boxW - 28, align: 'right' });
  ty += 16;
  // Balance Due — emphasized
  doc.save();
  doc
    .moveTo(labelX, ty - 2)
    .lineTo(valX, ty - 2)
    .strokeColor(COLOR.line)
    .lineWidth(0.5)
    .stroke();
  doc.restore();
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(COLOR.ink)
    .text('Balance Due', labelX, ty + 2);
  const balColor = feeStructure.totalBalance > 0 ? COLOR.warn : COLOR.ok;
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(balColor)
    .text(inr(feeStructure.totalBalance), labelX, ty, { width: boxW - 28, align: 'right' });

  y += boxH + 24;

  // ── Payment history ─────────────────────────────────────────────────────
  ensureSpace(doc, 60);
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(COLOR.ink)
    .text('Payment History', PAGE.margin, y);
  y += 16;

  if (payments.length === 0) {
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(COLOR.muted)
      .text('No payments recorded yet.', PAGE.margin, y);
    y += 16;
  } else {
    const rAmtX = PAGE.w - PAGE.margin - 60;
    const rModeX = rAmtX - 95;
    const rDateX = rAmtX - 170;
    y = tableHeader(doc, y, [
      { label: 'Receipt', x: PAGE.margin, width: 110 },
      { label: 'Date', x: rDateX, width: 75 },
      { label: 'Mode', x: rModeX, width: 75 },
      { label: 'Amount', x: rAmtX, width: 60, align: 'right' },
    ]);

    payments.forEach((p, i) => {
      ensureSpace(doc, 20);
      const focused = focusedPaymentId && String(p._id) === focusedPaymentId;
      const fill = focused ? COLOR.accentSoft : i % 2 === 1 ? COLOR.surface : null;
      y = tableRow(
        doc,
        y,
        [
          {
            text: p.receiptNumber || '—',
            x: PAGE.margin,
            width: 110,
            font: focused ? 'Helvetica-Bold' : 'Helvetica',
          },
          { text: fmtDate(p.paymentDate), x: rDateX, width: 75 },
          { text: String(p.paymentMode || '—').toUpperCase(), x: rModeX, width: 75 },
          {
            text: inrPlain(p.amount),
            x: rAmtX,
            width: 60,
            align: 'right',
            font: focused ? 'Helvetica-Bold' : 'Helvetica',
          },
        ],
        { fill, minH: 18 }
      );
    });
  }

  // ── Footer ──────────────────────────────────────────────────────────────
  const footerY = PAGE.h - 56;
  doc
    .moveTo(PAGE.margin, footerY)
    .lineTo(PAGE.w - PAGE.margin, footerY)
    .strokeColor(COLOR.line)
    .lineWidth(0.5)
    .stroke();
  doc
    .fontSize(7.5)
    .font('Helvetica')
    .fillColor(COLOR.faint)
    .text(
      'This is a computer-generated receipt and does not require a signature.',
      PAGE.margin,
      footerY + 8,
      {
        width: CONTENT_W,
        align: 'center',
      }
    )
    .text(
      `Generated ${new Date().toLocaleString('en-IN')}   ·   ${school?.name || ''}`,
      PAGE.margin,
      footerY + 20,
      {
        width: CONTENT_W,
        align: 'center',
      }
    );

  doc.end();
  return doc;
}

/**
 * Convenience: build data + render PDF for a student invoice.
 * Returns the readable pdfkit stream (caller pipes to res).
 */
export async function generateFeeInvoicePdf({ studentId, schoolId, academicYear, paymentId }) {
  const data = await buildFeeInvoiceData({ studentId, schoolId, academicYear, paymentId });
  return renderFeeInvoicePdf(data);
}
