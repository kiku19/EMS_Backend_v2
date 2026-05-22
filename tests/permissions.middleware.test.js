import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import {
  buildPermissionsArray,
  determineRole,
  ensurePermissionDocument,
  checkPermission,
  requireAdmin,
  getUserPermissions,
} from '../middleware/auth/permissions.js';
import UserPermission, { PERMISSION_TEMPLATES } from '../models/UserPermission.js';
import { createStaffUser, createSchoolRecord } from './helpers/factories.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockRes() {
  const res = {
    _status: null,
    _json: null,
    status(code) {
      this._status = code;
      return this;
    },
    json(data) {
      this._json = data;
      return this;
    },
  };
  return res;
}

function mockReq(overrides = {}) {
  return {
    headers: {},
    t: (key, vars) => {
      if (vars) {
        return Object.entries(vars).reduce((str, [k, v]) => str.replace(`{{${k}}}`, v), key);
      }
      return key;
    },
    app: { locals: { Staff: globalThis.mongoose?.connection?.model?.('Staff') || {} } },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildPermissionsArray
// ---------------------------------------------------------------------------

describe('buildPermissionsArray', () => {
  it('converts a permissions object to an array of records', () => {
    const result = buildPermissionsArray({
      students: { view: true, create: false },
      staff: { view: true, create: true, edit: false, delete: false, publish: false },
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ module: 'students', view: true, create: false });
    expect(result[1]).toMatchObject({ module: 'staff', view: true, create: true });
  });

  it('returns an empty array for undefined input', () => {
    expect(buildPermissionsArray(undefined)).toEqual([]);
  });

  it('returns an empty array for empty object', () => {
    expect(buildPermissionsArray({})).toEqual([]);
  });

  it('coerces non-boolean values to boolean', () => {
    const result = buildPermissionsArray({
      students: { view: 1, create: null, edit: 'yes', delete: 0 },
    });

    expect(result[0].view).toBe(true);
    expect(result[0].create).toBe(false);
    expect(result[0].edit).toBe(true);
    expect(result[0].delete).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// determineRole
// ---------------------------------------------------------------------------

describe('determineRole', () => {
  it('maps single Admin role to admin', () => {
    expect(determineRole('Admin')).toBe('admin');
  });

  it('maps single Teacher role to teacher', () => {
    expect(determineRole('Teacher')).toBe('teacher');
  });

  it('maps array with highest canonical role to admin', () => {
    expect(determineRole(['Teacher', 'Admin'])).toBe('admin');
  });

  it('maps Accountant to accountant', () => {
    expect(determineRole('Accountant')).toBe('accountant');
  });

  it('maps Receptionist to receptionist', () => {
    expect(determineRole('Receptionist')).toBe('receptionist');
  });

  it('maps Principal to admin', () => {
    expect(determineRole('Principal')).toBe('admin');
  });

  it('maps Vice Principal to teacher', () => {
    expect(determineRole('Vice Principal')).toBe('teacher');
  });

  it('maps Librarian to teacher', () => {
    expect(determineRole('Librarian')).toBe('teacher');
  });

  it('maps unknown role to teacher (least privilege)', () => {
    expect(determineRole('Some Unknown Role')).toBe('teacher');
  });

  it('maps null role to teacher', () => {
    expect(determineRole(null)).toBe('teacher');
  });

  it('maps array of non-canonical roles to teacher', () => {
    expect(determineRole(['Foo', 'Bar'])).toBe('teacher');
  });

  it('maps array with accountant and teacher to accountant', () => {
    expect(determineRole(['Teacher', 'Accountant'])).toBe('accountant');
  });

  it('skips non-string entries in array', () => {
    expect(determineRole(['Teacher', 123, null])).toBe('teacher');
  });
});

// ---------------------------------------------------------------------------
// ensurePermissionDocument
// ---------------------------------------------------------------------------

describe('ensurePermissionDocument', () => {
  it('fills missing permissions from template', async () => {
    const school = await createSchoolRecord();
    const staff = await createStaffUser({
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    const userPermission = await UserPermission.create({
      schoolId: school._id,
      userId: staff._id,
      role: 'teacher',
      permissions: [
        {
          module: 'students',
          view: true,
          create: false,
          edit: false,
          delete: false,
          publish: false,
        },
      ],
    });

    await ensurePermissionDocument(userPermission, 'teacher');

    const updated = await UserPermission.findById(userPermission._id).lean();
    expect(updated.permissions.length).toBeGreaterThan(1);
    expect(updated.permissions.find((p) => p.module === 'staff')).toBeTruthy();
  });

  it('coerces non-boolean action values to boolean', async () => {
    const school = await createSchoolRecord();
    const staff = await createStaffUser({
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    const userPermission = await UserPermission.create({
      schoolId: school._id,
      userId: staff._id,
      role: 'teacher',
      permissions: [
        { module: 'students', view: 'yes', create: null, edit: 1, delete: 0, publish: undefined },
      ],
    });

    await ensurePermissionDocument(userPermission, 'teacher');

    const updated = await UserPermission.findById(userPermission._id).lean();
    const studentsPerm = updated.permissions.find((p) => p.module === 'students');
    expect(typeof studentsPerm.view).toBe('boolean');
    expect(typeof studentsPerm.create).toBe('boolean');
    expect(typeof studentsPerm.edit).toBe('boolean');
    expect(typeof studentsPerm.delete).toBe('boolean');
    expect(typeof studentsPerm.publish).toBe('boolean');
  });

  it('sets role if missing', async () => {
    const school = await createSchoolRecord();
    const staff = await createStaffUser({
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    // Create a valid document then manually unset the role to simulate corruption
    let userPermission = await UserPermission.create({
      schoolId: school._id,
      userId: staff._id,
      role: 'teacher',
      permissions: [],
    });
    await UserPermission.updateOne({ _id: userPermission._id }, { $unset: { role: 1 } });
    userPermission = await UserPermission.findById(userPermission._id);

    await ensurePermissionDocument(userPermission, 'teacher');

    const updated = await UserPermission.findById(userPermission._id).lean();
    expect(updated.role).toBe('teacher');
  });

  it('initializes permissions array if missing', async () => {
    const school = await createSchoolRecord();
    const staff = await createStaffUser({
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    let userPermission = await UserPermission.create({
      schoolId: school._id,
      userId: staff._id,
      role: 'teacher',
    });

    // Remove permissions array manually
    await UserPermission.updateOne({ _id: userPermission._id }, { $unset: { permissions: 1 } });
    userPermission = await UserPermission.findById(userPermission._id);

    await ensurePermissionDocument(userPermission, 'teacher');

    const updated = await UserPermission.findById(userPermission._id).lean();
    expect(Array.isArray(updated.permissions)).toBe(true);
    expect(updated.permissions.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// checkPermission middleware
// ---------------------------------------------------------------------------

describe('checkPermission middleware', () => {
  it('bypasses for super-admin user', async () => {
    const req = mockReq({
      user: { id: 'super-admin', userType: 'super-admin', role: ['Super Admin'] },
    });
    const res = mockRes();
    const next = vi.fn();

    await checkPermission('students', 'view')(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('returns 401 when req.user is missing', async () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await checkPermission('students', 'view')(req, res, next);

    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when user id is missing', async () => {
    const req = mockReq({ user: { schoolId: 'some-school' } });
    const res = mockRes();
    const next = vi.fn();

    await checkPermission('students', 'view')(req, res, next);

    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when schoolId is missing', async () => {
    const req = mockReq({ user: { id: 'user-id' } });
    const res = mockRes();
    const next = vi.fn();

    await checkPermission('students', 'view')(req, res, next);

    expect(res._status).toBe(403);
    expect(res._json.hasPermission).toBe(false);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 404 when user has no UserPermission and no Staff record', async () => {
    const req = mockReq({
      user: {
        id: new mongoose.Types.ObjectId().toString(),
        schoolId: new mongoose.Types.ObjectId().toString(),
      },
      app: { locals: { Staff: mongoose.model('Staff') } },
    });
    const res = mockRes();
    const next = vi.fn();

    await checkPermission('students', 'view')(req, res, next);

    expect(res._status).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('auto-creates UserPermission from Staff role when missing', async () => {
    const school = await createSchoolRecord();
    const staff = await createStaffUser({
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    // Remove auto-created UserPermission
    await UserPermission.deleteOne({ userId: staff._id });

    const req = mockReq({
      user: { id: staff._id.toString(), schoolId: school._id.toString() },
      app: { locals: { Staff: mongoose.model('Staff') } },
    });
    const res = mockRes();
    const next = vi.fn();

    await checkPermission('students', 'view')(req, res, next);

    expect(next).toHaveBeenCalled();

    const created = await UserPermission.findOne({ userId: staff._id, schoolId: school._id });
    expect(created).toBeTruthy();
    expect(created.role).toBe('teacher');
  });

  it('calls next() when user has permission for the action', async () => {
    const school = await createSchoolRecord();
    const staff = await createStaffUser({
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    const req = mockReq({
      user: { id: staff._id.toString(), schoolId: school._id.toString() },
      app: { locals: { Staff: mongoose.model('Staff') } },
    });
    const res = mockRes();
    const next = vi.fn();

    await checkPermission('students', 'view')(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.userPermissions).toBeDefined();
  });

  it('returns 403 when user lacks the specific action', async () => {
    const school = await createSchoolRecord();
    const staff = await createStaffUser({
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    const req = mockReq({
      user: { id: staff._id.toString(), schoolId: school._id.toString() },
      app: { locals: { Staff: mongoose.model('Staff') } },
    });
    const res = mockRes();
    const next = vi.fn();

    // Teachers cannot delete students in the default template
    await checkPermission('students', 'delete')(req, res, next);

    expect(res._status).toBe(403);
    expect(res._json.hasPermission).toBe(false);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when module is not in permissions and user is not admin', async () => {
    const school = await createSchoolRecord();
    const staff = await createStaffUser({
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    // Manually set permissions to only have 'students' module
    await UserPermission.updateOne(
      { userId: staff._id, schoolId: school._id },
      {
        $set: {
          permissions: [
            {
              module: 'students',
              view: true,
              create: false,
              edit: false,
              delete: false,
              publish: false,
            },
          ],
        },
      }
    );

    const req = mockReq({
      user: { id: staff._id.toString(), schoolId: school._id.toString() },
      app: { locals: { Staff: mongoose.model('Staff') } },
    });
    const res = mockRes();
    const next = vi.fn();

    await checkPermission('settings', 'view')(req, res, next);

    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows admin access to modules not explicitly in permissions', async () => {
    const school = await createSchoolRecord();
    const staff = await createStaffUser({
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });

    // Remove all permissions except one
    await UserPermission.updateOne(
      { userId: staff._id, schoolId: school._id },
      {
        $set: {
          permissions: [
            {
              module: 'students',
              view: true,
              create: true,
              edit: true,
              delete: true,
              publish: true,
            },
          ],
        },
      }
    );

    const req = mockReq({
      user: { id: staff._id.toString(), schoolId: school._id.toString() },
      app: { locals: { Staff: mongoose.model('Staff') } },
    });
    const res = mockRes();
    const next = vi.fn();

    // Admin should be allowed even for modules not in their permissions array
    await checkPermission('some-new-module', 'view')(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.userPermissions).toBeDefined();
  });

  it('calls ensurePermissionDocument when UserPermission exists', async () => {
    const school = await createSchoolRecord();
    const staff = await createStaffUser({
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    // Corrupt the permission document
    await UserPermission.updateOne(
      { userId: staff._id, schoolId: school._id },
      { $set: { 'permissions.0.edit': null } }
    );

    const req = mockReq({
      user: { id: staff._id.toString(), schoolId: school._id.toString() },
      app: { locals: { Staff: mongoose.model('Staff') } },
    });
    const res = mockRes();
    const next = vi.fn();

    await checkPermission('students', 'view')(req, res, next);

    expect(next).toHaveBeenCalled();

    // ensurePermissionDocument should have fixed the null value
    const updated = await UserPermission.findOne({
      userId: staff._id,
      schoolId: school._id,
    }).lean();
    const studentsPerm = updated.permissions.find((p) => p.module === 'students');
    expect(typeof studentsPerm.edit).toBe('boolean');
  });

  it('returns 500 on unexpected error', async () => {
    const req = mockReq({
      user: { id: 'invalid', schoolId: 'invalid' },
      app: { locals: { Staff: null } },
    });
    const res = mockRes();
    const next = vi.fn();

    await checkPermission('students', 'view')(req, res, next);

    expect(res._status).toBe(500);
    expect(next).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// requireAdmin middleware
// ---------------------------------------------------------------------------

describe('requireAdmin middleware', () => {
  it('bypasses for super-admin user', async () => {
    const req = mockReq({
      user: { id: 'super-admin', userType: 'super-admin', role: ['Super Admin'] },
    });
    const res = mockRes();
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('returns 401 when req.user is missing', async () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when schoolId is missing', async () => {
    const req = mockReq({ user: { id: 'user-id' } });
    const res = mockRes();
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when user has no UserPermission record', async () => {
    const req = mockReq({
      user: {
        id: new mongoose.Types.ObjectId().toString(),
        schoolId: new mongoose.Types.ObjectId().toString(),
      },
    });
    const res = mockRes();
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when user permission role is not admin', async () => {
    const school = await createSchoolRecord();
    const staff = await createStaffUser({
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    const req = mockReq({
      user: { id: staff._id.toString(), schoolId: school._id.toString() },
    });
    const res = mockRes();
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when user has admin role in UserPermission', async () => {
    const school = await createSchoolRecord();
    const staff = await createStaffUser({
      schoolId: school._id,
      staffRole: ['Admin'],
      permissionRole: 'admin',
    });

    const req = mockReq({
      user: { id: staff._id.toString(), schoolId: school._id.toString() },
    });
    const res = mockRes();
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('returns 500 on unexpected error', async () => {
    const req = mockReq({
      user: { id: 'invalid', schoolId: 'invalid' },
    });
    const res = mockRes();
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(res._status).toBe(500);
    expect(next).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getUserPermissions middleware
// ---------------------------------------------------------------------------

describe('getUserPermissions middleware', () => {
  it('attaches userPermissions when found', async () => {
    const school = await createSchoolRecord();
    const staff = await createStaffUser({
      schoolId: school._id,
      staffRole: ['Teacher'],
      permissionRole: 'teacher',
    });

    const req = mockReq({
      user: { id: staff._id.toString(), schoolId: school._id.toString() },
    });
    const res = mockRes();
    const next = vi.fn();

    await getUserPermissions(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.userPermissions).toBeDefined();
    expect(req.userPermissions.userId.toString()).toBe(staff._id.toString());
  });

  it('calls next() without setting userPermissions when not found', async () => {
    const req = mockReq({
      user: {
        id: new mongoose.Types.ObjectId().toString(),
        schoolId: new mongoose.Types.ObjectId().toString(),
      },
    });
    const res = mockRes();
    const next = vi.fn();

    await getUserPermissions(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.userPermissions).toBeNull();
  });

  it('calls next() without userId/schoolId', async () => {
    const req = mockReq({ user: {} });
    const res = mockRes();
    const next = vi.fn();

    await getUserPermissions(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.userPermissions).toBeUndefined();
  });

  it('calls next() on error without crashing', async () => {
    const req = mockReq({ user: { id: 'invalid', schoolId: 'invalid' } });
    const res = mockRes();
    const next = vi.fn();

    await getUserPermissions(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.userPermissions).toBeUndefined();
  });
});
