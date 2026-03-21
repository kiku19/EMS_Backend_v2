import mongoose from 'mongoose';

// Tracks which version of the Data Processing Agreement a school has accepted.
// One record per school per DPA version.
const dpaRecordSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    // Semantic version of the DPA template accepted (e.g. "1.0")
    version: {
      type: String,
      required: true,
      trim: true,
    },
    acceptedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
    },
    // Denormalised for audit trail — survives staff record deletion
    acceptedByName: {
      type: String,
      maxlength: 200,
    },
    acceptedByEmail: {
      type: String,
      maxlength: 254,
    },
    acceptedAt: {
      type: Date,
      required: true,
    },
    ipAddress: {
      type: String,
      maxlength: 45,
    },
    // Name of the legal entity / school that accepted
    legalEntityName: {
      type: String,
      maxlength: 300,
    },
  },
  {
    timestamps: true,
  }
);

// One acceptance record per school per version
dpaRecordSchema.index({ schoolId: 1, version: 1 }, { unique: true });

export default mongoose.model('DPARecord', dpaRecordSchema);
