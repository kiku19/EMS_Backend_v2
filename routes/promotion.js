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
} from '../validators/index.js';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import { extractSchoolId } from '../utils/schoolContext.js';

const router = express.Router();

function scopeBySchool(schoolId, query = {}) {
  const normalizedId = extractSchoolId(schoolId);
  if (!normalizedId) throw new Error('schoolId is required');
  return { ...query, schoolId: normalizedId };
}

// ─── GET /promotions/preview?classId=&academicYear= ─────────────────────────
// Returns students for a class with their promotion readiness indicators
router.get('/preview', authenticate, checkPermission('students', 'view'), async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const { classId, academicYear } = req.query;

    if (!classId) return res.status(400).json({ error: 'classId is required' });

    const cls = await Class.findOne(
      scopeBySchool(schoolId, { _id: classId, isDeleted: { $ne: true } })
    );
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    const students = await Student.find(
      scopeBySchool(schoolId, { classId, status: 'active', isDeleted: { $ne: true } })
    )
      .sort({ rollNo: 1, name: 1 })
      .lean();

    // Fetch attendance percentages in bulk
    const studentIds = students.map((s) => s._id);
    const attendanceRecords = await Attendance.find(
      scopeBySchool(schoolId, { studentId: { $in: studentIds } })
    ).lean();

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

      return {
        studentId: s._id,
        name: s.name,
        admissionId: s.admissionId,
        rollNo: s.rollNo,
        feeStatus: s.feeStatus,
        attendancePercent,
        suggestedDecision: attBlocked || feeBlocked ? 'detained' : 'promoted',
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
  authenticate,
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

      // Pre-load target classes for roll number generation
      const targetClassIds = [
        ...new Set(studentDecisions.filter((d) => d.toClassId).map((d) => d.toClassId)),
      ];
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
            errors.push({ studentId: d.studentId, error: 'Student not found' });
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
            await StudentFeeStructure.deleteOne(
              scopeBySchool(schoolId, { studentId: student._id, academicYear: oldAcademicYear })
            );
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
            await StudentFeeStructure.deleteOne(
              scopeBySchool(schoolId, { studentId: student._id, academicYear: oldAcademicYear })
            );
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
router.get('/records', authenticate, checkPermission('students', 'view'), async (req, res) => {
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
  authenticate,
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
  authenticate,
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
  authenticate,
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
router.get('/rules', authenticate, checkPermission('students', 'view'), async (req, res) => {
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
  authenticate,
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

export default router;
