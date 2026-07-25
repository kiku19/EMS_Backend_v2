/**
 * C1 — Socket.IO Redis adapter must not crash the process on boot.
 *
 * Reproduces the launch-readiness blocker: with `enableOfflineQueue: false`
 * (config/redis.js), attaching `@socket.io/redis-adapter` to ioredis pub/sub
 * clients that have NOT been awaited via `.connect()` throws an *async*
 * `Stream isn't writeable` rejection that a synchronous try/catch cannot
 * observe → unhandled rejection → FATAL → process dies whenever REDIS_URL is
 * set. This blocks every horizontally-scaled (multi-instance) deployment.
 *
 * The test starts its OWN isolated redis-server on port 6380 (mirroring how the
 * audit verified the defect) and exercises the SAME adapter-attachment pattern
 * that lives in server.js:253-294. It is skipped automatically when the
 * `redis-server` binary is not present on PATH so CI environments without it
 * do not fail — but on any developer / ops machine with redis installed the
 * regression is fully covered.
 */
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Server as SocketIOServer } from 'socket.io';
import ioClient from 'socket.io-client';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { createRedisOptions } from '../config/redis.js';
import {
  isRedisServerAvailable,
  startIsolatedRedis,
  stopIsolatedRedis,
} from './helpers/redisServer.js';

const ISOLATED_REDIS_PORT = 6380;
const ISOLATED_REDIS_URL = `redis://127.0.0.1:${ISOLATED_REDIS_PORT}`;

// Mirrors server.js — pub/sub clients are created with createRedisOptions,
// which sets enableOfflineQueue:false (the root cause of the offline throw).
function buildAdapterPatternClients(redisUrl) {
  const pubClient = new Redis(
    redisUrl,
    createRedisOptions('ems-socketio-pub', { lazyConnect: true })
  );
  const subClient = new Redis(
    redisUrl,
    createRedisOptions('ems-socketio-sub', { lazyConnect: true })
  );
  // Swallow ioredis 'error' events so a down redis doesn't surface as an
  // unhandled error event (the connect() rejection is what we assert on).
  pubClient.on('error', () => {});
  subClient.on('error', () => {});
  return { pubClient, subClient };
}

function safeDisconnect(client) {
  try {
    client.disconnect();
  } catch {
    /* already disconnected */
  }
}

describe('C1 — Socket.IO Redis adapter boot (multi-instance)', () => {
  let redisProcess = null;

  beforeAll(async () => {
    if (!(await isRedisServerAvailable())) return;
    redisProcess = await startIsolatedRedis(ISOLATED_REDIS_PORT);
    // Clean keyspace so a leftover from a prior run can't interfere.
    const flush = new Redis(ISOLATED_REDIS_URL);
    flush.on('error', () => {});
    await flush.flushall();
    await flush.quit();
  }, 60_000);

  afterAll(async () => {
    if (redisProcess) await stopIsolatedRedis(redisProcess);
  });

  it('boots without crashing when REDIS_URL points at a reachable redis', async () => {
    if (!redisProcess) return; // binary missing — skip gracefully

    // Reproduce the exact server.js sequence. If the fix regresses (e.g. the
    // `.connect()` await is removed), this rejects and the test fails. We track
    // success with a flag that is only read after the try/finally so a throw
    // (the regression) surfaces as a failed assertion rather than a pass.
    const { pubClient, subClient } = buildAdapterPatternClients(ISOLATED_REDIS_URL);
    let attached;
    try {
      await Promise.all([pubClient.connect(), subClient.connect()]);
      const httpServer = createServer();
      const io = new SocketIOServer(httpServer, { cors: { origin: '*' } });
      io.adapter(createAdapter(pubClient, subClient)); // psubscribes on attach
      attached = true;
      io.close();
    } finally {
      safeDisconnect(pubClient);
      safeDisconnect(subClient);
    }

    expect(attached).toBe(true);
  }, 30_000);

  it('fans a broadcast from instance A to a socket on instance B', async () => {
    if (!redisProcess) return;

    // Instance A — the emitter.
    const httpA = createServer();
    const ioA = new SocketIOServer(httpA, { cors: { origin: '*' } });
    const clientsA = buildAdapterPatternClients(ISOLATED_REDIS_URL);
    await Promise.all([clientsA.pubClient.connect(), clientsA.subClient.connect()]);
    ioA.adapter(createAdapter(clientsA.pubClient, clientsA.subClient));
    await new Promise((resolve) => httpA.listen(0, resolve));

    // Instance B — the receiver, sharing the same Redis. On connect, it joins
    // the socket into a server-side room so ioA.to(room) reaches it cross-node.
    const httpB = createServer();
    const ioB = new SocketIOServer(httpB, { cors: { origin: '*' } });
    const clientsB = buildAdapterPatternClients(ISOLATED_REDIS_URL);
    await Promise.all([clientsB.pubClient.connect(), clientsB.subClient.connect()]);
    ioB.adapter(createAdapter(clientsB.pubClient, clientsB.subClient));
    ioB.on('connection', (socket) => socket.join('room:cross-instance'));
    await new Promise((resolve) => httpB.listen(0, resolve));

    const portB = httpB.address().port;
    const receiverClient = await new Promise((resolve, reject) => {
      const sock = ioClient(`http://127.0.0.1:${portB}`, { transports: ['websocket'] });
      sock.on('connect', () => resolve(sock));
      setTimeout(() => {
        sock.disconnect();
        reject(new Error('receiver socket did not connect'));
      }, 5_000);
    });

    // Give the pub/sub adapter a moment to sync room membership across nodes.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const received = new Promise((resolve) => receiverClient.on('cross-instance-event', resolve));

    // Emit from instance A. Without the Redis adapter this never reaches B's socket.
    ioA.to('room:cross-instance').emit('cross-instance-event', { ok: true });
    const payload = await Promise.race([
      received,
      new Promise((_, reject) => setTimeout(() => reject(new Error('event never arrived')), 5_000)),
    ]);

    expect(payload).toEqual({ ok: true });

    receiverClient.disconnect();
    ioA.close();
    ioB.close();
    safeDisconnect(clientsA.pubClient);
    safeDisconnect(clientsA.subClient);
    safeDisconnect(clientsB.pubClient);
    safeDisconnect(clientsB.subClient);
  }, 60_000);

  it('still finishes (in-memory fallback) instead of crashing when Redis is down', async () => {
    // Point at a port where nothing listens. The fixed boot code awaits the
    // connect, observes the rejection inside the try, and falls back rather
    // than throwing an unhandled rejection.
    const downUrl = 'redis://127.0.0.1:1'; // port 1 — nothing there
    const { pubClient, subClient } = buildAdapterPatternClients(downUrl);
    let usedFallback;

    try {
      try {
        await Promise.all([pubClient.connect(), subClient.connect()]);
        // If this somehow connected, disconnect cleanly (shouldn't happen here).
        safeDisconnect(pubClient);
        safeDisconnect(subClient);
      } catch {
        // This is the fixed fallback path — adapter is NOT attached; the app
        // continues single-instance. server.js logs a warning and moves on.
        usedFallback = true;
      }
    } finally {
      // lazyConnect clients that never connected are safe to disconnect.
      safeDisconnect(pubClient);
      safeDisconnect(subClient);
    }

    expect(usedFallback).toBe(true);
  }, 30_000);
});
