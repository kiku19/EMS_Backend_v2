/**
 * Script to delete Sooraj's attendance record for today
 * Usage: node delete-sooraj-today-attendance.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { connectDB, Staff, StaffAttendance } from './database.js';

dotenv.config();

async function deleteTodayAttendance() {
  try {
    console.log('Connecting to database...');
    await connectDB();
    console.log('Connected to database');

    // Get today's date
    const today = new Date().toISOString().split('T')[0];
    console.log('Today:', today);

    // Find attendance record for today for any staff named Sooraj
    const attendanceRecords = await StaffAttendance.find({
      date: today
    });

    console.log(`\nFound ${attendanceRecords.length} attendance records for today`);

    let deletedCount = 0;

    for (const record of attendanceRecords) {
      const staff = await Staff.findById(record.staffId);

      if (staff && staff.name.toLowerCase().includes('sooraj')) {
        console.log(`\nFound attendance for ${staff.name}:`);
        console.log('- Staff ID:', staff._id);
        console.log('- Staff Code:', staff.code);
        console.log('- Attendance ID:', record._id);
        console.log('- Date:', record.date);
        console.log('- Status:', record.status);

        // Delete the record
        const deleteResult = await StaffAttendance.deleteOne({ _id: record._id });
        deletedCount += deleteResult.deletedCount;
        console.log('✅ Deleted successfully');
      } else if (!staff) {
        // Record exists but staff not found - might be deleted
        console.log(`\nFound attendance for non-existent staff: ${record.staffId}`);
        console.log('- Attendance ID:', record._id);
        console.log('- Date:', record.date);
        console.log('- Status:', record.status);

        // Still show details but don't auto-delete without confirmation
        console.log('(Staff record not found in database)');
      }
    }

    if (deletedCount > 0) {
      console.log(`\n✅ Successfully deleted ${deletedCount} attendance record(s) for today`);
    } else {
      console.log('\n❌ No attendance records found for Sooraj today');
    }

    // Verify no records for Sooraj today
    const staffMembers = await Staff.find({ name: /sooraj/i });
    console.log(`\nVerification - checking ${staffMembers.length} staff member(s) named Sooraj:`);

    for (const staff of staffMembers) {
      const remainingAttendance = await StaffAttendance.findOne({
        staffId: staff._id,
        date: today
      });

      console.log(`- ${staff.name} (${staff.code}): ${remainingAttendance ? 'STILL HAS RECORD' : 'no record - OK'}`);
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

deleteTodayAttendance();
