import mongoose from 'mongoose';
import { connectDB, Class, Staff } from '../database.js';
import dotenv from 'dotenv';

dotenv.config();

async function checkAnilFullDetails() {
  try {
    await connectDB();
    console.log('✅ Connected to database\n');

    // Find Anil Kumar
    const anil = await Staff.findOne({ name: { $regex: /anil/i } });
    if (!anil) {
      console.log('Anil Kumar not found');
      return;
    }

    console.log('=== ANIL KUMAR FULL DETAILS ===');
    console.log(`Name: ${anil.name}`);
    console.log(`Code: ${anil.code}`);
    console.log(`ID: ${anil._id.toString()}`);
    console.log(`isClassTeacher: ${anil.isClassTeacher}`);
    console.log(`classTeacherOf: ${anil.classTeacherOf}`);
    console.log(`assignedClasses: ${JSON.stringify(anil.assignedClasses)}`);
    console.log('');

    // Find classes where Anil is class teacher
    const classesAsTeacher = await Class.find({ classTeacherId: anil._id });
    console.log('=== CLASSES WHERE ANIL IS CLASS TEACHER ===');
    if (classesAsTeacher.length === 0) {
      console.log('None');
    } else {
      classesAsTeacher.forEach(c => {
        console.log(`  ${c.name}-${c.section} (ID: ${c._id})`);
      });
    }

    // Check consistency
    console.log('\n=== CONSISTENCY CHECK ===');
    if (anil.classTeacherOf && classesAsTeacher.length > 0) {
      const classTeacherOfClass = classesAsTeacher.find(c => {
        const normalized = (c.name.replace('Class ', '') + c.section).replace('-', '').toUpperCase();
        const expected = anil.classTeacherOf.replace('Class ', '').replace('-', '').toUpperCase();
        return normalized === expected;
      });
      
      if (classTeacherOfClass) {
        console.log('✅ classTeacherOf matches classTeacherId');
      } else {
        console.log('❌ MISMATCH: classTeacherOf does not match classTeacherId');
        console.log(`   classTeacherOf: ${anil.classTeacherOf}`);
        console.log(`   Actual classTeacherId class: ${classesAsTeacher[0].name}-${classesAsTeacher[0].section}`);
      }
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

checkAnilFullDetails();
