import Announcement from '../models/Announcement.js';
import AnnouncementRecipient from '../models/AnnouncementRecipient.js';
import { Staff, Student, Class } from '../database.js';
import { sendAnnouncementEmail } from './emailService.js';
import { sendAnnouncementSMS } from './smsService.js';
import { sendAnnouncementWhatsApp } from './whatsappService.js';

// Helper function to resolve recipients
async function resolveRecipients(recipients) {
  const recipientList = [];

  for (const recipient of recipients) {
    if (recipient.type === 'all') {
      const staff = await Staff.find({ isActive: true });
      staff.forEach(s => recipientList.push({
        userId: s._id,
        userType: 'Staff',
        name: s.name,
        email: s.email,
        phone: s.phone
      }));

      const students = await Student.find({ isActive: true });
      students.forEach(s => recipientList.push({
        userId: s._id,
        userType: 'Student',
        name: s.name,
        email: s.email,
        phone: s.phone
      }));
    } else if (recipient.type === 'staff') {
      const staff = await Staff.find({ isActive: true });
      staff.forEach(s => recipientList.push({
        userId: s._id,
        userType: 'Staff',
        name: s.name,
        email: s.email,
        phone: s.phone
      }));
    } else if (recipient.type === 'students') {
      if (recipient.classIds && recipient.classIds.length > 0) {
        const classes = await Class.find({ _id: { $in: recipient.classIds } }).populate('students');
        for (const cls of classes) {
          cls.students.forEach(student => {
            recipientList.push({
              userId: student._id,
              userType: 'Student',
              name: student.name,
              email: student.email,
              phone: student.phone
            });
          });
        }
      } else {
        const students = await Student.find({ isActive: true });
        students.forEach(s => recipientList.push({
          userId: s._id,
          userType: 'Student',
          name: s.name,
          email: s.email,
          phone: s.phone
        }));
      }
    } else if (recipient.type === 'parents') {
      const students = await Student.find({ isActive: true }).populate('parent');
      students.forEach(s => {
        if (s.parent && s.parent.email) {
          recipientList.push({
            userId: s._id,
            userType: 'Parent',
            name: s.parent.name || s.name + "'s Parent",
            email: s.parent.email,
            phone: s.parent.phone
          });
        }
      });
    } else if (recipient.type === 'custom' && recipient.userIds) {
      for (const userId of recipient.userIds) {
        const staff = await Staff.findById(userId);
        if (staff) {
          recipientList.push({
            userId: staff._id,
            userType: 'Staff',
            name: staff.name,
            email: staff.email,
            phone: staff.phone
          });
        } else {
          const student = await Student.findById(userId);
          if (student) {
            recipientList.push({
              userId: student._id,
              userType: 'Student',
              name: student.name,
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

// Main function to send scheduled announcement
export async function sendScheduledAnnouncement(announcementId, specificRecipients = null) {
  try {
    const announcement = await Announcement.findById(announcementId);

    if (!announcement) {
      console.error('Announcement not found:', announcementId);
      return;
    }

    console.log(`📤 Sending announcement: ${announcement.title}`);

    // Update status
    announcement.status = 'sending';
    await announcement.save();

    // Get recipients
    let recipients;
    if (specificRecipients) {
      // Get specific recipients for resend
      recipients = await AnnouncementRecipient.find({
        announcementId: announcement._id,
        userId: { $in: specificRecipients }
      });
    } else {
      // Resolve all recipients
      const resolvedRecipients = await resolveRecipients(announcement.recipients);

      // Create recipient records
      recipients = await AnnouncementRecipient.create(
        resolvedRecipients.map(r => ({
          announcementId: announcement._id,
          userId: r.userId,
          userType: r.userType,
          deliveryStatus: announcement.channels.map(ch => ({
            channel: ch.type,
            status: 'pending'
          }))
        }))
      );
    }

    // Update total recipients
    announcement.analytics.totalRecipients = recipients.length;

    // Send via each channel
    for (const channel of announcement.channels) {
      const channelType = channel.type;
      console.log(`  Sending via ${channelType}...`);

      channel.status = 'sending';
      channel.stats.totalRecipients = recipients.length;

      for (const recipient of recipients) {
        const deliveryStatus = recipient.deliveryStatus.find(ds => ds.channel === channelType);

        if (!deliveryStatus || deliveryStatus.status === 'failed') {
          try {
            if (channelType === 'email') {
              const result = await sendAnnouncementEmail(announcement, recipient);
              deliveryStatus.status = result.success ? 'sent' : 'failed';
              deliveryStatus.sentAt = new Date();
              if (result.success) channel.stats.sentCount++;
              else channel.stats.failedCount++;
            } else if (channelType === 'sms') {
              const result = await sendAnnouncementSMS(recipient.phone, announcement.title, announcement.content);
              deliveryStatus.status = result.success ? 'sent' : 'failed';
              deliveryStatus.sentAt = new Date();
              if (result.success) channel.stats.sentCount++;
              else channel.stats.failedCount++;
            } else if (channelType === 'whatsapp') {
              const result = await sendAnnouncementWhatsApp(recipient.phone, 'announcement', {
                title: announcement.title,
                content: announcement.content
              });
              deliveryStatus.status = result.success ? 'sent' : 'failed';
              deliveryStatus.sentAt = new Date();
              if (result.success) channel.stats.sentCount++;
              else channel.stats.failedCount++;
            } else if (channelType === 'inapp') {
              deliveryStatus.status = 'delivered';
              deliveryStatus.sentAt = new Date();
              deliveryStatus.deliveredAt = new Date();
              channel.stats.sentCount++;
            }

            await recipient.save();
          } catch (error) {
            console.error(`  Error sending to ${recipient.name}:`, error.message);
            deliveryStatus.status = 'failed';
            deliveryStatus.error = error.message;
            channel.stats.failedCount++;
            await recipient.save();
          }
        }
      }

      channel.status = 'sent';
      channel.sentAt = new Date();
    }

    // Update overall analytics
    announcement.analytics.sentCount = recipients.length;
    announcement.analytics.deliveredCount = recipients.filter(r =>
      r.deliveryStatus.some(ds => ds.status === 'delivered' || ds.status === 'sent')
    ).length;
    announcement.analytics.failedCount = recipients.filter(r =>
      r.deliveryStatus.some(ds => ds.status === 'failed')
    ).length;

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

    console.log(`✅ Announcement sent: ${announcement.title}`);
    console.log(`   Sent: ${announcement.analytics.sentCount}, Failed: ${announcement.analytics.failedCount}`);
  } catch (error) {
    console.error('Error sending announcement:', error);
    if (announcement) {
      announcement.status = 'failed';
      await announcement.save();
    }
  }
}

export default { sendScheduledAnnouncement, resolveRecipients };
