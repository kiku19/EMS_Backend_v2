import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

describe('global cookie-authenticated CSRF protection', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CORS_ORIGIN', 'https://dashboard.classora.app,https://ops.classora.app');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects a production cookie-authenticated mutation from another origin', async () => {
    const { csrfProtect } = await import('../middleware/security/csrfProtect.js');
    const next = vi.fn();
    const response = createResponse();

    csrfProtect(
      {
        method: 'POST',
        originalUrl: '/api/v1/students',
        headers: {
          cookie: 'ems_auth_token=signed-token',
          origin: 'https://attacker.example',
        },
      },
      response,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(403);
    expect(response.body).toMatchObject({
      error: 'Forbidden: cross-site request blocked',
    });
  });

  it('accepts a cookie-authenticated mutation from an allowed dashboard origin', async () => {
    const { csrfProtect } = await import('../middleware/security/csrfProtect.js');
    const next = vi.fn();

    csrfProtect(
      {
        method: 'PATCH',
        originalUrl: '/api/v1/settings/school',
        headers: {
          cookie: 'ems_auth_token=signed-token',
          origin: 'https://dashboard.classora.app',
        },
      },
      createResponse(),
      next
    );

    expect(next).toHaveBeenCalledOnce();
  });

  it('allows Bearer and API-key mutations without browser Origin headers', async () => {
    const { csrfProtect } = await import('../middleware/security/csrfProtect.js');

    for (const headers of [
      { authorization: 'Bearer signed-token' },
      { 'x-api-key': 'server-key' },
    ]) {
      const next = vi.fn();
      csrfProtect(
        {
          method: 'POST',
          originalUrl: '/api/v1/attendance',
          headers,
        },
        createResponse(),
        next
      );
      expect(next).toHaveBeenCalledOnce();
    }
  });

  it('does not block unauthenticated webhook traffic', async () => {
    const { csrfProtect } = await import('../middleware/security/csrfProtect.js');
    const next = vi.fn();

    csrfProtect(
      {
        method: 'POST',
        originalUrl: '/api/v1/webhooks/razorpay',
        headers: {},
      },
      createResponse(),
      next
    );

    expect(next).toHaveBeenCalledOnce();
  });

  it('keeps the signed SAML callback exempt when an old auth cookie exists', async () => {
    const { csrfProtect } = await import('../middleware/security/csrfProtect.js');
    const next = vi.fn();

    csrfProtect(
      {
        method: 'POST',
        originalUrl: '/api/v1/auth/sso/saml/callback',
        headers: {
          cookie: 'ems_auth_token=old-session',
          origin: 'https://identity.school.example',
        },
      },
      createResponse(),
      next
    );

    expect(next).toHaveBeenCalledOnce();
  });

  // H2 — SameSite=None cookie CSRF coverage for the specific cookie-authenticated
  // mutation paths the launch audit flagged: /auth/refresh (refresh cookie) and
  // a super-admin mutation (ops cookie). Both carry ambient auth cookies and use
  // non-safe methods, so csrfProtect MUST validate their Origin/Referer.

  it('rejects a cross-site POST /auth/refresh carrying the refresh cookie', async () => {
    const { csrfProtect } = await import('../middleware/security/csrfProtect.js');
    const next = vi.fn();
    const response = createResponse();

    csrfProtect(
      {
        method: 'POST',
        originalUrl: '/api/v1/auth/refresh',
        headers: {
          cookie: 'ems_refresh_token=signed-refresh',
          origin: 'https://attacker.example',
        },
      },
      response,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(403);
    expect(response.body).toMatchObject({ error: 'Forbidden: cross-site request blocked' });
  });

  it('accepts a same-origin POST /auth/refresh carrying the refresh cookie', async () => {
    const { csrfProtect } = await import('../middleware/security/csrfProtect.js');
    const next = vi.fn();

    csrfProtect(
      {
        method: 'POST',
        originalUrl: '/api/v1/auth/refresh',
        headers: {
          cookie: 'ems_refresh_token=signed-refresh',
          origin: 'https://dashboard.classora.app',
        },
      },
      createResponse(),
      next
    );

    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects a cross-site super-admin mutation carrying the ops auth cookie', async () => {
    const { csrfProtect } = await import('../middleware/security/csrfProtect.js');
    const next = vi.fn();
    const response = createResponse();

    csrfProtect(
      {
        method: 'PATCH',
        originalUrl: '/api/v1/super-admin/schools/507f1f77bcf86cd799439011',
        headers: {
          cookie: 'ems_ops_token=ops-session',
          origin: 'https://attacker.example',
        },
      },
      response,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(403);
    expect(response.body).toMatchObject({ error: 'Forbidden: cross-site request blocked' });
  });

  it('accepts a same-origin super-admin mutation from the ops origin', async () => {
    const { csrfProtect } = await import('../middleware/security/csrfProtect.js');
    const next = vi.fn();

    csrfProtect(
      {
        method: 'PATCH',
        originalUrl: '/api/v1/super-admin/schools/507f1f77bcf86cd799439011',
        headers: {
          cookie: 'ems_ops_token=ops-session',
          origin: 'https://ops.classora.app',
        },
      },
      createResponse(),
      next
    );

    expect(next).toHaveBeenCalledOnce();
  });
});
