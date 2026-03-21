import mongoose from 'mongoose';

const changeSchema = new mongoose.Schema(
  {
    field: { type: String, required: true },
    oldValue: { type: mongoose.Schema.Types.Mixed },
    newValue: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

const FeatureFlagAuditLogSchema = new mongoose.Schema(
  {
    // Actor — the super admin (or service) that made the change
    actorId: { type: String, required: true },
    actorEmail: { type: String, default: null },

    // What happened
    action: {
      type: String,
      enum: ['created', 'updated', 'deleted', 'override_set', 'override_removed'],
      required: true,
    },

    // Which flag was affected
    flagKey: { type: String, required: true },

    // Field-level diff for 'updated' actions
    changes: { type: [changeSchema], default: undefined },

    // Extra context: e.g. { schoolId, enabled } for override actions
    metadata: { type: mongoose.Schema.Types.Mixed, default: undefined },
  },
  { timestamps: true }
);

// Append-only guard
const immutableError = () => {
  throw new Error('FeatureFlagAuditLog records are immutable and cannot be modified or deleted');
};
FeatureFlagAuditLogSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'],
  immutableError
);
FeatureFlagAuditLogSchema.pre(
  ['deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndRemove'],
  immutableError
);

FeatureFlagAuditLogSchema.index({ flagKey: 1, createdAt: -1 });
FeatureFlagAuditLogSchema.index({ actorId: 1, createdAt: -1 });
FeatureFlagAuditLogSchema.index({ createdAt: -1 });

export default mongoose.model('FeatureFlagAuditLog', FeatureFlagAuditLogSchema);
