import mongoose from 'mongoose';

const staffProfileAuditSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now, required: true },
  staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true },
  action: {
    type: String,
    enum: ['profile_update', 'photo_update'],
    required: true
  },
  fieldsChanged: [String],
  previousValues: mongoose.Schema.Types.Mixed,
  newValues: mongoose.Schema.Types.Mixed,
  source: {
    type: String,
    enum: ['mobile_app', 'web_dashboard'],
    required: true
  },
  ipAddress: String,
  userAgent: String
}, {
  timestamps: true
});

// Indexes for efficient querying
staffProfileAuditSchema.index({ staffId: 1, timestamp: -1 });
staffProfileAuditSchema.index({ timestamp: -1 });
staffProfileAuditSchema.index({ action: 1 });

export default mongoose.model('StaffProfileAudit', staffProfileAuditSchema);
