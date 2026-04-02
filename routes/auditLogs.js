import express from 'express';
import { z } from 'zod';
import AuditTrail from '../models/AuditTrail.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticate);

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const ACTION_ENUM = [
  'created',
  'updated',
  'deleted',
  'login',
  'logout',
  'login_failed',
  'password_changed',
  'permission_changed',
  'settings_changed',
  'role_changed',
];

const listQuerySchema = z.object({
  action: z.enum(ACTION_ENUM).optional(),
  entity: z.string().trim().optional(),
  userId: z
    .string()
    .regex(/^[a-f0-9]{24}$/i, 'Invalid userId')
    .optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const exportQuerySchema = z.object({
  format: z.enum(['csv', 'json']).default('csv'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  entity: z.string().trim().optional(),
  action: z.enum(ACTION_ENUM).optional(),
});

const purgeBodySchema = z.object({
  retentionMonths: z.coerce.number().int().min(1).max(120).default(12),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildFilter(schoolId, params) {
  const filter = { schoolId };
  if (params.action) filter.action = params.action;
  if (params.entity) filter.entity = params.entity;
  if (params.userId) filter.userId = params.userId;

  if (params.startDate || params.endDate) {
    filter.createdAt = {};
    if (params.startDate) filter.createdAt.$gte = new Date(params.startDate);
    if (params.endDate) {
      const end = new Date(params.endDate);
      end.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = end;
    }
  }
  return filter;
}

function escapeCsvField(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function logsToCsv(logs) {
  const headers = [
    'Date/Time',
    'Action',
    'Entity',
    'Entity ID',
    'Performed By',
    'User Name',
    'IP Address',
    'Path',
    'Method',
  ];
  const rows = logs.map((log) =>
    [
      log.createdAt?.toISOString() || '',
      log.action || '',
      log.entity || '',
      log.entityId || '',
      log.userId?._id?.toString() || log.userId?.toString() || '',
      log.userId?.name || log.userName || '',
      log.ipAddress || '',
      log.path || '',
      log.method || '',
    ]
      .map(escapeCsvField)
      .join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /audit-logs — paginated list (admin only)
router.get('/', requireAdmin, async (req, res) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Invalid query parameters', details: parsed.error.flatten().fieldErrors });
    }

    const { page, limit, ...filterParams } = parsed.data;
    const filter = buildFilter(req.user.schoolId, filterParams);
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      AuditTrail.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'name email role')
        .lean(),
      AuditTrail.countDocuments(filter),
    ]);

    res.json({
      logs,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// GET /audit-logs/export — CSV or JSON download (admin only)
// Must be before /:id to avoid route shadowing
router.get('/export', requireAdmin, async (req, res) => {
  try {
    const parsed = exportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Invalid query parameters', details: parsed.error.flatten().fieldErrors });
    }

    const { format, ...filterParams } = parsed.data;
    const filter = buildFilter(req.user.schoolId, filterParams);

    // Cap export at 10,000 records for safety
    const logs = await AuditTrail.find(filter)
      .sort({ createdAt: -1 })
      .limit(10000)
      .populate('userId', 'name email')
      .lean();

    const date = new Date().toISOString().split('T')[0];

    if (format === 'csv') {
      const csv = logsToCsv(logs);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${date}.csv"`);
      return res.send(csv);
    }

    // JSON format
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${date}.json"`);
    res.json(logs);
  } catch (error) {
    console.error('Error exporting audit logs:', error);
    res.status(500).json({ error: 'Failed to export audit logs' });
  }
});

// GET /audit-logs/:id — single log detail (admin only)
router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const log = await AuditTrail.findOne({
      _id: req.params.id,
      schoolId: req.user.schoolId, // school-scoped for multi-tenancy
    })
      .populate('userId', 'name email role')
      .lean();

    if (!log) return res.status(404).json({ error: 'Audit log not found' });

    res.json(log);
  } catch (error) {
    console.error('Error fetching audit log:', error);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

// POST /audit-logs/purge — manually trigger data retention purge (admin only)
router.post('/purge', requireAdmin, async (req, res) => {
  try {
    const parsed = purgeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Invalid parameters', details: parsed.error.flatten().fieldErrors });
    }

    const { purgeExpiredAuditLogs } = await import('../services/auditRetentionService.js');
    const result = await purgeExpiredAuditLogs(parsed.data.retentionMonths);

    res.json({
      success: true,
      purged: result.purged,
      retentionMonths: parsed.data.retentionMonths,
      cutoffDate: result.cutoffDate,
    });
  } catch (error) {
    console.error('Error purging audit logs:', error);
    res.status(500).json({ error: 'Failed to purge audit logs' });
  }
});

export default router;
