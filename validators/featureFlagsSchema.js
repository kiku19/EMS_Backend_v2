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
    name: z.string().min(1).max(200).trim(),
    description: z.string().max(500).optional().default(''),
    status: statusEnum.default('disabled'),
    minimumPlan: planEnum.default('starter'),
    rolloutPercentage: z.number().int().min(0).max(100).default(0),
    availableFrom: z.coerce.date().nullable().optional(),
    availableUntil: z.coerce.date().nullable().optional(),
    tags: z.array(z.string().trim()).default([]),
  })
  .strip();

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
  })
  .strip();

export const schoolOverrideSchema = z
  .object({
    schoolId: objectId,
    enabled: z.boolean(),
  })
  .strip();
