import UserPermission, { PERMISSION_TEMPLATES } from '../models/UserPermission.js';

/**
 * Middleware to check if user has required permission for a module
 * @param {string} module - Module name (e.g., 'staff', 'students')
 * @param {string} action - Action type ('view', 'create', 'edit', 'delete')
 */
export const checkPermission = (module, action) => {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id || req.body.userId || req.query.userId;
      
      if (!userId) {
        return res.status(401).json({ 
          error: 'Unauthorized',
          message: 'User ID not found in request'
        });
      }

      // Get user permissions from database
      let userPermission = await UserPermission.findOne({ userId });

      // If no permissions found, create default based on user role
      if (!userPermission) {
        const user = await req.app.locals.Staff.findById(userId);
        if (!user) {
          return res.status(404).json({ 
            error: 'User not found',
            message: 'User does not exist'
          });
        }

        // Determine role from user data
        const role = determineRole(user.role);
        const defaultPermissions = PERMISSION_TEMPLATES[role];

        // Create permissions array
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

      // Find permission for the requested module
      const modulePermission = userPermission.permissions.find(p => p.module === module);

      if (!modulePermission) {
        return res.status(403).json({
          error: 'Access Denied',
          message: `You don't have access to the ${module} module`,
          module,
          action,
          hasPermission: false
        });
      }

      // Check if user has the required action permission
      if (!modulePermission[action]) {
        return res.status(403).json({
          error: 'Permission Denied',
          message: `You don't have permission to ${action} in the ${module} module`,
          module,
          action,
          hasPermission: false,
          availableActions: Object.keys(modulePermission).filter(key => 
            ['view', 'create', 'edit', 'delete'].includes(key) && modulePermission[key]
          )
        });
      }

      // Permission granted
      req.userPermissions = userPermission;
      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({ 
        error: 'Internal Server Error',
        message: 'Failed to check permissions'
      });
    }
  };
};

/**
 * Determine role from user's role string
 */
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
  
  return 'teacher'; // Default to teacher role
}

/**
 * Middleware to check if user is admin
 */
export const requireAdmin = async (req, res, next) => {
  try {
    const userId = req.user?.id || req.body.userId || req.query.userId;
    
    if (!userId) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'User ID not found'
      });
    }

    const userPermission = await UserPermission.findOne({ userId });
    
    if (!userPermission || userPermission.role !== 'admin') {
      return res.status(403).json({
        error: 'Admin Access Required',
        message: 'This action requires administrator privileges'
      });
    }

    next();
  } catch (error) {
    console.error('Admin check error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: 'Failed to verify admin status'
    });
  }
};

/**
 * Get user permissions (no blocking, just returns permissions)
 */
export const getUserPermissions = async (req, res, next) => {
  try {
    const userId = req.user?.id || req.body.userId || req.query.userId;
    
    if (userId) {
      const userPermission = await UserPermission.findOne({ userId });
      req.userPermissions = userPermission;
    }
    
    next();
  } catch (error) {
    console.error('Get permissions error:', error);
    next(); // Continue even if error
  }
};
