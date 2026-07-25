import { z } from 'zod';

// Self-serve onboarding wizard step enum. The order matters —
// services/onboardingService.js validates forward-only transitions
// (with explicit skip + back-to-previous allowances) against this list.
export const ONBOARDING_STEPS = [
  'school-profile',
  'academic-year',
  'first-class',
  'first-student',
  'invite-staff',
  'complete',
];

export const onboardingStepEnum = z.enum(ONBOARDING_STEPS, {
  errorMap: () => ({
    message: `step must be one of: ${ONBOARDING_STEPS.join(', ')}`,
  }),
});

// Body for PATCH /api/v1/onboarding/step
// - step is required and must be a valid forward target
// - skipped is a marker so we don't loop users back into a step they
//   explicitly chose to skip; allowed on every step except 'complete'
// - data is an optional, free-form payload for per-step details
//   (school profile fields, class payload, student payload, etc.).
//   It is parsed with .passthrough so callers can add keys per step
//   without us needing to enumerate every variant here — but the
//   per-step controllers/services should still validate the contents
//   before persisting.
export const updateOnboardingStepSchema = z
  .object({
    step: onboardingStepEnum,
    skipped: z.boolean().optional().default(false),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.step === 'complete' && value.skipped === true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['skipped'],
        message: 'skipped cannot be true for the final "complete" step',
      });
    }
  });
