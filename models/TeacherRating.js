import mongoose from 'mongoose';

const teacherRatingSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Parent', required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 500, default: null },
  },
  { timestamps: true }
);

// One rating per parent-teacher-student combination
teacherRatingSchema.index(
  { schoolId: 1, teacherId: 1, parentId: 1, studentId: 1 },
  { unique: true }
);
teacherRatingSchema.index({ schoolId: 1, teacherId: 1 });

export default mongoose.model('TeacherRating', teacherRatingSchema);
