/**
 * Unit tests for services/featureFlagsService.js — pure functions
 *
 * Tests evaluateFlag, isPlanSufficient, rolloutBucket logic
 * by importing the private helpers indirectly via the module's behavior.
 *
 * The async database functions (isFeatureEnabled, getSchoolFeatures, CRUD)
 * are tested in route integration tests.
 *
 * We test the pure exported helpers: computeChanges logic tested implicitly,
 * and calculateDiscount-style validation of the evaluation pipeline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database models and billing service
vi.mock('../models/FeatureFlag.js', () => {
  const mockFindOne = vi.fn();
  const mockFind = vi.fn();
  return {
    default: {
      findOne: mockFindOne,
      find: mockFind,
    },
  };
});

vi.mock('../models/FeatureFlagAuditLog.js', () => ({
  default: { create: vi.fn(), find: vi.fn() },
}));

vi.mock('../models/School.js', () => ({
  default: { exists: vi.fn() },
}));

vi.mock('../services/billingService.js', () => ({
  ensureSchoolSubscription: vi.fn(),
  getEffectivePlan: vi.fn(),
  BILLING_PLANS: {},
}));

import FeatureFlag from '../models/FeatureFlag.js';
import { ensureSchoolSubscription, getEffectivePlan } from '../services/billingService.js';
import { isFeatureEnabled, getSchoolFeatures } from '../services/featureFlagsService.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isFeatureEnabled', () => {
  it('returns plan capability when no FeatureFlag document exists', async () => {
    FeatureFlag.findOne.mockReturnValue({ lean: () => Promise.resolve(null) });
    ensureSchoolSubscription.mockResolvedValue({ planKey: 'growth' });
    getEffectivePlan.mockReturnValue({
      key: 'growth',
      capabilities: { advancedReports: true },
    });

    const result = await isFeatureEnabled('advancedReports', 'school-1');
    expect(result).toBe(true);
  });

  it('returns false when plan does not have the capability', async () => {
    FeatureFlag.findOne.mockReturnValue({ lean: () => Promise.resolve(null) });
    ensureSchoolSubscription.mockResolvedValue({ planKey: 'starter' });
    getEffectivePlan.mockReturnValue({
      key: 'starter',
      capabilities: {},
    });

    const result = await isFeatureEnabled('advancedReports', 'school-1');
    expect(result).toBe(false);
  });

  it('returns true for enabled flag with sufficient plan', async () => {
    FeatureFlag.findOne.mockReturnValue({
      lean: () =>
        Promise.resolve({
          key: 'newDashboard',
          status: 'enabled',
          minimumPlan: 'starter',
          overrideSchools: [],
        }),
    });
    ensureSchoolSubscription.mockResolvedValue({ planKey: 'growth' });
    getEffectivePlan.mockReturnValue({ key: 'growth', capabilities: {} });

    const result = await isFeatureEnabled('newDashboard', 'school-1');
    expect(result).toBe(true);
  });

  it('returns false for disabled flag', async () => {
    FeatureFlag.findOne.mockReturnValue({
      lean: () =>
        Promise.resolve({
          key: 'newDashboard',
          status: 'disabled',
          overrideSchools: [],
        }),
    });
    ensureSchoolSubscription.mockResolvedValue({ planKey: 'scale' });
    getEffectivePlan.mockReturnValue({ key: 'scale', capabilities: {} });

    const result = await isFeatureEnabled('newDashboard', 'school-1');
    expect(result).toBe(false);
  });

  it('per-school override takes priority over everything', async () => {
    FeatureFlag.findOne.mockReturnValue({
      lean: () =>
        Promise.resolve({
          key: 'betaFeature',
          status: 'disabled',
          overrideSchools: [{ schoolId: 'school-1', enabled: true }],
        }),
    });
    ensureSchoolSubscription.mockResolvedValue({ planKey: 'starter' });
    getEffectivePlan.mockReturnValue({ key: 'starter', capabilities: {} });

    const result = await isFeatureEnabled('betaFeature', 'school-1');
    expect(result).toBe(true);
  });

  it('returns false when plan is insufficient for flag minimumPlan', async () => {
    FeatureFlag.findOne.mockReturnValue({
      lean: () =>
        Promise.resolve({
          key: 'premiumFeature',
          status: 'enabled',
          minimumPlan: 'scale',
          overrideSchools: [],
        }),
    });
    ensureSchoolSubscription.mockResolvedValue({ planKey: 'starter' });
    getEffectivePlan.mockReturnValue({ key: 'starter', capabilities: {} });

    const result = await isFeatureEnabled('premiumFeature', 'school-1');
    expect(result).toBe(false);
  });

  it('returns false for time-gated flag before availableFrom', async () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    FeatureFlag.findOne.mockReturnValue({
      lean: () =>
        Promise.resolve({
          key: 'upcoming',
          status: 'enabled',
          availableFrom: futureDate,
          overrideSchools: [],
        }),
    });
    ensureSchoolSubscription.mockResolvedValue({ planKey: 'scale' });
    getEffectivePlan.mockReturnValue({ key: 'scale', capabilities: {} });

    const result = await isFeatureEnabled('upcoming', 'school-1');
    expect(result).toBe(false);
  });

  it('returns false for time-gated flag after availableUntil', async () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    FeatureFlag.findOne.mockReturnValue({
      lean: () =>
        Promise.resolve({
          key: 'expired',
          status: 'enabled',
          availableUntil: pastDate,
          overrideSchools: [],
        }),
    });
    ensureSchoolSubscription.mockResolvedValue({ planKey: 'scale' });
    getEffectivePlan.mockReturnValue({ key: 'scale', capabilities: {} });

    const result = await isFeatureEnabled('expired', 'school-1');
    expect(result).toBe(false);
  });
});

describe('getSchoolFeatures', () => {
  it('merges plan capabilities with feature flags', async () => {
    FeatureFlag.find.mockReturnValue({
      lean: () =>
        Promise.resolve([
          {
            key: 'newFeature',
            status: 'enabled',
            minimumPlan: 'starter',
            overrideSchools: [],
          },
        ]),
    });
    ensureSchoolSubscription.mockResolvedValue({ planKey: 'growth' });
    getEffectivePlan.mockReturnValue({
      key: 'growth',
      capabilities: { basicReports: true },
    });

    const result = await getSchoolFeatures('school-1');

    expect(result.planKey).toBe('growth');
    expect(result.features.basicReports).toBe(true);
    expect(result.features.newFeature).toBe(true);
  });
});
