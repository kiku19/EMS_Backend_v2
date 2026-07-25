/**
 * Sentry early-instrumentation entry point.
 *
 * Sentry's recommended pattern: this file must be imported FIRST in the
 * application's lifecycle, before any other module (express, mongoose, http,
 * etc.) so the SDK can monkey-patch/AsyncLocalStorage-instrument those modules
 * for request isolation and automatic error capture.
 *
 * The actual config + DSN resolution lives in utils/sentry.js#initSentry (one
 * source of truth). This file just guarantees init runs as early as possible.
 *
 * Import order contract:
 *   start.js  →  import './instrument.js'   ← FIRST (this file)
 *              →  ...all other imports...    ← after
 *
 * See https://docs.sentry.io/platforms/javascript/guides/node/ for the
 * canonical setup this mirrors.
 */

import { initSentry } from './utils/sentry.js';

// dotenv must be loaded before reading process.env.SENTRY_DSN. start.js loads
// dotenv before importing this file, but load it defensively here too so this
// module is safe to import from any entry point.
import dotenv from 'dotenv';
dotenv.config();

initSentry();
