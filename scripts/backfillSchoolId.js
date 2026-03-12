import dotenv from 'dotenv';
import mongoose, { connectDB } from '../database.js';
import {
  Staff,
  Student,
  Class,
  Attendance,
  Exam,
  Result,
  TeacherTimetable,
  Substitution,
  Appointment,
  FeePayment,
} from '../database.js';
import Announcement from '../models/Announcement.js';
import StaffAttendance from '../models/StaffAttendance.js';
import GatePass from '../models/GatePass.js';
import StudentFeeStructure from '../models/StudentFeeStructure.js';
import { ensureDefaultSchool } from '../utils/schoolContext.js';

dotenv.config();

async function backfillCollection(Model, schoolId, label) {
  const alreadyHave = await Model.countDocuments({ schoolId: { $exists: true, $ne: null } });
  const result = await Model.updateMany(
    { $or: [{ schoolId: { $exists: false } }, { schoolId: null }] },
    { $set: { schoolId } }
  );
  const updated = result.modifiedCount ?? result.nModified ?? 0;
  console.log(`  ${label}: ${updated} docs updated, ${alreadyHave} docs already had schoolId`);
  return { label, updated, alreadyHave };
}

async function run() {
  try {
    await connectDB();
    console.log('Connected to MongoDB');

    const school = await ensureDefaultSchool();
    const schoolId = school._id;
    console.log(`Using default school: "${school.name}" (${schoolId})\n`);

    const results = [];

    results.push(await backfillCollection(Staff,               schoolId, 'Staff'));
    results.push(await backfillCollection(Student,             schoolId, 'Student'));
    results.push(await backfillCollection(Class,               schoolId, 'Class'));
    results.push(await backfillCollection(Attendance,          schoolId, 'Attendance'));
    results.push(await backfillCollection(Exam,                schoolId, 'Exam'));
    results.push(await backfillCollection(Result,              schoolId, 'Result'));
    results.push(await backfillCollection(TeacherTimetable,    schoolId, 'TeacherTimetable'));
    results.push(await backfillCollection(Substitution,        schoolId, 'Substitution'));
    results.push(await backfillCollection(Appointment,         schoolId, 'Appointment'));
    results.push(await backfillCollection(Announcement,        schoolId, 'Announcement'));
    results.push(await backfillCollection(StaffAttendance,     schoolId, 'StaffAttendance'));
    results.push(await backfillCollection(GatePass,            schoolId, 'GatePass'));
    results.push(await backfillCollection(StudentFeeStructure, schoolId, 'StudentFeeStructure'));
    results.push(await backfillCollection(FeePayment,          schoolId, 'FeePayment'));

    const totalUpdated = results.reduce((sum, r) => sum + r.updated, 0);
    const totalAlready = results.reduce((sum, r) => sum + r.alreadyHave, 0);

    console.log('\n--- Backfill Summary ---');
    console.log(`Collections processed : ${results.length}`);
    console.log(`Total docs updated    : ${totalUpdated}`);
    console.log(`Total docs skipped    : ${totalAlready} (already had schoolId)`);
    console.log('Backfill complete.');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Backfill failed:', error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}

run();
