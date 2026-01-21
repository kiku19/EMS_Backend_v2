import express from 'express';
import { Admission, Appointment, Feedback, CallLog, Staff } from '../database.js';
import { authenticate } from '../middleware/auth.js';

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
    const allowedFields = ['studentName', 'dateOfBirth', 'parentName', 'phoneNumber', 'email', 'classApplyingFor', 'assessmentRequired', 'assignedTeacher', 'testDate', 'testTime', 'testResult', 'source', 'status', 'admissionDecision', 'decisionRemarks'];

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

// ============= VISITORS ROUTES (SIMPLIFIED FRONT DESK VERSION) =============

/**
 * GET /api/front-desk/visitors/today
 * Get today's visitors (simplified version for front desk)
 */
router.get('/visitors/today', authenticate, async (req, res) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const visitors = await Admission.find({
      createdAt: { $gte: startOfDay, $lte: endOfDay }
    }).sort({ createdAt: -1 });

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
 * POST /api/front-desk/visitors
 * Create new visitor (simplified - uses Admission model for walk-in visitors)
 */
router.post('/visitors', authenticate, async (req, res) => {
  try {
    // For now, create as admission inquiry type
    const visitorData = {
      studentName: req.body.visitorName,
      phoneNumber: req.body.phoneNumber,
      status: 'inquiry-logged',
      source: 'walk-in'
    };

    const visitor = await Admission.create(visitorData);
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
 * Update visitor (for checkout)
 */
router.put('/visitors/:id', authenticate, async (req, res) => {
  try {
    const visitor = await Admission.findById(req.params.id);

    if (!visitor) {
      return res.status(404).json({
        success: false,
        error: 'Visitor not found'
      });
    }

    // Update fields
    if (req.body.checkOutTime) {
      visitor.notes = visitor.notes ? `${visitor.notes}\nChecked out at ${req.body.checkOutTime}` : `Checked out at ${req.body.checkOutTime}`;
    }

    await visitor.save();
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
    await Admission.deleteOne({ _id: req.params.id });
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
 * Get today's gate passes (simplified for front desk)
 */
router.get('/gate-passes/today', authenticate, async (req, res) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const gatePasses = await Admission.find({
      date: { $gte: startOfDay.toISOString().split('T')[0], $lte: endOfDay.toISOString().split('T')[0] }
    }).sort({ createdAt: -1 });

    // Format as gate passes
    const formatted = gatePasses.map(gp => ({
      _id: gp._id,
      personType: 'student',
      personId: gp._id,
      personName: gp.studentName,
      leavingWith: gp.parentName || 'N/A',
      permittedBy: gp.assignedTeacher?.name || 'N/A',
      outTime: gp.testTime || new Date().toTimeString().slice(0, 5),
      date: gp.dateOfInquiry
    }));

    res.json(formatted);
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
 * POST /api/front-desk/gate-passes
 * Create new gate pass (simplified - uses Admission model)
 */
router.post('/gate-passes', authenticate, async (req, res) => {
  try {
    const gatePassData = {
      ...req.body,
      status: 'test-scheduled'
    };

    const gatePass = await Admission.create(gatePassData);
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
 * DELETE /api/front-desk/gate-passes/:id
 * Delete gate pass
 */
router.delete('/gate-passes/:id', authenticate, async (req, res) => {
  try {
    await Admission.deleteOne({ _id: req.params.id });
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

    const appointments = await Appointment.find(query)
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
    const appointment = await Appointment.create(req.body);
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
    const appointment = await Appointment.findById(req.params.id);

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
    await Appointment.deleteOne({ _id: req.params.id });
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
