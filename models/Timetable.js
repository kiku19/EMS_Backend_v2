import mongoose from 'mongoose';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

const timetableSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    academicYear: { type: String, default: CURRENT_ACADEMIC_YEAR },
    periods: [
      {
        name: String,
        startTime: String,
        endTime: String,
        isBreak: { type: Boolean, default: false },
      },
    ],
    schedule: {
      Monday: [
        {
          subject: String,
          teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
          room: String,
          lastModified: { type: Date, default: Date.now },
          modifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
        },
      ],
      Tuesday: [
        {
          subject: String,
          teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
          room: String,
          lastModified: { type: Date, default: Date.now },
          modifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
        },
      ],
      Wednesday: [
        {
          subject: String,
          teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
          room: String,
          lastModified: { type: Date, default: Date.now },
          modifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
        },
      ],
      Thursday: [
        {
          subject: String,
          teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
          room: String,
          lastModified: { type: Date, default: Date.now },
          modifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
        },
      ],
      Friday: [
        {
          subject: String,
          teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
          room: String,
          lastModified: { type: Date, default: Date.now },
          modifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
        },
      ],
      Saturday: [
        {
          subject: String,
          teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
          room: String,
          lastModified: { type: Date, default: Date.now },
          modifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
        },
      ],
    },
    version: { type: Number, default: 1 },
    lastSyncedAt: { type: Date, default: Date.now },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
  },
  { timestamps: true }
);

timetableSchema.index({ schoolId: 1, classId: 1, academicYear: 1 }, { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } });
timetableSchema.index({ 'schedule.Monday.teacherId': 1 });
timetableSchema.index({ 'schedule.Tuesday.teacherId': 1 });
timetableSchema.index({ 'schedule.Wednesday.teacherId': 1 });
timetableSchema.index({ 'schedule.Thursday.teacherId': 1 });
timetableSchema.index({ 'schedule.Friday.teacherId': 1 });
timetableSchema.index({ 'schedule.Saturday.teacherId': 1 });

export default mongoose.model('Timetable', timetableSchema);
