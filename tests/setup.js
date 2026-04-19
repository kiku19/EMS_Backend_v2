import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, vi } from 'vitest';
import { resetDefaultSchool } from './helpers/factories.js';

// Freeze the test clock so hardcoded YYYY-MM-DD literals in tests (exam
// startDates, attendance dates, payroll months, etc.) stay stable across
// real-world time passing. Chosen date is mid-March 2026 — ahead of most
// "past attendance" literals (2026-03-06, 2026-03-01) and before "future
// exam" literals (2026-04-01, 2026-04-15) so both categories of test
// remain self-consistent.
//
// Individual tests that specifically need real time may call
// vi.useRealTimers() in their own beforeEach.
vi.useFakeTimers({ now: new Date('2026-03-15T12:00:00Z'), shouldAdvanceTime: true });

let mongoServer;

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
  mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(mongoServer.getUri(), {
    dbName: 'ems-test',
  });
}, 60000);

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

  if (mongoServer) {
    await mongoServer.stop();
  }
});
