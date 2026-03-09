import pino from 'pino';

const VALID_LOG_LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace']);
const REDACTED_VALUE = '[REDACTED]';
const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'cookies',
  'password',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'apiSecret',
  'jwt',
]);

let consoleBridgeInstalled = false;

function resolveLogLevel() {
  const configuredLevel = process.env.LOG_LEVEL?.toLowerCase();
  if (configuredLevel && VALID_LOG_LEVELS.has(configuredLevel)) {
    return configuredLevel;
  }

  return process.env.NODE_ENV === 'production' ? 'warn' : 'debug';
}

function sanitizeString(value) {
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, `$1${REDACTED_VALUE}`)
    .replace(
      /((?:token|access[_-]?token|refresh[_-]?token|authorization|cookie|set-cookie|password)\s*[:=]\s*)([^\s,;]+)/gi,
      `$1${REDACTED_VALUE}`
    );
}

function sanitizeValue(value, seen = new WeakSet()) {
  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message),
      stack: value.stack ? sanitizeString(value.stack) : undefined,
    };
  }

  if (Buffer.isBuffer(value)) {
    return `[Buffer ${value.length} bytes]`;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.add(value);

    return Object.entries(value).reduce((result, [key, entryValue]) => {
      if (SENSITIVE_KEYS.has(key)) {
        result[key] = REDACTED_VALUE;
        return result;
      }

      result[key] = sanitizeValue(entryValue, seen);
      return result;
    }, {});
  }

  return String(value);
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function stringifyValue(value) {
  if (typeof value === 'string') {
    return value;
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildTransport() {
  if (process.env.NODE_ENV === 'production' || process.env.LOG_PRETTY === 'false') {
    return undefined;
  }

  return pino.transport({
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  });
}

function wrapLogMethod(instance, level) {
  const originalMethod = instance[level].bind(instance);

  instance[level] = (messageOrObject, meta, ...args) => {
    if (typeof messageOrObject === 'string') {
      const sanitizedMessage = sanitizeString(messageOrObject);

      if (meta === undefined) {
        return originalMethod(sanitizedMessage, ...args.map((arg) => sanitizeValue(arg)));
      }

      if (isPlainObject(meta)) {
        return originalMethod(
          sanitizeValue(meta),
          sanitizedMessage,
          ...args.map((arg) => sanitizeValue(arg))
        );
      }

      return originalMethod(
        sanitizedMessage,
        sanitizeValue(meta),
        ...args.map((arg) => sanitizeValue(arg))
      );
    }

    if (messageOrObject instanceof Error) {
      return originalMethod(
        { err: sanitizeValue(messageOrObject) },
        typeof meta === 'string' ? sanitizeString(meta) : meta,
        ...args.map((arg) => sanitizeValue(arg))
      );
    }

    return originalMethod(
      sanitizeValue(messageOrObject),
      typeof meta === 'string' ? sanitizeString(meta) : sanitizeValue(meta),
      ...args.map((arg) => sanitizeValue(arg))
    );
  };
}

function addLogAlias(instance) {
  ['fatal', 'error', 'warn', 'info', 'debug', 'trace'].forEach((level) => {
    wrapLogMethod(instance, level);
  });
  instance.log = instance.info.bind(instance);
  return instance;
}

function logConsoleCall(instance, level, args) {
  const sanitizedArgs = args.map((arg) => sanitizeValue(arg));
  const [firstArg, ...restArgs] = sanitizedArgs;

  if (typeof firstArg === 'string') {
    if (restArgs.length === 0) {
      instance[level](firstArg);
      return;
    }

    if (restArgs.length === 1 && isPlainObject(restArgs[0])) {
      instance[level](restArgs[0], firstArg);
      return;
    }

    if (restArgs.every((arg) => !isPlainObject(arg) && !Array.isArray(arg))) {
      instance[level](`${firstArg} ${restArgs.map(stringifyValue).join(' ')}`.trim());
      return;
    }

    instance[level]({ args: restArgs }, firstArg);
    return;
  }

  if (sanitizedArgs.length === 1) {
    if (isPlainObject(firstArg)) {
      instance[level](firstArg);
      return;
    }

    instance[level](stringifyValue(firstArg));
    return;
  }

  instance[level]({ args: sanitizedArgs }, 'console output');
}

const rootLogger = addLogAlias(
  pino(
    {
      level: resolveLogLevel(),
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label.toUpperCase() }),
      },
      serializers: {
        err: pino.stdSerializers.err,
      },
    },
    buildTransport()
  )
);

export function createLogger(context) {
  return addLogAlias(rootLogger.child({ context }));
}

export function installConsoleBridge() {
  if (consoleBridgeInstalled) {
    return;
  }

  consoleBridgeInstalled = true;

  console.log = (...args) => logConsoleCall(rootLogger, 'debug', args);
  console.debug = (...args) => logConsoleCall(rootLogger, 'debug', args);
  console.info = (...args) => logConsoleCall(rootLogger, 'info', args);
  console.warn = (...args) => logConsoleCall(rootLogger, 'warn', args);
  console.error = (...args) => logConsoleCall(rootLogger, 'error', args);
}

export { sanitizeValue };
export default rootLogger;
