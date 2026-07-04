/**
 * Canonical pagination helpers — the single source of truth for every
 * paginated list endpoint in EMS-backend.
 *
 * Goal: one response envelope shape across every list route, so the dashboard
 * can stop hand-mapping six different shapes and just read `pagination` +
 * `aggregates` off any response.
 *
 * Canonical envelope (returned by `buildPaginationResponse`):
 *   {
 *     data: [...],
 *     pagination: {
 *       currentPage, totalPages, totalItems, itemsPerPage,
 *       hasNextPage, hasPrevPage,
 *     },
 *     aggregates: { ... }   // optional, endpoint-specific global stats
 *   }
 *
 * `limit: 0` is the documented "no pagination" opt-in (returns every match,
 * reports `totalPages: 1`). It is preserved for the few endpoints that
 * already expose it (students list, front-desk admissions) so internal/bulk
 * consumers keep working. New endpoints SHOULD NOT advertise it.
 */

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

/**
 * Parse a request's pagination query params into a normalized descriptor.
 *
 * Accepts `page` and `limit` as strings or numbers (query strings arrive as
 * strings). Applies the same clamping rules every route already used
 * ad-hoc: `page` ≥ 1, `limit` clamped to [1, MAX_PAGE_SIZE], and `limit: 0`
 * means "no pagination" (return all matches).
 *
 * @param {object} query         req.query (or a manual object)
 * @param {object} [opts]
 * @param {number} [opts.defaultLimit=50]
 * @param {number} [opts.maxLimit=100]
 * @returns {{ page: number, limit: number, skip: number, noPagination: boolean }}
 */
export function parsePaginationQuery(query = {}, opts = {}) {
  const defaultLimit = opts.defaultLimit ?? DEFAULT_PAGE_SIZE;
  const maxLimit = opts.maxLimit ?? MAX_PAGE_SIZE;

  const rawLimit = parseInt(query?.limit, 10);
  const noPagination = rawLimit === 0;

  if (noPagination) {
    return { page: 1, limit: 0, skip: 0, noPagination: true };
  }

  const pageNum = Math.max(parseInt(query?.page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(rawLimit || defaultLimit, 1), maxLimit);
  const skip = (pageNum - 1) * limitNum;

  return { page: pageNum, limit: limitNum, skip, noPagination: false };
}

/**
 * Build the canonical pagination metadata object from raw counts.
 *
 * @param {object} args
 * @param {number} args.page         1-indexed current page
 * @param {number} args.limit        items per page (use the clamped value)
 * @param {number} args.total        total matching items (full set, not the page)
 * @param {boolean} [args.noPagination]  when true, reports totalPages:1
 * @returns {{currentPage,totalPages,totalItems,itemsPerPage,hasNextPage,hasPrevPage}}
 */
export function buildPaginationMeta({ page, limit, total, noPagination = false }) {
  const totalItems = Number(total) || 0;
  if (noPagination) {
    return {
      currentPage: 1,
      totalPages: 1,
      totalItems,
      itemsPerPage: totalItems,
      hasNextPage: false,
      hasPrevPage: false,
    };
  }
  const itemsPerPage = limit;
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  return {
    currentPage: page,
    totalPages,
    totalItems,
    itemsPerPage,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

/**
 * Build the full canonical list response envelope.
 *
 * @param {object} args
 * @param {Array}   args.data         the page of rows to return
 * @param {number}  args.page         1-indexed current page
 * @param {number}  args.limit        items per page (clamped)
 * @param {number}  args.total        total matching items
 * @param {boolean} [args.noPagination]
 * @param {object} [args.aggregates]  optional global stats (dues, avgAttendance, …)
 * @param {object} [args.extra]       optional extra top-level fields to merge
 *                                    (e.g. { statusCounts, facets }) for
 *                                    endpoints that already return them
 */
export function buildPaginationResponse({
  data,
  page,
  limit,
  total,
  noPagination = false,
  aggregates,
  extra = {},
}) {
  const pagination = buildPaginationMeta({ page, limit, total, noPagination });
  const response = { data, pagination };
  if (aggregates !== undefined) response.aggregates = aggregates;
  return { ...response, ...extra };
}
