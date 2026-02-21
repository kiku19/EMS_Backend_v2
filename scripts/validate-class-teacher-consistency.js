import mongoose from 'mongoose';
import { connectDB, Class, Staff } from '../database.js';
import dotenv from 'dotenv';

dotenv.config();

async function validateAndFixClassTeacherConsistency() {
  try {
    await connectDB();
    console.log('✅ Connected to database\n');

    const issues = [];
    const fixes = [];

    // Get all staff who are class teachers
    const allStaff = await Staff.find({ isClassTeacher: true });
    console.log(`=== Checking ${allStaff.length} staff with isClassTeacher: true ===\n`);

    for (const staff of allStaff) {
      // Find classes where this staff is class teacher
      const classesAsTeacher = await Class.find({ classTeacherId: staff._id });
      
      // Check if classTeacherOf matches with actual class teacher class
      if (staff.classTeacherOf) {
        // Parse classTeacherOf (e.g., "Class 6-A" or "6-A" or "6A")
        const classTeacherOfNormalized = staff.classTeacherOf
          .replace('Class ', '')
          .replace('-', '')
          .toUpperCase();
        
        const matchingClass = classesAsTeacher.find(c => {
          const classNameNormalized = (c.name.replace('Class ', '') + c.section).replace('-', '').toUpperCase();
          return classNameNormalized === classTeacherOfNormalized;
        });
        
        if (!matchingClass && classesAsTeacher.length > 0) {
          // This is a mismatch - classTeacherOf doesn't match classTeacherId
          issues.push(`Staff ${staff.name} (${staff.code}): classTeacherOf="${staff.classTeacherOf}" but classTeacherId points to ${classesAsTeacher[0].name}-${classesAsTeacher[0].section}`);
        }
      }
    }

    // Check for classes with classTeacherId but staff.isClassTeacher is false
    console.log('\n=== Checking classes with classTeacherId but staff.isClassTeacher is false ===\n');
    const classesWithTeachers = await Class.find({ classTeacherId: { $exists: true, $ne: null } });
    
    for (const cls of classesWithTeachers) {
      const staff = await Staff.findById(cls.classTeacherId);
      if (staff && !staff.isClassTeacher) {
        issues.push(`Class ${cls.name}-${cls.section}: has classTeacherId but staff ${staff.name} has isClassTeacher: false`);
        fixes.push({
          type: 'fix_staff_isClassTeacher',
          staffId: staff._id,
          staffName: staff.name,
          className: `${cls.name}-${cls.section}`
        });
      }
    }

    // Summary
    console.log('\n=== SUMMARY ===');
    console.log(`Total issues found: ${issues.length}`);
    
    if (issues.length > 0) {
      console.log('\nIssues:');
      issues.forEach((issue, idx) => console.log(`  ${idx + 1}. ${issue}`));
    }

    if (fixes.length > 0) {
      console.log('\nSuggested fixes:');
      fixes.forEach((fix, idx) => console.log(`  ${idx + 1}. ${JSON.stringify(fix)}`));
    }

    // If no issues, confirm data is consistent
    if (issues.length === 0) {
      console.log('\n✅ Data is consistent! Class teacher assignments are properly synchronized.');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

validateAndFixClassTeacherConsistency();
