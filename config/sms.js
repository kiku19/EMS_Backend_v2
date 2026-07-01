import fetch from 'node-fetch';

// MSG91 SMS Configuration
const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
const MSG91_SENDER_ID = process.env.MSG91_SENDER_ID;
const MSG91_COUNTRY = process.env.MSG91_COUNTRY || '91';

/**
 * Send SMS via MSG91
 * @param {string|string[]} to - Phone number(s) with country code (e.g., 919876543210)
 * @param {string} message - SMS message content
 * @returns {Promise<Object>} Result object with success status
 */
export const sendSMS = async (to, message) => {
  try {
    if (!MSG91_AUTH_KEY) {
      throw new Error('MSG91 credentials not configured');
    }

    const recipients = Array.isArray(to) ? to : [to];

    // MSG91 Send SMS API
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

    const response = await fetch('https://control.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: {
        authkey: MSG91_AUTH_KEY,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        to: recipients.map((mobile) => ({ mobiles: String(mobile) })),
        sender: MSG91_SENDER_ID,
        template: message,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = await response.json();

    if (data.type === 'success') {
      return { success: true, messageId: data.requestId };
    } else {
      throw new Error(data.message || 'SMS sending failed');
    }
  } catch (error) {
    console.error('❌ SMS sending failed:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Send SMS using MSG91 Flow API (recommended for DLT compliance)
 * @param {string|string[]} to - Phone number(s)
 * @param {string} flowId - MSG91 Flow Template ID
 * @param {Object} variables - Template variables
 * @returns {Promise<Object>} Result object
 */
export const sendSMSWithFlow = async (to, flowId, variables = {}) => {
  try {
    if (!MSG91_AUTH_KEY) {
      throw new Error('MSG91 credentials not configured');
    }

    const recipients = Array.isArray(to) ? to : [to];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

    const response = await fetch(`https://control.msg91.com/api/v5/flow/${flowId}/`, {
      method: 'POST',
      headers: {
        authkey: MSG91_AUTH_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: recipients.map((mobile) => ({ mobiles: String(mobile), ...variables })),
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = await response.json();

    if (data.type === 'success') {
      return { success: true, messageId: data.requestId };
    } else {
      throw new Error(data.message || 'SMS sending failed');
    }
  } catch (error) {
    console.error('❌ SMS via Flow failed:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Send bulk SMS
 * @param {Array} smsList - Array of {to, message} objects
 * @returns {Promise<Array>} Results array
 */
export const sendBulkSMS = async (smsList) => {
  const results = [];

  for (const sms of smsList) {
    const result = await sendSMS(sms.to, sms.message);
    results.push({ ...sms, ...result });
  }

  return results;
};

export function isSmsConfigured() {
  return Boolean(MSG91_AUTH_KEY && MSG91_SENDER_ID);
}

export default { sendSMS, sendSMSWithFlow, sendBulkSMS, isSmsConfigured };
