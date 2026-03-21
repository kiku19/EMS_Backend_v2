import { z } from 'zod';
import { objectId, optionalObjectId, academicYear, optionalString } from './zodHelpers.js';

const cbseGradeEnum = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D', 'E1', 'E2']);
const coScholasticGradeEnum = z.enum(['A', 'B', 'C', 'D']);
const termEnum = z.enum(['term_1', 'term_2', 'annual']);

// ─── Scholastic Subject ───────────────────────────────────────────────────────
const scholasticSubjectSchema = z
  .object({
    subjectName: z.string().min(1).max(100).trim(),
    subjectCode: optionalString(20),
    theoryMaxMarks: z.number().min(0).max(1000).default(80),
    theoryMarks: z.number().min(0).max(1000).nullable().optional(),
    practicalMaxMarks: z.number().min(0).max(1000).default(20),
    practicalMarks: z.number().min(0).max(1000).nullable().optional(),
    // totalMarks / grade / gradePoint are computed server-side; clients may omit
    totalMarks: z.number().min(0).max(2000).nullable().optional(),
    maxMarks: z.number().min(1).max(2000).default(100),
    grade: cbseGradeEnum.nullable().optional(),
    gradePoint: z.number().min(0).max(10).nullable().optional(),
    isPassed: z.boolean().optional(),
    remarks: optionalString(200),
  })
  .strip();

// ─── Co-Scholastic Area ───────────────────────────────────────────────────────
const coScholasticAreaSchema = z
  .object({
    area: z.string().min(1).max(100).trim(),
    activity: optionalString(100),
    grade: coScholasticGradeEnum.nullable().optional(),
  })
  .strip();

// ─── CREATE / UPSERT ─────────────────────────────────────────────────────────
export const createCBSEReportCardSchema = z
  .object({
    studentId: objectId,
    classId: objectId,
    academicYear: academicYear,
    term: termEnum,
    scholasticGrades: z.array(scholasticSubjectSchema).default([]),
    coScholasticGrades: z.array(coScholasticAreaSchema).default([]),
    disciplineGrade: coScholasticGradeEnum.nullable().optional(),
    disciplineRemarks: optionalString(300),
    classTeacherRemarks: optionalString(500),
    principalRemarks: optionalString(500),
  })
  .strip();

// ─── UPDATE (all fields optional) ────────────────────────────────────────────
export const updateCBSEReportCardSchema = z
  .object({
    scholasticGrades: z.array(scholasticSubjectSchema).optional(),
    coScholasticGrades: z.array(coScholasticAreaSchema).optional(),
    disciplineGrade: coScholasticGradeEnum.nullable().optional(),
    disciplineRemarks: optionalString(300),
    classTeacherRemarks: optionalString(500),
    principalRemarks: optionalString(500),
  })
  .strip();

// ─── BULK CREATE (class-level) ────────────────────────────────────────────────
export const bulkCBSEReportCardsSchema = z
  .object({
    classId: objectId,
    academicYear: academicYear,
    term: termEnum,
    reportCards: z
      .array(
        z
          .object({
            studentId: objectId,
            scholasticGrades: z.array(scholasticSubjectSchema).default([]),
            coScholasticGrades: z.array(coScholasticAreaSchema).default([]),
            disciplineGrade: coScholasticGradeEnum.nullable().optional(),
            classTeacherRemarks: optionalString(500),
          })
          .strip()
      )
      .min(1, 'At least one student is required'),
  })
  .strip();
