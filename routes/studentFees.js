import { resolveAcademicYear } from '../utils/academicYear.js';
import express from 'express';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import FeeHead from '../models/FeeHead.js';
import { Student, Class } from '../database.js';
import { emitFeeUpdate } from '../utils/socketEmitter.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';

const router = express.Router();

function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) return { ...query };
  return { ...query, schoolId: normalizedSchoolId };
}

async function resolveRequestSchoolId(req) {
  if (req.user?.schoolId) return extractSchoolId(req.user.schoolId);
  const school = await ensureDefaultSchool();
  return extractSchoolId(school._id);
}

// Helper function to calculate fee status consistently
function calculateFeeStatus(totalBalance, totalPaid) {
  if (totalBalance <= 0) return 'paid';
  if (totalPaid > 0) return 'partial';
  return 'pending';
}

// Get fee structure for a student
router.get('/student/:studentId', authenticate, checkPermission('fees', 'view'), async (req, res) => {
  try {
    const academicYear = await resolveAcademicYear(req.query.academicYear);

    // Validate student belongs to the school
    const student = await Student.findOne(scopeBySchool(req.user?.schoolId, { _id: req.params.studentId }));
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const feeStructure = await StudentFeeStructure.findOne(
      scopeBySchool(req.user?.schoolId, { studentId: req.params.studentId, academicYear })
    )
      .populate('studentId', 'name admissionId rollNo')
      .populate('classId', 'name section')
      .populate('feeHeads.feeHeadId');

    if (!feeStructure) {
      return res.status(404).json({ error: 'Fee structure not found for this student' });
    }

    // Log for debugging
    console.log(`✅ Fee structure fetched for student ${req.params.studentId}, year ${feeStructure.academicYear}, totalFee: ${feeStructure.totalFee}`);

    res.json(feeStructure);
  } catch (error) {
    console.error('Error fetching student fee structure:', error);
    res.status(500).json({ error: error.message });
  }
});

// Batch get fee structures for multiple students
router.post('/batch', authenticate, checkPermission('fees', 'view'), async (req, res) => {
  try {
    const { studentIds, academicYear } = req.body;

    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ error: 'studentIds array is required' });
    }

    // Cap at 100 to prevent abuse
    const ids = studentIds.slice(0, 100);
    const year = await resolveAcademicYear(academicYear);

    const feeStructures = await StudentFeeStructure.find(
      scopeBySchool(req.user?.schoolId, {
        studentId: { $in: ids },
        academicYear: year
      })
    )
      .populate('studentId', 'name admissionId rollNo')
      .populate('classId', 'name section')
      .populate('feeHeads.feeHeadId');

    // Index by studentId for easy lookup
    const result = {};
    feeStructures.forEach(fs => {
      const sid = fs.studentId?._id?.toString() || fs.studentId?.toString();
      if (sid) result[sid] = fs;
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching batch fee structures:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all students with their fee structures
router.get('/all', authenticate, checkPermission('fees', 'view'), async (req, res) => {
  try {
    const { academicYear, classId, status } = req.query;
    const query = scopeBySchool(req.user?.schoolId, {});

    if (academicYear) query.academicYear = academicYear;
    if (classId) query.classId = classId;
    if (status) query.overallStatus = status;

    const feeStructures = await StudentFeeStructure.find(query)
      .populate('studentId', 'name admissionId rollNo photo')
      .populate('classId', 'name section')
      .sort({ 'studentId.name': 1 });

    res.json(feeStructures);
  } catch (error) {
    console.error('Error fetching all fee structures:', error);
    res.status(500).json({ error: error.message });
  }
});

// Initialize fee structure for a new student
router.post('/initialize/:studentId', authenticate, checkPermission('fees', 'create'), async (req, res) => {
  try {
    // Validate student belongs to the school
    const student = await Student.findOne(scopeBySchool(req.user?.schoolId, { _id: req.params.studentId })).populate('classId');

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const year = await resolveAcademicYear(req.body.academicYear);
    const schoolId = await resolveRequestSchoolId(req);

    // Check if fee structure already exists
    let feeStructure = await StudentFeeStructure.findOne(
      scopeBySchool(schoolId, { studentId: student._id, academicYear: year })
    );

    if (feeStructure) {
      return res.json({
        message: 'Fee structure already exists',
        feeStructure
      });
    }

    // Extract class number from class name (e.g., "Class 10" -> "10")
    const classNumber = student.classId.name.replace('Class ', '');

    // Find applicable fee heads for this class
    const applicableFeeHeads = await FeeHead.find(
      scopeBySchool(schoolId, {
        applicableClasses: classNumber,
        academicYear: year,
        isActive: true
      })
    );

    console.log(`Found ${applicableFeeHeads.length} applicable fee heads for class ${classNumber}`);

    // Create fee structure
    feeStructure = new StudentFeeStructure({
      studentId: student._id,
      classId: student.classId._id,
      academicYear: year,
      schoolId,
      feeHeads: applicableFeeHeads.map(fh => ({
        feeHeadId: fh._id,
        name: fh.name,
        category: fh.category,
        amount: fh.amount,
        mandatory: fh.mandatory,
        frequency: fh.frequency,
        paidAmount: 0,
        balanceAmount: fh.amount,
        status: 'pending'
      }))
    });

    // Calculate totals
    feeStructure.totalFee = feeStructure.feeHeads.reduce((sum, fh) => sum + fh.amount, 0);
    feeStructure.totalPaid = 0;
    feeStructure.totalBalance = feeStructure.totalFee;
    feeStructure.overallStatus = 'pending';

    await feeStructure.save();

    // Sync fee data to Student model for consistent reads
    await Student.findByIdAndUpdate(student._id, {
      feeStatus: 'pending',
      feeDetails: {
        totalFee: feeStructure.totalFee,
        paidAmount: 0,
        balanceAmount: feeStructure.totalBalance,
        discountApplied: 0,
        lastPaymentDate: null,
      }
    });

    console.log(`✅ Fee structure initialized for student ${student.name}`);

    // Emit socket event for real-time updates
    emitFeeUpdate(student._id, student.name, feeStructure);

    res.status(201).json(feeStructure);
  } catch (error) {
    // Handle race condition: duplicate key means another request already initialized it
    if (error.code === 11000) {
      const existing = await StudentFeeStructure.findOne({ studentId: req.params.studentId });
      if (existing) {
        return res.json({ message: 'Fee structure already exists', feeStructure: existing });
      }
    }
    console.error('Error initializing fee structure:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update discount for a student
router.put('/student/:studentId/discount', authenticate, checkPermission('fees', 'edit'), async (req, res) => {
  try {
    const { discountAmount, discountReason, academicYear } = req.body;

    const feeStructure = await StudentFeeStructure.findOne(
      scopeBySchool(req.user?.schoolId, {
        studentId: req.params.studentId,
        academicYear: await resolveAcademicYear(academicYear)
      })
    );

    if (!feeStructure) {
      return res.status(404).json({ error: 'Fee structure not found' });
    }

    const maxDiscount = feeStructure.totalFee - feeStructure.totalPaid;
    if ((discountAmount || 0) > maxDiscount) {
      return res.status(400).json({
        error: `Discount cannot exceed outstanding balance of ₹${maxDiscount}`,
        field: 'discountAmount',
        maxAllowed: maxDiscount
      });
    }

    feeStructure.discountApplied = discountAmount || 0;
    feeStructure.discountReason = discountReason || '';
    feeStructure.totalBalance = feeStructure.totalFee - feeStructure.totalPaid - feeStructure.discountApplied;

    // Update overall status using helper
    feeStructure.overallStatus = calculateFeeStatus(feeStructure.totalBalance, feeStructure.totalPaid);

    await feeStructure.save();

    // Sync fee data to Student model for consistent reads
    await Student.findByIdAndUpdate(req.params.studentId, {
      feeStatus: feeStructure.overallStatus,
      feeDetails: {
        totalFee: feeStructure.totalFee,
        paidAmount: feeStructure.totalPaid,
        balanceAmount: feeStructure.totalBalance,
        discountApplied: feeStructure.discountApplied || 0,
        lastPaymentDate: feeStructure.lastPaymentDate,
      }
    });

    // Get student details for socket event
    const student = await Student.findById(req.params.studentId).select('name');

    // Emit socket event for real-time updates
    if (student) {
      emitFeeUpdate(student._id, student.name, feeStructure);
    }

    res.json(feeStructure);
  } catch (error) {
    console.error('Error updating discount:', error);
    res.status(500).json({ error: error.message });
  }
});

// Record payment for a student
router.post('/student/:studentId/payment', authenticate, checkPermission('fees', 'edit'), async (req, res) => {
  try {
    const { amount, feeHeadPayments, academicYear } = req.body;

    const feeStructure = await StudentFeeStructure.findOne(
      scopeBySchool(req.user?.schoolId, {
        studentId: req.params.studentId,
        academicYear: await resolveAcademicYear(academicYear)
      })
    );

    if (!feeStructure) {
      return res.status(404).json({ error: 'Fee structure not found' });
    }

    // Update individual fee heads
    if (feeHeadPayments && Array.isArray(feeHeadPayments)) {
      for (const payment of feeHeadPayments) {
        const feeHeadIndex = feeStructure.feeHeads.findIndex(
          fh => fh.feeHeadId.toString() === payment.feeHeadId
        );

        if (feeHeadIndex >= 0) {
          feeStructure.feeHeads[feeHeadIndex].paidAmount += payment.amount;
          feeStructure.feeHeads[feeHeadIndex].balanceAmount = 
            feeStructure.feeHeads[feeHeadIndex].amount - 
            feeStructure.feeHeads[feeHeadIndex].paidAmount;

          // Update status
          if (feeStructure.feeHeads[feeHeadIndex].balanceAmount <= 0) {
            feeStructure.feeHeads[feeHeadIndex].status = 'paid';
          } else if (feeStructure.feeHeads[feeHeadIndex].paidAmount > 0) {
            feeStructure.feeHeads[feeHeadIndex].status = 'partial';
          }
        }
      }
    }

    // Recalculate totals
    feeStructure.totalPaid = feeStructure.feeHeads.reduce((sum, fh) => sum + fh.paidAmount, 0);
    feeStructure.totalBalance = feeStructure.totalFee - feeStructure.totalPaid - feeStructure.discountApplied;
    feeStructure.lastPaymentDate = new Date();

    // Update overall status using helper
    feeStructure.overallStatus = calculateFeeStatus(feeStructure.totalBalance, feeStructure.totalPaid);

    await feeStructure.save();

    // Sync fee data to Student model for consistent reads
    await Student.findByIdAndUpdate(req.params.studentId, {
      feeStatus: feeStructure.overallStatus,
      feeDetails: {
        totalFee: feeStructure.totalFee,
        paidAmount: feeStructure.totalPaid,
        balanceAmount: feeStructure.totalBalance,
        discountApplied: feeStructure.discountApplied || 0,
        lastPaymentDate: feeStructure.lastPaymentDate,
      }
    });

    console.log(`✅ Student ${req.params.studentId} fee status updated to: ${feeStructure.overallStatus}`);

    // Get student details for socket event
    const student = await Student.findById(req.params.studentId).select('name');

    // Emit socket event for real-time updates
    if (student) {
      emitFeeUpdate(student._id, student.name, feeStructure);
    }

    res.json(feeStructure);
  } catch (error) {
    console.error('Error recording payment:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get fee defaulters
router.get('/defaulters', authenticate, checkPermission('fees', 'view'), async (req, res) => {
  try {
    const { academicYear } = req.query;

    const defaulters = await StudentFeeStructure.find(
      scopeBySchool(req.user?.schoolId, {
        academicYear: await resolveAcademicYear(academicYear),
        overallStatus: { $in: ['pending', 'partial'] },
        totalBalance: { $gt: 0 }
      })
    )
      .populate('studentId', 'name admissionId rollNo phone parentPhone')
      .populate('classId', 'name section')
      .sort({ totalBalance: -1 });

    res.json(defaulters);
  } catch (error) {
    console.error('Error fetching defaulters:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;





