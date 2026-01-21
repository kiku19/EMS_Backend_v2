import fetch from 'node-fetch';

// MSG91 WhatsApp Configuration
const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
const MSG91_WHATSAPP_ENABLED = process.env.MSG91_WHATSAPP_ENABLED === 'true';

/**
 * Send WhatsApp message via MSG91
 * @param {string|string[]} to - Phone number(s) with country code
 * @param {string} templateName - WhatsApp template name (must be pre-approved)
 * @param {Object} templateParams - Template parameters
 * @returns {Promise<Object>} Result object
 */
export const sendWhatsAppMessage = async (to, templateName, templateParams = {}) => {
  try {
    if (!MSG91_WHATSAPP_ENABLED) {
      console.log('⚠️  WhatsApp is disabled');
      return { success: false, error: 'WhatsApp not enabled' };
    }

    if (!MSG91_AUTH_KEY) {
      throw new Error('MSG91 credentials not configured');
    }

    const recipients = Array.isArray(to) ? to : [to];

    const response = await fetch('https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/', {
      method: 'POST',
      headers: {
        'authkey': MSG91_AUTH_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        mobiles: recipients,
        template_name: templateName,
        template_params: templateParams,
        sender: process.env.MSG91_WHATSAPP_SENDER_PHONE
      })
    });

    const data = await response.json();

    if (data.status === 'success') {
      console.log('✅ WhatsApp message sent');
      return { success: true, messageId: data.messageId };
    } else {
      throw new Error(data.message || 'WhatsApp message failed');
    }
  } catch (error) {
    console.error('❌ WhatsApp sending failed:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Send WhatsApp message with media
 * @param {string} to - Phone number with country code
 * @param {string} templateName - Template name
 * @param {Object} templateParams - Template parameters
 * @param {Object} media - Media object {url, type, caption}
 * @returns {Promise<Object>} Result object
 */
export const sendWhatsAppMedia = async (to, templateName, templateParams, media) => {
  try {
    if (!MSG91_WHATSAPP_ENABLED) {
      return { success: false, error: 'WhatsApp not enabled' };
    }

    if (!MSG91_AUTH_KEY) {
      throw new Error('MSG91 credentials not configured');
    }

    const response = await fetch('https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/', {
      method: 'POST',
      headers: {
        'authkey': MSG91_AUTH_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        mobiles: [to],
        template_name: templateName,
        template_params: templateParams,
        media: {
          url: media.url,
          type: media.type, // image, video, document
          caption: media.caption || ''
        }
      })
    });

    const data = await response.json();

    if (data.status === 'success') {
      console.log('✅ WhatsApp media sent');
      return { success: true, messageId: data.messageId };
    } else {
      throw new Error(data.message || 'WhatsApp media failed');
    }
  } catch (error) {
    console.error('❌ WhatsApp media failed:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Send bulk WhatsApp messages
 * @param {Array} messageList - Array of {to, templateName, templateParams} objects
 * @returns {Promise<Array>} Results array
 */
export const sendBulkWhatsApp = async (messageList) => {
  const results = [];

  for (const msg of messageList) {
    const result = await sendWhatsAppMessage(msg.to, msg.templateName, msg.templateParams);
    results.push({ ...msg, ...result });
  }

  return results;
};

export default { sendWhatsAppMessage, sendWhatsAppMedia, sendBulkWhatsApp };
