import express from 'express';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import cors from 'cors';
import { createServer } from 'http';
import { createRequire } from 'module';
import { Server as SocketIOServer } from 'socket.io';
import { rateLimit } from 'express-rate-limit';
import { v2 as cloudinary } from 'cloudinary';
import mongoose, { connectDB, Staff } from './database.js';
import messageRoutes from './routes/messages.js';
import feeHeadsRoutes from './routes/feeHeads.js';
import studentFeesRoutes from './routes/studentFees.js';
import feeSettingsRoutes from './routes/feeSettings.js';
import feesRoutes from './routes/fees.js';
import staffAttendanceRoutes from './routes/staffAttendance.js';
import payrollRoutes from './routes/payroll.js';
import announcementRoutes from './routes/announcements.js';
import reminderRoutes from './routes/reminders.js';
import notificationRoutes from './routes/notifications.js';
import callRoutes from './routes/calls.js';
import visitorsRoutes from './routes/visitors.js';
import gatePassesRoutes from './routes/gatePasses.js';
import frontDeskRoutes from './routes/frontDesk.js';
import classesEnhancedRoutes from './routes/classesEnhanced.js';
import teacherAssignmentsRoutes from './routes/teacherAssignments.js';
import teacherTimetableRoutes from './routes/teacherTimetable.js';
import validationRoutes from './routes/validation.js';
import timetableRoutes from './routes/timetable.js';
import substitutionRoutes from './routes/substitutions.js';
import substitutionAlertsRoutes from './routes/substitutionAlerts.js';
import timetableCleanupRoutes from './routes/timetableCleanup.js';
import settingsRoutes from './routes/settings.js';
import trashRoutes from './routes/trash.js';
import parentAuthRoutes from './routes/parentAuth.js';
import parentDataRoutes from './routes/parentData.js';
import parentMessagingRoutes from './routes/parentMessaging.js';
import parentManagementRoutes from './routes/parentManagement.js';
import homeworkRoutes from './routes/homework.js';
import teacherLeavesRoutes from './routes/teacherLeaves.js';
import mobileRoutes from './routes/mobile.js';
import pushNotificationsRoutes from './routes/pushNotifications.js';
import payslipsRoutes from './routes/payslips.js';
import calendarEventsRoutes from './routes/calendarEvents.js';
import permissionRoutes from './routes/permissions.js';
import classSettingsRoutes from './routes/classSettings.js';
import intakeFormsRoutes from './routes/intakeForms.js';
import publicRoutes from './routes/public.js';
import aiRoutes from './routes/ai.js';
import authRoutes from './routes/auth.js';
import uploadRoutes from './routes/upload.js';
import staffRoutes from './routes/staff.js';
import systemConfigRoutes from './routes/systemConfig.js';
import feeTemplatesRoutes from './routes/feeTemplates.js';
import feeStructureRoutes from './routes/feeStructure.js';
import attendanceRoutes from './routes/attendance.js';
import academicsRoutes from './routes/academics.js';
import classesRoutes from './routes/classes.js';
import studentsRoutes from './routes/students.js';
import billingRoutes from './routes/billing.js';
import superAdminRoutes from './routes/superAdmin.js';
import { initializeChatHandlers } from './socket/chatHandler.js';
import { validateEnvironment, config } from './config/environment.js';
import { authenticate } from './middleware/auth.js';
import { authenticateParent } from './middleware/parentAuth.js';
import { initializeSocket } from './utils/socketEmitter.js';
import { createLogger } from './utils/logger.js';
import { bootstrapTenantContext } from './services/tenantBootstrapService.js';

const logger = createLogger('Server');
const require = createRequire(import.meta.url);
const { version } = require('./package.json');

validateEnvironment();

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled rejection');
  process.exit(1);
});

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;
const httpServer = createServer(app);

const getDatabaseStatus = () => {
  switch (mongoose.connection.readyState) {
    case 1:
      return 'connected';
    case 2:
      return 'connecting';
    case 3:
      return 'disconnecting';
    default:
      return 'disconnected';
  }
};

const healthHandler = (_req, res) => {
  const db = getDatabaseStatus();
  const memUsage = process.memoryUsage();
  const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  const isHealthy = db === 'connected';

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ok' : 'error',
    db,
    uptime: Math.round(process.uptime()),
    memory: { heapUsedMB: memMB },
    version,
    timestamp: new Date().toISOString(),
  });
};

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  },
  transports: ['websocket', 'polling']
});

app.set('io', io);
initializeSocket(io);

if (config.cloudinary.configured) {
  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret
  });
} else {
  logger.warn('Cloudinary not configured. File uploads will use base64 fallback.');
}

logger.debug({ corsOrigins: config.corsOrigins }, 'CORS origins configured');

app.use(cors({
  origin(origin, callback) {
    // Allow server-to-server (no origin) only in non-production
    if (!origin) {
      if (config.isDevelopment) return callback(null, true);
      return callback(null, false);
    }

    const allowedOrigins = config.corsOrigins;
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Wildcard matching only for explicitly listed wildcard patterns (dev LAN)
    const isAllowed = allowedOrigins.some((allowedOrigin) => {
      if (!allowedOrigin.includes('*')) return false;
      // Escape regex special chars except * which we convert to .*
      const escaped = allowedOrigin.replace(/[-[\]{}()+?.,\\^$|#\s]/g, '\\$&').replace(/\*/g, '.*');
      return new RegExp(`^${escaped}$`).test(origin);
    });

    if (isAllowed) {
      return callback(null, true);
    }

    logger.warn({ origin, allowedOrigins }, 'Rejected CORS origin');
    callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Auth-Mode'],
}));

app.use(helmet({
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(mongoSanitize());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    return req.path === '/health' || req.path.startsWith('/static');
  }
});

app.use('/api/', limiter);

initializeChatHandlers(io);
app.locals.io = io;
app.locals.Staff = Staff;

app.use('/api/auth', authRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/fee-heads', feeHeadsRoutes);
app.use('/api/student-fees', studentFeesRoutes);
app.use('/api/fee-settings', feeSettingsRoutes);
app.use('/api/fees', feesRoutes);
app.use('/api/fee-templates', feeTemplatesRoutes);
app.use('/api/fee-structure', feeStructureRoutes);
app.use('/api/staff-attendance', staffAttendanceRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/payslips', payslipsRoutes);
app.use('/api/permissions', permissionRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/visitors', visitorsRoutes);
app.use('/api/gate-passes', gatePassesRoutes);
app.use('/api/front-desk', frontDeskRoutes);
app.use('/api/classes-enhanced', classesEnhancedRoutes);
app.use('/api/teacher-assignments', teacherAssignmentsRoutes);
app.use('/api/teacher-timetable', teacherTimetableRoutes);
app.use('/api/validation', validationRoutes);
app.use('/api/timetable', timetableRoutes);
app.use('/api/substitutions', substitutionRoutes);
app.use('/api/substitution-alerts', substitutionAlertsRoutes);
app.use('/api/timetable-cleanup', timetableCleanupRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/trash', authenticate, trashRoutes);
app.use('/api/class-settings', classSettingsRoutes);
app.use('/api/classes', classesRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api', academicsRoutes);
app.use('/api', systemConfigRoutes);
app.use('/api', intakeFormsRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/parent/auth', parentAuthRoutes);
app.use('/api/parent', authenticateParent, parentDataRoutes);
app.use('/api/parent/messages', parentMessagingRoutes);
app.use('/api/parents', authenticate, parentManagementRoutes);
app.use('/api/mobile', mobileRoutes);
app.use('/api/homework', homeworkRoutes);
app.use('/api/teacher-leaves', teacherLeavesRoutes);
app.use('/api/push-notifications', pushNotificationsRoutes);
app.use('/api', calendarEventsRoutes);

// Global error handler — must be after all routes, 4 parameters required
app.use((err, req, res, next) => {
  logger.error({ err: err.message, path: req.path, method: req.method }, 'Unhandled error');
  const statusCode = err.status || err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message;
  res.status(statusCode).json({ error: message });
});

httpServer.listen(PORT, async () => {
  logger.info({ port: PORT }, 'Server started');
  logger.info({ environment: process.env.NODE_ENV || 'development' }, 'Runtime environment');

  try {
    await connectDB();
    await bootstrapTenantContext();
  } catch (error) {
    logger.error({ err: error }, 'Database connection failed');
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
});
