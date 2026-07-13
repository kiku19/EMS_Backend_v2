import UserPermission, { PERMISSION_TEMPLATES } from '../../models/UserPermission.js';
import { createLogger } from '../../utils/logger.js';
import { isSuperAdminUser } from '../../utils/superAdmin.js';

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
      // Super-admin bypasses RBAC entirely
      if (isSuperAdminUser(req.user)) {
        return next();
      }

      const userId = req.user?.id;
      const schoolId = req.user?.schoolId;

      if (!userId) {
        return res.status(401).json({
          error: req.t('common:errors.unauthorized'),
          message: req.t('auth:errors.userIdNotFound'),
        });
      }

      if (!schoolId) {
        // No school context = no permission can be evaluated. Without this the
        // {userId}-only lookup would pick up a stale row from a previous tenant
        // and silently grant that tenant's permissions.
        return res.status(403).json({
          error: req.t('common:errors.forbidden'),
          message: req.t('auth:errors.moduleAccessDenied', { module }),
          module,
          action,
          hasPermission: false,
        });
      }

      let userPermission = await UserPermission.findOne({ userId, schoolId });

      if (!userPermission) {
        const user = await req.app.locals.Staff.findOne({ _id: userId, schoolId });
        if (!user) {
          return res.status(404).json({
            error: req.t('auth:errors.userNotFound'),
            message: req.t('common:errors.notFound'),
          });
        }

        const role = determineRole(user.role);
        const defaultPermissions = PERMISSION_TEMPLATES[role] || PERMISSION_TEMPLATES.teacher;

        // Upsert with retry: under concurrent workers two operations may race
        // to insert the same (userId, schoolId) row, causing E11000.  A single
        // retry is usually sufficient because the winner will have created the
        // document by the time the loser retries.
        let upsertAttempts = 0;
        const maxUpsertAttempts = 3;
        while (upsertAttempts < maxUpsertAttempts) {
          upsertAttempts += 1;
          try {
            userPermission = await UserPermission.findOneAndUpdate(
              { userId, schoolId },
              {
                schoolId,
                userId,
                role,
                permissions: buildPermissionsArray(defaultPermissions),
                customPermissions: false,
              },
              { upsert: true, new: true }
            );
            break;
          } catch (err) {
            if (err.code === 11000 && upsertAttempts < maxUpsertAttempts) {
              // Race lost: the other worker created the row.  Re-fetch and continue.
              userPermission = await UserPermission.findOne({ userId, schoolId });
              if (userPermission) break;
              continue;
            }
            throw err;
          }
        }
      } else {
        await ensurePermissionDocument(userPermission, userPermission.role);
      }

      const modulePermission = userPermission.permissions.find(
        (permission) => permission.module === module
      );

      if (!modulePermission) {
        // Module isn't in the user's permissions array yet — typically
        // because PERMISSION_TEMPLATES pre-date the module (homework,
        // hostel, inventory, library, ptm, transport, front-office).
        // Default policy: 'admin' role gets full access so schools can
        // onboard these modules without a migration; every other role
        // denies until the template is extended.
        if (userPermission.role === 'admin') {
          req.userPermissions = userPermission;
          return next();
        }
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

// Map canonical Staff role strings (models/Staff.js enum) to the permission
// template roles (models/UserPermission.js enum). Anything not in this table
// — legacy freeform roles like "Administrative Assistant", "Frontdesk admin",
// "Vice Principal" — falls through to the least-privileged 'teacher' bucket
// rather than the old substring-matching which silently granted admin rights.
const STAFF_TO_PERMISSION_ROLE = Object.freeze({
  Admin: 'admin',
  Principal: 'admin',
  Accountant: 'accountant',
  Receptionist: 'receptionist',
  Teacher: 'teacher',
  Teaching: 'teacher',
  'Vice Principal': 'teacher',
  Librarian: 'teacher',
  'Lab Assistant': 'teacher',
  Counselor: 'teacher',
  Driver: 'teacher',
  Security: 'teacher',
  Administrative: 'teacher',
});

/**
 * Determine permission role from the Staff.role field.
 * Accepts the array form (preferred — Staff.role is an array) or a single string.
 * Defaults to the least-privileged 'teacher' when no canonical mapping exists.
 */
export function determineRole(userRole) {
  const roles = Array.isArray(userRole) ? userRole : [userRole];

  // Walk the array so Staff with ['Teacher', 'Admin'] resolves to the highest
  // canonical role present (admin > accountant/receptionist > teacher).
  const ranking = { admin: 3, accountant: 2, receptionist: 2, teacher: 1 };
  let best = null;

  for (const role of roles) {
    if (typeof role !== 'string') continue;
    const mapped = STAFF_TO_PERMISSION_ROLE[role];
    if (!mapped) continue;
    if (!best || ranking[mapped] > ranking[best]) {
      best = mapped;
    }
  }

  return best || 'teacher';
}

/**
 * Programmatic permission check (non-middleware).
 * Mirrors checkPermission's evaluation but returns a boolean instead of ending
 * the response — for routes that need to OR several permissions together
 * (e.g. trash restore = settings:edit OR the originating module's delete).
 *
 * @param {object} req - Express request (needs req.user)
 * @param {string} module - Module name (e.g. 'students')
 * @param {string} action - 'view' | 'create' | 'edit' | 'delete' | 'publish'
 * @returns {Promise<boolean>}
 */
export async function userHasPermission(req, module, action) {
  if (isSuperAdminUser(req.user)) return true;

  const userId = req.user?.id;
  const schoolId = req.user?.schoolId;
  if (!userId || !schoolId) return false;

  const userPermission = await UserPermission.findOne({ userId, schoolId });
  if (!userPermission) return false;

  await ensurePermissionDocument(userPermission, userPermission.role);

  const modulePermission = userPermission.permissions.find((p) => p.module === module);
  if (!modulePermission) {
    // Same policy as checkPermission: admin gets modules not yet in the template.
    return userPermission.role === 'admin';
  }
  return Boolean(modulePermission[action]);
}

/**
 * Middleware to check if user is admin
 */
export const requireAdmin = async (req, res, next) => {
  try {
    if (isSuperAdminUser(req.user)) {
      return next();
    }

    const userId = req.user?.id;
    const schoolId = req.user?.schoolId;

    if (!userId) {
      return res.status(401).json({
        error: req.t('common:errors.unauthorized'),
        message: req.t('auth:errors.userIdNotFound'),
      });
    }

    if (!schoolId) {
      return res.status(403).json({
        error: req.t('auth:errors.adminRequired'),
        message: req.t('auth:errors.adminPrivilegesRequired'),
      });
    }

    const userPermission = await UserPermission.findOne({ userId, schoolId });

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
    const schoolId = req.user?.schoolId;

    if (userId && schoolId) {
      req.userPermissions = await UserPermission.findOne({ userId, schoolId });
    }

    next();
  } catch (error) {
    logger.error({ err: error }, 'Get permissions error');
    next();
  }
};
