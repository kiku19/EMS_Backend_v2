import Agenda from 'agenda';

// Initialize Agenda with MongoDB connection
const agenda = new Agenda({
  db: {
    address: process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/ems',
    collection: process.env.AGENDA_DB_COLLECTION || 'jobs',
  },
  processEvery: process.env.AGENDA_PROCESS_EVERY || '5 seconds',
  maxConcurrency: 20,
  defaultConcurrency: 5,
  lockLimit: 0,
  ensureIndex: true,
});

// Define job types
agenda.define('send scheduled announcement', async (job) => {
  // Import dynamically to avoid circular dependencies
  const { sendScheduledAnnouncement } = await import('../services/announcementSender.js');
  await sendScheduledAnnouncement(job.attrs.data.announcementId);
});

agenda.define('check reminder triggers', async (job) => {
  // Import dynamically
  const { checkReminderTriggers } = await import('../services/reminderProcessor.js');
  await checkReminderTriggers();
});

agenda.define('process daily digest', async (job) => {
  // Import dynamically
  const { processDailyDigest } = await import('../services/notificationService.js');
  await processDailyDigest(job.attrs.data.userType);
});

agenda.define('cleanup old jobs', async (job) => {
  const result = await agenda.cancel({ nextRunAt: { $lt: new Date() } });
});

agenda.define('purge expired trash', async (job) => {
  const { purgeExpiredTrashItems } = await import('../services/trashCleanupService.js');
  const result = await purgeExpiredTrashItems();
});

agenda.define('bulk import students', async (job) => {
  const { jobId, schoolId, rows } = job.attrs.data;
  const { processBulkStudentImport } = await import('../services/bulkImportService.js');
  await processBulkStudentImport(jobId, schoolId, rows);
});

agenda.define('bulk import staff', async (job) => {
  const { jobId, schoolId, rows } = job.attrs.data;
  const { processBulkStaffImport } = await import('../services/bulkImportService.js');
  await processBulkStaffImport(jobId, schoolId, rows);
});

agenda.define('purge audit logs', async (job) => {
  const { retentionMonths = 12 } = job.attrs.data || {};
  const { purgeExpiredAuditLogs } = await import('../services/auditRetentionService.js');
  const result = await purgeExpiredAuditLogs(retentionMonths);
});

agenda.define('bulk notify parents', async (job) => {
  const { schoolId, students, message, channel, initiatedBy } = job.attrs.data;
  const { processBulkNotification } = await import('../services/bulkImportService.js');
  await processBulkNotification(schoolId, students, message, channel);
});

agenda.define('enforce retention policies', async (job) => {
  const { enforceRetentionPolicies } = await import('../services/retentionEnforcementService.js');
  const result = await enforceRetentionPolicies();
});

agenda.define('process fee reminders', async (job) => {
  const { processFeeReminders } = await import('../services/feeReminderService.js');
  await processFeeReminders();
});

agenda.define('send weekly error summary', async (job) => {
  const { sendWeeklySummaryReport } = await import('../services/errorRateMonitor.js');
  await sendWeeklySummaryReport();
});

agenda.define('send weekly sla report', async (job) => {
  const { sendWeeklySlaReport } = await import('../services/uptimeMonitor.js');
  await sendWeeklySlaReport();
});

agenda.define('tally auto export', async (job) => {
  const { processAutoExports } = await import('../services/tallyExportService.js');
  const result = await processAutoExports();
});

// OBS-05: Daily slow query digest
agenda.define('send daily slow query report', async (job) => {
  const { sendDailySlowQueryReport } = await import('../services/slowQueryMonitor.js');
  await sendDailySlowQueryReport();
});

// DR-05: Quarterly data archival for schools older than 3 years
agenda.define('archive old school data', async (job) => {
  const { triggeredBy = 'system' } = job.attrs.data || {};
  const { runArchival } = await import('../services/archivalService.js');
  const result = await runArchival(triggeredBy);
});

// OBS-04: Weekly business metrics report
agenda.define('send weekly business metrics report', async (job) => {
  const { getAllSchoolsMetricsSummary, flushBuffer } =
    await import('../services/businessMetricsService.js');
  const { sendWeeklyBusinessMetricsReport } = await import('../services/emailService.js');
  // Flush any buffered data before generating the report
  await flushBuffer();
  const summary = await getAllSchoolsMetricsSummary();
  await sendWeeklyBusinessMetricsReport(summary);
});

// Function to start agenda
export const startAgenda = async () => {
  try {
    await agenda.start();

    // Schedule recurring jobs

    // Check for scheduled announcements every 5 minutes
    await agenda.every('5 minutes', 'send scheduled announcement');

    // Check reminder triggers every hour
    await agenda.every('1 hour', 'check reminder triggers');

    // Process daily digest at 9 AM daily
    await agenda.every('0 9 * * *', 'process daily digest', { userType: 'all' });

    // Cleanup old jobs daily at 3 AM
    await agenda.every('0 3 * * *', 'cleanup old jobs');

    // Purge expired trash items daily at 2 AM
    await agenda.every('0 2 * * *', 'purge expired trash');

    // Purge audit logs older than 12 months — runs on the 1st of each month at 4 AM
    await agenda.every('0 4 1 * *', 'purge audit logs', { retentionMonths: 12 });

    // Enforce school-level data retention policies — runs on the 2nd of each month at 5 AM
    await agenda.every('0 5 2 * *', 'enforce retention policies');

    // Weekly error summary — every Monday at 9 AM
    await agenda.every('0 9 * * 1', 'send weekly error summary');

    // OBS-06: Weekly SLA report — every Monday at 9:05 AM
    await agenda.every('5 9 * * 1', 'send weekly sla report');

    // OBS-05: Daily slow query report — every day at 8 AM
    await agenda.every('0 8 * * *', 'send daily slow query report');

    // OBS-04: Weekly business metrics report — every Monday at 9:10 AM
    await agenda.every('10 9 * * 1', 'send weekly business metrics report');

    // Tally auto-export — runs daily at 6 AM, processes schools with auto-export enabled
    await agenda.every('0 6 * * *', 'tally auto export');

    // Fee due/overdue reminders — runs daily at 7 AM
    await agenda.every('0 7 * * *', 'process fee reminders');

    // DR-05: Archive old school data quarterly (3rd of Jan, Apr, Jul, Oct at 1 AM)
    await agenda.every('0 1 3 1,4,7,10 *', 'archive old school data', { triggeredBy: 'system' });
  } catch (error) {
    console.error('❌ Agenda start error:', error);
    throw error;
  }
};

// Helper function to schedule a one-time job
export const scheduleJob = async (name, when, data) => {
  try {
    const job = await agenda.schedule(when, name, data);
    return job;
  } catch (error) {
    console.error(`❌ Error scheduling job '${name}':`, error);
    throw error;
  }
};

// Helper function to schedule a recurring job
export const scheduleRecurringJob = async (name, interval, data) => {
  try {
    await agenda.every(interval, name, data);
  } catch (error) {
    console.error(`❌ Error scheduling recurring job '${name}':`, error);
    throw error;
  }
};

// Helper function to cancel jobs
export const cancelJobs = async (query) => {
  try {
    const numRemoved = await agenda.cancel(query);
    return numRemoved;
  } catch (error) {
    console.error('❌ Error cancelling jobs:', error);
    throw error;
  }
};

export default agenda;
