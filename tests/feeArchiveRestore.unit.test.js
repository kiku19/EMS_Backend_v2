import { describe, it, expect, beforeEach } from 'vitest';
import TrashItem from '../models/TrashItem.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import FeePayment from '../models/FeePayment.js';
import FeeRefund from '../models/FeeRefund.js';
import { archiveStudent } from '../services/studentArchiveService.js';
import { restoreTrashItem } from '../services/trashService.js';
import {
  createClassRecord,
  createSchoolRecord,
  createStaffUser,
  createStudentRecord,
} from './helpers/factories.js';

// Regression guard for the orphaned-fee leak fix at the SOURCE layer:
// archiving a Student must soft-delete that student's StudentFeeStructure,
// FeePayment, and FeeRefund records, and restoring the Student from trash
// must bring them back. Without this, archive+restore permanently hid a
// student's fee history even after the Student itself was restored.
//
// (tests/feesOrphanLeak.routes.test.js guards the complementary DISPLAY layer:
// that the four summary endpoints never surface an archived student's fees.)

const YEAR = '2025-26';

describe('archive/restore cascades soft-delete to fee collections', () => {
  let school;
  let classA;
  let student;
  let staff;
  let sfs;
  let payment;
  let refund;

  beforeEach(async () => {
    school = await createSchoolRecord({ name: 'Fee Cascade School' });
    staff = await createStaffUser({ schoolId: school._id, name: 'Archiver' });

    classA = await createClassRecord({
      schoolId: school._id,
      name: 'Class 1',
      section: 'A',
      academicYear: YEAR,
    });

    student = await createStudentRecord({
      schoolId: school._id,
      classId: classA._id,
      academicYear: YEAR,
      name: 'Cascade Student',
    });

    sfs = await StudentFeeStructure.create({
      schoolId: school._id,
      academicYear: YEAR,
      classId: classA._id,
      studentId: student._id,
      totalFee: 10000,
      totalPaid: 4000,
      totalBalance: 6000,
      overallStatus: 'partial',
      feeHeads: [],
    });

    payment = await FeePayment.create({
      schoolId: school._id,
      academicYear: YEAR,
      classId: classA._id,
      studentId: student._id,
      receiptNumber: `RCP-${student._id}`,
      paymentDate: '2025-06-01',
      amount: 4000,
      paymentMode: 'cash',
      status: 'completed',
      feeHeads: [],
    });

    refund = await FeeRefund.create({
      schoolId: school._id,
      academicYear: YEAR,
      classId: classA._id,
      studentId: student._id,
      refundNumber: `REF-${student._id}`,
      refundDate: '2025-06-02',
      amount: 500,
      reason: 'overpayment',
      refundMode: 'cash',
      status: 'pending',
    });
  });

  it('soft-deletes StudentFeeStructure, FeePayment, and FeeRefund on archive', async () => {
    const archivedAt = new Date();
    await archiveStudent({
      studentId: student._id,
      schoolId: school._id,
      deletedBy: staff._id,
    });

    const [sfsAfter, payAfter, refAfter] = await Promise.all([
      StudentFeeStructure.findById(sfs._id).lean(),
      FeePayment.findById(payment._id).lean(),
      FeeRefund.findById(refund._id).lean(),
    ]);

    expect(sfsAfter.isDeleted).toBe(true);
    expect(sfsAfter.deletedBy?.toString()).toBe(String(staff._id));
    expect(new Date(sfsAfter.deletedAt).getTime()).toBeGreaterThanOrEqual(
      archivedAt.getTime() - 1000
    );

    expect(payAfter.isDeleted).toBe(true);
    expect(payAfter.deletedBy?.toString()).toBe(String(staff._id));

    expect(refAfter.isDeleted).toBe(true);
    expect(refAfter.deletedBy?.toString()).toBe(String(staff._id));
  });

  it('restores all three fee collections when the Student is restored from trash', async () => {
    const { trashItem } = await archiveStudent({
      studentId: student._id,
      schoolId: school._id,
      deletedBy: staff._id,
    });

    // Sanity: archive flagged all three.
    expect(await StudentFeeStructure.findById(sfs._id).select('isDeleted')).toMatchObject({
      isDeleted: true,
    });

    await restoreTrashItem(trashItem);

    const [sfsAfter, payAfter, refAfter] = await Promise.all([
      StudentFeeStructure.findById(sfs._id).lean(),
      FeePayment.findById(payment._id).lean(),
      FeeRefund.findById(refund._id).lean(),
    ]);

    expect(sfsAfter.isDeleted).toBe(false);
    expect(sfsAfter.deletedAt).toBeNull();
    expect(sfsAfter.deletedBy).toBeNull();
    expect(payAfter.isDeleted).toBe(false);
    expect(payAfter.deletedAt).toBeNull();
    expect(refAfter.isDeleted).toBe(false);
    expect(refAfter.deletedAt).toBeNull();
  });

  it('only restores fee docs matching the cascadeDeletedAt timestamp (not unrelated soft-deletes)', async () => {
    // An unrelated soft-deleted SFS for a DIFFERENT timestamp must NOT be
    // swept up by the Student restore (cascadeFilter matches deletedAt).
    const otherStudent = await createStudentRecord({
      schoolId: school._id,
      classId: classA._id,
      academicYear: YEAR,
      name: 'Other Student',
    });
    const otherSfs = await StudentFeeStructure.create({
      schoolId: school._id,
      academicYear: YEAR,
      classId: classA._id,
      studentId: otherStudent._id,
      totalFee: 500,
      totalBalance: 500,
      feeHeads: [],
    });
    await StudentFeeStructure.updateOne(
      { _id: otherSfs._id },
      { $set: { isDeleted: true, deletedAt: new Date(2020, 0, 1) } }
    );

    const { trashItem } = await archiveStudent({
      studentId: student._id,
      schoolId: school._id,
      deletedBy: staff._id,
    });
    await restoreTrashItem(trashItem);

    const otherAfter = await StudentFeeStructure.findById(otherSfs._id).lean();
    expect(otherAfter.isDeleted).toBe(true); // untouched — wrong timestamp
  });

  it('leaves the trash entry for the restored student', async () => {
    const { trashItem } = await archiveStudent({
      studentId: student._id,
      schoolId: school._id,
      deletedBy: staff._id,
    });
    await restoreTrashItem(trashItem);

    // restoreTrashItem (Student branch) does not delete its own trash row —
    // the caller (trash route) owns that. We only assert the fee cascade here.
    const stillThere = await TrashItem.findById(trashItem._id).lean();
    expect(stillThere).toBeTruthy();
  });
});
