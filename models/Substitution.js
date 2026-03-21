import mongoose from 'mongoose';

const substitutionSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School' },
    date: { type: String, required: true }, // YYYY-MM-DD format
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    period: { type: String, required: true }, // Period number (1-8)
    absentTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    substituteTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true },
    reason: String,
    type: { type: String, enum: ['auto', 'manual'], default: 'manual' },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'completed', 'declined'],
      default: 'confirmed',
    },
    teacherResponse: {
      type: String,
      enum: ['pending', 'accepted', 'declined'],
      default: 'pending',
    },
    notes: String,
  },
  { timestamps: true }
);

substitutionSchema.index({ schoolId: 1, date: 1, classId: 1, period: 1 });

export default mongoose.model('Substitution', substitutionSchema);
