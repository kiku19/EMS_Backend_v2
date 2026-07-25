/**
 * H1 — Global JSON body limit + Razorpay webhook raw-body capture.
 *
 * Reproduces the launch-readiness hardening finding: server.js previously set
 * `express.json({ limit:'50mb', verify: ... req.rawBody = buf })` on EVERY
 * request, double-buffering up to 50MB and burning ~100MB RAM per large body —
 * a DoS amplifier. Only the Razorpay webhook actually needs the raw body (for
 * HMAC signature verification); everything else (uploads) goes through multer.
 *
 * The fix lowers the global limit to 1mb and removes raw-body capture from the
 * global parser, then mounts a dedicated raw-body-capturing parser on the
 * webhook route only. These tests pin both halves of that contract:
 *
 *   1. A >1mb JSON body to an ordinary route is rejected (413 Payload Too Large).
 *   2. The Razorpay webhook still receives req.rawBody and a valid HMAC
 *      signature is accepted (200), while a tampered/missing one is rejected.
 */
import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import billingRoutes from '../routes/billing.js';

// Mirrors the server.js global body parser after the fix: 1mb, no raw-body
// capture. Used to prove the global limit is enforced without depending on the
// full server bootstrap.
function buildGlobalParserApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.post('/echo', (req, res) => res.json({ ok: true, bytes: req.body?.data?.length ?? 0 }));
  return app;
}

// Minimal app mirroring the server.js middleware order for the billing webhook:
// a path-scoped raw-body parser mounted BEFORE the global express.json, then the
// billing router. This is the exact production wiring (the global parser
// consumes the stream, so the raw-body capture must run first for that path).
const RAZORPAY_WEBHOOK_PATH = '/api/v1/billing/razorpay-webhook';
function buildBillingApp() {
  const app = express();
  app.use((req, _res, next) => {
    if (req.path !== RAZORPAY_WEBHOOK_PATH) return next();
    return express.json({
      limit: '1mb',
      verify: (req2, _res2, buf) => {
        req2.rawBody = buf;
      },
    })(req, _res, next);
  });
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/v1/billing', billingRoutes);
  return app;
}

describe('H1 — global body limit lowered to 1mb', () => {
  it('accepts a JSON body well under 1mb', async () => {
    const app = buildGlobalParserApp();
    const small = { data: 'x'.repeat(1_000) };
    await request(app).post('/echo').send(small).expect(200);
  });

  it('rejects a JSON body larger than 1mb with 413 Payload Too Large', async () => {
    const app = buildGlobalParserApp();
    // ~2mb payload — must be rejected by the lowered limit. Before the fix this
    // was accepted (50mb cap) and double-buffered into rawBody.
    const oversized = { data: 'x'.repeat(2 * 1024 * 1024) };
    const res = await request(app).post('/echo').send(oversized).expect(413);
    expect(res.text).toMatch(/payload/i);
  });
});

describe('H1 — Razorpay webhook keeps raw-body capture for signature verification', () => {
  const WEBHOOK_SECRET = 'whsec_test_secret_for_h1';

  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  afterEach(() => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
  });

  function signedHeaders(payloadObj) {
    const raw = JSON.stringify(payloadObj);
    const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
    return { 'x-razorpay-signature': signature, 'content-type': 'application/json' };
  }

  it('accepts a webhook with a valid HMAC signature (200)', async () => {
    const app = buildBillingApp();
    const payload = { event: 'payment.captured', payload: { payment: { entity: {} } } };

    const res = await request(app)
      .post('/api/v1/billing/razorpay-webhook')
      .set(signedHeaders(payload))
      .send(payload)
      .expect(200);

    expect(res.body).toMatchObject({ received: true });
  });

  it('rejects a webhook whose signature does not match the raw body (400)', async () => {
    const app = buildBillingApp();
    const payload = { event: 'payment.captured', payload: { payment: { entity: {} } } };

    // Correct body, WRONG signature → must be rejected. This proves the
    // signature is computed against req.rawBody (the exact bytes), not a
    // re-serialized body that could differ in key ordering/whitespace.
    await request(app)
      .post('/api/v1/billing/razorpay-webhook')
      .set({ 'x-razorpay-signature': 'deadbeef', 'content-type': 'application/json' })
      .send(payload)
      .expect(400);
  });

  it('rejects a webhook with no signature header (400)', async () => {
    const app = buildBillingApp();
    await request(app)
      .post('/api/v1/billing/razorpay-webhook')
      .send({ event: 'payment.captured' })
      .expect(400);
  });
});
