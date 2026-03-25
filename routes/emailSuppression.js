import crypto from 'crypto';
import express from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import EmailSuppression from '../models/EmailSuppression.js';
import { suppressEmail } from '../config/email.js';
import { buildSchoolScopedQuery } from '../utils/schoolContext.js';

const router = express.Router();
router.use(authenticate);

// ── Zod schemas ───────────────────────────────────────────────────────────────

const addSuppressionSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase().trim(),
  reason: z.enum(['hard_bounce', 'soft_bounce', 'complaint', 'unsubscribe', 'manual']),
  notes: z.string().trim().max(500).optional(),
});

const releaseSuppressionSchema = z.object({
  notes: z.string().trim().max(500).optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function validationError(res, errors) {
  return res.status(400).json({
    error: 'Validation failed',
    details: errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/email-suppressions
 * List suppressed emails for this school (+ global suppressions).
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const { reason, isActive, page = '1', limit = '50' } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, parseInt(limit, 10) || 50);

    const filter = {
      $or: [{ schoolId: req.user.schoolId }, { schoolId: null }],
    };

    if (reason) filter.reason = reason;
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const [suppressions, total] = await Promise.all([
      EmailSuppression.find(filter)
        .sort({ suppressedAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      EmailSuppression.countDocuments(filter),
    ]);

    res.json({ suppressions, total, page: pageNum, limit: limitNum });
  } catch (err) {
    console.error('[EmailSuppression] List error:', err);
    res.status(500).json({ error: 'Failed to fetch suppressions' });
  }
});

/**
 * POST /api/v1/email-suppressions
 * Manually add an email to the suppression list.
 */
router.post('/', authenticate, async (req, res) => {
  const parsed = addSuppressionSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.errors);

  try {
    const { email, reason, notes } = parsed.data;

    await suppressEmail({
      email,
      schoolId: req.user.schoolId,
      reason,
      provider: 'manual',
      suppressedBy: req.user._id,
      notes: notes || null,
    });

    const record = await EmailSuppression.findOne({
      email,
      schoolId: req.user.schoolId,
    }).lean();

    res.status(201).json(record);
  } catch (err) {
    console.error('[EmailSuppression] Create error:', err);
    res.status(500).json({ error: 'Failed to add suppression' });
  }
});

/**
 * POST /api/v1/email-suppressions/check
 * Check whether a given email is currently suppressed for this school.
 */
router.post('/check', authenticate, async (req, res) => {
  const parsed = z.object({ email: z.string().email() }).safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.errors);

  try {
    const normalized = parsed.data.email.toLowerCase().trim();
    const suppression = await EmailSuppression.findOne({
      email: normalized,
      isActive: true,
      $or: [{ schoolId: req.user.schoolId }, { schoolId: null }],
    }).lean();

    res.json({ suppressed: !!suppression, suppression: suppression || null });
  } catch (err) {
    console.error('[EmailSuppression] Check error:', err);
    res.status(500).json({ error: 'Failed to check suppression status' });
  }
});

/**
 * POST /api/v1/email-suppressions/:id/release
 * Release (deactivate) a suppression so the address can receive emails again.
 * Only school-scoped suppressions may be released; global ones require super-admin.
 */
router.post('/:id/release', authenticate, async (req, res) => {
  const parsed = releaseSuppressionSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.errors);

  try {
    const scope = buildSchoolScopedQuery(req.user.schoolId);
    const record = await EmailSuppression.findOneAndUpdate(
      { _id: req.params.id, ...scope, isActive: true },
      {
        $set: {
          isActive: false,
          releasedAt: new Date(),
          releasedBy: req.user._id,
          notes: parsed.data.notes || null,
        },
      },
      { new: true }
    ).lean();

    if (!record) {
      return res.status(404).json({
        error: 'Suppression not found or already released',
      });
    }

    res.json(record);
  } catch (err) {
    console.error('[EmailSuppression] Release error:', err);
    res.status(500).json({ error: 'Failed to release suppression' });
  }
});

/**
 * DELETE /api/v1/email-suppressions/:id
 * Permanently remove a school-scoped suppression record.
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const scope = buildSchoolScopedQuery(req.user.schoolId);
    const record = await EmailSuppression.findOneAndDelete({
      _id: req.params.id,
      ...scope,
    });

    if (!record) {
      return res.status(404).json({ error: 'Suppression not found' });
    }

    res.json({ success: true, message: 'Suppression deleted' });
  } catch (err) {
    console.error('[EmailSuppression] Delete error:', err);
    res.status(500).json({ error: 'Failed to delete suppression' });
  }
});

// ── Bounce Webhook ─────────────────────────────────────────────────────────────
//
// POST /api/v1/email-suppressions/webhook/bounce
//
// Receives bounce notifications from ESP providers (SendGrid, SES, Mailgun,
// Postmark). Verified by HMAC-SHA256 signature using EMAIL_BOUNCE_WEBHOOK_SECRET.
// Suppressions are stored globally (schoolId: null) — a bounced address is
// invalid across all tenants.
//
// Provider setup:
//   SendGrid  → Events → Bounce, Spam report, Unsubscribe
//   Mailgun   → Webhooks → permanent_fail, complaint, unsubscribed
//   Postmark  → Bounce webhook URL
//   SES       → SNS subscription → Bounce + Complaint notifications

const BOUNCE_WEBHOOK_SECRET = process.env.EMAIL_BOUNCE_WEBHOOK_SECRET;

function verifySendGridSignature(req) {
  const sig = req.headers['x-twilio-email-event-webhook-signature'];
  const ts = req.headers['x-twilio-email-event-webhook-timestamp'];
  if (!sig || !ts || !BOUNCE_WEBHOOK_SECRET) return false;
  const payload = ts + JSON.stringify(req.body);
  const expected = crypto
    .createHmac('sha256', BOUNCE_WEBHOOK_SECRET)
    .update(payload)
    .digest('base64');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function verifyMailgunSignature(req) {
  const { timestamp, token, signature } = req.body;
  if (!timestamp || !token || !signature || !BOUNCE_WEBHOOK_SECRET) return false;
  const expected = crypto
    .createHmac('sha256', BOUNCE_WEBHOOK_SECRET)
    .update(timestamp + token)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function verifyGenericSignature(req) {
  const sig = req.headers['x-webhook-signature'];
  if (!sig || !BOUNCE_WEBHOOK_SECRET) return false;
  const expected = crypto
    .createHmac('sha256', BOUNCE_WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from('sha256=' + expected));
}

router.post('/webhook/bounce', express.json(), async (req, res) => {
  try {
    const provider = (req.headers['x-webhook-provider'] || 'generic').toLowerCase();
    // SECURITY: Never accept schoolId from query params — this is an unauthenticated
    // endpoint called by ESP providers. Bounce suppressions are global (schoolId: null)
    // because a bounced address is invalid regardless of which school sent the email.
    const schoolId = null;

    // Verify signature if secret is configured
    if (BOUNCE_WEBHOOK_SECRET) {
      let valid = false;
      if (provider === 'sendgrid') valid = verifySendGridSignature(req);
      else if (provider === 'mailgun') valid = verifyMailgunSignature(req);
      else valid = verifyGenericSignature(req);

      if (!valid) {
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
    }

    const events = Array.isArray(req.body) ? req.body : [req.body];
    const processed = [];

    for (const event of events) {
      const parsed = parseProviderEvent(event, provider);
      if (!parsed) continue;

      await suppressEmail({
        email: parsed.email,
        schoolId: schoolId,
        reason: parsed.reason,
        bounceCode: parsed.bounceCode,
        providerMessage: parsed.providerMessage,
        provider: parsed.provider,
      });

      processed.push(parsed.email);
    }

    res.json({ success: true, processed: processed.length });
  } catch (err) {
    console.error('[EmailSuppression] Webhook error:', err);
    res.status(500).json({ error: 'Failed to process bounce webhook' });
  }
});

/**
 * Parse a provider-specific event payload into a normalised form.
 * Returns null if the event type is not a bounce/complaint/unsubscribe.
 */
function parseProviderEvent(event, provider) {
  if (provider === 'sendgrid') {
    const typeMap = {
      bounce: 'hard_bounce',
      blocked: 'soft_bounce',
      spamreport: 'complaint',
      unsubscribe: 'unsubscribe',
      group_unsubscribe: 'unsubscribe',
    };
    const reason = typeMap[event.event];
    if (!reason) return null;
    return {
      email: event.email,
      reason,
      bounceCode: event.status || null,
      providerMessage: event.reason || null,
      provider: 'sendgrid',
    };
  }

  if (provider === 'mailgun') {
    const typeMap = {
      permanent_fail: 'hard_bounce',
      temporary_fail: 'soft_bounce',
      complaint: 'complaint',
      unsubscribed: 'unsubscribe',
    };
    const eventData = event['event-data'] || event;
    const reason = typeMap[eventData.event];
    if (!reason) return null;
    return {
      email: eventData.recipient,
      reason,
      bounceCode: eventData.severity || null,
      providerMessage: eventData.description || null,
      provider: 'mailgun',
    };
  }

  if (provider === 'postmark') {
    if (event.RecordType === 'Bounce') {
      const reason = event.Type === 'HardBounce' ? 'hard_bounce' : 'soft_bounce';
      return {
        email: event.Email,
        reason,
        bounceCode: String(event.TypeCode || ''),
        providerMessage: event.Description || null,
        provider: 'postmark',
      };
    }
    if (event.RecordType === 'SpamComplaint') {
      return {
        email: event.Email,
        reason: 'complaint',
        bounceCode: null,
        providerMessage: null,
        provider: 'postmark',
      };
    }
    return null;
  }

  if (provider === 'ses') {
    // SNS-wrapped SES notification
    const notification = typeof event.Message === 'string' ? JSON.parse(event.Message) : event;
    if (notification.notificationType === 'Bounce') {
      const isHard = notification.bounce?.bounceType === 'Permanent';
      const recipients = notification.bounce?.bouncedRecipients || [];
      // Return first recipient (caller iterates if needed)
      if (!recipients.length) return null;
      return {
        email: recipients[0].emailAddress,
        reason: isHard ? 'hard_bounce' : 'soft_bounce',
        bounceCode: recipients[0].status || null,
        providerMessage: recipients[0].diagnosticCode || null,
        provider: 'ses',
      };
    }
    if (notification.notificationType === 'Complaint') {
      const recipients = notification.complaint?.complainedRecipients || [];
      if (!recipients.length) return null;
      return {
        email: recipients[0].emailAddress,
        reason: 'complaint',
        bounceCode: null,
        providerMessage: null,
        provider: 'ses',
      };
    }
    return null;
  }

  // Generic fallback: expect { email, reason, bounceCode?, providerMessage? }
  if (!event.email || !event.reason) return null;
  const allowed = ['hard_bounce', 'soft_bounce', 'complaint', 'unsubscribe', 'manual'];
  if (!allowed.includes(event.reason)) return null;
  return {
    email: event.email,
    reason: event.reason,
    bounceCode: event.bounceCode || null,
    providerMessage: event.providerMessage || null,
    provider: 'manual',
  };
}

export default router;
