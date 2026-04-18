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
import Staff from '../models/Staff.js';
import Student from '../models/Student.js';
import Parent from '../models/Parent.js';
import pushNotificationService from '../services/pushNotificationService.js';

const router = express.Router();
router.use(authenticate);

const getUserModel = (user) => {
  const normalizedRole = String(user?.role || '').toLowerCase();
  if (normalizedRole === 'parent') return 'Parent';
  if (normalizedRole === 'student') return 'Student';
  return 'Staff';
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

    // Always tenant-scope notifications so a user who legitimately belongs
    // to multiple schools (group-admin / cross-posted staff) doesn't see
    // notifications from another tenant in the current session view.
    const query = {
      userId: user.id,
      userModel: getUserModel(user),
      ...(user.schoolId ? { schoolId: user.schoolId } : {}),
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
    const unreadCount = await Notification.getUnreadCount(user.id, query.userModel, user.schoolId);

    res.json({
      data: notifications,
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
      return res.status(400).json({ error: req.t('common:errors.unauthorized') });
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

// GET /api/notifications/unread-count - Lightweight unread count for polling
router.get('/unread-count', async (req, res) => {
  try {
    const user = req.user;
    const userModel = getUserModel(user);
    const count = await Notification.getUnreadCount(user.id, userModel, user.schoolId);
    res.json({ count });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({ error: 'Failed to fetch unread count' });
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

    await Notification.markAllAsReadForUser(user.id, userModel, user.schoolId);

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

// DELETE /api/notifications/clear-all - Clear all notifications for the user
router.delete('/clear-all', async (req, res) => {
  try {
    const user = req.user;
    const userModel = getUserModel(user);

    await Notification.deleteMany({
      userId: user.id,
      userModel,
    });

    res.json({ message: 'All notifications cleared' });
  } catch (error) {
    console.error('Error clearing notifications:', error);
    res.status(500).json({ error: 'Failed to clear notifications' });
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

/**
 * Calculate the Date when quiet hours end, so queued notifications can be delivered.
 * Uses the user's configured timezone to determine the correct UTC time.
 * @param {Object} quietHours - { enabled, startTime, endTime, timezone }
 * @returns {Date} The next time quiet hours end (as UTC Date)
 */
function getQuietHoursEndTime(quietHours) {
  const tz = quietHours.timezone || 'Asia/Kolkata';
  const [endH, endM] = (quietHours.endTime || '08:00').split(':').map(Number);

  // Get current time in the user's timezone
  let currentTimeInTz;
  try {
    currentTimeInTz = new Date().toLocaleTimeString('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    currentTimeInTz = new Date().toTimeString().slice(0, 5);
  }

  // Build candidate: today's endTime in the user's timezone
  // We construct an ISO string using the user's timezone date
  let dateInTz;
  try {
    dateInTz = new Date().toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
  } catch {
    dateInTz = new Date().toISOString().slice(0, 10);
  }

  // Create candidate date string and parse it
  const candidateStr = `${dateInTz}T${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00`;

  // Calculate UTC offset for the timezone to convert candidate to UTC
  const now = new Date();
  const candidate = new Date(candidateStr);

  // Use a simpler approach: calculate offset between server and target timezone
  const tzOffset = getTimezoneOffsetMs(tz);
  candidate.setTime(candidate.getTime() - tzOffset);

  // If the candidate is in the past, move to tomorrow
  if (candidate <= now) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return candidate;
}

/**
 * Get the UTC offset in milliseconds for a given IANA timezone.
 */
function getTimezoneOffsetMs(tz) {
  try {
    const now = new Date();
    // Get the timezone offset by comparing formatted dates
    const utcStr = now.toLocaleString('en-US', { timeZone: 'UTC' });
    const tzStr = now.toLocaleString('en-US', { timeZone: tz });
    return new Date(tzStr).getTime() - new Date(utcStr).getTime();
  } catch {
    // Fallback: assume server timezone offset
    return -new Date().getTimezoneOffset() * 60 * 1000;
  }
}

/**
 * Process notifications that were queued during quiet hours.
 * Called by the Agenda job 'process queued notifications'.
 */
export async function processQueuedNotifications() {
  const now = new Date();

  // Find notifications with scheduledFor <= now that still have pending non-inapp channels
  const queued = await Notification.find({
    scheduledFor: { $lte: now, $ne: null },
    'channels.status': 'pending',
    'channels.type': { $ne: 'inapp' },
  }).limit(100);

  let processed = 0;

  for (const notification of queued) {
    try {
      // Get user details
      let userEmail, userPhone, userName;
      if (notification.userModel === 'Staff') {
        const staff = await Staff.findById(notification.userId);
        userEmail = staff?.email;
        userPhone = staff?.phone;
        userName = staff?.name;
      } else if (notification.userModel === 'Parent') {
        const parent = await Parent.findById(notification.userId);
        userEmail = parent?.email;
        userPhone = parent?.phone;
        userName = parent?.name;
      } else {
        const student = await Student.findById(notification.userId);
        userEmail = student?.email;
        userPhone = student?.phone;
        userName = student?.name;
      }

      // Send via each pending channel
      for (const channel of notification.channels) {
        if (channel.type === 'inapp' || channel.status !== 'pending') continue;

        try {
          if (channel.type === 'email' && userEmail) {
            await sendAnnouncementEmail(
              { title: notification.title, content: notification.message },
              { email: userEmail, name: userName }
            );
            channel.status = 'sent';
            channel.sentAt = new Date();
          } else if (channel.type === 'sms' && userPhone) {
            await sendAnnouncementSMS(userPhone, notification.title, notification.message);
            channel.status = 'sent';
            channel.sentAt = new Date();
          } else if (channel.type === 'whatsapp' && userPhone) {
            await sendAnnouncementWhatsApp(userPhone, 'notification', {
              title: notification.title,
              message: notification.message,
            });
            channel.status = 'sent';
            channel.sentAt = new Date();
          }
        } catch (channelErr) {
          console.error(
            `[QueuedNotif] Failed to send ${channel.type} for ${notification._id}:`,
            channelErr.message
          );
          channel.status = 'failed';
          channel.error = channelErr.message;
        }
      }

      // Clear scheduledFor so it's not picked up again
      notification.scheduledFor = null;
      await notification.save();
      processed++;
    } catch (err) {
      console.error(
        `[QueuedNotif] Error processing notification ${notification._id}:`,
        err.message
      );
    }
  }

  return { processed, total: queued.length };
}

/**
 * Cleanup old notifications to prevent unbounded growth.
 * - Deletes read notifications older than 90 days
 * - Deletes ALL notifications older than 180 days
 * Called by the Agenda job 'cleanup old notifications'.
 */
export async function cleanupOldNotifications() {
  const now = new Date();

  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const oneEightyDaysAgo = new Date(now);
  oneEightyDaysAgo.setDate(oneEightyDaysAgo.getDate() - 180);

  // Delete read notifications older than 90 days
  const readResult = await Notification.deleteMany({
    read: true,
    createdAt: { $lt: ninetyDaysAgo },
  });

  // Delete ALL notifications older than 180 days (even unread)
  const allResult = await Notification.deleteMany({
    createdAt: { $lt: oneEightyDaysAgo },
  });

  return {
    readDeleted: readResult.deletedCount,
    allDeleted: allResult.deletedCount,
  };
}

// Helper function to send notification (used by other modules)
export async function sendNotification(userId, userModel, type, title, message, options = {}) {
  try {
    // Get user preferences
    const pref = await NotificationPreference.findOne({ userId, userModel });

    // Resolve schoolId: prefer explicit option, then look up from user document
    let schoolId = options.schoolId;
    if (!schoolId) {
      try {
        let userDoc;
        if (userModel === 'Staff') userDoc = await Staff.findById(userId).select('schoolId').lean();
        else if (userModel === 'Parent')
          userDoc = await Parent.findById(userId).select('schoolId').lean();
        else userDoc = await Student.findById(userId).select('schoolId').lean();
        schoolId = userDoc?.schoolId;
      } catch {
        /* best-effort */
      }
    }

    // Create in-app notification
    const notification = new Notification({
      ...(schoolId && { schoolId }),
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

    try {
      if (userModel === 'Staff') {
        pushNotificationService
          .sendToUser(userId.toString(), title, message, pushData)
          .catch((err) => console.error('[Push] sendToUser failed:', err.message));
      } else if (userModel === 'Parent') {
        pushNotificationService
          .sendToParent(userId.toString(), title, message, pushData)
          .catch((err) => console.error('[Push] sendToParent failed:', err.message));
      }
    } catch (err) {
      console.error('[Push] pushNotificationService failed:', err.message);
    }

    // Send via channels (respect quiet hours)
    if (pref && pref.isQuietHours() && options.priority !== 'urgent') {
      // Queue for delivery after quiet hours end
      const scheduledFor = getQuietHoursEndTime(pref.quietHours);
      notification.scheduledFor = scheduledFor;
      // Mark non-inapp channels as queued
      notification.channels = notification.channels.map((ch) =>
        ch.type !== 'inapp' ? { ...(ch.toObject?.() || ch), status: 'pending' } : ch
      );
      await notification.save();
    } else {
      // Send immediately — get user details once
      let userEmail, userPhone, userName;
      if (userModel === 'Staff') {
        const staff = await Staff.findById(userId);
        userEmail = staff?.email;
        userPhone = staff?.phone;
        userName = staff?.name;
      } else if (userModel === 'Parent') {
        const parent = await Parent.findById(userId);
        userEmail = parent?.email;
        userPhone = parent?.phone;
        userName = parent?.name;
      } else {
        const student = await Student.findById(userId);
        userEmail = student?.email;
        userPhone = student?.phone;
        userName = student?.name;
      }

      for (const channel of channels) {
        if (channel === 'inapp') continue;

        const channelEntry = notification.channels.find((ch) => ch.type === channel);
        try {
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
          if (channelEntry) {
            channelEntry.status = 'sent';
            channelEntry.sentAt = new Date();
          }
        } catch (channelErr) {
          if (channelEntry) {
            channelEntry.status = 'failed';
            channelEntry.error = channelErr.message;
          }
        }
      }
      await notification.save();
    }

    return notification;
  } catch (error) {
    console.error('Error sending notification:', error);
    throw error;
  }
}

export default router;
