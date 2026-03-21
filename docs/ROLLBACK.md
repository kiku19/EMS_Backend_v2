# Rollback Runbook

Use this guide when a production deployment needs to be rolled back.

---

## When to Roll Back

- Health check fails immediately after deploy (`/health` returns non-200)
- Error rate spikes sharply in Sentry/logs within 10 minutes of deploy
- Critical functionality broken (auth, fee payments, student data)

---

## Step 1 — Identify the Last Good Image

Each production deploy tags the backend image as:
```
<DOCKER_REGISTRY>/ems-backend:<git-sha>
<DOCKER_REGISTRY>/ems-backend:latest        ← overwritten on every deploy
```

Find the last known-good SHA from:
- GitHub Actions → `Deploy — Production` → previous successful run → "Set image tag" step
- Or: `docker image ls <DOCKER_REGISTRY>/ems-backend --format "{{.Tag}} {{.CreatedAt}}"` on the server

---

## Step 2 — Roll Back the Backend Container

SSH into the production server:
```bash
ssh <PROD_SSH_USER>@<PROD_HOST>
cd /opt/ems-production
```

Set the previous image and redeploy:
```bash
export IMAGE_TAG=<DOCKER_REGISTRY>/ems-backend:<PREVIOUS_SHA>
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull backend
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps backend
```

Verify health:
```bash
curl -sf http://localhost:3001/health && echo "OK"
```

---

## Step 3 — Assess Whether a Data Migration Rollback Is Needed

Most migrations in `migrations/` are **additive** (new fields, no destructive changes). Check the migration file run in the failed deploy:

- If the migration only **added** fields → no DB rollback needed; the old code ignores new fields.
- If the migration **removed or renamed** fields → manual DB rollback may be required (see migration file comments).

Run the migration with `--dry-run` first to inspect:
```bash
docker run --rm \
  -e MONGODB_URI="<PROD_MONGODB_URI>" \
  <IMAGE_TAG> \
  node migrations/<migration-file>.js --dry-run
```

---

## Step 4 — Re-pin `latest` Tag

After confirming rollback is stable, re-pin the `latest` tag so future `pull` calls use the safe image:
```bash
docker tag <DOCKER_REGISTRY>/ems-backend:<PREVIOUS_SHA> <DOCKER_REGISTRY>/ems-backend:latest
docker push <DOCKER_REGISTRY>/ems-backend:latest
```

---

## Step 5 — Post-Incident

1. Notify team in `#incidents` Slack channel with root cause and resolution.
2. Create a GitHub issue documenting the failure and fix.
3. Revert the broken commit on `main` with `git revert <sha>` and push — this triggers CI + a clean re-deploy once fixed.

---

## Required Secrets / Variables (GitHub Actions)

| Name | Where Used |
|------|-----------|
| `DOCKER_REGISTRY` | Docker image registry host (e.g. `ghcr.io/org`) |
| `DOCKER_USERNAME` | Registry login |
| `DOCKER_PASSWORD` | Registry password / PAT |
| `STAGING_MONGODB_URI` | Staging DB connection string |
| `PROD_MONGODB_URI` | Production DB connection string |
| `STAGING_HOST` / `PROD_HOST` | Server IPs/hostnames |
| `STAGING_SSH_USER` / `PROD_SSH_USER` | SSH usernames |
| `STAGING_SSH_KEY` / `PROD_SSH_KEY` | Private SSH keys |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL |

Set these in **GitHub → Settings → Secrets and variables → Actions**.

The `production` environment must also have **Required reviewers** configured (Settings → Environments → production) to enforce the manual approval gate before any production deploy.
