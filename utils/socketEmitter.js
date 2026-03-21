// Socket.IO emitter utility for broadcasting events across routes
import { EVENTS, emitEvent, emitEventToRoom } from './socketEvents.js';
export { EVENTS };

let io = null;

/**
 * Initialize the socket emitter with Socket.IO instance
 * @param {Object} socketIO - Socket.IO server instance
 */
export function initializeSocket(socketIO) {
  io = socketIO;
}

/**
 * Emit an event to all connected clients (legacy wrapper — prefer emitEvent directly)
 * @param {string} event - Event name
 * @param {Object} data - Data to emit
 */
export function emitSocketEvent(event, data) {
  emitEvent(io, event, data);
}

/**
 * Emit fee structure update event
 * @param {string} studentId - Student ID
 * @param {string} studentName - Student name
 * @param {Object} feeData - Fee structure data
 */
export function emitFeeUpdate(studentId, studentName, feeData) {
  const payload = {
    studentId: studentId.toString(),
    studentName,
    totalFee: feeData.totalFee,
    totalPaid: feeData.totalPaid,
    totalBalance: feeData.totalBalance,
    overallStatus: feeData.overallStatus,
  };

  // Broadcast to all clients (school dashboard, staff app)
  emitEvent(io, EVENTS.FEE_STRUCTURE_UPDATED, payload);

  // Also emit to the student-specific room so parent app gets it
  emitEventToRoom(io, `student:${studentId.toString()}`, EVENTS.STUDENT_FEE_UPDATED, payload);
}

/**
 * Emit fee payment created event
 * @param {string} studentId - Student ID
 * @param {string} studentName - Student name
 * @param {Object} payment - Payment data
 * @param {Object} feeData - Updated fee totals (optional)
 */
export function emitFeePaymentCreated(studentId, studentName, payment, feeData) {
  const payload = {
    studentId: studentId.toString(),
    studentName,
    payment: {
      amount: payment.amount,
      paymentMode: payment.paymentMode,
      receiptNumber: payment.receiptNumber,
      paymentDate: payment.paymentDate,
    },
    ...(feeData && {
      totalFee: feeData.totalFee,
      totalPaid: feeData.totalPaid,
      totalBalance: feeData.totalBalance,
      overallStatus: feeData.overallStatus,
    }),
  };

  // Broadcast to all clients
  emitEvent(io, EVENTS.FEE_PAYMENT_CREATED, payload);

  // Also emit to student-specific room
  emitEventToRoom(io, `student:${studentId.toString()}`, EVENTS.STUDENT_FEE_UPDATED, payload);
}

/**
 * Emit fee due reminder event (fee is due within 7 days)
 * @param {string} studentId - Student ID
 * @param {string} studentName - Student name
 * @param {Object} data - { dueDate, installmentName, balanceAmount }
 */
export function emitFeeDueReminder(studentId, studentName, data) {
  const payload = {
    studentId: studentId.toString(),
    studentName,
    dueDate: data.dueDate,
    installmentName: data.installmentName,
    balanceAmount: data.balanceAmount,
  };
  emitEvent(io, EVENTS.FEE_DUE_REMINDER, payload);
  emitEventToRoom(io, `student:${studentId.toString()}`, EVENTS.FEE_DUE_REMINDER, payload);
}

/**
 * Emit fee overdue event (fee is past due date and still unpaid)
 * @param {string} studentId - Student ID
 * @param {string} studentName - Student name
 * @param {Object} data - { overdueDate, installmentName, balanceAmount }
 */
export function emitFeeOverdueReminder(studentId, studentName, data) {
  const payload = {
    studentId: studentId.toString(),
    studentName,
    overdueDate: data.overdueDate,
    installmentName: data.installmentName,
    balanceAmount: data.balanceAmount,
  };
  emitEvent(io, EVENTS.FEE_OVERDUE, payload);
  emitEventToRoom(io, `student:${studentId.toString()}`, EVENTS.FEE_OVERDUE, payload);
}

/**
 * Emit a new notification to a specific user's socket room
 * @param {string|ObjectId} userId - User's MongoDB _id
 * @param {Object} notification - The saved Notification document
 */
export function emitNotificationToUser(userId, notification) {
  emitEventToRoom(io, `user:${userId.toString()}`, EVENTS.NOTIFICATION_NEW, {
    _id: notification._id.toString(),
    type: notification.type,
    title: notification.title,
    message: notification.message,
    priority: notification.priority,
    read: notification.read,
    createdAt: notification.createdAt,
    actionUrl: notification.actionUrl,
  });
}

/**
 * Emit staff profile update event
 * @param {string} staffId - Staff MongoDB _id
 * @param {string[]} fieldsChanged - Array of field names that changed
 * @param {string} source - Source of update ('mobile_app' | 'web_dashboard')
 * @param {Object} staffData - Updated staff data (optional)
 */
export function emitStaffUpdate(staffId, fieldsChanged, source, staffData = {}) {
  const payload = {
    staffId: staffId.toString(),
    fieldsChanged,
    source,
    ...(staffData.name && { name: staffData.name }),
    ...(staffData.role && { role: staffData.role }),
    ...(staffData.department && { department: staffData.department }),
    ...(staffData.status && { status: staffData.status }),
    ...(staffData.phone && { phone: staffData.phone }),
    ...(staffData.email && { email: staffData.email }),
    ...(staffData.picture && { picture: staffData.picture }),
  };

  emitEvent(io, EVENTS.STAFF_UPDATED, payload);
}
