/**
 * @swagger
 * tags:
 *   name: Notifications
 *   description: In-app notifications and per-user notification preferences
 */

/**
 * @swagger
 * /notifications:
 *   get:
 *     summary: Get notifications for the authenticated user
 *     tags: [Notifications]
 *     parameters:
 *       - in: query
 *         name: unreadOnly
 *         schema:
 *           type: boolean
 *         description: Return only unread notifications
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by notification type (e.g. fee_due, exam_result)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Notifications with unread count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 notifications:
 *                   type: array
 *                   items:
 *                     type: object
 *                 unreadCount:
 *                   type: integer
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @swagger
 * /notifications/{id}/read:
 *   put:
 *     summary: Mark a single notification as read
 *     tags: [Notifications]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: Updated notification
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @swagger
 * /notifications/read-all:
 *   put:
 *     summary: Mark all notifications as read for the authenticated user
 *     tags: [Notifications]
 *     responses:
 *       200:
 *         description: All notifications marked as read
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @swagger
 * /notifications/{id}:
 *   delete:
 *     summary: Delete a notification
 *     tags: [Notifications]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: Notification deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @swagger
 * /notifications/preferences/me:
 *   get:
 *     summary: Get the authenticated user's notification preferences (auto-creates defaults if missing)
 *     tags: [Notifications]
 *     responses:
 *       200:
 *         description: Notification preferences document
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *   put:
 *     summary: Update notification preferences
 *     tags: [Notifications]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               preferences:
 *                 type: array
 *                 description: Per-type channel preferences
 *               quietHours:
 *                 type: object
 *                 properties:
 *                   enabled:
 *                     type: boolean
 *                   start:
 *                     type: string
 *                     example: '22:00'
 *                   end:
 *                     type: string
 *                     example: '07:00'
 *               digestFrequency:
 *                 type: string
 *                 enum: [instant, daily, weekly, never]
 *               emailDigest:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Updated preferences
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @swagger
 * /notifications/preferences/reset:
 *   post:
 *     summary: Reset notification preferences to defaults
 *     tags: [Notifications]
 *     responses:
 *       200:
 *         description: Preferences reset
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

import express from 'express';
import mongoose from 'mongoose';
import Notification from '../models/Notification.js';
import NotificationPreference from '../models/NotificationPreference.js';
import AnnouncementRecipient from '../models/AnnouncementRecipient.js';
import { sendAnnouncementEmail } from '../services/emailService.js';
import { sendAnnouncementSMS } from '../services/smsService.js';
import { sendAnnouncementWhatsApp } from '../services/whatsappService.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { emitNotificationToUser } from '../utils/socketEmitter.js';

const router = express.Router();
router.use(authenticate);

const getUserModel = (user) => {
  const normalizedRole = String(user?.role || '').toLowerCase();
  return normalizedRole === 'parent' ? 'Student' : 'Staff';
};

const getPreferenceRole = (user) => {
  const normalizedRole = String(user?.role || '').toLowerCase();
  if (normalizedRole === 'admin') return 'admin';
  if (normalizedRole === 'parent') return 'parent';
  if (normalizedRole === 'student') return 'student';
  return 'staff';
};

// GET /api/notifications - Get user notifications
router.get('/', async (req, res) => {
  try {
    const user = req.user;
    const { unreadOnly, type, limit = 50 } = req.query;

    const query = {
      userId: user.id,
      userModel: getUserModel(user),
    };

    if (unreadOnly === 'true') {
      query.read = false;
    }

    if (type) {
      query.type = type;
    }

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    // Get unread count
    const unreadCount = await Notification.getUnreadCount(user.id, query.userModel);

    res.json({
      notifications,
      unreadCount,
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// GET /api/notifications/sms-stats - SMS delivery rate stats (admin only)
router.get('/sms-stats', requireAdmin, async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    if (!schoolId) {
      return res.status(400).json({ error: 'School context required' });
    }

    const daysNum = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 30);
    const since = new Date();
    since.setDate(since.getDate() - daysNum);
    const schoolObjectId = new mongoose.Types.ObjectId(String(schoolId));

    // Overall SMS delivery stats from announcement recipients (school-scoped via announcement)
    const [overallStats] = await AnnouncementRecipient.aggregate([
      {
        $lookup: {
          from: 'announcements',
          localField: 'announcementId',
          foreignField: '_id',
          as: 'announcement',
        },
      },
      { $unwind: '$announcement' },
      { $match: { 'announcement.schoolId': schoolObjectId } },
      { $unwind: '$deliveryStatus' },
      { $match: { 'deliveryStatus.channel': 'sms' } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          sent: {
            $sum: {
              $cond: [{ $in: ['$deliveryStatus.status', ['sent', 'delivered', 'read']] }, 1, 0],
            },
          },
          delivered: {
            $sum: { $cond: [{ $eq: ['$deliveryStatus.status', 'delivered'] }, 1, 0] },
          },
          failed: {
            $sum: { $cond: [{ $eq: ['$deliveryStatus.status', 'failed'] }, 1, 0] },
          },
          pending: {
            $sum: { $cond: [{ $eq: ['$deliveryStatus.status', 'pending'] }, 1, 0] },
          },
        },
      },
    ]);

    // Daily trend for the selected period
    const trend = await AnnouncementRecipient.aggregate([
      {
        $lookup: {
          from: 'announcements',
          localField: 'announcementId',
          foreignField: '_id',
          as: 'announcement',
        },
      },
      { $unwind: '$announcement' },
      { $match: { 'announcement.schoolId': schoolObjectId } },
      { $unwind: '$deliveryStatus' },
      {
        $match: {
          'deliveryStatus.channel': 'sms',
          'deliveryStatus.sentAt': { $gte: since },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$deliveryStatus.sentAt' } },
          sent: {
            $sum: {
              $cond: [{ $in: ['$deliveryStatus.status', ['sent', 'delivered', 'read']] }, 1, 0],
            },
          },
          delivered: {
            $sum: { $cond: [{ $eq: ['$deliveryStatus.status', 'delivered'] }, 1, 0] },
          },
          failed: {
            $sum: { $cond: [{ $eq: ['$deliveryStatus.status', 'failed'] }, 1, 0] },
          },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { date: '$_id', sent: 1, delivered: 1, failed: 1, _id: 0 } },
    ]);

    // Most recent 10 SMS failures
    const recentFailures = await AnnouncementRecipient.aggregate([
      {
        $lookup: {
          from: 'announcements',
          localField: 'announcementId',
          foreignField: '_id',
          as: 'announcement',
        },
      },
      { $unwind: '$announcement' },
      { $match: { 'announcement.schoolId': schoolObjectId } },
      { $unwind: '$deliveryStatus' },
      { $match: { 'deliveryStatus.channel': 'sms', 'deliveryStatus.status': 'failed' } },
      { $sort: { 'deliveryStatus.sentAt': -1 } },
      { $limit: 10 },
      {
        $project: {
          announcementId: 1,
          announcementTitle: '$announcement.title',
          userType: 1,
          error: '$deliveryStatus.error',
          sentAt: '$deliveryStatus.sentAt',
        },
      },
    ]);

    const overall = overallStats || { total: 0, sent: 0, delivered: 0, failed: 0, pending: 0 };
    const deliveryRate = overall.total > 0 ? Math.round((overall.sent / overall.total) * 100) : 0;

    res.json({
      overall: { ...overall, deliveryRate },
      trend,
      recentFailures,
      period: { days: daysNum, since },
    });
  } catch (error) {
    console.error('Error fetching SMS delivery stats:', error);
    res.status(500).json({ error: 'Failed to fetch SMS delivery stats' });
  }
});

// PUT /api/notifications/:id/read - Mark notification as read
router.put('/:id/read', async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      userId: req.user.id,
      userModel: getUserModel(req.user),
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    await notification.markAsRead();

    res.json(notification);
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// PUT /api/notifications/read-all - Mark all notifications as read
router.put('/read-all', async (req, res) => {
  try {
    const user = req.user;
    const userModel = getUserModel(user);

    await Notification.markAllAsReadForUser(user.id, userModel);

    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Error marking all as read:', error);
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
});

// DELETE /api/notifications/:id - Delete notification
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Notification.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id,
      userModel: getUserModel(req.user),
    });

    if (!deleted) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ message: 'Notification deleted' });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

// GET /api/notification-preferences - Get user preferences
router.get('/preferences/me', async (req, res) => {
  try {
    const user = req.user;
    const userModel = getUserModel(user);

    let preferences = await NotificationPreference.findOne({
      userId: user.id,
      userModel,
    }).lean();

    // If no preferences exist, create default
    if (!preferences) {
      preferences = await NotificationPreference.create({
        userId: user.id,
        userModel,
        role: getPreferenceRole(user),
        preferences: [], // Will be populated with defaults
      });
    }

    res.json(preferences);
  } catch (error) {
    console.error('Error fetching preferences:', error);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

// PUT /api/notification-preferences - Update preferences
router.put('/preferences/me', async (req, res) => {
  try {
    const user = req.user;
    const userModel = getUserModel(user);

    const { preferences, quietHours, digestFrequency, emailDigest } = req.body;

    let pref = await NotificationPreference.findOne({
      userId: user.id,
      userModel,
    });

    if (!pref) {
      pref = new NotificationPreference({
        userId: user.id,
        userModel,
        role: getPreferenceRole(user),
      });
    }

    if (preferences) pref.preferences = preferences;
    if (quietHours) pref.quietHours = quietHours;
    if (digestFrequency) pref.digestFrequency = digestFrequency;
    if (emailDigest) pref.emailDigest = emailDigest;

    await pref.save();

    res.json(pref);
  } catch (error) {
    console.error('Error updating preferences:', error);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// POST /api/notification-preferences/reset - Reset to defaults
router.post('/preferences/reset', async (req, res) => {
  try {
    const user = req.user;
    const userModel = getUserModel(user);

    await NotificationPreference.findOneAndDelete({
      userId: user.id,
      userModel,
    });

    res.json({ message: 'Preferences reset to defaults' });
  } catch (error) {
    console.error('Error resetting preferences:', error);
    res.status(500).json({ error: 'Failed to reset preferences' });
  }
});

// Helper function to send notification (used by other modules)
export async function sendNotification(userId, userModel, type, title, message, options = {}) {
  try {
    // Get user preferences
    const pref = await NotificationPreference.findOne({ userId, userModel });

    // Create in-app notification
    const notification = new Notification({
      userId,
      userModel,
      type,
      title,
      message,
      actionUrl: options.actionUrl,
      actionType: options.actionType,
      relatedId: options.relatedId,
      relatedType: options.relatedType,
      priority: options.priority || 'normal',
      channels: [],
    });

    // Determine which channels to use
    const channels = ['inapp'];
    if (pref) {
      const channelPref = pref.getChannelPreferences(type, type);
      if (channelPref.email) channels.push('email');
      if (channelPref.sms) channels.push('sms');
      if (channelPref.whatsapp) channels.push('whatsapp');
    }

    notification.channels = channels.map((ch) => ({
      type: ch,
      status: 'pending',
    }));

    await notification.save();

    // Emit real-time socket event to the user (fire-and-forget)
    try {
      emitNotificationToUser(userId, notification);
    } catch (err) {
      console.error('[Socket] Failed to emit notification:new:', err.message);
    }

    // Send push notification (fire-and-forget, don't block on failure)
    const pushData = {
      type,
      notificationId: notification._id.toString(),
      ...(options.relatedId && { relatedId: options.relatedId.toString() }),
      ...(options.relatedType && { relatedType: options.relatedType }),
      ...(options.actionUrl && { actionUrl: options.actionUrl }),
    };

    import('../services/pushNotificationService.js')
      .then(({ default: pushService }) => {
        if (userModel === 'Staff') {
          pushService
            .sendToUser(userId.toString(), title, message, pushData)
            .catch((err) => console.error('[Push] sendToUser failed:', err.message));
        } else if (userModel === 'Parent') {
          pushService
            .sendToParent(userId.toString(), title, message, pushData)
            .catch((err) => console.error('[Push] sendToParent failed:', err.message));
        }
      })
      .catch((err) => console.error('[Push] import pushNotificationService failed:', err.message));

    // Send via channels (respect quiet hours)
    if (pref && pref.isQuietHours() && options.priority !== 'urgent') {
      // Queue for later or skip
    } else {
      // Send immediately
      for (const channel of channels) {
        if (channel === 'inapp') continue;

        // Get user details
        let userEmail, userPhone, userName;
        if (userModel === 'Staff') {
          const staff = await import('../models/Staff.js').then((m) => m.default.findById(userId));
          userEmail = staff?.email;
          userPhone = staff?.phone;
          userName = staff?.name;
        } else {
          const student = await import('../models/Student.js').then((m) =>
            m.default.findById(userId)
          );
          userEmail = student?.email;
          userPhone = student?.phone;
          userName = student?.name;
        }

        // Send via channel
        if (channel === 'email' && userEmail) {
          await sendAnnouncementEmail(
            { title, content: message },
            { email: userEmail, name: userName }
          );
        } else if (channel === 'sms' && userPhone) {
          await sendAnnouncementSMS(userPhone, title, message);
        } else if (channel === 'whatsapp' && userPhone) {
          await sendAnnouncementWhatsApp(userPhone, 'notification', { title, message });
        }
      }
    }

    return notification;
  } catch (error) {
    console.error('Error sending notification:', error);
    throw error;
  }
}

export default router;
