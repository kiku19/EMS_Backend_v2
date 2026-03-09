// Environment variable validation and configuration
import dotenv from 'dotenv';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Environment');

function getDefaultLogLevel() {
  return (process.env.NODE_ENV || 'development') === 'production' ? 'WARN' : 'DEBUG';
}

// Load environment variables
dotenv.config();

/**
 * Required environment variables
 * Note: MONGO_URI can also be MONGODB_URI (Render uses MONGODB_URI)
 */
const REQUIRED_ENV_VARS = [
  'PORT',
];

const REQUIRED_SECRET_VARS = [
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
];

const INSECURE_SECRET_VALUES = new Set([
  'your-secret-key-change-in-production',
  'your-secret-key',
  'your-refresh-secret',
  'change-me',
  'changeme',
  'replace-me',
]);

const MIN_SECRET_LENGTH = 32;

/**
 * Optional environment variables with defaults
 */
const OPTIONAL_ENV_VARS = {
  NODE_ENV: 'development',
  CORS_ORIGIN: 'http://localhost:3000,http://localhost:8081,http://localhost:19006,exp://192.168.1.*:19000,http://192.168.1.*:3001,http://localhost:5173,http://localhost:5174,http://localhost:5175',
};

/**
 * Cloudinary variables (optional but recommended)
 */
const CLOUDINARY_VARS = [
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
];

function validateSecretValue(varName, value) {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return `Missing required environment variable: ${varName}`;
  }

  if (INSECURE_SECRET_VALUES.has(normalizedValue)) {
    return `${varName} is using an insecure placeholder value. Use a cryptographically random 256-bit secret.`;
  }

  if (normalizedValue.length < MIN_SECRET_LENGTH) {
    return `${varName} must be at least ${MIN_SECRET_LENGTH} characters. Use a cryptographically random 256-bit secret.`;
  }

  return null;
}

export function getRequiredSecret(varName) {
  const validationError = validateSecretValue(varName, process.env[varName]);

  if (validationError) {
    throw new Error(validationError);
  }

  return process.env[varName].trim();
}

/**
 * Validate environment variables
 */
export function validateEnvironment() {
  const errors = [];
  const warnings = [];

  // Check required variables
  for (const varName of REQUIRED_ENV_VARS) {
    if (!process.env[varName]) {
      errors.push(`Missing required environment variable: ${varName}`);
    }
  }

  // Check for MongoDB URI (either MONGO_URI or MONGODB_URI)
  if (!process.env.MONGO_URI && !process.env.MONGODB_URI) {
    errors.push('Missing required environment variable: MONGO_URI or MONGODB_URI');
  }

  // Check required secrets
  for (const varName of REQUIRED_SECRET_VARS) {
    const validationError = validateSecretValue(varName, process.env[varName]);
    if (validationError) {
      errors.push(validationError);
    }
  }

  // Check optional variables and set defaults
  for (const [varName, defaultValue] of Object.entries(OPTIONAL_ENV_VARS)) {
    if (!process.env[varName]) {
      process.env[varName] = defaultValue;
      warnings.push(`Using default for ${varName}: ${defaultValue}`);
    }
  }

  if (!process.env.LOG_LEVEL) {
    process.env.LOG_LEVEL = getDefaultLogLevel();
    warnings.push(`Using default for LOG_LEVEL: ${process.env.LOG_LEVEL}`);
  }

  // Check Cloudinary variables (warn if missing)
  const missingCloudinary = CLOUDINARY_VARS.filter(v => !process.env[v]);
  if (missingCloudinary.length > 0) {
    warnings.push(`Cloudinary not configured. File uploads will use base64 fallback. Missing: ${missingCloudinary.join(', ')}`);
  }

  // Log warnings
  warnings.forEach(warning => logger.warn(warning));

  // Throw error if required variables are missing
  if (errors.length > 0) {
    logger.error('Environment validation failed', { errors });
    throw new Error(`Environment validation failed:\n${errors.join('\n')}`);
  }

  logger.info('Environment validation passed', {
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT,
    cloudinaryConfigured: missingCloudinary.length === 0
  });

  return true;
}

/**
 * Get configuration object
 */
export function getConfig() {
  return {
    // Server
    port: parseInt(process.env.PORT) || 3001,
    nodeEnv: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || getDefaultLogLevel(),
    
    // Database
    mongoUri: process.env.MONGO_URI || process.env.MONGODB_URI,
    
    // CORS
    corsOrigins: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
      : [
          'http://localhost:3000',    // school-dashboard dev
          'http://localhost:8081',    // Expo web dev
          'http://localhost:19006',    // Expo dev
          'exp://192.168.1.*:19000',   // Expo LAN dev (wildcard for local network)
          'http://localhost:5173',     // Vite dev server
          'http://localhost:5174',     // Alternative Vite port
          'http://localhost:5175',     // Alternative Vite port
        ].concat(process.env.PARENT_APP_URL || []),
    
    // Cloudinary
    cloudinary: {
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      apiSecret: process.env.CLOUDINARY_API_SECRET,
      configured: !!(process.env.CLOUDINARY_CLOUD_NAME && 
                     process.env.CLOUDINARY_API_KEY && 
                     process.env.CLOUDINARY_API_SECRET)
    },
    
    // Features
    isDevelopment: process.env.NODE_ENV !== 'production',
    isProduction: process.env.NODE_ENV === 'production',
  };
}

// Export validated config
export const config = getConfig();
