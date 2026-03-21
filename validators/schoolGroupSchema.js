import { z } from 'zod';
import { objectId, optionalString } from './zodHelpers.js';

const planEnum = z.enum(['starter', 'growth', 'enterprise']);
const planStatusEnum = z.enum(['trialing', 'active', 'past_due', 'cancelled']);

// ─── CREATE SCHOOL GROUP ──────────────────────────────────────────
export const createSchoolGroupSchema = z
  .object({
    name: z.string().min(2).max(200).trim(),
    code: optionalString(40),
    status: z.enum(['active', 'inactive']).default('active'),
    plan: planEnum.default('enterprise'),
    planStatus: planStatusEnum.default('trialing'),
    contactEmail: z.string().email().nullish().or(z.literal('')),
    contactPhone: optionalString(20),
    billingContactName: optionalString(100),
    billingEmail: z.string().email().nullish().or(z.literal('')),
    billingPhone: optionalString(20),
    sharedFeeTemplates: z.boolean().default(false),
  })
  .strip();

// ─── UPDATE SCHOOL GROUP (all fields optional) ────────────────────
export const updateSchoolGroupSchema = z
  .object({
    name: z.string().min(2).max(200).trim().optional(),
    code: optionalString(40),
    status: z.enum(['active', 'inactive']).optional(),
    plan: planEnum.optional(),
    planStatus: planStatusEnum.optional(),
    contactEmail: z.string().email().nullish().or(z.literal('')),
    contactPhone: optionalString(20),
    billingContactName: optionalString(100),
    billingEmail: z.string().email().nullish().or(z.literal('')),
    billingPhone: optionalString(20),
    sharedFeeTemplates: z.boolean().optional(),
  })
  .strip();

// ─── ADD / REMOVE BRANCH — PARAMS (schoolId from URL, never body) ─
export const groupBranchParamsSchema = z.object({
  id: objectId,
  schoolId: objectId,
});

// ─── TRANSFER STUDENT BETWEEN BRANCHES ───────────────────────────
export const transferStudentSchema = z
  .object({
    studentId: objectId,
    fromSchoolId: objectId,
    toSchoolId: objectId,
    reason: z.string().max(500).optional(),
  })
  .strip();

// ─── ASSIGN / REMOVE STAFF FROM ADDITIONAL BRANCH ────────────────
export const staffBranchAssignmentSchema = z
  .object({
    staffId: objectId,
    targetSchoolId: objectId,
  })
  .strip();

// ─── WHITE-LABEL SETTINGS FOR GROUP ──────────────────────────────
const hexColorRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const domainRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

export const updateGroupWhiteLabelSchema = z
  .object({
    enabled: z.boolean().optional(),
    customDomain: z
      .string()
      .refine((v) => v === '' || domainRegex.test(v), {
        message: 'Must be a valid domain (e.g. portal.acme.edu)',
      })
      .optional(),
    branding: z
      .object({
        appName: z.string().max(100).optional(),
        logo: z.string().optional(),
        favicon: z.string().optional(),
        primaryColor: z.string().regex(hexColorRegex, 'Must be a valid hex color').optional(),
        secondaryColor: z.string().regex(hexColorRegex, 'Must be a valid hex color').optional(),
      })
      .optional(),
  })
  .strip();

// ─── CREATE GROUP-LEVEL FEE TEMPLATE ─────────────────────────────
export const groupFeeTemplateSchema = z
  .object({
    name: z.string().min(1).max(200).trim(),
    description: z.string().max(500).optional(),
    section: z.string().min(1).max(100).trim(),
    totalAnnualFee: z.number().min(0),
    academicYear: z.string().optional(),
    isActive: z.boolean().default(true),
    applicableFor: z
      .array(
        z.object({
          classGrade: z.string().optional(),
          applicable: z.boolean().optional(),
        })
      )
      .optional(),
    feeHeads: z
      .array(
        z.object({
          name: z.string().min(1),
          category: z
            .enum(['Academic', 'Transport', 'Extra-curricular', 'Hostel', 'Other'])
            .default('Academic'),
          amount: z.number().min(0),
          frequency: z
            .enum(['monthly', 'quarterly', 'term', 'yearly', 'one-time'])
            .default('yearly'),
          mandatory: z.boolean().default(true),
          applicableTerms: z.array(z.number()).optional(),
          dueDay: z.number().min(1).max(31).default(10),
          refundable: z.boolean().default(false),
        })
      )
      .optional(),
    discounts: z
      .array(
        z.object({
          name: z.string().optional(),
          percentage: z.number().min(0).max(100).optional(),
          conditions: z.string().optional(),
        })
      )
      .optional(),
  })
  .strip();
