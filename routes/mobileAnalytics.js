/**
 * SAPP-27: Mobile analytics ingestion endpoint.
 *
 * POST /api/v1/mobile/analytics
 *
 * Receives batched events from the staff app (screen views, user actions,
 * session markers) and records them into the existing business metrics
 * infrastructure (SchoolMetricSnapshot via recordRequest + UserDayActivity).
 *
 * All tracking is best-effort — failures never block the response.
 */

import express from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { recordRequest } from '../services/businessMetricsService.js';
import UserDayActivity from '../models/UserDayActivity.js';

const router = express.Router();
router.use(authenticate);

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const eventSchema = z.object({
  event: z.string().min(1).max(100),
  screen: z.string().max(100).optional(),
  props: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  ts: z.number().optional(),
});

const batchSchema = z.object({
  events: z.array(eventSchema).min(1).max(100),
  sessionId: z.string().max(100).optional(),
});

// ─── Screen → API path mapping ────────────────────────────────────────────────
// Maps screen names to a backend-style path so businessMetricsService.detectModule
// categorises the event under the correct feature bucket in SchoolMetricSnapshot.

const SCREEN_PATH_MAP = {
  AttendanceScreen: '/attendance',
  AttendanceHistoryScreen: '/attendance',
  ClassesScreen: '/classes',
  ClassDetailScreen: '/classes',
  ClassStudentsScreen: '/classes',
  ExamsScreen: '/academics',
  ExamDetailScreen: '/academics',
  ExamScheduleScreen: '/exam-schedule',
  ExamScheduleDetailScreen: '/exam-schedule',
  CreateExamScreen: '/academics',
  ResultsEntryScreen: '/academics',
  StudentsListScreen: '/students',
  StudentDetailScreen: '/students',
  StudentRemarksScreen: '/students',
  ReportCardScreen: '/students',
  HomeworkListScreen: '/homework',
  CreateHomeworkScreen: '/homework',
  HomeworkSubmissionsScreen: '/homework',
  NotificationsScreen: '/notifications',
  NotificationPreferencesScreen: '/notifications',
  AnnouncementsListScreen: '/announcements',
  AnnouncementDetailScreen: '/announcements',
  CreateAnnouncementScreen: '/announcements',
  ChatScreen: '/messages',
  ChatDetailScreen: '/messages',
  TimetableScreen: '/timetable',
  PayslipsScreen: '/payroll',
  LeaveRequestsScreen: '/staff-attendance',
  SelfAttendanceScreen: '/staff-attendance',
  ProfileScreen: '/mobile',
  EditProfileScreen: '/mobile',
  CalendarScreen: '/mobile',
  HomeScreen: '/mobile',
};

// ─── POST /api/v1/mobile/analytics ───────────────────────────────────────────

router.post('/', (req, res) => {
  const parsed = batchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid analytics payload',
      details: parsed.error.flatten().fieldErrors,
    });
  }

  // Respond immediately — tracking is fire-and-forget
  res.json({ received: parsed.data.events.length });

  setImmediate(async () => {
    try {
      const schoolId = req.user.schoolId;
      const userId = req.user._id;
      const userAgent = req.headers['user-agent'] || 'staff-app';
      const { events } = parsed.data;

      // Record each screen_view event as a feature request in SchoolMetricSnapshot
      for (const ev of events) {
        if (ev.event === 'screen_view' && ev.screen) {
          const path = SCREEN_PATH_MAP[ev.screen] || '/mobile';
          recordRequest(String(schoolId), path, userAgent);
        }
      }

      // Upsert UserDayActivity so this session counts toward DAU
      const date = new Date().toISOString().slice(0, 10);
      await UserDayActivity.updateOne(
        { schoolId, userId, date },
        { $setOnInsert: { schoolId, userId, date, client: 'mobile', recordedAt: new Date() } },
        { upsert: true }
      );
    } catch (err) {
      // Silent — analytics must never surface errors to the client
      console.error('[mobileAnalytics] processing error:', err.message);
    }
  });
});

export default router;
