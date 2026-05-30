/**
 * Google Classroom Sync Routes
 *
 * Endpoints:
 *   GET  /google-classroom/status                 Get integration status + current config
 *   GET  /google-classroom/auth-url               Get OAuth authorization URL
 *   POST /google-classroom/callback               Exchange OAuth code for tokens
 *   DELETE /google-classroom/disconnect           Revoke tokens and disconnect
 *   GET  /google-classroom/courses                List available Google Classroom courses
 *   GET  /google-classroom/config                 Get sync settings
 *   PUT  /google-classroom/config                 Update sync settings
 *   GET  /google-classroom/mappings               List class mappings
 *   POST /google-classroom/mappings               Create class mapping
 *   DELETE /google-classroom/mappings/:mappingId  Remove class mapping
 *   GET  /google-classroom/teacher-mappings       List teacher mappings
 *   POST /google-classroom/teacher-mappings       Create teacher mapping
 *   DELETE /google-classroom/teacher-mappings/:id Remove teacher mapping
 *   POST /google-classroom/sync                   Trigger manual sync
 *   GET  /google-classroom/sync/history           View sync history
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import { authenticate } from '../middleware/auth.js';
import { validateZod, zodSchemas } from '../middleware/validation.js';
import { createLogger } from '../utils/logger.js';
import GoogleClassroomSync from '../models/GoogleClassroomSync.js';
import {
  buildAuthUrl,
  exchangeCodeForTokens,
  listCourses,
  runSync,
} from '../services/googleClassroomService.js';
import { getRequiredSecret } from '../config/environment.js';

const router = express.Router();
const logger = createLogger('GoogleClassroom');

// All routes require authentication
router.use(authenticate);

// ── Helpers ──────────────────────────────────────────────────────────────────

function getOrCreateSyncRecord(schoolId) {
  return GoogleClassroomSync.findOneAndUpdate(
    { schoolId },
    { $setOnInsert: { schoolId } },
    { upsert: true, new: true }
  );
}

function isAdmin(req) {
  const roles = Array.isArray(req.user?.role) ? req.user.role : [req.user?.role];
  return roles.some((r) => typeof r === 'string' && r.toLowerCase() === 'admin');
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
}

// ── GET /google-classroom/status ─────────────────────────────────────────────

router.get('/status', async (req, res) => {
  try {
    const record = await GoogleClassroomSync.findOne({ schoolId: req.user.schoolId })
      .select('-oauth.accessToken -oauth.refreshToken')
      .lean();

    if (!record) {
      return res.json({
        success: true,
        data: {
          isConnected: false,
          connectedEmail: null,
          settings: null,
          classMappingsCount: 0,
          teacherMappingsCount: 0,
          lastSync: null,
        },
      });
    }

    return res.json({
      success: true,
      data: {
        isConnected: record.isConnected,
        connectedEmail: record.oauth?.connectedEmail || null,
        connectedAt: record.oauth?.connectedAt || null,
        settings: record.settings,
        classMappingsCount: record.classMappings?.length || 0,
        teacherMappingsCount: record.teacherMappings?.length || 0,
        lastSync: record.lastScheduledSync,
        nextSync: record.nextScheduledSync,
      },
    });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to get Google Classroom status');
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET /google-classroom/auth-url ────────────────────────────────────────────

router.get('/auth-url', requireAdmin, async (req, res) => {
  try {
    const stateToken = jwt.sign(
      { schoolId: req.user.schoolId.toString(), purpose: 'gc-oauth' },
      getRequiredSecret('JWT_SECRET'),
      { expiresIn: '15m' }
    );

    const authUrl = buildAuthUrl(stateToken);
    return res.json({ success: true, data: { authUrl } });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to build Google Classroom auth URL');
    return res.status(503).json({
      success: false,
      error: err.message.includes('not configured') ? err.message : 'Failed to generate auth URL',
    });
  }
});

// ── POST /google-classroom/callback ──────────────────────────────────────────

router.post('/callback', requireAdmin, async (req, res) => {
  try {
    const { code, state } = req.body;

    if (!code || !state) {
      return res.status(400).json({ success: false, error: 'code and state are required' });
    }

    // Verify state token belongs to this school
    let statePayload;
    try {
      statePayload = jwt.verify(state, getRequiredSecret('JWT_SECRET'));
    } catch {
      return res.status(400).json({ success: false, error: 'Invalid or expired state token' });
    }

    if (
      statePayload.purpose !== 'gc-oauth' ||
      statePayload.schoolId !== req.user.schoolId.toString()
    ) {
      return res.status(400).json({ success: false, error: 'State mismatch' });
    }

    const tokens = await exchangeCodeForTokens(code);

    const record = await getOrCreateSyncRecord(req.user.schoolId);
    record.oauth = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
      connectedEmail: tokens.email,
      connectedAt: new Date(),
    };
    record.isConnected = true;
    await record.save();

    logger.info({ schoolId: req.user.schoolId, email: tokens.email }, 'Google Classroom connected');

    return res.json({
      success: true,
      data: {
        isConnected: true,
        connectedEmail: tokens.email,
        scopes: tokens.scopes,
      },
    });
  } catch (err) {
    logger.error({ err: err.message }, 'Google Classroom OAuth callback failed');
    return res.status(500).json({ success: false, error: err.message || 'OAuth exchange failed' });
  }
});

// ── DELETE /google-classroom/disconnect ──────────────────────────────────────

router.delete('/disconnect', requireAdmin, async (req, res) => {
  try {
    await GoogleClassroomSync.updateOne(
      { schoolId: req.user.schoolId },
      {
        $set: {
          'oauth.accessToken': null,
          'oauth.refreshToken': null,
          'oauth.tokenExpiresAt': null,
          'oauth.connectedEmail': null,
          isConnected: false,
        },
      }
    );

    logger.info({ schoolId: req.user.schoolId }, 'Google Classroom disconnected');
    return res.json({ success: true, message: 'Disconnected from Google Classroom' });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to disconnect Google Classroom');
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET /google-classroom/courses ─────────────────────────────────────────────

router.get('/courses', requireAdmin, async (req, res) => {
  try {
    const record = await GoogleClassroomSync.findOne({ schoolId: req.user.schoolId });

    if (!record?.isConnected) {
      return res.status(400).json({ success: false, error: 'Google Classroom is not connected' });
    }

    const courses = await listCourses(record);

    return res.json({
      success: true,
      data: courses.map((c) => ({
        id: c.id,
        name: c.name,
        section: c.section || null,
        description: c.description || null,
        room: c.room || null,
        enrollmentCode: c.enrollmentCode || null,
        courseState: c.courseState,
        alternateLink: c.alternateLink || null,
      })),
    });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to list Google Classroom courses');
    return res
      .status(500)
      .json({ success: false, error: err.message || 'Failed to fetch courses' });
  }
});

// ── GET /google-classroom/config ──────────────────────────────────────────────

router.get('/config', requireAdmin, async (req, res) => {
  try {
    const record = await GoogleClassroomSync.findOne({ schoolId: req.user.schoolId })
      .select('settings')
      .lean();

    return res.json({
      success: true,
      data: record?.settings || {
        syncFrequency: 'daily',
        syncStudents: true,
        syncAssignments: true,
        syncGrades: true,
        conflictResolution: 'ems_wins',
        academicYear: null,
      },
    });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to get Google Classroom config');
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── PUT /google-classroom/config ──────────────────────────────────────────────

router.put(
  '/config',
  requireAdmin,
  validateZod(zodSchemas.updateGoogleClassroomConfig),
  async (req, res) => {
    try {
      const updates = {};
      const allowed = [
        'syncFrequency',
        'syncStudents',
        'syncAssignments',
        'syncGrades',
        'conflictResolution',
        'academicYear',
      ];
      for (const key of allowed) {
        if (req.body[key] !== undefined) {
          updates[`settings.${key}`] = req.body[key];
        }
      }

      const record = await GoogleClassroomSync.findOneAndUpdate(
        { schoolId: req.user.schoolId },
        { $set: updates },
        { upsert: true, new: true }
      )
        .select('settings')
        .lean();

      return res.json({ success: true, data: record.settings });
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to update Google Classroom config');
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

// ── GET /google-classroom/mappings ────────────────────────────────────────────

router.get('/mappings', async (req, res) => {
  try {
    const record = await GoogleClassroomSync.findOne({ schoolId: req.user.schoolId })
      .select('classMappings')
      .populate('classMappings.emsClassId', 'name grade section')
      .lean();

    return res.json({
      success: true,
      data: record?.classMappings || [],
    });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to get class mappings');
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── POST /google-classroom/mappings ───────────────────────────────────────────

router.post(
  '/mappings',
  requireAdmin,
  validateZod(zodSchemas.createGoogleClassroomMapping),
  async (req, res) => {
    try {
      const {
        emsClassId,
        googleCourseId,
        googleCourseName,
        syncStudents,
        syncAssignments,
        syncGrades,
      } = req.body;

      const record = await getOrCreateSyncRecord(req.user.schoolId);

      // Check for duplicate mapping
      const existing = record.classMappings.find(
        (m) => m.emsClassId.toString() === emsClassId || m.googleCourseId === googleCourseId
      );

      if (existing) {
        return res.status(409).json({
          success: false,
          error: 'A mapping already exists for this class or Google course',
        });
      }

      record.classMappings.push({
        emsClassId,
        googleCourseId,
        googleCourseName,
        syncStudents,
        syncAssignments,
        syncGrades,
      });
      await record.save();

      const newMapping = record.classMappings[record.classMappings.length - 1];

      return res.status(201).json({ success: true, data: newMapping });
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to create class mapping');
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

// ── DELETE /google-classroom/mappings/:mappingId ──────────────────────────────

router.delete('/mappings/:mappingId', requireAdmin, async (req, res) => {
  try {
    const { mappingId } = req.params;

    const result = await GoogleClassroomSync.updateOne(
      { schoolId: req.user.schoolId },
      { $pull: { classMappings: { _id: mappingId } } }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({ success: false, error: 'Mapping not found' });
    }

    return res.json({ success: true, message: 'Mapping removed' });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to remove class mapping');
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET /google-classroom/teacher-mappings ────────────────────────────────────

router.get('/teacher-mappings', requireAdmin, async (req, res) => {
  try {
    const record = await GoogleClassroomSync.findOne({ schoolId: req.user.schoolId })
      .select('teacherMappings')
      .populate('teacherMappings.emsStaffId', 'name email role')
      .lean();

    return res.json({ success: true, data: record?.teacherMappings || [] });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to get teacher mappings');
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── POST /google-classroom/teacher-mappings ───────────────────────────────────

router.post(
  '/teacher-mappings',
  requireAdmin,
  validateZod(zodSchemas.createGoogleTeacherMapping),
  async (req, res) => {
    try {
      const { emsStaffId, googleUserId, googleEmail } = req.body;

      const record = await getOrCreateSyncRecord(req.user.schoolId);

      const existing = record.teacherMappings.find(
        (m) => m.emsStaffId.toString() === emsStaffId || m.googleUserId === googleUserId
      );

      if (existing) {
        return res.status(409).json({
          success: false,
          error: 'A mapping already exists for this staff member or Google user',
        });
      }

      record.teacherMappings.push({ emsStaffId, googleUserId, googleEmail });
      await record.save();

      return res
        .status(201)
        .json({ success: true, data: record.teacherMappings[record.teacherMappings.length - 1] });
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to create teacher mapping');
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

// ── DELETE /google-classroom/teacher-mappings/:id ─────────────────────────────

router.delete('/teacher-mappings/:id', requireAdmin, async (req, res) => {
  try {
    const result = await GoogleClassroomSync.updateOne(
      { schoolId: req.user.schoolId },
      { $pull: { teacherMappings: { _id: req.params.id } } }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({ success: false, error: 'Teacher mapping not found' });
    }

    return res.json({ success: true, message: 'Teacher mapping removed' });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to remove teacher mapping');
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── POST /google-classroom/sync ───────────────────────────────────────────────

router.post('/sync', requireAdmin, async (req, res) => {
  try {
    const record = await GoogleClassroomSync.findOne({ schoolId: req.user.schoolId });

    if (!record?.isConnected) {
      return res.status(400).json({ success: false, error: 'Google Classroom is not connected' });
    }

    if (record.classMappings.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No class mappings configured. Add at least one mapping before syncing.',
      });
    }

    // Import models lazily to avoid circular dependency issues
    const { Student, Staff } = await import('../database.js');
    let Exam, Result;
    try {
      const examModule = await import('../models/Exam.js');
      Exam = examModule.default;
    } catch {
      /* Exam model optional */
    }
    try {
      const resultModule = await import('../models/Result.js');
      Result = resultModule.default;
    } catch {
      /* Result model optional */
    }

    const emsModels = {
      schoolId: req.user.schoolId,
      Student,
      Staff,
      Exam,
      Result,
    };

    // Run sync in background — respond immediately with accepted
    res.status(202).json({
      success: true,
      message: 'Sync started',
    });

    // Continue sync after response sent
    runSync(record, emsModels, 'manual').catch((err) => {
      logger.error({ err: err.message, schoolId: req.user.schoolId }, 'Background sync failed');
    });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to start Google Classroom sync');
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET /google-classroom/sync/history ────────────────────────────────────────

router.get('/sync/history', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    const record = await GoogleClassroomSync.findOne({ schoolId: req.user.schoolId })
      .select('syncHistory')
      .lean();

    const history = (record?.syncHistory || []).slice(-limit).reverse(); // Most recent first

    return res.json({ success: true, data: history, total: history.length });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to get sync history');
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
