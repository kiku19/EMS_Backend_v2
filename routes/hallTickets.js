import express from 'express';
import PDFDocument from 'pdfkit';
import { ExamSchedule, Student, SchoolSettings } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { validateZod } from '../middleware/validation.js';
import { hallTicketQuerySchema } from '../validators/index.js';
import { extractSchoolId } from '../utils/schoolContext.js';

const router = express.Router();
router.use(authenticate);

function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) throw new Error('schoolId is required for scoped queries');
  return { ...query, schoolId: normalizedSchoolId };
}

function formatDate(date) {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function getTimeForSession(schedule, session) {
  if (session === 'morning') {
    const slot = schedule.morningSlot;
    if (slot?.startTime && slot?.endTime) return `${slot.startTime} - ${slot.endTime}`;
    return '09:00 - 12:00';
  }
  const slot = schedule.afternoonSlot;
  if (slot?.startTime && slot?.endTime) return `${slot.startTime} - ${slot.endTime}`;
  return '14:00 - 17:00';
}

/**
 * Draw a single hall ticket onto the PDF document at position (x, y).
 * Each ticket fits in an A4 half page (595 x 420 pts).
 */
function drawHallTicket(doc, student, cls, schedule, schoolSettings, classEntries) {
  const ticketWidth = 495; // A4 width minus margins
  const x = 50;
  const startY = doc.y;

  // ── OUTER BORDER ──────────────────────────────────────────────────────────
  doc.save();
  doc.rect(x, startY, ticketWidth, 380).stroke('#333333');

  // ── HEADER BAND ───────────────────────────────────────────────────────────
  doc.rect(x, startY, ticketWidth, 60).fill('#1e3a5f');

  // School name
  doc
    .fillColor('#ffffff')
    .fontSize(14)
    .font('Helvetica-Bold')
    .text(schoolSettings.name || schoolSettings.schoolName || 'School', x + 10, startY + 8, {
      width: ticketWidth - 140,
      ellipsis: true,
    });

  // Board & affiliation
  const boardText = [
    schoolSettings.boardOfEducation,
    schoolSettings.affiliationNo ? `Aff. No: ${schoolSettings.affiliationNo}` : null,
    schoolSettings.udiseNo ? `UDISE: ${schoolSettings.udiseNo}` : null,
  ]
    .filter(Boolean)
    .join(' | ');

  doc
    .fillColor('#ccddee')
    .fontSize(8)
    .font('Helvetica')
    .text(boardText || 'Board of Education', x + 10, startY + 28, {
      width: ticketWidth - 140,
      ellipsis: true,
    });

  // Hall Ticket label (right side of header)
  doc
    .fillColor('#ffffff')
    .fontSize(10)
    .font('Helvetica-Bold')
    .text('HALL TICKET', x + ticketWidth - 130, startY + 10, { width: 120, align: 'center' });
  doc
    .fillColor('#ccddee')
    .fontSize(8)
    .font('Helvetica')
    .text(schedule.name, x + ticketWidth - 130, startY + 26, {
      width: 120,
      align: 'center',
      ellipsis: true,
    });

  // ── STUDENT INFO SECTION ──────────────────────────────────────────────────
  doc.restore();
  const infoY = startY + 70;

  // Photo box (right side)
  const photoBoxX = x + ticketWidth - 90;
  const photoBoxY = infoY;
  doc.rect(photoBoxX, photoBoxY, 80, 90).stroke('#999999');
  doc
    .fillColor('#cccccc')
    .fontSize(7)
    .font('Helvetica')
    .text('Photo', photoBoxX, photoBoxY + 38, { width: 80, align: 'center' });

  // Student details grid
  const labelX = x + 10;
  const valueX = x + 130;
  const colWidth = photoBoxX - valueX - 10;

  const fields = [
    ['Student Name', student.name],
    ['Admission No.', student.admissionId || '-'],
    ['Roll Number', student.rollNo != null ? String(student.rollNo) : '-'],
    ['Class & Section', `${cls?.name || '-'} - ${cls?.section || '-'}`],
    ['Date of Birth', student.dateOfBirth ? formatDate(student.dateOfBirth) : '-'],
    ['Gender', student.gender || '-'],
    ['Academic Year', schedule.academicYear || '-'],
  ];

  let fieldY = infoY;
  fields.forEach(([label, value]) => {
    doc
      .fillColor('#555555')
      .fontSize(8)
      .font('Helvetica')
      .text(label + ':', labelX, fieldY, { width: 118 });
    doc
      .fillColor('#111111')
      .fontSize(8)
      .font('Helvetica-Bold')
      .text(value, valueX, fieldY, { width: colWidth });
    fieldY += 13;
  });

  // ── EXAM SCHEDULE TABLE ───────────────────────────────────────────────────
  const tableY = infoY + 95;
  const tableHeaderH = 16;
  const rowH = 14;
  const cols = { sno: 30, date: 90, day: 60, subject: 150, session: 80, marks: 85 };
  const colXs = {
    sno: x,
    date: x + cols.sno,
    day: x + cols.sno + cols.date,
    subject: x + cols.sno + cols.date + cols.day,
    session: x + cols.sno + cols.date + cols.day + cols.subject,
    marks: x + cols.sno + cols.date + cols.day + cols.subject + cols.session,
  };

  // Table header background
  doc.rect(x, tableY, ticketWidth, tableHeaderH).fill('#e8f0fe');
  doc.fillColor('#1e3a5f').fontSize(8).font('Helvetica-Bold');
  doc.text('S.No', colXs.sno + 2, tableY + 4, { width: cols.sno - 4, align: 'center' });
  doc.text('Date', colXs.date + 2, tableY + 4, { width: cols.date - 4, align: 'center' });
  doc.text('Day', colXs.day + 2, tableY + 4, { width: cols.day - 4, align: 'center' });
  doc.text('Subject', colXs.subject + 2, tableY + 4, { width: cols.subject - 4, align: 'center' });
  doc.text('Session / Time', colXs.session + 2, tableY + 4, {
    width: cols.session - 4,
    align: 'center',
  });
  doc.text('Max Marks', colXs.marks + 2, tableY + 4, { width: cols.marks - 4, align: 'center' });

  // Table rows
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  classEntries.forEach((entry, idx) => {
    const rowY = tableY + tableHeaderH + idx * rowH;
    if (idx % 2 === 1) {
      doc.rect(x, rowY, ticketWidth, rowH).fill('#f9f9f9');
    }
    doc.fillColor('#222222').fontSize(7.5).font('Helvetica');
    const entryDate = new Date(entry.date);
    const timeStr = getTimeForSession(schedule, entry.session);
    doc.text(String(idx + 1), colXs.sno + 2, rowY + 3, { width: cols.sno - 4, align: 'center' });
    doc.text(formatDate(entry.date), colXs.date + 2, rowY + 3, {
      width: cols.date - 4,
      align: 'center',
    });
    doc.text(DAYS[entryDate.getDay()] || '-', colXs.day + 2, rowY + 3, {
      width: cols.day - 4,
      align: 'center',
    });
    doc.text(entry.subjectName, colXs.subject + 2, rowY + 3, {
      width: cols.subject - 4,
      ellipsis: true,
    });
    doc.text(
      `${entry.session.charAt(0).toUpperCase() + entry.session.slice(1)} (${timeStr})`,
      colXs.session + 2,
      rowY + 3,
      { width: cols.session - 4, align: 'center', ellipsis: true }
    );
    doc.text(String(entry.maxMarks || schedule.defaultMaxMarks || 100), colXs.marks + 2, rowY + 3, {
      width: cols.marks - 4,
      align: 'center',
    });
  });

  // Table outer border
  const tableH = tableHeaderH + classEntries.length * rowH;
  doc.rect(x, tableY, ticketWidth, tableH).stroke('#aaaaaa');
  // Column dividers
  [colXs.date, colXs.day, colXs.subject, colXs.session, colXs.marks].forEach((cx) => {
    doc
      .moveTo(cx, tableY)
      .lineTo(cx, tableY + tableH)
      .stroke('#cccccc');
  });
  // Row dividers
  for (let i = 1; i <= classEntries.length; i++) {
    const ry = tableY + tableHeaderH + (i - 1) * rowH;
    doc
      .moveTo(x, ry)
      .lineTo(x + ticketWidth, ry)
      .stroke('#e0e0e0');
  }

  // ── INSTRUCTIONS ─────────────────────────────────────────────────────────
  const instrY = tableY + tableH + 8;
  doc
    .fillColor('#333333')
    .fontSize(7)
    .font('Helvetica-Bold')
    .text('Instructions:', x + 10, instrY);
  doc
    .fillColor('#555555')
    .fontSize(6.5)
    .font('Helvetica')
    .text(
      '1. Students must carry this hall ticket to every examination.  ' +
        '2. No electronic devices allowed in the examination hall.  ' +
        '3. Report 15 minutes before the exam start time.',
      x + 10,
      instrY + 10,
      { width: ticketWidth - 130 }
    );

  // ── SIGNATURES ────────────────────────────────────────────────────────────
  const sigY = instrY + 30;
  doc
    .fillColor('#333333')
    .fontSize(7)
    .font('Helvetica')
    .text("Student's Signature", x + 10, sigY + 14, { width: 120, align: 'center' })
    .text('Class Teacher', x + ticketWidth / 2 - 60, sigY + 14, { width: 120, align: 'center' })
    .text('Principal', x + ticketWidth - 130, sigY + 14, { width: 120, align: 'center' });

  // Signature lines
  doc
    .moveTo(x + 10, sigY + 12)
    .lineTo(x + 130, sigY + 12)
    .stroke('#999999');
  doc
    .moveTo(x + ticketWidth / 2 - 60, sigY + 12)
    .lineTo(x + ticketWidth / 2 + 60, sigY + 12)
    .stroke('#999999');
  doc
    .moveTo(x + ticketWidth - 130, sigY + 12)
    .lineTo(x + ticketWidth - 10, sigY + 12)
    .stroke('#999999');

  // Outer border final draw
  doc.rect(x, startY, ticketWidth, 380).stroke('#333333');

  // Move cursor past ticket + gap
  doc.y = startY + 390;
}

// ─── GET /hall-tickets/schedule/:scheduleId ───────────────────────────────────
// List students eligible for hall tickets under an exam schedule
router.get(
  '/schedule/:scheduleId',
  authenticate,
  validateZod(hallTicketQuerySchema, 'query'),
  async (req, res) => {
    try {
      const schoolId = req.user?.schoolId;
      const { scheduleId } = req.params;
      const { classId } = req.query;

      const schedule = await ExamSchedule.findOne(
        scopeBySchool(schoolId, {
          _id: scheduleId,
          isDeleted: { $ne: true },
        })
      ).populate('classIds', 'name section');

      if (!schedule) {
        return res.status(404).json({ success: false, message: 'Exam schedule not found' });
      }

      // Determine which classIds to query
      const targetClassIds = classId ? [classId] : schedule.classIds.map((c) => c._id || c);

      const students = await Student.find(
        scopeBySchool(schoolId, {
          classId: { $in: targetClassIds },
          status: { $ne: 'inactive' },
          isDeleted: { $ne: true },
        })
      )
        .populate('classId', 'name section')
        .sort({ rollNo: 1, name: 1 })
        .select('name admissionId rollNo classId dateOfBirth gender photo academicYear');

      res.json({
        success: true,
        schedule: {
          _id: schedule._id,
          name: schedule.name,
          type: schedule.type,
          academicYear: schedule.academicYear,
          startDate: schedule.startDate,
          endDate: schedule.endDate,
          entries: schedule.entries,
          morningSlot: schedule.morningSlot,
          afternoonSlot: schedule.afternoonSlot,
          defaultMaxMarks: schedule.defaultMaxMarks,
          classIds: schedule.classIds,
        },
        students: students.map((s) => ({
          _id: s._id,
          name: s.name,
          admissionId: s.admissionId,
          rollNo: s.rollNo,
          dateOfBirth: s.dateOfBirth,
          gender: s.gender,
          photo: s.photo,
          academicYear: s.academicYear,
          class: s.classId
            ? { _id: s.classId._id, name: s.classId.name, section: s.classId.section }
            : null,
        })),
        total: students.length,
      });
    } catch (error) {
      console.error('Error fetching hall ticket data:', error);
      res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
  }
);

// ─── GET /hall-tickets/schedule/:scheduleId/download ─────────────────────────
// Bulk PDF download — one hall ticket per student (all classes in schedule)
router.get(
  '/schedule/:scheduleId/download',
  authenticate,
  validateZod(hallTicketQuerySchema, 'query'),
  async (req, res) => {
    try {
      const schoolId = req.user?.schoolId;
      const { scheduleId } = req.params;
      const { classId } = req.query;

      const [schedule, schoolSettings] = await Promise.all([
        ExamSchedule.findOne(
          scopeBySchool(schoolId, {
            _id: scheduleId,
            isDeleted: { $ne: true },
          })
        ).populate('classIds', 'name section'),
        SchoolSettings.findOne(scopeBySchool(schoolId)),
      ]);

      if (!schedule) {
        return res.status(404).json({ success: false, message: 'Exam schedule not found' });
      }

      const targetClassIds = classId ? [classId] : schedule.classIds.map((c) => c._id || c);

      const students = await Student.find(
        scopeBySchool(schoolId, {
          classId: { $in: targetClassIds },
          status: { $ne: 'inactive' },
          isDeleted: { $ne: true },
        })
      )
        .populate('classId', 'name section')
        .sort({ classId: 1, rollNo: 1, name: 1 })
        .select('name admissionId rollNo classId dateOfBirth gender photo academicYear');

      if (students.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: 'No students found for this schedule' });
      }

      const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });

      const safeName = (schedule.name || 'HallTickets').replace(/[^a-zA-Z0-9_-]/g, '_');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="hall-tickets-${safeName}.pdf"`);
      doc.pipe(res);

      const school = schoolSettings || { name: 'School', schoolName: 'School' };

      students.forEach((student, idx) => {
        if (idx > 0) doc.addPage();
        doc.y = 50;

        // Filter schedule entries relevant to this student's class
        const studentClassId = student.classId?._id?.toString() || student.classId?.toString();
        const classEntries = schedule.entries.filter((entry) => {
          if (!entry.classIds || entry.classIds.length === 0) return true;
          return entry.classIds.some((cid) => cid.toString() === studentClassId);
        });

        drawHallTicket(doc, student, student.classId, schedule, school, classEntries);
      });

      doc.end();
    } catch (error) {
      console.error('Error generating hall ticket PDF:', error);
      res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
  }
);

// ─── GET /hall-tickets/schedule/:scheduleId/student/:studentId/download ───────
// Single student hall ticket PDF download
router.get('/schedule/:scheduleId/student/:studentId/download', authenticate, async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const { scheduleId, studentId } = req.params;

    const [schedule, student, schoolSettings] = await Promise.all([
      ExamSchedule.findOne(
        scopeBySchool(schoolId, {
          _id: scheduleId,
          isDeleted: { $ne: true },
        })
      ).populate('classIds', 'name section'),
      Student.findOne(
        scopeBySchool(schoolId, {
          _id: studentId,
          status: { $ne: 'inactive' },
          isDeleted: { $ne: true },
        })
      ).populate('classId', 'name section'),
      SchoolSettings.findOne(scopeBySchool(schoolId)),
    ]);

    if (!schedule)
      return res.status(404).json({ success: false, message: 'Exam schedule not found' });
    if (!student)
      return res.status(404).json({ success: false, message: req.t('students:errors.notFound') });

    const studentClassId = student.classId?._id?.toString() || student.classId?.toString();
    const classEntries = schedule.entries.filter((entry) => {
      if (!entry.classIds || entry.classIds.length === 0) return true;
      return entry.classIds.some((cid) => cid.toString() === studentClassId);
    });

    const school = schoolSettings || { name: 'School', schoolName: 'School' };

    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
    const safeName = student.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="hall-ticket-${safeName}.pdf"`);
    doc.pipe(res);

    doc.y = 50;
    drawHallTicket(doc, student, student.classId, schedule, school, classEntries);
    doc.end();
  } catch (error) {
    console.error('Error generating individual hall ticket:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

export default router;
