# Database Restore Runbook — EMS

Use this guide when you need to restore the EMS MongoDB database from a backup.

---

## When to Restore

- **Data loss event**: Accidental deletion of records, collections, or the entire database
- **Corruption**: Database files or documents become corrupted
- **Ransomware / security incident**: Database has been compromised
- **Failed migration**: A deployment migration caused data integrity issues
- **Disaster recovery**: Hosting provider outage or complete infrastructure loss

> ⚠️ **Warning**: Restoring a backup overwrites existing data. Always verify you are restoring the correct backup before proceeding.

---

## Prerequisites

1. **AWS / S3 credentials** with read access to the backup bucket
2. **MongoDB connection string** for the target database
3. **Node.js 18+** installed locally (or access to the backend container)
4. **Backup manifest access** — know the approximate timestamp of the last good backup

---

## Backup Overview

| Layer | Tool | Schedule | Retention |
|-------|------|----------|-----------|
| Atlas PITR | MongoDB Atlas | Continuous | 2–35 days |
| S3 snapshot | `npm run backup:db` | Daily at 02:00 UTC | 30 days |
| In-app backup | `POST /api/v1/backup/create` | On-demand | Stored in MongoDB |

This runbook covers restoration from the **S3 snapshot** layer. For Atlas PITR, use the MongoDB Atlas console.

---

## Step 1 — Identify the Correct Backup

### Option A: List available backups

```bash
export MONGODB_URI="mongodb+srv://<user>:<pass>@cluster.mongodb.net/school_db"
export BACKUP_S3_BUCKET="ems-backups"
export BACKUP_S3_REGION="ap-south-1"
export BACKUP_S3_ACCESS_KEY_ID="..."
export BACKUP_S3_SECRET_ACCESS_KEY="..."

node scripts/restoreFromS3.js --list
```

Output:
```
Available backups (14 total):

  2026-06-09T02-00-00-000Z  —  s3://ems-backups/mongo-backups/school_db/2026-06-09T02-00-00-000Z/manifest.json
  2026-06-08T02-00-00-000Z  —  s3://ems-backups/mongo-backups/school_db/2026-06-08T02-00-00-000Z/manifest.json
```

### Option B: Find the backup in the AWS Console

1. Open the S3 bucket (`ems-backups`)
2. Navigate to `mongo-backups/<database-name>/`
3. Look for the timestamp folder from the date you want to restore

---

## Step 2 — Dry-Run the Restore (Strongly Recommended)

Always run a dry-run first to verify the backup is readable and matches expectations:

```bash
node scripts/restoreFromS3.js --latest --dry-run
```

Or for a specific backup:

```bash
node scripts/restoreFromS3.js --timestamp 2026-06-09T02-00-00-000Z --dry-run
```

This will:
- Download the manifest
- Verify every collection file can be decompressed and parsed
- Show the document count for each collection
- **Not modify the database**

If the dry-run reports any failures, do not proceed. Investigate the backup corruption first.

---

## Step 3 — Execute the Restore

### Full restore (drop existing collections)

Use this when the database is empty or you want to completely replace it:

```bash
node scripts/restoreFromS3.js --latest --drop
```

### Restore without dropping (merge mode)

Use this when you only want to restore missing collections or add documents to existing ones:

```bash
node scripts/restoreFromS3.js --latest
```

> ⚠️ **Caution**: Without `--drop`, duplicate `_id` values will cause insert errors. The script uses `ordered: false` so duplicates are skipped, but this may leave the database in an inconsistent state.

### Restore a specific backup

```bash
node scripts/restoreFromS3.js --timestamp 2026-06-09T02-00-00-000Z --drop
```

---

## Step 4 — Verify the Restore

### 4a. Document counts

Connect to the database and compare collection counts with the manifest:

```bash
mongosh "$MONGODB_URI" --eval "
  db.getCollectionNames().forEach(c => {
    if (!c.startsWith('system.')) {
      print(c + ': ' + db[c].countDocuments());
    }
  });
"
```

### 4b. Application health check

```bash
curl -sf https://<your-backend>/health && echo "Backend healthy"
```

### 4c. Spot-check key records

Verify a few critical records exist:

```bash
mongosh "$MONGODB_URI" --eval "
  print('Schools: ' + db.schools.countDocuments());
  print('Students: ' + db.students.countDocuments());
  print('Staff: ' + db.staff.countDocuments());
  print('Fee payments: ' + db.feepayments.countDocuments());
"
```

### 4d. Run the automated verification script

```bash
node scripts/verifyBackupRestore.js
```

This validates the **latest backup file on S3** (not the live database). Run this after restore to confirm the backup chain is still intact.

---

## Step 5 — Post-Restore Actions

1. **Restart the backend** if it was running during the restore:
   ```bash
   docker compose restart app
   # or on Render: trigger a manual deploy
   ```

2. **Clear Redis cache** (if applicable):
   ```bash
   docker compose exec redis redis-cli FLUSHDB
   ```

3. **Verify parent / staff apps** can log in and see data

4. **Notify the team** in `#incidents` with:
   - Date/time of the incident
   - Backup timestamp used for restore
   - Any data loss window (RPO)

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODB_URI` | Yes | Target MongoDB connection string |
| `BACKUP_S3_BUCKET` | Yes | S3 bucket containing backups |
| `BACKUP_S3_REGION` | Yes | S3 bucket region |
| `BACKUP_S3_ACCESS_KEY_ID` | Yes | AWS access key |
| `BACKUP_S3_SECRET_ACCESS_KEY` | Yes | AWS secret key |
| `BACKUP_S3_PREFIX` | No | Path prefix in bucket (default: `mongo-backups`) |
| `BACKUP_S3_ENDPOINT` | No | Custom S3 endpoint (e.g. Cloudflare R2) |
| `BACKUP_S3_FORCE_PATH_STYLE` | No | Set to `true` for MinIO or local S3 |

---

## Rollback Plan

If the restore goes wrong and you need to undo it:

1. **If you have Atlas PITR enabled** (M10+): Use the Atlas console to restore to a point in time **just before** you ran the restore script.

2. **If you have another S3 backup**: Identify an earlier backup timestamp and run the restore script again with `--drop`.

3. **If no other backups exist**: The data is unrecoverable. This is why the `--dry-run` step and regular `verifyBackupRestore.js` runs are critical.

---

## Recovery Time Objectives

| Scenario | Expected RTO | Expected RPO |
|----------|-------------|--------------|
| Atlas PITR restore | 15–60 min | 0–5 min |
| S3 full restore (this runbook) | 30–120 min | Up to 24 hours |
| In-app backup restore | 5–15 min | Variable |

---

## Escalation

If you cannot complete the restore using this runbook:

1. Check `docs/DATABASE_FAILOVER.md` for replica-set-specific issues
2. Contact the tech lead with the manifest key and error output
3. For Atlas-specific restores, open a support ticket with MongoDB Atlas
