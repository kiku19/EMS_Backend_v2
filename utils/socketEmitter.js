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
  emitSocketEvent('fee_structure_updated', {
    studentId: studentId.toString(),
    studentName,
    totalFee: feeData.totalFee,
    totalPaid: feeData.totalPaid,
    totalBalance: feeData.totalBalance,
    overallStatus: feeData.overallStatus,
    timestamp: new Date().toISOString()
  });
}
