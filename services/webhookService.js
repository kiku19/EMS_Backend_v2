import crypto from 'crypto';
import Webhook from '../models/Webhook.js';
import WebhookDeliveryLog from '../models/WebhookDeliveryLog.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('WebhookService');

const MAX_RETRIES = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 60; // max 60 webhook dispatches per school per minute

// In-memory rate limit counters (per schoolId)
const rateLimitCounters = new Map();

function getRateLimitKey(schoolId) {
  return String(schoolId);
}

function isRateLimited(schoolId) {
  const key = getRateLimitKey(schoolId);
  const now = Date.now();
  const entry = rateLimitCounters.get(key);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitCounters.set(key, { count: 1, windowStart: now });
    return false;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return true;
  }

  entry.count += 1;
  return false;
}

function computeHmacSignature(secret, payload) {
  return crypto
    .createHmac('sha256', secret)
    .update(typeof payload === 'string' ? payload : JSON.stringify(payload))
    .digest('hex');
}

function getRetryDelayMs(attempt) {
  // Exponential backoff: 5s, 25s, 125s, 625s, 3125s
  return Math.pow(5, attempt) * 1000;
}

async function deliverWebhook(webhook, event, payload, attempt = 1) {
  const body = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    schoolId: String(webhook.schoolId),
    data: payload,
  });

  const signature = computeHmacSignature(webhook.secret, body);

  const headers = {
    'Content-Type': 'application/json',
    'X-EMS-Event': event,
    'X-EMS-Signature': `sha256=${signature}`,
    'X-EMS-Timestamp': new Date().toISOString(),
    'User-Agent': 'EMS-Webhook/1.0',
  };

  const log = await WebhookDeliveryLog.create({
    webhookId: webhook._id,
    schoolId: webhook.schoolId,
    event,
    requestUrl: webhook.url,
    requestHeaders: headers,
    requestPayload: JSON.parse(body),
    status: 'pending',
    attemptNumber: attempt,
  });

  const startTime = Date.now();
  let responseStatus;
  let responseBody;
  let responseHeaders;
  let error;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    responseStatus = response.status;
    responseHeaders = Object.fromEntries(response.headers.entries());
    responseBody = await response.text().catch(() => '');

    const latencyMs = Date.now() - startTime;
    const success = response.status >= 200 && response.status < 300;

    await WebhookDeliveryLog.findByIdAndUpdate(log._id, {
      responseStatus,
      responseBody: responseBody.slice(0, 2000),
      responseHeaders,
      status: success ? 'success' : 'failed',
      latencyMs,
      errorMessage: success ? null : `HTTP ${responseStatus}`,
    });

    if (success) {
      await Webhook.findByIdAndUpdate(webhook._id, {
        lastTriggeredAt: new Date(),
        $set: { failureCount: 0 },
      });
    } else {
      await handleRetryOrDeadLetter(webhook, event, payload, attempt, `HTTP ${responseStatus}`);
    }

    return success;
  } catch (err) {
    error = err.name === 'AbortError' ? 'Timeout after 10s' : err.message;
    const latencyMs = Date.now() - startTime;

    await WebhookDeliveryLog.findByIdAndUpdate(log._id, {
      status: 'failed',
      latencyMs,
      errorMessage: error,
    });

    await handleRetryOrDeadLetter(webhook, event, payload, attempt, error);
    return false;
  }
}

async function handleRetryOrDeadLetter(webhook, event, payload, attempt, errorMsg) {
  await Webhook.findByIdAndUpdate(webhook._id, { $inc: { failureCount: 1 } });

  if (attempt < MAX_RETRIES) {
    const delayMs = getRetryDelayMs(attempt);
    setTimeout(() => {
      deliverWebhook(webhook, event, payload, attempt + 1).catch((err) =>
        logger.warn(
          { err, webhookId: webhook._id, attempt: attempt + 1 },
          'Webhook retry delivery failed'
        )
      );
    }, delayMs);
  } else {
    // Move to dead letter queue
    await Webhook.findByIdAndUpdate(webhook._id, {
      $push: {
        deadLetterQueue: {
          event,
          payload,
          failedAt: new Date(),
          lastError: errorMsg,
          attemptCount: attempt,
        },
      },
    });
  }
}

/**
 * Dispatch a webhook event to all active subscribers for the given school.
 * @param {string|ObjectId} schoolId
 * @param {string} event - e.g. 'student.created'
 * @param {object} payload - event data
 */
export async function dispatchWebhookEvent(schoolId, event, payload) {
  try {
    if (isRateLimited(schoolId)) {
      logger.warn({ schoolId, event }, 'Rate limit hit, dropping webhook event');
      return;
    }

    const webhooks = await Webhook.find({
      schoolId,
      isActive: true,
      events: event,
    }).lean();

    for (const webhook of webhooks) {
      deliverWebhook(webhook, event, payload).catch((err) =>
        logger.warn({ err, webhookId: webhook._id, event }, 'Webhook delivery failed')
      );
    }
  } catch (err) {
    logger.error({ err, schoolId, event }, 'Error dispatching webhook event');
  }
}

/**
 * Send a test payload to a specific webhook.
 */
export async function sendTestWebhook(webhook) {
  const testPayload = {
    test: true,
    message: 'This is a test webhook delivery from EMS',
  };

  return deliverWebhook(webhook, 'test', testPayload, 1);
}
