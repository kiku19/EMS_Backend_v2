/**
 * Socket.io Load Test — PERF-04
 *
 * Validates that the EMS Socket.io server handles 1000+ concurrent connections
 * while maintaining acceptable connection latency and event delivery rates.
 *
 * Usage:
 *   node tests/socket-load-test.js
 *   node tests/socket-load-test.js --connections=1500
 *   node tests/socket-load-test.js --connections=500 --p95-max=1000
 *
 * Options:
 *   --connections=N       Total concurrent connections to open (default: 1000)
 *   --port=N              Port for the test server (default: 3099)
 *   --batch-size=N        Connections per batch (default: 50)
 *   --batch-delay=N       Delay (ms) between batches (default: 20)
 *   --connect-timeout=N   Per-connection timeout in ms (default: 10000)
 *   --success-rate=N      Min connection success rate 0-1 (default: 0.99)
 *   --p95-max=N           Max allowed P95 connect latency in ms (default: 3000)
 *   --broadcast-min=N     Min broadcast delivery rate 0-1 (default: 0.99)
 *   --room-min=N          Min room-event delivery rate 0-1 (default: 0.99)
 */

import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioc } from 'socket.io-client';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
const ARGS = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k, v !== undefined ? v : true];
    })
);

const CONFIG = {
  TOTAL_CONNECTIONS: parseInt(ARGS['connections'] ?? '1000', 10),
  PORT: parseInt(ARGS['port'] ?? '3099', 10),
  BATCH_SIZE: parseInt(ARGS['batch-size'] ?? '50', 10),
  BATCH_DELAY_MS: parseInt(ARGS['batch-delay'] ?? '20', 10),
  CONNECT_TIMEOUT_MS: parseInt(ARGS['connect-timeout'] ?? '10000', 10),
  THRESHOLDS: {
    SUCCESS_RATE_MIN: parseFloat(ARGS['success-rate'] ?? '0.99'),
    CONNECT_P95_MAX_MS: parseInt(ARGS['p95-max'] ?? '3000', 10),
    BROADCAST_DELIVERY_MIN: parseFloat(ARGS['broadcast-min'] ?? '0.99'),
    ROOM_DELIVERY_MIN: parseFloat(ARGS['room-min'] ?? '0.99'),
  },
};

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------
function percentile(sortedArr, p) {
  if (!sortedArr.length) return 0;
  const idx = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, Math.min(idx, sortedArr.length - 1))];
}

function fmtMs(ms) {
  return ms < 1000 ? `${ms.toFixed(1)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function heapMB() {
  return (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printSeparator(char = '─', width = 57) {
  console.log(char.repeat(width));
}

// ---------------------------------------------------------------------------
// Minimal test Socket.io server (no DB, no auth)
// ---------------------------------------------------------------------------
function createTestServer(port) {
  const httpServer = createServer();
  const io = new SocketIOServer(httpServer, {
    transports: ['websocket'],
    cors: { origin: '*' },
    // Generous timeouts — we're testing connection capacity, not keep-alive
    pingInterval: 30_000,
    pingTimeout: 15_000,
    // Allow many connections per client IP (default is 0 = unlimited)
    connectTimeout: CONFIG.CONNECT_TIMEOUT_MS,
  });

  const counters = { connections: 0, disconnections: 0 };

  io.on('connection', (socket) => {
    counters.connections++;
    // Each socket joins its own room (mirrors student:<id> pattern in production)
    socket.join(`room:${socket.id}`);
    socket.on('disconnect', () => counters.disconnections++);
  });

  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, () => resolve({ httpServer, io, counters }));
  });
}

// ---------------------------------------------------------------------------
// Phase helpers
// ---------------------------------------------------------------------------

/** Connect N clients in batches; return connected clients + metrics. */
async function phaseConnect(serverUrl) {
  const clients = [];
  const connectTimes = [];
  const errors = [];
  let connected = 0;

  const total = CONFIG.TOTAL_CONNECTIONS;
  const batchSize = CONFIG.BATCH_SIZE;

  for (let i = 0; i < total; i += batchSize) {
    const end = Math.min(i + batchSize, total);
    const batchPromises = [];

    for (let j = i; j < end; j++) {
      const t0 = Date.now();
      const client = ioc(serverUrl, {
        transports: ['websocket'],
        reconnection: false,
        timeout: CONFIG.CONNECT_TIMEOUT_MS,
        forceNew: true,
      });

      const p = new Promise((resolve) => {
        const timer = setTimeout(() => {
          errors.push({ idx: j, reason: 'timeout' });
          resolve();
        }, CONFIG.CONNECT_TIMEOUT_MS);

        client.once('connect', () => {
          clearTimeout(timer);
          connectTimes.push(Date.now() - t0);
          connected++;
          resolve();
        });

        client.once('connect_error', (err) => {
          clearTimeout(timer);
          errors.push({ idx: j, reason: err.message });
          resolve();
        });
      });

      clients.push(client);
      batchPromises.push(p);
    }

    await Promise.all(batchPromises);

    const done = Math.min(i + batchSize, total);
    const pct = Math.round((done / total) * 100);
    process.stdout.write(
      `\r  Progress: ${done}/${total} (${pct}%) — connected: ${connected}  errors: ${errors.length}   `
    );

    if (end < total) await sleep(CONFIG.BATCH_DELAY_MS);
  }

  process.stdout.write('\n');
  return { clients, connectTimes, errors, connected };
}

/** Broadcast N rounds to all connected clients; return delivery rate. */
async function phaseBroadcast(io, clients, rounds = 3) {
  let received = 0;
  const connectedClients = clients.filter((c) => c.connected);

  const handlers = connectedClients.map((client) => {
    const fn = () => received++;
    client.on('_load_broadcast', fn);
    return { client, fn };
  });

  for (let r = 0; r < rounds; r++) {
    io.emit('_load_broadcast', { round: r, ts: Date.now() });
    await sleep(80);
  }
  await sleep(400); // Settle

  handlers.forEach(({ client, fn }) => client.off('_load_broadcast', fn));

  const expected = connectedClients.length * rounds;
  return { received, expected, rate: expected > 0 ? received / expected : 1 };
}

/** Target each connected socket's private room; return delivery rate. */
async function phaseRoomEvents(io, clients) {
  let received = 0;
  const connectedClients = clients.filter((c) => c.connected);
  const sample = connectedClients.slice(0, Math.min(200, connectedClients.length));

  const handlers = sample.map((client) => {
    const fn = () => received++;
    client.on('_load_room', fn);
    return { client, fn };
  });

  // Fetch server-side sockets to get their IDs (for room targeting)
  const serverSockets = await io.fetchSockets();
  let emitted = 0;
  // Emit to the first `sample.length` rooms only to keep latency predictable
  for (let i = 0; i < Math.min(sample.length, serverSockets.length); i++) {
    io.to(`room:${serverSockets[i].id}`).emit('_load_room', { socketId: serverSockets[i].id });
    emitted++;
  }
  await sleep(500); // Settle

  handlers.forEach(({ client, fn }) => client.off('_load_room', fn));

  return { received, emitted, rate: emitted > 0 ? received / emitted : 1 };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function run() {
  printSeparator('═');
  console.log(' EMS Socket.io Load Test — PERF-04');
  console.log(` Connections : ${CONFIG.TOTAL_CONNECTIONS}`);
  console.log(` Batch size  : ${CONFIG.BATCH_SIZE}  Batch delay: ${CONFIG.BATCH_DELAY_MS}ms`);
  console.log(` Port        : ${CONFIG.PORT}`);
  printSeparator('═');

  // ── Start server ──────────────────────────────────────────────────────────
  console.log('\n[1/4] Starting test server…');
  const { httpServer, io, counters } = await createTestServer(CONFIG.PORT);
  const serverUrl = `http://localhost:${CONFIG.PORT}`;
  console.log(`      OK — listening on ${serverUrl}`);
  const memBefore = heapMB();

  // ── Phase 1: Connect ──────────────────────────────────────────────────────
  console.log(`\n[2/4] Connecting ${CONFIG.TOTAL_CONNECTIONS} clients…`);
  const t0 = Date.now();
  const { clients, connectTimes, errors, connected } = await phaseConnect(serverUrl);
  const connectDuration = Date.now() - t0;

  await sleep(300); // Let server counters settle

  // ── Phase 2: Broadcast ────────────────────────────────────────────────────
  console.log('\n[3/4] Broadcast delivery test (3 rounds)…');
  const broadcast = await phaseBroadcast(io, clients, 3);
  console.log(
    `      Delivered ${broadcast.received}/${broadcast.expected} (${(broadcast.rate * 100).toFixed(1)}%)`
  );

  // ── Phase 3: Room events ──────────────────────────────────────────────────
  console.log('\n[4/4] Room-targeted event delivery test (sample: 200)…');
  const room = await phaseRoomEvents(io, clients);
  console.log(
    `      Delivered ${room.received}/${room.emitted} (${(room.rate * 100).toFixed(1)}%)`
  );

  // ── Disconnect all ────────────────────────────────────────────────────────
  console.log('\n      Disconnecting all clients…');
  clients.forEach((c) => c.disconnect());
  await sleep(600);
  const memAfter = heapMB();

  // ── Results ───────────────────────────────────────────────────────────────
  connectTimes.sort((a, b) => a - b);
  const p50 = percentile(connectTimes, 50);
  const p95 = percentile(connectTimes, 95);
  const p99 = percentile(connectTimes, 99);
  const successRate = connected / CONFIG.TOTAL_CONNECTIONS;

  console.log('');
  printSeparator('═');
  console.log(' RESULTS');
  printSeparator('─');
  console.log(`  Connections attempted : ${CONFIG.TOTAL_CONNECTIONS}`);
  console.log(`  Successfully connected: ${connected}  (${(successRate * 100).toFixed(2)}%)`);
  console.log(`  Connection errors     : ${errors.length}`);
  if (errors.length > 0 && errors.length <= 10) {
    errors.forEach((e) => console.log(`    ↳ [${e.idx}] ${e.reason}`));
  }
  printSeparator('─');
  console.log(`  Connect time P50      : ${fmtMs(p50)}`);
  console.log(`  Connect time P95      : ${fmtMs(p95)}`);
  console.log(`  Connect time P99      : ${fmtMs(p99)}`);
  console.log(
    `  Connect time min/max  : ${fmtMs(connectTimes[0] ?? 0)} / ${fmtMs(connectTimes.at(-1) ?? 0)}`
  );
  printSeparator('─');
  console.log(`  Broadcast delivery    : ${(broadcast.rate * 100).toFixed(2)}%`);
  console.log(`  Room event delivery   : ${(room.rate * 100).toFixed(2)}%`);
  printSeparator('─');
  console.log(`  Total connect phase   : ${fmtMs(connectDuration)}`);
  console.log(`  Server-side conns     : ${counters.connections}`);
  console.log(`  Heap before → after   : ${memBefore} MB → ${memAfter} MB`);
  printSeparator('═');

  // ── Threshold checks ──────────────────────────────────────────────────────
  console.log(' THRESHOLD CHECKS');
  printSeparator('─');

  const checks = [
    {
      label: 'Connection success rate',
      pass: successRate >= CONFIG.THRESHOLDS.SUCCESS_RATE_MIN,
      actual: `${(successRate * 100).toFixed(2)}%`,
      expected: `≥ ${(CONFIG.THRESHOLDS.SUCCESS_RATE_MIN * 100).toFixed(0)}%`,
    },
    {
      label: 'P95 connect latency',
      pass: p95 <= CONFIG.THRESHOLDS.CONNECT_P95_MAX_MS,
      actual: fmtMs(p95),
      expected: `≤ ${fmtMs(CONFIG.THRESHOLDS.CONNECT_P95_MAX_MS)}`,
    },
    {
      label: 'Broadcast delivery rate',
      pass: broadcast.rate >= CONFIG.THRESHOLDS.BROADCAST_DELIVERY_MIN,
      actual: `${(broadcast.rate * 100).toFixed(2)}%`,
      expected: `≥ ${(CONFIG.THRESHOLDS.BROADCAST_DELIVERY_MIN * 100).toFixed(0)}%`,
    },
    {
      label: 'Room event delivery rate',
      pass: room.rate >= CONFIG.THRESHOLDS.ROOM_DELIVERY_MIN,
      actual: `${(room.rate * 100).toFixed(2)}%`,
      expected: `≥ ${(CONFIG.THRESHOLDS.ROOM_DELIVERY_MIN * 100).toFixed(0)}%`,
    },
  ];

  let allPassed = true;
  for (const c of checks) {
    const icon = c.pass ? '✔' : '✘';
    console.log(`  ${icon}  ${c.label}: ${c.actual}  (threshold: ${c.expected})`);
    if (!c.pass) allPassed = false;
  }

  printSeparator('═');
  if (allPassed) {
    console.log(' ✔  ALL CHECKS PASSED\n');
  } else {
    console.log(' ✘  ONE OR MORE CHECKS FAILED\n');
  }
  printSeparator('═');
  console.log('');

  // Cleanup
  httpServer.close();
  process.exit(allPassed ? 0 : 1);
}

run().catch((err) => {
  console.error('\nLoad test aborted with error:', err);
  process.exit(1);
});
