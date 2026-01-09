import mongoose from 'mongoose';

const permissionRequestSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Staff',
    required: true
  },
  userName: { type: String, required: true },
  userEmail: String,
  module: { 
    type: String, 
    required: true,
    enum: ['dashboard', 'staff', 'students', 'classes', 'attendance', 'timetable', 'fees', 'payroll', 'messaging', 'reports', 'settings', 'front-desk']
  },
  permissions: [{
    type: String,
    enum: ['view', 'create', 'edit', 'delete']
  }],
  reason: { type: String, required: true },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  requestedAt: { type: Date, default: Date.now },
  reviewedAt: Date,
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Staff'
  },
  reviewerName: String,
  reviewNotes: String
}, { timestamps: true });

const PermissionRequest = mongoose.model('PermissionRequest', permissionRequestSchema);

export default PermissionRequest;
