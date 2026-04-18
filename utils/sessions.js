import Session from '../models/Session.js';

function parseDeviceInfo(userAgent = '') {
  const ua = userAgent || '';
  let browser = 'Unknown';
  let os = 'Unknown';
  let device = 'Desktop';

  if (/Chrome/.test(ua) && !/Edge/.test(ua)) browser = 'Chrome';
  else if (/Firefox/.test(ua)) browser = 'Firefox';
  else if (/Safari/.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';
  else if (/Edge/.test(ua)) browser = 'Edge';

  if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad/.test(ua)) os = 'iOS';

  if (/Mobile|Android|iPhone/.test(ua)) device = 'Mobile';
  else if (/iPad|Tablet/.test(ua)) device = 'Tablet';

  return { browser, os, device };
}

/**
 * Create a persisted Session row so the issued access token is revocable
 * via `DELETE /auth/sessions/:sessionId` and `logout-everywhere` flows.
 *
 * The session record is the authority for `Session.isRevoked` which
 * authenticate middleware reads on every protected request.
 */
export async function createStaffSessionRecord({ staff, sessionId, req }) {
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.connection?.remoteAddress ||
    req.ip;
  const userAgent = req.headers['user-agent'] || null;
  const deviceInfo = parseDeviceInfo(userAgent);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // refresh-token lifetime

  await Session.create({
    sessionId,
    userId: staff._id,
    schoolId: staff.schoolId,
    userType: 'staff',
    ipAddress: ip || null,
    userAgent,
    deviceInfo,
    lastActivityAt: new Date(),
    expiresAt,
    isRevoked: false,
  });
}
