/**
 * @swagger
 * tags:
 *   name: Timetable
 *   description: Class timetable management — generate, view, and update weekly schedules
 */

/**
 * @swagger
 * /timetable:
 *   get:
 *     summary: List all timetables for the school
 *     tags: [Timetable]
 *     parameters:
 *       - $ref: '#/components/parameters/AcademicYearQuery'
 *     responses:
 *       200:
 *         description: Array of timetables, each with classId populated
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *   post:
 *     summary: Create a timetable for a class
 *     tags: [Timetable]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [classId]
 *             properties:
 *               classId:
 *                 $ref: '#/components/schemas/ObjectId'
 *               academicYear:
 *                 $ref: '#/components/schemas/AcademicYear'
 *               periods:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                     startTime:
 *                       type: string
 *                       example: '09:00'
 *                     endTime:
 *                       type: string
 *                       example: '09:45'
 *                     isBreak:
 *                       type: boolean
 *               schedule:
 *                 type: object
 *                 description: Day → period slot assignments (Monday…Saturday)
 *     responses:
 *       201:
 *         description: Timetable created
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @swagger
 * /timetable/generate-all:
 *   post:
 *     summary: Auto-generate timetables for all classes
 *     description: Creates or regenerates schedules for every class, distributing subjects across periods while avoiding teacher double-booking.
 *     tags: [Timetable]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               academicYear:
 *                 $ref: '#/components/schemas/AcademicYear'
 *               periodRules:
 *                 type: object
 *                 description: Optional custom period configuration
 *     responses:
 *       200:
 *         description: Generation results with per-class success/error breakdown
 *       404:
 *         description: No classes found
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @swagger
 * /timetable/{classId}:
 *   get:
 *     summary: Get timetable for a specific class
 *     tags: [Timetable]
 *     parameters:
 *       - in: path
 *         name: classId
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *       - $ref: '#/components/parameters/AcademicYearQuery'
 *     responses:
 *       200:
 *         description: Class timetable with period and schedule data
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   put:
 *     summary: Replace an entire class timetable
 *     tags: [Timetable]
 *     parameters:
 *       - in: path
 *         name: classId
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               periods:
 *                 type: array
 *                 items:
 *                   type: object
 *               schedule:
 *                 type: object
 *     responses:
 *       200:
 *         description: Updated timetable
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   delete:
 *     summary: Delete a class timetable
 *     tags: [Timetable]
 *     parameters:
 *       - in: path
 *         name: classId
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *     responses:
 *       200:
 *         description: Timetable deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @swagger
 * /timetable/{classId}/slot:
 *   put:
 *     summary: Update a single period slot in a class timetable
 *     tags: [Timetable]
 *     parameters:
 *       - in: path
 *         name: classId
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [day, periodIndex]
 *             properties:
 *               day:
 *                 type: string
 *                 enum: [Monday, Tuesday, Wednesday, Thursday, Friday, Saturday]
 *               periodIndex:
 *                 type: integer
 *               subject:
 *                 type: string
 *               teacherId:
 *                 $ref: '#/components/schemas/ObjectId'
 *               room:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated slot
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @swagger
 * /timetable/{classId}/batch:
 *   post:
 *     summary: Batch update multiple period slots for a class
 *     tags: [Timetable]
 *     parameters:
 *       - in: path
 *         name: classId
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [slots]
 *             properties:
 *               slots:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     day:
 *                       type: string
 *                     periodIndex:
 *                       type: integer
 *                     subject:
 *                       type: string
 *                     teacherId:
 *                       $ref: '#/components/schemas/ObjectId'
 *     responses:
 *       200:
 *         description: Batch update result
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */

/**
 * @swagger
 * /timetable/{classId}/periods:
 *   put:
 *     summary: Update period definitions (time slots) for a class timetable
 *     tags: [Timetable]
 *     parameters:
 *       - in: path
 *         name: classId
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/ObjectId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [periods]
 *             properties:
 *               periods:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                     startTime:
 *                       type: string
 *                     endTime:
 *                       type: string
 *                     isBreak:
 *                       type: boolean
 *     responses:
 *       200:
 *         description: Periods updated
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */

import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import express from 'express';
import { Timetable, Class, Staff } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { validate, schemas, validateZod, zodSchemas } from '../middleware/validation.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';
import timetableService from '../services/timetableService.js';
import { TeacherTimetable } from '../database.js';
import { EVENTS, emitEvent } from '../utils/socketEvents.js';

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

// IMPORTANT: More specific routes must be defined BEFORE parameterized routes (:classId)
// Otherwise, /generate-all would be matched by /:classId

/**
 * GET /api/timetable
 * Get all timetables for school
 * Query params: academicYear (optional, defaults to CURRENT_ACADEMIC_YEAR)
 */
router.get('/', authenticate, checkPermission('classes', 'view'), async (req, res) => {
  try {
    const { academicYear = CURRENT_ACADEMIC_YEAR } = req.query;

    const timetables = await Timetable.find(scopeBySchool(req.user?.schoolId, { academicYear }))
      .populate('classId', 'name section teacher')
      .sort({ 'classId.name': 1, 'classId.section': 1 });

    res.json(timetables);
  } catch (error) {
    console.error('Error fetching all timetables:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/timetable/generate-all
 * Generate/regenerate timetables for all classes
 */
router.post(
  '/generate-all',
  authenticate,
  checkPermission('classes', 'edit'),
  validateZod(zodSchemas.generateAll),
  async (req, res) => {
    try {
      const { academicYear = CURRENT_ACADEMIC_YEAR, periodRules } = req.body;

      // Get all classes (exclude soft-deleted)
      const classes = await Class.find(
        scopeBySchool(req.user?.schoolId, { isDeleted: { $ne: true } })
      ).sort({ name: 1, section: 1 });

      if (classes.length === 0) {
        return res.status(404).json({ error: 'No classes found' });
      }

      const results = [];
      const errors = [];

      // Default periods if not provided
      const defaultPeriods = [
        { name: 'Period 1', startTime: '09:00', endTime: '09:45', isBreak: false },
        { name: 'Period 2', startTime: '09:45', endTime: '10:30', isBreak: false },
        { name: 'Break', startTime: '10:30', endTime: '10:45', isBreak: true },
        { name: 'Period 3', startTime: '10:45', endTime: '11:30', isBreak: false },
        { name: 'Period 4', startTime: '11:30', endTime: '12:15', isBreak: false },
        { name: 'Lunch', startTime: '12:15', endTime: '13:00', isBreak: true },
        { name: 'Period 5', startTime: '13:00', endTime: '13:45', isBreak: false },
        { name: 'Period 6', startTime: '13:45', endTime: '14:30', isBreak: false },
      ];

      // Track teacher busy slots across all classes to prevent double-booking
      const globalTeacherBusy = {};
      // Track what each teacher is teaching at each busy slot for conflict descriptions
      const globalTeacherBusyClass = {}; // teacherId → day → periodIdx → { className, subject }

      for (const cls of classes) {
        try {
          // Skip if class has no subjects
          if (!cls.subjects || cls.subjects.length === 0) {
            errors.push({
              classId: cls._id,
              className: `${cls.name}-${cls.section}`,
              error: 'No subjects assigned',
            });
            continue;
          }

          // Check if timetable exists
          let timetable = await Timetable.findOne(
            scopeBySchool(req.user?.schoolId, { classId: cls._id, academicYear })
          );

          if (!timetable) {
            // Create new timetable
            const resolvedSchoolId = await resolveRequestSchoolId(req);
            timetable = new Timetable({
              classId: cls._id,
              academicYear,
              schoolId: resolvedSchoolId,
              periods: defaultPeriods,
              schedule: {
                Monday: [],
                Tuesday: [],
                Wednesday: [],
                Thursday: [],
                Friday: [],
                Saturday: [],
              },
            });
          }

          // Generate schedule using same logic as wizard
          const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const periods = timetable.periods || defaultPeriods;

          // Collect conflict descriptions for this class
          const classConflicts = [];

          // Initialize empty schedule
          const schedule = {};
          days.forEach((day) => {
            schedule[day] = periods.map(() => ({
              subject: '',
              teacherId: null,
              room: '',
            }));
          });

          // Get non-break periods
          const nonBreakIndices = periods
            .map((p, i) => (!p.isBreak ? i : -1))
            .filter((i) => i !== -1);

          // Track subject usage
          const subjectUsage = {};
          cls.subjects.forEach((s) => {
            subjectUsage[s] = { perDay: {}, perWeek: 0 };
            days.forEach((d) => {
              subjectUsage[s].perDay[d] = 0;
            });
          });

          // Find teachers assigned to this class's subjects
          const assignedTeachers = await Staff.find(
            scopeBySchool(req.user?.schoolId, {
              isDeleted: { $ne: true },
              'teacherAssignments.classes': cls._id,
            })
          )
            .select('_id teacherAssignments')
            .lean();

          // Build subject → teacher map for this class
          const subjectTeacherMap = {};
          for (const teacher of assignedTeachers) {
            for (const assignment of teacher.teacherAssignments || []) {
              if (assignment.classes.some((c) => c.toString() === cls._id.toString())) {
                if (!subjectTeacherMap[assignment.subject]) {
                  subjectTeacherMap[assignment.subject] = [];
                }
                subjectTeacherMap[assignment.subject].push(teacher._id.toString());
              }
            }
          }

          // Calculate periods per subject
          const totalAvailablePeriods = nonBreakIndices.length * days.length;
          const periodsPerSubject = Math.floor(totalAvailablePeriods / cls.subjects.length);

          // Build subject pool
          const subjectPool = [];
          cls.subjects.forEach((subject) => {
            for (let i = 0; i < Math.max(1, periodsPerSubject); i++) {
              subjectPool.push(subject);
            }
          });

          // Shuffle and fill schedule
          const shuffleArray = (arr) => {
            const shuffled = [...arr];
            for (let i = shuffled.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            return shuffled;
          };

          for (const day of days) {
            const pool = shuffleArray(subjectPool);

            for (const periodIdx of nonBreakIndices) {
              let selectedSubject = null;

              for (let i = 0; i < pool.length; i++) {
                const subject = pool[i];
                const usage = subjectUsage[subject];

                // Check constraints
                const maxPerDay = periodRules?.maxPeriodsPerSubjectPerDay || 1;
                const maxPerWeek = periodRules?.maxPeriodsPerSubjectPerWeek || 5;
                const noConsecutive = periodRules?.noConsecutiveSame !== false;

                if (usage.perDay[day] >= maxPerDay) continue;
                if (usage.perWeek >= maxPerWeek) continue;

                if (noConsecutive && periodIdx > 0) {
                  const prevPeriod = periodIdx - 1;
                  if (
                    !periods[prevPeriod]?.isBreak &&
                    schedule[day][prevPeriod]?.subject === subject
                  ) {
                    continue;
                  }
                }

                selectedSubject = subject;
                pool.splice(i, 1);
                break;
              }

              if (selectedSubject) {
                // Try to auto-assign a teacher
                let assignedTeacherId = null;
                const candidateTeachers = subjectTeacherMap[selectedSubject] || [];

                if (candidateTeachers.length === 0) {
                  classConflicts.push({
                    type: 'no_teacher_assigned',
                    day,
                    periodIndex: periodIdx,
                    subject: selectedSubject,
                    description: `No teacher is assigned to teach "${selectedSubject}" in class ${cls.name}-${cls.section}`,
                  });
                } else {
                  for (const tId of candidateTeachers) {
                    if (!globalTeacherBusy[tId]) globalTeacherBusy[tId] = {};
                    if (!globalTeacherBusy[tId][day]) globalTeacherBusy[tId][day] = new Set();
                    if (!globalTeacherBusy[tId][day].has(periodIdx)) {
                      assignedTeacherId = tId;
                      globalTeacherBusy[tId][day].add(periodIdx);
                      if (!globalTeacherBusyClass[tId]) globalTeacherBusyClass[tId] = {};
                      if (!globalTeacherBusyClass[tId][day]) globalTeacherBusyClass[tId][day] = {};
                      globalTeacherBusyClass[tId][day][periodIdx] = {
                        className: `${cls.name}-${cls.section}`,
                        subject: selectedSubject,
                      };
                      break;
                    }
                  }

                  if (!assignedTeacherId) {
                    const conflictDetails = candidateTeachers.map((tId) => {
                      const busyInfo = globalTeacherBusyClass[tId]?.[day]?.[periodIdx];
                      return busyInfo
                        ? `already teaching "${busyInfo.subject}" in class ${busyInfo.className}`
                        : 'already occupied';
                    });
                    classConflicts.push({
                      type: 'teacher_conflict',
                      day,
                      periodIndex: periodIdx,
                      subject: selectedSubject,
                      description: `All ${candidateTeachers.length} teacher(s) for "${selectedSubject}" are unavailable on ${day} period ${periodIdx + 1}: ${conflictDetails.join('; ')}`,
                    });
                  }
                }

                schedule[day][periodIdx] = {
                  subject: selectedSubject,
                  teacherId: assignedTeacherId,
                  room: `Room ${cls.name.replace('Class ', '')}-${cls.section}`,
                };

                subjectUsage[selectedSubject].perDay[day]++;
                subjectUsage[selectedSubject].perWeek++;
              } else {
                classConflicts.push({
                  type: 'subject_pool_exhausted',
                  day,
                  periodIndex: periodIdx,
                  description: `No eligible subject could be assigned to period ${periodIdx + 1} on ${day} — all subjects reached their daily/weekly limit or consecutive-period constraint`,
                });
              }
            }
          }

          timetable.schedule = schedule;
          timetable.version += 1;
          timetable.lastSyncedAt = new Date();

          await timetable.save();
          await timetable.populate('classId', 'name section teacher');

          results.push({
            classId: cls._id,
            className: `${cls.name}-${cls.section}`,
            success: true,
            conflicts: classConflicts,
            conflictCount: classConflicts.length,
          });
        } catch (err) {
          console.error(`Error generating timetable for class ${cls.name}-${cls.section}:`, err);
          errors.push({
            classId: cls._id,
            className: `${cls.name}-${cls.section}`,
            error: err.message,
          });
        }
      }

      // --- Sync TeacherTimetable documents from generated class timetables ---
      try {
        const resolvedSchoolId = await resolveRequestSchoolId(req);
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        // Reload all generated timetables
        const allTimetables = await Timetable.find(
          scopeBySchool(req.user?.schoolId, { academicYear })
        ).lean();

        // Build teacher → schedule map
        const teacherScheduleMap = {}; // teacherId → { Monday: [...], ... }
        for (const tt of allTimetables) {
          for (const day of days) {
            const slots = tt.schedule?.[day] || [];
            slots.forEach((slot, idx) => {
              if (slot.teacherId) {
                const tid = slot.teacherId.toString();
                if (!teacherScheduleMap[tid]) {
                  teacherScheduleMap[tid] = {};
                  days.forEach((d) => {
                    teacherScheduleMap[tid][d] = [];
                  });
                }
                teacherScheduleMap[tid][day].push({
                  periodIndex: idx,
                  classId: tt.classId,
                  subject: slot.subject || '',
                  room: slot.room || '',
                  lastModified: new Date(),
                });
              }
            });
          }
        }

        // Upsert TeacherTimetable for each teacher
        let syncedTeachers = 0;
        for (const [teacherId, schedule] of Object.entries(teacherScheduleMap)) {
          const totalPeriods = days.reduce((sum, d) => sum + schedule[d].length, 0);
          await TeacherTimetable.findOneAndUpdate(
            { schoolId: resolvedSchoolId, teacherId, academicYear },
            {
              $set: {
                schedule,
                totalPeriodsPerWeek: totalPeriods,
                lastSyncedAt: new Date(),
              },
              $inc: { version: 1 },
              $setOnInsert: { schoolId: resolvedSchoolId, teacherId, academicYear },
            },
            { upsert: true, new: true }
          );
          syncedTeachers++;
        }

        res.json({
          success: true,
          generated: results.length,
          syncedTeachers,
          errorCount: errors.length,
          totalConflicts: results.reduce((sum, r) => sum + (r.conflictCount || 0), 0),
          results,
          errors,
        });
      } catch (syncError) {
        console.error('Teacher timetable sync error (class timetables still saved):', syncError);
        res.json({
          success: true,
          generated: results.length,
          syncedTeachers: 0,
          syncWarning:
            'Class timetables generated but teacher timetable sync failed: ' + syncError.message,
          errorCount: errors.length,
          totalConflicts: results.reduce((sum, r) => sum + (r.conflictCount || 0), 0),
          results,
          errors,
        });
      }
    } catch (error) {
      console.error('Error generating all timetables:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /api/timetable/:classId
 * Get timetable for a class
 * Query params: academicYear (optional, defaults to CURRENT_ACADEMIC_YEAR)
 */
router.get('/:classId', authenticate, checkPermission('classes', 'view'), async (req, res) => {
  try {
    const { classId } = req.params;
    const { academicYear = CURRENT_ACADEMIC_YEAR } = req.query;

    const timetable = await Timetable.findOne(
      scopeBySchool(req.user?.schoolId, { classId, academicYear })
    );

    if (!timetable) {
      return res.status(404).json({ error: 'Timetable not found for this class' });
    }

    res.json(timetable);
  } catch (error) {
    console.error('Error fetching timetable:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/timetable
 * Create new timetable
 */
router.post(
  '/',
  authenticate,
  checkPermission('classes', 'edit'),
  validateZod(zodSchemas.createTimetable),
  async (req, res) => {
    try {
      const { classId, academicYear = CURRENT_ACADEMIC_YEAR, periods, schedule } = req.body;

      // Validate class exists
      const classData = await Class.findOne(
        scopeBySchool(req.user?.schoolId, { _id: classId, isDeleted: { $ne: true } })
      );
      if (!classData) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }

      // Check if timetable already exists
      const existing = await Timetable.findOne(
        scopeBySchool(req.user?.schoolId, { classId, academicYear })
      );
      if (existing) {
        return res
          .status(400)
          .json({ error: 'Timetable already exists for this class and academic year' });
      }

      const timetable = new Timetable({
        classId,
        academicYear,
        schoolId: await resolveRequestSchoolId(req),
        periods: periods || [],
        schedule: schedule || {
          Monday: [],
          Tuesday: [],
          Wednesday: [],
          Thursday: [],
          Friday: [],
          Saturday: [],
        },
      });

      await timetable.save();

      // Populate class info for response
      await timetable.populate('classId', 'name section');

      const io = req.app.get('io');
      emitEvent(io, EVENTS.TIMETABLE_UPDATED, {
        schoolId: timetable.schoolId?.toString(),
        classId: classId?.toString(),
        academicYear,
      });

      res.status(201).json(timetable);
    } catch (error) {
      console.error('Error creating timetable:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * PUT /api/timetable/:classId/slot
 * Update a single slot in timetable
 * Body: { day, periodIndex, subject, teacherId, room }
 */
router.put(
  '/:classId/slot',
  authenticate,
  checkPermission('classes', 'edit'),
  validateZod(zodSchemas.updateSlot),
  async (req, res) => {
    try {
      const { classId } = req.params;
      const {
        day,
        periodIndex,
        subject,
        teacherId,
        room,
        academicYear = CURRENT_ACADEMIC_YEAR,
      } = req.body;

      // Validate teacher if provided
      if (teacherId) {
        const teacher = await Staff.findOne(scopeBySchool(req.user?.schoolId, { _id: teacherId }));
        if (!teacher) {
          return res.status(404).json({ error: 'Teacher not found' });
        }
      }

      // Find timetable
      const timetable = await Timetable.findOne(
        scopeBySchool(req.user?.schoolId, { classId, academicYear })
      );
      if (!timetable) {
        return res.status(404).json({ error: 'Timetable not found' });
      }

      // Ensure schedule array has enough slots
      while (timetable.schedule[day].length <= periodIndex) {
        timetable.schedule[day].push({
          subject: '',
          teacherId: null,
          room: '',
          lastModified: new Date(),
          modifiedBy: req.user?.id,
        });
      }

      // Store old teacherId before updating for sync
      const oldTeacherId = timetable.schedule[day][periodIndex]?.teacherId?.toString() || null;

      // Use timetableService to sync both class and teacher timetables
      try {
        await timetableService.syncTimetables({
          sourceType: 'class',
          sourceId: classId,
          day,
          periodIndex,
          slotData: {
            subject: subject || '',
            teacherId: teacherId || null,
            room: room || '',
          },
          academicYear,
          modifiedBy: req.user?.id,
          schoolId: req.user?.schoolId,
        });
      } catch (syncError) {
        console.error('Sync error (falling back to direct save):', syncError);
        // Fallback: save class timetable directly
        timetable.schedule[day][periodIndex] = {
          subject: subject || '',
          teacherId: teacherId || null,
          room: room || '',
          lastModified: new Date(),
          modifiedBy: req.user?.id,
        };
        timetable.version += 1;
        timetable.lastSyncedAt = new Date();
        await timetable.save();
      }

      // Reload and populate for response
      const updated = await Timetable.findOne(
        scopeBySchool(req.user?.schoolId, { classId, academicYear })
      ).populate('classId', 'name section');

      const io = req.app.get('io');
      emitEvent(io, EVENTS.TIMETABLE_UPDATED, {
        schoolId: req.user?.schoolId?.toString(),
        classId: classId?.toString(),
        academicYear,
      });

      res.json(updated);
    } catch (error) {
      console.error('Error updating timetable slot:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * POST /api/timetable/:classId/batch
 * Batch update slots in timetable
 * Body: { slots: [{ day, periodIndex, subject, teacherId, room }], academicYear }
 */
router.post(
  '/:classId/batch',
  authenticate,
  checkPermission('classes', 'edit'),
  validateZod(zodSchemas.batchUpdateSlots),
  async (req, res) => {
    try {
      const { classId } = req.params;
      const { slots: updates, academicYear = CURRENT_ACADEMIC_YEAR } = req.body;

      // Find timetable
      const timetable = await Timetable.findOne(
        scopeBySchool(req.user?.schoolId, { classId, academicYear })
      );
      if (!timetable) {
        return res.status(404).json({ error: 'Timetable not found' });
      }

      // Process each update (already validated by Zod)
      for (const update of updates) {
        const { day, periodIndex, subject, teacherId, room } = update;

        // Ensure schedule array has enough slots
        while (timetable.schedule[day].length <= periodIndex) {
          timetable.schedule[day].push({
            subject: '',
            teacherId: null,
            room: '',
            lastModified: new Date(),
            modifiedBy: req.user?.id,
          });
        }

        // Update the slot
        timetable.schedule[day][periodIndex] = {
          subject: subject || '',
          teacherId: teacherId || null,
          room: room || '',
          lastModified: new Date(),
          modifiedBy: req.user?.id,
        };
      }

      // Increment version
      timetable.version += 1;
      timetable.lastSyncedAt = new Date();

      await timetable.save();
      await timetable.populate('classId', 'name section');

      const io = req.app.get('io');
      emitEvent(io, EVENTS.TIMETABLE_UPDATED, {
        schoolId: timetable.schoolId?.toString(),
        classId: classId?.toString(),
        academicYear,
      });

      res.json(timetable);
    } catch (error) {
      console.error('Error batch updating timetable:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * PUT /api/timetable/:classId/periods
 * Update period configuration
 * Body: { periods: [{ name, startTime, endTime, isBreak }], academicYear }
 */
router.put(
  '/:classId/periods',
  authenticate,
  checkPermission('classes', 'edit'),
  validateZod(zodSchemas.updatePeriods),
  async (req, res) => {
    try {
      const { classId } = req.params;
      const { periods, academicYear = CURRENT_ACADEMIC_YEAR } = req.body;

      // Find timetable
      const timetable = await Timetable.findOne(
        scopeBySchool(req.user?.schoolId, { classId, academicYear })
      );
      if (!timetable) {
        return res.status(404).json({ error: 'Timetable not found' });
      }

      // Update periods
      timetable.periods = periods;
      timetable.version += 1;
      timetable.lastSyncedAt = new Date();

      await timetable.save();
      await timetable.populate('classId', 'name section');

      const io = req.app.get('io');
      emitEvent(io, EVENTS.TIMETABLE_UPDATED, {
        schoolId: timetable.schoolId?.toString(),
        classId: classId?.toString(),
        academicYear,
      });

      res.json(timetable);
    } catch (error) {
      console.error('Error updating periods:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * PUT /api/timetable/:classId
 * Update entire timetable
 * Body: { academicYear, periods, schedule }
 * Note: This must come AFTER more specific routes like /:classId/slot, /:classId/periods
 */
router.put(
  '/:classId',
  authenticate,
  checkPermission('classes', 'edit'),
  validateZod(zodSchemas.updateTimetable),
  async (req, res) => {
    try {
      const { classId } = req.params;
      const { academicYear = CURRENT_ACADEMIC_YEAR, periods, schedule } = req.body;

      // Validate class exists
      const classData = await Class.findOne(
        scopeBySchool(req.user?.schoolId, { _id: classId, isDeleted: { $ne: true } })
      );
      if (!classData) {
        return res.status(404).json({ error: req.t('common:errors.classNotFound') });
      }

      // Find existing timetable
      let timetable = await Timetable.findOne(
        scopeBySchool(req.user?.schoolId, { classId, academicYear })
      );

      if (timetable) {
        // Update existing timetable
        if (periods) timetable.periods = periods;
        if (schedule) timetable.schedule = schedule;
        timetable.version += 1;
        timetable.lastSyncedAt = new Date();
      } else {
        // Create new timetable
        timetable = new Timetable({
          classId,
          academicYear,
          schoolId: await resolveRequestSchoolId(req),
          periods: periods || [],
          schedule: schedule || {
            Monday: [],
            Tuesday: [],
            Wednesday: [],
            Thursday: [],
            Friday: [],
            Saturday: [],
          },
        });
      }

      await timetable.save();
      await timetable.populate('classId', 'name section');

      const io = req.app.get('io');
      emitEvent(io, EVENTS.TIMETABLE_UPDATED, {
        schoolId: timetable.schoolId?.toString(),
        classId: classId?.toString(),
        academicYear,
      });

      res.json(timetable);
    } catch (error) {
      console.error('Error updating timetable:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * DELETE /api/timetable/:classId
 * Delete timetable
 * Query params: academicYear (optional, defaults to CURRENT_ACADEMIC_YEAR)
 */
router.delete('/:classId', authenticate, checkPermission('classes', 'delete'), async (req, res) => {
  try {
    const { classId } = req.params;
    const { academicYear = CURRENT_ACADEMIC_YEAR } = req.query;

    const timetable = await Timetable.findOneAndDelete(
      scopeBySchool(req.user?.schoolId, { classId, academicYear })
    );

    if (!timetable) {
      return res.status(404).json({ error: 'Timetable not found' });
    }

    const io = req.app.get('io');
    emitEvent(io, EVENTS.TIMETABLE_UPDATED, {
      schoolId: timetable.schoolId?.toString(),
      classId: classId?.toString(),
      academicYear,
    });

    res.json({ success: true, message: 'Timetable deleted successfully' });
  } catch (error) {
    console.error('Error deleting timetable:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
