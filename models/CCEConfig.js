import mongoose from 'mongoose';
import { CURRENT_ACADEMIC_YEAR } from '../utils/constants.js';

// CCE Grade Scale entry (A1=90-100/10pts, A2=81-90/9pts, ... E2=0-20/2pts)
const cceGradeSchema = new mongoose.Schema(
  {
    minPercentage: { type: Number, required: true, min: 0, max: 100 },
    maxPercentage: { type: Number, required: true, min: 0, max: 100 },
    grade: { type: String, required: true, trim: true },
    gradePoint: { type: Number, required: true, min: 0, max: 10 },
    description: { type: String, trim: true },
  },
  { _id: false }
);

// Assessment type definition (FA1, FA2, SA1, SA2 etc.)
const assessmentTypeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['formative', 'summative'], required: true },
    term: { type: String, enum: ['term_1', 'term_2'], required: true },
    weightage: { type: Number, required: true, min: 0, max: 100 },
    maxMarks: { type: Number, required: true, min: 1 },
    isActive: { type: Boolean, default: true },
  },
  { _id: false }
);

// Co-scholastic area (Life Skills, Attitudes & Values, Co-curricular)
const coScholasticAreaSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      required: true,
      enum: ['life_skills', 'attitudes_values', 'co_curricular'],
    },
    name: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { _id: false }
);

const cceConfigSchema = new mongoose.Schema(
  {
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    academicYear: { type: String, default: CURRENT_ACADEMIC_YEAR },
    enabled: { type: Boolean, default: true },
    gradingScale: [cceGradeSchema],
    assessmentTypes: [assessmentTypeSchema],
    coScholasticAreas: [coScholasticAreaSchema],
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
  },
  { timestamps: true }
);

cceConfigSchema.index(
  { schoolId: 1, academicYear: 1 },
  { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } }
);

export default mongoose.model('CCEConfig', cceConfigSchema);
