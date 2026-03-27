/**
 * @swagger
 * tags:
 *   name: Announcements
 *   description: School-wide announcement management with multi-channel delivery (email, SMS, WhatsApp, in-app)
 */

/**
 * @swagger
 * /announcements:
 *   post:
 *     summary: Create a new announcement (draft or scheduled)
 *     tags: [Announcements]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, content, recipients, channels]
 *             properties:
 *               title:
 *                 type: string
 *                 example: Parent-Teacher Meeting
 *               content:
 *                 type: string
 *                 example: PTM scheduled for Saturday 10 AM
 *               recipients:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: [all, staff, students, parents, custom]
 *                     classIds:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/ObjectId'
 *                     userIds:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/ObjectId'
 *               channels:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [email, sms, whatsapp, inapp]
 *               scheduledFor:
 *                 type: string
 *                 format: date-time
 *                 description: If provided, announcement is scheduled; otherwise saved as draft
 *               attachments:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uri
 *     responses:
 *       201:
 *         description: Announcement created
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @swagger
 * /announcements:
 *   get:
 *     summary: List announcements with filters
 *     tags: [Announcements]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, scheduled, sending, sent]
 *       - in: query
 *         name: dateFrom
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: dateTo
 *         schema:
 *           type: string
 *           format: date
 *       - $ref: '#/components/parameters/PageQuery'
 *       - $ref: '#/components/parameters/LimitQuery'
 *     responses:
 *       200:
 *         description: Paginated list of announcements
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 announcements:
 *                   type: array
 *                   items:
 *                     type: object
 *                 totalPages:
 *                   type: integer
 *                 currentPage:
 *                   type: integer
 *                 total:
 *                   type: integer
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @swagger
 * /announcements/{id}:
 *   get:
 *     summary: Get announcement details with recipient list
 *     tags: [Announcements]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: Announcement with recipients
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   put:
 *     summary: Update a draft or scheduled announcement
 *     tags: [Announcements]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               content:
 *                 type: string
 *               recipients:
 *                 type: array
 *                 items:
 *                   type: object
 *               channels:
 *                 type: array
 *                 items:
 *                   type: string
 *               scheduledFor:
 *                 type: string
 *                 format: date-time
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Updated announcement
 *       400:
 *         description: Cannot edit sent announcement
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   delete:
 *     summary: Delete an announcement (cancels scheduled job if pending)
 *     tags: [Announcements]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: Announcement deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @swagger
 * /announcements/{id}/send:
 *   post:
 *     summary: Send an announcement immediately
 *     tags: [Announcements]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: Announcement sent
 *       400:
 *         description: Announcement already sent
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @swagger
 * /announcements/{id}/analytics:
 *   get:
 *     summary: Get delivery analytics for an announcement
 *     tags: [Announcements]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: Announcement analytics with per-channel delivery stats
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 announcement:
 *                   type: object
 *                 stats:
 *                   type: object
 *                   properties:
 *                     totalRecipients:
 *                       type: integer
 *                     sent:
 *                       type: integer
 *                     delivered:
 *                       type: integer
 *                     read:
 *                       type: integer
 *                     failed:
 *                       type: integer
 *                     byChannel:
 *                       type: object
 *                 failedRecipients:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

/**
 * @swagger
 * /announcements/{id}/resend:
 *   post:
 *     summary: Resend announcement to failed recipients
 *     tags: [Announcements]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               recipients:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/ObjectId'
 *                 description: Specific recipient IDs to resend to; if omitted, resends to all failed
 *     responses:
 *       200:
 *         description: Announcement resent
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

import express from 'express';
import { z } from 'zod';
import { connectDB, Staff, Student, Class } from '../database.js';
import Announcement from '../models/Announcement.js';
import AnnouncementRecipient from '../models/AnnouncementRecipient.js';
import { sendAnnouncementEmail, buildAnnouncementEmailHtml } from '../services/emailService.js';
import { sendEmail } from '../config/email.js';
import { sendAnnouncementSMS } from '../services/smsService.js';
import { sendAnnouncementWhatsApp } from '../services/whatsappService.js';
import { scheduleJob, cancelJobs } from '../config/agenda.js';
import { authenticate } from '../middleware/auth.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';
import { dispatchWebhookEvent } from '../services/webhookService.js';
import { createSmsRateLimiter } from '../middleware/tenantRateLimit.js';
import { EVENTS, emitEvent } from '../utils/socketEvents.js';

// --- Zod validation schemas ---

// Shared sub-schemas
const recipientSchema = z.object({
  type: z.enum(['all', 'staff', 'students', 'parents', 'custom'], {
    required_error: 'Recipient type is required',
    invalid_type_error: 'Recipient type must be one of: all, staff, students, parents, custom',
  }),
  classIds: z.array(z.string().min(1)).optional().default([]),
  userIds: z.array(z.string().min(1)).optional().default([]),
});

const attachmentSchema = z.object({
  url: z.string().url('Invalid attachment URL').optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  size: z.number().nonnegative().optional(),
});

const channelEnum = z.enum(['email', 'sms', 'whatsapp', 'inapp'], {
  invalid_type_error: 'Channel must be one of: email, sms, whatsapp, inapp',
});

// Create announcement schema
const createAnnouncementSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title must be 200 characters or fewer'),
  content: z.string().min(1, 'Content is required'),
  recipients: z.array(recipientSchema).min(1, 'At least one recipient group is required'),
  channels: z.array(channelEnum).min(1, 'At least one channel is required'),
  attachments: z.array(attachmentSchema).optional().default([]),
  scheduledFor: z.string().datetime({ offset: true }).nullable().optional(),
});

// Update announcement schema (all fields optional)
const updateAnnouncementSchema = z.object({
  title: z
    .string()
    .min(1, 'Title cannot be empty')
    .max(200, 'Title must be 200 characters or fewer')
    .optional(),
  content: z.string().min(1, 'Content cannot be empty').optional(),
  recipients: z
    .array(recipientSchema)
    .min(1, 'At least one recipient group is required')
    .optional(),
  channels: z.array(channelEnum).min(1, 'At least one channel is required').optional(),
  attachments: z.array(attachmentSchema).optional(),
  scheduledFor: z.string().datetime({ offset: true }).nullable().optional(),
});

// Zod schemas for email preview/test-send
const previewEmailSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().min(1, 'Content is required'),
  attachments: z
    .array(z.object({ name: z.string(), url: z.string().url() }))
    .optional()
    .default([]),
  lang: z.enum(['en', 'hi', 'ta', 'te', 'kn', 'ur']).optional().default('en'),
});

const testSendSchema = previewEmailSchema.extend({
  testEmail: z.string().email('Invalid test email address'),
});

const smsRateLimiter = createSmsRateLimiter();

const router = express.Router();

function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) throw new Error('schoolId is required for scoped queries');
  return { ...query, schoolId: normalizedSchoolId };
}

async function resolveRequestSchoolId(req) {
  if (req.user?.schoolId) return extractSchoolId(req.user.schoolId);
  const school = await ensureDefaultSchool();
  return extractSchoolId(school._id);
}

// All routes require authentication
router.use(authenticate);

// Helper function to resolve recipients
async function resolveRecipients(recipients, schoolId) {
  const recipientList = [];
  const schoolFilter = schoolId ? { schoolId } : {};

  for (const recipient of recipients) {
    if (recipient.type === 'all') {
      // Get all staff
      const staff = await Staff.find({ isActive: true, ...schoolFilter });
      staff.forEach((s) =>
        recipientList.push({
          userId: s._id,
          userType: 'Staff',
          email: s.email,
          phone: s.phone,
        })
      );

      // Get all students
      const students = await Student.find({ isActive: true, ...schoolFilter });
      students.forEach((s) =>
        recipientList.push({
          userId: s._id,
          userType: 'Student',
          email: s.email,
          phone: s.phone,
        })
      );
    } else if (recipient.type === 'staff') {
      const staff = await Staff.find({ isActive: true, ...schoolFilter });
      staff.forEach((s) =>
        recipientList.push({
          userId: s._id,
          userType: 'Staff',
          email: s.email,
          phone: s.phone,
        })
      );
    } else if (recipient.type === 'students') {
      if (recipient.classIds && recipient.classIds.length > 0) {
        // Get students from specific classes
        const classes = await Class.find({ _id: { $in: recipient.classIds }, ...schoolFilter });
        for (const cls of classes) {
          for (const studentId of cls.students) {
            const student = await Student.findById(studentId);
            if (student) {
              recipientList.push({
                userId: student._id,
                userType: 'Student',
                email: student.email,
                phone: student.phone,
              });
            }
          }
        }
      } else {
        // All students
        const students = await Student.find({ isActive: true, ...schoolFilter });
        students.forEach((s) =>
          recipientList.push({
            userId: s._id,
            userType: 'Student',
            email: s.email,
            phone: s.phone,
          })
        );
      }
    } else if (recipient.type === 'parents') {
      // Get parents of students
      const students = await Student.find({ isActive: true, ...schoolFilter });
      students.forEach((s) => {
        if (s.parent && s.parent.email) {
          recipientList.push({
            userId: s._id, // Use student ID as reference
            userType: 'Parent',
            email: s.parent.email,
            phone: s.parent.phone,
          });
        }
      });
    } else if (recipient.type === 'custom' && recipient.userIds) {
      // Custom user list
      for (const userId of recipient.userIds) {
        // Check if Staff or Student
        const staff = await Staff.findOne({ _id: userId, ...schoolFilter });
        if (staff) {
          recipientList.push({
            userId: staff._id,
            userType: 'Staff',
            email: staff.email,
            phone: staff.phone,
          });
        } else {
          const student = await Student.findOne({ _id: userId, ...schoolFilter });
          if (student) {
            recipientList.push({
              userId: student._id,
              userType: 'Student',
              email: student.email,
              phone: student.phone,
            });
          }
        }
      }
    }
  }

  // Remove duplicates
  const uniqueRecipients = [];
  const seen = new Set();
  for (const r of recipientList) {
    const key = `${r.userId}-${r.userType}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueRecipients.push(r);
    }
  }

  return uniqueRecipients;
}

// POST /api/announcements - Create announcement (draft)
router.post('/', async (req, res) => {
  try {
    // Validate request body with Zod
    const parsed = createAnnouncementSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: req.t('common:routes.validationFailed'),
        details: parsed.error.flatten(),
      });
    }

    const { title, content, recipients, channels, attachments, scheduledFor } = parsed.data;
    const user = req.user;

    // Require schoolId — multi-tenancy guard
    if (!user.schoolId) {
      return res.status(401).json({ error: 'Unauthorized: missing schoolId' });
    }

    // Create announcement
    const announcement = new Announcement({
      title,
      content,
      recipients,
      channels: channels.map((ch) => ({
        type: ch,
        status: 'pending',
      })),
      attachments: attachments || [],
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
      status: scheduledFor ? 'scheduled' : 'draft',
      createdBy: user.id,
      creatorModel: user.role === 'admin' || user.role === 'staff' ? 'Staff' : 'Student',
      schoolId: extractSchoolId(user.schoolId),
    });

    await announcement.save();

    // If scheduled, create job
    if (scheduledFor) {
      await scheduleJob('send scheduled announcement', scheduledFor, {
        announcementId: announcement._id,
      });
    }

    res.status(201).json(announcement);
  } catch (error) {
    console.error('Error creating announcement:', error);
    res.status(500).json({ error: req.t('common:routes.failedToCreateAnnouncement') });
  }
});

// GET /api/announcements - List all announcements with filters
router.get('/', async (req, res) => {
  try {
    const { status, recipients, channel, dateFrom, dateTo, page = 1, limit = 20 } = req.query;

    const query = {};

    if (status) {
      query.status = status;
    }

    if (dateFrom || dateTo) {
      query.scheduledFor = {};
      if (dateFrom) query.scheduledFor.$gte = new Date(dateFrom);
      if (dateTo) query.scheduledFor.$lte = new Date(dateTo);
    }

    const scopedQuery = scopeBySchool(req.user?.schoolId, query);

    const announcements = await Announcement.find(scopedQuery)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('createdBy', 'name profileImage')
      .lean();

    const total = await Announcement.countDocuments(scopedQuery);

    res.json({
      announcements,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total,
    });
  } catch (error) {
    console.error('Error fetching announcements:', error);
    res.status(500).json({ error: req.t('common:routes.failedToFetchAnnouncements') });
  }
});

// GET /api/announcements/stats - Get announcement stats for dashboard cards
router.get('/stats', async (req, res) => {
  try {
    const schoolId = await resolveRequestSchoolId(req);
    const baseQuery = scopeBySchool(schoolId);

    // Count sent this month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const sentThisMonth = await Announcement.countDocuments({
      ...baseQuery,
      status: 'sent',
      createdAt: { $gte: startOfMonth },
    });

    // Count scheduled (pending)
    const scheduled = await Announcement.countDocuments({
      ...baseQuery,
      status: 'scheduled',
    });

    // Total recipients delivered across all sent announcements
    const sentAnnouncementIds = await Announcement.find(
      { ...baseQuery, status: 'sent' },
      { _id: 1 }
    ).lean();
    const ids = sentAnnouncementIds.map((a) => a._id);

    let totalDelivered = 0;
    if (ids.length > 0) {
      const deliveredAgg = await AnnouncementRecipient.aggregate([
        { $match: { announcementId: { $in: ids } } },
        { $unwind: '$deliveryStatus' },
        {
          $match: {
            'deliveryStatus.status': { $in: ['delivered', 'read'] },
          },
        },
        { $count: 'total' },
      ]);
      totalDelivered = deliveredAgg[0]?.total || 0;
    }

    res.json({
      sentThisMonth,
      totalDelivered,
      scheduled,
    });
  } catch (error) {
    console.error('Error fetching announcement stats:', error);
    res.status(500).json({ error: req.t('common:routes.failedToFetchAnnouncementStats') });
  }
});

// POST /api/announcements/preview-email - Return rendered email HTML without saving/sending
router.post('/preview-email', async (req, res) => {
  try {
    const parsed = previewEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: req.t('common:routes.validationFailed'), details: parsed.error.flatten() });
    }
    const { title, content, attachments, lang } = parsed.data;
    const { html, subject } = buildAnnouncementEmailHtml(
      { title, content, attachments },
      'Recipient',
      lang
    );
    res.json({ html, subject });
  } catch (error) {
    console.error('Error generating email preview:', error);
    res.status(500).json({ error: req.t('common:routes.failedToGenerateEmailPreview') });
  }
});

// POST /api/announcements/test-send - Send a test email to a specific address
router.post('/test-send', async (req, res) => {
  try {
    const parsed = testSendSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: req.t('common:routes.validationFailed'), details: parsed.error.flatten() });
    }
    const { title, content, attachments, lang, testEmail } = parsed.data;
    const { html, subject } = buildAnnouncementEmailHtml(
      { title, content, attachments },
      'Test Recipient',
      lang
    );
    await sendEmail({ to: testEmail, subject: `[TEST] ${subject}`, html });
    res.json({ message: `Test email sent to ${testEmail}` });
  } catch (error) {
    console.error('Error sending test email:', error);
    res.status(500).json({ error: req.t('common:routes.failedToSendTestEmail') });
  }
});

// GET /api/announcements/:id - Get announcement details
router.get('/:id', async (req, res) => {
  try {
    const announcement = await Announcement.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    )
      .populate('createdBy', 'name profileImage')
      .lean();

    if (!announcement) {
      return res.status(404).json({ error: req.t('common:routes.announcementNotFound') });
    }

    // Get recipients
    const recipients = await AnnouncementRecipient.find({ announcementId: announcement._id })
      .populate('userId', 'name email phone')
      .lean();

    res.json({ ...announcement, recipients });
  } catch (error) {
    console.error('Error fetching announcement:', error);
    res.status(500).json({ error: req.t('common:routes.failedToFetchAnnouncement') });
  }
});

// PUT /api/announcements/:id - Update announcement (draft or scheduled only)
router.put('/:id', async (req, res) => {
  try {
    const announcement = await Announcement.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    );

    if (!announcement) {
      return res.status(404).json({ error: req.t('common:routes.announcementNotFound') });
    }

    // Can only edit draft or scheduled announcements
    if (announcement.status === 'sent' || announcement.status === 'sending') {
      return res.status(400).json({ error: req.t('common:routes.cannotEditSentAnnouncement') });
    }

    // Validate request body with Zod
    const parsed = updateAnnouncementSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: req.t('common:routes.validationFailed'),
        details: parsed.error.flatten(),
      });
    }

    const { title, content, recipients, channels, attachments, scheduledFor } = parsed.data;

    if (title) announcement.title = title;
    if (content) announcement.content = content;
    if (recipients) announcement.recipients = recipients;
    if (channels) announcement.channels = channels;
    if (attachments) announcement.attachments = attachments;

    // Update scheduled time
    if (scheduledFor !== undefined) {
      const newScheduledTime = new Date(scheduledFor);

      // Cancel existing scheduled job
      if (announcement.scheduledFor) {
        await cancelJobs({ 'data.announcementId': announcement._id });
      }

      if (newScheduledTime) {
        announcement.scheduledFor = newScheduledTime;
        announcement.status = 'scheduled';
        await scheduleJob('send scheduled announcement', newScheduledTime, {
          announcementId: announcement._id,
        });
      } else {
        announcement.scheduledFor = null;
        announcement.status = 'draft';
      }
    }

    await announcement.save();

    res.json(announcement);
  } catch (error) {
    console.error('Error updating announcement:', error);
    res.status(500).json({ error: req.t('common:routes.failedToUpdateAnnouncement') });
  }
});

// DELETE /api/announcements/:id - Delete announcement
router.delete('/:id', async (req, res) => {
  try {
    const announcement = await Announcement.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    );

    if (!announcement) {
      return res.status(404).json({ error: req.t('common:routes.announcementNotFound') });
    }

    // Cancel scheduled job if exists
    if (announcement.scheduledFor) {
      await cancelJobs({ 'data.announcementId': announcement._id });
    }

    // Soft delete announcement instead of hard delete to preserve audit trail
    announcement.isDeleted = true;
    announcement.deletedAt = new Date();
    announcement.deletedBy = req.user._id;
    await announcement.save();

    res.json({ message: req.t('common:routes.announcementDeletedSuccessfully') });
  } catch (error) {
    console.error('Error deleting announcement:', error);
    res.status(500).json({ error: req.t('common:routes.failedToDeleteAnnouncement') });
  }
});

// POST /api/announcements/:id/send - Send announcement immediately
router.post('/:id/send', smsRateLimiter, async (req, res) => {
  try {
    const announcement = await Announcement.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    );

    if (!announcement) {
      return res.status(404).json({ error: req.t('common:routes.announcementNotFound') });
    }

    if (announcement.status === 'sent') {
      return res.status(400).json({ error: req.t('common:routes.announcementAlreadySent') });
    }

    // Import the send function
    const { sendScheduledAnnouncement } = await import('../services/announcementSender.js');
    await sendScheduledAnnouncement(announcement._id);

    dispatchWebhookEvent(req.user?.schoolId, 'announcement.sent', {
      id: announcement._id,
      title: announcement.title,
      channels: announcement.channels,
    }).catch(() => {});

    const io = req.app.get('io');
    emitEvent(io, EVENTS.ANNOUNCEMENT_PUBLISHED, {
      schoolId: announcement.schoolId?.toString(),
      announcementId: announcement._id.toString(),
      title: announcement.title,
      targetType: announcement.recipients?.[0]?.type,
    });

    res.json({ message: req.t('common:routes.announcementSentSuccessfully') });
  } catch (error) {
    console.error('Error sending announcement:', error);
    res.status(500).json({ error: req.t('common:routes.failedToSendAnnouncement') });
  }
});

// GET /api/announcements/:id/analytics - Get announcement analytics
router.get('/:id/analytics', async (req, res) => {
  try {
    const announcement = await Announcement.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    )
      .populate('createdBy', 'name profileImage')
      .lean();

    if (!announcement) {
      return res.status(404).json({ error: req.t('common:routes.announcementNotFound') });
    }

    // Get recipient stats
    const recipients = await AnnouncementRecipient.find({ announcementId: announcement._id });

    const stats = {
      totalRecipients: recipients.length,
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      openCount: 0,
      clickCount: 0,
      bounceCount: 0,
      openRate: 0, // % of sent
      clickRate: 0, // % of opens
      bounceRate: 0, // % of sent
      byChannel: {
        email: {
          sent: 0,
          delivered: 0,
          read: 0,
          failed: 0,
          openCount: 0,
          clickCount: 0,
          bounceCount: 0,
        },
        sms: { sent: 0, delivered: 0, read: 0, failed: 0 },
        whatsapp: { sent: 0, delivered: 0, read: 0, failed: 0 },
        inapp: { sent: 0, delivered: 0, read: 0, failed: 0 },
      },
    };

    recipients.forEach((r) => {
      r.deliveryStatus.forEach((ds) => {
        const ch = stats.byChannel[ds.channel];
        if (!ch) return;
        if (ds.status !== 'pending') stats.sent++;
        if (ds.status === 'delivered' || ds.status === 'read') stats.delivered++;
        if (ds.status === 'read') stats.read++;
        if (ds.status === 'failed') stats.failed++;
        ch[ds.status] = (ch[ds.status] || 0) + 1;

        // Open / click / bounce (email only)
        if (ds.channel === 'email') {
          const opens = ds.openCount || 0;
          const clicks = ds.clickCount || 0;
          stats.openCount += opens;
          stats.clickCount += clicks;
          ch.openCount += opens;
          ch.clickCount += clicks;
          if (ds.bouncedAt) {
            stats.bounceCount++;
            ch.bounceCount++;
          }
        }
      });
    });

    // Calculate rates
    if (stats.sent > 0) {
      stats.openRate = Math.round((stats.openCount / stats.sent) * 100);
      stats.bounceRate = Math.round((stats.bounceCount / stats.sent) * 100);
    }
    if (stats.openCount > 0) {
      stats.clickRate = Math.round((stats.clickCount / stats.openCount) * 100);
    }

    // Get failed recipients
    const failedRecipients = recipients.filter((r) =>
      r.deliveryStatus.some((ds) => ds.status === 'failed')
    );

    res.json({
      announcement,
      stats,
      failedRecipients: failedRecipients.map((r) => ({
        userId: r.userId,
        userType: r.userType,
        errors: r.deliveryStatus
          .filter((ds) => ds.status === 'failed')
          .map((ds) => ({
            channel: ds.channel,
            error: ds.error,
          })),
      })),
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: req.t('common:routes.failedToFetchAnalytics') });
  }
});

// POST /api/announcements/:id/resend - Resend failed announcement
router.post('/:id/resend', smsRateLimiter, async (req, res) => {
  try {
    const { recipients } = req.body; // Array of recipient IDs to resend to

    const announcement = await Announcement.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    );

    if (!announcement) {
      return res.status(404).json({ error: req.t('common:routes.announcementNotFound') });
    }

    // Get failed recipients
    const failedRecipients = await AnnouncementRecipient.find({
      announcementId: announcement._id,
      'deliveryStatus.status': 'failed',
    });

    if (recipients && recipients.length > 0) {
      // Resend to specific recipients
      const targetRecipients = failedRecipients.filter((r) =>
        recipients.includes(r.userId.toString())
      );

      // Trigger resend logic
      const { sendScheduledAnnouncement } = await import('../services/announcementSender.js');
      for (const recipient of targetRecipients) {
        await sendScheduledAnnouncement(announcement._id, [recipient.userId]);
      }
    } else {
      // Resend to all failed
      const { sendScheduledAnnouncement } = await import('../services/announcementSender.js');
      const failedIds = failedRecipients.map((r) => r.userId);
      await sendScheduledAnnouncement(announcement._id, failedIds);
    }

    res.json({ message: req.t('common:routes.announcementResentSuccessfully') });
  } catch (error) {
    console.error('Error resending announcement:', error);
    res.status(500).json({ error: req.t('common:routes.failedToResendAnnouncement') });
  }
});

export default router;
