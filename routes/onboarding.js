import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { validateZod } from '../validators/zodHelpers.js';
import { updateOnboardingStepSchema } from '../validators/onboardingStepSchema.js';
import { getOnboardingStatus, updateOnboardingStep } from '../services/onboardingService.js';

const router = express.Router();

// All onboarding endpoints are auth'd and school-scoped. The wizard is
// reached only by self-serve admins, but the route is mounted behind
// `ENABLE_SELF_SIGNUP` in server.js so it stays dormant until that flag
// flips on.
router.use(authenticate);

// GET /api/v1/onboarding/step
// Returns the current wizard step + a few flags the UI uses to decide
// whether to force the wizard (schoolProfileComplete, provisioningStatus).
router.get('/step', async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    if (!schoolId) {
      return res.status(403).json({ error: 'School context required' });
    }
    const status = await getOnboardingStatus(schoolId);
    res.json(status);
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || 'Failed to read onboarding state',
    });
  }
});

// PATCH /api/v1/onboarding/step
// Body: { step, skipped?, data? }
// Validates the transition in the service and persists to
// School.metadata. When step === 'complete' it also flips
// School.provisioning.status to 'ready'.
router.patch('/step', validateZod(updateOnboardingStepSchema), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    if (!schoolId) {
      return res.status(403).json({ error: 'School context required' });
    }
    const { step, skipped, data } = req.body;
    const status = await updateOnboardingStep({
      schoolId,
      actorId: req.user.id || req.user._id,
      step,
      skipped,
      data,
    });
    res.json(status);
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message || 'Failed to update onboarding state',
      code: error.code,
    });
  }
});

export default router;
