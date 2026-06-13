import request from 'supertest';
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import mongoose from 'mongoose';

function createHealthApp({ serverReady = true, redisReady = true } = {}) {
  const app = express();

  const getDatabaseStatus = () => {
    switch (mongoose.connection.readyState) {
      case 1:
        return 'connected';
      case 2:
        return 'connecting';
      case 3:
        return 'disconnecting';
      default:
        return 'disconnected';
    }
  };

  const isRedisReady = () => redisReady;

  const healthHandler = (_req, res) => {
    const db = getDatabaseStatus();
    const memUsage = process.memoryUsage();
    const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const redisConfigured = !!process.env.REDIS_URL;
    const redis = redisConfigured ? (isRedisReady() ? 'ready' : 'unavailable') : 'disabled';
    const isHealthy = db === 'connected';

    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'ok' : 'error',
      db,
      redis,
      uptime: Math.round(process.uptime()),
      memory: { heapUsedMB: memMB },
      version: 'test',
      timestamp: expect.any(String),
    });
  };

  app.get('/health', healthHandler);
  app.get('/api/health', healthHandler);

  app.get('/ready', (_req, res) => {
    const db = getDatabaseStatus();
    const redisConfigured = !!process.env.REDIS_URL;
    const redis = redisConfigured ? (isRedisReady() ? 'ready' : 'unavailable') : 'disabled';
    const ready = db === 'connected' && serverReady;
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      db,
      redis,
      serverReady,
      timestamp: expect.any(String),
    });
  });

  app.get('/healthz', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/readyz', (_req, res) => {
    const db = getDatabaseStatus();
    const redisConfigured = !!process.env.REDIS_URL;
    const redis = redisConfigured ? (isRedisReady() ? 'ready' : 'unavailable') : 'disabled';
    const ready = db === 'connected' && serverReady;
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      db,
      redis,
      serverReady,
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}

describe('health check endpoints', () => {
  describe('GET /health', () => {
    it('returns 200 when DB is connected', async () => {
      const app = createHealthApp();
      const res = await request(app).get('/health').expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.db).toBe('connected');
      expect(res.body).toHaveProperty('uptime');
      expect(res.body).toHaveProperty('memory');
      expect(res.body).toHaveProperty('version');
      expect(res.body).toHaveProperty('timestamp');
    });
  });

  describe('GET /api/health', () => {
    it('returns 200 when DB is connected', async () => {
      const app = createHealthApp();
      const res = await request(app).get('/api/health').expect(200);
      expect(res.body.status).toBe('ok');
    });
  });

  describe('GET /ready', () => {
    it('returns 200 ready when DB is connected and server is ready', async () => {
      const app = createHealthApp({ serverReady: true });
      const res = await request(app).get('/ready').expect(200);

      expect(res.body.status).toBe('ready');
      expect(res.body.db).toBe('connected');
      expect(res.body.serverReady).toBe(true);
      expect(res.body).toHaveProperty('timestamp');
    });

    it('returns 503 not_ready when server is not ready', async () => {
      const app = createHealthApp({ serverReady: false });
      const res = await request(app).get('/ready').expect(503);

      expect(res.body.status).toBe('not_ready');
      expect(res.body.serverReady).toBe(false);
    });
  });

  describe('GET /readyz', () => {
    it('returns 200 ready when DB is connected and server is ready', async () => {
      const app = createHealthApp({ serverReady: true });
      const res = await request(app).get('/readyz').expect(200);

      expect(res.body.status).toBe('ready');
      expect(res.body.serverReady).toBe(true);
    });

    it('returns 503 not_ready when server is not ready', async () => {
      const app = createHealthApp({ serverReady: false });
      const res = await request(app).get('/readyz').expect(503);

      expect(res.body.status).toBe('not_ready');
    });
  });

  describe('GET /healthz', () => {
    it('returns 200 ok without DB check', async () => {
      const app = createHealthApp();
      const res = await request(app).get('/healthz').expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body).toHaveProperty('uptime');
      expect(res.body).toHaveProperty('timestamp');
    });
  });
});
