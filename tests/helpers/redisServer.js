import { spawn } from 'node:child_process';
import Redis from 'ioredis';

export function isRedisServerAvailable() {
  return new Promise((resolve) => {
    const child = spawn('redis-server', ['--version'], { stdio: 'ignore' });
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.on('error', () => done(false));
    child.on('exit', (code) => done(code === 0));
    setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // The process has already exited.
      }
      done(false);
    }, 5_000);
  });
}

export async function startIsolatedRedis(port) {
  const child = spawn(
    'redis-server',
    ['--port', String(port), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no'],
    { stdio: 'ignore' }
  );

  const deadline = Date.now() + 15_000;
  while (Date.now() <= deadline) {
    if (await pingOnce(port)) return child;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  killChild(child);
  throw new Error(`isolated redis on :${port} did not become reachable`);
}

function pingOnce(port) {
  const client = new Redis(`redis://127.0.0.1:${port}`, {
    connectTimeout: 500,
    retryStrategy: () => null,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: true,
    lazyConnect: true,
  });
  return client
    .connect()
    .then(() => client.ping())
    .then((response) => response === 'PONG')
    .catch(() => false)
    .finally(() => client.disconnect());
}

export async function stopIsolatedRedis(child) {
  if (!child) return;
  killChild(child);
  await new Promise((resolve) => {
    child.once('exit', resolve);
    setTimeout(() => {
      killChild(child);
      resolve();
    }, 3_000);
  });
}

function killChild(child) {
  try {
    child.kill('SIGTERM');
  } catch {
    // The process has already exited.
  }
}
