import { resolveAcademicYear } from '../utils/academicYear.js';
import express from 'express';
import { FeeStructure, Student, StudentFeeStructure } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';

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

// Get fee structure for a class (single object)
router.get('/class/:classId', checkPermission('fees', 'view'), async (req, res) => {
  try {
    const { classId } = req.params;
    const resolvedAcademicYear = await resolveAcademicYear(
      req.query.academicYear,
      req.user?.schoolId
    );

    const feeStructure = await FeeStructure.findOne(
      scopeBySchool(req.user?.schoolId, {
        classId,
        academicYear: resolvedAcademicYear,
      })
    ).populate('templateId', 'name section totalAnnualFee');

    if (!feeStructure) {
      return res
        .status(404)
        .json({ error: req.t('common:routes.noFeeStructureFoundForThisClass') });
    }

    res.json(feeStructure);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create or update fee structure for a class (upsert)
router.post('/', checkPermission('fees', 'create'), async (req, res) => {
  try {
    const { classId, academicYear, templateId, feeHeads, collectionSchedule, totalAnnualFee } =
      req.body;
    const resolvedAcademicYear = await resolveAcademicYear(academicYear, req.user?.schoolId);
    const schoolId = await resolveRequestSchoolId(req);

    if (!classId) {
      return res.status(400).json({ error: req.t('common:routes.classIdIsRequired') });
    }

    const updateData = {
      schoolId,
      classId,
      academicYear: resolvedAcademicYear,
      ...(templateId && { templateId }),
      ...(feeHeads && { feeHeads }),
      ...(collectionSchedule && { collectionSchedule }),
      ...(totalAnnualFee !== undefined && { totalAnnualFee }),
      appliedDate: new Date(),
    };

    const structure = await FeeStructure.findOneAndUpdate(
      scopeBySchool(req.user?.schoolId, { classId, academicYear: resolvedAcademicYear }),
      updateData,
      { new: true, upsert: true, runValidators: true }
    );

    res.status(201).json(structure);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Apply class fee structure to all students in the class
router.post(
  '/apply-to-students',
  checkPermission('fees', 'edit'),
  async (req, res) => {
    try {
      const { classId, academicYear } = req.body;
      const resolvedAcademicYear = await resolveAcademicYear(academicYear, req.user?.schoolId);
      const schoolId = await resolveRequestSchoolId(req);

      const classStructure = await FeeStructure.findOne(
        scopeBySchool(req.user?.schoolId, { classId, academicYear: resolvedAcademicYear })
      );
      if (!classStructure) {
        return res.status(404).json({
          error: req.t(
            'common:routes.feeStructureNotFoundForThisClassPleaseSaveAFeeStructureFirst'
          ),
        });
      }

      const students = await Student.find(
        scopeBySchool(req.user?.schoolId, { classId, status: 'active' })
      );

      let appliedCount = 0;

      for (const student of students) {
        const existing = await StudentFeeStructure.findOne(
          scopeBySchool(req.user?.schoolId, {
            studentId: student._id,
            academicYear: resolvedAcademicYear,
          })
        );

        if (!existing) {
          const newStructure = new StudentFeeStructure({
            schoolId,
            studentId: student._id,
            classId,
            academicYear: resolvedAcademicYear,
            feeHeads: classStructure.feeHeads.map((feeHead) => ({
              feeHeadId: feeHead._id || feeHead.feeHeadId,
              name: feeHead.name,
              category: feeHead.category,
              amount: feeHead.amount,
              mandatory: feeHead.mandatory,
              frequency: feeHead.frequency,
              paidAmount: 0,
              balanceAmount: feeHead.amount,
              status: 'pending',
            })),
          });

          newStructure.totalFee = newStructure.feeHeads.reduce((sum, fh) => sum + fh.amount, 0);
          newStructure.totalPaid = 0;
          newStructure.totalBalance = newStructure.totalFee;
          newStructure.overallStatus = 'pending';

          await newStructure.save();

          // Sync Student.feeDetails with the newly created fee structure
          await Student.findByIdAndUpdate(student._id, {
            $set: {
              'feeDetails.totalFee': newStructure.totalFee,
              'feeDetails.paidAmount': newStructure.totalPaid,
              'feeDetails.balanceAmount': newStructure.totalBalance,
              feeStatus: newStructure.overallStatus || 'pending',
            },
          });

          appliedCount += 1;
        }
      }

      res.json({
        success: true,
        message: `Fee structure applied to ${appliedCount} students (${students.length - appliedCount} already had a structure)`,
        appliedCount,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

export default router;
