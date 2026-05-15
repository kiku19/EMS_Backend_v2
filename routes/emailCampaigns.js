import express from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import EmailCampaign from '../models/EmailCampaign.js';
import { Student, Attendance } from '../database.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import Parent from '../models/Parent.js';
import { sendEmail } from '../config/email.js';
import { authenticate } from '../middleware/auth.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import { scheduleJob, cancelJobs } from '../config/agenda.js';
import { logToTrash } from '../services/trashService.js';

const router = express.Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const targetCriteriaSchema = z.object({
  groupType: z.enum(['all_parents', 'by_class', 'fee_defaulters', 'attendance_below']),
  classIds: z.array(z.string()).optional().default([]),
  feeStatus: z.enum(['pending', 'partial']).optional().default('pending'),
  attendanceThreshold: z.number().min(0).max(100).optional().default(75),
  academicYear: z.string().optional(),
});

const createCampaignSchema = z.object({
  name: z.string().min(1, 'Campaign name is required').max(200),
  subject: z.string().min(1, 'Email subject is required').max(500),
  htmlBody: z.string().min(1, 'Email body is required'),
  textBody: z.string().optional(),
  targetCriteria: targetCriteriaSchema,
  scheduledFor: z.string().datetime({ offset: true }).optional().nullable(),
});

const updateCampaignSchema = createCampaignSchema.partial();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scopeBySchool(schoolId, query = {}) {
  const normalized = extractSchoolId(schoolId);
  if (!normalized) throw new Error('schoolId is required');
  return { ...query, schoolId: normalized };
}

/**
 * Resolve parent email recipients from targeting criteria.
 * Returns array of { email, parentName, studentName, studentId, parentId }
 */
async function resolveParentRecipients(criteria, schoolId) {
  const schoolFilter = { schoolId };
  let studentIds = null;

  if (criteria.groupType === 'by_class') {
    if (!criteria.classIds || criteria.classIds.length === 0) {
      throw new Error('classIds required for by_class targeting');
    }
    const classObjectIds = criteria.classIds.map((id) => new mongoose.Types.ObjectId(id));
    const students = await Student.find({
      classId: { $in: classObjectIds },
      isActive: true,
      isDeleted: { $ne: true },
      ...schoolFilter,
    })
      .select('_id')
      .lean();
    studentIds = students.map((s) => s._id);
  } else if (criteria.groupType === 'fee_defaulters') {
    const feeStatus = criteria.feeStatus || 'pending';
    const feeQuery = { schoolId, overallStatus: feeStatus };
    if (criteria.academicYear) feeQuery.academicYear = criteria.academicYear;
    const feeStructures = await StudentFeeStructure.find(feeQuery).select('studentId').lean();
    studentIds = [...new Set(feeStructures.map((f) => f.studentId.toString()))].map(
      (id) => new mongoose.Types.ObjectId(id)
    );
  } else if (criteria.groupType === 'attendance_below') {
    const threshold = criteria.attendanceThreshold ?? 75;
    // Aggregate attendance per student: find students below threshold
    const matchFilter = { ...schoolFilter };
    if (criteria.classIds && criteria.classIds.length > 0) {
      matchFilter.classId = { $in: criteria.classIds.map((id) => new mongoose.Types.ObjectId(id)) };
    }
    const agg = await Attendance.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: '$studentId',
          total: { $sum: 1 },
          present: {
            $sum: {
              $cond: [{ $in: ['$status', ['present', 'late', 'halfday']] }, 1, 0],
            },
          },
        },
      },
      {
        $project: {
          attendancePct: {
            $multiply: [{ $divide: ['$present', '$total'] }, 100],
          },
        },
      },
      { $match: { attendancePct: { $lt: threshold } } },
    ]);
    studentIds = agg.map((r) => r._id);
  }
  // else: all_parents — studentIds stays null (fetch all)

  // Fetch students with parent email info
  const studentQuery = {
    isActive: true,
    isDeleted: { $ne: true },
    ...schoolFilter,
  };
  if (studentIds !== null) {
    if (studentIds.length === 0) return []; // no matching students
    studentQuery._id = { $in: studentIds };
  }

  const students = await Student.find(studentQuery)
    .select('_id name parents classId')
    .lean();

  const seen = new Set();
  const recipients = [];

  for (const student of students) {
    // Collect all parent emails for this student (de-duplicated per email)
    const parentEntries = [];

    // parents array
    if (Array.isArray(student.parents)) {
      for (const p of student.parents) {
        if (p.email) {
          parentEntries.push({ email: p.email.toLowerCase(), name: p.name || 'Parent' });
        }
      }
    }

    for (const entry of parentEntries) {
      if (!seen.has(entry.email)) {
        seen.add(entry.email);
        recipients.push({
          email: entry.email,
          parentName: entry.name,
          studentName: student.name,
          studentId: student._id,
          status: 'pending',
          openCount: 0,
          clickCount: 0,
        });
      }
    }
  }

  // Also check Parent model for linked parents (may not have student.parentEmail set)
  const linkedParentQuery = {
    schoolId,
    status: 'active',
    email: { $exists: true, $nin: [null, ''] },
  };
  if (studentIds !== null && studentIds.length > 0) {
    linkedParentQuery['children.studentId'] = { $in: studentIds };
  } else if (studentIds === null) {
    // all_parents from Parent model too
  } else {
    // empty list — already returned above
  }

  const linkedParents = await Parent.find(linkedParentQuery)
    .select('_id name email children')
    .lean();
  for (const parent of linkedParents) {
    if (parent.email && !seen.has(parent.email.toLowerCase())) {
      seen.add(parent.email.toLowerCase());
      // Find a child name for context
      const childId = parent.children?.[0]?.studentId;
      const childStudent = childId
        ? students.find((s) => s._id.toString() === childId.toString())
        : null;
      recipients.push({
        email: parent.email.toLowerCase(),
        parentName: parent.name,
        studentName: childStudent?.name || '',
        studentId: childId || null,
        parentId: parent._id,
        status: 'pending',
        openCount: 0,
        clickCount: 0,
      });
    }
  }

  return recipients;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.use(authenticate);

// POST /email-campaigns — Create campaign (draft or scheduled)
router.post('/', async (req, res) => {
  try {
    const parsed = createCampaignSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { name, subject, htmlBody, textBody, targetCriteria, scheduledFor } = parsed.data;
    const schoolId = extractSchoolId(req.user?.schoolId);

    const campaign = new EmailCampaign({
      schoolId,
      name,
      subject,
      htmlBody,
      textBody,
      targetCriteria,
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
      status: scheduledFor ? 'scheduled' : 'draft',
      createdBy: req.user.id,
    });
    await campaign.save();

    if (scheduledFor) {
      await scheduleJob('send email campaign', scheduledFor, { campaignId: campaign._id });
    }

    res.status(201).json(campaign);
  } catch (error) {
    console.error('Error creating email campaign:', error);
    res.status(500).json({ error: 'Failed to create email campaign' });
  }
});

// GET /email-campaigns — List campaigns
router.get('/', async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query = scopeBySchool(req.user?.schoolId);
    if (status) query.status = status;

    const campaigns = await EmailCampaign.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .populate('createdBy', 'name')
      .select('-recipients')
      .lean();

    const total = await EmailCampaign.countDocuments(query);

    res.json({
      campaigns,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: Number(page),
    });
  } catch (error) {
    console.error('Error fetching email campaigns:', error);
    res.status(500).json({ error: 'Failed to fetch email campaigns' });
  }
});

// GET /email-campaigns/:id — Get campaign details with analytics
router.get('/:id', async (req, res) => {
  try {
    const campaign = await EmailCampaign.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    )
      .populate('createdBy', 'name')
      .lean();

    if (!campaign) {
      return res.status(404).json({ error: 'Email campaign not found' });
    }

    res.json(campaign);
  } catch (error) {
    console.error('Error fetching email campaign:', error);
    res.status(500).json({ error: 'Failed to fetch email campaign' });
  }
});

// PUT /email-campaigns/:id — Update draft/scheduled campaign
router.put('/:id', async (req, res) => {
  try {
    const campaign = await EmailCampaign.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    );
    if (!campaign) {
      return res.status(404).json({ error: 'Email campaign not found' });
    }
    if (campaign.status === 'sent' || campaign.status === 'sending') {
      return res.status(400).json({ error: 'Cannot edit a campaign that is sent or sending' });
    }

    const parsed = updateCampaignSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { name, subject, htmlBody, textBody, targetCriteria, scheduledFor } = parsed.data;

    if (name !== undefined) campaign.name = name;
    if (subject !== undefined) campaign.subject = subject;
    if (htmlBody !== undefined) campaign.htmlBody = htmlBody;
    if (textBody !== undefined) campaign.textBody = textBody;
    if (targetCriteria !== undefined) campaign.targetCriteria = targetCriteria;

    if (scheduledFor !== undefined) {
      // Cancel existing scheduled job
      if (campaign.scheduledFor) {
        await cancelJobs({ 'data.campaignId': campaign._id });
      }
      if (scheduledFor) {
        campaign.scheduledFor = new Date(scheduledFor);
        campaign.status = 'scheduled';
        await scheduleJob('send email campaign', campaign.scheduledFor, {
          campaignId: campaign._id,
        });
      } else {
        campaign.scheduledFor = null;
        campaign.status = 'draft';
      }
    }

    await campaign.save();
    res.json(campaign);
  } catch (error) {
    console.error('Error updating email campaign:', error);
    res.status(500).json({ error: 'Failed to update email campaign' });
  }
});

// DELETE /email-campaigns/:id — Delete campaign
router.delete('/:id', async (req, res) => {
  try {
    const campaign = await EmailCampaign.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    );
    if (!campaign) {
      return res.status(404).json({ error: 'Email campaign not found' });
    }
    if (campaign.scheduledFor) {
      await cancelJobs({ 'data.campaignId': campaign._id });
    }
    const campaignSnapshot = campaign.toObject();
    await EmailCampaign.findByIdAndDelete(campaign._id);

    logToTrash({
      itemType: 'EmailCampaign',
      itemId: campaignSnapshot._id,
      itemName: campaignSnapshot.name || campaignSnapshot.subject || 'Email Campaign',
      originalData: campaignSnapshot,
      deletedBy: req.user?.id || req.user?._id,
      schoolId: req.user?.schoolId,
    }).catch(() => {});

    res.json({ message: 'Email campaign deleted successfully' });
  } catch (error) {
    console.error('Error deleting email campaign:', error);
    res.status(500).json({ error: 'Failed to delete email campaign' });
  }
});

// GET /email-campaigns/:id/preview-html — EMAIL-05: Return rendered HTML body for preview
router.get('/:id/preview-html', async (req, res) => {
  try {
    const campaign = await EmailCampaign.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    ).lean();
    if (!campaign) {
      return res.status(404).json({ error: 'Email campaign not found' });
    }

    // Wrap the stored htmlBody in a minimal preview envelope so the browser
    // renders it correctly when injected into an iframe via srcdoc.
    const htmlBody = campaign.htmlBody || campaign.body || '';
    const preview = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Email Preview — ${campaign.subject || 'Campaign'}</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 24px; }
    .preview-wrapper { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
    .preview-header { background: #4f46e5; color: #fff; padding: 16px 24px; font-size: 13px; }
    .preview-body { padding: 24px; }
  </style>
</head>
<body>
  <div class="preview-wrapper">
    <div class="preview-header">
      <strong>Subject:</strong> ${campaign.subject || '(no subject)'}<br/>
      <strong>From:</strong> ${campaign.senderName || 'School'} &lt;${campaign.senderEmail || 'no-reply@school.com'}&gt;
    </div>
    <div class="preview-body">${htmlBody}</div>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.send(preview);
  } catch (error) {
    console.error('Error generating email preview:', error);
    res.status(500).json({ error: 'Failed to generate email preview' });
  }
});

// POST /email-campaigns/:id/preview-recipients — Preview recipients without sending
router.post('/:id/preview-recipients', async (req, res) => {
  try {
    const campaign = await EmailCampaign.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    ).lean();
    if (!campaign) {
      return res.status(404).json({ error: 'Email campaign not found' });
    }
    const schoolId = extractSchoolId(req.user?.schoolId);
    const recipients = await resolveParentRecipients(campaign.targetCriteria, schoolId);
    res.json({ count: recipients.length, recipients: recipients.slice(0, 50) }); // cap preview at 50
  } catch (error) {
    console.error('Error previewing recipients:', error);
    res.status(500).json({ error: 'Failed to preview recipients' });
  }
});

// POST /email-campaigns/:id/send — Send campaign immediately
router.post('/:id/send', async (req, res) => {
  try {
    const campaign = await EmailCampaign.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    );
    if (!campaign) {
      return res.status(404).json({ error: 'Email campaign not found' });
    }
    if (campaign.status === 'sent' || campaign.status === 'sending') {
      return res.status(400).json({ error: 'Campaign already sent or sending' });
    }

    const schoolId = extractSchoolId(req.user?.schoolId);

    // Resolve recipients
    const recipients = await resolveParentRecipients(campaign.targetCriteria, schoolId);
    if (recipients.length === 0) {
      return res.status(400).json({ error: 'No recipients found for the selected target group' });
    }

    // Mark as sending and store recipients
    campaign.status = 'sending';
    campaign.recipients = recipients;
    campaign.analytics.totalRecipients = recipients.length;
    campaign.sentAt = new Date();
    await campaign.save();

    // Send emails asynchronously (fire and forget; update status in background)
    sendCampaignEmails(
      campaign._id,
      recipients,
      campaign.subject,
      campaign.htmlBody,
      campaign.textBody,
      schoolId
    );

    res.json({ message: 'Campaign is being sent', totalRecipients: recipients.length });
  } catch (error) {
    console.error('Error sending email campaign:', error);
    res.status(500).json({ error: 'Failed to send email campaign' });
  }
});

// GET /email-campaigns/:id/analytics — Get campaign analytics
router.get('/:id/analytics', async (req, res) => {
  try {
    const campaign = await EmailCampaign.findOne(
      scopeBySchool(req.user?.schoolId, { _id: req.params.id })
    ).lean();
    if (!campaign) {
      return res.status(404).json({ error: 'Email campaign not found' });
    }

    const { recipients = [], analytics } = campaign;
    const failed = recipients.filter((r) => r.status === 'failed' || r.status === 'bounced');

    res.json({
      campaign: {
        _id: campaign._id,
        name: campaign.name,
        subject: campaign.subject,
        status: campaign.status,
        sentAt: campaign.sentAt,
        completedAt: campaign.completedAt,
        targetCriteria: campaign.targetCriteria,
      },
      analytics,
      failedRecipients: failed.map((r) => ({
        email: r.email,
        parentName: r.parentName,
        studentName: r.studentName,
        status: r.status,
        error: r.error,
      })),
    });
  } catch (error) {
    console.error('Error fetching campaign analytics:', error);
    res.status(500).json({ error: 'Failed to fetch campaign analytics' });
  }
});

// ─── Background send helper ───────────────────────────────────────────────────

async function sendCampaignEmails(campaignId, recipients, subject, htmlBody, textBody, schoolId) {
  let sentCount = 0;
  let failedCount = 0;

  const campaign = await EmailCampaign.findById(campaignId);
  if (!campaign) return;

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i];
    try {
      // Personalise: replace {{parentName}} and {{studentName}} placeholders
      const personalHtml = htmlBody
        .replace(/\{\{parentName\}\}/g, recipient.parentName || 'Parent')
        .replace(/\{\{studentName\}\}/g, recipient.studentName || 'Student');
      const personalText = textBody
        ? textBody
            .replace(/\{\{parentName\}\}/g, recipient.parentName || 'Parent')
            .replace(/\{\{studentName\}\}/g, recipient.studentName || 'Student')
        : undefined;

      await sendEmail({
        to: recipient.email,
        subject,
        html: personalHtml,
        text: personalText,
        schoolId,
      });

      campaign.recipients[i].status = 'sent';
      campaign.recipients[i].sentAt = new Date();
      sentCount++;
    } catch (err) {
      campaign.recipients[i].status = 'failed';
      campaign.recipients[i].error = err.message?.slice(0, 200);
      failedCount++;
    }

    // Save progress every 10 emails
    if ((i + 1) % 10 === 0 || i === recipients.length - 1) {
      await campaign.save();
    }
  }

  // Update analytics and mark complete
  campaign.analytics.sentCount = sentCount;
  campaign.analytics.failedCount = failedCount;
  campaign.analytics.totalRecipients = recipients.length;
  campaign.status =
    failedCount === recipients.length ? 'failed' : failedCount > 0 ? 'partial' : 'sent';
  campaign.completedAt = new Date();
  await campaign.save();
}

// POST /email-campaigns/:id/test — Send a test email to a single address
router.post('/:id/test', async (req, res) => {
  try {
    const schoolId = extractSchoolId(req.user?.schoolId);
    const campaign = await EmailCampaign.findOne(
      scopeBySchool(schoolId, { _id: req.params.id })
    ).lean();

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const testEmail = req.body?.email;
    if (!testEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail)) {
      return res.status(400).json({ error: 'A valid test email address is required' });
    }

    const personalHtml = campaign.htmlBody
      .replace(/\{\{parentName\}\}/g, 'Test Parent')
      .replace(/\{\{studentName\}\}/g, 'Test Student');

    await sendEmail({
      to: testEmail,
      subject: `[TEST] ${campaign.subject}`,
      html: personalHtml,
      text: campaign.textBody || undefined,
      schoolId,
    });

    res.json({ success: true, message: `Test email sent to ${testEmail}` });
  } catch (err) {
    console.error('[EmailCampaigns] Test send error:', err);
    res.status(500).json({ error: err.message || 'Failed to send test email' });
  }
});

export default router;
