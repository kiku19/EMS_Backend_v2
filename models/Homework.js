import mongoose from 'mongoose';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

const homeworkSchema = new mongoose.Schema({
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  subject: { type: String, required: true },
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  // Optional: target a specific section string (e.g. 'A') within the class for section-level targeting
  sectionId: { type: String },
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true },
  academicYear: { type: String, default: CURRENT_ACADEMIC_YEAR },

  // Due date and time
  dueDate: { type: Date, required: true },

  // Attachments
  attachments: [
    {
      name: String,
      url: String,
      type: String, // image, pdf, document, etc.
    },
  ],

  // Status
  status: {
    type: String,
    enum: ['active', 'cancelled', 'completed'],
    default: 'active',
  },

  // Submission tracking
  submissions: [
    {
      studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
      submittedAt: Date,
      attachments: [
        {
          name: String,
          url: String,
        },
      ],
      remarks: String, // student's note on submission
      marks: Number,
      feedback: String, // teacher's feedback after grading
      gradedAt: Date, // when the grade was assigned
    },
  ],

  // For parents app visibility
  sentToParents: { type: Boolean, default: true },

  // Creation metadata
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Indexes for efficient queries
homeworkSchema.index({ schoolId: 1, classId: 1, status: 1, dueDate: -1 });
homeworkSchema.index({ schoolId: 1, teacherId: 1, createdAt: -1 });

export default mongoose.model('Homework', homeworkSchema);
