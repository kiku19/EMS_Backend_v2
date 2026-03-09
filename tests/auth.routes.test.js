import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from './helpers/testApp.js';
import { createClassRecord, createSchoolRecord, createStaffUser } from './helpers/factories.js';

describe('auth routes', () => {
  it('logs in with a cookie session and restores the current session', async () => {
    const school = await createSchoolRecord({
      name: 'North Campus',
      code: 'NORTH-CAMPUS',
      isDefault: true,
    });

    const teacher = await createStaffUser({
      name: 'Alice Teacher',
      email: 'alice.teacher@example.com',
      password: 'password123',
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
        password: 'password123',
      })
      .expect(200);

    expect(loginResponse.body).toMatchObject({
      id: teacher._id.toString(),
      name: 'Alice Teacher',
      schoolId: school._id.toString(),
      school: expect.objectContaining({
        code: 'NORTH-CAMPUS',
      }),
      token: expect.any(String),
    });
    expect(loginResponse.headers['set-cookie']).toBeTruthy();

    const sessionResponse = await agent
      .get('/api/auth/session')
      .expect(200);

    expect(sessionResponse.body).toMatchObject({
      id: teacher._id.toString(),
      name: 'Alice Teacher',
      schoolId: school._id.toString(),
      school: expect.objectContaining({
        code: 'NORTH-CAMPUS',
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
      password: 'password123',
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
      password: 'password123',
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
      schoolId: northSchool._id,
    });

    await createStaffUser({
      name: 'Alex South',
      email: 'alex@example.com',
      password: 'password123',
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
      schoolId: southSchool._id,
    });

    const { app } = createTestApp();

    const ambiguousResponse = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'alex@example.com',
        password: 'password123',
      })
      .expect(409);

    expect(ambiguousResponse.body.error).toBe(
      'Multiple accounts matched the provided credentials. Please provide a school identifier.'
    );

    const resolvedResponse = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'alex@example.com',
        password: 'password123',
        schoolCode: 'SOUTH',
      })
      .expect(200);

    expect(resolvedResponse.body).toMatchObject({
      name: 'Alex South',
      schoolId: southSchool._id.toString(),
      school: expect.objectContaining({
        code: 'SOUTH',
      }),
      token: expect.any(String),
    });
  });
});
