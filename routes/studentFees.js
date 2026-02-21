import express from 'express';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import FeeHead from '../models/FeeHead.js';
import { Student, Class } from '../database.js';
import { emitFeeUpdate } from '../utils/socketEmitter.js';

const router = express.Router();

// Helper function to calculate fee status consistently
function calculateFeeStatus(totalBalance, totalPaid) {
  if (totalBalance <= 0) return 'paid';
  if (totalPaid > 0) return 'partial';
  return 'pending';
}

// Get fee structure for a student
router.get('/student/:studentId', async (req, res) => {
  try {
    const { academicYear } = req.query;
    const query = {
      studentId: req.params.studentId,
      academicYear: academicYear || '2024-25'  // FIXED: Always include academic year to get correct fee structure
    };

    const feeStructure = await StudentFeeStructure.findOne(query)
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

// Get all students with their fee structures
router.get('/all', async (req, res) => {
  try {
    const { academicYear, classId, status } = req.query;
    const query = {};
    
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
router.post('/initialize/:studentId', async (req, res) => {
  try {
    const student = await Student.findById(req.params.studentId).populate('classId');
    
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const { academicYear } = req.body;
    const year = academicYear || '2024-25';

    // Check if fee structure already exists
    let feeStructure = await StudentFeeStructure.findOne({
      studentId: student._id,
      academicYear: year
    });

    if (feeStructure) {
      return res.json({
        message: 'Fee structure already exists',
        feeStructure
      });
    }

    // Extract class number from class name (e.g., "Class 10" -> "10")
    const classNumber = student.classId.name.replace('Class ', '');

    // Find applicable fee heads for this class
    const applicableFeeHeads = await FeeHead.find({
      applicableClasses: classNumber,
      academicYear: year,
      isActive: true
    });

    console.log(`📋 Found ${applicableFeeHeads.length} applicable fee heads for class ${classNumber}`);

    // Create fee structure
    feeStructure = new StudentFeeStructure({
      studentId: student._id,
      classId: student.classId._id,
      academicYear: year,
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
    console.error('Error initializing fee structure:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update discount for a student
router.put('/student/:studentId/discount', async (req, res) => {
  try {
    const { discountAmount, discountReason, academicYear } = req.body;

    const feeStructure = await StudentFeeStructure.findOne({
      studentId: req.params.studentId,
      academicYear: academicYear || '2024-25'
    });

    if (!feeStructure) {
      return res.status(404).json({ error: 'Fee structure not found' });
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
router.post('/student/:studentId/payment', async (req, res) => {
  try {
    const { amount, feeHeadPayments, academicYear } = req.body;

    const feeStructure = await StudentFeeStructure.findOne({
      studentId: req.params.studentId,
      academicYear: academicYear || '2024-25'
    });

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
router.get('/defaulters', async (req, res) => {
  try {
    const { academicYear } = req.query;
    
    const defaulters = await StudentFeeStructure.find({
      academicYear: academicYear || '2024-25',
      overallStatus: { $in: ['pending', 'partial'] },
      totalBalance: { $gt: 0 }
    })
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
