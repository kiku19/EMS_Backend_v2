/**
 * Script to list all staff attendance records
 * Usage: node list-all-attendance.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { connectDB, Staff, StaffAttendance } from './database.js';

dotenv.config();

async function listAttendance() {
  try {
    console.log('Connecting to database...');
    await connectDB();
    console.log('Connected to database');

    // Get today's date
    const today = new Date().toISOString().split('T')[0];
    console.log('Today:', today);

    // Find all attendance records for today
    const todayRecords = await StaffAttendance.find({ date: today });
    console.log(`\nAttendance records for today (${today}): ${todayRecords.length}`);

    // Find all attendance records in database
    const allRecords = await StaffAttendance.find({})
      .sort({ date: -1 })
      .limit(20);

    console.log(`\nTotal recent attendance records in database: ${allRecords.length}`);
    console.log('\nRecent records:');

    for (const record of allRecords) {
      const staff = await Staff.findById(record.staffId);
      console.log(`- ${record.date}: StaffID=${record.staffId}, Name=${staff?.name || 'Unknown'}, Status=${record.status}`);
    }

    // Find Sooraj specifically
    const sooraj = await Staff.findOne({ name: /sooraj/i });
    if (sooraj) {
      console.log(`\nSooraj's ID: ${sooraj._id}`);

      // Find all attendance for Sooraj
      const soorajAttendance = await StaffAttendance.find({
        staffId: sooraj._id
      }).sort({ date: -1 });

      console.log(`Sooraj's total attendance records: ${soorajAttendance.length}`);
      console.log('\nSooraj\'s attendance:');
      soorajAttendance.forEach(att => {
        console.log(`- ${att.date}: ${att.status}`);
      });
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

listAttendance();
