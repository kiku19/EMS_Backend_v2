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

// ─── Student Leave Schemas ──────────────────────────────────────────────────

// POST /student-leaves — create student leave application
export const createStudentLeaveSchema = z
  .object({
    studentId: objectId,
    appliedByParentId: objectId,
    leaveType: z.enum(['sick', 'personal', 'family', 'other'], {
      required_error: 'Leave type is required',
      invalid_type_error: 'Leave type must be one of: sick, personal, family, other',
    }),
    reason: z.string().min(3, 'Reason must be at least 3 characters').max(1000),
    startDate: dateString,
    endDate: dateString,
    days: z.number().int().min(1, 'Days must be at least 1').optional(),
  })
  .refine((data) => new Date(data.endDate) >= new Date(data.startDate), {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  });

// PUT /student-leaves/:id — update pending student leave
export const updateStudentLeaveSchema = z
  .object({
    leaveType: z.enum(['sick', 'personal', 'family', 'other']).optional(),
    reason: z.string().min(3).max(1000).optional(),
    startDate: dateString.optional(),
    endDate: dateString.optional(),
    days: z.number().int().min(1).optional(),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return new Date(data.endDate) >= new Date(data.startDate);
      }
      return true;
    },
    {
      message: 'End date must be on or after start date',
      path: ['endDate'],
    }
  );

// PUT /student-leaves/:id/status — approve or reject student leave
export const updateStudentLeaveStatusSchema = z.object({
  status: z.enum(['approved', 'rejected'], { required_error: 'Status is required' }),
  rejectionReason: z.string().max(500).optional(),
  adminRemarks: z.string().max(1000).optional(),
});

// GET /student-leaves — query parameters for listing student leaves
export const studentLeaveQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  studentId: optionalObjectId,
  leaveType: z.enum(['sick', 'personal', 'family', 'other']).optional(),
  startDateFrom: dateString.optional(),
  startDateTo: dateString.optional(),
  skip: z.string().regex(/^\d+$/).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
});
