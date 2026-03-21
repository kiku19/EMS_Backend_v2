import mongoose from 'mongoose';

/**
 * OBS-04: Business Metrics — User Day Activity
 *
 * One document per (schoolId, userId, date). Used to compute DAU/WAU/MAU accurately.
 * Documents expire automatically after 90 days via TTL index on recordedAt.
 */
const userDayActivitySchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    date: { type: String, required: true }, // "YYYY-MM-DD"
    client: {
      type: String,
      enum: ['web', 'mobile', 'api'],
      default: 'web',
    },
    recordedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

// Unique: one document per user per school per day
userDayActivitySchema.index({ schoolId: 1, userId: 1, date: 1 }, { unique: true });
// For date-range queries per school
userDayActivitySchema.index({ schoolId: 1, date: 1 });
// TTL: auto-expire after 90 days
userDayActivitySchema.index({ recordedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default mongoose.models.UserDayActivity ||
  mongoose.model('UserDayActivity', userDayActivitySchema);
