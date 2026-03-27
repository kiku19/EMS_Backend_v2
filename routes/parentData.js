import express from 'express';
import { z } from 'zod';
import { authenticateParent } from '../middleware/parentAuth.js';
import NotificationPreference from '../models/NotificationPreference.js';
import profileRouter from './parent/profile.js';
import academicsRouter from './parent/academics.js';
import feesRouter from './parent/fees.js';
import scheduleRouter from './parent/schedule.js';
import activitiesRouter from './parent/activities.js';

const router = express.Router();

router.use(authenticateParent);

router.use(profileRouter);
router.use(academicsRouter);
router.use(feesRouter);
router.use(scheduleRouter);
router.use(activitiesRouter);

// ─── Notification Settings (simple toggle format for parent app) ─────────────

// Maps parent app toggle keys to NotificationPreference category names
const TOGGLE_TO_CATEGORY = {
  attendance: 'attendance',
  fees: 'payment',
  exams: 'academic',
  results: 'academic',
  announcements: 'announcement',
  chat: 'chat',
  remarks: 'remarks',
};

const DEFAULT_TOGGLES = {
  attendance: true,
  fees: true,
  exams: true,
  results: true,
  announcements: true,
  chat: true,
  remarks: true,
};

const notificationSettingsSchema = z.object({
  attendance: z.boolean().optional(),
  fees: z.boolean().optional(),
  exams: z.boolean().optional(),
  results: z.boolean().optional(),
  announcements: z.boolean().optional(),
  chat: z.boolean().optional(),
  remarks: z.boolean().optional(),
});

/**
 * GET /api/parent/notification-settings
 * Returns the simple toggle format { attendance: true, fees: false, ... }
 */
router.get('/notification-settings', async (req, res) => {
  try {
    const userId = req.user.id;

    const pref = await NotificationPreference.findOne({
      userId,
      userModel: 'Parent',
    }).lean();

    if (!pref || !pref.preferences || pref.preferences.length === 0) {
      return res.json({ settings: { ...DEFAULT_TOGGLES } });
    }

    // Convert structured preferences back to simple toggles
    const settings = { ...DEFAULT_TOGGLES };
    for (const [toggleKey, category] of Object.entries(TOGGLE_TO_CATEGORY)) {
      const catPref = pref.preferences.find((p) => p.category === category);
      if (catPref) {
        // For 'academic' category, check for specific type (exams vs results)
        if (toggleKey === 'exams' || toggleKey === 'results') {
          const notif = catPref.notifications.find((n) => n.type === toggleKey);
          if (notif) {
            settings[toggleKey] = notif.enabled !== false;
          }
        } else {
          // Category-level: if any notification is explicitly disabled, toggle is off
          const firstNotif = catPref.notifications[0];
          settings[toggleKey] = firstNotif ? firstNotif.enabled !== false : true;
        }
      }
    }

    res.json({ settings });
  } catch (error) {
    console.error('Error fetching parent notification settings:', error);
    res.status(500).json({ error: 'Failed to fetch notification settings' });
  }
});

/**
 * PUT /api/parent/notification-settings
 * Accepts the simple toggle format and persists to NotificationPreference
 */
router.put('/notification-settings', async (req, res) => {
  try {
    const userId = req.user.id;
    const schoolId = req.user.schoolId;
    const toggles = notificationSettingsSchema.parse(req.body);

    let pref = await NotificationPreference.findOne({
      userId,
      userModel: 'Parent',
    });

    if (!pref) {
      pref = new NotificationPreference({
        userId,
        userModel: 'Parent',
        role: 'parent',
        schoolId,
        preferences: [],
      });
    }

    // Build structured preferences from toggles
    // Group toggles by category, merging where multiple toggles map to same category
    const categoryMap = {};
    for (const [toggleKey, enabled] of Object.entries(toggles)) {
      const category = TOGGLE_TO_CATEGORY[toggleKey];
      if (!category) continue;
      if (!categoryMap[category]) {
        categoryMap[category] = { category, notifications: [] };
      }
      categoryMap[category].notifications.push({
        type: toggleKey,
        enabled,
        channels: { inapp: enabled, email: false, sms: false, whatsapp: false },
      });
    }

    // Merge with existing preferences (preserve any category not in toggles)
    const existingCategories = new Set(Object.keys(categoryMap));
    const preserved = (pref.preferences || []).filter((p) => !existingCategories.has(p.category));
    pref.preferences = [...preserved, ...Object.values(categoryMap)];

    await pref.save();

    res.json({ settings: { ...DEFAULT_TOGGLES, ...toggles } });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    console.error('Error saving parent notification settings:', error);
    res.status(500).json({ error: 'Failed to save notification settings' });
  }
});

export default router;
