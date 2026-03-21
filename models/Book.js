import mongoose from 'mongoose';

const bookSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },

    // Identification
    title: { type: String, required: true, trim: true },
    author: { type: String, required: true, trim: true },
    isbn: { type: String, trim: true },
    publisher: { type: String, trim: true },
    publishedYear: { type: Number },
    edition: { type: String, trim: true },

    // Catalog
    category: {
      type: String,
      enum: ['textbook', 'reference', 'fiction', 'non-fiction', 'periodical', 'digital', 'other'],
      default: 'other',
    },
    subject: { type: String, trim: true },
    language: { type: String, default: 'English', trim: true },
    description: { type: String, trim: true },

    // Stock
    totalCopies: { type: Number, required: true, min: 1, default: 1 },
    availableCopies: { type: Number, default: 1, min: 0 },
    reservedCopies: { type: Number, default: 0, min: 0 },

    // Location
    rackNumber: { type: String, trim: true },
    shelfNumber: { type: String, trim: true },

    // Digital resource
    digitalUrl: { type: String, trim: true },

    // Fine settings (per day in currency units)
    finePerDay: { type: Number, default: 0, min: 0 },

    // Cover image
    coverImageUrl: { type: String, trim: true },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

bookSchema.index({ schoolId: 1, isActive: 1 });
bookSchema.index({ schoolId: 1, isbn: 1 });
bookSchema.index({ schoolId: 1, category: 1 });
bookSchema.index({ schoolId: 1, title: 'text', author: 'text' });

export default mongoose.model('Book', bookSchema);
