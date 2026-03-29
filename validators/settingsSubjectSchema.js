import { z } from 'zod';
import { optionalString } from './zodHelpers.js';

// ─── CREATE SUBJECT ─────────────────────────────────────────────
export const createSubjectSchema = z
  .object({
    name: z.string().min(1, 'Subject name is required').max(100).trim(),
    code: z.string().min(1, 'Subject code is required').max(20).trim(),
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
    code: z.string().min(1, 'Subject code is required').max(20).trim().optional(),
    description: optionalString(500),
    assignedClasses: z.array(z.number().int().min(1).max(12)).optional(),
  })
  .strip();
