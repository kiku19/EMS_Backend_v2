import { z } from 'zod';
import { objectId, optionalString } from './zodHelpers.js';

const planEnum = z.enum(['starter', 'growth', 'scale']);
const planStatusEnum = z.enum(['trialing', 'active', 'past_due', 'cancelled']);

// ─── CREATE SCHOOL ────────────────────────────────────────────────
export const superAdminCreateSchoolSchema = z
  .object({
    schoolName: z
      .string()
      .min(2, 'School name must be at least 2 characters')
      .max(200, 'School name must not exceed 200 characters')
      .trim(),
    schoolCode: optionalString(40),
    contactEmail: z
      .string()
      .email('Contact email must be a valid email address')
      .nullish()
      .or(z.literal('')),
    contactPhone: optionalString(20),
    plan: planEnum.default('starter'),
    planStatus: planStatusEnum.default('trialing'),
    trialEndsAt: z.coerce
      .date({ invalid_type_error: 'Trial end date must be a valid date' })
      .nullable()
      .optional(),
    frontendUrl: z.string().url('Frontend URL must be a valid URL').nullish().or(z.literal('')),
    backendUrl: z.string().url('Backend URL must be a valid URL').nullish().or(z.literal('')),
    adminName: z
      .string()
      .min(2, 'Admin name must be at least 2 characters')
      .max(100, 'Admin name must not exceed 100 characters')
      .trim(),
    adminEmail: z.string().email('Admin email must be a valid email address'),
    adminPassword: z
      .string()
      .min(8, 'Admin password must be at least 8 characters')
      .max(50, 'Admin password must not exceed 50 characters')
      .nullish()
      .or(z.literal('')),
    schoolSettings: z.record(z.string(), z.unknown()).default({}),
  })
  .strip();

// ─── UPDATE SCHOOL (all fields optional) ─────────────────────────
export const superAdminUpdateSchoolSchema = z
  .object({
    schoolName: z
      .string()
      .min(2, 'School name must be at least 2 characters')
      .max(200, 'School name must not exceed 200 characters')
      .trim()
      .optional(),
    schoolCode: optionalString(40),
    status: z.enum(['active', 'inactive']).optional(),
    contactEmail: z
      .string()
      .email('Contact email must be a valid email address')
      .nullish()
      .or(z.literal('')),
    contactPhone: optionalString(20),
    plan: planEnum.optional(),
    planStatus: planStatusEnum.optional(),
    trialEndsAt: z.coerce
      .date({ invalid_type_error: 'Trial end date must be a valid date' })
      .nullable()
      .optional(),
    frontendUrl: z.string().url('Frontend URL must be a valid URL').nullish().or(z.literal('')),
    backendUrl: z.string().url('Backend URL must be a valid URL').nullish().or(z.literal('')),
  })
  .strip();

// ─── PROVISION SCHOOL (all fields optional) ───────────────────────
export const superAdminProvisionSchoolSchema = z
  .object({
    adminName: z
      .string()
      .min(2, 'Admin name must be at least 2 characters')
      .max(100, 'Admin name must not exceed 100 characters')
      .trim()
      .nullish()
      .or(z.literal('')),
    adminEmail: z
      .string()
      .email('Admin email must be a valid email address')
      .nullish()
      .or(z.literal('')),
    adminPassword: z
      .string()
      .min(8, 'Admin password must be at least 8 characters')
      .max(50, 'Admin password must not exceed 50 characters')
      .nullish()
      .or(z.literal('')),
    contactPhone: optionalString(20),
    schoolSettings: z.record(z.string(), z.unknown()).default({}),
  })
  .strip();

// ─── MONGO ID PARAM ───────────────────────────────────────────────
export const mongoIdParamSchema = z.object({
  id: objectId,
});
