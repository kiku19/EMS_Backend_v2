/**
 * Shared auth helper functions used by both auth.js and twoFactor.js.
 * Kept in a separate module to avoid circular imports.
 */
import jwt from 'jsonwebtoken';
import { Class } from '../database.js';
import { getRequiredSecret } from '../config/environment.js';
import { ensureDocumentSchool, resolveSchool, serializeSchool } from '../utils/schoolContext.js';
import {
  ensureSchoolSubscription,
  summarizeSubscription,
  syncUsageMetrics, // eslint-disable-line no-unused-vars
} from '../services/billingService.js';

export function generateStaffRefreshToken(staffId, schoolId, tokenVersion = 1, sessionId) {
  const claims = { userId: staffId, schoolId, userType: 'staff', tokenVersion };
  if (sessionId) claims.sessionId = sessionId;
  return jwt.sign(claims, getRequiredSecret('JWT_REFRESH_SECRET'), { expiresIn: '30d' });
}

export async function buildStaffAuthPayload(staff) {
  const resolvedSchoolId = await ensureDocumentSchool(staff);
  const classes = await Class.find({ classTeacherId: staff._id });
  const school = resolvedSchoolId ? await resolveSchool({ schoolId: resolvedSchoolId }) : null;
  const subscription = resolvedSchoolId
    ? await ensureSchoolSubscription(resolvedSchoolId, {
        billingContactName: school?.billingContactName || school?.name,
        billingEmail: school?.billingEmail || school?.contactEmail,
        billingPhone: school?.billingPhone || school?.contactPhone,
      })
    : null;

  return {
    id: staff._id,
    code: staff.code,
    name: staff.name,
    role: staff.role,
    email: staff.email,
    phone: staff.phone,
    classes: classes.map((cls) => ({ id: cls._id, name: cls.name, section: cls.section })),
    employeeId: staff.code,
    picture: staff.picture || staff.photo || null,
    schoolId: resolvedSchoolId?.toString?.() || resolvedSchoolId || null,
    school: serializeSchool(school),
    subscription: summarizeSubscription(subscription),
  };
}
