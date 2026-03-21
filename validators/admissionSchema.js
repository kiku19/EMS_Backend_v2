import { z } from 'zod';
import { optionalObjectId, optionalEmail } from './zodHelpers.js';

export const ADMISSION_STATUSES = [
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

// Maps each target status to the set of valid current statuses that may precede it.
const STAGE_PREREQUISITES = {
  'form-sent': ['inquiry-logged', 'form-sent'],
  'form-submitted': ['form-sent', 'form-submitted'],
  'documents-verified': ['form-submitted', 'documents-verified'],
  // Allow rescheduling from failed/no-show
  'test-scheduled': [
    'documents-verified',
    'form-submitted',
    'test-failed',
    'test-no-show',
    'test-scheduled',
  ],
  'test-cleared': ['test-scheduled'],
  'test-failed': ['test-scheduled'],
  'test-no-show': ['test-scheduled'],
  // Without assessment: approve from documents-verified or earlier stages
  // With assessment:    approve only from test-cleared (enforced below)
  'admission-approved': ['test-cleared', 'documents-verified', 'form-submitted', 'form-sent'],
  // Rejection can happen at almost any stage
  'admission-rejected': [
    'inquiry-logged',
    'form-sent',
    'form-submitted',
    'documents-verified',
    'test-scheduled',
    'test-failed',
    'test-no-show',
  ],
  'fee-paid': ['admission-approved'],
  'student-admitted': ['fee-paid', 'admission-approved'],
};

const TEST_STAGES = new Set(['test-scheduled', 'test-cleared', 'test-failed', 'test-no-show']);
// Stages from which direct approval is attempted (bypassing test track)
const DIRECT_APPROVAL_FROM = new Set(['documents-verified', 'form-submitted', 'form-sent']);

/**
 * Validates that a status transition is allowed given the current admission state.
 * @param {object} currentAdmission - The existing Admission document from the DB.
 * @param {string} newStatus - The status value being requested.
 * @returns {string|null} An error message if the transition is invalid, or null if valid.
 */
export function validateStageTransition(currentAdmission, newStatus) {
  const currentStatus = currentAdmission.status;

  // No status change — nothing to validate
  if (!newStatus || newStatus === currentStatus) return null;

  const validPredecessors = STAGE_PREREQUISITES[newStatus];

  // No prerequisites defined for this target status — allow freely
  if (!validPredecessors) return null;

  if (!validPredecessors.includes(currentStatus)) {
    const validFrom = validPredecessors.filter((s) => s !== newStatus).join(', ');
    return (
      `Cannot transition from "${currentStatus}" to "${newStatus}". ` +
      `Valid predecessor stage(s): ${validFrom}.`
    );
  }

  // Test stages require assessmentRequired to be true on the admission
  if (TEST_STAGES.has(newStatus) && !currentAdmission.assessmentRequired) {
    return `Cannot move to "${newStatus}": this admission does not require an assessment.`;
  }

  // Direct approval (bypassing test) is only valid when assessment is NOT required
  if (newStatus === 'admission-approved' && DIRECT_APPROVAL_FROM.has(currentStatus)) {
    if (currentAdmission.assessmentRequired) {
      return (
        'Assessment is required for this admission. ' +
        'Complete the test stage ("test-cleared") before approving.'
      );
    }
  }

  return null;
}

const documentItemSchema = z.object({
  name: z.string().min(1, 'Document name is required'),
  status: z.enum(['pending', 'received', 'verified', 'rejected']).default('pending'),
  notes: z.string().nullish(),
  receivedDate: z.string().nullish(),
});

export const createAdmissionSchema = z.object({
  studentName: z.string().min(1, 'Student name is required').max(100),
  dateOfBirth: z.string().nullish(),
  parentName: z.string().max(100).nullish(),
  phoneNumber: z
    .string()
    .regex(/^[0-9]{10}$/, 'Phone number must be exactly 10 digits')
    .nullish()
    .or(z.literal('')),
  email: optionalEmail,
  classApplyingFor: z.string().min(1, 'Class is required'),
  hscGroup: z.string().nullish(),
  assessmentRequired: z.boolean().default(false),
  assignedTeacher: optionalObjectId,
  testDate: z.string().nullish(),
  testTime: z.string().nullish(),
  testResult: z.enum(['pending', 'cleared', 'failed']).default('pending'),
  source: z.enum(['walk-in', 'call', 'website', 'reference']).default('walk-in'),
  status: z.enum(ADMISSION_STATUSES).default('inquiry-logged'),
  admissionDecision: z.enum(['pending', 'approved', 'rejected']).nullish(),
  decisionRemarks: z.string().nullish(),
  paymentStatus: z.enum(['unpaid', 'paid', 'pending']).nullish(),
  paymentMode: z.string().nullish(),
  paymentAmount: z.union([z.number().nonnegative(), z.string()]).nullish(),
  paymentDate: z.string().nullish(),
  transactionId: z.string().nullish(),
  documents: z.array(documentItemSchema).default([]),
});

export const updateAdmissionSchema = createAdmissionSchema.partial();

export const updateDocumentsSchema = z.object({
  documents: z.array(documentItemSchema),
});
