import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import express from 'express';
import { Staff, Class, Timetable } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { buildSchoolScopedQuery } from '../utils/schoolContext.js';
import { validateZod } from '../validators/zodHelpers.js';
import { teacherAssignmentSchema } from '../validators/staffSchema.js';

const router = express.Router();
router.use(authenticate);

const schoolQuery = (req, extra = {}) =>
  buildSchoolScopedQuery(req.user?.schoolId, { isDeleted: { $ne: true }, ...extra });

// Get available teachers for a specific class, subject, day, and period
// IMPORTANT: This route must come BEFORE /:teacherId to avoid route conflicts
router.get(
  '/available-teachers',
  authenticate,
  checkPermission('staff', 'view'),
  async (req, res) => {
    try {
      const { classId, subject, day, period, academicYear = CURRENT_ACADEMIC_YEAR } = req.query;

      // Validate required parameters
      if (!classId || !subject) {
        return res.status(400).json({
          error: 'classId and subject are required query parameters',
        });
      }

      // Verify class exists within this school
      const targetClass = await Class.findOne(schoolQuery(req, { _id: classId }));
      if (!targetClass) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }

      // Find all teachers who have this subject-class assignment within this school
      const qualifiedTeachers = await Staff.find(
        schoolQuery(req, {
          status: 'active',
          teacherAssignments: {
            $elemMatch: {
              subject: subject,
              classes: classId,
            },
          },
        })
      ).select('_id name code department teacherAssignments');

      // If day and period are provided, filter out teachers with conflicts
      let availableTeachers = qualifiedTeachers;

      if (day && period !== undefined) {
        const periodIndex = parseInt(period);

        // Get all timetables for the academic year within this school
        const allTimetables = await Timetable.find(schoolQuery(req, { academicYear })).populate(
          'classId',
          'name section'
        );

        // Build a map of teacher conflicts
        const teacherConflicts = new Map();

        for (const timetable of allTimetables) {
          // Skip the current class
          if (timetable.classId._id.toString() === classId) {
            continue;
          }

          const daySchedule = timetable.schedule[day];
          if (daySchedule && daySchedule[periodIndex]) {
            const slot = daySchedule[periodIndex];
            if (slot.teacherId) {
              const teacherIdStr = slot.teacherId.toString();
              if (!teacherConflicts.has(teacherIdStr)) {
                teacherConflicts.set(teacherIdStr, []);
              }
              teacherConflicts.get(teacherIdStr).push({
                classId: timetable.classId._id,
                className: `${timetable.classId.name} ${timetable.classId.section}`,
                subject: slot.subject,
                day,
                period: periodIndex,
              });
            }
          }
        }

        // Filter out teachers with conflicts
        availableTeachers = qualifiedTeachers.filter((teacher) => {
          return !teacherConflicts.has(teacher._id.toString());
        });

        // Add conflict information for debugging
        const conflictedTeachers = qualifiedTeachers
          .filter((teacher) => teacherConflicts.has(teacher._id.toString()))
          .map((teacher) => ({
            id: teacher._id,
            name: teacher.name,
            code: teacher.code,
            conflicts: teacherConflicts.get(teacher._id.toString()),
          }));

        return res.json({
          available: availableTeachers.map((t) => ({
            id: t._id,
            name: t.name,
            code: t.code,
            department: t.department,
            assignments: t.teacherAssignments.filter(
              (a) => a.subject === subject && a.classes.some((c) => c.toString() === classId)
            ),
          })),
          conflicted: conflictedTeachers,
          filters: {
            classId,
            subject,
            day,
            period: periodIndex,
            academicYear,
          },
        });
      }

      // Return all qualified teachers if no time slot specified
      res.json({
        available: availableTeachers.map((t) => ({
          id: t._id,
          name: t.name,
          code: t.code,
          department: t.department,
          assignments: t.teacherAssignments.filter(
            (a) => a.subject === subject && a.classes.some((c) => c.toString() === classId)
          ),
        })),
        filters: {
          classId,
          subject,
          academicYear,
        },
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// Get teacher assignments for a specific teacher
router.get('/:teacherId', authenticate, checkPermission('staff', 'view'), async (req, res) => {
  try {
    const { teacherId } = req.params;

    const staff = await Staff.findOne(schoolQuery(req, { _id: teacherId })).populate(
      'teacherAssignments.classes',
      'name section'
    );

    if (!staff) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    res.json({
      teacherId: staff._id,
      teacherName: staff.name,
      assignments: staff.teacherAssignments || [],
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new teacher assignment
router.post(
  '/',
  authenticate,
  checkPermission('staff', 'edit'),
  validateZod(teacherAssignmentSchema),
  async (req, res) => {
    try {
      const { teacherId, subject, classIds } = req.body;

      // Verify teacher exists within this school
      const staff = await Staff.findOne(schoolQuery(req, { _id: teacherId }));
      if (!staff) {
        return res.status(404).json({ error: 'Teacher not found' });
      }

      // Verify all classes exist within this school
      const classes = await Class.find(schoolQuery(req, { _id: { $in: classIds } }));
      if (classes.length !== classIds.length) {
        return res.status(400).json({ error: 'One or more classes not found' });
      }

      // Check if assignment already exists for this subject
      const existingAssignment = staff.teacherAssignments.find((a) => a.subject === subject);

      if (existingAssignment) {
        // Add new classes to existing assignment (avoid duplicates)
        const existingClassIds = existingAssignment.classes.map((c) => c.toString());
        const newClassIds = classIds.filter((id) => !existingClassIds.includes(id.toString()));

        if (newClassIds.length > 0) {
          existingAssignment.classes.push(...newClassIds);
          await staff.save();
        }

        const updatedStaff = await Staff.findOne(schoolQuery(req, { _id: teacherId })).populate(
          'teacherAssignments.classes',
          'name section'
        );

        return res.json({
          success: true,
          assignment: updatedStaff.teacherAssignments.find((a) => a.subject === subject),
        });
      }

      // Create new assignment
      const newAssignment = {
        subject,
        classes: classIds,
        createdAt: new Date(),
      };

      staff.teacherAssignments.push(newAssignment);
      await staff.save();

      const updatedStaff = await Staff.findOne(schoolQuery(req, { _id: teacherId })).populate(
        'teacherAssignments.classes',
        'name section'
      );

      res.status(201).json({
        success: true,
        assignment: updatedStaff.teacherAssignments[updatedStaff.teacherAssignments.length - 1],
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// Update a teacher assignment
router.put(
  '/:id',
  authenticate,
  checkPermission('staff', 'edit'),
  validateZod(teacherAssignmentSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { teacherId, subject, classIds } = req.body;

      // Verify teacher exists within this school
      const staff = await Staff.findOne(schoolQuery(req, { _id: teacherId }));
      if (!staff) {
        return res.status(404).json({ error: 'Teacher not found' });
      }

      // Verify all classes exist within this school
      const classes = await Class.find(schoolQuery(req, { _id: { $in: classIds } }));
      if (classes.length !== classIds.length) {
        return res.status(400).json({ error: 'One or more classes not found' });
      }

      // Find and update the assignment
      const assignment = staff.teacherAssignments.id(id);
      if (!assignment) {
        return res.status(404).json({ error: 'Assignment not found' });
      }

      assignment.subject = subject;
      assignment.classes = classIds;

      await staff.save();

      const updatedStaff = await Staff.findOne(schoolQuery(req, { _id: teacherId })).populate(
        'teacherAssignments.classes',
        'name section'
      );

      res.json({
        success: true,
        assignment: updatedStaff.teacherAssignments.id(id),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// Delete a teacher assignment
router.delete('/:id', authenticate, checkPermission('staff', 'edit'), async (req, res) => {
  try {
    const { id } = req.params;
    const { teacherId } = req.query;

    if (!teacherId) {
      return res.status(400).json({ error: 'teacherId query parameter is required' });
    }

    // Verify teacher exists within this school
    const staff = await Staff.findOne(schoolQuery(req, { _id: teacherId }));
    if (!staff) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    // Find and remove the assignment
    const assignment = staff.teacherAssignments.id(id);
    if (!assignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    staff.teacherAssignments.pull(id);
    await staff.save();

    res.json({
      success: true,
      message: 'Assignment deleted successfully',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
