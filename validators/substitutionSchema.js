import { z } from 'zod';
import { objectIdString } from './zodHelpers.js';

// --- Create substitution ---
export const createSubstitutionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format'),
  classId: objectIdString,
  period: z.string().min(1, 'Period is required'),
  absentTeacherId: objectIdString.optional(),
  substituteTeacherId: objectIdString,
  reason: z.string().max(500).optional(),
  type: z.enum(['auto', 'manual']).optional().default('manual'),
  status: z.enum(['pending', 'confirmed', 'completed', 'declined']).optional().default('confirmed'),
  notes: z.string().max(1000).optional(),
}).strip();

// --- Update substitution ---
export const updateSubstitutionSchema = z.object({
  substituteTeacherId: objectIdString.optional(),
  status: z.enum(['pending', 'confirmed', 'completed', 'declined']).optional(),
  teacherResponse: z.enum(['pending', 'accepted', 'declined']).optional(),
  reason: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
}).strip();

// --- Bulk assign substitutions ---
export const bulkAssignSchema = z.object({
  substitutions: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
      classId: objectIdString,
      period: z.string().min(1),
      substituteTeacherId: objectIdString,
      reason: z.string().max(500).optional(),
    }).strip()
  ).min(1, 'At least one substitution is required').max(50),
}).strip();

// --- Query by date ---
export const substitutionDateQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['pending', 'confirmed', 'completed', 'declined']).optional(),
}).strip();
