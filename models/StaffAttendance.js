import mongoose from 'mongoose';

const staffAttendanceSchema = new mongoose.Schema({
  staffId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Staff', 
    required: true 
  },
  date: { 
    type: String, 
    required: true 
  }, // Format: YYYY-MM-DD
  status: { 
    type: String, 
    enum: ['present', 'absent', 'leave', 'halfday', 'unmarked'],
    default: 'unmarked'
  },
  inTime: { 
    type: String, 
    default: '-' 
  },
  outTime: { 
    type: String, 
    default: '-' 
  },
  reason: { 
    type: String, 
    default: '' 
  },
  markedBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Staff' 
  },
}, { timestamps: true });

// Compound index to ensure one attendance record per staff per date
staffAttendanceSchema.index({ staffId: 1, date: 1 }, { unique: true });

export default mongoose.model('StaffAttendance', staffAttendanceSchema);
