import express from 'express';
import { z } from 'zod';
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
import AuditTrail from '../models/AuditTrail.js';

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

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const modulePermissionSchema = z.object({
  module: z.enum([
    'dashboard',
    'staff',
    'students',
    'classes',
    'academics',
    'attendance',
    'timetable',
    'fees',
    'payroll',
    'messaging',
    'reports',
    'settings',
    'front-desk',
    'intake-forms',
    'communication',
  ]),
  view: z.boolean().default(false),
  create: z.boolean().default(false),
  edit: z.boolean().default(false),
  delete: z.boolean().default(false),
  publish: z.boolean().default(false),
});

const customRoleCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  description: z.string().trim().max(300).optional().default(''),
  permissions: z.array(modulePermissionSchema).default([]),
  locked: z.record(z.record(z.boolean())).optional().default({}),
});

const customRoleUpdateSchema = customRoleCreateSchema.partial();

// Get user's permissions
router.get('/user/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;

    let userPermission = await UserPermission.findOne({ userId });

    if (!userPermission) {
      const user = await Staff.findById(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const role = determineRole(user.role);
      const defaultPermissions = PERMISSION_TEMPLATES[role] || PERMISSION_TEMPLATES.teacher;

      userPermission = await UserPermission.findOneAndUpdate(
        { userId },
        {
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
    res.status(500).json({ error: 'Failed to fetch permissions' });
  }
});

// Update user permissions (admin only)
router.put('/user/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const { permissions, role, customPermissions } = req.body;
    const adminId = req.user._id;

    // Verify admin
    const adminPermission = await UserPermission.findOne({ userId: adminId });
    if (!adminPermission || adminPermission.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const updated = await UserPermission.findOneAndUpdate(
      { userId },
      {
        permissions,
        role,
        customPermissions,
        lastUpdated: new Date(),
        updatedBy: adminId,
      },
      { new: true, upsert: true }
    );

    logPermissionAuditEvent({
      schoolId: req.user.schoolId,
      actorId: adminId,
      action: 'role_changed',
      entityId: userId,
      newValue: { role, customPermissions },
      req,
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating permissions:', error);
    res.status(500).json({ error: 'Failed to update permissions' });
  }
});

// Create permission request
router.post('/request', authenticate, async (req, res) => {
  try {
    const { userId, userName, userEmail, module, permissions, reason } = req.body;

    if (!userId || !userName || !module || !permissions || !reason) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if there's already a pending request for this user and module
    const existingRequest = await PermissionRequest.findOne({
      userId,
      module,
      status: 'pending',
    });

    if (existingRequest) {
      return res.status(400).json({
        error: 'A pending request already exists for this module',
        existingRequest,
      });
    }

    const request = await PermissionRequest.create({
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
    res.status(500).json({ error: 'Failed to create permission request' });
  }
});

// Get all permission requests (admin only)
router.get('/requests', authenticate, async (req, res) => {
  try {
    const status = sanitizeQueryStr(req.query.status);
    const userId = sanitizeQueryId(req.query.userId);

    // Verify admin
    const adminPermission = await UserPermission.findOne({ userId: req.user._id });
    if (!adminPermission || adminPermission.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const query = {};
    if (status) query.status = status;
    if (userId) query.userId = userId;

    const requests = await PermissionRequest.find(query).sort({ requestedAt: -1 }).limit(100);

    res.json(requests);
  } catch (error) {
    console.error('Error fetching permission requests:', error);
    res.status(500).json({ error: 'Failed to fetch permission requests' });
  }
});

// Get pending requests count (admin only)
router.get('/requests/count/pending', authenticate, async (req, res) => {
  try {
    // Verify admin
    const adminPermission = await UserPermission.findOne({ userId: req.user._id });
    if (!adminPermission || adminPermission.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const count = await PermissionRequest.countDocuments({ status: 'pending' });
    res.json({ count });
  } catch (error) {
    console.error('Error counting pending requests:', error);
    res.status(500).json({ error: 'Failed to count pending requests' });
  }
});

// Approve/Reject permission request (admin only)
router.put('/requests/:requestId', authenticate, async (req, res) => {
  try {
    const { requestId } = req.params;
    const { status, reviewNotes } = req.body;
    const adminId = req.user._id;
    const adminName = req.user.name || 'Admin';

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Verify admin
    const adminPermission = await UserPermission.findOne({ userId: adminId });
    if (!adminPermission || adminPermission.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const request = await PermissionRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Request has already been reviewed' });
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
      let userPermission = await UserPermission.findOne({ userId: request.userId });

      if (!userPermission) {
        const user = await Staff.findById(request.userId);
        const role = determineRole(user.role);
        const defaultPermissions = PERMISSION_TEMPLATES[role] || PERMISSION_TEMPLATES.teacher;

        userPermission = await UserPermission.findOneAndUpdate(
          { userId: request.userId },
          {
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
    res.status(500).json({ error: 'Failed to review permission request' });
  }
});

// Get user's permission requests
router.get('/user/:userId/requests', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.query;

    const query = { userId };
    if (status) query.status = status;

    const requests = await PermissionRequest.find(query).sort({ requestedAt: -1 }).limit(50);

    res.json(requests);
  } catch (error) {
    console.error('Error fetching user requests:', error);
    res.status(500).json({ error: 'Failed to fetch user requests' });
  }
});

// ─── Custom Roles CRUD ────────────────────────────────────────────────────────

// List all custom roles for the school
router.get('/custom-roles', authenticate, async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const roles = await CustomRole.find({ schoolId }).sort({ createdAt: 1 });
    res.json(roles);
  } catch (error) {
    console.error('Error fetching custom roles:', error);
    res.status(500).json({ error: 'Failed to fetch custom roles' });
  }
});

// Create a custom role
router.post('/custom-roles', authenticate, async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const parsed = customRoleCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    const { name, description, permissions, locked } = parsed.data;

    const existing = await CustomRole.findOne({
      schoolId,
      name: { $regex: new RegExp(`^${name}$`, 'i') },
    });
    if (existing) {
      return res.status(400).json({ error: 'A role with this name already exists' });
    }

    const role = await CustomRole.create({
      schoolId,
      name,
      description,
      permissions,
      locked,
      createdBy: req.user._id,
    });

    res.status(201).json(role);
  } catch (error) {
    console.error('Error creating custom role:', error);
    res.status(500).json({ error: 'Failed to create custom role' });
  }
});

// Update a custom role
router.put('/custom-roles/:id', authenticate, async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const { id } = req.params;

    const parsed = customRoleUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    const role = await CustomRole.findOne({ _id: id, schoolId });
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    if (role.isSystem) {
      return res.status(403).json({ error: 'System roles cannot be modified' });
    }

    const { name, description, permissions, locked } = parsed.data;

    if (name && name !== role.name) {
      const existing = await CustomRole.findOne({
        schoolId,
        name: { $regex: new RegExp(`^${name}$`, 'i') },
        _id: { $ne: id },
      });
      if (existing) {
        return res.status(400).json({ error: 'A role with this name already exists' });
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
    res.status(500).json({ error: 'Failed to update custom role' });
  }
});

// Delete a custom role
router.delete('/custom-roles/:id', authenticate, async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const { id } = req.params;

    const role = await CustomRole.findOne({ _id: id, schoolId });
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    if (role.isSystem) {
      return res.status(403).json({ error: 'System roles cannot be deleted' });
    }

    await role.deleteOne();
    res.json({ message: 'Role deleted successfully' });
  } catch (error) {
    console.error('Error deleting custom role:', error);
    res.status(500).json({ error: 'Failed to delete custom role' });
  }
});

export default router;
