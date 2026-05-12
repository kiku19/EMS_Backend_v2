import Reminder from '../models/Reminder.js';
import ReminderLog from '../models/ReminderLog.js';
import ReminderTemplate from '../models/ReminderTemplate.js';
import { FeePayment, Attendance, Staff, Student, Class } from '../database.js';
import Parent from '../models/Parent.js';
import { sendReminderEmail } from './emailService.js';
import { sendFeeReminderSMS, sendAttendanceAlertSMS, sendAnnouncementSMS } from './smsService.js';
import { sendFeeReminderWhatsApp, sendAttendanceAlertWhatsApp } from './whatsappService.js';
import { sendNotification } from '../routes/notifications.js';
import NotificationPreference from '../models/NotificationPreference.js';
import { createLogger } from '../utils/logger.js';

// Map reminder.type to NotificationPreference category for channel pref lookup.
const REMINDER_CATEGORY_MAP = {
  fee: 'payment',
  attendance: 'attendance',
  academic: 'academic',
  event: 'event',
  emergency: 'emergency',
};

// Returns { email, sms, whatsapp, inapp } honoring user prefs.
// If the user has no preference doc, defaults to allowing all channels so
// behavior matches the historical broadcast.
async function getChannelPrefsForRecipient(recipient, reminder) {
  try {
    const pref = await NotificationPreference.findOne({
      userId: recipient.userId,
      userModel: recipient.userType,
    });
    if (!pref) return { email: true, sms: true, whatsapp: true, inapp: true, quiet: false };
    const category = REMINDER_CATEGORY_MAP[reminder.type] || 'announcement';
    const channels = pref.getChannelPreferences(category, reminder.type);
    const quiet = pref.isQuietHours();
    return { ...channels, quiet };
  } catch {
    return { email: true, sms: true, whatsapp: true, inapp: true, quiet: false };
  }
}

const logger = createLogger('ReminderProcessor');

// Helper function to resolve reminder recipients
async function resolveReminderRecipients(recipients) {
  const recipientList = [];

  for (const recipient of recipients) {
    if (recipient.type === 'all' || recipient.type === 'staff') {
      const staff = await Staff.find({ isActive: true });
      staff.forEach((s) =>
        recipientList.push({
          userId: s._id,
          userType: 'Staff',
          name: s.name,
          email: s.email,
          phone: s.phone,
        })
      );
    }

    if (recipient.type === 'all' || recipient.type === 'students') {
      if (recipient.classIds && recipient.classIds.length > 0) {
        const classes = await Class.find({ _id: { $in: recipient.classIds } }).populate('students');
        for (const cls of classes) {
          cls.students.forEach((student) => {
            recipientList.push({
              userId: student._id,
              userType: 'Student',
              name: student.name,
              email: student.email,
              phone: student.phone,
            });
          });
        }
      } else {
        const students = await Student.find({ isActive: true });
        students.forEach((s) =>
          recipientList.push({
            userId: s._id,
            userType: 'Student',
            name: s.name,
            email: s.email,
            phone: s.phone,
          })
        );
      }
    }

    if (recipient.type === 'parents') {
      const students = await Student.find({ isActive: true }).populate('parent');
      students.forEach((s) => {
        if (s.parent && s.parent.email) {
          recipientList.push({
            userId: s._id,
            userType: 'Parent',
            name: s.parent.name || s.name + "'s Parent",
            email: s.parent.email,
            phone: s.parent.phone,
            studentName: s.name,
          });
        }
      });
    }

    if (recipient.type === 'custom' && recipient.userIds) {
      for (const userId of recipient.userIds) {
        const staff = await Staff.findById(userId);
        if (staff) {
          recipientList.push({
            userId: staff._id,
            userType: 'Staff',
            name: staff.name,
            email: staff.email,
            phone: staff.phone,
          });
        } else {
          const student = await Student.findById(userId);
          if (student) {
            recipientList.push({
              userId: student._id,
              userType: 'Student',
              name: student.name,
              email: student.email,
              phone: student.phone,
            });
          }
        }
      }
    }
  }

  // Remove duplicates
  const uniqueRecipients = [];
  const seen = new Set();
  for (const r of recipientList) {
    const key = `${r.userId}-${r.userType}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueRecipients.push(r);
    }
  }

  return uniqueRecipients;
}

// Function to check and process reminder triggers
export async function checkReminderTriggers() {
  try {
    // Get all active reminders
    const activeReminders = await Reminder.find({ isActive: true });

    for (const reminder of activeReminders) {
      // Check if it's time to execute
      const now = new Date();
      if (reminder.nextExecutionAt && reminder.nextExecutionAt > now) {
        continue; // Not time yet
      }

      // Process based on type
      let matchedRecipients = [];

      if (reminder.type === 'fee') {
        matchedRecipients = await processFeeReminder(reminder);
      } else if (reminder.type === 'attendance') {
        matchedRecipients = await processAttendanceReminder(reminder);
      } else if (reminder.type === 'academic') {
        matchedRecipients = await processAcademicReminder(reminder);
      } else if (reminder.type === 'events') {
        matchedRecipients = await processEventReminder(reminder);
      } else if (reminder.type === 'custom') {
        // For custom reminders, use all configured recipients
        const recipients = await resolveReminderRecipients(reminder.recipients);
        matchedRecipients = recipients;
      }

      // Send reminders to matched recipients
      if (matchedRecipients.length > 0) {
        await sendReminderMessages(reminder, matchedRecipients);

        // For fee reminders, also push to parents of the affected students
        if (reminder.type === 'fee') {
          const studentIds = matchedRecipients
            .filter((r) => r.userType === 'Student')
            .map((r) => r.userId);

          if (studentIds.length > 0) {
            try {
              const { default: pushService } = await import('./pushNotificationService.js');
              const parents = await Parent.find({
                'children.studentId': { $in: studentIds },
              }).select('_id fcmTokens');

              for (const parent of parents) {
                if (parent.fcmTokens?.length > 0) {
                  pushService
                    .sendToParent(parent._id.toString(), reminder.title, reminder.message, {
                      type: 'payment',
                      actionUrl: '/fees',
                    })
                    .catch((err) =>
                      logger.warn({ err, parentId: parent._id }, 'Fee reminder parent push failed')
                    );
                }
              }
            } catch (pushErr) {
              logger.warn({ err: pushErr }, 'Fee reminder parent push error');
            }
          }
        }
      }

      // Update next execution time
      await reminder.markExecuted();
    }
  } catch (error) {
    logger.error({ err: error }, 'Error checking reminder triggers');
  }
}

// Process fee reminders
async function processFeeReminder(reminder) {
  const matchedRecipients = [];
  const now = new Date();

  for (const trigger of reminder.triggers) {
    if (trigger.condition === 'days_before_due') {
      // Find fees due in X days
      const dueDate = new Date(now);
      dueDate.setDate(dueDate.getDate() + trigger.value);

      const feePayments = await FeePayment.find({
        dueDate: {
          $gte: new Date(dueDate.setHours(0, 0, 0, 0)),
          $lt: new Date(dueDate.setHours(23, 59, 59, 999)),
        },
        status: { $in: ['pending', 'partial'] },
      }).populate('studentId');

      for (const fee of feePayments) {
        if (fee.studentId) {
          matchedRecipients.push({
            userId: fee.studentId._id,
            userType: 'Student',
            name: fee.studentId.name,
            email: fee.studentId.email,
            phone: fee.studentId.phone,
            triggerData: {
              feeType: fee.feeType,
              amount: fee.amount,
              dueDate: fee.dueDate,
            },
          });
        }
      }
    } else if (trigger.condition === 'days_after_overdue') {
      // Find fees overdue by X days
      const overdueDate = new Date(now);
      overdueDate.setDate(overdueDate.getDate() - trigger.value);

      const feePayments = await FeePayment.find({
        dueDate: { $lte: overdueDate },
        status: { $in: ['pending', 'partial'] },
      }).populate('studentId');

      for (const fee of feePayments) {
        if (fee.studentId) {
          matchedRecipients.push({
            userId: fee.studentId._id,
            userType: 'Student',
            name: fee.studentId.name,
            email: fee.studentId.email,
            phone: fee.studentId.phone,
            triggerData: {
              feeType: fee.feeType,
              amount: fee.amount,
              dueDate: fee.dueDate,
              overdueDays: trigger.value,
            },
          });
        }
      }
    }
  }

  return matchedRecipients;
}

// Process attendance reminders
async function processAttendanceReminder(reminder) {
  const matchedRecipients = [];

  for (const trigger of reminder.triggers) {
    if (
      trigger.condition === 'absent_without_notice' ||
      trigger.condition === 'absent_with_notice'
    ) {
      // Check today's attendance
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const attendanceRecords = await Attendance.find({
        date: today,
        status: 'absent',
      }).populate('studentId');

      for (const record of attendanceRecords) {
        if (record.studentId) {
          matchedRecipients.push({
            userId: record.studentId._id,
            userType: 'Student',
            name: record.studentId.name,
            email: record.studentId.email,
            phone: record.studentId.phone,
            parentEmail: record.studentId.parent?.email,
            parentPhone: record.studentId.parent?.phone,
            triggerData: {
              date: record.date,
              status: record.status,
              reason: record.reason,
            },
          });
        }
      }
    } else if (trigger.condition === 'attendance_below') {
      // Find students with attendance below threshold
      const students = await Student.find({ isActive: true });

      for (const student of students) {
        const attendanceRecords = await Attendance.find({
          studentId: student._id,
          status: { $in: ['present', 'late'] },
        });

        const totalDays = await Attendance.countDocuments({ studentId: student._id });
        if (totalDays > 0) {
          const percentage = (attendanceRecords.length / totalDays) * 100;

          if (percentage < trigger.value) {
            matchedRecipients.push({
              userId: student._id,
              userType: 'Student',
              name: student.name,
              email: student.email,
              phone: student.phone,
              triggerData: {
                attendancePercentage: percentage.toFixed(2),
                threshold: trigger.value,
              },
            });
          }
        }
      }
    }
  }

  return matchedRecipients;
}

// Process academic reminders
async function processAcademicReminder(reminder) {
  // TODO: Implement based on homework, exams, etc.
  return [];
}

// Process event reminders
async function processEventReminder(reminder) {
  // TODO: Implement based on events (PTM, Sports Day, etc.)
  return [];
}

// Send reminder messages to recipients
async function sendReminderMessages(reminder, recipients) {
  for (const recipient of recipients) {
    try {
      // Replace template variables
      let message = reminder.message;
      const data = { ...recipient.triggerData };

      Object.keys(data).forEach((key) => {
        message = message.replace(new RegExp(`{${key}}`, 'g'), data[key]);
      });

      // Create log
      const log = await ReminderLog.create({
        reminderId: reminder._id,
        recipientId: recipient.userId,
        recipientType: recipient.userType,
        triggerData: recipient.triggerData,
      });

      // Honor per-user notification preferences and quiet hours (priority < urgent
      // gets quiet-hours suppression for email/SMS/WhatsApp; inapp still delivers).
      const prefs = await getChannelPrefsForRecipient(recipient, reminder);
      const allowChannel = (ch) => {
        if (ch === 'inapp') return prefs.inapp !== false;
        if (prefs.quiet && reminder.priority !== 'urgent') return false;
        return prefs[ch] !== false;
      };

      // Send via configured channels
      for (const channel of reminder.channels) {
        if (channel === 'email' && recipient.email) {
          if (!allowChannel('email')) continue;
          await sendReminderEmail(reminder, recipient, data);
          log.channels.push({ channel: 'email', status: 'sent', sentAt: new Date() });
        } else if (channel === 'sms' && recipient.phone) {
          if (!allowChannel('sms')) continue;
          if (reminder.type === 'fee') {
            await sendFeeReminderSMS(recipient.phone, recipient.triggerData);
          } else if (reminder.type === 'attendance') {
            await sendAttendanceAlertSMS(recipient.phone, recipient.triggerData);
          } else {
            await sendAnnouncementSMS(recipient.phone, reminder.title, message);
          }
          log.channels.push({ channel: 'sms', status: 'sent', sentAt: new Date() });
        } else if (channel === 'whatsapp' && recipient.phone) {
          if (!allowChannel('whatsapp')) continue;
          if (reminder.type === 'fee') {
            await sendFeeReminderWhatsApp(recipient.phone, recipient.triggerData);
          } else if (reminder.type === 'attendance') {
            await sendAttendanceAlertWhatsApp(recipient.phone, recipient.triggerData);
          }
          log.channels.push({ channel: 'whatsapp', status: 'sent', sentAt: new Date() });
        } else if (channel === 'inapp') {
          await sendNotification(
            recipient.userId,
            recipient.userType,
            reminder.type,
            reminder.title,
            message,
            { actionUrl: '/reminders', actionType: 'navigate' }
          );
          log.channels.push({ channel: 'inapp', status: 'sent', sentAt: new Date() });
        }
      }

      log.status = 'sent';
      await log.save();

      // Update reminder stats
      reminder.stats.totalSent++;
    } catch (error) {
      logger.error(
        { err: error, recipientName: recipient.name, reminderId: reminder._id },
        'Error sending reminder to recipient'
      );
      reminder.stats.totalFailed++;
    }
  }

  await reminder.save();
}

export default { checkReminderTriggers, processFeeReminder, processAttendanceReminder };
