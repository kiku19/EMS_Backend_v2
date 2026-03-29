import mongoose from 'mongoose';

const assetCategorySchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 500 },
    isDeleted: { type: Boolean, default: false, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  },
  { timestamps: true }
);

assetCategorySchema.index(
  { schoolId: 1, name: 1 },
  { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } }
);

const AssetCategory = mongoose.model('AssetCategory', assetCategorySchema);
export default AssetCategory;
