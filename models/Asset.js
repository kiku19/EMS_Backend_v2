import mongoose from 'mongoose';

const assetSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    assetTag: { type: String, trim: true, maxlength: 50 },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    category: {
      type: String,
      required: true,
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
    serialNumber: { type: String, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 1000 },
    location: { type: String, trim: true, maxlength: 200 },
    assignedTo: { type: String, trim: true, maxlength: 200 },
    quantity: { type: Number, required: true, min: 0, default: 1 },
    minimumQuantity: { type: Number, min: 0, default: 0 },
    purchaseDate: { type: Date },
    purchasePrice: { type: Number, min: 0 },
    currentValue: { type: Number, min: 0 },
    depreciationRate: { type: Number, min: 0, max: 100, default: 0 },
    warrantyExpiry: { type: Date },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },
    condition: {
      type: String,
      enum: ['GOOD', 'FAIR', 'POOR', 'DAMAGED'],
      default: 'GOOD',
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'UNDER_MAINTENANCE', 'DISPOSED', 'LOST'],
      default: 'ACTIVE',
    },
    notes: { type: String, trim: true, maxlength: 1000 },
    isDeleted: { type: Boolean, default: false, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  },
  { timestamps: true }
);

assetSchema.index({ schoolId: 1, assetTag: 1 }, { unique: true, sparse: true });
assetSchema.index({ schoolId: 1, category: 1 });
assetSchema.index({ schoolId: 1, status: 1 });

const Asset = mongoose.model('Asset', assetSchema);
export default Asset;
