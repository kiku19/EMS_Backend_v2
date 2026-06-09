import { z } from 'zod';
import { objectId } from './zodHelpers.js';

const planEnum = z.enum(['starter', 'growth', 'scale']);
const statusEnum = z.enum(['enabled', 'disabled', 'rollout']);

export const createFeatureFlagSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(100)
      .regex(
        /^[a-zA-Z][a-zA-Z0-9_]*$/,
        'Key must start with a letter and contain only alphanumeric characters or underscores'
      )
      .trim(),
    name: z.string().min(1).max(200).trim().optional(),
    description: z.string().max(500).optional().default(''),
    status: statusEnum.default('disabled'),
    minimumPlan: planEnum.default('starter'),
    rolloutPercentage: z.number().int().min(0).max(100).default(0),
    availableFrom: z.coerce.date().nullable().optional(),
    availableUntil: z.coerce.date().nullable().optional(),
    tags: z.array(z.string().trim()).default([]),
    // Frontend aliases (super-admin panel uses these field names)
    defaultEnabled: z.boolean().optional(),
    plan: planEnum.optional(),
  })
  .strip()
  .transform((data) => {
    const transformed = { ...data };
    // Use key as fallback name when not provided (frontend super-admin panel omits name)
    if (!transformed.name) {
      transformed.name = transformed.key;
    }
    // Map frontend defaultEnabled → backend status
    if (transformed.defaultEnabled !== undefined) {
      transformed.status = transformed.defaultEnabled ? 'enabled' : 'disabled';
      delete transformed.defaultEnabled;
    }
    // Map frontend plan → backend minimumPlan
    if (transformed.plan !== undefined) {
      transformed.minimumPlan = transformed.plan;
      delete transformed.plan;
    }
    return transformed;
  });

export const updateFeatureFlagSchema = z
  .object({
    name: z.string().min(1).max(200).trim().optional(),
    description: z.string().max(500).optional(),
    status: statusEnum.optional(),
    minimumPlan: planEnum.optional(),
    rolloutPercentage: z.number().int().min(0).max(100).optional(),
    availableFrom: z.coerce.date().nullable().optional(),
    availableUntil: z.coerce.date().nullable().optional(),
    tags: z.array(z.string().trim()).optional(),
    // Frontend aliases (super-admin panel uses these field names)
    defaultEnabled: z.boolean().optional(),
    plan: planEnum.optional(),
  })
  .strip()
  .transform((data) => {
    const transformed = { ...data };
    // Map frontend defaultEnabled → backend status
    if (transformed.defaultEnabled !== undefined) {
      transformed.status = transformed.defaultEnabled ? 'enabled' : 'disabled';
      delete transformed.defaultEnabled;
    }
    // Map frontend plan → backend minimumPlan
    if (transformed.plan !== undefined) {
      transformed.minimumPlan = transformed.plan;
      delete transformed.plan;
    }
    return transformed;
  });

export const schoolOverrideSchema = z
  .object({
    schoolId: objectId,
    enabled: z.boolean(),
  })
  .strip();
