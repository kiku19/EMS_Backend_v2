import mongoose from 'mongoose';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

const attendanceSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    // AGENTS.md mandates "Attendance uniqueness per student+date+academicYear".
    // Without this field a re-enrolled student marked on the same calendar date
    // in a later year collides with the old record and the upsert silently
    // overwrites the prior year's classId/status.
    //
    // NOT `required: true` (mirrors models/Student.js) so legacy documents that
    // predate this field don't fail validation on save; they simply fall back
    // to CURRENT_ACADEMIC_YEAR via the default.
    //
    // MIGRATION NOTE: existing Attendance documents have no academicYear and
    // will be written with the default (CURRENT_ACADEMIC_YEAR) on their next
    // save. To backfill historical rows with their true year, run a one-off
    // migration that derives academicYear from each record's `date` (e.g.
    // date >= YYYY-04-01 → `${YYYY}-${YY+1}`) — out of scope here.
    academicYear: { type: String, default: CURRENT_ACADEMIC_YEAR },
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
// Includes academicYear so the same student+date in different academic years
// (e.g. a re-enrolled student) are distinct rows. NOTE: the live MongoDB
// collection still has the old { schoolId, studentId, date } unique index —
// drop it via `db.attendances.dropIndex("schoolId_1_studentId_1_date_1")` after
// deploying, else the old index will keep enforcing the looser uniqueness.
attendanceSchema.index(
  { schoolId: 1, studentId: 1, date: 1, academicYear: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
attendanceSchema.index({ classId: 1, date: 1 });
attendanceSchema.index({ studentId: 1, date: 1 });
attendanceSchema.index({ schoolId: 1, classId: 1, date: -1 }); // Optimizes class-level attendance reports

export default mongoose.model('Attendance', attendanceSchema);
