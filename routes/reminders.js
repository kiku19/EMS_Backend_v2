import express from 'express';
import Reminder from '../models/Reminder.js';
import ReminderTemplate from '../models/ReminderTemplate.js';
import ReminderLog from '../models/ReminderLog.js';
import { scheduleJob, cancelJobs } from '../config/agenda.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticate);

// POST /api/reminders - Create reminder
router.post('/', async (req, res) => {
  try {
    const { title, type, triggers, message, templateId, recipients, channels, startDate, endDate, frequency } = req.body;
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
      nextExecutionAt: new Date(startDate)
    });

    await reminder.save();

    // Schedule the reminder
    await scheduleJob('check reminder triggers', new Date(startDate), {
      reminderId: reminder._id
    });

    res.status(201).json(reminder);
  } catch (error) {
    console.error('Error creating reminder:', error);
    res.status(500).json({ error: 'Failed to create reminder' });
  }
});

// GET /api/reminders - List all reminders
router.get('/', async (req, res) => {
  try {
    const { type, isActive, page = 1, limit = 20 } = req.query;

    const query = {};
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
      total
    });
  } catch (error) {
    console.error('Error fetching reminders:', error);
    res.status(500).json({ error: 'Failed to fetch reminders' });
  }
});

// GET /api/reminders/:id - Get reminder details
router.get('/:id', async (req, res) => {
  try {
    const reminder = await Reminder.findById(req.params.id)
      .populate('createdBy', 'name')
      .populate('templateId', 'name message')
      .lean();

    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found' });
    }

    // Get execution logs
    const logs = await ReminderLog.find({ reminderId: reminder._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json({ ...reminder, logs });
  } catch (error) {
    console.error('Error fetching reminder:', error);
    res.status(500).json({ error: 'Failed to fetch reminder' });
  }
});

// PUT /api/reminders/:id - Update reminder
router.put('/:id', async (req, res) => {
  try {
    const reminder = await Reminder.findById(req.params.id);

    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found' });
    }

    const { title, type, triggers, message, recipients, channels, startDate, endDate, frequency } = req.body;

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
    res.status(500).json({ error: 'Failed to update reminder' });
  }
});

// DELETE /api/reminders/:id - Delete reminder
router.delete('/:id', async (req, res) => {
  try {
    const reminder = await Reminder.findById(req.params.id);

    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found' });
    }

    // Cancel scheduled jobs
    await cancelJobs({ 'data.reminderId': reminder._id });

    // Delete logs
    await ReminderLog.deleteMany({ reminderId: reminder._id });

    // Delete reminder
    await Reminder.findByIdAndDelete(reminder._id);

    res.json({ message: 'Reminder deleted successfully' });
  } catch (error) {
    console.error('Error deleting reminder:', error);
    res.status(500).json({ error: 'Failed to delete reminder' });
  }
});

// POST /api/reminders/:id/toggle - Toggle active/inactive
router.post('/:id/toggle', async (req, res) => {
  try {
    const reminder = await Reminder.findById(req.params.id);

    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found' });
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
        reminderId: reminder._id
      });
      reminder.nextExecutionAt = reminder.startDate;
    }

    await reminder.save();

    res.json(reminder);
  } catch (error) {
    console.error('Error toggling reminder:', error);
    res.status(500).json({ error: 'Failed to toggle reminder' });
  }
});

// POST /api/reminders/:id/duplicate - Duplicate reminder
router.post('/:id/duplicate', async (req, res) => {
  try {
    const reminder = await Reminder.findById(req.params.id);

    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found' });
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
      nextExecutionAt: null
    });

    await duplicate.save();

    res.status(201).json(duplicate);
  } catch (error) {
    console.error('Error duplicating reminder:', error);
    res.status(500).json({ error: 'Failed to duplicate reminder' });
  }
});

// Reminder Templates routes
// GET /api/reminders/templates - Get all templates
router.get('/templates/all', async (req, res) => {
  try {
    const { type } = req.query;
    const query = {};
    if (type) query.type = type;

    const templates = await ReminderTemplate.find(query)
      .sort({ isDefault: -1, name: 1 })
      .populate('createdBy', 'name')
      .lean();

    res.json(templates);
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// POST /api/reminders/templates - Create template
router.post('/templates', async (req, res) => {
  try {
    const { name, type, message, variables, defaultChannels, isDefault, category, description } = req.body;
    const user = req.user;

    const template = new ReminderTemplate({
      name,
      type,
      message,
      variables,
      defaultChannels,
      isDefault: isDefault || false,
      createdBy: user.id,
      category,
      description
    });

    await template.save();

    res.status(201).json(template);
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// PUT /api/reminders/templates/:id - Update template
router.put('/templates/:id', async (req, res) => {
  try {
    const template = await ReminderTemplate.findById(req.params.id);

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const { name, type, message, variables, defaultChannels, isDefault, category, description } = req.body;

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
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// DELETE /api/reminders/templates/:id - Delete template
router.delete('/templates/:id', async (req, res) => {
  try {
    await ReminderTemplate.findByIdAndDelete(req.params.id);
    res.json({ message: 'Template deleted successfully' });
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

export default router;
