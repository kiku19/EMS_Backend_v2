import express from 'express';
import UserPermission, { PERMISSION_TEMPLATES } from '../models/UserPermission.js';
import PermissionRequest from '../models/PermissionRequest.js';
import { Staff } from '../database.js';
import { requireAdmin } from '../middleware/permissions.js';

const router = express.Router();

// Get user's permissions
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    let userPermission = await UserPermission.findOne({ userId });

    // If no permissions found, create default based on user role
    if (!userPermission) {
      const user = await Staff.findById(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const role = determineRole(user.role);
      const defaultPermissions = PERMISSION_TEMPLATES[role];

      const permissionsArray = Object.entries(defaultPermissions).map(([mod, perms]) => ({
        module: mod,
        ...perms
      }));

      userPermission = await UserPermission.create({
        userId,
        role,
        permissions: permissionsArray,
        customPermissions: false
      });
    }

    res.json(userPermission);
  } catch (error) {
    console.error('Error fetching user permissions:', error);
    res.status(500).json({ error: 'Failed to fetch permissions' });
  }
});

// Update user permissions (admin only)
router.put('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { permissions, role, customPermissions } = req.body;
    const adminId = req.body.adminId || req.query.adminId;

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
        updatedBy: adminId
      },
      { new: true, upsert: true }
    );

    res.json(updated);
  } catch (error) {
    console.error('Error updating permissions:', error);
    res.status(500).json({ error: 'Failed to update permissions' });
  }
});

// Create permission request
router.post('/request', async (req, res) => {
  try {
    const { userId, userName, userEmail, module, permissions, reason } = req.body;

    if (!userId || !userName || !module || !permissions || !reason) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if there's already a pending request for this user and module
    const existingRequest = await PermissionRequest.findOne({
      userId,
      module,
      status: 'pending'
    });

    if (existingRequest) {
      return res.status(400).json({ 
        error: 'A pending request already exists for this module',
        existingRequest
      });
    }

    const request = await PermissionRequest.create({
      userId,
      userName,
      userEmail,
      module,
      permissions,
      reason,
      status: 'pending'
    });

    // Emit socket event to notify admins
    if (req.app.locals.io) {
      req.app.locals.io.emit('permission_request_created', {
        requestId: request._id,
        userId,
        userName,
        module,
        permissions
      });
    }

    res.status(201).json(request);
  } catch (error) {
    console.error('Error creating permission request:', error);
    res.status(500).json({ error: 'Failed to create permission request' });
  }
});

// Get all permission requests (admin only)
router.get('/requests', async (req, res) => {
  try {
    const { status, userId } = req.query;
    const adminId = req.query.adminId;

    // Verify admin
    const adminPermission = await UserPermission.findOne({ userId: adminId });
    if (!adminPermission || adminPermission.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const query = {};
    if (status) query.status = status;
    if (userId) query.userId = userId;

    const requests = await PermissionRequest.find(query)
      .sort({ requestedAt: -1 })
      .limit(100);

    res.json(requests);
  } catch (error) {
    console.error('Error fetching permission requests:', error);
    res.status(500).json({ error: 'Failed to fetch permission requests' });
  }
});

// Get pending requests count (admin only)
router.get('/requests/count/pending', async (req, res) => {
  try {
    const adminId = req.query.adminId;

    // Verify admin
    const adminPermission = await UserPermission.findOne({ userId: adminId });
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
router.put('/requests/:requestId', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { status, reviewNotes, adminId, adminName } = req.body;

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
        // Create new permission record
        const user = await Staff.findById(request.userId);
        const role = determineRole(user.role);
        const defaultPermissions = PERMISSION_TEMPLATES[role];

        const permissionsArray = Object.entries(defaultPermissions).map(([mod, perms]) => ({
          module: mod,
          ...perms
        }));

        userPermission = new UserPermission({
          userId: request.userId,
          role,
          permissions: permissionsArray,
          customPermissions: false
        });
      }

      // Update the specific module permissions
      const moduleIndex = userPermission.permissions.findIndex(p => p.module === request.module);
      
      if (moduleIndex >= 0) {
        // Update existing module permissions
        request.permissions.forEach(perm => {
          userPermission.permissions[moduleIndex][perm] = true;
        });
      } else {
        // Add new module permissions
        const newModulePermission = {
          module: request.module,
          view: false,
          create: false,
          edit: false,
          delete: false
        };
        request.permissions.forEach(perm => {
          newModulePermission[perm] = true;
        });
        userPermission.permissions.push(newModulePermission);
      }

      userPermission.customPermissions = true;
      userPermission.lastUpdated = new Date();
      userPermission.updatedBy = adminId;
      await userPermission.save();
    }

    // Emit socket event to notify user
    if (req.app.locals.io) {
      req.app.locals.io.emit('permission_request_reviewed', {
        requestId: request._id,
        userId: request.userId,
        module: request.module,
        status,
        reviewerName: adminName
      });
    }

    res.json(request);
  } catch (error) {
    console.error('Error reviewing permission request:', error);
    res.status(500).json({ error: 'Failed to review permission request' });
  }
});

// Get user's permission requests
router.get('/user/:userId/requests', async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.query;

    const query = { userId };
    if (status) query.status = status;

    const requests = await PermissionRequest.find(query)
      .sort({ requestedAt: -1 })
      .limit(50);

    res.json(requests);
  } catch (error) {
    console.error('Error fetching user requests:', error);
    res.status(500).json({ error: 'Failed to fetch user requests' });
  }
});

// Helper function
function determineRole(userRole) {
  const roleLower = userRole.toLowerCase();
  
  if (roleLower.includes('admin') || roleLower.includes('principal')) {
    return 'admin';
  } else if (roleLower.includes('teacher')) {
    return 'teacher';
  } else if (roleLower.includes('accountant') || roleLower.includes('finance')) {
    return 'accountant';
  } else if (roleLower.includes('receptionist') || roleLower.includes('front')) {
    return 'receptionist';
  }
  
  return 'teacher';
}

export default router;
