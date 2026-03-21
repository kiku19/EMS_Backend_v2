import mongoose from 'mongoose';

const remarkSchema = new mongoose.Schema(
  {
    // Multi-tenancy
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },

    // Link to student
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },

    // Remark details
    title: { type: String, required: true },
    description: { type: String, required: true },
    category: {
      type: String,
      enum: ['academic', 'behavioral', 'achievement', 'attendance', 'health', 'general'],
      default: 'general',
    },

    // Author (staff member who created the remark)
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    authorName: { type: String }, // Denormalized for easy display

    // Communication status
    sentToParent: { type: Boolean, default: false },
    sentDate: { type: Date },

    // Timestamps
    date: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
remarkSchema.index({ schoolId: 1, studentId: 1, date: -1 });
remarkSchema.index({ authorId: 1, date: -1 });
remarkSchema.index({ category: 1 });

export default mongoose.model('Remark', remarkSchema);
