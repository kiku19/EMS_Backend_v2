import express from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { onboardSchool } from '../services/schoolProvisioningService.js';
import { generateToken, setAuthCookie, setRefreshCookie } from '../middleware/auth.js';
import { buildStaffAuthPayload, generateStaffRefreshToken } from './authHelpers.js';
import { validateZod } from '../middleware/validation.js';
import { randomUUID } from 'crypto';
import { createStaffSessionRecord } from '../utils/sessions.js';
import {
  seedStaff,
  seedClasses,
  seedStudents,
  seedAttendance,
  seedAcademics,
  seedFees,
  seedFrontDesk,
  seedMessaging,
} from './seedDummyData.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Demo');
const router = express.Router();

// ─── Validation ───────────────────────────────────────────────
const demoProvisionSchema = z.object({
  prospectName: z.string().trim().max(100).optional(),
  prospectEmail: z.string().trim().email('Invalid email address').optional().or(z.literal('')),
  prospectCompany: z.string().trim().max(100).optional(),
});

// 5 demo provisions per IP per hour
const demoRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    message: 'Too many demo requests from this IP. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

/**
 * POST /api/v1/demo/provision
 * Auto-provision a fully seeded demo school for prospects.
 * No authentication required — public endpoint.
 * Returns a JWT token for immediate dashboard access.
 */
router.post('/provision', demoRateLimiter, validateZod(demoProvisionSchema), async (req, res) => {
  try {
    const { prospectName, prospectEmail, prospectCompany } = req.body;

    const timestamp = Date.now();
    const adminEmail = `demo-admin-${timestamp}@demo.ems.school`;
    const adminPassword = 'DemoAccess@123';
    const demoExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // 1. Provision a fresh school + admin
    const result = await onboardSchool({
      schoolName: 'Demo School',
      adminName: 'Demo Admin',
      adminEmail,
      adminPassword,
      plan: 'growth',
      planStatus: 'trialing',
      provisionedBy: 'demo-system',
      source: 'demo-auto-provision',
      schoolSettings: { email: adminEmail },
    });

    const { school, admin } = result;

    // 2. Tag school as demo with expiry + prospect tracking
    school.metadata = {
      ...school.metadata,
      isDemo: true,
      demoExpiresAt: demoExpiresAt.toISOString(),
      provisionedAt: new Date().toISOString(),
      ...(prospectName ? { prospectName } : {}),
      ...(prospectEmail ? { prospectEmail } : {}),
      ...(prospectCompany ? { prospectCompany } : {}),
    };
    school.markModified('metadata');
    await school.save();

    const schoolId = school._id;

    // 3. Seed demo data in dependency order
    const staffRecords = await seedStaff(schoolId, admin._id);
    const staffIds = staffRecords.map((s) => s._id);

    const classes = await seedClasses(schoolId, staffIds);
    const { students } = await seedStudents(schoolId, classes);

    await Promise.all([
      seedAttendance(schoolId, students, classes, staffIds),
      seedAcademics(schoolId, classes, students, staffIds),
      seedFees(schoolId, classes, students),
      seedFrontDesk(schoolId, staffIds),
      seedMessaging(schoolId, staffIds),
    ]);

    // 4. Generate auth token for immediate dashboard access
    const payload = await buildStaffAuthPayload(admin);
    const sessionId = randomUUID();
    const token = generateToken(admin._id.toString(), admin.role, {
      schoolId: schoolId.toString(),
      userType: 'staff',
      sessionId,
    });
    const refreshToken = generateStaffRefreshToken(
      admin._id.toString(),
      schoolId.toString(),
      admin.tokenVersion || 1,
      sessionId
    );
    await createStaffSessionRecord({ staff: admin, sessionId, req });

    // Set httpOnly cookies so auth survives page refresh
    setAuthCookie(res, token);
    setRefreshCookie(res, refreshToken);

    logger.info(
      { schoolId: schoolId.toString(), schoolCode: school.code, prospectEmail },
      'Demo school provisioned'
    );

    res.status(201).json({
      success: true,
      message: 'Demo environment ready',
      demo: {
        schoolName: school.name,
        schoolCode: school.code,
        expiresAt: demoExpiresAt.toISOString(),
      },
      ...payload,
      token,
      refreshToken,
    });
  } catch (error) {
    logger.error({ err: error }, 'Demo provisioning failed');
    res.status(500).json({
      success: false,
      message: 'Failed to provision demo environment. Please try again.',
    });
  }
});

export default router;
