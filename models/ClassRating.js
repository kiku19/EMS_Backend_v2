import mongoose from 'mongoose';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

const classRatingSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School' },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    academicYear: { type: String, default: CURRENT_ACADEMIC_YEAR },

    // Overall rating (1-5 stars)
    rating: { type: Number, min: 1, max: 5, default: 3 },

    // Component scores (0-100)
    attendanceScore: { type: Number, min: 0, max: 100, default: 70 },
    academicScore: { type: Number, min: 0, max: 100, default: 70 },
    behaviorScore: { type: Number, min: 0, max: 100, default: 70 },
    feeScore: { type: Number, min: 0, max: 100, default: 70 },

    // Rating history
    ratingHistory: [
      {
        date: { type: Date, default: Date.now },
        rating: Number,
        attendanceScore: Number,
        academicScore: Number,
        behaviorScore: Number,
        feeScore: Number,
      },
    ],

    // Metadata
    lastCalculated: { type: Date, default: Date.now },
    calculatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
classRatingSchema.index({ schoolId: 1, classId: 1, academicYear: 1 }, { unique: true });
classRatingSchema.index({ rating: -1 });

// Method to calculate overall rating from component scores
classRatingSchema.methods.calculateOverallRating = function () {
  // Weightage: Attendance 30%, Academic 40%, Behavior 20%, Fees 10%
  const weightedScore =
    this.attendanceScore * 0.3 +
    this.academicScore * 0.4 +
    this.behaviorScore * 0.2 +
    this.feeScore * 0.1;

  // Convert to 1-5 scale
  this.rating = Math.max(1, Math.min(5, (weightedScore / 100) * 5));
  return this.rating;
};

export default mongoose.model('ClassRating', classRatingSchema);
