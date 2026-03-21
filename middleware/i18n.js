/**
 * i18n Express middleware
 *
 * Wraps i18next-http-middleware to:
 *   1. Detect the request language from Accept-Language header or ?lang= query param
 *   2. Attach req.t() and req.language to every incoming request
 *
 * Mount this before any route handler that needs localised messages.
 *
 * @example
 *   // In a route handler:
 *   res.status(404).json({ success: false, error: req.t('common:errors.notFound') });
 *   res.json({ success: true, message: req.t('common:success.created', { entity: 'Student' }) });
 */

import i18nextMiddleware from 'i18next-http-middleware';
import i18next from '../config/i18n.js';

export const i18nMiddleware = i18nextMiddleware.handle(i18next, {
  // Do not strip ?lng= from the URL (we use ?lang= instead — see config/i18n.js)
  removeLngFromUrl: false,
});
