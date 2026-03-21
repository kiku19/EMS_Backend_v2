# Incident Response Playbook — EMS

This document defines how the EMS team detects, responds to, escalates, and reviews production incidents.

---

## Severity Levels

| Level | Name | Definition | Response Target | Example |
|-------|------|-----------|-----------------|---------|
| **P1** | Critical | Full outage or data loss in progress | Immediate (< 15 min) | Auth down, DB unreachable, mass data deletion |
| **P2** | High | Core feature broken for all schools | < 1 hour | Fee payments failing, attendance not saving |
| **P3** | Medium | Feature degraded or broken for subset | < 4 hours | Single school data missing, slow API (> 5 s) |
| **P4** | Low | Minor issue, workaround available | Next business day | UI glitch, non-critical endpoint returning stale data |

---

## Escalation Chain

```
On-call engineer (first responder)
   │  (if unresolved in 15 min — P1/P2, 1 hour — P3)
   ▼
Backend lead
   │  (if unresolved in 30 min — P1, 2 hours — P2)
   ▼
CTO / Founder
   │  (P1 data loss, security breach, or regulatory impact)
   ▼
Legal / Compliance (DPDP Act, Aadhaar exposure)
```

**Contact list** — stored in the team password manager under `EMS / On-Call Contacts`. Update after every role change.

---

## Incident Lifecycle

```
Detected → Triaged → Mitigated → Resolved → Post-Mortem
```

1. **Detect** — alert fires (Sentry, uptime monitor, user report, health check failure)
2. **Triage** — assign severity, open incident channel `#inc-YYYY-MM-DD-<slug>`
3. **Mitigate** — stop user impact (rollback, feature flag off, traffic reroute)
4. **Resolve** — root cause fixed and verified
5. **Post-mortem** — blameless review within 48 hours for P1/P2

---

## Playbook: Production API Down (P1)

**Trigger:** `/health` returns non-200, error rate > 50%, or Render/server reports crash.

### Step 1 — Verify scope

```bash
# From your local machine
curl -sf https://api.yourschool.in/health && echo "OK" || echo "DOWN"
```

Check Render / server logs for the crash message.

### Step 2 — Rollback if caused by a deploy

Follow the full procedure in [`ROLLBACK.md`](./ROLLBACK.md).

### Step 3 — If not deploy-related, check dependencies

```bash
# SSH into prod server
ssh <PROD_SSH_USER>@<PROD_HOST>
cd /opt/ems-production

# Check container status
docker compose ps

# Tail logs (last 100 lines)
docker compose logs --tail=100 backend

# Check MongoDB connectivity
docker compose exec backend node -e "
  const mongoose = require('mongoose');
  mongoose.connect(process.env.MONGODB_URI).then(() => {
    console.log('MongoDB OK');
    process.exit(0);
  }).catch(err => {
    console.error('MongoDB FAIL:', err.message);
    process.exit(1);
  });
"

# Check Redis
docker compose exec backend node -e "
  const { createClient } = require('redis');
  const c = createClient({ url: process.env.REDIS_URL });
  c.connect().then(() => c.ping()).then(r => {
    console.log('Redis OK:', r);
    process.exit(0);
  }).catch(err => {
    console.error('Redis FAIL:', err.message);
    process.exit(1);
  });
"
```

### Step 4 — Restart if crash-looping

```bash
docker compose restart backend
sleep 10
curl -sf http://localhost:3001/health && echo "RECOVERED"
```

### Step 5 — Communicate

Post to `#incidents` within 10 minutes of declaring P1:
```
🔴 P1 INCIDENT — [short description]
Started: <time>
Impact: <what schools/features are affected>
Status: Investigating / Mitigating / Resolved
```

---

## Playbook: Database Unreachable (P1)

**Trigger:** All API responses return 500 with `MongoServerError` or `MongoNetworkError` in logs.

### Step 1 — Check Atlas status

Visit [status.mongodb.com](https://status.mongodb.com) for Atlas outages.

### Step 2 — Check connection string

```bash
# Verify env var is set
docker compose exec backend sh -c 'echo $MONGODB_URI | cut -c1-30'
```

### Step 3 — Check Atlas IP whitelist

MongoDB Atlas → Network Access → confirm the production server IP is whitelisted.
If Render auto-assigns IPs, use `0.0.0.0/0` as a temporary emergency whitelist entry (remove after).

### Step 4 — If Atlas is healthy but connections are failing

Restart the backend to clear stale connection pool:
```bash
docker compose restart backend
```

### Step 5 — If Atlas is down

Hold traffic at the load balancer level (set Render service to maintenance mode) and wait for Atlas recovery. Post status updates every 15 minutes in `#incidents`.

---

## Playbook: Authentication Broken (P2)

**Trigger:** Users cannot log in; 401/403 returned on all authenticated routes.

### Step 1 — Check JWT secret

```bash
docker compose exec backend sh -c 'echo $JWT_SECRET | wc -c'
# Should be > 20 characters
```

If the env var is empty, redeploy with the secret restored from the password manager.

### Step 2 — Check token validation middleware

```bash
# Test with a known-good token
curl -H "Authorization: Bearer <test-token>" \
  https://api.yourschool.in/api/schools/profile
```

Review `middleware/auth.js` for recent changes.

### Step 3 — Check Redis (session/token blacklist)

If Redis is unavailable, the auth middleware may fail closed. Verify Redis connectivity (see API Down playbook Step 3).

---

## Playbook: Fee Payment Failing (P2)

**Trigger:** Payment gateway returns errors; receipts not generating.

### Step 1 — Check payment gateway status

Visit the payment provider's status page (Razorpay: [razorpay.com/status](https://razorpay.com/status)).

### Step 2 — Check webhook endpoint

```bash
curl -X POST https://api.yourschool.in/api/payments/webhook \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
# Should return 400 (invalid signature), not 500
```

### Step 3 — Check env vars

```bash
docker compose exec backend sh -c 'echo $RAZORPAY_KEY_ID | cut -c1-10'
```

### Step 4 — If gateway is healthy but payments still fail

Check the `feePayments` collection for recent documents with `status: 'failed'` and inspect the `gatewayResponse` field for error codes.

---

## Playbook: Data Appears Missing (P3)

**Trigger:** A school reports that student records, fees, or attendance data has disappeared.

> This is almost always a **multi-tenancy scoping bug**, not actual data loss.

### Step 1 — Verify schoolId on the session

Confirm the user's JWT contains the correct `schoolId`. Have the user log out and back in.

### Step 2 — Query the database directly

```js
// Run via mongo shell or Compass
db.students.countDocuments({ schoolId: ObjectId("<school-id>") })
```

If count > 0, the data exists — the API is filtering it out. Review recent changes to the query that fetches this data.

### Step 3 — Check isDeleted filter

Queries must include `isDeleted: { $ne: true }`. If data was accidentally soft-deleted:
```js
// RECOVERY — restore soft-deleted records
db.students.updateMany(
  { schoolId: ObjectId("<school-id>"), isDeleted: true },
  { $set: { isDeleted: false } }
)
```

Only run after confirming with the school that deletion was unintentional.

### Step 4 — Check backups

If data is genuinely gone, restore from the most recent backup. See DR-01 backup procedures.

---

## Playbook: Security Breach / Unauthorized Access (P1)

**Trigger:** Evidence of unauthorized data access, credential exposure, or active attack.

### Step 1 — Isolate immediately

```bash
# Take the API offline to stop active exfiltration
# Render: Service → Settings → Suspend
# Or on server:
docker compose stop backend
```

### Step 2 — Rotate all secrets

In the password manager, generate new values for:
- `JWT_SECRET`
- `MONGODB_URI` credentials (rotate Atlas user password)
- `RAZORPAY_KEY_SECRET`
- Any API keys exposed

### Step 3 — Invalidate all active sessions

```bash
# Flush Redis (all JWTs in blacklist/sessions cleared)
docker compose exec redis redis-cli FLUSHALL
```

All users will need to re-login — this is intentional.

### Step 4 — Audit access logs

```bash
docker compose logs backend | grep '"status":4' | tail -500
```

Identify the source IP, affected endpoints, and time window.

### Step 5 — Notify affected schools

If student PII was accessed, schools must be notified within 72 hours per DPDP Act 2023. Loop in legal/compliance immediately.

### Step 6 — Do not restore service until root cause is confirmed

---

## Communication Templates

### Internal — Incident Declared (`#incidents`)
```
🔴 P[1/2/3] INCIDENT — <short title>
Time declared: <HH:MM IST>
On-call: <name>
Impact: <affected feature/schools>
Status: Investigating
Next update: <HH:MM IST>
```

### Internal — Resolved (`#incidents`)
```
✅ RESOLVED — <short title>
Duration: <X> min
Root cause: <1 sentence>
Fix applied: <1 sentence>
Post-mortem: <date/link or N/A for P3/P4>
```

### External — School-facing (send via in-app notification or email)
```
Subject: EMS Service Update — <Date>

We are aware of an issue affecting [feature]. Our team is actively working on a fix.

Impact: [describe what is not working]
Started: [HH:MM IST]
Status: [Investigating / Being Fixed / Resolved]

We will send another update by [time]. Thank you for your patience.

— EMS Support Team
```

---

## Post-Mortem Process (P1 and P2)

Complete within **48 hours** of resolution. Create a GitHub issue with label `post-mortem`.

### Template

```markdown
## Incident Post-Mortem — <title> (<date>)

### Summary
One paragraph: what happened, user impact, duration.

### Timeline (IST)
- HH:MM — First alert / user report
- HH:MM — On-call engaged
- HH:MM — Root cause identified
- HH:MM — Mitigation applied
- HH:MM — Fully resolved

### Root Cause
Technical description of why this happened.

### Contributing Factors
- Factor 1
- Factor 2

### What Went Well
- Item 1

### What Went Wrong
- Item 1

### Action Items
| Action | Owner | Due |
|--------|-------|-----|
| Add monitoring for X | @name | YYYY-MM-DD |
| Fix code path Y | @name | YYYY-MM-DD |
```

---

## Monitoring & Alert Checklist

Ensure these are configured before going to production:

- [ ] **Uptime check** — external HTTP check on `GET /health` every 60 s; alert if down for 2 consecutive checks
- [ ] **Sentry** — `SENTRY_DSN` set; alert threshold: > 10 new errors/minute
- [ ] **MongoDB Atlas alerts** — connection count > 80%, disk > 75%, replication lag > 10 s
- [ ] **Redis** — memory > 80% of `maxmemory`; keyspace eviction rate > 0
- [ ] **Render / host CPU** — alert if > 90% for > 5 minutes
- [ ] **Slack webhook** — `SLACK_WEBHOOK_URL` set; CI pipeline posts deploy + health check results

---

## Quick Reference

| Situation | First Action |
|-----------|-------------|
| API returning 500 | Check `docker compose logs backend` |
| Auth failing (401) | Check `JWT_SECRET` env var |
| MongoDB errors | Check Atlas status + IP whitelist |
| Data "missing" | Verify `schoolId` on session; query DB directly |
| Payment errors | Check payment gateway status page |
| Suspected breach | Suspend service → rotate secrets → call CTO |
| Need to rollback | Follow `ROLLBACK.md` |
| Data loss confirmed | Restore from backup (see DR-01) |
