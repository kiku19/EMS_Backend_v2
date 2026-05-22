import express from 'express';
import { Staff, Student } from '../../database.js';
import { authenticate } from '../../middleware/auth.js';
import { i18nMiddleware } from '../../middleware/i18n.js';
import academicsRoutes from '../../routes/academics.js';
import frontDeskRoutes from '../../routes/frontDesk.js';
import gatePassesRoutes from '../../routes/gatePasses.js';
import visitorsRoutes from '../../routes/visitors.js';
import aiRoutes from '../../routes/ai.js';
import authRoutes from '../../routes/auth.js';
import attendanceRoutes from '../../routes/attendance.js';
import announcementRoutes from '../../routes/announcements.js';
import billingRoutes from '../../routes/billing.js';
import calendarEventsRoutes from '../../routes/calendarEvents.js';
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
import systemConfigRoutes from '../../routes/systemConfig.js';
import timetableRoutes from '../../routes/timetable.js';
import timetableCleanupRoutes from '../../routes/timetableCleanup.js';
import teacherTimetableRoutes from '../../routes/teacherTimetable.js';
import trashRoutes from '../../routes/trash.js';
import uploadRoutes from '../../routes/upload.js';
import validationRoutes from '../../routes/validation.js';
import payslipsRoutes from '../../routes/payslips.js';
import teacherLeavesRoutes from '../../routes/teacherLeaves.js';
import teacherAssignmentsRoutes from '../../routes/teacherAssignments.js';
import substitutionsRoutes from '../../routes/substitutions.js';
import substitutionAlertsRoutes from '../../routes/substitutionAlerts.js';
import backupRoutes from '../../routes/backup.js';
import bulkImportRoutes from '../../routes/bulkImport.js';
import ptmRoutes from '../../routes/ptm.js';
import twoFactorRoutes from '../../routes/twoFactor.js';
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

  // Mount auth + public routes BEFORE wildcard `/api` routers so
  // signup/login/refresh/public-form-access don't get trapped by the
  // router-level `authenticate` on routers mounted at `/api`.
  // 2FA routes must mount BEFORE the generic /api/auth router because
  // authRoutes applies router-level `authenticate`, which would otherwise
  // block the unauthenticated /api/auth/2fa/verify post-login step.
  app.use('/api/auth/2fa', twoFactorRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/public', publicRoutes);
  app.use('/api/super-admin', superAdminRoutes);
  // Parent routes must mount before the wildcard `/api` routers (academics,
  // examSchedule, etc.) which apply router-level `authenticate` to every
  // matching path. Without this ordering, /api/parent/auth/login falls
  // through into the academics router and is blocked with a 401.
  app.use('/api/parent/auth', parentAuthRoutes);
  app.use('/api/parent/messages', parentMessagingRoutes);
  app.use('/api/parent', authenticateParent, parentDataRoutes);
  app.use('/api', academicsRoutes);
  app.use('/api/announcements', announcementRoutes);
  app.use('/api/billing', billingRoutes);
  app.use('/api/classes', classesRoutes);
  app.use('/api/classes-enhanced', classesEnhancedRoutes);
  app.use('/api/class-settings', classSettingsRoutes);
  app.use('/api', examScheduleRoutes);
  app.use('/api/hall-tickets', hallTicketsRoutes);
  app.use('/api/fee-heads', feeHeadsRoutes);
  app.use('/api/fees', feesRoutes);
  app.use('/api/fee-structure', feeStructureRoutes);
  app.use('/api/homework', homeworkRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/permissions', permissionRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/staff', staffRoutes);
  app.use('/api/staff-attendance', staffAttendanceRoutes);
  app.use('/api/student-fees', studentFeesRoutes);
  app.use('/api/students', studentsRoutes);
  app.use('/api/attendance', attendanceRoutes);
  app.use('/api/timetable', timetableRoutes);
  app.use('/api/timetable-cleanup', timetableCleanupRoutes);
  app.use('/api/teacher-timetable', teacherTimetableRoutes);
  app.use('/api/fee-settings', feeSettingsRoutes);
  app.use('/api/fee-templates', feeTemplatesRoutes);
  app.use('/api/payroll', payrollRoutes);
  app.use('/api/trash', trashRoutes);
  app.use('/api/upload', uploadRoutes);
  app.use('/api/mobile', mobileRoutes);
  app.use('/api/validation', validationRoutes);
  app.use('/api', systemConfigRoutes);
  app.use('/api', intakeFormsRoutes);
  app.use('/api', calendarEventsRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/calls', callRoutes);
  app.use('/api/parents', authenticate, parentManagementRoutes);
  app.use('/api/push-notifications', pushNotificationsRoutes);
  app.use('/api/reminders', reminderRoutes);
  app.use('/api/front-desk', frontDeskRoutes);
  app.use('/api/gate-passes', gatePassesRoutes);
  app.use('/api/visitors', visitorsRoutes);
  app.use('/api/payslips', payslipsRoutes);
  app.use('/api/teacher-leaves', teacherLeavesRoutes);
  app.use('/api/teacher-assignments', teacherAssignmentsRoutes);
  app.use('/api/substitutions', substitutionsRoutes);
  app.use('/api/substitution-alerts', substitutionAlertsRoutes);
  app.use('/api/backup', backupRoutes);
  app.use('/api/bulk-import', bulkImportRoutes);
  app.use('/api/ptm', ptmRoutes);
  app.use('/api/search', searchRoutes);

  // Temporary debug error handler
  app.use((err, req, res, next) => {
    console.error('[TEST-ERROR-HANDLER]', err.message, err.stack);
    res.status(500).json({ error: err.message });
  });

  return { app, io };
}
