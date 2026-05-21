import Agenda from 'agenda';

let _agenda = null;

function getAgenda() {
  if (_agenda) return _agenda;

  const mongoUri =
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    (process.env.NODE_ENV === 'test' ? process.env.MONGO_TEST_URI : null) ||
    'mongodb://localhost:27017/ems';

  _agenda = new Agenda({
    db: {
      address: mongoUri,
      collection: process.env.AGENDA_DB_COLLECTION || 'jobs',
    },
    processEvery: process.env.AGENDA_PROCESS_EVERY || '5 seconds',
    maxConcurrency: 20,
    defaultConcurrency: 5,
    lockLimit: 0,
    ensureIndex: true,
  });

  // Define job types
  _agenda.define('send scheduled announcement', async (job) => {
    const { sendScheduledAnnouncement } = await import('../services/announcementSender.js');
    await sendScheduledAnnouncement(job.attrs.data.announcementId);
  });

  _agenda.define('check reminder triggers', async (job) => {
    const { checkReminderTriggers } = await import('../services/reminderProcessor.js');
    await checkReminderTriggers();
  });

  _agenda.define('process daily digest', async (job) => {
    const { processDailyDigest } = await import('../services/notificationService.js');
    await processDailyDigest(job.attrs.data.userType);
  });

  _agenda.define('process queued notifications', async (job) => {
    const { processQueuedNotifications } = await import('../routes/notifications.js');
    const result = await processQueuedNotifications();
    console.log(`[Agenda] Processed ${result.processed}/${result.total} queued notifications`);
  });

  _agenda.define('cleanup old jobs', async (job) => {
    await _agenda.cancel({ nextRunAt: { $lt: new Date() } });
  });

  _agenda.define('purge expired trash', async (job) => {
    const { purgeExpiredTrashItems } = await import('../services/trashCleanupService.js');
    await purgeExpiredTrashItems();
  });

  _agenda.define('cleanup old notifications', async (job) => {
    const { cleanupOldNotifications } = await import('../routes/notifications.js');
    const result = await cleanupOldNotifications();
    console.log(
      `[Agenda] Notification cleanup: ${result.readDeleted} read (>90d) + ${result.allDeleted} all (>180d) removed`
    );
  });

  _agenda.define('bulk import students', async (job) => {
    const { jobId, schoolId, rows } = job.attrs.data;
    const { processBulkStudentImport } = await import('../services/bulkImportService.js');
    await processBulkStudentImport(jobId, schoolId, rows);
  });

  _agenda.define('bulk import staff', async (job) => {
    const { jobId, schoolId, rows } = job.attrs.data;
    const { processBulkStaffImport } = await import('../services/bulkImportService.js');
    await processBulkStaffImport(jobId, schoolId, rows);
  });

  _agenda.define('purge audit logs', async (job) => {
    const { retentionMonths = 12 } = job.attrs.data || {};
    const { purgeExpiredAuditLogs } = await import('../services/auditRetentionService.js');
    await purgeExpiredAuditLogs(retentionMonths);
  });

  _agenda.define('bulk notify parents', async (job) => {
    const { schoolId, students, message, channel, initiatedBy } = job.attrs.data;
    const { processBulkNotification } = await import('../services/bulkImportService.js');
    await processBulkNotification(schoolId, students, message, channel);
  });

  _agenda.define('enforce retention policies', async (job) => {
    const { enforceRetentionPolicies } = await import('../services/retentionEnforcementService.js');
    await enforceRetentionPolicies();
  });

  _agenda.define('process fee reminders', async (job) => {
    const { processFeeReminders } = await import('../services/feeReminderService.js');
    await processFeeReminders();
  });

  _agenda.define('send weekly error summary', async (job) => {
    const { sendWeeklySummaryReport } = await import('../services/errorRateMonitor.js');
    await sendWeeklySummaryReport();
  });

  _agenda.define('send weekly sla report', async (job) => {
    const { sendWeeklySlaReport } = await import('../services/uptimeMonitor.js');
    await sendWeeklySlaReport();
  });

  _agenda.define('tally auto export', async (job) => {
    const { processAutoExports } = await import('../services/tallyExportService.js');
    await processAutoExports();
  });

  // OBS-05: Daily slow query digest
  _agenda.define('send daily slow query report', async (job) => {
    const { sendDailySlowQueryReport } = await import('../services/slowQueryMonitor.js');
    await sendDailySlowQueryReport();
  });

  // DR-05: Quarterly data archival for schools older than 3 years
  _agenda.define('archive old school data', async (job) => {
    const { triggeredBy = 'system' } = job.attrs.data || {};
    const { runArchival } = await import('../services/archivalService.js');
    await runArchival(triggeredBy);
  });

  // OBS-04: Weekly business metrics report
  _agenda.define('send weekly business metrics report', async (job) => {
    const { getAllSchoolsMetricsSummary, flushBuffer } =
      await import('../services/businessMetricsService.js');
    const { sendWeeklyBusinessMetricsReport } = await import('../services/emailService.js');
    await flushBuffer();
    const summary = await getAllSchoolsMetricsSummary();
    await sendWeeklyBusinessMetricsReport(summary);
  });

  return _agenda;
}

// Lazy proxy so module import never triggers an eager MongoDB connection.
const agenda = new Proxy(
  {},
  {
    get(_target, prop) {
      const instance = getAgenda();
      const value = instance[prop];
      return typeof value === 'function' ? value.bind(instance) : value;
    },
  }
);

// Function to start agenda
export const startAgenda = async () => {
  try {
    const instance = getAgenda();
    await instance.start();

    // Schedule recurring jobs
    await instance.every('5 minutes', 'send scheduled announcement');
    await instance.every('1 hour', 'check reminder triggers');
    await instance.every('0 9 * * *', 'process daily digest', { userType: 'all' });
    await instance.every('0 3 * * *', 'cleanup old jobs');
    await instance.every('0 2 * * *', 'purge expired trash');
    await instance.every('0 4 1 * *', 'purge audit logs', { retentionMonths: 12 });
    await instance.every('0 5 2 * *', 'enforce retention policies');
    await instance.every('0 9 * * 1', 'send weekly error summary');
    await instance.every('5 9 * * 1', 'send weekly sla report');
    await instance.every('0 8 * * *', 'send daily slow query report');
    await instance.every('10 9 * * 1', 'send weekly business metrics report');
    await instance.every('0 6 * * *', 'tally auto export');
    await instance.every('0 7 * * *', 'process fee reminders');
    await instance.every('15 minutes', 'process queued notifications');
    await instance.every('0 1 3 1,4,7,10 *', 'archive old school data', { triggeredBy: 'system' });
    await instance.every('30 2 * * *', 'cleanup old notifications');
  } catch (error) {
    console.error('❌ Agenda start error:', error);
    throw error;
  }
};

// Helper function to schedule a one-time job
export const scheduleJob = async (name, when, data) => {
  try {
    const instance = getAgenda();
    const job = await instance.schedule(when, name, data);
    return job;
  } catch (error) {
    console.error(`❌ Error scheduling job '${name}':`, error);
    throw error;
  }
};

// Helper function to schedule a recurring job
export const scheduleRecurringJob = async (name, interval, data) => {
  try {
    const instance = getAgenda();
    await instance.every(interval, name, data);
  } catch (error) {
    console.error(`❌ Error scheduling recurring job '${name}':`, error);
    throw error;
  }
};

// Helper function to cancel jobs
export const cancelJobs = async (query) => {
  try {
    const instance = getAgenda();
    const numRemoved = await instance.cancel(query);
    return numRemoved;
  } catch (error) {
    console.error('❌ Error cancelling jobs:', error);
    throw error;
  }
};

export default agenda;
