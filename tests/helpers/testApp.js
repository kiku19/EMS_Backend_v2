import express from 'express';
import { Staff, Student } from '../../database.js';
import { authenticate } from '../../middleware/auth.js';
import { i18nMiddleware } from '../../middleware/i18n.js';
import { addApiVersionHeader, deprecationWarning } from '../../middleware/apiVersion.js';
import academicsRoutes from '../../routes/academics.js';
import frontDeskRoutes from '../../routes/frontDesk.js';
import gatePassesRoutes from '../../routes/gatePasses.js';
import visitorsRoutes from '../../routes/visitors.js';
import aiRoutes from '../../routes/ai.js';
import authRoutes from '../../routes/auth.js';
import attendanceRoutes from '../../routes/attendance.js';
import announcementRoutes from '../../routes/announcements.js';
import billingRoutes from '../../routes/billing.js';
import dashboardRoutes from '../../routes/dashboard.js';
import calendarEventsRoutes from '../../routes/calendarEvents.js';
import emailCampaignsRoutes from '../../routes/emailCampaigns.js';
import classesRoutes from '../../routes/classes.js';
import classesEnhancedRoutes from '../../routes/classesEnhanced.js';
import classSettingsRoutes from '../../routes/classSettings.js';
import examScheduleRoutes from '../../routes/examSchedule.js';
import hallTicketsRoutes from '../../routes/hallTickets.js';
import feeHeadsRoutes from '../../routes/feeHeads.js';
import feesRoutes from '../../routes/fees.js';
import feeStructureRoutes from '../../routes/feeStructure.js';
import feeSettingsRoutes from '../../routes/feeSettings.js';
import feeTemplatesRoutes from '../../routes/feeTemplates.js';
import homeworkRoutes from '../../routes/homework.js';
import intakeFormsRoutes from '../../routes/intakeForms.js';
import callRoutes from '../../routes/calls.js';
import messageRoutes from '../../routes/messages.js';
import mobileRoutes from '../../routes/mobile.js';
import notificationRoutes from '../../routes/notifications.js';
import parentAuthRoutes from '../../routes/parentAuth.js';
import parentDataRoutes from '../../routes/parentData.js';
import parentManagementRoutes from '../../routes/parentManagement.js';
import parentMessagingRoutes from '../../routes/parentMessaging.js';
import pushNotificationsRoutes from '../../routes/pushNotifications.js';
import reminderRoutes from '../../routes/reminders.js';
import payrollRoutes from '../../routes/payroll.js';
import searchRoutes from '../../routes/search.js';
import permissionRoutes from '../../routes/permissions.js';
import publicRoutes from '../../routes/public.js';
import settingsRoutes from '../../routes/settings.js';
import staffRoutes from '../../routes/staff.js';
import staffAttendanceRoutes from '../../routes/staffAttendance.js';
import studentFeesRoutes from '../../routes/studentFees.js';
import studentsRoutes from '../../routes/students.js';
import superAdminRoutes from '../../routes/superAdmin.js';
import transportRoutes from '../../routes/transport.js';
import hostelRoutes from '../../routes/hostel.js';
import libraryRoutes from '../../routes/library.js';
import inventoryRoutes from '../../routes/inventory.js';
import systemConfigRoutes from '../../routes/systemConfig.js';
import timetableRoutes from '../../routes/timetable.js';
import timetableCleanupRoutes from '../../routes/timetableCleanup.js';
import teacherTimetableRoutes from '../../routes/teacherTimetable.js';
import trashRoutes from '../../routes/trash.js';
import uploadRoutes from '../../routes/upload.js';
import validationRoutes from '../../routes/validation.js';
import payslipsRoutes from '../../routes/payslips.js';
import teacherLeavesRoutes from '../../routes/teacherLeaves.js';
import studentLeavesRoutes from '../../routes/studentLeaves.js';
import teacherAssignmentsRoutes from '../../routes/teacherAssignments.js';
import substitutionsRoutes from '../../routes/substitutions.js';
import substitutionAlertsRoutes from '../../routes/substitutionAlerts.js';
import backupRoutes from '../../routes/backup.js';
import bulkImportRoutes from '../../routes/bulkImport.js';
import ptmRoutes from '../../routes/ptm.js';
import reportsRoutes from '../../routes/reports.js';
import promotionRoutes from '../../routes/promotion.js';
import twoFactorRoutes from '../../routes/twoFactor.js';
import expensesRoutes from '../../routes/expenses.js';
import gdprRoutes from '../../routes/gdpr.js';
import webhooksRoutes from '../../routes/webhooks.js';
import featureFlagsRoutes from '../../routes/featureFlags.js';
import googleClassroomRoutes from '../../routes/googleClassroom.js';
import ssoRoutes from '../../routes/sso.js';
import apiKeysRoutes from '../../routes/apiKeys.js';
import auditLogsRoutes from '../../routes/auditLogs.js';
import { initializeSocket } from '../../utils/socketEmitter.js';
import { authenticateParent } from '../../middleware/auth/parentAuth.js';

function createTestIo() {
  return {
    emit() {},
    to() {
      return {
        emit() {},
      };
    },
  };
}

export function createTestApp() {
  const app = express();
  const io = createTestIo();

  app.use(i18nMiddleware);
  app.use(express.json());
  app.set('io', io);
  app.locals.Staff = Staff;
  app.locals.Student = Student;

  initializeSocket(io);

  // ─── API v1 Router ──────────────────────────────────────────────────────────
  // Mirrors server.js: all routes are registered once on v1Router and mounted at
  // both /api/v1 (canonical) and /api (legacy, backward-compatible). Tests can
  // therefore verify versioned paths and legacy paths using the same app.
  const v1Router = express.Router();

  v1Router.use(addApiVersionHeader);

  // Mount auth + public routes BEFORE wildcard routers so signup/login/refresh/
  // public-form-access don't get trapped by router-level `authenticate`.
  // 2FA routes must mount BEFORE the generic /auth router because authRoutes
  // applies router-level `authenticate`, which would otherwise block the
  // unauthenticated /auth/2fa/verify post-login step.
  v1Router.use('/auth/2fa', twoFactorRoutes);
  v1Router.use('/auth/sso', ssoRoutes);
  v1Router.use('/auth', authRoutes);
  v1Router.use('/public', publicRoutes);
  v1Router.use('/super-admin', superAdminRoutes);
  // Parent routes must mount before wildcard routers (academics, examSchedule,
  // etc.) which apply router-level `authenticate`. Without this ordering,
  // /parent/auth/login falls through into the academics router and is blocked.
  v1Router.use('/parent/auth', parentAuthRoutes);
  v1Router.use('/parent/messages', parentMessagingRoutes);
  v1Router.use('/parent', authenticateParent, parentDataRoutes);
  v1Router.use('/', academicsRoutes);
  v1Router.use('/announcements', announcementRoutes);
  v1Router.use('/billing', billingRoutes);
  v1Router.use('/classes', classesRoutes);
  v1Router.use('/classes-enhanced', classesEnhancedRoutes);
  v1Router.use('/class-settings', classSettingsRoutes);
  v1Router.use('/', examScheduleRoutes);
  v1Router.use('/hall-tickets', hallTicketsRoutes);
  v1Router.use('/fee-heads', feeHeadsRoutes);
  v1Router.use('/fees', feesRoutes);
  v1Router.use('/fee-structure', feeStructureRoutes);
  v1Router.use('/homework', homeworkRoutes);
  v1Router.use('/messages', messageRoutes);
  v1Router.use('/notifications', notificationRoutes);
  v1Router.use('/permissions', permissionRoutes);
  v1Router.use('/settings', settingsRoutes);
  v1Router.use('/staff', staffRoutes);
  v1Router.use('/staff-attendance', staffAttendanceRoutes);
  v1Router.use('/student-fees', studentFeesRoutes);
  v1Router.use('/students', studentsRoutes);
  v1Router.use('/attendance', attendanceRoutes);
  v1Router.use('/timetable', timetableRoutes);
  v1Router.use('/timetable-cleanup', timetableCleanupRoutes);
  v1Router.use('/teacher-timetable', teacherTimetableRoutes);
  v1Router.use('/fee-settings', feeSettingsRoutes);
  v1Router.use('/fee-templates', feeTemplatesRoutes);
  v1Router.use('/payroll', payrollRoutes);
  v1Router.use('/trash', trashRoutes);
  v1Router.use('/upload', uploadRoutes);
  v1Router.use('/mobile', mobileRoutes);
  v1Router.use('/validation', validationRoutes);
  v1Router.use('/', systemConfigRoutes);
  v1Router.use('/', intakeFormsRoutes);
  v1Router.use('/', calendarEventsRoutes);
  v1Router.use('/ai', aiRoutes);
  v1Router.use('/calls', callRoutes);
  v1Router.use('/parents', authenticate, parentManagementRoutes);
  v1Router.use('/push-notifications', pushNotificationsRoutes);
  v1Router.use('/reminders', reminderRoutes);
  v1Router.use('/front-desk', frontDeskRoutes);
  v1Router.use('/gate-passes', gatePassesRoutes);
  v1Router.use('/visitors', visitorsRoutes);
  v1Router.use('/payslips', payslipsRoutes);
  v1Router.use('/teacher-leaves', teacherLeavesRoutes);
  v1Router.use('/student-leaves', studentLeavesRoutes);
  v1Router.use('/teacher-assignments', teacherAssignmentsRoutes);
  v1Router.use('/substitutions', substitutionsRoutes);
  v1Router.use('/substitution-alerts', substitutionAlertsRoutes);
  v1Router.use('/backup', backupRoutes);
  v1Router.use('/bulk-import', bulkImportRoutes);
  v1Router.use('/ptm', ptmRoutes);
  v1Router.use('/reports', reportsRoutes);
  v1Router.use('/promotions', promotionRoutes);
  v1Router.use('/search', searchRoutes);
  v1Router.use('/dashboard', dashboardRoutes);
  v1Router.use('/transport', transportRoutes);
  v1Router.use('/hostel', hostelRoutes);
  v1Router.use('/library', libraryRoutes);
  v1Router.use('/inventory', inventoryRoutes);
  v1Router.use('/email-campaigns', emailCampaignsRoutes);
  v1Router.use('/expenses', expensesRoutes);
  v1Router.use('/gdpr', gdprRoutes);
  v1Router.use('/webhooks', webhooksRoutes);
  v1Router.use('/feature-flags', featureFlagsRoutes);
  v1Router.use('/google-classroom', googleClassroomRoutes);
  v1Router.use('/api-keys', apiKeysRoutes);
  v1Router.use('/audit-logs', auditLogsRoutes);

  // Canonical versioned mount
  app.use('/api/v1', v1Router);

  // Legacy /api mount — keeps existing mobile apps and test fixtures working.
  // Responses include Deprecation + Sunset + Link headers nudging clients to
  // migrate to /api/v1.
  app.use('/api', deprecationWarning, v1Router);

  // Temporary debug error handler
  app.use((err, req, res, next) => {
    console.error('[TEST-ERROR-HANDLER]', err.message, err.stack);
    res.status(500).json({ error: err.message });
  });

  return { app, io };
}
