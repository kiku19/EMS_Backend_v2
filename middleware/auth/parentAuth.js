import jwt from 'jsonwebtoken';
import Parent from '../../models/Parent.js';
import { getRequiredSecret } from '../../config/environment.js';
import { ensureDocumentSchool } from '../../utils/schoolContext.js';
import { runWithTenant } from '../../utils/tenantAsyncContext.js';

/**
 * Authenticate parent JWT token and load parent data
 */
export const authenticateParent = async (req, res, next) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'INVALID_TOKEN',
        message: req.t('auth:errors.noToken'),
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify JWT token
    const decoded = jwt.verify(token, getRequiredSecret('JWT_SECRET'));

    // Load parent from database
    const parent = await Parent.findById(decoded.userId || decoded.parentId).select('-password');

    if (!parent) {
      return res.status(401).json({
        success: false,
        error: 'PARENT_NOT_FOUND',
        message: req.t('auth:errors.parentNotFound'),
      });
    }

    // Check parent status
    if (parent.status !== 'active') {
      return res.status(401).json({
        success: false,
        error: 'ACCOUNT_INACTIVE',
        message: req.t('auth:errors.parentInactive'),
      });
    }

    // Attach parent data to request
    const resolvedSchoolId = await ensureDocumentSchool(parent);
    const schoolId = resolvedSchoolId?.toString?.() || resolvedSchoolId || null;

    req.parent = parent;
    req.userType = 'parent';
    req.userId = parent._id;
    req.schoolId = schoolId;
    req.user = {
      id: parent._id,
      userId: parent._id,
      role: 'parent',
      userType: 'parent',
      schoolId,
    };

    // Bind the parent's schoolId to the async context so all downstream
    // database queries are scoped to the correct tenant.
    return runWithTenant(schoolId, next);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'TOKEN_EXPIRED',
        message: req.t('common:errors.tokenExpired'),
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'INVALID_TOKEN',
        message: req.t('common:errors.tokenInvalid'),
      });
    }

    return res.status(500).json({
      success: false,
      error: 'AUTH_ERROR',
      message: req.t('auth:errors.authFailed'),
    });
  }
};

/**
 * Validate parent can access specific student data
 */
export const validateParentChildAccess = async (req, res, next) => {
  try {
    const { studentId } = req.params;

    if (!studentId) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_STUDENT_ID',
        message: req.t('auth:errors.studentIdRequired'),
      });
    }

    // Check if studentId is in parent's children array
    const hasAccess = req.parent.children.some(
      (child) => child.studentId.toString() === studentId || child.toString() === studentId
    );

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        error: 'ACCESS_DENIED',
        message: req.t('auth:errors.studentAccessDenied'),
      });
    }

    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: req.t('auth:errors.accessValidationFailed'),
    });
  }
};

/**
 * Combined middleware for authentication and access check
 */
export const parentAuthWithAccessCheck = [authenticateParent, validateParentChildAccess];
