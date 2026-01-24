import mongoose from 'mongoose';
import { connectDB, Class, Staff } from '../database.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Script to check and fix duplicate class teacher assignments
 * Rule: One teacher should be assigned as class teacher to only ONE class
 */

async function checkAndFixDuplicateClassTeachers() {
  try {
    // Connect to database
    await connectDB();
    console.log('✅ Connected to database\n');

    // Step 1: Find all classes with class teachers
    console.log('📊 Step 1: Finding all classes with class teachers...');
    const classesWithTeachers = await Class.find({
      classTeacherId: { $exists: true, $ne: null }
    }).populate('classTeacherId', 'name code');

    console.log(`   Found ${classesWithTeachers.length} classes with assigned teachers\n`);

    // Step 2: Group classes by teacher
    console.log('🔍 Step 2: Checking for teachers assigned to multiple classes...');
    const teacherMap = new Map();

    classesWithTeachers.forEach(cls => {
      const teacherId = cls.classTeacherId._id.toString();
      if (!teacherMap.has(teacherId)) {
        teacherMap.set(teacherId, {
          teacher: cls.classTeacherId,
          classes: []
        });
      }
      teacherMap.get(teacherId).classes.push({
        classId: cls._id,
        className: `${cls.name} ${cls.section}`,
        createdAt: cls.createdAt,
        updatedAt: cls.updatedAt
      });
    });

    // Step 3: Identify violations (teachers with multiple classes)
    const violations = [];
    teacherMap.forEach((data, teacherId) => {
      if (data.classes.length > 1) {
        violations.push({
          teacherId,
          teacherName: data.teacher.name,
          teacherCode: data.teacher.code,
          classes: data.classes,
          count: data.classes.length
        });
      }
    });

    console.log(`   Found ${violations.length} teachers assigned to multiple classes\n`);

    // Step 4: Report violations
    if (violations.length === 0) {
      console.log('✅ No violations found! All teachers are assigned to only one class.\n');
      return;
    }

    console.log('⚠️  VIOLATIONS FOUND:\n');
    console.log('='.repeat(80));
    violations.forEach((violation, idx) => {
      console.log(`\n${idx + 1}. Teacher: ${violation.teacherName} (${violation.teacherCode})`);
      console.log(`   Assigned to ${violation.count} classes:`);

      // Sort classes by updatedAt (most recent first)
      const sortedClasses = [...violation.classes].sort((a, b) =>
        new Date(b.updatedAt) - new Date(a.updatedAt)
      );

      sortedClasses.forEach((cls, clsIdx) => {
        const keepMarker = clsIdx === 0 ? '✓ KEEP' : '  ✗ REMOVE';
        console.log(`      ${keepMarker} - ${cls.className} (updated: ${cls.updatedAt.toISOString()})`);
      });
    });
    console.log('\n' + '='.repeat(80) + '\n');

    // Step 5: Fix violations
    console.log('🔧 Step 3: Fixing violations...\n');
    const fixReport = [];

    for (const violation of violations) {
      const sortedClasses = [...violation.classes].sort((a, b) =>
        new Date(b.updatedAt) - new Date(a.updatedAt)
      );

      // Keep the first (most recent) class, remove the rest
      const classToKeep = sortedClasses[0];
      const classesToRemove = sortedClasses.slice(1);

      console.log(`   Teacher: ${violation.teacherName} (${violation.teacherCode})`);
      console.log(`   ✓ Keeping: ${classToKeep.className}`);

      const removedClassIds = [];

      for (const classToRemove of classesToRemove) {
        console.log(`   ✗ Removing assignment from: ${classToRemove.className}`);

        // Set classTeacherId to null
        await Class.findByIdAndUpdate(classToRemove.classId, {
          $unset: { classTeacherId: 1 }
        });

        removedClassIds.push(classToRemove.classId.toString());
      }

      fixReport.push({
        teacherId: violation.teacherId,
        teacherName: violation.teacherName,
        teacherCode: violation.teacherCode,
        classKept: {
          classId: classToKeep.classId.toString(),
          className: classToKeep.className
        },
        classesRemoved: classesToRemove.map(c => ({
          classId: c.classId.toString(),
          className: c.className
        }))
      });

      console.log('');
    }

    // Step 6: Verify fixes
    console.log('✅ Step 4: Verifying fixes...');
    const recheckViolations = await verifyNoViolations();

    // Step 7: Final Report
    console.log('\n' + '='.repeat(80));
    console.log('📋 FINAL REPORT:\n');
    console.log(`   Total violations found: ${violations.length}`);
    console.log(`   Total violations fixed: ${fixReport.length}`);
    console.log(`   Remaining violations: ${recheckViolations}`);

    if (recheckViolations === 0) {
      console.log('\n✅ SUCCESS: All duplicate class teacher assignments have been fixed!\n');
    } else {
      console.log('\n⚠️  WARNING: Some violations still exist. Please investigate.\n');
    }

    console.log('='.repeat(80) + '\n');

    // Log detailed fix report
    console.log('📄 DETAILED FIX REPORT:\n');
    fixReport.forEach((report, idx) => {
      console.log(`${idx + 1}. Teacher: ${report.teacherName} (${report.teacherCode})`);
      console.log(`   Class Kept: ${report.classKept.className} (ID: ${report.classKept.classId})`);
      console.log(`   Classes Removed: ${report.classesRemoved.length}`);
      report.classesRemoved.forEach((c, cIdx) => {
        console.log(`      ${cIdx + 1}. ${c.className} (ID: ${c.classId})`);
      });
      console.log('');
    });

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    // Close database connection
    await mongoose.connection.close();
    console.log('✅ Database connection closed\n');
  }
}

async function verifyNoViolations() {
  const classesWithTeachers = await Class.find({
    classTeacherId: { $exists: true, $ne: null }
  }).populate('classTeacherId', 'name');

  const teacherMap = new Map();
  classesWithTeachers.forEach(cls => {
    const teacherId = cls.classTeacherId._id.toString();
    if (!teacherMap.has(teacherId)) {
      teacherMap.set(teacherId, 0);
    }
    teacherMap.set(teacherId, teacherMap.get(teacherId) + 1);
  });

  let violations = 0;
  teacherMap.forEach(count => {
    if (count > 1) violations++;
  });

  return violations;
}

// Run the script
checkAndFixDuplicateClassTeachers();
