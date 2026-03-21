# Database Failover Strategy — EMS

## Objectives

| Metric | Target | Basis |
|--------|--------|-------|
| **RTO** (Recovery Time Objective) | ≤ 30 seconds | MongoDB Atlas automatic primary re-election |
| **RPO** (Recovery Point Objective) | 0 seconds | Majority write concern (`w:"majority"`, `j:true`) |

### What these mean

- **RTO ≤ 30 s**: After a primary node failure, the MongoDB driver detects the outage within
  `heartbeatFrequencyMS` (10 s), waits for a secondary to win the election (typically 10–30 s on Atlas),
  then automatically retries in-flight operations. No application restart is needed.

- **RPO = 0**: Every write acknowledged by the application has been committed to a majority of replica
  set members and flushed to the journal. A primary crash immediately after acknowledgement cannot roll
  back any confirmed write.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    MongoDB Atlas (M10+)                  │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Primary    │  │ Secondary 1  │  │ Secondary 2  │  │
│  │  (writes +   │  │  (reads +    │  │  (reads +    │  │
│  │   reads)     │  │   failover)  │  │   failover)  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │  Oplog stream   │                 │           │
│         └─────────────────┴─────────────────┘           │
└─────────────────────────────────────────────────────────┘
         ▲ w:"majority" write acknowledgement
         │
┌────────┴──────────────────────────────────┐
│          EMS Backend (Node.js)            │
│  retryWrites: true   retryReads: true     │
│  readPreference: primaryPreferred         │
│  heartbeatFrequencyMS: 10000              │
│  serverSelectionTimeoutMS: 30000          │
└───────────────────────────────────────────┘
```

---

## Connection Options (implemented in `database.js`)

| Option | Value | Purpose |
|--------|-------|---------|
| `retryWrites` | `true` | Retry idempotent writes on transient network errors |
| `retryReads` | `true` | Retry reads on transient network errors |
| `w` | `"majority"` | Wait for majority acknowledgement before confirming write |
| `j` | `true` | Flush to journal before acknowledging |
| `readPreference` | `"primaryPreferred"` | Read from primary; fall back to secondary if primary is unreachable |
| `heartbeatFrequencyMS` | `10000` | Detect primary failure within 10 s |
| `serverSelectionTimeoutMS` | `30000` | Allow up to 30 s for new primary election |
| `connectTimeoutMS` | `10000` | Hard per-socket connection timeout |

---

## Failover Sequence

1. Primary node becomes unreachable.
2. Driver heartbeat detects failure within **10 s** (`heartbeatFrequencyMS`).
3. Remaining members hold an election; a new primary is elected within **10–30 s** (Atlas SLA).
4. Driver routes all writes and reads to the new primary automatically.
5. Any in-flight writes are retried once (`retryWrites: true`).
6. Application resumes without restart. Logs show:
   ```
   MongoDB disconnected — driver will retry automatically
   MongoDB connected successfully
   ```
7. Alert: `/api/ops/replica-status` endpoint transitions `myState` from `1 (PRIMARY)` to `2 (SECONDARY)` and back.

**Total downtime visible to end-users: ≤ 30 s.**

---

## Monitoring

### Replica set status endpoint
```
GET /api/ops/replica-status
```

Example healthy response:
```json
{
  "setName": "atlas-rs0",
  "myState": 1,
  "primary": "mongo-shard-00-00.example.mongodb.net:27017",
  "secondaryCount": 2,
  "members": [
    { "name": "...:27017", "state": "PRIMARY",   "health": "healthy", "lagSeconds": 0 },
    { "name": "...:27017", "state": "SECONDARY", "health": "healthy", "lagSeconds": 1 },
    { "name": "...:27017", "state": "SECONDARY", "health": "healthy", "lagSeconds": 2 }
  ]
}
```

Returns `503` if the database is disconnected.

### Key log lines to watch
| Event | Log message |
|-------|-------------|
| Failover starts | `MongoDB disconnected — driver will retry automatically` |
| New primary elected | `MongoDB connected successfully` |
| Full RS back | `MongoDB replica set: primary + all secondaries connected` |

---

## Atlas Tier Requirements

| Tier | RS Members | Automated Failover |
|------|-----------|-------------------|
| M10+ | 3-node RS | Yes (SLA: < 30 s) |
| M0/M2/M5 (free/shared) | 3-node RS | Yes, but no SLA |

> **Recommendation**: Use **M10** or above in production to guarantee the failover SLA. M0/M2/M5 share
> infrastructure and may have degraded election times.

---

## Backup Strategy (RPO for disaster scenarios)

Beyond replica set failover (which covers node failure), full data recovery is covered by:

| Layer | Tool | Schedule | Retention |
|-------|------|----------|-----------|
| **Atlas PITR** | MongoDB Atlas Point-in-Time Recovery | Continuous (oplog) | 2 days (M10), 35 days (M30+) |
| **S3 snapshot** | `npm run backup:db` via Render cron | Daily | 30 days |
| **In-app backup** | `POST /api/v1/backup/create` | On-demand | Stored in MongoDB |

For full disaster recovery from S3 backup, see the restore procedure below.

---

## Restore Procedure (from S3 backup)

```bash
# 1. Set environment variables
export MONGO_URI="mongodb+srv://..."
export BACKUP_S3_BUCKET="ems-backups"
export BACKUP_S3_REGION="ap-south-1"
export BACKUP_S3_ACCESS_KEY_ID="..."
export BACKUP_S3_SECRET_ACCESS_KEY="..."

# 2. Download the manifest to find the backup timestamp
aws s3 ls s3://$BACKUP_S3_BUCKET/mongo-backups/<database>/ --recursive | grep manifest.json

# 3. Restore a collection (decompress NDJSON and mongoimport)
aws s3 cp s3://$BACKUP_S3_BUCKET/mongo-backups/<db>/<timestamp>/students.ndjson.gz - \
  | gunzip \
  | mongoimport --uri="$MONGO_URI" --collection=students --drop

# Repeat for each collection listed in the manifest.
```

**Expected RTO from S3 restore**: 30–120 minutes depending on database size.
**Expected RPO from S3 restore**: Up to 24 hours (last daily backup).

---

## Local Replica Set (Development / Testing)

To test failover behaviour locally:

```bash
# Start 3-node RS
docker compose -f docker-compose.replicaset.yml up -d

# Initialise the replica set (one-time)
node scripts/initReplicaSet.js

# Simulate primary failure
docker compose -f docker-compose.replicaset.yml stop mongo1

# Watch the app logs — reconnection should complete within 30 s
docker compose -f docker-compose.replicaset.yml logs -f app

# Restore the primary
docker compose -f docker-compose.replicaset.yml start mongo1
```
