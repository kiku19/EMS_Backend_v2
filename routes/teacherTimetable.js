import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import express from 'express';
import { TeacherTimetable, Staff, Class } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { validateZod, zodSchemas } from '../middleware/validation.js';
import timetableService from '../services/timetableService.js';
import conflictDetectionService from '../services/conflictDetectionService.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';

const router = express.Router();
router.use(authenticate);

function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) throw new Error('schoolId is required for scoped queries');
  return { ...query, schoolId: normalizedSchoolId };
}

async function resolveRequestSchoolId(req) {
  if (req.user?.schoolId) return extractSchoolId(req.user.schoolId);
  const school = await ensureDefaultSchool();
  return extractSchoolId(school._id);
}

/**
 * Middleware to check if user can edit teacher timetable
 * - Admins can edit any teacher's timetable
 * - Teachers can only view their own timetable (not edit)
 */
const canEditTeacherTimetable = async (req, res, next) => {
  try {
    const { teacherId } = req.params;
    const userId = req.user?.userId || req.user?.id;
    const schoolId = req.user?.schoolId ? extractSchoolId(req.user.schoolId) : undefined;

    // Fetch user permissions from database, scoped by school for multi-tenancy
    const { UserPermission } = await import('../database.js');
    const permQuery = { userId };
    if (schoolId) permQuery.schoolId = schoolId;
    const userPermission = await UserPermission.findOne(permQuery);

    // If user is admin, allow
    if (userPermission && userPermission.role === 'admin') {
      req.userPermissions = userPermission;
      return next();
    }

    // Check if logged-in user is the same staff member as teacherId
    // req.user.userId is the Staff _id (from JWT), teacherId is also a Staff _id
    const isSelf = String(userId) === String(teacherId);

    // If user is trying to edit their own timetable, deny
    if (isSelf) {
      return res.status(403).json({
        success: false,
        type: 'PermissionError',
        message: 'Teachers cannot edit their own timetable. Please contact an administrator.',
        details: {
          reason: 'Teachers can only view their timetable, not edit it',
        },
      });
    }

    // Otherwise, deny
    return res.status(403).json({
      success: false,
      type: 'PermissionError',
      message: 'You do not have permission to edit teacher timetables',
      details: {
        reason: 'Only administrators can edit teacher timetables',
      },
    });
  } catch (error) {
    console.error('Error checking timetable edit permission:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify permissions',
      error: error.message,
    });
  }
};

/**
 * Middleware to check if user can view teacher timetable
 * - Admins can view any teacher's timetable
 * - Teachers can view their own timetable
 */
const canViewTeacherTimetable = async (req, res, next) => {
  try {
    const { teacherId } = req.params;
    const userId = req.user?.userId || req.user?.id;
    const schoolId = req.user?.schoolId ? extractSchoolId(req.user.schoolId) : undefined;

    // Fetch user permissions from database, scoped by school for multi-tenancy
    const { UserPermission } = await import('../database.js');
    const permQuery = { userId };
    if (schoolId) permQuery.schoolId = schoolId;
    const userPermission = await UserPermission.findOne(permQuery);

    // If user is admin, allow
    if (userPermission && userPermission.role === 'admin') {
      req.userPermissions = userPermission;
      return next();
    }

    // If user is viewing their own timetable, allow
    // req.user.userId is the Staff _id (from JWT), teacherId is also a Staff _id
    if (String(userId) === String(teacherId)) {
      req.userPermissions = userPermission;
      return next();
    }

    // Otherwise, check if they have staff view permission
    if (userPermission) {
      const staffPermission = userPermission.permissions?.find((p) => p.module === 'staff');
      if (staffPermission && staffPermission.view) {
        req.userPermissions = userPermission;
        return next();
      }
    }

    // Deny access
    return res.status(403).json({
      success: false,
      type: 'PermissionError',
      message: "You do not have permission to view this teacher's timetable",
      details: {
        reason: 'You can only view your own timetable or need staff view permission',
      },
    });
  } catch (error) {
    console.error('Error checking timetable view permission:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify permissions',
      error: error.message,
    });
  }
};

/**
 * GET /api/teacher-timetable/:teacherId
 * Get teacher timetable for a specific teacher
 * Query params: academicYear (optional, defaults to CURRENT_ACADEMIC_YEAR)
 */
router.get('/:teacherId', canViewTeacherTimetable, async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { academicYear = CURRENT_ACADEMIC_YEAR } = req.query;

    // Validate teacher exists and belongs to this school
    const schoolId = await resolveRequestSchoolId(req);
    const teacher = await Staff.findOne(scopeBySchool(schoolId, { _id: teacherId }));
    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found',
      });
    }

    // Get teacher timetable
    const timetable = await timetableService.getTeacherTimetable(teacherId, academicYear, schoolId);

    // If no timetable exists, create an empty one
    if (!timetable) {
      const newTimetable = new TeacherTimetable({
        teacherId,
        academicYear,
        schedule: {
          Monday: [],
          Tuesday: [],
          Wednesday: [],
          Thursday: [],
          Friday: [],
          Saturday: [],
          Sunday: [],
        },
        schoolId: req.user?.schoolId ? extractSchoolId(req.user.schoolId) : undefined,
      });
      await newTimetable.save();

      return res.json({
        success: true,
        timetable: newTimetable,
        teacher: {
          _id: teacher._id,
          name: teacher.name,
          code: teacher.code,
        },
      });
    }

    res.json({
      success: true,
      timetable,
      teacher: {
        _id: teacher._id,
        name: teacher.name,
        code: teacher.code,
      },
    });
  } catch (error) {
    console.error('Error fetching teacher timetable:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch teacher timetable',
      error: error.message,
    });
  }
});

/**
 * POST /api/teacher-timetable/:teacherId
 * Create or initialize teacher timetable
 * Body: { academicYear, periods }
 */
router.post('/:teacherId', canEditTeacherTimetable, async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { academicYear = CURRENT_ACADEMIC_YEAR, periods = [] } = req.body;
    const schoolId = await resolveRequestSchoolId(req);

    // Validate teacher exists and belongs to this school
    const teacher = await Staff.findOne(scopeBySchool(schoolId, { _id: teacherId }));
    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found',
      });
    }

    // Check if timetable already exists
    let timetable = await TeacherTimetable.findOne(
      scopeBySchool(schoolId, { teacherId, academicYear })
    );

    if (timetable) {
      return res.status(400).json({
        success: false,
        message: 'Teacher timetable already exists for this academic year',
      });
    }

    // Create new timetable
    timetable = new TeacherTimetable({
      teacherId,
      academicYear,
      schedule: {
        Monday: [],
        Tuesday: [],
        Wednesday: [],
        Thursday: [],
        Friday: [],
        Saturday: [],
        Sunday: [],
      },
      schoolId: req.user?.schoolId ? extractSchoolId(req.user.schoolId) : undefined,
    });

    await timetable.save();

    res.status(201).json({
      success: true,
      message: 'Teacher timetable created successfully',
      timetable,
    });
  } catch (error) {
    console.error('Error creating teacher timetable:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create teacher timetable',
      error: error.message,
    });
  }
});

/**
 * PUT /api/teacher-timetable/:teacherId/slot
 * Update a specific slot in teacher timetable with validation
 * Body: { day, periodIndex, classId, subject, room, academicYear }
 */
router.put(
  '/:teacherId/slot',
  canEditTeacherTimetable,
  validateZod(zodSchemas.teacherUpdateSlot),
  async (req, res) => {
    try {
      const { teacherId } = req.params;
      const {
        day,
        periodIndex,
        classId,
        subject,
        room,
        academicYear = CURRENT_ACADEMIC_YEAR,
      } = req.body;
      const schoolId = await resolveRequestSchoolId(req);

      // Validate teacher exists and belongs to this school
      const teacher = await Staff.findOne(scopeBySchool(schoolId, { _id: teacherId }));
      if (!teacher) {
        return res.status(404).json({
          success: false,
          message: 'Teacher not found',
        });
      }

      // If classId is provided, validate class exists and teacher qualification
      if (classId) {
        const classDoc = await Class.findOne(
          scopeBySchool(schoolId, { _id: classId, isDeleted: { $ne: true } })
        );
        if (!classDoc) {
          return res.status(404).json({
            success: false,
            message: req.t('common:errors.classNotFound'),
          });
        }

        // Validate teacher qualification for this subject and class
        // Use flexible mode (strictMode=false) to allow scheduling without formal assignments
        if (subject) {
          const validation = await conflictDetectionService.validateSlotAssignment(
            teacherId,
            classId,
            subject,
            day,
            periodIndex,
            false, // Flexible mode
            schoolId,
            academicYear
          );

          if (!validation.isValid) {
            return res.status(409).json({
              success: false,
              type: validation.error.type,
              message: validation.error.message,
              conflict: validation.error,
            });
          }

          // If there's a warning (teacher not formally assigned), log it but allow the operation
          if (validation.warning) {
            console.warn('Timetable assignment warning:', validation.warning.message);
          }
        }
      }

      // Prepare slot data
      const slotData = {
        classId: classId || null,
        subject: subject || '',
        room: room || '',
      };

      // Sync timetables (this will update both teacher and class timetables)
      const result = await timetableService.syncTimetables({
        sourceType: 'teacher',
        sourceId: teacherId,
        day,
        periodIndex,
        slotData,
        academicYear,
        modifiedBy: req.user?.id || null,
        schoolId,
      });

      res.json({
        success: true,
        message: 'Teacher timetable slot updated successfully',
        timetable: result.teacherTimetable,
        oldClassId: result.oldClassId,
        newClassId: result.newClassId,
      });
    } catch (error) {
      console.error('Error updating teacher timetable slot:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update teacher timetable slot',
        error: error.message,
      });
    }
  }
);

/**
 * GET /api/teacher-timetable/:teacherId/conflicts
 * Get all conflicts for a teacher
 * Query params: academicYear (optional, defaults to CURRENT_ACADEMIC_YEAR)
 */
router.get('/:teacherId/conflicts', canViewTeacherTimetable, async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { academicYear = CURRENT_ACADEMIC_YEAR } = req.query;
    const schoolId = await resolveRequestSchoolId(req);

    // Validate teacher exists and belongs to this school
    const teacher = await Staff.findOne(scopeBySchool(schoolId, { _id: teacherId }));
    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found',
      });
    }

    // Get all conflicts for this teacher — pass schoolId so the query is
    // tenant-scoped and never bleeds across schools when the same teacherId
    // appears in a migrated/demo dataset.
    const conflicts = await conflictDetectionService.getTeacherConflicts(
      teacherId,
      academicYear,
      schoolId
    );

    res.json({
      success: true,
      conflicts,
      count: conflicts.length,
      teacher: {
        _id: teacher._id,
        name: teacher.name,
        code: teacher.code,
      },
    });
  } catch (error) {
    console.error('Error fetching teacher conflicts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch teacher conflicts',
      error: error.message,
    });
  }
});

/**
 * POST /api/teacher-timetable/:teacherId/switch-class
 * Switch class for a teacher in a specific time slot
 * Body: { day, periodIndex, oldClassId, newClassId, subject, room, academicYear }
 */
router.post(
  '/:teacherId/switch-class',
  canEditTeacherTimetable,
  validateZod(zodSchemas.switchClass),
  async (req, res) => {
    try {
      const { teacherId } = req.params;
      const {
        day,
        periodIndex,
        oldClassId,
        newClassId,
        subject,
        room,
        academicYear = CURRENT_ACADEMIC_YEAR,
      } = req.body;
      const schoolId = await resolveRequestSchoolId(req);

      // Validate teacher exists and belongs to this school
      const teacher = await Staff.findOne(scopeBySchool(schoolId, { _id: teacherId }));
      if (!teacher) {
        return res.status(404).json({
          success: false,
          message: 'Teacher not found',
        });
      }

      // Validate new class exists
      const newClass = await Class.findOne(
        scopeBySchool(schoolId, { _id: newClassId, isDeleted: { $ne: true } })
      );
      if (!newClass) {
        return res.status(404).json({
          success: false,
          message: 'New class not found',
        });
      }

      // Validate old class exists if provided
      if (oldClassId) {
        const oldClass = await Class.findOne(
          scopeBySchool(schoolId, { _id: oldClassId, isDeleted: { $ne: true } })
        );
        if (!oldClass) {
          return res.status(404).json({
            success: false,
            message: 'Old class not found',
          });
        }
      }

      // Check for conflicts in the new class slot — scoped by academicYear
      // so a teacher who taught this period in a prior year doesn't trigger
      // a false-positive conflict against this-year's move.
      const conflict = await conflictDetectionService.checkTeacherConflict(
        teacherId,
        day,
        periodIndex,
        oldClassId, // Exclude old class from conflict check
        false,
        schoolId,
        academicYear,
        true // skipCache — write-path (class switch), must see freshest state (CT16)
      );

      if (conflict) {
        return res.status(409).json({
          success: false,
          type: 'ConflictError',
          message: conflict.message,
          conflict: conflict,
        });
      }

      // Perform the class switch
      const result = await timetableService.switchClass({
        teacherId,
        oldClassId,
        newClassId,
        day,
        periodIndex,
        subject,
        room,
        academicYear,
        modifiedBy: req.user?.id || null,
        schoolId,
      });

      res.json({
        success: true,
        message: 'Class switched successfully',
        oldClassId: result.oldClassId,
        newClassId: result.newClassId,
        oldClassTimetable: result.oldClassTimetable,
        newClassTimetable: result.newClassTimetable,
        teacherTimetable: result.teacherTimetable,
      });
    } catch (error) {
      console.error('Error switching class:', error);

      // Check if it's a validation error
      if (error.message.includes('not qualified') || error.message.includes('not found')) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: 'Failed to switch class',
        error: error.message,
      });
    }
  }
);

export default router;
