import { z } from 'zod';
import { objectId } from './zodHelpers.js';

// Query params for listing hall ticket students
export const hallTicketQuerySchema = z
  .object({
    classId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid 24-character ID')
      .optional(),
    academicYear: z
      .string()
      .regex(/^\d{4}-\d{2}$/, 'Academic year must be in YYYY-YY format')
      .optional(),
  })
  .strip();
