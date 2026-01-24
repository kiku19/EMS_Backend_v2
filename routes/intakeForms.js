import express from 'express';
import { IntakeForm, FormAssignment, FormSubmission, Student, Staff, StudentFeeStructure, Class } from '../database.js';
import { authenticate } from '../middleware/auth.js';
import { validateIndianPhone, validateInternationalPhone, mockThirdPartyValidation } from '../services/phoneValidation.js';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';
import crypto from 'crypto';
import mongoose from 'mongoose';

const router = express.Router();

// Helper function to generate unique access token
function generateAccessToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ============================================================
// INTAKE FORMS CRUD ENDPOINTS
// ============================================================

// GET /intake-forms - Get all intake forms with optional filters
router.get('/intake-forms', authenticate, async (req, res) => {
  try {
    const { type, status } = req.query;
    console.log('📋 Fetching intake forms with filters:', { type, status });

    const query = {};
    if (type) query.formType = type;
    if (status) query.status = status;

    const forms = await IntakeForm.find(query)
      .populate('createdBy', 'name code')
      .sort({ createdAt: -1 });

    console.log(`✅ Found ${forms.length} intake forms`);
    res.json(forms);
  } catch (error) {
    console.error('❌ Error fetching intake forms:', error);
    res.status(500).json({
      error: 'Failed to fetch intake forms',
      message: error.message
    });
  }
});

// GET /intake-forms/:id - Get a single intake form by ID
router.get('/intake-forms/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('📋 Fetching intake form:', id);

    const form = await IntakeForm.findById(id)
      .populate('createdBy', 'name code');

    if (!form) {
      console.warn('⚠️ Intake form not found:', id);
      return res.status(404).json({
        error: 'Intake form not found',
        message: `No form found with ID: ${id}`
      });
    }

    console.log('✅ Intake form found:', form.formName);
    res.json(form);
  } catch (error) {
    console.error('❌ Error fetching intake form:', error);
    res.status(500).json({
      error: 'Failed to fetch intake form',
      message: error.message
    });
  }
});

// POST /intake-forms - Create a new intake form
router.post('/intake-forms', authenticate, async (req, res) => {
  try {
    const { formName, formType, fields, status } = req.body;

    console.log('📝 Creating new intake form:', { formName, formType });

    // Validate required fields
    if (!formName) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'formName is required'
      });
    }

    if (!formType) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'formType is required (staff, student, or parent)'
      });
    }

    if (!fields || !Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'fields must be a non-empty array'
      });
    }

    // Create intake form
    const form = new IntakeForm({
      formName,
      formType,
      fields,
      status: status || 'active',
      createdBy: req.user.id
    });

    await form.save();
    console.log('✅ Intake form created:', form.formName);

    // Populate createdBy before returning
    await form.populate('createdBy', 'name code');

    res.status(201).json(form);
  } catch (error) {
    console.error('❌ Error creating intake form:', error);
    res.status(500).json({
      error: 'Failed to create intake form',
      message: error.message
    });
  }
});

// PUT /intake-forms/:id - Update an intake form
router.put('/intake-forms/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { formName, formType, fields, status } = req.body;

    console.log('📝 Updating intake form:', id);

    // Find existing form
    const form = await IntakeForm.findById(id);

    if (!form) {
      console.warn('⚠️ Intake form not found:', id);
      return res.status(404).json({
        error: 'Intake form not found',
        message: `No form found with ID: ${id}`
      });
    }

    // Update fields
    if (formName !== undefined) form.formName = formName;
    if (formType !== undefined) form.formType = formType;
    if (fields !== undefined) {
      if (!Array.isArray(fields) || fields.length === 0) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'fields must be a non-empty array'
        });
      }
      form.fields = fields;
    }
    if (status !== undefined) form.status = status;

    await form.save();
    console.log('✅ Intake form updated:', form.formName);

    // Populate createdBy before returning
    await form.populate('createdBy', 'name code');

    res.json(form);
  } catch (error) {
    console.error('❌ Error updating intake form:', error);
    res.status(500).json({
      error: 'Failed to update intake form',
      message: error.message
    });
  }
});

// DELETE /intake-forms/:id - Delete an intake form
router.delete('/intake-forms/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('🗑️ Deleting intake form:', id);

    const form = await IntakeForm.findByIdAndDelete(id);

    if (!form) {
      console.warn('⚠️ Intake form not found:', id);
      return res.status(404).json({
        error: 'Intake form not found',
        message: `No form found with ID: ${id}`
      });
    }

    // Optional: Also delete related assignments and submissions
    // Uncomment if you want this behavior
    // await FormAssignment.deleteMany({ formId: id });
    // await FormSubmission.deleteMany({ formId: id });

    console.log('✅ Intake form deleted:', form.formName);
    res.json({
      success: true,
      message: 'Intake form deleted successfully',
      id
    });
  } catch (error) {
    console.error('❌ Error deleting intake form:', error);
    res.status(500).json({
      error: 'Failed to delete intake form',
      message: error.message
    });
  }
});

// POST /intake-forms/:id/duplicate - Duplicate an intake form
router.post('/intake-forms/:id/duplicate', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { createdBy } = req.body;

    console.log('📋 Duplicating intake form:', id);

    const originalForm = await IntakeForm.findById(id);

    if (!originalForm) {
      console.warn('⚠️ Intake form not found:', id);
      return res.status(404).json({
        error: 'Intake form not found',
        message: `No form found with ID: ${id}`
      });
    }

    // Create duplicate
    const duplicatedForm = new IntakeForm({
      formName: `${originalForm.formName} (Copy)`,
      formType: originalForm.formType,
      fields: originalForm.fields,
      status: 'active',
      createdBy: createdBy || req.user.id
    });

    await duplicatedForm.save();
    console.log('✅ Intake form duplicated:', duplicatedForm.formName);

    // Populate createdBy before returning
    await duplicatedForm.populate('createdBy', 'name code');

    res.status(201).json(duplicatedForm);
  } catch (error) {
    console.error('❌ Error duplicating intake form:', error);
    res.status(500).json({
      error: 'Failed to duplicate intake form',
      message: error.message
    });
  }
});

// ============================================================
// FORM ASSIGNMENT ENDPOINTS
// ============================================================

// POST /intake-forms/:id/assign - Assign form to email/phone
router.post('/intake-forms/:id/assign', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { emails = [], phones = [], assignedToEmail, assignedToPhone, expiresInDays = 7, assignedBy } = req.body;
    const enableThirdPartyValidation = req.query.validatePhone === 'true';

    console.log('📤 Assigning intake form:', id, 'to:', { emails, phones, assignedToEmail, assignedToPhone });
    if (enableThirdPartyValidation) {
      console.log('🔍 Third-party phone validation enabled');
    }

    // Validate form exists
    const form = await IntakeForm.findById(id);
    if (!form) {
      console.warn('⚠️ Intake form not found:', id);
      return res.status(404).json({
        error: 'Intake form not found',
        message: `No form found with ID: ${id}`
      });
    }

    // Support both array format (from frontend) and string format (backward compatibility)
    const recipientEmails = emails?.length ? emails : (assignedToEmail ? [assignedToEmail] : []);
    const recipientPhones = phones?.length ? phones : (assignedToPhone ? [assignedToPhone] : []);

    if (recipientEmails.length === 0 && recipientPhones.length === 0) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'At least one email or phone is required'
      });
    }

    // Validate phone numbers if provided
    if (recipientPhones.length > 0) {
      console.log(`🔍 Validating ${recipientPhones.length} phone number(s)...`);
      const validationErrors = [];

      for (const phone of recipientPhones) {
        // Format validation (Indian phone numbers)
        const formatValidation = validateIndianPhone(phone);

        console.log(`  Phone: ${phone} - Format validation: ${formatValidation.isValid ? '✅ Valid' : '❌ Invalid'}`);

        if (!formatValidation.isValid) {
          validationErrors.push({
            phone: phone,
            error: formatValidation.error,
            stage: 'format_validation'
          });
          continue;
        }

        // Third-party validation (optional)
        if (enableThirdPartyValidation) {
          try {
            const thirdPartyValidation = await mockThirdPartyValidation(phone);

            console.log(`  Phone: ${phone} - Third-party validation: ${thirdPartyValidation.isValid ? '✅ Valid' : '❌ Invalid'} (${thirdPartyValidation.provider})`);

            if (!thirdPartyValidation.isValid) {
              validationErrors.push({
                phone: phone,
                error: thirdPartyValidation.error,
                stage: 'third_party_validation',
                provider: thirdPartyValidation.provider
              });
            }
          } catch (error) {
            console.error(`❌ Third-party validation failed for phone ${phone}:`, error.message);
            validationErrors.push({
              phone: phone,
              error: 'Third-party validation service unavailable',
              stage: 'third_party_validation',
              details: error.message
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
          validationErrors: validationErrors
        });
      }

      console.log('✅ All phone numbers validated successfully');
    }

    // Calculate expiration date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    // Create assignments for all recipients
    const assignments = [];
    const assignedById = assignedBy || req.user.id;

    for (const email of recipientEmails) {
      const accessToken = generateAccessToken();
      const assignment = new FormAssignment({
        formId: id,
        assignedToEmail: email,
        assignedBy: assignedById,
        status: 'pending',
        accessToken,
        expiresAt,
        assignedAt: new Date()
      });
      await assignment.save();
      await assignment.populate('formId', 'formName formType');
      await assignment.populate('assignedBy', 'name code');
      assignments.push(assignment);
      console.log('✅ Form assignment created for email:', email);
    }

    for (const phone of recipientPhones) {
      const accessToken = generateAccessToken();
      const assignment = new FormAssignment({
        formId: id,
        assignedToPhone: phone,
        assignedBy: assignedById,
        status: 'pending',
        accessToken,
        expiresAt,
        assignedAt: new Date()
      });
      await assignment.save();
      await assignment.populate('formId', 'formName formType');
      await assignment.populate('assignedBy', 'name code');
      assignments.push(assignment);
      console.log('✅ Form assignment created for phone:', phone);
    }

    console.log(`✅ Created ${assignments.length} form assignments`);

    res.status(201).json({
      assignments,
      count: assignments.length,
      validation: {
        phonesValidated: recipientPhones.length,
        thirdPartyEnabled: enableThirdPartyValidation
      }
    });
  } catch (error) {
    console.error('❌ Error creating form assignment:', error);
    res.status(500).json({
      error: 'Failed to create form assignment',
      message: error.message
    });
  }
});

// GET /form-assignments - Get all form assignments with optional filters
router.get('/form-assignments', authenticate, async (req, res) => {
  try {
    const { formId, status } = req.query;
    console.log('📋 Fetching form assignments with filters:', { formId, status });

    const query = {};
    if (formId) query.formId = formId;
    if (status) query.status = status;

    const assignments = await FormAssignment.find(query)
      .populate('formId', 'formName formType')
      .populate('assignedBy', 'name code')
      .sort({ assignedAt: -1 });

    console.log(`✅ Found ${assignments.length} form assignments`);
    res.json(assignments);
  } catch (error) {
    console.error('❌ Error fetching form assignments:', error);
    res.status(500).json({
      error: 'Failed to fetch form assignments',
      message: error.message
    });
  }
});

// GET /form-assignments/:id - Get a single form assignment by ID
router.get('/form-assignments/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('📋 Fetching form assignment:', id);

    const assignment = await FormAssignment.findById(id)
      .populate('formId', 'formName formType fields')
      .populate('assignedBy', 'name code');

    if (!assignment) {
      console.warn('⚠️ Form assignment not found:', id);
      return res.status(404).json({
        error: 'Form assignment not found',
        message: `No assignment found with ID: ${id}`
      });
    }

    console.log('✅ Form assignment found');
    res.json(assignment);
  } catch (error) {
    console.error('❌ Error fetching form assignment:', error);
    res.status(500).json({
      error: 'Failed to fetch form assignment',
      message: error.message
    });
  }
});

// PUT /form-assignments/:id/resend - Resend form assignment
router.put('/form-assignments/:id/resend', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { expiresInDays = 7 } = req.body;

    console.log('📤 Resending form assignment:', id);

    const assignment = await FormAssignment.findById(id);

    if (!assignment) {
      console.warn('⚠️ Form assignment not found:', id);
      return res.status(404).json({
        error: 'Form assignment not found',
        message: `No assignment found with ID: ${id}`
      });
    }

    // Update expiration date and generate new token
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    assignment.accessToken = generateAccessToken();
    assignment.expiresAt = expiresAt;
    assignment.status = 'pending';

    await assignment.save();
    console.log('✅ Form assignment resent');

    // Populate references
    await assignment.populate('formId', 'formName formType');
    await assignment.populate('assignedBy', 'name code');

    res.json(assignment);
  } catch (error) {
    console.error('❌ Error resending form assignment:', error);
    res.status(500).json({
      error: 'Failed to resend form assignment',
      message: error.message
    });
  }
});

// DELETE /form-assignments/:id - Delete a form assignment
router.delete('/form-assignments/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('🗑️ Deleting form assignment:', id);

    const assignment = await FormAssignment.findByIdAndDelete(id);

    if (!assignment) {
      console.warn('⚠️ Form assignment not found:', id);
      return res.status(404).json({
        error: 'Form assignment not found',
        message: `No assignment found with ID: ${id}`
      });
    }

    console.log('✅ Form assignment deleted');
    res.json({
      success: true,
      message: 'Form assignment deleted successfully',
      id
    });
  } catch (error) {
    console.error('❌ Error deleting form assignment:', error);
    res.status(500).json({
      error: 'Failed to delete form assignment',
      message: error.message
    });
  }
});

// ============================================================
// FORM SUBMISSION ENDPOINTS
// ============================================================

// GET /form-submissions - Get all form submissions with optional filters
router.get('/form-submissions', authenticate, async (req, res) => {
  try {
    const { formId, reviewStatus } = req.query;
    console.log('📋 Fetching form submissions with filters:', { formId, reviewStatus });

    const query = {};
    if (formId) query.formId = formId;
    if (reviewStatus) query.reviewStatus = reviewStatus;

    const submissions = await FormSubmission.find(query)
      .populate('assignmentId', 'assignedToEmail assignedToPhone assignedBy')
      .populate('formId', 'formName formType')
      .populate('reviewedBy', 'name code')
      .sort({ submittedAt: -1 });

    console.log(`✅ Found ${submissions.length} form submissions`);
    res.json(submissions);
  } catch (error) {
    console.error('❌ Error fetching form submissions:', error);
    res.status(500).json({
      error: 'Failed to fetch form submissions',
      message: error.message
    });
  }
});

// GET /form-submissions/:id - Get a single form submission by ID
router.get('/form-submissions/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('📋 Fetching form submission:', id);

    const submission = await FormSubmission.findById(id)
      .populate('assignmentId', 'assignedToEmail assignedToPhone assignedBy')
      .populate('formId', 'formName formType fields')
      .populate('reviewedBy', 'name code');

    if (!submission) {
      console.warn('⚠️ Form submission not found:', id);
      return res.status(404).json({
        error: 'Form submission not found',
        message: `No submission found with ID: ${id}`
      });
    }

    console.log('✅ Form submission found');
    res.json(submission);
  } catch (error) {
    console.error('❌ Error fetching form submission:', error);
    res.status(500).json({
      error: 'Failed to fetch form submission',
      message: error.message
    });
  }
});

// PUT /form-submissions/:id/review - Review a form submission
router.put('/form-submissions/:id/review', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewStatus, reviewNotes, staffId, studentId } = req.body;

    console.log('👁️ Reviewing form submission:', id, 'status:', reviewStatus);

    const submission = await FormSubmission.findById(id);

    if (!submission) {
      console.warn('⚠️ Form submission not found:', id);
      return res.status(404).json({
        error: 'Form submission not found',
        message: `No submission found with ID: ${id}`
      });
    }

    // Validate reviewStatus
    const validStatuses = ['pending', 'approved', 'rejected', 'needs_revision'];
    if (!validStatuses.includes(reviewStatus)) {
      return res.status(400).json({
        error: 'Validation failed',
        message: `reviewStatus must be one of: ${validStatuses.join(', ')}`
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
    console.log('✅ Form submission reviewed');

    // Update assignment status
    if (submission.assignmentId) {
      await FormAssignment.findByIdAndUpdate(
        submission.assignmentId,
        { status: reviewStatus === 'approved' ? 'approved' : 'submitted' }
      );
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
      message: error.message
    });
  }
});

// DELETE /form-submissions/:id - Delete a form submission
router.delete('/form-submissions/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('🗑️ Deleting form submission:', id);

    const submission = await FormSubmission.findByIdAndDelete(id);

    if (!submission) {
      console.warn('⚠️ Form submission not found:', id);
      return res.status(404).json({
        error: 'Form submission not found',
        message: `No submission found with ID: ${id}`
      });
    }

    console.log('✅ Form submission deleted');
    res.json({
      success: true,
      message: 'Form submission deleted successfully',
      id
    });
  } catch (error) {
    console.error('❌ Error deleting form submission:', error);
    res.status(500).json({
      error: 'Failed to delete form submission',
      message: error.message
    });
  }
});

// PUT /api/form-submissions/:id/review - Enhanced review endpoint with auto entity creation
router.put('/form-submissions/:id/review-enhanced', authenticate, async (req, res) => {
  try {
    const submission = await FormSubmission.findById(req.params.id);

    if (!submission) {
      return res.status(404).json({
        success: false,
        error: 'Submission not found'
      });
    }

    const { decision, reviewNotes } = req.body;

    if (!decision || !['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid decision',
        message: 'Decision must be either approved or rejected'
      });
    }

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
          error: 'Associated form not found'
        });
      }

      // Create entity based on form type
      if (form.formType === 'student') {
        try {
          const student = await createStudentFromSubmission(submission.submissionData, form);
          submission.studentId = student._id;
          console.log('✅ Student created from submission:', student._id);
        } catch (studentError) {
          console.error('❌ Error creating student:', studentError);
          return res.status(500).json({
            success: false,
            error: 'Failed to create student record',
            details: studentError.message
          });
        }
      } else if (form.formType === 'staff') {
        try {
          const staff = await createStaffFromSubmission(submission.submissionData, form);
          submission.staffId = staff._id;
          console.log('✅ Staff created from submission:', staff._id);
        } catch (staffError) {
          console.error('❌ Error creating staff:', staffError);
          return res.status(500).json({
            success: false,
            error: 'Failed to create staff record',
            details: staffError.message
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

    console.log('✅ Submission reviewed:', submission._id, decision);

    res.json({
      success: true,
      data: submission,
      message: `Submission ${decision} successfully`
    });
  } catch (error) {
    console.error('❌ Review submission error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to review submission'
    });
  }
});

// POST /api/form-submissions/:id/request-edit - Request edits from parent
router.post('/form-submissions/:id/request-edit', authenticate, async (req, res) => {
  try {
    const submission = await FormSubmission.findById(req.params.id);

    if (!submission) {
      return res.status(404).json({
        success: false,
        error: 'Submission not found'
      });
    }

    const { notes } = req.body;

    if (!notes || notes.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Notes are required',
        message: 'Please provide notes explaining what needs to be edited'
      });
    }

    // Update submission to request edits
    submission.reviewStatus = 'needs_revision';
    submission.editRequestNotes = notes;
    submission.editRequestedAt = new Date();
    submission.editRequestedBy = req.user.id;
    submission.resubmissionCount = (submission.resubmissionCount || 0) + 1;

    await submission.save();

    // Get assignment to send notification
    const assignment = await FormAssignment.findById(submission.assignmentId);

    // TODO: Send notification to parent about edit request
    if (assignment) {
      console.log('📧 Edit request notification would be sent to:', assignment.assignedToEmail || assignment.assignedToPhone);
      // Implement email/SMS sending logic here
    }

    // Populate for response
    await submission.populate('formId', 'formName formType');
    await submission.populate('editRequestedBy', 'name code');

    console.log('✅ Edit request sent for submission:', submission._id);

    res.json({
      success: true,
      data: submission,
      message: 'Edit request sent successfully'
    });
  } catch (error) {
    console.error('❌ Request edit error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to request edits'
    });
  }
});

// GET /api/form-submissions/student/:studentId - Get student's submissions
router.get('/form-submissions/student/:studentId', authenticate, async (req, res) => {
  try {
    const { studentId } = req.params;

    const submissions = await FormSubmission.find({ studentId })
      .populate('formId', 'formName formType')
      .populate('assignmentId')
      .populate('reviewedBy', 'name code')
      .sort({ submittedAt: -1 });

    console.log(`✅ Found ${submissions.length} submissions for student:`, studentId);

    res.json({
      success: true,
      data: submissions,
      count: submissions.length
    });
  } catch (error) {
    console.error('❌ Get student submissions error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch student submissions'
    });
  }
});

// GET /api/form-submissions/staff/:staffId - Get staff's submissions
router.get('/form-submissions/staff/:staffId', authenticate, async (req, res) => {
  try {
    const { staffId } = req.params;

    const submissions = await FormSubmission.find({ staffId })
      .populate('formId', 'formName formType')
      .populate('assignmentId')
      .populate('reviewedBy', 'name code')
      .sort({ submittedAt: -1 });

    console.log(`✅ Found ${submissions.length} submissions for staff:`, staffId);

    res.json({
      success: true,
      data: submissions,
      count: submissions.length
    });
  } catch (error) {
    console.error('❌ Get staff submissions error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch staff submissions'
    });
  }
});

// GET /api/form-assignments/:token - Get assignment by access token (for public form submission)
router.get('/form-assignments/token/:token', async (req, res) => {
  try {
    const { token } = req.params;

    console.log('🔑 Fetching assignment by token');

    const assignment = await FormAssignment.findOne({ accessToken: token })
      .populate('formId');

    if (!assignment) {
      return res.status(404).json({
        success: false,
        error: 'Invalid access token'
      });
    }

    // Check if token has expired
    if (assignment.expiresAt && assignment.expiresAt < new Date()) {
      return res.status(400).json({
        success: false,
        error: 'Access token has expired',
        message: 'Please contact the school for a new link'
      });
    }

    console.log('✅ Valid access token for form:', assignment.formId.formName);

    res.json({
      success: true,
      data: {
        formId: assignment.formId._id,
        formName: assignment.formId.formName,
        formType: assignment.formId.formType,
        fields: assignment.formId.fields
      }
    });
  } catch (error) {
    console.error('❌ Get assignment by token error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to fetch assignment'
    });
  }
});

// PUT /api/form-assignments/:id/status - Update assignment status
router.put('/form-assignments/:id/status', authenticate, async (req, res) => {
  try {
    const assignment = await FormAssignment.findById(req.params.id);

    if (!assignment) {
      return res.status(404).json({
        success: false,
        error: 'Assignment not found'
      });
    }

    const { status } = req.body;

    if (!status || !['pending', 'in_progress', 'submitted', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status',
        message: 'Status must be one of: pending, in_progress, submitted, approved, rejected'
      });
    }

    assignment.status = status;
    await assignment.save();

    await assignment.populate('formId', 'formName formType');
    await assignment.populate('assignedBy', 'name code');

    console.log('✅ Assignment status updated:', assignment._id, status);

    res.json({
      success: true,
      data: assignment,
      message: 'Assignment status updated successfully'
    });
  } catch (error) {
    console.error('❌ Update assignment status error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to update assignment status'
    });
  }
});

// ============================================================
// PUBLIC ENDPOINTS (No Authentication Required)
// ============================================================

// GET /form-submissions/public/:accessToken - Get form details for public submission
router.get('/form-submissions/public/:accessToken', async (req, res) => {
  try {
    const { accessToken } = req.params;
    console.log('📋 Public form access request');

    const assignment = await FormAssignment.findOne({ accessToken })
      .populate('formId', 'formName formType fields');

    if (!assignment) {
      console.warn('⚠️ Invalid access token');
      return res.status(404).json({
        error: 'Invalid access token',
        message: 'This form link is invalid or has been revoked'
      });
    }

    // Check if expired
    if (assignment.expiresAt && new Date() > assignment.expiresAt) {
      console.warn('⚠️ Access token expired');
      return res.status(400).json({
        error: 'Link expired',
        message: 'This form link has expired. Please request a new one.',
        expired: true
      });
    }

    // Check if already submitted
    const existingSubmission = await FormSubmission.findOne({ assignmentId: assignment._id });
    if (existingSubmission) {
      console.warn('⚠️ Form already submitted');
      return res.status(400).json({
        error: 'Already submitted',
        message: 'This form has already been submitted',
        alreadySubmitted: true,
        submittedAt: existingSubmission.submittedAt,
        reviewStatus: existingSubmission.reviewStatus
      });
    }

    console.log('✅ Valid form access');
    res.json({
      success: true,
      data: {
        formId: assignment.formId._id,
        formName: assignment.formId.formName,
        formType: assignment.formId.formType,
        fields: assignment.formId.fields,
        assignedToEmail: assignment.assignedToEmail,
        assignedToPhone: assignment.assignedToPhone,
        expiresAt: assignment.expiresAt
      }
    });
  } catch (error) {
    console.error('❌ Error fetching public form:', error);
    res.status(500).json({
      error: 'Failed to fetch form details',
      message: error.message
    });
  }
});

// POST /form-submissions/public/:accessToken - Submit form publicly via access token
router.post('/form-submissions/public/:accessToken', async (req, res) => {
  try {
    const { accessToken } = req.params;
    const { submissionData } = req.body;

    console.log('📝 Public form submission request');

    // Find assignment by access token
    const assignment = await FormAssignment.findOne({ accessToken })
      .populate('formId');

    if (!assignment) {
      console.warn('⚠️ Invalid access token');
      return res.status(404).json({
        error: 'Invalid access token',
        message: 'This form link is invalid or has been revoked'
      });
    }

    // Check if expired
    if (assignment.expiresAt && new Date() > assignment.expiresAt) {
      console.warn('⚠️ Access token expired');
      return res.status(400).json({
        error: 'Link expired',
        message: 'This form link has expired. Please request a new one.'
      });
    }

    // Check if already submitted
    const existingSubmission = await FormSubmission.findOne({ assignmentId: assignment._id });
    if (existingSubmission) {
      console.warn('⚠️ Form already submitted');
      return res.status(400).json({
        error: 'Already submitted',
        message: 'This form has already been submitted'
      });
    }

    // Validate submission data
    if (!submissionData || typeof submissionData !== 'object') {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'submissionData is required and must be an object'
      });
    }

    // Create submission
    const submission = new FormSubmission({
      assignmentId: assignment._id,
      formId: assignment.formId._id,
      submissionData,
      submittedByEmail: assignment.assignedToEmail,
      submittedByPhone: assignment.assignedToPhone,
      submittedAt: new Date(),
      reviewStatus: 'pending'
    });

    await submission.save();
    console.log('✅ Public form submission created');

    // Update assignment status
    assignment.status = 'submitted';
    await assignment.save();

    // Populate references for response
    await submission.populate('formId', 'formName formType');

    res.status(201).json({
      success: true,
      message: 'Form submitted successfully. You will be notified after review.',
      data: submission
    });
  } catch (error) {
    console.error('❌ Error submitting public form:', error);
    res.status(500).json({
      error: 'Failed to submit form',
      message: error.message
    });
  }
});

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Create Student record from submission data
 */
async function createStudentFromSubmission(submissionData, form) {
  console.log('🎓 Creating student from submission data...');

  const { getNextAdmissionId, getNextRollNumber } = await import('../database.js');

  // Extract and map fields from submissionData
  const studentData = {
    name: submissionData.name || submissionData.studentName,
    admissionId: submissionData.admissionId || await getNextAdmissionId(),
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

    // Parent/Guardian Information
    parentName: submissionData.parentName || submissionData.fatherName,
    parentPhone: submissionData.parentPhone,
    parentEmail: submissionData.parentEmail,
    parentRelationship: submissionData.parentRelationship || 'Father',
    parentOccupation: submissionData.parentOccupation,
    alternatePhone: submissionData.alternatePhone,

    // Additional Parents
    parents: submissionData.parents || [{
      name: submissionData.parentName || submissionData.fatherName,
      relationship: submissionData.parentRelationship || 'Father',
      phone: submissionData.parentPhone,
      email: submissionData.parentEmail,
      isWhatsapp: submissionData.isWhatsapp !== undefined ? submissionData.isWhatsapp : true
    }],

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
    feeStatus: 'pending'
  };

  // Generate roll number if classId provided
  if (studentData.classId && !studentData.rollNo) {
    studentData.rollNo = await getNextRollNumber(studentData.classId);
  }

  const student = await Student.create(studentData);
  console.log('✅ Student created:', student._id);

  // Auto-initialize fee structure for the new student
  try {
    // Check if fee structure already exists
    const existingFeeStructure = await StudentFeeStructure.findOne({
      studentId: student._id,
      academicYear: studentData.academicYear || CURRENT_ACADEMIC_YEAR
    });

    if (!existingFeeStructure) {
      // Get class information
      const classInfo = await Class.findById(studentData.classId);
      if (classInfo) {
        // Extract class number from class name (e.g., "Class 10" -> "10")
        const classNumber = classInfo.name.replace('Class ', '');

        // Find FeeHead model to get applicable fee heads
        const FeeHead = mongoose.model('FeeHead');
        const applicableFeeHeads = await FeeHead.find({
          applicableClasses: classNumber,
          academicYear: studentData.academicYear || CURRENT_ACADEMIC_YEAR,
          isActive: true
        });

        // Create fee structure
        const feeStructure = new StudentFeeStructure({
          studentId: student._id,
          classId: studentData.classId,
          academicYear: studentData.academicYear || CURRENT_ACADEMIC_YEAR,
          feeHeads: applicableFeeHeads.map(fh => ({
            feeHeadId: fh._id,
            name: fh.name,
            category: fh.category,
            amount: fh.amount,
            mandatory: fh.mandatory,
            frequency: fh.frequency,
            paidAmount: 0,
            balanceAmount: fh.amount,
            status: 'pending'
          }))
        });

        // Calculate totals
        feeStructure.totalFee = feeStructure.feeHeads.reduce((sum, fh) => sum + fh.amount, 0);
        feeStructure.totalPaid = 0;
        feeStructure.totalBalance = feeStructure.totalFee;
        feeStructure.overallStatus = 'pending';

        await feeStructure.save();
        console.log('✅ Fee structure initialized for student:', student._id);
      }
    }
  } catch (feeError) {
    // Log fee initialization error but don't fail student creation
    console.error('⚠️ Error auto-initializing fee structure for student from form submission:', feeError);
  }

  return student;
}

/**
 * Create Staff record from submission data
 */
async function createStaffFromSubmission(submissionData, form) {
  console.log('👔 Creating staff from submission data...');

  const { getNextStaffCode } = await import('../database.js');
  const staffCode = await getNextStaffCode();

  // Extract and map fields from submissionData
  const staffData = {
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
    password: submissionData.password || 'TempPassword123', // Should be changed on first login
    joinDate: submissionData.joinDate || new Date().toISOString().split('T')[0]
  };

  const staff = await Staff.create(staffData);
  console.log('✅ Staff created:', staff._id);
  return staff;
}

export default router;
