/**
 * Script to reset Sooraj's attendance record for today
 * Usage: node reset-sooraj-attendance.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { connectDB, Staff, StaffAttendance } from './database.js';

dotenv.config();

async function resetAttendance() {
  try {
    console.log('Connecting to database...');
    await connectDB();
    console.log('Connected to database');

    // Find Sooraj (case-insensitive search)
    const staff = await Staff.findOne({ name: /sooraj/i });

    if (!staff) {
      console.log('❌ Staff member "Sooraj" not found');
      process.exit(1);
    }

    console.log('Found staff:', {
      _id: staff._id,
      name: staff.name,
      code: staff.code,
      role: staff.role
    });

    // Get today's date in YYYY-MM-DD format
    const today = new Date().toISOString().split('T')[0];
    console.log('Today\'s date:', today);

    // Find attendance record for today
    const attendance = await StaffAttendance.findOne({
      staffId: staff._id,
      date: today
    });

    if (!attendance) {
      console.log('✅ No attendance record found for today - nothing to reset');
      process.exit(0);
    }

    console.log('Found attendance record:', {
      _id: attendance._id,
      staffId: attendance.staffId,
      date: attendance.date,
      status: attendance.status,
      inTime: attendance.inTime,
      outTime: attendance.outTime
    });

    // Delete the attendance record
    const result = await StaffAttendance.deleteOne({ _id: attendance._id });
    console.log('✅ Successfully deleted attendance record');
    console.log('Deleted count:', result.deletedCount);

    // Verify deletion
    const verify = await StaffAttendance.findOne({
      staffId: staff._id,
      date: today
    });

    if (verify) {
      console.log('❌ Verification failed - record still exists');
      process.exit(1);
    } else {
      console.log('✅ Verification successful - record has been deleted');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

resetAttendance();
