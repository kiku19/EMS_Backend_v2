import express from 'express';
import mongoose from 'mongoose';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import ImportJob from '../models/ImportJob.js';
import { createLogger } from '../utils/logger.js';
import agenda from '../config/agenda.js';

const router = express.Router();
router.use(authenticate);
const logger = createLogger('Jobs');

// GET /jobs/stats — summary counts by status
router.get('/stats', checkPermission('settings', 'view'), async (req, res) => {
  try {
    const schoolId = extractSchoolId(req.user?.schoolId);
    if (!schoolId) return res.status(400).json({ error: req.t('common:errors.unauthorized') });

    const [importStats] = await ImportJob.aggregate([
      { $match: { schoolId: new mongoose.Types.ObjectId(schoolId) } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]);

    const importStatsByStatus = await ImportJob.aggregate([
      { $match: { schoolId: new mongoose.Types.ObjectId(schoolId) } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]);

    const statusCounts = { queued: 0, running: 0, completed: 0, failed: 0, rolled_back: 0 };
    for (const s of importStatsByStatus) {
      if (s._id in statusCounts) statusCounts[s._id] = s.count;
    }

    // Count Agenda system jobs
    let systemJobStats = { total: 0, running: 0, scheduled: 0, failed: 0 };
    try {
      const db = mongoose.connection.db;
      const jobsCollection = db.collection(process.env.AGENDA_DB_COLLECTION || 'jobs');
      const [total, running, failed] = await Promise.all([
        jobsCollection.countDocuments({}),
        jobsCollection.countDocuments({
          lockedAt: { $ne: null },
          lastFinishedAt: { $not: { $gt: '$lockedAt' } },
        }),
        jobsCollection.countDocuments({ failedAt: { $ne: null } }),
      ]);
      systemJobStats = { total, running, scheduled: total - running - failed, failed };
    } catch (_) {
      // Agenda collection may not exist yet
    }

    res.json({
      importJobs: {
        ...statusCounts,
        total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
      },
      systemJobs: systemJobStats,
    });
  } catch (err) {
    logger.error({ err }, 'Job stats error');
    res.status(500).json({ error: err.message });
  }
});

// GET /jobs — list import jobs + system jobs
router.get('/', checkPermission('settings', 'view'), async (req, res) => {
  try {
    const schoolId = extractSchoolId(req.user?.schoolId);
    if (!schoolId) return res.status(400).json({ error: req.t('common:errors.unauthorized') });

    const { status, type, limit = 20, page = 1 } = req.query;
    const filter = { schoolId };
    if (status) filter.status = status;
    if (type) filter.type = type;

    const skip = (Number(page) - 1) * Number(limit);
    const [importJobs, total] = await Promise.all([
      ImportJob.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate('initiatedBy', 'name email')
        .lean(),
      ImportJob.countDocuments(filter),
    ]);

    // Fetch recent system (Agenda) jobs
    let systemJobs = [];
    try {
      const db = mongoose.connection.db;
      const jobsCollection = db.collection(process.env.AGENDA_DB_COLLECTION || 'jobs');
      systemJobs = await jobsCollection
        .find({})
        .sort({ lastRunAt: -1, nextRunAt: 1 })
        .limit(50)
        .toArray();
      // Sanitise for client — remove large data blobs
      systemJobs = systemJobs.map((j) => ({
        _id: j._id,
        name: j.name,
        type: j.type || 'normal',
        priority: j.priority,
        nextRunAt: j.nextRunAt,
        lastRunAt: j.lastRunAt,
        lastFinishedAt: j.lastFinishedAt,
        lockedAt: j.lockedAt,
        failedAt: j.failedAt,
        failReason: j.failReason,
        repeatInterval: j.repeatInterval,
        repeatTimezone: j.repeatTimezone,
        status:
          j.lockedAt && !j.lastFinishedAt
            ? 'running'
            : j.failedAt
              ? 'failed'
              : j.nextRunAt
                ? 'scheduled'
                : 'completed',
      }));
    } catch (_) {
      // Agenda collection may not exist yet
    }

    res.json({
      importJobs,
      total,
      page: Number(page),
      limit: Number(limit),
      systemJobs,
    });
  } catch (err) {
    logger.error({ err }, 'Jobs list error');
    res.status(500).json({ error: err.message });
  }
});

// GET /jobs/import/:jobId — import job detail
router.get(
  '/import/:jobId',
  checkPermission('settings', 'view'),
  async (req, res) => {
    try {
      const schoolId = extractSchoolId(req.user?.schoolId);
      if (!schoolId) return res.status(400).json({ error: req.t('common:errors.unauthorized') });
      if (!mongoose.Types.ObjectId.isValid(req.params.jobId)) {
        return res.status(400).json({ error: 'Invalid jobId' });
      }

      const job = await ImportJob.findOne({ _id: req.params.jobId, schoolId })
        .populate('initiatedBy', 'name email')
        .lean();
      if (!job) return res.status(404).json({ error: 'Job not found' });

      res.json({ job });
    } catch (err) {
      logger.error({ err }, 'Import job detail error');
      res.status(500).json({ error: err.message });
    }
  }
);

// DELETE /jobs/import/:jobId — cancel a queued import job
router.delete(
  '/import/:jobId',
  checkPermission('settings', 'delete'),
  async (req, res) => {
    try {
      const schoolId = extractSchoolId(req.user?.schoolId);
      if (!schoolId) return res.status(400).json({ error: req.t('common:errors.unauthorized') });
      if (!mongoose.Types.ObjectId.isValid(req.params.jobId)) {
        return res.status(400).json({ error: 'Invalid jobId' });
      }

      const job = await ImportJob.findOne({ _id: req.params.jobId, schoolId });
      if (!job) return res.status(404).json({ error: 'Job not found' });
      if (!['queued', 'running'].includes(job.status)) {
        return res.status(400).json({ error: 'Only queued or running jobs can be cancelled' });
      }

      job.status = 'failed';
      job.errorMessage = 'Cancelled by user';
      job.completedAt = new Date();
      await job.save();

      // Also cancel in Agenda if queued
      try {
        await agenda.cancel({ 'data.jobId': req.params.jobId });
      } catch (_) {
        // Agenda may not be running
      }

      res.json({ message: 'Job cancelled', jobId: job._id });
    } catch (err) {
      logger.error({ err }, 'Cancel job error');
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
