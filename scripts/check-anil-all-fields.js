import mongoose from 'mongoose';
import { connectDB, Class, Staff } from '../database.js';
import dotenv from 'dotenv';

dotenv.config();

async function checkAnilAllFields() {
  try {
    await connectDB();
    console.log('✅ Connected to database\n');

    // Find Anil Kumar
    const anil = await Staff.findOne({ name: { $regex: /anil/i } });
    if (!anil) {
      console.log('Anil Kumar not found');
      return;
    }

    console.log('=== ALL CLASS-RELATED FIELDS FOR ANIL KUMAR ===\n');

    console.log('1. isClassTeacher:', anil.isClassTeacher);
    console.log('2. classTeacherOf:', anil.classTeacherOf);
    console.log('3. assignedClasses:', anil.assignedClasses);
    console.log('4. teacherAssignments:', JSON.stringify(anil.teacherAssignments, null, 2));

    // Check what the API returns
    console.log('\n=== WHAT THE API RETURNS ===');

    // Simulate staff API response
    const assignedClass = await Class.findOne({ classTeacherId: anil._id });
    console.log('assignedClass (from Class.classTeacherId):', assignedClass ? `${assignedClass.name}-${assignedClass.section}` : null);
    console.log('assignedClassId:', assignedClass?._id?.toString());

    // Check classes where Anil teaches subjects
    console.log('\n=== SUBJECT TEACHING ASSIGNMENTS ===');
    const teachingClasses = await Class.find({
      $or: [
        { 'teacherAssignments.teacherId': anil._id },
        { 'subjects.teacherId': anil._id }
      ]
    });

    if (teachingClasses.length > 0) {
      teachingClasses.forEach(c => {
        console.log(`${c.name}-${c.section}:`);
        // Check what subjects Anil teaches in this class
        if (c.teacherAssignments) {
          c.teacherAssignments.forEach(ta => {
            if (String(ta.teacherId) === String(anil._id)) {
              console.log(`  - Subject: ${ta.subject}`);
            }
          });
        }
      });
    } else {
      console.log('No subject teaching assignments found');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

checkAnilAllFields();
