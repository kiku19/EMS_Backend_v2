/**
 * DR-02: Initialise a 3-node MongoDB replica set for local development.
 *
 * Run after starting docker-compose.replicaset.yml:
 *   docker compose -f docker-compose.replicaset.yml up -d
 *   node scripts/initReplicaSet.js
 *
 * This only needs to run once per fresh volume. Subsequent starts will
 * already have the RS config persisted in the mongo data volumes.
 */

import { MongoClient } from 'mongodb';

const PRIMARY_URI = process.env.MONGO_RS_PRIMARY || 'mongodb://localhost:27017';

const RS_CONFIG = {
  _id: 'rs0',
  members: [
    { _id: 0, host: 'mongo1:27017', priority: 2 }, // preferred primary
    { _id: 1, host: 'mongo2:27017', priority: 1 },
    { _id: 2, host: 'mongo3:27017', priority: 1 },
  ],
};

async function initReplicaSet() {
  const client = new MongoClient(PRIMARY_URI, {
    directConnection: true,
    serverSelectionTimeoutMS: 10000,
  });

  try {
    await client.connect();
    console.log('Connected to mongo1. Initialising replica set...');

    const adminDb = client.db('admin');

    // Check current status first
    let currentStatus;
    try {
      currentStatus = await adminDb.command({ replSetGetStatus: 1 });
      console.log(
        `Replica set "${currentStatus.set}" already initialised (state: ${currentStatus.myState}). Skipping.`
      );
      return;
    } catch {
      // NotYetInitialized — proceed with init
    }

    const result = await adminDb.command({ replSetInitiate: RS_CONFIG });
    console.log('replSetInitiate result:', JSON.stringify(result, null, 2));

    // Wait for primary election (up to 30 s)
    let elected = false;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const status = await adminDb.command({ replSetGetStatus: 1 });
        const primary = status.members?.find((m) => m.stateStr === 'PRIMARY');
        if (primary) {
          console.log(`Primary elected: ${primary.name} (after ${i + 1} s)`);
          elected = true;
          break;
        }
        process.stdout.write('.');
      } catch {
        // still initialising
      }
    }

    if (!elected) {
      console.error('\nERROR: No primary elected within 30 s. Check container networking.');
      process.exitCode = 1;
    } else {
      console.log('\nReplica set ready.');
      console.log(
        'Connection string: mongodb://mongo1:27017,mongo2:27017,mongo3:27017/school_db?replicaSet=rs0'
      );
    }
  } finally {
    await client.close();
  }
}

initReplicaSet().catch((err) => {
  console.error('initReplicaSet failed:', err.message);
  process.exitCode = 1;
});
