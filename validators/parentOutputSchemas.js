import { z } from 'zod';

// Safely convert a MongoDB ObjectId (or string) to a plain string id.
const toId = (id) => id?.toString?.() ?? (id ? String(id) : '');

/**
 * Apply a Zod output schema to an array of lean Mongoose documents.
 * Transforms are applied via .parse() — any thrown errors propagate.
 */
export function applyOutputSchema(schema, docs) {
  return (docs ?? []).map((doc) => schema.parse(doc));
}

/**
 * Exam output schema
 * Normalises:
 *   _id        → id  (added; _id kept for backward compat)
 *   examType   → type (prefers canonical `type`; falls back to deprecated `examType`)
 */
export const examOutputSchema = z.any().transform((doc) => ({
  ...doc,
  id: toId(doc._id),
  type: doc.type ?? doc.examType ?? null,
}));

/**
 * Result output schema
 * Normalises:
 *   _id               → id
 *   examId (populated) → id + type added to nested object
 */
export const resultOutputSchema = z.any().transform((doc) => {
  let examId = doc.examId;
  if (examId && typeof examId === 'object' && !Array.isArray(examId)) {
    examId = {
      ...examId,
      id: toId(examId._id),
      type: examId.type ?? examId.examType ?? null,
    };
  }
  return {
    ...doc,
    id: toId(doc._id),
    examId,
  };
});

/**
 * Remark output schema
 * Normalises: _id → id
 */
export const remarkOutputSchema = z.any().transform((doc) => ({
  ...doc,
  id: toId(doc._id),
}));

/**
 * Attendance record output schema
 * Normalises: _id → id
 */
export const attendanceRecordOutputSchema = z.any().transform((doc) => ({
  ...doc,
  id: toId(doc._id),
}));

/**
 * Fee payment output schema
 * Normalises: _id → id
 */
export const paymentOutputSchema = z.any().transform((doc) => ({
  ...doc,
  id: toId(doc._id),
}));
