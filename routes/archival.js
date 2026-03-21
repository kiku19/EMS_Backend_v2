/**
 * Archival Routes — DR-05
 *
 * Super-admin-only endpoints for managing the data archival strategy.
 * All routes require authenticate + requireSuperAdmin middleware.
 *
 * GET  /archival/eligible-schools     — Schools older than 3 years (archival candidates)
 * GET  /archival                      — List archive records (paginated, filterable)
 * POST /archival/run                  — Trigger an archival pass now
 * GET  /archival/:id/download         — Download archived data as JSON
 * DELETE /archival/:id                — Delete an archive record
 */

import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { authenticate, requireSuperAdmin } from '../middleware/auth.js';
import ArchiveRecord from '../models/ArchiveRecord.js';
import { runArchival, getEligibleSchools } from '../services/archivalService.js';

const router = express.Router();

router.use(authenticate, requireSuperAdmin);

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const archivalListQuerySchema = z.object({
  schoolId: z.string().optional(),
  archiveType: z.enum(['attendance', 'results', 'feePayments', 'feeRefunds', 'remarks']).optional(),
  status: z.enum(['completed', 'failed']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const archivalRunSchema = z.object({
  dryRun: z.boolean().optional().default(false),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /archival/eligible-schools
 * Returns schools whose createdAt is more than 3 years ago.
 */
router.get('/eligible-schools', async (_req, res) => {
  try {
    const schools = await getEligibleSchools();
    res.json({ schools, total: schools.length });
  } catch (err) {
    console.error('[Archival] eligible-schools error:', err);
    res.status(500).json({ error: 'Failed to load eligible schools' });
  }
});

/**
 * GET /archival
 * List archive records with optional filters and pagination.
 * Query params: schoolId, archiveType, status, page, limit
 */
router.get('/', async (req, res) => {
  const parsed = archivalListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
  }

  const { schoolId, archiveType, status, page, limit } = parsed.data;
  const filter = {};

  if (schoolId) {
    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(400).json({ error: 'Invalid schoolId' });
    }
    filter.schoolId = new mongoose.Types.ObjectId(schoolId);
  }

  if (archiveType) filter.archiveType = archiveType;
  if (status) filter.status = status;

  try {
    const skip = (page - 1) * limit;
    const [records, total] = await Promise.all([
      ArchiveRecord.find(filter)
        .select('-data')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ArchiveRecord.countDocuments(filter),
    ]);

    res.json({ records, total, page, limit });
  } catch (err) {
    console.error('[Archival] list error:', err);
    res.status(500).json({ error: 'Failed to list archive records' });
  }
});

/**
 * POST /archival/run
 * Trigger an archival pass immediately.
 * Body: { dryRun?: boolean }
 *
 * dryRun=true returns eligible schools and record counts without moving data.
 */
router.post('/run', async (req, res) => {
  const parsed = archivalRunSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
  }

  const { dryRun } = parsed.data;
  const triggeredBy = req.user?.email || req.user?.name || 'super-admin';

  try {
    if (dryRun) {
      const schools = await getEligibleSchools();
      return res.json({
        dryRun: true,
        eligibleSchools: schools.length,
        schools: schools.map((s) => ({
          schoolId: s._id,
          name: s.name,
          code: s.code,
          createdAt: s.createdAt,
        })),
        message: 'Dry run complete. No data was archived.',
      });
    }

    const result = await runArchival(triggeredBy);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Archival] run error:', err);
    res.status(500).json({ error: 'Archival run failed', detail: err.message });
  }
});

/**
 * GET /archival/:id/download
 * Download the archived data payload as a JSON file.
 */
router.get('/:id/download', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid archive record ID' });
  }

  try {
    const record = await ArchiveRecord.findById(req.params.id).lean();
    if (!record) return res.status(404).json({ error: 'Archive record not found' });

    const dateStr = new Date(record.createdAt).toISOString().split('T')[0];
    const filename = `archive_${record.archiveType}_${dateStr}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(record.data, null, 2));
  } catch (err) {
    console.error('[Archival] download error:', err);
    res.status(500).json({ error: 'Failed to download archive record' });
  }
});

/**
 * DELETE /archival/:id
 * Permanently removes an archive record. Use only when data is no longer needed.
 */
router.delete('/:id', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid archive record ID' });
  }

  try {
    const record = await ArchiveRecord.findByIdAndDelete(req.params.id);
    if (!record) return res.status(404).json({ error: 'Archive record not found' });

    res.json({ success: true, deleted: { _id: record._id, archiveType: record.archiveType } });
  } catch (err) {
    console.error('[Archival] delete error:', err);
    res.status(500).json({ error: 'Failed to delete archive record' });
  }
});

export default router;
