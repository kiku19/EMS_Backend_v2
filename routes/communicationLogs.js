import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { Announcement, AnnouncementRecipient } from '../database.js';
import { extractSchoolId } from '../utils/schoolContext.js';

const router = express.Router();
router.use(authenticate);

const channelEnum = z.enum(['email', 'sms', 'whatsapp', 'inapp']);
const statusEnum = z.enum(['pending', 'sent', 'delivered', 'read', 'failed']);

const listQuerySchema = z.object({
  channel: channelEnum.optional(),
  status: statusEnum.optional(),
  search: z.string().max(200).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

/**
 * Build the aggregation pipeline used by both the list and count queries.
 *
 * We keep the first `$match` as light as possible (school + date range on the
 * recipient document) and only `$unwind` deliveryStatus afterwards so MongoDB
 * can use the `{ schoolId: 1, announcementId: 1 }` index before expanding the
 * array. Channel / status filtering and text search happen after unwind.
 */
function buildPipeline(req) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    const err = new Error(`Validation failed: ${issues}`);
    err.status = 400;
    throw err;
  }

  const { channel, status, search, dateFrom, dateTo, page, limit } = parsed.data;
  const normalizedSchoolId = extractSchoolId(req.user?.schoolId);
  if (!normalizedSchoolId) {
    const err = new Error('schoolId is required');
    err.status = 401;
    throw err;
  }
  const schoolQuery = {
    schoolId: mongoose.Types.ObjectId.isValid(normalizedSchoolId)
      ? new mongoose.Types.ObjectId(normalizedSchoolId)
      : normalizedSchoolId,
  };

  const matchStage = { $match: schoolQuery };

  const lookupStage = {
    $lookup: {
      from: 'announcements',
      localField: 'announcementId',
      foreignField: '_id',
      as: 'announcement',
    },
  };

  const unwindAnnouncementStage = {
    $unwind: { path: '$announcement', preserveNullAndEmptyArrays: true },
  };

  const unwindStage = { $unwind: '$deliveryStatus' };

  const postUnwindMatch = { $match: {} };
  if (channel) postUnwindMatch.$match['deliveryStatus.channel'] = channel;
  if (status) postUnwindMatch.$match['deliveryStatus.status'] = status;

  if (dateFrom || dateTo) {
    postUnwindMatch.$match['deliveryStatus.sentAt'] = {};
    if (dateFrom) postUnwindMatch.$match['deliveryStatus.sentAt'].$gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      postUnwindMatch.$match['deliveryStatus.sentAt'].$lte = end;
    }
  }

  const searchMatch = { $match: {} };
  if (search && search.trim()) {
    const q = search.trim();
    searchMatch.$match.$or = [
      { 'announcement.title': { $regex: q, $options: 'i' } },
      { name: { $regex: q, $options: 'i' } },
      { email: { $regex: q, $options: 'i' } },
      { phone: { $regex: q, $options: 'i' } },
    ];
  }

  const projectStage = {
    $project: {
      _id: 1,
      announcementId: 1,
      announcementTitle: { $ifNull: ['$announcement.title', '—'] },
      subject: { $ifNull: ['$announcement.title', '—'] },
      content: { $ifNull: ['$announcement.content', ''] },
      userId: 1,
      userType: 1,
      recipientName: {
        $cond: { if: { $and: ['$name', { $ne: ['$name', ''] }] }, then: '$name', else: '—' },
      },
      recipientEmail: '$email',
      recipientPhone: '$phone',
      recipient: {
        $cond: {
          if: { $and: ['$email', { $ne: ['$email', ''] }] },
          then: '$email',
          else: {
            $cond: { if: { $and: ['$phone', { $ne: ['$phone', ''] }] }, then: '$phone', else: '—' },
          },
        },
      },
      name: {
        $cond: { if: { $and: ['$name', { $ne: ['$name', ''] }] }, then: '$name', else: '—' },
      },
      channel: '$deliveryStatus.channel',
      type: '$deliveryStatus.channel',
      status: '$deliveryStatus.status',
      sentAt: '$deliveryStatus.sentAt',
      deliveredAt: '$deliveryStatus.deliveredAt',
      readAt: '$deliveryStatus.readAt',
      error: '$deliveryStatus.error',
      messageId: '$deliveryStatus.messageId',
      createdAt: 1,
      updatedAt: 1,
    },
  };

  const sortStage = { $sort: { sentAt: -1, createdAt: -1 } };
  const skipStage = { $skip: (page - 1) * limit };
  const limitStage = { $limit: limit };

  return {
    page,
    limit,
    pipeline: [
      matchStage,
      lookupStage,
      unwindAnnouncementStage,
      unwindStage,
      postUnwindMatch,
      searchMatch,
      projectStage,
      sortStage,
      skipStage,
      limitStage,
    ],
    countPipeline: [
      matchStage,
      lookupStage,
      unwindAnnouncementStage,
      unwindStage,
      postUnwindMatch,
      searchMatch,
      { $count: 'total' },
    ],
  };
}

// GET /api/communication-logs — list individual communication logs
router.get('/', async (req, res) => {
  try {
    const { page, limit, pipeline, countPipeline } = buildPipeline(req);

    const [logs, countResult] = await Promise.all([
      AnnouncementRecipient.aggregate(pipeline).allowDiskUse(true),
      AnnouncementRecipient.aggregate(countPipeline).allowDiskUse(true),
    ]);

    const total = countResult[0]?.total || 0;

    res.json({
      logs,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Error fetching communication logs:', error);
    res.status(500).json({ error: req.t('common:routes.failedToFetchCommunicationLogs') });
  }
});

// GET /api/communication-logs/stats — aggregate stats for the dashboard cards
router.get('/stats', async (req, res) => {
  try {
    const normalizedSchoolId = extractSchoolId(req.user?.schoolId);
    if (!normalizedSchoolId) {
      return res.status(401).json({ error: 'Unauthorized: missing schoolId' });
    }
    const schoolQuery = {
      schoolId: mongoose.Types.ObjectId.isValid(normalizedSchoolId)
        ? new mongoose.Types.ObjectId(normalizedSchoolId)
        : normalizedSchoolId,
    };

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Sent this month — any deliveryStatus with a sentAt in this month
    const sentThisMonthAgg = await AnnouncementRecipient.aggregate([
      { $match: { ...schoolQuery, createdAt: { $gte: startOfMonth } } },
      { $unwind: '$deliveryStatus' },
      { $match: { 'deliveryStatus.sentAt': { $gte: startOfMonth } } },
      { $count: 'total' },
    ]);
    const sentThisMonth = sentThisMonthAgg[0]?.total || 0;

    // Total delivered/read across all channels
    const totalDeliveredAgg = await AnnouncementRecipient.aggregate([
      { $match: schoolQuery },
      { $unwind: '$deliveryStatus' },
      { $match: { 'deliveryStatus.status': { $in: ['delivered', 'read'] } } },
      { $count: 'total' },
    ]);
    const totalDelivered = totalDeliveredAgg[0]?.total || 0;

    // Total failed
    const totalFailedAgg = await AnnouncementRecipient.aggregate([
      { $match: schoolQuery },
      { $unwind: '$deliveryStatus' },
      { $match: { 'deliveryStatus.status': 'failed' } },
      { $count: 'total' },
    ]);
    const totalFailed = totalFailedAgg[0]?.total || 0;

    // Total sent logs
    const totalSentAgg = await AnnouncementRecipient.aggregate([
      { $match: schoolQuery },
      { $unwind: '$deliveryStatus' },
      { $match: { 'deliveryStatus.status': { $ne: 'pending' } } },
      { $count: 'total' },
    ]);
    const totalSent = totalSentAgg[0]?.total || 0;

    // Scheduled announcements (pending future sends)
    const scheduled = await Announcement.countDocuments({
      ...schoolQuery,
      status: 'scheduled',
    });

    res.json({
      sentThisMonth,
      totalDelivered,
      totalFailed,
      totalSent,
      scheduled,
    });
  } catch (error) {
    console.error('Error fetching communication log stats:', error);
    res.status(500).json({ error: req.t('common:routes.failedToFetchCommunicationLogStats') });
  }
});

export default router;
