/**
 * Email/SMS delivery analytics tracking endpoints.
 * These routes are intentionally unauthenticated — they are called by:
 *   - Email clients loading the tracking pixel (open tracking)
 *   - Users clicking links in emails (click tracking)
 *   - MSG91 delivery webhook (SMS/WhatsApp delivery status)
 *
 * Security: all lookups use opaque random tokens stored at send-time.
 */

import express from 'express';
import { z } from 'zod';
import AnnouncementRecipient from '../models/AnnouncementRecipient.js';
import Announcement from '../models/Announcement.js';
import { processDeliveryEvent } from '../utils/deliveryStatus.js';

const router = express.Router();

// 1×1 transparent GIF (base64 decoded at module load, reused per request)
const TRACKING_PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const smsWebhookSchema = z
  .object({
    requestId: z.string().optional(),
    type: z.enum(['sms', 'whatsapp']).optional(),
    status: z.string(),
    number: z.string().optional(),
    reason: z.string().optional(),
    date: z.string().optional(),
  })
  .passthrough();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Find a recipient record and its deliveryStatus entry by tracking token.
 * Returns { recipient, deliveryStatus } or null.
 */
async function findByToken(token) {
  const recipient = await AnnouncementRecipient.findOne({
    'deliveryStatus.trackingToken': token,
  });
  if (!recipient) return null;
  const deliveryStatus = recipient.deliveryStatus.find((ds) => ds.trackingToken === token);
  return { recipient, deliveryStatus };
}

// ─── GET /api/v1/tracking/pixel/:token — email open tracking ─────────────────

router.get('/pixel/:token', async (req, res) => {
  // Always return the pixel immediately; tracking is best-effort
  res.set({
    'Content-Type': 'image/gif',
    'Content-Length': TRACKING_PIXEL.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
  res.end(TRACKING_PIXEL);

  // Async tracking (does not affect response)
  try {
    const token = req.params.token;
    const found = await findByToken(token);
    if (!found) return;

    const { recipient, deliveryStatus } = found;
    const now = new Date();

    if (!deliveryStatus.openedAt) {
      deliveryStatus.openedAt = now;
    }
    deliveryStatus.openCount = (deliveryStatus.openCount || 0) + 1;
    await recipient.save();

    // Increment announcement-level open count
    await Announcement.findByIdAndUpdate(recipient.announcementId, {
      $inc: { 'analytics.openCount': 1 },
    });
  } catch (err) {
    console.error('[tracking] pixel error:', err.message);
  }
});

// ─── GET /api/v1/tracking/click/:token — email click tracking ────────────────

router.get('/click/:token', async (req, res) => {
  const { url } = req.query;

  // Validate destination URL before redirecting
  let destination;
  try {
    if (!url) throw new Error('missing url');
    destination = decodeURIComponent(url);
    new URL(destination); // throws if invalid
  } catch {
    return res.status(400).send('Invalid redirect URL');
  }

  // Redirect immediately; tracking is best-effort
  res.redirect(302, destination);

  try {
    const token = req.params.token;
    const found = await findByToken(token);
    if (!found) return;

    const { recipient, deliveryStatus } = found;
    deliveryStatus.clickCount = (deliveryStatus.clickCount || 0) + 1;
    await recipient.save();

    // Increment announcement-level click count
    await Announcement.findByIdAndUpdate(recipient.announcementId, {
      $inc: { 'analytics.clickCount': 1 },
    });
  } catch (err) {
    console.error('[tracking] click error:', err.message);
  }
});

// ─── POST /api/v1/tracking/sms-webhook — MSG91 delivery status callback ──────

router.post('/sms-webhook', async (req, res) => {
  // Validate shared secret if configured
  const secret = process.env.MSG91_WEBHOOK_SECRET;
  if (secret) {
    const provided = req.headers['x-webhook-secret'] || req.query.secret;
    if (provided !== secret) {
      return res.status(401).json({ error: req.t('common:errors.unauthorized') });
    }
  }

  // MSG91 can send either a single object or an array of events
  const events = Array.isArray(req.body) ? req.body : [req.body];

  const results = [];
  for (const raw of events) {
    const parsed = smsWebhookSchema.safeParse(raw);
    if (!parsed.success) {
      results.push({ requestId: raw?.requestId, error: 'Invalid payload' });
      continue;
    }

    const { requestId, status, reason } = parsed.data;
    if (!requestId) {
      results.push({ error: 'Missing requestId' });
      continue;
    }

    try {
      const result = await processDeliveryEvent(requestId, status, reason);
      results.push({ requestId, ...result });
    } catch (err) {
      console.error('[tracking] sms-webhook error:', err.message);
      results.push({ requestId, error: err.message });
    }
  }

  res.json({ received: results.length, results });
});

export default router;
