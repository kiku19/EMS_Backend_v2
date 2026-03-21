# Horizontal Scaling — EMS Backend

## Architecture Overview

```
                  ┌─────────────┐
Clients ─────────▶│  Load Balancer │
                  │ (nginx / Render / ALB) │
                  └──────┬──────┘
                         │ round-robin
              ┌──────────┴──────────┐
              ▼                     ▼
        ┌─────────┐          ┌─────────┐
        │ app:1   │          │ app:2   │
        │ Node.js │          │ Node.js │
        └────┬────┘          └────┬────┘
             │                   │
             └────────┬──────────┘
                      ▼
              ┌──────────────┐
              │    Redis     │  ← Socket.IO pub/sub adapter
              │  (shared)    │  ← Rate limit store
              └──────────────┘
                      │
              ┌──────────────┐
              │   MongoDB    │
              └──────────────┘
```

## Why No Sticky Sessions

Authentication is **stateless JWT**. Every request carries a self-contained token
validated locally — no session state is stored on the server. Any instance can
handle any request.

Socket.IO events are broadcast through the **Redis adapter** (`@socket.io/redis-adapter`),
so a socket connected to instance 1 receives events emitted by instance 2 via Redis
pub/sub. No sticky sessions required.

> **If you add server-side sessions** (e.g. `express-session` with a Redis store),
> sessions remain stateless as long as you configure them with `resave: false` and
> store them in Redis. Sticky sessions are still not needed.

## Local Multi-Instance Testing

```bash
# Start 2 backend instances + nginx + mongo + redis
docker compose up --scale app=2

# Or 3 instances
docker compose up --scale app=3
```

nginx resolves the `app` upstream via Docker's internal DNS, which round-robins
across all running containers automatically.

## Render Deployment

1. **No sticky sessions needed** — leave "Session Affinity" off in Render settings.
2. Set `REDIS_URL` to your Upstash or Render Redis instance URL.
3. Scale via Render's "Number of instances" slider.
4. Render's health check URL: `/healthz` (liveness) and `/readyz` (readiness).
5. `PORT` env var is set automatically by Render — the app reads it via `process.env.PORT`.

```
Render Service Settings:
  Health Check Path: /healthz
  Session Affinity: Disabled (not needed — stateless JWT + Redis adapter)
  Auto-Deploy: on push to main
```

## AWS / ALB Deployment

1. Create an **Application Load Balancer** (ALB) targeting an ECS service or EC2 Auto Scaling Group.
2. Target group health check: `GET /healthz` — expect HTTP 200.
3. **No stickiness** — leave "Stickiness" disabled on the target group.
4. Set `REDIS_URL` to ElastiCache (Redis) endpoint.
5. Set `MONGODB_URI` to DocumentDB or Atlas connection string.
6. Example ECS task env vars:
   - `PORT=3001`
   - `REDIS_URL=redis://your-elasticache-endpoint:6379`
   - `MONGODB_URI=mongodb+srv://...`
   - `JWT_SECRET=<secret from Secrets Manager>`

## Known Multi-Instance Limitation

`socket/chatHandler.js` maintains an in-memory `activeUsers` Map (userId → socketId).
With 2+ instances, a user connected to instance 2 won't appear in instance 1's
`activeUsers` Map, so direct `io.to(socketId)` targeting can miss cross-instance users.

**Interim mitigation**: `io.to(room).emit()` works correctly via the Redis adapter
because rooms are shared. Join users into a personal room on connect:
```js
socket.join(`user:${userId}`);
// Then emit cross-instance via room:
io.to(`user:${targetUserId}`).emit('message', data);
```

A proper fix is to replace the `activeUsers` Map with a Redis hash so all instances
share presence state. Track in a future task.
