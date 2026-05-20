import mongoose from 'mongoose';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

const examScheduleSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    name: { type: String, required: true }, // e.g., "Mid-Term Examination March 2026"
    type: { type: String }, // unit_test, quiz, midterm, final
    academicYear: { type: String, default: CURRENT_ACADEMIC_YEAR },
    classIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    sessionType: { type: String, enum: ['morning', 'afternoon', 'both'], default: 'morning' },
    morningSlot: {
      startTime: { type: String, default: '09:00' },
      endTime: { type: String, default: '12:00' },
    },
    afternoonSlot: {
      startTime: { type: String, default: '14:00' },
      endTime: { type: String, default: '17:00' },
    },
    defaultMaxMarks: { type: Number, default: 100 },
    defaultPassingMarks: { type: Number, default: 35 },
    entries: [
      {
        date: { type: Date, required: true },
        session: { type: String, enum: ['morning', 'afternoon'], required: true },
        subjectName: { type: String, required: true },
        classIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
        maxMarks: { type: Number, default: 100 },
        passingMarks: { type: Number, default: 35 },
      },
    ],
    generatedExamIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Exam' }],
    status: { type: String, enum: ['draft', 'scheduled', 'sent'], default: 'draft' },
    sentAt: { type: Date },
    sentToParents: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
  },
  { timestamps: true }
);

examScheduleSchema.index({ schoolId: 1, academicYear: 1 });
examScheduleSchema.index(
  { schoolId: 1, name: 1, academicYear: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

export default mongoose.model('ExamSchedule', examScheduleSchema);
