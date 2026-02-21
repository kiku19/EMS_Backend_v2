import mongoose from 'mongoose';
import { connectDB, Class, Staff } from '../database.js';
import dotenv from 'dotenv';

dotenv.config();

async function findMissingClassTeachers() {
  try {
    await connectDB();
    console.log('✅ Connected to database\n');

    // List all classes
    const allClasses = await Class.find({}).sort({ name: 1, section: 1 });
    
    console.log('=== ALL CLASSES WITH CLASS TEACHER STATUS ===');
    for (const cls of allClasses) {
      let teacherName = 'UNASSIGNED';
      if (cls.classTeacherId) {
        const staff = await Staff.findById(cls.classTeacherId);
        teacherName = staff ? staff.name : 'UNKNOWN (ID: ' + cls.classTeacherId + ')';
      }
      console.log(`  ${cls.name}-${cls.section}: ${teacherName}`);
    }

    // List all staff with classTeacherOf
    console.log('\n=== ALL STAFF WITH classTeacherOf ===');
    const allStaff = await Staff.find({ classTeacherOf: { $exists: true, $ne: null } });
    for (const staff of allStaff) {
      console.log(`  ${staff.name} (${staff.code}): classTeacherOf = "${staff.classTeacherOf}"`);
    }

    // Find classes that have a classTeacherOf but no classTeacherId
    console.log('\n=== POTENTIAL MATCHES (classTeacherOf not matching classTeacherId) ===');
    for (const staff of allStaff) {
      const classTeacherOfClass = allClasses.find(c => {
        const className = `${c.name} ${c.section}`;
        return className === staff.classTeacherOf || 
               c.name.replace('Class ', '') === staff.classTeacherOf.replace('Class ', '');
      });
      
      if (classTeacherOfClass && classTeacherOfClass.classTeacherId) {
        const currentTeacher = await Staff.findById(classTeacherOfClass.classTeacherId);
        if (currentTeacher && currentTeacher._id.toString() !== staff._id.toString()) {
          console.log(`  ${staff.name}: classTeacherOf="${staff.classTeacherOf}" but classTeacherId points to ${currentTeacher.name}`);
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

findMissingClassTeachers();
