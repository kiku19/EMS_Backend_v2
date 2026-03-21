import mongoose from 'mongoose';

const documentConfigSchema = new mongoose.Schema(
  {
    documentName: { type: String, required: true },
    isRequired: { type: Boolean, default: false },
    uploadType: { type: String, enum: ['single', 'multiple', 'front-back'], default: 'single' },
    allowedFormats: [{ type: String }],
    maxFileSize: { type: Number, default: 5242880 }, // 5MB in bytes
    displayOrder: { type: Number, default: 0 },
    description: String,
  },
  { timestamps: true }
);

export default mongoose.model('DocumentConfig', documentConfigSchema);
