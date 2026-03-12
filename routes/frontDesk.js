import express from 'express';
import { Admission, Appointment, Feedback, CallLog, Staff, Student } from '../database.js';
import Visitor from '../models/Visitor.js';
import GatePass from '../models/GatePass.js';
import { authenticate } from '../middleware/auth.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';

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

const router = express.Router();

// Middleware to attach Staff model to req.app.locals if not already there
router.use((req, res, next) => {
  if (!req.app.locals.Staff) {
    req.app.locals.Staff = Staff;
  }
  next();
});

// ============= ADMISSIONS ROUTES =============

/**
 * GET /api/front-desk/admissions
 * Get all admissions with optional filters
 */
router.get('/admissions', authenticate, async (req, res) => {
  try {
    const { status, source } = req.query;
    const query = {};

    if (status) query.status = status;
    if (source) query.source = source;

    const admissions = await Admission.find(query)
      .sort({ createdAt: -1 })
      .populate('assignedTeacher', 'name')
      .populate('decisionBy', 'name');

    res.json(admissions);
  } catch (error) {
    console.error('❌ Get admissions error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch admissions'
    });
  }
});

/**
 * POST /api/front-desk/admissions
 * Create new admission inquiry
 */
router.post('/admissions', authenticate, async (req, res) => {
  try {
    const admissionData = {
      ...req.body,
      dateOfInquiry: new Date().toISOString().split('T')[0]
    };

    // If assignedTeacher is provided, populate assignedTeacher field
    if (req.body.assignedTeacher) {
      admissionData.assignedTeacher = req.body.assignedTeacher;
    }

    const admission = await Admission.create(admissionData);

    // Populate for response
    await admission.populate('assignedTeacher', 'name');

    res.status(201).json(admission);
  } catch (error) {
    console.error('❌ Create admission error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to create admission inquiry'
    });
  }
});

/**
 * PUT /api/front-desk/admissions/:id
 * Update admission inquiry
 */
router.put('/admissions/:id', authenticate, async (req, res) => {
  try {
    const admission = await Admission.findById(req.params.id);

    if (!admission) {
      return res.status(404).json({
        success: false,
        error: 'Admission not found'
      });
    }

    // Update allowed fields
    const allowedFields = ['studentName', 'dateOfBirth', 'parentName', 'phoneNumber', 'email', 'classApplyingFor',
      'hscGroup', 'assessmentRequired', 'assignedTeacher', 'testDate', 'testTime', 'testResult', 'source', 'status',
      'admissionDecision', 'decisionRemarks', 'paymentStatus', 'paymentMode', 'paymentAmount', 'paymentDate', 'transactionId'];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        admission[field] = req.body[field];
      }
    });

    // If status changed to admission-approved or admission-rejected, update decision metadata
    if (req.body.status && req.body.status.startsWith('admission-')) {
      admission.decisionBy = req.user.id;
      if (req.body.status === 'admission-approved') {
        admission.admissionDecision = 'approved';
      } else if (req.body.status === 'admission-rejected') {
        admission.admissionDecision = 'rejected';
      }
    }

    await admission.save();
    await admission.populate('assignedTeacher', 'name');

    res.json(admission);
  } catch (error) {
    console.error('❌ Update admission error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to update admission'
    });
  }
});

/**
 * DELETE /api/front-desk/admissions/:id
 * Delete admission inquiry
 */
router.delete('/admissions/:id', authenticate, async (req, res) => {
  try {
    await Admission.deleteOne({ _id: req.params.id });
    res.json({ success: true, message: 'Admission deleted successfully' });
  } catch (error) {
    console.error('❌ Delete admission error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to delete admission'
    });
  }
});

/**
 * POST /api/front-desk/admissions/:id/convert-to-student
 * Convert admission inquiry to student record
 */
router.post('/admissions/:id/convert-to-student', authenticate, async (req, res) => {
  try {
    const admission = await Admission.findById(req.params.id);

    if (!admission) {
      return res.status(404).json({
        success: false,
        error: 'Admission not found'
      });
    }

    // Check if admission is approved and fee paid
    if (admission.status !== 'admission-approved' && admission.status !== 'fee-paid' && admission.status !== 'student-admitted') {
      return res.status(400).json({
        success: false,
        error: 'Admission must be approved and fee paid before converting to student'
      });
    }

    // Check if student already exists
    const existingStudent = await Student.findOne({ admissionId: admission._id });
    if (existingStudent) {
      return res.status(400).json({
        success: false,
        error: 'Student record already exists for this admission'
      });
    }

    // Generate admission number for student
    const year = new Date().getFullYear();
    const classCount = await Student.countDocuments({ classId: admission.classApplyingFor });
    const admissionNumber = `${year}-${admission.classApplyingFor}-${String(classCount + 1).padStart(4, '0')}`;

    // Create student from admission
    const studentData = {
      name: admission.studentName,
      dateOfBirth: admission.dateOfBirth,
      admissionId: admissionNumber,
      classId: admission.classApplyingFor,
      section: '',
      rollNo: String(classCount + 1),
      parentName: admission.parentName,
      parentPhone: admission.phoneNumber,
      parentEmail: admission.email,
      admissionDate: new Date().toISOString().split('T')[0],
      status: 'active',
      hscGroup: admission.hscGroup || '',
      // Reference to admission inquiry
      admissionInquiryId: admission._id
    };

    const student = await Student.create(studentData);

    // Update admission status
    admission.status = 'student-admitted';
    await admission.save();

    res.status(201).json({
      success: true,
      message: 'Student created successfully',
      student,
      admissionNumber
    });
  } catch (error) {
    console.error('❌ Convert admission to student error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to convert admission to student'
    });
  }
});

/**
 * GET /api/front-desk/admissions/:id/tracker
 * Get admission tracker timeline
 */
router.get('/admissions/:id/tracker', authenticate, async (req, res) => {
  try {
    const admission = await Admission.findById(req.params.id)
      .populate('assignedTeacher', 'name')
      .populate('decisionBy', 'name');

    if (!admission) {
      return res.status(404).json({
        success: false,
        error: 'Admission not found'
      });
    }

    // Build timeline based on status
    const timeline = [];
    const statusOptions = [
      'inquiry-logged',
      'form-sent',
      'form-submitted',
      'documents-verified',
      'test-scheduled',
      'test-cleared',
      'test-failed',
      'test-no-show',
      'admission-approved',
      'admission-rejected',
      'fee-paid',
      'student-admitted'
    ];

    const currentIndex = statusOptions.indexOf(admission.status);

    statusOptions.forEach((status, index) => {
      const isCompleted = index <= currentIndex;
      const isCurrent = index === currentIndex;

      let label = status.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      let date = null;
      let notes = '';

      // Add dates and notes based on status
      if (status === 'inquiry-logged') {
        date = admission.createdAt;
        notes = `Source: ${admission.source}`;
      } else if (status === 'test-scheduled') {
        date = admission.testDate;
        notes = admission.testTime ? `Time: ${admission.testTime}` : '';
      } else if (status === 'admission-approved' || status === 'admission-rejected') {
        if (admission.admissionDecision) {
          label = `Admission ${admission.admissionDecision.toUpperCase()}`;
        }
        notes = admission.decisionRemarks || '';
      } else if (status === 'fee-paid') {
        if (admission.paymentStatus === 'paid') {
          date = admission.paymentDate;
          notes = `Mode: ${admission.paymentMode}, Amount: ${admission.paymentAmount}`;
        }
      }

      timeline.push({
        status,
        label,
        isCompleted,
        isCurrent,
        date,
        notes,
        assignedTo: admission.assignedTeacher?.name || null
      });
    });

    res.json({
      admission,
      timeline,
      currentStage: admission.status,
      progress: ((currentIndex + 1) / statusOptions.length) * 100
    });
  } catch (error) {
    console.error('❌ Get admission tracker error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to get admission tracker'
    });
  }
});

// ============= VISITORS ROUTES =============

/**
 * GET /api/front-desk/visitors/today
 * Get today's visitors
 */
router.get('/visitors/today', authenticate, async (req, res) => {
  try {
    const visitors = await Visitor.getTodaysVisitors();
    res.json(visitors);
  } catch (error) {
    console.error('❌ Get today visitors error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch visitors'
    });
  }
});

/**
 * GET /api/front-desk/visitors
 * Get all visitors with optional filters
 */
router.get('/visitors', authenticate, async (req, res) => {
  try {
    const { status, search } = req.query;
    let visitors;

    if (search) {
      visitors = await Visitor.searchVisitors(search);
    } else if (status === 'active') {
      visitors = await Visitor.getActiveVisitors();
    } else {
      visitors = await Visitor.find()
        .sort({ checkInTime: -1 })
        .populate('checkedInBy', 'name code')
        .populate('studentId', 'name admissionId rollNo classId');
    }

    res.json(visitors);
  } catch (error) {
    console.error('❌ Get visitors error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch visitors'
    });
  }
});

/**
 * POST /api/front-desk/visitors
 * Create new visitor
 */
router.post('/visitors', authenticate, async (req, res) => {
  try {
    // Extract only allowed fields for security (input sanitization)
    const allowedFields = [
      'visitorName', 'phoneNumber', 'email', 'reasonForVisit', 'otherPurpose',
      'whomToMeet', 'department', 'companyName', 'deliveryPerson', 'studentId',
      'studentName', 'parentMapping', 'gatePassRequired', 'appointmentRequired',
      'admissionInquiry', 'itemsDeclared', 'notes'
    ];

    const visitorData = {
      checkInTime: new Date(),
      checkedInBy: req.user.id,
      status: 'ACTIVE'
    };

    // Only copy allowed fields from request body
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        visitorData[field] = req.body[field];
      }
    });

    const visitor = await Visitor.create(visitorData);

    // Populate for response
    await visitor.populate('checkedInBy', 'name code');
    if (visitor.studentId) {
      await visitor.populate('studentId', 'name admissionId rollNo classId');
    }

    res.status(201).json(visitor);
  } catch (error) {
    console.error('❌ Create visitor error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to create visitor'
    });
  }
});

/**
 * PUT /api/front-desk/visitors/:id
 * Update visitor (for checkout or edit)
 */
router.put('/visitors/:id', authenticate, async (req, res) => {
  try {
    const visitor = await Visitor.findById(req.params.id);

    if (!visitor) {
      return res.status(404).json({
        success: false,
        error: 'Visitor not found'
      });
    }

    // Update allowed fields - support both old and new field names
    const allowedFields = ['name', 'visitorName', 'phone', 'phoneNumber', 'email', 'purpose',
      'reasonForVisit', 'otherPurpose', 'whomToMeet', 'department', 'companyName',
      'deliveryPerson', 'notes', 'studentId', 'studentName', 'parentMapping',
      'gatePassRequired', 'appointmentRequired'];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        visitor[field] = req.body[field];
      }
    });

    // Handle checkout
    if (req.body.checkOutTime && visitor.status === 'ACTIVE') {
      await visitor.checkOut(req.user.id, req.body.notes || '');
    }

    await visitor.save();
    await visitor.populate('checkedInBy', 'name code');
    if (visitor.studentId) {
      await visitor.populate('studentId', 'name admissionId rollNo classId');
    }

    res.json(visitor);
  } catch (error) {
    console.error('❌ Update visitor error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to update visitor'
    });
  }
});

/**
 * DELETE /api/front-desk/visitors/:id
 * Delete visitor
 */
router.delete('/visitors/:id', authenticate, async (req, res) => {
  try {
    await Visitor.deleteOne({ _id: req.params.id });
    res.json({ success: true, message: 'Visitor deleted successfully' });
  } catch (error) {
    console.error('❌ Delete visitor error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to delete visitor'
    });
  }
});

// ============= GATE PASSES ROUTES =============

/**
 * GET /api/front-desk/gate-passes/today
 * Get today's gate passes
 */
router.get('/gate-passes/today', authenticate, async (req, res) => {
  try {
    const gatePasses = await GatePass.getTodaysPasses();
    res.json(gatePasses);
  } catch (error) {
    console.error('❌ Get today gate passes error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch gate passes'
    });
  }
});

/**
 * GET /api/front-desk/gate-passes
 * Get all gate passes with optional filters
 */
router.get('/gate-passes', authenticate, async (req, res) => {
  try {
    const { status, approvalStatus, studentId } = req.query;
    let gatePasses;

    if (studentId) {
      gatePasses = await GatePass.getByStudent(studentId);
    } else if (status === 'active') {
      gatePasses = await GatePass.getActivePasses();
    } else {
      const query = {};
      if (status) query.status = status;
      if (approvalStatus) query.approvalStatus = approvalStatus;

      gatePasses = await GatePass.find(query)
        .sort({ leavingDate: -1, leavingTime: -1 })
        .populate('studentId', 'name admissionId photo rollNo')
        .populate('approvedByStaffId', 'name code')
        .populate('requestedById', 'name code');
    }

    res.json(gatePasses);
  } catch (error) {
    console.error('❌ Get gate passes error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch gate passes'
    });
  }
});

/**
 * POST /api/front-desk/gate-passes
 * Create new gate pass
 */
router.post('/gate-passes', authenticate, async (req, res) => {
  try {
    // Extract only allowed fields for security (input sanitization)
    const allowedFields = [
      'studentId', 'studentName', 'class', 'section', 'reason', 'otherReason',
      'leavingDate', 'leavingTime', 'expectedReturnDate', 'expectedReturnTime',
      'leavingWith', 'escortName', 'escortRelation', 'escortPhone',
      'approvedBy', 'approvedByStaffId', 'approvedByName', 'notes'
    ];

    const gatePassData = {
      requestedById: req.user.id,
      requestedByName: req.user.name || 'Front Desk',
      status: 'PENDING',
      approvalStatus: 'PENDING'
    };

    // Only copy allowed fields from request body
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        gatePassData[field] = req.body[field];
      }
    });

    // Validate required fields
    if (!gatePassData.studentId || !gatePassData.reason) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: studentId and reason are required'
      });
    }

    const gatePass = await GatePass.create(gatePassData);

    // Populate for response
    await gatePass.populate('studentId', 'name admissionId photo rollNo');
    await gatePass.populate('approvedByStaffId', 'name code');
    await gatePass.populate('requestedById', 'name code');

    res.status(201).json(gatePass);
  } catch (error) {
    console.error('❌ Create gate pass error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to create gate pass'
    });
  }
});

/**
 * PUT /api/front-desk/gate-passes/:id
 * Update gate pass
 */
router.put('/gate-passes/:id', authenticate, async (req, res) => {
  try {
    const gatePass = await GatePass.findById(req.params.id);

    if (!gatePass) {
      return res.status(404).json({
        success: false,
        error: 'Gate pass not found'
      });
    }

    // Update allowed fields
    const allowedFields = ['reason', 'otherReason', 'leavingDate', 'leavingTime', 'expectedReturnDate',
      'expectedReturnTime', 'leavingWith', 'parentType', 'escortName', 'escortRelation',
      'escortPhone', 'approvedBy', 'approvedByStaffId', 'approvedByName', 'notes'];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        gatePass[field] = req.body[field];
      }
    });

    // If status is being updated
    if (req.body.approvalStatus) {
      gatePass.approvalStatus = req.body.approvalStatus;
      if (req.body.approvalStatus === 'APPROVED') {
        gatePass.status = 'ACTIVE';
      } else if (req.body.approvalStatus === 'REJECTED') {
        gatePass.status = 'CANCELLED';
      }
    }

    if (req.body.status) {
      gatePass.status = req.body.status;
    }

    await gatePass.save();
    await gatePass.populate('studentId', 'name admissionId photo rollNo');
    await gatePass.populate('approvedByStaffId', 'name code');
    await gatePass.populate('requestedById', 'name code');

    res.json(gatePass);
  } catch (error) {
    console.error('❌ Update gate pass error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to update gate pass'
    });
  }
});

/**
 * DELETE /api/front-desk/gate-passes/:id
 * Delete gate pass
 */
router.delete('/gate-passes/:id', authenticate, async (req, res) => {
  try {
    await GatePass.deleteOne({ _id: req.params.id });
    res.json({ success: true, message: 'Gate pass deleted successfully' });
  } catch (error) {
    console.error('❌ Delete gate pass error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to delete gate pass'
    });
  }
});

// ============= APPOINTMENTS ROUTES =============

/**
 * GET /api/front-desk/appointments
 * Get all appointments with optional filters
 */
router.get('/appointments', authenticate, async (req, res) => {
  try {
    const { status } = req.query;
    const query = {};

    if (status) query.status = status;

    const schoolId = await resolveRequestSchoolId(req);
    const appointments = await Appointment.find(scopeBySchool(schoolId, query))
      .sort({ fromDateTime: 1 });

    res.json(appointments);
  } catch (error) {
    console.error('❌ Get appointments error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch appointments'
    });
  }
});

/**
 * POST /api/front-desk/appointments
 * Create new appointment
 */
router.post('/appointments', authenticate, async (req, res) => {
  try {
    const schoolId = await resolveRequestSchoolId(req);
    const appointment = await Appointment.create({ ...req.body, schoolId });
    res.status(201).json(appointment);
  } catch (error) {
    console.error('❌ Create appointment error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to create appointment'
    });
  }
});

/**
 * PUT /api/front-desk/appointments/:id
 * Update appointment
 */
router.put('/appointments/:id', authenticate, async (req, res) => {
  try {
    const schoolId = await resolveRequestSchoolId(req);
    const appointment = await Appointment.findOne(scopeBySchool(schoolId, { _id: req.params.id }));

    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: 'Appointment not found'
      });
    }

    // Update allowed fields
    const allowedFields = ['visitorName', 'phoneNumber', 'purpose', 'fromDateTime', 'toDateTime', 'meetingWith', 'notes', 'status'];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        appointment[field] = req.body[field];
      }
    });

    await appointment.save();
    res.json(appointment);
  } catch (error) {
    console.error('❌ Update appointment error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to update appointment'
    });
  }
});

/**
 * DELETE /api/front-desk/appointments/:id
 * Delete appointment
 */
router.delete('/appointments/:id', authenticate, async (req, res) => {
  try {
    const schoolId = await resolveRequestSchoolId(req);
    await Appointment.deleteOne(scopeBySchool(schoolId, { _id: req.params.id }));
    res.json({ success: true, message: 'Appointment deleted successfully' });
  } catch (error) {
    console.error('❌ Delete appointment error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to delete appointment'
    });
  }
});

// ============= FEEDBACKS ROUTES =============

/**
 * GET /api/front-desk/feedbacks
 * Get all feedbacks with optional filters
 */
router.get('/feedbacks', authenticate, async (req, res) => {
  try {
    const { status } = req.query;
    const query = {};

    if (status) query.status = status;

    const feedbacks = await Feedback.find(query)
      .sort({ createdAt: -1 })
      .populate('assignedStaff', 'name role');

    res.json(feedbacks);
  } catch (error) {
    console.error('❌ Get feedbacks error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch feedbacks'
    });
  }
});

/**
 * POST /api/front-desk/feedbacks
 * Create new feedback
 */
router.post('/feedbacks', authenticate, async (req, res) => {
  try {
    const feedbackData = {
      ...req.body,
      date: new Date().toISOString().split('T')[0]
    };

    const feedback = await Feedback.create(feedbackData);

    // Populate for response
    await feedback.populate('assignedStaff', 'name role');

    res.status(201).json(feedback);
  } catch (error) {
    console.error('❌ Create feedback error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to create feedback'
    });
  }
});

/**
 * PUT /api/front-desk/feedbacks/:id
 * Update feedback
 */
router.put('/feedbacks/:id', authenticate, async (req, res) => {
  try {
    const feedback = await Feedback.findById(req.params.id);

    if (!feedback) {
      return res.status(404).json({
        success: false,
        error: 'Feedback not found'
      });
    }

    // Update allowed fields
    const allowedFields = ['name', 'phoneNumber', 'category', 'assignedStaff', 'notifyStaff', 'status', 'notes'];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        feedback[field] = req.body[field];
      }
    });

    await feedback.save();
    await feedback.populate('assignedStaff', 'name role');

    res.json(feedback);
  } catch (error) {
    console.error('❌ Update feedback error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to update feedback'
    });
  }
});

/**
 * DELETE /api/front-desk/feedbacks/:id
 * Delete feedback
 */
router.delete('/feedbacks/:id', authenticate, async (req, res) => {
  try {
    await Feedback.deleteOne({ _id: req.params.id });
    res.json({ success: true, message: 'Feedback deleted successfully' });
  } catch (error) {
    console.error('❌ Delete feedback error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to delete feedback'
    });
  }
});

// ============= CALL LOGS ROUTES =============

/**
 * GET /api/front-desk/call-logs
 * Get all call logs
 */
router.get('/call-logs', authenticate, async (req, res) => {
  try {
    const callLogs = await CallLog.find()
      .sort({ dateTime: -1 });

    res.json(callLogs);
  } catch (error) {
    console.error('❌ Get call logs error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch call logs'
    });
  }
});

/**
 * POST /api/front-desk/call-logs
 * Create new call log
 */
router.post('/call-logs', authenticate, async (req, res) => {
  try {
    const callLogData = {
      ...req.body,
      loggedBy: req.user.id
    };

    const callLog = await CallLog.create(callLogData);
    res.status(201).json(callLog);
  } catch (error) {
    console.error('❌ Create call log error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to create call log'
    });
  }
});

/**
 * PUT /api/front-desk/call-logs/:id
 * Update call log
 */
router.put('/call-logs/:id', authenticate, async (req, res) => {
  try {
    const callLog = await CallLog.findById(req.params.id);

    if (!callLog) {
      return res.status(404).json({
        success: false,
        error: 'Call log not found'
      });
    }

    // Update allowed fields
    const allowedFields = ['callerName', 'phoneNumber', 'dateTime', 'purpose', 'intent', 'keyNotes', 'summary', 'title'];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        callLog[field] = req.body[field];
      }
    });

    await callLog.save();
    res.json(callLog);
  } catch (error) {
    console.error('❌ Update call log error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to update call log'
    });
  }
});

/**
 * DELETE /api/front-desk/call-logs/:id
 * Delete call log
 */
router.delete('/call-logs/:id', authenticate, async (req, res) => {
  try {
    await CallLog.deleteOne({ _id: req.params.id });
    res.json({ success: true, message: 'Call log deleted successfully' });
  } catch (error) {
    console.error('❌ Delete call log error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to delete call log'
    });
  }
});

export default router;
