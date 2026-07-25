import express from 'express';
import mongoose from 'mongoose';
import { Admission, Appointment, Feedback, CallLog, Staff, Student } from '../database.js';
// NOTE: Visitor and GatePass models are NOT imported here.
// Visitor CRUD is handled by routes/visitors.js (mounted at /api/visitors).
// Gate Pass CRUD is handled by routes/gatePasses.js (mounted at /api/gate-passes).
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import {
  validateStageTransition,
  createAdmissionSchema,
  updateAdmissionSchema,
} from '../validators/admissionSchema.js';
import { logToTrash } from '../services/trashService.js';

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

// Coarse admission stages → their constituent fine-grained statuses. Mirrors
// STAGE_OPTIONS in the dashboard's admissionsConstants.js so a `?stage=` filter
// resolves to the same buckets the UI shows.
const STAGE_STATUSES = {
  inquiry: ['inquiry-logged', 'form-sent'],
  visited: ['form-submitted', 'documents-verified'],
  applied: ['test-scheduled', 'test-cleared', 'test-failed', 'test-no-show'],
  admitted: ['admission-approved', 'fee-paid', 'student-admitted'],
  rejected: ['admission-rejected'],
};

// Escape user-supplied search text before it goes into a RegExp so special
// characters are matched literally (and can't form a pathological pattern).
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
 * List admissions for the school, newest first.
 *
 * Query params:
 *   - status  exact admission status
 *   - stage   coarse stage key (inquiry|visited|applied|admitted|rejected);
 *             ignored when `status` is also supplied
 *   - source  enquiry source (walk-in|call|website|reference)
 *   - search  case-insensitive match on name / parent / phone / class
 *   - page    1-based page number (default 1)
 *   - limit   page size (default 50, max 100, 0 = no cap / return every match)
 *
 * Response shape depends on whether pagination was requested:
 *   - No `page`/`limit` param → legacy bare array of every match (kept so the
 *     front-desk dashboard summary and other unpaginated callers are unaffected).
 *   - `page` or `limit` present → { data, pagination, statusCounts } envelope,
 *     mirroring the canonical students list contract. `statusCounts` is the
 *     per-status breakdown across the whole school (ignoring search/stage/page)
 *     so the UI's stage filter strip stays an accurate pipeline navigator.
 */
router.get('/admissions', checkPermission('front-desk', 'view'), async (req, res) => {
  try {
    const { status, source, search, stage, page, limit } = req.query;
    const schoolId = await resolveRequestSchoolId(req);

    // Build the filter. Coerce values to String so a crafted query such as
    // `?status[$ne]=` can't smuggle an operator object into the filter.
    const query = { schoolId };
    if (status) {
      query.status = String(status);
    } else if (stage && STAGE_STATUSES[String(stage)]) {
      query.status = { $in: STAGE_STATUSES[String(stage)] };
    }
    if (source) query.source = String(source);
    if (search && String(search).trim()) {
      const rx = new RegExp(escapeRegex(String(search).trim()), 'i');
      query.$or = [
        { studentName: rx },
        { parentName: rx },
        { phoneNumber: rx },
        { classApplyingFor: rx },
      ];
    }

    // Backward compatibility: callers that don't ask for pagination still get
    // the full array they always received.
    const wantsPagination = page !== undefined || limit !== undefined;
    if (!wantsPagination) {
      const admissions = await Admission.find(query)
        .sort({ createdAt: -1 })
        .populate('assignedTeacher', 'name')
        .populate('decisionBy', 'name');
      return res.json(admissions);
    }

    const rawLimit = parseInt(limit, 10);
    const noLimit = rawLimit === 0; // limit=0 → return every match (board view)
    const pageNum = noLimit ? 1 : Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = noLimit ? 0 : Math.min(Math.max(rawLimit || 50, 1), 100);
    const skip = noLimit ? 0 : (pageNum - 1) * limitNum;

    let listQuery = Admission.find(query)
      .sort({ createdAt: -1 })
      .populate('assignedTeacher', 'name')
      .populate('decisionBy', 'name');
    if (!noLimit) listQuery = listQuery.skip(skip).limit(limitNum);

    const [data, totalItems, statusAgg] = await Promise.all([
      listQuery,
      Admission.countDocuments(query),
      Admission.aggregate([
        { $match: { schoolId: new mongoose.Types.ObjectId(schoolId) } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    const statusCounts = statusAgg.reduce(
      (acc, { _id, count }) => {
        if (_id) acc[_id] = count;
        acc.all += count;
        return acc;
      },
      { all: 0 }
    );

    const totalPages = noLimit ? 1 : Math.max(Math.ceil(totalItems / limitNum), 1);

    res.json({
      data,
      statusCounts,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalItems,
        itemsPerPage: noLimit ? totalItems : limitNum,
        hasNextPage: noLimit ? false : pageNum < totalPages,
        hasPrevPage: noLimit ? false : pageNum > 1,
      },
    });
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
router.post('/admissions', checkPermission('front-desk', 'create'), async (req, res) => {
  try {
    const schoolId = await resolveRequestSchoolId(req);

    // Validate the request body with Zod. Previously the create handler
    // destructured req.body directly, so any shape (wrong types, missing
    // required studentName/classApplyingFor, junk fields) flowed straight into
    // Admission.create and either crashed opaquely or stored garbage.
    const parsed = createAdmissionSchema.safeParse(req.body);
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

    const admissionData = {
      ...parsed.data,
      schoolId,
      dateOfInquiry: new Date().toISOString().split('T')[0],
    };

    // assignedTeacher must belong to the caller's school. Without this scope
    // check a front-desk user could attach any Staff id from another tenant to
    // an admission, leaking that staff member's name into this school's record.
    if (admissionData.assignedTeacher) {
      const teacher = await Staff.findOne({
        _id: admissionData.assignedTeacher,
        schoolId,
      }).select('_id');
      if (!teacher) {
        return res.status(400).json({
          success: false,
          error: 'Assigned teacher was not found in this school',
        });
      }
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
      message: 'Failed to create admission inquiry',
    });
  }
});

/**
 * PUT /api/front-desk/admissions/:id
 * Update admission inquiry
 */
router.put('/admissions/:id', checkPermission('front-desk', 'edit'), async (req, res) => {
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

    // assignedTeacher (if being changed) must belong to this school — same
    // cross-tenant guard as the create handler.
    if (parsed.data.assignedTeacher) {
      const teacher = await Staff.findOne({
        _id: parsed.data.assignedTeacher,
        schoolId,
      }).select('_id');
      if (!teacher) {
        return res.status(400).json({
          success: false,
          error: 'Assigned teacher was not found in this school',
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
});

/**
 * DELETE /api/front-desk/admissions/:id
 * Delete admission inquiry
 */
router.delete('/admissions/:id', checkPermission('front-desk', 'delete'), async (req, res) => {
  try {
    const schoolId = await resolveRequestSchoolId(req);

    // Snapshot before deletion for trash logging
    const admissionSnapshot = await Admission.findOne(
      scopeBySchool(schoolId, { _id: req.params.id })
    ).lean();

    await Admission.deleteOne(scopeBySchool(schoolId, { _id: req.params.id }));

    // Log to trash
    if (admissionSnapshot) {
      logToTrash({
        itemType: 'Admission',
        itemId: admissionSnapshot._id,
        itemName: admissionSnapshot.studentName || admissionSnapshot.name || 'Admission',
        originalData: admissionSnapshot,
        deletedBy: req.user?.id || req.user?._id,
        schoolId,
      }).catch(() => {});
    }

    res.json({ success: true, message: 'Admission deleted successfully' });
  } catch (error) {
    console.error('❌ Delete admission error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to delete admission',
    });
  }
});

/**
 * POST /api/front-desk/admissions/:id/convert-to-student
 * Convert admission inquiry to student record
 */
router.post(
  '/admissions/:id/convert-to-student',
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
        parents: [
          {
            name: admission.parentName,
            phone: admission.phoneNumber,
            email: admission.email,
            relationship: 'Parent',
          },
        ],
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
router.get('/admissions/:id/tracker', checkPermission('front-desk', 'view'), async (req, res) => {
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
});

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
router.get('/appointments', checkPermission('front-desk', 'view'), async (req, res) => {
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
});

/**
 * POST /api/front-desk/appointments
 * Create new appointment
 */
router.post('/appointments', checkPermission('front-desk', 'create'), async (req, res) => {
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
});

/**
 * PUT /api/front-desk/appointments/:id
 * Update appointment
 */
router.put('/appointments/:id', checkPermission('front-desk', 'edit'), async (req, res) => {
  try {
    const schoolId = await resolveRequestSchoolId(req);
    const appointment = await Appointment.findOne(scopeBySchool(schoolId, { _id: req.params.id }));

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
});

/**
 * DELETE /api/front-desk/appointments/:id
 * Delete appointment
 */
router.delete('/appointments/:id', checkPermission('front-desk', 'delete'), async (req, res) => {
  try {
    const schoolId = await resolveRequestSchoolId(req);

    // Snapshot before deletion for trash logging
    const appointmentSnapshot = await Appointment.findOne(
      scopeBySchool(schoolId, { _id: req.params.id })
    ).lean();

    await Appointment.deleteOne(scopeBySchool(schoolId, { _id: req.params.id }));

    // Log to trash
    if (appointmentSnapshot) {
      logToTrash({
        itemType: 'Appointment',
        itemId: appointmentSnapshot._id,
        itemName: appointmentSnapshot.visitorName || 'Appointment',
        originalData: appointmentSnapshot,
        deletedBy: req.user?.id || req.user?._id,
        schoolId,
      }).catch(() => {});
    }

    res.json({ success: true, message: 'Appointment deleted successfully' });
  } catch (error) {
    console.error('❌ Delete appointment error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to delete appointment',
    });
  }
});

// ============= FEEDBACKS ROUTES =============

/**
 * GET /api/front-desk/feedbacks
 * Get all feedbacks with optional filters
 */
router.get('/feedbacks', checkPermission('front-desk', 'view'), async (req, res) => {
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
router.post('/feedbacks', checkPermission('front-desk', 'create'), async (req, res) => {
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
});

/**
 * PUT /api/front-desk/feedbacks/:id
 * Update feedback
 */
router.put('/feedbacks/:id', checkPermission('front-desk', 'edit'), async (req, res) => {
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
});

/**
 * DELETE /api/front-desk/feedbacks/:id
 * Delete feedback
 */
router.delete('/feedbacks/:id', checkPermission('front-desk', 'delete'), async (req, res) => {
  try {
    const schoolId = req.user?.schoolId ? extractSchoolId(req.user.schoolId) : null;

    // Snapshot before deletion for trash logging
    const feedbackSnapshot = await Feedback.findOne(
      scopeBySchool(schoolId, { _id: req.params.id })
    ).lean();

    await Feedback.deleteOne(scopeBySchool(schoolId, { _id: req.params.id }));

    // Log to trash
    if (feedbackSnapshot) {
      logToTrash({
        itemType: 'Feedback',
        itemId: feedbackSnapshot._id,
        itemName: feedbackSnapshot.name || feedbackSnapshot.subject || 'Feedback',
        originalData: feedbackSnapshot,
        deletedBy: req.user?.id || req.user?._id,
        schoolId,
      }).catch(() => {});
    }

    res.json({ success: true, message: 'Feedback deleted successfully' });
  } catch (error) {
    console.error('❌ Delete feedback error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to delete feedback',
    });
  }
});

// ============= CALL LOGS ROUTES =============

/**
 * GET /api/front-desk/call-logs
 * Get all call logs
 */
router.get('/call-logs', checkPermission('front-desk', 'view'), async (req, res) => {
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
router.post('/call-logs', checkPermission('front-desk', 'create'), async (req, res) => {
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
});

/**
 * PUT /api/front-desk/call-logs/:id
 * Update call log
 */
router.put('/call-logs/:id', checkPermission('front-desk', 'edit'), async (req, res) => {
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
});

/**
 * DELETE /api/front-desk/call-logs/:id
 * Delete call log
 */
router.delete('/call-logs/:id', checkPermission('front-desk', 'delete'), async (req, res) => {
  try {
    const schoolId = req.user?.schoolId ? extractSchoolId(req.user.schoolId) : null;

    // Snapshot before deletion for trash logging
    const callLogSnapshot = await CallLog.findOne(
      scopeBySchool(schoolId, { _id: req.params.id })
    ).lean();

    await CallLog.deleteOne(scopeBySchool(schoolId, { _id: req.params.id }));

    // Log to trash
    if (callLogSnapshot) {
      logToTrash({
        itemType: 'CallLog',
        itemId: callLogSnapshot._id,
        itemName: callLogSnapshot.callerName || 'Call Log',
        originalData: callLogSnapshot,
        deletedBy: req.user?.id || req.user?._id,
        schoolId,
      }).catch(() => {});
    }

    res.json({ success: true, message: 'Call log deleted successfully' });
  } catch (error) {
    console.error('❌ Delete call log error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to delete call log',
    });
  }
});

export default router;
