import express from 'express';
import mongoose from 'mongoose';
import { Class, Student, Timetable, TeacherTimetable } from '../../database.js';
import { authenticate } from '../../middleware/auth.js';
import { scopeBySchool } from './helpers.js';

const router = express.Router();
router.use(authenticate);

// Fix 3.6: Rewritten to query TeacherTimetable (not Timetable) and look up period times
router.get('/:id/timetable/today', authenticate, async (req, res) => {
  try {
    const { CURRENT_ACADEMIC_YEAR } = await import('../../utils/constants.js');
    const { academicYear = CURRENT_ACADEMIC_YEAR, timezone = 'Asia/Kolkata' } = req.query;
    const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: timezone });

    // Query TeacherTimetable for the teacher
    const teacherTimetable = await TeacherTimetable.findOne(
      scopeBySchool(req.user?.schoolId, {
        teacherId: req.params.id,
        academicYear,
      })
    );

    if (!teacherTimetable || !teacherTimetable.schedule[dayName]) {
      return res.json([]);
    }

    const daySlots = teacherTimetable.schedule[dayName];

    // Get class info and period times for each slot
    const classIds = [
      ...new Set(daySlots.filter((s) => s.classId).map((s) => s.classId.toString())),
    ];
    const [classes, classTimetables] = await Promise.all([
      Class.find({ _id: { $in: classIds } })
        .select('name section')
        .lean(),
      Timetable.find(
        scopeBySchool(req.user?.schoolId, {
          classId: { $in: classIds },
          academicYear,
        })
      )
        .select('classId periods')
        .lean(),
    ]);

    // Get student counts (scoped by school)
    const studentCountMatch = {
      classId: { $in: classIds.map((id) => new mongoose.Types.ObjectId(id)) },
      isDeleted: { $ne: true },
    };
    if (req.user?.schoolId) {
      studentCountMatch.schoolId = new mongoose.Types.ObjectId(String(req.user.schoolId));
    }
    const studentCounts = await Student.aggregate([
      { $match: studentCountMatch },
      { $group: { _id: '$classId', count: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(studentCounts.map((sc) => [sc._id.toString(), sc.count]));

    const classMap = Object.fromEntries(classes.map((c) => [c._id.toString(), c]));
    const periodMap = Object.fromEntries(
      classTimetables.map((t) => [t.classId.toString(), t.periods])
    );

    const schedule = daySlots
      .filter((slot) => slot.classId && slot.subject)
      .map((slot) => {
        const classDoc = classMap[slot.classId.toString()];
        const periods = periodMap[slot.classId.toString()] || [];
        const period = periods[slot.periodIndex];

        return {
          id: slot._id?.toString() || `${slot.classId}-${slot.periodIndex}`,
          subject: slot.subject,
          topic: '',
          startTime: period?.startTime || '',
          endTime: period?.endTime || '',
          type: period?.isBreak ? 'break' : 'class',
          room: slot.room || '',
          class: classDoc ? `${classDoc.name}-${classDoc.section}` : '',
          students: countMap[slot.classId.toString()] || 0,
          notes: '',
        };
      })
      .filter((s) => s.startTime)
      .sort((a, b) => {
        const [aH, aM] = a.startTime.split(':').map(Number);
        const [bH, bM] = b.startTime.split(':').map(Number);
        return aH * 60 + aM - (bH * 60 + bM);
      });

    res.json(schedule);
  } catch (error) {
    console.error('Error fetching today timetable:', error);
    res.status(500).json({ error: req.t('common:routes.failedToFetchTimetable') });
  }
});

router.get('/:id/timetable/week', authenticate, async (req, res) => {
  try {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const { CURRENT_ACADEMIC_YEAR } = await import('../../utils/constants.js');
    const { academicYear = CURRENT_ACADEMIC_YEAR } = req.query;

    const teacherTimetable = await TeacherTimetable.findOne(
      scopeBySchool(req.user?.schoolId, {
        teacherId: req.params.id,
        academicYear,
      })
    );

    if (!teacherTimetable) {
      const weekSchedule = {};
      days.forEach((d) => {
        weekSchedule[d] = [];
      });
      return res.json(weekSchedule);
    }

    // Collect all classIds across all days
    const allClassIds = new Set();
    days.forEach((day) => {
      (teacherTimetable.schedule[day] || []).forEach((slot) => {
        if (slot.classId) allClassIds.add(slot.classId.toString());
      });
    });
    const classIdArr = [...allClassIds];

    const [classes, classTimetables, studentCounts] = await Promise.all([
      Class.find({ _id: { $in: classIdArr } })
        .select('name section')
        .lean(),
      Timetable.find(
        scopeBySchool(req.user?.schoolId, {
          classId: { $in: classIdArr },
          academicYear,
        })
      )
        .select('classId periods')
        .lean(),
      Student.aggregate([
        {
          $match: {
            classId: { $in: classIdArr.map((id) => new mongoose.Types.ObjectId(id)) },
            isDeleted: { $ne: true },
            ...(req.user?.schoolId
              ? { schoolId: new mongoose.Types.ObjectId(String(req.user.schoolId)) }
              : {}),
          },
        },
        { $group: { _id: '$classId', count: { $sum: 1 } } },
      ]),
    ]);

    const classMap = Object.fromEntries(classes.map((c) => [c._id.toString(), c]));
    const periodMap = Object.fromEntries(
      classTimetables.map((t) => [t.classId.toString(), t.periods])
    );
    const countMap = Object.fromEntries(studentCounts.map((sc) => [sc._id.toString(), sc.count]));

    const weekSchedule = {};
    days.forEach((day) => {
      const daySlots = teacherTimetable.schedule[day] || [];
      weekSchedule[day] = daySlots
        .filter((slot) => slot.classId && slot.subject)
        .map((slot) => {
          const classDoc = classMap[slot.classId.toString()];
          const periods = periodMap[slot.classId.toString()] || [];
          const period = periods[slot.periodIndex];

          return {
            id: slot._id?.toString() || `${slot.classId}-${slot.periodIndex}`,
            subject: slot.subject,
            topic: '',
            startTime: period?.startTime || '',
            endTime: period?.endTime || '',
            room: slot.room || '',
            class: classDoc ? `${classDoc.name}-${classDoc.section}` : '',
            students: countMap[slot.classId.toString()] || 0,
            notes: '',
          };
        })
        .filter((s) => s.startTime)
        .sort((a, b) => {
          const [aH, aM] = (a.startTime || '00:00').split(':').map(Number);
          const [bH, bM] = (b.startTime || '00:00').split(':').map(Number);
          return aH * 60 + aM - (bH * 60 + bM);
        });
    });

    res.json(weekSchedule);
  } catch (error) {
    console.error('Error fetching weekly timetable:', error);
    res.status(500).json({ error: req.t('common:routes.failedToFetchTimetable') });
  }
});

export default router;
