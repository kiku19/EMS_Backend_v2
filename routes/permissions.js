import express from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { PERMISSION_MODULES } from '../constants/permissionModules.js';
import UserPermission, { PERMISSION_TEMPLATES } from '../models/UserPermission.js';
import PermissionRequest from '../models/PermissionRequest.js';
import CustomRole from '../models/CustomRole.js';
import { Staff } from '../database.js';
import {
  buildPermissionsArray,
  determineRole,
  ensurePermissionDocument,
} from '../middleware/permissions.js';
import { sanitizeQueryStr, sanitizeQueryId } from '../middleware/validation.js';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/auth/permissions.js';
import AuditTrail from '../models/AuditTrail.js';
import { buildSchoolScopedQuery } from '../utils/schoolContext.js';
import School from '../models/School.js';
import { resolveEnabledModules } from '../config/moduleRegistry.js';

// Fire-and-forget audit entry
function logPermissionAuditEvent({ schoolId, actorId, action, entityId, newValue, req }) {
  if (!schoolId || !actorId) return;
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || null;
  AuditTrail.create({
    schoolId,
    userId: actorId,
    action,
    entity: 'permission',
    entityId: entityId?.toString() || null,
    method: req.method,
    path: req.path,
    newValue,
    ipAddress: ip,
    userAgent: req.headers['user-agent'] || null,
  }).catch(() => {});
}

const router = express.Router();
router.use(authenticate);

const schoolQuery = (req, extra = {}) => buildSchoolScopedQuery(req.user?.schoolId, extra);

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const modulePermissionSchema = z.object({
  module: z.enum(PERMISSION_MODULES),
  view: z.boolean().default(false),
  create: z.boolean().default(false),
  edit: z.boolean().default(false),
  delete: z.boolean().default(false),
  publish: z.boolean().default(false),
  approve: z.boolean().default(false),
});

const customRoleCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  description: z.string().trim().max(300).optional().default(''),
  permissions: z.array(modulePermissionSchema).default([]),
  locked: z.record(z.record(z.boolean())).optional().default({}),
});

const customRoleUpdateSchema = customRoleCreateSchema.partial();

// Matches UserPermission.role enum. 'custom' lets admins flip customPermissions
// true without forcing a template role.
const userPermissionUpdateSchema = z.object({
  role: z.enum(['admin', 'teacher', 'accountant', 'receptionist', 'custom']),
  permissions: z.array(modulePermissionSchema),
  customPermissions: z.boolean().optional().default(false),
  // Optional reference to a CustomRole. When set, checkPermission merges the
  // custom role's permission list into the user's effective permissions —
  // without this the entire "Roles & Access" tab was dead data (admins could
  // create/edit custom roles but they had zero effect on what users could do).
  customRoleId: z
    .string()
    .refine((v) => mongoose.isValidObjectId(v), { message: 'Invalid customRoleId' })
    .optional()
    .nullable(),
});

// Get current user's own permissions (no IDOR risk — userId from auth token)
router.get('/me', async (req, res) => {
  try {
    const userId = req.user.id;
    const sid = req.user.schoolId;

    let userPermission = await UserPermission.findOne(schoolQuery(req, { userId }));

    if (!userPermission) {
      const user = await Staff.findOne(schoolQuery(req, { _id: userId }));
      if (!user) {
        return res.status(404).json({ error: req.t('common:routes.userNotFound') });
      }

      const role = determineRole(user.role);
      const defaultPermissions = PERMISSION_TEMPLATES[role] || PERMISSION_TEMPLATES.teacher;

      userPermission = await UserPermission.findOneAndUpdate(
        schoolQuery(req, { userId }),
        {
          schoolId: sid,
          userId,
          role,
          permissions: buildPermissionsArray(defaultPermissions),
          customPermissions: false,
        },
        { upsert: true, new: true }
      );
    } else {
      await ensurePermissionDocument(userPermission, userPermission.role);
    }

    // Include the school's effective enabled-module set so the dashboard can
    // gate nav + routes from the same payload it already fetches on load.
    const school = await School.findById(sid).select('enabledModules').lean();
    const { enabled } = resolveEnabledModules(school?.enabledModules);

    res.json({
      ...userPermission.toObject(),
      enabledModules: [...enabled],
    });
  } catch (error) {
    console.error('Error fetching user permissions:', error);
    res.status(500).json({ error: req.t('common:routes.failedToFetchPermissions') });
  }
});

// Get user's permissions (admin or self only)
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const sid = req.user.schoolId;

    // IDOR guard: only allow fetching own permissions or if requester is admin
    if (userId !== req.user.id) {
      const requesterPermission = await UserPermission.findOne(
        schoolQuery(req, { userId: req.user.id })
      );
      if (!requesterPermission || requesterPermission.role !== 'admin') {
        return res.status(403).json({ error: req.t('common:routes.adminAccessRequired') });
      }
    }

    let userPermission = await UserPermission.findOne(schoolQuery(req, { userId }));

    if (!userPermission) {
      const user = await Staff.findOne(schoolQuery(req, { _id: userId }));
      if (!user) {
        return res.status(404).json({ error: req.t('common:routes.userNotFound') });
      }

      const role = determineRole(user.role);
      const defaultPermissions = PERMISSION_TEMPLATES[role] || PERMISSION_TEMPLATES.teacher;

      userPermission = await UserPermission.findOneAndUpdate(
        schoolQuery(req, { userId }),
        {
          schoolId: sid,
          userId,
          role,
          permissions: buildPermissionsArray(defaultPermissions),
          customPermissions: false,
        },
        { upsert: true, new: true }
      );
    } else {
      await ensurePermissionDocument(userPermission, userPermission.role);
    }

    res.json(userPermission);
  } catch (error) {
    console.error('Error fetching user permissions:', error);
    res.status(500).json({ error: req.t('common:routes.failedToFetchPermissions') });
  }
});

// Update user permissions (admin only)
router.put('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const adminId = req.user.id;
    const sid = req.user.schoolId;

    // Validate body BEFORE any DB work — unchecked role/permissions would let an
    // admin bypass PERMISSION_TEMPLATES by submitting arbitrary shapes.
    const parsed = userPermissionUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation Error',
        details: parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    const { permissions, role, customPermissions, customRoleId } = parsed.data;

    // Verify admin
    const adminPermission = await UserPermission.findOne(schoolQuery(req, { userId: adminId }));
    if (!adminPermission || adminPermission.role !== 'admin') {
      return res.status(403).json({ error: req.t('common:routes.adminAccessRequired') });
    }

    // Tenant-isolation guard: the target userId MUST belong to the admin's
    // school. Without this, an admin in School A can upsert a NEW
    // UserPermission row for a School B userId (previous behaviour), poisoning
    // {userId}-only lookups and letting an attacker escalate across tenants.
    const targetStaff = await Staff.findOne(schoolQuery(req, { _id: userId })).lean();
    if (!targetStaff) {
      return res.status(404).json({ error: req.t('common:routes.userNotFound') });
    }

    // Validate the custom role belongs to this school before linking it —
    // otherwise an admin could point customRoleId at another tenant's role and
    // pull its permission list into their school.
    const resolvedCustomRoleId = customRoleId;
    if (customRoleId) {
      const roleExists = await CustomRole.findOne(schoolQuery(req, { _id: customRoleId }))
        .select('_id')
        .lean();
      if (!roleExists) {
        return res.status(404).json({ error: req.t('common:routes.roleNotFound') });
      }
    }
    // Clear the link when an explicit null is sent (un-assign a custom role).
    const updateDoc = {
      schoolId: sid,
      permissions,
      role,
      customPermissions,
      lastUpdated: new Date(),
      updatedBy: adminId,
    };
    if (resolvedCustomRoleId !== undefined) {
      updateDoc.customRoleId = resolvedCustomRoleId || null;
    }

    const updated = await UserPermission.findOneAndUpdate(schoolQuery(req, { userId }), updateDoc, {
      new: true,
      upsert: true,
    });

    logPermissionAuditEvent({
      schoolId: req.user.schoolId,
      actorId: adminId,
      action: 'role_changed',
      entityId: userId,
      newValue: { role, customPermissions, customRoleId: resolvedCustomRoleId ?? null },
      req,
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating permissions:', error);
    res.status(500).json({ error: req.t('common:routes.failedToUpdatePermissions') });
  }
});

// Create permission request
router.post('/request', async (req, res) => {
  try {
    const { module, permissions, reason } = req.body;

    if (!module || !permissions || !reason) {
      return res.status(400).json({ error: req.t('common:routes.missingRequiredFields') });
    }

    // Identity MUST come from the authenticated session, not the request body —
    // otherwise an authenticated user could file a permission request
    // impersonating any other user in the school (or attach a userId that
    // doesn't belong to the school at all), poisoning the audit trail.
    const userId = req.user.id || req.user.userId;

    if (!userId) {
      return res.status(401).json({ error: req.t('common:errors.unauthorized') });
    }

    // The JWT only carries { userId, role, schoolId, userType } — name/email
    // are NOT on the token, so look the Staff record up (school-scoped) to get
    // a trustworthy display name + email for the request record.
    let userName = req.user.name || '';
    let userEmail = req.user.email || '';
    if (!userName) {
      const requester = await Staff.findOne(schoolQuery(req, { _id: userId }))
        .select('name email')
        .lean();
      if (!requester) {
        return res.status(404).json({ error: req.t('common:routes.userNotFound') });
      }
      userName = requester.name || '';
      userEmail = requester.email || '';
    }

    // Check if there's already a pending request for this user and module
    const existingRequest = await PermissionRequest.findOne(
      schoolQuery(req, { userId, module, status: 'pending' })
    );

    if (existingRequest) {
      return res.status(400).json({
        error: req.t('common:routes.aPendingRequestAlreadyExistsForThisModule'),
        existingRequest,
      });
    }

    const request = await PermissionRequest.create({
      schoolId: req.user.schoolId,
      userId,
      userName,
      userEmail,
      module,
      permissions,
      reason,
      status: 'pending',
    });

    // Emit socket event to notify admins
    if (req.app.locals.io) {
      req.app.locals.io.emit('permission_request_created', {
        requestId: request._id,
        userId,
        userName,
        module,
        permissions,
      });
    }

    res.status(201).json(request);
  } catch (error) {
    console.error('Error creating permission request:', error);
    res.status(500).json({ error: req.t('common:routes.failedToCreatePermissionRequest') });
  }
});

// Get all permission requests (admin only)
router.get('/requests', async (req, res) => {
  try {
    const status = sanitizeQueryStr(req.query.status);
    const userId = sanitizeQueryId(req.query.userId);

    // Verify admin
    const adminPermission = await UserPermission.findOne(schoolQuery(req, { userId: req.user.id }));
    if (!adminPermission || adminPermission.role !== 'admin') {
      return res.status(403).json({ error: req.t('common:routes.adminAccessRequired') });
    }

    const filter = {};
    if (status) filter.status = status;
    if (userId) filter.userId = userId;

    const requests = await PermissionRequest.find(schoolQuery(req, filter))
      .sort({ requestedAt: -1 })
      .limit(100);

    res.json(requests);
  } catch (error) {
    console.error('Error fetching permission requests:', error);
    res.status(500).json({ error: req.t('common:routes.failedToFetchPermissionRequests') });
  }
});

// Get pending requests count (admin only)
router.get('/requests/count/pending', async (req, res) => {
  try {
    // Verify admin
    const adminPermission = await UserPermission.findOne(schoolQuery(req, { userId: req.user.id }));
    if (!adminPermission || adminPermission.role !== 'admin') {
      return res.status(403).json({ error: req.t('common:routes.adminAccessRequired') });
    }

    const count = await PermissionRequest.countDocuments(schoolQuery(req, { status: 'pending' }));
    res.json({ count });
  } catch (error) {
    console.error('Error counting pending requests:', error);
    res.status(500).json({ error: req.t('common:routes.failedToCountPendingRequests') });
  }
});

// Approve/Reject permission request (admin only)
router.put('/requests/:requestId', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { status, reviewNotes } = req.body;
    const adminId = req.user.id;
    const adminName = req.user.name || 'Admin';
    const sid = req.user.schoolId;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: req.t('common:routes.invalidStatus') });
    }

    // Verify admin
    const adminPermission = await UserPermission.findOne(schoolQuery(req, { userId: adminId }));
    if (!adminPermission || adminPermission.role !== 'admin') {
      return res.status(403).json({ error: req.t('common:routes.adminAccessRequired') });
    }

    const request = await PermissionRequest.findOne(schoolQuery(req, { _id: requestId }));
    if (!request) {
      return res.status(404).json({ error: req.t('common:routes.requestNotFound') });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ error: req.t('common:routes.requestHasAlreadyBeenReviewed') });
    }

    // Update request status
    request.status = status;
    request.reviewedAt = new Date();
    request.reviewedBy = adminId;
    request.reviewerName = adminName;
    request.reviewNotes = reviewNotes;
    await request.save();

    // If approved, update user permissions
    if (status === 'approved') {
      let userPermission = await UserPermission.findOne(
        schoolQuery(req, { userId: request.userId })
      );

      if (!userPermission) {
        const user = await Staff.findOne(schoolQuery(req, { _id: request.userId }));
        const role = determineRole(user.role);
        const defaultPermissions = PERMISSION_TEMPLATES[role] || PERMISSION_TEMPLATES.teacher;

        userPermission = await UserPermission.findOneAndUpdate(
          schoolQuery(req, { userId: request.userId }),
          {
            schoolId: sid,
            userId: request.userId,
            role,
            permissions: buildPermissionsArray(defaultPermissions),
            customPermissions: false,
          },
          { upsert: true, new: true }
        );
      } else {
        await ensurePermissionDocument(userPermission, userPermission.role);
      }

      // Update the specific module permissions
      const moduleIndex = userPermission.permissions.findIndex((p) => p.module === request.module);

      if (moduleIndex >= 0) {
        // Update existing module permissions
        request.permissions.forEach((perm) => {
          userPermission.permissions[moduleIndex][perm] = true;
        });
      } else {
        // Add new module permissions
        const newModulePermission = {
          module: request.module,
          view: false,
          create: false,
          edit: false,
          delete: false,
          publish: false,
        };
        request.permissions.forEach((perm) => {
          newModulePermission[perm] = true;
        });
        userPermission.permissions.push(newModulePermission);
      }

      userPermission.customPermissions = true;
      userPermission.lastUpdated = new Date();
      userPermission.updatedBy = adminId;
      await userPermission.save();
    }

    logPermissionAuditEvent({
      schoolId: req.user.schoolId,
      actorId: adminId,
      action: 'permission_changed',
      entityId: request.userId,
      newValue: { requestId: request._id.toString(), module: request.module, status },
      req,
    });

    // Emit socket event to notify user
    if (req.app.locals.io) {
      req.app.locals.io.emit('permission_request_reviewed', {
        requestId: request._id,
        userId: request.userId,
        module: request.module,
        status,
        reviewerName: adminName,
      });
    }

    res.json(request);
  } catch (error) {
    console.error('Error reviewing permission request:', error);
    res.status(500).json({ error: req.t('common:routes.failedToReviewPermissionRequest') });
  }
});

// Get user's permission requests (admin or self only)
router.get('/user/:userId/requests', async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.query;

    // IDOR guard: only allow fetching own requests or if requester is admin
    if (userId !== req.user.id) {
      const requesterPermission = await UserPermission.findOne(
        schoolQuery(req, { userId: req.user.id })
      );
      if (!requesterPermission || requesterPermission.role !== 'admin') {
        return res.status(403).json({ error: req.t('common:routes.adminAccessRequired') });
      }
    }

    const filter = { userId };
    if (status) filter.status = status;

    const requests = await PermissionRequest.find(schoolQuery(req, filter))
      .sort({ requestedAt: -1 })
      .limit(50);

    res.json(requests);
  } catch (error) {
    console.error('Error fetching user requests:', error);
    res.status(500).json({ error: req.t('common:routes.failedToFetchUserRequests') });
  }
});

// ─── Custom Roles CRUD ────────────────────────────────────────────────────────

// List all custom roles for the school
router.get('/custom-roles', async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const roles = await CustomRole.find({ schoolId }).sort({ createdAt: 1 }).lean();

    // Aggregate assigned-user counts per role in one query
    const counts = await UserPermission.aggregate([
      { $match: { schoolId, customRoleId: { $exists: true, $ne: null } } },
      { $group: { _id: '$customRoleId', count: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(counts.map((c) => [String(c._id), c.count]));

    const rolesWithCounts = roles.map((r) => ({
      ...r,
      userCount: countMap[String(r._id)] || 0,
    }));

    res.json(rolesWithCounts);
  } catch (error) {
    console.error('Error fetching custom roles:', error);
    res.status(500).json({ error: req.t('common:routes.failedToFetchCustomRoles') });
  }
});

// Create a custom role
router.post('/custom-roles', requireAdmin, async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const parsed = customRoleCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: req.t('common:routes.validationFailed'), details: parsed.error.errors });
    }

    const { name, description, permissions, locked } = parsed.data;

    const existing = await CustomRole.findOne({
      schoolId,
      name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    });
    if (existing) {
      return res.status(400).json({ error: req.t('common:routes.aRoleWithThisNameAlreadyExists') });
    }

    const role = await CustomRole.create({
      schoolId,
      name,
      description,
      permissions,
      locked,
      createdBy: req.user.id,
    });

    res.status(201).json(role);
  } catch (error) {
    console.error('Error creating custom role:', error);
    res.status(500).json({ error: req.t('common:routes.failedToCreateCustomRole') });
  }
});

// Update a custom role
router.put('/custom-roles/:id', requireAdmin, async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const { id } = req.params;

    const parsed = customRoleUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: req.t('common:routes.validationFailed'), details: parsed.error.errors });
    }

    const role = await CustomRole.findOne({ _id: id, schoolId });
    if (!role) {
      return res.status(404).json({ error: req.t('common:routes.roleNotFound') });
    }

    if (role.isSystem) {
      return res.status(403).json({ error: req.t('common:routes.systemRolesCannotBeModified') });
    }

    const { name, description, permissions, locked } = parsed.data;

    if (name && name !== role.name) {
      const existing = await CustomRole.findOne({
        schoolId,
        name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        _id: { $ne: id },
      });
      if (existing) {
        return res
          .status(400)
          .json({ error: req.t('common:routes.aRoleWithThisNameAlreadyExists') });
      }
    }

    if (name !== undefined) role.name = name;
    if (description !== undefined) role.description = description;
    if (permissions !== undefined) role.permissions = permissions;
    if (locked !== undefined) role.locked = locked;
    await role.save();

    res.json(role);
  } catch (error) {
    console.error('Error updating custom role:', error);
    res.status(500).json({ error: req.t('common:routes.failedToUpdateCustomRole') });
  }
});

// Delete a custom role
router.delete('/custom-roles/:id', requireAdmin, async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const { id } = req.params;

    const role = await CustomRole.findOne({ _id: id, schoolId });
    if (!role) {
      return res.status(404).json({ error: req.t('common:routes.roleNotFound') });
    }

    if (role.isSystem) {
      return res.status(403).json({ error: req.t('common:routes.systemRolesCannotBeDeleted') });
    }

    // Check if any users are assigned to this custom role
    const assignedUsers = await UserPermission.countDocuments({
      schoolId,
      customRoleId: id,
    });
    if (assignedUsers > 0) {
      return res.status(400).json({
        error: `Cannot delete role "${role.name}". ${assignedUsers} user(s) are currently assigned to it. Please reassign them first.`,
      });
    }

    await role.deleteOne();
    res.json({ message: req.t('common:routes.roleDeletedSuccessfully') });
  } catch (error) {
    console.error('Error deleting custom role:', error);
    res.status(500).json({ error: req.t('common:routes.failedToDeleteCustomRole') });
  }
});

export default router;
