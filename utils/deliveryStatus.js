/**
 * Shared delivery status processing for SMS and WhatsApp webhooks (MSG91).
 *
 * Both /tracking/sms-webhook and /whatsapp/webhook receive delivery callbacks
 * from MSG91. This utility handles the common DB lookup and update logic:
 *   1. Find AnnouncementRecipient by messageId → update + bump announcement analytics
 *   2. Fall back to ReminderLog by messageId → update channel status
 */

import AnnouncementRecipient from '../models/AnnouncementRecipient.js';
import Announcement from '../models/Announcement.js';
import ReminderLog from '../models/ReminderLog.js';

// MSG91 statuses that map to our 'failed' state
const FAILED_STATUSES = new Set(['failed', 'undelivered', 'rejected', 'ndnc', 'blocked']);

/**
 * Normalise an MSG91 status string to our internal status.
 * Returns 'delivered', 'failed', or null (unknown → ignore).
 */
function normaliseStatus(status) {
  const s = (status || '').toLowerCase();
  if (s === 'delivered') return 'delivered';
  if (FAILED_STATUSES.has(s)) return 'failed';
  return null;
}

/**
 * Process a single MSG91 delivery status event.
 *
 * @param {string} messageId  - MSG91 requestId / messageId stored at send-time
 * @param {string} rawStatus  - Status string from MSG91 payload
 * @param {string} [reason]   - Failure reason (present on failed events)
 * @returns {Promise<{ processed: boolean, source?: string, skipped?: string, error?: string }>}
 */
export async function processDeliveryEvent(messageId, rawStatus, reason) {
  if (!messageId) return { processed: false, skipped: 'missing messageId' };

  const internalStatus = normaliseStatus(rawStatus);
  if (!internalStatus) return { processed: false, skipped: `unhandled status: ${rawStatus}` };

  // ── 1. AnnouncementRecipient lookup ────────────────────────────────────────
  const recipient = await AnnouncementRecipient.findOne({
    'deliveryStatus.messageId': messageId,
  });

  if (recipient) {
    const ds = recipient.deliveryStatus.find((d) => d.messageId === messageId);
    if (!ds) return { processed: false, skipped: 'deliveryStatus entry not found' };

    if (internalStatus === 'delivered') {
      ds.status = 'delivered';
      ds.deliveredAt = new Date();
    } else {
      ds.status = 'failed';
      if (reason) ds.error = reason;
    }
    await recipient.save();

    // Bump announcement-level analytics counter
    const analyticsField =
      internalStatus === 'delivered' ? 'analytics.deliveredCount' : 'analytics.failedCount';
    await Announcement.findByIdAndUpdate(recipient.announcementId, {
      $inc: { [analyticsField]: 1 },
    });

    return { processed: true, source: 'announcement' };
  }

  // ── 2. ReminderLog fallback ─────────────────────────────────────────────────
  const log = await ReminderLog.findOne({ 'channels.messageId': messageId });

  if (log) {
    const ch = log.channels.find((c) => c.messageId === messageId);
    if (!ch) return { processed: false, skipped: 'channel entry not found in reminder log' };

    ch.status = internalStatus;
    if (internalStatus === 'failed' && reason) ch.error = reason;
    await log.save();

    return { processed: true, source: 'reminder' };
  }

  return { processed: false, skipped: 'messageId not found in any record' };
}
