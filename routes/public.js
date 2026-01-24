import express from 'express';
import { FormAssignment, FormSubmission, IntakeForm } from '../database.js';
import crypto from 'crypto';

const router = express.Router();

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
        code: 'INVALID_TOKEN'
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
        code: 'FORM_NOT_FOUND'
      });
    }

    // Check if form is active
    if (populatedAssignment.formId.status !== 'active') {
      return res.status(403).json({
        error: 'Form is not currently active',
        code: 'FORM_INACTIVE'
      });
    }

    // Check if already submitted
    const existingSubmission = await FormSubmission.findOne({
      assignmentId: assignment._id
    });

    // Return form details for rendering
    res.json({
      success: true,
      assignment: {
        id: populatedAssignment._id,
        status: populatedAssignment.status,
        assignedAt: populatedAssignment.assignedAt,
        expiresAt: populatedAssignment.expiresAt,
        assignedBy: populatedAssignment.assignedBy
      },
      form: {
        id: populatedAssignment.formId._id,
        name: populatedAssignment.formId.formName,
        type: populatedAssignment.formId.formType,
        fields: populatedAssignment.formId.fields
      },
      alreadySubmitted: !!existingSubmission,
      submission: existingSubmission ? {
        id: existingSubmission._id,
        submittedAt: existingSubmission.submittedAt,
        reviewStatus: existingSubmission.reviewStatus
      } : null
    });
  } catch (error) {
    console.error('Error fetching form assignment:', error);
    res.status(500).json({
      error: 'Failed to fetch form details',
      details: error.message
    });
  }
});

// POST /api/public/form-submission/:token - Submit form data
router.post('/form-submission/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { submissionData, submittedByEmail, submittedByPhone } = req.body;

    // Validate access token
    const validation = await validateAccessToken(token);

    if (!validation.valid) {
      return res.status(401).json({
        error: validation.error,
        code: 'INVALID_TOKEN'
      });
    }

    const assignment = validation.assignment;

    // Check if already submitted
    const existingSubmission = await FormSubmission.findOne({
      assignmentId: assignment._id
    });

    if (existingSubmission) {
      return res.status(400).json({
        error: 'Form has already been submitted',
        code: 'ALREADY_SUBMITTED',
        submissionId: existingSubmission._id
      });
    }

    // Validate submission data is provided
    if (!submissionData || typeof submissionData !== 'object') {
      return res.status(400).json({
        error: 'Submission data is required',
        code: 'INVALID_DATA'
      });
    }

    // Populate form to get form details
    const populatedAssignment = await FormAssignment.findById(assignment._id)
      .populate('formId');

    if (!populatedAssignment.formId) {
      return res.status(404).json({
        error: 'Associated form not found',
        code: 'FORM_NOT_FOUND'
      });
    }

    // Create form submission
    const submission = new FormSubmission({
      assignmentId: assignment._id,
      formId: populatedAssignment.formId._id,
      submissionData,
      submittedByEmail: submittedByEmail || assignment.assignedToEmail,
      submittedByPhone: submittedByPhone || assignment.assignedToPhone,
      submittedAt: new Date()
    });

    await submission.save();

    // Update assignment status
    assignment.status = 'submitted';
    await assignment.save();

    console.log('✅ Form submission created:', submission._id);

    res.status(201).json({
      success: true,
      message: 'Form submitted successfully',
      submission: {
        id: submission._id,
        submittedAt: submission.submittedAt,
        reviewStatus: submission.reviewStatus
      }
    });
  } catch (error) {
    console.error('Error creating form submission:', error);
    res.status(500).json({
      error: 'Failed to submit form',
      details: error.message
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
        code: 'INVALID_TOKEN'
      });
    }

    const assignment = validation.assignment;

    // Check for existing submission
    const submission = await FormSubmission.findOne({
      assignmentId: assignment._id
    });

    if (!submission) {
      return res.json({
        success: true,
        submitted: false,
        message: 'Form has not been submitted yet'
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
        reviewedAt: submission.reviewedAt
      }
    });
  } catch (error) {
    console.error('Error checking submission status:', error);
    res.status(500).json({
      error: 'Failed to check submission status',
      details: error.message
    });
  }
});

// PUT /api/public/form-submission/:token - Update existing submission (if allowed)
router.put('/form-submission/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { submissionData } = req.body;

    // Validate access token
    const validation = await validateAccessToken(token);

    if (!validation.valid) {
      return res.status(401).json({
        error: validation.error,
        code: 'INVALID_TOKEN'
      });
    }

    const assignment = validation.assignment;

    // Find existing submission
    const submission = await FormSubmission.findOne({
      assignmentId: assignment._id
    });

    if (!submission) {
      return res.status(404).json({
        error: 'No submission found for this assignment',
        code: 'NO_SUBMISSION'
      });
    }

    // Check if submission can be edited (only if needs_revision status)
    if (submission.reviewStatus !== 'needs_revision') {
      return res.status(403).json({
        error: 'Form cannot be edited at this stage',
        code: 'CANNOT_EDIT',
        currentStatus: submission.reviewStatus
      });
    }

    // Update submission data
    submission.submissionData = {
      ...submission.submissionData,
      ...submissionData
    };

    // Reset review status
    submission.reviewStatus = 'pending';
    submission.reviewNotes = null;
    submission.reviewedAt = null;

    await submission.save();

    console.log('✅ Form submission updated:', submission._id);

    res.json({
      success: true,
      message: 'Form updated successfully',
      submission: {
        id: submission._id,
        submittedAt: submission.submittedAt,
        reviewStatus: submission.reviewStatus
      }
    });
  } catch (error) {
    console.error('Error updating form submission:', error);
    res.status(500).json({
      error: 'Failed to update form',
      details: error.message
    });
  }
});

export default router;
