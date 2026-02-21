import mongoose from 'mongoose';
import { connectDB, Class, Staff } from '../database.js';
import dotenv from 'dotenv';

dotenv.config();

async function checkStaffAssignedClasses() {
  try {
    await connectDB();
    console.log('✅ Connected to database\n');

    // Find all staff
    const allStaff = await Staff.find({});
    
    console.log('=== ALL STAFF WITH assignedClasses !== [] ===');
    allStaff.forEach(s => {
      if (s.assignedClasses && s.assignedClasses.length > 0) {
        console.log(`\n${s.name} (${s.code}):`);
        console.log(`  assignedClasses: ${JSON.stringify(s.assignedClasses)}`);
        console.log(`  classTeacherOf: ${s.classTeacherOf}`);
        console.log(`  isClassTeacher: ${s.isClassTeacher}`);
      }
    });

    // Also find Anil specifically
    console.log('\n\n=== ANIL KUMAR FULL DETAILS ===');
    const anil = await Staff.findOne({ name: { $regex: /anil/i } });
    if (anil) {
      console.log(`Name: ${anil.name}`);
      console.log(`Code: ${anil.code}`);
      console.log(`ID: ${anil._id.toString()}`);
      console.log(`assignedClasses: ${JSON.stringify(anil.assignedClasses)}`);
      console.log(`classTeacherOf: ${anil.classTeacherOf}`);
      console.log(`isClassTeacher: ${anil.isClassTeacher}`);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

checkStaffAssignedClasses();
