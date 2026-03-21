import mongoose from 'mongoose';

const bookIssueSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },

    bookId: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
    // Denormalized for display
    bookTitle: { type: String },
    bookIsbn: { type: String },

    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    // Denormalized for display
    studentName: { type: String },
    studentAdmissionNo: { type: String },

    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    issuedByName: { type: String },

    issueDate: { type: Date, required: true, default: Date.now },
    dueDate: { type: Date, required: true },
    returnDate: { type: Date },

    status: {
      type: String,
      enum: ['issued', 'returned', 'overdue', 'reserved', 'cancelled'],
      default: 'issued',
    },

    // Fine
    finePerDay: { type: Number, default: 0, min: 0 },
    fineAmount: { type: Number, default: 0, min: 0 },
    finePaid: { type: Boolean, default: false },
    finePaidDate: { type: Date },

    notes: { type: String, trim: true },

    // Copy tracking
    copyId: { type: mongoose.Schema.Types.ObjectId, ref: 'BookCopy' },
    copyNumber: { type: String },
    returnCondition: {
      type: String,
      enum: ['new', 'good', 'fair', 'worn', 'damaged', 'lost'],
    },
  },
  { timestamps: true }
);

bookIssueSchema.index({ schoolId: 1, status: 1 });
bookIssueSchema.index({ schoolId: 1, studentId: 1 });
bookIssueSchema.index({ schoolId: 1, bookId: 1 });
bookIssueSchema.index({ schoolId: 1, dueDate: 1, status: 1 });

export default mongoose.model('BookIssue', bookIssueSchema);
