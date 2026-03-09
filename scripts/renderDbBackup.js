import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { once } from 'events';
import { PassThrough } from 'stream';
import { finished } from 'stream/promises';
import { createGzip } from 'zlib';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

dotenv.config();

const requireEnv = (name) => {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!mongoUri) {
  throw new Error('Missing required environment variable: MONGO_URI or MONGODB_URI');
}

const backupBucket = requireEnv('BACKUP_S3_BUCKET');
const backupRegion = requireEnv('BACKUP_S3_REGION');
const backupPrefix = (process.env.BACKUP_S3_PREFIX || 'mongo-backups').replace(/^\/+|\/+$/g, '');
const backupTimestamp = new Date().toISOString().replace(/[:.]/g, '-');

const s3 = new S3Client({
  region: backupRegion,
  endpoint: process.env.BACKUP_S3_ENDPOINT || undefined,
  forcePathStyle: process.env.BACKUP_S3_FORCE_PATH_STYLE === 'true',
  credentials: {
    accessKeyId: requireEnv('BACKUP_S3_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('BACKUP_S3_SECRET_ACCESS_KEY'),
  },
});

const uploadCollection = async (db, databaseName, collectionName) => {
  const key = `${backupPrefix}/${databaseName}/${backupTimestamp}/${collectionName}.ndjson.gz`;
  const collection = db.collection(collectionName);
  const gzip = createGzip();
  const stream = new PassThrough();

  gzip.pipe(stream);

  const uploadPromise = s3.send(new PutObjectCommand({
    Bucket: backupBucket,
    Key: key,
    Body: stream,
    ContentEncoding: 'gzip',
    ContentType: 'application/x-ndjson',
  }));

  let documentCount = 0;

  try {
    for await (const document of collection.find({})) {
      const line = `${JSON.stringify(document)}\n`;

      if (!gzip.write(line)) {
        await once(gzip, 'drain');
      }

      documentCount += 1;
    }

    gzip.end();
    await finished(gzip);
    await uploadPromise;
  } catch (error) {
    gzip.destroy(error);
    throw error;
  }

  return {
    collectionName,
    documentCount,
    key,
  };
};

const uploadManifest = async (manifest) => {
  const key = `${backupPrefix}/${manifest.database}/${backupTimestamp}/manifest.json`;

  await s3.send(new PutObjectCommand({
    Bucket: backupBucket,
    Key: key,
    Body: JSON.stringify(manifest, null, 2),
    ContentType: 'application/json',
  }));

  return key;
};

const run = async () => {
  console.log('Starting Render backup job...');

  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 5,
  });

  const db = mongoose.connection.db;
  const databaseName = db.databaseName;
  const collectionNames = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map(({ name }) => name)
    .filter((name) => !name.startsWith('system.'));

  console.log(`Backing up ${collectionNames.length} collections from ${databaseName}`);

  const collections = [];

  for (const collectionName of collectionNames) {
    console.log(`Uploading ${collectionName}...`);
    const summary = await uploadCollection(db, databaseName, collectionName);
    collections.push(summary);
    console.log(`Uploaded ${collectionName}: ${summary.documentCount} documents`);
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    database: databaseName,
    collectionCount: collections.length,
    collections,
  };

  const manifestKey = await uploadManifest(manifest);
  console.log(`Backup completed. Manifest uploaded to ${manifestKey}`);
};

run()
  .catch((error) => {
    console.error('Backup job failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });
