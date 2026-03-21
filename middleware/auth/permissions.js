import UserPermission, { PERMISSION_TEMPLATES } from '../../models/UserPermission.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('Permissions');

const ACTION_KEYS = ['view', 'create', 'edit', 'delete', 'publish'];

const toPermissionRecord = (module, actions = {}) => ({
  module,
  view: Boolean(actions.view),
  create: Boolean(actions.create),
  edit: Boolean(actions.edit),
  delete: Boolean(actions.delete),
  publish: Boolean(actions.publish),
});

export const buildPermissionsArray = (permissionsObject = {}) => {
  return Object.entries(permissionsObject).map(([module, actions]) =>
    toPermissionRecord(module, actions)
  );
};

export async function ensurePermissionDocument(userPermission, role) {
  const effectiveRole = role || userPermission.role || 'teacher';
  const defaultPermissions = PERMISSION_TEMPLATES[effectiveRole] || PERMISSION_TEMPLATES.teacher;
  let changed = false;

  if (!Array.isArray(userPermission.permissions)) {
    userPermission.permissions = [];
    changed = true;
  }

  const permissionMap = new Map();
  userPermission.permissions.forEach((permission) => {
    permissionMap.set(permission.module, permission);

    ACTION_KEYS.forEach((action) => {
      if (typeof permission[action] !== 'boolean') {
        permission[action] = false;
        changed = true;
      }
    });
  });

  Object.entries(defaultPermissions).forEach(([module, actions]) => {
    const existingPermission = permissionMap.get(module);

    if (!existingPermission) {
      userPermission.permissions.push(toPermissionRecord(module, actions));
      changed = true;
      return;
    }

    ACTION_KEYS.forEach((action) => {
      if (typeof existingPermission[action] !== 'boolean') {
        existingPermission[action] = Boolean(actions[action]);
        changed = true;
      }
    });
  });

  if (!userPermission.role) {
    userPermission.role = effectiveRole;
    changed = true;
  }

  if (changed) {
    userPermission.lastUpdated = new Date();
    await userPermission.save();
  }

  return userPermission;
}

/**
 * Middleware to check if user has required permission for a module
 * @param {string} module - Module name (e.g., 'staff', 'students')
 * @param {string} action - Action type ('view', 'create', 'edit', 'delete', 'publish')
 */
export const checkPermission = (module, action) => {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          error: req.t('common:errors.unauthorized'),
          message: req.t('auth:errors.userIdNotFound'),
        });
      }

      let userPermission = await UserPermission.findOne({ userId });

      if (!userPermission) {
        const user = await req.app.locals.Staff.findById(userId);
        if (!user) {
          return res.status(404).json({
            error: req.t('auth:errors.userNotFound'),
            message: req.t('common:errors.notFound'),
          });
        }

        const role = determineRole(user.role);
        const defaultPermissions = PERMISSION_TEMPLATES[role] || PERMISSION_TEMPLATES.teacher;

        userPermission = await UserPermission.findOneAndUpdate(
          { userId },
          {
            schoolId: req.user?.schoolId || user.schoolId || null,
            userId,
            role,
            permissions: buildPermissionsArray(defaultPermissions),
            customPermissions: false,
          },
          { upsert: true, new: true }
        );
      } else {
        let shouldPersistSchoolId = false;
        if (!userPermission.schoolId && req.user?.schoolId) {
          userPermission.schoolId = req.user.schoolId;
          shouldPersistSchoolId = true;
        }
        await ensurePermissionDocument(userPermission, userPermission.role);
        if (shouldPersistSchoolId) {
          userPermission.lastUpdated = new Date();
          await userPermission.save({ validateModifiedOnly: true });
        }
      }

      const modulePermission = userPermission.permissions.find(
        (permission) => permission.module === module
      );

      if (!modulePermission) {
        return res.status(403).json({
          error: req.t('common:errors.forbidden'),
          message: req.t('auth:errors.moduleAccessDenied', { module }),
          module,
          action,
          hasPermission: false,
        });
      }

      if (!modulePermission[action]) {
        return res.status(403).json({
          error: req.t('common:errors.forbidden'),
          message: req.t('auth:errors.actionPermissionDenied', { action, module }),
          module,
          action,
          hasPermission: false,
          availableActions: ACTION_KEYS.filter(
            (permissionAction) => modulePermission[permissionAction]
          ),
        });
      }

      req.userPermissions = userPermission;
      next();
    } catch (error) {
      logger.error({ err: error, module, action }, 'Permission check error');
      res.status(500).json({
        error: req.t('common:errors.serverError'),
        message: req.t('auth:errors.permissionCheckFailed'),
      });
    }
  };
};

/**
 * Determine role from user's role string or array
 */
export function determineRole(userRole) {
  const roleStr = Array.isArray(userRole) ? userRole[0] : userRole;

  if (!roleStr || typeof roleStr !== 'string') {
    return 'teacher';
  }

  const roleLower = roleStr.toLowerCase();

  if (roleLower.includes('admin') || roleLower.includes('principal')) {
    return 'admin';
  }
  if (roleLower.includes('teacher')) {
    return 'teacher';
  }
  if (roleLower.includes('accountant') || roleLower.includes('finance')) {
    return 'accountant';
  }
  if (roleLower.includes('receptionist') || roleLower.includes('front')) {
    return 'receptionist';
  }

  return 'teacher';
}

/**
 * Middleware to check if user is admin
 */
export const requireAdmin = async (req, res, next) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        error: req.t('common:errors.unauthorized'),
        message: req.t('auth:errors.userIdNotFound'),
      });
    }

    const userPermission = await UserPermission.findOne({ userId });

    if (!userPermission || userPermission.role !== 'admin') {
      return res.status(403).json({
        error: req.t('auth:errors.adminRequired'),
        message: req.t('auth:errors.adminPrivilegesRequired'),
      });
    }

    next();
  } catch (error) {
    logger.error({ err: error }, 'Admin check error');
    res.status(500).json({
      error: req.t('common:errors.serverError'),
      message: req.t('auth:errors.adminStatusCheckFailed'),
    });
  }
};

/**
 * Get user permissions (no blocking, just returns permissions)
 */
export const getUserPermissions = async (req, res, next) => {
  try {
    const userId = req.user?.id;

    if (userId) {
      const userPermission = await UserPermission.findOne({ userId });
      if (userPermission && !userPermission.schoolId && req.user?.schoolId) {
        userPermission.schoolId = req.user.schoolId;
        await userPermission.save({ validateModifiedOnly: true });
      }
      req.userPermissions = userPermission;
    }

    next();
  } catch (error) {
    logger.error({ err: error }, 'Get permissions error');
    next();
  }
};
