import mongoose from 'mongoose';

const procurementRequestSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    itemName: { type: String, required: true, trim: true, maxlength: 200 },
    category: {
      type: String,
      enum: [
        'FURNITURE',
        'ELECTRONICS',
        'LAB_EQUIPMENT',
        'SPORTS',
        'STATIONERY',
        'VEHICLE',
        'OTHER',
      ],
    },
    quantity: { type: Number, required: true, min: 1 },
    estimatedCost: { type: Number, min: 0 },
    actualCost: { type: Number, min: 0 },
    justification: { type: String, trim: true, maxlength: 1000 },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'PURCHASED'],
      default: 'PENDING',
    },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },
    notes: { type: String, trim: true, maxlength: 1000 },
    isDeleted: { type: Boolean, default: false, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  },
  { timestamps: true }
);

procurementRequestSchema.index({ schoolId: 1, status: 1 });

const ProcurementRequest = mongoose.model('ProcurementRequest', procurementRequestSchema);
export default ProcurementRequest;
