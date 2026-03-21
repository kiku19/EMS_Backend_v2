import mongoose from 'mongoose';

const consentRecordSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    entityType: {
      type: String,
      enum: ['Student', 'Parent', 'Staff'],
      required: true,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    consentType: {
      type: String,
      enum: [
        'data_collection',
        'marketing',
        'photo_usage',
        'data_sharing',
        'biometric',
        'parental_consent_for_under_13',
      ],
      required: true,
    },
    granted: {
      type: Boolean,
      required: true,
    },
    grantedAt: { type: Date },
    revokedAt: { type: Date },
    ipAddress: { type: String, maxlength: 45 },
    source: {
      type: String,
      enum: ['online_form', 'paper_form', 'verbal', 'admin_recorded'],
      default: 'admin_recorded',
    },
    notes: { type: String, maxlength: 500 },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
    },
  },
  {
    timestamps: true,
  }
);

// One consent record per entity+type (upserted on change)
consentRecordSchema.index(
  { schoolId: 1, entityType: 1, entityId: 1, consentType: 1 },
  { unique: true }
);
consentRecordSchema.index({ schoolId: 1, consentType: 1, granted: 1 });

export default mongoose.model('ConsentRecord', consentRecordSchema);
