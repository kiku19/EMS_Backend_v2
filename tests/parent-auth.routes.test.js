import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import parentAuthRoutes from '../routes/parentAuth.js';

function createParentAuthTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/parent/auth', parentAuthRoutes);
  return app;
}

describe('parent auth routes', () => {
  it('returns 503 for OTP requests when Firebase is not configured', async () => {
    const app = createParentAuthTestApp();

    const response = await request(app)
      .post('/api/parent/auth/send-otp')
      .send({
        phone: '9876543210',
      })
      .expect(503);

    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'OTP_PROVIDER_NOT_CONFIGURED',
      },
    });
  });

  it('returns 503 for OTP verification when Firebase is not configured', async () => {
    const app = createParentAuthTestApp();

    const response = await request(app)
      .post('/api/parent/auth/verify-otp')
      .send({
        phone: '9876543210',
        firebaseIdToken: 'dummy-token',
      })
      .expect(503);

    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'OTP_PROVIDER_NOT_CONFIGURED',
      },
    });
  });
});
