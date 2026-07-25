// Sentry early-instrumentation MUST run before any other module so the SDK can
// instrument express/mongoose/http. instrument.js loads dotenv + calls initSentry().
// See ./instrument.js for why this is the first import.
import './instrument.js';

// Validate required environment variables immediately so the process exits
// with a clear error instead of cryptic failures from later imports.
const { validateEnvironment } = await import('./config/environment.js');
validateEnvironment();

const { installConsoleBridge } = await import('./utils/logger.js');
installConsoleBridge();

await import('./server.js');
