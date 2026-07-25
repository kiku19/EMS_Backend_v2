import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { FormAssignment, FormSubmission, IntakeForm } from '../database.js';
import Staff from '../models/Staff.js';
import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';
import { optionalPhone, optionalEmail } from '../validators/zodHelpers.js';
import { sendNotification } from './notifications.js';
import { sendIntakeFormSubmittedEmail } from '../services/emailService.js';
import { EVENTS, emitEvent } from '../utils/socketEvents.js';

const router = express.Router();
const logger = createLogger('Public');

// Prevent token leakage via Referer headers
router.use((req, res, next) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Per-token rate limiter: max 10 submissions per hour per IP
const formSubmissionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `${req.ip}:${req.params.token || ''}`,
  message: { error: 'Too many submissions. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Helper function to validate access token
async function validateAccessToken(token) {
  if (!token) {
    return { valid: false, error: 'Access token is required' };
  }

  const assignment = await FormAssignment.findOne({ accessToken: token });

  if (!assignment) {
    return { valid: false, error: 'Invalid access token' };
  }

  // Check if token is expired
  if (assignment.expiresAt && new Date() > new Date(assignment.expiresAt)) {
    return { valid: false, error: 'Access token has expired' };
  }

  return { valid: true, assignment };
}

// GET /api/public/form-assignment/:token - Get form details by access token
router.get('/form-assignment/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Validate access token
    const validation = await validateAccessToken(token);

    if (!validation.valid) {
      return res.status(401).json({
        error: validation.error,
        code: 'INVALID_TOKEN',
      });
    }

    const assignment = validation.assignment;

    // Populate form details
    const populatedAssignment = await FormAssignment.findById(assignment._id)
      .populate('formId')
      .populate('assignedBy', 'name email');

    if (!populatedAssignment.formId) {
      return res.status(404).json({
        error: 'Associated form not found',
        code: 'FORM_NOT_FOUND',
      });
    }

    // Check if form is active
    if (populatedAssignment.formId.status !== 'active') {
      return res.status(403).json({
        error: 'Form is not currently active',
        code: 'FORM_INACTIVE',
      });
    }

    // Check if already submitted
    const existingSubmission = await FormSubmission.findOne({
      assignmentId: assignment._id,
    });

    // Return form details for rendering
    res.json({
      success: true,
      assignment: {
        id: populatedAssignment._id,
        status: populatedAssignment.status,
        assignedAt: populatedAssignment.assignedAt,
        expiresAt: populatedAssignment.expiresAt,
        assignedBy: populatedAssignment.assignedBy,
      },
      form: {
        id: populatedAssignment.formId._id,
        name: populatedAssignment.formId.formName,
        type: populatedAssignment.formId.formType,
        fields: populatedAssignment.formId.fields,
      },
      alreadySubmitted: !!existingSubmission,
      submission: existingSubmission
        ? {
            id: existingSubmission._id,
            submittedAt: existingSubmission.submittedAt,
            reviewStatus: existingSubmission.reviewStatus,
          }
        : null,
    });
  } catch (error) {
    logger.error({ err: error }, 'Error fetching form assignment');
    res.status(500).json({
      error: 'Failed to fetch form details',
      details: error.message,
    });
  }
});

// Zod schema for public form submission
const formSubmissionBodySchema = z.object({
  submissionData: z.record(z.string(), z.unknown()),
  submittedByEmail: optionalEmail,
  submittedByPhone: optionalPhone,
});

// POST /api/public/form-submission/:token - Submit form data
router.post('/form-submission/:token', formSubmissionLimiter, async (req, res) => {
  try {
    const { token } = req.params;

    // Validate request body with Zod
    const parseResult = formSubmissionBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      const errors = parseResult.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
      return res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: errors,
      });
    }

    const { submissionData, submittedByEmail, submittedByPhone } = parseResult.data;

    // Validate access token
    const validation = await validateAccessToken(token);

    if (!validation.valid) {
      return res.status(401).json({
        error: validation.error,
        code: 'INVALID_TOKEN',
      });
    }

    const assignment = validation.assignment;

    // Check if already submitted
    const existingSubmission = await FormSubmission.findOne({
      assignmentId: assignment._id,
    });

    if (existingSubmission) {
      return res.status(400).json({
        error: 'Form has already been submitted',
        code: 'ALREADY_SUBMITTED',
        submissionId: existingSubmission._id,
      });
    }

    // Validate submission data is provided and is a plain object
    if (!submissionData || typeof submissionData !== 'object' || Array.isArray(submissionData)) {
      return res.status(400).json({
        error: 'Submission data is required and must be an object',
        code: 'INVALID_DATA',
      });
    }

    // Enforce a reasonable size limit on submissionData to prevent oversized documents
    const submissionDataStr = JSON.stringify(submissionData);
    if (submissionDataStr.length > 512 * 1024) {
      // 512 KB
      return res.status(400).json({
        error: 'Submission data is too large',
        code: 'DATA_TOO_LARGE',
      });
    }

    // Populate form to get form details and validate fields against schema
    const populatedAssignment = await FormAssignment.findById(assignment._id).populate('formId');

    if (!populatedAssignment.formId) {
      return res.status(404).json({
        error: 'Associated form not found',
        code: 'FORM_NOT_FOUND',
      });
    }

    // Validate submissionData keys against form field definitions
    const formFields = populatedAssignment.formId.fields || [];
    // Require every declared field to carry a stable `name` (the key the
    // client must submit under). A field with no name has no addressable slot,
    // so its data is unbindable — previously the fallback `f.name || f.id ||
    // f.key` silently produced an empty allowedKeys set for such fields, which
    // made the whole unknown-key check a no-op. Reject the form definition up
    // front instead of accepting an ambiguous submission.
    const namelessField = formFields.find((f) => !f.name);
    if (formFields.length > 0 && namelessField) {
      return res.status(400).json({
        error: 'Form configuration error: every field must define a name.',
        code: 'FIELD_MISSING_NAME',
      });
    }

    // Build an allowlist keyed STRICTLY on field.name (the canonical address),
    // plus each field's declared type so we can coerce/validate below.
    const fieldByName = new Map();
    for (const f of formFields) {
      if (f.name) fieldByName.set(f.name, f);
    }

    if (fieldByName.size > 0) {
      const allowedKeys = new Set(fieldByName.keys());
      const unknownKeys = Object.keys(submissionData).filter((k) => !allowedKeys.has(k));
      if (unknownKeys.length > 0) {
        return res.status(400).json({
          error: `Unknown fields in submission: ${unknownKeys.join(', ')}`,
          code: 'UNKNOWN_FIELDS',
        });
      }
    }

    // Sanitize string values. The previous filter stripped angle brackets,
    // `javascript:` and `onX=` handlers but left backticks and `${` intact,
    // so a payload could escape into downstream template rendering
    // (e.g. `{{ value }}` interpolation or a ``${...}`` template literal in a
    // generated PDF/email) and execute. Strip those too.
    const sanitizeString = (str) =>
      str
        .replace(/[<>]/g, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+=/gi, '')
        .replace(/`/g, '')
        .replace(/\$\{/g, '');

    const sanitizedData = {};
    for (const [key, value] of Object.entries(submissionData)) {
      const fieldDef = fieldByName.get(key);

      if (typeof value === 'string') {
        sanitizedData[key] = sanitizeString(value);
      } else if (Array.isArray(value)) {
        // Arrays (checkbox groups, multi-file) — sanitize any string element
        // and drop anything that isn't a string, number, or boolean.
        sanitizedData[key] = value
          .map((item) => (typeof item === 'string' ? sanitizeString(item) : item))
          .filter((item) => ['string', 'number', 'boolean'].includes(typeof item));
      } else if (value !== null && typeof value === 'object') {
        // Nested objects are not part of the flat submission contract —
        // flatten/reject rather than store an unvalidated blob.
        return res.status(400).json({
          error: `Field "${key}" must be a scalar value, not an object.`,
          code: 'INVALID_FIELD_SHAPE',
        });
      } else {
        sanitizedData[key] = value;
      }

      // Server-side type check per field where the form declares a type. Stops
      // a numeric/text field from carrying an object or wildly wrong scalar.
      if (fieldDef && fieldDef.type) {
        const expectedType = String(fieldDef.type).toLowerCase();
        const got = sanitizedData[key];
        if (
          (expectedType === 'number' && typeof got !== 'number') ||
          (expectedType === 'boolean' && typeof got !== 'boolean')
        ) {
          return res.status(400).json({
            error: `Field "${key}" must be of type ${expectedType}.`,
            code: 'INVALID_FIELD_TYPE',
          });
        }
      }
    }

    // Create form submission — inherit schoolId from the assignment (public routes have no req.user)
    const submission = new FormSubmission({
      schoolId: assignment.schoolId,
      assignmentId: assignment._id,
      formId: populatedAssignment.formId._id,
      submissionData: sanitizedData,
      submittedByEmail: submittedByEmail || assignment.assignedToEmail,
      submittedByPhone: submittedByPhone || assignment.assignedToPhone,
      submittedAt: new Date(),
    });

    await submission.save();

    // Update assignment status
    assignment.status = 'submitted';
    await assignment.save();

    // --- Notification: Notify school admins of new submission (fire-and-forget) ---
    const formDoc = populatedAssignment.formId;
    const submittedBy = submission.submittedByEmail || submission.submittedByPhone || 'Unknown';
    const schoolId = assignment.schoolId;

    // Find admin staff for this school to notify
    (async () => {
      try {
        const admins = await Staff.find({
          schoolId,
          role: { $in: ['Admin', 'admin', 'Principal', 'principal'] },
          status: { $ne: 'inactive' },
        })
          .select('_id name email')
          .lean();

        for (const admin of admins) {
          // In-app notification via sendNotification
          sendNotification(
            admin._id,
            'Staff',
            'intake_form',
            'New Form Submission',
            `A new ${formDoc.formType || 'intake'} form "${formDoc.formName}" has been submitted by ${submittedBy}.`,
            {
              schoolId,
              relatedId: submission._id,
              relatedType: 'FormSubmission',
              actionUrl: `/intake-forms/submissions/${submission._id}`,
              actionType: 'navigate',
              priority: 'normal',
            }
          ).catch((err) =>
            console.error('[IntakeForm] Failed to send admin notification:', err.message)
          );

          // Email notification
          if (admin.email) {
            sendIntakeFormSubmittedEmail({
              adminEmail: admin.email,
              adminName: admin.name || 'Admin',
              formName: formDoc.formName,
              formType: formDoc.formType || 'student',
              submittedBy,
              submissionId: submission._id.toString(),
              schoolName: process.env.SCHOOL_NAME,
            }).catch((err) =>
              console.error(
                `[IntakeForm] Failed to send submission email to ${admin.email}:`,
                err.message
              )
            );
          }
        }

        // Emit socket event for real-time dashboard updates
        const io = req.app.get('io');
        emitEvent(io, EVENTS.INTAKE_FORM_SUBMITTED, {
          schoolId: schoolId?.toString(),
          submissionId: submission._id.toString(),
          formName: formDoc.formName,
          formType: formDoc.formType,
          submittedByEmail: submission.submittedByEmail || undefined,
          submittedByPhone: submission.submittedByPhone || undefined,
        });
      } catch (notifErr) {
        logger.error({ err: notifErr }, 'Failed to send form submission notifications');
      }
    })();

    res.status(201).json({
      success: true,
      message: 'Form submitted successfully',
      submission: {
        id: submission._id,
        submittedAt: submission.submittedAt,
        reviewStatus: submission.reviewStatus,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Error creating form submission');
    res.status(500).json({
      error: 'Failed to submit form',
      details: error.message,
    });
  }
});

// GET /api/public/form-submission/:token/status - Check if form was already submitted
router.get('/form-submission/:token/status', async (req, res) => {
  try {
    const { token } = req.params;

    // Validate access token
    const validation = await validateAccessToken(token);

    if (!validation.valid) {
      return res.status(401).json({
        error: validation.error,
        code: 'INVALID_TOKEN',
      });
    }

    const assignment = validation.assignment;

    // Check for existing submission
    const submission = await FormSubmission.findOne({
      assignmentId: assignment._id,
    });

    if (!submission) {
      return res.json({
        success: true,
        submitted: false,
        message: 'Form has not been submitted yet',
      });
    }

    // Return submission status
    res.json({
      success: true,
      submitted: true,
      submission: {
        id: submission._id,
        submittedAt: submission.submittedAt,
        reviewStatus: submission.reviewStatus,
        reviewNotes: submission.reviewNotes,
        reviewedAt: submission.reviewedAt,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Error checking submission status');
    res.status(500).json({
      error: 'Failed to check submission status',
      details: error.message,
    });
  }
});

// Zod schema for public form submission update
const formSubmissionUpdateSchema = z.object({
  submissionData: z.record(z.string(), z.unknown()),
});

// PUT /api/public/form-submission/:token - Update existing submission (if allowed)
router.put('/form-submission/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Validate request body with Zod
    const parseResult = formSubmissionUpdateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: parseResult.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const { submissionData } = parseResult.data;

    // Validate access token
    const validation = await validateAccessToken(token);

    if (!validation.valid) {
      return res.status(401).json({
        error: validation.error,
        code: 'INVALID_TOKEN',
      });
    }

    const assignment = validation.assignment;

    // Find existing submission
    const submission = await FormSubmission.findOne({
      assignmentId: assignment._id,
    });

    if (!submission) {
      return res.status(404).json({
        error: 'No submission found for this assignment',
        code: 'NO_SUBMISSION',
      });
    }

    // Check if submission can be edited (only if needs_revision status)
    if (submission.reviewStatus !== 'needs_revision') {
      return res.status(403).json({
        error: 'Form cannot be edited at this stage',
        code: 'CANNOT_EDIT',
        currentStatus: submission.reviewStatus,
      });
    }

    // Update submission data
    submission.submissionData = {
      ...submission.submissionData,
      ...submissionData,
    };

    // Reset review status
    submission.reviewStatus = 'pending';
    submission.reviewNotes = null;
    submission.reviewedAt = null;

    await submission.save();

    res.json({
      success: true,
      message: 'Form updated successfully',
      submission: {
        id: submission._id,
        submittedAt: submission.submittedAt,
        reviewStatus: submission.reviewStatus,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Error updating form submission');
    res.status(500).json({
      error: 'Failed to update form',
      details: error.message,
    });
  }
});

export default router;
