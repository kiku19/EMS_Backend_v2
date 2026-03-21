/**
 * Migration Runner
 *
 * Scans the migrations/ directory for versioned migration files, compares
 * against the _migrations collection in MongoDB, and runs pending up() or
 * down() functions in order.
 *
 * Migration file contract:
 *   export const description = 'Human-readable description';
 *   export async function up(db, { dryRun }) { ... }
 *   export async function down(db, { dryRun }) { ... }  // optional
 *
 * The `db` parameter is a MongoDB native Db instance (mongoose.connection.db).
 */

import { readdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIGRATIONS_COLLECTION = '_migrations';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns all migration files sorted by version number.
 * Only matches files like 001_some_name.js (digits prefix).
 */
async function getMigrationFiles() {
  const files = await readdir(__dirname);
  return files
    .filter((f) => /^\d+_.+\.js$/.test(f) && f !== 'runner.js')
    .sort()
    .map((f) => ({
      filename: f,
      version: parseInt(f.match(/^(\d+)/)[1], 10),
      name: f.replace(/\.js$/, ''),
    }));
}

/** Returns a Set of migration names that have already been applied. */
async function getAppliedMigrations(db) {
  const docs = await db.collection(MIGRATIONS_COLLECTION).find({}).toArray();
  return new Set(docs.map((d) => d.name));
}

/** Records or removes a migration entry from the tracking collection. */
async function recordMigration(db, name, direction) {
  const coll = db.collection(MIGRATIONS_COLLECTION);
  if (direction === 'up') {
    await coll.updateOne({ name }, { $set: { name, appliedAt: new Date() } }, { upsert: true });
  } else {
    await coll.deleteOne({ name });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the current migration status without running anything.
 *
 * @param {import('mongodb').Db} db
 * @returns {Promise<Array<{name: string, version: number, applied: boolean}>>}
 */
export async function getMigrationStatus(db) {
  const files = await getMigrationFiles();
  const applied = await getAppliedMigrations(db);
  return files.map((f) => ({
    name: f.name,
    version: f.version,
    applied: applied.has(f.name),
  }));
}

/**
 * Runs pending migrations in the given direction.
 *
 * @param {import('mongodb').Db} db       - Native MongoDB Db instance
 * @param {'up'|'down'} direction         - Direction to migrate
 * @param {object} [options]
 * @param {boolean} [options.dryRun]      - Preview without writing
 * @param {number|null} [options.toVersion] - Migrate up/down to this version (inclusive)
 * @returns {Promise<Array<{name: string, success: boolean, error?: string}>>}
 */
export async function runMigrations(
  db,
  direction = 'up',
  { dryRun = false, toVersion = null } = {}
) {
  const files = await getMigrationFiles();
  const appliedSet = await getAppliedMigrations(db);

  let toRun;

  if (direction === 'up') {
    toRun = files.filter((f) => !appliedSet.has(f.name));
    if (toVersion !== null) {
      toRun = toRun.filter((f) => f.version <= toVersion);
    }
  } else {
    // Rollback: newest first
    const applied = files.filter((f) => appliedSet.has(f.name)).reverse();
    if (toVersion !== null) {
      toRun = applied.filter((f) => f.version > toVersion);
    } else {
      // Rollback only the most recently applied migration
      toRun = applied.slice(0, 1);
    }
  }

  if (toRun.length === 0) {
    console.log('No pending migrations.');
    return [];
  }

  const results = [];

  for (const file of toRun) {
    const migrationUrl = pathToFileURL(path.join(__dirname, file.filename)).href;
    const migration = await import(migrationUrl);

    const fn = direction === 'up' ? migration.up : migration.down;

    if (!fn) {
      console.log(`  [SKIP] ${file.name}: no ${direction}() exported`);
      results.push({ name: file.name, success: true, skipped: true });
      continue;
    }

    const label = dryRun ? 'DRY-RUN' : direction.toUpperCase();
    const desc = migration.description ? ` — ${migration.description}` : '';
    console.log(`  [${label}] ${file.name}${desc}`);

    try {
      await fn(db, { dryRun });

      if (!dryRun) {
        await recordMigration(db, file.name, direction);
      }

      results.push({ name: file.name, success: true });
      console.log(`  [OK] ${file.name}`);
    } catch (err) {
      console.error(`  [ERROR] ${file.name}: ${err.message}`);
      results.push({ name: file.name, success: false, error: err.message });
      // Stop on first failure — don't run subsequent migrations on a broken state
      throw err;
    }
  }

  return results;
}
