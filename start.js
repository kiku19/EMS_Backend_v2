import dotenv from 'dotenv';
import { installConsoleBridge } from './utils/logger.js';
import { initSentry } from './utils/sentry.js';

dotenv.config();
installConsoleBridge();

// Must be initialized before server.js imports express/mongoose so Sentry
// can instrument those modules via AsyncLocalStorage request isolation.
initSentry();

await import('./server.js');
