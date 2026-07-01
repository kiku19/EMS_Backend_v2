import express from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { checkPermission } from '../../middleware/auth/permissions.js';
import { ensureSchoolSettings } from '../../utils/academicYear.js';
import { buildSchoolScopedQuery } from '../../utils/schoolContext.js';
import { SchoolSettings } from '../../database.js';
import { sendEmail } from '../../config/email.js';
import { sendSMS } from '../../config/sms.js';

const router = express.Router();
router.use(authenticate);

const communicationSettingsSchema = z.object({
  sms: z.object({
    enabled: z.boolean(),
    provider: z.enum(['twilio', 'msg91', 'textlocal']),
    senderId: z.string().max(20).optional().default(''),
    apiKey: z.string().max(500).optional().default(''),
  }),
  email: z.object({
    enabled: z.boolean(),
    provider: z.enum(['smtp', 'sendgrid', 'mailgun']),
    smtpHost: z.string().max(253).optional().default(''),
    port: z.string().max(5).optional().default('587'),
    username: z.string().max(200).optional().default(''),
    password: z.string().max(500).optional().default(''),
  }),
});

const testEmailSchema = z.object({
  to: z.string().email('Invalid email address').max(253),
});

const testSmsSchema = z.object({
  to: z
    .string()
    .regex(/^\+?[0-9]{7,15}$/, 'Invalid phone number')
    .max(20),
});

// GET /settings/communication
router.get('/communication', authenticate, async (req, res) => {
  try {
    const settings = await ensureSchoolSettings(req.user?.schoolId);
    const comm = settings.communicationSettings || {};
    res.json({
      sms: {
        enabled: comm.sms?.enabled ?? true,
        provider: comm.sms?.provider ?? 'twilio',
        senderId: comm.sms?.senderId ?? '',
        apiKey: comm.sms?.apiKey ? '••••••••' : '',
      },
      email: {
        enabled: comm.email?.enabled ?? true,
        provider: comm.email?.provider ?? 'smtp',
        smtpHost: comm.email?.smtpHost ?? '',
        port: comm.email?.port ?? '587',
        username: comm.email?.username ?? '',
        password: comm.email?.password ? '••••••••' : '',
      },
    });
  } catch (error) {
    console.error('Error fetching communication settings:', error);
    res.status(500).json({ error: 'Failed to fetch communication settings' });
  }
});

// PUT /settings/communication (admin/settings-edit only)
router.put(
  '/communication',
  authenticate,
  checkPermission('settings', 'edit'),
  async (req, res) => {
    try {
      const parsed = communicationSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
      }

      const query = buildSchoolScopedQuery(req.user?.schoolId);
      const settings = await SchoolSettings.findOne(query);
      if (!settings) {
        return res.status(404).json({ error: 'School settings not found' });
      }

      const data = parsed.data;
      const existing = settings.communicationSettings || {};

      // If password/apiKey is the masked placeholder, keep the existing value
      const smsApiKey =
        data.sms.apiKey === '••••••••' ? (existing.sms?.apiKey ?? '') : data.sms.apiKey;
      const emailPassword =
        data.email.password === '••••••••' ? (existing.email?.password ?? '') : data.email.password;

      settings.communicationSettings = {
        sms: {
          enabled: data.sms.enabled,
          provider: data.sms.provider,
          senderId: data.sms.senderId,
          apiKey: smsApiKey,
        },
        email: {
          enabled: data.email.enabled,
          provider: data.email.provider,
          smtpHost: data.email.smtpHost,
          port: data.email.port,
          username: data.email.username,
          password: emailPassword,
        },
      };

      await settings.save();

      // Return with masked secrets
      res.json({
        sms: {
          enabled: settings.communicationSettings.sms.enabled,
          provider: settings.communicationSettings.sms.provider,
          senderId: settings.communicationSettings.sms.senderId,
          apiKey: settings.communicationSettings.sms.apiKey ? '••••••••' : '',
        },
        email: {
          enabled: settings.communicationSettings.email.enabled,
          provider: settings.communicationSettings.email.provider,
          smtpHost: settings.communicationSettings.email.smtpHost,
          port: settings.communicationSettings.email.port,
          username: settings.communicationSettings.email.username,
          password: settings.communicationSettings.email.password ? '••••••••' : '',
        },
      });
    } catch (error) {
      console.error('Error updating communication settings:', error);
      res.status(500).json({ error: 'Failed to update communication settings' });
    }
  }
);

// POST /settings/communication/test-email — send a test email through configured SMTP
router.post(
  '/communication/test-email',
  authenticate,
  checkPermission('settings', 'edit'),
  async (req, res) => {
    try {
      const parsed = testEmailSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const { to } = parsed.data;
      const schoolName = process.env.SCHOOL_NAME || 'School Management System';
      const result = await sendEmail({
        to,
        subject: `[TEST] ${schoolName} email test`,
        html: `<div style="font-family: Arial, sans-serif; padding: 24px; color: #111;">
<h2 style="margin: 0 0 12px;">Test email</h2>
<p style="margin: 0 0 12px;">This is a test email sent from <strong>${schoolName}</strong> communication settings.</p>
<p style="margin: 0;">If you received this message, your SMTP configuration is working correctly.</p>
</div>`,
        schoolId: req.user?.schoolId,
      });
      if (result?.success === false) {
        return res.status(400).json({
          success: false,
          message:
            result?.error || result?.reason || 'Failed to send test email. Check SMTP credentials.',
        });
      }
      res.json({ success: true, message: `Test email sent to ${to}` });
    } catch (error) {
      console.error('Error sending test email:', error);
      res.status(500).json({ success: false, message: 'Failed to send test email' });
    }
  }
);

// POST /settings/communication/test-sms — send a test SMS through configured MSG91
router.post(
  '/communication/test-sms',
  authenticate,
  checkPermission('settings', 'edit'),
  async (req, res) => {
    try {
      const parsed = testSmsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const { to } = parsed.data;
      const result = await sendSMS(to, 'Test SMS from school communication settings.');
      if (result?.success === false) {
        return res.status(400).json({
          success: false,
          message: result?.error || 'Failed to send test SMS. Check MSG91 credentials.',
        });
      }
      res.json({ success: true, message: `Test SMS sent to ${to}` });
    } catch (error) {
      console.error('Error sending test SMS:', error);
      res.status(500).json({ success: false, message: 'Failed to send test SMS' });
    }
  }
);

export default router;
