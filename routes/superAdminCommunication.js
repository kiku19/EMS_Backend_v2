/**
 * Super-admin → per-school Communication gateway config.
 *
 * The canonical write path for SMS/email gateway credentials (Task 3 of the
 * onboarding revamp). School admins can only READ communication settings via
 * GET /settings/communication (masked); all writes + test-sends go through
 * here, super-admin-gated, scoped by the :id school param (NOT req.user.schoolId
 * — super-admin has no school of their own).
 *
 *   GET   /super-admin/schools/:id/communication            — full config (secrets masked)
 *   PATCH /super-admin/schools/:id/communication            — update SMS/email config
 *   POST  /super-admin/schools/:id/communication/test-email — send a test email
 *   POST  /super-admin/schools/:id/communication/test-sms   — send a test SMS
 *
 * Mounted under /super-admin so the router-wide `authenticate, requireSuperAdmin`
 * middleware already enforces the ops-only gate.
 */
import express from 'express';
import { z } from 'zod';
import { SchoolSettings } from '../database.js';
import School from '../models/School.js';
import { authenticate, requireSuperAdmin } from '../middleware/auth.js';
import { validateZod, mongoIdParamSchema } from '../validators/index.js';
import { sendEmail } from '../config/email.js';
import { sendSMS } from '../config/sms.js';

const router = express.Router();

// Router-wide gate: every endpoint here is ops-only. Matches the parent
// /super-admin mount's enforcement so a misconfigured mount can't accidentally
// expose credential writes to tenant admins.
router.use(authenticate, requireSuperAdmin);

const communicationSettingsSchema = z
  .object({
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
  })
  .strict();

const testEmailSchema = z.object({
  to: z.string().email('Invalid email address').max(253),
});

const testSmsSchema = z.object({
  to: z
    .string()
    .regex(/^\+?[0-9]{7,15}$/, 'Invalid phone number')
    .max(20),
});

/** Masked payload for responses — never leak the stored apiKey/password. */
function maskedPayload(comm = {}) {
  return {
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
  };
}

async function findSchoolSettings(schoolId) {
  // select the credentials fields so we can preserve them on masked-input writes.
  return SchoolSettings.findOne({ schoolId }).select(
    '+communicationSettings.sms.apiKey +communicationSettings.email.password'
  );
}

// GET — full config (masked).
router.get(
  '/schools/:id/communication',
  validateZod(mongoIdParamSchema, 'params'),
  async (req, res) => {
    try {
      const school = await School.findById(req.params.id).select('_id name');
      if (!school) {
        return res.status(404).json({ error: 'School not found' });
      }
      const settings = await findSchoolSettings(req.params.id);
      res.json({
        school: { id: school._id, name: school.name },
        communication: maskedPayload(settings?.communicationSettings),
      });
    } catch (error) {
      console.error('Error fetching super-admin communication settings:', error);
      res.status(500).json({ error: 'Failed to fetch communication settings' });
    }
  }
);

// PATCH — update SMS/email config. Masked placeholder values preserve the
// stored secret so the ops UI can submit the masked form without re-entering
// credentials on every save.
router.patch(
  '/schools/:id/communication',
  validateZod(mongoIdParamSchema, 'params'),
  validateZod(communicationSettingsSchema),
  async (req, res) => {
    try {
      const school = await School.findById(req.params.id).select('_id name');
      if (!school) {
        return res.status(404).json({ error: 'School not found' });
      }

      let settings = await findSchoolSettings(req.params.id);
      if (!settings) {
        // Lazily create the settings row if it doesn't exist yet.
        settings = await SchoolSettings.create({ schoolId: req.params.id });
        settings = await findSchoolSettings(req.params.id);
      }

      const data = req.body;
      const existing = settings.communicationSettings || {};

      // If password/apiKey is the masked placeholder, keep the existing value.
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

      res.json({
        school: { id: school._id, name: school.name },
        communication: maskedPayload(settings.communicationSettings),
      });
    } catch (error) {
      console.error('Error updating super-admin communication settings:', error);
      res.status(500).json({ error: 'Failed to update communication settings' });
    }
  }
);

// POST — send a test email through the school's configured gateway.
router.post(
  '/schools/:id/communication/test-email',
  validateZod(mongoIdParamSchema, 'params'),
  validateZod(testEmailSchema),
  async (req, res) => {
    try {
      const school = await School.findById(req.params.id).select('name');
      if (!school) {
        return res.status(404).json({ error: 'School not found' });
      }
      const { to } = req.body;
      const result = await sendEmail({
        to,
        subject: `[TEST] ${school.name} email test`,
        html: `<div style="font-family: Arial, sans-serif; padding: 24px; color: #111;">
<h2 style="margin: 0 0 12px;">Test email</h2>
<p style="margin: 0 0 12px;">This is a test email sent from <strong>${school.name}</strong> communication settings.</p>
<p style="margin: 0;">If you received this message, your SMTP configuration is working correctly.</p>
</div>`,
        schoolId: req.params.id,
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
      console.error('Error sending super-admin test email:', error);
      res.status(500).json({ success: false, message: 'Failed to send test email' });
    }
  }
);

// POST — send a test SMS through the school's configured gateway.
router.post(
  '/schools/:id/communication/test-sms',
  validateZod(mongoIdParamSchema, 'params'),
  validateZod(testSmsSchema),
  async (req, res) => {
    try {
      const school = await School.findById(req.params.id).select('name');
      if (!school) {
        return res.status(404).json({ error: 'School not found' });
      }
      const { to } = req.body;
      const result = await sendSMS(to, `Test SMS from ${school.name} communication settings.`);
      if (result?.success === false) {
        return res.status(400).json({
          success: false,
          message: result?.error || 'Failed to send test SMS. Check gateway credentials.',
        });
      }
      res.json({ success: true, message: `Test SMS sent to ${to}` });
    } catch (error) {
      console.error('Error sending super-admin test SMS:', error);
      res.status(500).json({ success: false, message: 'Failed to send test SMS' });
    }
  }
);

export default router;
