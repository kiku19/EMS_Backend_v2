# Multi-Region Deployment Strategy — EMS Backend

> **Status:** Planning document. Single-region (Mumbai) is sufficient at current scale.
> Revisit when school count or geographic spread justifies the infrastructure cost.

---

## When to Go Multi-Region

Trigger any of these before investing in multi-region:

| Signal | Threshold |
|--------|-----------|
| Active schools in 2+ distant states | ≥ 50 schools outside Maharashtra |
| P95 latency from secondary region | > 300 ms consistently |
| Monthly infrastructure budget | > ₹2 lakh/month |
| Data residency requirement | State-level compliance mandate |

---

## Target Regions (India)

| Region | Cloud | Purpose |
|--------|-------|---------|
| `ap-south-1` (Mumbai) | AWS / Render | Primary — write traffic, auth, jobs |
| `ap-south-2` (Chennai/Hyderabad) | AWS | Read replica, CDN PoP |

---

## Architecture Overview

```
                        ┌─────────────────────────────┐
Clients ──────────────▶ │   AWS Route 53 / Cloudflare │
(web, mobile, parent)   │   Geo-DNS latency routing   │
                        └───────────┬─────────────────┘
                                    │
              ┌─────────────────────┴───────────────────────┐
              ▼ Mumbai (primary)                             ▼ Chennai (secondary)
   ┌────────────────────┐                        ┌────────────────────┐
   │  ALB / Render LB   │                        │  ALB / Render LB   │
   └────────┬───────────┘                        └────────┬───────────┘
            │ round-robin                                 │ round-robin
    ┌───────┴────────┐                           ┌───────┴────────┐
    │ app:1  app:2   │                           │ app:3  app:4   │
    │   (Node.js)    │                           │   (Node.js)    │
    └───────┬────────┘                           └───────┬────────┘
            │                                           │
    ┌───────┴────────┐                        ┌────────┴────────┐
    │  Redis Primary │◀────── replication ───▶│  Redis Replica  │
    │  (Upstash MUM) │                        │  (Upstash HYD)  │
    └────────────────┘                        └─────────────────┘
            │                                           │
            └──────────────────┬────────────────────────┘
                               ▼
                  ┌────────────────────────┐
                  │  MongoDB Atlas          │
                  │  Global Cluster         │
                  │  ┌──────────────────┐   │
                  │  │ Primary (Mumbai) │   │
                  │  │ Replica (Chennai)│   │
                  │  │ Replica (Singapore)│ │
                  │  └──────────────────┘   │
                  └────────────────────────┘
                               │
                  ┌────────────────────────┐
                  │  Cloudinary (CDN)       │
                  │  Static assets, media   │
                  │  Auto geo-distributed   │
                  └────────────────────────┘
```

---

## 1. Database Strategy — MongoDB Atlas Global Clusters vs Replica Sets

### Option A: Atlas Global Cluster (Recommended for 2+ regions)

**How it works:** Zones map collections to specific regions. Write operations on zone-local shards are fast; cross-zone writes fall back to primary.

**EMS shard key:** `{ schoolId: 1 }` — each school's data lives in the zone nearest to that school.

```js
// Atlas zone mapping (configured via Atlas UI or Terraform)
// Zone: "india-west"  → ap-south-1 (Mumbai)  → Maharashtra, Gujarat schools
// Zone: "india-south" → ap-south-2 (Chennai)  → Tamil Nadu, Karnataka schools
```

**Pros:** Zone-local reads AND writes for schools in their region. No application-level read preference needed.
**Cons:** Requires M30+ cluster (~$500/month base). Shard key must be chosen before data migration.

### Option B: Atlas Replica Set + Read Preference (Simpler, cheaper)

One primary in Mumbai + one secondary in Chennai. Application routes reads to nearest node.

```js
// In database.js — add readPreference to connection options
mongoose.connect(process.env.MONGODB_URI, {
  readPreference: process.env.MONGO_READ_PREFERENCE || 'primaryPreferred',
  readPreferenceTags: process.env.MONGO_READ_TAGS
    ? JSON.parse(process.env.MONGO_READ_TAGS)
    : undefined,
});
```

For GET-heavy endpoints (attendance lists, fee reports, result dashboards), use secondary reads:

```js
// Example: read-replica routing for reports (no real-time consistency needed)
Model.find(query).read('secondaryPreferred');
```

**Pros:** Works with existing M10/M20 clusters. No shard key migration needed.
**Cons:** All writes still go to Mumbai primary. Adds ~10–20 ms cross-region write latency if primary fails over.

### Recommendation

Start with **Option B** (replica set + read preference). Migrate to Option A only when write latency from Chennai becomes a user complaint.

---

## 2. CDN Strategy for Static Assets

Current: Cloudinary handles media (images, documents). React dashboard and parent-app web builds are served from Render's static CDN.

### Dashboard & Web Apps

Render's static sites are served via a global CDN with Indian PoPs. No change needed.

For self-hosted deployments (AWS):

```
S3 bucket (ap-south-1)
  └── CloudFront distribution
        ├── PoP: Mumbai
        ├── PoP: Chennai
        └── Price class: PriceClass_100 (India-focused)
```

### Cloudinary Media (Profile photos, fee receipts, documents)

Cloudinary automatically geo-distributes via its CDN. No regional config needed on our side.

For cost control, set upload presets:
- Images: `quality: auto`, `fetch_format: auto`
- Documents: no transformation, direct delivery

### Environment Variable

```env
# Already used in Cloudinary config — no new vars needed
CLOUDINARY_CLOUD_NAME=...
```

---

## 3. Read Replica Routing for GET-Heavy Endpoints

Add a `MONGO_READ_PREFERENCE` env var to enable secondary reads in production without code changes:

```env
# .env.production
MONGO_READ_PREFERENCE=secondaryPreferred
```

Endpoints that benefit most from secondary reads (no real-time write dependency):
- `GET /api/attendance` — historical records
- `GET /api/fees/reports` — fee summaries
- `GET /api/academics/results` — published results
- `GET /api/students` — list/search
- `GET /api/staff` — list/search

Endpoints that MUST use primary (write-after-read consistency):
- All POST/PUT/PATCH/DELETE endpoints
- `GET /api/fees/student/:id` after payment — balance must reflect latest write
- Auth endpoints

---

## 4. DNS-Based Geo-Routing

### Cloudflare (Recommended — free tier covers India routing)

```
app.yourschool.in  →  Cloudflare
  ├── India         →  api-mum.yourschool.in (Mumbai ALB)
  └── Default       →  api-mum.yourschool.in (Mumbai ALB — fallback)
```

When Chennai region is active:
```
  ├── South India   →  api-chn.yourschool.in (Chennai ALB)
  ├── Other India   →  api-mum.yourschool.in (Mumbai ALB)
  └── Default       →  api-mum.yourschool.in
```

### AWS Route 53 (If on AWS)

```
Latency-based routing policy:
  school-api.yourschool.in
    CNAME → alb-mumbai.ap-south-1.elb.amazonaws.com  (region: ap-south-1)
    CNAME → alb-chennai.ap-south-2.elb.amazonaws.com (region: ap-south-2)
```

Route 53 automatically routes to the region with lower measured latency.

### CORS Update Required

When adding a secondary regional domain, add it to `CORS_ORIGIN`:

```env
CORS_ORIGIN=https://app.yourschool.in,https://app-south.yourschool.in
```

---

## 5. Regional Media Storage

Current: All media goes to Cloudinary (globally distributed by default).

If data residency mandates India-only storage:

```
Option A: Cloudinary with India data residency add-on (enterprise plan)
Option B: AWS S3 ap-south-1 (Mumbai) + S3 Transfer Acceleration
Option C: Backblaze B2 Mumbai + Cloudflare CDN
```

For S3 migration, the relevant env vars (already in `render.yaml`):

```env
BACKUP_S3_BUCKET=ems-media-india
BACKUP_S3_REGION=ap-south-1
BACKUP_S3_ACCESS_KEY_ID=...
BACKUP_S3_SECRET_ACCESS_KEY=...
```

No code change needed — the Cloudinary/S3 abstraction is already in `services/`.

---

## 6. WebSocket Routing Per Region

Current state: Socket.IO uses Redis adapter (`@socket.io/redis-adapter`) for pub/sub across instances within one region. See `horizontal-scaling.md`.

### Multi-Region WebSocket Architecture

Each region runs its own Socket.IO cluster connected to a regional Redis. Cross-region events are forwarded via a message broker.

```
Mumbai cluster ──┐                 ┌── Chennai cluster
  app:1 ──redis-mum   cross-region    redis-chn── app:3
  app:2 ──┘      └─── pub/sub ────┘               app:4
```

**Cross-region event forwarding options:**

| Option | Complexity | Latency | Cost |
|--------|-----------|---------|------|
| Upstash Redis Global (active-active) | Low | ~15 ms | ~$0.4/100k msgs |
| AWS EventBridge (cross-region bus) | Medium | ~30 ms | $1/million events |
| Dedicated relay microservice | High | ~20 ms | Infra cost |

**Recommended:** Upstash Global Database — single Redis URL, automatically replicates across regions.

```env
# Replace regional Redis URLs with one global Upstash URL
REDIS_URL=rediss://global-12345.upstash.io:6379
```

No code changes needed in `socket/` or `config/redis.js` — the global URL handles replication transparently.

### Personal Room Pattern (Required for multi-region correctness)

As noted in `horizontal-scaling.md`, the `activeUsers` in-memory Map breaks across instances. Ensure all socket handlers use room-based targeting:

```js
// On connect (already recommended in horizontal-scaling.md):
socket.join(`user:${userId}`);

// Emit cross-region (works via Redis adapter):
io.to(`user:${targetUserId}`).emit('event', data);
```

---

## 7. Cost Estimate (India, 2-region)

> Estimates in USD/month at moderate scale (~200 active schools).

| Component | Single-Region | Two-Region | Delta |
|-----------|-------------|------------|-------|
| MongoDB Atlas M20 (Mumbai) | $57 | $114 (+ Chennai replica) | +$57 |
| Render Web Service (2 instances) | $50 | $100 (+ Chennai region) | +$50 |
| Redis — Upstash Global | $0–$20 | $0–$40 | +$20 |
| Cloudflare CDN | $0 (free) | $0 (free) | $0 |
| Cloudinary Media CDN | $0–$99 | $0–$99 (already global) | $0 |
| DNS (Route 53 / Cloudflare) | $1 | $2 | +$1 |
| **Total** | **~$128–$227** | **~$256–$355** | **+$128** |

Break-even: ~1.5× current infra cost for meaningful latency improvement in South India.

---

## Migration Path

When the trigger thresholds above are met, follow this order:

1. **Enable MongoDB read replica** — Atlas UI, add Chennai secondary. Set `MONGO_READ_PREFERENCE=secondaryPreferred`. Zero downtime.
2. **Switch to Upstash Global Redis** — Update `REDIS_URL`. Zero downtime (reconnect on new URL).
3. **Deploy Chennai app instances** — Render: new service pointing to same MongoDB/Redis. Add regional health checks.
4. **Configure Cloudflare geo-routing** — Route South India traffic to Chennai load balancer.
5. **Monitor latency** — Check P95 per region for 2 weeks. Roll back DNS routing if issues arise.
6. **Evaluate Atlas Global Cluster** — Only if write latency from Chennai exceeds 200 ms sustained.

---

## Data Residency Compliance (India)

Current posture: All data stored in Cloudinary (US-based CDN with global replication) and MongoDB Atlas `ap-south-1` (Mumbai).

For DPDP Act 2023 compliance:
- Sensitive personal data (Aadhaar, payment info) must not leave India — **currently satisfied** with Atlas Mumbai.
- Cloudinary media (student photos, documents) — stored in US PoPs. For strict compliance, migrate to S3 `ap-south-1`.
- No action needed for current scale — flag when regulatory guidance clarifies Cloudinary's status.
