/**
 * Diagnostic script to investigate student-class assignment inconsistencies
 *
 * This script checks:
 * 1. Students with classId as string vs ObjectId
 * 2. Students with status != 'active'
 * 3. Students with isDeleted = true
 * 4. Students with invalid classId references
 * 5. Class student counts vs actual student counts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/school_db';

// Simplified schemas for diagnostic
const classSchema = new mongoose.Schema({
  name: String,
  section: String,
  classTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  academicYear: String,
}, { collection: 'classes' });

const studentSchema = new mongoose.Schema({
  name: String,
  admissionId: String,
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
  status: String,
  isDeleted: Boolean,
  academicYear: String,
}, { collection: 'students', strict: false });

const Class = mongoose.model('Class', classSchema);
const Student = mongoose.model('Student', studentSchema);

async function diagnose() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    console.log('='.repeat(60));

    // 1. Get all classes
    const classes = await Class.find({}).lean();
    console.log(`\n📚 Total Classes: ${classes.length}`);

    // 2. Get all students (raw)
    const allStudents = await Student.find({}).lean();
    console.log(`👨‍🎓 Total Students (all): ${allStudents.length}`);

    // 3. Check for students with different classId types
    const studentsWithStringClassId = allStudents.filter(s => typeof s.classId === 'string');
    const studentsWithObjectIdClassId = allStudents.filter(s => s.classId instanceof mongoose.Types.ObjectId);
    const studentsWithNullClassId = allStudents.filter(s => !s.classId);

    console.log('\n📊 ClassId Type Analysis:');
    console.log(`  - String classId: ${studentsWithStringClassId.length}`);
    console.log(`  - ObjectId classId: ${studentsWithObjectIdClassId.length}`);
    console.log(`  - Null/undefined classId: ${studentsWithNullClassId.length}`);

    // 4. Check status distribution
    const statusCounts = {};
    allStudents.forEach(s => {
      const status = s.status || 'undefined';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });
    console.log('\n📊 Status Distribution:');
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`  - ${status}: ${count}`);
    });

    // 5. Check isDeleted distribution
    const deletedCount = allStudents.filter(s => s.isDeleted === true).length;
    const notDeletedCount = allStudents.filter(s => s.isDeleted !== true).length;
    console.log('\n📊 Deletion Status:');
    console.log(`  - isDeleted=true: ${deletedCount}`);
    console.log(`  - isDeleted=false/undefined: ${notDeletedCount}`);

    // 6. Detailed class-wise analysis
    console.log('\n' + '='.repeat(60));
    console.log('📋 CLASS-WISE STUDENT ANALYSIS');
    console.log('='.repeat(60));

    for (const cls of classes) {
      const classIdStr = cls._id.toString();

      // Count students with different queries
      const byExactMatch = allStudents.filter(s => s.classId && s.classId.toString() === classIdStr);
      const byActiveOnly = byExactMatch.filter(s => s.status === 'active');
      const byNotDeleted = byExactMatch.filter(s => s.isDeleted !== true);
      const byActiveAndNotDeleted = byExactMatch.filter(s => s.status === 'active' && s.isDeleted !== true);

      console.log(`\n🏫 Class ${cls.name}-${cls.section} (ID: ${classIdStr.substring(0, 8)}...)`);
      console.log(`   Teacher ID: ${cls.classTeacherId || 'None'}`);
      console.log(`   ---`);
      console.log(`   All with this classId: ${byExactMatch.length}`);
      console.log(`   Active only: ${byActiveOnly.length}`);
      console.log(`   Not deleted: ${byNotDeleted.length}`);
      console.log(`   Active AND not deleted: ${byActiveAndNotDeleted.length}`);

      // Show details if counts differ
      if (byExactMatch.length !== byActiveAndNotDeleted.length) {
        console.log(`   ⚠️ COUNT MISMATCH! Showing details:`);

        byExactMatch.forEach(s => {
          const issues = [];
          if (s.status !== 'active') issues.push(`status=${s.status}`);
          if (s.isDeleted === true) issues.push('isDeleted=true');
          console.log(`      - ${s.name} (${s.admissionId}): ${issues.length ? issues.join(', ') : 'OK'}`);
        });
      }
    }

    // 7. Find students with invalid classId references
    console.log('\n' + '='.repeat(60));
    console.log('🔍 STUDENTS WITH INVALID CLASS REFERENCES');
    console.log('='.repeat(60));

    const validClassIds = new Set(classes.map(c => c._id.toString()));
    const invalidRefStudents = allStudents.filter(s => {
      if (!s.classId) return true;
      return !validClassIds.has(s.classId.toString());
    });

    if (invalidRefStudents.length > 0) {
      console.log(`\n⚠️ Found ${invalidRefStudents.length} students with invalid classId:`);
      invalidRefStudents.forEach(s => {
        console.log(`  - ${s.name} (${s.admissionId}): classId=${s.classId}`);
      });
    } else {
      console.log('\n✅ All students have valid classId references');
    }

    // 8. Check for students with string classId (potential type mismatch)
    if (studentsWithStringClassId.length > 0) {
      console.log('\n' + '='.repeat(60));
      console.log('⚠️ STUDENTS WITH STRING classId (type mismatch)');
      console.log('='.repeat(60));

      studentsWithStringClassId.forEach(s => {
        console.log(`  - ${s.name} (${s.admissionId}): classId="${s.classId}" (string)`);
      });
    }

    // 9. Summary and recommendations
    console.log('\n' + '='.repeat(60));
    console.log('📝 SUMMARY & RECOMMENDATIONS');
    console.log('='.repeat(60));

    const issues = [];

    if (studentsWithStringClassId.length > 0) {
      issues.push(`- ${studentsWithStringClassId.length} students have classId as string instead of ObjectId`);
    }

    if (deletedCount > 0) {
      issues.push(`- ${deletedCount} students are soft-deleted (isDeleted=true)`);
    }

    const inactiveCount = allStudents.filter(s => s.status !== 'active' && s.isDeleted !== true).length;
    if (inactiveCount > 0) {
      issues.push(`- ${inactiveCount} students have status != 'active'`);
    }

    if (invalidRefStudents.length > 0) {
      issues.push(`- ${invalidRefStudents.length} students have invalid classId references`);
    }

    if (issues.length > 0) {
      console.log('\n⚠️ ISSUES FOUND:');
      issues.forEach(i => console.log(i));

      console.log('\n💡 RECOMMENDED FIXES:');
      console.log('1. Convert string classId to ObjectId');
      console.log('2. Filter by status="active" AND isDeleted!=true in all queries');
      console.log('3. Fix invalid classId references or delete orphaned students');
    } else {
      console.log('\n✅ No major issues found in data consistency');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

diagnose();
