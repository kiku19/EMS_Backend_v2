import mongoose from 'mongoose';
import { connectDB, Class, Staff } from '../database.js';
import dotenv from 'dotenv';

dotenv.config();

async function fixClassTeacherInconsistencies() {
  try {
    await connectDB();
    console.log('✅ Connected to database\n');

    const fixes = [];

    // Get all classes with classTeacherId
    const classesWithTeachers = await Class.find({ classTeacherId: { $exists: true, $ne: null } });
    
    console.log('=== Current class teacher assignments ===');
    for (const cls of classesWithTeachers) {
      const staff = await Staff.findById(cls.classTeacherId);
      console.log(`  ${cls.name}-${cls.section}: ${staff ? staff.name : 'UNKNOWN (ID: ' + cls.classTeacherId + ')'}`);
    }

    console.log('\n=== Fixing inconsistencies ===\n');

    // Fix 1: Sooraj J (EMP015) should be class teacher of Class 8-A
    const SoorajJ = await Staff.findOne({ code: 'EMP015' });
    if (SoorajJ) {
      // First, clear any incorrect classTeacherId pointing to SoorajJ (like Class 1-B)
      const incorrectClassForSoorajJ = await Class.findOne({ 
        classTeacherId: SoorajJ._id,
        name: { $ne: 'Class 8' },
        section: { $ne: 'A' }
      });
      if (incorrectClassForSoorajJ) {
        incorrectClassForSoorajJ.classTeacherId = null;
        await incorrectClassForSoorajJ.save();
        console.log(`✅ Cleared: ${incorrectClassForSoorajJ.name}-${incorrectClassForSoorajJ.section} no longer points to ${SoorajJ.name}`);
        fixes.push(`Cleared ${incorrectClassForSoorajJ.name}-${incorrectClassForSoorajJ.section} classTeacherId`);
      }

      // Now set Class 8-A to point to SoorajJ
      const class8A = await Class.findOne({ name: 'Class 8', section: 'A' });
      if (class8A && class8A.classTeacherId?.toString() !== SoorajJ._id.toString()) {
        class8A.classTeacherId = SoorajJ._id;
        await class8A.save();
        console.log(`✅ Fixed: Class 8-A now points to ${SoorajJ.name}`);
        fixes.push(`Set Class 8-A classTeacherId to ${SoorajJ.name}`);
      }

      // Update SoorajJ's classTeacherOf
      if (SoorajJ.classTeacherOf !== 'Class 8-A') {
        SoorajJ.classTeacherOf = 'Class 8-A';
        await SoorajJ.save();
        console.log(`✅ Fixed: ${SoorajJ.name} classTeacherOf updated to "Class 8-A"`);
        fixes.push(`Fixed ${SoorajJ.name} classTeacherOf to "Class 8-A"`);
      }
    }

    // Fix 2: Sooraj (EMP016) should be class teacher of Class 1-D
    const Sooraj = await Staff.findOne({ code: 'EMP016' });
    if (Sooraj) {
      // First, clear any incorrect classTeacherId pointing to Sooraj (like Class 5-A)
      const incorrectClassForSooraj = await Class.findOne({ 
        classTeacherId: Sooraj._id,
        name: { $ne: 'Class 1' },
        section: { $ne: 'D' }
      });
      if (incorrectClassForSooraj) {
        incorrectClassForSooraj.classTeacherId = null;
        await incorrectClassForSooraj.save();
        console.log(`✅ Cleared: ${incorrectClassForSooraj.name}-${incorrectClassForSooraj.section} no longer points to ${Sooraj.name}`);
        fixes.push(`Cleared ${incorrectClassForSooraj.name}-${incorrectClassForSooraj.section} classTeacherId`);
      }

      // Now set Class 1-D to point to Sooraj
      const class1D = await Class.findOne({ name: 'Class 1', section: 'D' });
      if (class1D && class1D.classTeacherId?.toString() !== Sooraj._id.toString()) {
        class1D.classTeacherId = Sooraj._id;
        await class1D.save();
        console.log(`✅ Fixed: Class 1-D now points to ${Sooraj.name}`);
        fixes.push(`Set Class 1-D classTeacherId to ${Sooraj.name}`);
      }

      // Update Sooraj's classTeacherOf
      if (Sooraj.classTeacherOf !== 'Class 1-D') {
        Sooraj.classTeacherOf = 'Class 1-D';
        await Sooraj.save();
        console.log(`✅ Fixed: ${Sooraj.name} classTeacherOf updated to "Class 1-D"`);
        fixes.push(`Fixed ${Sooraj.name} classTeacherOf to "Class 1-D"`);
      }
    }

    // Fix 3: Rekha Joshi (EMP021) should be class teacher of Class 5-B
    const Rekha = await Staff.findOne({ code: 'EMP021' });
    if (Rekha) {
      // First, clear any incorrect classTeacherId pointing to Rekha (like Class 1-A)
      const incorrectClassForRekha = await Class.findOne({ 
        classTeacherId: Rekha._id,
        name: { $ne: 'Class 5' },
        section: { $ne: 'B' }
      });
      if (incorrectClassForRekha) {
        incorrectClassForRekha.classTeacherId = null;
        await incorrectClassForRekha.save();
        console.log(`✅ Cleared: ${incorrectClassForRekha.name}-${incorrectClassForRekha.section} no longer points to ${Rekha.name}`);
        fixes.push(`Cleared ${incorrectClassForRekha.name}-${incorrectClassForRekha.section} classTeacherId`);
      }

      // Now set Class 5-B to point to Rekha
      const class5B = await Class.findOne({ name: 'Class 5', section: 'B' });
      if (class5B && class5B.classTeacherId?.toString() !== Rekha._id.toString()) {
        class5B.classTeacherId = Rekha._id;
        await class5B.save();
        console.log(`✅ Fixed: Class 5-B now points to ${Rekha.name}`);
        fixes.push(`Set Class 5-B classTeacherId to ${Rekha.name}`);
      }

      // Update Rekha's classTeacherOf
      if (Rekha.classTeacherOf !== 'Class 5-B') {
        Rekha.classTeacherOf = 'Class 5-B';
        await Rekha.save();
        console.log(`✅ Fixed: ${Rekha.name} classTeacherOf updated to "Class 5-B"`);
        fixes.push(`Fixed ${Rekha.name} classTeacherOf to "Class 5-B"`);
      }
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
    const finalClasses = await Class.find({ classTeacherId: { $exists: true, $ne: null } });
    for (const cls of finalClasses) {
      const staff = await Staff.findById(cls.classTeacherId);
      console.log(`  ${cls.name}-${cls.section}: ${staff ? staff.name : 'UNKNOWN'}`);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

fixClassTeacherInconsistencies();
