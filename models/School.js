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
  plan: {
    type: String,
    enum: ['starter', 'growth', 'enterprise'],
    default: 'starter',
    index: true,
  },
  planStatus: {
    type: String,
    enum: ['trialing', 'active', 'past_due', 'cancelled'],
    default: 'trialing',
    index: true,
  },
  trialEndsAt: {
    type: Date,
    default: null,
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
  frontendUrl: {
    type: String,
    trim: true,
    default: null,
  },
  backendUrl: {
    type: String,
    trim: true,
    default: null,
  },
  billingContactName: {
    type: String,
    trim: true,
    default: null,
  },
  billingEmail: {
    type: String,
    trim: true,
    lowercase: true,
    default: null,
  },
  billingPhone: {
    type: String,
    trim: true,
    default: null,
  },
  provisioning: {
    status: {
      type: String,
      enum: ['pending', 'ready', 'error'],
      default: 'pending',
    },
    lastProvisionedAt: {
      type: Date,
      default: null,
    },
    lastProvisionedBy: {
      type: String,
      default: null,
    },
    notes: {
      type: String,
      default: null,
    },
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
