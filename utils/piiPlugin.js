/**
 * Mongoose PII Encryption Plugin
 *
 * Transparently encrypts PII fields on save and decrypts on read.
 * For fields that need to remain searchable (phone, email), an HMAC
 * hash companion field (`{field}Hash`) is added automatically.
 *
 * Usage:
 *   import piiPlugin from '../utils/piiPlugin.js';
 *
 *   schema.plugin(piiPlugin, {
 *     fields: ['phone', 'email', 'aadhaarNumber', 'address'],
 *     searchableFields: ['phone', 'email'],
 *     arrayFields: {
 *       'parents': ['phone', 'email'],
 *       'healthInfo.emergencyContacts': ['phone', 'alternatePhone', 'email'],
 *     },
 *   });
 *
 * Migration: Existing plaintext data is handled gracefully —
 *   - decrypt() returns plaintext values unchanged (not matching encrypted format)
 *   - encrypt() skips already-encrypted values
 *   - Records are encrypted on next .save(); hash fields populated at that time
 *   - Queries via piiMatch() fall back to plaintext match for un-migrated records
 */
import { encrypt, decrypt, hmac, isEncrypted } from './encryption.js';

export default function piiPlugin(schema, options = {}) {
  const { fields = [], searchableFields = [], arrayFields = {} } = options;

  // ── Add hash companion fields for searchable fields ───────────────────────
  for (const field of searchableFields) {
    schema.add({ [`${field}Hash`]: { type: String, index: true } });
  }

  // ── Pre-save: encrypt top-level + array fields, compute hashes ────────────
  schema.pre('save', function () {
    for (const field of fields) {
      const val = this[field];
      if (val && typeof val === 'string') {
        const plain = isEncrypted(val) ? decrypt(val) : val;
        this[field] = encrypt(plain);
        if (searchableFields.includes(field)) {
          this[`${field}Hash`] = hmac(plain);
        }
      } else if (searchableFields.includes(field)) {
        this[`${field}Hash`] = null;
      }
    }

    for (const [arrayPath, subFields] of Object.entries(arrayFields)) {
      const arr = resolveNestedArray(this, arrayPath);
      if (!arr) continue;
      for (const item of arr) {
        for (const sf of subFields) {
          if (item[sf] && typeof item[sf] === 'string' && !isEncrypted(item[sf])) {
            item[sf] = encrypt(item[sf]);
          }
        }
      }
    }
  });

  // ── Pre-update hooks: encrypt fields in $set payloads ─────────────────────
  const encryptUpdatePayload = function () {
    const update = this.getUpdate();
    if (!update) return;

    const targets = [update.$set, update].filter(Boolean);
    for (const target of targets) {
      for (const field of fields) {
        if (target[field] && typeof target[field] === 'string' && !isEncrypted(target[field])) {
          const plain = target[field];
          target[field] = encrypt(plain);
          if (searchableFields.includes(field)) {
            const hashKey = `${field}Hash`;
            if (update.$set) update.$set[hashKey] = hmac(plain);
            else target[hashKey] = hmac(plain);
          }
        }
      }
    }
  };

  schema.pre('findOneAndUpdate', encryptUpdatePayload);
  schema.pre('updateOne', encryptUpdatePayload);
  schema.pre('updateMany', encryptUpdatePayload);

  // ── Post hooks: decrypt after read ────────────────────────────────────────
  schema.post('save', decryptDocument);
  schema.post('init', decryptDocument);
  schema.post('find', (docs) => {
    if (Array.isArray(docs)) docs.forEach(decryptDocument);
  });
  schema.post('findOne', decryptDocument);
  schema.post('findOneAndUpdate', decryptDocument);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function decryptDocument(doc) {
    if (!doc) return;
    const isMongoose = typeof doc.unmarkModified === 'function';

    for (const field of fields) {
      const val = isMongoose ? doc.get(field) : doc[field];
      if (val && isEncrypted(val)) {
        const plain = decrypt(val);
        if (isMongoose) {
          doc.set(field, plain);
          doc.unmarkModified(field);
        } else {
          doc[field] = plain;
        }
      }
    }

    for (const [arrayPath, subFields] of Object.entries(arrayFields)) {
      const arr = resolveNestedArray(doc, arrayPath);
      if (!arr) continue;
      for (const item of arr) {
        for (const sf of subFields) {
          if (item[sf] && isEncrypted(item[sf])) {
            item[sf] = decrypt(item[sf]);
          }
        }
      }
    }
  }
}

/** Walk a dot-separated path to reach a nested array (works for both Mongoose docs and plain objects). */
function resolveNestedArray(obj, path) {
  let current = obj;
  for (const part of path.split('.')) {
    if (!current) return null;
    current = typeof current.get === 'function' ? current.get(part) : current[part];
  }
  return Array.isArray(current) ? current : null;
}
