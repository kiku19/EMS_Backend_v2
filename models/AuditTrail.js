import mongoose from 'mongoose';

// Sub-schema for field-level change entries (computed diff between oldValue and newValue)
const changeEntrySchema = new mongoose.Schema(
  {
    field: { type: String, required: true },
    oldValue: { type: mongoose.Schema.Types.Mixed },
    newValue: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

const auditTrailSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true },
    userName: { type: String }, // denormalized for fast display without populate
    action: {
      type: String,
      enum: [
        'created',
        'updated',
        'deleted',
        'login',
        'logout',
        'login_failed',
        'password_changed',
        'permission_changed',
        'settings_changed',
        'role_changed',
      ],
      required: true,
    },
    entity: { type: String, required: true }, // e.g. 'student', 'staff', 'class', 'fee', 'auth'
    entityId: { type: String }, // stringified ObjectId to handle various ID types
    method: { type: String }, // HTTP method (POST, PUT, PATCH, DELETE)
    path: { type: String }, // URL path
    changes: { type: [changeEntrySchema], default: undefined }, // field-level diffs for updates
    oldValue: { type: mongoose.Schema.Types.Mixed },
    newValue: { type: mongoose.Schema.Types.Mixed },
    ipAddress: { type: String },
    userAgent: { type: String },
  },
  {
    timestamps: true,
  }
);

// Enforce append-only: block all update/delete operations at the Mongoose middleware level
const immutableError = () => {
  throw new Error('AuditTrail records are immutable and cannot be modified or deleted');
};
auditTrailSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'], immutableError);
auditTrailSchema.pre(
  ['deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndRemove'],
  immutableError
);

auditTrailSchema.index({ schoolId: 1, createdAt: -1 });
auditTrailSchema.index({ schoolId: 1, entity: 1, createdAt: -1 });
auditTrailSchema.index({ schoolId: 1, userId: 1, createdAt: -1 });
auditTrailSchema.index({ schoolId: 1, action: 1, createdAt: -1 });

export default mongoose.model('AuditTrail', auditTrailSchema);
