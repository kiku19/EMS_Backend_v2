import express from 'express';
import { Student, Class, StudentFeeStructure, Attendance, ActivityLog } from '../../database.js';
import { authenticate } from '../../middleware/auth.js';
import { checkPermission } from '../../middleware/permissions.js';
import {
  validateZod,
  studentPromoteSchema,
  yearEndPromotionSchema,
} from '../../validators/index.js';
import { CURRENT_ACADEMIC_YEAR } from '../../utils/constants.js';
import { extractSchoolId } from '../../utils/schoolContext.js';
import { checkClassCapacity } from '../../utils/classCapacity.js';
import { scopeBySchool, initializeFeeStructure } from './helpers.js';

const router = express.Router();
router.use(authenticate);

// ─── YEAR-END BULK PROMOTION ──────────────────────────────────────
// Static path must be registered before /:id/promote
router.post(
  '/promote/year-end',
  authenticate,
  checkPermission('students', 'edit'),
  validateZod(yearEndPromotionSchema),
  async (req, res) => {
    try {
      const schoolId = req.user?.schoolId;
      const {
        academicYear,
        classPromotions,
        skipFeeCheck = false,
        skipAttendanceCheck = false,
      } = req.body;

      const summary = {
        totalClasses: classPromotions.length,
        totalStudents: 0,
        promoted: 0,
        graduated: 0,
        notPromoted: 0,
        errors: 0,
      };
      const details = [];

      for (const mapping of classPromotions) {
        const { fromClassId, toClassId, graduate = false } = mapping;

        const fromClass = await Class.findOne(
          scopeBySchool(schoolId, { _id: fromClassId, isDeleted: { $ne: true } })
        );
        if (!fromClass) {
          details.push({ fromClassId, error: req.t('common:routes.sourceClassNotFound') });
          continue;
        }

        let toClass = null;
        if (!graduate) {
          toClass = await Class.findOne(
            scopeBySchool(schoolId, { _id: toClassId, isDeleted: { $ne: true } })
          );
          if (!toClass) {
            details.push({ fromClassId, error: req.t('common:routes.targetClassNotFound') });
            continue;
          }
        }

        const students = await Student.find(
          scopeBySchool(schoolId, {
            classId: fromClassId,
            status: 'active',
            isDeleted: { $ne: true },
          })
        );
        summary.totalStudents += students.length;

        const classResult = {
          fromClass: `${fromClass.name}-${fromClass.section}`,
          toClass: graduate ? 'Graduated' : `${toClass.name}-${toClass.section}`,
          promoted: [],
          graduated: [],
          notPromoted: [],
          errors: [],
        };

        for (const student of students) {
          try {
            if (!skipFeeCheck && student.feeStatus === 'pending') {
              classResult.notPromoted.push({
                studentId: student._id,
                studentName: student.name,
                reason: 'Fee pending',
              });
              summary.notPromoted++;
              continue;
            }

            if (!skipAttendanceCheck) {
              // Scope attendance to the source class's academic year
              const attYearStr = fromClass.academicYear || CURRENT_ACADEMIC_YEAR;
              const [attYearStart] = attYearStr.split('-');
              const attYearNum = parseInt(attYearStart, 10);
              const attQuery = scopeBySchool(schoolId, { studentId: student._id });
              if (!isNaN(attYearNum)) {
                attQuery.date = { $gte: `${attYearNum}-04-01`, $lte: `${attYearNum + 1}-03-31` };
              }
              const attendance = await Attendance.find(attQuery);
              const present = attendance.filter(
                (a) => a.status === 'present' || a.status === 'late'
              ).length;
              const attendancePercent =
                attendance.length > 0 ? (present / attendance.length) * 100 : 0;
              if (attendancePercent < 60) {
                classResult.notPromoted.push({
                  studentId: student._id,
                  studentName: student.name,
                  reason: 'Low attendance',
                });
                summary.notPromoted++;
                continue;
              }
            }

            const oldAcademicYear = fromClass.academicYear || CURRENT_ACADEMIC_YEAR;

            if (graduate) {
              student.status = 'graduated';
              student.academicYear = academicYear;
              await student.save();
              classResult.graduated.push({ studentId: student._id, studentName: student.name });
              summary.graduated++;
            } else {
              student.classId = toClassId;
              student.academicYear = academicYear;
              student.feeStatus = 'pending';
              student.feeDetails = {
                totalFee: 0,
                paidAmount: 0,
                balanceAmount: 0,
                discountApplied: 0,
                lastPaymentDate: null,
              };
              await student.save();
              await StudentFeeStructure.deleteMany(
                scopeBySchool(schoolId, { studentId: student._id, academicYear: oldAcademicYear })
              );
              try {
                await initializeFeeStructure(student);
              } catch (feeError) {
                console.error(
                  'Error initializing fee structure after year-end promotion:',
                  feeError
                );
              }
              classResult.promoted.push({ studentId: student._id, studentName: student.name });
              summary.promoted++;
            }
          } catch (err) {
            classResult.errors.push({
              studentId: student._id,
              studentName: student.name,
              error: err.message,
            });
            summary.errors++;
          }
        }
        details.push(classResult);
      }

      await ActivityLog.create({
        schoolId: extractSchoolId(schoolId),
        activityType: 'year_end_promotion',
        description: `Year-end promotion completed for academic year ${academicYear}: ${summary.promoted} promoted, ${summary.graduated} graduated, ${summary.notPromoted} held back`,
        performedBy: req.user?.id,
        details: { academicYear, summary },
      });

      res.json({ success: true, summary, details });
    } catch (error) {
      console.error('Error in year-end promotion:', error);
      res.status(500).json({ error: req.t('common:routes.yearEndPromotionFailed') });
    }
  }
);

// ─── INDIVIDUAL STUDENT PROMOTION ────────────────────────────────
router.post(
  '/:id/promote',
  authenticate,
  checkPermission('students', 'edit'),
  validateZod(studentPromoteSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const schoolId = req.user?.schoolId;
      const {
        targetClassId,
        academicYear = CURRENT_ACADEMIC_YEAR,
        graduate = false,
        skipFeeCheck = false,
        skipAttendanceCheck = false,
      } = req.body;

      const student = await Student.findOne(
        scopeBySchool(schoolId, { _id: id, isDeleted: { $ne: true } })
      ).populate('classId', 'name section academicYear');
      if (!student) return res.status(404).json({ error: req.t('common:routes.studentNotFound1') });
      if (student.status !== 'active')
        return res
          .status(400)
          .json({ error: req.t('common:routes.onlyActiveStudentsCanBePromoted') });

      const fromClass = student.classId;

      if (graduate) {
        student.status = 'graduated';
        student.academicYear = academicYear;
        await student.save();
        await ActivityLog.create({
          schoolId: extractSchoolId(schoolId),
          activityType: 'student_graduated',
          description: `Student ${student.name} marked as graduated`,
          performedBy: req.user?.id,
          details: { studentId: student._id, fromClass: fromClass?._id, academicYear },
        });
        return res.json({
          success: true,
          message: `${student.name} marked as graduated`,
          student: { _id: student._id, name: student.name, status: student.status },
        });
      }

      // Validate target class
      const targetClass = await Class.findOne(
        scopeBySchool(schoolId, { _id: targetClassId, isDeleted: { $ne: true } })
      );
      if (!targetClass)
        return res
          .status(400)
          .json({ error: req.t('common:routes.targetClassNotFoundInYourSchool') });

      // Check target class capacity
      const capacityResult = await checkClassCapacity(targetClassId, schoolId);
      if (capacityResult?.isFull) {
        return res.status(400).json({
          error: `Target class is at full capacity (${capacityResult.currentCount}/${capacityResult.capacity}). Cannot promote student.`,
        });
      }

      // Fee check
      if (!skipFeeCheck && student.feeStatus === 'pending') {
        return res.status(400).json({
          error: req.t('common:routes.studentHasPendingFeesUseSkipfeecheckTrueToOverride'),
        });
      }

      // Attendance check (scoped to student's current academic year)
      if (!skipAttendanceCheck) {
        const attYearStr = fromClass?.academicYear || CURRENT_ACADEMIC_YEAR;
        const [attYearStart] = attYearStr.split('-');
        const attYearNum = parseInt(attYearStart, 10);
        const attQuery = scopeBySchool(schoolId, { studentId: id });
        if (!isNaN(attYearNum)) {
          attQuery.date = { $gte: `${attYearNum}-04-01`, $lte: `${attYearNum + 1}-03-31` };
        }
        const attendance = await Attendance.find(attQuery);
        const present = attendance.filter(
          (a) => a.status === 'present' || a.status === 'late'
        ).length;
        const attendancePercent = attendance.length > 0 ? (present / attendance.length) * 100 : 0;
        if (attendancePercent < 60) {
          return res.status(400).json({
            error: `Attendance too low (${attendancePercent.toFixed(1)}%). Use skipAttendanceCheck:true to override.`,
          });
        }
      }

      const oldAcademicYear = fromClass?.academicYear || CURRENT_ACADEMIC_YEAR;

      // Promote student
      student.classId = targetClassId;
      student.academicYear = academicYear;
      student.feeStatus = 'pending';
      student.feeDetails = {
        totalFee: 0,
        paidAmount: 0,
        balanceAmount: 0,
        discountApplied: 0,
        lastPaymentDate: null,
      };
      await student.save();

      // Remove old StudentFeeStructure and initialize new one for promoted class/year
      await StudentFeeStructure.deleteMany(
        scopeBySchool(schoolId, { studentId: id, academicYear: oldAcademicYear })
      );
      try {
        await initializeFeeStructure(student);
      } catch (feeError) {
        console.error('Error initializing fee structure after promotion:', feeError);
      }

      await ActivityLog.create({
        schoolId: extractSchoolId(schoolId),
        activityType: 'student_promoted',
        description: `Student ${student.name} promoted from ${fromClass?.name || '?'}-${fromClass?.section || '?'} to ${targetClass.name}-${targetClass.section}`,
        performedBy: req.user?.id,
        details: {
          studentId: student._id,
          fromClass: fromClass?._id,
          toClass: targetClassId,
          academicYear,
        },
      });

      res.json({
        success: true,
        message: `${student.name} promoted to ${targetClass.name}-${targetClass.section}`,
        student: { _id: student._id, name: student.name, classId: targetClassId, academicYear },
      });
    } catch (error) {
      console.error('Error promoting student:', error);
      res.status(500).json({ error: req.t('common:routes.failedToPromoteStudent') });
    }
  }
);

export default router;
