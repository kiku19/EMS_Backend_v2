/**
 * Background processing service for large bulk imports (>500 rows)
 * Called by Agenda job definitions in config/agenda.js
 */

import mongoose from 'mongoose';
import crypto from 'crypto';
import { Class, Staff, Student, StudentFeeStructure, FeePayment } from '../database.js';
import FeeHead from '../models/FeeHead.js';
import ImportJob from '../models/ImportJob.js';
import { studentRowSchema, staffRowSchema } from '../validators/bulkImportSchema.js';
import { getNextStaffCode } from '../database.js';
import { createLogger } from '../utils/logger.js';
import { sendBulkSMS } from '../config/sms.js';

const logger = createLogger('BulkImportService');

// ─── HELPERS ─────────────────────────────────────────────────────

function generatePassword(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(crypto.randomInt(chars.length));
  }
  return password;
}

async function ensureUniqueUsername(baseUsername, schoolId) {
  let username = baseUsername;
  let suffix = 1;
  while (await Staff.findOne({ schoolId, username, isDeleted: { $ne: true } })) {
    username = `${baseUsername}${suffix}`;
    suffix++;
  }
  return username;
}

async function initializeStudentFeeStructure(student) {
  const classInfo = await Class.findById(student.classId);
  if (!classInfo) return;

  const classNumber = classInfo.name.replace('Class ', '');
  const applicableFeeHeads = await FeeHead.find({
    schoolId: student.schoolId,
    applicableClasses: classNumber,
    academicYear: student.academicYear,
    isActive: true,
  });
  if (!applicableFeeHeads.length) return;

  const feeStructure = new StudentFeeStructure({
    studentId: student._id,
    classId: student.classId,
    academicYear: student.academicYear,
    schoolId: student.schoolId,
    feeHeads: applicableFeeHeads.map((fh) => ({
      feeHeadId: fh._id,
      name: fh.name,
      category: fh.category,
      amount: fh.amount,
      mandatory: fh.mandatory,
      frequency: fh.frequency,
      paidAmount: 0,
      balanceAmount: fh.amount,
      status: 'pending',
    })),
  });
  feeStructure.totalFee = feeStructure.feeHeads.reduce((s, fh) => s + fh.amount, 0);
  feeStructure.totalPaid = 0;
  feeStructure.totalBalance = feeStructure.totalFee;
  feeStructure.overallStatus = 'pending';
  await feeStructure.save();
}

// ─── BULK STUDENT IMPORT (background) ───────────────────────────

export async function processBulkStudentImport(jobId, schoolId, rows) {
  const job = await ImportJob.findById(jobId);
  if (!job) {
    logger.error({ jobId }, 'ImportJob not found for bulk student import');
    return;
  }

  const schoolObjId = new mongoose.Types.ObjectId(schoolId);
  const createdIds = [];
  const rowResults = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  job.status = 'running';
  job.totalRows = rows.length;
  await job.save();

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2;
    const raw = rows[i];

    const parsed = studentRowSchema.safeParse({
      name: raw.name,
      admissionId: raw.admissionid || raw.admissionId || raw.admission_id,
      academicYear: raw.academicyear || raw.academicYear || raw.academic_year,
      className: raw.classname || raw.className || raw.class,
      section: raw.section,
      rollNo: raw.rollno || raw.rollNo || raw.roll_no || undefined,
      gender: raw.gender || undefined,
      dateOfBirth: raw.dateofbirth || raw.dateOfBirth || raw.dob || raw.date_of_birth || undefined,
      parentName: raw.parentname || raw.parentName || raw.parent_name,
      parentPhone: raw.parentphone || raw.parentPhone || raw.parent_phone || undefined,
      parentEmail: raw.parentemail || raw.parentEmail || raw.parent_email || undefined,
      phone: raw.phone || undefined,
      email: raw.email || undefined,
      address: raw.address || undefined,
    });

    if (!parsed.success) {
      const errors = parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      rowResults.push({
        row: rowNum,
        identifier: raw.admissionid || raw.admissionId || '?',
        status: 'failed',
        error: errors,
      });
      failed++;
      continue;
    }

    const data = parsed.data;
    const classNameFull = data.className.startsWith('Class ')
      ? data.className
      : `Class ${data.className}`;
    const classDoc = await Class.findOne({
      schoolId: schoolObjId,
      name: classNameFull,
      section: data.section.toUpperCase(),
      isDeleted: { $ne: true },
    });

    if (!classDoc) {
      rowResults.push({
        row: rowNum,
        identifier: data.admissionId,
        status: 'failed',
        error: `Class '${data.className}-${data.section}' not found`,
      });
      failed++;
      continue;
    }

    const existing = await Student.findOne({
      schoolId: schoolObjId,
      admissionId: data.admissionId,
      isDeleted: { $ne: true },
    });
    if (existing) {
      rowResults.push({
        row: rowNum,
        identifier: data.admissionId,
        status: 'skipped',
        error: 'Admission ID already exists',
      });
      skipped++;
      continue;
    }

    try {
      const student = new Student({
        schoolId: schoolObjId,
        name: data.name,
        admissionId: data.admissionId,
        academicYear: data.academicYear,
        classId: classDoc._id,
        rollNo: data.rollNo || undefined,
        gender: data.gender || undefined,
        dateOfBirth: data.dateOfBirth || undefined,
        parents: [
          {
            name: data.parentName,
            phone: data.parentPhone || undefined,
            email: data.parentEmail || undefined,
            relationship: 'Parent',
            isWhatsapp: false,
          },
        ],
        parentName: data.parentName,
        parentPhone: data.parentPhone || undefined,
        parentEmail: data.parentEmail || undefined,
        phone: data.phone || undefined,
        email: data.email || undefined,
        address: data.address || undefined,
        feeStatus: 'pending',
        status: 'active',
      });
      await student.save();
      await initializeStudentFeeStructure(student);
      createdIds.push(student._id);
      rowResults.push({ row: rowNum, identifier: data.admissionId, status: 'imported' });
      imported++;
    } catch (err) {
      logger.error({ err, rowNum }, 'Student save error in background import');
      rowResults.push({
        row: rowNum,
        identifier: data.admissionId,
        status: 'failed',
        error: err.message,
      });
      failed++;
    }

    // Periodically save progress (every 50 rows)
    if ((i + 1) % 50 === 0) {
      job.processedRows = i + 1;
      job.importedCount = imported;
      job.skippedCount = skipped;
      job.failedCount = failed;
      await job.save();
    }
  }

  job.status = 'completed';
  job.processedRows = rows.length;
  job.importedCount = imported;
  job.skippedCount = skipped;
  job.failedCount = failed;
  job.rows = rowResults;
  job.createdIds = createdIds;
  job.completedAt = new Date();
  await job.save();

  logger.info({ jobId, imported, skipped, failed }, 'Bulk student import complete');
}

// ─── BULK STAFF IMPORT (background) ─────────────────────────────

export async function processBulkStaffImport(jobId, schoolId, rows) {
  const job = await ImportJob.findById(jobId);
  if (!job) {
    logger.error({ jobId }, 'ImportJob not found for bulk staff import');
    return;
  }

  const schoolObjId = new mongoose.Types.ObjectId(schoolId);
  const createdIds = [];
  const rowResults = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  job.status = 'running';
  job.totalRows = rows.length;
  await job.save();

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2;
    const raw = rows[i];

    const parsed = staffRowSchema.safeParse({
      name: raw.name,
      role: raw.role,
      department: raw.department || undefined,
      phone: raw.phone || undefined,
      email: raw.email || undefined,
      gender: raw.gender || undefined,
      joinDate: raw.joindate || raw.joinDate || raw.join_date || undefined,
      designation: raw.designation || undefined,
      salary: raw.salary || undefined,
    });

    if (!parsed.success) {
      const errors = parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      rowResults.push({
        row: rowNum,
        identifier: raw.name || '?',
        status: 'failed',
        error: errors,
      });
      failed++;
      continue;
    }

    const data = parsed.data;

    if (data.email) {
      const existing = await Staff.findOne({
        schoolId: schoolObjId,
        email: data.email.toLowerCase(),
        isDeleted: { $ne: true },
      });
      if (existing) {
        rowResults.push({
          row: rowNum,
          identifier: data.name,
          status: 'skipped',
          error: `Email already in use by ${existing.name}`,
        });
        skipped++;
        continue;
      }
    }

    try {
      const code = await getNextStaffCode(schoolObjId);
      const baseUsername = data.email ? data.email.split('@')[0].toLowerCase() : code.toLowerCase();
      const username = await ensureUniqueUsername(baseUsername, schoolObjId);
      const password = generatePassword(8);

      const staff = new Staff({
        schoolId: schoolObjId,
        code,
        name: data.name,
        role: [data.role],
        department: data.department || 'General',
        status: 'active',
        phone: data.phone || undefined,
        email: data.email ? data.email.toLowerCase() : undefined,
        joinDate: data.joinDate || undefined,
        designation: data.designation || undefined,
        gender: data.gender || undefined,
        salary: data.salary || undefined,
        username,
        password,
      });
      await staff.save();
      createdIds.push(staff._id);
      rowResults.push({ row: rowNum, identifier: data.name, status: 'imported' });
      imported++;
    } catch (err) {
      logger.error({ err, rowNum }, 'Staff save error in background import');
      rowResults.push({ row: rowNum, identifier: data.name, status: 'failed', error: err.message });
      failed++;
    }

    if ((i + 1) % 50 === 0) {
      job.processedRows = i + 1;
      job.importedCount = imported;
      job.skippedCount = skipped;
      job.failedCount = failed;
      await job.save();
    }
  }

  job.status = 'completed';
  job.processedRows = rows.length;
  job.importedCount = imported;
  job.skippedCount = skipped;
  job.failedCount = failed;
  job.rows = rowResults;
  job.createdIds = createdIds;
  job.completedAt = new Date();
  await job.save();

  logger.info({ jobId, imported, skipped, failed }, 'Bulk staff import complete');
}

// ─── BULK NOTIFICATION ───────────────────────────────────────────

export async function processBulkNotification(schoolId, students, message, channel) {
  let smsSent = 0;

  if (channel === 'sms' || channel === 'both') {
    const smsList = students
      .filter((s) => s.parentPhone)
      .map((s) => ({ to: s.parentPhone, message }));
    if (smsList.length > 0) {
      try {
        await sendBulkSMS(smsList);
        smsSent = smsList.length;
      } catch (err) {
        logger.error({ err }, 'Bulk SMS send failed');
      }
    }
  }

  logger.info({ schoolId, total: students.length, smsSent, channel }, 'Bulk notification complete');
}
