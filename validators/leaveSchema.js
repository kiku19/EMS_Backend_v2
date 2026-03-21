import { z } from 'zod';
import { objectId, dateString, optionalObjectId } from './zodHelpers.js';

// Attachment item
const attachmentSchema = z.object({
  name: z.string().max(255).optional(),
  url: z.string().url('Must be a valid URL').optional(),
});

// POST /teacher-leaves — apply for leave
// teacherId is optional here: backend always sets it from req.user.id (JWT)
export const applyLeaveSchema = z
  .object({
    teacherId: optionalObjectId,
    leaveType: z.string().min(1, 'Leave type is required').max(100),
    reason: z.string().min(3, 'Reason must be at least 3 characters').max(1000),
    startDate: dateString,
    endDate: dateString,
    days: z.number().int().min(1, 'Days must be at least 1').optional(),
    attachments: z.array(attachmentSchema).max(5).optional(),
  })
  .refine((data) => new Date(data.endDate) >= new Date(data.startDate), {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  });

// PUT /teacher-leaves/:id/status — approve or reject leave
export const updateLeaveStatusSchema = z.object({
  status: z.enum(['approved', 'rejected'], { required_error: 'Status is required' }),
  rejectionReason: z.string().max(500).optional(),
  substitutions: z
    .array(
      z.object({
        date: z.string().optional(),
        classId: optionalObjectId,
        period: z.string().optional(),
        substituteTeacherId: optionalObjectId,
      })
    )
    .optional(),
});
