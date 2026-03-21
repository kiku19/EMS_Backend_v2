import mongoose from 'mongoose';

/**
 * ArchiveRecord — stores archived historical data for schools older than 3 years.
 *
 * DR-05: Schools created > 3 years ago accumulate large volumes of historical
 * operational data (attendance, results, fee payments). Archival moves documents
 * older than the configured threshold out of primary collections and into this
 * store, reducing query overhead on hot collections while preserving records for
 * audit/compliance purposes.
 */
const archiveRecordSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    // e.g. 'attendance', 'results', 'feePayments', 'feeRefunds', 'remarks'
    archiveType: {
      type: String,
      enum: ['attendance', 'results', 'feePayments', 'feeRefunds', 'remarks'],
      required: true,
      index: true,
    },
    // Inclusive date range of the archived records
    periodStart: {
      type: Date,
      required: true,
    },
    periodEnd: {
      type: Date,
      required: true,
    },
    recordCount: {
      type: Number,
      default: 0,
    },
    sizeBytes: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['completed', 'failed'],
      default: 'completed',
      index: true,
    },
    // Who or what triggered archival: 'system' for scheduled job, or a staff ObjectId
    triggeredBy: {
      type: String,
      default: 'system',
    },
    failReason: {
      type: String,
      default: null,
    },
    // The actual archived documents
    data: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

archiveRecordSchema.index({ schoolId: 1, archiveType: 1, createdAt: -1 });
archiveRecordSchema.index({ createdAt: 1 });

export default mongoose.models.ArchiveRecord ||
  mongoose.model('ArchiveRecord', archiveRecordSchema);
