import mongoose from 'mongoose';

const attendanceSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School' },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    date: { type: String, required: true },
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
