import { z } from 'zod';

/**
 * Centralized socket event registry.
 * All socket event names and their Zod payload schemas are defined here.
 * Standard envelope for all events: { event, schoolId?, studentId?, classId?, timestamp, data }
 */

// ---------------------------------------------------------------------------
// Event name constants
// ---------------------------------------------------------------------------
export const EVENTS = {
  // Attendance
  STUDENT_ATTENDANCE_UPDATED: 'student_attendance_updated',
  STUDENT_ATTENDANCE_BULK_UPDATED: 'student_attendance_bulk_updated',
  ATTENDANCE_UPDATED: 'attendance_updated',

  // Academics
  RESULTS_PUBLISHED: 'results_published',
  EXAM_SCHEDULE_SENT: 'exam_schedule_sent',

  // Students
  STUDENT_CREATED: 'student_created',
  REMARK_SENT_TO_PARENT: 'remark_sent_to_parent',

  // Classes
  CLASS_UPDATED: 'class_updated',

  // Homework
  HOMEWORK_CREATED: 'homework_created',

  // Staff / Leaves
  STAFF_UPDATED: 'staff_updated',
  LEAVE_APPLIED: 'leave_applied',
  LEAVE_STATUS_UPDATED: 'leave_status_updated',
  LEAVE_CANCELLED: 'leave_cancelled',

  // Fees
  FEE_STRUCTURE_UPDATED: 'fee_structure_updated',
  FEE_PAYMENT_CREATED: 'fee_payment_created',
  STUDENT_FEE_UPDATED: 'student_fee_updated',
  FEE_DUE_REMINDER: 'fee_due_reminder',
  FEE_OVERDUE: 'fee_overdue',

  // Permissions
  PERMISSION_REQUEST_CREATED: 'permission_request_created',
  PERMISSION_REQUEST_REVIEWED: 'permission_request_reviewed',

  // Announcements
  ANNOUNCEMENT_PUBLISHED: 'announcement_published',

  // Timetable
  TIMETABLE_UPDATED: 'timetable_updated',

  // Notifications
  NOTIFICATION_NEW: 'notification:new',
};

// ---------------------------------------------------------------------------
// Per-event data schemas (validates the `data` field of the envelope)
// ---------------------------------------------------------------------------
const EVENT_SCHEMAS = {
  [EVENTS.STUDENT_ATTENDANCE_UPDATED]: z.object({
    date: z.union([z.string(), z.date()]),
    status: z.string(),
    classId: z.string().optional(),
    studentId: z.string().optional(),
  }),

  [EVENTS.STUDENT_ATTENDANCE_BULK_UPDATED]: z.object({
    date: z.union([z.string(), z.date()]),
    count: z.number(),
    classId: z.string().optional(),
  }),

  [EVENTS.ATTENDANCE_UPDATED]: z.object({
    type: z.string(),
    staffId: z.string().optional(),
    date: z.union([z.string(), z.date()]),
    status: z.string(),
    inTime: z.string().optional(),
    outTime: z.string().optional(),
    reason: z.string().optional(),
  }),

  [EVENTS.RESULTS_PUBLISHED]: z.object({
    examId: z.string(),
    examName: z.string(),
    classId: z.string().optional(),
  }),

  [EVENTS.EXAM_SCHEDULE_SENT]: z.object({
    scheduleId: z.string(),
    scheduleName: z.string(),
    classIds: z.array(z.string()),
  }),

  [EVENTS.STUDENT_CREATED]: z.object({
    studentId: z.string(),
    name: z.string(),
    admissionId: z.string().optional(),
    class: z.unknown().optional(),
  }),

  [EVENTS.REMARK_SENT_TO_PARENT]: z.object({
    remarkId: z.string(),
    title: z.string(),
    studentName: z.string().optional(),
    category: z.string().optional(),
  }),

  [EVENTS.CLASS_UPDATED]: z.object({
    classId: z.string(),
    name: z.string().optional(),
    section: z.string().optional(),
    classTeacherId: z.unknown().optional(),
    teacher: z.string().nullable().optional(),
    teacherPhoto: z.string().nullable().optional(),
  }),

  [EVENTS.HOMEWORK_CREATED]: z.object({
    homeworkId: z.string(),
    classId: z.string(),
    teacherId: z.string().optional(),
    title: z.string(),
    subject: z.string().optional(),
    dueDate: z.union([z.string(), z.date()]).optional(),
  }),

  [EVENTS.STAFF_UPDATED]: z.object({
    staffId: z.string(),
    name: z.string().optional(),
    role: z.unknown().optional(),
    department: z.string().optional(),
    status: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    picture: z.string().optional(),
    photo: z.string().optional(),
    fieldsChanged: z.array(z.string()).optional(),
    source: z.string().optional(),
  }),

  [EVENTS.LEAVE_APPLIED]: z.object({
    leaveId: z.string(),
    teacherId: z.string(),
    leaveType: z.string().optional(),
    startDate: z.union([z.string(), z.date()]).optional(),
    endDate: z.union([z.string(), z.date()]).optional(),
    days: z.number().optional(),
  }),

  [EVENTS.LEAVE_STATUS_UPDATED]: z.object({
    leaveId: z.string(),
    teacherId: z.string(),
    status: z.string(),
  }),

  [EVENTS.LEAVE_CANCELLED]: z.object({
    leaveId: z.string(),
    teacherId: z.string(),
  }),

  [EVENTS.FEE_STRUCTURE_UPDATED]: z.object({
    studentId: z.string(),
    studentName: z.string().optional(),
    totalFee: z.number().optional(),
    totalPaid: z.number().optional(),
    totalBalance: z.number().optional(),
    overallStatus: z.string().optional(),
  }),

  [EVENTS.FEE_PAYMENT_CREATED]: z.object({
    studentId: z.string(),
    studentName: z.string().optional(),
    payment: z
      .object({
        amount: z.number(),
        paymentMode: z.string().optional(),
        receiptNumber: z.string().optional(),
        paymentDate: z.union([z.string(), z.date()]).optional(),
      })
      .optional(),
    totalFee: z.number().optional(),
    totalPaid: z.number().optional(),
    totalBalance: z.number().optional(),
    overallStatus: z.string().optional(),
  }),

  [EVENTS.STUDENT_FEE_UPDATED]: z
    .object({
      studentId: z.string(),
      studentName: z.string().optional(),
    })
    .passthrough(),

  [EVENTS.FEE_DUE_REMINDER]: z.object({
    studentId: z.string(),
    studentName: z.string().optional(),
    dueDate: z.string(),
    installmentName: z.string().optional(),
    balanceAmount: z.number().optional(),
  }),

  [EVENTS.FEE_OVERDUE]: z.object({
    studentId: z.string(),
    studentName: z.string().optional(),
    overdueDate: z.string(),
    installmentName: z.string().optional(),
    balanceAmount: z.number().optional(),
  }),

  [EVENTS.PERMISSION_REQUEST_CREATED]: z.object({
    requestId: z.string(),
    userId: z.string(),
    userName: z.string().optional(),
    module: z.string(),
    permissions: z.unknown().optional(),
  }),

  [EVENTS.PERMISSION_REQUEST_REVIEWED]: z.object({
    requestId: z.string(),
    userId: z.string(),
    module: z.string(),
    status: z.string(),
    reviewerName: z.string().optional(),
  }),

  [EVENTS.ANNOUNCEMENT_PUBLISHED]: z.object({
    announcementId: z.string(),
    title: z.string(),
    targetType: z.string().optional(),
  }),

  [EVENTS.TIMETABLE_UPDATED]: z.object({
    classId: z.string().optional(),
    academicYear: z.string().optional(),
  }),

  [EVENTS.NOTIFICATION_NEW]: z.object({
    _id: z.string(),
    type: z.string(),
    title: z.string(),
    message: z.string(),
    priority: z.string().optional(),
    read: z.boolean().optional(),
    createdAt: z.union([z.string(), z.date()]).optional(),
    actionUrl: z.string().optional(),
  }),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build and validate the standard event envelope.
 * @param {string} eventName
 * @param {Object} payload - { schoolId?, studentId?, classId?, ...eventData }
 * @returns {Object} envelope
 */
function buildEnvelope(eventName, payload = {}) {
  const { schoolId, studentId, classId, ...rest } = payload;

  // Keep studentId/classId in event data — many schemas require them
  const eventData = { ...rest };
  if (studentId != null) eventData.studentId = studentId.toString();
  if (classId != null) eventData.classId = classId.toString();

  const schema = EVENT_SCHEMAS[eventName];
  if (schema) {
    const result = schema.safeParse(eventData);
    if (!result.success) {
      console.error(
        `❌ Invalid socket payload for event "${eventName}":`,
        result.error.flatten().fieldErrors
      );
    }
  }

  const envelope = {
    event: eventName,
    timestamp: new Date().toISOString(),
    data: eventData,
  };

  if (schoolId != null) envelope.schoolId = schoolId.toString();
  if (studentId != null) envelope.studentId = studentId.toString();
  if (classId != null) envelope.classId = classId.toString();

  return envelope;
}

/**
 * Emit a standardized socket event to all connected clients.
 *
 * @param {import('socket.io').Server|null} io - Socket.IO server instance
 * @param {string} eventName - One of the EVENTS constants
 * @param {Object} payload - { schoolId?, studentId?, classId?, ...eventData }
 */
export function emitEvent(io, eventName, payload = {}) {
  if (!io) {
    console.warn(`⚠️ Socket not initialized, cannot emit event: ${eventName}`);
    return;
  }
  const envelope = buildEnvelope(eventName, payload);
  io.emit(eventName, envelope);
}

/**
 * Emit a standardized socket event to a specific room.
 *
 * @param {import('socket.io').Server|null} io - Socket.IO server instance
 * @param {string} room - Socket.IO room name (e.g. 'student:abc123')
 * @param {string} eventName - One of the EVENTS constants
 * @param {Object} payload - { schoolId?, studentId?, classId?, ...eventData }
 */
export function emitEventToRoom(io, room, eventName, payload = {}) {
  if (!io) {
    console.warn(`⚠️ Socket not initialized, cannot emit event: ${eventName}`);
    return;
  }
  const envelope = buildEnvelope(eventName, payload);
  io.to(room).emit(eventName, envelope);
}
