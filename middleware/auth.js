import jwt from 'jsonwebtoken';
import { UserPermission } from '../database.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '8h';

/**
 * Generate JWT token for authenticated user
 */
export function generateToken(userId, role) {
  return jwt.sign(
    { userId, role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * Verify JWT token
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

/**
 * Authentication middleware - Verify user is logged in
 */
export async function authenticate(req, res, next) {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    
    console.log('🔐 Auth middleware - Header:', authHeader ? `Bearer ${authHeader.substring(7, 27)}...` : 'NONE');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.warn('⚠️ Auth failed: No Bearer token in header');
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'No token provided'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token
    const decoded = verifyToken(token);
    
    if (!decoded) {
      console.warn('⚠️ Auth failed: Invalid or expired token');
      return res.status(401).json({ 
        error: 'Invalid or expired token',
        message: 'Please login again'
      });
    }

    console.log('✅ Auth successful:', decoded.userId, decoded.role);

    // Attach user info to request
    req.user = {
      id: decoded.userId,      // Use 'id' for consistency with permissions middleware
      userId: decoded.userId,  // Keep userId for backward compatibility
      role: decoded.role
    };

    next();
  } catch (error) {
    console.error('❌ Authentication error:', error);
    return res.status(401).json({ 
      error: 'Authentication failed',
      message: error.message
    });
  }
}

/**
 * Optional authentication - Don't fail if no token, just attach user if present
 */
export async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = verifyToken(token);
      
      if (decoded) {
        req.user = {
          userId: decoded.userId,
          role: decoded.role
        };
      }
    }

    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
}

/**
 * Require admin role
 */
export async function requireAdmin(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Authentication required' 
      });
    }

    // Check if user has admin permissions
    const permissions = await UserPermission.findOne({ userId: req.user.userId });
    
    if (!permissions || permissions.role !== 'admin') {
      return res.status(403).json({ 
        error: 'Admin access required',
        message: 'You do not have permission to perform this action'
      });
    }

    next();
  } catch (error) {
    console.error('Admin check error:', error);
    return res.status(500).json({ 
      error: 'Permission check failed',
      message: error.message
    });
  }
}

export default {
  generateToken,
  verifyToken,
  authenticate,
  optionalAuth,
  requireAdmin
};
