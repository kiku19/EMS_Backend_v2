/**
 * Phone Validation Service
 * Handles validation of Indian and international phone numbers
 * with mock third-party API validation
 */

/**
 * Validates Indian phone number format
 * @param {string} phone - Phone number to validate
 * @returns {Object} - { isValid: boolean, error: string }
 */
function validateIndianPhone(phone) {
  if (!phone) {
    return {
      isValid: false,
      error: 'Phone number is required',
    };
  }

  // Remove all non-numeric characters
  const cleanedPhone = phone.replace(/\D/g, '');

  // Check if exactly 10 digits
  if (cleanedPhone.length !== 10) {
    return {
      isValid: false,
      error: 'Phone number must be exactly 10 digits',
    };
  }

  // Check if starts with valid digits (6, 7, 8, 9)
  const firstDigit = parseInt(cleanedPhone.charAt(0), 10);
  if (![6, 7, 8, 9].includes(firstDigit)) {
    return {
      isValid: false,
      error: 'Phone number must start with 6, 7, 8, or 9',
    };
  }

  // Check if all characters are digits
  if (!/^\d+$/.test(cleanedPhone)) {
    return {
      isValid: false,
      error: 'Phone number must contain only digits',
    };
  }

  return {
    isValid: true,
    error: null,
  };
}

/**
 * Validates international phone number format based on country code
 * @param {string} phone - Phone number to validate
 * @param {string} countryCode - ISO country code (e.g., 'US', 'UK', 'AE')
 * @returns {Object} - { isValid: boolean, error: string }
 */
function validateInternationalPhone(phone, countryCode) {
  if (!phone) {
    return {
      isValid: false,
      error: 'Phone number is required',
    };
  }

  if (!countryCode) {
    return {
      isValid: false,
      error: 'Country code is required for international validation',
    };
  }

  // Remove spaces, dashes, parentheses
  const cleanedPhone = phone.replace(/[\s\-()]/g, '');

  // Country-specific validation patterns
  const countryPatterns = {
    // US/Canada: 10 digits, optional +1 prefix
    US: /^(\+?1)?[2-9]\d{9}$/,
    CA: /^(\+?1)?[2-9]\d{9}$/,

    // UK: 10-11 digits, optional +44 prefix
    UK: /^(\+?44)?[1-9]\d{8,10}$/,

    // UAE: 9 digits (after country code), starts with 5
    AE: /^(\+?971)?5[02468]\d{7}$/,

    // Australia: 9 digits, starts with 4
    AU: /^(\+?61)?4\d{8}$/,

    // Germany: 10-11 digits
    DE: /^(\+?49)?[1-9]\d{8,10}$/,

    // France: 9 digits (after country code)
    FR: /^(\+?33)?[1-9]\d{8}$/,

    // Singapore: 8 digits, starts with 8 or 9
    SG: /^(\+?65)?[89]\d{7}$/,

    // Default: Basic international format (7-15 digits with +)
    DEFAULT: /^\+?[1-9]\d{6,14}$/,
  };

  // Get pattern for country, use DEFAULT if not found
  const pattern = countryPatterns[countryCode.toUpperCase()] || countryPatterns['DEFAULT'];

  if (!pattern.test(cleanedPhone)) {
    return {
      isValid: false,
      error: `Invalid phone number format for country code: ${countryCode}`,
    };
  }

  // Check minimum length (7 digits excluding country code)
  const digitsOnly = cleanedPhone.replace(/\D/g, '');
  if (digitsOnly.length < 7) {
    return {
      isValid: false,
      error: 'Phone number must be at least 7 digits',
    };
  }

  // Check maximum length (15 digits including country code)
  if (digitsOnly.length > 15) {
    return {
      isValid: false,
      error: 'Phone number cannot exceed 15 digits',
    };
  }

  return {
    isValid: true,
    error: null,
  };
}

/**
 * Mock third-party validation service
 * Simulates external API validation with network delay
 * @param {string} phone - Phone number to validate
 * @returns {Promise<Object>} - { isValid: boolean, error: string, provider: string }
 */
async function mockThirdPartyValidation(phone) {
  // Simulate network delay (500-1500ms)
  const delay = Math.floor(Math.random() * 1000) + 500;

  await new Promise((resolve) => setTimeout(resolve, delay));

  // Clean phone number
  const cleanedPhone = phone.replace(/\D/g, '');

  // Known invalid patterns
  const invalidPatterns = [
    /^0000000000$/, // All zeros
    /^1111111111$/, // All ones
    /^2222222222$/, // All twos
    /^3333333333$/, // All threes
    /^4444444444$/, // All fours
    /^5555555555$/, // All fives
    /^6666666666$/, // All sixes
    /^7777777777$/, // All sevens
    /^8888888888$/, // All eights
    /^9999999999$/, // All nines
    /^1234567890$/, // Sequential
    /^0987654321$/, // Reverse sequential
  ];

  // Check against invalid patterns
  for (const pattern of invalidPatterns) {
    if (pattern.test(cleanedPhone)) {
      return {
        isValid: false,
        error: 'Phone number is flagged as invalid by third-party service',
        provider: 'MockPhoneValidationAPI',
      };
    }
  }

  // Check if number is in a valid range (for Indian numbers)
  if (cleanedPhone.length === 10) {
    const firstDigit = parseInt(cleanedPhone.charAt(0), 10);
    if (![6, 7, 8, 9].includes(firstDigit)) {
      return {
        isValid: false,
        error: 'Phone number does not match valid carrier ranges',
        provider: 'MockPhoneValidationAPI',
      };
    }
  }

  // Simulate occasional verification failure (5% chance)
  if (Math.random() < 0.05) {
    return {
      isValid: false,
      error: 'Unable to verify phone number at this time',
      provider: 'MockPhoneValidationAPI',
    };
  }

  // Valid number
  return {
    isValid: true,
    error: null,
    provider: 'MockPhoneValidationAPI',
  };
}

/**
 * Comprehensive phone validation
 * Combines format validation with third-party verification
 * @param {string} phone - Phone number to validate
 * @param {string} countryCode - Optional country code
 * @param {boolean} useThirdParty - Whether to use third-party validation
 * @returns {Promise<Object>} - { isValid: boolean, error: string, details: Object }
 */
async function validatePhone(phone, countryCode = 'IN', useThirdParty = false) {
  // Step 1: Format validation
  let formatResult;

  if (countryCode.toUpperCase() === 'IN') {
    formatResult = validateIndianPhone(phone);
  } else {
    formatResult = validateInternationalPhone(phone, countryCode);
  }

  if (!formatResult.isValid) {
    return {
      isValid: false,
      error: formatResult.error,
      details: {
        stage: 'format_validation',
        phone: phone,
        countryCode: countryCode,
      },
    };
  }

  // Step 2: Third-party validation (if requested)
  if (useThirdParty) {
    const thirdPartyResult = await mockThirdPartyValidation(phone);

    if (!thirdPartyResult.isValid) {
      return {
        isValid: false,
        error: thirdPartyResult.error,
        details: {
          stage: 'third_party_validation',
          phone: phone,
          countryCode: countryCode,
          provider: thirdPartyResult.provider,
        },
      };
    }

    return {
      isValid: true,
      error: null,
      details: {
        stage: 'completed',
        phone: phone,
        countryCode: countryCode,
        provider: thirdPartyResult.provider,
      },
    };
  }

  // Format validation only
  return {
    isValid: true,
    error: null,
    details: {
      stage: 'format_validation_only',
      phone: phone,
      countryCode: countryCode,
    },
  };
}

export { validateIndianPhone, validateInternationalPhone, mockThirdPartyValidation, validatePhone };
