import express from 'express';
import { Admission, Appointment, Feedback, CallLog, Staff, Student } from '../database.js';
// NOTE: Visitor and GatePass models are NOT imported here.
// Visitor CRUD is handled by routes/visitors.js (mounted at /api/visitors).
// Gate Pass CRUD is handled by routes/gatePasses.js (mounted at /api/gate-passes).
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import { validateStageTransition, updateAdmissionSchema } from '../validators/admissionSchema.js';

function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) throw new Error('schoolId is required for scoped queries');
  return { ...query, schoolId: normalizedSchoolId };
}

async function resolveRequestSchoolId(req) {
  const schoolId = req.user?.schoolId ? extractSchoolId(req.user.schoolId) : null;
  if (!schoolId) throw new Error(req.t('common:errors.unauthorized'));
  return schoolId;
}

const router = express.Router();
router.use(authenticate);

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
router.get('/admissions', authenticate, checkPermission('front-desk', 'view'), async (req, res) => {
  try {
    const { status, source } = req.query;
    const schoolId = await resolveRequestSchoolId(req);
    const query = { schoolId };

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
      message: 'Failed to fetch admissions',
    });
  }
});

/**
 * POST /api/front-desk/admissions
 * Create new admission inquiry
 */
router.post(
  '/admissions',
  authenticate,
  checkPermission('front-desk', 'create'),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);
      const {
        studentName,
        dateOfBirth,
        parentName,
        phoneNumber,
        email,
        classApplyingFor,
        hscGroup,
        assessmentRequired,
        assignedTeacher,
        testDate,
        testTime,
        source,
        documents,
      } = req.body;

      const admissionData = {
        studentName,
        dateOfBirth,
        parentName,
        phoneNumber,
        email,
        classApplyingFor,
        hscGroup,
        assessmentRequired,
        assignedTeacher: assignedTeacher || undefined,
        testDate,
        testTime,
        source,
        documents,
        schoolId,
        dateOfInquiry: new Date().toISOString().split('T')[0],
      };

      const admission = await Admission.create(admissionData);

      // Populate for response
      await admission.populate('assignedTeacher', 'name');

      res.status(201).json(admission);
    } catch (error) {
      console.error('❌ Create admission error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: 'Failed to create admission inquiry',
      });
    }
  }
);

/**
 * PUT /api/front-desk/admissions/:id
 * Update admission inquiry
 */
router.put(
  '/admissions/:id',
  authenticate,
  checkPermission('front-desk', 'edit'),
  async (req, res) => {
    try {
      // Validate request body shape
      const parsed = updateAdmissionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: parsed.error.issues.map((i) => ({
            field: i.path.join('.'),
            message: i.message,
          })),
        });
      }

      const schoolId = await resolveRequestSchoolId(req);
      const admission = await Admission.findOne(scopeBySchool(schoolId, { _id: req.params.id }));

      if (!admission) {
        return res.status(404).json({
          success: false,
          error: 'Admission not found',
        });
      }

      // Stage prerequisite validation — must happen before mutating the document
      if (parsed.data.status) {
        const transitionError = validateStageTransition(admission, parsed.data.status);
        if (transitionError) {
          return res.status(400).json({
            success: false,
            error: transitionError,
          });
        }
      }

      // Update allowed fields
      const allowedFields = [
        'studentName',
        'dateOfBirth',
        'parentName',
        'phoneNumber',
        'email',
        'classApplyingFor',
        'hscGroup',
        'assessmentRequired',
        'assignedTeacher',
        'testDate',
        'testTime',
        'testResult',
        'source',
        'status',
        'admissionDecision',
        'decisionRemarks',
        'paymentStatus',
        'paymentMode',
        'paymentAmount',
        'paymentDate',
        'transactionId',
        'documents',
      ];

      allowedFields.forEach((field) => {
        if (parsed.data[field] !== undefined) {
          admission[field] = parsed.data[field];
        }
      });

      // If status changed to admission-approved or admission-rejected, update decision metadata
      if (parsed.data.status && parsed.data.status.startsWith('admission-')) {
        admission.decisionBy = req.user.id;
        if (parsed.data.status === 'admission-approved') {
          admission.admissionDecision = 'approved';
        } else if (parsed.data.status === 'admission-rejected') {
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
        message: 'Failed to update admission',
      });
    }
  }
);

/**
 * DELETE /api/front-desk/admissions/:id
 * Delete admission inquiry
 */
router.delete(
  '/admissions/:id',
  authenticate,
  checkPermission('front-desk', 'delete'),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);
      await Admission.deleteOne(scopeBySchool(schoolId, { _id: req.params.id }));
      res.json({ success: true, message: 'Admission deleted successfully' });
    } catch (error) {
      console.error('❌ Delete admission error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: 'Failed to delete admission',
      });
    }
  }
);

/**
 * POST /api/front-desk/admissions/:id/convert-to-student
 * Convert admission inquiry to student record
 */
router.post(
  '/admissions/:id/convert-to-student',
  authenticate,
  checkPermission('front-desk', 'create'),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);
      const admission = await Admission.findOne(scopeBySchool(schoolId, { _id: req.params.id }));

      if (!admission) {
        return res.status(404).json({
          success: false,
          error: 'Admission not found',
        });
      }

      // Only allow conversion when fee has been paid
      if (admission.status !== 'fee-paid') {
        return res.status(400).json({
          success: false,
          error: 'Admission fee must be paid before converting to student',
        });
      }

      // Check if student already exists
      const existingStudent = await Student.findOne({
        schoolId,
        admissionId: admission._id,
        isDeleted: { $ne: true },
      });
      if (existingStudent) {
        return res.status(400).json({
          success: false,
          error: 'Student record already exists for this admission',
        });
      }

      // Generate admission number for student
      const year = new Date().getFullYear();
      const classCount = await Student.countDocuments({
        schoolId,
        classId: admission.classApplyingFor,
      });
      const admissionNumber = `${year}-${admission.classApplyingFor}-${String(classCount + 1).padStart(4, '0')}`;

      // Create student from admission
      const studentData = {
        schoolId,
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
        admissionInquiryId: admission._id,
      };

      const student = await Student.create(studentData);

      // Update admission status
      admission.status = 'student-admitted';
      await admission.save();

      res.status(201).json({
        success: true,
        message: 'Student created successfully',
        student,
        admissionNumber,
      });
    } catch (error) {
      console.error('❌ Convert admission to student error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: 'Failed to convert admission to student',
      });
    }
  }
);

/**
 * GET /api/front-desk/admissions/:id/tracker
 * Get admission tracker timeline
 */
router.get(
  '/admissions/:id/tracker',
  authenticate,
  checkPermission('front-desk', 'view'),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);
      const admission = await Admission.findOne(scopeBySchool(schoolId, { _id: req.params.id }))
        .populate('assignedTeacher', 'name')
        .populate('decisionBy', 'name');

      if (!admission) {
        return res.status(404).json({
          success: false,
          error: 'Admission not found',
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
        'student-admitted',
      ];

      const currentIndex = statusOptions.indexOf(admission.status);

      statusOptions.forEach((status, index) => {
        const isCompleted = index <= currentIndex;
        const isCurrent = index === currentIndex;

        let label = status.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
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
          assignedTo: admission.assignedTeacher?.name || null,
        });
      });

      res.json({
        admission,
        timeline,
        currentStage: admission.status,
        progress: ((currentIndex + 1) / statusOptions.length) * 100,
      });
    } catch (error) {
      console.error('❌ Get admission tracker error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: 'Failed to get admission tracker',
      });
    }
  }
);

// ============= VISITORS ROUTES =============
// REMOVED: Duplicate visitor CRUD routes previously here.
// All visitor operations are now handled by the dedicated routes in visitors.js
// mounted at /api/visitors (with proper Zod validation and consistent response shapes).
// The frontend frontDeskApi methods delegate to /api/visitors endpoints.

// REMOVED: Duplicate gate pass CRUD routes previously here.
// All gate pass operations are now handled by the dedicated routes in gatePasses.js
// mounted at /api/gate-passes (with proper Zod validation, status transition guards,
// and dedicated approve/reject/mark-used/cancel endpoints).
// The frontend frontDeskApi methods delegate to /api/gate-passes endpoints.

// ============= APPOINTMENTS ROUTES =============

/**
 * GET /api/front-desk/appointments
 * Get all appointments with optional filters
 */
router.get(
  '/appointments',
  authenticate,
  checkPermission('front-desk', 'view'),
  async (req, res) => {
    try {
      const { status } = req.query;
      const query = {};

      if (status) query.status = status;

      const schoolId = await resolveRequestSchoolId(req);
      const appointments = await Appointment.find(scopeBySchool(schoolId, query)).sort({
        fromDateTime: 1,
      });

      res.json(appointments);
    } catch (error) {
      console.error('❌ Get appointments error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: 'Failed to fetch appointments',
      });
    }
  }
);

/**
 * POST /api/front-desk/appointments
 * Create new appointment
 */
router.post(
  '/appointments',
  authenticate,
  checkPermission('front-desk', 'create'),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);
      const {
        visitorName,
        phoneNumber,
        purpose,
        fromDateTime,
        toDateTime,
        meetingWith,
        notes,
        status,
      } = req.body;
      const appointment = await Appointment.create({
        visitorName,
        phoneNumber,
        purpose,
        fromDateTime,
        toDateTime,
        meetingWith,
        notes,
        status,
        schoolId,
      });
      res.status(201).json(appointment);
    } catch (error) {
      console.error('❌ Create appointment error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: 'Failed to create appointment',
      });
    }
  }
);

/**
 * PUT /api/front-desk/appointments/:id
 * Update appointment
 */
router.put(
  '/appointments/:id',
  authenticate,
  checkPermission('front-desk', 'edit'),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);
      const appointment = await Appointment.findOne(
        scopeBySchool(schoolId, { _id: req.params.id })
      );

      if (!appointment) {
        return res.status(404).json({
          success: false,
          error: 'Appointment not found',
        });
      }

      // Update allowed fields
      const allowedFields = [
        'visitorName',
        'phoneNumber',
        'purpose',
        'fromDateTime',
        'toDateTime',
        'meetingWith',
        'notes',
        'status',
      ];

      allowedFields.forEach((field) => {
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
        message: 'Failed to update appointment',
      });
    }
  }
);

/**
 * DELETE /api/front-desk/appointments/:id
 * Delete appointment
 */
router.delete(
  '/appointments/:id',
  authenticate,
  checkPermission('front-desk', 'delete'),
  async (req, res) => {
    try {
      const schoolId = await resolveRequestSchoolId(req);
      await Appointment.deleteOne(scopeBySchool(schoolId, { _id: req.params.id }));
      res.json({ success: true, message: 'Appointment deleted successfully' });
    } catch (error) {
      console.error('❌ Delete appointment error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: 'Failed to delete appointment',
      });
    }
  }
);

// ============= FEEDBACKS ROUTES =============

/**
 * GET /api/front-desk/feedbacks
 * Get all feedbacks with optional filters
 */
router.get('/feedbacks', authenticate, checkPermission('front-desk', 'view'), async (req, res) => {
  try {
    const { status } = req.query;
    const query = { schoolId: req.user.schoolId };

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
      message: 'Failed to fetch feedbacks',
    });
  }
});

/**
 * POST /api/front-desk/feedbacks
 * Create new feedback
 */
router.post(
  '/feedbacks',
  authenticate,
  checkPermission('front-desk', 'create'),
  async (req, res) => {
    try {
      const { name, phoneNumber, category, assignedStaff, notifyStaff, status, notes } = req.body;
      const feedbackData = {
        name,
        phoneNumber,
        category,
        assignedStaff,
        notifyStaff,
        status,
        notes,
        schoolId: req.user.schoolId,
        date: new Date().toISOString().split('T')[0],
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
        message: 'Failed to create feedback',
      });
    }
  }
);

/**
 * PUT /api/front-desk/feedbacks/:id
 * Update feedback
 */
router.put(
  '/feedbacks/:id',
  authenticate,
  checkPermission('front-desk', 'edit'),
  async (req, res) => {
    try {
      const schoolId = req.user?.schoolId ? extractSchoolId(req.user.schoolId) : null;
      const feedback = await Feedback.findOne(scopeBySchool(schoolId, { _id: req.params.id }));

      if (!feedback) {
        return res.status(404).json({
          success: false,
          error: 'Feedback not found',
        });
      }

      // Update allowed fields
      const allowedFields = [
        'name',
        'phoneNumber',
        'category',
        'assignedStaff',
        'notifyStaff',
        'status',
        'notes',
      ];

      allowedFields.forEach((field) => {
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
        message: 'Failed to update feedback',
      });
    }
  }
);

/**
 * DELETE /api/front-desk/feedbacks/:id
 * Delete feedback
 */
router.delete(
  '/feedbacks/:id',
  authenticate,
  checkPermission('front-desk', 'delete'),
  async (req, res) => {
    try {
      const schoolId = req.user?.schoolId ? extractSchoolId(req.user.schoolId) : null;
      await Feedback.deleteOne(scopeBySchool(schoolId, { _id: req.params.id }));
      res.json({ success: true, message: 'Feedback deleted successfully' });
    } catch (error) {
      console.error('❌ Delete feedback error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: 'Failed to delete feedback',
      });
    }
  }
);

// ============= CALL LOGS ROUTES =============

/**
 * GET /api/front-desk/call-logs
 * Get all call logs
 */
router.get('/call-logs', authenticate, checkPermission('front-desk', 'view'), async (req, res) => {
  try {
    const schoolId = req.user?.schoolId ? extractSchoolId(req.user.schoolId) : null;
    const callLogs = await CallLog.find(scopeBySchool(schoolId)).sort({ dateTime: -1 });

    res.json(callLogs);
  } catch (error) {
    console.error('❌ Get call logs error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch call logs',
    });
  }
});

/**
 * POST /api/front-desk/call-logs
 * Create new call log
 */
router.post(
  '/call-logs',
  authenticate,
  checkPermission('front-desk', 'create'),
  async (req, res) => {
    try {
      const schoolId = req.user?.schoolId ? extractSchoolId(req.user.schoolId) : null;
      const { callerName, phoneNumber, dateTime, purpose, intent, keyNotes, summary, title } =
        req.body;
      const callLogData = {
        callerName,
        phoneNumber,
        dateTime,
        purpose,
        intent,
        keyNotes,
        summary,
        title,
        schoolId,
        loggedBy: req.user.id,
      };

      const callLog = await CallLog.create(callLogData);
      res.status(201).json(callLog);
    } catch (error) {
      console.error('❌ Create call log error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: 'Failed to create call log',
      });
    }
  }
);

/**
 * PUT /api/front-desk/call-logs/:id
 * Update call log
 */
router.put(
  '/call-logs/:id',
  authenticate,
  checkPermission('front-desk', 'edit'),
  async (req, res) => {
    try {
      const schoolId = req.user?.schoolId ? extractSchoolId(req.user.schoolId) : null;
      const callLog = await CallLog.findOne(scopeBySchool(schoolId, { _id: req.params.id }));

      if (!callLog) {
        return res.status(404).json({
          success: false,
          error: 'Call log not found',
        });
      }

      // Update allowed fields
      const allowedFields = [
        'callerName',
        'phoneNumber',
        'dateTime',
        'purpose',
        'intent',
        'keyNotes',
        'summary',
        'title',
      ];

      allowedFields.forEach((field) => {
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
        message: 'Failed to update call log',
      });
    }
  }
);

/**
 * DELETE /api/front-desk/call-logs/:id
 * Delete call log
 */
router.delete(
  '/call-logs/:id',
  authenticate,
  checkPermission('front-desk', 'delete'),
  async (req, res) => {
    try {
      const schoolId = req.user?.schoolId ? extractSchoolId(req.user.schoolId) : null;
      await CallLog.deleteOne(scopeBySchool(schoolId, { _id: req.params.id }));
      res.json({ success: true, message: 'Call log deleted successfully' });
    } catch (error) {
      console.error('❌ Delete call log error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: 'Failed to delete call log',
      });
    }
  }
);

export default router;
