import mongoose from 'mongoose';
import { connectDB, Class, Staff } from '../database.js';
import dotenv from 'dotenv';

dotenv.config();

async function checkTeacherAssignments() {
  try {
    await connectDB();
    console.log('✅ Connected to database\n');

    // Find Anil Kumar
    const anil = await Staff.findOne({ name: { $regex: /anil/i } });
    if (!anil) {
      console.log('Anil Kumar not found');
      return;
    }

    const anilIdStr = anil._id.toString();
    console.log('Anil ID:', anilIdStr);
    console.log('');

    // Check teacherAssignments in Class collection
    const classesWithTeacherAssignments = await Class.find({
      'teacherAssignments.teacherId': anil._id
    });

    console.log('=== CLASSES WITH ANIL IN teacherAssignments ===');
    if (classesWithTeacherAssignments.length === 0) {
      console.log('No classes found');
    } else {
      classesWithTeacherAssignments.forEach(c => {
        console.log(`${c.name}-${c.section}:`);
        c.teacherAssignments.forEach(ta => {
          if (String(ta.teacherId) === anilIdStr) {
            console.log(`  Subject: ${ta.subject}`);
            console.log(`  Classes: ${ta.classes}`);
          }
        });
      });
    }

    // Check staff's teacherAssignments field
    console.log('\n=== ANIL teacherAssignments ===');
    console.log(JSON.stringify(anil.teacherAssignments, null, 2));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

checkTeacherAssignments();
