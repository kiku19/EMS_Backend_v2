import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/school_db';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

// Define schemas
const Student = mongoose.model('Student', new mongoose.Schema({}, { strict: false }));
const Class = mongoose.model('Class', new mongoose.Schema({}, { strict: false }));

async function fixIsDeletedField() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('🔧 FIX 1: Set isDeleted=false for all students');
  console.log('═══════════════════════════════════════════════════════════\n');

  const studentsWithoutIsDeleted = await Student.countDocuments({ 
    isDeleted: { $exists: false } 
  });

  console.log(`Found ${studentsWithoutIsDeleted} students without isDeleted field`);
  
  if (studentsWithoutIsDeleted === 0) {
    console.log('✓ No students need fixing');
    return;
  }

  const answer = await question(`\nDo you want to set isDeleted=false for these ${studentsWithoutIsDeleted} students? (yes/no): `);
  
  if (answer.toLowerCase() !== 'yes') {
    console.log('Skipped.');
    return;
  }

  const result = await Student.updateMany(
    { isDeleted: { $exists: false } },
    { $set: { isDeleted: false } }
  );

  console.log(`✅ Updated ${result.modifiedCount} students`);
}

async function fixClassStrength() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('🔧 FIX 2: Update class strength based on actual student count');
  console.log('═══════════════════════════════════════════════════════════\n');

  const allClasses = await Class.find({});
  
  console.log('Current class strengths vs actual counts:\n');

  const updates = [];
  
  for (const cls of allClasses) {
    const actualCount = await Student.countDocuments({
      classId: cls._id,
      status: 'active',
      isDeleted: { $ne: true }
    });

    const storedStrength = cls.strength || 0;
    
    if (actualCount !== storedStrength) {
      console.log(`   ${cls.name}-${cls.section}: ${storedStrength} → ${actualCount}`);
      updates.push({ cls, actualCount });
    }
  }

  if (updates.length === 0) {
    console.log('✓ All class strengths are correct');
    return;
  }

  const answer = await question(`\nDo you want to update ${updates.length} class strengths? (yes/no): `);
  
  if (answer.toLowerCase() !== 'yes') {
    console.log('Skipped.');
    return;
  }

  let updated = 0;
  for (const { cls, actualCount } of updates) {
    await Class.updateOne(
      { _id: cls._id },
      { $set: { strength: actualCount } }
    );
    updated++;
  }

  console.log(`✅ Updated ${updated} classes`);
}

async function fixTransferredStatus() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('🔧 FIX 3: Fix students with "transferred" status');
  console.log('═══════════════════════════════════════════════════════════\n');

  const transferredStudents = await Student.find({ status: 'transferred' });

  if (transferredStudents.length === 0) {
    console.log('✓ No students with "transferred" status');
    return;
  }

  console.log(`Found ${transferredStudents.length} students with "transferred" status:`);
  transferredStudents.forEach(s => {
    console.log(`   - ${s.name} (${s.admissionId})`);
  });

  console.log('\nOptions:');
  console.log('1. Change to "alumni"');
  console.log('2. Change to "inactive"');
  console.log('3. Skip');

  const answer = await question('\nSelect option (1/2/3): ');

  let newStatus;
  if (answer === '1') {
    newStatus = 'alumni';
  } else if (answer === '2') {
    newStatus = 'inactive';
  } else {
    console.log('Skipped.');
    return;
  }

  const result = await Student.updateMany(
    { status: 'transferred' },
    { $set: { status: newStatus } }
  );

  console.log(`✅ Updated ${result.modifiedCount} students to "${newStatus}"`);
}

async function addMissingIndexes() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('🔧 FIX 4: Add database indexes for better performance');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Creating indexes...');

  try {
    // Student indexes
    await Student.collection.createIndex({ classId: 1, status: 1 });
    console.log('✓ Created index: Student.classId + status');

    await Student.collection.createIndex({ status: 1 });
    console.log('✓ Created index: Student.status');

    await Student.collection.createIndex({ isDeleted: 1 });
    console.log('✓ Created index: Student.isDeleted');

    await Student.collection.createIndex({ admissionId: 1 });
    console.log('✓ Created index: Student.admissionId');

    // Class indexes
    await Class.collection.createIndex({ name: 1, section: 1 });
    console.log('✓ Created index: Class.name + section');

    console.log('\n✅ All indexes created successfully');
  } catch (error) {
    if (error.code === 85 || error.message.includes('already exists')) {
      console.log('ℹ️  Some indexes already exist (this is normal)');
    } else {
      console.error('❌ Error creating indexes:', error.message);
    }
  }
}

async function generateFixReport() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('📊 POST-FIX VERIFICATION');
  console.log('═══════════════════════════════════════════════════════════\n');

  const totalStudents = await Student.countDocuments({});
  const studentsWithIsDeleted = await Student.countDocuments({ isDeleted: { $exists: true } });
  const studentsWithoutIsDeleted = totalStudents - studentsWithIsDeleted;

  console.log('Student Field Status:');
  console.log(`   Total students: ${totalStudents}`);
  console.log(`   With isDeleted field: ${studentsWithIsDeleted}`);
  console.log(`   Without isDeleted field: ${studentsWithoutIsDeleted}`);

  if (studentsWithoutIsDeleted === 0) {
    console.log('   ✅ All students have isDeleted field');
  } else {
    console.log(`   ⚠️  ${studentsWithoutIsDeleted} students still missing isDeleted field`);
  }

  const allClasses = await Class.find({});
  let classesWithCorrectStrength = 0;
  let classesWithIncorrectStrength = 0;

  for (const cls of allClasses) {
    const actualCount = await Student.countDocuments({
      classId: cls._id,
      status: 'active',
      isDeleted: { $ne: true }
    });

    if (cls.strength === actualCount) {
      classesWithCorrectStrength++;
    } else {
      classesWithIncorrectStrength++;
    }
  }

  console.log('\nClass Strength Status:');
  console.log(`   Correct: ${classesWithCorrectStrength}/${allClasses.length}`);
  console.log(`   Incorrect: ${classesWithIncorrectStrength}/${allClasses.length}`);

  if (classesWithIncorrectStrength === 0) {
    console.log('   ✅ All class strengths are correct');
  } else {
    console.log(`   ⚠️  ${classesWithIncorrectStrength} classes still have incorrect strength`);
  }

  const transferredCount = await Student.countDocuments({ status: 'transferred' });
  console.log('\nStatus Field:');
  console.log(`   Students with "transferred" status: ${transferredCount}`);
  if (transferredCount === 0) {
    console.log('   ✅ No students with invalid status');
  }
}

async function main() {
  try {
    console.log('🔧 Database Issue Fixer');
    console.log('This script will fix common database issues found by the diagnostic tool\n');

    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });

    console.log('✅ Connected to MongoDB\n');

    console.log('⚠️  WARNING: This script will modify your database!');
    console.log('Make sure you have a backup before proceeding.\n');

    const proceed = await question('Do you want to continue? (yes/no): ');
    
    if (proceed.toLowerCase() !== 'yes') {
      console.log('Aborted.');
      process.exit(0);
    }

    // Run all fixes
    await fixIsDeletedField();
    await fixClassStrength();
    await fixTransferredStatus();
    await addMissingIndexes();
    await generateFixReport();

    console.log('\n\n✅ All fixes completed!');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('📝 Next Steps:');
    console.log('1. Restart your backend server');
    console.log('2. Clear browser cache and reload school dashboard');
    console.log('3. Verify that all student counts are correct\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    rl.close();
    await mongoose.connection.close();
    process.exit(0);
  }
}

main();
