import { z } from 'zod';
import { optionalObjectId, phoneIntl } from './zodHelpers.js';

export const sendOtpSchema = z.object({
  phone: phoneIntl,
  schoolId: optionalObjectId,
  schoolCode: z.string().trim().max(50).optional(),
});

export const verifyOtpSchema = z
  .object({
    phone: phoneIntl,
    otp: z
      .string()
      .regex(/^\d{4,10}$/, 'OTP must be 4–10 digits')
      .optional(),
    firebaseIdToken: z.string().min(1).optional(),
    schoolId: optionalObjectId,
    schoolCode: z.string().trim().max(50).optional(),
  })
  .refine((data) => Boolean(data.otp) || Boolean(data.firebaseIdToken), {
    message: 'Either otp or firebaseIdToken is required',
    path: ['otp'],
  });

export const leaveRequestSchema = z
  .object({
    leaveType: z.enum(['sick', 'personal', 'family', 'other'], {
      errorMap: () => ({ message: 'leaveType must be one of: sick, personal, family, other' }),
    }),
    reason: z.string().min(1, 'Reason is required').max(500, 'Reason cannot exceed 500 characters'),
    startDate: z
      .string()
      .refine((d) => !isNaN(Date.parse(d)), { message: 'startDate must be a valid date' }),
    endDate: z
      .string()
      .refine((d) => !isNaN(Date.parse(d)), { message: 'endDate must be a valid date' }),
  })
  .refine((data) => new Date(data.startDate) <= new Date(data.endDate), {
    message: 'startDate must be on or before endDate',
    path: ['startDate'],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'New password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number'),
    confirmPassword: z.string().min(1, 'Confirm password is required'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from current password',
    path: ['newPassword'],
  });
