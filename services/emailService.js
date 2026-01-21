import { sendEmail, sendBulkEmails } from '../config/email.js';

/**
 * Send welcome email to new user
 * @param {Object} user - User object
 * @param {string} tempPassword - Temporary password (if applicable)
 */
export const sendWelcomeEmail = async (user, tempPassword = null) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4a90e2; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9f9f9; }
        .button { display: inline-block; padding: 12px 24px; background: #4a90e2; color: white; text-decoration: none; border-radius: 5px; margin: 10px 0; }
        .footer { padding: 20px; text-align: center; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Welcome to ${process.env.SCHOOL_NAME || 'School Management System'}</h1>
        </div>
        <div class="content">
          <p>Dear ${user.name},</p>
          <p>Your account has been created successfully.</p>
          ${tempPassword ? `<p><strong>Login Credentials:</strong></p>
          <p>Email: ${user.email || user.phone}<br>
          Password: ${tempPassword}</p>` : ''}
          <p>Please log in to your account to get started.</p>
          <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/login" class="button">Login Now</a>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} ${process.env.SCHOOL_NAME || 'School Management System'}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: user.email || user.phone,
    subject: 'Welcome to School Management System',
    html
  });
};

/**
 * Send announcement email
 * @param {Object} announcement - Announcement object
 * @param {Object} recipient - Recipient object
 */
export const sendAnnouncementEmail = async (announcement, recipient) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4a90e2; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9f9f9; }
        .announcement { background: white; padding: 15px; border-left: 4px solid #4a90e2; margin: 10px 0; }
        .footer { padding: 20px; text-align: center; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📢 ${announcement.title}</h1>
        </div>
        <div class="content">
          <p>Dear ${recipient.name},</p>
          <div class="announcement">
            <p>${announcement.content.replace(/\n/g, '<br>')}</p>
          </div>
          ${announcement.attachments && announcement.attachments.length > 0 ? `
            <p><strong>Attachments:</strong></p>
            <ul>
              ${announcement.attachments.map(att => `<li><a href="${att.url}">${att.name}</a></li>`).join('')}
            </ul>
          ` : ''}
          <p>Thank you,<br>${process.env.SCHOOL_NAME || 'School Administration'}</p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} ${process.env.SCHOOL_NAME || 'School Management System'}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: recipient.email,
    subject: `📢 ${announcement.title}`,
    html
  });
};

/**
 * Send reminder email
 * @param {Object} reminder - Reminder object
 * @param {Object} recipient - Recipient object
 * @param {Object} data - Dynamic data for template variables
 */
export const sendReminderEmail = async (reminder, recipient, data = {}) => {
  let message = reminder.message;

  // Replace template variables
  Object.keys(data).forEach(key => {
    message = message.replace(new RegExp(`{${key}}`, 'g'), data[key]);
  });

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #f39c12; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9f9f9; }
        .reminder { background: white; padding: 15px; border-left: 4px solid #f39c12; margin: 10px 0; }
        .footer { padding: 20px; text-align: center; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>⏰ ${reminder.title}</h1>
        </div>
        <div class="content">
          <p>Dear ${recipient.name},</p>
          <div class="reminder">
            <p>${message.replace(/\n/g, '<br>')}</p>
          </div>
          <p>Please take necessary action.</p>
          <p>Thank you,<br>${process.env.SCHOOL_NAME || 'School Administration'}</p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} ${process.env.SCHOOL_NAME || 'School Management System'}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: recipient.email,
    subject: `⏰ ${reminder.title}`,
    html
  });
};

/**
 * Send fee payment reminder email
 * @param {Object} student - Student object
 * @param {Object} feeData - Fee details
 */
export const sendFeeReminderEmail = async (student, feeData) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #e74c3c; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9f9f9; }
        .fee-details { background: white; padding: 15px; border-left: 4px solid #e74c3c; margin: 10px 0; }
        .button { display: inline-block; padding: 12px 24px; background: #e74c3c; color: white; text-decoration: none; border-radius: 5px; margin: 10px 0; }
        .footer { padding: 20px; text-align: center; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>💰 Fee Payment Reminder</h1>
        </div>
        <div class="content">
          <p>Dear Parent/Guardian,</p>
          <p>This is a reminder that the fee payment for <strong>${student.name}</strong> is due.</p>
          <div class="fee-details">
            <p><strong>Fee Type:</strong> ${feeData.feeType}</p>
            <p><strong>Amount:</strong> ₹${feeData.amount}</p>
            <p><strong>Due Date:</strong> ${new Date(feeData.dueDate).toLocaleDateString()}</p>
          </div>
          <p>Please ensure timely payment to avoid late fees.</p>
          <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/fees" class="button">Pay Now</a>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} ${process.env.SCHOOL_NAME || 'School Management System'}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  // Send to parent's email
  return await sendEmail({
    to: student.parent?.email || student.email,
    subject: `💰 Fee Payment Reminder - ${student.name}`,
    html
  });
};

/**
 * Send attendance alert email
 * @param {Object} student - Student object
 * @param {Object} attendanceData - Attendance details
 */
export const sendAttendanceAlertEmail = async (student, attendanceData) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: ${attendanceData.isPresent ? '#27ae60' : '#e74c3c'}; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9f9f9; }
        .details { background: white; padding: 15px; border-left: 4px solid ${attendanceData.isPresent ? '#27ae60' : '#e74c3c'}; margin: 10px 0; }
        .footer { padding: 20px; text-align: center; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>${attendanceData.isPresent ? '✅' : '❌'} Attendance Alert</h1>
        </div>
        <div class="content">
          <p>Dear Parent/Guardian,</p>
          <p>We would like to inform you about the attendance of <strong>${student.name}</strong>.</p>
          <div class="details">
            <p><strong>Date:</strong> ${new Date(attendanceData.date).toLocaleDateString()}</p>
            <p><strong>Status:</strong> ${attendanceData.isPresent ? 'Present' : 'Absent'}</p>
            ${!attendanceData.isPresent && attendanceData.reason ? `<p><strong>Reason:</strong> ${attendanceData.reason}</p>` : ''}
          </div>
          ${!attendanceData.isPresent ? '<p>Please contact the school administration if you have any questions.</p>' : ''}
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} ${process.env.SCHOOL_NAME || 'School Management System'}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: student.parent?.email || student.email,
    subject: `${attendanceData.isPresent ? '✅' : '❌'} Attendance Alert - ${student.name}`,
    html
  });
};

export { sendEmail, sendBulkEmails };
