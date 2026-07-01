import express from 'express';
import { Student, StudentFeeStructure, FeePayment, School, Parent } from '../../database.js';
import { authenticate } from '../../middleware/auth.js';
import { checkPermission } from '../../middleware/permissions.js';
import { resolveAcademicYear } from '../../utils/academicYear.js';
import { scopeBySchool, sendReminderSchema, sendRemindersBulkSchema } from './helpers.js';
import { createLogger } from '../../utils/logger.js';
import { objectIdParamHandler } from '../../middleware/validation.js';

const router = express.Router();
const logger = createLogger('StudentFees');

// Map the reminder domain type ('fee' | 'attendance') to a valid
// Notification.type enum value. NOTE: 'fee' is NOT a member of the
// Notification.type enum (the canonical fee/payment type is 'payment'),
// so passing the raw reminder type straight through made every reminder
// notification fail validation on save — silently swallowed per-parent while
// the endpoint still reported success (SCH-209). Reuse 'payment', which the
// rest of the codebase already uses for fee/payment notifications.
const REMINDER_NOTIFICATION_TYPE = { fee: 'payment', attendance: 'attendance' };

router.use(authenticate);
router.param('id', objectIdParamHandler);
router.param('classId', objectIdParamHandler);

router.get(
  '/class/:classId/fee-status',
  authenticate,
  checkPermission('fees', 'view'),
  async (req, res) => {
    try {
      const academicYear = await resolveAcademicYear(req.query.academicYear, req.user?.schoolId);
      const feeStructures = await StudentFeeStructure.find(
        scopeBySchool(req.user?.schoolId, { classId: req.params.classId, academicYear })
      ).populate('studentId', 'name admissionId rollNo');

      const result = feeStructures.map((feeStructure) => ({
        studentId: feeStructure.studentId._id,
        studentName: feeStructure.studentId.name,
        admissionId: feeStructure.studentId.admissionId,
        rollNo: feeStructure.studentId.rollNo,
        totalFee: feeStructure.totalFee,
        totalPaid: feeStructure.totalPaid,
        totalBalance: feeStructure.totalBalance,
        overallStatus: feeStructure.overallStatus,
      }));

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

router.get(
  '/:id/fee-summary',
  authenticate,
  checkPermission('students', 'view'),
  async (req, res) => {
    try {
      const scopedStudent = await Student.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id })
      );
      if (!scopedStudent) {
        return res.status(404).json({ error: req.t('common:routes.studentNotFound1') });
      }

      const year = await resolveAcademicYear(req.query.academicYear, req.user?.schoolId);
      const feeStructure = await StudentFeeStructure.findOne(
        scopeBySchool(req.user?.schoolId, { studentId: req.params.id, academicYear: year })
      ).populate('feeHeads.feeHeadId');

      if (!feeStructure) {
        return res.json({
          totalFee: 0,
          totalPaid: 0,
          totalPending: 0,
          totalDiscount: 0,
          collectionMode: 'term',
          nextDueDate: null,
          pendingDuesByPeriod: {},
          feeHeads: [],
          overallStatus: 'pending',
        });
      }

      const pendingDuesByPeriod = {};
      feeStructure.feeHeads.forEach((feeHead) => {
        if (feeHead.balanceAmount > 0) {
          const period = feeHead.frequency || 'onetime';
          pendingDuesByPeriod[period] = (pendingDuesByPeriod[period] || 0) + feeHead.balanceAmount;
        }
      });

      res.json({
        totalFee: feeStructure.totalFee,
        totalPaid: feeStructure.totalPaid,
        totalPending: feeStructure.totalBalance,
        totalDiscount: feeStructure.discountApplied || 0,
        collectionMode: 'term',
        nextDueDate: feeStructure.nextDueDate || null,
        pendingDuesByPeriod,
        feeHeads: feeStructure.feeHeads,
        overallStatus: feeStructure.overallStatus,
      });
    } catch (error) {
      logger.error('Error fetching fee summary:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

router.post(
  '/:id/send-reminder',
  authenticate,
  checkPermission('students', 'edit'),
  async (req, res) => {
    const parsed = sendReminderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: req.t('common:routes.validationFailed'), details: parsed.error.errors });
    }
    const { type, message } = parsed.data;

    try {
      const student = await Student.findOne(
        scopeBySchool(req.user?.schoolId, { _id: req.params.id })
      ).populate('classId', 'name section');

      if (!student) {
        return res.status(404).json({ error: req.t('common:routes.studentNotFound1') });
      }

      const parents = await Parent.find({ 'children.studentId': req.params.id }).select('_id');
      if (parents.length === 0) {
        return res
          .status(400)
          .json({ error: req.t('common:routes.noLinkedParentAccountFoundForThisStudent') });
      }

      const title =
        type === 'fee' ? `Fee Reminder: ${student.name}` : `Attendance Reminder: ${student.name}`;
      const body =
        message ||
        (type === 'fee'
          ? `This is a reminder regarding pending fees for ${student.name}.`
          : `This is a reminder regarding attendance for ${student.name}.`);

      const { sendNotification } = await import('../notifications.js');
      const notifType = REMINDER_NOTIFICATION_TYPE[type] || 'payment';
      let notified = 0;
      for (const parent of parents) {
        try {
          await sendNotification(parent._id, 'Parent', notifType, title, body, {
            relatedId: student._id,
            relatedType: 'Student',
            priority: 'normal',
          });
          notified++;
        } catch (notifError) {
          logger.error('Error sending reminder notification to parent:', notifError);
        }
      }

      res.json({
        success: true,
        message: `Reminder sent to ${notified} parent(s) of ${student.name}`,
        studentId: student._id,
        notified,
      });
    } catch (error) {
      logger.error('Error sending reminder:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

router.post(
  '/send-reminders-bulk',
  authenticate,
  checkPermission('students', 'edit'),
  async (req, res) => {
    const parsed = sendRemindersBulkSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: req.t('common:routes.validationFailed'), details: parsed.error.errors });
    }
    const { studentIds, type, message } = parsed.data;
    const schoolId = req.user?.schoolId;

    const { sendNotification } = await import('../notifications.js');
    const notifType = REMINDER_NOTIFICATION_TYPE[type] || 'payment';
    let succeeded = 0;
    let failed = 0;

    for (const studentId of studentIds) {
      try {
        const student = await Student.findOne(scopeBySchool(schoolId, { _id: studentId }));
        if (!student) {
          failed++;
          continue;
        }

        const parents = await Parent.find({ 'children.studentId': studentId }).select('_id');
        if (parents.length === 0) {
          failed++;
          continue;
        }

        const title =
          type === 'fee' ? `Fee Reminder: ${student.name}` : `Attendance Reminder: ${student.name}`;
        const body =
          message ||
          (type === 'fee'
            ? `This is a reminder regarding pending fees for ${student.name}.`
            : `This is a reminder regarding attendance for ${student.name}.`);

        for (const parent of parents) {
          try {
            await sendNotification(parent._id, 'Parent', notifType, title, body, {
              relatedId: student._id,
              relatedType: 'Student',
              priority: 'normal',
            });
          } catch (notifError) {
            logger.error('Error sending bulk reminder notification to parent:', notifError);
          }
        }
        succeeded++;
      } catch (err) {
        logger.error('Error processing bulk reminder for student:', studentId, err);
        failed++;
      }
    }

    res.json({ succeeded, failed });
  }
);

// GET /:id/fee-invoice — return fee invoice data for a specific student
router.get('/:id/fee-invoice', authenticate, checkPermission('fees', 'view'), async (req, res) => {
  try {
    const student = await Student.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
    )
      .populate('classId', 'name section')
      .lean();

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const year = await resolveAcademicYear(req.query.academicYear, req.user?.schoolId);

    const feeStructure = await StudentFeeStructure.findOne(
      scopeBySchool(req.user?.schoolId, { studentId: req.params.id, academicYear: year })
    )
      .populate('feeHeads.feeHeadId')
      .lean();

    // Fetch payment history for this student and academic year
    const payments = await FeePayment.find(
      scopeBySchool(req.user?.schoolId, {
        studentId: req.params.id,
        academicYear: year,
        status: { $ne: 'cancelled' },
      })
    )
      .sort({ paymentDate: -1 })
      .lean();

    // Fetch school info for the invoice header
    const school = await School.findById(req.user?.schoolId)
      .select('name code contactEmail contactPhone')
      .lean();

    const invoiceDate = new Date().toISOString();
    const invoiceNumber = `INV-${student.admissionId || req.params.id.toString().slice(-6).toUpperCase()}-${year.replace('-', '')}`;

    res.json({
      invoice: {
        invoiceNumber,
        invoiceDate,
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
        classId: student.classId?._id,
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
              frequency: fh.frequency || 'annual',
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
    });
  } catch (error) {
    logger.error('Error generating fee invoice:', error);
    res.status(500).json({ error: 'Failed to generate fee invoice' });
  }
});

export default router;
