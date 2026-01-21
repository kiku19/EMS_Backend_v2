import { sendWhatsAppMessage, sendWhatsAppMedia, sendBulkWhatsApp } from '../config/whatsapp.js';

/**
 * Send announcement via WhatsApp
 * @param {string} to - Phone number
 * @param {string} templateName - WhatsApp template name
 * @param {Object} params - Template parameters
 */
export const sendAnnouncementWhatsApp = async (to, templateName, params = {}) => {
  return await sendWhatsAppMessage(to, templateName, {
    ...params,
    school_name: process.env.SCHOOL_NAME || 'School'
  });
};

/**
 * Send fee reminder via WhatsApp
 * @param {string} to - Phone number
 * @param {Object} feeData - Fee details
 */
export const sendFeeReminderWhatsApp = async (to, feeData) => {
  return await sendWhatsAppMessage(to, 'fee_reminder', {
    student_name: feeData.studentName,
    fee_type: feeData.feeType,
    amount: feeData.amount.toString(),
    due_date: new Date(feeData.dueDate).toLocaleDateString(),
    school_name: process.env.SCHOOL_NAME || 'School'
  });
};

/**
 * Send attendance alert via WhatsApp
 * @param {string} to - Phone number
 * @param {Object} attendanceData - Attendance details
 */
export const sendAttendanceAlertWhatsApp = async (to, attendanceData) => {
  const templateName = attendanceData.isPresent ? 'attendance_present' : 'attendance_absent';

  return await sendWhatsAppMessage(to, templateName, {
    student_name: attendanceData.studentName,
    date: new Date(attendanceData.date).toLocaleDateString(),
    school_name: process.env.SCHOOL_NAME || 'School'
  });
};

/**
 * Send announcement with media via WhatsApp
 * @param {string} to - Phone number
 * @param {string} templateName - Template name
 * @param {Object} params - Template parameters
 * @param {Object} media - Media object {url, type, caption}
 */
export const sendAnnouncementWhatsAppMedia = async (to, templateName, params, media) => {
  return await sendWhatsAppMedia(to, templateName, params, media);
};

export { sendWhatsAppMessage, sendWhatsAppMedia, sendBulkWhatsApp };
