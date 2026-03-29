import mongoose from 'mongoose';

const rollNumberConfigSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    format: { type: String, enum: ['sequential', 'class-based'], default: 'sequential' },
    startingNumber: { type: Number, default: 1 },
    resetPerClass: { type: Boolean, default: true },
  },
  { timestamps: true }
);

rollNumberConfigSchema.index({ schoolId: 1 }, { unique: true });

export default mongoose.model('RollNumberConfig', rollNumberConfigSchema);
