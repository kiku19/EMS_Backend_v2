import Agenda from 'agenda';

// Initialize Agenda with MongoDB connection
const agenda = new Agenda({
  db: {
    address: process.env.MONGO_URI || 'mongodb://localhost:27017/ems',
    collection: process.env.AGENDA_DB_COLLECTION || 'jobs'
  },
  processEvery: process.env.AGENDA_PROCESS_EVERY || '5 seconds',
  maxConcurrency: 20,
  defaultConcurrency: 5,
  lockLimit: 0,
  ensureIndex: true
});

// Define job types
agenda.define('send scheduled announcement', async (job) => {
  console.log('📤 Processing scheduled announcement:', job.attrs.data.announcementId);
  // Import dynamically to avoid circular dependencies
  const { sendScheduledAnnouncement } = await import('../services/announcementSender.js');
  await sendScheduledAnnouncement(job.attrs.data.announcementId);
});

agenda.define('check reminder triggers', async (job) => {
  console.log('⏰ Checking reminder triggers...');
  // Import dynamically
  const { checkReminderTriggers } = await import('../services/reminderProcessor.js');
  await checkReminderTriggers();
});

agenda.define('process daily digest', async (job) => {
  console.log('📰 Processing daily digest...');
  // Import dynamically
  const { processDailyDigest } = await import('../services/notificationService.js');
  await processDailyDigest(job.attrs.data.userType);
});

agenda.define('cleanup old jobs', async (job) => {
  console.log('🧹 Cleaning up old completed jobs...');
  const result = await agenda.cancel({ nextRunAt: { $lt: new Date() } });
  console.log(`Cleaned up ${result} old jobs`);
});

// Function to start agenda
export const startAgenda = async () => {
  try {
    await agenda.start();
    console.log('✅ Agenda job scheduler started');

    // Schedule recurring jobs

    // Check for scheduled announcements every 5 minutes
    await agenda.every('5 minutes', 'send scheduled announcement');

    // Check reminder triggers every hour
    await agenda.every('1 hour', 'check reminder triggers');

    // Process daily digest at 9 AM daily
    await agenda.every('0 9 * * *', 'process daily digest', { userType: 'all' });

    // Cleanup old jobs daily at 3 AM
    await agenda.every('0 3 * * *', 'cleanup old jobs');

    console.log('✅ Recurring jobs scheduled');
  } catch (error) {
    console.error('❌ Agenda start error:', error);
    throw error;
  }
};

// Helper function to schedule a one-time job
export const scheduleJob = async (name, when, data) => {
  try {
    const job = await agenda.schedule(when, name, data);
    console.log(`✅ Job '${name}' scheduled for ${when}`);
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
    console.log(`✅ Recurring job '${name}' scheduled every ${interval}`);
  } catch (error) {
    console.error(`❌ Error scheduling recurring job '${name}':`, error);
    throw error;
  }
};

// Helper function to cancel jobs
export const cancelJobs = async (query) => {
  try {
    const numRemoved = await agenda.cancel(query);
    console.log(`✅ Cancelled ${numRemoved} jobs`);
    return numRemoved;
  } catch (error) {
    console.error('❌ Error cancelling jobs:', error);
    throw error;
  }
};

export default agenda;
