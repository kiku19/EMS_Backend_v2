import { z } from 'zod';
import { optionalString } from './zodHelpers.js';

// ─── EXAM HALL ──────────────────────────────────────────────────
// Mirrors models/ExamHall.js. `benchCapacity` is 1 (single-seater) or 2
// (double-seater). `capacity` is the authoritative student limit; if omitted
// it defaults to rows × columns (one student per bench, per the anti-copy
// rule).
export const createExamHallSchema = z
  .object({
    name: z
      .string()
      .min(2, 'Hall name must be at least 2 characters')
      .max(100, 'Name too long')
      .trim(),
    block: optionalString(100),
    capacity: z.coerce.number().int().min(1, 'Capacity must be at least 1'),
    benchCapacity: z.coerce
      .number()
      .int()
      .refine((v) => v === 1 || v === 2, { message: 'benchCapacity must be 1 or 2' })
      .default(2),
    rows: z.coerce.number().int().min(1).max(50).default(1),
    columns: z.coerce.number().int().min(1).max(50).default(1),
    notes: optionalString(500),
  })
  .strip();

export const updateExamHallSchema = z
  .object({
    name: z.string().min(2, 'Hall name must be at least 2 characters').max(100).trim().optional(),
    block: optionalString(100),
    capacity: z.coerce.number().int().min(1).optional(),
    benchCapacity: z.coerce
      .number()
      .int()
      .refine((v) => v === 1 || v === 2, { message: 'benchCapacity must be 1 or 2' })
      .optional(),
    rows: z.coerce.number().int().min(1).max(50).optional(),
    columns: z.coerce.number().int().min(1).max(50).optional(),
    notes: optionalString(500),
    isActive: z.boolean().optional(),
  })
  .strip();
