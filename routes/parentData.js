import express from 'express';
import crypto from 'crypto';
import { Parent, Student, Class, FeePayment } from '../database.js';
import { authenticateParent, validateParentChildAccess } from '../middleware/parentAuth.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import { emitFeePaymentCreated } from '../utils/socketEmitter.js';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateParent);

// Param-normalizing middleware: routes using :id need studentId for validateParentChildAccess
router.param('id', (req, res, next, id) => {
  req.params.studentId = id;
  next();
});

// GET /api/parent/profile
// Return current parent profile
router.get('/profile', async (req, res) => {
  try {
    const parent = req.parent;

    res.json({
      success: true,
      data: {
        id: parent._id,
        name: parent.name,
        phone: parent.phone,
        email: parent.email,
        avatar: parent.avatar,
        children: parent.children,
        preferences: parent.preferences,
        status: parent.status,
        lastLogin: parent.lastLogin,
        createdAt: parent.createdAt
      }
    });
  } catch (error) {
    console.error('Get parent profile error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to fetch parent profile'
      }
    });
  }
});

// PUT /api/parent/profile
// Update parent profile (email, avatar, preferences)
router.put('/profile', async (req, res) => {
  try {
    const parent = req.parent;
    const { email, avatar, preferences } = req.body;

    // Update allowed fields
    if (email !== undefined) parent.email = email;
    if (avatar !== undefined) parent.avatar = avatar;
    if (preferences !== undefined) {
      parent.preferences = {
        ...parent.preferences,
        ...preferences
      };
    }

    await parent.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        id: parent._id,
        name: parent.name,
        phone: parent.phone,
        email: parent.email,
        avatar: parent.avatar,
        preferences: parent.preferences
      }
    });
  } catch (error) {
    console.error('Update parent profile error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to update profile'
      }
    });
  }
});

// GET /api/parent/children
// Return parent's children with student details
router.get('/children', async (req, res) => {
  try {
    const parent = req.parent;

    // Fetch all children with their student details
    const childrenWithDetails = await Promise.all(
      parent.children.map(async (child) => {
        try {
          const student = await Student.findById(child.studentId)
            .select('name admissionId rollNo classId photo status feeDetails')
            .populate('classId', 'name section academicYear')
            .lean();

          if (!student) {
            return {
              studentId: child.studentId,
              relationship: child.relationship,
              isPrimary: child.isPrimary,
              error: 'Student not found'
            };
          }

          return {
            studentId: student._id,
            name: student.name,
            admissionId: student.admissionId,
            rollNo: student.rollNo,
            class: student.classId ? {
              id: student.classId._id,
              name: student.classId.name,
              section: student.classId.section,
              academicYear: student.classId.academicYear
            } : null,
            photo: student.photo,
            status: student.status,
            feeStatus: student.feeStatus,
            feeDetails: student.feeDetails,
            relationship: child.relationship,
            isPrimary: child.isPrimary
          };
        } catch (error) {
          console.error('Error fetching child details:', error);
          return {
            studentId: child.studentId,
            relationship: child.relationship,
            isPrimary: child.isPrimary,
            error: 'Failed to fetch details'
          };
        }
      })
    );

    res.json({
      success: true,
      data: {
        children: childrenWithDetails,
        total: childrenWithDetails.length
      }
    });
  } catch (error) {
    console.error('Get children error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to fetch children data'
      }
    });
  }
});

// GET /api/parent/students/:id
// Get student details (with access check)
router.get('/students/:id', validateParentChildAccess, async (req, res) => {
  try {
    const { id } = req.params;

    const student = await Student.findById(id)
      .select('-parents -siblings -isDeleted -deletedAt -deletedBy')
      .populate({
        path: 'classId',
        select: 'name section room block academicYear classTeacherId',
        populate: {
          path: 'classTeacherId',
          select: 'name phone email photo'
        }
      })
      .lean();

    if (!student) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'STUDENT_NOT_FOUND',
          message: 'Student not found'
        }
      });
    }

    // Get child relationship info from parent's children array
    const childInfo = req.parent.children.find(
      child => child.studentId.toString() === id
    );

    res.json({
      success: true,
      data: {
        ...student,
        relationship: childInfo?.relationship,
        isPrimary: childInfo?.isPrimary
      }
    });
  } catch (error) {
    console.error('Get student details error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to fetch student details'
      }
    });
  }
});

// GET /api/parent/students/:id/attendance
// Get student attendance data (with access check)
router.get('/students/:id/attendance', validateParentChildAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { startDate, endDate, limit = 30 } = req.query;

    const student = await Student.findById(id).select('name classId');

    if (!student) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'STUDENT_NOT_FOUND',
          message: 'Student not found'
        }
      });
    }

    // Import Attendance model
    const { Attendance } = await import('../database.js');

    const query = {
      studentId: id
    };

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = startDate;
      if (endDate) query.date.$lte = endDate;
    }

    const attendance = await Attendance.find(query)
      .sort({ date: -1 })
      .limit(parseInt(limit))
      .lean();

    // Calculate statistics
    const stats = {
      total: attendance.length,
      present: attendance.filter(a => a.status === 'present').length,
      absent: attendance.filter(a => a.status === 'absent').length,
      late: attendance.filter(a => a.status === 'late').length
    };

    stats.percentage = stats.total > 0
      ? Math.round((stats.present / stats.total) * 100)
      : 0;

    res.json({
      success: true,
      data: {
        studentId: id,
        studentName: student.name,
        attendance,
        stats
      }
    });
  } catch (error) {
    console.error('Get student attendance error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to fetch attendance data'
      }
    });
  }
});

// GET /api/parent/students/:id/fees
// Get student fee details (with access check)
router.get('/students/:id/fees', validateParentChildAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { academicYear } = req.query;

    const student = await Student.findById(id)
      .select('name admissionId classId feeDetails feeStatus')
      .populate('classId', 'name section academicYear');

    if (!student) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'STUDENT_NOT_FOUND',
          message: 'Student not found'
        }
      });
    }

    // Get fee structure from StudentFeeStructure (the source of truth for fee data)
    const year = academicYear || student.classId?.academicYear || '2024-25';

    console.log(`🔍 [Parent Fees] Student: ${student.name} (${id}), academicYear query: "${year}", classAcademicYear: "${student.classId?.academicYear}"`);

    // First try with resolved year, then try without academicYear filter as fallback
    let feeStructure = await StudentFeeStructure.findOne({
      studentId: id,
      academicYear: year
    }).lean();

    if (!feeStructure) {
      // Fallback: find any fee structure for this student
      feeStructure = await StudentFeeStructure.findOne({ studentId: id })
        .sort({ createdAt: -1 })
        .lean();
      if (feeStructure) {
        console.log(`⚠️ [Parent Fees] No fee structure for year "${year}", found one for year "${feeStructure.academicYear}" instead`);
      }
    }

    console.log(`📊 [Parent Fees] FeeStructure found: ${!!feeStructure}, totalFee: ${feeStructure?.totalFee}, totalPaid: ${feeStructure?.totalPaid}, totalBalance: ${feeStructure?.totalBalance}`);
    console.log(`📊 [Parent Fees] Student.feeDetails: ${JSON.stringify(student.feeDetails)}, Student.feeStatus: ${student.feeStatus}`);

    // Build feeDetails from StudentFeeStructure if available, fallback to Student.feeDetails
    let feeDetails;
    let feeStatus;
    let feeHeads = [];

    if (feeStructure) {
      feeDetails = {
        totalFee: feeStructure.totalFee || 0,
        paidAmount: feeStructure.totalPaid || 0,
        balanceAmount: feeStructure.totalBalance || 0,
        discountApplied: feeStructure.discountApplied || 0,
        lastPaymentDate: feeStructure.lastPaymentDate || null,
      };
      feeStatus = feeStructure.overallStatus || student.feeStatus || 'pending';
      feeHeads = feeStructure.feeHeads || [];
    } else {
      // Fallback to Student.feeDetails if no StudentFeeStructure exists
      feeDetails = student.feeDetails || {
        totalFee: 0,
        paidAmount: 0,
        balanceAmount: 0,
        discountApplied: 0,
        lastPaymentDate: null,
      };
      feeStatus = student.feeStatus || 'pending';
    }

    // Get fee payments
    const { FeePayment } = await import('../database.js');

    const payments = await FeePayment.find({ studentId: id })
      .sort({ paymentDate: -1 })
      .limit(10)
      .lean();

    res.json({
      success: true,
      data: {
        studentId: id,
        studentName: student.name,
        admissionId: student.admissionId,
        class: student.classId,
        feeDetails,
        feeStatus,
        feeStructure: feeHeads.length > 0 ? { feeHeads } : null,
        recentPayments: payments
      }
    });
  } catch (error) {
    console.error('Get student fees error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to fetch fee details'
      }
    });
  }
});

// GET /api/parent/students/:id/results
// Get student exam results (with access check)
router.get('/students/:id/results', validateParentChildAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { academicYear } = req.query;

    const student = await Student.findById(id).select('name classId');

    if (!student) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'STUDENT_NOT_FOUND',
          message: 'Student not found'
        }
      });
    }

    // Get results
    const { Result, Exam } = await import('../database.js');

    const query = { studentId: id };
    if (academicYear) query.academicYear = academicYear;

    const results = await Result.find(query)
      .populate('examId', 'name examType startDate endDate')
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      data: {
        studentId: id,
        studentName: student.name,
        results
      }
    });
  } catch (error) {
    console.error('Get student results error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to fetch results'
      }
    });
  }
});

// GET /api/parent/students/:id/remarks
// Get student remarks (with access check)
router.get('/students/:id/remarks', validateParentChildAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 20 } = req.query;

    const student = await Student.findById(id).select('name');
    if (!student) {
      return res.status(404).json({
        success: false,
        error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found' }
      });
    }

    const Remark = (await import('../models/Remark.js')).default;

    const remarks = await Remark.find({ studentId: id })
      .sort({ date: -1 })
      .limit(parseInt(limit))
      .lean();

    res.json({
      success: true,
      data: {
        studentId: id,
        studentName: student.name,
        remarks,
        total: remarks.length
      }
    });
  } catch (error) {
    console.error('Get student remarks error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch remarks' }
    });
  }
});

// POST /api/parent/fcm-token
// Register FCM token for push notifications
router.post('/fcm-token', async (req, res) => {
  try {
    const { token, deviceInfo } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_TOKEN',
          message: 'FCM token is required'
        }
      });
    }

    const parent = req.parent;

    // Check if token already exists
    const existingTokenIndex = parent.fcmTokens.findIndex(
      t => t.token === token
    );

    if (existingTokenIndex === -1) {
      // Add new token
      parent.fcmTokens.push({
        token,
        deviceInfo: deviceInfo || null,
        createdAt: new Date()
      });
    } else {
      // Update device info for existing token
      parent.fcmTokens[existingTokenIndex].deviceInfo = deviceInfo;
    }

    await parent.save();

    res.json({
      success: true,
      message: 'FCM token registered successfully',
      data: {
        tokenCount: parent.fcmTokens.length
      }
    });
  } catch (error) {
    console.error('Register FCM token error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to register FCM token'
      }
    });
  }
});

// DELETE /api/parent/fcm-token
// Remove FCM token
router.delete('/fcm-token', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_TOKEN',
          message: 'FCM token is required'
        }
      });
    }

    const parent = req.parent;

    // Remove token
    parent.fcmTokens = parent.fcmTokens.filter(
      t => t.token !== token
    );

    await parent.save();

    res.json({
      success: true,
      message: 'FCM token removed successfully',
      data: {
        tokenCount: parent.fcmTokens.length
      }
    });
  } catch (error) {
    console.error('Remove FCM token error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to remove FCM token'
      }
    });
  }
});

// GET /api/parent/announcements
// Get announcements for parent's children
router.get('/announcements', async (req, res) => {
  try {
    const parent = req.parent;
    const { limit = 20 } = req.query;

    // Get all class IDs from parent's children
    const studentIds = parent.children.map(child => child.studentId);

    const students = await Student.find({ _id: { $in: studentIds } })
      .select('classId')
      .lean();

    const classIds = students.map(s => s.classId).filter(Boolean);

    // Import Announcement model
    const { Announcement } = await import('../database.js');

    // Get announcements for these classes
    const announcements = await Announcement.find({
      $or: [
        { targetClasses: { $in: classIds } },
        { targetType: 'all' },
        { targetType: 'parents' }
      ],
      status: 'published',
      publishedAt: { $lte: new Date() }
    })
    .sort({ publishedAt: -1 })
    .limit(parseInt(limit))
    .lean();

    res.json({
      success: true,
      data: {
        announcements,
        total: announcements.length
      }
    });
  } catch (error) {
    console.error('Get announcements error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to fetch announcements'
      }
    });
  }
});

// GET /api/parent/timetable/:studentId
// Get student timetable (with access check)
router.get('/timetable/:studentId', validateParentChildAccess, async (req, res) => {
  try {
    const { studentId } = req.params;

    const student = await Student.findById(studentId)
      .select('name classId')
      .populate('classId', 'name section academicYear');

    if (!student || !student.classId) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CLASS_NOT_FOUND',
          message: 'Student class not found'
        }
      });
    }

    // Get timetable
    const { Timetable } = await import('../database.js');

    const timetable = await Timetable.findOne({
      classId: student.classId._id,
      academicYear: student.classId.academicYear
    })
    .select('periods schedule -_id')
    .lean();

    if (!timetable) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TIMETABLE_NOT_FOUND',
          message: 'Timetable not found for this class'
        }
      });
    }

    res.json({
      success: true,
      data: {
        studentId,
        studentName: student.name,
        class: student.classId,
        timetable
      }
    });
  } catch (error) {
    console.error('Get timetable error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to fetch timetable'
      }
    });
  }
});

// ============================================================
// PAYMENT GATEWAY ROUTES (Razorpay)
// ============================================================

/**
 * Helper: Get or create Razorpay instance
 * Requires RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in env
 */
let razorpayInstance = null;
async function getRazorpay() {
  if (razorpayInstance) return razorpayInstance;
  const Razorpay = (await import('razorpay')).default;
  razorpayInstance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
  return razorpayInstance;
}

// POST /api/parent/students/:id/payment/create-order
// Create a Razorpay order for fee payment
router.post('/students/:id/payment/create-order', validateParentChildAccess, async (req, res) => {
  try {
    const { id: studentId } = req.params;
    const { amount, feeHeadPayments, academicYear } = req.body;

    // Validate amount
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_AMOUNT', message: 'Payment amount must be greater than 0' }
      });
    }

    // Verify amount doesn't exceed balance
    const feeStructure = await StudentFeeStructure.findOne({ studentId, academicYear: academicYear || '2024-25' })
      || await StudentFeeStructure.findOne({ studentId }).sort({ createdAt: -1 });

    if (!feeStructure) {
      return res.status(404).json({
        success: false,
        error: { code: 'NO_FEE_STRUCTURE', message: 'No fee structure found for this student' }
      });
    }

    if (amount > feeStructure.totalBalance) {
      return res.status(400).json({
        success: false,
        error: { code: 'AMOUNT_EXCEEDS_BALANCE', message: `Amount ₹${amount} exceeds pending balance ₹${feeStructure.totalBalance}` }
      });
    }

    // Validate individual fee head payments if provided
    if (feeHeadPayments && feeHeadPayments.length > 0) {
      for (const fhp of feeHeadPayments) {
        const head = feeStructure.feeHeads.find(h =>
          h.feeHeadId?.toString() === fhp.feeHeadId || h._id?.toString() === fhp.feeHeadId
        );
        if (head && fhp.amount > head.balanceAmount) {
          return res.status(400).json({
            success: false,
            error: { code: 'HEAD_AMOUNT_EXCEEDS', message: `Amount for "${head.name}" exceeds its pending balance` }
          });
        }
      }
    }

    const student = await Student.findById(studentId).select('name admissionId classId').populate('classId', 'name');

    // Check if Razorpay keys are configured
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      // Fallback: create a mock order for development/testing
      const mockOrderId = `order_dev_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      return res.json({
        success: true,
        data: {
          orderId: mockOrderId,
          amount: amount,
          amountInPaise: Math.round(amount * 100),
          currency: 'INR',
          studentName: student?.name || '',
          keyId: 'rzp_test_placeholder',
          notes: {
            studentId,
            studentName: student?.name || '',
            className: student?.classId?.name || '',
            admissionId: student?.admissionId || '',
            academicYear: feeStructure.academicYear,
            parentId: req.parent._id.toString(),
          },
          mock: true, // Flag for frontend to handle mock flow
        }
      });
    }

    // Create Razorpay order
    const razorpay = await getRazorpay();
    const amountInPaise = Math.round(amount * 100);

    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `fee_${studentId}_${Date.now()}`,
      notes: {
        studentId,
        studentName: student?.name || '',
        className: student?.classId?.name || '',
        admissionId: student?.admissionId || '',
        academicYear: feeStructure.academicYear,
        parentId: req.parent._id.toString(),
      }
    });

    res.json({
      success: true,
      data: {
        orderId: order.id,
        amount: amount,
        amountInPaise: order.amount,
        currency: order.currency,
        studentName: student?.name || '',
        keyId: process.env.RAZORPAY_KEY_ID,
        notes: order.notes,
        mock: false,
      }
    });
  } catch (error) {
    console.error('Create payment order error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'ORDER_CREATION_FAILED', message: 'Failed to create payment order' }
    });
  }
});

// POST /api/parent/students/:id/payment/verify
// Verify Razorpay payment and record it
router.post('/students/:id/payment/verify', validateParentChildAccess, async (req, res) => {
  try {
    const { id: studentId } = req.params;
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      amount,
      feeHeadPayments,
      academicYear,
      mock, // For dev/test without real Razorpay
    } = req.body;

    // Verify signature (skip for mock payments)
    if (!mock && process.env.RAZORPAY_KEY_SECRET) {
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

      if (expectedSignature !== razorpay_signature) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_SIGNATURE', message: 'Payment verification failed. Invalid signature.' }
        });
      }
    }

    const student = await Student.findById(studentId)
      .select('name admissionId classId feeDetails')
      .populate('classId', 'name academicYear');

    if (!student) {
      return res.status(404).json({
        success: false,
        error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found' }
      });
    }

    const year = academicYear || student.classId?.academicYear || '2024-25';

    // Build fee heads breakdown for payment record
    let paymentFeeHeads = [];
    if (feeHeadPayments && feeHeadPayments.length > 0) {
      paymentFeeHeads = feeHeadPayments.map(fhp => ({
        name: fhp.name || fhp.feeHeadName || '',
        amount: fhp.amount,
      }));
    }

    // Create FeePayment record
    const receiptNumber = `RCP-ON-${Date.now()}`;
    const payment = new FeePayment({
      studentId,
      classId: student.classId?._id || student.classId,
      academicYear: year,
      receiptNumber,
      paymentDate: new Date().toISOString().split('T')[0],
      amount,
      paymentMode: 'online',
      feeHeads: paymentFeeHeads,
      transactionId: razorpay_payment_id || `mock_${Date.now()}`,
      status: 'completed',
      remarks: `Online payment via parent app. Order: ${razorpay_order_id || 'N/A'}`,
    });

    await payment.save();

    // Update StudentFeeStructure
    const feeStructure = await StudentFeeStructure.findOne({ studentId, academicYear: year })
      || await StudentFeeStructure.findOne({ studentId }).sort({ createdAt: -1 });

    if (feeStructure) {
      // Update individual fee head payments if breakdown provided
      if (feeHeadPayments && feeHeadPayments.length > 0) {
        for (const fhp of feeHeadPayments) {
          const head = feeStructure.feeHeads.find(h =>
            h.feeHeadId?.toString() === fhp.feeHeadId || h._id?.toString() === fhp.feeHeadId
          );
          if (head) {
            head.paidAmount = (head.paidAmount || 0) + fhp.amount;
            head.balanceAmount = head.amount - head.paidAmount;
            head.status = head.balanceAmount <= 0 ? 'paid' : head.paidAmount > 0 ? 'partial' : 'pending';
          }
        }
      }

      // Update totals
      feeStructure.totalPaid = (feeStructure.totalPaid || 0) + amount;
      feeStructure.totalBalance = (feeStructure.totalFee || 0) - feeStructure.totalPaid - (feeStructure.discountApplied || 0);
      if (feeStructure.totalBalance < 0) feeStructure.totalBalance = 0;
      feeStructure.overallStatus = feeStructure.totalBalance <= 0 ? 'paid' : feeStructure.totalPaid > 0 ? 'partial' : 'pending';
      feeStructure.lastPaymentDate = new Date();

      await feeStructure.save();
    }

    // Update Student.feeDetails
    try {
      student.feeDetails = student.feeDetails || {};
      student.feeDetails.totalPaid = (student.feeDetails.totalPaid || 0) + amount;
      student.feeDetails.totalPending = (student.feeDetails.totalFee || 0) - student.feeDetails.totalPaid;
      await student.save();
    } catch (e) {
      console.warn('Could not update student fee details:', e.message);
    }

    // Emit socket event
    emitFeePaymentCreated(studentId, student.name, payment, feeStructure);

    res.json({
      success: true,
      data: {
        payment: {
          _id: payment._id,
          amount: payment.amount,
          receiptNumber: payment.receiptNumber,
          transactionId: payment.transactionId,
          paymentDate: payment.paymentDate,
          paymentMode: payment.paymentMode,
          status: payment.status,
        },
        updatedFeeDetails: feeStructure ? {
          totalFee: feeStructure.totalFee,
          paidAmount: feeStructure.totalPaid,
          balanceAmount: feeStructure.totalBalance,
          overallStatus: feeStructure.overallStatus,
        } : null,
      }
    });
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'VERIFICATION_FAILED', message: 'Payment verification failed' }
    });
  }
});

export default router;
