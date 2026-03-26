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
  },
  { timestamps: true }
);

attendanceSchema.index({ schoolId: 1, studentId: 1, date: 1 }, { unique: true });
attendanceSchema.index({ classId: 1, date: 1 });
attendanceSchema.index({ studentId: 1, date: 1 });

export default mongoose.model('Attendance', attendanceSchema);
