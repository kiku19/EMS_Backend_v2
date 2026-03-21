import mongoose from 'mongoose';

const admissionFormConfigSchema = new mongoose.Schema(
  {
    fieldName: { type: String, required: true },
    fieldType: { type: String, enum: ['student', 'staff'], default: 'student' },
    isVisible: { type: Boolean, default: true },
    isMandatory: { type: Boolean, default: false },
    autoGenerate: { type: Boolean, default: false },
    defaultValue: String,
    fieldOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model('AdmissionFormConfig', admissionFormConfigSchema);
