import { sendSMS, sendSMSWithFlow, sendBulkSMS } from '../config/sms.js';

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
 * @param {Object} feeData - Fee details
 */
export const sendFeeReminderSMS = async (to, feeData) => {
  const message = `FEE REMINDER: Fee payment of ₹${feeData.amount} is due by ${new Date(feeData.dueDate).toLocaleDateString()}. Please pay on time to avoid late fees.`;

  return await sendSMS(to, message);
};

/**
 * Send attendance alert SMS
 * @param {string} to - Phone number
 * @param {Object} attendanceData - Attendance details
 */
export const sendAttendanceAlertSMS = async (to, attendanceData) => {
  const message = `ATTENDANCE ALERT: Your child was ${attendanceData.isPresent ? 'PRESENT' : 'ABSENT'} on ${new Date(attendanceData.date).toLocaleDateString()}. ${!attendanceData.isPresent ? 'Please contact school if you have questions.' : ''}`;

  return await sendSMS(to, message);
};

/**
 * Send OTP via SMS
 * @param {string} to - Phone number
 * @param {string} otp - One-time password
 */
export const sendOTPSMS = async (to, otp) => {
  const message = `Your verification code is: ${otp}. Valid for 5 minutes. Do not share this with anyone.`;

  return await sendSMS(to, message);
};

/**
 * Send emergency alert SMS
 * @param {string} to - Phone number
 * @param {string} alertMessage - Emergency message
 */
export const sendEmergencyAlertSMS = async (to, alertMessage) => {
  const message = `🚨 EMERGENCY ALERT: ${alertMessage}`;

  return await sendSMS(to, message);
};

export { sendSMS, sendSMSWithFlow, sendBulkSMS };
