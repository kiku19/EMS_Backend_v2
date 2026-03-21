/**
 * GDPR & Data Retention Routes
 *
 * Endpoints:
 *   GET    /gdpr/export/:entityType/:entityId        — Full data export (JSON or CSV)
 *   POST   /gdpr/erasure-requests                   — Submit right-to-erasure request
 *   GET    /gdpr/erasure-requests                   — List erasure requests
 *   GET    /gdpr/erasure-requests/:id               — Get single erasure request
 *   PUT    /gdpr/erasure-requests/:id/review        — Approve or reject erasure request
 *   POST   /gdpr/erasure-requests/:id/execute       — Execute approved erasure
 *   GET    /gdpr/consent/:entityType/:entityId      — Get consent records for an entity
 *   POST   /gdpr/consent                            — Record / update a consent
 *   GET    /gdpr/retention-policies                 — Get retention policies for this school
 *   PUT    /gdpr/retention-policies                 — Upsert one or more retention policies
 *   GET    /gdpr/dashboard                          — Retention status summary
 *   GET    /gdpr/dpa                                — Get current DPA template + school acceptance status
 *   POST   /gdpr/dpa/accept                         — Record school admin's acceptance of the DPA
 */

import express from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { validateZod } from '../middleware/validation.js';
import { buildSchoolScopedQuery } from '../utils/schoolContext.js';
import { isCoppaApplicable } from '../utils/coppaUtils.js';
import { exportEntityData, flattenForCsv } from '../services/gdprExportService.js';
import { permanentlyDeleteStudentData } from '../services/studentDataErasureService.js';
import { permanentlyDeleteStaffData } from '../services/staffDeletionService.js';
import ErasureRequest from '../models/ErasureRequest.js';
import ConsentRecord from '../models/ConsentRecord.js';
import RetentionPolicy, {
  DEFAULT_RETENTION_MONTHS,
  ENTITY_TYPES,
} from '../models/RetentionPolicy.js';
import DPARecord from '../models/DPARecord.js';
import { Student, Staff } from '../database.js';
import TrashItem from '../models/TrashItem.js';

const router = express.Router();

// All GDPR endpoints require authentication
router.use(authenticate);

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const ENTITY_TYPES_EXPORT = ['Student', 'Staff'];

const erasureRequestSchema = z.object({
  entityType: z.enum(['Student', 'Staff', 'Parent']),
  entityId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid entity ID'),
  reason: z.string().min(10, 'Reason must be at least 10 characters').max(1000),
});

const reviewErasureSchema = z.object({
  action: z.enum(['approve', 'reject']),
  reviewNote: z.string().max(1000).optional(),
});

const consentSchema = z.object({
  entityType: z.enum(['Student', 'Parent', 'Staff']),
  entityId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid entity ID'),
  consentType: z.enum([
    'data_collection',
    'marketing',
    'photo_usage',
    'data_sharing',
    'biometric',
    'parental_consent_for_under_13',
  ]),
  granted: z.boolean(),
  source: z.enum(['online_form', 'paper_form', 'verbal', 'admin_recorded']).optional(),
  notes: z.string().max(500).optional(),
});

const retentionPolicySchema = z.object({
  policies: z
    .array(
      z.object({
        entityType: z.enum(ENTITY_TYPES),
        retentionMonths: z.number().int().min(1).max(120),
        description: z.string().max(500).optional(),
      })
    )
    .min(1),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toCSV(rows) {
  if (!rows.length) return '';
  const allKeys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  function esc(v) {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  }
  const header = allKeys.map(esc).join(',');
  const dataLines = rows.map((row) => allKeys.map((k) => esc(row[k] ?? '')).join(','));
  return [header, ...dataLines].join('\n');
}

async function resolveEntityName(entityType, entityId, schoolId) {
  if (entityType === 'Student') {
    const s = await Student.findOne({ _id: entityId, schoolId }).select('name').lean();
    return s?.name || 'Unknown Student';
  }
  if (entityType === 'Staff') {
    const s = await Staff.findOne({ _id: entityId, schoolId }).select('name').lean();
    return s?.name || 'Unknown Staff';
  }
  return 'Unknown';
}

// ─── Data Export ──────────────────────────────────────────────────────────────

/**
 * GET /gdpr/export/:entityType/:entityId?format=json|csv
 * Exports all personal data for a Student or Staff member.
 * Requires admin permission.
 */
router.get(
  '/export/:entityType/:entityId',
  checkPermission('students', 'view'),
  async (req, res) => {
    try {
      const { entityType, entityId } = req.params;
      const format = req.query.format === 'csv' ? 'csv' : 'json';
      const schoolId = req.user.schoolId;

      if (!ENTITY_TYPES_EXPORT.includes(entityType)) {
        return res.status(400).json({
          success: false,
          message: `entityType must be one of: ${ENTITY_TYPES_EXPORT.join(', ')}`,
        });
      }

      const data = await exportEntityData(entityType, entityId, schoolId);
      if (!data) {
        return res.status(404).json({ success: false, message: `${entityType} not found` });
      }

      if (format === 'csv') {
        const rows = flattenForCsv(data, entityType);
        const csv = toCSV(rows);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="gdpr-export-${entityType.toLowerCase()}-${entityId}.csv"`
        );
        return res.send(csv);
      }

      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="gdpr-export-${entityType.toLowerCase()}-${entityId}.json"`
      );
      return res.json({ success: true, entityType, entityId, exportedAt: new Date(), data });
    } catch (err) {
      console.error('[GDPR] Export error:', err);
      res.status(500).json({ success: false, message: 'Export failed', error: err.message });
    }
  }
);

// ─── Erasure Requests ─────────────────────────────────────────────────────────

/**
 * POST /gdpr/erasure-requests
 * Submit a right-to-erasure request for review.
 */
router.post('/erasure-requests', validateZod(erasureRequestSchema), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const requestedBy = req.user._id || req.user.id;
    const { entityType, entityId, reason } = req.body;

    // Check for existing pending/approved request
    const existing = await ErasureRequest.findOne(
      buildSchoolScopedQuery(schoolId, {
        entityType,
        entityId,
        status: { $in: ['pending', 'approved'] },
      })
    );
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'An active erasure request already exists for this entity',
        existingRequestId: existing._id,
      });
    }

    const entityName = await resolveEntityName(entityType, entityId, schoolId);

    const request = await ErasureRequest.create({
      schoolId,
      entityType,
      entityId,
      entityName,
      reason,
      requestedBy,
      status: 'pending',
    });

    res.status(201).json({ success: true, request });
  } catch (err) {
    console.error('[GDPR] Create erasure request error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /gdpr/erasure-requests
 * List erasure requests for this school. Query: ?status=pending&entityType=Student
 */
router.get('/erasure-requests', checkPermission('students', 'view'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const query = buildSchoolScopedQuery(schoolId);

    if (req.query.status) query.status = req.query.status;
    if (req.query.entityType) query.entityType = req.query.entityType;

    const requests = await ErasureRequest.find(query)
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('requestedBy', 'name email')
      .populate('reviewedBy', 'name email')
      .lean();

    res.json({ success: true, requests });
  } catch (err) {
    console.error('[GDPR] List erasure requests error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /gdpr/erasure-requests/:id
 */
router.get('/erasure-requests/:id', checkPermission('students', 'view'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const request = await ErasureRequest.findOne(
      buildSchoolScopedQuery(schoolId, { _id: req.params.id })
    )
      .populate('requestedBy', 'name email')
      .populate('reviewedBy', 'name email')
      .lean();

    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    res.json({ success: true, request });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * PUT /gdpr/erasure-requests/:id/review
 * Approve or reject an erasure request. Admin only.
 */
router.put(
  '/erasure-requests/:id/review',
  checkPermission('students', 'delete'),
  validateZod(reviewErasureSchema),
  async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      const reviewedBy = req.user._id || req.user.id;
      const { action, reviewNote } = req.body;

      const request = await ErasureRequest.findOne(
        buildSchoolScopedQuery(schoolId, { _id: req.params.id, status: 'pending' })
      );
      if (!request) {
        return res.status(404).json({
          success: false,
          message: 'Pending erasure request not found',
        });
      }

      request.status = action === 'approve' ? 'approved' : 'rejected';
      request.reviewedBy = reviewedBy;
      request.reviewNote = reviewNote;
      request.reviewedAt = new Date();
      await request.save();

      res.json({ success: true, request });
    } catch (err) {
      console.error('[GDPR] Review erasure request error:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

/**
 * POST /gdpr/erasure-requests/:id/execute
 * Execute an approved erasure request. Admin only.
 * For Students: calls permanentlyDeleteStudentData.
 * For Staff: calls permanentlyDeleteStaffData for full cascade purge.
 */
router.post(
  '/erasure-requests/:id/execute',
  checkPermission('students', 'delete'),
  async (req, res) => {
    try {
      const schoolId = req.user.schoolId;

      const request = await ErasureRequest.findOne(
        buildSchoolScopedQuery(schoolId, { _id: req.params.id, status: 'approved' })
      );
      if (!request) {
        return res.status(404).json({
          success: false,
          message: 'Approved erasure request not found',
        });
      }

      let deletedRecords;
      try {
        if (request.entityType === 'Student') {
          const result = await permanentlyDeleteStudentData(request.entityId);
          deletedRecords = result.deletedRecords;
        } else if (request.entityType === 'Staff') {
          const result = await permanentlyDeleteStaffData(request.entityId);
          deletedRecords = result.deletedRecords;
        } else {
          return res.status(400).json({
            success: false,
            message: `Automated erasure is not supported for entityType: ${request.entityType}`,
          });
        }
      } catch (execErr) {
        request.status = 'failed';
        request.executionError = execErr.message?.slice(0, 500);
        await request.save();
        return res.status(500).json({
          success: false,
          message: 'Erasure execution failed',
          error: execErr.message,
        });
      }

      request.status = 'executed';
      request.executedAt = new Date();
      request.deletedRecords = deletedRecords;
      await request.save();

      res.json({ success: true, message: 'Erasure executed successfully', deletedRecords });
    } catch (err) {
      console.error('[GDPR] Execute erasure error:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ─── Consent Management ───────────────────────────────────────────────────────

/**
 * GET /gdpr/consent/:entityType/:entityId
 * Get all consent records for a specific entity.
 */
router.get('/consent/:entityType/:entityId', async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const { entityType, entityId } = req.params;

    const records = await ConsentRecord.find(
      buildSchoolScopedQuery(schoolId, { entityType, entityId })
    )
      .sort({ updatedAt: -1 })
      .lean();

    res.json({ success: true, records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /gdpr/consent
 * Record or update a consent entry. Uses upsert so re-submitting the same
 * entityId+consentType updates the existing record.
 */
router.post('/consent', validateZod(consentSchema), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const recordedBy = req.user._id || req.user.id;
    const { entityType, entityId, consentType, granted, source, notes } = req.body;

    const now = new Date();
    const update = {
      schoolId,
      entityType,
      entityId,
      consentType,
      granted,
      source: source || 'admin_recorded',
      notes,
      recordedBy,
      grantedAt: granted ? now : undefined,
      revokedAt: !granted ? now : undefined,
    };

    const record = await ConsentRecord.findOneAndUpdate(
      buildSchoolScopedQuery(schoolId, { entityType, entityId, consentType }),
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({ success: true, record });
  } catch (err) {
    console.error('[GDPR] Record consent error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Retention Policies ───────────────────────────────────────────────────────

/**
 * GET /gdpr/retention-policies
 * Returns retention policies for this school, falling back to defaults for
 * any entity type not yet explicitly configured.
 */
router.get('/retention-policies', checkPermission('students', 'view'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;

    const saved = await RetentionPolicy.find(buildSchoolScopedQuery(schoolId)).lean();
    const savedMap = Object.fromEntries(saved.map((p) => [p.entityType, p]));

    const policies = ENTITY_TYPES.map((entityType) => ({
      entityType,
      retentionMonths:
        savedMap[entityType]?.retentionMonths ?? DEFAULT_RETENTION_MONTHS[entityType],
      description: savedMap[entityType]?.description ?? null,
      isDefault: !savedMap[entityType],
      updatedAt: savedMap[entityType]?.updatedAt ?? null,
    }));

    res.json({ success: true, policies });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * PUT /gdpr/retention-policies
 * Upsert one or more retention policy entries for this school.
 * Body: { policies: [{ entityType, retentionMonths, description? }] }
 */
router.put(
  '/retention-policies',
  checkPermission('students', 'delete'),
  validateZod(retentionPolicySchema),
  async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      const updatedBy = req.user._id || req.user.id;
      const { policies } = req.body;

      const upserted = await Promise.all(
        policies.map(({ entityType, retentionMonths, description }) =>
          RetentionPolicy.findOneAndUpdate(
            buildSchoolScopedQuery(schoolId, { entityType }),
            { $set: { schoolId, entityType, retentionMonths, description, updatedBy } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          )
        )
      );

      res.json({ success: true, updated: upserted.length, policies: upserted });
    } catch (err) {
      console.error('[GDPR] Update retention policies error:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ─── Retention Dashboard ──────────────────────────────────────────────────────

/**
 * GET /gdpr/dashboard
 * Returns retention status summary: policies, pending erasure requests,
 * upcoming trash purges, and consent coverage.
 */
router.get('/dashboard', checkPermission('students', 'view'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;

    const [
      savedPolicies,
      pendingErasures,
      approvedErasures,
      executedErasures,
      totalConsents,
      grantedConsents,
      expiringTrash,
    ] = await Promise.all([
      RetentionPolicy.find(buildSchoolScopedQuery(schoolId)).lean(),
      ErasureRequest.countDocuments(buildSchoolScopedQuery(schoolId, { status: 'pending' })),
      ErasureRequest.countDocuments(buildSchoolScopedQuery(schoolId, { status: 'approved' })),
      ErasureRequest.countDocuments(buildSchoolScopedQuery(schoolId, { status: 'executed' })),
      ConsentRecord.countDocuments(buildSchoolScopedQuery(schoolId)),
      ConsentRecord.countDocuments(buildSchoolScopedQuery(schoolId, { granted: true })),
      TrashItem.countDocuments({
        expiresAt: { $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }, // expiring within 7 days
      }),
    ]);

    const savedMap = Object.fromEntries(savedPolicies.map((p) => [p.entityType, p]));
    const retentionSummary = ENTITY_TYPES.map((entityType) => ({
      entityType,
      retentionMonths:
        savedMap[entityType]?.retentionMonths ?? DEFAULT_RETENTION_MONTHS[entityType],
      isDefault: !savedMap[entityType],
    }));

    res.json({
      success: true,
      dashboard: {
        retentionPolicies: retentionSummary,
        erasureRequests: {
          pending: pendingErasures,
          approved: approvedErasures,
          executed: executedErasures,
        },
        consent: {
          total: totalConsents,
          granted: grantedConsents,
          revoked: totalConsents - grantedConsents,
        },
        trash: {
          expiringWithin7Days: expiringTrash,
        },
        generatedAt: new Date(),
      },
    });
  } catch (err) {
    console.error('[GDPR] Dashboard error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Data Processing Agreement (DPA) ─────────────────────────────────────────

// Current DPA version — bump this string to require schools to re-accept
const CURRENT_DPA_VERSION = '1.0';

// Summary of what the DPA covers, returned alongside acceptance status.
// Full text lives in docs/DPA_TEMPLATE.md.
const DPA_SUMMARY = {
  version: CURRENT_DPA_VERSION,
  effectiveDate: '2026-03-01',
  title: 'Data Processing Agreement',
  description:
    'This agreement governs how the EMS platform (as Data Processor) processes personal data on behalf of your school (as Data Controller), in compliance with applicable data protection law.',
  keyClauses: [
    "Personal data is processed only on the school's documented instructions",
    'Data is encrypted at rest (AES-256) and in transit (TLS 1.2+)',
    'Role-based access control ensures strict school-level data isolation',
    'Sub-processors are listed and notified in advance of changes',
    'Data breach notification within 72 hours of discovery',
    'Full data export and right-to-erasure tools are provided within the platform',
    'Data is deleted within 30 days of subscription termination',
  ],
  subProcessors: [
    { name: 'MongoDB Atlas', purpose: 'Primary database hosting', location: 'India (ap-south-1)' },
    { name: 'Cloudinary', purpose: 'File and image storage', location: 'Global CDN' },
    { name: 'Firebase (Google LLC)', purpose: 'Push notifications', location: 'Global' },
    { name: 'SendGrid / Twilio', purpose: 'Email and SMS delivery', location: 'Global' },
    { name: 'Redis Labs', purpose: 'Session caching and queues', location: 'India region' },
  ],
  fullDocumentPath: '/docs/DPA_TEMPLATE.md',
};

const dpaAcceptSchema = z.object({
  legalEntityName: z.string().min(2).max(300).optional(),
});

/**
 * GET /gdpr/dpa
 * Returns the current DPA summary and whether this school has accepted it.
 */
router.get('/dpa', async (req, res) => {
  try {
    const schoolId = req.user.schoolId;

    const existing = await DPARecord.findOne(
      buildSchoolScopedQuery(schoolId, { version: CURRENT_DPA_VERSION })
    )
      .populate('acceptedBy', 'name email')
      .lean();

    res.json({
      success: true,
      dpa: DPA_SUMMARY,
      acceptance: existing
        ? {
            accepted: true,
            version: existing.version,
            acceptedAt: existing.acceptedAt,
            acceptedBy: existing.acceptedBy,
            acceptedByName: existing.acceptedByName,
            legalEntityName: existing.legalEntityName,
          }
        : { accepted: false },
    });
  } catch (err) {
    console.error('[GDPR] DPA get error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /gdpr/dpa/accept
 * Records that an admin has accepted the current DPA on behalf of the school.
 * Idempotent — re-accepting the same version updates the record.
 */
router.post(
  '/dpa/accept',
  checkPermission('settings', 'edit'),
  validateZod(dpaAcceptSchema),
  async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      const acceptedBy = req.user._id || req.user.id;
      const { legalEntityName } = req.body;

      const ipAddress =
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress;

      const record = await DPARecord.findOneAndUpdate(
        buildSchoolScopedQuery(schoolId, { version: CURRENT_DPA_VERSION }),
        {
          $set: {
            schoolId,
            version: CURRENT_DPA_VERSION,
            acceptedBy,
            acceptedByName: req.user.name || null,
            acceptedByEmail: req.user.email || null,
            acceptedAt: new Date(),
            ipAddress: ipAddress || null,
            legalEntityName: legalEntityName || null,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      res.status(201).json({
        success: true,
        message: `DPA version ${CURRENT_DPA_VERSION} accepted`,
        record: {
          version: record.version,
          acceptedAt: record.acceptedAt,
          acceptedByName: record.acceptedByName,
          legalEntityName: record.legalEntityName,
        },
      });
    } catch (err) {
      console.error('[GDPR] DPA accept error:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ─── COPPA Compliance Report ───────────────────────────────────────────────────

/**
 * GET /gdpr/coppa/report
 * Returns students under 13 (COPPA threshold) along with whether each has a
 * granted parental_consent_for_under_13 consent record.
 * Requires admin/staff permission on students.
 */
router.get('/coppa/report', checkPermission('students', 'view'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;

    // Fetch all students with a dateOfBirth so we can filter client-side.
    // Limiting to 1000 to avoid unbounded queries; schools with more students
    // should paginate using ?skip and ?limit if needed.
    const skip = Math.max(0, parseInt(req.query.skip, 10) || 0);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 500));

    const students = await Student.find(
      buildSchoolScopedQuery(schoolId, {
        isDeleted: { $ne: true },
        dateOfBirth: { $exists: true, $ne: '' },
      })
    )
      .select('_id name admissionId classId dateOfBirth')
      .skip(skip)
      .limit(limit)
      .lean();

    const under13 = students.filter((s) => isCoppaApplicable(s.dateOfBirth));

    if (under13.length === 0) {
      return res.json({ success: true, total: 0, students: [] });
    }

    const under13Ids = under13.map((s) => s._id);

    // Find which of these students already have a granted parental consent record
    const consentRecords = await ConsentRecord.find(
      buildSchoolScopedQuery(schoolId, {
        entityType: 'Student',
        entityId: { $in: under13Ids },
        consentType: 'parental_consent_for_under_13',
        granted: true,
      })
    )
      .select('entityId granted')
      .lean();

    const consentedSet = new Set(consentRecords.map((r) => String(r.entityId)));

    const result = under13.map((s) => ({
      _id: s._id,
      name: s.name,
      admissionId: s.admissionId,
      classId: s.classId,
      dateOfBirth: s.dateOfBirth,
      parentalConsentGranted: consentedSet.has(String(s._id)),
    }));

    res.json({
      success: true,
      total: result.length,
      consentGranted: consentedSet.size,
      consentPending: result.length - consentedSet.size,
      students: result,
    });
  } catch (err) {
    console.error('[GDPR] COPPA report error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
