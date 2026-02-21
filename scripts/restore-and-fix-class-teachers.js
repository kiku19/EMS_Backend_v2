import mongoose from 'mongoose';
import { connectDB, Class, Staff } from '../database.js';
import dotenv from 'dotenv';

dotenv.config();

async function restoreAndFixClassTeachers() {
  try {
    await connectDB();
    console.log('✅ Connected to database\n');

    const fixes = [];

    // Get all staff with isClassTeacher: true
    const allStaff = await Staff.find({ isClassTeacher: true });
    console.log(`=== Processing ${allStaff.length} staff with isClassTeacher: true ===\n`);

    for (const staff of allStaff) {
      // Get the class that should be assigned based on classTeacherOf
      if (!staff.classTeacherOf) continue;

      // Parse classTeacherOf to find the class
      let targetClass = null;
      const classMatch = staff.classTeacherOf.match(/Class\s*(\d+)[-\s]?([A-Z])?/i);
      // Handle both "Class 11-A" and "11-A" formats
      const classMatch2 = staff.classTeacherOf.match(/^(\d+)[-\s]?([A-Z])?$/i);
      
      if (classMatch) {
        const name = `Class ${classMatch[1]}`;
        const section = classMatch[2] || 'A';
        targetClass = await Class.findOne({ name, section });
      } else if (classMatch2) {
        const name = `Class ${classMatch2[1]}`;
        const section = classMatch2[2] || 'A';
        targetClass = await Class.findOne({ name, section });
      }

      if (!targetClass) {
        console.log(`⚠️ Could not find class for ${staff.name}: ${staff.classTeacherOf}`);
        continue;
      }

      // Check if classTeacherId already points to this staff
      if (targetClass.classTeacherId && targetClass.classTeacherId.toString() === staff._id.toString()) {
        console.log(`✅ ${staff.name}: ${targetClass.name}-${targetClass.section} already correctly assigned`);
        continue;
      }

      // Don't reassign if another teacher is correctly assigned
      if (targetClass.classTeacherId) {
        const currentTeacher = await Staff.findById(targetClass.classTeacherId);
        if (currentTeacher && currentTeacher._id.toString() !== staff._id.toString()) {
          // Check if the current teacher also has matching classTeacherOf
          if (currentTeacher.classTeacherOf) {
            const currentMatch = currentTeacher.classTeacherOf.match(/Class\s*(\d+)[-\s]?([A-Z])?/i);
            if (currentMatch) {
              const currentName = `Class ${currentMatch[1]}`;
              const currentSection = currentMatch[2] || 'A';
              if (currentName === targetClass.name && currentSection === targetClass.section) {
                console.log(`⚠️ ${targetClass.name}-${targetClass.section} is correctly assigned to ${currentTeacher.name} (classTeacherOf matches), skipping ${staff.name}`);
                continue;
              }
            }
          }
          console.log(`⚠️ ${targetClass.name}-${targetClass.section} is currently assigned to ${currentTeacher.name}, reassigning to ${staff.name}`);
        }
      }

      // Set the classTeacherId
      targetClass.classTeacherId = staff._id;
      await targetClass.save();
      console.log(`✅ Fixed: ${targetClass.name}-${targetClass.section} now points to ${staff.name}`);
      fixes.push(`Set ${targetClass.name}-${targetClass.section} classTeacherId to ${staff.name}`);
    }

    // Summary
    console.log('\n=== SUMMARY ===');
    console.log(`Total fixes applied: ${fixes.length}`);
    if (fixes.length === 0) {
      console.log('No fixes needed - data is already consistent');
    } else {
      fixes.forEach((fix, idx) => console.log(`  ${idx + 1}. ${fix}`));
    }

    // Verify final state
    console.log('\n=== Final class teacher assignments ===');
    const finalClasses = await Class.find({ classTeacherId: { $exists: true, $ne: null } }).sort({ name: 1, section: 1 });
    for (const cls of finalClasses) {
      const staff = await Staff.findById(cls.classTeacherId);
      console.log(`  ${cls.name}-${cls.section}: ${staff ? staff.name : 'UNKNOWN'}`);
    }

    // Check for unassigned classes
    console.log('\n=== Unassigned classes ===');
    const unassignedClasses = await Class.find({ 
      $or: [
        { classTeacherId: { $exists: false } },
        { classTeacherId: null }
      ]
    }).sort({ name: 1, section: 1 });
    
    if (unassignedClasses.length === 0) {
      console.log('  All classes have class teachers!');
    } else {
      unassignedClasses.forEach(cls => {
        console.log(`  ${cls.name}-${cls.section}: UNASSIGNED`);
      });
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

restoreAndFixClassTeachers();
