import { Student, StudentFeeStructure, FeeStructure } from '../database.js';
import FeeHead from '../models/FeeHead.js';
import { computeFeeBalance, computeFeeHeadStatus, syncStudentFeeDetails } from './feeCalculator.js';
import { createLogger } from './logger.js';

const logger = createLogger('ApplyClassFeeStructure');

export function annualizedAmount(feeHead) {
  const amount = Number(feeHead?.amount || 0);
  if (feeHead?.frequency === 'monthly') return amount * 12;
  if (feeHead?.frequency === 'quarterly') return amount * 4;
  if (feeHead?.frequency === 'term') {
    const terms =
      Array.isArray(feeHead.applicableTerms) && feeHead.applicableTerms.length
        ? feeHead.applicableTerms.length
        : 2;
    return amount * Math.max(terms, 1);
  }
  return amount;
}

/**
 * Derive the top-level `dueDate` for a StudentFeeStructure from a class
 * FeeStructure's collection schedule (the earliest installment due date).
 *
 * Both the bulk-apply path and the GET auto-init path must compute this the
 * same way — otherwise auto-initialised structures never get a dueDate, so
 * `computeFeeBalance` can never mark them overdue and late-fee/reminder
 * pipelines silently skip them.
 *
 * @param {Object} classStructure - FeeStructure document (may have .collectionSchedule.installments)
 * @returns {Date|undefined}
 */
export function computeStructureDueDate(classStructure) {
  const earliest = (classStructure?.collectionSchedule?.installments || [])
    .map((installment) => installment?.dueDate)
    .filter(Boolean)
    .sort()[0];
  return earliest ? new Date(earliest) : undefined;
}

export function buildStudentInstallments(classStructure, existingInstallments = []) {
  return (classStructure.collectionSchedule?.installments || []).map((installment, index) => {
    const prior = existingInstallments.find(
      (candidate, priorIndex) =>
        priorIndex === index ||
        String(candidate.name || '')
          .trim()
          .toLowerCase() ===
          String(installment.name || '')
            .trim()
            .toLowerCase()
    );
    const amount = Number(installment.amount || 0);
    const paidAmount = Math.min(Number(prior?.paidAmount || 0), amount);
    const balanceAmount = Math.max(amount - paidAmount, 0);
    const dueDate = installment.dueDate ? new Date(installment.dueDate) : undefined;
    const status =
      balanceAmount <= 0
        ? 'paid'
        : paidAmount > 0
          ? 'partial'
          : dueDate && dueDate < new Date()
            ? 'overdue'
            : 'pending';
    return {
      name: installment.name || `Installment ${index + 1}`,
      dueDate,
      amount,
      paidAmount,
      balanceAmount,
      status,
    };
  });
}

/**
 * Apply (or re-apply) a class FeeStructure to every active student in that
 * class for the given academic year.
 *
 * - Students with no existing StudentFeeStructure get a fresh one built from
 *   the class structure's feeHeads.
 * - Students with an existing structure are merged: paid amounts are preserved,
 *   heads present in the class structure are updated to its amounts, heads no
 *   longer in the class structure are kept only if they carry payment history.
 *
 * This is the single source of truth for "propagate a class structure to its
 * students" — used by the save endpoint (auto-apply on save) and the explicit
 * apply-to-students endpoint.
 *
 * @param {Object} classStructure - the FeeStructure document (with .feeHeads)
 * @param {Object} opts - { schoolId, academicYear, session? }
 * @returns {Promise<{ appliedCount: number }>}
 */
export async function applyClassFeeStructureToStudents(
  classStructure,
  { schoolId, academicYear, session, abortOnError = false } = {}
) {
  if (!classStructure) {
    return { appliedCount: 0, appliedStudentIds: [], failures: [] };
  }

  const students = await Student.find({
    schoolId,
    classId: classStructure.classId,
    status: 'active',
    isDeleted: { $ne: true },
  }).session(session || null);

  const structureDueDate = computeStructureDueDate(classStructure);

  let appliedCount = 0;
  const appliedStudentIds = [];
  const failures = [];

  for (const student of students) {
    try {
      const existing = await StudentFeeStructure.findOne({
        schoolId,
        studentId: student._id,
        academicYear,
        isDeleted: { $ne: true },
      }).session(session || null);

      const feeHeadsFromStructure = classStructure.feeHeads.map((fh) => ({
        feeHeadId: fh.feeHeadId || fh._id,
        name: fh.name,
        category: fh.category,
        baseAmount: Number(fh.amount || 0),
        amount: annualizedAmount(fh),
        mandatory: fh.mandatory,
        frequency: fh.frequency,
        applicableTerms: fh.applicableTerms,
        dueDay: fh.dueDay,
        refundable: fh.refundable,
        // start from a "nothing paid" baseline; merge step preserves prior paid
        paidAmount: 0,
        balanceAmount: fh.amount,
        status: 'pending',
      }));

      if (!existing) {
        const newStructure = new StudentFeeStructure({
          schoolId,
          studentId: student._id,
          classId: classStructure.classId,
          academicYear,
          feeHeads: feeHeadsFromStructure,
          installments: buildStudentInstallments(classStructure),
          ...(structureDueDate ? { dueDate: new Date(structureDueDate) } : {}),
        });
        newStructure.totalFee = newStructure.feeHeads.reduce((s, h) => s + (h.amount || 0), 0);
        newStructure.totalPaid = 0;
        newStructure.totalBalance = newStructure.totalFee;
        newStructure.overallStatus = 'pending';
        await newStructure.save({ session });
        await syncStudentFeeDetails(student._id, newStructure, session);
        appliedCount += 1;
        appliedStudentIds.push(student._id);
        continue;
      }

      // Merge: index class heads by feeHeadId so we can update-in-place while
      // preserving the student's paidAmount on each head.
      const classHeadsMap = new Map();
      for (const fh of classStructure.feeHeads) {
        const id = (fh.feeHeadId || fh._id)?.toString();
        if (id) classHeadsMap.set(id, fh);
      }

      const merged = [];
      for (const existingFh of existing.feeHeads) {
        const id = existingFh.feeHeadId?.toString();
        const classFh = id ? classHeadsMap.get(id) : null;
        if (classFh) {
          const paidAmount = existingFh.paidAmount || 0;
          merged.push({
            feeHeadId: existingFh.feeHeadId,
            name: classFh.name || existingFh.name,
            category: classFh.category || existingFh.category,
            baseAmount: Number(classFh.amount || 0),
            amount: annualizedAmount(classFh),
            mandatory: classFh.mandatory !== undefined ? classFh.mandatory : existingFh.mandatory,
            frequency: classFh.frequency || existingFh.frequency,
            applicableTerms: classFh.applicableTerms || existingFh.applicableTerms,
            dueDay: classFh.dueDay ?? existingFh.dueDay,
            refundable: classFh.refundable ?? existingFh.refundable,
            paidAmount,
            ...computeFeeHeadStatus({ amount: annualizedAmount(classFh), paidAmount }),
          });
          classHeadsMap.delete(id);
        } else if ((existingFh.paidAmount || 0) > 0) {
          // Head no longer in the class structure, but the student has paid
          // towards it — keep it so payment history / refunds stay intact.
          merged.push(existingFh);
        }
      }

      // Add brand-new heads from the class structure.
      for (const classFh of classHeadsMap.values()) {
        merged.push({
          feeHeadId: classFh.feeHeadId || classFh._id,
          name: classFh.name,
          category: classFh.category,
          baseAmount: Number(classFh.amount || 0),
          amount: annualizedAmount(classFh),
          mandatory: classFh.mandatory,
          frequency: classFh.frequency,
          applicableTerms: classFh.applicableTerms,
          dueDay: classFh.dueDay,
          refundable: classFh.refundable,
          paidAmount: 0,
          balanceAmount: annualizedAmount(classFh),
          status: 'pending',
        });
      }

      existing.classId = classStructure.classId;
      existing.dueDate = structureDueDate ? new Date(structureDueDate) : undefined;
      existing.feeHeads = merged;
      existing.installments = buildStudentInstallments(classStructure, existing.installments || []);
      existing.totalFee = merged.reduce((s, h) => s + (h.amount || 0), 0);
      existing.totalPaid = merged.reduce((s, h) => s + (h.paidAmount || 0), 0);
      const { totalBalance, overallStatus } = computeFeeBalance(existing);
      existing.totalBalance = totalBalance;
      existing.overallStatus = overallStatus;
      await existing.save({ session });
      await syncStudentFeeDetails(student._id, existing, session);
      appliedCount += 1;
      appliedStudentIds.push(student._id);
    } catch (err) {
      logger.error({ err, studentId: student._id }, 'applyClassFeeStructure: student failed');
      failures.push({ studentId: student._id, message: err.message });
      if (abortOnError) throw err;
    }
  }

  return { appliedCount, appliedStudentIds, failures };
}

/**
 * Build the feeHeads array for a single student from the BEST available source:
 * the class FeeStructure (preferred) if one exists for the class+year, else the
 * global FeeHead catalogue via applicableClasses (the legacy fallback).
 *
 * Used by student-creation and class-change flows so a student joining a class
 * automatically inherits whatever structure the admin set for that class.
 *
 * @returns {Promise<{ feeHeads: Array, source: 'class'|'catalogue'|'none', classStructure: Object|null }>}
 */
export async function buildStudentFeeHeads({
  schoolId,
  classId,
  academicYear,
  classNameTokens = [],
}) {
  // 1. Prefer the class FeeStructure.
  const classStructure = await FeeStructure.findOne({
    schoolId,
    classId,
    academicYear,
  }).lean();
  if (classStructure && Array.isArray(classStructure.feeHeads) && classStructure.feeHeads.length) {
    return {
      feeHeads: classStructure.feeHeads.map((fh) => ({
        feeHeadId: fh.feeHeadId || fh._id,
        name: fh.name,
        category: fh.category,
        baseAmount: Number(fh.amount || 0),
        amount: annualizedAmount(fh),
        mandatory: fh.mandatory,
        frequency: fh.frequency,
        applicableTerms: fh.applicableTerms,
        dueDay: fh.dueDay,
        refundable: fh.refundable,
      })),
      source: 'class',
      classStructure,
    };
  }

  // 2. Fallback: global FeeHead catalogue.
  if (classNameTokens.length) {
    const applicable = await FeeHead.find({
      schoolId,
      applicableClasses: { $in: classNameTokens },
      isActive: true,
    }).lean();
    if (applicable.length) {
      return {
        feeHeads: applicable.map((fh) => ({
          feeHeadId: fh._id,
          name: fh.name,
          category: fh.category,
          baseAmount: Number(fh.amount || 0),
          amount: annualizedAmount(fh),
          mandatory: fh.mandatory,
          frequency: fh.frequency,
          applicableTerms: fh.applicableTerms,
          dueDay: fh.dueDay,
          refundable: fh.refundable,
        })),
        source: 'catalogue',
        classStructure: null,
      };
    }
  }

  return { feeHeads: [], source: 'none', classStructure: null };
}
