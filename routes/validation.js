import express from 'express';
import { Class, Staff } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import validationService from '../services/validationService.js';
import { resolveAcademicYear } from '../utils/academicYear.js';

const router = express.Router();
router.use(authenticate);

router.get('/class/:classId/empty-slots', authenticate, async (req, res) => {
  try {
    const academicYear = await resolveAcademicYear(req.query.academicYear, req.user?.schoolId);
    const emptySlots = await validationService.identifyEmptySlots(req.params.classId, academicYear);

    res.json({
      success: true,
      classId: req.params.classId,
      academicYear,
      emptySlots,
      count: emptySlots.length,
    });
  } catch (error) {
    console.error('Error identifying empty slots:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to identify empty slots',
    });
  }
});

router.get('/teacher/:teacherId/gaps', authenticate, async (req, res) => {
  try {
    const academicYear = await resolveAcademicYear(req.query.academicYear, req.user?.schoolId);
    const gaps = await validationService.identifyTeacherScheduleGaps(
      req.params.teacherId,
      academicYear
    );

    res.json({
      success: true,
      teacherId: req.params.teacherId,
      academicYear,
      gaps,
      count: gaps.length,
    });
  } catch (error) {
    console.error('Error identifying teacher schedule gaps:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to identify teacher schedule gaps',
    });
  }
});

router.get('/class/:classId/report', authenticate, async (req, res) => {
  try {
    const academicYear = await resolveAcademicYear(req.query.academicYear, req.user?.schoolId);
    const report = await validationService.generateClassValidationReport(
      req.params.classId,
      academicYear
    );

    res.json({ success: true, report });
  } catch (error) {
    console.error('Error generating class validation report:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate class validation report',
    });
  }
});

router.get('/teacher/:teacherId/report', authenticate, async (req, res) => {
  try {
    const academicYear = await resolveAcademicYear(req.query.academicYear, req.user?.schoolId);
    const report = await validationService.generateTeacherValidationReport(
      req.params.teacherId,
      academicYear
    );

    res.json({ success: true, report });
  } catch (error) {
    console.error('Error generating teacher validation report:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate teacher validation report',
    });
  }
});

router.get('/classes/comprehensive', authenticate, async (req, res) => {
  try {
    const academicYear = await resolveAcademicYear(req.query.academicYear, req.user?.schoolId);
    const report = await validationService.generateComprehensiveClassReport(academicYear);

    res.json({ success: true, report });
  } catch (error) {
    console.error('Error generating comprehensive class report:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate comprehensive class report',
    });
  }
});

router.get('/teachers/comprehensive', authenticate, async (req, res) => {
  try {
    const academicYear = await resolveAcademicYear(req.query.academicYear, req.user?.schoolId);
    const report = await validationService.generateComprehensiveTeacherReport(academicYear);

    res.json({ success: true, report });
  } catch (error) {
    console.error('Error generating comprehensive teacher report:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate comprehensive teacher report',
    });
  }
});

router.get('/class-teachers/check-duplicates', authenticate, async (req, res) => {
  try {
    const schoolId = extractSchoolId(req.user?.schoolId);
    const classesWithTeachers = await Class.find({
      schoolId,
      classTeacherId: { $exists: true, $ne: null },
    }).populate('classTeacherId', 'name code');

    const teacherMap = new Map();
    classesWithTeachers.forEach((classDoc) => {
      const teacherId = classDoc.classTeacherId._id.toString();
      if (!teacherMap.has(teacherId)) {
        teacherMap.set(teacherId, {
          teacher: {
            id: classDoc.classTeacherId._id,
            name: classDoc.classTeacherId.name,
            code: classDoc.classTeacherId.code,
          },
          classes: [],
        });
      }

      teacherMap.get(teacherId).classes.push({
        classId: classDoc._id,
        className: `${classDoc.name} ${classDoc.section}`,
        createdAt: classDoc.createdAt,
        updatedAt: classDoc.updatedAt,
      });
    });

    const violations = [];
    teacherMap.forEach((data, teacherId) => {
      if (data.classes.length <= 1) {
        return;
      }

      const sortedClasses = [...data.classes].sort(
        (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
      );
      violations.push({
        teacherId,
        teacherName: data.teacher.name,
        teacherCode: data.teacher.code,
        classCount: data.classes.length,
        classes: sortedClasses.map((classInfo) => ({
          classId: classInfo.classId,
          className: classInfo.className,
          createdAt: classInfo.createdAt,
          updatedAt: classInfo.updatedAt,
        })),
        recommendedToKeep: sortedClasses[0].classId,
        recommendedToRemove: sortedClasses.slice(1).map((classInfo) => classInfo.classId),
      });
    });

    res.json({
      success: true,
      hasViolations: violations.length > 0,
      violationCount: violations.length,
      violations,
      totalClassesWithTeachers: classesWithTeachers.length,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error('Error checking for duplicates:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/class-teachers/check-consistency', authenticate, async (req, res) => {
  try {
    const schoolId = extractSchoolId(req.user?.schoolId);
    const staffWithClassTeacher = await Staff.find({ schoolId, isClassTeacher: true });
    const inconsistencies = [];

    for (const staff of staffWithClassTeacher) {
      if (!staff.classTeacherOf) {
        continue;
      }

      const classMatch =
        staff.classTeacherOf.match(/Class\s*(\d+)[-\s]?([A-Z])?/i) ||
        staff.classTeacherOf.match(/^(\d+)[-\s]?([A-Z])?$/i);
      if (!classMatch) {
        continue;
      }

      const className = `Class ${classMatch[1]}`;
      const section = classMatch[2] || 'A';
      const targetClass = await Class.findOne({ schoolId, name: className, section });
      if (!targetClass) {
        continue;
      }

      const expectedTeacherId = staff._id.toString();
      const actualTeacherId = targetClass.classTeacherId
        ? targetClass.classTeacherId.toString()
        : null;
      if (actualTeacherId !== expectedTeacherId) {
        inconsistencies.push({
          staffId: staff._id,
          staffName: staff.name,
          staffCode: staff.code,
          classTeacherOf: staff.classTeacherOf,
          expectedClassId: targetClass._id,
          actualClassTeacherId: actualTeacherId,
          status: actualTeacherId ? 'mismatch' : 'unassigned',
        });
      }
    }

    const classesWithTeachers = await Class.find({
      schoolId,
      classTeacherId: { $exists: true, $ne: null },
    });

    for (const classDoc of classesWithTeachers) {
      const staff = await Staff.findOne({ _id: classDoc.classTeacherId, schoolId });
      if (staff && !staff.isClassTeacher) {
        inconsistencies.push({
          staffId: staff._id,
          staffName: staff.name,
          staffCode: staff.code,
          classTeacherOf: staff.classTeacherOf,
          classId: classDoc._id,
          className: `${classDoc.name} ${classDoc.section}`,
          isClassTeacher: staff.isClassTeacher,
          status: 'isClassTeacher_false',
        });
      }
    }

    res.json({
      success: true,
      hasInconsistencies: inconsistencies.length > 0,
      inconsistencyCount: inconsistencies.length,
      inconsistencies,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error('Error checking consistency:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/class-teachers/fix-duplicates', authenticate, async (req, res) => {
  try {
    const schoolId = extractSchoolId(req.user?.schoolId);
    const classesWithTeachers = await Class.find({
      schoolId,
      classTeacherId: { $exists: true, $ne: null },
    }).populate('classTeacherId', 'name code');

    const teacherMap = new Map();
    classesWithTeachers.forEach((classDoc) => {
      const teacherId = classDoc.classTeacherId._id.toString();
      if (!teacherMap.has(teacherId)) {
        teacherMap.set(teacherId, {
          teacher: {
            id: classDoc.classTeacherId._id,
            name: classDoc.classTeacherId.name,
            code: classDoc.classTeacherId.code,
          },
          classes: [],
        });
      }

      teacherMap.get(teacherId).classes.push({
        classId: classDoc._id,
        className: `${classDoc.name} ${classDoc.section}`,
        createdAt: classDoc.createdAt,
        updatedAt: classDoc.updatedAt,
      });
    });

    const fixes = [];
    teacherMap.forEach((data, teacherId) => {
      if (data.classes.length <= 1) {
        return;
      }

      const sortedClasses = [...data.classes].sort(
        (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
      );
      fixes.push({
        teacherId,
        teacherName: data.teacher.name,
        teacherCode: data.teacher.code,
        classKept: sortedClasses[0],
        classesRemoved: sortedClasses.slice(1),
      });
    });

    const fixResults = [];
    for (const fix of fixes) {
      for (const classToRemove of fix.classesRemoved) {
        await Class.findOneAndUpdate(
          { _id: classToRemove.classId, schoolId },
          {
            $unset: { classTeacherId: 1 },
          }
        );
      }

      fixResults.push({
        teacherName: fix.teacherName,
        teacherCode: fix.teacherCode,
        classKept: {
          classId: fix.classKept.classId.toString(),
          className: fix.classKept.className,
        },
        classesRemoved: fix.classesRemoved.map((classInfo) => ({
          classId: classInfo.classId.toString(),
          className: classInfo.className,
        })),
      });
    }

    res.json({
      success: true,
      message: `Fixed ${fixes.length} duplicate class teacher assignments`,
      fixesApplied: fixResults.length,
      details: fixResults,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error('Error fixing duplicates:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
