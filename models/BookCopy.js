import mongoose from 'mongoose';

const bookCopySchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    bookId: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },

    copyNumber: { type: String, required: true, trim: true },
    barcode: { type: String, trim: true },

    condition: {
      type: String,
      enum: ['new', 'good', 'fair', 'worn', 'damaged', 'lost'],
      default: 'good',
    },

    status: {
      type: String,
      enum: ['available', 'issued', 'reserved', 'decommissioned'],
      default: 'available',
    },

    notes: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

bookCopySchema.index({ schoolId: 1, bookId: 1 });
bookCopySchema.index({ schoolId: 1, bookId: 1, copyNumber: 1 }, { unique: true });
bookCopySchema.index({ schoolId: 1, status: 1 });

export default mongoose.model('BookCopy', bookCopySchema);
