import mongoose from 'mongoose';

// Snapshot of a single student's state before promotion (for rollback)
const studentSnapshotSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    studentName: String,
    admissionId: String,
    rollNo: Number,
    fromClassId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
    fromAcademicYear: String,
    previousStatus: String, // student.status before promotion
    previousFeeStatus: String, // student.feeStatus before promotion
    decision: {
      type: String,
      enum: ['promoted', 'detained', 'transferred', 'graduated'],
      required: true,
    },
    toClassId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' }, // null for detained/transferred/graduated
    newRollNo: Number,
  },
  { _id: false }
);

const promotionRecordSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    toAcademicYear: { type: String, required: true }, // target academic year
    fromAcademicYear: { type: String, required: true }, // source academic year
    promotedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    promotedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['completed', 'rolledback'], default: 'completed' },
    rollbackAt: Date,
    rollbackBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    rollbackReason: String,
    studentSnapshots: [studentSnapshotSchema],
    summary: {
      totalStudents: { type: Number, default: 0 },
      promoted: { type: Number, default: 0 },
      detained: { type: Number, default: 0 },
      transferred: { type: Number, default: 0 },
      graduated: { type: Number, default: 0 },
      errors: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

promotionRecordSchema.index({ schoolId: 1, toAcademicYear: 1, createdAt: -1 });
promotionRecordSchema.index({ schoolId: 1, status: 1 });

export default mongoose.model('PromotionRecord', promotionRecordSchema);
