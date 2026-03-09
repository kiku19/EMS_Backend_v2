import { resolveAcademicYear } from '../utils/academicYear.js';
import express from 'express';
import { Student, StudentFeeStructure } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';

const router = express.Router();

router.get('/class/:classId', authenticate, checkPermission('fees', 'view'), async (req, res) => {
  try {
    const { classId } = req.params;
    const resolvedAcademicYear = await resolveAcademicYear(req.query.academicYear);

    const feeStructures = await StudentFeeStructure.find({
      classId,
      academicYear: resolvedAcademicYear
    }).populate('studentId', 'name admissionId rollNo');

    res.json(feeStructures);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', authenticate, checkPermission('fees', 'create'), async (req, res) => {
  try {
    const { classId, academicYear, name, description } = req.body;
    const resolvedAcademicYear = await resolveAcademicYear(academicYear);

    const existing = await StudentFeeStructure.findOne({
      classId,
      academicYear: resolvedAcademicYear
    });

    if (existing) {
      return res.status(400).json({ error: 'Fee structure already exists for this class and year' });
    }

    const structure = new StudentFeeStructure({
      classId,
      academicYear: resolvedAcademicYear,
      name,
      description,
      feeHeads: []
    });

    await structure.save();
    res.status(201).json(structure);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/apply-to-students', authenticate, checkPermission('fees', 'edit'), async (req, res) => {
  try {
    const { classId, academicYear, feeStructureId } = req.body;
    const resolvedAcademicYear = await resolveAcademicYear(academicYear);

    const templateStructure = await StudentFeeStructure.findById(feeStructureId);
    if (!templateStructure) {
      return res.status(404).json({ error: 'Fee structure template not found' });
    }

    const students = await Student.find({
      classId,
      academicYear: resolvedAcademicYear
    });

    let appliedCount = 0;

    for (const student of students) {
      const existing = await StudentFeeStructure.findOne({
        studentId: student._id,
        academicYear: resolvedAcademicYear
      });

      if (!existing) {
        const newStructure = new StudentFeeStructure({
          studentId: student._id,
          classId,
          academicYear: resolvedAcademicYear,
          feeHeads: templateStructure.feeHeads.map((feeHead) => ({
            ...feeHead.toObject(),
            paidAmount: 0,
            balanceAmount: feeHead.amount,
            status: 'pending'
          }))
        });

        newStructure.totalFee = newStructure.feeHeads.reduce((sum, feeHead) => sum + feeHead.amount, 0);
        newStructure.totalPaid = 0;
        newStructure.totalBalance = newStructure.totalFee;
        newStructure.overallStatus = 'pending';

        await newStructure.save();
        appliedCount += 1;
      }
    }

    res.json({
      success: true,
      message: `Fee structure applied to ${appliedCount} students`,
      appliedCount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
