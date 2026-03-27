import mongoose from 'mongoose';

const documentItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'received', 'verified', 'rejected'],
      default: 'pending',
    },
    notes: String,
    receivedDate: String,
  },
  { _id: false }
);

const admissionSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    studentName: { type: String, required: true },
    dateOfBirth: String,
    parentName: String,
    phoneNumber: String,
    email: String,
    classApplyingFor: String,
    assessmentRequired: { type: Boolean, default: false },
    assignedTeacher: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    testDate: String,
    testTime: String,
    testResult: String, // 'cleared', 'failed', 'pending'
    dateOfInquiry: { type: String, default: () => new Date().toISOString().split('T')[0] },
    source: String, // 'walk-in', 'call', 'website', 'reference'
    status: { type: String, default: 'inquiry-logged' },
    admissionDecision: String, // 'approved', 'rejected', 'pending'
    decisionRemarks: String,
    decisionBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    documents: { type: [documentItemSchema], default: [] },
  },
  { timestamps: true }
);

admissionSchema.index({ schoolId: 1, status: 1, createdAt: -1 });

export default mongoose.model('Admission', admissionSchema);
