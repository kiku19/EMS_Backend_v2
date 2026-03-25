/**
 * i18n Infrastructure — i18next configuration
 *
 * Initialises a shared i18next instance with synchronous in-memory resources
 * loaded from /locales/{lng}/{ns}.json. Using createRequire avoids the async
 * complexity of i18next-fs-backend while keeping translations in separate files.
 *
 * Supported languages : en (default), hi
 * Namespaces          : common, auth, validation, academics, attendance, classes, fees, payroll, staff, students
 *
 * Usage in route handlers (request-scoped):
 *   req.t('common:errors.notFound')
 *   req.t('auth:success.login')
 *   req.t('common:success.created', { entity: 'Student' })
 *
 * Usage outside request context (services, jobs):
 *   import { t } from '../utils/translate.js';
 *   t('common:errors.notFound')
 *   t('auth:errors.invalidCredentials', {}, 'hi')
 */

import i18next from 'i18next';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const resources = {
  en: {
    common: require('../locales/en/common.json'),
    auth: require('../locales/en/auth.json'),
    validation: require('../locales/en/validation.json'),
    academics: require('../locales/en/academics.json'),
    attendance: require('../locales/en/attendance.json'),
    classes: require('../locales/en/classes.json'),
    fees: require('../locales/en/fees.json'),
    payroll: require('../locales/en/payroll.json'),
    staff: require('../locales/en/staff.json'),
    students: require('../locales/en/students.json'),
  },
  hi: {
    common: require('../locales/hi/common.json'),
    auth: require('../locales/hi/auth.json'),
    validation: require('../locales/hi/validation.json'),
  },
};

i18next.init({
  // Synchronous init — no async backend needed since resources are inlined
  initImmediate: false,

  // Language settings
  fallbackLng: 'en',
  supportedLngs: ['en', 'hi'],
  defaultNS: 'common',
  ns: [
    'common',
    'auth',
    'validation',
    'academics',
    'attendance',
    'classes',
    'fees',
    'payroll',
    'staff',
    'students',
  ],

  resources,

  interpolation: {
    // Not needed for server-side rendering (no HTML escaping required)
    escapeValue: false,
  },

  // Detect language from Accept-Language header or ?lang= query param
  // (handled by i18next-http-middleware — see middleware/i18n.js)
  detection: {
    order: ['header', 'querystring'],
    lookupHeader: 'accept-language',
    lookupQuerystring: 'lang',
    caches: false,
  },
});

export default i18next;
