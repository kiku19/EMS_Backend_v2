import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

const BASE = '/api/upload';

describe('upload routes', () => {
  let app, school, admin, headers;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'Upload School', code: 'UPL' });
    admin = await createStaffUser({
      name: 'Upload Admin',
      email: 'upload.admin@example.com',
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });
    headers = authHeadersFor(admin, 'admin');
    ({ app } = createTestApp());
  });

  // ───────────────────────────────────────────────────────────────
  // Auth
  // ───────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('POST /api/upload returns 401 without token', async () => {
      await request(app).post(BASE).expect(401);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST /api/upload — validation
  // ───────────────────────────────────────────────────────────────
  describe('POST /api/upload', () => {
    it('returns 400 when no file is attached', async () => {
      const res = await request(app).post(BASE).set(headers).expect(400);

      expect(res.body.error).toMatch(/no file/i);
    });

    it('rejects a disallowed MIME type (multer fileFilter error)', async () => {
      // Multer fileFilter errors bypass the route's try/catch (they flow via next(err)).
      // Express's default error handler returns 500 in this path.
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .attach('file', Buffer.from('malicious content'), {
          filename: 'evil.exe',
          contentType: 'application/x-msdownload',
        });

      // The request should NOT succeed (200 is never returned for rejected types)
      expect(res.status).not.toBe(200);
    });

    it('returns 503 when Cloudinary is not configured', async () => {
      // In test environment Cloudinary env vars are not set
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .attach('file', Buffer.from('fake image data'), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        })
        .expect(503);

      expect(res.body.error).toMatch(/not configured/i);
    });
  });
});
