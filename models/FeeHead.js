import mongoose from 'mongoose';

// Fee Head Schema - defines individual fee components (reusable across academic years)
const feeHeadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    category: {
      type: String,
      enum: ['Academic', 'Transport', 'Extra-curricular', 'Hostel', 'Other'],
      default: 'Academic',
    },

    // Enhanced head type classification
    headType: {
      type: String,
      enum: [
        'tuition',
        'learning',
        'miscellaneous',
        'study_materials',
        'exam_development',
        'admission',
        'transport',
        'lab',
        'library',
        'computer',
        'sports',
        'extra_curricular',
        'uniforms_id',
        'hostel',
        'custom',
      ],
      default: 'tuition',
    },
    customType: String, // For custom fee heads

    amount: { type: Number, required: true, min: 0 },
    mandatory: { type: Boolean, default: true },
    description: String,

    // Class applicability - which classes this fee head applies to
    applicableClasses: [
      {
        type: String, // '1', '2', '3', ... '12'
        required: true,
      },
    ],

    // For Class 11-12: Stream/Group selection
    applicableStreams: [
      {
        type: String,
        enum: ['Science', 'Commerce', 'Arts', 'All'],
      },
    ],

    // Frequency
    frequency: {
      type: String,
      enum: ['monthly', 'quarterly', 'term', 'yearly', 'one-time'],
      default: 'yearly',
    },

    // Rules and conditions
    rules: {
      conditions: [{ type: String }],
      defaultApplicable: { type: Boolean, default: true },
      requiresApproval: { type: Boolean, default: false },
    },

    // School scoping
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },

    // Status
    isActive: { type: Boolean, default: true },

    // Auto-apply to students
    autoApply: { type: Boolean, default: true },
  },
  { timestamps: true }
);

feeHeadSchema.index({ schoolId: 1, isActive: 1 });
feeHeadSchema.index({ schoolId: 1, headType: 1 });

export default mongoose.model('FeeHead', feeHeadSchema);
