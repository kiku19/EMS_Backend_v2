/**
 * @swagger
 * tags:
 *   name: Webhooks
 *   description: |
 *     Outbound webhook subscriptions. EMS POSTs a signed JSON payload to your URL
 *     whenever a subscribed event fires.
 *
 *     **Signature verification** — every delivery includes an `X-EMS-Signature-256`
 *     header containing `sha256=<HMAC-SHA256 of raw body using your webhook secret>`.
 *     Always verify this header before processing the payload.
 */

/**
 * @swagger
 * /webhooks:
 *   get:
 *     summary: List all webhooks for the school
 *     tags: [Webhooks]
 *     responses:
 *       200:
 *         description: Array of webhooks (secret field excluded)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/WebhookBase'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */

/**
 * @swagger
 * /webhooks:
 *   post:
 *     summary: Create a webhook subscription
 *     description: |
 *       Creates a new webhook. The `secret` field is returned **only in this response** —
 *       store it securely. It will not be accessible again via the API.
 *       If you omit `secret`, one is auto-generated for you.
 *     tags: [Webhooks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateWebhookRequest'
 *     responses:
 *       201:
 *         description: Webhook created — includes `secret` (shown once only)
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/WebhookBase'
 *                 - type: object
 *                   properties:
 *                     secret:
 *                       type: string
 *                       description: HMAC signing secret — store this, it won't be shown again
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */

/**
 * @swagger
 * /webhooks/events:
 *   get:
 *     summary: List all supported event types
 *     tags: [Webhooks]
 *     responses:
 *       200:
 *         description: Array of event type strings
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: string
 *               example:
 *                 - student.created
 *                 - student.updated
 *                 - fee.paid
 *                 - attendance.marked
 *                 - exam.published
 *                 - result.entered
 *                 - staff.created
 *                 - announcement.sent
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @swagger
 * /webhooks/{id}:
 *   get:
 *     summary: Get a single webhook
 *     tags: [Webhooks]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: Webhook detail (secret excluded)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WebhookBase'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */

/**
 * @swagger
 * /webhooks/{id}:
 *   put:
 *     summary: Update a webhook
 *     tags: [Webhooks]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateWebhookRequest'
 *     responses:
 *       200:
 *         description: Updated webhook (secret excluded)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WebhookBase'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */

/**
 * @swagger
 * /webhooks/{id}:
 *   delete:
 *     summary: Delete a webhook and its delivery logs
 *     tags: [Webhooks]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: Webhook deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessMessage'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */

/**
 * @swagger
 * /webhooks/{id}/test:
 *   post:
 *     summary: Send a test delivery to the webhook URL
 *     description: Fires a `ping` event to verify the endpoint is reachable and the signature validates correctly.
 *     tags: [Webhooks]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: Test delivery result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: 'Test delivery succeeded' }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */

/**
 * @swagger
 * /webhooks/{id}/logs:
 *   get:
 *     summary: Get delivery logs for a webhook
 *     tags: [Webhooks]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *       - $ref: '#/components/parameters/PageQuery'
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 20
 *     responses:
 *       200:
 *         description: Paginated delivery logs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 logs:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/WebhookDeliveryLog'
 *                 total: { type: integer, example: 87 }
 *                 page: { type: integer, example: 1 }
 *                 limit: { type: integer, example: 20 }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */

/**
 * @swagger
 * /webhooks/{id}/dead-letter:
 *   get:
 *     summary: Get dead letter queue for a webhook
 *     description: Returns deliveries that exhausted all retries and were moved to the dead letter queue.
 *     tags: [Webhooks]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: Array of dead-letter items
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   event: { type: string, example: 'fee.paid' }
 *                   payload: { type: object }
 *                   failedAt: { type: string, format: date-time }
 *                   lastError: { type: string }
 *                   attemptCount: { type: integer, example: 5 }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 *   delete:
 *     summary: Clear dead letter queue
 *     tags: [Webhooks]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: Dead letter queue cleared
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessMessage'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */

import crypto from 'crypto';
import express from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import Webhook, { WEBHOOK_EVENTS_LIST } from '../models/Webhook.js';
import WebhookDeliveryLog from '../models/WebhookDeliveryLog.js';
import { buildSchoolScopedQuery } from '../utils/schoolContext.js';
import { sendTestWebhook } from '../services/webhookService.js';

const router = express.Router();
router.use(authenticate);

const webhookCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: z.string().url('Must be a valid URL'),
  secret: z.string().min(8).max(256).optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS_LIST)).min(1, 'Select at least one event'),
  isActive: z.boolean().optional().default(true),
});

const webhookUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  url: z.string().url('Must be a valid URL').optional(),
  secret: z.string().min(8).max(256).optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS_LIST)).min(1).optional(),
  isActive: z.boolean().optional(),
});

function generateSecret() {
  return crypto.randomBytes(32).toString('hex');
}

// GET /api/v1/webhooks - list all webhooks for the school
router.get('/', async (req, res) => {
  try {
    const scope = buildSchoolScopedQuery(req.user.schoolId);
    const webhooks = await Webhook.find(scope)
      .select('-secret -deadLetterQueue')
      .sort({ createdAt: -1 })
      .lean();
    res.json(webhooks);
  } catch (err) {
    console.error('[Webhooks] List error:', err);
    res.status(500).json({ error: 'Failed to fetch webhooks' });
  }
});

// POST /api/v1/webhooks - create a webhook
router.post('/', async (req, res) => {
  const parsed = webhookCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: parsed.error.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
    });
  }

  try {
    const { name, url, secret, events, isActive } = parsed.data;
    const webhook = await Webhook.create({
      schoolId: req.user.schoolId,
      name,
      url,
      secret: secret || generateSecret(),
      events,
      isActive,
    });

    // Return secret only on creation so admin can record it
    res.status(201).json(webhook);
  } catch (err) {
    console.error('[Webhooks] Create error:', err);
    res.status(500).json({ error: 'Failed to create webhook' });
  }
});

// GET /api/v1/webhooks/events - list supported event types
router.get('/events', (req, res) => {
  res.json(WEBHOOK_EVENTS_LIST);
});

// GET /api/v1/webhooks/:id - get a single webhook
router.get('/:id', async (req, res) => {
  try {
    const scope = buildSchoolScopedQuery(req.user.schoolId);
    const webhook = await Webhook.findOne({ _id: req.params.id, ...scope })
      .select('-secret')
      .lean();

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }
    res.json(webhook);
  } catch (err) {
    console.error('[Webhooks] Get error:', err);
    res.status(500).json({ error: 'Failed to fetch webhook' });
  }
});

// PUT /api/v1/webhooks/:id - update a webhook
router.put('/:id', async (req, res) => {
  const parsed = webhookUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: parsed.error.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
    });
  }

  try {
    const scope = buildSchoolScopedQuery(req.user.schoolId);
    const updates = { ...parsed.data };

    const webhook = await Webhook.findOneAndUpdate(
      { _id: req.params.id, ...scope },
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-secret');

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }
    res.json(webhook);
  } catch (err) {
    console.error('[Webhooks] Update error:', err);
    res.status(500).json({ error: 'Failed to update webhook' });
  }
});

// DELETE /api/v1/webhooks/:id - delete a webhook
router.delete('/:id', async (req, res) => {
  try {
    const scope = buildSchoolScopedQuery(req.user.schoolId);
    const webhook = await Webhook.findOneAndDelete({ _id: req.params.id, ...scope });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    // Clean up delivery logs
    await WebhookDeliveryLog.deleteMany({ webhookId: req.params.id });

    res.json({ success: true, message: 'Webhook deleted' });
  } catch (err) {
    console.error('[Webhooks] Delete error:', err);
    res.status(500).json({ error: 'Failed to delete webhook' });
  }
});

// POST /api/v1/webhooks/:id/test - send a test delivery
router.post('/:id/test', async (req, res) => {
  try {
    const scope = buildSchoolScopedQuery(req.user.schoolId);
    const webhook = await Webhook.findOne({ _id: req.params.id, ...scope });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const success = await sendTestWebhook(webhook);
    res.json({
      success,
      message: success ? 'Test delivery succeeded' : 'Test delivery failed — check delivery logs',
    });
  } catch (err) {
    console.error('[Webhooks] Test error:', err);
    res.status(500).json({ error: 'Failed to send test webhook' });
  }
});

// GET /api/v1/webhooks/:id/logs - get delivery logs for a webhook
router.get('/:id/logs', async (req, res) => {
  try {
    const scope = buildSchoolScopedQuery(req.user.schoolId);
    // Verify webhook belongs to school
    const webhook = await Webhook.exists({ _id: req.params.id, ...scope });
    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);

    const logs = await WebhookDeliveryLog.find({ webhookId: req.params.id })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const total = await WebhookDeliveryLog.countDocuments({ webhookId: req.params.id });

    res.json({ logs, total, page, limit });
  } catch (err) {
    console.error('[Webhooks] Logs error:', err);
    res.status(500).json({ error: 'Failed to fetch delivery logs' });
  }
});

// GET /api/v1/webhooks/:id/dead-letter - get dead letter queue
router.get('/:id/dead-letter', async (req, res) => {
  try {
    const scope = buildSchoolScopedQuery(req.user.schoolId);
    const webhook = await Webhook.findOne({ _id: req.params.id, ...scope })
      .select('deadLetterQueue name')
      .lean();

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    res.json(webhook.deadLetterQueue || []);
  } catch (err) {
    console.error('[Webhooks] Dead letter error:', err);
    res.status(500).json({ error: 'Failed to fetch dead letter queue' });
  }
});

// DELETE /api/v1/webhooks/:id/dead-letter - clear dead letter queue
router.delete('/:id/dead-letter', async (req, res) => {
  try {
    const scope = buildSchoolScopedQuery(req.user.schoolId);
    const webhook = await Webhook.findOneAndUpdate(
      { _id: req.params.id, ...scope },
      { $set: { deadLetterQueue: [] } },
      { new: true }
    ).select('name deadLetterQueue');

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    res.json({ success: true, message: 'Dead letter queue cleared' });
  } catch (err) {
    console.error('[Webhooks] Clear dead letter error:', err);
    res.status(500).json({ error: 'Failed to clear dead letter queue' });
  }
});

export default router;
