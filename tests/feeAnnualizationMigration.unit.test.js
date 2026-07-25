import { describe, expect, it } from 'vitest';
import { reconcileLedger } from '../migrations/014_fee_structure_annualization_and_installments.js';

describe('fee annualization migration', () => {
  it('annualizes periodic heads and preserves historical paid totals', () => {
    const reconciled = reconcileLedger(
      {
        totalPaid: 1500,
        feeHeads: [
          {
            name: 'Tuition',
            amount: 1000,
            paidAmount: 1500,
            balanceAmount: 0,
          },
        ],
      },
      {
        feeHeads: [{ name: 'Tuition', amount: 1000, frequency: 'monthly' }],
        collectionSchedule: {
          installments: [
            { name: 'April', amount: 1000, dueDate: '2099-04-10' },
            { name: 'May', amount: 1000, dueDate: '2099-05-10' },
          ],
        },
      }
    );

    expect(reconciled.feeHeads[0]).toMatchObject({
      baseAmount: 1000,
      amount: 12000,
      paidAmount: 1500,
      balanceAmount: 10500,
      status: 'partial',
    });
    expect(reconciled.installments).toMatchObject([
      { name: 'April', paidAmount: 1000, balanceAmount: 0, status: 'paid' },
      { name: 'May', paidAmount: 500, balanceAmount: 500, status: 'partial' },
    ]);
    expect(reconciled.totalFee).toBe(12000);
    expect(reconciled.totalBalance).toBe(10500);
  });

  it('preserves installment-specific history when it already exists', () => {
    const reconciled = reconcileLedger(
      {
        totalPaid: 500,
        feeHeads: [],
        installments: [
          { name: 'Term 1', amount: 1000, paidAmount: 200 },
          { name: 'Term 2', amount: 1000, paidAmount: 300 },
        ],
      },
      {
        feeHeads: [],
        collectionSchedule: {
          installments: [
            { name: 'Term 1', amount: 1000 },
            { name: 'Term 2', amount: 1000 },
          ],
        },
      }
    );

    expect(reconciled.installments.map((item) => item.paidAmount)).toEqual([200, 300]);
  });

  it('does not allocate already-tracked payments a second time when history is partial', () => {
    const reconciled = reconcileLedger(
      {
        totalPaid: 500,
        feeHeads: [],
        installments: [{ name: 'Term 1', amount: 1000, paidAmount: 500 }],
      },
      {
        feeHeads: [],
        collectionSchedule: {
          installments: [
            { name: 'Term 1', amount: 1000 },
            { name: 'Term 2', amount: 1000 },
          ],
        },
      }
    );

    expect(reconciled.installments.map((item) => item.paidAmount)).toEqual([500, 0]);
    expect(
      reconciled.installments.reduce((sum, installment) => sum + installment.paidAmount, 0)
    ).toBe(500);
  });
});
