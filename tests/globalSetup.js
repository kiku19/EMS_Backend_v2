import { MongoMemoryReplSet } from 'mongodb-memory-server';

export default async function globalSetup() {
  // Pin MongoDB 6.0.x because the default 7.0.x requires a newer Visual C++
  // Redistributable than is available on this Windows test runner (exit code
  // 3221225781). MongoDB 6.0 is fully compatible with transactions and all
  // features used by the test suite.
  const mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ launchTimeout: 120000 }],
    binary: { version: '6.0.21' },
  });

  process.env.MONGO_TEST_URI = mongoServer.getUri();

  // Return teardown function that vitest will call after all tests finish
  return async () => {
    await mongoServer.stop();
  };
}
