/**
 * Localized message templates for SMS and push notifications.
 * Supported locales: en, hi, ta, te, kn, ur
 */

// ---------------------------------------------------------------------------
// SMS Templates
// ---------------------------------------------------------------------------

const SMS_TEMPLATES = {
  en: {
    fee_reminder: ({ amount, dueDate }) =>
      `FEE REMINDER: Fee payment of \u20b9${amount} is due by ${dueDate}. Please pay on time to avoid late fees.`,
    attendance_absent: ({ date }) =>
      `ATTENDANCE ALERT: Your child was ABSENT on ${date}. Please contact school if you have questions.`,
    attendance_present: ({ date }) => `ATTENDANCE UPDATE: Your child was PRESENT on ${date}.`,
    otp: ({ otp }) =>
      `Your verification code is: ${otp}. Valid for 5 minutes. Do not share this with anyone.`,
    emergency: ({ message }) => `\ud83d\udea8 EMERGENCY ALERT: ${message}`,
  },

  hi: {
    fee_reminder: ({ amount, dueDate }) =>
      `\u0936\u0941\u0932\u094d\u0915 \u0905\u0928\u0941\u0938\u094d\u092e\u093e\u0930\u0915: \u20b9${amount} \u0915\u093e \u0936\u0941\u0932\u094d\u0915 \u092d\u0941\u0917\u0924\u093e\u0928 ${dueDate} \u0924\u0915 \u0926\u0947\u092f \u0939\u0948\u0964 \u0935\u093f\u0932\u0902\u092c \u0936\u0941\u0932\u094d\u0915 \u0938\u0947 \u092c\u091a\u0928\u0947 \u0915\u0947 \u0932\u093f\u090f \u0938\u092e\u092f \u092a\u0930 \u092d\u0941\u0917\u0924\u093e\u0928 \u0915\u0930\u0947\u0902\u0964`,
    attendance_absent: ({ date }) =>
      `\u0909\u092a\u0938\u094d\u0925\u093f\u0924\u093f \u091a\u0947\u0924\u093e\u0935\u0928\u0940: \u0906\u092a\u0915\u093e \u092c\u091a\u094d\u091a\u093e ${date} \u0915\u094b \u0905\u0928\u0941\u092a\u0938\u094d\u0925\u093f\u0924 \u0925\u093e\u0964 \u0915\u094b\u0908 \u092a\u094d\u0930\u0936\u094d\u0928 \u0939\u094b \u0924\u094b \u0938\u094d\u0915\u0942\u0932 \u0938\u0947 \u0938\u0902\u092a\u0930\u094d\u0915 \u0915\u0930\u0947\u0902\u0964`,
    attendance_present: ({ date }) =>
      `\u0909\u092a\u0938\u094d\u0925\u093f\u0924\u093f \u0938\u0942\u091a\u0928\u093e: \u0906\u092a\u0915\u093e \u092c\u091a\u094d\u091a\u093e ${date} \u0915\u094b \u0909\u092a\u0938\u094d\u0925\u093f\u0924 \u0925\u093e\u0964`,
    otp: ({ otp }) =>
      `\u0906\u092a\u0915\u093e \u0938\u0924\u094d\u092f\u093e\u092a\u0928 \u0915\u094b\u0921: ${otp}\u0964 5 \u092e\u093f\u0928\u091f \u0915\u0947 \u0932\u093f\u090f \u0935\u0948\u0927\u0964 \u0915\u093f\u0938\u0940 \u0915\u0947 \u0938\u093e\u0925 \u0938\u093e\u091d\u093e \u0928 \u0915\u0930\u0947\u0902\u0964`,
    emergency: ({ message }) =>
      `\ud83d\udea8 \u0906\u092a\u093e\u0924\u0915\u093e\u0932\u0940\u0928 \u0938\u0942\u091a\u0928\u093e: ${message}`,
  },

  ta: {
    fee_reminder: ({ amount, dueDate }) =>
      `\u0b95\u0b9f\u0bcd\u0b9f\u0ba3 \u0ba8\u0bbf\u0ba9\u0bc8\u0bb5\u0bc2\u0b9f\u0bcd\u0b9f\u0bb2\u0bcd: \u20b9${amount} \u0b95\u0b9f\u0bcd\u0b9f\u0ba3\u0bae\u0bcd ${dueDate} \u0bb5\u0bb0\u0bc8 \u0b9a\u0bc6\u0bb2\u0bc1\u0ba4\u0bcd\u0ba4 \u0bb5\u0bc7\u0ba3\u0bcd\u0b9f\u0bc1\u0bae\u0bcd. \u0ba4\u0bbe\u0bae\u0ba4 \u0b85\u0baa\u0bb0\u0bbe\u0ba4\u0bae\u0bcd \u0ba4\u0bb5\u0bbf\u0bb0\u0bcd\u0b95\u0bcd\u0b95 \u0b9a\u0bb0\u0bbf\u0baf\u0bbe\u0ba9 \u0ba8\u0bc7\u0bb0\u0ba4\u0bcd\u0ba4\u0bbf\u0bb2\u0bcd \u0b9a\u0bc6\u0bb2\u0bc1\u0ba4\u0bcd\u0ba4\u0bb5\u0bc1\u0bae\u0bcd.`,
    attendance_absent: ({ date }) =>
      `\u0bb5\u0bb0\u0bc1\u0b95\u0bc8 \u0b8e\u0b9a\u0bcd\u0b9a\u0bb0\u0bbf\u0b95\u0bcd\u0b95\u0bc8: \u0b89\u0b99\u0bcd\u0b95\u0bb3\u0bcd \u0baa\u0bbf\u0bb3\u0bcd\u0bb3\u0bc8 ${date} \u0b85\u0ba9\u0bcd\u0bb1\u0bc1 \u0bb5\u0bb0\u0bb5\u0bbf\u0bb2\u0bcd\u0bb2\u0bc8. \u0b95\u0bc7\u0bb3\u0bcd\u0bb5\u0bbf\u0b95\u0bb3\u0bc1\u0b95\u0bcd\u0b95\u0bc1 \u0baa\u0bb3\u0bcd\u0bb3\u0bbf\u0baf\u0bc8 \u0ba4\u0bca\u0b9f\u0bb0\u0bcd\u0baa\u0bc1 \u0b95\u0bca\u0bb3\u0bcd\u0bb3\u0bb5\u0bc1\u0bae\u0bcd.`,
    attendance_present: ({ date }) =>
      `\u0bb5\u0bb0\u0bc1\u0b95\u0bc8 \u0b85\u0bb1\u0bbf\u0bb5\u0bbf\u0baa\u0bcd\u0baa\u0bc1: \u0b89\u0b99\u0bcd\u0b95\u0bb3\u0bcd \u0baa\u0bbf\u0bb3\u0bcd\u0bb3\u0bc8 ${date} \u0b85\u0ba9\u0bcd\u0bb1\u0bc1 \u0bb5\u0ba8\u0bcd\u0ba4\u0bbf\u0bb0\u0bc1\u0ba8\u0bcd\u0ba4\u0bbe\u0bb0\u0bcd.`,
    otp: ({ otp }) =>
      `\u0b89\u0b99\u0bcd\u0b95\u0bb3\u0bcd \u0b9a\u0bb0\u0bbf\u0baa\u0bbe\u0bb0\u0bcd\u0baa\u0bcd\u0baa\u0bc1 \u0b95\u0bc1\u0bb1\u0bbf\u0baf\u0bc0\u0b9f\u0bc1: ${otp}. 5 \u0ba8\u0bbf\u0bae\u0bbf\u0b9f\u0b99\u0bcd\u0b95\u0bb3\u0bcd \u0b9a\u0bc6\u0bb2\u0bcd\u0bb2\u0bc1\u0baa\u0b9f\u0bbf\u0baf\u0bbe\u0b95\u0bc1\u0bae\u0bcd. \u0baf\u0bbe\u0bb0\u0bc1\u0b9f\u0ba9\u0bc1\u0bae\u0bcd \u0baa\u0b95\u0bbf\u0bb0 \u0bb5\u0bc7\u0ba3\u0bcd\u0b9f\u0bbe\u0bae\u0bcd.`,
    emergency: ({ message }) =>
      `\ud83d\udea8 \u0b85\u0bb5\u0b9a\u0bb0 \u0b8e\u0b9a\u0bcd\u0b9a\u0bb0\u0bbf\u0b95\u0bcd\u0b95\u0bc8: ${message}`,
  },

  te: {
    fee_reminder: ({ amount, dueDate }) =>
      `\u0c30\u0c41\u0c38\u0c41\u0c2e\u0c41 \u0c30\u0c3f\u0c2e\u0c48\u0c02\u0c21\u0c30\u0c4d: \u20b9${amount} \u0c1a\u0c46\u0c32\u0c4d\u0c32\u0c3f\u0c02\u0c2a\u0c41 ${dueDate} \u0c28\u0c3e\u0c1f\u0c3f\u0c15\u0c3f \u0c1a\u0c46\u0c32\u0c4d\u0c32\u0c3f\u0c02\u0c1a\u0c3e\u0c32\u0c3f. \u0c06\u0c32\u0c38\u0c4d\u0c2f \u0c30\u0c41\u0c38\u0c41\u0c2e\u0c41 \u0c28\u0c3f\u0c35\u0c3e\u0c30\u0c3f\u0c02\u0c1a\u0c21\u0c3e\u0c28\u0c3f\u0c15\u0c3f \u0c38\u0c2e\u0c2f\u0c3e\u0c28\u0c3f\u0c15\u0c3f \u0c1a\u0c46\u0c32\u0c4d\u0c32\u0c3f\u0c02\u0c1a\u0c02\u0c21\u0c3f.`,
    attendance_absent: ({ date }) =>
      `\u0c39\u0c3e\u0c1c\u0c30\u0c41 \u0c39\u0c46\u0c1a\u0c4d\u0c1a\u0c30\u0c3f\u0c15: \u0c2e\u0c40 \u0c2a\u0c3f\u0c32\u0c4d\u0c32\u0c35\u0c3e\u0c21\u0c41 ${date}\u0c28 \u0c17\u0c48\u0c30\u0c4d\u200c\u0c39\u0c3e\u0c1c\u0c30\u0c41 \u0c05\u0c2f\u0c4d\u0c2f\u0c3e\u0c21\u0c41. \u0c2a\u0c4d\u0c30\u0c36\u0c4d\u0c28\u0c32\u0c15\u0c41 \u0c2a\u0c3e\u0c20\u0c36\u0c3e\u0c32\u0c28\u0c41 \u0c38\u0c02\u0c2a\u0c4d\u0c30\u0c26\u0c3f\u0c02\u0c1a\u0c02\u0c21\u0c3f.`,
    attendance_present: ({ date }) =>
      `\u0c39\u0c3e\u0c1c\u0c30\u0c41 \u0c28\u0c4b\u0c1f\u0c40\u0c38\u0c41: \u0c2e\u0c40 \u0c2a\u0c3f\u0c32\u0c4d\u0c32\u0c35\u0c3e\u0c21\u0c41 ${date}\u0c28 \u0c39\u0c3e\u0c1c\u0c30\u0c41 \u0c05\u0c2f\u0c4d\u0c2f\u0c3e\u0c21\u0c41.`,
    otp: ({ otp }) =>
      `\u0c2e\u0c40 \u0c27\u0c43\u0c35\u0c40\u0c15\u0c30\u0c23 \u0c15\u0c4b\u0c21\u0c4d: ${otp}. 5 \u0c28\u0c3f\u0c2e\u0c3f\u0c37\u0c3e\u0c32 \u0c2a\u0c3e\u0c1f\u0c41 \u0c1a\u0c46\u0c32\u0c4d\u0c32\u0c41\u0c2c\u0c3e\u0c1f\u0c41 \u0c05\u0c35\u0c41\u0c24\u0c41\u0c02\u0c26\u0c3f. \u0c0e\u0c35\u0c30\u0c3f\u0c24\u0c4b\u0c28\u0c42 \u0c2a\u0c02\u0c1a\u0c41\u0c15\u0c4b\u0c35\u0c26\u0c4d\u0c26\u0c41.`,
    emergency: ({ message }) =>
      `\ud83d\udea8 \u0c05\u0c24\u0c4d\u0c2f\u0c35\u0c38\u0c30 \u0c39\u0c46\u0c1a\u0c4d\u0c1a\u0c30\u0c3f\u0c15: ${message}`,
  },

  kn: {
    fee_reminder: ({ amount, dueDate }) =>
      `\u0c9c\u0ccd\u0c9e\u0cbe\u0caa\u0ca8: \u20b9${amount} \u0cb6\u0cc1\u0cb2\u0ccd\u0c95 \u0caa\u0cbe\u0cb5\u0ca4\u0cbf ${dueDate} \u0cb0\u0c82\u0ca6\u0cc1 \u0cac\u0cbe\u0c95\u0cbf \u0c87\u0ca6\u0cc6. \u0cb5\u0cbf\u0cb3\u0c82\u0cac \u0cb6\u0cc1\u0cb2\u0ccd\u0c95 \u0ca4\u0caa\u0ccd\u0caa\u0cbf\u0cb8\u0cb2\u0cc1 \u0cb8\u0cae\u0caf\u0c95\u0ccd\u0c95\u0cc6 \u0caa\u0cbe\u0cb5\u0ca4\u0cbf\u0cb8\u0cbf.`,
    attendance_absent: ({ date }) =>
      `\u0cb9\u0cbe\u0c9c\u0cb0\u0cbe\u0ca4\u0cbf \u0c8e\u0c9a\u0ccd\u0c9a\u0cb0\u0cbf\u0c95\u0cc6: \u0ca8\u0cbf\u0cae\u0ccd\u0cae \u0cae\u0c97\u0cc1 ${date} \u0cb0\u0c82\u0ca6\u0cc1 \u0c97\u0cc8\u0cb0\u0cc1\u0cb9\u0cbe\u0c9c\u0cb0\u0cbe\u0c97\u0cbf\u0ca6\u0cc6. \u0caa\u0ccd\u0cb0\u0cb6\u0ccd\u0ca8\u0cc6\u0c97\u0cb3\u0cbf\u0c97\u0cc6 \u0cb6\u0cbe\u0cb2\u0cc6\u0caf\u0ca8\u0ccd\u0ca8\u0cc1 \u0cb8\u0c82\u0caa\u0cb0\u0ccd\u0c95\u0cbf\u0cb8\u0cbf.`,
    attendance_present: ({ date }) =>
      `\u0cb9\u0cbe\u0c9c\u0cb0\u0cbe\u0ca4\u0cbf \u0cb8\u0cc2\u0c9a\u0ca8\u0cc6: \u0ca8\u0cbf\u0cae\u0ccd\u0cae \u0cae\u0c97\u0cc1 ${date} \u0cb0\u0c82\u0ca6\u0cc1 \u0cb9\u0cbe\u0c9c\u0cb0\u0cbe\u0c97\u0cbf\u0ca6\u0cc6.`,
    otp: ({ otp }) =>
      `\u0ca8\u0cbf\u0cae\u0ccd\u0cae \u0caa\u0cb0\u0cbf\u0cb6\u0cc0\u0cb2\u0ca8\u0cc6 \u0c95\u0ccb\u0ca1\u0ccd: ${otp}. 5 \u0ca8\u0cbf\u0cae\u0cbf\u0cb7\u0c97\u0cb3 \u0c95\u0cbe\u0cb2 \u0cae\u0cbe\u0ca8\u0ccd\u0caf. \u0caf\u0cbe\u0cb0\u0cca\u0c82\u0ca6\u0cbf\u0c97\u0cc2 \u0cb9\u0c82\u0c9a\u0cbf\u0c95\u0cca\u0cb3\u0ccd\u0cb3\u0cac\u0cc7\u0ca1\u0cbf.`,
    emergency: ({ message }) =>
      `\ud83d\udea8 \u0ca4\u0cc1\u0cb0\u0ccd\u0ca4\u0cc1 \u0c8e\u0c9a\u0ccd\u0c9a\u0cb0\u0cbf\u0c95\u0cc6: ${message}`,
  },

  ur: {
    fee_reminder: ({ amount, dueDate }) =>
      `\u0641\u06cc\u0633 \u06cc\u0627\u062f \u062f\u06c1\u0627\u0646\u06cc: \u20b9${amount} \u06a9\u06cc \u0641\u06cc\u0633 ${dueDate} \u062a\u06a9 \u0648\u0627\u062c\u0628 \u0627\u0644\u0627\u062f\u0627 \u06c1\u06d2\u06d4 \u062a\u0627\u062e\u06cc\u0631\u06cc \u062c\u0631\u0645\u0627\u0646\u06d2 \u0633\u06d2 \u0628\u0686\u0646\u06d2 \u06a9\u06d2 \u0644\u06cc\u06d2 \u0648\u0642\u062a \u067e\u0631 \u0627\u062f\u0627\u0626\u06cc\u06af\u06cc \u06a9\u0631\u06cc\u06ba\u06d4`,
    attendance_absent: ({ date }) =>
      `\u062d\u0627\u0636\u0631\u06cc \u0627\u0646\u062a\u0628\u0627\u06c1: \u0622\u067e \u06a9\u0627 \u0628\u0686\u06c1 ${date} \u06a9\u0648 \u063a\u06cc\u0631 \u062d\u0627\u0636\u0631 \u062a\u06be\u0627\u06d4 \u0633\u0648\u0627\u0644\u0627\u062a \u06a9\u06d2 \u0644\u06cc\u06d2 \u0627\u0633\u06a9\u0648\u0644 \u0633\u06d2 \u0631\u0627\u0628\u0637\u06c1 \u06a9\u0631\u06cc\u06ba\u06d4`,
    attendance_present: ({ date }) =>
      `\u062d\u0627\u0636\u0631\u06cc \u0627\u0637\u0644\u0627\u0639: \u0622\u067e \u06a9\u0627 \u0628\u0686\u06c1 ${date} \u06a9\u0648 \u062d\u0627\u0636\u0631 \u062a\u06be\u0627\u06d4`,
    otp: ({ otp }) =>
      `\u0622\u067e \u06a9\u0627 \u062a\u0635\u062f\u06cc\u0642\u06cc \u06a9\u0648\u0688: ${otp}\u06d4 5 \u0645\u0646\u0679 \u06a9\u06d2 \u0644\u06cc\u06d2 \u062f\u0631\u0633\u062a \u06c1\u06d2\u06d4 \u06a9\u0633\u06cc \u06a9\u06d2 \u0633\u0627\u062a\u06be \u0634\u06cc\u0626\u0631 \u0646\u06c1 \u06a9\u0631\u06cc\u06ba\u06d4`,
    emergency: ({ message }) =>
      `\ud83d\udea8 \u06c1\u0646\u06af\u0627\u0645\u06cc \u0627\u0646\u062a\u0628\u0627\u06c1: ${message}`,
  },
};

// ---------------------------------------------------------------------------
// Push Notification Templates
// ---------------------------------------------------------------------------

const PUSH_TEMPLATES = {
  en: {
    fee_due: ({ amount, dueDate }) => ({
      title: 'Fee Reminder',
      body: `Fee payment of \u20b9${amount} is due by ${dueDate}.`,
    }),
    attendance_absent: ({ date, studentName }) => ({
      title: 'Attendance Alert',
      body: `${studentName || 'Your child'} was absent on ${date}.`,
    }),
    attendance_present: ({ date, studentName }) => ({
      title: 'Attendance Update',
      body: `${studentName || 'Your child'} was present on ${date}.`,
    }),
    exam_result_published: ({ examName }) => ({
      title: 'Results Published',
      body: `${examName} results are now available.`,
    }),
    announcement: ({ title, content }) => ({
      title: title || 'New Announcement',
      body: content ? content.substring(0, 100) : '',
    }),
    emergency: ({ message }) => ({
      title: '\ud83d\udea8 Emergency Alert',
      body: message,
    }),
  },

  hi: {
    fee_due: ({ amount, dueDate }) => ({
      title:
        '\u0936\u0941\u0932\u094d\u0915 \u0905\u0928\u0941\u0938\u094d\u092e\u093e\u0930\u0915',
      body: `\u20b9${amount} \u0915\u093e \u0936\u0941\u0932\u094d\u0915 \u092d\u0941\u0917\u0924\u093e\u0928 ${dueDate} \u0924\u0915 \u0926\u0947\u092f \u0939\u0948\u0964`,
    }),
    attendance_absent: ({ date, studentName }) => ({
      title:
        '\u0909\u092a\u0938\u094d\u0925\u093f\u0924\u093f \u091a\u0947\u0924\u093e\u0935\u0928\u0940',
      body: `${studentName || '\u0906\u092a\u0915\u093e \u092c\u091a\u094d\u091a\u093e'} ${date} \u0915\u094b \u0905\u0928\u0941\u092a\u0938\u094d\u0925\u093f\u0924 \u0925\u093e\u0964`,
    }),
    attendance_present: ({ date, studentName }) => ({
      title: '\u0909\u092a\u0938\u094d\u0925\u093f\u0924\u093f \u0905\u092a\u0921\u0947\u091f',
      body: `${studentName || '\u0906\u092a\u0915\u093e \u092c\u091a\u094d\u091a\u093e'} ${date} \u0915\u094b \u0909\u092a\u0938\u094d\u0925\u093f\u0924 \u0925\u093e\u0964`,
    }),
    exam_result_published: ({ examName }) => ({
      title:
        '\u092a\u0930\u093f\u0923\u093e\u092e \u092a\u094d\u0930\u0915\u093e\u0936\u093f\u0924',
      body: `${examName} \u0915\u0947 \u092a\u0930\u093f\u0923\u093e\u092e \u0905\u092c \u0909\u092a\u0932\u092c\u094d\u0927 \u0939\u0948\u0902\u0964`,
    }),
    announcement: ({ title, content }) => ({
      title: title || '\u0928\u0908 \u0918\u094b\u0937\u0923\u093e',
      body: content ? content.substring(0, 100) : '',
    }),
    emergency: ({ message }) => ({
      title:
        '\ud83d\udea8 \u0906\u092a\u093e\u0924\u0915\u093e\u0932\u0940\u0928 \u0938\u0942\u091a\u0928\u093e',
      body: message,
    }),
  },

  ta: {
    fee_due: ({ amount, dueDate }) => ({
      title:
        '\u0b95\u0b9f\u0bcd\u0b9f\u0ba3 \u0ba8\u0bbf\u0ba9\u0bc8\u0bb5\u0bc2\u0b9f\u0bcd\u0b9f\u0bb2\u0bcd',
      body: `\u20b9${amount} \u0b95\u0b9f\u0bcd\u0b9f\u0ba3\u0bae\u0bcd ${dueDate} \u0bb5\u0bb0\u0bc8 \u0b9a\u0bc6\u0bb2\u0bc1\u0ba4\u0bcd\u0ba4 \u0bb5\u0bc7\u0ba3\u0bcd\u0b9f\u0bc1\u0bae\u0bcd.`,
    }),
    attendance_absent: ({ date, studentName }) => ({
      title:
        '\u0bb5\u0bb0\u0bc1\u0b95\u0bc8 \u0b8e\u0b9a\u0bcd\u0b9a\u0bb0\u0bbf\u0b95\u0bcd\u0b95\u0bc8',
      body: `${studentName || '\u0b89\u0b99\u0bcd\u0b95\u0bb3\u0bcd \u0baa\u0bbf\u0bb3\u0bcd\u0bb3\u0bc8'} ${date} \u0b85\u0ba9\u0bcd\u0bb1\u0bc1 \u0bb5\u0bb0\u0bb5\u0bbf\u0bb2\u0bcd\u0bb2\u0bc8.`,
    }),
    attendance_present: ({ date, studentName }) => ({
      title:
        '\u0bb5\u0bb0\u0bc1\u0b95\u0bc8 \u0b85\u0bb1\u0bbf\u0bb5\u0bbf\u0baa\u0bcd\u0baa\u0bc1',
      body: `${studentName || '\u0b89\u0b99\u0bcd\u0b95\u0bb3\u0bcd \u0baa\u0bbf\u0bb3\u0bcd\u0bb3\u0bc8'} ${date} \u0b85\u0ba9\u0bcd\u0bb1\u0bc1 \u0bb5\u0ba8\u0bcd\u0ba4\u0bbf\u0bb0\u0bc1\u0ba8\u0bcd\u0ba4\u0bbe\u0bb0\u0bcd.`,
    }),
    exam_result_published: ({ examName }) => ({
      title:
        '\u0ba4\u0bc7\u0bb0\u0bcd\u0bb5\u0bc1 \u0bae\u0ba4\u0bbf\u0baa\u0bcd\u0baa\u0bc6\u0ba3\u0bcd\u0b95\u0bb3\u0bcd \u0bb5\u0bc6\u0bb3\u0bbf\u0baf\u0bbf\u0b9f\u0bcd\u0b9f\u0ba4\u0bc1',
      body: `${examName} \u0bae\u0ba4\u0bbf\u0baa\u0bcd\u0baa\u0bc6\u0ba3\u0bcd\u0b95\u0bb3\u0bcd \u0b87\u0baa\u0bcd\u0baa\u0bcb\u0ba4\u0bc1 \u0b95\u0bbf\u0b9f\u0bc8\u0b95\u0bcd\u0b95\u0bbf\u0ba9\u0bcd\u0bb1\u0ba9.`,
    }),
    announcement: ({ title, content }) => ({
      title:
        title ||
        '\u0baa\u0bc1\u0ba4\u0bbf\u0baf \u0b85\u0bb1\u0bbf\u0bb5\u0bbf\u0baa\u0bcd\u0baa\u0bc1',
      body: content ? content.substring(0, 100) : '',
    }),
    emergency: ({ message }) => ({
      title:
        '\ud83d\udea8 \u0b85\u0bb5\u0b9a\u0bb0 \u0b8e\u0b9a\u0bcd\u0b9a\u0bb0\u0bbf\u0b95\u0bcd\u0b95\u0bc8',
      body: message,
    }),
  },

  te: {
    fee_due: ({ amount, dueDate }) => ({
      title:
        '\u0c30\u0c41\u0c38\u0c41\u0c2e\u0c41 \u0c30\u0c3f\u0c2e\u0c48\u0c02\u0c21\u0c30\u0c4d',
      body: `\u20b9${amount} \u0c1a\u0c46\u0c32\u0c4d\u0c32\u0c3f\u0c02\u0c2a\u0c41 ${dueDate} \u0c28\u0c3e\u0c1f\u0c3f\u0c15\u0c3f \u0c1a\u0c46\u0c32\u0c4d\u0c32\u0c3f\u0c02\u0c1a\u0c3e\u0c32\u0c3f.`,
    }),
    attendance_absent: ({ date, studentName }) => ({
      title: '\u0c39\u0c3e\u0c1c\u0c30\u0c41 \u0c39\u0c46\u0c1a\u0c4d\u0c1a\u0c30\u0c3f\u0c15',
      body: `${studentName || '\u0c2e\u0c40 \u0c2a\u0c3f\u0c32\u0c4d\u0c32\u0c35\u0c3e\u0c21\u0c41'} ${date}\u0c28 \u0c17\u0c48\u0c30\u0c4d\u200c\u0c39\u0c3e\u0c1c\u0c30\u0c41 \u0c05\u0c2f\u0c4d\u0c2f\u0c3e\u0c21\u0c41.`,
    }),
    attendance_present: ({ date, studentName }) => ({
      title: '\u0c39\u0c3e\u0c1c\u0c30\u0c41 \u0c28\u0c4b\u0c1f\u0c40\u0c38\u0c41',
      body: `${studentName || '\u0c2e\u0c40 \u0c2a\u0c3f\u0c32\u0c4d\u0c32\u0c35\u0c3e\u0c21\u0c41'} ${date}\u0c28 \u0c39\u0c3e\u0c1c\u0c30\u0c41 \u0c05\u0c2f\u0c4d\u0c2f\u0c3e\u0c21\u0c41.`,
    }),
    exam_result_published: ({ examName }) => ({
      title:
        '\u0c2b\u0c32\u0c3f\u0c24\u0c3e\u0c32\u0c41 \u0c2a\u0c4d\u0c30\u0c15\u0c1f\u0c3f\u0c02\u0c1a\u0c2c\u0c21\u0c4d\u0c21\u0c3e\u0c2f\u0c3f',
      body: `${examName} \u0c2b\u0c32\u0c3f\u0c24\u0c3e\u0c32\u0c41 \u0c07\u0c2a\u0c4d\u0c2a\u0c41\u0c21\u0c41 \u0c05\u0c02\u0c26\u0c41\u0c2c\u0c3e\u0c1f\u0c41\u0c32\u0c4b \u0c09\u0c28\u0c4d\u0c28\u0c3e\u0c2f\u0c3f.`,
    }),
    announcement: ({ title, content }) => ({
      title: title || '\u0c15\u0c4a\u0c24\u0c4d\u0c24 \u0c2a\u0c4d\u0c30\u0c15\u0c1f\u0c28',
      body: content ? content.substring(0, 100) : '',
    }),
    emergency: ({ message }) => ({
      title:
        '\ud83d\udea8 \u0c05\u0c24\u0c4d\u0c2f\u0c35\u0c38\u0c30 \u0c39\u0c46\u0c1a\u0c4d\u0c1a\u0c30\u0c3f\u0c15',
      body: message,
    }),
  },

  kn: {
    fee_due: ({ amount, dueDate }) => ({
      title: '\u0cb6\u0cc1\u0cb2\u0ccd\u0c95 \u0c9c\u0ccd\u0c9e\u0cbe\u0caa\u0ca8',
      body: `\u20b9${amount} \u0cb6\u0cc1\u0cb2\u0ccd\u0c95 \u0caa\u0cbe\u0cb5\u0ca4\u0cbf ${dueDate} \u0cb0\u0c82\u0ca6\u0cc1 \u0cac\u0cbe\u0c95\u0cbf \u0c87\u0ca6\u0cc6.`,
    }),
    attendance_absent: ({ date, studentName }) => ({
      title:
        '\u0cb9\u0cbe\u0c9c\u0cb0\u0cbe\u0ca4\u0cbf \u0c8e\u0c9a\u0ccd\u0c9a\u0cb0\u0cbf\u0c95\u0cc6',
      body: `${studentName || '\u0ca8\u0cbf\u0cae\u0ccd\u0cae \u0cae\u0c97\u0cc1'} ${date} \u0cb0\u0c82\u0ca6\u0cc1 \u0c97\u0cc8\u0cb0\u0cc1\u0cb9\u0cbe\u0c9c\u0cb0\u0cbe\u0c97\u0cbf\u0ca6\u0cc6.`,
    }),
    attendance_present: ({ date, studentName }) => ({
      title: '\u0cb9\u0cbe\u0c9c\u0cb0\u0cbe\u0ca4\u0cbf \u0cb8\u0cc2\u0c9a\u0ca8\u0cc6',
      body: `${studentName || '\u0ca8\u0cbf\u0cae\u0ccd\u0cae \u0cae\u0c97\u0cc1'} ${date} \u0cb0\u0c82\u0ca6\u0cc1 \u0cb9\u0cbe\u0c9c\u0cb0\u0cbe\u0c97\u0cbf\u0ca6\u0cc6.`,
    }),
    exam_result_published: ({ examName }) => ({
      title:
        '\u0cab\u0cb2\u0cbf\u0ca4\u0cbe\u0c82\u0cb6 \u0caa\u0ccd\u0cb0\u0c95\u0091\u0c9f\u0cbf\u0cb8\u0cb2\u0cbe\u0c97\u0cbf\u0ca6\u0cc6',
      body: `${examName} \u0cab\u0cb2\u0cbf\u0ca4\u0cbe\u0c82\u0cb6\u0c97\u0cb3\u0cc1 \u0c87\u0c9a\u0ccd\u0c9a\u0cbf\u0c97\u0cc6 \u0cb2\u0cad\u0ccd\u0caf\u0cb5\u0cbf\u0ca6\u0cc6.`,
    }),
    announcement: ({ title, content }) => ({
      title:
        title ||
        '\u0cb9\u0cca\u0c9a\u0ccd\u0c9a\u0cc1 \u0caa\u0ccd\u0cb0\u0c95\u0091\u0c9f\u0ca3\u0cc6',
      body: content ? content.substring(0, 100) : '',
    }),
    emergency: ({ message }) => ({
      title:
        '\ud83d\udea8 \u0ca4\u0cc1\u0cb0\u0ccd\u0ca4\u0cc1 \u0c8e\u0c9a\u0ccd\u0c9a\u0cb0\u0cbf\u0c95\u0cc6',
      body: message,
    }),
  },

  ur: {
    fee_due: ({ amount, dueDate }) => ({
      title: '\u0641\u06cc\u0633 \u06cc\u0627\u062f \u062f\u06c1\u0627\u0646\u06cc',
      body: `\u20b9${amount} \u06a9\u06cc \u0641\u06cc\u0633 ${dueDate} \u062a\u06a9 \u0648\u0627\u062c\u0628 \u0627\u0644\u0627\u062f\u0627 \u06c1\u06d2\u06d4`,
    }),
    attendance_absent: ({ date, studentName }) => ({
      title: '\u062d\u0627\u0636\u0631\u06cc \u0627\u0646\u062a\u0628\u0627\u06c1',
      body: `${studentName || '\u0622\u067e \u06a9\u0627 \u0628\u0686\u06c1'} ${date} \u06a9\u0648 \u063a\u06cc\u0631 \u062d\u0627\u0636\u0631 \u062a\u06be\u0627\u06d4`,
    }),
    attendance_present: ({ date, studentName }) => ({
      title: '\u062d\u0627\u0636\u0631\u06cc \u0627\u0637\u0644\u0627\u0639',
      body: `${studentName || '\u0622\u067e \u06a9\u0627 \u0628\u0686\u06c1'} ${date} \u06a9\u0648 \u062d\u0627\u0636\u0631 \u062a\u06be\u0627\u06d4`,
    }),
    exam_result_published: ({ examName }) => ({
      title: '\u0646\u062a\u0627\u0626\u062c \u0634\u0627\u0626\u0639',
      body: `${examName} \u06a9\u06d2 \u0646\u062a\u0627\u0626\u062c \u0627\u0628 \u062f\u0633\u062a\u06cc\u0627\u0628 \u06c1\u06cc\u06ba\u06d4`,
    }),
    announcement: ({ title, content }) => ({
      title: title || '\u0646\u06cc\u0627 \u0627\u0639\u0644\u0627\u0646',
      body: content ? content.substring(0, 100) : '',
    }),
    emergency: ({ message }) => ({
      title:
        '\ud83d\udea8 \u06c1\u0646\u06af\u0627\u0645\u06cc \u0627\u0646\u062a\u0628\u0627\u06c1',
      body: message,
    }),
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Supported locale codes matching SchoolSettings.language.supportedLanguages enum.
 */
export const SUPPORTED_LOCALES = ['en', 'hi', 'ta', 'te', 'kn', 'ur'];

/**
 * Build a localized SMS message string.
 *
 * @param {'fee_reminder'|'attendance_absent'|'attendance_present'|'otp'|'emergency'} type
 * @param {Object} data - Template variables (amount, dueDate, date, otp, message, etc.)
 * @param {string} [locale='en'] - BCP 47-style locale code
 * @returns {string} Localized message string, falling back to English if locale/type not found
 */
export function buildSmsMessage(type, data, locale = 'en') {
  const lang = SMS_TEMPLATES[locale] || SMS_TEMPLATES.en;
  const builder = lang[type] ?? SMS_TEMPLATES.en[type];
  return builder ? builder(data) : '';
}

/**
 * Build localized push notification title and body.
 *
 * @param {'fee_due'|'attendance_absent'|'attendance_present'|'exam_result_published'|'announcement'|'emergency'} type
 * @param {Object} data - Template variables (amount, dueDate, date, studentName, examName, title, content, message)
 * @param {string} [locale='en'] - BCP 47-style locale code
 * @returns {{ title: string, body: string }} Localized push content, falling back to English
 */
export function buildPushContent(type, data, locale = 'en') {
  const lang = PUSH_TEMPLATES[locale] || PUSH_TEMPLATES.en;
  const builder = lang[type] ?? PUSH_TEMPLATES.en[type];
  return builder ? builder(data) : { title: '', body: '' };
}
