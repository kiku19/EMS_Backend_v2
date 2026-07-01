import { z } from 'zod';

// [PAG-32] CommandPalette now also queries books, assets, rooms, routes via /search
// so the palette can find entities beyond the first 50 of each list.
const SEARCH_TYPES = [
  'students',
  'staff',
  'classes',
  'fees',
  'exams',
  'announcements',
  'books',
  'assets',
  'rooms',
  'routes',
];

export const searchQuerySchema = z.object({
  q: z.string().min(1, 'Search query is required').max(200, 'Search query too long').trim(),
  types: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return SEARCH_TYPES; // default to all types
      const parts = val
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return parts.filter((p) => SEARCH_TYPES.includes(p));
    }),
  limit: z
    .string()
    .optional()
    .transform((val) => {
      const n = parseInt(val ?? '10', 10);
      return Math.min(Math.max(Number.isNaN(n) ? 10 : n, 1), 50);
    }),
  page: z
    .string()
    .optional()
    .transform((val) => {
      const n = parseInt(val ?? '1', 10);
      return Math.max(Number.isNaN(n) ? 1 : n, 1);
    }),
  academicYear: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Must be YYYY-YY format')
    .optional(),
});
