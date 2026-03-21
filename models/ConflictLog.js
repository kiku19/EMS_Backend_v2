import mongoose from 'mongoose';

const conflictLogSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School' },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true },
    conflictType: {
      type: String,
      enum: ['double_booking', 'unqualified', 'invalid_assignment'],
      required: true,
    },
    day: { type: String, required: true },
    periodIndex: { type: Number, required: true },
    classes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
    subject: String,
    detectedAt: { type: Date, default: Date.now },
    resolvedAt: Date,
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    resolution: String,
    status: {
      type: String,
      enum: ['active', 'resolved', 'ignored'],
      default: 'active',
    },
  },
  { timestamps: true }
);

conflictLogSchema.index({ schoolId: 1, teacherId: 1, status: 1 });
conflictLogSchema.index({ detectedAt: -1 });

export default mongoose.model('ConflictLog', conflictLogSchema);
