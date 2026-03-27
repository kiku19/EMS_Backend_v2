import mongoose from 'mongoose';

const admissionFormConfigSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
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

// Each field name must be unique per school + fieldType combination
admissionFormConfigSchema.index({ schoolId: 1, fieldName: 1, fieldType: 1 }, { unique: true });
admissionFormConfigSchema.index({ schoolId: 1, fieldType: 1, fieldOrder: 1 });

export default mongoose.model('AdmissionFormConfig', admissionFormConfigSchema);
