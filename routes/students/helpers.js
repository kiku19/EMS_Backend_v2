import mongoose from 'mongoose';
import { z } from 'zod';
import { Class, StudentFeeStructure } from '../../database.js';
import FeeHead from '../../models/FeeHead.js';
import { extractSchoolId, ensureDefaultSchool } from '../../utils/schoolContext.js';
import { resolveAcademicYear } from '../../utils/academicYear.js';

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

  const classNumber = classInfo.name.replace('Class ', '');
  const applicableFeeHeads = await FeeHead.find({
    schoolId: student.schoolId,
    applicableClasses: classNumber,
    academicYear,
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
