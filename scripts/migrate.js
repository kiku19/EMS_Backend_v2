/**
 * Migration CLI
 *
 * Usage:
 *   node scripts/migrate.js [command] [options]
 *
 * Commands:
 *   up        Run all pending migrations (default)
 *   down      Rollback the last applied migration
 *   status    Show which migrations have been applied
 *
 * Options:
 *   --dry-run          Preview changes without writing to the database
 *   --to <version>     Migrate up/down to a specific version number
 *
 * Examples:
 *   node scripts/migrate.js up
 *   node scripts/migrate.js up --dry-run
 *   node scripts/migrate.js up --to 2
 *   node scripts/migrate.js down
 *   node scripts/migrate.js status
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { runMigrations, getMigrationStatus } from '../migrations/runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MONGO_URI =
  process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/ems';

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

const COMMANDS = ['up', 'down', 'status'];
const command = COMMANDS.includes(args[0]) ? args[0] : 'up';
const dryRun = args.includes('--dry-run');

const toIndex = args.indexOf('--to');
const toVersion = toIndex !== -1 ? parseInt(args[toIndex + 1], 10) : null;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const safeUri = MONGO_URI.replace(/\/\/[^@]+@/, '//<credentials>@');
  console.log('=== EMS Database Migration Runner ===');
  console.log(`Command  : ${command}`);
  console.log(`Mode     : ${dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);
  if (toVersion !== null) console.log(`To version: ${toVersion}`);
  console.log(`URI      : ${safeUri}`);
  console.log('');

  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;

  try {
    if (command === 'status') {
      const statuses = await getMigrationStatus(db);
      if (statuses.length === 0) {
        console.log('No migration files found.');
      } else {
        const maxLen = Math.max(...statuses.map((s) => s.name.length));
        console.log(`${'Migration'.padEnd(maxLen)}  Status`);
        console.log('-'.repeat(maxLen + 10));
        for (const s of statuses) {
          const status = s.applied ? '[applied]' : '[pending]';
          console.log(`${s.name.padEnd(maxLen)}  ${status}`);
        }
      }
    } else {
      const results = await runMigrations(db, command, { dryRun, toVersion });

      console.log('');
      if (results.length === 0) {
        console.log('Nothing to do.');
      } else {
        const succeeded = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;
        console.log(`Done: ${succeeded} succeeded, ${failed} failed.`);
        if (dryRun) {
          console.log('DRY RUN — no changes were written to the database.');
        }
      }
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('\nMigration runner failed:', err.message);
  process.exit(1);
});
