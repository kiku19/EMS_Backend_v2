import mongoose from 'mongoose';

const formSubmissionSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School' },
    assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'FormAssignment', required: true },
    formId: { type: mongoose.Schema.Types.ObjectId, ref: 'IntakeForm', required: true },
    submissionData: mongoose.Schema.Types.Mixed, // All form field responses
    submittedByEmail: String,
    submittedByPhone: String,
    submittedAt: { type: Date, default: Date.now },

    // Review workflow fields
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    reviewedAt: Date,
    reviewStatus: {
      type: String,
      default: 'pending',
      enum: ['pending', 'approved', 'rejected', 'needs_revision'],
    },
    reviewNotes: String,

    // Entity linking (populated after approval)
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
    convertedAt: Date, // Timestamp when submission was converted to student/staff record

    // Edit request workflow fields
    editRequestNotes: String,
    editRequestedAt: Date,
    editRequestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    resubmissionCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

formSubmissionSchema.index({ schoolId: 1, reviewStatus: 1, submittedAt: -1 });
formSubmissionSchema.index({ assignmentId: 1 });
formSubmissionSchema.index({ formId: 1 });
formSubmissionSchema.index({ submittedByEmail: 1 });
formSubmissionSchema.index({ reviewStatus: 1 });
formSubmissionSchema.index({ studentId: 1 });
formSubmissionSchema.index({ staffId: 1 });
formSubmissionSchema.index({ submittedAt: -1 });

export default mongoose.model('FormSubmission', formSubmissionSchema);
