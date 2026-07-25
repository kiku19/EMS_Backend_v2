import mongoose from 'mongoose';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

const teacherTimetableSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true },
    academicYear: { type: String, default: CURRENT_ACADEMIC_YEAR },
    schedule: {
      Monday: [
        {
          periodIndex: Number,
          classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
          subject: String,
          room: String,
          lastModified: { type: Date, default: Date.now },
        },
      ],
      Tuesday: [
        {
          periodIndex: Number,
          classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
          subject: String,
          room: String,
          lastModified: { type: Date, default: Date.now },
        },
      ],
      Wednesday: [
        {
          periodIndex: Number,
          classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
          subject: String,
          room: String,
          lastModified: { type: Date, default: Date.now },
        },
      ],
      Thursday: [
        {
          periodIndex: Number,
          classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
          subject: String,
          room: String,
          lastModified: { type: Date, default: Date.now },
        },
      ],
      Friday: [
        {
          periodIndex: Number,
          classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
          subject: String,
          room: String,
          lastModified: { type: Date, default: Date.now },
        },
      ],
      Saturday: [
        {
          periodIndex: Number,
          classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
          subject: String,
          room: String,
          lastModified: { type: Date, default: Date.now },
        },
      ],
      Sunday: [
        {
          periodIndex: Number,
          classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
          subject: String,
          room: String,
          lastModified: { type: Date, default: Date.now },
        },
      ],
    },
    totalPeriodsPerWeek: { type: Number, default: 0 },
    version: { type: Number, default: 1 },
    lastSyncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

teacherTimetableSchema.index({ schoolId: 1, teacherId: 1, academicYear: 1 }, { unique: true });
teacherTimetableSchema.index({ schoolId: 1, academicYear: 1 });

export default mongoose.model('TeacherTimetable', teacherTimetableSchema);
