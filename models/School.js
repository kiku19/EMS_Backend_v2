import mongoose from 'mongoose';

const schoolSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  code: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    unique: true,
    index: true,
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active',
    index: true,
  },
  isDefault: {
    type: Boolean,
    default: false,
    index: true,
  },
  contactEmail: {
    type: String,
    trim: true,
    lowercase: true,
    default: null,
  },
  contactPhone: {
    type: String,
    trim: true,
    default: null,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, {
  timestamps: true,
});

schoolSchema.index({ createdAt: 1 });

export default mongoose.models.School || mongoose.model('School', schoolSchema);
