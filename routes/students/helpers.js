import mongoose from 'mongoose';
import { z } from 'zod';
import { Class, StudentFeeStructure } from '../../database.js';
import FeeHead from '../../models/FeeHead.js';
import { extractSchoolId, ensureDefaultSchool } from '../../utils/schoolContext.js';
import { resolveAcademicYear } from '../../utils/academicYear.js';

/**
 * Produce the candidate tokens for matching a Class against
 * FeeHead.applicableClasses. Schools use different conventions — "Class 10",
 * "Grade 10", "10", "X" (Roman), "X-A" — so we return a small set and the
 * caller does `$in` against it.
 *
 * Examples:
 *   "Class 10" → ['Class 10', '10']
 *   "Grade 5"  → ['Grade 5', '5']
 *   "10"       → ['10']
 *   "X"        → ['X']
 *   "Nursery"  → ['Nursery']
 */
export function classNameTokens(name) {
  if (!name || typeof name !== 'string') return [];
  const trimmed = name.trim();
  const tokens = new Set([trimmed]);
  // "Class N" / "Grade N" → N
  const numberMatch = trimmed.match(/\b(\d+)\b/);
  if (numberMatch) tokens.add(numberMatch[1]);
  // "Class X" → X  (Roman-numeral / single-letter tail)
  const tailMatch = trimmed.match(/(?:Class|Grade)\s+([A-Za-z0-9]+(?:-[A-Za-z0-9]+)?)$/i);
  if (tailMatch) tokens.add(tailMatch[1]);
  return Array.from(tokens);
}

export const createRemarkSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  description: z.string().min(1, 'Description is required').max(2000, 'Description too long'),
  category: z
    .enum(['academic', 'behavioral', 'achievement', 'attendance', 'health', 'general'])
    .optional()
    .default('general'),
  sentToParent: z.boolean().optional().default(false),
});

export const updateRemarkSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  description: z.string().min(1, 'Description is required').max(2000, 'Description too long'),
  category: z
    .enum(['academic', 'behavioral', 'achievement', 'attendance', 'health', 'general'])
    .optional()
    .default('general'),
  sentToParent: z.boolean().optional().default(false),
});

export const sendReminderSchema = z.object({
  type: z.enum(['fee', 'attendance'], { required_error: 'Reminder type is required' }),
  message: z.string().max(500, 'Message too long').optional(),
});

export const sendRemindersBulkSchema = z.object({
  studentIds: z.array(z.string().min(1)).min(1, 'At least one student is required').max(500, 'Too many students'),
  type: z.enum(['fee', 'attendance'], { required_error: 'Reminder type is required' }),
  message: z.string().max(500, 'Message too long').optional(),
});

export function scopeBySchool(schoolId, query = {}) {
  const normalizedSchoolId = extractSchoolId(schoolId);
  if (!normalizedSchoolId) throw new Error('schoolId is required for scoped queries');
  return { ...query, schoolId: normalizedSchoolId };
}

export async function resolveRequestSchoolId(req) {
  if (req.user?.schoolId) return extractSchoolId(req.user.schoolId);
  const school = await ensureDefaultSchool();
  return extractSchoolId(school._id);
}

export function processParents(parents = []) {
  return parents.map((parent) => ({
    ...parent,
    isWhatsapp: parent.isWhatsapp || false,
  }));
}

export function cleanObject(object) {
  Object.keys(object).forEach((key) => {
    if (object[key] === undefined) {
      delete object[key];
      return;
    }

    if (
      typeof object[key] === 'object' &&
      object[key] !== null &&
      !Array.isArray(object[key]) &&
      Object.keys(object[key]).length === 0
    ) {
      delete object[key];
    }
  });
}

export function formatStudentClass(student) {
  if (!student.classId || typeof student.classId === 'string') {
    return null;
  }

  const className = student.classId.name.replace('Class ', '');
  return student.classId.section ? `${className}-${student.classId.section}` : className;
}

export function escapeRegex(value = '') {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function getStudentListSort(sortBy = 'name', sortOrder = 'asc') {
  const direction = ['desc', 'descending'].includes(String(sortOrder).toLowerCase()) ? -1 : 1;

  switch (sortBy) {
    case 'rollNo':
      return { isPinned: -1, pinnedAt: -1, rollNo: direction, name: 1 };
    case 'class':
      return {
        isPinned: -1,
        pinnedAt: -1,
        'classId.name': direction,
        'classId.section': direction,
        rollNo: 1,
        name: 1,
      };
    case 'name':
    default:
      return { isPinned: -1, pinnedAt: -1, name: direction, rollNo: 1 };
  }
}

export async function buildStudentListQuery(
  { classId, status, academicYear, search, feeStatus, schoolId },
  resolvedAcademicYear
) {
  const conditions = [{ isDeleted: { $ne: true } }];

  if (schoolId) {
    conditions.push({ schoolId });
  }

  if (classId) {
    conditions.push({
      classId: mongoose.Types.ObjectId.isValid(classId)
        ? new mongoose.Types.ObjectId(classId)
        : classId,
    });
  }

  if (status && status !== 'all') {
    conditions.push({ status });
  }

  if (academicYear && academicYear !== 'all') {
    conditions.push({ academicYear });
  }

  if (search?.trim()) {
    const trimmedSearch = search.trim();
    const searchRegex = new RegExp(escapeRegex(trimmedSearch), 'i');
    const numericSearch = Number.parseInt(trimmedSearch, 10);
    conditions.push({
      $or: [
        { name: searchRegex },
        { admissionId: searchRegex },
        { email: searchRegex },
        { parentName: searchRegex },
        // Note: parentPhone and parents.phone are PII-encrypted and not in searchableFields,
        // so regex queries cannot match against them. Only searchable PII fields (phone, email) are included.
        ...(Number.isNaN(numericSearch) ? [] : [{ rollNo: numericSearch }]),
      ],
    });
  }

  if (feeStatus && feeStatus !== 'all') {
    const matchingFeeStudentIds = await StudentFeeStructure.find({
      ...(schoolId ? { schoolId } : {}),
      academicYear: resolvedAcademicYear,
      overallStatus: feeStatus,
    }).distinct('studentId');

    conditions.push({
      $or: [{ _id: { $in: matchingFeeStudentIds } }, { feeStatus }],
    });
  }

  return conditions.length === 1 ? conditions[0] : { $and: conditions };
}

export async function initializeFeeStructure(student) {
  const academicYear = await resolveAcademicYear(student.academicYear);

  const existingFeeStructure = await StudentFeeStructure.findOne({
    studentId: student._id,
    academicYear,
    schoolId: student.schoolId,
  });

  if (existingFeeStructure) {
    return;
  }

  const classInfo = await Class.findOne({ _id: student.classId, schoolId: student.schoolId });
  if (!classInfo) {
    return;
  }

  // FeeHead has no academicYear field — it's a tenant-wide reusable catalogue.
  // Filtering by {academicYear} made this query return zero rows, so every
  // new student was initialised with an empty fee structure (totalFee=0).
  // Also accept multiple class-name shapes ("Class 10", "Grade 10", "10",
  // Roman) so schools using non-"Class N" naming conventions still match.
  const tokens = classNameTokens(classInfo.name);
  const applicableFeeHeads = await FeeHead.find({
    schoolId: student.schoolId,
    applicableClasses: { $in: tokens },
    isActive: true,
  });

  const feeStructure = new StudentFeeStructure({
    studentId: student._id,
    classId: student.classId,
    academicYear,
    schoolId: student.schoolId,
    feeHeads: applicableFeeHeads.map((feeHead) => ({
      feeHeadId: feeHead._id,
      name: feeHead.name,
      category: feeHead.category,
      amount: feeHead.amount,
      mandatory: feeHead.mandatory,
      frequency: feeHead.frequency,
      paidAmount: 0,
      balanceAmount: feeHead.amount,
      status: 'pending',
    })),
  });

  feeStructure.totalFee = feeStructure.feeHeads.reduce((sum, feeHead) => sum + feeHead.amount, 0);
  feeStructure.totalPaid = 0;
  feeStructure.totalBalance = feeStructure.totalFee;
  feeStructure.overallStatus = 'pending';

  await feeStructure.save();
}

function overallStatusFor(totalFee, totalPaid) {
  if (totalPaid >= totalFee && totalFee > 0) return 'paid';
  if (totalPaid > 0) return 'partial';
  return 'pending';
}

function feeHeadStatusFor(amount, paidAmount) {
  if (paidAmount >= amount && amount > 0) return 'paid';
  if (paidAmount > 0) return 'partial';
  return 'pending';
}

/**
 * Re-align the student's fee structure to the feeHeads applicable to their
 * CURRENT class, preserving paidAmount and payment history on any feeHead
 * carried forward from the old class. Heads present in the old class but not
 * the new one are retained ONLY when they already have a paidAmount > 0
 * (i.e. real payment history exists) so downstream payment-cancellation still
 * works.
 *
 * This exists because the previous class-change flow did
 * `deleteMany({studentId, academicYear}) + initializeFeeStructure()` which
 * zeroed out every recorded paidAmount — a 'paid Rs. 10,000' student showed
 * up to the new class owing the full amount.
 */
export async function resyncFeeStructureForClassChange(student) {
  const academicYear = await resolveAcademicYear(student.academicYear);

  const existing = await StudentFeeStructure.findOne({
    studentId: student._id,
    academicYear,
    schoolId: student.schoolId,
  });

  if (!existing) {
    // No structure yet (e.g. student was created without fees) — treat as
    // first-time init so the new class's heads get applied.
    return initializeFeeStructure(student);
  }

  const classInfo = await Class.findOne({ _id: student.classId, schoolId: student.schoolId });
  if (!classInfo) return;

  const newApplicableHeads = await FeeHead.find({
    schoolId: student.schoolId,
    applicableClasses: { $in: classNameTokens(classInfo.name) },
    isActive: true,
  });

  const priorByFeeHeadId = new Map(
    existing.feeHeads.map((fh) => [fh.feeHeadId?.toString(), fh])
  );

  const mergedHeads = newApplicableHeads.map((feeHead) => {
    const prior = priorByFeeHeadId.get(feeHead._id.toString());
    const paidAmount = prior?.paidAmount || 0;
    const balanceAmount = Math.max(0, feeHead.amount - paidAmount);
    return {
      feeHeadId: feeHead._id,
      name: feeHead.name,
      category: feeHead.category,
      amount: feeHead.amount,
      mandatory: feeHead.mandatory,
      frequency: feeHead.frequency,
      paidAmount,
      balanceAmount,
      status: feeHeadStatusFor(feeHead.amount, paidAmount),
    };
  });

  // Preserve old-class heads that carry real payment history — dropping them
  // would orphan their FeePayment.feeHeads entries and make refunds nonsense.
  const newIds = new Set(newApplicableHeads.map((fh) => fh._id.toString()));
  for (const prior of existing.feeHeads) {
    const id = prior.feeHeadId?.toString();
    if (id && !newIds.has(id) && (prior.paidAmount || 0) > 0) {
      mergedHeads.push({
        feeHeadId: prior.feeHeadId,
        name: prior.name,
        category: prior.category,
        amount: prior.amount,
        mandatory: prior.mandatory,
        frequency: prior.frequency,
        paidAmount: prior.paidAmount,
        balanceAmount: 0, // Legacy head — no further balance accrues in new class
        status: 'paid',
      });
    }
  }

  existing.classId = student.classId;
  existing.feeHeads = mergedHeads;
  existing.totalFee = mergedHeads.reduce((s, h) => s + (h.amount || 0), 0);
  existing.totalPaid = mergedHeads.reduce((s, h) => s + (h.paidAmount || 0), 0);
  existing.totalBalance = Math.max(0, existing.totalFee - existing.totalPaid);
  existing.overallStatus = overallStatusFor(existing.totalFee, existing.totalPaid);
  await existing.save();
}
