/**
 * @swagger
 * tags:
 *   name: Changelog
 *   description: In-app changelog and release notes
 */

/**
 * @swagger
 * /changelog:
 *   get:
 *     summary: Get published changelog entries with unread count for the current user
 *     tags: [Changelog]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: List of changelog entries with unread count
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @swagger
 * /changelog/{id}/read:
 *   put:
 *     summary: Mark a changelog entry as read for the current user
 *     tags: [Changelog]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: Marked as read
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @swagger
 * /changelog/read-all:
 *   put:
 *     summary: Mark all changelog entries as read for the current user
 *     tags: [Changelog]
 *     responses:
 *       200:
 *         description: All entries marked as read
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @swagger
 * /changelog/admin:
 *   post:
 *     summary: Create a new changelog entry (super-admin only)
 *     tags: [Changelog]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, body, version, category]
 *             properties:
 *               title:
 *                 type: string
 *               body:
 *                 type: string
 *               version:
 *                 type: string
 *               category:
 *                 type: string
 *                 enum: [new_feature, improvement, bug_fix, announcement]
 *               publishedAt:
 *                 type: string
 *                 format: date-time
 *               isPublished:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Changelog entry created
 *       400:
 *         description: Validation error
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Forbidden
 */

import express from 'express';
import { z } from 'zod';
import Changelog from '../models/Changelog.js';
import ChangelogRead from '../models/ChangelogRead.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticate);

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const createChangelogSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  body: z.string().min(1, 'Body is required').max(5000),
  version: z.string().min(1, 'Version is required').max(20),
  category: z.enum(['new_feature', 'improvement', 'bug_fix', 'announcement']),
  publishedAt: z.string().datetime().optional().nullable(),
  isPublished: z.boolean().optional().default(false),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/changelog — published entries + unread count for user
router.get('/', async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    const entries = await Changelog.find({ isPublished: true })
      .sort({ publishedAt: -1, createdAt: -1 })
      .limit(Math.min(parseInt(limit) || 20, 100))
      .lean();

    // Get IDs the user has already read
    const readRecords = await ChangelogRead.find({
      userId: req.user.id,
      userModel: 'Staff',
      changelogId: { $in: entries.map((e) => e._id) },
    }).lean();

    const readSet = new Set(readRecords.map((r) => r.changelogId.toString()));

    const enriched = entries.map((entry) => ({
      ...entry,
      isRead: readSet.has(entry._id.toString()),
    }));

    const unreadCount = enriched.filter((e) => !e.isRead).length;

    res.json({ entries: enriched, unreadCount });
  } catch (error) {
    console.error('Error fetching changelog:', error);
    res.status(500).json({ error: 'Failed to fetch changelog' });
  }
});

// PUT /api/changelog/read-all — mark all as read
router.put('/read-all', async (req, res) => {
  try {
    const publishedEntries = await Changelog.find({ isPublished: true }, '_id').lean();

    const ops = publishedEntries.map((entry) => ({
      updateOne: {
        filter: { userId: req.user.id, userModel: 'Staff', changelogId: entry._id },
        update: {
          $setOnInsert: {
            userId: req.user.id,
            userModel: 'Staff',
            changelogId: entry._id,
            readAt: new Date(),
          },
        },
        upsert: true,
      },
    }));

    if (ops.length > 0) {
      await ChangelogRead.bulkWrite(ops);
    }

    res.json({ message: 'All changelog entries marked as read' });
  } catch (error) {
    console.error('Error marking changelog as read:', error);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// PUT /api/changelog/:id/read — mark single entry as read
router.put('/:id/read', async (req, res) => {
  try {
    const entry = await Changelog.findOne({ _id: req.params.id, isPublished: true }).lean();
    if (!entry) {
      return res.status(404).json({ error: 'Changelog entry not found' });
    }

    await ChangelogRead.updateOne(
      { userId: req.user.id, userModel: 'Staff', changelogId: entry._id },
      {
        $setOnInsert: {
          userId: req.user.id,
          userModel: 'Staff',
          changelogId: entry._id,
          readAt: new Date(),
        },
      },
      { upsert: true }
    );

    res.json({ message: 'Marked as read' });
  } catch (error) {
    console.error('Error marking changelog entry as read:', error);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// ─── Admin Routes (super-admin only) ─────────────────────────────────────────

// GET /api/changelog/admin — list all entries including drafts
router.get('/admin', async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'super_admin' && role !== 'superadmin') {
      return res.status(403).json({ error: 'Super admin access required' });
    }

    const { limit = 50, page = 1 } = req.query;
    const skip = (Math.max(1, parseInt(page) || 1) - 1) * Math.min(parseInt(limit) || 50, 100);

    const [entries, total] = await Promise.all([
      Changelog.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Math.min(parseInt(limit) || 50, 100))
        .lean(),
      Changelog.countDocuments(),
    ]);

    res.json({ entries, total });
  } catch (error) {
    console.error('Error fetching admin changelog:', error);
    res.status(500).json({ error: 'Failed to fetch changelog entries' });
  }
});

// POST /api/changelog/admin — create entry
router.post('/admin', async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'super_admin' && role !== 'superadmin') {
      return res.status(403).json({ error: 'Super admin access required' });
    }

    const result = createChangelogSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Validation failed', details: result.error.errors });
    }

    const { title, body, version, category, publishedAt, isPublished } = result.data;

    const entry = new Changelog({
      title,
      body,
      version,
      category,
      isPublished,
      publishedAt: isPublished ? (publishedAt ? new Date(publishedAt) : new Date()) : null,
    });

    await entry.save();
    res.status(201).json(entry);
  } catch (error) {
    console.error('Error creating changelog entry:', error);
    res.status(500).json({ error: 'Failed to create changelog entry' });
  }
});

// PUT /api/changelog/admin/:id — update entry
router.put('/admin/:id', async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'super_admin' && role !== 'superadmin') {
      return res.status(403).json({ error: 'Super admin access required' });
    }

    const result = createChangelogSchema.partial().safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Validation failed', details: result.error.errors });
    }

    const updates = { ...result.data };
    if (updates.isPublished && !updates.publishedAt) {
      updates.publishedAt = new Date();
    }

    const entry = await Changelog.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!entry) {
      return res.status(404).json({ error: 'Changelog entry not found' });
    }

    res.json(entry);
  } catch (error) {
    console.error('Error updating changelog entry:', error);
    res.status(500).json({ error: 'Failed to update changelog entry' });
  }
});

// DELETE /api/changelog/admin/:id — delete entry
router.delete('/admin/:id', async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'super_admin' && role !== 'superadmin') {
      return res.status(403).json({ error: 'Super admin access required' });
    }

    const entry = await Changelog.findByIdAndDelete(req.params.id);
    if (!entry) {
      return res.status(404).json({ error: 'Changelog entry not found' });
    }

    await ChangelogRead.deleteMany({ changelogId: req.params.id });

    res.json({ message: 'Changelog entry deleted' });
  } catch (error) {
    console.error('Error deleting changelog entry:', error);
    res.status(500).json({ error: 'Failed to delete changelog entry' });
  }
});

export default router;
