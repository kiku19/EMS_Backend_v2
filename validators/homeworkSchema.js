import { z } from 'zod';
import { academicYear, optionalObjectId } from './zodHelpers.js';

// ─── HOMEWORK PAGINATION + STATS QUERY ────────────────────────────────
// PAG-08: list endpoint and stats endpoint share the same filter set so
// the KPI cards on the dashboard can be computed over the same shape the
// user is currently filtering. `page`/`limit` drive server-side pagination
// on GET /homework; the stats endpoint ignores them.

const homeworkStatusEnum = z.enum(['active', 'completed', 'cancelled'], {
  errorMap: () => ({ message: 'Status must be one of: active, completed, cancelled' }),
});

const baseFilters = {
  status: homeworkStatusEnum.optional(),
  classId: optionalObjectId.optional(),
  teacherId: optionalObjectId.optional(),
  academicYear: academicYear.optional(),
  // Free-text search matched against title / subject / description server-side
  // so older homework on later pages is still findable.
  search: z.string().max(100).optional(),
};

export const homeworkListQuerySchema = z
  .object({
    ...baseFilters,
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strip();

export const homeworkStatsQuerySchema = z
  .object({
    ...baseFilters,
  })
  .strip();
