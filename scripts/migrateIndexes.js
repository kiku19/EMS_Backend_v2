/**
 * Index Migration Script
 *
 * Drops old indexes and lets Mongoose recreate them with updated definitions.
 * Required after the student journey audit fixes that changed indexes on:
 *   - students: rollNo partial filter expression (Issue #4)
 *   - classes: added schoolId to unique index (Issue #16)
 *   - feestructures: added schoolId to unique index (Issue #34)
 *   - attendances: fixed stale records.studentId path (Issue #52)
 *
 * Usage: node scripts/migrateIndexes.js
 */

import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MONGO_URI =
  process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/ems';

// Old indexes to drop (by collection name and index key pattern)
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

  // Trigger Mongoose to recreate indexes with updated definitions
  console.log('--- Recreating indexes via Mongoose syncIndexes ---');
  try {
    await import('../database.js');

    const models = ['Student', 'Class', 'FeeStructure', 'Attendance'];
    for (const modelName of models) {
      try {
        const model = mongoose.model(modelName);
        console.log(`  Syncing indexes for ${modelName}...`);
        await model.syncIndexes();
        console.log(`  DONE: ${modelName} indexes synced.`);
      } catch (err) {
        console.error(`  ERROR syncing ${modelName}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`  ERROR loading models: ${err.message}`);
    console.log('  Indexes will be recreated automatically on next server start.');
  }

  console.log('\nMigration complete.');
  await mongoose.disconnect();
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
