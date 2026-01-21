import express from 'express';
import FeePayment from '../models/FeePayment.js';
import { Student } from '../database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get all payments with optional filters
router.get('/payments', authenticateToken, async (req, res) => {
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
      .populate('studentId', 'firstName lastName admissionId class')
      .sort({ paymentDate: -1 });

    res.json(payments);
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// Create a new payment
router.post('/payments', authenticateToken, async (req, res) => {
  try {
    const payment = new FeePayment(req.body);
    await payment.save();

    // Update student's fee details
    if (payment.studentId) {
      const student = await Student.findById(payment.studentId);
      if (student) {
        student.feeDetails = student.feeDetails || {};
        student.feeDetails.totalPaid = (student.feeDetails.totalPaid || 0) + payment.amount;
        student.feeDetails.totalPending = (student.feeDetails.totalFee || 0) - student.feeDetails.totalPaid;
        await student.save();
      }
    }

    res.status(201).json(payment);
  } catch (error) {
    console.error('Error creating payment:', error);
    res.status(500).json({ error: 'Failed to create payment' });
  }
});

// Get payment by ID
router.get('/payments/:id', authenticateToken, async (req, res) => {
  try {
    const payment = await FeePayment.findById(req.params.id)
      .populate('studentId', 'firstName lastName admissionId class');
    
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
