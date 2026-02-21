import express from 'express';
import { Timetable, TeacherTimetable, Staff, Class, ConflictLog, Substitution } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';

const router = express.Router();

/**
 * GET /api/timetable-cleanup/preview
 * Preview what will be deleted before clearing
 */
router.get('/preview', authenticate, checkPermission('classes', 'delete'), async (req, res) => {
  try {
    // Count all timetable-related data
    const timetablesCount = await Timetable.countDocuments();
    const teacherTimetablesCount = await TeacherTimetable.countDocuments();
    const conflictsCount = await ConflictLog.countDocuments();
    const substitutionsCount = await Substitution.countDocuments();

    // Count staff with teacher assignments
    const staffWithAssignments = await Staff.countDocuments({
      teacherAssignments: { $exists: true, $ne: [] }
    });

    // Count classes with class teachers
    const classesWithTeachers = await Class.countDocuments({
      classTeacherId: { $exists: true, $ne: null }
    });

    // Get sample data for preview
    const sampleTimetables = await Timetable.find().limit(3)
      .populate('classId', 'name section')
      .select('classId academicYear version');

    const sampleAssignments = await Staff.find({
      teacherAssignments: { $exists: true, $ne: [] }
    }).limit(5).select('name code teacherAssignments');

    res.json({
      success: true,
      counts: {
        classTimetables: timetablesCount,
        teacherTimetables: teacherTimetablesCount,
        conflictLogs: conflictsCount,
        substitutions: substitutionsCount,
        staffWithAssignments,
        classesWithTeachers
      },
      sampleData: {
        timetables: sampleTimetables,
        staffAssignments: sampleAssignments
      }
    });
  } catch (error) {
    console.error('Error previewing cleanup:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to preview cleanup data',
      error: error.message
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
    const {
      timetables = true,
      teacherTimetables = true,
      staffAssignments = true,
      classTeachers = true,
      conflicts = true,
      substitutions = true
    } = req.body.options || {};

    const results = {
      deleted: {},
      updated: {},
      errors: []
    };

    // 1. Delete all class timetables
    if (timetables) {
      const result = await Timetable.deleteMany({});
      results.deleted.classTimetables = result.deletedCount;
      console.log(`✅ Deleted ${result.deletedCount} class timetables`);
    }

    // 2. Delete all teacher timetables
    if (teacherTimetables) {
      const result = await TeacherTimetable.deleteMany({});
      results.deleted.teacherTimetables = result.deletedCount;
      console.log(`✅ Deleted ${result.deletedCount} teacher timetables`);
    }

    // 3. Clear staff teacher assignments
    if (staffAssignments) {
      const result = await Staff.updateMany(
        {},
        { $set: { teacherAssignments: [] } }
      );
      results.updated.staffAssignments = result.modifiedCount;
      console.log(`✅ Cleared assignments for ${result.modifiedCount} staff members`);
    }

    // 4. Clear class teacher assignments
    if (classTeachers) {
      const result = await Class.updateMany(
        {},
        { $set: { classTeacherId: null } }
      );
      results.updated.classTeachers = result.modifiedCount;
      console.log(`✅ Cleared class teachers for ${result.modifiedCount} classes`);
    }

    // 5. Delete all conflict logs
    if (conflicts) {
      const result = await ConflictLog.deleteMany({});
      results.deleted.conflictLogs = result.deletedCount;
      console.log(`✅ Deleted ${result.deletedCount} conflict logs`);
    }

    // 6. Delete all substitutions
    if (substitutions) {
      const result = await Substitution.deleteMany({});
      results.deleted.substitutions = result.deletedCount;
      console.log(`✅ Deleted ${result.deletedCount} substitutions`);
    }

    // Log the action
    console.log(`🗑️ Timetable cleanup completed by user ${req.user?.id || 'unknown'}`);
    console.log('Results:', results);

    res.json({
      success: true,
      message: 'Timetable data cleanup completed successfully',
      results
    });
  } catch (error) {
    console.error('Error executing cleanup:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to execute cleanup',
      error: error.message
    });
  }
});

/**
 * POST /api/timetable-cleanup/reset-staff
 * Reset a specific staff member's assignments
 */
router.post('/reset-staff/:staffId', authenticate, checkPermission('classes', 'edit'), async (req, res) => {
  try {
    const { staffId } = req.params;

    // Clear staff assignments
    const staff = await Staff.findByIdAndUpdate(
      staffId,
      { $set: { teacherAssignments: [], isClassTeacher: false, classTeacherOf: null } },
      { new: true }
    );

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: 'Staff not found'
      });
    }

    // Delete teacher timetable
    await TeacherTimetable.deleteMany({ teacherId: staffId });

    res.json({
      success: true,
      message: `Reset timetable data for ${staff.name}`,
      staff: {
        id: staff._id,
        name: staff.name,
        code: staff.code
      }
    });
  } catch (error) {
    console.error('Error resetting staff:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset staff data',
      error: error.message
    });
  }
});

export default router;
