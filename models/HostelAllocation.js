import mongoose from 'mongoose';

const hostelAllocationSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    hostelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hostel', required: true },
    roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'HostelRoom', required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },

    // Denormalized for display without populate
    studentName: { type: String, trim: true },
    admissionNo: { type: String, trim: true },
    roomNumber: { type: String, trim: true },
    hostelName: { type: String, trim: true },

    bedNumber: { type: String, trim: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date },

    status: {
      type: String,
      enum: ['active', 'vacated', 'transferred'],
      default: 'active',
    },

    monthlyFee: { type: Number, default: 0, min: 0 },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

hostelAllocationSchema.index({ schoolId: 1, status: 1 });
hostelAllocationSchema.index({ schoolId: 1, studentId: 1 });
hostelAllocationSchema.index({ schoolId: 1, roomId: 1, status: 1 });

export default mongoose.model('HostelAllocation', hostelAllocationSchema);
