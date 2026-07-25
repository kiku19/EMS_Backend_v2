import { randomBytes } from 'crypto';
import mongoose from 'mongoose';
import Announcement from '../models/Announcement.js';
import AnnouncementRecipient from '../models/AnnouncementRecipient.js';
import { Staff, Student, Class } from '../database.js';
import { sendAnnouncementEmail } from './emailService.js';
import { sendAnnouncementSMS } from './smsService.js';
import { sendAnnouncementWhatsApp } from './whatsappService.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('AnnouncementSender');

// Helper function to resolve recipients
// Exported so the announcements route (and other callers) reuse the exact
// same resolution logic — the route previously had a divergent local copy
// that ignored isActive/schoolId scoping for class students.
export async function resolveRecipients(recipients, schoolId) {
  const recipientList = [];
  const schoolFilter = schoolId ? { schoolId } : {};

  for (const recipient of recipients) {
    if (recipient.type === 'all') {
      const staff = await Staff.find({ isActive: true, ...schoolFilter });
      staff.forEach((s) =>
        recipientList.push({
          userId: s._id,
          userType: 'Staff',
          name: s.name,
          email: s.email,
          phone: s.phone,
        })
      );

      const students = await Student.find({ isActive: true, ...schoolFilter });
      students.forEach((s) =>
        recipientList.push({
          userId: s._id,
          userType: 'Student',
          name: s.name,
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
          name: s.name,
          email: s.email,
          phone: s.phone,
        })
      );
    } else if (recipient.type === 'students') {
      if (recipient.classIds && recipient.classIds.length > 0) {
        // Resolve class members directly from Student so we can enforce the
        // same isActive + schoolId scoping used everywhere else. Reading the
        // raw cls.students array previously pulled in inactive students and
        // (if a class doc leaked across tenants) students from another school.
        const students = await Student.find({
          classId: { $in: recipient.classIds },
          isActive: true,
          ...schoolFilter,
        });
        students.forEach((student) => {
          recipientList.push({
            userId: student._id,
            userType: 'Student',
            name: student.name,
            email: student.email,
            phone: student.phone,
          });
        });
      } else {
        const students = await Student.find({ isActive: true, ...schoolFilter });
        students.forEach((s) =>
          recipientList.push({
            userId: s._id,
            userType: 'Student',
            name: s.name,
            email: s.email,
            phone: s.phone,
          })
        );
      }
    } else if (recipient.type === 'parents') {
      const students = await Student.find({ isActive: true, ...schoolFilter }).populate('parent');
      students.forEach((s) => {
        if (s.parent && s.parent.email) {
          recipientList.push({
            userId: s._id,
            userType: 'Parent',
            name: s.parent.name || s.name + "'s Parent",
            email: s.parent.email,
            phone: s.parent.phone,
          });
        }
      });
    } else if (recipient.type === 'custom' && recipient.userIds) {
      for (const userId of recipient.userIds) {
        const staff = await Staff.findOne({ _id: userId, ...schoolFilter });
        if (staff) {
          recipientList.push({
            userId: staff._id,
            userType: 'Staff',
            name: staff.name,
            email: staff.email,
            phone: staff.phone,
          });
        } else {
          const student = await Student.findOne({ _id: userId, ...schoolFilter });
          if (student) {
            recipientList.push({
              userId: student._id,
              userType: 'Student',
              name: student.name,
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

// Recompute announcement analytics across ALL AnnouncementRecipient docs.
//
// The in-memory `recipients` array only reflects the batch processed in the
// current call, which is wrong for resends: POST /:id/resend invokes
// sendScheduledAnnouncement once per recipient with specificRecipients=[userId],
// so the old "analytics.sentCount = recipients.length" code overwrote the
// totals with the single-recipient batch. Aggregating across every persisted
// AnnouncementRecipient doc gives correct cumulative totals regardless of how
// many resend passes have run.
async function recomputeAnalytics(announcementId) {
  const [agg] = await AnnouncementRecipient.aggregate([
    { $match: { announcementId: mongoose.Types.ObjectId(announcementId) } },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              totalRecipients: { $sum: 1 },
              // Mirrors the per-recipient predicates used below:
              //  - sent/delivered: at least one deliveryStatus reached sent/delivered/read
              //  - failed: at least one deliveryStatus is failed
              sentCount: {
                $sum: {
                  $cond: [
                    {
                      $gt: [
                        {
                          $size: {
                            $filter: {
                              input: '$deliveryStatus',
                              as: 'ds',
                              cond: {
                                $in: ['$$ds.status', ['sent', 'delivered', 'read']],
                              },
                            },
                          },
                        },
                        0,
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              // deliveredCount counts only recipients with a deliveryStatus
              // explicitly in delivered/read. Email/SMS/WhatsApp only ever set
              // status='sent' (no webhooks), so counting 'sent' as delivered
              // inflated the metric; only inapp delivery (and webhook-driven
              // confirmations) reach 'delivered'/'read'.
              deliveredCount: {
                $sum: {
                  $cond: [
                    {
                      $gt: [
                        {
                          $size: {
                            $filter: {
                              input: '$deliveryStatus',
                              as: 'ds',
                              cond: { $in: ['$$ds.status', ['delivered', 'read']] },
                            },
                          },
                        },
                        0,
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              failedCount: {
                $sum: {
                  $cond: [
                    {
                      $gt: [
                        {
                          $size: {
                            $filter: {
                              input: '$deliveryStatus',
                              as: 'ds',
                              cond: { $eq: ['$$ds.status', 'failed'] },
                            },
                          },
                        },
                        0,
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              openCount: { $sum: { $ifNull: [{ $sum: '$deliveryStatus.openCount' }, 0] } },
              clickCount: { $sum: { $ifNull: [{ $sum: '$deliveryStatus.clickCount' }, 0] } },
              bounceCount: {
                $sum: {
                  $size: {
                    $filter: {
                      input: '$deliveryStatus',
                      as: 'ds',
                      cond: { $ifNull: ['$$ds.bouncedAt', false] },
                    },
                  },
                },
              },
            },
          },
        ],
      },
    },
  ]);

  const totals = (agg && agg.totals && agg.totals[0]) || {
    totalRecipients: 0,
    sentCount: 0,
    deliveredCount: 0,
    failedCount: 0,
    openCount: 0,
    clickCount: 0,
    bounceCount: 0,
  };

  await Announcement.updateOne(
    { _id: announcementId },
    {
      $set: {
        'analytics.totalRecipients': totals.totalRecipients,
        'analytics.sentCount': totals.sentCount,
        'analytics.deliveredCount': totals.deliveredCount,
        'analytics.failedCount': totals.failedCount,
        'analytics.openCount': totals.openCount,
        'analytics.clickCount': totals.clickCount,
        'analytics.bounceCount': totals.bounceCount,
      },
    }
  );

  return totals;
}

// Main function to send scheduled announcement
export async function sendScheduledAnnouncement(announcementId, specificRecipients = null) {
  let announcement;
  try {
    announcement = await Announcement.findById(announcementId);

    if (!announcement) {
      logger.warn({ announcementId }, 'Announcement not found');
      return;
    }

    logger.info({ announcementId, title: announcement.title }, 'Sending announcement');

    // Update status
    announcement.status = 'sending';
    await announcement.save();

    // Get recipients
    let recipients;
    if (specificRecipients) {
      // Get specific recipients for resend
      recipients = await AnnouncementRecipient.find({
        announcementId: announcement._id,
        userId: { $in: specificRecipients },
      });
    } else {
      // Resolve all recipients
      const resolvedRecipients = await resolveRecipients(
        announcement.recipients,
        announcement.schoolId
      );

      // Upsert recipient records. Re-sending a partial/failed announcement
      // (only `sent` is guarded upstream) previously hit AnnouncementRecipient.create
      // again and minted duplicate (announcementId, userId) docs. find-or-create
      // via upsert keeps existing docs (preserving their delivery history) and
      // only inserts genuinely new recipients.
      if (resolvedRecipients.length > 0) {
        const ops = resolvedRecipients.map((r) => ({
          updateOne: {
            filter: {
              announcementId: announcement._id,
              userId: r.userId,
            },
            update: {
              $setOnInsert: {
                schoolId: announcement.schoolId,
                announcementId: announcement._id,
                userId: r.userId,
                userType: r.userType,
                name: r.name || '',
                email: r.email || '',
                phone: r.phone || '',
                deliveryStatus: announcement.channels.map((ch) => ({
                  channel: ch.type,
                  status: 'pending',
                })),
              },
            },
            upsert: true,
          },
        }));
        await AnnouncementRecipient.bulkWrite(ops, { ordered: false });
      }

      // Re-fetch (including pre-existing docs) so the delivery loop has a
      // hydrated set to iterate over.
      recipients = await AnnouncementRecipient.find({
        announcementId: announcement._id,
      });
    }

    // Update total recipients
    announcement.analytics.totalRecipients = recipients.length;

    // Send via each channel
    for (const channel of announcement.channels) {
      const channelType = channel.type;
      logger.info({ channelType }, 'Sending via channel');

      channel.status = 'sending';
      channel.stats.totalRecipients = recipients.length;

      for (const recipient of recipients) {
        const deliveryStatus = recipient.deliveryStatus.find((ds) => ds.channel === channelType);

        // Skip suppressed email rows entirely on retries: they are permanently
        // undeliverable and were intentionally kept at status 'pending' (out of
        // the failed pool). We detect them by the durable `[suppressed]` marker
        // written into the schema-backed `error` field on the first attempt.
        if (
          typeof deliveryStatus?.error === 'string' &&
          deliveryStatus.error.startsWith('[suppressed]')
        ) {
          continue;
        }

        if (!deliveryStatus || deliveryStatus.status === 'failed') {
          try {
            if (channelType === 'email') {
              // Generate unique tracking token for open/click analytics
              if (!deliveryStatus.trackingToken) {
                deliveryStatus.trackingToken = randomBytes(20).toString('hex');
              }
              const result = await sendAnnouncementEmail(
                announcement,
                recipient,
                'en',
                deliveryStatus.trackingToken
              );
              // Suppressed recipients (address on the suppression list) are
              // NOT a hard failure: counting them as failed/bounced both
              // distorted analytics and pulled them back into the failed
              // resend pool (so every resend retried a permanently suppressed
              // address). Record the suppression in the schema-backed `error`
              // field for visibility and leave status at 'pending' so the row
              // is excluded from the failed-based resend query and the failed/
              // bounce counts. (AnnouncementRecipient.deliveryStatus has no
              // dedicated suppressed flag, so we reuse `error` as the durable
              // marker; the in-loop retry guard below also keys off `error`.)
              if (result.suppressed) {
                deliveryStatus.status = 'pending'; // explicitly NOT 'failed'
                deliveryStatus.sentAt = new Date();
                deliveryStatus.error = `[suppressed] ${result.reason || 'suppressed'}`;
              } else if (result.success) {
                deliveryStatus.status = 'sent';
                deliveryStatus.sentAt = new Date();
                if (result.messageId) deliveryStatus.messageId = result.messageId;
                channel.stats.sentCount++;
              } else {
                deliveryStatus.status = 'failed';
                deliveryStatus.sentAt = new Date();
                channel.stats.failedCount++;
                channel.stats.bounceCount = (channel.stats.bounceCount || 0) + 1;
                if (result.error) deliveryStatus.bounceReason = result.error;
                deliveryStatus.bouncedAt = new Date();
              }
            } else if (channelType === 'sms') {
              const result = await sendAnnouncementSMS(
                recipient.phone,
                announcement.title,
                announcement.content
              );
              deliveryStatus.status = result.success ? 'sent' : 'failed';
              deliveryStatus.sentAt = new Date();
              if (result.success) {
                if (result.requestId) deliveryStatus.messageId = result.requestId;
                channel.stats.sentCount++;
              } else {
                channel.stats.failedCount++;
              }
            } else if (channelType === 'whatsapp') {
              const result = await sendAnnouncementWhatsApp(recipient.phone, 'announcement', {
                title: announcement.title,
                content: announcement.content,
              });
              deliveryStatus.status = result.success ? 'sent' : 'failed';
              deliveryStatus.sentAt = new Date();
              if (result.success) {
                if (result.messageId) deliveryStatus.messageId = result.messageId;
                channel.stats.sentCount++;
              } else {
                channel.stats.failedCount++;
              }
            } else if (channelType === 'inapp') {
              deliveryStatus.status = 'delivered';
              deliveryStatus.sentAt = new Date();
              deliveryStatus.deliveredAt = new Date();
              channel.stats.sentCount++;
            }

            await recipient.save();
          } catch (error) {
            logger.error(
              { err: error, recipientName: recipient.name, channelType },
              'Error sending to recipient'
            );
            deliveryStatus.status = 'failed';
            deliveryStatus.error = error.message;
            channel.stats.failedCount++;
            if (channelType === 'email') {
              channel.stats.bounceCount = (channel.stats.bounceCount || 0) + 1;
              deliveryStatus.bounceReason = error.message;
              deliveryStatus.bouncedAt = new Date();
            }
            await recipient.save();
          }
        }
      }

      channel.status = 'sent';
      channel.sentAt = new Date();
    }

    // Recompute analytics across ALL AnnouncementRecipient docs for this
    // announcement (not just the in-memory `recipients` batch). This matters
    // for resends, which are invoked per-recipient — writing from the batch
    // would clobber the cumulative totals with the last single-recipient pass.
    const totals = await recomputeAnalytics(announcement._id);
    announcement.analytics.totalRecipients = totals.totalRecipients;
    announcement.analytics.sentCount = totals.sentCount;
    announcement.analytics.deliveredCount = totals.deliveredCount;
    announcement.analytics.failedCount = totals.failedCount;
    announcement.analytics.openCount = totals.openCount;
    announcement.analytics.clickCount = totals.clickCount;
    announcement.analytics.bounceCount = totals.bounceCount;

    // Update status
    if (announcement.analytics.failedCount === 0) {
      announcement.status = 'sent';
    } else if (announcement.analytics.sentCount > 0) {
      announcement.status = 'partial';
    } else {
      announcement.status = 'failed';
    }

    announcement.sentAt = new Date();
    announcement.completedAt = new Date();

    // Calculate read rate
    await announcement.updateReadRate();

    logger.info(
      {
        title: announcement.title,
        sent: announcement.analytics.sentCount,
        failed: announcement.analytics.failedCount,
      },
      'Announcement sent'
    );

    // Send push notifications based on recipient types — failures logged but do not affect delivery status
    let pushFailed = false;
    try {
      const { default: pushService } = await import('./pushNotificationService.js');
      const recipientTypes = announcement.recipients.map((r) => r.type);
      const pushTitle = announcement.title;
      const pushBody = announcement.content.substring(0, 150);
      const pushData = { type: 'announcement', announcementId: announcement._id.toString() };
      const schoolId = announcement.schoolId;

      if (recipientTypes.includes('all') || recipientTypes.includes('parents')) {
        await pushService.sendToAllParents(schoolId, pushTitle, pushBody, pushData).catch((err) => {
          logger.warn({ err }, 'Push sendToAllParents failed');
          pushFailed = true;
        });
      }
      if (recipientTypes.includes('all') || recipientTypes.includes('staff')) {
        await pushService.sendToAllStaff(schoolId, pushTitle, pushBody, pushData).catch((err) => {
          logger.warn({ err }, 'Push sendToAllStaff failed');
          pushFailed = true;
        });
      }
    } catch (pushErr) {
      logger.warn({ err: pushErr }, 'Push notification dispatch failed');
      pushFailed = true;
    }

    return {
      status: announcement.status,
      sent: announcement.analytics.sentCount,
      failed: announcement.analytics.failedCount,
      total: announcement.analytics.totalRecipients,
      pushFailed,
    };
  } catch (error) {
    logger.error({ err: error, announcementId }, 'Error sending announcement');
    if (announcement) {
      announcement.status = 'failed';
      await announcement.save();
    }
    return {
      status: 'failed',
      sent: announcement?.analytics?.sentCount || 0,
      failed: announcement?.analytics?.totalRecipients || 0,
      total: announcement?.analytics?.totalRecipients || 0,
      pushFailed: false,
    };
  }
}

export default { sendScheduledAnnouncement, resolveRecipients };
