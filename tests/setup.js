import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { resetDefaultSchool } from './helpers/factories.js';

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

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), {
    dbName: 'ems-test',
  });
});

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
