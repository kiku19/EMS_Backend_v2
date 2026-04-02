/**
 * @swagger
 * tags:
 *   name: API Keys
 *   description: |
 *     Machine-to-machine API key management. API keys allow external integrations
 *     (e.g., Tally, custom dashboards) to access the EMS API without user sessions.
 *
 *     **Authentication** — include the raw key in the `Authorization` header:
 *     ```
 *     Authorization: Bearer ems_<key>
 *     ```
 *
 *     **Security notes**
 *     - Raw keys are returned **once** at creation time and are never stored.
 *     - Keys are rate-limited per hour (default 1 000 req/h).
 *     - Use `POST /{id}/rotate` for zero-downtime key rotation (24-hour grace period for the old key).
 *     - Use `POST /{id}/revoke` for immediate revocation.
 */

/**
 * @swagger
 * /api-keys:
 *   get:
 *     summary: List all API keys for the school
 *     tags: [API Keys]
 *     responses:
 *       200:
 *         description: Array of API key records (keyHash fields excluded)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ApiKeyBase'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */

/**
 * @swagger
 * /api-keys/scopes:
 *   get:
 *     summary: List available permission scopes
 *     tags: [API Keys]
 *     responses:
 *       200:
 *         description: Array of scope strings
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: string
 *               example:
 *                 - read:all
 *                 - read:students
 *                 - read:fees
 *                 - read:attendance
 *                 - read:academics
 *                 - read:staff
 *                 - write:fees
 *                 - write:attendance
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @swagger
 * /api-keys/{id}:
 *   get:
 *     summary: Get a single API key
 *     tags: [API Keys]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: API key detail (keyHash excluded)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiKeyBase'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */

/**
 * @swagger
 * /api-keys:
 *   post:
 *     summary: Create a new API key
 *     description: |
 *       Creates a new API key. The `rawKey` field in the response is the full key value
 *       and is returned **only once**. Store it securely — it cannot be retrieved again.
 *     tags: [API Keys]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateApiKeyRequest'
 *     responses:
 *       201:
 *         description: API key created — includes `rawKey` (shown once only)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CreateApiKeyResponse'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */

/**
 * @swagger
 * /api-keys/{id}:
 *   put:
 *     summary: Update an API key
 *     description: Update name, scopes, rate limit, expiry, or active status. Partial updates supported.
 *     tags: [API Keys]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateApiKeyRequest'
 *     responses:
 *       200:
 *         description: Updated API key
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiKeyBase'
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
 * /api-keys/{id}/rotate:
 *   post:
 *     summary: Rotate an API key (zero-downtime)
 *     description: |
 *       Generates a new key and invalidates the old one after a **24-hour grace period**.
 *       During the grace period both the old and new key are accepted, giving you time to
 *       update your integration without downtime.
 *
 *       The new `rawKey` is returned once — store it immediately.
 *     tags: [API Keys]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: New raw key and grace period expiry
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 rawKey:
 *                   type: string
 *                   description: New full API key — save immediately
 *                   example: 'ems_newkeyvalue...'
 *                 keyPrefix:
 *                   type: string
 *                   example: 'newprefix'
 *                 previousKeyExpiresAt:
 *                   type: string
 *                   format: date-time
 *                   description: When the old key stops being accepted
 *                 _warning:
 *                   type: string
 *                   example: 'Save this new key now — it will not be shown again. The old key remains valid for 24 hours.'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */

/**
 * @swagger
 * /api-keys/{id}/revoke:
 *   post:
 *     summary: Revoke an API key immediately
 *     description: Permanently disables the key. Unlike rotation, there is no grace period — the key stops working instantly.
 *     tags: [API Keys]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: Key revoked
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 revokedAt: { type: string, format: date-time }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */

/**
 * @swagger
 * /api-keys/{id}:
 *   delete:
 *     summary: Permanently delete an API key
 *     description: Hard-deletes the key record. Use `revoke` instead if you may need audit history.
 *     tags: [API Keys]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: Key deleted
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

import express from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import ApiKey, {
  API_KEY_SCOPES,
  generateApiKey,
  getKeyPrefix,
  hashApiKey,
} from '../models/ApiKey.js';
import { buildSchoolScopedQuery } from '../utils/schoolContext.js';

const router = express.Router();
router.use(authenticate);

const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours

const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1, 'Select at least one scope'),
  rateLimitPerHour: z.number().int().min(1).max(100000).optional().default(1000),
  expiresAt: z.string().datetime().optional(),
});

const apiKeyUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).optional(),
  rateLimitPerHour: z.number().int().min(1).max(100000).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  isActive: z.boolean().optional(),
});

// Exclude sensitive fields from list responses
const SAFE_FIELDS = '-keyHash -previousKeyHash';

// GET /api/v1/api-keys — list all API keys for the school
router.get('/', async (req, res) => {
  try {
    const scope = buildSchoolScopedQuery(req.user.schoolId);
    const keys = await ApiKey.find(scope).select(SAFE_FIELDS).sort({ createdAt: -1 }).lean();
    res.json(keys);
  } catch (err) {
    console.error('[ApiKeys] List error:', err);
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

// GET /api/v1/api-keys/scopes — list available scopes
router.get('/scopes', (req, res) => {
  res.json(API_KEY_SCOPES);
});

// GET /api/v1/api-keys/:id — get a single API key
router.get('/:id', async (req, res) => {
  try {
    const scope = buildSchoolScopedQuery(req.user.schoolId);
    const key = await ApiKey.findOne({ _id: req.params.id, ...scope })
      .select(SAFE_FIELDS)
      .lean();

    if (!key) {
      return res.status(404).json({ error: 'API key not found' });
    }
    res.json(key);
  } catch (err) {
    console.error('[ApiKeys] Get error:', err);
    res.status(500).json({ error: 'Failed to fetch API key' });
  }
});

// POST /api/v1/api-keys — create an API key
// The raw key is returned ONCE in the response — it is not stored.
router.post('/', async (req, res) => {
  const parsed = apiKeyCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: parsed.error.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
    });
  }

  try {
    const { name, scopes, rateLimitPerHour, expiresAt } = parsed.data;
    const rawKey = generateApiKey();
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = getKeyPrefix(rawKey);

    const apiKey = await ApiKey.create({
      schoolId: req.user.schoolId,
      name,
      keyHash,
      keyPrefix,
      scopes,
      rateLimitPerHour,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      createdBy: req.user.userId,
    });

    // Return raw key ONCE — after this point it cannot be recovered
    res.status(201).json({
      ...apiKey.toObject(),
      rawKey,
      _warning: 'Save this key now — it will not be shown again.',
    });
  } catch (err) {
    console.error('[ApiKeys] Create error:', err);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// PUT /api/v1/api-keys/:id — update name, scopes, rateLimitPerHour, expiresAt, isActive
router.put('/:id', async (req, res) => {
  const parsed = apiKeyUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: parsed.error.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
    });
  }

  try {
    const scope = buildSchoolScopedQuery(req.user.schoolId);
    const updates = {};
    const { name, scopes, rateLimitPerHour, expiresAt, isActive } = parsed.data;
    if (name !== undefined) updates.name = name;
    if (scopes !== undefined) updates.scopes = scopes;
    if (rateLimitPerHour !== undefined) updates.rateLimitPerHour = rateLimitPerHour;
    if (expiresAt !== undefined) updates.expiresAt = expiresAt ? new Date(expiresAt) : null;
    if (isActive !== undefined) updates.isActive = isActive;

    const key = await ApiKey.findOneAndUpdate(
      { _id: req.params.id, ...scope },
      { $set: updates },
      { new: true, runValidators: true }
    ).select(SAFE_FIELDS);

    if (!key) {
      return res.status(404).json({ error: 'API key not found' });
    }
    res.json(key);
  } catch (err) {
    console.error('[ApiKeys] Update error:', err);
    res.status(500).json({ error: 'Failed to update API key' });
  }
});

// POST /api/v1/api-keys/:id/rotate — rotate the key
// Old key stays valid for 24 hours (grace period) after rotation.
router.post('/:id/rotate', async (req, res) => {
  try {
    const scope = buildSchoolScopedQuery(req.user.schoolId);
    const existing = await ApiKey.findOne({ _id: req.params.id, ...scope });

    if (!existing) {
      return res.status(404).json({ error: 'API key not found' });
    }

    const rawKey = generateApiKey();
    const newHash = hashApiKey(rawKey);
    const newPrefix = getKeyPrefix(rawKey);

    await ApiKey.findByIdAndUpdate(existing._id, {
      $set: {
        keyHash: newHash,
        keyPrefix: newPrefix,
        previousKeyHash: existing.keyHash,
        previousKeyExpiresAt: new Date(Date.now() + GRACE_PERIOD_MS),
        isActive: true,
        revokedAt: undefined,
      },
    });

    res.json({
      rawKey,
      keyPrefix: newPrefix,
      previousKeyExpiresAt: new Date(Date.now() + GRACE_PERIOD_MS),
      _warning:
        'Save this new key now — it will not be shown again. The old key remains valid for 24 hours.',
    });
  } catch (err) {
    console.error('[ApiKeys] Rotate error:', err);
    res.status(500).json({ error: 'Failed to rotate API key' });
  }
});

// POST /api/v1/api-keys/:id/revoke — revoke immediately (no grace period)
router.post('/:id/revoke', async (req, res) => {
  try {
    const scope = buildSchoolScopedQuery(req.user.schoolId);
    const key = await ApiKey.findOneAndUpdate(
      { _id: req.params.id, ...scope },
      {
        $set: {
          isActive: false,
          revokedAt: new Date(),
          previousKeyHash: undefined,
          previousKeyExpiresAt: undefined,
        },
      },
      { new: true }
    ).select(SAFE_FIELDS);

    if (!key) {
      return res.status(404).json({ error: 'API key not found' });
    }
    res.json({ success: true, revokedAt: key.revokedAt });
  } catch (err) {
    console.error('[ApiKeys] Revoke error:', err);
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

// DELETE /api/v1/api-keys/:id — permanently delete an API key
router.delete('/:id', async (req, res) => {
  try {
    const scope = buildSchoolScopedQuery(req.user.schoolId);
    const key = await ApiKey.findOneAndDelete({ _id: req.params.id, ...scope });

    if (!key) {
      return res.status(404).json({ error: 'API key not found' });
    }
    res.json({ success: true, message: 'API key deleted' });
  } catch (err) {
    console.error('[ApiKeys] Delete error:', err);
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

export default router;
