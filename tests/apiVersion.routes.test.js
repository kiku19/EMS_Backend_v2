/**
 * Integration tests for API versioning.
 *
 * Verifies that the test app mirrors server.js: all business routes are
 * available under /api/v1 and continue to work under the legacy /api prefix
 * with deprecation headers.
 */

import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { createTestApp } from './helpers/testApp.js';
import { generateSignupInvite } from '../utils/signupInvites.js';

describe('API versioning routes', () => {
  it('serves /api/v1/auth/signup and returns the same result as /api/auth/signup', async () => {
    const { app } = createTestApp();

    const v1Response = await request(app)
      .post('/api/v1/auth/signup')
      .send({
        name: 'Priya Sharma',
        email: 'priya@example.com',
        schoolName: 'Sunrise Public School',
        password: 'Password123',
      })
      .expect(400);

    const legacyResponse = await request(app)
      .post('/api/auth/signup')
      .send({
        name: 'Priya Sharma',
        email: 'priya@example.com',
        schoolName: 'Sunrise Public School',
        password: 'Password123',
      })
      .expect(400);

    expect(v1Response.body.error).toBe('Validation Error');
    expect(legacyResponse.body.error).toBe('Validation Error');
    expect(v1Response.headers['x-api-version']).toBe('v1');
    expect(legacyResponse.headers['x-api-version']).toBe('v1');
  });

  it('includes Deprecation, Sunset, and Link headers on legacy /api routes', async () => {
    const { app } = createTestApp();
    const inviteToken = generateSignupInvite({
      email: 'priya@example.com',
      schoolName: 'Sunrise Public School',
      invitedBy: 'ops-team',
    });

    const response = await request(app)
      .get('/api/auth/signup/invite-details')
      .query({ token: inviteToken })
      .expect(200);

    expect(response.headers['deprecation']).toBe('true');
    expect(response.headers['sunset']).toBe('Mon, 01 Jan 2029 00:00:00 GMT');
    expect(response.headers['link']).toContain('/api/v1/auth/signup/invite-details');
    expect(response.headers['link']).toContain('rel="successor-version"');
  });

  it('does not include Deprecation headers on canonical /api/v1 routes', async () => {
    const { app } = createTestApp();
    const inviteToken = generateSignupInvite({
      email: 'legacy@example.com',
      schoolName: 'Sunrise Public School',
      invitedBy: 'ops-team',
    });

    const response = await request(app)
      .get('/api/v1/auth/signup/invite-details')
      .query({ token: inviteToken })
      .expect(200);

    expect(response.headers['x-api-version']).toBe('v1');
    expect(response.headers['deprecation']).toBeUndefined();
    expect(response.headers['sunset']).toBeUndefined();
  });
});
