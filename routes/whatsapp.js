import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { authenticateParent } from '../middleware/parentAuth.js';
import Parent from '../models/Parent.js';
import { buildSchoolScopedQuery } from '../utils/schoolContext.js';
import { processDeliveryEvent } from '../utils/deliveryStatus.js';

const router = express.Router();

/**
 * POST /api/v1/whatsapp/webhook
 * MSG91 delivery status callback — no authentication (called by MSG91 servers).
 * Always returns 200 immediately to prevent MSG91 retries.
 */
router.post('/webhook', (req, res) => {
  // Always return 200 immediately to prevent MSG91 retries
  res.status(200).json({ status: 'ok' });

  // Process delivery status asynchronously (best-effort, must not block response)
  const { status, requestId, mobile, reason } = req.body || {};
  if (status && requestId) {
    processDeliveryEvent(requestId, status, reason).catch((err) => {
      console.error(`[WhatsApp] webhook processing error (reqId: ${requestId}):`, err.message);
    });
  }
});

/**
 * PUT /api/v1/whatsapp/opt-in
 * Parent opts in to WhatsApp notifications.
 */
router.put('/opt-in', authenticateParent, async (req, res) => {
  try {
    await Parent.findByIdAndUpdate(req.parent._id, { $set: { 'preferences.whatsappOptIn': true } });
    res.json({ success: true, message: 'WhatsApp notifications enabled' });
  } catch (err) {
    console.error('[WhatsApp] Opt-in error:', err.message);
    res.status(500).json({ error: 'Failed to update WhatsApp preference' });
  }
});

/**
 * PUT /api/v1/whatsapp/opt-out
 * Parent opts out of WhatsApp notifications.
 */
router.put('/opt-out', authenticateParent, async (req, res) => {
  try {
    await Parent.findByIdAndUpdate(req.parent._id, {
      $set: { 'preferences.whatsappOptIn': false },
    });
    res.json({ success: true, message: 'WhatsApp notifications disabled' });
  } catch (err) {
    console.error('[WhatsApp] Opt-out error:', err.message);
    res.status(500).json({ error: 'Failed to update WhatsApp preference' });
  }
});

/**
 * GET /api/v1/whatsapp/opt-in-stats
 * Admin — count of parents who have opted in to WhatsApp for this school.
 */
router.get('/opt-in-stats', authenticate, async (req, res) => {
  try {
    const scope = buildSchoolScopedQuery(req.user.schoolId);
    const total = await Parent.countDocuments(scope);
    const optedIn = await Parent.countDocuments({ ...scope, 'preferences.whatsappOptIn': true });
    res.json({ total, optedIn, optedOut: total - optedIn });
  } catch (err) {
    console.error('[WhatsApp] Opt-in stats error:', err.message);
    res.status(500).json({ error: 'Failed to fetch WhatsApp opt-in stats' });
  }
});

export default router;
