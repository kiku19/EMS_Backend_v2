import mongoose from 'mongoose';

const rollNumberConfigSchema = new mongoose.Schema(
  {
    format: { type: String, enum: ['sequential', 'class-based'], default: 'sequential' },
    startingNumber: { type: Number, default: 1 },
    resetPerClass: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('RollNumberConfig', rollNumberConfigSchema);
