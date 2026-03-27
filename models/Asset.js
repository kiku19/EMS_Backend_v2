import mongoose from 'mongoose';

const assetSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    assetTag: { type: String, trim: true, maxlength: 50 },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    category: { type: String, required: true, trim: true, maxlength: 100 },
    serialNumber: { type: String, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 1000 },
    location: { type: String, trim: true, maxlength: 200 },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    assignedToName: { type: String, trim: true, maxlength: 200 },
    quantity: { type: Number, required: true, min: 0, default: 1 },
    minimumQuantity: { type: Number, min: 0, default: 0 },
    purchaseDate: { type: Date },
    purchasePrice: { type: Number, min: 0 },
    currentValue: { type: Number, min: 0 },
    depreciationRate: { type: Number, min: 0, max: 100, default: 0 },
    depreciationMethod: {
      type: String,
      enum: ['STRAIGHT_LINE', 'DECLINING_BALANCE'],
      default: 'DECLINING_BALANCE',
    },
    usefulLifeYears: { type: Number, min: 0 },
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

/**
 * Calculate depreciated current value based on purchase price, date, rate, and method.
 * Supports STRAIGHT_LINE and DECLINING_BALANCE depreciation methods.
 */
assetSchema.statics.calculateDepreciatedValue = function (asset) {
  if (!asset.purchasePrice || !asset.purchaseDate || !asset.depreciationRate) {
    return asset.purchasePrice || 0;
  }

  const rate = asset.depreciationRate;
  const purchaseDate = new Date(asset.purchaseDate);
  const now = new Date();
  const yearsElapsed = (now - purchaseDate) / (1000 * 60 * 60 * 24 * 365.25);

  if (yearsElapsed <= 0) return asset.purchasePrice;

  let currentValue;
  if (asset.depreciationMethod === 'STRAIGHT_LINE') {
    // Straight-line: equal depreciation each year
    const usefulLife = asset.usefulLifeYears || 100 / rate;
    const annualDepreciation = asset.purchasePrice / usefulLife;
    currentValue = asset.purchasePrice - annualDepreciation * yearsElapsed;
  } else {
    // Declining balance (default): compound reduction
    currentValue = asset.purchasePrice * Math.pow(1 - rate / 100, yearsElapsed);
  }

  return Math.max(0, Math.round(currentValue * 100) / 100);
};

/**
 * Pre-save hook: auto-compute currentValue from depreciation whenever
 * purchasePrice, purchaseDate, or depreciationRate are present.
 */
assetSchema.pre('save', function (next) {
  if (this.purchasePrice && this.purchaseDate && this.depreciationRate) {
    this.currentValue = this.constructor.calculateDepreciatedValue(this);
  }
  next();
});

/**
 * Pre-findOneAndUpdate hook: recalculate currentValue when depreciation
 * inputs change via findOneAndUpdate.
 */
assetSchema.pre('findOneAndUpdate', async function (next) {
  const update = this.getUpdate();
  const setFields = update.$set || update;

  // Only recalculate if depreciation-relevant fields are being changed
  const depFields = [
    'purchasePrice',
    'purchaseDate',
    'depreciationRate',
    'depreciationMethod',
    'usefulLifeYears',
  ];
  const hasDepChange = depFields.some((f) => setFields[f] !== undefined);

  if (hasDepChange) {
    // Fetch the current document to merge with updates
    const docToUpdate = await this.model.findOne(this.getQuery()).lean();
    if (docToUpdate) {
      const merged = { ...docToUpdate, ...setFields };
      if (merged.purchasePrice && merged.purchaseDate && merged.depreciationRate) {
        const newValue = this.model.calculateDepreciatedValue(merged);
        if (update.$set) {
          update.$set.currentValue = newValue;
        } else {
          update.currentValue = newValue;
        }
      }
    }
  }
  next();
});

const Asset = mongoose.model('Asset', assetSchema);
export default Asset;
