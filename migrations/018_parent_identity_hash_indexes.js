/** Enforce tenant-safe guardian identity uniqueness on deterministic hashes. */

import { decrypt, hmac } from '../utils/encryption.js';

export const description =
  'Backfill parent phone/email hashes and replace ineffective encrypted-value unique indexes';

const COLLECTION = 'parents';
const LEGACY_PHONE_INDEX = 'schoolId_1_phone_1';
const LEGACY_EMAIL_INDEX = 'schoolId_1_email_1';
const PHONE_HASH_INDEX = 'schoolId_1_phoneHash_1';
const EMAIL_HASH_INDEX = 'schoolId_1_emailHash_1';

async function collectionExists(db) {
  return (await db.listCollections({ name: COLLECTION }).toArray()).length > 0;
}

async function dropIfPresent(collection, indexName) {
  const indexes = await collection.indexes();
  if (indexes.some((index) => index.name === indexName)) await collection.dropIndex(indexName);
}

function collectHashRepairs(rows, field) {
  const repairs = [];
  const seen = new Set();
  const duplicates = new Set();
  const hashField = `${field}Hash`;

  for (const row of rows) {
    const valueHash = row[hashField] || hmac(decrypt(row[field]));
    if (!valueHash) continue;
    const tenantHash = `${row.schoolId}:${valueHash}`;
    if (seen.has(tenantHash)) duplicates.add(tenantHash);
    seen.add(tenantHash);
    if (!row[hashField]) repairs.push({ _id: row._id, valueHash });
  }

  return { repairs, duplicateCount: duplicates.size };
}

export async function up(db, { dryRun }) {
  if (!(await collectionExists(db))) {
    console.log(`    [SKIP] ${COLLECTION}: collection does not exist`);
    return;
  }

  const collection = db.collection(COLLECTION);
  const rows = await collection
    .find(
      { schoolId: { $exists: true } },
      { projection: { schoolId: 1, phone: 1, phoneHash: 1, email: 1, emailHash: 1 } }
    )
    .toArray();
  const phone = collectHashRepairs(
    rows.filter((row) => typeof row.phone === 'string'),
    'phone'
  );
  const email = collectHashRepairs(
    rows.filter((row) => typeof row.email === 'string'),
    'email'
  );

  console.log(`    [SCAN] ${phone.repairs.length} parent phone hash(es) require backfill.`);
  console.log(`    [SCAN] ${email.repairs.length} parent email hash(es) require backfill.`);
  if (phone.duplicateCount || email.duplicateCount) {
    throw new Error(
      `Parents contain ${phone.duplicateCount} duplicate phone and ${email.duplicateCount} duplicate email group(s) within a school; resolve them before applying migration 018.`
    );
  }
  if (dryRun) return;

  const repairs = new Map();
  for (const repair of phone.repairs) {
    repairs.set(repair._id.toString(), { _id: repair._id, phoneHash: repair.valueHash });
  }
  for (const repair of email.repairs) {
    const key = repair._id.toString();
    repairs.set(key, {
      ...(repairs.get(key) || { _id: repair._id }),
      emailHash: repair.valueHash,
    });
  }
  if (repairs.size > 0) {
    await collection.bulkWrite(
      [...repairs.values()].map(({ _id, ...fields }) => ({
        updateOne: { filter: { _id }, update: { $set: fields } },
      }))
    );
  }

  await dropIfPresent(collection, LEGACY_PHONE_INDEX);
  await dropIfPresent(collection, LEGACY_EMAIL_INDEX);
  await collection.createIndex(
    { schoolId: 1, phoneHash: 1 },
    {
      name: PHONE_HASH_INDEX,
      unique: true,
      partialFilterExpression: { phoneHash: { $type: 'string' } },
    }
  );
  await collection.createIndex(
    { schoolId: 1, emailHash: 1 },
    {
      name: EMAIL_HASH_INDEX,
      unique: true,
      partialFilterExpression: { emailHash: { $type: 'string' } },
    }
  );
}

export async function down(db, { dryRun }) {
  if (!(await collectionExists(db))) return;
  console.log('    Restoring legacy encrypted-value parent indexes; hash fields are retained.');
  if (dryRun) return;

  const collection = db.collection(COLLECTION);
  await dropIfPresent(collection, PHONE_HASH_INDEX);
  await dropIfPresent(collection, EMAIL_HASH_INDEX);
  await collection.createIndex(
    { schoolId: 1, phone: 1 },
    { name: LEGACY_PHONE_INDEX, unique: true }
  );
  await collection.createIndex(
    { schoolId: 1, email: 1 },
    {
      name: LEGACY_EMAIL_INDEX,
      unique: true,
      partialFilterExpression: { email: { $type: 'string' } },
    }
  );
}
