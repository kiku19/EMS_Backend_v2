import StudentFeeStructure from '../models/StudentFeeStructure.js';
import FeeStructure from '../models/FeeStructure.js';
import Parent from '../models/Parent.js';
import { Student } from '../database.js';
import { emitFeeDueReminder, emitFeeOverdueReminder } from '../utils/socketEmitter.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('FeeReminder');

const DUE_REMINDER_DAYS_AHEAD = 7;
// Only send one reminder per student per day (per type)
const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Parse a dueDate string (e.g. "2026-03-25" or "25/03/2026") into a Date.
 * Returns null if unparseable.
 */
function parseDueDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Send push + in-app notification to all parents linked to a student.
 * @param {Object} student - populated student doc { _id, name, schoolId }
 * @param {string} title
 * @param {string} body
 * @param {Object} pushData
 */
async function notifyParents(student, title, body, feeData) {
  try {
    const { sendNotification } = await import('../routes/notifications.js');
    const { sendFeeReminderWhatsApp } = await import('./whatsappService.js');

    const parents = await Parent.find({
      'children.studentId': student._id,
      schoolId: student.schoolId,
    }).select('_id phone preferences');

    for (const parent of parents) {
      // In-app notification (also sends push internally via sendNotification)
      await sendNotification(parent._id, 'Parent', 'fee', title, body, {
        actionUrl: '/fees',
        actionType: 'navigate',
        relatedType: 'fee',
      }).catch((err) => logger.warn({ err, parentId: parent._id }, 'sendNotification failed'));

      // WhatsApp notification for opted-in parents
      if (parent.preferences?.whatsappOptIn && parent.phone && feeData) {
        sendFeeReminderWhatsApp(parent.phone, feeData).catch((err) =>
          logger.warn({ err, parentId: parent._id }, 'WhatsApp fee reminder failed')
        );
      }
    }
  } catch (err) {
    logger.error({ err, studentId: student._id }, 'notifyParents error');
  }
}

/**
 * Process "fee due soon" reminders.
 * Finds FeeStructure installments due within DUE_REMINDER_DAYS_AHEAD days,
 * then notifies students with unpaid balances in those classes.
 */
async function processDueReminders() {
  const now = new Date();
  const cutoffDate = new Date(now.getTime() + DUE_REMINDER_DAYS_AHEAD * 24 * 60 * 60 * 1000);
  const cooldownCutoff = new Date(now.getTime() - REMINDER_COOLDOWN_MS);

  // Find fee structures that have an upcoming installment
  const feeStructures = await FeeStructure.find({
    'collectionSchedule.installments': {
      $elemMatch: { status: { $in: ['pending', 'partial'] } },
    },
  }).lean();

  for (const fs of feeStructures) {
    const upcomingInstallment = fs.collectionSchedule?.installments?.find((inst) => {
      if (!['pending', 'partial'].includes(inst.status)) return false;
      const d = parseDueDate(inst.dueDate);
      return d && d >= now && d <= cutoffDate;
    });

    if (!upcomingInstallment) continue;

    // Find students in this class with outstanding balances, not yet reminded today
    const studentFeeRecords = await StudentFeeStructure.find({
      classId: fs.classId,
      schoolId: fs.schoolId,
      academicYear: fs.academicYear,
      overallStatus: { $in: ['pending', 'partial'] },
      totalBalance: { $gt: 0 },
      $or: [
        { lastDueReminderSentAt: { $exists: false } },
        { lastDueReminderSentAt: null },
        { lastDueReminderSentAt: { $lte: cooldownCutoff } },
      ],
    }).populate('studentId', 'name schoolId');

    for (const record of studentFeeRecords) {
      const student = record.studentId;
      if (!student) continue;

      const title = 'Fee Payment Reminder';
      const body = `Fee installment "${upcomingInstallment.name || 'upcoming'}" of ₹${record.totalBalance} is due on ${upcomingInstallment.dueDate}.`;

      // Emit socket event
      emitFeeDueReminder(student._id, student.name, {
        dueDate: upcomingInstallment.dueDate,
        installmentName: upcomingInstallment.name,
        balanceAmount: record.totalBalance,
      });

      // Send push + in-app + WhatsApp to parents
      await notifyParents(
        { _id: student._id, name: student.name, schoolId: record.schoolId },
        title,
        body,
        {
          studentName: student.name,
          feeType: upcomingInstallment.name || 'Upcoming Installment',
          amount: record.totalBalance,
          dueDate: upcomingInstallment.dueDate,
        }
      );

      // Update tracking to prevent duplicate within cooldown window
      await StudentFeeStructure.updateOne(
        { _id: record._id },
        { $set: { lastDueReminderSentAt: now } }
      );
    }
  }
}

/**
 * Process "fee overdue" reminders.
 * Finds FeeStructure installments whose dueDate has passed but are still unpaid.
 */
async function processOverdueReminders() {
  const now = new Date();
  const cooldownCutoff = new Date(now.getTime() - REMINDER_COOLDOWN_MS);

  const feeStructures = await FeeStructure.find({
    'collectionSchedule.installments': {
      $elemMatch: { status: { $in: ['pending', 'partial', 'overdue'] } },
    },
  }).lean();

  for (const fs of feeStructures) {
    const overdueInstallment = fs.collectionSchedule?.installments?.find((inst) => {
      if (!['pending', 'partial', 'overdue'].includes(inst.status)) return false;
      const d = parseDueDate(inst.dueDate);
      return d && d < now;
    });

    if (!overdueInstallment) continue;

    const studentFeeRecords = await StudentFeeStructure.find({
      classId: fs.classId,
      schoolId: fs.schoolId,
      academicYear: fs.academicYear,
      overallStatus: { $in: ['pending', 'partial'] },
      totalBalance: { $gt: 0 },
      $or: [
        { lastOverdueReminderSentAt: { $exists: false } },
        { lastOverdueReminderSentAt: null },
        { lastOverdueReminderSentAt: { $lte: cooldownCutoff } },
      ],
    }).populate('studentId', 'name schoolId');

    for (const record of studentFeeRecords) {
      const student = record.studentId;
      if (!student) continue;

      const title = 'Fee Overdue';
      const body = `Fee installment "${overdueInstallment.name || 'previous'}" of ₹${record.totalBalance} was due on ${overdueInstallment.dueDate} and is overdue.`;

      // Emit socket event
      emitFeeOverdueReminder(student._id, student.name, {
        overdueDate: overdueInstallment.dueDate,
        installmentName: overdueInstallment.name,
        balanceAmount: record.totalBalance,
      });

      // Send push + in-app + WhatsApp to parents
      await notifyParents(
        { _id: student._id, name: student.name, schoolId: record.schoolId },
        title,
        body,
        {
          studentName: student.name,
          feeType: overdueInstallment.name || 'Overdue Installment',
          amount: record.totalBalance,
          dueDate: overdueInstallment.dueDate,
        }
      );

      await StudentFeeStructure.updateOne(
        { _id: record._id },
        { $set: { lastOverdueReminderSentAt: now } }
      );
    }
  }
}

/**
 * Main entry point — runs both due and overdue reminder passes.
 * Called by the Agenda job daily.
 */
export async function processFeeReminders() {
  logger.info('Processing fee due/overdue reminders');
  try {
    await processDueReminders();
    await processOverdueReminders();
    logger.info('Fee reminders processed');
  } catch (err) {
    logger.error({ err }, 'Fee reminder processing error');
  }
}
