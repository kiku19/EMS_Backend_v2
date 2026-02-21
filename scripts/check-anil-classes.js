import mongoose from 'mongoose';
import { connectDB, Class, Staff } from '../database.js';
import dotenv from 'dotenv';

dotenv.config();

async function checkAnilClasses() {
  try {
    await connectDB();
    console.log('✅ Connected to database\n');

    // Find AnilKumar staff
    const staffList = await Staff.find({ name: { $regex: /anil/i } });
    console.log('=== Staff matching "Anil" ===');
    staffList.forEach(s => {
      console.log('ID:', s._id.toString());
      console.log('Name:', s.name);
      console.log('Code:', s.code);
      console.log('---');
    });

    // Check classes where these staff are class teachers
    if (staffList.length > 0) {
      for (const s of staffList) {
        const classes = await Class.find({ classTeacherId: s._id });
        console.log('\n=== Classes where', s.name, 'is class teacher ===');
        if (classes.length === 0) {
          console.log('No classes found');
        } else {
          classes.forEach(c => {
            console.log(`${c.name}-${c.section} | classTeacherId: ${c.classTeacherId?.toString()}`);
          });
        }
      }
    }

    // Also check all classes with class teachers
    console.log('\n\n=== ALL CLASSES WITH CLASS TEACHERS ===');
    const allClasses = await Class.find({ classTeacherId: { $exists: true, $ne: null } })
      .populate('classTeacherId', 'name code');

    // Group by teacher
    const teacherMap = new Map();
    allClasses.forEach(cls => {
      if (!cls.classTeacherId) return;
      const teacherId = cls.classTeacherId._id.toString();
      if (!teacherMap.has(teacherId)) {
        teacherMap.set(teacherId, {
          name: cls.classTeacherId.name,
          code: cls.classTeacherId.code,
          classes: []
        });
      }
      teacherMap.get(teacherId).classes.push(`${cls.name}-${cls.section}`);
    });

    teacherMap.forEach((data, teacherId) => {
      console.log(`\n${data.name} (${data.code}):`);
      console.log(`  Classes: ${data.classes.join(', ')}`);
      if (data.classes.length > 1) {
        console.log(`  ⚠️  VIOLATION: Teacher has ${data.classes.length} classes!`);
      }
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

checkAnilClasses();
