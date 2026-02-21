/**
 * Script to check Sooraj's attendance records
 * Usage: node check-sooraj-attendance.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { connectDB, Staff, StaffAttendance } from './database.js';

dotenv.config();

async function checkAttendance() {
  try {
    console.log('Connecting to database...');
    await connectDB();
    console.log('Connected to database');

    // Find Sooraj
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

    // Get all attendance records for Sooraj
    const allAttendance = await StaffAttendance.find({ staffId: staff._id })
      .sort({ date: -1 })
      .limit(10);

    console.log(`\nFound ${allAttendance.length} recent attendance records:`);
    allAttendance.forEach(att => {
      console.log(`- ${att.date}: status=${att.status}, in=${att.inTime || 'N/A'}, out=${att.outTime || 'N/A'}`);
    });

    // Check today specifically
    const today = new Date().toISOString().split('T')[0];
    console.log(`\nToday's date (YYYY-MM-DD): ${today}`);

    const todayAttendance = await StaffAttendance.findOne({
      staffId: staff._id,
      date: today
    });

    if (todayAttendance) {
      console.log('✅ Today\'s attendance FOUND:', todayAttendance);
    } else {
      console.log('❌ No attendance found for today');

      // Try checking with different date formats
      const dateObj = new Date();
      const alternatives = [
        dateObj.toISOString().split('T')[0], // YYYY-MM-DD
        dateObj.toLocaleDateString('en-IN'), // DD/MM/YYYY
        dateObj.toLocaleDateString('en-US'), // M/D/YYYY
        `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}` // YYYY-MM-DD zero-padded
      ];

      console.log('\nTrying alternative date formats:');
      for (const altDate of alternatives) {
        const altAttendance = await StaffAttendance.findOne({
          staffId: staff._id,
          date: altDate
        });
        console.log(`- ${altDate}: ${altAttendance ? 'FOUND' : 'not found'}`);
        if (altAttendance) {
          console.log('  Record:', altAttendance);
        }
      }
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkAttendance();
