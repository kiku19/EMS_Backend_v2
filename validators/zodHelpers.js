import { z } from 'zod';

// Reusable Zod primitives for the EMS project

// MongoDB ObjectId pattern
export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid 24-character ID');

// Optional ObjectId (allows null/empty)
export const optionalObjectId = objectId.nullish().or(z.literal(''));

// 10-digit phone number
export const phone10 = z.string().regex(/^[0-9]{10}$/, 'Phone number must be exactly 10 digits');

// Optional 10-digit phone
export const optionalPhone = phone10.nullish().or(z.literal(''));

// International phone number (E.164 style or with common separators)
// Accepts: +919876543210, +1-415-555-2671, +44 20 7946 0958, 9876543210
export const phoneIntl = z
  .string()
  .regex(
    /^\+?[0-9\s\-().]{7,20}$/,
    'Phone number must be 7–20 characters and may include +, digits, spaces, dashes, or parentheses'
  );

// Optional international phone
export const optionalPhoneIntl = phoneIntl.nullish().or(z.literal(''));

// Optional email — explicit regex instead of z.string().email() to ensure
// consistent behaviour across Zod versions and require a proper TLD (≥2 chars)
export const optionalEmail = z
  .string()
  .regex(
    /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
    'Must be a valid email address'
  )
  .nullish()
  .or(z.literal(''));

// Optional URI
export const optionalUri = z.string().url('Must be a valid URL').nullish().or(z.literal(''));

// Academic year pattern YYYY-YY
export const academicYear = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'Academic year must be in YYYY-YY format (e.g. 2025-26)');

// Date string YYYY-MM-DD
export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

// Optional string with max length
export const optionalString = (max = 500) =>
  z.string().max(max, `Must not exceed ${max} characters`).nullish().or(z.literal(''));

// Blood group enum
export const bloodGroupEnum = z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'], {
  errorMap: () => ({ message: 'Blood group must be one of: A+, A-, B+, B-, AB+, AB-, O+, O-' }),
});

// Gender enum
export const genderEnum = z.enum(['Male', 'Female', 'Other'], {
  errorMap: () => ({ message: 'Gender must be Male, Female, or Other' }),
});

// Zod validation middleware factory (drop-in replacement for Joi validate())
export function validateZod(schema, source = 'body') {
  return (req, res, next) => {
    const data =
      source === 'body'
        ? req.body
        : source === 'params'
          ? req.params
          : source === 'query'
            ? req.query
            : req[source];

    const result = schema.safeParse(data);

    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));

      return res.status(400).json({
        error: 'Validation failed',
        details: errors,
      });
    }

    // Replace request data with validated and sanitized data
    if (source === 'body') req.body = result.data;
    else if (source === 'params') req.params = result.data;
    else if (source === 'query') req.query = result.data;
    else req[source] = result.data;

    next();
  };
}
