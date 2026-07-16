// Environment variable validation and configuration
// Uses Zod for strict type-safe validation. Server fails fast if required vars
// are missing or malformed — no silent production failures.
import { z } from 'zod';
import dotenv from 'dotenv';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Environment');

dotenv.config();

// ── Secret validation helpers ─────────────────────────────────────────────────

const INSECURE_SECRET_VALUES = new Set([
  'your-secret-key-change-in-production',
  'your-secret-key',
  'your-refresh-secret',
  'change-me',
  'changeme',
  'replace-me',
  'replace-with-64-char-random-hex',
  'replace-with-another-64-char-random-hex',
  'replace-with-a-different-64-char-random-hex',
  'replace-with-a-unique-64-char-random-hex',
  'replace-with-64-char-random-hex',
]);

const MIN_SECRET_LENGTH = 64;

function validateSecretValue(varName, value) {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return `Missing required environment variable: ${varName}`;
  }

  if (INSECURE_SECRET_VALUES.has(normalizedValue)) {
    return `${varName} is using an insecure placeholder value. Use a cryptographically random 256-bit secret.`;
  }

  if (normalizedValue.length < MIN_SECRET_LENGTH) {
    return `${varName} must be at least ${MIN_SECRET_LENGTH} characters. Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`;
  }

  return null;
}

// ── Zod schema for all environment variables ──────────────────────────────────

const jwtSecretSchema = z
  .string()
  .min(
    MIN_SECRET_LENGTH,
    `Must be at least ${MIN_SECRET_LENGTH} characters. Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  )
  .refine((val) => !INSECURE_SECRET_VALUES.has(val.trim()), {
    message: 'Using an insecure placeholder value. Replace with a cryptographically random secret.',
  });

const envSchema = z
  .object({
    // ── Server — required ───────────────────────────────────────────────────────
    PORT: z.string().regex(/^\d+$/, 'PORT must be a numeric string (e.g. "3001")'),
    NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
    // Temporary local QA switch; keep false/unset in real deployments.
    DISABLE_AUTH_RATE_LIMITING: z.enum(['true', 'false']).optional(),
    // Optional safety-net switch for local QA/incident response. The
    // per-tenant limiter remains active for authenticated traffic.
    DISABLE_GLOBAL_RATE_LIMITING: z.enum(['true', 'false']).optional(),

    // ── Database — at least one is required (checked in validateEnvironment) ────
    MONGO_URI: z.string().optional(),
    MONGODB_URI: z.string().optional(),

    // ── Auth — required ─────────────────────────────────────────────────────────
    JWT_SECRET: jwtSecretSchema,
    JWT_REFRESH_SECRET: jwtSecretSchema,

    // ── PII encryption — optional (falls back to JWT_SECRET) ───────────────────
    PII_ENCRYPTION_KEY: z
      .string()
      .min(32, 'PII_ENCRYPTION_KEY should be at least 32 characters')
      .optional(),

    // ── Logging — optional ──────────────────────────────────────────────────────
    LOG_LEVEL: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).optional(),

    // ── CORS / URLs — optional ──────────────────────────────────────────────────
    CORS_ORIGIN: z.string().optional(),
    FRONTEND_URL: z.string().optional(),
    PARENT_APP_URL: z.string().optional(),

    // ── App settings — optional ─────────────────────────────────────────────────
    SCHOOL_NAME: z.string().optional(),

    // ── Cloudinary file storage — optional ──────────────────────────────────────
    CLOUDINARY_CLOUD_NAME: z.string().optional(),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_API_SECRET: z.string().optional(),

    // ── Redis — optional (required for multi-instance production) ───────────────
    REDIS_URL: z.string().optional(),
    // Set to 'false' only in staging with self-signed TLS certs (rediss:// URLs)
    REDIS_TLS_REJECT_UNAUTHORIZED: z.enum(['true', 'false']).optional(),

    // ── Email / SMTP — optional ─────────────────────────────────────────────────
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.string().regex(/^\d+$/).optional(),
    SMTP_SECURE: z.enum(['true', 'false']).optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),

    // ── MSG91 SMS & WhatsApp — optional ─────────────────────────────────────────
    MSG91_AUTH_KEY: z.string().optional(),
    MSG91_SENDER_ID: z.string().optional(),
    MSG91_FLOW_ID: z.string().optional(),
    MSG91_COUNTRY: z.string().optional(),
    MSG91_WHATSAPP_ENABLED: z.enum(['true', 'false']).optional(),
    MSG91_WHATSAPP_SENDER_PHONE: z.string().optional(),

    // ── Razorpay payments — optional ────────────────────────────────────────────
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),

    // ── AI providers — optional ─────────────────────────────────────────────────
    GROQ_API_KEY: z.string().optional(),
    GROQ_CHAT_MODEL: z.string().optional(),
    GROQ_TRANSCRIPTION_MODEL: z.string().optional(),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_CHAT_MODEL: z.string().optional(),
    AI_DEFAULT_MODEL_ID: z.string().optional(),

    // ── Agenda background jobs — optional ───────────────────────────────────────
    AGENDA_DB_COLLECTION: z.string().optional(),
    AGENDA_PROCESS_EVERY: z.string().optional(),

    // ── S3 backup — optional ────────────────────────────────────────────────────
    BACKUP_S3_BUCKET: z.string().optional(),
    BACKUP_S3_REGION: z.string().optional(),
    BACKUP_S3_ACCESS_KEY_ID: z.string().optional(),
    BACKUP_S3_SECRET_ACCESS_KEY: z.string().optional(),
    BACKUP_S3_PREFIX: z.string().optional(),
    BACKUP_S3_ENDPOINT: z.string().optional(),
    BACKUP_S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).optional(),

    // ── PeerJS video calling — optional ─────────────────────────────────────────
    PEERJS_PORT: z.string().regex(/^\d+$/).optional(),
    PEERJS_PATH: z.string().optional(),
    STUN_SERVERS: z.string().optional(),
    TURN_SERVER_URL: z.string().optional(),
    TURN_SERVER_USERNAME: z.string().optional(),
    TURN_SERVER_PASSWORD: z.string().optional(),
  })
  .passthrough(); // allow platform-injected vars (Render, Railway, etc.) to pass through

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Read a required secret from process.env, throwing if missing or insecure.
 * Called lazily (per-request) by auth middleware so JWT secrets are available
 * without a full startup dependency on validateEnvironment.
 */
export function getRequiredSecret(varName) {
  const validationError = validateSecretValue(varName, process.env[varName]);

  if (validationError) {
    throw new Error(validationError);
  }

  return process.env[varName].trim();
}

/**
 * Validate all environment variables on server startup.
 * Throws with a descriptive message if any required var is missing or malformed.
 * Logs warnings for optional services that are not configured.
 */
export function validateEnvironment() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const messages = result.error.issues.map(
      (issue) => `  ${issue.path.join('.') || 'env'}: ${issue.message}`
    );
    logger.error('Environment validation failed', { issues: result.error.issues });
    throw new Error(`Environment validation failed:\n${messages.join('\n')}`);
  }

  const env = result.data;

  // Cross-field: require at least one MongoDB URI
  if (!env.MONGO_URI && !env.MONGODB_URI) {
    throw new Error('Environment validation failed:\n  Missing required: MONGO_URI or MONGODB_URI');
  }

  // Production-specific: REDIS_URL is strongly recommended for multi-instance deployments
  if (env.NODE_ENV === 'production' && !env.REDIS_URL) {
    logger.warn(
      'REDIS_URL not set in production. Socket.IO and rate limiting will not share state across multiple instances.'
    );
  }

  // Apply defaults to process.env for code that reads it directly (e.g. config/ai.js)
  if (!process.env.NODE_ENV) process.env.NODE_ENV = 'development';
  if (!process.env.LOG_LEVEL) {
    process.env.LOG_LEVEL = env.NODE_ENV === 'production' ? 'WARN' : 'DEBUG';
  }

  // Warn about optional services not configured
  const warnings = [];

  const cloudinaryConfigured =
    env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET;
  if (!cloudinaryConfigured) {
    warnings.push(
      'Cloudinary not configured. Document and chat-attachment uploads will return 503; only staff profile photos fall back to base64 storage. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.'
    );
  }

  if (!env.SMTP_USER || !env.SMTP_PASS) {
    warnings.push(
      'SMTP not configured. Email features will be unavailable. Set SMTP_USER and SMTP_PASS.'
    );
  }

  if (!env.MSG91_AUTH_KEY) {
    warnings.push('MSG91_AUTH_KEY not set. SMS and WhatsApp notifications will be unavailable.');
  }

  if (!env.GROQ_API_KEY && !env.GEMINI_API_KEY) {
    warnings.push(
      'No AI provider configured (GROQ_API_KEY / GEMINI_API_KEY). AI assistant will be unavailable.'
    );
  }

  warnings.forEach((w) => logger.warn(w));

  logger.info('Environment validation passed', {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    cloudinaryConfigured: Boolean(cloudinaryConfigured),
    redisConfigured: Boolean(env.REDIS_URL),
    emailConfigured: Boolean(env.SMTP_USER && env.SMTP_PASS),
  });

  return true;
}

/**
 * Returns a typed, validated configuration object.
 * Must be called after validateEnvironment() at server startup.
 */
export function getConfig() {
  const defaultLogLevel =
    (process.env.NODE_ENV || 'development') === 'production' ? 'WARN' : 'DEBUG';

  return {
    // Server
    port: parseInt(process.env.PORT, 10) || 3001,
    nodeEnv: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || defaultLogLevel,

    // Database
    mongoUri: process.env.MONGO_URI || process.env.MONGODB_URI,

    // CORS
    corsOrigins: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
      : [
          'http://localhost:3000', // school-dashboard dev
          'http://localhost:8081', // Expo web dev
          'http://localhost:19006', // Expo dev
          'exp://192.168.1.*:19000', // Expo LAN dev
          'http://localhost:5173', // Vite dev server
          'http://localhost:5174', // Alternative Vite port
          'http://localhost:5175', // Alternative Vite port
          'https://lol-sch-draven.vercel.app', // school-dashboard production
        ].concat(process.env.PARENT_APP_URL ? [process.env.PARENT_APP_URL] : []),

    // Cloudinary
    cloudinary: {
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      apiSecret: process.env.CLOUDINARY_API_SECRET,
      configured: !!(
        process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET
      ),
    },

    // Redis
    redisUrl: process.env.REDIS_URL || null,
    redisEnabled: !!process.env.REDIS_URL,

    // Feature flags
    isDevelopment: process.env.NODE_ENV !== 'production',
    isProduction: process.env.NODE_ENV === 'production',
  };
}

// Exported config (populated at module load; always valid after validateEnvironment() passes)
export const config = getConfig();
