import mongoose from 'mongoose';
import { connectDB, Class, Staff } from '../database.js';
import dotenv from 'dotenv';

dotenv.config();

async function debugAnilIds() {
  try {
    await connectDB();
    console.log('✅ Connected to database\n');

    // Find Anil Kumar staff
    const staff = await Staff.findOne({ name: { $regex: /anil/i } });
    if (!staff) {
      console.log('Anil Kumar not found');
      return;
    }

    console.log('=== Staff Record ===');
    console.log('_id:', staff._id.toString());
    console.log('_id type:', typeof staff._id);
    console.log('id (getter):', staff.id);
    console.log('id type:', typeof staff.id);
    console.log('Name:', staff.name);
    console.log('Code:', staff.code);

    // Get all classes with class teachers
    const classes = await Class.find({ classTeacherId: { $exists: true, $ne: null } });
    console.log('\n=== All Classes with classTeacherId ===');

    classes.forEach(c => {
      const classTeacherIdStr = c.classTeacherId?.toString();
      const staffIdStr = staff._id.toString();
      const match = classTeacherIdStr === staffIdStr;

      console.log(`${c.name}-${c.section}:`);
      console.log(`  classTeacherId: ${classTeacherIdStr}`);
      console.log(`  staff._id:      ${staffIdStr}`);
      console.log(`  Match: ${match ? '✓ YES' : '✗ NO'}`);
      console.log('');
    });

    // Check String() comparison
    console.log('\n=== String Comparison Test ===');
    const testStaffId = staff._id;
    const testStaffIdStr = staff.id;

    classes.forEach(c => {
      const ctId = c.classTeacherId;
      if (!ctId) return;

      // These are the comparisons used in the frontend
      const compare1 = String(ctId) === String(testStaffId);
      const compare2 = String(ctId) === String(testStaffIdStr);

      if (compare1 || compare2) {
        console.log(`MATCH: ${c.name}-${c.section}`);
        console.log(`  String(ctId) === String(staff._id): ${compare1}`);
        console.log(`  String(ctId) === String(staff.id): ${compare2}`);
      }
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

debugAnilIds();
