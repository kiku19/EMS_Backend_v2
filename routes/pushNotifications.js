import express from 'express';
import webpush from 'web-push';
import PushToken from '../models/PushToken.js';
import WebPushSubscription from '../models/WebPushSubscription.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticate);

// Configure VAPID keys if provided
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_CONTACT_EMAIL || 'admin@school.com'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

/**
 * @route   POST /api/push-notifications/register-token
 * @desc    Register/update FCM push notification token for staff
 * @access  Private
 */
router.post('/register-token', authenticate, async (req, res) => {
  try {
    const { token, platform, appVersion, osVersion, deviceId } = req.body;
    const userId = req.user?.id; // From auth middleware
    const schoolId = req.user?.schoolId;

    // Validate required fields
    if (!token || !platform) {
      return res.status(400).json({
        success: false,
        message: 'Token and platform are required',
      });
    }

    // Validate platform
    if (!['ios', 'android', 'web'].includes(platform)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid platform. Must be ios, android, or web',
      });
    }

    if (!schoolId) {
      return res.status(400).json({
        success: false,
        message: 'schoolId is required',
      });
    }

    // Check if token already exists
    const existingToken = await PushToken.findOne({ token });

    if (existingToken) {
      // Update existing token
      existingToken.user = userId;
      existingToken.userModel = 'Staff';
      existingToken.schoolId = schoolId;
      existingToken.platform = platform;
      existingToken.appVersion = appVersion;
      existingToken.osVersion = osVersion;
      existingToken.deviceId = deviceId;
      existingToken.lastUsedAt = new Date();
      existingToken.isActive = true;
      await existingToken.save();

      return res.json({
        success: true,
        message: 'Token updated successfully',
      });
    }

    // Create new token
    const newToken = new PushToken({
      user: userId,
      userModel: 'Staff',
      schoolId,
      token,
      platform,
      appVersion,
      osVersion,
      deviceId,
    });

    await newToken.save();

    res.status(201).json({
      success: true,
      message: 'Token registered successfully',
      tokenId: newToken._id,
    });
  } catch (error) {
    console.error('Error registering token:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

/**
 * @route   DELETE /api/push-notifications/unregister-token
 * @desc    Unregister push notification token
 * @access  Private
 */
router.delete('/unregister-token', authenticate, async (req, res) => {
  try {
    const { token } = req.body;
    const userId = req.user?.id;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token is required',
      });
    }

    const deleted = await PushToken.findOneAndDelete({
      user: userId,
      token,
    });

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Token not found',
      });
    }

    res.json({
      success: true,
      message: 'Token unregistered successfully',
    });
  } catch (error) {
    console.error('Error unregistering token:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

/**
 * @route   GET /api/push-notifications/my-tokens
 * @desc    Get all tokens for current user
 * @access  Private
 */
router.get('/my-tokens', authenticate, async (req, res) => {
  try {
    const userId = req.user?.id;

    const tokens = await PushToken.find({
      user: userId,
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      tokens: tokens.map((t) => ({
        id: t._id,
        platform: t.platform,
        appVersion: t.appVersion,
        osVersion: t.osVersion,
        isActive: t.isActive,
        lastUsedAt: t.lastUsedAt,
        createdAt: t.createdAt,
      })),
    });
  } catch (error) {
    console.error('Error fetching tokens:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

/**
 * @route   POST /api/push-notifications/test
 * @desc    Send test notification to current user
 * @access  Private
 */
router.post('/test', authenticate, async (req, res) => {
  try {
    const userId = req.user?.id;
    const {
      title = 'Test Notification',
      body = 'This is a test notification from the school app',
    } = req.body;

    const { default: pushNotificationService } =
      await import('../services/pushNotificationService.js');
    const result = await pushNotificationService.sendToUser(userId, title, body, {
      type: 'test',
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: 'Test notification sent',
      result,
    });
  } catch (error) {
    console.error('Error sending test notification:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

/**
 * @route   GET /api/push-notifications/vapid-public-key
 * @desc    Get VAPID public key for web push subscription
 * @access  Private
 */
router.get('/vapid-public-key', authenticate, (req, res) => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return res.status(503).json({ success: false, message: 'Web push not configured' });
  }
  res.json({ success: true, publicKey });
});

/**
 * @route   POST /api/push-notifications/web-subscribe
 * @desc    Save a Web Push (VAPID) subscription
 * @access  Private
 */
router.post('/web-subscribe', authenticate, async (req, res) => {
  try {
    const { endpoint, keys, expirationTime, userAgent } = req.body;
    const userId = req.user?.id;
    const schoolId = req.user?.schoolId;

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res
        .status(400)
        .json({ success: false, message: 'endpoint, keys.p256dh, and keys.auth are required' });
    }

    if (!schoolId) {
      return res.status(400).json({ success: false, message: 'schoolId is required' });
    }

    await WebPushSubscription.findOneAndUpdate(
      { endpoint },
      {
        user: userId,
        userModel: 'Staff',
        schoolId,
        endpoint,
        keys,
        expirationTime: expirationTime ? new Date(expirationTime) : null,
        userAgent,
        isActive: true,
      },
      { upsert: true, new: true }
    );

    res.status(201).json({ success: true, message: 'Web push subscription saved' });
  } catch (error) {
    console.error('Error saving web push subscription:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

/**
 * @route   DELETE /api/push-notifications/web-unsubscribe
 * @desc    Remove a Web Push subscription
 * @access  Private
 */
router.delete('/web-unsubscribe', authenticate, async (req, res) => {
  try {
    const { endpoint } = req.body;
    const userId = req.user?.id;

    if (!endpoint) {
      return res.status(400).json({ success: false, message: 'endpoint is required' });
    }

    await WebPushSubscription.findOneAndUpdate({ endpoint, user: userId }, { isActive: false });

    res.json({ success: true, message: 'Web push subscription removed' });
  } catch (error) {
    console.error('Error removing web push subscription:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

export default router;
