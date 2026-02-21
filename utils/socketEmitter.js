// Socket.IO emitter utility for broadcasting events across routes
let io = null;

/**
 * Initialize the socket emitter with Socket.IO instance
 * @param {Object} socketIO - Socket.IO server instance
 */
export function initializeSocket(socketIO) {
  io = socketIO;
}

/**
 * Emit an event to all connected clients
 * @param {string} event - Event name
 * @param {Object} data - Data to emit
 */
export function emitSocketEvent(event, data) {
  if (io) {
    io.emit(event, data);
    console.log(`📡 Socket event emitted: ${event}`, data);
  } else {
    console.warn(`⚠️ Socket not initialized, cannot emit event: ${event}`);
  }
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
    timestamp: new Date().toISOString()
  };

  // Broadcast to all clients (school dashboard, staff app)
  emitSocketEvent('fee_structure_updated', payload);

  // Also emit to the student-specific room so parent app gets it
  if (io) {
    io.to(`student:${studentId.toString()}`).emit('student_fee_updated', payload);
  }
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
    timestamp: new Date().toISOString()
  };

  // Broadcast to all clients
  emitSocketEvent('fee_payment_created', payload);

  // Also emit to student-specific room
  if (io) {
    io.to(`student:${studentId.toString()}`).emit('student_fee_updated', payload);
  }
}

/**
 * Emit staff profile update event
 * @param {string} staffId - Staff MongoDB _id
 * @param {string[]} fieldsChanged - Array of field names that changed
 * @param {string} source - Source of update ('mobile_app' | 'web_dashboard')
 * @param {Object} staffData - Updated staff data (optional)
 */
export function emitStaffUpdate(staffId, fieldsChanged, source, staffData = {}) {
  const eventData = {
    staffId: staffId.toString(),
    fieldsChanged,
    timestamp: new Date().toISOString(),
    source
  };

  // Add optional staff data if provided
  if (staffData.name) eventData.name = staffData.name;
  if (staffData.role) eventData.role = staffData.role;
  if (staffData.department) eventData.department = staffData.department;
  if (staffData.status) eventData.status = staffData.status;
  if (staffData.phone) eventData.phone = staffData.phone;
  if (staffData.email) eventData.email = staffData.email;
  if (staffData.picture) eventData.picture = staffData.picture;

  emitSocketEvent('staff_updated', eventData);
}
