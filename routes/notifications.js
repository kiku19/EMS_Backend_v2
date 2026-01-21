import express from 'express';
import Notification from '../models/Notification.js';
import NotificationPreference from '../models/NotificationPreference.js';
import { sendAnnouncementEmail } from '../services/emailService.js';
import { sendAnnouncementSMS } from '../services/smsService.js';
import { sendAnnouncementWhatsApp } from '../services/whatsappService.js';
import { verifyToken } from '../middleware/auth.js';

const router = express.Router();
router.use(verifyToken);

// GET /api/notifications - Get user notifications
router.get('/', async (req, res) => {
  try {
    const user = req.user;
    const { unreadOnly, type, limit = 50 } = req.query;

    const query = {
      userId: user.id,
      userModel: user.role === 'admin' || user.role === 'staff' ? 'Staff' : 'Student'
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
      unreadCount
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// PUT /api/notifications/:id/read - Mark notification as read
router.put('/:id/read', async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);

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
    const userModel = user.role === 'admin' || user.role === 'staff' ? 'Staff' : 'Student';

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
    await Notification.findByIdAndDelete(req.params.id);
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
    const userModel = user.role === 'admin' || user.role === 'staff' ? 'Staff' : 'Student';

    let preferences = await NotificationPreference.findOne({
      userId: user.id,
      userModel
    }).lean();

    // If no preferences exist, create default
    if (!preferences) {
      preferences = await NotificationPreference.create({
        userId: user.id,
        userModel,
        role: user.role === 'admin' ? 'admin' : (user.role === 'parent' ? 'parent' : userModel.toLowerCase()),
        preferences: [] // Will be populated with defaults
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
    const userModel = user.role === 'admin' || user.role === 'staff' ? 'Staff' : 'Student';

    const { preferences, quietHours, digestFrequency, emailDigest } = req.body;

    let pref = await NotificationPreference.findOne({
      userId: user.id,
      userModel
    });

    if (!pref) {
      pref = new NotificationPreference({
        userId: user.id,
        userModel,
        role: user.role
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
    const userModel = user.role === 'admin' || user.role === 'staff' ? 'Staff' : 'Student';

    await NotificationPreference.findOneAndDelete({
      userId: user.id,
      userModel
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
      channels: []
    });

    // Determine which channels to use
    let channels = ['inapp'];
    if (pref) {
      const channelPref = pref.getChannelPreferences(type, type);
      if (channelPref.email) channels.push('email');
      if (channelPref.sms) channels.push('sms');
      if (channelPref.whatsapp) channels.push('whatsapp');
    }

    notification.channels = channels.map(ch => ({
      type: ch,
      status: 'pending'
    }));

    await notification.save();

    // Send via channels (respect quiet hours)
    if (pref && pref.isQuietHours() && options.priority !== 'urgent') {
      // Queue for later or skip
      console.log('Quiet hours active, notification queued');
    } else {
      // Send immediately
      for (const channel of channels) {
        if (channel === 'inapp') continue;

        // Get user details
        let userEmail, userPhone, userName;
        if (userModel === 'Staff') {
          const staff = await import('../models/Staff.js').then(m => m.default.findById(userId));
          userEmail = staff?.email;
          userPhone = staff?.phone;
          userName = staff?.name;
        } else {
          const student = await import('../models/Student.js').then(m => m.default.findById(userId));
          userEmail = student?.email;
          userPhone = student?.phone;
          userName = student?.name;
        }

        // Send via channel
        if (channel === 'email' && userEmail) {
          await sendAnnouncementEmail({ title, content: message }, { email: userEmail, name: userName });
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
