import mongoose from 'mongoose';
import { z } from 'zod';
import { Class, StudentFeeStructure, Attendance } from '../../database.js';
import { extractSchoolId, ensureDefaultSchool } from '../../utils/schoolContext.js';
import { resolveAcademicYear } from '../../utils/academicYear.js';
import { checkClassCapacity } from '../../utils/classCapacity.js';
import { CURRENT_ACADEMIC_YEAR } from '../../utils/constants.js';
import {
  buildStudentFeeHeads,
  buildStudentInstallments,
} from '../../utils/applyClassFeeStructure.js';
import { computeFeeBalance } from '../../utils/feeCalculator.js';

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
  studentIds: z
    .array(z.string().min(1))
    .min(1, 'At least one student is required')
    .max(500, 'Too many students'),
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

/**
 * C26 — Shared promotion guard. Mirrors the three checks the single-promote
 * handler (routes/students/promotions.js /:id/promote) runs before mutating a
 * student's class/year, so bulk-promote cannot bypass them:
 *   1. pending-fee check   (Student.feeStatus === 'pending')
 *   2. attendance threshold (>=60% present/late in the source class's AY)
 *   3. target-class capacity (checkClassCapacity, strengthLimit)
 *
 * Each guard can be individually skipped via the options object, matching the
 * single-promote skip flags. Throws an Error with a descriptive `.code` and
 * message on the first failing guard; resolves with the resolved target class
 * otherwise.
 *
 * @param {object} student      - Populated Student doc (needs classId populated
 *                                for academicYear; plain doc/lean is fine).
 * @param {object} targetClass  - Resolved target Class doc.
 * @param {object} options
 * @param {string} options.schoolId
 * @param {string} [options.academicYear]
 * @param {boolean} [options.skipFeeCheck=false]
 * @param {boolean} [options.skipAttendanceCheck=false]
 * @param {number} [options.extraOccupied=0] - Already-reserved seats in the
 *        target class within the same batch (bulk-promote passes a running
 *        tally so a multi-student batch does not over-fill one class, since
 *        checkClassCapacity reads committed data and cannot see in-batch writes).
 * @returns {Promise<object>} the targetClass, on success.
 */
export async function assertStudentCanPromote(student, targetClass, options = {}) {
  const {
    schoolId,
    academicYear,
    skipFeeCheck = false,
    skipAttendanceCheck = false,
    extraOccupied = 0,
  } = options;

  if (!student) {
    const err = new Error('Student not found');
    err.code = 'STUDENT_NOT_FOUND';
    throw err;
  }
  if (!targetClass) {
    const err = new Error('Target class not found');
    err.code = 'TARGET_CLASS_NOT_FOUND';
    throw err;
  }

  // 1. Fee check — pending fees block promotion (same predicate as single-promote).
  if (!skipFeeCheck && student.feeStatus === 'pending') {
    const err = new Error('Student has pending fees');
    err.code = 'FEE_PENDING';
    throw err;
  }

  // 2. Attendance check — scope to the source class's academic year, mirror
  //    the single-promote 60% threshold (present+late / total).
  if (!skipAttendanceCheck) {
    const fromClass =
      student.classId && student.classId.toObject ? student.classId.toObject() : student.classId;
    const attYearStr = fromClass?.academicYear || student.academicYear || CURRENT_ACADEMIC_YEAR;
    const [attYearStart] = attYearStr.split('-');
    const attYearNum = parseInt(attYearStart, 10);
    const attQuery = scopeBySchool(schoolId, { studentId: student._id });
    if (!isNaN(attYearNum)) {
      attQuery.date = { $gte: `${attYearNum}-04-01`, $lte: `${attYearNum + 1}-03-31` };
    }
    const attendance = await Attendance.find(attQuery).lean();
    const present = attendance.filter((a) => a.status === 'present' || a.status === 'late').length;
    const attendancePercent = attendance.length > 0 ? (present / attendance.length) * 100 : 0;
    if (attendancePercent < 60) {
      const err = new Error(`Attendance too low (${attendancePercent.toFixed(1)}%)`);
      err.code = 'LOW_ATTENDANCE';
      err.attendancePercent = Math.round(attendancePercent * 10) / 10;
      throw err;
    }
  }

  // 3. Target-class capacity — same helper single-promote uses, plus any
  //    in-batch reservations so a bulk batch never over-fills one class.
  const capacityResult = await checkClassCapacity(targetClass._id, schoolId);
  const projectedCount = (capacityResult?.currentCount || 0) + (extraOccupied || 0);
  if (capacityResult && projectedCount >= capacityResult.capacity) {
    const err = new Error(
      `Target class is at full capacity (${projectedCount}/${capacityResult.capacity})`
    );
    err.code = 'CLASS_FULL';
    err.currentCount = projectedCount;
    err.capacity = capacityResult.capacity;
    throw err;
  }

  return targetClass;
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

    // NOTE: Date instances are `typeof 'object'` with no enumerable own keys,
    // so the empty-object check below would delete them. Guard against this so
    // date fields (e.g. admissionDate) actually persist. Same for any other
    // built-in object types (Map/Set) that have no enumerable keys.
    if (object[key] instanceof Date) return;

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

/**
 * S6 — Merge an incoming `parents` payload against the existing array.
 *
 * The About-tab single-parent edit rebuilt a fresh array containing only the
 * edited parent; $set then replaced the whole array, deleting the other
 * parent AND stripping parentId / isWhatsapp / isParent (which the rebuilt
 * objects omitted). This preserves untouched parents verbatim and carries
 * forward the linkage fields on edited ones.
 *
 * Match strategy (per incoming parent):
 *   1. explicit `_id` on the incoming parent,
 *   2. stable identity key (name + phone + relationship), lowercased.
 *
 * Replacement vs. partial-edit rule:
 *   - If AT LEAST ONE incoming parent matched an existing parent, this is a
 *     partial edit — unmatched existing parents are carried forward (so the
 *     About-tab single-parent edit doesn't delete the other parent).
 *   - If NO incoming parent matched any existing one, this is a full
 *     replacement — all existing parents are dropped (a brand-new identity
 *     means the caller intends to swap the parent set).
 *
 * The About-tab edit sends the edited parent with unchanged
 * name/phone/relationship (only fields like occupation change), so it matches
 * by identity → partial-edit mode → the other parent survives. A payload with
 * a totally new identity matches nothing → replacement mode.
 */
export function mergeParentsForUpdate(existingParents = [], incomingParents = []) {
  const existing = existingParents.map((p) => (p.toObject ? p.toObject() : { ...p }));
  const usedExisting = new Set();
  const result = [];
  let anyMatched = false;

  const identityKey = (p) =>
    [p?.name, p?.phone, p?.relationship]
      .map((v) =>
        String(v ?? '')
          .trim()
          .toLowerCase()
      )
      .join('|');

  for (const incoming of incomingParents) {
    let matchIdx = -1;
    // 1. _id match
    if (incoming._id) {
      matchIdx = existing.findIndex(
        (p, i) => !usedExisting.has(i) && p._id && String(p._id) === String(incoming._id)
      );
    }
    // 2. identity match (name + phone + relationship)
    if (matchIdx === -1) {
      const key = identityKey(incoming);
      if (key && key !== '||') {
        matchIdx = existing.findIndex((p, i) => !usedExisting.has(i) && identityKey(p) === key);
      }
    }

    if (matchIdx !== -1) {
      anyMatched = true;
      usedExisting.add(matchIdx);
      const stored = existing[matchIdx];
      // Carry forward linkage fields the client omitted. `incoming` already
      // went through processParents, so spread order lets client values win.
      result.push({
        ...stored,
        ...incoming,
        parentId: incoming.parentId ?? stored.parentId ?? null,
        isWhatsapp: incoming.isWhatsapp ?? stored.isWhatsapp,
        isParent: incoming.isParent ?? stored.isParent,
      });
    } else {
      // No match — genuinely new parent (appended; replacement semantics
      // decided by `anyMatched` below).
      result.push(incoming);
    }
  }

  // Partial edit → carry forward untouched existing parents. Full
  // replacement (no matches) → drop them.
  if (anyMatched) {
    for (let i = 0; i < existing.length; i++) {
      if (!usedExisting.has(i)) {
        result.push(existing[i]);
      }
    }
  }

  return result;
}

/**
 * S8 — Generic merge for array subdocuments where the client rebuild drops
 * fields (e.g. siblings losing age/class/school). Match by _id, then by the
 * `identityFn` extractor (name). Untouched stored entries are carried forward
 * when at least one match occurred (partial edit); a payload with no matches
 * is treated as a full replacement. Client-supplied fields override stored
 * ones field-by-field, so stored-only fields survive when the client omits
 * them.
 */
export function mergeSubdocArray(existingArr = [], incomingArr = [], identityFn = (e) => '') {
  const existing = existingArr.map((e) => (e.toObject ? e.toObject() : { ...e }));
  const usedExisting = new Set();
  const result = [];
  let anyMatched = false;

  for (const incoming of incomingArr) {
    let matchIdx = -1;
    if (incoming._id) {
      matchIdx = existing.findIndex(
        (e, i) => !usedExisting.has(i) && e._id && String(e._id) === String(incoming._id)
      );
    }
    if (matchIdx === -1) {
      const key = String(identityFn(incoming) ?? '')
        .trim()
        .toLowerCase();
      if (key) {
        matchIdx = existing.findIndex(
          (e, i) =>
            !usedExisting.has(i) &&
            String(identityFn(e) ?? '')
              .trim()
              .toLowerCase() === key
        );
      }
    }

    if (matchIdx !== -1) {
      anyMatched = true;
      usedExisting.add(matchIdx);
      result.push({ ...existing[matchIdx], ...incoming });
    } else {
      result.push(incoming);
    }
  }

  if (anyMatched) {
    for (let i = 0; i < existing.length; i++) {
      if (!usedExisting.has(i)) {
        result.push(existing[i]);
      }
    }
  }

  return result;
}

export function mergeNestedObject(existingValue, incomingValue) {
  if (incomingValue == null) return undefined;
  const existing = existingValue?.toObject
    ? existingValue.toObject()
    : existingValue && typeof existingValue === 'object'
      ? { ...existingValue }
      : {};
  return { ...existing, ...incomingValue };
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
  const parseList = (value) =>
    String(value || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry && entry !== 'all');

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

  const statuses = parseList(status);
  if (statuses.length > 0) {
    conditions.push({ status: { $in: statuses } });
  }

  const academicYears = parseList(academicYear);
  if (academicYears.length > 0) {
    conditions.push({ academicYear: { $in: academicYears } });
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
        // Note: parents.phone are PII-encrypted and not in searchableFields,
        // so regex queries cannot match against them. Only searchable PII fields (phone, email) are included.
        ...(Number.isNaN(numericSearch) ? [] : [{ rollNo: numericSearch }]),
      ],
    });
  }

  const feeStatuses = parseList(feeStatus);
  if (feeStatuses.length > 0) {
    const matchingFeeStudentIds = await StudentFeeStructure.find({
      ...(schoolId ? { schoolId } : {}),
      academicYear: academicYears.length > 0 ? { $in: academicYears } : resolvedAcademicYear,
      overallStatus: { $in: feeStatuses },
      isDeleted: { $ne: true },
    }).distinct('studentId');

    // Match ONLY against StudentFeeStructure.overallStatus (the authoritative
    // source). The previous $or joined Student.feeStatus — a legacy field
    // that was client-settable pre-fix and can still hold stale / forged
    // values ("paid" without a payment record), so it leaked the wrong
    // students into filters.
    conditions.push({ _id: { $in: matchingFeeStudentIds } });
  }

  return conditions.length === 1 ? conditions[0] : { $and: conditions };
}

export async function initializeFeeStructure(student, options = {}) {
  const { session } = options;
  const academicYear = await resolveAcademicYear(student.academicYear);

  const existingFeeStructure = await StudentFeeStructure.findOne({
    studentId: student._id,
    academicYear,
    schoolId: student.schoolId,
    isDeleted: { $ne: true },
  }).session(session);

  if (existingFeeStructure) {
    return existingFeeStructure;
  }

  const classInfo = await Class.findOne({
    _id: student.classId,
    schoolId: student.schoolId,
  }).session(session);
  if (!classInfo) {
    return null;
  }

  // Prefer the class FeeStructure (the admin-configured per-class amounts) and
  // fall back to the global FeeHead catalogue via applicableClasses only when
  // no class structure exists. Previously this always used the catalogue, so a
  // student joining a class with a saved 20,000 structure could be initialised
  // with the generic FeeHead amount (or nothing) instead.
  const { feeHeads: applicableFeeHeads, classStructure } = await buildStudentFeeHeads({
    schoolId: student.schoolId,
    classId: student.classId,
    academicYear,
    classNameTokens: classNameTokens(classInfo.name),
  });

  const feeStructure = new StudentFeeStructure({
    studentId: student._id,
    classId: student.classId,
    academicYear,
    schoolId: student.schoolId,
    feeHeads: applicableFeeHeads.map((feeHead) => ({
      feeHeadId: feeHead.feeHeadId,
      name: feeHead.name,
      category: feeHead.category,
      baseAmount: feeHead.baseAmount,
      amount: feeHead.amount,
      mandatory: feeHead.mandatory,
      frequency: feeHead.frequency,
      applicableTerms: feeHead.applicableTerms,
      dueDay: feeHead.dueDay,
      refundable: feeHead.refundable,
      paidAmount: 0,
      balanceAmount: feeHead.amount,
      status: 'pending',
    })),
    installments: classStructure ? buildStudentInstallments(classStructure) : [],
  });

  feeStructure.totalFee = feeStructure.feeHeads.reduce((sum, feeHead) => sum + feeHead.amount, 0);
  feeStructure.totalPaid = 0;
  feeStructure.totalBalance = feeStructure.totalFee;
  feeStructure.overallStatus = 'pending';

  await feeStructure.save({ session });
  return feeStructure;
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
export async function resyncFeeStructureForClassChange(student, options = {}) {
  const { session } = options;
  const academicYear = await resolveAcademicYear(student.academicYear);

  const existing = await StudentFeeStructure.findOne({
    studentId: student._id,
    academicYear,
    schoolId: student.schoolId,
    isDeleted: { $ne: true },
  }).session(session);

  if (!existing) {
    // No structure yet (e.g. student was created without fees) — treat as
    // first-time init so the new class's heads get applied.
    return initializeFeeStructure(student, { session });
  }

  const classInfo = await Class.findOne({
    _id: student.classId,
    schoolId: student.schoolId,
  }).session(session);
  if (!classInfo) return;

  // Prefer the new class's FeeStructure; fall back to the FeeHead catalogue.
  const { feeHeads: newApplicableHeads } = await buildStudentFeeHeads({
    schoolId: student.schoolId,
    classId: student.classId,
    academicYear,
    classNameTokens: classNameTokens(classInfo.name),
  });

  const priorByFeeHeadId = new Map(existing.feeHeads.map((fh) => [fh.feeHeadId?.toString(), fh]));

  const mergedHeads = newApplicableHeads.map((feeHead) => {
    const prior = priorByFeeHeadId.get(feeHead.feeHeadId?.toString());
    const paidAmount = prior?.paidAmount || 0;
    const balanceAmount = Math.max(0, feeHead.amount - paidAmount);
    return {
      feeHeadId: feeHead.feeHeadId,
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
  const newIds = new Set(newApplicableHeads.map((fh) => fh.feeHeadId?.toString()));
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
  // Use the canonical balance calculator so discountApplied (and any
  // lateFeeApplied) is factored in. The local overallStatusFor helper ignored
  // discounts, so a discounted student who changed class was over-billed by
  // their concession amount.
  const { totalBalance, overallStatus } = computeFeeBalance(existing);
  existing.totalBalance = totalBalance;
  existing.overallStatus = overallStatus;
  await existing.save({ session });
  return existing;
}
