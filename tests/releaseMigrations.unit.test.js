import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';

const RELEASE_MIGRATIONS = [
  '../migrations/008_timetable_dedupe.js',
  '../migrations/009_salary_adjustment_tenant_indexes.js',
  '../migrations/010_fee_ledger_tenant_integrity.js',
  '../migrations/011_calendar_event_recurrence_indexes.js',
  '../migrations/012_staff_role_phone_integrity.js',
  '../migrations/013_salary_template_active_name_index.js',
  '../migrations/014_fee_structure_annualization_and_installments.js',
  '../migrations/015_fee_query_indexes.js',
  '../migrations/016_academics_timetable_query_indexes.js',
  '../migrations/017_transfer_certificate_unique_index.js',
  '../migrations/018_parent_identity_hash_indexes.js',
];

describe('release migrations', () => {
  it('all support side-effect-free up/down dry runs on the isolated test database', async () => {
    const db = mongoose.connection.db;
    const beforeCollections = (await db.listCollections().toArray())
      .map((item) => item.name)
      .sort();

    for (const modulePath of RELEASE_MIGRATIONS) {
      const migration = await import(modulePath);
      expect(migration.description).toBeTruthy();
      await migration.up(db, { dryRun: true });
      await migration.down(db, { dryRun: true });
    }

    const afterCollections = (await db.listCollections().toArray()).map((item) => item.name).sort();
    expect(afterCollections).toEqual(beforeCollections);
  });
});
