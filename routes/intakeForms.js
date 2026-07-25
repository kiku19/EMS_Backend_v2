import express from 'express';
import {
  IntakeForm,
  FormAssignment,
  FormSubmission,
  Student,
  Staff,
  StudentFeeStructure,
  Class,
} from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/auth/permissions.js';
import { validateZod } from '../validators/zodHelpers.js';
import {
  createIntakeFormSchema,
  updateIntakeFormSchema,
  assignFormSchema,
  reviewSubmissionSchema,
  reviewEnhancedSchema,
  requestEditSchema,
} from '../validators/intakeFormSchema.js';
import {
  validateIndianPhone,
  validateInternationalPhone,
  mockThirdPartyValidation,
} from '../services/phoneValidation.js';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import { logToTrash } from '../services/trashService.js';
import {
  sendIntakeFormAssignedEmail,
  sendIntakeFormEditRequestEmail,
} from '../services/emailService.js';
import { EVENTS, emitEvent } from '../utils/socketEvents.js';
import crypto from 'crypto';
import mongoose from 'mongoose';

const router = express.Router();

// Public form endpoints have been consolidated into routes/public.js
// which has proper rate limiting, Zod validation, input sanitization, and data size limits.
// Frontend should use /api/v1/public/form-assignment/:token and /api/v1/public/form-submission/:token

router.use(authenticate);

// Helper function to generate unique access token
function generateAccessToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ============================================================
// INTAKE FORMS CRUD ENDPOINTS
// ============================================================

// GET /intake-forms - Get all intake forms with optional filters
router.get('/intake-forms', checkPermission('intake-forms', 'view'), async (req, res) => {
  try {
    const { type, status } = req.query;

    const query = { schoolId: req.user.schoolId };
    if (type) query.formType = type;
    if (status) query.status = status;

    const forms = await IntakeForm.find(query)
      .populate('createdBy', 'name code')
      .sort({ createdAt: -1 });

    res.json(forms);
  } catch (error) {
    console.error('❌ Error fetching intake forms:', error);
    res.status(500).json({
      error: 'Failed to fetch intake forms',
      message: error.message,
    });
  }
});

// GET /intake-forms/enrollment-funnel - Get admission-to-enrollment conversion funnel data
router.get(
  '/intake-forms/enrollment-funnel',
  checkPermission('intake-forms', 'view'),
  async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      if (!schoolId) {
        return res.status(400).json({ error: 'schoolId missing from auth context' });
      }

      const schoolObjId = new mongoose.Types.ObjectId(schoolId);

      // Total invitations (form links sent)
      const totalInvited = await FormAssignment.countDocuments({ schoolId });

      // Total submissions received
      const totalSubmitted = await FormSubmission.countDocuments({ schoolId });

      // Counts by review status
      const statusAgg = await FormSubmission.aggregate([
        { $match: { schoolId: schoolObjId } },
        { $group: { _id: '$reviewStatus', count: { $sum: 1 } } },
      ]);
      const statusMap = {};
      statusAgg.forEach((s) => {
        statusMap[s._id] = s.count;
      });

      const pending = statusMap['pending'] || 0;
      const approved = statusMap['approved'] || 0;
      const rejected = statusMap['rejected'] || 0;
      const needsRevision = statusMap['needs_revision'] || 0;

      // Converted to student/staff (entity record created)
      const totalEnrolled = await FormSubmission.countDocuments({
        schoolId,
        studentId: { $exists: true, $ne: null },
      });
      const totalStaffConverted = await FormSubmission.countDocuments({
        schoolId,
        staffId: { $exists: true, $ne: null },
      });

      // Conversion rates (safe division)
      const pct = (num, den) => (den > 0 ? parseFloat(((num / den) * 100).toFixed(1)) : 0);

      const funnel = {
        invited: totalInvited,
        submitted: totalSubmitted,
        pending,
        approved,
        rejected,
        needsRevision,
        enrolled: totalEnrolled,
        staffConverted: totalStaffConverted,
        rates: {
          submissionRate: pct(totalSubmitted, totalInvited),
          approvalRate: pct(approved, totalSubmitted),
          enrollmentRate: pct(totalEnrolled, approved),
          overallRate: pct(totalEnrolled, totalInvited),
        },
      };

      res.json({ success: true, data: funnel });
    } catch (error) {
      console.error('❌ Error fetching enrollment funnel:', error);
      res.status(500).json({ error: 'Failed to fetch enrollment funnel', message: error.message });
    }
  }
);

// GET /intake-forms/:id - Get a single intake form by ID
router.get('/intake-forms/:id', checkPermission('intake-forms', 'view'), async (req, res) => {
  try {
    const { id } = req.params;

    const form = await IntakeForm.findOne({ _id: id, schoolId: req.user.schoolId }).populate(
      'createdBy',
      'name code'
    );

    if (!form) {
      console.warn('⚠️ Intake form not found:', id);
      return res.status(404).json({
        error: 'Intake form not found',
        message: `No form found with ID: ${id}`,
      });
    }

    res.json(form);
  } catch (error) {
    console.error('❌ Error fetching intake form:', error);
    res.status(500).json({
      error: 'Failed to fetch intake form',
      message: error.message,
    });
  }
});

// POST /intake-forms - Create a new intake form
router.post(
  '/intake-forms',
  validateZod(createIntakeFormSchema),
  checkPermission('intake-forms', 'create'),
  async (req, res) => {
    try {
      const { formName, formType, fields, status } = req.body;

      // Create intake form
      const form = new IntakeForm({
        schoolId: req.user.schoolId,
        formName,
        formType,
        fields,
        status: status || 'active',
        createdBy: req.user.id,
      });

      await form.save();

      // Populate createdBy before returning
      await form.populate('createdBy', 'name code');

      res.status(201).json(form);
    } catch (error) {
      console.error('❌ Error creating intake form:', error);
      res.status(500).json({
        error: 'Failed to create intake form',
        message: error.message,
      });
    }
  }
);

// PUT /intake-forms/:id - Update an intake form
router.put(
  '/intake-forms/:id',
  validateZod(updateIntakeFormSchema),
  checkPermission('intake-forms', 'edit'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { formName, formType, fields, status } = req.body;

      // Find existing form
      const form = await IntakeForm.findOne({ _id: id, schoolId: req.user.schoolId });

      if (!form) {
        console.warn('Intake form not found:', id);
        return res.status(404).json({
          error: 'Intake form not found',
          message: `No form found with ID: ${id}`,
        });
      }

      // Update fields
      if (formName !== undefined) form.formName = formName;
      if (formType !== undefined) form.formType = formType;
      if (fields !== undefined) {
        form.fields = fields;
      }
      if (status !== undefined) form.status = status;

      await form.save();

      // Populate createdBy before returning
      await form.populate('createdBy', 'name code');

      res.json(form);
    } catch (error) {
      console.error('❌ Error updating intake form:', error);
      res.status(500).json({
        error: 'Failed to update intake form',
        message: error.message,
      });
    }
  }
);

// DELETE /intake-forms/:id - Delete an intake form
router.delete('/intake-forms/:id', checkPermission('intake-forms', 'delete'), async (req, res) => {
  try {
    const { id } = req.params;

    const form = await IntakeForm.findOneAndDelete({ _id: id, schoolId: req.user.schoolId });

    if (!form) {
      console.warn('⚠️ Intake form not found:', id);
      return res.status(404).json({
        error: 'Intake form not found',
        message: `No form found with ID: ${id}`,
      });
    }

    // Log to trash before cascade
    logToTrash({
      itemType: 'IntakeForm',
      itemId: form._id,
      itemName: form.formName || 'Intake Form',
      originalData: form.toObject(),
      deletedBy: req.user?.id || req.user?._id,
      schoolId: req.user?.schoolId,
    }).catch(() => {});

    // Cascade: soft-delete related assignments and submissions
    await FormAssignment.updateMany(
      { formId: id },
      { $set: { isDeleted: true, deletedAt: new Date() } }
    );
    await FormSubmission.updateMany(
      { formId: id },
      { $set: { isDeleted: true, deletedAt: new Date() } }
    );

    res.json({
      success: true,
      message: 'Intake form and related assignments/submissions deleted successfully',
      id,
    });
  } catch (error) {
    console.error('❌ Error deleting intake form:', error);
    res.status(500).json({
      error: 'Failed to delete intake form',
      message: error.message,
    });
  }
});

// POST /intake-forms/:id/duplicate - Duplicate an intake form
router.post(
  '/intake-forms/:id/duplicate',
  checkPermission('intake-forms', 'create'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { createdBy } = req.body;

      const originalForm = await IntakeForm.findOne({ _id: id, schoolId: req.user.schoolId });

      if (!originalForm) {
        console.warn('⚠️ Intake form not found:', id);
        return res.status(404).json({
          error: 'Intake form not found',
          message: `No form found with ID: ${id}`,
        });
      }

      // Create duplicate
      const duplicatedForm = new IntakeForm({
        schoolId: req.user.schoolId,
        formName: `${originalForm.formName} (Copy)`,
        formType: originalForm.formType,
        fields: originalForm.fields,
        status: 'active',
        createdBy: req.user.id,
      });

      await duplicatedForm.save();

      // Populate createdBy before returning
      await duplicatedForm.populate('createdBy', 'name code');

      res.status(201).json(duplicatedForm);
    } catch (error) {
      console.error('❌ Error duplicating intake form:', error);
      res.status(500).json({
        error: 'Failed to duplicate intake form',
        message: error.message,
      });
    }
  }
);

// ============================================================
// FORM ASSIGNMENT ENDPOINTS
// ============================================================

// POST /intake-forms/:id/assign - Assign form to email/phone
router.post(
  '/intake-forms/:id/assign',
  validateZod(assignFormSchema),
  checkPermission('intake-forms', 'create'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const {
        emails = [],
        phones = [],
        assignedToEmail,
        assignedToPhone,
        expiresInDays = 7,
      } = req.body;
      const enableThirdPartyValidation = req.query.validatePhone === 'true';

      // Validate form exists
      const form = await IntakeForm.findOne({ _id: id, schoolId: req.user.schoolId });
      if (!form) {
        console.warn('⚠️ Intake form not found:', id);
        return res.status(404).json({
          error: 'Intake form not found',
          message: `No form found with ID: ${id}`,
        });
      }

      // Support both array format (from frontend) and string format (backward compatibility)
      const recipientEmails = emails?.length ? emails : assignedToEmail ? [assignedToEmail] : [];
      const recipientPhones = phones?.length ? phones : assignedToPhone ? [assignedToPhone] : [];

      if (recipientEmails.length === 0 && recipientPhones.length === 0) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'At least one email or phone is required',
        });
      }

      // Validate phone numbers if provided
      if (recipientPhones.length > 0) {
        const validationErrors = [];

        for (const phone of recipientPhones) {
          // Format validation (Indian phone numbers)
          const formatValidation = validateIndianPhone(phone);

          if (!formatValidation.isValid) {
            validationErrors.push({
              phone: phone,
              error: formatValidation.error,
              stage: 'format_validation',
            });
            continue;
          }

          // Third-party validation (optional)
          if (enableThirdPartyValidation) {
            try {
              const thirdPartyValidation = await mockThirdPartyValidation(phone);

              if (!thirdPartyValidation.isValid) {
                validationErrors.push({
                  phone: phone,
                  error: thirdPartyValidation.error,
                  stage: 'third_party_validation',
                  provider: thirdPartyValidation.provider,
                });
              }
            } catch (error) {
              console.error(`❌ Third-party validation failed for phone ${phone}:`, error.message);
              validationErrors.push({
                phone: phone,
                error: 'Third-party validation service unavailable',
                stage: 'third_party_validation',
                details: error.message,
              });
            }
          }
        }

        // If any validation failed, return errors
        if (validationErrors.length > 0) {
          console.warn('⚠️ Phone validation failed for one or more numbers:', validationErrors);
          return res.status(400).json({
            error: 'Phone validation failed',
            message: 'One or more phone numbers failed validation',
            validationErrors: validationErrors,
          });
        }
      }

      // Calculate expiration date
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);

      // Create assignments for all recipients
      const assignments = [];
      const assignedById = req.user.id;

      for (const email of recipientEmails) {
        const accessToken = generateAccessToken();
        const assignment = new FormAssignment({
          schoolId: req.user.schoolId,
          formId: id,
          assignedToEmail: email,
          assignedBy: assignedById,
          status: 'pending',
          accessToken,
          expiresAt,
          assignedAt: new Date(),
        });
        await assignment.save();
        await assignment.populate('formId', 'formName formType');
        await assignment.populate('assignedBy', 'name code');
        assignments.push(assignment);
      }

      for (const phone of recipientPhones) {
        const accessToken = generateAccessToken();
        const assignment = new FormAssignment({
          schoolId: req.user.schoolId,
          formId: id,
          assignedToPhone: phone,
          assignedBy: assignedById,
          status: 'pending',
          accessToken,
          expiresAt,
          assignedAt: new Date(),
        });
        await assignment.save();
        await assignment.populate('formId', 'formName formType');
        await assignment.populate('assignedBy', 'name code');
        assignments.push(assignment);
      }

      // --- Notification: Send email to each assigned recipient (fire-and-forget) ---
      const schoolName = process.env.SCHOOL_NAME || 'School';
      for (const assignment of assignments) {
        const recipientEmail = assignment.assignedToEmail;
        if (recipientEmail) {
          sendIntakeFormAssignedEmail({
            recipientEmail,
            formName: form.formName,
            formType: form.formType,
            accessToken: assignment.accessToken,
            expiresAt: assignment.expiresAt,
            schoolName,
          }).catch((err) =>
            console.error(
              `[IntakeForm] Failed to send assignment email to ${recipientEmail}:`,
              err.message
            )
          );
        }

        // Emit socket event for real-time dashboard updates
        const io = req.app.get('io');
        emitEvent(io, EVENTS.INTAKE_FORM_ASSIGNED, {
          schoolId: req.user.schoolId,
          assignmentId: assignment._id.toString(),
          formName: form.formName,
          formType: form.formType,
          assignedToEmail: assignment.assignedToEmail || undefined,
          assignedToPhone: assignment.assignedToPhone || undefined,
        });
      }

      res.status(201).json({
        assignments,
        count: assignments.length,
        validation: {
          phonesValidated: recipientPhones.length,
          thirdPartyEnabled: enableThirdPartyValidation,
        },
      });
    } catch (error) {
      console.error('❌ Error creating form assignment:', error);
      res.status(500).json({
        error: 'Failed to create form assignment',
        message: error.message,
      });
    }
  }
);

// GET /form-assignments - Get all form assignments with optional filters
router.get('/form-assignments', checkPermission('intake-forms', 'view'), async (req, res) => {
  try {
    const { formId, status } = req.query;

    const query = { schoolId: req.user.schoolId };
    if (formId) query.formId = formId;
    if (status) query.status = status;

    const assignments = await FormAssignment.find(query)
      .populate('formId', 'formName formType')
      .populate('assignedBy', 'name code')
      .sort({ assignedAt: -1 });

    res.json(assignments);
  } catch (error) {
    console.error('❌ Error fetching form assignments:', error);
    res.status(500).json({
      error: 'Failed to fetch form assignments',
      message: error.message,
    });
  }
});

// GET /form-assignments/:id - Get a single form assignment by ID
router.get('/form-assignments/:id', checkPermission('intake-forms', 'view'), async (req, res) => {
  try {
    const { id } = req.params;

    const assignment = await FormAssignment.findOne({ _id: id, schoolId: req.user.schoolId })
      .populate('formId', 'formName formType fields')
      .populate('assignedBy', 'name code');

    if (!assignment) {
      console.warn('⚠️ Form assignment not found:', id);
      return res.status(404).json({
        error: 'Form assignment not found',
        message: `No assignment found with ID: ${id}`,
      });
    }

    res.json(assignment);
  } catch (error) {
    console.error('❌ Error fetching form assignment:', error);
    res.status(500).json({
      error: 'Failed to fetch form assignment',
      message: error.message,
    });
  }
});

// PUT /form-assignments/:id/resend - Resend form assignment
router.put(
  '/form-assignments/:id/resend',
  checkPermission('intake-forms', 'edit'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { expiresInDays = 7 } = req.body;

      const assignment = await FormAssignment.findOne({ _id: id, schoolId: req.user.schoolId });

      if (!assignment) {
        console.warn('⚠️ Form assignment not found:', id);
        return res.status(404).json({
          error: 'Form assignment not found',
          message: `No assignment found with ID: ${id}`,
        });
      }

      // Update expiration date and generate new token
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);

      assignment.accessToken = generateAccessToken();
      assignment.expiresAt = expiresAt;
      assignment.status = 'pending';

      await assignment.save();

      // Populate references
      await assignment.populate('formId', 'formName formType');
      await assignment.populate('assignedBy', 'name code');

      // --- Notification: Re-send email on resend (fire-and-forget) ---
      if (assignment.assignedToEmail) {
        const formDoc = await IntakeForm.findById(assignment.formId?._id || assignment.formId);
        sendIntakeFormAssignedEmail({
          recipientEmail: assignment.assignedToEmail,
          formName: formDoc?.formName || 'Intake Form',
          formType: formDoc?.formType || 'student',
          accessToken: assignment.accessToken,
          expiresAt: assignment.expiresAt,
          schoolName: process.env.SCHOOL_NAME,
        }).catch((err) => console.error(`[IntakeForm] Failed to send resend email:`, err.message));
      }

      res.json(assignment);
    } catch (error) {
      console.error('❌ Error resending form assignment:', error);
      res.status(500).json({
        error: 'Failed to resend form assignment',
        message: error.message,
      });
    }
  }
);

// DELETE /form-assignments/:id - Delete a form assignment
router.delete(
  '/form-assignments/:id',
  checkPermission('intake-forms', 'delete'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const assignment = await FormAssignment.findOneAndDelete({
        _id: id,
        schoolId: req.user.schoolId,
      });

      if (!assignment) {
        console.warn('⚠️ Form assignment not found:', id);
        return res.status(404).json({
          error: 'Form assignment not found',
          message: `No assignment found with ID: ${id}`,
        });
      }

      logToTrash({
        itemType: 'FormAssignment',
        itemId: assignment._id,
        itemName: assignment.assignedToEmail || assignment.assignedToPhone || 'Form Assignment',
        originalData: assignment.toObject(),
        deletedBy: req.user?.id || req.user?._id,
        schoolId: req.user?.schoolId,
      }).catch(() => {});

      res.json({
        success: true,
        message: 'Form assignment deleted successfully',
        id,
      });
    } catch (error) {
      console.error('❌ Error deleting form assignment:', error);
      res.status(500).json({
        error: 'Failed to delete form assignment',
        message: error.message,
      });
    }
  }
);

// ============================================================
// FORM SUBMISSION ENDPOINTS
// ============================================================

// GET /form-submissions - Get form submissions with optional filters.
// Pagination is opt-in (PAG-16): when `page` or `limit` is supplied the
// response is a paginated envelope `{ data, pagination }`; otherwise the full
// sorted list is returned as a bare array for backward compatibility with
// callers that aggregate over every submission (enrollment funnel,
// student-form counts).
router.get('/form-submissions', checkPermission('intake-forms', 'view'), async (req, res) => {
  try {
    const { formId, reviewStatus, page, limit } = req.query;

    const query = { schoolId: req.user.schoolId };
    if (formId) query.formId = formId;
    if (reviewStatus) query.reviewStatus = reviewStatus;

    const buildQuery = () =>
      FormSubmission.find(query)
        .populate('assignmentId', 'assignedToEmail assignedToPhone assignedBy')
        .populate('formId', 'formName formType')
        .populate('reviewedBy', 'name code')
        .sort({ submittedAt: -1 });

    const wantsPagination = page !== undefined || limit !== undefined;

    if (!wantsPagination) {
      const submissions = await buildQuery();
      return res.json(submissions);
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [submissions, total] = await Promise.all([
      buildQuery().skip(skip).limit(limitNum),
      FormSubmission.countDocuments(query),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limitNum));

    res.json({
      data: submissions,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalItems: total,
        itemsPerPage: limitNum,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
    });
  } catch (error) {
    console.error('❌ Error fetching form submissions:', error);
    res.status(500).json({
      error: 'Failed to fetch form submissions',
      message: error.message,
    });
  }
});

// GET /form-submissions/:id - Get a single form submission by ID
router.get('/form-submissions/:id', checkPermission('intake-forms', 'view'), async (req, res) => {
  try {
    const { id } = req.params;

    const submission = await FormSubmission.findOne({ _id: id, schoolId: req.user.schoolId })
      .populate('assignmentId', 'assignedToEmail assignedToPhone assignedBy')
      .populate('formId', 'formName formType fields')
      .populate('reviewedBy', 'name code');

    if (!submission) {
      console.warn('⚠️ Form submission not found:', id);
      return res.status(404).json({
        error: 'Form submission not found',
        message: `No submission found with ID: ${id}`,
      });
    }

    res.json(submission);
  } catch (error) {
    console.error('❌ Error fetching form submission:', error);
    res.status(500).json({
      error: 'Failed to fetch form submission',
      message: error.message,
    });
  }
});

// PUT /form-submissions/:id/review - Review a form submission
router.put(
  '/form-submissions/:id/review',
  validateZod(reviewSubmissionSchema),
  checkPermission('intake-forms', 'edit'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { reviewStatus, reviewNotes, staffId, studentId } = req.body;

      const submission = await FormSubmission.findOne({ _id: id, schoolId: req.user.schoolId });

      if (!submission) {
        console.warn('Form submission not found:', id);
        return res.status(404).json({
          error: 'Form submission not found',
          message: `No submission found with ID: ${id}`,
        });
      }

      // Update submission
      submission.reviewStatus = reviewStatus;
      submission.reviewNotes = reviewNotes;
      submission.reviewedBy = req.user.id;
      submission.reviewedAt = new Date();

      // Link to entity if approved
      if (reviewStatus === 'approved') {
        if (staffId) submission.staffId = staffId;
        if (studentId) submission.studentId = studentId;
      }

      // Handle edit request
      if (reviewStatus === 'needs_revision') {
        submission.editRequestNotes = reviewNotes;
        submission.editRequestedAt = new Date();
        submission.editRequestedBy = req.user.id;
        submission.resubmissionCount = (submission.resubmissionCount || 0) + 1;
      }

      await submission.save();

      // Update assignment status
      if (submission.assignmentId) {
        await FormAssignment.findByIdAndUpdate(submission.assignmentId, {
          status: reviewStatus === 'approved' ? 'approved' : 'submitted',
        });
      }

      // Populate references
      await submission.populate('assignmentId', 'assignedToEmail assignedToPhone assignedBy');
      await submission.populate('formId', 'formName formType');
      await submission.populate('reviewedBy', 'name code');

      res.json(submission);
    } catch (error) {
      console.error('❌ Error reviewing form submission:', error);
      res.status(500).json({
        error: 'Failed to review form submission',
        message: error.message,
      });
    }
  }
);

// DELETE /form-submissions/:id - Delete a form submission
router.delete(
  '/form-submissions/:id',
  checkPermission('intake-forms', 'delete'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const submission = await FormSubmission.findOneAndDelete({
        _id: id,
        schoolId: req.user.schoolId,
      });

      if (!submission) {
        console.warn('⚠️ Form submission not found:', id);
        return res.status(404).json({
          error: 'Form submission not found',
          message: `No submission found with ID: ${id}`,
        });
      }

      logToTrash({
        itemType: 'FormSubmission',
        itemId: submission._id,
        itemName: submission.submitterName || submission.submitterEmail || 'Form Submission',
        originalData: submission.toObject(),
        deletedBy: req.user?.id || req.user?._id,
        schoolId: req.user?.schoolId,
      }).catch(() => {});

      res.json({
        success: true,
        message: 'Form submission deleted successfully',
        id,
      });
    } catch (error) {
      console.error('❌ Error deleting form submission:', error);
      res.status(500).json({
        error: 'Failed to delete form submission',
        message: error.message,
      });
    }
  }
);

// PUT /api/form-submissions/:id/review - Enhanced review endpoint with auto entity creation
router.put(
  '/form-submissions/:id/review-enhanced',
  validateZod(reviewEnhancedSchema),
  checkPermission('intake-forms', 'edit'),
  async (req, res) => {
    try {
      const submission = await FormSubmission.findOne({
        _id: req.params.id,
        schoolId: req.user.schoolId,
      });

      if (!submission) {
        return res.status(404).json({
          success: false,
          error: 'Submission not found',
        });
      }

      const { decision, reviewNotes } = req.body;

      // Update submission review
      submission.reviewStatus = decision;
      submission.reviewNotes = reviewNotes;
      submission.reviewedBy = req.user.id;
      submission.reviewedAt = new Date();
      // If approved, create entity (Student or Staff)
      if (decision === 'approved') {
        const form = await IntakeForm.findById(submission.formId);

        if (!form) {
          return res.status(404).json({
            success: false,
            error: 'Associated form not found',
          });
        }

        // Create entity based on form type
        if (form.formType === 'student') {
          try {
            const student = await createStudentFromSubmission(
              submission.submissionData,
              form,
              req.user?.schoolId || null
            );
            submission.studentId = student._id;
            submission.convertedAt = new Date();
          } catch (studentError) {
            console.error('❌ Error creating student:', studentError);
            if (studentError.code === 'SCHOOL_ID_REQUIRED') {
              return res.status(400).json({
                success: false,
                error: 'School membership is required to convert a form submission',
                code: 'SCHOOL_ID_REQUIRED',
              });
            }
            return res.status(500).json({
              success: false,
              error: 'Failed to create student record',
              details: studentError.message,
            });
          }
        } else if (form.formType === 'staff') {
          try {
            const staff = await createStaffFromSubmission(
              submission.submissionData,
              form,
              req.user?.schoolId || null
            );
            submission.staffId = staff._id;
            submission.convertedAt = new Date();
          } catch (staffError) {
            console.error('❌ Error creating staff:', staffError);
            if (staffError.code === 'SCHOOL_ID_REQUIRED') {
              return res.status(400).json({
                success: false,
                error: 'School membership is required to convert a form submission',
                code: 'SCHOOL_ID_REQUIRED',
              });
            }
            return res.status(500).json({
              success: false,
              error: 'Failed to create staff record',
              details: staffError.message,
            });
          }
        }
      }

      await submission.save();

      // Populate for response
      await submission.populate('formId', 'formName formType');
      await submission.populate('reviewedBy', 'name code');
      await submission.populate('studentId', 'name admissionId');
      await submission.populate('staffId', 'name code');

      res.json({
        success: true,
        data: submission,
        message: `Submission ${decision} successfully`,
      });
    } catch (error) {
      console.error('❌ Review submission error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: 'Failed to review submission',
      });
    }
  }
);

// POST /api/form-submissions/:id/request-edit - Request edits from parent
router.post(
  '/form-submissions/:id/request-edit',
  validateZod(requestEditSchema),
  checkPermission('intake-forms', 'edit'),
  async (req, res) => {
    try {
      const submission = await FormSubmission.findOne({
        _id: req.params.id,
        schoolId: req.user.schoolId,
      });

      if (!submission) {
        return res.status(404).json({
          success: false,
          error: 'Submission not found',
        });
      }

      const { notes } = req.body;

      // Update submission to request edits
      submission.reviewStatus = 'needs_revision';
      submission.editRequestNotes = notes;
      submission.editRequestedAt = new Date();
      submission.editRequestedBy = req.user.id;
      submission.resubmissionCount = (submission.resubmissionCount || 0) + 1;

      await submission.save();

      // Get assignment to send notification
      const assignment = await FormAssignment.findById(submission.assignmentId);

      // Send email notification to parent about edit request
      if (assignment && assignment.assignedToEmail) {
        const formDoc = await IntakeForm.findById(submission.formId)
          .select('formName formType')
          .lean();
        sendIntakeFormEditRequestEmail({
          recipientEmail: assignment.assignedToEmail,
          formName: formDoc?.formName || 'Intake Form',
          editNotes: notes,
          accessToken: assignment.accessToken,
          schoolName: process.env.SCHOOL_NAME,
        }).catch((err) =>
          console.error(`[IntakeForm] Failed to send edit request email:`, err.message)
        );

        // Emit socket event for real-time updates
        const io = req.app.get('io');
        emitEvent(io, EVENTS.INTAKE_FORM_ASSIGNED, {
          schoolId: req.user.schoolId,
          assignmentId: assignment._id.toString(),
          formName: formDoc?.formName,
          formType: formDoc?.formType,
          assignedToEmail: assignment.assignedToEmail,
        });
      }

      // Populate for response
      await submission.populate('formId', 'formName formType');
      await submission.populate('editRequestedBy', 'name code');

      res.json({
        success: true,
        data: submission,
        message: 'Edit request sent successfully',
      });
    } catch (error) {
      console.error('❌ Request edit error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: 'Failed to request edits',
      });
    }
  }
);

// GET /api/form-submissions/student/:studentId - Get student's submissions
router.get(
  '/form-submissions/student/:studentId',
  checkPermission('intake-forms', 'view'),
  async (req, res) => {
    try {
      const { studentId } = req.params;

      const submissions = await FormSubmission.find({ studentId, schoolId: req.user.schoolId })
        .populate('formId', 'formName formType')
        .populate('assignmentId')
        .populate('reviewedBy', 'name code')
        .sort({ submittedAt: -1 });

      res.json({
        success: true,
        data: submissions,
        count: submissions.length,
      });
    } catch (error) {
      console.error('❌ Get student submissions error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: 'Failed to fetch student submissions',
      });
    }
  }
);

// GET /api/form-submissions/staff/:staffId - Get staff's submissions
router.get(
  '/form-submissions/staff/:staffId',
  checkPermission('intake-forms', 'view'),
  async (req, res) => {
    try {
      const { staffId } = req.params;

      const submissions = await FormSubmission.find({ staffId, schoolId: req.user.schoolId })
        .populate('formId', 'formName formType')
        .populate('assignmentId')
        .populate('reviewedBy', 'name code')
        .sort({ submittedAt: -1 });

      res.json({
        success: true,
        data: submissions,
        count: submissions.length,
      });
    } catch (error) {
      console.error('❌ Get staff submissions error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: 'Failed to fetch staff submissions',
      });
    }
  }
);

// PUT /api/form-assignments/:id/status - Update assignment status
router.put(
  '/form-assignments/:id/status',
  checkPermission('intake-forms', 'edit'),
  async (req, res) => {
    try {
      const assignment = await FormAssignment.findOne({
        _id: req.params.id,
        schoolId: req.user.schoolId,
      });

      if (!assignment) {
        return res.status(404).json({
          success: false,
          error: 'Assignment not found',
        });
      }

      const { status } = req.body;

      if (
        !status ||
        !['pending', 'in_progress', 'submitted', 'approved', 'rejected'].includes(status)
      ) {
        return res.status(400).json({
          success: false,
          error: 'Invalid status',
          message: 'Status must be one of: pending, in_progress, submitted, approved, rejected',
        });
      }

      assignment.status = status;
      await assignment.save();

      await assignment.populate('formId', 'formName formType');
      await assignment.populate('assignedBy', 'name code');

      res.json({
        success: true,
        data: assignment,
        message: 'Assignment status updated successfully',
      });
    } catch (error) {
      console.error('❌ Update assignment status error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: 'Failed to update assignment status',
      });
    }
  }
);

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Create Student record from submission data
 */
async function createStudentFromSubmission(submissionData, form, schoolId = null) {
  const { getNextAdmissionId, getNextRollNumber } = await import('../database.js');

  // schoolId MUST come from the authenticated caller (req.user.schoolId). The
  // old `schoolId || undefined` fallback silently created students with NO
  // tenant, which then leaked across every school-scoped query. Reject hard
  // instead of producing an orphan record.
  if (!schoolId) {
    const err = new Error('schoolId is required to convert a form submission to a student');
    err.code = 'SCHOOL_ID_REQUIRED';
    throw err;
  }

  // Build student data using form's field mapping if available.
  // Each field in form.fields can have a `mapTo` property indicating the Student schema field.
  // e.g., { label: "Student Name", key: "studentName", mapTo: "name", type: "text" }
  // This allows custom forms to map arbitrary field names to Student model fields.
  const studentData = { schoolId };

  // Use dynamic field mapping from the form if fields define mapTo targets
  const formFields = Array.isArray(form?.fields) ? form.fields : [];
  const hasMappings = formFields.some((f) => f.mapTo);

  if (hasMappings) {
    // Dynamic mapping: iterate form fields and map submission values to student fields
    for (const field of formFields) {
      if (!field.mapTo) continue;
      const fieldKey = field.key || field.name || field.label;
      if (!fieldKey) continue;
      const value = submissionData[fieldKey];
      if (value !== undefined && value !== null && value !== '') {
        studentData[field.mapTo] = value;
      }
    }
    // Ensure required defaults
    if (!studentData.status) studentData.status = 'active';
    if (!studentData.feeStatus) studentData.feeStatus = 'pending';
  } else {
    // Fallback: hardcoded field mapping for backward compatibility with forms
    // that don't define mapTo on their fields
    Object.assign(studentData, {
      name: submissionData.name || submissionData.studentName,
      classId: submissionData.classId,
      rollNo: submissionData.rollNo,

      // Personal Information
      gender: submissionData.gender,
      dateOfBirth: submissionData.dateOfBirth || submissionData.dob,
      bloodGroup: submissionData.bloodGroup,
      nationality: submissionData.nationality,
      religion: submissionData.religion,
      category: submissionData.category,
      motherTongue: submissionData.motherTongue,
      aadhaarNumber: submissionData.aadhaarNumber,

      // Contact Information
      phone: submissionData.phone || submissionData.studentPhone,
      email: submissionData.email || submissionData.studentEmail,
      whatsappNumber: submissionData.whatsappNumber,
      isWhatsapp: submissionData.isWhatsapp !== undefined ? submissionData.isWhatsapp : true,
      address: submissionData.address,
      city: submissionData.city,
      state: submissionData.state,
      zipCode: submissionData.zipCode || submissionData.pincode,

      // Parents/Guardians
      parents: submissionData.parents || [
        {
          name: submissionData.parentName || submissionData.fatherName,
          relationship: submissionData.parentRelationship || 'Father',
          phone: submissionData.parentPhone,
          email: submissionData.parentEmail,
          occupation: submissionData.parentOccupation,
          isWhatsapp: submissionData.isWhatsapp !== undefined ? submissionData.isWhatsapp : true,
        },
      ],

      // Siblings
      siblings: submissionData.siblings || [],

      // Academic Information
      previousSchool: submissionData.previousSchool,
      tcNumber: submissionData.tcNumber,

      // Health & Safety
      medicalConditions: submissionData.medicalConditions,
      emergencyContactName: submissionData.emergencyContactName,
      emergencyContactPhone: submissionData.emergencyContactPhone,

      // Requirements
      transportRequired: submissionData.transportRequired || false,
      hostelRequired: submissionData.hostelRequired || false,

      // Documents
      documents: submissionData.documents || [],
      photo: submissionData.photo,

      // Status
      status: 'active',
      feeStatus: 'pending',
    });
  }

  // Ensure admissionId is generated
  if (!studentData.admissionId) {
    studentData.admissionId = submissionData.admissionId || (await getNextAdmissionId(schoolId));
  }

  // Generate roll number if classId provided
  if (studentData.classId && !studentData.rollNo) {
    studentData.rollNo = await getNextRollNumber(studentData.classId, schoolId);
  }

  // Persist the student + its auto-initialized fee structure inside a single
  // transaction. Previously these were two independent writes: if the fee
  // structure save failed the student was left dangling with no fee record,
  // and if the student write failed the sequence-abuse of getNextAdmissionId
  // was already committed. With withTransaction either both commit or both
  // abort, so a converted submission never leaves a half-created student.
  const session = await mongoose.startSession();
  let student;
  try {
    await session.withTransaction(async () => {
      student = await Student.create([studentData], { session });
      student = student[0];

      // Auto-initialize fee structure for the new student
      try {
        // Check if fee structure already exists
        const existingFeeStructure = await StudentFeeStructure.findOne({
          studentId: student._id,
          academicYear: studentData.academicYear || CURRENT_ACADEMIC_YEAR,
          isDeleted: { $ne: true },
        }).session(session);

        if (!existingFeeStructure) {
          // Get class information
          const classInfo = await Class.findById(studentData.classId).session(session);
          if (classInfo) {
            // Extract class number from class name (e.g., "Class 10" -> "10")
            const classNumber = classInfo.name.replace('Class ', '');

            // Find FeeHead model to get applicable fee heads
            const FeeHead = mongoose.model('FeeHead');
            const applicableFeeHeads = await FeeHead.find({
              schoolId: student.schoolId,
              applicableClasses: classNumber,
              isActive: true,
            }).session(session);

            // Create fee structure — schoolId is set explicitly so the fee
            // record is queryable alongside the student and other tenant data.
            const feeStructure = new StudentFeeStructure({
              schoolId: student.schoolId,
              studentId: student._id,
              classId: studentData.classId,
              academicYear: studentData.academicYear || CURRENT_ACADEMIC_YEAR,
              feeHeads: applicableFeeHeads.map((fh) => ({
                feeHeadId: fh._id,
                name: fh.name,
                category: fh.category,
                amount: fh.amount,
                mandatory: fh.mandatory,
                frequency: fh.frequency,
                paidAmount: 0,
                balanceAmount: fh.amount,
                status: 'pending',
              })),
            });

            // Calculate totals
            feeStructure.totalFee = feeStructure.feeHeads.reduce((sum, fh) => sum + fh.amount, 0);
            feeStructure.totalPaid = 0;
            feeStructure.totalBalance = feeStructure.totalFee;
            feeStructure.overallStatus = 'pending';

            await feeStructure.save({ session });
          }
        }
      } catch (feeError) {
        // Log fee initialization error but, inside the transaction, re-throw so
        // the whole conversion aborts rather than committing a student with no
        // fee record (which silently broke fee collection for that student).
        console.error(
          '⚠️ Error auto-initializing fee structure for student from form submission:',
          feeError
        );
        throw feeError;
      }
    });
  } finally {
    session.endSession();
  }

  return student;
}

/**
 * Create Staff record from submission data
 */
async function createStaffFromSubmission(submissionData, form, schoolId = null) {
  // schoolId MUST come from the authenticated caller (req.user.schoolId).
  // The old `schoolId || ensureDefaultSchool()._id` fallback silently created
  // staff with NO tenant (or the wrong default tenant), which then leaked
  // across every school-scoped query — the same orphan/invisible-record bug
  // fixed for createStudentFromSubmission above. Reject hard instead of
  // producing an orphan record. See X9.
  if (!schoolId) {
    const err = new Error('schoolId is required to convert a form submission to a staff member');
    err.code = 'SCHOOL_ID_REQUIRED';
    throw err;
  }

  const { getNextStaffCode } = await import('../database.js');
  const staffCode = await getNextStaffCode();

  // Extract and map fields from submissionData
  const staffData = {
    schoolId,
    code: staffCode,
    name: submissionData.name,
    role: submissionData.role || submissionData.designation || 'Teacher',
    department: submissionData.department,
    status: 'active',

    // Personal Details
    phone: submissionData.phone,
    email: submissionData.email,
    dob: submissionData.dateOfBirth || submissionData.dob,
    gender: submissionData.gender,
    fatherName: submissionData.fatherName,
    bloodGroup: submissionData.bloodGroup,
    maritalStatus: submissionData.maritalStatus,
    employmentType: submissionData.employmentType,
    emergencyContact: submissionData.emergencyContact,
    emergencyPhone: submissionData.emergencyPhone,
    whatsappNumber: submissionData.whatsappNumber,
    isWhatsapp: submissionData.isWhatsapp !== undefined ? submissionData.isWhatsapp : false,

    // Address
    address: submissionData.address,

    // Documents
    picture: submissionData.photo,
    idDocuments: submissionData.idDocuments || [],

    // Qualifications
    professionalQualifications: submissionData.professionalQualifications || [],
    totalExperience: submissionData.totalExperience,
    previousOrganization: submissionData.previousOrganization,
    roleInOrganization: submissionData.roleInOrganization,
    qualificationDocs: submissionData.qualificationDocs || [],
    customDocuments: submissionData.customDocuments || [],

    // Bank & Salary
    accountNumber: submissionData.accountNumber,
    ifscCode: submissionData.ifscCode,
    bankName: submissionData.bankName,
    branchName: submissionData.branchName,
    salary: submissionData.salary || 0,
    salaryTemplate: submissionData.salaryTemplate,

    // Login credentials (generate temporary password)
    username: submissionData.username || submissionData.email,
    password: submissionData.password || crypto.randomBytes(12).toString('base64url'), // Auto-generated secure password; should be changed on first login
    joinDate: submissionData.joinDate || new Date().toISOString().split('T')[0],
  };

  // Run the create inside a transaction so the staff record and its
  // staff-code reservation commit atomically. Mirrors the student path
  // (createStudentFromSubmission) — without this, a failure mid-create left
  // a half-written staff doc.
  const session = await mongoose.startSession();
  let staff;
  try {
    await session.withTransaction(async () => {
      const created = await Staff.create([staffData], { session });
      staff = created[0];
    });
  } finally {
    session.endSession();
  }
  return staff;
}

export default router;
