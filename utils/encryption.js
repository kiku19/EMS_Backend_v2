/**
 * PII Field-Level Encryption Utility
 *
 * Uses AES-256-GCM for encryption (authenticated, non-deterministic).
 * Uses HMAC-SHA256 for searchable field hashes (deterministic).
 *
 * Key source:  PII_ENCRYPTION_KEY  env var (falls back to JWT_SECRET).
 * The raw key is SHA-256-hashed to guarantee a 32-byte AES key.
 * HMAC uses a separately derived key (same source + ':hmac' salt).
 */
import crypto from 'crypto';
import { getRequiredSecret } from '../config/environment.js';
import { createLogger } from './logger.js';

const logger = createLogger('Encryption');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce recommended for GCM

// iv (24 hex) . authTag (32 hex) . ciphertext (variable hex)
const ENCRYPTED_RE = /^[0-9a-f]{24}\.[0-9a-f]{32}\.[0-9a-f]+$/;

// ── Key derivation (cached) ─────────────────────────────────────────────────

let _encKey = null;
let _hmacKey = null;

function getRawSecret() {
  const raw = process.env.PII_ENCRYPTION_KEY || getRequiredSecret('JWT_SECRET');
  return raw;
}

function getEncryptionKey() {
  if (!_encKey) {
    _encKey = crypto.createHash('sha256').update(getRawSecret()).digest();
  }
  return _encKey;
}

function getHmacKey() {
  if (!_hmacKey) {
    _hmacKey = crypto
      .createHash('sha256')
      .update(getRawSecret() + ':hmac')
      .digest();
  }
  return _hmacKey;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns `iv_hex.tag_hex.ciphertext_hex`.
 * Idempotent — already-encrypted values pass through unchanged.
 */
export function encrypt(plaintext) {
  if (!plaintext || typeof plaintext !== 'string') return plaintext;
  if (isEncrypted(plaintext)) return plaintext;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}.${tag.toString('hex')}.${enc.toString('hex')}`;
}

/**
 * Decrypt an AES-256-GCM ciphertext string.
 * Idempotent — plaintext values pass through unchanged (migration-safe).
 */
export function decrypt(ciphertext) {
  if (!ciphertext || typeof ciphertext !== 'string') return ciphertext;
  if (!isEncrypted(ciphertext)) return ciphertext;

  try {
    const [ivHex, tagHex, dataHex] = ciphertext.split('.');
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      getEncryptionKey(),
      Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString(
      'utf8'
    );
  } catch (err) {
    logger.error('PII decryption failed — returning raw value', { error: err.message });
    return ciphertext;
  }
}

/**
 * Deterministic HMAC-SHA256 hash for searchable PII fields.
 * Normalises to lowercase + trimmed before hashing so that
 * `hmac('Foo@BAR.com')` === `hmac('foo@bar.com ')`.
 */
export function hmac(value) {
  if (!value || typeof value !== 'string') return null;
  return crypto.createHmac('sha256', getHmacKey()).update(value.toLowerCase().trim()).digest('hex');
}

/** Returns `true` if the value looks like an encrypted string from this module. */
export function isEncrypted(value) {
  return typeof value === 'string' && ENCRYPTED_RE.test(value);
}

/**
 * Build a query condition for a PII-encrypted searchable field.
 * During migration, matches either the HMAC hash or the original plaintext
 * so that un-encrypted records are still discoverable.
 */
export function piiMatch(field, value) {
  if (!value || typeof value !== 'string') return { [field]: value };
  return {
    $or: [
      { [`${field}Hash`]: hmac(value) },
      { [field]: value }, // fallback for not-yet-encrypted records
    ],
  };
}

/** Reset cached keys — test-only. */
export function _resetKeys() {
  _encKey = null;
  _hmacKey = null;
}
