import mongoose from 'mongoose';

// Default retention periods in months per entity type
export const DEFAULT_RETENTION_MONTHS = {
  students: 84, // 7 years (statutory requirement in most jurisdictions)
  staff: 84, // 7 years
  attendance: 36, // 3 years
  academics: 60, // 5 years (transcripts, results)
  fees: 84, // 7 years (financial records, statutory)
  payroll: 84, // 7 years (statutory)
  messaging: 12, // 1 year
  frontDesk: 12, // 1 year
  auditLogs: 12, // 1 year
  trashedItems: 1, // 30 days (expressed as months, rounded to 1)
};

export const ENTITY_TYPES = Object.keys(DEFAULT_RETENTION_MONTHS);

const retentionPolicySchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    entityType: {
      type: String,
      enum: ENTITY_TYPES,
      required: true,
    },
    retentionMonths: {
      type: Number,
      required: true,
      min: 1,
      max: 120, // max 10 years
    },
    description: { type: String, maxlength: 500 },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
    },
  },
  {
    timestamps: true,
  }
);

// One policy per entity type per school
retentionPolicySchema.index({ schoolId: 1, entityType: 1 }, { unique: true });

export default mongoose.model('RetentionPolicy', retentionPolicySchema);
