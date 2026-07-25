import { z } from 'zod';
import { optionalString } from './zodHelpers.js';

// ─── CREATE SUBJECT ─────────────────────────────────────────────
export const createSubjectSchema = z
  .object({
    name: z.string().min(1, 'Subject name is required').max(100).trim(),
    code: z.string().max(20, 'Subject code must not exceed 20 characters').trim().optional(),
    description: optionalString(500),
    assignedClasses: z
      .array(
        z
          .number()
          .int()
          .min(1, 'Class must be between 1 and 12')
          .max(12, 'Class must be between 1 and 12')
      )
      .default([]),
  })
  .strip();

// ─── UPDATE SUBJECT ─────────────────────────────────────────────
export const updateSubjectSchema = z
  .object({
    name: z.string().min(1, 'Subject name is required').max(100).trim().optional(),
    code: z.string().max(20, 'Subject code must not exceed 20 characters').trim().optional(),
    description: optionalString(500),
    assignedClasses: z.array(z.number().int().min(1).max(12)).optional(),
  })
  .strip();

// ─── IMPORT CURRICULUM ──────────────────────────────────────────
// Pulls a bundled curriculum's subjects into the master subject directory.
// `grades` is optional — when omitted the curriculum is applied to grades 1-12.
export const importCurriculumSchema = z
  .object({
    curriculumId: z.string().min(1, 'Curriculum id is required').trim(),
    grades: z
      .array(
        z
          .number()
          .int()
          .min(1, 'Class must be between 1 and 12')
          .max(12, 'Class must be between 1 and 12')
      )
      .optional(),
  })
  .strip();
