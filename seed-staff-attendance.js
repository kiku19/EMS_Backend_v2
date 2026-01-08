import { connectDB, Staff, StaffAttendance } from './database.js';

async function seedStaffAttendance() {
  try {
    await connectDB();
    console.log('Connected to database');

    // Get all staff
    const staff = await Staff.find();
    console.log(`Found ${staff.length} staff members`);

    // Clear existing attendance
    await StaffAttendance.deleteMany({});
    console.log('Cleared existing attendance data');

    // Generate attendance for the last 30 days
    const attendanceRecords = [];
    const today = new Date();
    
    for (let i = 0; i < 30; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      // Skip weekends
      const dayOfWeek = date.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;
      
      for (const staffMember of staff) {
        // Generate random attendance with realistic distribution
        const rand = Math.random();
        let status, inTime, outTime, reason;
        
        if (rand < 0.85) {
          // 85% present
          status = 'present';
          inTime = `0${8 + Math.floor(Math.random() * 2)}:${Math.floor(Math.random() * 60).toString().padStart(2, '0')}`;
          outTime = `1${6 + Math.floor(Math.random() * 2)}:${Math.floor(Math.random() * 60).toString().padStart(2, '0')}`;
          reason = '';
        } else if (rand < 0.90) {
          // 5% on leave
          status = 'leave';
          inTime = '-';
          outTime = '-';
          const leaveReasons = ['Sick leave', 'Personal leave', 'Casual leave', 'Medical appointment'];
          reason = leaveReasons[Math.floor(Math.random() * leaveReasons.length)];
        } else if (rand < 0.95) {
          // 5% half day
          status = 'halfday';
          inTime = 