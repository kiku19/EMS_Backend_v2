import express from 'express';
import { connectDB, Staff, Student, Class } from '../database.js';
import Announcement from '../models/Announcement.js';
import AnnouncementRecipient from '../models/AnnouncementRecipient.js';
import { sendAnnouncementEmail } from '../services/emailService.js';
import { sendAnnouncementSMS } from '../services/smsService.js';
import { sendAnnouncementWhatsApp } from '../services/whatsappService.js';
import { scheduleJob, cancelJobs } from '../config/agenda.js';
import { authenticate } from '../middleware/auth.js';
import { extractSchoolId, ensureDefaultSchool } from '../utils/schoolContext.js';

const router = express.Router();

function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) return { ...query };
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
async function resolveRecipients(recipients) {
  const recipientList = [];

  for (const recipient of recipients) {
    if (recipient.type === 'all') {
      // Get all staff
      const staff = await Staff.find({ isActive: true });
      staff.forEach(s => recipientList.push({
        userId: s._id,
        userType: 'Staff',
        email: s.email,
        phone: s.phone
      }));

      // Get all students
      const students = await Student.find({ isActive: true });
      students.forEach(s => recipientList.push({
        userId: s._id,
        userType: 'Student',
        email: s.email,
        phone: s.phone
      }));
    } else if (recipient.type === 'staff') {
      const staff = await Staff.find({ isActive: true });
      staff.forEach(s => recipientList.push({
        userId: s._id,
        userType: 'Staff',
        email: s.email,
        phone: s.phone
      }));
    } else if (recipient.type === 'students') {
      if (recipient.classIds && recipient.classIds.length > 0) {
        // Get students from specific classes
        const classes = await Class.find({ _id: { $in: recipient.classIds } });
        for (const cls of classes) {
          cls.students.forEach(studentId => {
            const student = Student.findById(studentId);
            if (student) {
              recipientList.push({
                userId: student._id,
                userType: 'Student',
                email: student.email,
                phone: student.phone
              });
            }
          });
        }
      } else {
        // All students
        const students = await Student.find({ isActive: true });
        students.forEach(s => recipientList.push({
          userId: s._id,
          userType: 'Student',
          email: s.email,
          phone: s.phone
        }));
      }
    } else if (recipient.type === 'parents') {
      // Get parents of students
      const students = await Student.find({ isActive: true });
      students.forEach(s => {
        if (s.parent && s.parent.email) {
          recipientList.push({
            userId: s._id, // Use student ID as reference
            userType: 'Parent',
            email: s.parent.email,
            phone: s.parent.phone
          });
        }
      });
    } else if (recipient.type === 'custom' && recipient.userIds) {
      // Custom user list
      for (const userId of recipient.userIds) {
        // Check if Staff or Student
        const staff = await Staff.findById(userId);
        if (staff) {
          recipientList.push({
            userId: staff._id,
            userType: 'Staff',
            email: staff.email,
            phone: staff.phone
          });
        } else {
          const student = await Student.findById(userId);
          if (student) {
            recipientList.push({
              userId: student._id,
              userType: 'Student',
              email: student.email,
              phone: student.phone
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
    const { title, content, recipients, channels, attachments, scheduledFor } = req.body;
    const user = req.user;

    // Validate required fields
    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }

    if (!recipients || recipients.length === 0) {
      return res.status(400).json({ error: 'Recipients are required' });
    }

    // Create announcement
    const announcement = new Announcement({
      title,
      content,
      recipients,
      channels: channels.map(ch => ({
        type: ch,
        status: 'pending'
      })),
      attachments: attachments || [],
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
      status: scheduledFor ? 'scheduled' : 'draft',
      createdBy: user.id,
      creatorModel: user.role === 'admin' || user.role === 'staff' ? 'Staff' : 'Student',
      schoolId: req.user?.schoolId ? extractSchoolId(req.user.schoolId) : undefined
    });

    await announcement.save();

    // If scheduled, create job
    if (scheduledFor) {
      await scheduleJob('send scheduled announcement', scheduledFor, {
        announcementId: announcement._id
      });
    }

    res.status(201).json(announcement);
  } catch (error) {
    console.error('Error creating announcement:', error);
    res.status(500).json({ error: 'Failed to create announcement' });
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
      total
    });
  } catch (error) {
    console.error('Error fetching announcements:', error);
    res.status(500).json({ error: 'Failed to fetch announcements' });
  }
});

// GET /api/announcements/:id - Get announcement details
router.get('/:id', async (req, res) => {
  try {
    const announcement = await Announcement.findOne(scopeBySchool(req.user?.schoolId, { _id: req.params.id }))
      .populate('createdBy', 'name profileImage')
      .lean();

    if (!announcement) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    // Get recipients
    const recipients = await AnnouncementRecipient.find({ announcementId: announcement._id })
      .populate('userId', 'name email phone')
      .lean();

    res.json({ ...announcement, recipients });
  } catch (error) {
    console.error('Error fetching announcement:', error);
    res.status(500).json({ error: 'Failed to fetch announcement' });
  }
});

// PUT /api/announcements/:id - Update announcement (draft or scheduled only)
router.put('/:id', async (req, res) => {
  try {
    const announcement = await Announcement.findOne(scopeBySchool(req.user?.schoolId, { _id: req.params.id }));

    if (!announcement) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    // Can only edit draft or scheduled announcements
    if (announcement.status === 'sent' || announcement.status === 'sending') {
      return res.status(400).json({ error: 'Cannot edit sent announcement' });
    }

    const { title, content, recipients, channels, attachments, scheduledFor } = req.body;

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
          announcementId: announcement._id
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
    res.status(500).json({ error: 'Failed to update announcement' });
  }
});

// DELETE /api/announcements/:id - Delete announcement
router.delete('/:id', async (req, res) => {
  try {
    const announcement = await Announcement.findOne(scopeBySchool(req.user?.schoolId, { _id: req.params.id }));

    if (!announcement) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    // Cancel scheduled job if exists
    if (announcement.scheduledFor) {
      await cancelJobs({ 'data.announcementId': announcement._id });
    }

    // Delete recipients
    await AnnouncementRecipient.deleteMany({ announcementId: announcement._id });

    // Delete announcement
    await Announcement.findByIdAndDelete(announcement._id);

    res.json({ message: 'Announcement deleted successfully' });
  } catch (error) {
    console.error('Error deleting announcement:', error);
    res.status(500).json({ error: 'Failed to delete announcement' });
  }
});

// POST /api/announcements/:id/send - Send announcement immediately
router.post('/:id/send', async (req, res) => {
  try {
    const announcement = await Announcement.findOne(scopeBySchool(req.user?.schoolId, { _id: req.params.id }));

    if (!announcement) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    if (announcement.status === 'sent') {
      return res.status(400).json({ error: 'Announcement already sent' });
    }

    // Import the send function
    const { sendScheduledAnnouncement } = await import('../services/announcementSender.js');
    await sendScheduledAnnouncement(announcement._id);

    res.json({ message: 'Announcement sent successfully' });
  } catch (error) {
    console.error('Error sending announcement:', error);
    res.status(500).json({ error: 'Failed to send announcement' });
  }
});

// GET /api/announcements/:id/analytics - Get announcement analytics
router.get('/:id/analytics', async (req, res) => {
  try {
    const announcement = await Announcement.findOne(scopeBySchool(req.user?.schoolId, { _id: req.params.id }))
      .populate('createdBy', 'name profileImage')
      .lean();

    if (!announcement) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    // Get recipient stats
    const recipients = await AnnouncementRecipient.find({ announcementId: announcement._id });

    const stats = {
      totalRecipients: recipients.length,
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      byChannel: {
        email: { sent: 0, delivered: 0, read: 0, failed: 0 },
        sms: { sent: 0, delivered: 0, read: 0, failed: 0 },
        whatsapp: { sent: 0, delivered: 0, read: 0, failed: 0 },
        inapp: { sent: 0, delivered: 0, read: 0, failed: 0 }
      }
    };

    recipients.forEach(r => {
      r.deliveryStatus.forEach(ds => {
        stats.byChannel[ds.channel][ds.status]++;
        if (ds.status !== 'pending') stats.sent++;
        if (ds.status === 'delivered' || ds.status === 'read') stats.delivered++;
        if (ds.status === 'read') stats.read++;
        if (ds.status === 'failed') stats.failed++;
      });
    });

    // Get failed recipients
    const failedRecipients = recipients.filter(r =>
      r.deliveryStatus.some(ds => ds.status === 'failed')
    );

    res.json({
      announcement,
      stats,
      failedRecipients: failedRecipients.map(r => ({
        userId: r.userId,
        userType: r.userType,
        errors: r.deliveryStatus.filter(ds => ds.status === 'failed').map(ds => ({
          channel: ds.channel,
          error: ds.error
        }))
      }))
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// POST /api/announcements/:id/resend - Resend failed announcement
router.post('/:id/resend', async (req, res) => {
  try {
    const { recipients } = req.body; // Array of recipient IDs to resend to

    const announcement = await Announcement.findOne(scopeBySchool(req.user?.schoolId, { _id: req.params.id }));

    if (!announcement) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    // Get failed recipients
    const failedRecipients = await AnnouncementRecipient.find({
      announcementId: announcement._id,
      'deliveryStatus.status': 'failed'
    });

    if (recipients && recipients.length > 0) {
      // Resend to specific recipients
      const targetRecipients = failedRecipients.filter(r =>
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
      const failedIds = failedRecipients.map(r => r.userId);
      await sendScheduledAnnouncement(announcement._id, failedIds);
    }

    res.json({ message: 'Announcement resent successfully' });
  } catch (error) {
    console.error('Error resending announcement:', error);
    res.status(500).json({ error: 'Failed to resend announcement' });
  }
});

export default router;
