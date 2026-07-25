import express from 'express';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import cors from 'cors';
import { createServer } from 'http';
import { createRequire } from 'module';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { isRedisReady, createRedisOptions } from './config/redis.js';
import { v2 as cloudinary } from 'cloudinary';
import mongoose, { connectDB, Staff, getReplicaSetStatus } from './database.js';
import messageRoutes from './routes/messages.js';
import feeHeadsRoutes from './routes/feeHeads.js';
import studentFeesRoutes from './routes/studentFees.js';
import feeSettingsRoutes from './routes/feeSettings.js';
import feeReminderConfigRoutes from './routes/feeReminderConfig.js';
import feesRoutes from './routes/fees.js';
import staffAttendanceRoutes from './routes/staffAttendance.js';
import payrollRoutes from './routes/payroll.js';
import expensesRoutes from './routes/expenses.js';
import vendorsRoutes from './routes/vendors.js';
import announcementRoutes from './routes/announcements.js';
import communicationLogsRoutes from './routes/communicationLogs.js';
import emailCampaignsRoutes from './routes/emailCampaigns.js';
import trackingRoutes from './routes/tracking.js';
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
import dataCleanupRoutes from './routes/dataCleanup.js';
import seedDummyDataRoutes from './routes/seedDummyData.js';
import demoRoutes from './routes/demo.js';
import settingsRoutes from './routes/settings.js';
import curriculaRoutes from './routes/curricula.js';
import trashRoutes from './routes/trash.js';
import backupRoutes from './routes/backup.js';
import parentAuthRoutes from './routes/parentAuth.js';
import parentDataRoutes from './routes/parentData.js';
import parentMessagingRoutes from './routes/parentMessaging.js';
import parentManagementRoutes from './routes/parentManagement.js';
import homeworkRoutes from './routes/homework.js';
import teacherLeavesRoutes from './routes/teacherLeaves.js';
import studentLeavesRoutes from './routes/studentLeaves.js';
import mobileRoutes from './routes/mobile.js';
import mobileAnalyticsRoutes from './routes/mobileAnalytics.js';
import pushNotificationsRoutes from './routes/pushNotifications.js';
import payslipsRoutes from './routes/payslips.js';
import calendarEventsRoutes from './routes/calendarEvents.js';
import permissionRoutes from './routes/permissions.js';
import classSettingsRoutes from './routes/classSettings.js';
import intakeFormsRoutes from './routes/intakeForms.js';
import publicRoutes from './routes/public.js';
import aiRoutes from './routes/ai.js';
import authRoutes from './routes/auth.js';
import ssoRoutes from './routes/sso.js';
import twoFactorRoutes from './routes/twoFactor.js';
import uploadRoutes from './routes/upload.js';
import staffRoutes from './routes/staff.js';
import systemConfigRoutes from './routes/systemConfig.js';
import feeTemplatesRoutes from './routes/feeTemplates.js';
import feeStructureRoutes from './routes/feeStructure.js';
import attendanceRoutes from './routes/attendance.js';
import academicsRoutes from './routes/academics.js';
import academicPerformanceRoutes from './routes/academicPerformance.js';
import cbseReportCardRoutes from './routes/cbseReportCard.js';
import icseReportCardRoutes from './routes/icseReportCard.js';
import cceRoutes from './routes/cce.js';
import examScheduleRoutes from './routes/examSchedule.js';
import examHallsRoutes from './routes/examHalls.js';
import classesRoutes from './routes/classes.js';
import studentsRoutes from './routes/students.js';
import promotionRoutes from './routes/promotion.js';
import billingRoutes from './routes/billing.js';
import referralRoutes from './routes/referral.js';
import couponRoutes from './routes/coupons.js';
import featureFlagsRoutes from './routes/featureFlags.js';
import onboardingRoutes from './routes/onboarding.js';
import superAdminRoutes from './routes/superAdmin.js';
import superAdminActivityRoutes from './routes/superAdminActivity.js';
import superAdminTrashRoutes from './routes/superAdminTrash.js';
import superAdminBillingRoutes from './routes/superAdminBilling.js';
import superAdminLifecycleRoutes from './routes/superAdminLifecycle.js';
import schoolGroupsRoutes from './routes/schoolGroups.js';
import reportsRoutes from './routes/reports.js';
import exportRoutes from './routes/export.js';
import hallTicketsRoutes from './routes/hallTickets.js';
import bulkImportRoutes from './routes/bulkImport.js';
import bulkOpsRoutes from './routes/bulkOps.js';
import jobsRoutes from './routes/jobs.js';
import libraryRoutes from './routes/library.js';
import transportRoutes from './routes/transport.js';
import hostelRoutes from './routes/hostel.js';
import { initializeChatHandlers } from './socket/chatHandler.js';
import { validateEnvironment, config } from './config/environment.js';
import { authenticate } from './middleware/auth.js';
import { authenticateParent } from './middleware/parentAuth.js';
import { moduleAccessGuard } from './middleware/auth/moduleAccess.js';
import schoolStatusGuard from './middleware/auth/schoolStatusGuard.js';
import { apiUsageTracker } from './middleware/apiUsageTracker.js';
import { initializeSocket } from './utils/socketEmitter.js';
import { createLogger } from './utils/logger.js';
import { bootstrapTenantContext } from './services/tenantBootstrapService.js';
import { startAgenda } from './config/agenda.js';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './docs/swaggerDef.js';
import { addApiVersionHeader, deprecationWarning } from './middleware/apiVersion.js';
import { auditLogMiddleware } from './middleware/auditLog.js';
import {
  createTenantRateLimiter,
  createAuthRateLimiter,
  createGlobalRateLimiter,
  isAuthRateLimitingDisabled,
} from './middleware/tenantRateLimit.js';
import auditLogsRoutes from './routes/auditLogs.js';
import dashboardRoutes from './routes/dashboard.js';
import webhooksRoutes from './routes/webhooks.js';
import apiKeysRoutes from './routes/apiKeys.js';
import ptmRoutes from './routes/ptm.js';
import searchRoutes from './routes/search.js';
import gdprRoutes from './routes/gdpr.js';
import archivalRoutes from './routes/archival.js';
import inventoryRoutes from './routes/inventory.js';
import tallyRoutes from './routes/tally.js';
import googleClassroomRoutes from './routes/googleClassroom.js';
import npsRoutes from './routes/nps.js';
import emailSuppressionRoutes from './routes/emailSuppression.js';
import whatsappRoutes from './routes/whatsapp.js';
import { Sentry } from './utils/sentry.js';
import { errorRateTracker } from './middleware/errorRateTracker.js';
import { getErrorRateStats, registerDeployment } from './services/errorRateMonitor.js';
import { startUptimeMonitor, getUptimeStats } from './services/uptimeMonitor.js';
import { initializeSlowQueryMonitor } from './services/slowQueryMonitor.js';
import queryPerformanceRoutes from './routes/queryPerformance.js';
import metricsRoutes from './routes/metrics.js';
import changelogRoutes from './routes/changelog.js';
import knowledgeBaseRoutes from './routes/knowledgeBase.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { httpLogger } from './middleware/httpLogger.js';
import { requestTracingMiddleware } from './middleware/requestTracing.js';
import { i18nMiddleware } from './middleware/i18n.js';
import { getApmStats, startSlaMonitor } from './services/apmService.js';
import { businessMetricsTracker } from './middleware/businessMetricsTracker.js';
import { startFlushTimer } from './services/businessMetricsService.js';
import { startHealthWatchdog } from './services/healthWatchdog.js';

const logger = createLogger('Server');
const require = createRequire(import.meta.url);
const { version } = require('./package.json');

// Tracks whether all startup tasks (DB, agenda, bootstrap) have completed
let serverReady = false;
export const isServerReady = () => serverReady;

validateEnvironment();

let isShuttingDown = false;

function flushAndExit(exitCode) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  // Safety net: force exit even if the logger transport never flushes
  const safetyTimeout = setTimeout(() => process.exit(exitCode), 2500);
  safetyTimeout.unref();

  logger.flush(() => {
    clearTimeout(safetyTimeout);
    process.exit(exitCode);
  });
}

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(error);
  }
  flushAndExit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled rejection');
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
  }
  flushAndExit(1);
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
  const redisConfigured = !!process.env.REDIS_URL;
  const redis = redisConfigured ? (isRedisReady() ? 'ready' : 'unavailable') : 'disabled';
  const isHealthy = db === 'connected';

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ok' : 'error',
    db,
    redis,
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
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  },
  transports: ['websocket', 'polling'],
});

// Wire Redis adapter for Socket.IO (enables multi-instance pub/sub)
// pub and sub MUST be separate connections — Redis pub/sub protocol requirement
if (process.env.REDIS_URL) {
  try {
    const pubClient = new Redis(process.env.REDIS_URL, createRedisOptions('ems-socketio-pub'));
    const subClient = new Redis(process.env.REDIS_URL, createRedisOptions('ems-socketio-sub'));

    pubClient.on('error', (err) =>
      logger.error({ err: err.message }, 'Socket.IO Redis pub client error')
    );
    subClient.on('error', (err) =>
      logger.error({ err: err.message }, 'Socket.IO Redis sub client error')
    );
    pubClient.on('reconnecting', () => logger.info('Socket.IO Redis pub client reconnecting'));
    subClient.on('reconnecting', () => logger.info('Socket.IO Redis sub client reconnecting'));

    io.adapter(createAdapter(pubClient, subClient));
    logger.info('Socket.IO Redis adapter enabled — multi-instance WebSocket broadcast active');
  } catch (err) {
    logger.warn(
      { err: err.message },
      'Socket.IO Redis adapter setup failed — using default in-memory adapter'
    );
  }
}

app.set('io', io);
initializeSocket(io);

if (config.cloudinary.configured) {
  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
  });
} else {
  logger.warn(
    'Cloudinary not configured. Document and chat-attachment uploads will return 503; only staff profile photos fall back to base64 storage. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.'
  );
}

logger.debug({ corsOrigins: config.corsOrigins }, 'CORS origins configured');

app.use(
  cors({
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
        const escaped = allowedOrigin
          .replace(/[-[\]{}()+?.,\\^$|#\s]/g, '\\$&')
          .replace(/\*/g, '.*');
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
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Branch-School-Id',
      'X-Auth-Mode',
      'Cache-Control',
      'Pragma',
      'X-Requested-With',
    ],
  })
);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // Swagger UI requires inline scripts
        styleSrc: ["'self'", "'unsafe-inline'"], // Swagger UI requires inline styles
        imgSrc: ["'self'", 'data:', 'https://res.cloudinary.com'],
        fontSrc: ["'self'", 'https:', 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(mongoSanitize());

app.use(
  express.json({
    limit: '50mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// OBS-03: Assign unique request ID for log correlation across all requests
app.use(requestIdMiddleware);

// OBS-03: Structured HTTP request/response logging (method, url, statusCode, duration, schoolId, userId)
app.use(httpLogger);

// OBS-02: Latency tracking — records p50/p95/p99 per endpoint, sets X-Trace-Id header
app.use(requestTracingMiddleware);

// OBS-07: Track error rates for spike detection across all requests
app.use(errorRateTracker);

// I18N: Language detection + req.t() injection (reads Accept-Language header or ?lang= param)
app.use(i18nMiddleware);

app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// OBS-06: Liveness probe — answers "is the process alive?"
// External monitors (UptimeRobot/Pingdom) should hit this every 60 s.
// Deliberately lightweight: no DB/Redis check so it never blocks on deps.
app.get('/healthz', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// OBS-06: Readiness probe — answers "is the service ready to handle traffic?"
// Returns 503 if DB is not connected or startup tasks haven't completed.
// Used by load balancers and container orchestrators (K8s readinessProbe).
app.get('/ready', (_req, res) => {
  const db = getDatabaseStatus();
  const redisConfigured = !!process.env.REDIS_URL;
  const redis = redisConfigured ? (isRedisReady() ? 'ready' : 'unavailable') : 'disabled';
  const ready = db === 'connected' && serverReady;
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    db,
    redis,
    serverReady,
    timestamp: new Date().toISOString(),
  });
});

app.get('/readyz', (_req, res) => {
  const db = getDatabaseStatus();
  const redisConfigured = !!process.env.REDIS_URL;
  const redis = redisConfigured ? (isRedisReady() ? 'ready' : 'unavailable') : 'disabled';
  const ready = db === 'connected' && serverReady;
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    db,
    redis,
    serverReady,
    timestamp: new Date().toISOString(),
  });
});

// OBS-06: Startup probe — answers "has the app finished initializing?"
// K8s startupProbe should use this. Returns 503 until DB, agenda, and bootstrap complete.
// Once startup succeeds, liveness/readiness probes take over.
app.get('/startupz', (_req, res) => {
  res.status(serverReady ? 200 : 503).json({
    status: serverReady ? 'started' : 'starting',
    timestamp: new Date().toISOString(),
  });
});

// OBS-06: Public status page data — no auth required.
// Schools can poll this to check service availability.
app.get('/api/status', (_req, res) => {
  res.json(getUptimeStats());
});

// OBS-07: Error rate stats endpoint (internal/ops use — no auth to keep it lightweight)
app.get('/api/ops/error-rate', (_req, res) => {
  res.json(getErrorRateStats());
});

// OBS-02: APM endpoint — per-endpoint latency percentiles (p50/p95/p99)
app.get('/api/ops/apm', (_req, res) => {
  res.json(getApmStats());
});

// OBS-05: Query performance dashboard (slow queries, index stats, suggestions)
app.use('/api/ops/query-performance', queryPerformanceRoutes);

// DR-02: Replica set status — returns member states, primary, replication lag
app.get('/api/ops/replica-status', async (_req, res) => {
  const status = await getReplicaSetStatus();
  if (!status) {
    return res.status(503).json({ error: 'Replica set status unavailable' });
  }
  res.json(status);
});

// OBS-04: Prometheus scrape endpoint — expose key EMS metrics for Grafana/Prometheus
// Optional: protect with OPS_METRICS_SECRET env var (pass as X-Ops-Secret header)
app.use('/api/metrics', metricsRoutes);

// OBS-07: Deployment marker — call this from CI/CD after each deploy to enable correlation
// POST /api/ops/deployment  { version, commitSha }
app.post('/api/ops/deployment', (req, res) => {
  const secret = process.env.OPS_DEPLOYMENT_SECRET;
  if (secret && req.headers['x-ops-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { version, commitSha } = req.body || {};
  registerDeployment({ version, commitSha });
  res.json({ ok: true, message: 'Deployment registered for error correlation' });
});

// ─── API Documentation ──────────────────────────────────────────────────────
// Swagger UI: GET /api/docs
// Raw OpenAPI JSON spec: GET /api/docs/spec  (importable into Postman)
app.use(
  '/api/docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    explorer: true,
    customSiteTitle: 'EMS API Docs',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      tryItOutEnabled: true,
    },
  })
);
app.get('/api/docs/spec', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});
// ────────────────────────────────────────────────────────────────────────────

initializeChatHandlers(io);
app.locals.io = io;
app.locals.Staff = Staff;

// ─── API v1 Router ───────────────────────────────────────────────────────────
// All routes are registered here once and mounted at both:
//   /api/v1  — versioned (current)
//   /api     — legacy (backward-compat, adds Deprecation headers)
const v1Router = express.Router();

v1Router.use(addApiVersionHeader);
v1Router.use(auditLogMiddleware);
v1Router.use(apiUsageTracker);
// OBS-04: Business metrics tracking (DAU/MAU, feature adoption, client split)
v1Router.use(businessMetricsTracker);

// Per-tenant rate limiter — keyed by schoolId, limits scale with plan tier
v1Router.use(createTenantRateLimiter());

// ─── Public / Unauthenticated Routes ────────────────────────────────────────
// These routes contain public endpoints (login, signup, OAuth callbacks,
// webhooks, tracking pixels, etc.) and manage auth internally per-handler.
// Auth endpoints get a stricter per-IP limiter to block credential-stuffing.
v1Router.use(
  '/auth',
  createAuthRateLimiter({
    skip: (req) => {
      // Outside production, skip auth limiting entirely so local dev and the
      // test runner aren't locked out while iterating. Production MUST set
      // NODE_ENV=production (matches the codebase's non-prod gating elsewhere).
      if (isAuthRateLimitingDisabled() || process.env.NODE_ENV !== 'production') return true;
      // In production, exempt the benign session check: GET /auth/session is
      // polled on every dashboard load to read the current session. It carries
      // no credentials, so it must not share the credential-stuffing budget
      // that protects POST /auth/login, /signup, /refresh, etc. (req.path is
      // relative to the /auth mount here, so it is just '/session').
      return req.method === 'GET' && req.path === '/session';
    },
  })
);
v1Router.use('/auth', authRoutes);
v1Router.use('/auth/sso', ssoRoutes);
v1Router.use('/auth/2fa', twoFactorRoutes);
v1Router.use('/parent/auth', parentAuthRoutes);
v1Router.use('/parent', authenticateParent, parentDataRoutes);
v1Router.use('/parent/messages', parentMessagingRoutes);
v1Router.use('/public', publicRoutes);
v1Router.use('/demo', demoRoutes);
// EMAIL-06: delivery analytics — pixel/click/sms-webhook (no auth — called by email clients & MSG91)
v1Router.use('/tracking', trackingRoutes);
v1Router.use('/webhooks', webhooksRoutes);
v1Router.use('/billing', billingRoutes);

// ─── Authentication Barrier ─────────────────────────────────────────────────
// All routes mounted BELOW this line require a valid JWT / API key.
// Individual route files may still apply `authenticate` per-handler as
// defense-in-depth — the double-check is harmless and intentional.
v1Router.use(authenticate);

// ─── Module Enablement Gateway ──────────────────────────────────────────────
// Blocks API access to modules a school has switched OFF in Settings → Modules.
// Core + system endpoints (students, staff, classes, permissions, settings, …)
// are never gated; super-admins bypass. See middleware/auth/moduleAccess.js.
v1Router.use(moduleAccessGuard);

// ─── School Status Guard (Phase 6) ──────────────────────────────────────────
// Blocks API access for suspended/locked/churned schools (billing stays open so
// they can pay to reactivate). Super-admin bypasses via null schoolId.
v1Router.use(schoolStatusGuard);

// ─── Platform Administration ─────────────────────────────────────────────────
v1Router.use('/permissions', permissionRoutes);
v1Router.use('/super-admin', superAdminRoutes);
v1Router.use('/super-admin/activity', superAdminActivityRoutes);
v1Router.use('/super-admin/trash', superAdminTrashRoutes);
v1Router.use('/super-admin/billing', superAdminBillingRoutes);
v1Router.use('/super-admin/lifecycle', superAdminLifecycleRoutes);
v1Router.use('/school-groups', schoolGroupsRoutes);
v1Router.use('/referral', referralRoutes);
v1Router.use('/coupons', couponRoutes);
v1Router.use('/feature-flags', featureFlagsRoutes);
v1Router.use('/nps', npsRoutes);

// ─── Core School Data ────────────────────────────────────────────────────────
v1Router.use('/classes', classesRoutes);
v1Router.use('/classes-enhanced', classesEnhancedRoutes);
v1Router.use('/class-settings', classSettingsRoutes);
v1Router.use('/students', studentsRoutes);
v1Router.use('/promotions', promotionRoutes);
v1Router.use('/staff', staffRoutes);

// ─── Academics ───────────────────────────────────────────────────────────────
v1Router.use('/attendance', attendanceRoutes);
v1Router.use('/academic-performance', academicPerformanceRoutes);
v1Router.use('/cbse-report-card', cbseReportCardRoutes);
v1Router.use('/icse-report-card', icseReportCardRoutes);
v1Router.use('/', cceRoutes);
v1Router.use('/hall-tickets', hallTicketsRoutes);
v1Router.use('/', academicsRoutes);
v1Router.use('/', examScheduleRoutes);
// Routes inside examHalls.js are defined with the full `/exam-halls` prefix
// (like examScheduleRoutes/academicsRoutes above), so mount at root — mounting
// at '/exam-halls' would double the prefix to /exam-halls/exam-halls (404).
v1Router.use('/', examHallsRoutes);
v1Router.use('/homework', homeworkRoutes);

// ─── Staff & HR ──────────────────────────────────────────────────────────────
v1Router.use('/staff-attendance', staffAttendanceRoutes);
v1Router.use('/payroll', payrollRoutes);
v1Router.use('/expenses', expensesRoutes);
v1Router.use('/vendors', vendorsRoutes);
v1Router.use('/payslips', payslipsRoutes);
v1Router.use('/teacher-assignments', teacherAssignmentsRoutes);
v1Router.use('/teacher-timetable', teacherTimetableRoutes);
v1Router.use('/teacher-leaves', teacherLeavesRoutes);
v1Router.use('/student-leaves', studentLeavesRoutes);
v1Router.use('/timetable', timetableRoutes);
v1Router.use('/timetable-cleanup', timetableCleanupRoutes);
v1Router.use('/substitutions', substitutionRoutes);
v1Router.use('/substitution-alerts', substitutionAlertsRoutes);

// ─── Fees & Finance ──────────────────────────────────────────────────────────
v1Router.use('/fee-heads', feeHeadsRoutes);
v1Router.use('/student-fees', studentFeesRoutes);
v1Router.use('/fee-settings', feeSettingsRoutes);
v1Router.use('/fee-reminder-config', feeReminderConfigRoutes);
v1Router.use('/fees', feesRoutes);
v1Router.use('/fee-templates', feeTemplatesRoutes);
v1Router.use('/fee-structure', feeStructureRoutes);

// ─── Communication & Messaging ───────────────────────────────────────────────
v1Router.use('/messages', messageRoutes);
v1Router.use('/announcements', announcementRoutes);
v1Router.use('/communication-logs', communicationLogsRoutes);
v1Router.use('/email-campaigns', emailCampaignsRoutes);
v1Router.use('/notifications', notificationRoutes);
v1Router.use('/push-notifications', pushNotificationsRoutes);
v1Router.use('/calls', callRoutes);
v1Router.use('/whatsapp', whatsappRoutes);
v1Router.use('/reminders', reminderRoutes);

// ─── Parent Management (staff-side) ─────────────────────────────────────────
v1Router.use('/parents', parentManagementRoutes);

// ─── Mobile App ──────────────────────────────────────────────────────────────
v1Router.use('/mobile', mobileRoutes);
v1Router.use('/mobile/analytics', mobileAnalyticsRoutes);

// ─── Front Desk & Security ───────────────────────────────────────────────────
v1Router.use('/visitors', visitorsRoutes);
v1Router.use('/gate-passes', gatePassesRoutes);
v1Router.use('/front-desk', frontDeskRoutes);

// ─── Settings & Configuration ────────────────────────────────────────────────
v1Router.use('/settings', settingsRoutes);
v1Router.use('/curricula', curriculaRoutes);
v1Router.use('/', systemConfigRoutes);
v1Router.use('/', intakeFormsRoutes);
v1Router.use('/', calendarEventsRoutes);
v1Router.use('/ptm', ptmRoutes);

// ─── Operations & Administration ─────────────────────────────────────────────
v1Router.use('/audit-logs', auditLogsRoutes);

// ─── Self-Serve Onboarding (PR4) ──────────────────────────────────────────────
// Mounts only when ENABLE_SELF_SIGNUP=true. The flag is read live on every
// request so flipping it in Render takes effect on the next boot, with no
// restart required by an admin pushing a redeploy. PR1 (signup endpoint)
// and PR4 (this wizard) both gate on the same flag; PR6 will flip it
// production-wide after hardening + soak.
if (process.env.ENABLE_SELF_SIGNUP === 'true') {
  v1Router.use('/onboarding', onboardingRoutes);
}
v1Router.use('/dashboard', dashboardRoutes);
v1Router.use('/trash', trashRoutes);
v1Router.use('/backup', backupRoutes);
v1Router.use('/data-cleanup', dataCleanupRoutes);
v1Router.use('/gdpr', gdprRoutes);
v1Router.use('/archival', archivalRoutes);
v1Router.use('/search', searchRoutes);
v1Router.use('/jobs', jobsRoutes);

// ─── Reports & Data ──────────────────────────────────────────────────────────
v1Router.use('/reports', reportsRoutes);
v1Router.use('/export', exportRoutes);
v1Router.use('/bulk-import', bulkImportRoutes);
v1Router.use('/bulk-ops', bulkOpsRoutes);

// ─── Extra Modules ───────────────────────────────────────────────────────────
v1Router.use('/library', libraryRoutes);
v1Router.use('/transport', transportRoutes);
v1Router.use('/inventory', inventoryRoutes);
v1Router.use('/hostel', hostelRoutes);

// ─── Integrations ────────────────────────────────────────────────────────────
v1Router.use('/tally', tallyRoutes);
v1Router.use('/google-classroom', googleClassroomRoutes);
v1Router.use('/api-keys', apiKeysRoutes);
v1Router.use('/email-suppressions', emailSuppressionRoutes);
v1Router.use('/changelog', changelogRoutes);
v1Router.use('/knowledge-base', knowledgeBaseRoutes);

// ─── Utilities & Developer Tools ─────────────────────────────────────────────
v1Router.use('/ai', aiRoutes);
v1Router.use('/upload', uploadRoutes);
v1Router.use('/validation', validationRoutes);
v1Router.use('/seed-data', seedDummyDataRoutes);

// Global safety-net rate limiter — caps any single IP before per-tenant logic
app.use('/api', createGlobalRateLimiter());

// Mount versioned router — canonical going forward
app.use('/api/v1', v1Router);

// Mount legacy /api prefix — keeps existing mobile apps working.
// Responses include Deprecation + Sunset + Link headers nudging clients to upgrade.
app.use('/api', deprecationWarning, v1Router);
// ────────────────────────────────────────────────────────────────────────────

// 404 catch-all — must be after all routes, before error handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found', path: req.path });
});

// Sentry error handler — must be before the global error handler
Sentry.setupExpressErrorHandler(app);

// Global error handler — must be after all routes, 4 parameters required
app.use((err, req, res, next) => {
  logger.error({ err: err.message, path: req.path, method: req.method }, 'Unhandled error');

  let statusCode = err.status || err.statusCode || 500;

  // Capture server errors to Sentry for production alerting
  if (statusCode >= 500) {
    Sentry.withScope((scope) => {
      if (req.requestId) scope.setTag('requestId', req.requestId);
      scope.setTag('route', `${req.method} ${req.path}`);
      Sentry.captureException(err);
    });
  }
  let message = err.message || 'Internal server error';
  let details = err.details || null;

  // Normalise well-known Mongoose / JWT error types
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation Error';
    details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
  } else if (err.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid ID format';
    details = { field: err.path, value: err.value };
  } else if (err.code === 11000) {
    statusCode = 409;
    message = 'Duplicate entry';
    const field = Object.keys(err.keyPattern || {})[0];
    details = { field, message: `${field} already exists` };
  } else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
  } else if (process.env.NODE_ENV === 'production') {
    message = statusCode >= 500 ? 'Internal server error' : message;
  }

  const response = { success: false, error: message, statusCode };
  if (details) response.details = details;
  if (process.env.NODE_ENV === 'development') response.stack = err.stack;

  res.status(statusCode).json(response);
});

httpServer.listen(PORT, async () => {
  logger.info({ port: PORT }, 'Server started');
  logger.info({ environment: process.env.NODE_ENV || 'development' }, 'Runtime environment');

  // OBS-07: Register this server start as a deployment event for error correlation
  registerDeployment({ version, commitSha: process.env.RENDER_GIT_COMMIT });

  try {
    await connectDB();
    // OBS-05: Attach slow query APM listeners now that the MongoDB client is ready
    initializeSlowQueryMonitor();
    await bootstrapTenantContext();
    await startAgenda();
    // OBS-06: Start internal uptime monitor after DB is connected
    startUptimeMonitor();
    // DR-04: Start health watchdog — exits process if DB stays down in production
    startHealthWatchdog();
    // OBS-04: Start periodic business metrics flush (every 5 min → MongoDB)
    startFlushTimer();
    // PERF-06: Start SLA compliance monitor (p99 < 500ms target, checks every 5 min)
    startSlaMonitor();
    // Mark server as fully initialized — readiness & startup probes now return 200
    serverReady = true;
    logger.info('Server fully initialized — readiness probe active');
  } catch (error) {
    logger.error({ err: error }, 'Database connection failed');
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
});
