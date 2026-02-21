import express from 'express';
import { Student, FeePayment } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { emitFeePaymentCreated } from '../utils/socketEmitter.js';

const router = express.Router();

// Get all payments with optional filters
router.get('/payments', authenticate, async (req, res) => {
  try {
    const { studentId, academicYear, status, startDate, endDate } = req.query;

    const filter = {};
    if (studentId) filter.studentId = studentId;
    if (academicYear) filter.academicYear = academicYear;
    if (status) filter.status = status;
    if (startDate || endDate) {
      filter.paymentDate = {};
      if (startDate) filter.paymentDate.$gte = new Date(startDate);
      if (endDate) filter.paymentDate.$lte = new Date(endDate);
    }

    const payments = await FeePayment.find(filter)
      .populate('studentId', 'name admissionId class')
      .sort({ paymentDate: -1 });

    res.json(payments);
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// Create a new payment
router.post('/payments', async (req, res) => {
  try {
    const { studentId, studentName, classId, academicYear, receiptNumber, paymentDate, amount, paymentMode, feeHeads, remarks } = req.body;

    // Generate receipt number if not provided
    const receipt = receiptNumber || `RCP-${Date.now()}`;

    // Create payment with explicit fields
    const payment = new FeePayment({
      studentId,
      classId,
      academicYear: academicYear || '2024-25',
      receiptNumber: receipt,
      paymentDate: paymentDate || new Date().toISOString().split('T')[0],
      amount,
      paymentMode: paymentMode || 'cash',
      feeHeads: feeHeads || [],
      remarks: remarks || '',
      status: 'completed'
    });

    await payment.save();

    // Update student's fee details (non-blocking, don't fail if this errors)
    try {
      if (studentId) {
        const student = await Student.findById(studentId);
        if (student) {
          student.feeDetails = student.feeDetails || {};
          student.feeDetails.totalPaid = (student.feeDetails.totalPaid || 0) + amount;
          student.feeDetails.totalPending = (student.feeDetails.totalFee || 0) - student.feeDetails.totalPaid;
          await student.save();
        }
      }
    } catch (studentUpdateError) {
      console.warn('Could not update student fee details:', studentUpdateError.message);
    }

    // Emit real-time socket event for payment creation
    emitFeePaymentCreated(studentId, studentName || '', payment);

    res.status(201).json(payment);
  } catch (error) {
    console.error('Error creating payment:', error);
    res.status(500).json({ error: error.message || 'Failed to create payment' });
  }
});

// Get payment by ID
router.get('/payments/:id', async (req, res) => {
  try {
    const payment = await FeePayment.findById(req.params.id)
      .populate('studentId', 'name admissionId class');

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    res.json(payment);
  } catch (error) {
    console.error('Error fetching payment:', error);
    res.status(500).json({ error: 'Failed to fetch payment' });
  }
});

export default router;
