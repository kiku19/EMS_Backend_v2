import express from 'express';
import { Class, Student, StudentFeeStructure, Attendance, ActivityLog } from '../database.js';
import FeeTemplate from '../models/FeeTemplate.js';
import PromotionRecord from '../models/PromotionRecord.js';
import PromotionRule from '../models/PromotionRule.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import {
  validateZod,
  bulkPromotionSchema,
  rollbackPromotionSchema,
  newAcademicYearSchema,
  promotionRulesSchema,
  multiClassPromotionSchema,
} from '../validators/index.js';
import {
  CURRENT_ACADEMIC_YEAR,
  getNextAcademicYear,
  getAcademicYearDateRange,
  suggestNextClassName,
} from '../utils/constants.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import { checkClassCapacity } from '../utils/classCapacity.js';
import { initializeFeeStructure } from './students/helpers.js';

const router = express.Router();
router.use(authenticate);

function scopeBySchool(schoolId, query = {}) {
  const normalizedId = extractSchoolId(schoolId);
  if (!normalizedId) throw new Error('schoolId is required');
  return { ...query, schoolId: normalizedId };
}

// ─── GET /promotions/preview?classId=&academicYear= ─────────────────────────
// Returns students for a class with their promotion readiness indicators
router.get('/preview', checkPermission('students', 'view'), async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const { classId, academicYear } = req.query;

    if (!classId) return res.status(400).json({ error: 'classId is required' });

    const cls = await Class.findOne(
      scopeBySchool(schoolId, { _id: classId, isDeleted: { $ne: true } })
    );
    if (!cls) return res.status(404).json({ error: req.t('common:errors.classNotFound') });

    const students = await Student.find(
      scopeBySchool(schoolId, { classId, status: 'active', isDeleted: { $ne: true } })
    )
      .sort({ rollNo: 1, name: 1 })
      .lean();

    // Fetch attendance percentages in bulk, scoped to academic year
    const studentIds = students.map((s) => s._id);
    const attQuery = scopeBySchool(schoolId, { studentId: { $in: studentIds } });

    // Scope attendance to the class's academic year date range
    const classAcademicYear = academicYear || cls.academicYear || CURRENT_ACADEMIC_YEAR;
    const [yearStartStr] = classAcademicYear.split('-');
    const yearStartNum = parseInt(yearStartStr, 10);
    if (!isNaN(yearStartNum)) {
      attQuery.date = { $gte: `${yearStartNum}-04-01`, $lte: `${yearStartNum + 1}-03-31` };
    }

    const attendanceRecords = await Attendance.find(attQuery).lean();

    const attendanceMap = {};
    for (const rec of attendanceRecords) {
      const sid = rec.studentId.toString();
      if (!attendanceMap[sid]) attendanceMap[sid] = { present: 0, total: 0 };
      attendanceMap[sid].total++;
      if (rec.status === 'present' || rec.status === 'late') attendanceMap[sid].present++;
    }

    // Load school's configured promotion rules (fall back to safe defaults)
    const rules = await PromotionRule.findOne(scopeBySchool(schoolId, {})).lean();
    const minAttendancePercent = rules?.minAttendancePercent ?? 75;
    const feeRequirement = rules?.feeRequirement ?? 'none';

    const previews = students.map((s) => {
      const sid = s._id.toString();
      const att = attendanceMap[sid] || { present: 0, total: 0 };
      const attendancePercent = att.total > 0 ? Math.round((att.present / att.total) * 100) : null;

      const attBlocked = attendancePercent !== null && attendancePercent < minAttendancePercent;
      const feeBlocked =
        (feeRequirement === 'full' && s.feeStatus !== 'paid') ||
        (feeRequirement === 'partial' && s.feeStatus === 'pending');

      const blocked = attBlocked || feeBlocked;
      let blockedReason = null;
      if (attBlocked && feeBlocked) {
        blockedReason = `Low attendance (${attendancePercent}% < ${minAttendancePercent}% required) and fee status: ${s.feeStatus}`;
      } else if (attBlocked) {
        blockedReason = `Low attendance (${attendancePercent}% < ${minAttendancePercent}% required)`;
      } else if (feeBlocked) {
        blockedReason = `Fee status: ${s.feeStatus} (requirement: ${feeRequirement})`;
      }

      return {
        studentId: s._id,
        name: s.name,
        admissionId: s.admissionId,
        rollNo: s.rollNo,
        feeStatus: s.feeStatus,
        attendancePercent,
        blocked,
        blockedReason,
        suggestedDecision: blocked ? 'detained' : 'promoted',
      };
    });

    res.json({
      class: { _id: cls._id, name: cls.name, section: cls.section, academicYear: cls.academicYear },
      students: previews,
      rules: { minAttendancePercent, feeRequirement },
    });
  } catch (error) {
    console.error('Error fetching promotion preview:', error);
    res.status(500).json({ error: 'Failed to fetch promotion preview' });
  }
});

// ─── POST /promotions/execute ────────────────────────────────────────────────
// Execute bulk promotion with per-student decisions; stores snapshot for rollback
router.post(
  '/execute',
  checkPermission('students', 'edit'),
  validateZod(bulkPromotionSchema),
  async (req, res) => {
    try {
      const schoolId = req.user?.schoolId;
      const normalizedSchoolId = extractSchoolId(schoolId);
      const { fromAcademicYear, toAcademicYear, studentDecisions, generateRollNumbers } = req.body;

      const summary = {
        totalStudents: studentDecisions.length,
        promoted: 0,
        detained: 0,
        transferred: 0,
        graduated: 0,
        errors: 0,
      };
      const snapshots = [];
      const errors = [];

      // Pre-load target classes for capacity check and roll number generation
      const targetClassIds = [
        ...new Set(studentDecisions.filter((d) => d.toClassId).map((d) => d.toClassId)),
      ];

      // Check capacity for each target class before proceeding
      for (const cid of targetClassIds) {
        const cap = await checkClassCapacity(cid, schoolId);
        const studentsGoingHere = studentDecisions.filter(
          (d) => d.toClassId === cid && d.decision === 'promoted'
        ).length;
        if (cap && cap.available < studentsGoingHere) {
          return res.status(400).json({
            error: `Target class capacity exceeded: would have ${cap.currentCount + studentsGoingHere}/${cap.capacity} students`,
            classId: cid,
            className: cap.classData
              ? `${cap.classData.name}${cap.classData.section ? '-' + cap.classData.section : ''}`
              : cid,
          });
        }
      }

      const rollCounters = {}; // classId -> next roll number
      if (generateRollNumbers) {
        for (const cid of targetClassIds) {
          const maxRollStudent = await Student.findOne(
            scopeBySchool(schoolId, { classId: cid, isDeleted: { $ne: true } })
          )
            .sort({ rollNo: -1 })
            .lean();
          rollCounters[cid] = (maxRollStudent?.rollNo || 0) + 1;
        }
      }

      for (const d of studentDecisions) {
        try {
          const student = await Student.findOne(
            scopeBySchool(schoolId, { _id: d.studentId, isDeleted: { $ne: true } })
          );
          if (!student) {
            errors.push({ studentId: d.studentId, error: req.t('students:errors.notFound') });
            summary.errors++;
            continue;
          }

          // Build snapshot before any changes
          const snapshot = {
            studentId: student._id,
            studentName: student.name,
            admissionId: student.admissionId,
            rollNo: student.rollNo,
            fromClassId: student.classId,
            fromAcademicYear: student.academicYear,
            previousStatus: student.status,
            previousFeeStatus: student.feeStatus,
            decision: d.decision,
            toClassId: d.toClassId || null,
            newRollNo: null,
          };

          const oldAcademicYear = student.academicYear || fromAcademicYear;

          if (d.decision === 'promoted') {
            // TODO [AUDIT-15]: Attendance & Result records still reference the old classId after
            // promotion. Archive or migrate them. See Attendance.classId and Result.classId.

            let newRollNo = d.newRollNo || null;
            if (generateRollNumbers && d.toClassId) {
              newRollNo = rollCounters[d.toClassId]++;
            }
            snapshot.newRollNo = newRollNo;

            student.classId = d.toClassId;
            student.academicYear = toAcademicYear;
            student.feeStatus = 'pending';
            student.feeDetails = {
              totalFee: 0,
              paidAmount: 0,
              balanceAmount: 0,
              discountApplied: 0,
              lastPaymentDate: null,
            };
            if (newRollNo) student.rollNo = newRollNo;
            await student.save();
            // The prior-year fee structure is intentionally kept as
            // historical record (payment history, discount, etc.). A fresh
            // structure is minted for the new year below.
            try {
              await initializeFeeStructure(student);
            } catch (feeErr) {
              console.error(`Fee structure init failed for student ${student._id}:`, feeErr);
            }
            summary.promoted++;
          } else if (d.decision === 'detained') {
            // Keep same class, just update academic year
            student.academicYear = toAcademicYear;
            student.feeStatus = 'pending';
            student.feeDetails = {
              totalFee: 0,
              paidAmount: 0,
              balanceAmount: 0,
              discountApplied: 0,
              lastPaymentDate: null,
            };
            await student.save();
            // Prior-year fee structure kept as history (see promoted branch).
            try {
              await initializeFeeStructure(student);
            } catch (feeErr) {
              console.error(
                `Fee structure init failed for detained student ${student._id}:`,
                feeErr
              );
            }
            summary.detained++;
          } else if (d.decision === 'transferred') {
            student.status = 'transferred';
            student.academicYear = toAcademicYear;
            await student.save();
            summary.transferred++;
          } else if (d.decision === 'graduated') {
            student.status = 'graduated';
            student.academicYear = toAcademicYear;
            await student.save();
            summary.graduated++;
          }

          snapshots.push(snapshot);
        } catch (err) {
          errors.push({ studentId: d.studentId, error: err.message });
          summary.errors++;
        }
      }

      // Save promotion record for rollback capability
      const record = await PromotionRecord.create({
        schoolId: normalizedSchoolId,
        fromAcademicYear,
        toAcademicYear,
        promotedBy: req.user?.id,
        studentSnapshots: snapshots,
        summary,
      });

      await ActivityLog.create({
        schoolId: normalizedSchoolId,
        activityType: 'bulk_promotion',
        description: `Bulk promotion executed: ${summary.promoted} promoted, ${summary.detained} detained, ${summary.transferred} transferred, ${summary.graduated} graduated`,
        performedBy: req.user?.id,
        details: { fromAcademicYear, toAcademicYear, summary, promotionRecordId: record._id },
      });

      res.json({ success: true, summary, errors, promotionRecordId: record._id });
    } catch (error) {
      console.error('Error executing bulk promotion:', error);
      res.status(500).json({ error: 'Bulk promotion failed' });
    }
  }
);

// ─── GET /promotions/records ─────────────────────────────────────────────────
// List promotion history for a school
router.get('/records', checkPermission('students', 'view'), async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const records = await PromotionRecord.find(scopeBySchool(schoolId, {}))
      .sort({ createdAt: -1 })
      .limit(20)
      .select('-studentSnapshots')
      .lean();

    res.json({ records });
  } catch (error) {
    console.error('Error fetching promotion records:', error);
    res.status(500).json({ error: 'Failed to fetch promotion records' });
  }
});

// ─── GET /promotions/records/:recordId ──────────────────────────────────────
// Get a specific promotion record (full report with per-student decisions)
router.get(
  '/records/:recordId',
  checkPermission('students', 'view'),
  async (req, res) => {
    try {
      const schoolId = req.user?.schoolId;
      const record = await PromotionRecord.findOne(
        scopeBySchool(schoolId, { _id: req.params.recordId })
      )
        .populate('studentSnapshots.fromClassId', 'name section')
        .populate('studentSnapshots.toClassId', 'name section')
        .lean();

      if (!record) return res.status(404).json({ error: 'Promotion record not found' });

      // Build class-wise report
      const classReport = {};
      for (const snap of record.studentSnapshots) {
        const fromKey = snap.fromClassId?._id?.toString() || 'unknown';
        if (!classReport[fromKey]) {
          classReport[fromKey] = {
            fromClass: snap.fromClassId
              ? `${snap.fromClassId.name}-${snap.fromClassId.section}`
              : 'Unknown',
            promoted: [],
            detained: [],
            transferred: [],
            graduated: [],
          };
        }
        classReport[fromKey][snap.decision].push({
          name: snap.studentName,
          admissionId: snap.admissionId,
          rollNo: snap.rollNo,
        });
      }

      res.json({ record: { ...record, classReport: Object.values(classReport) } });
    } catch (error) {
      console.error('Error fetching promotion record:', error);
      res.status(500).json({ error: 'Failed to fetch promotion record' });
    }
  }
);

// ─── POST /promotions/rollback/:recordId ────────────────────────────────────
// Undo a bulk promotion by restoring each student's previous state
router.post(
  '/rollback/:recordId',
  checkPermission('students', 'edit'),
  validateZod(rollbackPromotionSchema),
  async (req, res) => {
    try {
      const schoolId = req.user?.schoolId;
      const normalizedSchoolId = extractSchoolId(schoolId);
      const { reason } = req.body;

      const record = await PromotionRecord.findOne(
        scopeBySchool(schoolId, { _id: req.params.recordId })
      );
      if (!record) return res.status(404).json({ error: 'Promotion record not found' });
      if (record.status === 'rolledback')
        return res.status(400).json({ error: 'This promotion has already been rolled back' });

      let restored = 0;
      let failed = 0;
      const errors = [];

      for (const snap of record.studentSnapshots) {
        try {
          const student = await Student.findOne(
            scopeBySchool(schoolId, { _id: snap.studentId, isDeleted: { $ne: true } })
          );
          if (!student) {
            failed++;
            continue;
          }

          student.classId = snap.fromClassId;
          student.academicYear = snap.fromAcademicYear;
          student.status = snap.previousStatus;
          student.feeStatus = snap.previousFeeStatus;
          if (snap.decision === 'promoted' && snap.newRollNo) {
            student.rollNo = snap.rollNo; // restore original roll number
          }
          await student.save();

          // Remove any fee structure created for the new year during promotion
          if (snap.decision === 'promoted' || snap.decision === 'detained') {
            await StudentFeeStructure.deleteOne(
              scopeBySchool(schoolId, {
                studentId: student._id,
                academicYear: record.toAcademicYear,
              })
            );
          }
          restored++;
        } catch (err) {
          errors.push({ studentId: snap.studentId, error: err.message });
          failed++;
        }
      }

      record.status = 'rolledback';
      record.rollbackAt = new Date();
      record.rollbackBy = req.user?.id;
      record.rollbackReason = reason || null;
      await record.save();

      await ActivityLog.create({
        schoolId: normalizedSchoolId,
        activityType: 'promotion_rollback',
        description: `Promotion rollback: ${restored} students restored, ${failed} failed`,
        performedBy: req.user?.id,
        details: {
          promotionRecordId: record._id,
          fromAcademicYear: record.fromAcademicYear,
          toAcademicYear: record.toAcademicYear,
          restored,
          failed,
          reason,
        },
      });

      res.json({ success: true, restored, failed, errors });
    } catch (error) {
      console.error('Error rolling back promotion:', error);
      res.status(500).json({ error: 'Rollback failed' });
    }
  }
);

// ─── POST /promotions/new-academic-year ────────────────────────────────────
// Create new academic year by copying class structure (and optionally fee templates)
router.post(
  '/new-academic-year',
  checkPermission('students', 'edit'),
  validateZod(newAcademicYearSchema),
  async (req, res) => {
    try {
      const schoolId = req.user?.schoolId;
      const normalizedSchoolId = extractSchoolId(schoolId);
      const { fromAcademicYear, toAcademicYear, copyClasses, copyFeeTemplates } = req.body;

      // Check if target year classes already exist
      const existing = await Class.findOne(
        scopeBySchool(schoolId, { academicYear: toAcademicYear, isDeleted: { $ne: true } })
      );
      if (existing) {
        return res
          .status(409)
          .json({ error: `Classes for academic year ${toAcademicYear} already exist` });
      }

      const result = { classesCreated: 0, feeTemplatesCopied: 0, errors: [] };

      if (copyClasses) {
        const sourceClasses = await Class.find(
          scopeBySchool(schoolId, { academicYear: fromAcademicYear, isDeleted: { $ne: true } })
        ).lean();

        for (const cls of sourceClasses) {
          try {
            await Class.create({
              schoolId: normalizedSchoolId,
              name: cls.name,
              section: cls.section,
              academicYear: toAcademicYear,
              subjects: cls.subjects || [],
              assignedSubjects: cls.assignedSubjects || [],
              strengthLimit: {
                current: cls.strengthLimit?.current || 40,
                default: cls.strengthLimit?.default || 40,
              },
              room: cls.room,
              block: cls.block,
              classTag: cls.classTag,
            });
            result.classesCreated++;
          } catch (err) {
            result.errors.push({ className: `${cls.name}-${cls.section}`, error: err.message });
          }
        }
      }

      if (copyFeeTemplates) {
        const sourceTemplates = await FeeTemplate.find(scopeBySchool(schoolId, {})).lean();

        for (const tpl of sourceTemplates) {
          try {
            const newName = tpl.name.includes(fromAcademicYear)
              ? tpl.name.replace(fromAcademicYear, toAcademicYear)
              : `${tpl.name} (${toAcademicYear})`;
            // Check if already exists
            const exists = await FeeTemplate.findOne(scopeBySchool(schoolId, { name: newName }));
            if (!exists) {
              await FeeTemplate.create({
                schoolId: normalizedSchoolId,
                name: newName,
                description: tpl.description,
                section: tpl.section,
                applicableFor: tpl.applicableFor,
                feeHeads: tpl.feeHeads,
                totalAnnualFee: tpl.totalAnnualFee,
                discounts: tpl.discounts,
              });
              result.feeTemplatesCopied++;
            }
          } catch (err) {
            result.errors.push({ templateName: tpl.name, error: err.message });
          }
        }
      }

      await ActivityLog.create({
        schoolId: normalizedSchoolId,
        activityType: 'new_academic_year',
        description: `New academic year ${toAcademicYear} created: ${result.classesCreated} classes, ${result.feeTemplatesCopied} fee templates`,
        performedBy: req.user?.id,
        details: { fromAcademicYear, toAcademicYear, result },
      });

      res.json({ success: true, ...result });
    } catch (error) {
      console.error('Error creating new academic year:', error);
      res.status(500).json({ error: 'Failed to create new academic year' });
    }
  }
);

// ─── GET /promotions/rules ───────────────────────────────────────────────────
// Returns the school's configured promotion rules (or defaults if none saved yet)
router.get('/rules', checkPermission('students', 'view'), async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const rules = await PromotionRule.findOne(scopeBySchool(schoolId, {})).lean();
    res.json({
      minAttendancePercent: rules?.minAttendancePercent ?? 75,
      feeRequirement: rules?.feeRequirement ?? 'none',
    });
  } catch (error) {
    console.error('Error fetching promotion rules:', error);
    res.status(500).json({ error: 'Failed to fetch promotion rules' });
  }
});

// ─── PUT /promotions/rules ───────────────────────────────────────────────────
// Save (upsert) the school's promotion rules
router.put(
  '/rules',
  checkPermission('students', 'edit'),
  validateZod(promotionRulesSchema),
  async (req, res) => {
    try {
      const schoolId = req.user?.schoolId;
      const normalizedSchoolId = extractSchoolId(schoolId);
      const { minAttendancePercent, feeRequirement } = req.body;

      const rules = await PromotionRule.findOneAndUpdate(
        { schoolId: normalizedSchoolId },
        { $set: { minAttendancePercent, feeRequirement } },
        { upsert: true, new: true }
      ).lean();

      res.json({
        minAttendancePercent: rules.minAttendancePercent,
        feeRequirement: rules.feeRequirement,
      });
    } catch (error) {
      console.error('Error saving promotion rules:', error);
      res.status(500).json({ error: 'Failed to save promotion rules' });
    }
  }
);

// ─── GET /promotions/check-year?academicYear= ─────────────────────────────
// Quick check whether classes exist for a given academic year
router.get('/check-year', checkPermission('students', 'view'), async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const { academicYear } = req.query;

    if (!academicYear)
      return res.status(400).json({ error: 'academicYear query param is required' });

    const classCount = await Class.countDocuments(
      scopeBySchool(schoolId, { academicYear, isDeleted: { $ne: true } })
    );

    res.json({ exists: classCount > 0, classCount, academicYear });
  } catch (error) {
    console.error('Error checking academic year:', error);
    res.status(500).json({ error: 'Failed to check academic year' });
  }
});

// ─── GET /promotions/preview-all?academicYear= ────────────────────────────
// Returns ALL classes in the given academic year with auto-suggested target class,
// student counts, and per-class eligibility summary for the year-end wizard
router.get('/preview-all', checkPermission('students', 'view'), async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const academicYear = req.query.academicYear || CURRENT_ACADEMIC_YEAR;
    const toAcademicYear = req.query.toAcademicYear || getNextAcademicYear(academicYear);

    // Load all classes for the academic year
    const classes = await Class.find(
      scopeBySchool(schoolId, { academicYear, isDeleted: { $ne: true } })
    )
      .sort({ name: 1, section: 1 })
      .lean();

    if (classes.length === 0) {
      return res.json({ classMappings: [], academicYear, toAcademicYear });
    }

    // Load target year classes for matching
    const targetClasses = await Class.find(
      scopeBySchool(schoolId, { academicYear: toAcademicYear, isDeleted: { $ne: true } })
    ).lean();

    // Load promotion rules
    const rules = await PromotionRule.findOne(scopeBySchool(schoolId, {})).lean();
    const minAttendancePercent = rules?.minAttendancePercent ?? 75;
    const feeRequirement = rules?.feeRequirement ?? 'none';

    // Get attendance date range for current academic year
    const dateRange = getAcademicYearDateRange(academicYear);

    // Build class mappings
    const classMappings = [];

    for (const cls of classes) {
      // Count active students
      const studentCount = await Student.countDocuments(
        scopeBySchool(schoolId, {
          classId: cls._id,
          status: 'active',
          isDeleted: { $ne: true },
        })
      );

      // Auto-suggest target class
      const { nextName, isGraduating } = suggestNextClassName(cls.name);

      let suggestedTargetClass = null;
      if (!isGraduating && nextName) {
        // Find matching target class in the target year (same section preferred)
        suggestedTargetClass =
          targetClasses.find((tc) => tc.name === nextName && tc.section === cls.section) ||
          targetClasses.find((tc) => tc.name === nextName) ||
          null;
      }

      // Get per-class eligibility summary (lightweight — count blocked vs eligible)
      let eligibleCount = studentCount;
      let blockedCount = 0;

      if (studentCount > 0 && (feeRequirement !== 'none' || minAttendancePercent > 0)) {
        const students = await Student.find(
          scopeBySchool(schoolId, {
            classId: cls._id,
            status: 'active',
            isDeleted: { $ne: true },
          })
        )
          .select('_id feeStatus')
          .lean();

        // Fee-blocked count
        if (feeRequirement !== 'none') {
          const feeBlockedStudents = students.filter((s) =>
            feeRequirement === 'full' ? s.feeStatus !== 'paid' : s.feeStatus === 'pending'
          );
          blockedCount = feeBlockedStudents.length;
        }

        // Attendance-blocked count (bulk query)
        if (minAttendancePercent > 0 && dateRange) {
          const studentIds = students.map((s) => s._id);
          const attRecords = await Attendance.find(
            scopeBySchool(schoolId, {
              studentId: { $in: studentIds },
              date: { $gte: dateRange.startDate, $lte: dateRange.endDate },
            })
          ).lean();

          const attMap = {};
          for (const rec of attRecords) {
            const sid = rec.studentId.toString();
            if (!attMap[sid]) attMap[sid] = { present: 0, total: 0 };
            attMap[sid].total++;
            if (rec.status === 'present' || rec.status === 'late') attMap[sid].present++;
          }

          let attBlocked = 0;
          for (const s of students) {
            const att = attMap[s._id.toString()];
            if (att && att.total > 0) {
              const pct = Math.round((att.present / att.total) * 100);
              if (pct < minAttendancePercent) attBlocked++;
            }
          }
          // Use max of fee-blocked and att-blocked (some students may be blocked by both)
          blockedCount = Math.max(blockedCount, attBlocked);
        }

        eligibleCount = studentCount - blockedCount;
      }

      // Check target class capacity
      let targetCapacity = null;
      if (suggestedTargetClass) {
        const cap = await checkClassCapacity(suggestedTargetClass._id, schoolId);
        targetCapacity = cap
          ? { current: cap.currentCount, max: cap.capacity, available: cap.available }
          : null;
      }

      classMappings.push({
        fromClassId: cls._id,
        fromClassName: cls.name,
        fromSection: cls.section,
        studentCount,
        eligibleCount,
        blockedCount,
        isGraduating,
        suggestedTargetClassId: suggestedTargetClass?._id || null,
        suggestedTargetClassName: suggestedTargetClass
          ? `${suggestedTargetClass.name}${suggestedTargetClass.section ? ' (' + suggestedTargetClass.section + ')' : ''}`
          : null,
        targetClassExists: !!suggestedTargetClass,
        targetCapacity,
      });
    }

    // Also return all target year classes for manual override dropdown
    const targetClassOptions = targetClasses.map((tc) => ({
      _id: tc._id,
      name: tc.name,
      section: tc.section,
      label: `${tc.name}${tc.section ? ' (' + tc.section + ')' : ''}`,
    }));

    res.json({
      classMappings,
      academicYear,
      toAcademicYear,
      targetYearExists: targetClasses.length > 0,
      targetClassOptions,
      rules: { minAttendancePercent, feeRequirement },
    });
  } catch (error) {
    console.error('Error fetching preview-all:', error);
    res.status(500).json({ error: 'Failed to fetch promotion preview for all classes' });
  }
});

// ─── POST /promotions/execute-all ──────────────────────────────────────────
// Multi-class year-end promotion — promotes students across all mapped classes
// in a single operation with one PromotionRecord for rollback
router.post(
  '/execute-all',
  checkPermission('students', 'edit'),
  validateZod(multiClassPromotionSchema),
  async (req, res) => {
    try {
      const schoolId = req.user?.schoolId;
      const normalizedSchoolId = extractSchoolId(schoolId);
      const {
        fromAcademicYear,
        toAcademicYear,
        classMappings: mappings,
        generateRollNumbers,
      } = req.body;

      const summary = {
        totalStudents: 0,
        promoted: 0,
        detained: 0,
        transferred: 0,
        graduated: 0,
        errors: 0,
      };
      const allSnapshots = [];
      const allErrors = [];
      const recordClassMappings = [];

      // Pre-validate: check capacity for all target classes
      for (const mapping of mappings) {
        if (mapping.graduate || !mapping.toClassId) continue;
        const promotedCount = mapping.studentDecisions.filter(
          (d) => d.decision === 'promoted'
        ).length;
        if (promotedCount > 0) {
          const cap = await checkClassCapacity(mapping.toClassId, schoolId);
          if (cap && cap.available < promotedCount) {
            const cls = await Class.findById(mapping.toClassId).select('name section').lean();
            return res.status(400).json({
              error: `Target class ${cls ? cls.name + (cls.section ? '-' + cls.section : '') : mapping.toClassId} capacity exceeded: would have ${cap.currentCount + promotedCount}/${cap.capacity}`,
              classId: mapping.toClassId,
            });
          }
        }
      }

      // Process each class mapping
      for (const mapping of mappings) {
        const { fromClassId, toClassId, graduate = false, studentDecisions } = mapping;

        const fromClass = await Class.findOne(
          scopeBySchool(schoolId, { _id: fromClassId, isDeleted: { $ne: true } })
        ).lean();
        const toClass = toClassId
          ? await Class.findOne(
              scopeBySchool(schoolId, { _id: toClassId, isDeleted: { $ne: true } })
            ).lean()
          : null;

        const classMappingRecord = {
          fromClassId,
          fromClassName: fromClass
            ? `${fromClass.name}${fromClass.section ? '-' + fromClass.section : ''}`
            : 'Unknown',
          toClassId: toClassId || null,
          toClassName: graduate
            ? 'Graduated'
            : toClass
              ? `${toClass.name}${toClass.section ? '-' + toClass.section : ''}`
              : 'Unknown',
          graduate,
          studentCount: studentDecisions.length,
          promotedCount: 0,
          detainedCount: 0,
          graduatedCount: 0,
        };

        // Roll number counter for this target class
        let rollCounter = null;
        if (generateRollNumbers && toClassId) {
          const maxRollStudent = await Student.findOne(
            scopeBySchool(schoolId, { classId: toClassId, isDeleted: { $ne: true } })
          )
            .sort({ rollNo: -1 })
            .lean();
          rollCounter = (maxRollStudent?.rollNo || 0) + 1;
        }

        for (const d of studentDecisions) {
          summary.totalStudents++;

          try {
            const student = await Student.findOne(
              scopeBySchool(schoolId, { _id: d.studentId, isDeleted: { $ne: true } })
            );
            if (!student) {
              allErrors.push({
                studentId: d.studentId,
                classId: fromClassId,
                error: 'Student not found',
              });
              summary.errors++;
              continue;
            }

            // Snapshot before changes
            const snapshot = {
              studentId: student._id,
              studentName: student.name,
              admissionId: student.admissionId,
              rollNo: student.rollNo,
              fromClassId: student.classId,
              fromAcademicYear: student.academicYear,
              previousStatus: student.status,
              previousFeeStatus: student.feeStatus,
              decision: d.decision,
              // Don't set toClassId/newRollNo to null — Mongoose subdoc can't cast null to ObjectId
            };

            const oldAcademicYear = student.academicYear || fromAcademicYear;
            const decision = graduate ? 'graduated' : d.decision;

            if (decision === 'promoted' && toClassId) {
              let newRollNo = null;
              if (generateRollNumbers && rollCounter !== null) {
                newRollNo = rollCounter++;
              }
              snapshot.toClassId = toClassId;
              snapshot.newRollNo = newRollNo;

              student.classId = toClassId;
              student.academicYear = toAcademicYear;
              student.feeStatus = 'pending';
              student.feeDetails = {
                totalFee: 0,
                paidAmount: 0,
                balanceAmount: 0,
                discountApplied: 0,
                lastPaymentDate: null,
              };
              if (newRollNo) student.rollNo = newRollNo;
              await student.save();
              // Prior-year fee structure kept as history (rollback path
              // /promote/:id/rollback only wipes the NEW year's row).
              try {
                await initializeFeeStructure(student);
              } catch (e) {
                console.error(`Fee init failed for ${student._id}:`, e);
              }
              summary.promoted++;
              classMappingRecord.promotedCount++;
            } else if (decision === 'detained') {
              student.academicYear = toAcademicYear;
              student.feeStatus = 'pending';
              student.feeDetails = {
                totalFee: 0,
                paidAmount: 0,
                balanceAmount: 0,
                discountApplied: 0,
                lastPaymentDate: null,
              };
              await student.save();
              try {
                await initializeFeeStructure(student);
              } catch (e) {
                console.error(`Fee init failed for detained ${student._id}:`, e);
              }
              summary.detained++;
              classMappingRecord.detainedCount++;
            } else if (decision === 'transferred') {
              student.status = 'transferred';
              student.academicYear = toAcademicYear;
              await student.save();
              summary.transferred++;
            } else if (decision === 'graduated') {
              student.status = 'graduated';
              student.academicYear = toAcademicYear;
              await student.save();
              summary.graduated++;
              classMappingRecord.graduatedCount++;
            }

            allSnapshots.push(snapshot);
          } catch (err) {
            allErrors.push({ studentId: d.studentId, classId: fromClassId, error: err.message });
            summary.errors++;
          }
        }

        recordClassMappings.push(classMappingRecord);
      }

      // Create single PromotionRecord for the entire year-end operation
      // Clean classMappings to avoid Mongoose cast errors on null ObjectIds
      const cleanedClassMappings = recordClassMappings.map((cm) => ({
        ...cm,
        fromClassId: cm.fromClassId || undefined,
        toClassId: cm.toClassId || undefined, // remove null — Mongoose can't cast null to ObjectId in subdocs
      }));

      const record = await PromotionRecord.create({
        schoolId: normalizedSchoolId,
        fromAcademicYear,
        toAcademicYear,
        promotedBy: req.user?.id,
        studentSnapshots: allSnapshots,
        classMappings: cleanedClassMappings,
        summary,
      });

      await ActivityLog.create({
        schoolId: normalizedSchoolId,
        activityType: 'bulk_promotion',
        description: `Year-end promotion: ${summary.promoted} promoted, ${summary.detained} detained, ${summary.graduated} graduated across ${mappings.length} classes`,
        performedBy: req.user?.id,
        details: { fromAcademicYear, toAcademicYear, summary, promotionRecordId: record._id },
      });

      res.json({
        success: true,
        summary,
        classMappings: recordClassMappings,
        errors: allErrors,
        promotionRecordId: record._id,
      });
    } catch (error) {
      console.error('Error executing multi-class promotion:', error?.message, error?.stack);
      res.status(500).json({ error: error?.message || 'Multi-class promotion failed' });
    }
  }
);

export default router;
