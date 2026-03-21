import admin, { isFirebaseConfigured } from '../config/firebase.js';
import PushToken from '../models/PushToken.js';
import Parent from '../models/Parent.js';
import { buildPushContent } from '../utils/i18nTemplates.js';

export { buildPushContent };

class PushNotificationService {
  /**
   * Send push notification to a single staff user via PushToken collection
   */
  async sendToUser(userId, title, body, data = {}) {
    if (!isFirebaseConfigured()) {
      return { success: false, message: 'Firebase not configured' };
    }

    const tokens = await PushToken.find({
      user: userId,
      isActive: true,
    });

    if (tokens.length === 0) {
      return { success: false, message: 'No tokens found for user' };
    }

    // Stringify all data values (FCM requires string values)
    const stringData = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));

    const results = [];
    for (const tokenDoc of tokens) {
      const message = {
        notification: { title, body },
        data: stringData,
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
        if (
          error.code === 'messaging/registration-token-not-registered' ||
          error.code === 'messaging/invalid-registration-token'
        ) {
          tokenDoc.isActive = false;
          await tokenDoc.save();
        }
      }
    }

    return results;
  }

  /**
   * Send push notification to a parent user via their embedded fcmTokens
   */
  async sendToParent(parentId, title, body, data = {}) {
    if (!isFirebaseConfigured()) {
      return { success: false, message: 'Firebase not configured' };
    }

    try {
      const parent = await Parent.findById(parentId).select('fcmTokens');

      if (!parent || !parent.fcmTokens || parent.fcmTokens.length === 0) {
        return { success: false, message: 'No FCM tokens found for parent' };
      }

      const tokenList = parent.fcmTokens.map((t) => t.token).filter(Boolean);
      if (tokenList.length === 0) {
        return { success: false, message: 'No valid FCM tokens for parent' };
      }

      // Stringify all data values
      const stringData = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));

      const invalidTokens = [];
      const results = [];

      for (const token of tokenList) {
        const message = {
          notification: { title, body },
          data: stringData,
          token,
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
          results.push({ success: true, token, messageId: response });
        } catch (error) {
          results.push({ success: false, token, error: error.message });
          if (
            error.code === 'messaging/registration-token-not-registered' ||
            error.code === 'messaging/invalid-registration-token'
          ) {
            invalidTokens.push(token);
          }
        }
      }

      // Remove invalid tokens from parent document
      if (invalidTokens.length > 0) {
        parent.fcmTokens = parent.fcmTokens.filter((t) => !invalidTokens.includes(t.token));
        await parent.save();
      }

      return results;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Send notification to multiple users (staff, via PushToken collection)
   */
  async sendToMultipleUsers(userIds, title, body, data = {}) {
    if (!isFirebaseConfigured()) {
      return { success: false, message: 'Firebase not configured' };
    }

    const tokens = await PushToken.find({
      user: { $in: userIds },
      isActive: true,
    });

    if (tokens.length === 0) {
      return { success: false, message: 'No tokens found' };
    }

    // Stringify all data values
    const stringData = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));

    const tokenList = tokens.map((t) => t.token);

    // Use multicast for efficiency (max 500 tokens)
    const message = {
      notification: { title, body },
      data: stringData,
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
      const response = await admin.messaging().sendEachForMulticast(message);

      // Handle failed tokens
      if (response.failureCount > 0) {
        const failedTokens = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            failedTokens.push(tokenList[idx]);
          }
        });

        // Mark failed tokens as inactive
        await PushToken.updateMany({ token: { $in: failedTokens } }, { isActive: false });
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
   * Send to all staff in a school (for announcements, scoped by schoolId)
   */
  async sendToAllStaff(schoolId, title, body, data = {}) {
    if (!isFirebaseConfigured()) {
      return { success: false, message: 'Firebase not configured' };
    }

    const query = { isActive: true, userModel: 'Staff' };
    if (schoolId) query.schoolId = schoolId;

    const tokens = await PushToken.find(query);

    if (tokens.length === 0) {
      return { success: false, message: 'No staff tokens found' };
    }

    // Stringify all data values
    const stringData = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));

    const staffTokenList = tokens.map((t) => t.token);

    // Send in batches of 500
    const results = [];
    for (let i = 0; i < staffTokenList.length; i += 500) {
      const batch = staffTokenList.slice(i, i + 500);
      const message = {
        notification: { title, body },
        data: stringData,
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
        const response = await admin.messaging().sendEachForMulticast(message);
        results.push({
          batchStart: i,
          successCount: response.successCount,
          failureCount: response.failureCount,
        });
      } catch (error) {
        results.push({ batchStart: i, error: error.message });
      }
    }

    return { success: true, results };
  }

  /**
   * Send to all parents of students in a school
   */
  async sendToAllParents(schoolId, title, body, data = {}) {
    if (!isFirebaseConfigured()) {
      return { success: false, message: 'Firebase not configured' };
    }

    try {
      const query = { fcmTokens: { $exists: true, $not: { $size: 0 } } };
      if (schoolId) query.schoolId = schoolId;

      const parents = await Parent.find(query).select('fcmTokens');

      const allTokens = parents.flatMap((p) => p.fcmTokens.map((t) => t.token)).filter(Boolean);

      if (allTokens.length === 0) {
        return { success: false, message: 'No parent FCM tokens found' };
      }

      // Stringify all data values
      const stringData = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));

      const results = [];
      for (let i = 0; i < allTokens.length; i += 500) {
        const batch = allTokens.slice(i, i + 500);
        const message = {
          notification: { title, body },
          data: stringData,
          tokens: batch,
          android: {
            priority: 'high',
            notification: { channelId: 'default-channel-id', sound: 'default' },
          },
        };

        try {
          const response = await admin.messaging().sendEachForMulticast(message);
          results.push({
            batchStart: i,
            successCount: response.successCount,
            failureCount: response.failureCount,
          });
        } catch (error) {
          results.push({ batchStart: i, error: error.message });
        }
      }

      return { success: true, results };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

export default new PushNotificationService();
