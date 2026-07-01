import crypto from 'crypto';
import { createLogger } from './logger.js';

const logger = createLogger('OTP');

const OTP_LENGTH = Number(process.env.OTP_LENGTH) || 6;
const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES) || 5;
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS) || 3;
const OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || process.env.JWT_SECRET;

function getOtpHmacSecret() {
  if (!OTP_HMAC_SECRET) {
    throw new Error('OTP_HMAC_SECRET (or JWT_SECRET) is required for OTP hashing');
  }
  return OTP_HMAC_SECRET;
}

/**
 * Generate a numeric OTP of configured length (default 6 digits).
 */
export function generateOTP(length = OTP_LENGTH) {
  if (!Number.isInteger(length) || length < 4 || length > 10) {
    throw new Error('OTP length must be an integer between 4 and 10');
  }

  // Use crypto.randomInt to avoid modulo bias
  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;
  return String(crypto.randomInt(min, max + 1));
}

/**
 * Hash an OTP with HMAC-SHA256.
 */
export function hashOTP(otp) {
  return crypto.createHmac('sha256', getOtpHmacSecret()).update(String(otp)).digest('hex');
}

/**
 * Constant-time compare of OTP against a hash.
 */
export function verifyOTP(otp, hash) {
  if (!otp || !hash) return false;
  const candidate = hashOTP(otp);
  if (candidate.length !== hash.length) return false;

  // crypto.timingSafeEqual requires equal-length buffers
  try {
    return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'));
  } catch {
    // Fallback for non-hex hashes (e.g. during algorithm changes)
    return candidate === hash;
  }
}

export function getOtpExpiryMinutes() {
  return OTP_EXPIRY_MINUTES;
}

export function getOtpMaxAttempts() {
  return OTP_MAX_ATTEMPTS;
}

export { OTP_LENGTH, OTP_EXPIRY_MINUTES, OTP_MAX_ATTEMPTS };
