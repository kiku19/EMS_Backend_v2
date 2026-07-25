/**
 * Reconcile student fee ledgers with their class fee structure.
 *
 * Older ledgers stored a monthly/quarterly/term amount as though it were the
 * full-year amount and did not persist installment balances. The class fee
 * structure is the source of truth. This migration keeps a reversible backup,
 * preserves every paid amount, and deterministically allocates historical
 * payments to the oldest installments when no installment history exists.
 */

export const description = 'Annualize periodic student fee heads and backfill installment balances';

function annualizedAmount(head) {
  const amount = Number(head?.amount || 0);
  if (head?.frequency === 'monthly') return amount * 12;
  if (head?.frequency === 'quarterly') return amount * 4;
  if (head?.frequency === 'term') {
    const count =
      Array.isArray(head.applicableTerms) && head.applicableTerms.length
        ? head.applicableTerms.length
        : 2;
    return amount * count;
  }
  return amount;
}

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right);
}

function matchSourceHead(studentHead, sourceHeads) {
  return sourceHeads.find(
    (source) =>
      sameId(studentHead.feeHeadId, source.feeHeadId || source._id) ||
      String(studentHead.name || '')
        .trim()
        .toLowerCase() ===
        String(source.name || '')
          .trim()
          .toLowerCase()
  );
}

export function reconcileLedger(ledger, classStructure, now = new Date()) {
  const sourceHeads = classStructure?.feeHeads || [];
  const feeHeads = (ledger.feeHeads || []).map((head) => {
    const source = matchSourceHead(head, sourceHeads);
    if (!source) return { ...head };
    const amount = annualizedAmount(source);
    const paidAmount = Number(head.paidAmount || 0);
    return {
      ...head,
      baseAmount: Number(source.amount || 0),
      amount,
      frequency: source.frequency || head.frequency,
      applicableTerms: source.applicableTerms || head.applicableTerms,
      dueDay: source.dueDay ?? head.dueDay,
      refundable: source.refundable ?? head.refundable,
      paidAmount,
      balanceAmount: Math.max(amount - paidAmount, 0),
      status: amount - paidAmount <= 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'pending',
    };
  });

  const totalFee = feeHeads.reduce((sum, head) => sum + Number(head.amount || 0), 0);
  const existingInstallments = ledger.installments || [];
  const sourceInstallments = classStructure?.collectionSchedule?.installments || [];
  const installmentTotal = sourceInstallments.reduce(
    (sum, installment) => sum + Number(installment.amount || 0),
    0
  );
  const paidForInstallments = Math.min(Number(ledger.totalPaid || 0), installmentTotal);
  const matchedExistingInstallments = sourceInstallments.map((source, index) =>
    existingInstallments.find(
      (candidate, candidateIndex) =>
        candidateIndex === index ||
        String(candidate.name || '')
          .trim()
          .toLowerCase() ===
          String(source.name || '')
            .trim()
            .toLowerCase()
    )
  );

  // Some legacy ledgers contain a partially populated installment array. The
  // tracked rows are already included in totalPaid, so reserve those amounts
  // first and distribute only the genuinely unallocated remainder. Starting
  // with totalPaid for every missing row would count the tracked amount twice.
  let trackedPaidBudget = paidForInstallments;
  const preservedPaidAmounts = matchedExistingInstallments.map((existing, index) => {
    if (!existing) return null;
    const sourceAmount = Number(sourceInstallments[index]?.amount || 0);
    const preserved = Math.min(
      Math.max(Number(existing.paidAmount || 0), 0),
      sourceAmount,
      trackedPaidBudget
    );
    trackedPaidBudget = Math.max(trackedPaidBudget - preserved, 0);
    return preserved;
  });
  let unallocatedPaid = trackedPaidBudget;
  const installments = sourceInstallments.map((source, index) => {
    const existing = matchedExistingInstallments[index];
    const amount = Number(source.amount || 0);
    const paidAmount = existing ? preservedPaidAmounts[index] : Math.min(unallocatedPaid, amount);
    if (!existing) unallocatedPaid = Math.max(unallocatedPaid - paidAmount, 0);
    const balanceAmount = Math.max(amount - paidAmount, 0);
    const dueDate = source.dueDate ? new Date(source.dueDate) : null;
    return {
      name: source.name || `Installment ${index + 1}`,
      dueDate,
      amount,
      paidAmount,
      balanceAmount,
      status:
        balanceAmount <= 0
          ? 'paid'
          : paidAmount > 0
            ? 'partial'
            : dueDate && dueDate < now
              ? 'overdue'
              : 'pending',
    };
  });

  const totalBalance = Math.max(
    totalFee - Number(ledger.totalPaid || 0) - Number(ledger.discountApplied || 0),
    0
  );
  const dueDate =
    installments
      .map((item) => item.dueDate)
      .filter(Boolean)
      .sort((a, b) => a - b)[0] ||
    ledger.dueDate ||
    null;
  const overallStatus =
    totalBalance <= 0
      ? 'paid'
      : dueDate && new Date(dueDate) < now
        ? 'overdue'
        : Number(ledger.totalPaid || 0) > 0
          ? 'partial'
          : 'pending';

  return {
    feeHeads,
    installments,
    totalFee,
    totalBalance,
    dueDate,
    overallStatus,
  };
}

async function collectionExists(db, name) {
  return (await db.listCollections({ name }).toArray()).length > 0;
}

export async function up(db, { dryRun }) {
  if (!(await collectionExists(db, 'studentfeestructures'))) return;
  const ledgers = await db.collection('studentfeestructures').find({}).toArray();
  const operations = [];
  let noClassStructure = 0;

  for (const ledger of ledgers) {
    const classStructure = await db.collection('feestructures').findOne({
      schoolId: ledger.schoolId,
      classId: ledger.classId,
      academicYear: ledger.academicYear,
      isActive: { $ne: false },
    });
    if (!classStructure) {
      noClassStructure += 1;
      continue;
    }
    const reconciled = reconcileLedger(ledger, classStructure);
    const before = {
      feeHeads: ledger.feeHeads || [],
      installments: ledger.installments || [],
      totalFee: ledger.totalFee,
      totalBalance: ledger.totalBalance,
      dueDate: ledger.dueDate,
      overallStatus: ledger.overallStatus,
    };
    if (JSON.stringify(before) === JSON.stringify(reconciled)) continue;
    operations.push({
      updateOne: {
        filter: { _id: ledger._id, 'migrationBackups.feeAnnualization014': { $exists: false } },
        update: {
          $set: {
            ...reconciled,
            'migrationBackups.feeAnnualization014': before,
          },
        },
      },
    });
  }

  console.log(
    `    [SCAN] student fee ledgers: ${operations.length} updates, ${noClassStructure} without a class structure (left unchanged)`
  );
  if (!dryRun && operations.length) {
    await db.collection('studentfeestructures').bulkWrite(operations, { ordered: false });
  }
}

export async function down(db, { dryRun }) {
  if (!(await collectionExists(db, 'studentfeestructures'))) return;
  const ledgers = await db
    .collection('studentfeestructures')
    .find({ 'migrationBackups.feeAnnualization014': { $exists: true } })
    .toArray();
  console.log(`    [SCAN] ${ledgers.length} student fee ledgers can be restored`);
  if (dryRun || !ledgers.length) return;
  await db.collection('studentfeestructures').bulkWrite(
    ledgers.map((ledger) => ({
      updateOne: {
        filter: { _id: ledger._id },
        update: {
          $set: ledger.migrationBackups.feeAnnualization014,
          $unset: { 'migrationBackups.feeAnnualization014': '' },
        },
      },
    })),
    { ordered: false }
  );
}
