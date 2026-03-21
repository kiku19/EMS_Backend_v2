import mongoose from 'mongoose';

const SchoolOverrideSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    enabled: { type: Boolean, required: true },
  },
  { _id: false }
);

const FeatureFlagSchema = new mongoose.Schema(
  {
    // Unique identifier, camelCase (e.g., 'advancedReports')
    key: {
      type: String,
      required: true,
      trim: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },

    // 'enabled'  — all qualifying schools have access
    // 'disabled' — nobody has access regardless of plan
    // 'rollout'  — hash-based percentage rollout
    status: {
      type: String,
      enum: ['enabled', 'disabled', 'rollout'],
      default: 'disabled',
    },

    // Minimum plan required to access this feature
    minimumPlan: {
      type: String,
      enum: ['starter', 'growth', 'scale'],
      default: 'starter',
    },

    // Used when status === 'rollout': 0–100 percentage of schools that get the feature
    rolloutPercentage: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },

    // Optional time window — feature only available within this range
    availableFrom: { type: Date, default: null },
    availableUntil: { type: Date, default: null },

    // Per-school overrides (highest priority — bypasses all other checks)
    overrideSchools: [SchoolOverrideSchema],

    tags: [{ type: String, trim: true }],
  },
  { timestamps: true }
);

FeatureFlagSchema.index({ key: 1 }, { unique: true });

export default mongoose.model('FeatureFlag', FeatureFlagSchema);
