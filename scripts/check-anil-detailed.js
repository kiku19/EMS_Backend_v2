import mongoose from 'mongoose';
import { connectDB, Class, Staff } from '../database.js';
import dotenv from 'dotenv';

dotenv.config();

async function checkAnilDetailed() {
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
    console.log('=== ANIL KUMAR RAW DATA ===');
    console.log('_id:', anilIdStr);
    console.log('id:', anil.id);
    console.log('assignedClasses:', JSON.stringify(anil.assignedClasses));
    console.log('classTeacherOf:', anil.classTeacherOf);
    console.log('isClassTeacher:', anil.isClassTeacher);
    console.log('teacherAssignments:', JSON.stringify(anil.teacherAssignments, null, 2));
    console.log('');

    // Check classesWithTeachers logic
    console.log('=== SIMULATING classesWithTeachers FILTER ===');
    const allClasses = await Class.find({});
    const allStaff = await Staff.find({});
    
    const classesWithTeachers = allClasses.map(c => ({
      ...c.toObject(),
      id: c._id.toString(),
      _id: c._id,
      classTeacherId: c.classTeacherId ? c.classTeacherId.toString() : null
    }));

    const matching = classesWithTeachers.filter(cls =>
      String(cls.classTeacherId) === String(anil.id) || 
      String(cls.classTeacherId) === String(anil._id)
    );

    console.log(`Anil.id: ${anil.id}`);
    console.log(`Anil._id: ${anil._id}`);
    console.log(`Matching classes count: ${matching.length}`);
    matching.forEach(c => {
      console.log(`  - ${c.name}-${c.section} (classTeacherId: ${c.classTeacherId})`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

checkAnilDetailed();
