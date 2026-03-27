import mongoose from 'mongoose';

const callLogSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    callerName: String,
    phoneNumber: String,
    dateTime: { type: String, required: true },
    purpose: String,
    intent: String,
    keyNotes: String,
    summary: String,
    title: String,
    transcription: String,
    recordingUrl: String,
    loggedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  },
  { timestamps: true }
);

export default mongoose.model('CallLog', callLogSchema);
