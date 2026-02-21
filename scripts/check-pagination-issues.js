import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/school_db';

/**
 * Comprehensive Database Consistency Checker
 * 
 * This script checks for common data consistency issues:
 * 1. Pagination issues (data beyond default limits)
 * 2. Missing or undefined fields
 * 3. Orphaned references (e.g., students with invalid classId)
 * 4. Status field inconsistencies
 * 5. Soft-delete issues (isDeleted field)
 */

// Define schemas
const schemas = {
  Class: new mongoose.Schema({}, { strict: false }),
  Student: new mongoose.Schema({}, { strict: false }),
  Staff: new mongoose.Schema({}, { strict: false }),
  Attendance: new mongoose.Schema({}, { strict: false }),
  Result: new mongoose.Schema({}, { strict: false }),
  FeePayment: new mongoose.Schema({}, { strict: false }),
};

const models = {};

async function initModels() {
  for (const [name, schema] of Object.entries(schemas)) {
    models[name] = mongoose.model(name, schema);
  }
}

async function checkPaginationIssues() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📊 PAGINATION ISSUES CHECK');
  console.log('═══════════════════════════════════════════════════════════\n');

  const limits = [50, 100, 200];
  
  for (const [modelName, Model] of Object.entries(models)) {
    try {
      const total = await Model.countDocuments({});
      
      if (total === 0) {
        console.log(`✓ ${modelName}: No documents (skipping)`);
        continue;
      }

      console.log(`\n📋 ${modelName}:`);
      console.log(`   Total documents: ${total}`);
      
      for (const limit of limits) {
        const fetched = await Model.find({}).limit(limit).countDocuments();
        const percentage = ((fetched / total) * 100).toFixed(1);
        
        if (fetched < total) {
          console.log(`   ⚠️  Limit ${limit}: Only ${fetched}/${total} (${percentage}%) - ${total - fetched} documents beyond limit`);
        } else {
          console.log(`   ✓ Limit ${limit}: All ${fetched} documents within limit`);
          break;
        }
      }
      
      if (total > 200) {
        console.log(`   🔴 CRITICAL: ${total} documents exceed common pagination limits!`);
        console.log(`      → Frontend may not fetch all data`);
        console.log(`      → Recommend: Increase API limit or implement proper pagination`);
      }
    } catch (error) {
      console.log(`   ❌ Error checking ${modelName}:`, error.message);
    }
  }
}

async function checkStudentClassConsistency() {
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('👥 STUDENT-CLASS CONSISTENCY CHECK');
  console.log('═══════════════════════════════════════════════════════════\n');

  const Student = models.Student;
  const Class = models.Class;

  const allStudents = await Student.find({});
  const allClasses = await Class.find({});
  
  console.log(`Total Students: ${allStudents.length}`);
  console.log(`Total Classes: ${allClasses.length}\n`);

  // Check for orphaned students (classId doesn't exist)
  const classIds = new Set(allClasses.map(c => c._id.toString()));
  const orphanedStudents = allStudents.filter(s => 
    s.classId && !classIds.has(s.classId.toString())
  );

  if (orphanedStudents.length > 0) {
    console.log(`🔴 CRITICAL: ${orphanedStudents.length} orphaned students (invalid classId):`);
    orphanedStudents.forEach(s => {
      console.log(`   - ${s.name} (ID: ${s._id}, classId: ${s.classId})`);
    });
  } else {
    console.log('✓ No orphaned students found');
  }

  // Check student distribution per class
  console.log('\n📊 Student Distribution by Class:');
  
  const classStudentCounts = {};
  allStudents.forEach(s => {
    const classId = s.classId ? s.classId.toString() : 'NO_CLASS';
    classStudentCounts[classId] = (classStudentCounts[classId] || 0) + 1;
  });

  for (const cls of allClasses) {
    const classId = cls._id.toString();
    const actualCount = classStudentCounts[classId] || 0;
    const storedStrength = cls.strength || 0;
    
    const status = actualCount === storedStrength ? '✓' : '⚠️';
    console.log(`   ${status} ${cls.name}-${cls.section}: ${actualCount} students (stored: ${storedStrength})`);
    
    if (actualCount !== storedStrength) {
      console.log(`      → Mismatch: Actual count (${actualCount}) != Stored strength (${storedStrength})`);
    }
  }

  // Check for students without classId
  const studentsWithoutClass = allStudents.filter(s => !s.classId);
  if (studentsWithoutClass.length > 0) {
    console.log(`\n⚠️  ${studentsWithoutClass.length} students without classId:`);
    studentsWithoutClass.forEach(s => {
      console.log(`   - ${s.name} (ID: ${s._id})`);
    });
  }
}

async function checkMissingFields() {
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('🔍 MISSING/UNDEFINED FIELDS CHECK');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Check Students
  const Student = models.Student;
  const allStudents = await Student.find({});
  
  console.log('📋 Students:');
  
  const criticalFields = ['status', 'isDeleted', 'classId', 'name', 'admissionId'];
  const fieldStats = {};
  
  criticalFields.forEach(field => {
    const missing = allStudents.filter(s => s[field] === undefined || s[field] === null);
    fieldStats[field] = {
      total: allStudents.length,
      missing: missing.length,
      percentage: ((missing.length / allStudents.length) * 100).toFixed(1)
    };
  });

  for (const [field, stats] of Object.entries(fieldStats)) {
    const icon = stats.missing === 0 ? '✓' : stats.missing > stats.total * 0.1 ? '🔴' : '⚠️';
    console.log(`   ${icon} ${field}: ${stats.missing}/${stats.total} missing (${stats.percentage}%)`);
    
    if (stats.missing > 0 && field === 'status') {
      console.log(`      → These students will be treated as 'active' by default`);
    }
    if (stats.missing > 0 && field === 'isDeleted') {
      console.log(`      → These students will be treated as 'not deleted' by default`);
    }
  }

  // Check Staff
  const Staff = models.Staff;
  const allStaff = await Staff.find({});
  
  console.log('\n📋 Staff:');
  
  const staffFields = ['status', 'name', 'role', 'code'];
  const staffFieldStats = {};
  
  staffFields.forEach(field => {
    const missing = allStaff.filter(s => s[field] === undefined || s[field] === null);
    staffFieldStats[field] = {
      total: allStaff.length,
      missing: missing.length,
      percentage: ((missing.length / allStaff.length) * 100).toFixed(1)
    };
  });

  for (const [field, stats] of Object.entries(staffFieldStats)) {
    const icon = stats.missing === 0 ? '✓' : stats.missing > stats.total * 0.1 ? '🔴' : '⚠️';
    console.log(`   ${icon} ${field}: ${stats.missing}/${stats.total} missing (${stats.percentage}%)`);
  }
}

async function checkStatusFieldConsistency() {
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('📊 STATUS FIELD CONSISTENCY CHECK');
  console.log('═══════════════════════════════════════════════════════════\n');

  const Student = models.Student;
  const allStudents = await Student.find({});
  
  const statusCounts = {
    active: 0,
    inactive: 0,
    alumni: 0,
    undefined: 0,
    other: []
  };

  allStudents.forEach(s => {
    if (s.status === undefined || s.status === null) {
      statusCounts.undefined++;
    } else if (s.status === 'active') {
      statusCounts.active++;
    } else if (s.status === 'inactive') {
      statusCounts.inactive++;
    } else if (s.status === 'alumni') {
      statusCounts.alumni++;
    } else {
      statusCounts.other.push(s.status);
    }
  });

  console.log('📋 Student Status Distribution:');
  console.log(`   Active: ${statusCounts.active}`);
  console.log(`   Inactive: ${statusCounts.inactive}`);
  console.log(`   Alumni: ${statusCounts.alumni}`);
  console.log(`   Undefined: ${statusCounts.undefined}`);
  
  if (statusCounts.other.length > 0) {
    console.log(`   ⚠️  Unknown status values: ${[...new Set(statusCounts.other)].join(', ')}`);
  }

  // Check isDeleted field
  const deletedCounts = {
    true: 0,
    false: 0,
    undefined: 0
  };

  allStudents.forEach(s => {
    if (s.isDeleted === true) {
      deletedCounts.true++;
    } else if (s.isDeleted === false) {
      deletedCounts.false++;
    } else {
      deletedCounts.undefined++;
    }
  });

  console.log('\n📋 Student isDeleted Distribution:');
  console.log(`   Deleted (true): ${deletedCounts.true}`);
  console.log(`   Not Deleted (false): ${deletedCounts.false}`);
  console.log(`   Undefined: ${deletedCounts.undefined}`);
  
  if (deletedCounts.undefined > 0) {
    console.log(`   ℹ️  Undefined values are treated as 'not deleted' in queries`);
  }
}

async function checkAPILimitIssues() {
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('🔧 API LIMIT RECOMMENDATIONS');
  console.log('═══════════════════════════════════════════════════════════\n');

  const Student = models.Student;
  const Staff = models.Staff;
  const Class = models.Class;

  const studentCount = await Student.countDocuments({});
  const staffCount = await Staff.countDocuments({});
  const classCount = await Class.countDocuments({});

  console.log('📊 Current Data Volumes:');
  console.log(`   Students: ${studentCount}`);
  console.log(`   Staff: ${staffCount}`);
  console.log(`   Classes: ${classCount}\n`);

  console.log('💡 Recommendations:');
  
  if (studentCount > 50) {
    console.log(`   🔴 Students (${studentCount}): Default limit of 50 is insufficient`);
    console.log(`      → Recommended limit: ${Math.max(studentCount + 50, 500)}`);
    console.log(`      → Or implement proper pagination with multiple API calls`);
  } else {
    console.log(`   ✓ Students (${studentCount}): Within default limit of 50`);
  }

  if (staffCount > 50) {
    console.log(`   ⚠️  Staff (${staffCount}): May exceed default limit`);
    console.log(`      → Recommended limit: ${Math.max(staffCount + 20, 200)}`);
  } else {
    console.log(`   ✓ Staff (${staffCount}): Within default limit of 50`);
  }

  if (classCount > 50) {
    console.log(`   ⚠️  Classes (${classCount}): May exceed default limit`);
    console.log(`      → Recommended limit: ${Math.max(classCount + 10, 100)}`);
  } else {
    console.log(`   ✓ Classes (${classCount}): Within default limit of 50`);
  }
}

async function checkClassStudentCounts() {
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('📊 DETAILED CLASS-WISE STUDENT COUNT');
  console.log('═══════════════════════════════════════════════════════════\n');

  const Student = models.Student;
  const Class = models.Class;

  const allClasses = await Class.find({}).sort({ name: 1, section: 1 });
  
  console.log('Class-wise breakdown:\n');

  for (const cls of allClasses) {
    const classId = cls._id;
    
    // Different query variations
    const allStudents = await Student.countDocuments({ classId });
    const activeStudents = await Student.countDocuments({ classId, status: 'active' });
    const notDeletedStudents = await Student.countDocuments({ classId, isDeleted: { $ne: true } });
    const activeNotDeleted = await Student.countDocuments({ 
      classId, 
      status: 'active', 
      isDeleted: { $ne: true } 
    });

    console.log(`📋 ${cls.name}-${cls.section} (ID: ${classId})`);
    console.log(`   All students: ${allStudents}`);
    console.log(`   Active only: ${activeStudents}`);
    console.log(`   Not deleted: ${notDeletedStudents}`);
    console.log(`   Active + Not deleted: ${activeNotDeleted}`);
    console.log(`   Stored strength: ${cls.strength || 'not set'}`);
    
    if (allStudents !== activeNotDeleted) {
      console.log(`   ⚠️  Discrepancy: ${allStudents - activeNotDeleted} students are inactive or deleted`);
    }
    
    if (cls.strength && cls.strength !== activeNotDeleted) {
      console.log(`   ⚠️  Strength mismatch: Stored (${cls.strength}) vs Actual (${activeNotDeleted})`);
    }
    
    console.log('');
  }
}

async function generateSummaryReport() {
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('📝 SUMMARY REPORT');
  console.log('═══════════════════════════════════════════════════════════\n');

  const issues = [];
  const warnings = [];
  const recommendations = [];

  const Student = models.Student;
  const studentCount = await Student.countDocuments({});
  
  if (studentCount > 50) {
    issues.push(`Students exceed default pagination limit (${studentCount} > 50)`);
    recommendations.push('Increase API limit to at least ' + (studentCount + 50));
  }

  const studentsWithoutStatus = await Student.countDocuments({ status: { $exists: false } });
  if (studentsWithoutStatus > 0) {
    warnings.push(`${studentsWithoutStatus} students have undefined status field`);
    recommendations.push('Set default status for all students');
  }

  const studentsWithoutIsDeleted = await Student.countDocuments({ isDeleted: { $exists: false } });
  if (studentsWithoutIsDeleted > 0) {
    warnings.push(`${studentsWithoutIsDeleted} students have undefined isDeleted field`);
    recommendations.push('Set isDeleted=false for all existing students');
  }

  console.log('🔴 Critical Issues:');
  if (issues.length === 0) {
    console.log('   None found ✓');
  } else {
    issues.forEach(issue => console.log(`   - ${issue}`));
  }

  console.log('\n⚠️  Warnings:');
  if (warnings.length === 0) {
    console.log('   None found ✓');
  } else {
    warnings.forEach(warning => console.log(`   - ${warning}`));
  }

  console.log('\n💡 Recommendations:');
  if (recommendations.length === 0) {
    console.log('   System is healthy ✓');
  } else {
    recommendations.forEach(rec => console.log(`   - ${rec}`));
  }
}

async function main() {
  try {
    console.log('🔍 Database Consistency Checker');
    console.log('Starting comprehensive analysis...\n');

    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });

    console.log('✅ Connected to MongoDB\n');

    await initModels();

    // Run all checks
    await checkPaginationIssues();
    await checkStudentClassConsistency();
    await checkMissingFields();
    await checkStatusFieldConsistency();
    await checkClassStudentCounts();
    await checkAPILimitIssues();
    await generateSummaryReport();

    console.log('\n\n✅ Analysis complete!');
    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

main();
