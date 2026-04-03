import mongoose from 'mongoose';

const trashItemSchema = new mongoose.Schema(
  {
    itemType: {
      type: String,
      required: true,
      index: true,
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
      index: true,
    },
    itemName: {
      type: String,
      required: true,
    },
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    restoreStrategy: {
      type: String,
      enum: ['soft-delete', 'hard-delete'],
      required: true,
    },
    modelName: {
      type: String,
      required: false, // null for BulkCleanup
    },
    softDeleteField: {
      type: String,
      default: 'isDeleted',
    },
    // For BulkCleanup items: stores the category key and model name
    bulkCleanup: {
      category: String,
      modelName: String,
      recordCount: Number,
      schoolId: mongoose.Schema.Types.ObjectId,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
    },
    deletedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    originalData: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    deletionContext: {
      classId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Class',
      },
      relatedItems: [
        {
          itemType: String,
          itemId: mongoose.Schema.Types.ObjectId,
          itemName: String,
        },
      ],
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient expired queries
trashItemSchema.index({ expiresAt: 1, itemType: 1 });

// Compound index for efficient listing queries (school-scoped)
trashItemSchema.index({ schoolId: 1, itemType: 1, deletedAt: -1 });

// Index for search by name
trashItemSchema.index({ itemName: 'text' });

// Virtual property to calculate days remaining until expiration
trashItemSchema.virtual('daysRemaining').get(function () {
  const now = new Date();
  const expiresAt = new Date(this.expiresAt);
  const diffMs = expiresAt - now;
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
});

// Static method to find expired items
trashItemSchema.statics.findExpired = function () {
  return this.find({
    expiresAt: { $lt: new Date() },
  }).sort({ expiresAt: 1 });
};

// Static method to find items by type
trashItemSchema.statics.findByType = function (itemType) {
  return this.find({ itemType }).sort({ deletedAt: -1 }).populate('deletedBy', 'name email');
};

export default mongoose.model('TrashItem', trashItemSchema);
