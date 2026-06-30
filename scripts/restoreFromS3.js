/**
 * restoreFromS3.js
 *
 * Restores a MongoDB database from an S3 backup created by renderDbBackup.js.
 *
 * Usage:
 *   node scripts/restoreFromS3.js --latest [--drop] [--dry-run]
 *   node scripts/restoreFromS3.js --timestamp 2026-06-09T02-00-00-000Z [--drop] [--dry-run]
 *   node scripts/restoreFromS3.js --list
 *
 * Required env vars (same set used by renderDbBackup.js):
 *   MONGODB_URI or MONGO_URI, BACKUP_S3_BUCKET, BACKUP_S3_REGION,
 *   BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY
 *
 * Optional env vars:
 *   BACKUP_S3_PREFIX, BACKUP_S3_ENDPOINT, BACKUP_S3_FORCE_PATH_STYLE
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { createGunzip } from 'zlib';
import { Readable } from 'stream';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';

// ─── Parse CLI args ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const argValue = (name) => {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : undefined;
};

const isList = flag('--list');
const isLatest = flag('--latest');
const targetTimestamp = argValue('--timestamp');
const isDryRun = flag('--dry-run');
const shouldDrop = flag('--drop');

if (!isList && !isLatest && !targetTimestamp) {
  console.error(`
Usage:
  node scripts/restoreFromS3.js --latest [--drop] [--dry-run]
  node scripts/restoreFromS3.js --timestamp <ISO-timestamp> [--drop] [--dry-run]
  node scripts/restoreFromS3.js --list

Options:
  --latest         Restore the most recent backup
  --timestamp      Restore a specific backup by timestamp folder name
  --list           List available backups in S3
  --drop           Drop existing collections before restoring
  --dry-run        Show what would be restored without modifying the database
`);
  process.exit(1);
}

// ─── Config ──────────────────────────────────────────────────────────────────

dotenv.config();

const requireEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!mongoUri) {
  throw new Error('Missing required environment variable: MONGO_URI or MONGODB_URI');
}

const backupBucket = requireEnv('BACKUP_S3_BUCKET');
const backupRegion = requireEnv('BACKUP_S3_REGION');
const backupPrefix = (process.env.BACKUP_S3_PREFIX || 'mongo-backups').replace(/^\/+|\/+$/g, '');

const s3 = new S3Client({
  region: backupRegion,
  endpoint: process.env.BACKUP_S3_ENDPOINT || undefined,
  forcePathStyle: process.env.BACKUP_S3_FORCE_PATH_STYLE === 'true',
  credentials: {
    accessKeyId: requireEnv('BACKUP_S3_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('BACKUP_S3_SECRET_ACCESS_KEY'),
  },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getObject = (key) =>
  s3.send(new GetObjectCommand({ Bucket: backupBucket, Key: key })).then((r) => r.Body);

const streamToString = async (body) => {
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
};

const listManifests = async () => {
  let continuationToken;
  const manifests = [];

  do {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: backupBucket,
        Prefix: `${backupPrefix}/`,
        ContinuationToken: continuationToken,
      })
    );

    for (const obj of response.Contents ?? []) {
      if (obj.Key.endsWith('/manifest.json')) {
        manifests.push(obj);
      }
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  manifests.sort((a, b) => b.LastModified - a.LastModified);
  return manifests;
};

const findManifestKey = async () => {
  const manifests = await listManifests();

  if (!manifests.length) {
    throw new Error(`No manifest files found under s3://${backupBucket}/${backupPrefix}/`);
  }

  if (isLatest) {
    return manifests[0].Key;
  }

  if (targetTimestamp) {
    const match = manifests.find((m) => m.Key.includes(`/${targetTimestamp}/`));
    if (!match) {
      throw new Error(
        `No backup found for timestamp "${targetTimestamp}". Run --list to see available backups.`
      );
    }
    return match.Key;
  }

  return manifests[0].Key;
};

const parseNdjsonStream = async (body) => {
  const gunzip = createGunzip();
  const source = Readable.from(body);
  source.pipe(gunzip);

  const documents = [];
  let partial = '';

  for await (const chunk of gunzip) {
    const text = partial + chunk.toString('utf8');
    const lines = text.split('\n');
    partial = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      documents.push(JSON.parse(line));
    }
  }

  if (partial.trim()) {
    documents.push(JSON.parse(partial));
  }

  return documents;
};

const restoreCollection = async (db, collectionName, documents, { dryRun }) => {
  if (dryRun) {
    console.log(`  [DRY-RUN] Would insert ${documents.length} documents into "${collectionName}"`);
    return documents.length;
  }

  const collection = db.collection(collectionName);

  if (shouldDrop) {
    console.log(`  Dropping existing collection "${collectionName}"...`);
    await collection.drop().catch((err) => {
      if (err.codeName !== 'NamespaceNotFound') throw err;
    });
  }

  if (!documents.length) {
    console.log(`  Collection "${collectionName}" has 0 documents — nothing to insert`);
    return 0;
  }

  const result = await collection.insertMany(documents, { ordered: false });
  console.log(`  Inserted ${result.insertedCount} documents into "${collectionName}"`);
  return result.insertedCount;
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const run = async () => {
  if (isList) {
    const manifests = await listManifests();
    console.log(`Available backups (${manifests.length} total):\n`);
    for (const m of manifests) {
      const timestamp = m.Key.match(/\/([^/]+)\/manifest\.json$/)?.[1] ?? 'unknown';
      console.log(`  ${timestamp}  —  s3://${backupBucket}/${m.Key}`);
    }
    return;
  }

  console.log(isDryRun ? 'Starting DRY-RUN restore…' : 'Starting database restore…');

  const manifestKey = await findManifestKey();
  console.log(`Using manifest: s3://${backupBucket}/${manifestKey}`);

  const manifestBody = await getObject(manifestKey);
  const manifest = JSON.parse(await streamToString(manifestBody));

  console.log(`Backup created: ${manifest.createdAt}`);
  console.log(`Database: ${manifest.database}`);
  console.log(`Collections to restore: ${manifest.collectionCount}\n`);

  if (isDryRun) {
    console.log('DRY-RUN mode: no database changes will be made.\n');
  }

  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 5,
  });

  const db = mongoose.connection.db;
  const results = [];

  for (const col of manifest.collections) {
    console.log(`Restoring "${col.collectionName}" (expected ${col.documentCount} docs)…`);

    try {
      const body = await getObject(col.key);
      const documents = await parseNdjsonStream(body);

      if (documents.length !== col.documentCount) {
        console.warn(
          `  WARNING: document count mismatch (manifest: ${col.documentCount}, actual: ${documents.length})`
        );
      }

      const inserted = await restoreCollection(db, col.collectionName, documents, {
        dryRun: isDryRun,
      });

      results.push({
        collection: col.collectionName,
        status: 'ok',
        expected: col.documentCount,
        inserted,
      });
    } catch (error) {
      console.error(`  FAILED: ${error.message}`);
      results.push({
        collection: col.collectionName,
        status: 'fail',
        error: error.message,
      });
    }
  }

  console.log('\n────────────────────────────────────────');
  console.log(isDryRun ? 'DRY-RUN complete' : 'Restore complete');
  console.log('────────────────────────────────────────');

  const ok = results.filter((r) => r.status === 'ok');
  const failed = results.filter((r) => r.status === 'fail');

  for (const r of ok) {
    console.log(`  ✓ ${r.collection}: ${r.inserted}/${r.expected} docs`);
  }
  for (const r of failed) {
    console.log(`  ✗ ${r.collection}: ${r.error}`);
  }

  if (failed.length) {
    console.error(`\nFAILED: ${failed.length} collection(s) could not be restored`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${ok.length} collection(s) restored successfully.`);
  }
};

run()
  .catch((error) => {
    console.error('Restore failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });
