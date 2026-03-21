import { randomBytes } from 'crypto';
import Announcement from '../models/Announcement.js';
import AnnouncementRecipient from '../models/AnnouncementRecipient.js';
import { Staff, Student, Class } from '../database.js';
import { sendAnnouncementEmail } from './emailService.js';
import { sendAnnouncementSMS } from './smsService.js';
import { sendAnnouncementWhatsApp } from './whatsappService.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('AnnouncementSender');

// Helper function to resolve recipients
async function resolveRecipients(recipients, schoolId) {
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
        const classes = await Class.find({
          _id: { $in: recipient.classIds },
          ...schoolFilter,
        }).populate('students');
        for (const cls of classes) {
          cls.students.forEach((student) => {
            recipientList.push({
              userId: student._id,
              userType: 'Student',
              name: student.name,
              email: student.email,
              phone: student.phone,
            });
          });
        }
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

      // Create recipient records
      recipients = await AnnouncementRecipient.create(
        resolvedRecipients.map((r) => ({
          announcementId: announcement._id,
          userId: r.userId,
          userType: r.userType,
          deliveryStatus: announcement.channels.map((ch) => ({
            channel: ch.type,
            status: 'pending',
          })),
        }))
      );
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
              deliveryStatus.status = result.success ? 'sent' : 'failed';
              deliveryStatus.sentAt = new Date();
              if (result.success) {
                if (result.messageId) deliveryStatus.messageId = result.messageId;
                channel.stats.sentCount++;
              } else {
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

    // Update overall analytics
    announcement.analytics.sentCount = recipients.length;
    announcement.analytics.deliveredCount = recipients.filter((r) =>
      r.deliveryStatus.some((ds) => ds.status === 'delivered' || ds.status === 'sent')
    ).length;
    announcement.analytics.failedCount = recipients.filter((r) =>
      r.deliveryStatus.some((ds) => ds.status === 'failed')
    ).length;

    // Aggregate open/click/bounce counts across all recipients and channels
    let totalOpenCount = 0;
    let totalClickCount = 0;
    let totalBounceCount = 0;
    for (const r of recipients) {
      for (const ds of r.deliveryStatus) {
        totalOpenCount += ds.openCount || 0;
        totalClickCount += ds.clickCount || 0;
        if (ds.bouncedAt) totalBounceCount++;
      }
    }
    announcement.analytics.openCount = totalOpenCount;
    announcement.analytics.clickCount = totalClickCount;
    announcement.analytics.bounceCount = totalBounceCount;

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

    // Send push notifications based on recipient types
    try {
      const { default: pushService } = await import('./pushNotificationService.js');
      const recipientTypes = announcement.recipients.map((r) => r.type);
      const pushTitle = announcement.title;
      const pushBody = announcement.content.substring(0, 150);
      const pushData = { type: 'announcement', announcementId: announcement._id.toString() };
      const schoolId = announcement.schoolId;

      if (recipientTypes.includes('all') || recipientTypes.includes('parents')) {
        pushService
          .sendToAllParents(schoolId, pushTitle, pushBody, pushData)
          .catch((err) => logger.warn({ err }, 'Push sendToAllParents failed'));
      }
      if (recipientTypes.includes('all') || recipientTypes.includes('staff')) {
        pushService
          .sendToAllStaff(schoolId, pushTitle, pushBody, pushData)
          .catch((err) => logger.warn({ err }, 'Push sendToAllStaff failed'));
      }
    } catch (pushErr) {
      logger.warn({ err: pushErr }, 'Push notification dispatch failed');
    }
  } catch (error) {
    logger.error({ err: error, announcementId }, 'Error sending announcement');
    if (announcement) {
      announcement.status = 'failed';
      await announcement.save();
    }
  }
}

export default { sendScheduledAnnouncement, resolveRecipients };
