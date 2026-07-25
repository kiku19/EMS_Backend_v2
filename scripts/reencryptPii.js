/**
 * PII Re-encryption Pass
 *
 * Decrypts every encrypted PII field with an OLD key and re-encrypts it with a
 * NEW (canonical) key, recomputing searchable hashes. Use this when the
 * PII_ENCRYPTION_KEY changes and existing parent/student/staff contact data
 * must survive the rotation (SCH-198).
 *
 * It works at the raw MongoDB driver level, bypassing the Mongoose piiPlugin —
 * the plugin would auto-decrypt with the CURRENT key, which is exactly the key
 * that no longer matches the data. We must control both keys explicitly.
 *
 * SAFETY
 *   - Dry-run by default. Nothing is written unless you pass --apply.
 *   - Keys are never printed; only a short SHA-256 fingerprint is shown so you
 *     can confirm which key is in effect.
 *   - A value that fails to decrypt with the OLD key is LEFT UNTOUCHED and
 *     counted as a mismatch (never re-encrypted / never clobbered). A non-zero
 *     mismatch count means the OLD key is wrong — stop and re-check before
 *     running with --apply.
 *   - Take a database backup before running with --apply (npm run backup:db).
 *
 * Usage
 *   PII_OLD_KEY=<old-secret> node scripts/reencryptPii.js            # dry run
 *   PII_OLD_KEY=<old-secret> node scripts/reencryptPii.js --apply    # write
 *
 * Keys (env preferred so they do not land in shell history / process list):
 *   PII_OLD_KEY   (required)  the key the data is currently encrypted with
 *   PII_NEW_KEY   (optional)  the canonical target key; defaults to the app's
 *                             effective key (PII_ENCRYPTION_KEY || JWT_SECRET)
 *
 * Flags: --apply (write), --old-key <k>, --new-key <k>, --collection <name>
 *
 * NOTE: keep the PII_FIELD_MAP below in sync with the piiPlugin options in
 *       models/Parent.js, models/Student.js, models/Staff.js.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { createCipher, isEncrypted } from '../utils/encryption.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MONGO_URI =
  process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/ems';

// PII field config per collection — mirrors the piiPlugin options in the models.
const PII_FIELD_MAP = {
  parents: {
    fields: ['phone', 'email'],
    searchableFields: ['phone', 'email'],
    arrayFields: {},
  },
  students: {
    fields: [
      'phone',
      'email',
      'whatsappNumber',
      'address',
      'aadhaarNumber',
      'emergencyContactName',
      'emergencyContactPhone',
      'alumniEmail',
      'alumniPhone',
    ],
    searchableFields: ['phone', 'email'],
    arrayFields: {
      parents: ['phone', 'email'],
      'healthInfo.emergencyContacts': ['phone', 'alternatePhone', 'email'],
    },
  },
  staffs: {
    fields: [
      'phone',
      'email',
      'address',
      'whatsappNumber',
      'accountNumber',
      'ifscCode',
      'panNumber',
      'emergencyContact',
      'emergencyPhone',
    ],
    searchableFields: ['phone', 'email'],
    arrayFields: {
      emergencyContacts: ['phone'],
    },
  },
};

// ── CLI args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const apply = args.includes('--apply');

function flagValue(name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}

const oldKey = flagValue('--old-key') || process.env.PII_OLD_KEY;
const newKey =
  flagValue('--new-key') ||
  process.env.PII_NEW_KEY ||
  process.env.PII_ENCRYPTION_KEY ||
  process.env.JWT_SECRET;
const onlyCollection = flagValue('--collection');

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Short, non-reversible fingerprint of a key so operators can confirm it without exposing it. */
function fingerprint(key) {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);
}

/** Read a nested array by dot path from a plain document (raw driver returns plain objects). */
function resolveNestedArray(obj, dotPath) {
  let current = obj;
  for (const part of dotPath.split('.')) {
    if (current == null) return null;
    current = current[part];
  }
  return Array.isArray(current) ? current : null;
}

/**
 * Compute the $set patch to re-key one document. Never mutates `doc`.
 * Returns { set, reencrypted, mismatches, alreadyNew } where `set` is the
 * update payload (empty object → nothing to do).
 *
 * `rekey` classifies each encrypted value:
 *   - decrypts under OLD  → re-encrypt under NEW (counted in `reencrypted`)
 *   - decrypts under NEW  → already migrated, skip (counted in `alreadyNew`) —
 *                           makes the pass idempotent / safe to re-run
 *   - neither             → true mismatch, LEFT UNTOUCHED (counted in `mismatches`)
 */
function buildReencryptPatch(doc, config, oldCipher, newCipher) {
  const set = {};
  let reencrypted = 0;
  let mismatches = 0;
  let alreadyNew = 0;

  const rekey = (value) => {
    if (!value || typeof value !== 'string' || !isEncrypted(value)) return { skip: true };
    try {
      const plain = oldCipher.decryptStrict(value);
      return { value: newCipher.encrypt(plain), plain };
    } catch {
      // Not under the OLD key. Is it already under the NEW key?
      try {
        newCipher.decryptStrict(value);
        return { alreadyNew: true };
      } catch {
        return { mismatch: true };
      }
    }
  };

  const applyResult = (res, onValue) => {
    if (res.skip) return;
    if (res.alreadyNew) {
      alreadyNew++;
      return;
    }
    if (res.mismatch) {
      mismatches++;
      return;
    }
    onValue(res);
    reencrypted++;
  };

  // Top-level fields
  for (const field of config.fields) {
    applyResult(rekey(doc[field]), (res) => {
      set[field] = res.value;
      if (config.searchableFields.includes(field)) {
        set[`${field}Hash`] = newCipher.hmac(res.plain);
      }
    });
  }

  // Nested array fields (positional paths, e.g. parents.0.phone)
  for (const [arrayPath, subFields] of Object.entries(config.arrayFields)) {
    const arr = resolveNestedArray(doc, arrayPath);
    if (!arr) continue;
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      if (!item || typeof item !== 'object') continue;
      for (const sf of subFields) {
        applyResult(rekey(item[sf]), (res) => {
          set[`${arrayPath}.${i}.${sf}`] = res.value;
        });
      }
    }
  }

  return { set, reencrypted, mismatches, alreadyNew };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!oldKey) {
    console.error(
      'ERROR: OLD key is required. Set PII_OLD_KEY (preferred) or pass --old-key <secret>.'
    );
    process.exit(1);
  }
  if (!newKey) {
    console.error(
      'ERROR: NEW key could not be resolved. Set PII_NEW_KEY / PII_ENCRYPTION_KEY / JWT_SECRET, ' +
        'or pass --new-key <secret>.'
    );
    process.exit(1);
  }
  if (oldKey === newKey) {
    console.error(
      'ERROR: OLD and NEW keys are identical — nothing to re-encrypt. ' +
        'Double-check which key the data is actually under.'
    );
    process.exit(1);
  }

  const oldCipher = createCipher(oldKey);
  const newCipher = createCipher(newKey);

  const collections = onlyCollection ? [onlyCollection] : Object.keys(PII_FIELD_MAP);
  for (const name of collections) {
    if (!PII_FIELD_MAP[name]) {
      console.error(
        `ERROR: unknown collection "${name}". Known: ${Object.keys(PII_FIELD_MAP).join(', ')}`
      );
      process.exit(1);
    }
  }

  const safeUri = MONGO_URI.replace(/\/\/[^@]+@/, '//<credentials>@');
  console.log('=== PII Re-encryption Pass ===');
  console.log(`Mode        : ${apply ? 'APPLY (writes enabled)' : 'DRY RUN (no writes)'}`);
  console.log(`OLD key fp  : sha256:${fingerprint(oldKey)}…`);
  console.log(`NEW key fp  : sha256:${fingerprint(newKey)}…`);
  console.log(`Collections : ${collections.join(', ')}`);
  console.log(`URI         : ${safeUri}`);
  console.log('');

  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;

  const totals = { scanned: 0, modified: 0, reencrypted: 0, alreadyNew: 0, mismatches: 0 };

  try {
    for (const name of collections) {
      const config = PII_FIELD_MAP[name];
      const coll = db.collection(name);
      const cursor = coll.find({}, { readPreference: 'primary' });

      let scanned = 0;
      let modified = 0;
      let reencrypted = 0;
      let alreadyNew = 0;
      let mismatches = 0;
      for await (const doc of cursor) {
        scanned++;
        const patch = buildReencryptPatch(doc, config, oldCipher, newCipher);
        reencrypted += patch.reencrypted;
        alreadyNew += patch.alreadyNew;
        mismatches += patch.mismatches;
        if (Object.keys(patch.set).length === 0) continue;
        modified++;
        if (apply) {
          await coll.updateOne({ _id: doc._id }, { $set: patch.set });
        }
      }

      console.log(
        `${name.padEnd(10)}  scanned=${scanned}  docsToModify=${modified}  ` +
          `fields=${reencrypted}  alreadyNew=${alreadyNew}  mismatches=${mismatches}`
      );
      totals.scanned += scanned;
      totals.modified += modified;
      totals.reencrypted += reencrypted;
      totals.alreadyNew += alreadyNew;
      totals.mismatches += mismatches;
    }

    console.log('');
    console.log(
      `TOTAL       scanned=${totals.scanned}  docsToModify=${totals.modified}  ` +
        `fields=${totals.reencrypted}  alreadyNew=${totals.alreadyNew}  mismatches=${totals.mismatches}`
    );

    if (totals.mismatches > 0) {
      console.log('');
      console.log(
        `WARNING: ${totals.mismatches} field(s) could not be decrypted with the OLD key ` +
          '(left untouched). The OLD key is likely wrong — do NOT run --apply until this is 0.'
      );
    }

    if (!apply) {
      console.log('');
      console.log('DRY RUN — no changes were written. Re-run with --apply to persist.');
    } else {
      console.log('');
      console.log('APPLY complete — PII re-encrypted under the NEW key.');
    }
  } finally {
    await mongoose.disconnect();
  }

  // A non-zero mismatch count is an operational red flag → non-zero exit.
  if (totals.mismatches > 0) process.exit(2);
}

// Export pure helpers for unit testing without a database.
export { buildReencryptPatch, fingerprint, PII_FIELD_MAP };

// Only run when invoked directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error('\nRe-encryption failed:', err.message);
    process.exit(1);
  });
}
