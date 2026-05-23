import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { resetDefaultSchool } from './helpers/factories.js';

// Note: `vi.useFakeTimers` is set up in ./clockSetup.js, which is listed
// BEFORE this file in vitest.config.js's setupFiles. That ordering matters
// because importing factories.js (line above) transitively loads
// utils/constants.js, which eagerly computes CURRENT_ACADEMIC_YEAR from
// `new Date()` at module load time. Freezing the clock in a separate
// earlier-loaded setup file ensures that that computation sees the fake clock.

process.env.NODE_ENV = 'test';
process.env.PORT = process.env.PORT || '3001';
process.env.JWT_SECRET =
  process.env.JWT_SECRET || '1234567890123456789012345678901234567890123456789012345678901234';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ||
  'abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqrstuvwxyz1234';
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
process.env.SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'superid@test.com';
process.env.SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'super12345';
process.env.SUPER_ADMIN_NAME = process.env.SUPER_ADMIN_NAME || 'Master User';

// Replica-set mode is required because several routes use Mongoose
// transactions (session.withTransaction). MongoMemoryServer in standalone
// mode rejects transactions with "Transaction numbers are only allowed on a
// replica set member or mongos", failing ~160 tests. Production MongoDB
// also runs as a replica set (see EMS-backend/CLAUDE.md Database section).

beforeAll(async () => {
  if (!process.env.MONGO_TEST_URI) {
    throw new Error(
      'MONGO_TEST_URI is not set. Ensure globalSetup (tests/globalSetup.js) is configured in vitest.config.js.'
    );
  }

  if (mongoose.connection.readyState === 0) {
    // Use one database per worker so tests in the same worker can reuse
    // the connection, eliminating connect/disconnect overhead per file.
    const workerId = process.env.VITEST_WORKER_ID || '0';
    const dbName = `ems-test-worker-${workerId}`;

    await mongoose.connect(process.env.MONGO_TEST_URI, {
      dbName,
      autoIndex: true,
      autoCreate: false,
    });
  }

  // Ensure a clean slate for this test file even when reusing a connection.
  const collections = Object.values(mongoose.connection.collections);
  for (const collection of collections) {
    await collection.deleteMany({});
  }
  resetDefaultSchool();
}, 120000);

beforeEach(async () => {
  const collections = Object.values(mongoose.connection.collections);
  for (const collection of collections) {
    await collection.deleteMany({});
  }
  resetDefaultSchool();
});

afterAll(async () => {
  // Intentionally do NOT disconnect here.  Keeping the connection open
  // lets subsequent test files in the same worker reuse it, shaving
  // ~4-6s of connect/disconnect overhead per file.  The globalSetup
  // teardown will stop the MongoMemoryReplSet after all tests finish.
});
