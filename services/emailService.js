import { sendEmail, sendBulkEmails } from '../config/email.js';
import { getEmailStrings, interp } from '../utils/emailTemplates.js';

/**
 * Send welcome email to new user
 * @param {Object} user - User object
 * @param {string} tempPassword - Temporary password (if applicable)
 * @param {string} [lang='en'] - Locale code (en|hi|ta|te|kn|ur)
 */
export const sendWelcomeEmail = async (user, tempPassword = null, lang = 'en') => {
  const s = getEmailStrings(lang);
  const schoolName = process.env.SCHOOL_NAME || s.common.schoolManagement;
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
          <h1>${interp(s.welcome.header, { schoolName })}</h1>
        </div>
        <div class="content">
          <p>${interp(s.welcome.greeting, { name: user.name })}</p>
          <p>${s.welcome.accountCreated}</p>
          ${
            tempPassword
              ? `<p><strong>${s.welcome.loginCredentials}</strong></p>
          <p>${s.welcome.emailLabel}: ${user.email || user.phone}<br>
          ${s.welcome.passwordLabel}: ${tempPassword}</p>`
              : ''
          }
          <p>${s.welcome.getStarted}</p>
          <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/login" class="button">${s.welcome.loginButton}</a>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} ${schoolName}. ${s.common.rights}</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: user.email || user.phone,
    subject: s.welcome.subject,
    html,
  });
};

/**
 * Build announcement email HTML (reusable for preview and sending)
 * @param {Object} announcement - Announcement object { title, content, attachments }
 * @param {string} recipientName - Display name for the greeting
 * @param {string} [lang='en'] - Locale code (en|hi|ta|te|kn|ur)
 * @returns {{ html: string, subject: string }}
 */
export const buildAnnouncementEmailHtml = (
  announcement,
  recipientName = 'Recipient',
  lang = 'en',
  trackingToken = null
) => {
  const s = getEmailStrings(lang);
  const schoolName = process.env.SCHOOL_NAME || s.common.schoolAdministration;
  const baseUrl = process.env.BACKEND_URL || process.env.API_BASE_URL || '';

  // 1x1 transparent GIF tracking pixel
  const pixelHtml =
    trackingToken && baseUrl
      ? `<img src="${baseUrl}/api/v1/tracking/pixel/${trackingToken}" width="1" height="1" style="display:none;border:0" alt="" />`
      : '';

  // Rewrite attachment URLs through click tracker
  const rewriteUrl = (url) => {
    if (!trackingToken || !baseUrl || !url) return url;
    return `${baseUrl}/api/v1/tracking/click/${trackingToken}?url=${encodeURIComponent(url)}`;
  };

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
          <p>${interp(s.announcement.greeting, { name: recipientName })}</p>
          <div class="announcement">
            <p>${announcement.content.replace(/\n/g, '<br>')}</p>
          </div>
          ${
            announcement.attachments && announcement.attachments.length > 0
              ? `
            <p><strong>${s.announcement.attachments}</strong></p>
            <ul>
              ${announcement.attachments.map((att) => `<li><a href="${rewriteUrl(att.url)}">${att.name}</a></li>`).join('')}
            </ul>
          `
              : ''
          }
          <p>${s.announcement.thankYou}<br>${schoolName}</p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} ${process.env.SCHOOL_NAME || s.common.schoolManagement}. ${s.common.rights}</p>
        </div>
      </div>
      ${pixelHtml}
    </body>
    </html>
  `;
  return { html, subject: `📢 ${announcement.title}` };
};

/**
 * Send announcement email
 * @param {Object} announcement - Announcement object
 * @param {Object} recipient - Recipient object
 * @param {string} [lang='en'] - Locale code (en|hi|ta|te|kn|ur)
 */
export const sendAnnouncementEmail = async (
  announcement,
  recipient,
  lang = 'en',
  trackingToken = null
) => {
  const { html, subject } = buildAnnouncementEmailHtml(
    announcement,
    recipient.name,
    lang,
    trackingToken
  );
  return await sendEmail({ to: recipient.email, subject, html });
};

/**
 * Send reminder email
 * @param {Object} reminder - Reminder object
 * @param {Object} recipient - Recipient object
 * @param {Object} data - Dynamic data for template variables
 * @param {string} [lang='en'] - Locale code (en|hi|ta|te|kn|ur)
 */
export const sendReminderEmail = async (reminder, recipient, data = {}, lang = 'en') => {
  const s = getEmailStrings(lang);
  const schoolName = process.env.SCHOOL_NAME || s.common.schoolAdministration;
  let message = reminder.message;

  // Replace template variables
  Object.keys(data).forEach((key) => {
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
          <p>${interp(s.reminder.greeting, { name: recipient.name })}</p>
          <div class="reminder">
            <p>${message.replace(/\n/g, '<br>')}</p>
          </div>
          <p>${s.reminder.takeAction}</p>
          <p>${s.reminder.thankYou}<br>${schoolName}</p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} ${process.env.SCHOOL_NAME || s.common.schoolManagement}. ${s.common.rights}</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: recipient.email,
    subject: `⏰ ${reminder.title}`,
    html,
  });
};

/**
 * Send fee payment reminder email
 * @param {Object} student - Student object
 * @param {Object} feeData - Fee details
 * @param {string} [lang='en'] - Locale code (en|hi|ta|te|kn|ur)
 */
export const sendFeeReminderEmail = async (student, feeData, lang = 'en') => {
  const s = getEmailStrings(lang);
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
          <h1>${s.feeReminder.header}</h1>
        </div>
        <div class="content">
          <p>${s.feeReminder.greeting}</p>
          <p>${s.feeReminder.reminderBefore} <strong>${student.name}</strong> ${s.feeReminder.reminderAfter}</p>
          <div class="fee-details">
            <p><strong>${s.feeReminder.feeType}</strong> ${feeData.feeType}</p>
            <p><strong>${s.feeReminder.amount}</strong> ₹${feeData.amount}</p>
            <p><strong>${s.feeReminder.dueDate}</strong> ${new Date(feeData.dueDate).toLocaleDateString()}</p>
          </div>
          <p>${s.feeReminder.avoidLateFees}</p>
          <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/fees" class="button">${s.feeReminder.payButton}</a>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} ${process.env.SCHOOL_NAME || s.common.schoolManagement}. ${s.common.rights}</p>
        </div>
      </div>
    </body>
    </html>
  `;

  // Send to parent's email
  return await sendEmail({
    to: student.parent?.email || student.email,
    subject: interp(s.feeReminder.subject, { studentName: student.name }),
    html,
  });
};

/**
 * Send attendance alert email
 * @param {Object} student - Student object
 * @param {Object} attendanceData - Attendance details
 * @param {string} [lang='en'] - Locale code (en|hi|ta|te|kn|ur)
 */
export const sendAttendanceAlertEmail = async (student, attendanceData, lang = 'en') => {
  const s = getEmailStrings(lang);
  const statusText = attendanceData.isPresent
    ? s.attendanceAlert.present
    : s.attendanceAlert.absent;
  const emoji = attendanceData.isPresent ? '✅' : '❌';

  // Handle languages where the student name falls mid-sentence (infoAfter non-empty)
  const infoText = s.attendanceAlert.infoAfter
    ? `${s.attendanceAlert.infoBefore} <strong>${student.name}</strong> ${s.attendanceAlert.infoAfter}`
    : `${s.attendanceAlert.infoBefore} <strong>${student.name}</strong>.`;

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
          <h1>${emoji} ${s.attendanceAlert.header}</h1>
        </div>
        <div class="content">
          <p>${s.attendanceAlert.greeting}</p>
          <p>${infoText}</p>
          <div class="details">
            <p><strong>${s.attendanceAlert.date}</strong> ${new Date(attendanceData.date).toLocaleDateString()}</p>
            <p><strong>${s.attendanceAlert.status}</strong> ${statusText}</p>
            ${!attendanceData.isPresent && attendanceData.reason ? `<p><strong>${s.attendanceAlert.reason}</strong> ${attendanceData.reason}</p>` : ''}
          </div>
          ${!attendanceData.isPresent ? `<p>${s.attendanceAlert.contactSchool}</p>` : ''}
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} ${process.env.SCHOOL_NAME || s.common.schoolManagement}. ${s.common.rights}</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: student.parent?.email || student.email,
    subject: `${emoji} ${interp(s.attendanceAlert.subject, { studentName: student.name })}`,
    html,
  });
};

/**
 * Send welcome email to a newly signed-up school admin
 * Includes login link and optional email verification link.
 * @param {Object} adminUser - { name, email }
 * @param {Object} school - { name, code, plan, trialEndsAt }
 * @param {string|null} verificationToken - JWT token for email verification
 * @param {string} [lang='en'] - Locale code (en|hi|ta|te|kn|ur)
 */
export const sendSchoolWelcomeEmail = async (
  adminUser,
  school,
  verificationToken = null,
  lang = 'en'
) => {
  const s = getEmailStrings(lang);
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const loginUrl = `${frontendUrl}/login`;
  const verificationUrl = verificationToken
    ? `${frontendUrl}/verify-email?token=${encodeURIComponent(verificationToken)}`
    : null;

  const trialDays = school.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(school.trialEndsAt) - Date.now()) / (1000 * 60 * 60 * 24)))
    : 14;

  const verificationSection = verificationUrl
    ? `<div style="background:#fff8e1;border-left:4px solid #f59e0b;padding:12px 16px;margin:16px 0;border-radius:4px;">
        <p style="margin:0 0 8px;font-weight:600;color:#92400e;">${s.schoolWelcome.verifyTitle}</p>
        <p style="margin:0 0 10px;font-size:14px;color:#78350f;">${s.schoolWelcome.verifyText}</p>
        <a href="${verificationUrl}" style="display:inline-block;padding:10px 20px;background:#f59e0b;color:#fff;text-decoration:none;border-radius:5px;font-size:14px;font-weight:600;">${s.schoolWelcome.verifyButton}</a>
      </div>`
    : '';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family:Arial,sans-serif;line-height:1.6;color:#333;margin:0;padding:0;background:#f4f4f4;">
      <div style="max-width:600px;margin:20px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <div style="background:#0d9488;padding:28px 24px;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:22px;">${s.schoolWelcome.header}</h1>
          <p style="color:#99f6e4;margin:6px 0 0;font-size:14px;">${interp(s.schoolWelcome.readyToGo, { schoolName: school.name })}</p>
        </div>
        <div style="padding:28px 24px;">
          <p>${interp(s.schoolWelcome.greeting, { name: adminUser.name })}</p>
          <p>${s.schoolWelcome.trialBefore} <strong>${trialDays}${s.schoolWelcome.trialAfter}</strong> — ${s.schoolWelcome.noCCRequired}</p>
          <div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:12px 16px;margin:16px 0;border-radius:4px;">
            <p style="margin:0;font-size:14px;color:#15803d;"><strong>${s.schoolWelcome.schoolLabel}</strong> ${school.name}</p>
            <p style="margin:4px 0 0;font-size:14px;color:#15803d;"><strong>${s.schoolWelcome.codeLabel}</strong> ${school.code}</p>
            <p style="margin:4px 0 0;font-size:14px;color:#15803d;"><strong>${s.schoolWelcome.emailLabel}</strong> ${adminUser.email}</p>
          </div>
          ${verificationSection}
          <p>${s.schoolWelcome.getStarted}</p>
          <div style="text-align:center;margin:24px 0;">
            <a href="${loginUrl}" style="display:inline-block;padding:12px 28px;background:#0d9488;color:#fff;text-decoration:none;border-radius:5px;font-size:15px;font-weight:600;">${s.schoolWelcome.loginButton}</a>
          </div>
          <p style="font-size:13px;color:#666;">${s.schoolWelcome.ignoreText}</p>
        </div>
        <div style="padding:16px 24px;text-align:center;color:#999;font-size:12px;border-top:1px solid #eee;">
          <p>&copy; ${new Date().getFullYear()} SchoolSync. ${s.common.rights}</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: adminUser.email,
    subject: interp(s.schoolWelcome.subject, { schoolName: school.name }),
    html,
  });
};

/**
 * Send password reset email to a staff member.
 * @param {Object} staff - { name, email }
 * @param {string} resetToken - JWT token for password reset
 */
export const sendPasswordResetEmail = async (staff, resetToken) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const resetUrl = `${frontendUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family:Arial,sans-serif;line-height:1.6;color:#333;margin:0;padding:0;background:#f4f4f4;">
      <div style="max-width:600px;margin:20px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <div style="background:#0d9488;padding:28px 24px;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:22px;">Password Reset Request</h1>
        </div>
        <div style="padding:28px 24px;">
          <p>Hi ${staff.name},</p>
          <p>We received a request to reset your SchoolSync password. Click the button below to set a new password:</p>
          <div style="text-align:center;margin:24px 0;">
            <a href="${resetUrl}" style="display:inline-block;padding:12px 28px;background:#0d9488;color:#fff;text-decoration:none;border-radius:5px;font-size:15px;font-weight:600;">Reset Password</a>
          </div>
          <p style="font-size:13px;color:#666;">This link expires in <strong>1 hour</strong>. If you did not request a password reset, you can safely ignore this email — your password will remain unchanged.</p>
          <p style="font-size:12px;color:#999;margin-top:16px;">If the button doesn't work, copy and paste this link into your browser:<br><a href="${resetUrl}" style="color:#0d9488;word-break:break-all;">${resetUrl}</a></p>
        </div>
        <div style="padding:16px 24px;text-align:center;color:#999;font-size:12px;border-top:1px solid #eee;">
          <p>&copy; ${new Date().getFullYear()} SchoolSync. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: staff.email,
    subject: 'Reset your SchoolSync password',
    html,
  });
};

/**
 * OBS-04: Send weekly business metrics report email to configured recipients.
 * @param {Array} schoolSummaries - Result of getAllSchoolsMetricsSummary()
 */
export const sendWeeklyBusinessMetricsReport = async (schoolSummaries) => {
  const to = process.env.BUSINESS_METRICS_EMAIL || process.env.ALERT_EMAIL_TO;
  if (!to) return; // No recipient configured — skip silently

  const reportDate = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const totalDau = schoolSummaries.reduce((s, r) => s + r.dau, 0);
  const totalMau = schoolSummaries.reduce((s, r) => s + r.mau, 0);
  const totalApiCalls = schoolSummaries.reduce((s, r) => s + r.apiCallsLast7d, 0);
  const activeSchools = schoolSummaries.filter((r) => r.dau > 0).length;

  const rows = schoolSummaries
    .sort((a, b) => b.mau - a.mau)
    .map(
      (r) => `
      <tr style="border-bottom:1px solid #eee">
        <td style="padding:8px 12px">${r.name}</td>
        <td style="padding:8px 12px;text-align:center">${r.dau}</td>
        <td style="padding:8px 12px;text-align:center">${r.wau}</td>
        <td style="padding:8px 12px;text-align:center">${r.mau}</td>
        <td style="padding:8px 12px;text-align:center">${r.apiCallsLast7d.toLocaleString()}</td>
        <td style="padding:8px 12px;text-align:center">${r.clientSplit.webPct}% / ${r.clientSplit.mobilePct}%</td>
      </tr>`
    )
    .join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; color: #333; line-height: 1.6; }
        .container { max-width: 800px; margin: 0 auto; padding: 20px; }
        .header { background: #1a1a2e; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .summary { display: flex; gap: 16px; margin: 20px 0; }
        .stat { flex: 1; background: #f4f6ff; border-radius: 8px; padding: 16px; text-align: center; }
        .stat h3 { margin: 0; font-size: 28px; color: #1a1a2e; }
        .stat p { margin: 4px 0 0; font-size: 12px; color: #666; }
        table { width: 100%; border-collapse: collapse; font-size: 14px; }
        th { background: #1a1a2e; color: white; padding: 10px 12px; text-align: left; }
        th:not(:first-child) { text-align: center; }
        tr:nth-child(even) { background: #f9f9f9; }
        .footer { margin-top: 24px; font-size: 12px; color: #999; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2 style="margin:0">Weekly Business Metrics Report</h2>
          <p style="margin:4px 0 0;opacity:0.8">${reportDate}</p>
        </div>

        <table style="margin-top:20px;width:100%">
          <tr>
            <td style="padding:12px;background:#f4f6ff;border-radius:8px;text-align:center;width:25%">
              <div style="font-size:28px;font-weight:bold;color:#1a1a2e">${totalDau}</div>
              <div style="font-size:12px;color:#666">Total DAU (today)</div>
            </td>
            <td style="padding:12px;background:#f4f6ff;border-radius:8px;text-align:center;width:25%">
              <div style="font-size:28px;font-weight:bold;color:#1a1a2e">${totalMau}</div>
              <div style="font-size:12px;color:#666">Total MAU (30d)</div>
            </td>
            <td style="padding:12px;background:#f4f6ff;border-radius:8px;text-align:center;width:25%">
              <div style="font-size:28px;font-weight:bold;color:#1a1a2e">${activeSchools}</div>
              <div style="font-size:12px;color:#666">Active Schools (today)</div>
            </td>
            <td style="padding:12px;background:#f4f6ff;border-radius:8px;text-align:center;width:25%">
              <div style="font-size:28px;font-weight:bold;color:#1a1a2e">${totalApiCalls.toLocaleString()}</div>
              <div style="font-size:12px;color:#666">API Calls (7d)</div>
            </td>
          </tr>
        </table>

        <h3 style="margin-top:28px">Per-School Breakdown</h3>
        <table>
          <thead>
            <tr>
              <th>School</th>
              <th>DAU</th>
              <th>WAU</th>
              <th>MAU</th>
              <th>API Calls (7d)</th>
              <th>Web / Mobile</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>

        <div class="footer">
          <p>Generated automatically by EMS · ${process.env.SCHOOL_NAME || 'School Management System'}</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to,
    subject: `Weekly Business Metrics — ${reportDate}`,
    html,
  });
};

export { sendEmail, sendBulkEmails };
