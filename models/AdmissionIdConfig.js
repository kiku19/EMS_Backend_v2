import mongoose from 'mongoose';

const admissionIdConfigSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    prefix: { type: String, default: 'ADM' },
    yearFormat: { type: String, enum: ['YYYY', 'YY', 'none'], default: 'YYYY' },
    separator: { type: String, enum: ['-', '/', '_', ''], default: '-' },
    numberPadding: { type: Number, default: 4 },
    startingNumber: { type: Number, default: 1 },
    currentNumber: { type: Number, default: 0 },
    resetFrequency: { type: String, enum: ['yearly', 'monthly', 'never'], default: 'yearly' },
    lastResetDate: Date,
  },
  { timestamps: true }
);

admissionIdConfigSchema.index({ schoolId: 1 }, { unique: true });

export default mongoose.model('AdmissionIdConfig', admissionIdConfigSchema);
