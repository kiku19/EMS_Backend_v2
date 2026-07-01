/**
 * PII Field-Level Encryption Utility
 *
 * Uses AES-256-GCM for encryption (authenticated, non-deterministic).
 * Uses HMAC-SHA256 for searchable field hashes (deterministic).
 *
 * Key source:  PII_ENCRYPTION_KEY  env var (falls back to JWT_SECRET).
 * The raw key is SHA-256-hashed to guarantee a 32-byte AES key.
 * HMAC uses a separately derived key (same source + ':hmac' salt).
 *
 * The default exports below bind to the env-derived key lazily. For tooling
 * that must work with an explicit key (e.g. a re-encryption pass across a key
 * rotation), use `createCipher(rawSecret)` to build an independent instance.
 */
import crypto from 'crypto';
import { getRequiredSecret } from '../config/environment.js';
import { createLogger } from './logger.js';

const logger = createLogger('Encryption');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce recommended for GCM

// iv (24 hex) . authTag (32 hex) . ciphertext (variable hex)
const ENCRYPTED_RE = /^[0-9a-f]{24}\.[0-9a-f]{32}\.[0-9a-f]+$/;

// ── Key-independent format check ─────────────────────────────────────────────

/** Returns `true` if the value looks like an encrypted string from this module. */
export function isEncrypted(value) {
  return typeof value === 'string' && ENCRYPTED_RE.test(value);
}

// ── Cipher factory (explicit key) ────────────────────────────────────────────

/**
 * Build an encrypt/decrypt/hmac instance bound to a specific raw secret.
 *
 * Unlike the default exports, this does NOT read process.env — the caller
 * supplies the key. This is what a re-encryption pass uses to decrypt data
 * written under an OLD key and re-encrypt it under the canonical NEW key.
 *
 * The returned `decrypt` is migration-safe (logs + returns the raw value on an
 * auth failure), while `decryptStrict` THROWS on failure — use the strict form
 * when a failed decrypt must not be silently written back (e.g. re-encryption).
 */
export function createCipher(rawSecret) {
  if (!rawSecret || typeof rawSecret !== 'string') {
    throw new Error('createCipher requires a non-empty secret string');
  }

  const encKey = crypto.createHash('sha256').update(rawSecret).digest();
  const hmacKey = crypto
    .createHash('sha256')
    .update(rawSecret + ':hmac')
    .digest();

  function encrypt(plaintext) {
    if (!plaintext || typeof plaintext !== 'string') return plaintext;
    if (isEncrypted(plaintext)) return plaintext;

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, encKey, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}.${tag.toString('hex')}.${enc.toString('hex')}`;
  }

  function decryptStrict(ciphertext) {
    if (!ciphertext || typeof ciphertext !== 'string') return ciphertext;
    if (!isEncrypted(ciphertext)) return ciphertext;

    const [ivHex, tagHex, dataHex] = ciphertext.split('.');
    const decipher = crypto.createDecipheriv(ALGORITHM, encKey, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString(
      'utf8'
    );
  }

  function decrypt(ciphertext) {
    try {
      return decryptStrict(ciphertext);
    } catch (err) {
      logger.error('PII decryption failed — returning raw value', { error: err.message });
      return ciphertext;
    }
  }

  function hmac(value) {
    if (!value || typeof value !== 'string') return null;
    return crypto.createHmac('sha256', hmacKey).update(value.toLowerCase().trim()).digest('hex');
  }

  return { encrypt, decrypt, decryptStrict, hmac, isEncrypted };
}

// ── Default instance (env-derived key, cached) ───────────────────────────────

let _default = null;

function getRawSecret() {
  return process.env.PII_ENCRYPTION_KEY || getRequiredSecret('JWT_SECRET');
}

function defaultCipher() {
  if (!_default) _default = createCipher(getRawSecret());
  return _default;
}

// ── Public API (env default) ─────────────────────────────────────────────────

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns `iv_hex.tag_hex.ciphertext_hex`.
 * Idempotent — already-encrypted values pass through unchanged.
 */
export function encrypt(plaintext) {
  return defaultCipher().encrypt(plaintext);
}

/**
 * Decrypt an AES-256-GCM ciphertext string.
 * Idempotent — plaintext values pass through unchanged (migration-safe).
 * Returns the raw value (and logs) if the auth tag does not verify.
 */
export function decrypt(ciphertext) {
  return defaultCipher().decrypt(ciphertext);
}

/**
 * Deterministic HMAC-SHA256 hash for searchable PII fields.
 * Normalises to lowercase + trimmed before hashing so that
 * `hmac('Foo@BAR.com')` === `hmac('foo@bar.com ')`.
 */
export function hmac(value) {
  return defaultCipher().hmac(value);
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

/** Reset the cached default instance — test-only. */
export function _resetKeys() {
  _default = null;
}
