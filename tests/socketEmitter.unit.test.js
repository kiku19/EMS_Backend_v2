/**
 * Unit tests for utils/socketEmitter.js
 *
 * All tests are pure — no database, no HTTP.
 * We inject a mock Socket.IO instance to verify emit calls.
 *
 * NOTE: emitEvent() wraps payloads in a standard envelope:
 *   { event, timestamp, data: { ...eventData } }
 * Tests below account for this envelope structure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  initializeSocket,
  emitSocketEvent,
  emitFeeUpdate,
  emitFeePaymentCreated,
  emitStaffUpdate,
} from '../utils/socketEmitter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockIo() {
  return {
    emit: vi.fn(),
    to: vi.fn().mockReturnThis(),
  };
}

// Reset io to null between tests so state doesn't leak.
beforeEach(() => {
  initializeSocket(null);
});

// ---------------------------------------------------------------------------
// initializeSocket / emitSocketEvent
// ---------------------------------------------------------------------------

describe('emitSocketEvent', () => {
  it('does not throw and warns when socket is not initialized', () => {
    // Should not throw even when io is null
    expect(() => emitSocketEvent('test_event', { data: 1 })).not.toThrow();
  });

  it('calls io.emit with event name and envelope when socket is initialized', () => {
    const io = makeMockIo();
    initializeSocket(io);

    emitSocketEvent('my_event', { foo: 'bar' });

    expect(io.emit).toHaveBeenCalledTimes(1);
    const [eventName, envelope] = io.emit.mock.calls[0];
    expect(eventName).toBe('my_event');
    expect(envelope.event).toBe('my_event');
    expect(envelope.data).toEqual({ foo: 'bar' });
    expect(envelope.timestamp).toBeDefined();
  });

  it('does not call io.emit after socket is reset to null', () => {
    const io = makeMockIo();
    initializeSocket(io);
    initializeSocket(null);

    emitSocketEvent('my_event', {});

    expect(io.emit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// emitFeeUpdate
// ---------------------------------------------------------------------------

describe('emitFeeUpdate', () => {
  it('emits fee_structure_updated with correct payload', () => {
    const io = makeMockIo();
    initializeSocket(io);

    const feeData = {
      totalFee: 10000,
      totalPaid: 5000,
      totalBalance: 5000,
      overallStatus: 'partial',
    };

    emitFeeUpdate('student-id-1', 'Alice', feeData);

    const [eventName, envelope] = io.emit.mock.calls[0];
    expect(eventName).toBe('fee_structure_updated');
    expect(envelope.data).toEqual(
      expect.objectContaining({
        studentId: 'student-id-1',
        studentName: 'Alice',
        totalFee: 10000,
        totalPaid: 5000,
        totalBalance: 5000,
        overallStatus: 'partial',
      })
    );
  });

  it('emits student_fee_updated to the student room', () => {
    const io = makeMockIo();
    initializeSocket(io);

    emitFeeUpdate('student-id-2', 'Bob', {
      totalFee: 5000,
      totalPaid: 5000,
      totalBalance: 0,
      overallStatus: 'paid',
    });

    expect(io.to).toHaveBeenCalledWith('student:student-id-2');
    // The room emit is the second call (first is broadcast)
    const roomCall = io.emit.mock.calls.find((c) => c[0] === 'student_fee_updated');
    expect(roomCall).toBeDefined();
    expect(roomCall[1].data.studentId).toBe('student-id-2');
  });

  it('includes a timestamp in the envelope', () => {
    const io = makeMockIo();
    initializeSocket(io);

    emitFeeUpdate('s1', 'Carol', {
      totalFee: 0,
      totalPaid: 0,
      totalBalance: 0,
      overallStatus: 'paid',
    });

    const call = io.emit.mock.calls[0];
    expect(call[1].timestamp).toBeDefined();
    expect(typeof call[1].timestamp).toBe('string');
  });

  it('does not throw when socket is not initialized', () => {
    expect(() =>
      emitFeeUpdate('s1', 'Dave', {
        totalFee: 0,
        totalPaid: 0,
        totalBalance: 0,
        overallStatus: 'paid',
      })
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// emitFeePaymentCreated
// ---------------------------------------------------------------------------

describe('emitFeePaymentCreated', () => {
  it('emits fee_payment_created with payment details', () => {
    const io = makeMockIo();
    initializeSocket(io);

    const payment = {
      amount: 2000,
      paymentMode: 'cash',
      receiptNumber: 'RCP-001',
      paymentDate: '2026-01-15',
    };

    emitFeePaymentCreated('student-id-3', 'Eve', payment);

    const [eventName, envelope] = io.emit.mock.calls[0];
    expect(eventName).toBe('fee_payment_created');
    expect(envelope.data).toEqual(
      expect.objectContaining({
        studentId: 'student-id-3',
        studentName: 'Eve',
        payment: expect.objectContaining({
          amount: 2000,
          paymentMode: 'cash',
          receiptNumber: 'RCP-001',
        }),
      })
    );
  });

  it('includes fee totals when feeData is provided', () => {
    const io = makeMockIo();
    initializeSocket(io);

    const payment = {
      amount: 3000,
      paymentMode: 'upi',
      receiptNumber: 'RCP-002',
      paymentDate: '2026-01-20',
    };
    const feeData = {
      totalFee: 10000,
      totalPaid: 3000,
      totalBalance: 7000,
      overallStatus: 'partial',
    };

    emitFeePaymentCreated('s4', 'Frank', payment, feeData);

    const call = io.emit.mock.calls[0];
    expect(call[1].data.totalFee).toBe(10000);
    expect(call[1].data.totalPaid).toBe(3000);
    expect(call[1].data.overallStatus).toBe('partial');
  });

  it('does not include fee totals when feeData is omitted', () => {
    const io = makeMockIo();
    initializeSocket(io);

    const payment = {
      amount: 1000,
      paymentMode: 'cash',
      receiptNumber: 'RCP-003',
      paymentDate: '2026-01-25',
    };
    emitFeePaymentCreated('s5', 'Grace', payment);

    const call = io.emit.mock.calls[0];
    expect(call[1].data.totalFee).toBeUndefined();
  });

  it('emits student_fee_updated to the student room', () => {
    const io = makeMockIo();
    initializeSocket(io);

    emitFeePaymentCreated('s6', 'Hank', {
      amount: 500,
      paymentMode: 'card',
      receiptNumber: 'R4',
      paymentDate: '2026-01-01',
    });

    expect(io.to).toHaveBeenCalledWith('student:s6');
  });

  it('does not throw when socket is not initialized', () => {
    expect(() =>
      emitFeePaymentCreated('s7', 'Ivy', {
        amount: 100,
        paymentMode: 'cash',
        receiptNumber: 'R5',
        paymentDate: '2026-01-01',
      })
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// emitStaffUpdate
// ---------------------------------------------------------------------------

describe('emitStaffUpdate', () => {
  it('emits staff_updated with required fields', () => {
    const io = makeMockIo();
    initializeSocket(io);

    emitStaffUpdate('staff-id-1', ['name', 'phone'], 'web_dashboard');

    const [eventName, envelope] = io.emit.mock.calls[0];
    expect(eventName).toBe('staff_updated');
    expect(envelope.data).toEqual(
      expect.objectContaining({
        staffId: 'staff-id-1',
        fieldsChanged: ['name', 'phone'],
        source: 'web_dashboard',
      })
    );
  });

  it('includes optional staffData fields when provided', () => {
    const io = makeMockIo();
    initializeSocket(io);

    emitStaffUpdate('staff-id-2', ['name'], 'mobile_app', {
      name: 'John',
      role: ['Teacher'],
      email: 'john@example.com',
    });

    const call = io.emit.mock.calls[0];
    expect(call[1].data.name).toBe('John');
    expect(call[1].data.role).toEqual(['Teacher']);
    expect(call[1].data.email).toBe('john@example.com');
  });

  it('omits optional staffData fields that are falsy', () => {
    const io = makeMockIo();
    initializeSocket(io);

    emitStaffUpdate('staff-id-3', ['status'], 'web_dashboard', { name: null, role: null });

    const call = io.emit.mock.calls[0];
    expect(call[1].data.name).toBeUndefined();
    expect(call[1].data.role).toBeUndefined();
  });

  it('includes a timestamp', () => {
    const io = makeMockIo();
    initializeSocket(io);

    emitStaffUpdate('staff-id-4', ['department'], 'web_dashboard');

    const call = io.emit.mock.calls[0];
    expect(typeof call[1].timestamp).toBe('string');
  });

  it('does not throw when socket is not initialized', () => {
    expect(() => emitStaffUpdate('staff-id-5', ['name'], 'web_dashboard')).not.toThrow();
  });
});
