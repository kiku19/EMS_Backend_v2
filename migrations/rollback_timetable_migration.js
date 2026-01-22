/**
 * Rollback: Timetable Management Migration
 * 
 * This script rolls back the timetable management migration by:
 * - Removing teacherAssignments from Staff collection
 * - Removing classTag and assignedSubjects from Class collection
 * - Removing metadata fields from Timetable collection
 * - Dropping TeacherTimetable collection
 * - Dropping ConflictLog collection
 * - Removing indexes
 */

const mongoose = require('mongoose');
const readline = require('readline');
require('dotenv').config();

// Create readline interface for user confirmation
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

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

// Rollback functions
const removeStaffFields = async () => {
  console.log('\n📝 Removing teacherAssignments field from Staff collection...');
  
  const db = mongoose.connection.db;
  const staff = db.collection('staff');
  
  const result = await staff.updateMany(
    { teacherAssignments: { $exists: true } },
    { $unset: { teacherAssignments: '' } }
  );
  
  console.log(`✓ Removed teacherAssignments from ${result.modifiedCount} staff records`);
};

const removeClassFields = async () => {
  console.log('\n📝 Removing classTag and assignedSubjects from Class collection...');
  
  const db = mongoose.connection.db;
  const classes = db.collection('classes');
  
  const result = await classes.updateMany(
    {
      $or: [
        { classTag: { $exists: true } },
        { assignedSubjects: { $exists: true } }
      ]
    },
    {
      $unset: {
        classTag: '',
        assignedSubjects: ''
      }
    }
  );
  
  console.log(`✓ Removed fields from ${result.modifiedCount} class records`);
};

const removeTimetableFields = async () => {
  console.log('\n📝 Removing metadata fields from Timetable collection...');
  
  const db = mongoose.connection.db;
  const timetables = db.collection('timetables');
  
  // Remove version and lastSyncedAt
  const result = await timetables.updateMany(
    {
      $or: [
        { version: { $exists: true } },
        { lastSyncedAt: { $exists: true } }
      ]
    },
    {
      $unset: {
        version: '',
        lastSyncedAt: ''
      }
    }
  );
  
  console.log(`✓ Removed metadata from ${result.modifiedCount} timetable records`);
  
  // Remove lastModified and modifiedBy from schedule slots
  const timetablesWithSchedule = await timetables.find({ schedule: { $exists: true } }).toArray();
  
  let slotsUpdated = 0;
  for (const timetable of timetablesWithSchedule) {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    let needsUpdate = false;
    
    for (const day of days) {
      if (timetable.schedule[day]) {
        for (let i = 0; i < timetable.schedule[day].length; i++) {
          const slot = timetable.schedule[day][i];
          if (slot && (slot.lastModified || slot.modifiedBy)) {
            delete timetable.schedule[day][i].lastModified;
            delete timetable.schedule[day][i].modifiedBy;
            needsUpdate = true;
            slotsUpdated++;
          }
        }
      }
    }
    
    if (needsUpdate) {
      await timetables.updateOne(
        { _id: timetable._id },
        { $set: { schedule: timetable.schedule } }
      );
    }
  }
  
  console.log(`✓ Removed metadata from ${slotsUpdated} timetable slots`);
};

const dropTeacherTimetableCollection = async () => {
  console.log('\n📝 Dropping TeacherTimetable collection...');
  
  const db = mongoose.connection.db;
  
  try {
    await db.dropCollection('teachertimetables');
    console.log('✓ Dropped TeacherTimetable collection');
  } catch (error) {
    if (error.message.includes('ns not found')) {
      console.log('✓ TeacherTimetable collection does not exist');
    } else {
      throw error;
    }
  }
};

const dropConflictLogCollection = async () => {
  console.log('\n📝 Dropping ConflictLog collection...');
  
  const db = mongoose.connection.db;
  
  try {
    await db.dropCollection('conflictlogs');
    console.log('✓ Dropped ConflictLog collection');
  } catch (error) {
    if (error.message.includes('ns not found')) {
      console.log('✓ ConflictLog collection does not exist');
    } else {
      throw error;
    }
  }
};

const removeIndexes = async () => {
  console.log('\n📝 Removing indexes...');
  
  const db = mongoose.connection.db;
  
  // Remove Timetable indexes
  const timetables = db.collection('timetables');
  try {
    await timetables.dropIndex('schedule.Monday.teacherId_1');
    await timetables.dropIndex('schedule.Tuesday.teacherId_1');
    await timetables.dropIndex('schedule.Wednesday.teacherId_1');
    await timetables.dropIndex('schedule.Thursday.teacherId_1');
    await timetables.dropIndex('schedule.Friday.teacherId_1');
    await timetables.dropIndex('schedule.Saturday.teacherId_1');
    console.log('✓ Removed Timetable indexes');
  } catch (error) {
    console.log('⚠ Some Timetable indexes may not exist');
  }
  
  // Remove Staff indexes
  const staff = db.collection('staff');
  try {
    await staff.dropIndex('teacherAssignments.subject_1');
    await staff.dropIndex('teacherAssignments.classes_1');
    console.log('✓ Removed Staff indexes');
  } catch (error) {
    console.log('⚠ Some Staff indexes may not exist');
  }
};

const validateRollback = async () => {
  console.log('\n📝 Validating rollback...');
  
  const db = mongoose.connection.db;
  
  // Check Staff collection
  const staff = db.collection('staff');
  const staffWithAssignments = await staff.countDocuments({ teacherAssignments: { $exists: true } });
  console.log(`✓ Staff records with teacherAssignments: ${staffWithAssignments} (should be 0)`);
  
  // Check Class collection
  const classes = db.collection('classes');
  const classesWithFields = await classes.countDocuments({
    $or: [
      { classTag: { $exists: true } },
      { assignedSubjects: { $exists: true } }
    ]
  });
  console.log(`✓ Class records with new fields: ${classesWithFields} (should be 0)`);
  
  // Check Timetable collection
  const timetables = db.collection('timetables');
  const timetablesWithMetadata = await timetables.countDocuments({
    $or: [
      { version: { $exists: true } },
      { lastSyncedAt: { $exists: true } }
    ]
  });
  console.log(`✓ Timetable records with metadata: ${timetablesWithMetadata} (should be 0)`);
  
  // Check TeacherTimetable collection
  const collections = await db.listCollections({ name: 'teachertimetables' }).toArray();
  console.log(`✓ TeacherTimetable collection exists: ${collections.length > 0 ? 'Yes' : 'No'} (should be No)`);
  
  // Check ConflictLog collection
  const conflictCollections = await db.listCollections({ name: 'conflictlogs' }).toArray();
  console.log(`✓ ConflictLog collection exists: ${conflictCollections.length > 0 ? 'Yes' : 'No'} (should be No)`);
};

// Main rollback function
const runRollback = async () => {
  console.log('⚠️  TIMETABLE MANAGEMENT MIGRATION ROLLBACK\n');
  console.log('This will REMOVE all timetable management features and data:');
  console.log('  1. Remove teacherAssignments from Staff collection');
  console.log('  2. Remove classTag and assignedSubjects from Class collection');
  console.log('  3. Remove metadata from Timetable collection');
  console.log('  4. Drop TeacherTimetable collection (ALL TEACHER TIMETABLES WILL BE DELETED)');
  console.log('  5. Drop ConflictLog collection');
  console.log('  6. Remove indexes\n');
  
  console.log('⚠️  WARNING: This action cannot be undone!');
  console.log('⚠️  Make sure you have a backup before proceeding.\n');
  
  const answer = await question('Are you sure you want to rollback? (yes/no): ');
  
  if (answer.toLowerCase() !== 'yes') {
    console.log('\n❌ Rollback cancelled');
    rl.close();
    process.exit(0);
  }
  
  const confirmAnswer = await question('\nType "ROLLBACK" to confirm: ');
  
  if (confirmAnswer !== 'ROLLBACK') {
    console.log('\n❌ Rollback cancelled');
    rl.close();
    process.exit(0);
  }
  
  rl.close();
  
  try {
    await connectDB();
    
    console.log('\n🚀 Starting rollback...');
    
    await removeStaffFields();
    await removeClassFields();
    await removeTimetableFields();
    await dropTeacherTimetableCollection();
    await dropConflictLogCollection();
    await removeIndexes();
    await validateRollback();
    
    console.log('\n✅ Rollback completed successfully!');
    console.log('\nNext steps:');
    console.log('  1. Set ENABLE_TIMETABLE_MANAGEMENT=false in .env');
    console.log('  2. Restart your backend server');
    console.log('  3. Verify the system is working correctly');
    
  } catch (error) {
    console.error('\n❌ Rollback failed:', error);
    console.error('\nPlease restore from backup and contact support.');
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n✓ Database connection closed');
  }
};

// Run rollback if called directly
if (require.main === module) {
  runRollback();
}

module.exports = { runRollback };
