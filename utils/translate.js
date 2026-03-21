/**
 * Server-side translation helper
 *
 * Use this for translations outside of a request context — e.g. background
 * jobs, email templates, scheduled tasks, and service-layer code.
 *
 * For request-scoped translation always prefer req.t(), which automatically
 * uses the caller's detected language.
 *
 * @example
 *   import { t } from '../utils/translate.js';
 *
 *   // English (default)
 *   t('common:errors.notFound')
 *   // => "Resource not found"
 *
 *   // Hindi
 *   t('auth:errors.invalidCredentials', {}, 'hi')
 *   // => "गलत ईमेल/फोन या पासवर्ड"
 *
 *   // With interpolation
 *   t('common:success.created', { entity: 'Student' })
 *   // => "Student created successfully"
 */

import i18next from '../config/i18n.js';

/**
 * Translate a key outside of a request context.
 *
 * @param {string} key       - Translation key, e.g. 'common:errors.notFound'
 * @param {Object} [options] - Interpolation variables, e.g. { entity: 'Student' }
 * @param {string} [lng]     - Language code ('en' | 'hi'). Defaults to 'en'.
 * @returns {string}
 */
export function t(key, options = {}, lng = 'en') {
  return i18next.t(key, { lng, ...options });
}

export default t;
