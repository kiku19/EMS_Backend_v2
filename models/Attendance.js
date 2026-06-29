import mongoose from 'mongoose';

const attendanceSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    date: {
      type: String,
      required: true,
      validate: {
        validator: function (v) {
          // Must be YYYY-MM-DD format and represent a real date
          if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
          const d = new Date(v + 'T00:00:00Z');
          return !isNaN(d.getTime()) && d.toISOString().startsWith(v);
        },
        message: 'Date must be a valid date in YYYY-MM-DD format',
      },
    },
    status: {
      type: String,
      required: true,
      enum: ['present', 'absent', 'late', 'leave', 'halfday'],
    },
    markedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    // Audit trail for admin-driven regularization (drawer on student profile).
    // Mirrors StaffAttendance.regularization. Optional — old docs simply
    // have no trail; only set when the record is flipped via the
    // POST /attendance/student/:id/regularize endpoint.
    regularization: {
      regularizedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
      regularizedAt: Date,
      previousStatus: {
        type: String,
        enum: ['present', 'absent', 'late', 'leave', 'halfday', 'unmarked'],
      },
      regularizationReason: String,
    },
    // Soft-delete support: admins can now retract an accidental mass mark
    // (via trash restore) instead of hard-deleting rows which left no audit
    // trail and couldn't be undone.
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  },
  { timestamps: true }
);

// Unique index now filters out soft-deleted rows so restoring an old
// record doesn't collide with a new one marked after the deletion.
attendanceSchema.index(
  { schoolId: 1, studentId: 1, date: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
attendanceSchema.index({ classId: 1, date: 1 });
attendanceSchema.index({ studentId: 1, date: 1 });
attendanceSchema.index({ schoolId: 1, classId: 1, date: -1 }); // Optimizes class-level attendance reports

export default mongoose.model('Attendance', attendanceSchema);
