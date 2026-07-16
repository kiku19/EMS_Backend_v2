import express from 'express';
import mongoose from 'mongoose';
import { Student, Class, StudentFeeStructure, Attendance, ActivityLog } from '../../database.js';
import { authenticate } from '../../middleware/auth.js';
import { checkPermission } from '../../middleware/permissions.js';
import {
  validateZod,
  studentPromoteSchema,
  yearEndPromotionSchema,
  bulkStudentPromoteSchema,
} from '../../validators/index.js';
import { CURRENT_ACADEMIC_YEAR } from '../../utils/constants.js';
import { extractSchoolId } from '../../utils/schoolContext.js';
import { checkClassCapacity } from '../../utils/classCapacity.js';
import {
  scopeBySchool,
  initializeFeeStructure,
  resyncFeeStructureForClassChange,
  assertStudentCanPromote,
} from './helpers.js';

const router = express.Router();
router.use(authenticate);

async function syncPromotedStudentFees(student, previousAcademicYear, session) {
  const feeStructure =
    previousAcademicYear === student.academicYear
      ? await resyncFeeStructureForClassChange(student, { session })
      : await initializeFeeStructure(student, { session });

  if (!feeStructure) return;

  student.feeStatus = feeStructure.overallStatus || 'pending';
  student.feeDetails = {
    totalFee: feeStructure.totalFee || 0,
    paidAmount: feeStructure.totalPaid || 0,
    balanceAmount: feeStructure.totalBalance || 0,
    discountApplied: feeStructure.discountApplied || 0,
    lastPaymentDate: feeStructure.lastPaymentDate || null,
  };
  await student.save({ session });
}

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
          if (toClass.academicYear && toClass.academicYear !== academicYear) {
            details.push({
              fromClassId,
              error: `Target class belongs to ${toClass.academicYear}, not ${academicYear}`,
            });
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

            const oldAcademicYear =
              student.academicYear || fromClass.academicYear || CURRENT_ACADEMIC_YEAR;

            if (graduate) {
              const session = await mongoose.startSession();
              try {
                await session.withTransaction(async (transactionSession) => {
                  const currentStudent = await Student.findOne(
                    scopeBySchool(schoolId, {
                      _id: student._id,
                      status: 'active',
                      isDeleted: { $ne: true },
                    })
                  ).session(transactionSession);
                  if (!currentStudent) throw new Error('Student is no longer active');
                  currentStudent.status = 'graduated';
                  currentStudent.academicYear = academicYear;
                  await currentStudent.save({ session: transactionSession });
                });
              } finally {
                await session.endSession();
              }
              classResult.graduated.push({ studentId: student._id, studentName: student.name });
              summary.graduated++;
            } else {
              const oldFeeStructure = await StudentFeeStructure.findOne(
                scopeBySchool(schoolId, {
                  studentId: student._id,
                  academicYear: oldAcademicYear,
                  isDeleted: { $ne: true },
                })
              );
              const unpaidBalance = oldFeeStructure?.totalBalance || 0;

              const session = await mongoose.startSession();
              try {
                await session.withTransaction(async (transactionSession) => {
                  const currentStudent = await Student.findOne(
                    scopeBySchool(schoolId, {
                      _id: student._id,
                      status: 'active',
                      isDeleted: { $ne: true },
                    })
                  ).session(transactionSession);
                  const currentTargetClass = await Class.findOne(
                    scopeBySchool(schoolId, {
                      _id: toClassId,
                      isDeleted: { $ne: true },
                    })
                  ).session(transactionSession);
                  if (!currentStudent || !currentTargetClass) {
                    throw new Error('Student or target class changed during promotion');
                  }
                  if (
                    currentTargetClass.academicYear &&
                    currentTargetClass.academicYear !== academicYear
                  ) {
                    throw new Error(
                      `Target class belongs to ${currentTargetClass.academicYear}, not ${academicYear}`
                    );
                  }

                  currentStudent.classId = currentTargetClass._id;
                  currentStudent.academicYear = academicYear;
                  currentStudent.rollNo = null;
                  await currentStudent.save({ session: transactionSession });
                  await syncPromotedStudentFees(
                    currentStudent,
                    oldAcademicYear,
                    transactionSession
                  );
                });
              } finally {
                await session.endSession();
              }
              const promotedEntry = { studentId: student._id, studentName: student.name };
              if (unpaidBalance > 0) {
                promotedEntry.warning = `Unpaid balance of ₹${unpaidBalance} remains recorded against ${oldAcademicYear}.`;
              }
              classResult.promoted.push(promotedEntry);
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

// ─── BULK PROMOTE STUDENTS ───────────────────────────────────────
// Replaces N sequential /:id/promote calls from the students list action.
// Static path must be registered before /:id/promote.
router.post(
  '/bulk-promote',
  authenticate,
  checkPermission('students', 'edit'),
  validateZod(bulkStudentPromoteSchema),
  async (req, res) => {
    const schoolId = req.user?.schoolId;
    const { promotions, skipFeeCheck = false, skipAttendanceCheck = false } = req.body;
    const targetClassIds = [
      ...new Set(promotions.filter((p) => !p.graduate).map((p) => String(p.targetClassId))),
    ];

    try {
      // Reject the entire operation before any write if a target belongs to
      // another tenant (or was deleted). Partial promotion is not safe.
      const targetClasses = await Class.find(
        scopeBySchool(schoolId, {
          _id: { $in: targetClassIds },
          isDeleted: { $ne: true },
        })
      );
      const targetClassMap = new Map(targetClasses.map((cls) => [String(cls._id), cls]));
      const missingTargetIds = targetClassIds.filter((id) => !targetClassMap.has(id));
      if (missingTargetIds.length > 0) {
        return res.status(400).json({
          error: 'One or more target classes were not found in your school',
          targetClassIds: missingTargetIds,
        });
      }

      // C26: Run the same three guards single-promote runs (pending fees,
      // attendance threshold, target-class capacity) per student BEFORE the
      // transaction. Failures are recorded, not silently skipped — the rest of
      // the batch still promotes.
      const studentIds = promotions.map((p) => p.studentId);
      const guardStudents = await Student.find(
        scopeBySchool(schoolId, {
          _id: { $in: studentIds },
          isDeleted: { $ne: true },
        })
      ).populate('classId', 'name section academicYear');

      const guardStudentMap = new Map(
        guardStudents.map((student) => [String(student._id), student])
      );
      if (guardStudentMap.size !== new Set(studentIds.map(String)).size) {
        const missingStudentIds = studentIds.map(String).filter((id) => !guardStudentMap.has(id));
        return res.status(400).json({
          error: 'One or more students were not found in your school',
          studentIds: missingStudentIds,
        });
      }

      const failedDetails = [];
      // Running tally of seats reserved per target class within this batch.
      // checkClassCapacity reads committed data, so it cannot see in-batch
      // promotions — we pass this in via extraOccupied to prevent over-filling.
      const targetOccupancy = new Map();
      for (const id of targetClassIds) targetOccupancy.set(id, 0);

      const allowedPromotions = [];
      for (const promo of promotions) {
        const student = guardStudentMap.get(String(promo.studentId));
        if (promo.graduate) {
          allowedPromotions.push(promo);
          continue;
        }
        const targetClass = targetClassMap.get(String(promo.targetClassId));
        try {
          await assertStudentCanPromote(student, targetClass, {
            schoolId,
            skipFeeCheck,
            skipAttendanceCheck,
            extraOccupied: targetOccupancy.get(String(promo.targetClassId)) || 0,
          });
          // Reserve a seat in this target class for the rest of the batch.
          targetOccupancy.set(
            String(promo.targetClassId),
            (targetOccupancy.get(String(promo.targetClassId)) || 0) + 1
          );
          allowedPromotions.push(promo);
        } catch (guardError) {
          failedDetails.push({
            studentId: promo.studentId,
            reason: guardError.code || guardError.message,
            message: guardError.message,
          });
        }
      }

      const mongoSession = await mongoose.startSession();
      let promoted = 0;
      let graduated = 0;
      try {
        await mongoSession.withTransaction(async (session) => {
          const allowedIds = allowedPromotions.map((p) => p.studentId);
          const students = await Student.find(
            scopeBySchool(schoolId, {
              _id: { $in: allowedIds },
              isDeleted: { $ne: true },
            })
          ).session(session);
          const currentTargetClasses = await Class.find(
            scopeBySchool(schoolId, {
              _id: { $in: targetClassIds },
              isDeleted: { $ne: true },
            })
          ).session(session);
          const studentMap = new Map(students.map((student) => [String(student._id), student]));
          const currentTargetClassMap = new Map(
            currentTargetClasses.map((cls) => [String(cls._id), cls])
          );

          if (studentMap.size !== new Set(allowedIds.map(String)).size) {
            const error = new Error('One or more students changed during promotion');
            error.status = 409;
            throw error;
          }
          if (currentTargetClassMap.size !== targetClassIds.length) {
            const error = new Error('One or more target classes changed during promotion');
            error.status = 409;
            throw error;
          }

          for (const promo of allowedPromotions) {
            const student = studentMap.get(String(promo.studentId));
            if (promo.graduate) {
              student.status = 'graduated';
              await student.save({ session });
              graduated += 1;
              continue;
            }

            const targetClass = currentTargetClassMap.get(String(promo.targetClassId));
            const previousAcademicYear = student.academicYear;
            student.classId = targetClass._id;
            student.academicYear = targetClass.academicYear || student.academicYear;
            student.rollNo = null;
            await student.save({ session });
            await syncPromotedStudentFees(student, previousAcademicYear, session);
            promoted += 1;
          }
        });
      } finally {
        await mongoSession.endSession();
      }

      res.json({
        success: true,
        promoted,
        graduated,
        failed: failedDetails.length,
        failedDetails,
        errors: [],
      });
    } catch (error) {
      console.error('Error in bulk promote:', error);
      res.status(error.status || 500).json({
        error: error.status ? error.message : 'Bulk promote failed',
        ...(error.studentIds ? { studentIds: error.studentIds } : {}),
      });
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
        const mongoSession = await mongoose.startSession();
        try {
          await mongoSession.withTransaction(async (session) => {
            const currentStudent = await Student.findOne(
              scopeBySchool(schoolId, {
                _id: id,
                status: 'active',
                isDeleted: { $ne: true },
              })
            ).session(session);
            if (!currentStudent) {
              const error = new Error('Student is no longer available for graduation');
              error.status = 409;
              throw error;
            }
            currentStudent.status = 'graduated';
            currentStudent.academicYear = academicYear;
            await currentStudent.save({ session });
            await ActivityLog.create(
              [
                {
                  schoolId: extractSchoolId(schoolId),
                  activityType: 'student_graduated',
                  description: `Student ${currentStudent.name} marked as graduated`,
                  performedBy: req.user?.id,
                  details: {
                    studentId: currentStudent._id,
                    fromClass: fromClass?._id,
                    academicYear,
                  },
                },
              ],
              { session }
            );
          });
        } finally {
          await mongoSession.endSession();
        }
        return res.json({
          success: true,
          message: `${student.name} marked as graduated`,
          student: { _id: student._id, name: student.name, status: 'graduated' },
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

      if (targetClass.academicYear && targetClass.academicYear !== academicYear) {
        return res.status(400).json({
          error: `Target class belongs to academic year ${targetClass.academicYear}; promotion requested ${academicYear}`,
        });
      }

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

      const oldAcademicYear =
        student.academicYear || fromClass?.academicYear || CURRENT_ACADEMIC_YEAR;

      // Prior-year financial history remains immutable after promotion.
      const oldFeeStructure = await StudentFeeStructure.findOne(
        scopeBySchool(schoolId, {
          studentId: id,
          academicYear: oldAcademicYear,
          isDeleted: { $ne: true },
        })
      );
      const unpaidBalance = oldFeeStructure?.totalBalance || 0;
      const warning =
        unpaidBalance > 0
          ? `Unpaid balance of ₹${unpaidBalance} remains recorded against ${oldAcademicYear}.`
          : undefined;

      const mongoSession = await mongoose.startSession();
      try {
        await mongoSession.withTransaction(async (session) => {
          const currentStudent = await Student.findOne(
            scopeBySchool(schoolId, {
              _id: id,
              status: 'active',
              isDeleted: { $ne: true },
            })
          ).session(session);
          const currentTargetClass = await Class.findOne(
            scopeBySchool(schoolId, {
              _id: targetClassId,
              academicYear,
              isDeleted: { $ne: true },
            })
          ).session(session);
          if (!currentStudent || !currentTargetClass) {
            const error = new Error('Student or target class changed during promotion');
            error.status = 409;
            throw error;
          }

          currentStudent.classId = currentTargetClass._id;
          currentStudent.academicYear = academicYear;
          currentStudent.rollNo = null;
          await currentStudent.save({ session });
          await syncPromotedStudentFees(currentStudent, oldAcademicYear, session);

          await ActivityLog.create(
            [
              {
                schoolId: extractSchoolId(schoolId),
                activityType: 'student_promoted',
                description: `Student ${currentStudent.name} promoted from ${fromClass?.name || '?'}-${fromClass?.section || '?'} to ${currentTargetClass.name}-${currentTargetClass.section}`,
                performedBy: req.user?.id,
                details: {
                  studentId: currentStudent._id,
                  fromClass: fromClass?._id,
                  toClass: currentTargetClass._id,
                  academicYear,
                },
              },
            ],
            { session }
          );
        });
      } finally {
        await mongoSession.endSession();
      }

      res.json({
        success: true,
        message: `${student.name} promoted to ${targetClass.name}-${targetClass.section}`,
        warning,
        student: { _id: student._id, name: student.name, classId: targetClassId, academicYear },
      });
    } catch (error) {
      console.error('Error promoting student:', error);
      res.status(error.status || 500).json({
        error:
          error.status && error.message
            ? error.message
            : req.t('common:routes.failedToPromoteStudent'),
      });
    }
  }
);

export default router;
