import School from '../models/School.js';
import AuditTrail from '../models/AuditTrail.js';
import { ONBOARDING_STEPS } from '../validators/onboardingStepSchema.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('OnboardingService');

// One step forward, any number of steps back. Matches the dashboard wizard
// UX rule "Back only to previous step, not arbitrary navigation" — we
// enforce it on the server too so a tampered client can't jump ahead.
function isAllowedTransition(fromStep, toStep) {
  if (!fromStep) return true; // legacy school with no metadata yet
  if (fromStep === toStep) return true; // idempotent re-save (e.g. re-uploading logo)
  const fromIdx = ONBOARDING_STEPS.indexOf(fromStep);
  const toIdx = ONBOARDING_STEPS.indexOf(toStep);
  if (fromIdx === -1 || toIdx === -1) return false;
  return toIdx === fromIdx + 1 || toIdx < fromIdx;
}

function nowIsoString() {
  return new Date().toISOString();
}

/**
 * Read the current onboarding state for the authenticated school.
 * Returns a plain object so the wizard can render the correct step on
 * mount even before any PATCH has happened.
 */
export async function getOnboardingStatus(schoolId) {
  // School is the tenant root — findById directly (no schoolId self-scope
  // filter, since School documents don't have a schoolId field of their own).
  const school = await School.findById(schoolId).lean();
  if (!school) {
    const err = new Error('School not found');
    err.status = 404;
    throw err;
  }

  const metadata = school.metadata || {};
  return {
    step: metadata.onboardingStep || 'school-profile',
    skippedSteps: Array.isArray(metadata.onboardingSkippedSteps)
      ? metadata.onboardingSkippedSteps
      : [],
    completedSteps: Array.isArray(metadata.onboardingCompletedSteps)
      ? metadata.onboardingCompletedSteps
      : [],
    provisioningStatus: school.provisioning?.status || 'pending',
    schoolProfileComplete: Boolean(
      school.contactEmail && school.contactPhone && school.frontendUrl
    ),
    updatedAt: metadata.onboardingStepUpdatedAt || null,
  };
}

/**
 * Validate and persist a wizard step transition.
 *
 * - Forbids arbitrary forward jumps (one step at a time, or back-steps).
 * - When `skipped: true` is passed we record the step in
 *   `metadata.onboardingSkippedSteps` so the wizard does not loop the
 *   user back into it on a refresh (per the issue spec).
 * - When the new step is 'complete' we also flip `provisioning.status`
 *   to 'ready' so the dashboard redirect-back guard lets the user in.
 *
 * Writes a fire-and-forget AuditTrail entry for every state change.
 * Returns the updated status object (same shape as getOnboardingStatus).
 */
export async function updateOnboardingStep({
  schoolId,
  actorId,
  step,
  skipped = false,
  data = {},
}) {
  const school = await School.findById(schoolId);
  if (!school) {
    const err = new Error('School not found');
    err.status = 404;
    throw err;
  }

  const metadata = school.metadata || {};
  const currentStep = metadata.onboardingStep || 'school-profile';

  if (!isAllowedTransition(currentStep, step)) {
    const err = new Error(
      `Invalid onboarding step transition: ${currentStep} -> ${step}. ` +
        'Steps must advance one at a time.'
    );
    err.status = 400;
    err.code = 'ONBOARDING_INVALID_TRANSITION';
    throw err;
  }

  const completedSteps = Array.isArray(metadata.onboardingCompletedSteps)
    ? [...new Set(metadata.onboardingCompletedSteps)]
    : [];
  const skippedSteps = Array.isArray(metadata.onboardingSkippedSteps)
    ? [...new Set(metadata.onboardingSkippedSteps)]
    : [];

  // The 'complete' step is the wizard terminal — it's reached when the user
  // finishes step 5 (invite-staff, optionally skipped). We don't add it to
  // skippedSteps (superRefine forbids `skipped: true` for 'complete').
  if (step === 'complete') {
    // Promote provisioning to 'ready' so the dashboard's onboarding guard
    // stops forcing the wizard.
    school.provisioning = {
      ...(school.provisioning || {}),
      status: 'ready',
      lastProvisionedAt: nowIsoString(),
      lastProvisionedBy: actorId ? String(actorId) : 'self-serve-wizard',
      notes: school.provisioning?.notes || 'onboarding-wizard-complete',
    };
    // Mark the last interactive step (invite-staff) as completed too, so
    // the wizard's progress bar stays at 100% after finishing.
    if (currentStep !== 'complete' && !completedSteps.includes(currentStep)) {
      completedSteps.push(currentStep);
    }
  } else if (skipped) {
    // The user explicitly skipped the step they were on (currentStep).
    // Record it as both skipped and completed so the wizard does not loop
    // them back into it on refresh.
    if (!skippedSteps.includes(currentStep)) skippedSteps.push(currentStep);
    if (!completedSteps.includes(currentStep)) completedSteps.push(currentStep);
  } else {
    // Normal forward or backward transition. The step we are leaving
    // (currentStep) is the one the user just finished; mark it complete.
    if (!completedSteps.includes(currentStep)) completedSteps.push(currentStep);
    // If the user revisits a step they previously skipped and now finishes
    // it normally, remove it from skippedSteps.
    const idx = skippedSteps.indexOf(currentStep);
    if (idx !== -1) skippedSteps.splice(idx, 1);
  }

  school.metadata = {
    ...metadata,
    onboardingStep: step,
    onboardingStepUpdatedAt: nowIsoString(),
    onboardingCompletedSteps: completedSteps,
    onboardingSkippedSteps: skippedSteps,
    onboardingLastActorId: actorId ? String(actorId) : null,
    // Optional per-step payload (logo URL, class payload, etc.). Strict
    // shape validation for these payloads lives in the per-step
    // controllers/services when they eventually land; for now we accept
    // whatever the wizard sends so the step endpoint stays generic.
    ...(data && Object.keys(data).length > 0 ? { onboardingStepData: data } : {}),
  };

  await school.save();

  // Fire-and-forget audit. Never throw — onboarding completion should
  // not be blocked by audit write failures.
  AuditTrail.create({
    schoolId,
    userId: actorId,
    action: 'settings_changed',
    entity: 'onboarding',
    entityId: String(school._id),
    method: 'PATCH',
    path: '/api/v1/onboarding/step',
    newValue: {
      step,
      skipped,
      provisioningStatus: school.provisioning?.status,
    },
    oldValue: { step: currentStep },
  }).catch((err) => {
    logger.warn({ err: err.message }, 'Failed to write onboarding audit entry');
  });

  return getOnboardingStatus(schoolId);
}
