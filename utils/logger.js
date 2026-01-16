// Simple logging utility
// Can be replaced with winston or pino in the future

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

const COLORS = {
  ERROR: '\x1b[31m', // Red
  WARN: '\x1b[33m',  // Yellow
  INFO: '\x1b[36m',  // Cyan
  DEBUG: '\x1b[90m', // Gray
  RESET: '\x1b[0m',
};

const currentLogLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? 
  (process.env.NODE_ENV === 'production' ? LOG_LEVELS.INFO : LOG_LEVELS.DEBUG);

/**
 * Format log message with timestamp and level
 */
function formatMessage(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const color = COLORS[level];
  const reset = COLORS.RESET;
  
  let logMessage = `${color}[${timestamp}] [${level}]${reset} ${message}`;
  
  if (Object.keys(meta).length > 0) {
    logMessage += ` ${JSON.stringify(meta)}`;
  }
  
  return logMessage;
}

/**
 * Logger class
 */
class Logger {
  constructor(context = '') {
    this.context = context;
  }

  error(message, meta = {}) {
    if (currentLogLevel >= LOG_LEVELS.ERROR) {
      const contextMeta = this.context ? { context: this.context, ...meta } : meta;
      console.error(formatMessage('ERROR', message, contextMeta));
    }
  }

  warn(message, meta = {}) {
    if (currentLogLevel >= LOG_LEVELS.WARN) {
      const contextMeta = this.context ? { context: this.context, ...meta } : meta;
      console.warn(formatMessage('WARN', message, contextMeta));
    }
  }

  info(message, meta = {}) {
    if (currentLogLevel >= LOG_LEVELS.INFO) {
      const contextMeta = this.context ? { context: this.context, ...meta } : meta;
      console.log(formatMessage('INFO', message, contextMeta));
    }
  }

  debug(message, meta = {}) {
    if (currentLogLevel >= LOG_LEVELS.DEBUG) {
      const contextMeta = this.context ? { context: this.context, ...meta } : meta;
      console.log(formatMessage('DEBUG', message, contextMeta));
    }
  }

  // Alias for backward compatibility
  log(message, meta = {}) {
    this.info(message, meta);
  }
}

// Create default logger
const logger = new Logger();

// Export logger factory
export function createLogger(context) {
  return new Logger(context);
}

// Export default logger
export default logger;

// Export log levels for reference
export { LOG_LEVELS };
