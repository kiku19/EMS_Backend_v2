import { sendSMS, sendSMSWithFlow, sendBulkSMS } from '../config/sms.js';
import { buildSmsMessage } from '../utils/i18nTemplates.js';

/**
 * Send SMS announcement
 * @param {string} to - Phone number
 * @param {string} title - Announcement title
 * @param {string} content - Announcement content
 */
export const sendAnnouncementSMS = async (to, title, content) => {
  // SMS has character limit, so truncate content if needed
  const message = `${title}\n\n${content}`.substring(0, 160);

  return await sendSMS(to, message);
};

/**
 * Send fee reminder SMS
 * @param {string} to - Phone number
 * @param {Object} feeData - Fee details (amount, dueDate)
 * @param {string} [locale='en'] - Recipient locale
 */
export const sendFeeReminderSMS = async (to, feeData, locale = 'en') => {
  const message = buildSmsMessage(
    'fee_reminder',
    {
      amount: feeData.amount,
      dueDate: new Date(feeData.dueDate).toLocaleDateString(),
    },
    locale
  );

  return await sendSMS(to, message);
};

/**
 * Send attendance alert SMS
 * @param {string} to - Phone number
 * @param {Object} attendanceData - Attendance details (isPresent, date)
 * @param {string} [locale='en'] - Recipient locale
 */
export const sendAttendanceAlertSMS = async (to, attendanceData, locale = 'en') => {
  const type = attendanceData.isPresent ? 'attendance_present' : 'attendance_absent';
  const message = buildSmsMessage(
    type,
    {
      date: new Date(attendanceData.date).toLocaleDateString(),
    },
    locale
  );

  return await sendSMS(to, message);
};

/**
 * Send OTP via SMS
 * @param {string} to - Phone number
 * @param {string} otp - One-time password
 * @param {string} [locale='en'] - Recipient locale
 */
export const sendOTPSMS = async (to, otp, locale = 'en') => {
  const message = buildSmsMessage('otp', { otp }, locale);

  return await sendSMS(to, message);
};

/**
 * Send emergency alert SMS
 * @param {string} to - Phone number
 * @param {string} alertMessage - Emergency message
 * @param {string} [locale='en'] - Recipient locale
 */
export const sendEmergencyAlertSMS = async (to, alertMessage, locale = 'en') => {
  const message = buildSmsMessage('emergency', { message: alertMessage }, locale);

  return await sendSMS(to, message);
};

export { sendSMS, sendSMSWithFlow, sendBulkSMS, isSmsConfigured } from '../config/sms.js';
