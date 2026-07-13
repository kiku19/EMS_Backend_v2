import StudentFeeStructure from '../models/StudentFeeStructure.js';
import FeeStructure from '../models/FeeStructure.js';
import FeeReminderConfig, { DEFAULT_FEE_REMINDER_CONFIG } from '../models/FeeReminderConfig.js';
import Parent from '../models/Parent.js';
import { Student } from '../database.js';
import { emitFeeDueReminder, emitFeeOverdueReminder } from '../utils/socketEmitter.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('FeeReminder');

// Fallbacks used when no FeeReminderConfig document exists yet. These preserve
// the original (hardcoded) behaviour so existing deployments stay back-compat.
const FALLBACK_DUE_REMINDER_DAYS_AHEAD = 7;
const FALLBACK_REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Load a school's reminder config, merged over the defaults. Returns the
 * canonical default config when no document has been persisted yet.
 */
async function loadConfig(schoolId, academicYear) {
  if (!schoolId) return { ...DEFAULT_FEE_REMINDER_CONFIG };
  const doc = await FeeReminderConfig.findOne({ schoolId, academicYear })
    .lean()
    .catch(() => null);
  if (!doc) return { ...DEFAULT_FEE_REMINDER_CONFIG };
  return {
    ...DEFAULT_FEE_REMINDER_CONFIG,
    ...doc,
    dueReminder: { ...DEFAULT_FEE_REMINDER_CONFIG.dueReminder, ...(doc.dueReminder || {}) },
    overdueReminder: {
      ...DEFAULT_FEE_REMINDER_CONFIG.overdueReminder,
      ...(doc.overdueReminder || {}),
    },
    channels: { ...DEFAULT_FEE_REMINDER_CONFIG.channels, ...(doc.channels || {}) },
  };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
 * Delivery channels are gated by the school's FeeReminderConfig.
 * @param {Object} student - populated student doc { _id, name, schoolId }
 * @param {string} title
 * @param {string} body
 * @param {Object} feeData
 * @param {Object} channels - { inApp, push, whatsapp, email }
 */
async function notifyParents(
  student,
  title,
  body,
  feeData,
  channels = DEFAULT_FEE_REMINDER_CONFIG.channels
) {
  const ch = { ...DEFAULT_FEE_REMINDER_CONFIG.channels, ...channels };
  try {
    const parents = await Parent.find({
      'children.studentId': student._id,
      schoolId: student.schoolId,
    }).select('_id phone preferences');

    if (ch.inApp || ch.push) {
      const { sendNotification } = await import('../routes/notifications.js');
      for (const parent of parents) {
        // In-app notification (also sends push internally via sendNotification)
        await sendNotification(parent._id, 'Parent', 'fee', title, body, {
          actionUrl: '/fees',
          actionType: 'navigate',
          relatedType: 'fee',
        }).catch((err) => logger.warn({ err, parentId: parent._id }, 'sendNotification failed'));
      }
    }

    // WhatsApp notification for opted-in parents
    if (ch.whatsapp) {
      const { sendFeeReminderWhatsApp } = await import('./whatsappService.js');
      for (const parent of parents) {
        if (parent.preferences?.whatsappOptIn && parent.phone && feeData) {
          sendFeeReminderWhatsApp(parent.phone, feeData).catch((err) =>
            logger.warn({ err, parentId: parent._id }, 'WhatsApp fee reminder failed')
          );
        }
      }
    }

    // Email channel — left as a future wiring point; the service exists but
    // is not yet called here. Logged so admins can see intent in audit later.
    if (ch.email && feeData) {
      logger.debug({ studentId: student._id }, 'Email fee reminder queued (wiring TODO)');
    }
  } catch (err) {
    logger.error({ err, studentId: student._id }, 'notifyParents error');
  }
}

/**
 * Process "fee due soon" reminders.
 * Finds FeeStructure installments due within `config.dueReminder.daysBefore`
 * days, then notifies students with unpaid balances in those classes.
 */
async function processDueReminders() {
  const now = new Date();
  // Cache config per school+year as we walk fee structures.
  const configCache = new Map();
  const getCfg = async (schoolId, academicYear) => {
    const key = `${schoolId}|${academicYear}`;
    if (!configCache.has(key)) configCache.set(key, await loadConfig(schoolId, academicYear));
    return configCache.get(key);
  };

  // Find fee structures that have an upcoming installment
  const feeStructures = await FeeStructure.find({
    'collectionSchedule.installments': {
      $elemMatch: { status: { $in: ['pending', 'partial'] } },
    },
  }).lean();

  for (const fs of feeStructures) {
    const config = await getCfg(fs.schoolId, fs.academicYear);
    if (!config.enabled || !config.dueReminder.enabled) continue;

    const daysAhead = config.dueReminder.daysBefore ?? FALLBACK_DUE_REMINDER_DAYS_AHEAD;
    const cooldownMs = (config.cooldownHours ?? 24) * 60 * 60 * 1000;
    const cutoffDate = new Date(now.getTime() + daysAhead * MS_PER_DAY);
    const cooldownCutoff = new Date(now.getTime() - cooldownMs);

    const upcomingInstallment = fs.collectionSchedule?.installments?.find((inst) => {
      if (!['pending', 'partial'].includes(inst.status)) return false;
      const d = parseDueDate(inst.dueDate);
      return d && d >= now && d <= cutoffDate;
    });

    if (!upcomingInstallment) continue;

    // Find students in this class with outstanding balances, not yet reminded within cooldown
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

      // Send push + in-app + WhatsApp to parents (channels gated by config)
      await notifyParents(
        { _id: student._id, name: student.name, schoolId: record.schoolId },
        title,
        body,
        {
          studentName: student.name,
          feeType: upcomingInstallment.name || 'Upcoming Installment',
          amount: record.totalBalance,
          dueDate: upcomingInstallment.dueDate,
        },
        config.channels
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
  const configCache = new Map();
  const getCfg = async (schoolId, academicYear) => {
    const key = `${schoolId}|${academicYear}`;
    if (!configCache.has(key)) configCache.set(key, await loadConfig(schoolId, academicYear));
    return configCache.get(key);
  };

  const feeStructures = await FeeStructure.find({
    'collectionSchedule.installments': {
      $elemMatch: { status: { $in: ['pending', 'partial', 'overdue'] } },
    },
  }).lean();

  for (const fs of feeStructures) {
    const config = await getCfg(fs.schoolId, fs.academicYear);
    if (!config.enabled || !config.overdueReminder.enabled) continue;

    const cooldownMs = (config.cooldownHours ?? 24) * 60 * 60 * 1000;
    const cooldownCutoff = new Date(now.getTime() - cooldownMs);

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

      // Respect maxReminders: skip if already reminded too many times.
      if (config.overdueReminder.maxReminders > 0) {
        const sentCount = record.overdueReminderCount || 0;
        if (sentCount >= config.overdueReminder.maxReminders) continue;
      }

      const title = 'Fee Overdue';
      const body = `Fee installment "${overdueInstallment.name || 'previous'}" of ₹${record.totalBalance} was due on ${overdueInstallment.dueDate} and is overdue.`;

      // Emit socket event
      emitFeeOverdueReminder(student._id, student.name, {
        overdueDate: overdueInstallment.dueDate,
        installmentName: overdueInstallment.name,
        balanceAmount: record.totalBalance,
      });

      // Send push + in-app + WhatsApp to parents (channels gated by config)
      await notifyParents(
        { _id: student._id, name: student.name, schoolId: record.schoolId },
        title,
        body,
        {
          studentName: student.name,
          feeType: overdueInstallment.name || 'Overdue Installment',
          amount: record.totalBalance,
          dueDate: overdueInstallment.dueDate,
        },
        config.channels
      );

      await StudentFeeStructure.updateOne(
        { _id: record._id },
        {
          $set: { lastOverdueReminderSentAt: now },
          $inc: { overdueReminderCount: 1 },
        }
      );
    }
  }
}

/**
 * Dispatch a single manual reminder to its audience. Called by the route
 * handler after the manual reminder record has been persisted.
 *
 * @param {Object} reminder - { name, message, audience:{type,classIds}, schoolId, academicYear }
 */
export async function processManualReminder(reminder) {
  const { schoolId, academicYear, audience = {} } = reminder;
  const config = await loadConfig(schoolId, academicYear);
  const baseQuery = { schoolId, academicYear, totalBalance: { $gt: 0 } };
  if (audience.type === 'overdue') baseQuery.overallStatus = { $in: ['pending', 'partial'] };
  if (audience.type === 'unpaid') baseQuery.overallStatus = 'pending';
  if (audience.type === 'class' && Array.isArray(audience.classIds) && audience.classIds.length) {
    baseQuery.classId = { $in: audience.classIds };
  }

  const records = await StudentFeeStructure.find(baseQuery)
    .populate('studentId', 'name schoolId')
    .limit(2000);

  const title = reminder.name || 'Fee Reminder';
  const body = reminder.message || 'This is a reminder regarding your pending fee payment.';

  for (const record of records) {
    const student = record.studentId;
    if (!student) continue;
    await notifyParents(
      { _id: student._id, name: student.name, schoolId: record.schoolId },
      title,
      body,
      { studentName: student.name, amount: record.totalBalance },
      config.channels
    ).catch((err) => logger.warn({ err, studentId: student._id }, 'manual notify failed'));
  }

  logger.info(
    { recipientCount: records.length, reminder: reminder.name },
    'Manual fee reminder dispatched'
  );
  return { recipientCount: records.length };
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
