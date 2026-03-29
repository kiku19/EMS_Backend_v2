import express from 'express';
import mongoose from 'mongoose';
import Reminder from '../models/Reminder.js';
import ReminderTemplate from '../models/ReminderTemplate.js';
import ReminderLog from '../models/ReminderLog.js';
import { scheduleJob, cancelJobs } from '../config/agenda.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { buildSchoolScopedQuery } from '../utils/schoolContext.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const logger = createLogger('Reminders');
router.use(authenticate);
router.use(requireAdmin);

// POST /api/reminders - Create reminder
router.post('/', async (req, res) => {
  try {
    const {
      title,
      type,
      triggers,
      message,
      templateId,
      recipients,
      channels,
      startDate,
      endDate,
      frequency,
    } = req.body;
    const user = req.user;

    const reminder = new Reminder({
      title,
      type,
      triggers,
      message,
      templateId,
      recipients,
      channels,
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : null,
      frequency,
      isActive: true,
      createdBy: user.id,
      schoolId: user.schoolId,
      nextExecutionAt: new Date(startDate),
    });

    await reminder.save();

    // Schedule the reminder — if scheduling fails, mark the reminder as inactive and surface the error
    try {
      await scheduleJob('check reminder triggers', new Date(startDate), {
        reminderId: reminder._id,
      });
    } catch (scheduleError) {
      logger.error(
        { err: scheduleError, reminderId: reminder._id },
        'Failed to schedule reminder job'
      );
      // Roll back: delete the saved reminder since it will never execute
      await Reminder.findByIdAndDelete(reminder._id);
      return res
        .status(500)
        .json({ error: req.t('common:routes.failedToScheduleReminderPleaseTryAgain') });
    }

    res.status(201).json(reminder);
  } catch (error) {
    logger.error({ err: error }, 'Error creating reminder');
    res.status(500).json({ error: req.t('common:routes.failedToCreateReminder') });
  }
});

// GET /api/reminders - List all reminders
router.get('/', async (req, res) => {
  try {
    const { type, isActive, page = 1, limit = 20 } = req.query;

    const query = buildSchoolScopedQuery(req.user.schoolId, {});
    if (type) query.type = type;
    if (isActive !== undefined) query.isActive = isActive === 'true';

    const reminders = await Reminder.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('createdBy', 'name')
      .populate('templateId', 'name')
      .lean();

    const total = await Reminder.countDocuments(query);

    res.json({
      reminders,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total,
    });
  } catch (error) {
    console.error('Error fetching reminders:', error);
    res.status(500).json({ error: req.t('common:routes.failedToFetchReminders') });
  }
});

// GET /api/reminders/:id - Get reminder details
router.get('/:id', async (req, res) => {
  try {
    const reminder = await Reminder.findOne(
      buildSchoolScopedQuery(req.user.schoolId, { _id: req.params.id })
    )
      .populate('createdBy', 'name')
      .populate('templateId', 'name message')
      .lean();

    if (!reminder) {
      return res.status(404).json({ error: req.t('common:routes.reminderNotFound') });
    }

    // Get execution logs
    const logs = await ReminderLog.find({ reminderId: reminder._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json({ ...reminder, logs });
  } catch (error) {
    console.error('Error fetching reminder:', error);
    res.status(500).json({ error: req.t('common:routes.failedToFetchReminder') });
  }
});

// PUT /api/reminders/:id - Update reminder
router.put('/:id', async (req, res) => {
  try {
    const reminder = await Reminder.findOne(
      buildSchoolScopedQuery(req.user.schoolId, { _id: req.params.id })
    );

    if (!reminder) {
      return res.status(404).json({ error: req.t('common:routes.reminderNotFound') });
    }

    const { title, type, triggers, message, recipients, channels, startDate, endDate, frequency } =
      req.body;

    if (title) reminder.title = title;
    if (type) reminder.type = type;
    if (triggers) reminder.triggers = triggers;
    if (message) reminder.message = message;
    if (recipients) reminder.recipients = recipients;
    if (channels) reminder.channels = channels;
    if (startDate) reminder.startDate = new Date(startDate);
    if (endDate !== undefined) reminder.endDate = endDate ? new Date(endDate) : null;
    if (frequency) reminder.frequency = frequency;

    await reminder.save();

    res.json(reminder);
  } catch (error) {
    console.error('Error updating reminder:', error);
    res.status(500).json({ error: req.t('common:routes.failedToUpdateReminder') });
  }
});

// DELETE /api/reminders/:id - Delete reminder
router.delete('/:id', async (req, res) => {
  try {
    const reminder = await Reminder.findOne(
      buildSchoolScopedQuery(req.user.schoolId, { _id: req.params.id })
    );

    if (!reminder) {
      return res.status(404).json({ error: req.t('common:routes.reminderNotFound') });
    }

    // Cancel scheduled jobs
    await cancelJobs({ 'data.reminderId': reminder._id });

    // Delete logs
    await ReminderLog.deleteMany({ reminderId: reminder._id });

    // Delete reminder
    await Reminder.findByIdAndDelete(reminder._id);

    res.json({ message: req.t('common:routes.reminderDeletedSuccessfully') });
  } catch (error) {
    console.error('Error deleting reminder:', error);
    res.status(500).json({ error: req.t('common:routes.failedToDeleteReminder') });
  }
});

// POST /api/reminders/:id/toggle - Toggle active/inactive
router.post('/:id/toggle', async (req, res) => {
  try {
    const reminder = await Reminder.findOne(
      buildSchoolScopedQuery(req.user.schoolId, { _id: req.params.id })
    );

    if (!reminder) {
      return res.status(404).json({ error: req.t('common:routes.reminderNotFound') });
    }

    // If active state is provided in request body, use it; otherwise toggle
    const { active } = req.body;
    reminder.isActive = active !== undefined ? active : !reminder.isActive;

    if (!reminder.isActive) {
      // Cancel scheduled jobs
      await cancelJobs({ 'data.reminderId': reminder._id });
      reminder.nextExecutionAt = null;
    } else {
      // Reschedule
      await scheduleJob('check reminder triggers', reminder.startDate, {
        reminderId: reminder._id,
      });
      reminder.nextExecutionAt = reminder.startDate;
    }

    await reminder.save();

    res.json(reminder);
  } catch (error) {
    console.error('Error toggling reminder:', error);
    res.status(500).json({ error: req.t('common:routes.failedToToggleReminder') });
  }
});

// POST /api/reminders/:id/duplicate - Duplicate reminder
router.post('/:id/duplicate', async (req, res) => {
  try {
    const reminder = await Reminder.findOne(
      buildSchoolScopedQuery(req.user.schoolId, { _id: req.params.id })
    );

    if (!reminder) {
      return res.status(404).json({ error: req.t('common:routes.reminderNotFound') });
    }

    // Create a duplicate
    const duplicate = new Reminder({
      title: `${reminder.title} (Copy)`,
      type: reminder.type,
      triggers: reminder.triggers,
      message: reminder.message,
      templateId: reminder.templateId,
      recipients: reminder.recipients,
      channels: reminder.channels,
      startDate: reminder.startDate,
      endDate: reminder.endDate,
      frequency: reminder.frequency,
      isActive: false, // Start as inactive
      createdBy: req.user.id,
      schoolId: req.user.schoolId,
      nextExecutionAt: null,
    });

    await duplicate.save();

    res.status(201).json(duplicate);
  } catch (error) {
    console.error('Error duplicating reminder:', error);
    res.status(500).json({ error: req.t('common:routes.failedToDuplicateReminder') });
  }
});

// Reminder Templates routes
// GET /api/reminders/templates - Get all templates
router.get('/templates/all', async (req, res) => {
  try {
    const { type } = req.query;
    const query = buildSchoolScopedQuery(req.user.schoolId, {});
    if (type) query.type = type;

    const templates = await ReminderTemplate.find(query)
      .sort({ isDefault: -1, name: 1 })
      .populate('createdBy', 'name')
      .lean();

    res.json(templates);
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ error: req.t('common:routes.failedToFetchTemplates') });
  }
});

// POST /api/reminders/templates - Create template
router.post('/templates', async (req, res) => {
  try {
    const { name, type, message, variables, defaultChannels, isDefault, category, description } =
      req.body;
    const user = req.user;

    const template = new ReminderTemplate({
      name,
      type,
      message,
      variables,
      defaultChannels,
      isDefault: isDefault || false,
      createdBy: user.id,
      schoolId: user.schoolId,
      category,
      description,
    });

    await template.save();

    res.status(201).json(template);
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({ error: req.t('common:routes.failedToCreateTemplate') });
  }
});

// PUT /api/reminders/templates/:id - Update template
router.put('/templates/:id', async (req, res) => {
  try {
    const template = await ReminderTemplate.findOne(
      buildSchoolScopedQuery(req.user.schoolId, { _id: req.params.id })
    );

    if (!template) {
      return res.status(404).json({ error: req.t('common:routes.templateNotFound') });
    }

    const { name, type, message, variables, defaultChannels, isDefault, category, description } =
      req.body;

    if (name) template.name = name;
    if (type) template.type = type;
    if (message) template.message = message;
    if (variables) template.variables = variables;
    if (defaultChannels) template.defaultChannels = defaultChannels;
    if (isDefault !== undefined) template.isDefault = isDefault;
    if (category) template.category = category;
    if (description) template.description = description;

    await template.save();

    res.json(template);
  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({ error: req.t('common:routes.failedToUpdateTemplate') });
  }
});

// PUT /api/reminders/templates/:id/default - Set template as default
router.put('/templates/:id/default', async (req, res) => {
  try {
    const template = await ReminderTemplate.findOne(
      buildSchoolScopedQuery(req.user.schoolId, { _id: req.params.id })
    );

    if (!template) {
      return res.status(404).json({
        error: req.t('common:routes.templateNotFound', { defaultValue: 'Template not found' }),
      });
    }

    // Unset isDefault on all other templates of the same type within this school
    await ReminderTemplate.updateMany(
      buildSchoolScopedQuery(req.user.schoolId, {
        type: template.type,
        _id: { $ne: template._id },
      }),
      { $set: { isDefault: false } }
    );

    // Set this template as default
    template.isDefault = true;
    await template.save();

    res.json(template);
  } catch (error) {
    console.error('Error setting default template:', error);
    res
      .status(500)
      .json({
        error: req.t('common:routes.failedToUpdateTemplate', {
          defaultValue: 'Failed to update template',
        }),
      });
  }
});

// DELETE /api/reminders/templates/:id - Delete template
router.delete('/templates/:id', async (req, res) => {
  try {
    const template = await ReminderTemplate.findOneAndDelete(
      buildSchoolScopedQuery(req.user.schoolId, { _id: req.params.id })
    );
    if (!template) {
      return res.status(404).json({
        error: req.t('common:routes.templateNotFound', { defaultValue: 'Template not found' }),
      });
    }
    res.json({ message: req.t('common:routes.templateDeletedSuccessfully') });
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({ error: req.t('common:routes.failedToDeleteTemplate') });
  }
});

// ── EMAIL-03: SMS Delivery Rate Monitoring ─────────────────────────────────────

/**
 * GET /api/reminders/sms-delivery-stats
 *
 * Returns SMS delivery rate aggregated from ReminderLog.channels where channel = 'sms'.
 * Filters by optional ?from=YYYY-MM-DD&to=YYYY-MM-DD&reminderId=...
 *
 * Response:
 *   { total, sent, delivered, failed, deliveryRate, failureRate, byReminder: [...] }
 */
router.get('/sms-delivery-stats', async (req, res) => {
  try {
    const { from, to, reminderId } = req.query;
    const schoolId = req.user?.schoolId;

    const matchStage = {};
    if (schoolId) {
      matchStage.schoolId = new mongoose.Types.ObjectId(schoolId);
    }
    if (reminderId) {
      matchStage.reminderId = new mongoose.Types.ObjectId(reminderId);
    }

    if (from || to) {
      matchStage.createdAt = {};
      if (from) matchStage.createdAt.$gte = new Date(from);
      if (to) matchStage.createdAt.$lte = new Date(`${to}T23:59:59.999Z`);
    }

    const logs = await ReminderLog.find(matchStage).lean();

    // Extract only SMS channel entries
    let total = 0;
    let sent = 0;
    let delivered = 0;
    let failed = 0;
    const byReminder = {};

    for (const log of logs) {
      for (const ch of log.channels || []) {
        if (ch.channel !== 'sms') continue;
        total++;
        const rid = log.reminderId?.toString();
        if (!byReminder[rid]) byReminder[rid] = { total: 0, sent: 0, delivered: 0, failed: 0 };
        byReminder[rid].total++;

        if (ch.status === 'delivered' || ch.status === 'read') {
          delivered++;
          byReminder[rid].delivered++;
        } else if (ch.status === 'failed') {
          failed++;
          byReminder[rid].failed++;
        } else {
          sent++;
          byReminder[rid].sent++;
        }
      }
    }

    const deliveryRate = total > 0 ? Math.round((delivered / total) * 10000) / 100 : 0;
    const failureRate = total > 0 ? Math.round((failed / total) * 10000) / 100 : 0;

    res.json({
      total,
      sent,
      delivered,
      failed,
      deliveryRate, // percentage of messages confirmed delivered
      failureRate, // percentage of messages that failed
      byReminder: Object.entries(byReminder).map(([id, stats]) => ({ reminderId: id, ...stats })),
    });
  } catch (error) {
    logger.error('SMS delivery stats error', { error });
    res.status(500).json({ error: 'Failed to fetch SMS delivery stats' });
  }
});

export default router;
