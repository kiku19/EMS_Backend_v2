// Chat Permission Middleware
// Checks if user has permission to use chat features based on their role

import { Staff } from '../database.js';

// Permission constants
export const CHAT_PERMISSIONS = {
  SEND_MESSAGE: 'chat.send_message',
  VIEW_CONVERSATIONS: 'chat.view_conversations',
  MESSAGE_STUDENTS: 'chat.message_students',
  MESSAGE_PARENTS: 'chat.message_parents',
  MESSAGE_STAFF: 'chat.message_staff',
  MESSAGE_ANYONE: 'chat.message_anyone',
  CREATE_GROUP: 'chat.create_group',
  BROADCAST: 'chat.broadcast'
};

// Default role permissions
export const DEFAULT_ROLE_PERMISSIONS = {
  'Principal': [
    CHAT_PERMISSIONS.SEND_MESSAGE,
    CHAT_PERMISSIONS.VIEW_CONVERSATIONS,
    CHAT_PERMISSIONS.MESSAGE_STUDENTS,
    CHAT_PERMISSIONS.MESSAGE_PARENTS,
    CHAT_PERMISSIONS.MESSAGE_STAFF,
    CHAT_PERMISSIONS.MESSAGE_ANYONE,
    CHAT_PERMISSIONS.CREATE_GROUP,
    CHAT_PERMISSIONS.BROADCAST
  ],
  'Vice Principal': [
    CHAT_PERMISSIONS.SEND_MESSAGE,
    CHAT_PERMISSIONS.VIEW_CONVERSATIONS,
    CHAT_PERMISSIONS.MESSAGE_STUDENTS,
    CHAT_PERMISSIONS.MESSAGE_PARENTS,
    CHAT_PERMISSIONS.MESSAGE_STAFF,
    CHAT_PERMISSIONS.MESSAGE_ANYONE,
    CHAT_PERMISSIONS.CREATE_GROUP
  ],
  'Admin': [
    CHAT_PERMISSIONS.SEND_MESSAGE,
    CHAT_PERMISSIONS.VIEW_CONVERSATIONS,
    CHAT_PERMISSIONS.MESSAGE_STUDENTS,
    CHAT_PERMISSIONS.MESSAGE_PARENTS,
    CHAT_PERMISSIONS.MESSAGE_STAFF,
    CHAT_PERMISSIONS.MESSAGE_ANYONE
  ],
  'Teacher': [
    CHAT_PERMISSIONS.SEND_MESSAGE,
    CHAT_PERMISSIONS.VIEW_CONVERSATIONS,
    CHAT_PERMISSIONS.MESSAGE_STUDENTS, // Only their class students
    CHAT_PERMISSIONS.MESSAGE_PARENTS,  // Only their class parents
    CHAT_PERMISSIONS.MESSAGE_STAFF     // Other teachers
  ],
  'Accountant': [
    CHAT_PERMISSIONS.SEND_MESSAGE,
    CHAT_PERMISSIONS.VIEW_CONVERSATIONS,
    CHAT_PERMISSIONS.MESSAGE_PARENTS   // For fee-related communication
  ],
  'Librarian': [
    CHAT_PERMISSIONS.SEND_MESSAGE,
    CHAT_PERMISSIONS.VIEW_CONVERSATIONS,
    CHAT_PERMISSIONS.MESSAGE_STUDENTS
  ],
  'Front Desk': [
    CHAT_PERMISSIONS.SEND_MESSAGE,
    CHAT_PERMISSIONS.VIEW_CONVERSATIONS,
    CHAT_PERMISSIONS.MESSAGE_PARENTS
  ]
};

// Check if user has specific permission
export async function hasPermission(userId, userType, permission) {
  try {
    if (userType === 'student') {
      // Students can only message their teachers and admin
      return [
        CHAT_PERMISSIONS.SEND_MESSAGE,
        CHAT_PERMISSIONS.VIEW_CONVERSATIONS
      ].includes(permission);
    }

    // For staff, check their role
    const staff = await Staff.findById(userId).select('role customPermissions');
    if (!staff) {
      console.warn('⚠️ [PERMISSION] Staff not found:', userId);
      return false;
    }

    // Check custom permissions first (from Settings > Roles & Access)
    if (staff.customPermissions && staff.customPermissions.includes(permission)) {
      return true;
    }

    // Fall back to default role permissions
    const rolePermissions = DEFAULT_ROLE_PERMISSIONS[staff.role] || [];

    // If role not in defaults, give basic permissions (SEND_MESSAGE and VIEW_CONVERSATIONS)
    if (rolePermissions.length === 0) {
      console.log('📋 [PERMISSION] Role not in defaults, giving basic permissions:', staff.role);
      return [
        CHAT_PERMISSIONS.SEND_MESSAGE,
        CHAT_PERMISSIONS.VIEW_CONVERSATIONS
      ].includes(permission);
    }

    const hasAccess = rolePermissions.includes(permission);
    console.log('🔍 [PERMISSION] Check:', {
      userId,
      role: staff.role,
      permission,
      hasAccess
    });

    return hasAccess;
  } catch (error) {
    console.error('❌ [PERMISSION] Error checking permission:', error);
    return false;
  }
}

// Check if user can message another user
export async function canMessageUser(senderId, senderType, receiverId, receiverType) {
  try {
    // Students can only message staff
    if (senderType === 'student' && receiverType === 'student') {
      return false; // Students cannot message other students
    }

    if (senderType === 'student' && receiverType === 'staff') {
      return true; // Students can message staff
    }

    // For staff, check their permissions
    const sender = await Staff.findById(senderId).select('role customPermissions');
    if (!sender) return false;

    // Check if they have MESSAGE_ANYONE permission
    if (await hasPermission(senderId, senderType, CHAT_PERMISSIONS.MESSAGE_ANYONE)) {
      return true;
    }

    // Check specific permissions based on receiver type
    if (receiverType === 'staff') {
      return await hasPermission(senderId, senderType, CHAT_PERMISSIONS.MESSAGE_STAFF);
    }

    if (receiverType === 'student') {
      return await hasPermission(senderId, senderType, CHAT_PERMISSIONS.MESSAGE_STUDENTS);
    }

    if (receiverType === 'parent') {
      return await hasPermission(senderId, senderType, CHAT_PERMISSIONS.MESSAGE_PARENTS);
    }

    return false;
  } catch (error) {
    console.error('Error checking message permission:', error);
    return false;
  }
}

// Middleware for REST API routes
export async function checkChatPermission(permission) {
  return async (req, res, next) => {
    try {
      const { userId, userType } = req.query || req.body;

      if (!userId || !userType) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const hasAccess = await hasPermission(userId, userType, permission);

      if (!hasAccess) {
        return res.status(403).json({ 
          error: 'Permission denied',
          message: 'You do not have permission to perform this action'
        });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

// Get user's chat permissions
export async function getUserChatPermissions(userId, userType) {
  try {
    if (userType === 'student') {
      return {
        canSendMessage: true,
        canViewConversations: true,
        canMessageStudents: false,
        canMessageParents: false,
        canMessageStaff: true,
        canMessageAnyone: false,
        canCreateGroup: false,
        canBroadcast: false
      };
    }

    const staff = await Staff.findById(userId).select('role customPermissions');
    if (!staff) return null;

    let permissions = staff.customPermissions || DEFAULT_ROLE_PERMISSIONS[staff.role] || [];

    // If role not in defaults, give basic permissions
    if (permissions.length === 0) {
      console.log('📋 [PERMISSION] Role not in defaults, giving basic permissions:', staff.role);
      permissions = [
        CHAT_PERMISSIONS.SEND_MESSAGE,
        CHAT_PERMISSIONS.VIEW_CONVERSATIONS
      ];
    }

    return {
      canSendMessage: permissions.includes(CHAT_PERMISSIONS.SEND_MESSAGE),
      canViewConversations: permissions.includes(CHAT_PERMISSIONS.VIEW_CONVERSATIONS),
      canMessageStudents: permissions.includes(CHAT_PERMISSIONS.MESSAGE_STUDENTS),
      canMessageParents: permissions.includes(CHAT_PERMISSIONS.MESSAGE_PARENTS),
      canMessageStaff: permissions.includes(CHAT_PERMISSIONS.MESSAGE_STAFF),
      canMessageAnyone: permissions.includes(CHAT_PERMISSIONS.MESSAGE_ANYONE),
      canCreateGroup: permissions.includes(CHAT_PERMISSIONS.CREATE_GROUP),
      canBroadcast: permissions.includes(CHAT_PERMISSIONS.BROADCAST)
    };
  } catch (error) {
    console.error('Error getting user permissions:', error);
    return null;
  }
}
