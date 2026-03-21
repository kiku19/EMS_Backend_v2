import mongoose from 'mongoose';

const auditItemSchema = new mongoose.Schema(
  {
    assetId: { type: mongoose.Schema.Types.ObjectId, ref: 'Asset', required: true },
    expectedQuantity: { type: Number, min: 0 },
    actualQuantity: { type: Number, min: 0 },
    condition: { type: String, enum: ['GOOD', 'FAIR', 'POOR', 'DAMAGED'] },
    notes: { type: String, trim: true, maxlength: 500 },
    verifiedBy: { type: String, trim: true, maxlength: 200 },
  },
  { _id: false }
);

const assetAuditSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    status: {
      type: String,
      enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED'],
      default: 'PENDING',
    },
    startDate: { type: Date },
    completedDate: { type: Date },
    auditItems: [auditItemSchema],
    notes: { type: String, trim: true, maxlength: 1000 },
    isDeleted: { type: Boolean, default: false, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  },
  { timestamps: true }
);

assetAuditSchema.index({ schoolId: 1, status: 1 });
assetAuditSchema.index({ schoolId: 1, createdAt: -1 });

const AssetAudit = mongoose.model('AssetAudit', assetAuditSchema);
export default AssetAudit;
