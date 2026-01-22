/**
 * Import Teacher Assignments from CSV
 * 
 * This script imports teacher assignments from a CSV file.
 * 
 * CSV Format:
 * teacher_id,teacher_name,subject,class_ids
 * T001,John Smith,Mathematics,"C10A,C10B,C10C"
 * T001,John Smith,Physics,C10A
 * T002,Jane Doe,English,"C10A,C10B"
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
require('dotenv').config();

// Connect to database
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/school_db', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✓ Connected to MongoDB');
  } catch (error) {
    console.error('✗ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Parse CSV file
const parseCSV = (filePath) => {
  return new Promise((resolve, reject) => {
    const assignments = [];
    
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        assignments.push({
          teacherId: row.teacher_id,
          teacherName: row.teacher_name,
          subject: row.subject,
          classIds: row.class_ids.split(',').map(id => id.trim())
        });
      })
      .on('end', () => {
        resolve(assignments);
      })
      .on('error', (error) => {
        reject(error);
      });
  });
};

// Validate assignments
const validateAssignments = async (assignments) => {
  console.log('\n📝 Validating assignments...');
  
  const db = mongoose.connection.db;
  const staff = db.collection('staff');
  const classes = db.collection('classes');
  
  const errors = [];
  const warnings = [];
  
  for (const assignment of assignments) {
    // Check if teacher exists
    const teacher = await staff.findOne({ staffId: assignment.teacherId });
    if (!teacher) {
      errors.push(`Teacher not found: ${assignment.teacherId} (${assignment.teacherName})`);
      continue;
    }
    
    // Check if classes exist
    for (const classId of assignment.classIds) {
      const classDoc = await classes.findOne({ classId: classId });
      if (!classDoc) {
        warnings.push(`Class not found: ${classId} for teacher ${assignment.teacherId}`);
      }
    }
  }
  
  if (errors.length > 0) {
    console.log('\n❌ Validation Errors:');
    errors.forEach(err => console.log(`  - ${err}`));
  }
  
  if (warnings.length > 0) {
    console.log('\n⚠️  Validation Warnings:');
    warnings.forEach(warn => console.log(`  - ${warn}`));
  }
  
  if (errors.length === 0) {
    console.log('✓ All assignments are valid');
  }
  
  return { errors, warnings };
};

// Import assignments
const importAssignments = async (assignments, dryRun = false) => {
  console.log(`\n📝 ${dryRun ? 'Simulating' : 'Importing'} assignments...`);
  
  const db = mongoose.connection.db;
  const staff = db.collection('staff');
  const classes = db.collection('classes');
  
  // Group assignments by teacher
  const teacherAssignments = {};
  for (const assignment of assignments) {
    if (!teacherAssignments[assignment.teacherId]) {
      teacherAssignments[assignment.teacherId] = [];
    }
    
    // Convert class IDs to ObjectIds
    const classObjectIds = [];
    for (const classId of assignment.classIds) {
      const classDoc = await classes.findOne({ classId: classId });
      if (classDoc) {
        classObjectIds.push(classDoc._id);
      }
    }
    
    teacherAssignments[assignment.teacherId].push({
      subject: assignment.subject,
      classes: classObjectIds,
      createdAt: new Date()
    });
  }
  
  let updated = 0;
  let failed = 0;
  
  for (const teacherId in teacherAssignments) {
    try {
      const teacher = await staff.findOne({ staffId: teacherId });
      if (!teacher) {
        console.log(`✗ Teacher not found: ${teacherId}`);
        failed++;
        continue;
      }
      
      if (dryRun) {
        console.log(`✓ Would update teacher: ${teacherId} with ${teacherAssignments[teacherId].length} assignments`);
        updated++;
      } else {
        await staff.updateOne(
          { staffId: teacherId },
          { $set: { teacherAssignments: teacherAssignments[teacherId] } }
        );
        console.log(`✓ Updated teacher: ${teacherId} with ${teacherAssignments[teacherId].length} assignments`);
        updated++;
      }
    } catch (error) {
      console.log(`✗ Failed to update teacher ${teacherId}:`, error.message);
      failed++;
    }
  }
  
  console.log(`\n✓ ${dryRun ? 'Simulation' : 'Import'} complete:`);
  console.log(`  - Updated: ${updated}`);
  console.log(`  - Failed: ${failed}`);
  
  return { updated, failed };
};

// Main function
const runImport = async (csvFilePath, dryRun = false) => {
  console.log('📥 Teacher Assignment Import\n');
  
  if (!csvFilePath) {
    console.error('❌ Please provide a CSV file path');
    console.log('\nUsage:');
    console.log('  node import_teacher_assignments.js <csv_file> [--dry-run]');
    console.log('\nExample:');
    console.log('  node import_teacher_assignments.js assignments.csv');
    console.log('  node import_teacher_assignments.js assignments.csv --dry-run');
    process.exit(1);
  }
  
  if (!fs.existsSync(csvFilePath)) {
    console.error(`❌ File not found: ${csvFilePath}`);
    process.exit(1);
  }
  
  try {
    await connectDB();
    
    console.log(`📄 Reading CSV file: ${csvFilePath}`);
    const assignments = await parseCSV(csvFilePath);
    console.log(`✓ Found ${assignments.length} assignments`);
    
    const validation = await validateAssignments(assignments);
    
    if (validation.errors.length > 0) {
      console.log('\n❌ Cannot proceed due to validation errors');
      process.exit(1);
    }
    
    if (dryRun) {
      console.log('\n🔍 Running in DRY RUN mode (no changes will be made)');
    }
    
    const result = await importAssignments(assignments, dryRun);
    
    if (!dryRun && result.updated > 0) {
      console.log('\n✅ Import completed successfully!');
      console.log('\nNext steps:');
      console.log('  1. Verify assignments in the Staff module');
      console.log('  2. Create timetables using the new assignments');
    } else if (dryRun) {
      console.log('\n✅ Dry run completed successfully!');
      console.log('\nTo perform the actual import, run:');
      console.log(`  node import_teacher_assignments.js ${csvFilePath}`);
    }
    
  } catch (error) {
    console.error('\n❌ Import failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n✓ Database connection closed');
  }
};

// Parse command line arguments
const args = process.argv.slice(2);
const csvFilePath = args[0];
const dryRun = args.includes('--dry-run');

// Run import if called directly
if (require.main === module) {
  runImport(csvFilePath, dryRun);
}

module.exports = { runImport, parseCSV, validateAssignments, importAssignments };
