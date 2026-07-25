/**
 * H2 — Auth cookie attributes audit (SameSite=None CSRF surface).
 *
 * Production auth/refresh cookies are `httpOnly + sameSite=none + secure` so
 * they can be sent cross-origin by the browser. CSRF safety therefore rests on
 * the csrfProtect middleware validating the Origin/Referer of every cookie-
 * authenticated mutation (covered in csrfProtect.unit.test.js).
 *
 * These tests pin the cookie-attribute contract so a regression (e.g. dropping
 * httpOnly, or setting sameSite=none without secure in production) is caught.
 * The 2FA device cookie (routes/twoFactor.js) and the super-admin ops cookies
 * (routes/superAdminAuth.js) are built from the identical pattern — all four
 * cookie builders were audited for H2 and share httpOnly/sameSite/secure.
 *
 * We exercise the setters through a real Express response (supertest) because
 * the auth module transitively compiles Mongoose models, which would otherwise
 * collide with the test DB's model registry.
 */
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAuthCookie, setRefreshCookie } from '../middleware/auth/auth.js';

function cookieApp(setter) {
  const app = express();
  app.get('/set', (req, res) => {
    setter(res, 'signed-token-value');
    res.json({ ok: true });
  });
  return app;
}

function parseSetCookieHeader(headers) {
  const raw = headers['set-cookie'];
  if (!raw || raw.length === 0) return '';
  return raw.join('; ');
}

describe('H2 — auth/refresh cookie attributes (production SameSite=None surface)', () => {
  // The cookie option builders read NODE_ENV at CALL time, so stubbing it before
  // each request is sufficient. No module reset (that would recompile Mongoose
  // models and collide with the test DB registry).

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sets the auth cookie HttpOnly + SameSite=None + Secure in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const res = await request(cookieApp(setAuthCookie)).get('/set').expect(200);
    const cookie = parseSetCookieHeader(res.headers);

    expect(cookie).toContain('ems_auth_token=');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=None/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/Path=\//i);
  });

  it('sets the refresh cookie HttpOnly + SameSite=None + Secure in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const res = await request(cookieApp(setRefreshCookie)).get('/set').expect(200);
    const cookie = parseSetCookieHeader(res.headers);

    expect(cookie).toContain('ems_refresh_token=');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=None/i);
    expect(cookie).toMatch(/Secure/i);
  });

  it('uses SameSite=Lax (not None) outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development');

    const res = await request(cookieApp(setAuthCookie)).get('/set').expect(200);
    const cookie = parseSetCookieHeader(res.headers);

    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Secure/i);
  });
});
