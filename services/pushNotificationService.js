const admin = require('../config/firebase');
const PushToken = require('../models/PushToken');

class PushNotificationService {
  /**
   * Send push notification to a single user
   */
  async sendToUser(userId, title, body, data = {}) {
    const tokens = await PushToken.find({
      user: userId,
      isActive: true
    });

    if (tokens.length === 0) {
      return { success: false, message: 'No tokens found for user' };
    }

    const results = [];
    for (const tokenDoc of tokens) {
      const message = {
        notification: { title, body },
        data,
        token: tokenDoc.token,
        android: {
          priority: 'high',
          notification: {
            channelId: 'default-channel-id',
            sound: 'default',
          },
        },
        apns: {
          payload: {
            aps: {
              badge: 1,
              sound: 'default',
            },
          },
        },
      };

      try {
        const response = await admin.messaging().send(message);
        results.push({ success: true, token: tokenDoc.token, messageId: response });

        // Update lastUsedAt
        tokenDoc.lastUsedAt = new Date();
        await tokenDoc.save();
      } catch (error) {
        results.push({ success: false, token: tokenDoc.token, error: error.message });

        // Mark token as inactive if it's invalid
        if (error.code === 'messaging/registration-token-not-registered') {
          tokenDoc.isActive = false;
          await tokenDoc.save();
        }
      }
    }

    return results;
  }

  /**
   * Send notification to multiple users
   */
  async sendToMultipleUsers(userIds, title, body, data = {}) {
    const tokens = await PushToken.find({
      user: { $in: userIds },
      isActive: true
    });

    if (tokens.length === 0) {
      return { success: false, message: 'No tokens found' };
    }

    const tokenList = tokens.map(t => t.token);

    // Use multicast for efficiency (max 500 tokens)
    const message = {
      notification: { title, body },
      data,
      tokens: tokenList,
      android: {
        priority: 'high',
        notification: {
          channelId: 'default-channel-id',
          sound: 'default',
        },
      },
    };

    try {
      const response = await admin.messaging().sendMulticast(message);

      // Handle failed tokens
      if (response.failureCount > 0) {
        const failedTokens = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            failedTokens.push(tokenList[idx]);
          }
        });

        // Mark failed tokens as inactive
        await PushToken.updateMany(
          { token: { $in: failedTokens } },
          { isActive: false }
        );
      }

      return {
        success: true,
        successCount: response.successCount,
        failureCount: response.failureCount,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Send to all staff (for announcements)
   */
  async sendToAllStaff(title, body, data = {}) {
    const tokens = await PushToken.find({
      isActive: true
    }).populate('user', 'role');

    // Filter for staff only
    const staffTokens = tokens
      .filter(t => t.user.role && ['Teacher', 'Admin', 'Staff'].includes(t.user.role))
      .map(t => t.token);

    if (staffTokens.length === 0) {
      return { success: false, message: 'No staff tokens found' };
    }

    // Send in batches of 500
    const batches = [];
    for (let i = 0; i < staffTokens.length; i += 500) {
      batches.push(staffTokens.slice(i, i + 500));
    }

    const results = [];
    for (const batch of batches) {
      const message = {
        notification: { title, body },
        data,
        tokens: batch,
        android: {
          priority: 'high',
          notification: {
            channelId: 'default-channel-id',
            sound: 'default',
          },
        },
      };

      try {
        const response = await admin.messaging().sendMulticast(message);
        results.push({
          batch: batches.indexOf(batch),
          successCount: response.successCount,
          failureCount: response.failureCount,
        });
      } catch (error) {
        results.push({
          batch: batches.indexOf(batch),
          error: error.message,
        });
      }
    }

    return { success: true, results };
  }
}

module.exports = new PushNotificationService();
