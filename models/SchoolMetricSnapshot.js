import mongoose from 'mongoose';

/**
 * OBS-04: Business Metrics — Daily School Metric Snapshot
 *
 * One document per (schoolId, date). Holds daily aggregated feature usage,
 * API call counts, and client-type breakdowns for the business metrics dashboard.
 * Counters are incremented atomically via $inc + upsert.
 * Documents expire automatically after 90 days.
 */
const schoolMetricSnapshotSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    date: { type: String, required: true }, // "YYYY-MM-DD"
    apiCalls: { type: Number, default: 0 },
    features: {
      students: { type: Number, default: 0 },
      classes: { type: Number, default: 0 },
      attendance: { type: Number, default: 0 },
      exams: { type: Number, default: 0 },
      fees: { type: Number, default: 0 },
      staff: { type: Number, default: 0 },
      messaging: { type: Number, default: 0 },
      timetable: { type: Number, default: 0 },
      homework: { type: Number, default: 0 },
      library: { type: Number, default: 0 },
      transport: { type: Number, default: 0 },
      frontDesk: { type: Number, default: 0 },
      payroll: { type: Number, default: 0 },
      parentApp: { type: Number, default: 0 },
      staffApp: { type: Number, default: 0 },
      other: { type: Number, default: 0 },
    },
    clients: {
      web: { type: Number, default: 0 },
      mobile: { type: Number, default: 0 },
      api: { type: Number, default: 0 },
    },
    recordedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

// Unique: one snapshot per school per day
schoolMetricSnapshotSchema.index({ schoolId: 1, date: 1 }, { unique: true });
// For date-range aggregations across all schools
schoolMetricSnapshotSchema.index({ date: 1 });
// TTL: auto-expire after 90 days
schoolMetricSnapshotSchema.index({ recordedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default mongoose.models.SchoolMetricSnapshot ||
  mongoose.model('SchoolMetricSnapshot', schoolMetricSnapshotSchema);
