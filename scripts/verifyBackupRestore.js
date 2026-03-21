/**
 * verifyBackupRestore.js
 *
 * Downloads the most recent backup manifest from S3, then verifies every
 * collection file by decompressing it and checking that:
 *   1. Each line is valid JSON
 *   2. The document count matches the manifest
 *
 * Exit codes:
 *   0 — all collections verified (backup is restorable)
 *   1 — one or more collections failed verification
 *
 * Usage:
 *   node scripts/verifyBackupRestore.js
 *
 * Required env vars (same set used by renderDbBackup.js):
 *   BACKUP_S3_BUCKET, BACKUP_S3_REGION,
 *   BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY
 *
 * Optional env vars:
 *   BACKUP_S3_PREFIX, BACKUP_S3_ENDPOINT, BACKUP_S3_FORCE_PATH_STYLE
 */

import dotenv from 'dotenv';
import { createGunzip } from 'zlib';
import { Readable } from 'stream';
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

dotenv.config();

// ─── Config ──────────────────────────────────────────────────────────────────

const requireEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

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

/**
 * Find the manifest.json key from the most recently written backup set.
 * Manifests live at: <prefix>/<database>/<timestamp>/manifest.json
 */
const findLatestManifestKey = async () => {
  // Paginate through all objects; stop once we have enough keys.
  let continuationToken;
  const manifestObjects = [];

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
        manifestObjects.push(obj);
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  if (!manifestObjects.length) {
    throw new Error(`No manifest files found under s3://${backupBucket}/${backupPrefix}/`);
  }

  // Sort descending by LastModified; pick the newest.
  manifestObjects.sort((a, b) => b.LastModified - a.LastModified);
  return manifestObjects[0].Key;
};

/**
 * Download, decompress, and validate a single .ndjson.gz collection file.
 * Returns { lineCount, expectedCount, parseError, matches }.
 */
const verifyCollection = async (key, expectedCount) => {
  const body = await getObject(key);
  const gunzip = createGunzip();
  const source = Readable.from(body);
  source.pipe(gunzip);

  let lineCount = 0;
  let partial = '';
  let parseError = null;

  for await (const chunk of gunzip) {
    const text = partial + chunk.toString('utf8');
    const lines = text.split('\n');
    // Last element may be an incomplete line – carry it forward.
    partial = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        JSON.parse(line);
        lineCount++;
      } catch (e) {
        parseError = `Invalid JSON at document ${lineCount + 1}: ${e.message}`;
        break;
      }
    }

    if (parseError) break;
  }

  // Handle any remaining partial content after stream ends.
  if (!parseError && partial.trim()) {
    try {
      JSON.parse(partial);
      lineCount++;
    } catch (e) {
      parseError = `Invalid JSON in final document: ${e.message}`;
    }
  }

  const matches = !parseError && lineCount === expectedCount;
  return { lineCount, expectedCount, parseError, matches };
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const run = async () => {
  console.log('Starting backup restore verification…');

  const manifestKey = await findLatestManifestKey();
  console.log(`Using manifest: s3://${backupBucket}/${manifestKey}`);

  const manifestBody = await getObject(manifestKey);
  const manifest = JSON.parse(await streamToString(manifestBody));

  console.log(`Backup created: ${manifest.createdAt}`);
  console.log(`Collections to verify: ${manifest.collectionCount}\n`);

  let allPassed = true;
  const results = [];

  for (const col of manifest.collections) {
    process.stdout.write(
      `  Verifying ${col.collectionName} (expected ${col.documentCount} docs)… `
    );

    try {
      const result = await verifyCollection(col.key, col.documentCount);

      if (result.matches) {
        console.log(`OK (${result.lineCount} docs)`);
        results.push({ collection: col.collectionName, status: 'pass', count: result.lineCount });
      } else if (result.parseError) {
        console.log(`FAIL: ${result.parseError}`);
        results.push({ collection: col.collectionName, status: 'fail', reason: result.parseError });
        allPassed = false;
      } else {
        const reason = `count mismatch: got ${result.lineCount}, expected ${result.expectedCount}`;
        console.log(`FAIL: ${reason}`);
        results.push({ collection: col.collectionName, status: 'fail', reason });
        allPassed = false;
      }
    } catch (error) {
      console.log(`FAIL: ${error.message}`);
      results.push({ collection: col.collectionName, status: 'fail', reason: error.message });
      allPassed = false;
    }
  }

  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;

  console.log(`\nVerification complete: ${passed}/${manifest.collectionCount} collections passed`);

  if (!allPassed) {
    console.error(
      `FAILED: ${failed} collection(s) could not be verified — backup may not be restorable`
    );
    process.exitCode = 1;
  } else {
    console.log('All collections verified successfully — backup is restorable.');
  }
};

run().catch((error) => {
  console.error('Restore verification failed:', error);
  process.exitCode = 1;
});
