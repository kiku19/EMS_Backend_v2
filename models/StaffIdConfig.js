import mongoose from 'mongoose';

const staffIdConfigSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    prefix: { type: String, default: 'EMP' },
    separator: { type: String, default: '' },
    includeYear: { type: Boolean, default: false },
    startingNumber: { type: Number, default: 1 },
    digits: { type: Number, default: 3 },
    currentNumber: { type: Number, default: 0 },
  },
  { timestamps: true }
);

staffIdConfigSchema.index({ schoolId: 1 }, { unique: true });

export default mongoose.model('StaffIdConfig', staffIdConfigSchema);
