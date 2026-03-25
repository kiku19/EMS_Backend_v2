import express from 'express';
import {
  Timetable,
  TeacherTimetable,
  Staff,
  Class,
  ConflictLog,
  Substitution,
} from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { extractSchoolId } from '../utils/schoolContext.js';

const router = express.Router();
router.use(authenticate);

function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) throw new Error('schoolId is required for scoped queries');
  return { ...query, schoolId: normalizedSchoolId };
}

/**
 * GET /api/timetable-cleanup/preview
 * Preview what will be deleted before clearing
 */
router.get('/preview', authenticate, checkPermission('classes', 'delete'), async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    // Count timetable-related data for this school
    const timetablesCount = await Timetable.countDocuments(scopeBySchool(schoolId));
    const teacherTimetablesCount = await TeacherTimetable.countDocuments(scopeBySchool(schoolId));
    const conflictsCount = await ConflictLog.countDocuments(scopeBySchool(schoolId));
    const substitutionsCount = await Substitution.countDocuments(scopeBySchool(schoolId));

    // Count staff with teacher assignments
    const staffWithAssignments = await Staff.countDocuments(
      scopeBySchool(schoolId, {
        teacherAssignments: { $exists: true, $ne: [] },
      })
    );

    // Count classes with class teachers
    const classesWithTeachers = await Class.countDocuments(
      scopeBySchool(schoolId, {
        classTeacherId: { $exists: true, $ne: null },
      })
    );

    // Get sample data for preview
    const sampleTimetables = await Timetable.find(scopeBySchool(schoolId))
      .limit(3)
      .populate('classId', 'name section')
      .select('classId academicYear version');

    const sampleAssignments = await Staff.find(
      scopeBySchool(schoolId, {
        teacherAssignments: { $exists: true, $ne: [] },
      })
    )
      .limit(5)
      .select('name code teacherAssignments');

    res.json({
      success: true,
      counts: {
        classTimetables: timetablesCount,
        teacherTimetables: teacherTimetablesCount,
        conflictLogs: conflictsCount,
        substitutions: substitutionsCount,
        staffWithAssignments,
        classesWithTeachers,
      },
      sampleData: {
        timetables: sampleTimetables,
        staffAssignments: sampleAssignments,
      },
    });
  } catch (error) {
    console.error('Error previewing cleanup:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to preview cleanup data',
      error: error.message,
    });
  }
});

/**
 * POST /api/timetable-cleanup/execute
 * Clear all timetable-related data
 * Body: { options: { timetables, teacherTimetables, staffAssignments, classTeachers, conflicts, substitutions } }
 */
router.post('/execute', authenticate, checkPermission('classes', 'delete'), async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const {
      timetables = true,
      teacherTimetables = true,
      staffAssignments = true,
      classTeachers = true,
      conflicts = true,
      substitutions = true,
    } = req.body.options || {};

    const results = {
      deleted: {},
      updated: {},
      errors: [],
    };

    // 1. Delete class timetables for this school
    if (timetables) {
      const result = await Timetable.deleteMany(scopeBySchool(schoolId));
      results.deleted.classTimetables = result.deletedCount;
    }

    // 2. Delete teacher timetables for this school
    if (teacherTimetables) {
      const result = await TeacherTimetable.deleteMany(scopeBySchool(schoolId));
      results.deleted.teacherTimetables = result.deletedCount;
    }

    // 3. Clear staff teacher assignments for this school
    if (staffAssignments) {
      const result = await Staff.updateMany(scopeBySchool(schoolId), {
        $set: { teacherAssignments: [] },
      });
      results.updated.staffAssignments = result.modifiedCount;
    }

    // 4. Clear class teacher assignments for this school
    if (classTeachers) {
      const result = await Class.updateMany(scopeBySchool(schoolId), {
        $set: { classTeacherId: null },
      });
      results.updated.classTeachers = result.modifiedCount;
    }

    // 5. Delete conflict logs for this school
    if (conflicts) {
      const result = await ConflictLog.deleteMany(scopeBySchool(schoolId));
      results.deleted.conflictLogs = result.deletedCount;
    }

    // 6. Delete substitutions for this school
    if (substitutions) {
      const result = await Substitution.deleteMany(scopeBySchool(schoolId));
      results.deleted.substitutions = result.deletedCount;
    }

    // Log the action

    res.json({
      success: true,
      message: 'Timetable data cleanup completed successfully',
      results,
    });
  } catch (error) {
    console.error('Error executing cleanup:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to execute cleanup',
      error: error.message,
    });
  }
});

/**
 * POST /api/timetable-cleanup/reset-staff
 * Reset a specific staff member's assignments
 */
router.post(
  '/reset-staff/:staffId',
  authenticate,
  checkPermission('classes', 'edit'),
  async (req, res) => {
    try {
      const { staffId } = req.params;
      const schoolId = req.user?.schoolId;

      // Clear staff assignments — scoped to this school
      const staff = await Staff.findOneAndUpdate(
        scopeBySchool(schoolId, { _id: staffId }),
        { $set: { teacherAssignments: [], isClassTeacher: false, classTeacherOf: null } },
        { new: true }
      );

      if (!staff) {
        return res.status(404).json({
          success: false,
          message: req.t('common:errors.staffNotFound'),
        });
      }

      // Delete teacher timetable
      await TeacherTimetable.deleteMany(scopeBySchool(schoolId, { teacherId: staffId }));

      res.json({
        success: true,
        message: `Reset timetable data for ${staff.name}`,
        staff: {
          id: staff._id,
          name: staff.name,
          code: staff.code,
        },
      });
    } catch (error) {
      console.error('Error resetting staff:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to reset staff data',
        error: error.message,
      });
    }
  }
);

export default router;
