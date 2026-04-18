import request from 'supertest';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { createTestApp } from './helpers/testApp.js';
import { School, SchoolSettings, SchoolSubscription, Staff, UserPermission } from '../database.js';
import { createClassRecord, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { generateSignupInvite } from '../utils/signupInvites.js';
import { generateToken, verifyToken } from '../middleware/auth.js';
import { piiMatch } from '../utils/encryption.js';

describe('auth routes', () => {
  it('rejects signup without an invite token', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/auth/signup')
      .send({
        name: 'Priya Sharma',
        email: 'priya@example.com',
        schoolName: 'Sunrise Public School',
        password: 'Password123',
      })
      .expect(400);

    expect(response.body.error).toBe('Validation Error');
    expect(response.body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'inviteToken' })])
    );
  });

  it('returns invite details for a valid invite token', async () => {
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

    expect(response.body).toMatchObject({
      success: true,
      invite: {
        email: 'priya@example.com',
        schoolName: 'Sunrise Public School',
        invitedBy: 'ops-team',
        expiresAt: expect.any(String),
      },
    });
  });

  it('signs up a new school and provisions an admin account from a valid invite', async () => {
    const { app } = createTestApp();
    const inviteToken = generateSignupInvite({
      email: 'priya@example.com',
      schoolName: 'Sunrise Public School',
      invitedBy: 'ops-team',
    });

    const response = await request(app)
      .post('/api/auth/signup')
      .send({
        name: 'Priya Sharma',
        email: 'priya@example.com',
        schoolName: 'Sunrise Public School',
        password: 'Password123',
        inviteToken,
      })
      .expect(201);

    expect(response.body).toMatchObject({
      success: true,
      message: 'Invite accepted successfully',
      school: expect.objectContaining({
        name: 'Sunrise Public School',
        code: 'SUNRISE-PUBLIC-SCHOOL',
      }),
      user: expect.objectContaining({
        name: 'Priya Sharma',
        email: 'priya@example.com',
        schoolId: expect.any(String),
        subscription: expect.objectContaining({
          planKey: 'growth',
          status: 'trialing',
        }),
      }),
    });

    const school = await School.findOne({ code: 'SUNRISE-PUBLIC-SCHOOL' });
    const staff = await Staff.findOne(piiMatch('email', 'priya@example.com'));
    const permissions = await UserPermission.findOne({ userId: staff?._id });
    const settings = await SchoolSettings.findOne({ schoolId: school?._id });
    const subscription = await SchoolSubscription.findOne({ schoolId: school?._id });

    expect(school).toBeTruthy();
    expect(school?.metadata).toMatchObject({
      signupSource: 'invite-only',
      invitedBy: 'ops-team',
    });
    expect(staff).toBeTruthy();
    expect(staff?.schoolId?.toString()).toBe(school?._id.toString());
    expect(staff?.role).toEqual(['Admin']);
    expect(await staff?.comparePassword('Password123')).toBe(true);
    expect(permissions).toMatchObject({
      schoolId: school?._id,
      userId: staff?._id,
      role: 'admin',
    });
    expect(settings).toMatchObject({
      schoolId: school?._id,
      schoolName: 'Sunrise Public School',
      email: 'priya@example.com',
    });
    expect(subscription).toMatchObject({
      schoolId: school?._id,
      planKey: 'starter',
      trialPlanKey: 'growth',
      status: 'trialing',
      billingEmail: 'priya@example.com',
      billingContactName: 'Priya Sharma',
    });
  });

  it('rejects signup when the invite token is invalid', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/auth/signup')
      .send({
        name: 'Priya Sharma',
        email: 'priya@example.com',
        schoolName: 'Sunrise Public School',
        password: 'Password123',
        inviteToken: 'invalid-token',
      })
      .expect(403);

    expect(response.body.error).toBe(
      'Signup is available by invitation only. Use the invite link sent to your school.'
    );
  });

  it('rejects signup when the owner email is already in use', async () => {
    await createStaffUser({
      name: 'Existing Admin',
      email: 'existing@example.com',
      password: 'Password123',
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });

    const { app } = createTestApp();
    const inviteToken = generateSignupInvite({
      email: 'existing@example.com',
      schoolName: 'Another School',
    });

    const response = await request(app)
      .post('/api/auth/signup')
      .send({
        name: 'New Admin',
        email: 'existing@example.com',
        schoolName: 'Another School',
        password: 'Password123',
        inviteToken,
      })
      .expect(409);

    expect(response.body.error).toBe('An account with this email already exists');
    expect(await School.countDocuments({ name: 'Another School' })).toBe(0);
  });

  it('logs in with a cookie session and restores the current session', async () => {
    const school = await createSchoolRecord({
      name: 'North Campus',
      code: 'NORTH-CAMPUS',
      isDefault: true,
    });

    const teacher = await createStaffUser({
      name: 'Alice Teacher',
      email: 'alice.teacher@example.com',
      password: 'Password123',
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
      schoolId: school._id,
    });

    await createClassRecord({
      name: 'Class 8',
      section: 'B',
      classTeacherId: teacher._id,
    });

    const { app } = createTestApp();
    const agent = request.agent(app);

    const loginResponse = await agent
      .post('/api/auth/login')
      .set('X-Auth-Mode', 'cookie')
      .send({
        email: 'alice.teacher@example.com',
        password: 'Password123',
      })
      .expect(200);

    expect(loginResponse.body).toMatchObject({
      id: teacher._id.toString(),
      name: 'Alice Teacher',
      schoolId: school._id.toString(),
      school: expect.objectContaining({
        code: 'NORTH-CAMPUS',
      }),
      subscription: expect.objectContaining({
        planKey: 'growth',
        status: 'trialing',
      }),
      token: expect.any(String),
    });
    expect(loginResponse.headers['set-cookie']).toBeTruthy();

    const sessionResponse = await agent.get('/api/auth/session').expect(200);

    expect(sessionResponse.body).toMatchObject({
      id: teacher._id.toString(),
      name: 'Alice Teacher',
      schoolId: school._id.toString(),
      school: expect.objectContaining({
        code: 'NORTH-CAMPUS',
      }),
      subscription: expect.objectContaining({
        planKey: 'growth',
        status: 'trialing',
      }),
      token: expect.any(String),
    });
    expect(sessionResponse.body.classes).toEqual([
      expect.objectContaining({
        name: 'Class 8',
        section: 'B',
      }),
    ]);
  });

  it('rejects invalid credentials', async () => {
    await createStaffUser({
      name: 'Bob Admin',
      email: 'bob.admin@example.com',
      password: 'Password123',
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });

    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'bob.admin@example.com',
        password: 'wrong-password',
      })
      .expect(401);

    expect(response.body.error).toBe('Invalid credentials');
  });

  it('logs in as super admin and restores the super admin session', async () => {
    const { app } = createTestApp();
    const agent = request.agent(app);

    const loginResponse = await agent
      .post('/api/auth/login')
      .set('X-Auth-Mode', 'cookie')
      .send({
        email: 'superid@test.com',
        password: 'super12345',
      })
      .expect(200);

    expect(loginResponse.body).toMatchObject({
      id: 'super-admin',
      name: 'Master User',
      role: ['Super Admin'],
      userType: 'super-admin',
      token: expect.any(String),
    });

    const sessionResponse = await agent.get('/api/auth/session').expect(200);

    expect(sessionResponse.body).toMatchObject({
      id: 'super-admin',
      name: 'Master User',
      role: ['Super Admin'],
      userType: 'super-admin',
      token: expect.any(String),
    });
  });

  it('requires a school identifier when credentials match multiple schools', async () => {
    const northSchool = await createSchoolRecord({
      name: 'North Campus',
      code: 'NORTH',
    });
    const southSchool = await createSchoolRecord({
      name: 'South Campus',
      code: 'SOUTH',
    });

    await createStaffUser({
      name: 'Alex North',
      email: 'alex@example.com',
      password: 'Password123',
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
      schoolId: northSchool._id,
    });

    await createStaffUser({
      name: 'Alex South',
      email: 'alex@example.com',
      password: 'Password123',
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
      schoolId: southSchool._id,
    });

    const { app } = createTestApp();

    const ambiguousResponse = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'alex@example.com',
        password: 'Password123',
      })
      .expect(409);

    expect(ambiguousResponse.body.error).toBe(
      'Multiple accounts matched the provided credentials. Please provide a school identifier.'
    );

    const resolvedResponse = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'alex@example.com',
        password: 'Password123',
        schoolCode: 'SOUTH',
      })
      .expect(200);

    expect(resolvedResponse.body).toMatchObject({
      name: 'Alex South',
      schoolId: southSchool._id.toString(),
      school: expect.objectContaining({
        code: 'SOUTH',
      }),
      subscription: expect.objectContaining({
        planKey: 'growth',
        status: 'trialing',
      }),
      token: expect.any(String),
    });
  });

  // ─── Login endpoint — additional coverage ────────────────────────────────

  it('rejects login with a wrong password', async () => {
    const school = await createSchoolRecord({ name: 'Test School', code: 'TEST-WRONG-PW' });

    await createStaffUser({
      name: 'Carol Staff',
      email: 'carol.staff@example.com',
      password: 'correctpassword',
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
      schoolId: school._id,
    });

    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'carol.staff@example.com',
        password: 'wrongpassword',
      })
      .expect(401);

    expect(response.body.error).toBe('Invalid credentials');
  });

  it('rejects login for a non-existent email', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'nobody@example.com',
        password: 'Password123',
      })
      .expect(401);

    expect(response.body.error).toBe('Invalid credentials');
  });

  it('rejects login when the email field is missing', async () => {
    const { app } = createTestApp();

    // Sending only a password (no email, no phone) triggers the Joi .xor() rule
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        password: 'Password123',
      })
      .expect(400);

    expect(response.body.error).toBe('Validation Error');
  });

  it('rejects login when the password field is missing', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'someone@example.com',
      })
      .expect(400);

    expect(response.body.error).toBe('Validation Error');
    expect(response.body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'password' })])
    );
  });

  it('rejects login for an inactive (suspended) staff member', async () => {
    const school = await createSchoolRecord({ name: 'Inactive School', code: 'INACTIVE-SCH' });

    await createStaffUser({
      name: 'Suspended User',
      email: 'suspended@example.com',
      password: 'Password123',
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
      status: 'inactive',
      schoolId: school._id,
    });

    const { app } = createTestApp();

    // The authenticateStaff function queries { status: 'active', ... } so an
    // inactive account produces "Invalid credentials" (401), not a 403.
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'suspended@example.com',
        password: 'Password123',
      })
      .expect(401);

    expect(response.body.error).toBe('Invalid credentials');
  });

  it('login response body includes the schoolId for the authenticated staff', async () => {
    const school = await createSchoolRecord({ name: 'Token School', code: 'TOKEN-SCH' });

    await createStaffUser({
      name: 'Dana Teacher',
      email: 'dana.teacher@example.com',
      password: 'Password123',
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
      schoolId: school._id,
    });

    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'dana.teacher@example.com',
        password: 'Password123',
      })
      .expect(200);

    expect(response.body.schoolId).toBe(school._id.toString());
    expect(response.body.token).toEqual(expect.any(String));
  });

  // ─── Session endpoint — GET /api/auth/session ────────────────────────────

  it('returns current user info when a valid Bearer token is supplied to the session endpoint', async () => {
    const school = await createSchoolRecord({ name: 'Session School', code: 'SESSION-SCH' });

    const staff = await createStaffUser({
      name: 'Eve Staff',
      email: 'eve.staff@example.com',
      password: 'Password123',
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
      schoolId: school._id,
    });

    const token = generateToken(staff._id.toString(), staff.role, {
      schoolId: school._id.toString(),
      userType: 'staff',
    });

    const { app } = createTestApp();

    const response = await request(app)
      .get('/api/auth/session')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toMatchObject({
      id: staff._id.toString(),
      name: 'Eve Staff',
      schoolId: school._id.toString(),
      token: expect.any(String),
    });
  });

  it('returns 401 when no token is provided to the session endpoint', async () => {
    const { app } = createTestApp();

    const response = await request(app).get('/api/auth/session').expect(401);

    expect(response.body.error).toBeDefined();
  });

  it('returns 401 when a malformed token is provided to the session endpoint', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .get('/api/auth/session')
      .set('Authorization', 'Bearer this.is.not.a.valid.jwt')
      .expect(401);

    expect(response.body.error).toBeDefined();
  });

  it('returns 401 when an expired token is provided to the session endpoint', async () => {
    const school = await createSchoolRecord({ name: 'Expired School', code: 'EXPIRED-SCH' });

    const staff = await createStaffUser({
      name: 'Frank Staff',
      email: 'frank.staff@example.com',
      password: 'Password123',
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
      schoolId: school._id,
    });

    // Sign a token that expired one second ago using the same secret the test
    // setup injects via process.env.JWT_SECRET.
    const expiredToken = jwt.sign(
      {
        userId: staff._id.toString(),
        role: staff.role,
        schoolId: school._id.toString(),
        userType: 'staff',
      },
      process.env.JWT_SECRET,
      { expiresIn: -1 }
    );

    const { app } = createTestApp();

    const response = await request(app)
      .get('/api/auth/session')
      .set('Authorization', `Bearer ${expiredToken}`)
      .expect(401);

    expect(response.body.error).toBeDefined();
  });

  // ─── Token / JWT ──────────────────────────────────────────────────────────

  it('authenticates protected routes using the Bearer token format returned by login', async () => {
    const school = await createSchoolRecord({ name: 'Bearer School', code: 'BEARER-SCH' });

    const staff = await createStaffUser({
      name: 'Grace Staff',
      email: 'grace.staff@example.com',
      password: 'Password123',
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
      schoolId: school._id,
    });

    const { app } = createTestApp();

    // Obtain the token through the login endpoint
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'grace.staff@example.com',
        password: 'Password123',
      })
      .expect(200);

    const { token } = loginResponse.body;
    expect(token).toBeTruthy();

    // Use the Bearer token on the session endpoint (a protected route)
    const sessionResponse = await request(app)
      .get('/api/auth/session')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(sessionResponse.body).toMatchObject({
      id: staff._id.toString(),
      name: 'Grace Staff',
    });
  });

  it('the JWT returned by login contains the correct userId and schoolId claims', async () => {
    const school = await createSchoolRecord({ name: 'Claims School', code: 'CLAIMS-SCH' });

    const staff = await createStaffUser({
      name: 'Henry Staff',
      email: 'henry.staff@example.com',
      password: 'Password123',
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
      schoolId: school._id,
    });

    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'henry.staff@example.com',
        password: 'Password123',
      })
      .expect(200);

    const { token } = response.body;
    expect(token).toBeTruthy();

    const decoded = verifyToken(token);
    expect(decoded).toBeTruthy();
    expect(decoded.userId).toBe(staff._id.toString());
    expect(decoded.schoolId).toBe(school._id.toString());
  });

  // ─── Multi-school isolation ───────────────────────────────────────────────

  it('staff from School A cannot see School B staff via the scoped staff list endpoint', async () => {
    const schoolA = await createSchoolRecord({ name: 'School Alpha', code: 'SCHOOL-ALPHA' });
    const schoolB = await createSchoolRecord({ name: 'School Beta', code: 'SCHOOL-BETA' });

    // A staff member that belongs exclusively to School B
    const staffB = await createStaffUser({
      name: 'Staff Beta',
      email: 'staff.beta@example.com',
      password: 'Password123',
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
      schoolId: schoolB._id,
    });

    // An admin for School A — their token carries schoolId = schoolA
    await createStaffUser({
      name: 'Admin Alpha',
      email: 'admin.alpha@example.com',
      password: 'Password123',
      staffRole: ['Admin'],
      permissionRole: 'admin',
      schoolId: schoolA._id,
    });

    const { app } = createTestApp();

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'admin.alpha@example.com',
        password: 'Password123',
        schoolCode: 'SCHOOL-ALPHA',
      })
      .expect(200);

    const { token } = loginResponse.body;
    expect(loginResponse.body.schoolId).toBe(schoolA._id.toString());

    // The GET /api/staff route scopes results by req.user.schoolId (School A).
    // School B's staff member must not appear in the response.
    const staffListResponse = await request(app)
      .get('/api/staff')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const returnedIds = staffListResponse.body.map((s) => (s.id || s._id)?.toString());
    expect(returnedIds).not.toContain(staffB._id.toString());
  });

  it('a staff token is scoped to its own school and cannot be forged to represent another school', async () => {
    const schoolA = await createSchoolRecord({ name: 'Maple School', code: 'MAPLE-SCH' });
    const schoolB = await createSchoolRecord({ name: 'Oak School', code: 'OAK-SCH' });

    await createStaffUser({
      name: 'Maple Teacher',
      email: 'maple.teacher@example.com',
      password: 'Password123',
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
      schoolId: schoolA._id,
    });

    const { app } = createTestApp();

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'maple.teacher@example.com',
        password: 'Password123',
        schoolCode: 'MAPLE-SCH',
      })
      .expect(200);

    const decoded = verifyToken(loginResponse.body.token);
    expect(decoded).toBeTruthy();

    // Token must carry School A's id, not School B's
    expect(decoded.schoolId).toBe(schoolA._id.toString());
    expect(decoded.schoolId).not.toBe(schoolB._id.toString());
  });

  // ─── Session lifecycle: sessionId must survive /session and /refresh ─────

  it('preserves sessionId across /auth/session and /auth/refresh for staff', async () => {
    const school = await createSchoolRecord({ name: 'SID School', code: 'SID-SCH' });
    await createStaffUser({
      name: 'Sid Staff',
      email: 'sid.staff@example.com',
      password: 'Password123',
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
      schoolId: school._id,
    });

    const { app } = createTestApp();
    const agent = request.agent(app);

    const loginRes = await agent
      .post('/api/auth/login')
      .set('X-Auth-Mode', 'cookie')
      .send({ email: 'sid.staff@example.com', password: 'Password123' })
      .expect(200);

    const loginDecoded = verifyToken(loginRes.body.token);
    const loginSessionId = loginDecoded.sessionId;
    expect(loginSessionId).toBeTruthy();

    // /session reissue must keep the same sessionId
    const sessionRes = await agent.get('/api/auth/session').expect(200);
    const sessionDecoded = verifyToken(sessionRes.body.token);
    expect(sessionDecoded.sessionId).toBe(loginSessionId);

    // /refresh reissue must keep the same sessionId
    const refreshRes = await agent.post('/api/auth/refresh').expect(200);
    const refreshDecoded = verifyToken(refreshRes.body.token);
    expect(refreshDecoded.sessionId).toBe(loginSessionId);

    // Refresh token itself must now carry the sessionId so future rotations work
    const refreshTokenDecoded = jwt.verify(
      refreshRes.body.refreshToken,
      process.env.JWT_REFRESH_SECRET
    );
    expect(refreshTokenDecoded.sessionId).toBe(loginSessionId);
  });

  it('revokes a staff session so /auth/refresh can no longer mint fresh tokens', async () => {
    const { Session } = await import('../models/Session.js').then((m) => ({ Session: m.default }));

    const school = await createSchoolRecord({ name: 'Revoke School', code: 'RVK-SCH' });
    await createStaffUser({
      name: 'Rev Staff',
      email: 'rev.staff@example.com',
      password: 'Password123',
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
      schoolId: school._id,
    });

    const { app } = createTestApp();
    const agent = request.agent(app);

    const loginRes = await agent
      .post('/api/auth/login')
      .set('X-Auth-Mode', 'cookie')
      .send({ email: 'rev.staff@example.com', password: 'Password123' })
      .expect(200);

    const { sessionId } = verifyToken(loginRes.body.token);

    // Simulate admin revoking this session (DELETE /auth/sessions/:id path)
    await Session.findOneAndUpdate(
      { sessionId },
      { $set: { isRevoked: true, revokedAt: new Date() } }
    );

    // The original access token should now be rejected on protected routes
    await agent.get('/api/auth/session').expect(401);

    // Refresh must also fail — the rotated token would otherwise bypass revocation
    await agent.post('/api/auth/refresh').expect(401);
  });

  it('super-admin login issues a sessionId and the session is revocable on /auth/refresh', async () => {
    const { Session } = await import('../models/Session.js').then((m) => ({ Session: m.default }));

    const { app } = createTestApp();
    const agent = request.agent(app);

    const loginRes = await agent
      .post('/api/auth/login')
      .set('X-Auth-Mode', 'cookie')
      .send({ email: 'superid@test.com', password: 'super12345' })
      .expect(200);

    const decoded = verifyToken(loginRes.body.token);
    expect(decoded.sessionId).toBeTruthy();
    expect(decoded.userType).toBe('super-admin');

    // A Session record must have been created with userType super-admin
    const sessionDoc = await Session.findOne({ sessionId: decoded.sessionId }).lean();
    expect(sessionDoc).toBeTruthy();
    expect(sessionDoc.userType).toBe('super-admin');

    // Revoke and verify refresh is blocked — before the fix, super-admin refresh
    // tokens were non-revocable for 30d
    await Session.findOneAndUpdate(
      { sessionId: decoded.sessionId },
      { $set: { isRevoked: true, revokedAt: new Date() } }
    );

    await agent.post('/api/auth/refresh').expect(401);
  });
});
