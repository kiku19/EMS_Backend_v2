import { MongoMemoryReplSet } from 'mongodb-memory-server';

export default async function globalSetup() {
  const mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ launchTimeout: 120000 }],
  });

  process.env.MONGO_TEST_URI = mongoServer.getUri();

  // Return teardown function that vitest will call after all tests finish
  return async () => {
    await mongoServer.stop();
  };
}
