import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { FormAssignment, FormSubmission, IntakeForm } from '../database.js';
import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';
import { optionalPhone, optionalEmail } from '../validators/zodHelpers.js';

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
    if (formFields.length > 0) {
      const allowedKeys = new Set(formFields.map((f) => f.name || f.id || f.key).filter(Boolean));
      const unknownKeys = Object.keys(submissionData).filter((k) => !allowedKeys.has(k));
      if (unknownKeys.length > 0) {
        return res.status(400).json({
          error: `Unknown fields in submission: ${unknownKeys.join(', ')}`,
          code: 'UNKNOWN_FIELDS',
        });
      }
    }

    // Sanitize string values — strip angle brackets and JS event handlers
    const sanitizedData = {};
    for (const [key, value] of Object.entries(submissionData)) {
      if (typeof value === 'string') {
        sanitizedData[key] = value
          .replace(/[<>]/g, '')
          .replace(/javascript:/gi, '')
          .replace(/on\w+=/gi, '');
      } else {
        sanitizedData[key] = value;
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
