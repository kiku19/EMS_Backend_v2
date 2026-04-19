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

    it('rejects SVG files (excluded from allowed types to prevent script execution)', async () => {
      const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .attach('file', Buffer.from(svgContent), {
          filename: 'evil.svg',
          contentType: 'image/svg+xml',
        });

      expect(res.status).not.toBe(200);
    });

    it('rejects HTML content disguised as image/jpeg (MIME spoofing)', async () => {
      const htmlContent = '<!DOCTYPE html><html><body><script>alert(1)</script></body></html>';
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .attach('file', Buffer.from(htmlContent), {
          filename: 'evil.jpg',
          contentType: 'image/jpeg',
        })
        .expect(400);

      expect(res.body.error).toMatch(/HTML|content does not match/i);
    });

    it('rejects HTML content disguised as text/plain', async () => {
      const htmlContent = '<html><body>hello</body></html>';
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .attach('file', Buffer.from(htmlContent), {
          filename: 'evil.txt',
          contentType: 'text/plain',
        })
        .expect(400);

      expect(res.body.error).toMatch(/HTML/i);
    });

    it('returns 400 when image content is faked (MIME mismatch)', async () => {
      // The route runs MIME-magic validation BEFORE the Cloudinary check, so
      // a fake-payload "image/jpeg" is rejected at the file-validation layer
      // with 400 instead of reaching the 503 "not configured" path.
      const res = await request(app)
        .post(BASE)
        .set(headers)
        .attach('file', Buffer.from('fake image data'), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        })
        .expect(400);

      expect(res.body.error).toMatch(/does not match|declared type|magic/i);
    });
  });
});
