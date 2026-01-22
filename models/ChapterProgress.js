import mongoose from 'mongoose';

const chapterProgressSchema = new mongoose.Schema({
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
  subjectName: { type: String, required: true },
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true },
  academicYear: { type: String, default: '2024-25' },

  // Chapter tracking
  chapters: [{
    chapterName: { type: String, required: true },
    chapterNumber: { type: Number, required: true },
    status: {
      type: String,
      enum: ['not_started', 'in_progress', 'completed'],
      default: 'not_started'
    },
    progressPercentage: { type: Number, min: 0, max: 100, default: 0 },
    startDate: Date,
    completedDate: Date,
    topics: [String] // List of topics in the chapter
  }],

  // Overall subject progress
  overallProgress: { type: Number, min: 0, max: 100, default: 0 },

  // Upcoming chapters
  upcomingChapters: [String],

  // Assigned students (empty means all students in class)
  assignedStudents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }]
}, {
  timestamps: true
});

// Indexes
chapterProgressSchema.index({ classId: 1, subjectName: 1, academicYear: 1 }, { unique: true });
chapterProgressSchema.index({ teacherId: 1 });

// Method to calculate overall progress
chapterProgressSchema.methods.calculateOverallProgress = function() {
  if (this.chapters.length === 0) {
    this.overallProgress = 0;
    return 0;
  }

  const totalProgress = this.chapters.reduce((sum, chapter) => sum + chapter.progressPercentage, 0);
  this.overallProgress = Math.round(totalProgress / this.chapters.length);
  return this.overallProgress;
};

export default mongoose.model('ChapterProgress', chapterProgressSchema);
