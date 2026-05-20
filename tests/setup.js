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

  // Use a unique database name per test file so parallel workers and
  // sequential test files don't collide.
  const dbName = `ems-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  await mongoose.connect(process.env.MONGO_TEST_URI, {
    dbName,
  });
}, 120000);

beforeEach(async () => {
  const collections = Object.values(mongoose.connection.collections);
  for (const collection of collections) {
    await collection.deleteMany({});
  }
  resetDefaultSchool();
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
