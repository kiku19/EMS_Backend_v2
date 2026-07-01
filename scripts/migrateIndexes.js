/**
 * Index Migration Script  (`npm run migrate:indexes`)
 *
 * Two responsibilities:
 *
 *  1. Drop a handful of *legacy* indexes whose key stayed the same but whose
 *     options changed (a partialFilterExpression was added, schoolId was added
 *     to a compound unique key, a stale path was fixed). `syncIndexes()` does
 *     not always detect an options-only change on an identically-keyed index,
 *     so those are dropped explicitly by name first and then recreated below.
 *       - students: rollNo partial filter expression (Issue #4)
 *       - classes: added schoolId to unique index (Issue #16)
 *       - feestructures: added schoolId to unique index (Issue #34)
 *       - attendances: fixed stale records.studentId path (Issue #52)
 *
 *  2. Run `syncIndexes()` for **every registered Mongoose model** so the live
 *     database's indexes match the schemas exactly (creates missing indexes,
 *     drops indexes no longer declared). This is what makes it safe to disable
 *     Mongoose `autoIndex` in production (see DB_DISABLE_AUTOINDEX in
 *     database.js): indexes are ensured deliberately at deploy time by this
 *     script instead of re-ensured on every cold start. Previously this step
 *     covered only the 4 models above, which is not sufficient once autoIndex
 *     is off — all ~129 models need their indexes ensured.
 *
 * Idempotent and safe to re-run. Intended to be run as a deliberate deploy
 * step, not on every boot. Exits non-zero if any model fails to sync so a
 * deploy pipeline (`npm run migrate:indexes && npm start`) halts on failure.
 *
 * Usage: node scripts/migrateIndexes.js   (or: npm run migrate:indexes)
 */

import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Import every model file so ALL models are registered — not just the subset
// that database.js imports. At runtime the app registers all ~129 models as
// routes/services load; a standalone script must replicate that or it silently
// under-covers (importing only database.js registers ~68). All model schemas
// live under models/, so importing each file registers every model.
async function registerAllModels() {
  const modelsDir = path.join(__dirname, '..', 'models');
  const files = fs
    .readdirSync(modelsDir)
    .filter((f) => f.endsWith('.js'))
    .sort();
  for (const file of files) {
    await import(pathToFileURL(path.join(modelsDir, file)).href);
  }
}

const MONGO_URI =
  process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/ems';

// Old indexes to drop (by collection name and index name) whose options changed
// but whose key did not — syncIndexes() alone may not replace these.
const INDEX_MIGRATIONS = [
  {
    collection: 'students',
    description: 'Issue #4: rollNo unique index now uses partialFilterExpression',
    oldIndexName: 'rollNo_1_classId_1_academicYear_1',
  },
  {
    collection: 'classes',
    description: 'Issue #16: unique class index now includes schoolId',
    oldIndexName: 'name_1_section_1_academicYear_1',
  },
  {
    collection: 'feestructures',
    description: 'Issue #34: unique fee structure index now includes schoolId',
    oldIndexName: 'classId_1_academicYear_1',
  },
  {
    collection: 'attendances',
    description: 'Issue #52: fixed stale records.studentId path to studentId',
    oldIndexName: 'records.studentId_1_date_1',
  },
];

async function migrate() {
  console.log('Connecting to MongoDB...');
  console.log(`URI: ${MONGO_URI.replace(/\/\/.*@/, '//<credentials>@')}\n`);

  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;

  // ── Step 1: drop legacy indexes whose options changed ─────────────────────
  for (const migration of INDEX_MIGRATIONS) {
    const { collection, description, oldIndexName } = migration;
    console.log(`--- ${collection} ---`);
    console.log(`  ${description}`);

    try {
      // Check if collection exists
      const collections = await db.listCollections({ name: collection }).toArray();
      if (collections.length === 0) {
        console.log(`  SKIP: Collection "${collection}" does not exist.\n`);
        continue;
      }

      // List current indexes
      const indexes = await db.collection(collection).indexes();
      const indexNames = indexes.map((i) => i.name);

      if (indexNames.includes(oldIndexName)) {
        console.log(`  Dropping old index: ${oldIndexName}`);
        await db.collection(collection).dropIndex(oldIndexName);
        console.log(`  DONE: Old index dropped.\n`);
      } else {
        console.log(
          `  SKIP: Old index "${oldIndexName}" not found. Current indexes: ${indexNames.join(', ')}\n`
        );
      }
    } catch (err) {
      if (err.code === 27) {
        console.log(`  SKIP: Index already removed.\n`);
      } else {
        console.error(`  ERROR: ${err.message}\n`);
      }
    }
  }

  // ── Step 2: sync indexes for EVERY registered model ───────────────────────
  console.log('--- Syncing indexes for all registered models (Mongoose syncIndexes) ---');
  const failures = [];
  try {
    await registerAllModels();

    const modelNames = mongoose.modelNames().sort();
    console.log(`  ${modelNames.length} models registered.\n`);

    for (const modelName of modelNames) {
      try {
        const model = mongoose.model(modelName);
        await model.syncIndexes();
        console.log(`  [OK]   ${modelName}`);
      } catch (err) {
        failures.push({ modelName, message: err.message });
        console.error(`  [FAIL] ${modelName}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`  ERROR loading models: ${err.message}`);
    failures.push({ modelName: '<model load>', message: err.message });
  }

  await mongoose.disconnect();

  if (failures.length > 0) {
    console.error(`\nMigration finished with ${failures.length} failure(s):`);
    for (const f of failures) {
      console.error(`  - ${f.modelName}: ${f.message}`);
    }
    process.exit(1);
  }

  console.log('\nMigration complete — all model indexes synced.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
