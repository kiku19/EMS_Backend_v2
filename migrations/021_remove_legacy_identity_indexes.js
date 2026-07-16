/**
 * Remove obsolete globally-unique and encrypted-value indexes.
 *
 * Tenant-scoped receipt counters intentionally reuse a receipt number in each
 * school, and encrypted contact values are non-deterministic. The current
 * compound receipt and deterministic-hash indexes enforce the correct rules;
 * these historical indexes can only create false duplicate-key failures.
 */

export const description =
  'Remove legacy global receipt and parent identity indexes that block valid tenant-scoped records';

const LEGACY_INDEXES = [
  {
    collection: 'feepayments',
    name: 'receiptNumber_1',
    key: { receiptNumber: 1 },
    unique: true,
  },
  {
    collection: 'parents',
    name: 'phone_1',
    key: { phone: 1 },
    unique: true,
  },
  {
    collection: 'parents',
    name: 'schoolId_1_phone_1',
    key: { schoolId: 1, phone: 1 },
  },
  {
    collection: 'parents',
    name: 'schoolId_1_email_1',
    key: { schoolId: 1, email: 1 },
  },
];

const hasSameKey = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);

async function collectionExists(db, name) {
  return (await db.listCollections({ name }).toArray()).length > 0;
}

async function removeLegacyIndex(db, spec, dryRun) {
  if (!(await collectionExists(db, spec.collection))) {
    console.log(`    [SKIP] ${spec.collection}: collection does not exist`);
    return;
  }

  const collection = db.collection(spec.collection);
  // Prefer the known legacy name, but also match the exact key/options. A
  // restored or hand-created index may have a custom name while still
  // enforcing the same global uniqueness rule.
  const index = (await collection.indexes()).find(
    (candidate) =>
      candidate.name === spec.name ||
      (hasSameKey(candidate.key, spec.key) && (!spec.unique || candidate.unique === true))
  );
  if (!index) {
    console.log(`    [OK]   ${spec.collection}.${spec.name}: not present`);
    return;
  }
  if (!hasSameKey(index.key, spec.key) || (spec.unique && !index.unique)) {
    console.log(
      `    [SKIP] ${spec.collection}.${spec.name}: does not match the known legacy index`
    );
    return;
  }

  if (dryRun) {
    console.log(`    [DROP] ${spec.collection}.${index.name}: would remove obsolete index`);
    return;
  }

  await collection.dropIndex(index.name);
  console.log(`    [DROP] ${spec.collection}.${index.name}: removed obsolete index`);
}

export async function up(db, { dryRun }) {
  for (const spec of LEGACY_INDEXES) {
    await removeLegacyIndex(db, spec, dryRun);
  }
}

// Deliberately no down migration: recreating these indexes would reintroduce
// incorrect cross-school uniqueness and may fail once valid tenant duplicates
// exist. The supported indexes remain in place throughout.
