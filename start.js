import dotenv from 'dotenv';

// Load .env before any other module so validation sees the real values.
dotenv.config();

// Validate required environment variables immediately so the process exits
// with a clear error instead of cryptic failures from later imports.
const { validateEnvironment } = await import('./config/environment.js');
validateEnvironment();

const { installConsoleBridge } = await import('./utils/logger.js');
installConsoleBridge();

const { initSentry } = await import('./utils/sentry.js');
// Must be initialized before server.js imports express/mongoose so Sentry
// can instrument those modules via AsyncLocalStorage request isolation.
initSentry();

await import('./server.js');
