import nodemailer from 'nodemailer';

// Create email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// Verify email configuration on startup
export const verifyEmailConfig = async () => {
  try {
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      await transporter.verify();
      console.log('✅ Email server is ready to send messages');
    } else {
      console.log('⚠️  Email credentials not configured. Email features will be disabled.');
    }
  } catch (error) {
    console.error('❌ Email configuration error:', error.message);
  }
};

// Send email function
export const sendEmail = async ({ to, subject, html, text, attachments = [] }) => {
  try {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      throw new Error('Email credentials not configured');
    }

    const mailOptions = {
      from: `"${process.env.SCHOOL_NAME || 'School Management System'}" <${process.env.SMTP_USER}>`,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      text,
      html,
      attachments
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Email sending failed:', error.message);
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

export default transporter;
