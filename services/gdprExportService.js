/**
 * GDPR Data Portability Export Service
 *
 * Collects all personal data held for a given entity (Student or Staff)
 * and returns it in a structured format suitable for JSON or CSV export.
 */

import { Student, Staff, Attendance, Result, FeePayment, FeeRefund } from '../database.js';
import ConsentRecord from '../models/ConsentRecord.js';
import Parent from '../models/Parent.js';
import Remark from '../models/Remark.js';
import StaffAttendance from '../models/StaffAttendance.js';
import PayrollRecord from '../models/PayrollRecord.js';
import Notification from '../models/Notification.js';
import TeacherLeave from '../models/TeacherLeave.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';

// ─── Student Export ───────────────────────────────────────────────────────────

async function exportStudentData(studentId, schoolId) {
  const student = await Student.findOne({ _id: studentId, schoolId }).lean();
  if (!student) return null;

  const [
    attendance,
    results,
    feePayments,
    feeRefunds,
    feeStructures,
    remarks,
    notifications,
    consents,
    parents,
  ] = await Promise.all([
    Attendance.find({ studentId, schoolId }).lean(),
    Result.find({ studentId, schoolId }).lean(),
    FeePayment.find({ studentId, schoolId }).lean(),
    FeeRefund.find({ studentId, schoolId }).lean(),
    StudentFeeStructure.find({ studentId, schoolId }).lean(),
    Remark.find({ studentId, schoolId }).lean(),
    Notification.find({ userId: studentId, userModel: 'Student' }).lean(),
    ConsentRecord.find({ entityId: studentId, entityType: 'Student', schoolId }).lean(),
    Parent.find({ 'children.studentId': studentId }).select('name phone email').lean(),
  ]);

  return {
    profile: student,
    attendance,
    academics: { results },
    fees: { feePayments, feeRefunds, feeStructures },
    remarks,
    notifications,
    consents,
    linkedParents: parents,
  };
}

// ─── Staff Export ─────────────────────────────────────────────────────────────

async function exportStaffData(staffId, schoolId) {
  const staff = await Staff.findOne({ _id: staffId, schoolId }).lean();
  if (!staff) return null;

  const [attendance, leaves, payroll, notifications, consents] = await Promise.all([
    StaffAttendance.find({ staffId, schoolId }).lean(),
    TeacherLeave.find({ teacherId: staffId, schoolId }).lean(),
    PayrollRecord.find({ employeeId: staffId, schoolId }).lean(),
    Notification.find({ userId: staffId, userModel: 'Staff' }).lean(),
    ConsentRecord.find({ entityId: staffId, entityType: 'Staff', schoolId }).lean(),
  ]);

  return {
    profile: staff,
    attendance,
    leaves,
    payroll,
    notifications,
    consents,
  };
}

// ─── CSV Flattener ────────────────────────────────────────────────────────────

/**
 * Flattens the nested export data into a CSV-friendly array of rows.
 * Each row has a `section` and the relevant record fields.
 */
export function flattenForCsv(data, entityType) {
  const rows = [];

  function flattenObject(obj, prefix = '') {
    const result = {};
    for (const [k, v] of Object.entries(obj || {})) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        Object.assign(result, flattenObject(v, key));
      } else {
        result[key] = v instanceof Date ? v.toISOString() : (v ?? '');
      }
    }
    return result;
  }

  function addSection(section, records) {
    if (!Array.isArray(records)) records = [records];
    for (const record of records) {
      rows.push({ section, ...flattenObject(record) });
    }
  }

  if (entityType === 'Student') {
    addSection('profile', [data.profile]);
    addSection('attendance', data.attendance);
    addSection('results', data.academics?.results);
    addSection('feePayments', data.fees?.feePayments);
    addSection('feeRefunds', data.fees?.feeRefunds);
    addSection('feeStructures', data.fees?.feeStructures);
    addSection('remarks', data.remarks);
    addSection('consents', data.consents);
  } else if (entityType === 'Staff') {
    addSection('profile', [data.profile]);
    addSection('attendance', data.attendance);
    addSection('leaves', data.leaves);
    addSection('payroll', data.payroll);
    addSection('consents', data.consents);
  }

  return rows;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Export all personal data for an entity.
 *
 * @param {'Student'|'Staff'} entityType
 * @param {string} entityId
 * @param {string} schoolId
 * @returns {Promise<object|null>} Structured data object, or null if not found
 */
export async function exportEntityData(entityType, entityId, schoolId) {
  if (entityType === 'Student') {
    return exportStudentData(entityId, schoolId);
  }
  if (entityType === 'Staff') {
    return exportStaffData(entityId, schoolId);
  }
  throw new Error(`Unsupported entityType: ${entityType}`);
}
