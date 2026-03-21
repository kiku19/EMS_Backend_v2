import mongoose from 'mongoose';

const maintenanceLogSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    assetId: { type: mongoose.Schema.Types.ObjectId, ref: 'Asset', required: true, index: true },
    maintenanceType: {
      type: String,
      required: true,
      enum: ['PREVENTIVE', 'CORRECTIVE', 'INSPECTION'],
    },
    description: { type: String, required: true, trim: true, maxlength: 1000 },
    scheduledDate: { type: Date, required: true },
    completedDate: { type: Date },
    cost: { type: Number, min: 0 },
    status: {
      type: String,
      enum: ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
      default: 'SCHEDULED',
    },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },
    performedBy: { type: String, trim: true, maxlength: 200 },
    notes: { type: String, trim: true, maxlength: 1000 },
    isDeleted: { type: Boolean, default: false, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  },
  { timestamps: true }
);

maintenanceLogSchema.index({ schoolId: 1, status: 1 });
maintenanceLogSchema.index({ schoolId: 1, scheduledDate: -1 });

const MaintenanceLog = mongoose.model('MaintenanceLog', maintenanceLogSchema);
export default MaintenanceLog;
