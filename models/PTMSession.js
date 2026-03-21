import mongoose from 'mongoose';

const ptmSlotSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    parentName: { type: String, required: true },
    parentPhone: { type: String },
    scheduledTime: { type: String, required: true }, // HH:MM format
    status: {
      type: String,
      enum: ['booked', 'completed', 'cancelled', 'no-show'],
      default: 'booked',
    },
    notes: { type: String, default: '' },
  },
  { _id: true }
);

const ptmSessionSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    sessionDate: { type: Date, required: true },
    startTime: { type: String, required: true }, // HH:MM format
    endTime: { type: String, required: true }, // HH:MM format
    slotDuration: { type: Number, default: 15 }, // minutes
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true },
    venue: { type: String, default: '' },
    status: {
      type: String,
      enum: ['scheduled', 'ongoing', 'completed', 'cancelled'],
      default: 'scheduled',
    },
    slots: [ptmSlotSchema],
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

ptmSessionSchema.index({ schoolId: 1, sessionDate: 1 });
ptmSessionSchema.index({ schoolId: 1, classId: 1 });
ptmSessionSchema.index({ schoolId: 1, staffId: 1 });

export default mongoose.model('PTMSession', ptmSessionSchema);
