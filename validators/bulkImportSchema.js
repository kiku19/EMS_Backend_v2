import { z } from 'zod';
import {
  optionalPhone,
  optionalEmail,
  academicYear,
  dateString,
  optionalString,
  genderEnum,
} from './zodHelpers.js';

// ─── ATTENDANCE CORRECTION ROW (from CSV/Excel) ──────────────────
export const attendanceCorrectionRowSchema = z
  .object({
    admissionId: z.string().min(1).max(50).trim(),
    date: dateString,
    status: z.enum(['present', 'absent', 'late', 'leave', 'halfday']),
  })
  .strip();

// ─── EXAM RESULTS ROW (from CSV/Excel) ───────────────────────────
export const examResultRowSchema = z
  .object({
    admissionId: z.string().min(1).max(50).trim(),
    marksObtained: z.union([
      z.number().min(0),
      z
        .string()
        .regex(/^\d+(\.\d+)?$/)
        .transform(Number),
    ]),
    maxMarks: z
      .union([
        z.number().min(1),
        z
          .string()
          .regex(/^\d+(\.\d+)?$/)
          .transform(Number),
      ])
      .optional(),
    remarks: optionalString(500),
  })
  .strip();

// ─── STUDENT ROW (from CSV/Excel) ───────────────────────────────
export const studentRowSchema = z
  .object({
    name: z.string().min(2).max(100).trim(),
    admissionId: z.string().min(1).max(50).trim(),
    academicYear: academicYear,
    // Class is resolved by name + section at import time
    className: z.string().min(1).max(50).trim(),
    section: z.string().min(1).max(10).trim(),
    rollNo: z
      .union([z.number().int().min(1), z.string().regex(/^\d+$/).transform(Number)])
      .nullish()
      .or(z.literal('')),
    gender: genderEnum.nullish().or(z.literal('')),
    dateOfBirth: dateString.nullish().or(z.literal('')),
    parentName: z.string().min(1).max(100).trim(),
    parentPhone: optionalPhone,
    parentEmail: optionalEmail,
    phone: optionalPhone,
    email: optionalEmail,
    address: optionalString(500),
  })
  .strip();

// ─── STAFF ROW (from CSV/Excel) ──────────────────────────────────
export const staffRowSchema = z
  .object({
    name: z.string().min(2).max(100).trim(),
    role: z.string().min(1).max(50).trim(),
    department: optionalString(50),
    phone: optionalPhone,
    email: optionalEmail,
    gender: genderEnum.nullish().or(z.literal('')),
    joinDate: dateString.nullish().or(z.literal('')),
    designation: optionalString(100),
    salary: z
      .union([
        z.number().min(0),
        z
          .string()
          .regex(/^\d+(\.\d+)?$/)
          .transform(Number),
      ])
      .nullish()
      .or(z.literal('')),
  })
  .strip();

// ─── FEE PAYMENT ROW (from CSV/Excel) ────────────────────────────
export const feePaymentRowSchema = z
  .object({
    admissionId: z.string().min(1).max(50).trim(),
    academicYear: academicYear,
    amount: z.union([
      z.number().min(0.01),
      z
        .string()
        .regex(/^\d+(\.\d+)?$/)
        .transform(Number),
    ]),
    paymentDate: dateString,
    paymentMode: z.enum(['cash', 'cheque', 'online', 'card', 'upi', 'bank_transfer']),
    receiptNumber: optionalString(100),
    remarks: optionalString(500),
  })
  .strip();
