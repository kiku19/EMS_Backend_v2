import mongoose from 'mongoose';
import { connectDB, Class, Staff } from '../database.js';
import dotenv from 'dotenv';

dotenv.config();

async function checkAnilTeacherAssignments() {
  try {
    await connectDB();
    console.log('✅ Connected to database\n');

    // Find Anil Kumar
    const anil = await Staff.findOne({ name: { $regex: /anil/i } });
    if (!anil) {
      console.log('Anil Kumar not found');
      return;
    }

    console.log('=== ANIL TEACHER ASSIGNMENTS ===');
    if (anil.teacherAssignments && anil.teacherAssignments.length > 0) {
      for (const ta of anil.teacherAssignments) {
        console.log(`\nSubject: ${ta.subject}`);
        console.log('Classes:');
        for (const classId of ta.classes) {
          const cls = await Class.findById(classId);
          if (cls) {
            console.log(`  - ${cls.name}-${cls.section} (ID: ${cls._id})`);
          } else {
            console.log(`  - NOT FOUND (ID: ${classId})`);
          }
        }
      }
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

checkAnilTeacherAssignments();
