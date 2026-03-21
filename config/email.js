import nodemailer from 'nodemailer';
import EmailSuppression from '../models/EmailSuppression.js';
import SchoolSettings from '../models/SchoolSettings.js';

// Create email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Verify email configuration on startup
export const verifyEmailConfig = async () => {
  try {
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      await transporter.verify();
    } else {
      // No SMTP credentials configured — skip verification
    }
  } catch (error) {
    console.error('❌ Email configuration error:', error.message);
  }
};

/**
 * Check if an email address is on the active suppression list.
 * Checks both global (schoolId=null) and school-specific records.
 * @param {string} email
 * @param {string|null} schoolId
 * @returns {Object|null} suppression record or null
 */
export const checkEmailSuppression = async (email, schoolId = null) => {
  try {
    const normalized = email.toLowerCase().trim();
    return await EmailSuppression.findOne({
      email: normalized,
      isActive: true,
      $or: [
        { schoolId: schoolId || null },
        { schoolId: null }, // global suppressions apply to all schools
      ],
    }).lean();
  } catch {
    // If DB check fails (e.g. during startup), allow the send to proceed
    return null;
  }
};

/**
 * Record an email as suppressed (upsert).
 * @param {Object} params
 */
export const suppressEmail = async ({
  email,
  schoolId = null,
  reason,
  bounceCode = null,
  providerMessage = null,
  provider = 'smtp',
  suppressedBy = null,
  notes = null,
}) => {
  try {
    const normalized = email.toLowerCase().trim();
    await EmailSuppression.findOneAndUpdate(
      { email: normalized, schoolId: schoolId || null },
      {
        $set: {
          reason,
          bounceCode,
          providerMessage,
          provider,
          suppressedBy,
          notes,
          isActive: true,
          releasedAt: null,
          releasedBy: null,
          lastAttemptAt: new Date(),
        },
        $inc: { attemptCount: 1 },
        $setOnInsert: { suppressedAt: new Date() },
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    console.error('[EmailSuppression] Failed to record suppression:', err.message);
  }
};

// Send email function
export const sendEmail = async ({ to, subject, html, text, attachments = [], schoolId = null }) => {
  try {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      throw new Error('Email credentials not configured');
    }

    const recipient = Array.isArray(to) ? to[0] : to;

    // Check suppression list before attempting to send
    const suppression = await checkEmailSuppression(recipient, schoolId);
    if (suppression) {
      console.warn(`⚠️  Email to ${recipient} skipped — suppressed (${suppression.reason})`);
      return {
        success: false,
        suppressed: true,
        reason: suppression.reason,
        suppressedAt: suppression.suppressedAt,
      };
    }

    // Resolve per-school DKIM signing when a verified custom domain is configured
    let fromAddress = `"${process.env.SCHOOL_NAME || 'School Management System'}" <${process.env.SMTP_USER}>`;
    let dkimOptions = null;

    if (schoolId) {
      try {
        const schoolSettings = await SchoolSettings.findOne({ schoolId })
          .select('emailDomain')
          .lean();
        const ed = schoolSettings?.emailDomain;
        if (ed?.sendingDomain && ed.dkimVerified && ed.dkimPrivateKey) {
          const senderEmail = ed.senderEmail || `noreply@${ed.sendingDomain}`;
          const senderName = ed.senderName || process.env.SCHOOL_NAME || 'School';
          fromAddress = `"${senderName}" <${senderEmail}>`;
          dkimOptions = {
            domainName: ed.sendingDomain,
            keySelector: ed.dkimSelector || 'ems',
            privateKey: ed.dkimPrivateKey,
          };
        }
      } catch (settingsErr) {
        console.warn('[Email] Could not load school email domain settings:', settingsErr.message);
      }
    }

    const mailOptions = {
      from: fromAddress,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      text,
      html,
      attachments,
      ...(dkimOptions ? { dkim: dkimOptions } : {}),
    };

    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Email sending failed:', error.message);

    // Auto-suppress on permanent SMTP failures (5xx = hard bounce)
    const responseCode = error.responseCode || 0;
    if (responseCode >= 500 && responseCode < 600) {
      const recipient = Array.isArray(to) ? to[0] : to;
      if (recipient) {
        await suppressEmail({
          email: recipient,
          schoolId: schoolId || null,
          reason: 'hard_bounce',
          bounceCode: String(responseCode),
          providerMessage: error.response || error.message,
          provider: 'smtp',
        });
        console.warn(`⚠️  Auto-suppressed ${recipient} after hard bounce (${responseCode})`);
      }
    }

    return { success: false, error: error.message };
  }
};

// Send bulk emails
export const sendBulkEmails = async (emails) => {
  const results = [];

  for (const email of emails) {
    const result = await sendEmail(email);
    results.push({ ...email, ...result });
  }

  return results;
};

export { EmailSuppression };
export default transporter;
