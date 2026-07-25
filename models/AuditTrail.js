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
    // schoolId is optional so platform-scope super-admin actions (which have no
    // owning school) can be recorded. School-user entries always carry schoolId.
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null, index: true },
    // userId is optional because super-admin is a single env-var account whose
    // id ('super-admin') is not an ObjectId. School-user entries always carry it.
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', default: null },
    // Distinguishes who performed the action. Drives the cross-school activity
    // feed (super-admin queries) without polluting school-scoped audit views.
    actorType: {
      type: String,
      enum: ['school-user', 'super-admin'],
      default: 'school-user',
      index: true,
    },
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
        'login_2fa_required',
        'login_blocked_sso_only',
        'password_changed',
        'password_reset',
        'permission_changed',
        'settings_changed',
        'role_changed',
        'email.verified',
        'signup',
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
// Platform-wide activity feed (super-admin console). Partial filter on null
// schoolId so it stays small and doesn't slow school-scoped queries above.
auditTrailSchema.index(
  { actorType: 1, createdAt: -1 },
  { partialFilterExpression: { schoolId: null } }
);

export default mongoose.model('AuditTrail', auditTrailSchema);
