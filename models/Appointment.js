import mongoose from 'mongoose';

const appointmentSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School' },
    visitorName: { type: String, required: true },
    phoneNumber: String,
    purpose: String,
    fromDateTime: { type: Date, required: true },
    toDateTime: { type: Date, required: true },
    meetingWith: String,
    notes: String,
    status: { type: String, default: 'scheduled' }, // 'scheduled', 'completed', 'cancelled'
  },
  { timestamps: true }
);

appointmentSchema.index({ schoolId: 1, fromDateTime: 1 });

export default mongoose.model('Appointment', appointmentSchema);
