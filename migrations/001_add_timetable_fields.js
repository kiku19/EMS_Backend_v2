/**
 * Migration: Add Timetable Management Fields
 * 
 * This migration adds new fields to existing models to support
 * the timetable management system:
 * - Adds teacherAssignments to Staff model
 * - Adds classTag and assignedSubjects to Class model
 * - Adds metadata fields to Timetable model
 * - Creates TeacherTimetable collection
 * - Creates ConflictLog collection
 * - Adds necessary indexes
 */

const mongoose = require('mongoose');
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

// Migration functions
const addStaffFields = async () => {
  console.log('\n📝 Adding teacherAssignments field to Staff collection...');
  
  const db = mongoose.connection.db;
  const staff = db.collection('staff');
  
  // Add teacherAssignments field to all staff members who don't have it
  const result = await staff.updateMany(
    { teacherAssignments: { $exists: false } },
    { $set: { teacherAssignments: [] } }
  );
  
  console.log(`✓ Updated ${result.modifiedCount} staff records`);
};

const addClassFields = async () => {
  console.log('\n📝 Adding classTag and assignedSubjects fields to Class collection...');
  
  const db = mongoose.connection.db;
  const classes = db.collection('classes');
  
  // Add new fields to all classes that don't have them
  const result = await classes.updateMany(
    {
      $or: [
        { classTag: { $exists: false } },
        { assignedSubjects: { $exists: false } }
      ]
    },
    {
      $set: {
        classTag: '',
        assignedSubjects: []
      }
    }
  );
  
  console.log(`✓ Updated ${result.modifiedCount} class records`);
};

const addTimetableFields = async () => {
  console.log('\n📝 Adding metadata fields to Timetable collection...');
  
  const db = mongoose.connection.db;
  const timetables = db.collection('timetables');
  
  // Add version and lastSyncedAt to all timetables
  const result = await timetables.updateMany(
    {
      $or: [
        { version: { $exists: false } },
        { lastSyncedAt: { $exists: false } }
      ]
    },
    {
      $set: {
        version: 1,
        lastSyncedAt: new Date()
      }
    }
  );
  
  console.log(`✓ Updated ${result.modifiedCount} timetable records`);
  
  // Add lastModified and modifiedBy to all schedule slots
  const timetablesWithSchedule = await timetables.find({ schedule: { $exists: true } }).toArray();
  
  let slotsUpdated = 0;
  for (const timetable of timetablesWithSchedule) {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    let needsUpdate = false;
    
    for (const day of days) {
      if (timetable.schedule[day]) {
        for (let i = 0; i < timetable.schedule[day].length; i++) {
          const slot = timetable.schedule[day][i];
          if (slot && slot.subject && !slot.lastModified) {
            timetable.schedule[day][i].lastModified = new Date();
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
  
  console.log(`✓ Updated ${slotsUpdated} timetable slots with metadata`);
};

const createTeacherTimetableCollection = async () => {
  console.log('\n📝 Creating TeacherTimetable collection...');
  
  const db = mongoose.connection.db;
  
  // Check if collection exists
  const collections = await db.listCollections({ name: 'teachertimetables' }).toArray();
  
  if (collections.length > 0) {
    console.log('✓ TeacherTimetable collection already exists');
    return;
  }
  
  // Create collection
  await db.createCollection('teachertimetables');
  console.log('✓ Created TeacherTimetable collection');
};

const createConflictLogCollection = async () => {
  console.log('\n📝 Creating ConflictLog collection...');
  
  const db = mongoose.connection.db;
  
  // Check if collection exists
  const collections = await db.listCollections({ name: 'conflictlogs' }).toArray();
  
  if (collections.length > 0) {
    console.log('✓ ConflictLog collection already exists');
    return;
  }
  
  // Create collection
  await db.createCollection('conflictlogs');
  console.log('✓ Created ConflictLog collection');
};

const createIndexes = async () => {
  console.log('\n📝 Creating indexes...');
  
  const db = mongoose.connection.db;
  
  // Timetable indexes
  const timetables = db.collection('timetables');
  await timetables.createIndex({ classId: 1, academicYear: 1 }, { unique: true });
  await timetables.createIndex({ 'schedule.Monday.teacherId': 1 });
  await timetables.createIndex({ 'schedule.Tuesday.teacherId': 1 });
  await timetables.createIndex({ 'schedule.Wednesday.teacherId': 1 });
  await timetables.createIndex({ 'schedule.Thursday.teacherId': 1 });
  await timetables.createIndex({ 'schedule.Friday.teacherId': 1 });
  await timetables.createIndex({ 'schedule.Saturday.teacherId': 1 });
  console.log('✓ Created Timetable indexes');
  
  // TeacherTimetable indexes
  const teacherTimetables = db.collection('teachertimetables');
  await teacherTimetables.createIndex({ teacherId: 1, academicYear: 1 }, { unique: true });
  console.log('✓ Created TeacherTimetable indexes');
  
  // Staff indexes for teacher assignments
  const staff = db.collection('staff');
  await staff.createIndex({ 'teacherAssignments.subject': 1 });
  await staff.createIndex({ 'teacherAssignments.classes': 1 });
  console.log('✓ Created Staff indexes');
  
  // ConflictLog indexes
  const conflictLogs = db.collection('conflictlogs');
  await conflictLogs.createIndex({ teacherId: 1, status: 1 });
  await conflictLogs.createIndex({ detectedAt: -1 });
  console.log('✓ Created ConflictLog indexes');
};

const generateTeacherTimetables = async () => {
  console.log('\n📝 Generating teacher timetables from class timetables...');
  
  const db = mongoose.connection.db;
  const timetables = db.collection('timetables');
  const teacherTimetables = db.collection('teachertimetables');
  
  // Get all class timetables
  const classTimetables = await timetables.find({}).toArray();
  
  // Build teacher schedules
  const teacherSchedules = {};
  
  for (const classTimetable of classTimetables) {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    for (const day of days) {
      if (classTimetable.schedule && classTimetable.schedule[day]) {
        classTimetable.schedule[day].forEach((slot, periodIndex) => {
          if (slot && slot.teacherId) {
            const teacherId = slot.teacherId.toString();
            
            if (!teacherSchedules[teacherId]) {
              teacherSchedules[teacherId] = {
                teacherId: slot.teacherId,
                academicYear: classTimetable.academicYear || '2024-25',
                schedule: {
                  Monday: [],
                  Tuesday: [],
                  Wednesday: [],
                  Thursday: [],
                  Friday: [],
                  Saturday: []
                },
                totalPeriodsPerWeek: 0,
                version: 1,
                lastSyncedAt: new Date()
              };
            }
            
            // Add slot to teacher schedule
            teacherSchedules[teacherId].schedule[day].push({
              periodIndex,
              classId: classTimetable.classId,
              subject: slot.subject,
              room: slot.room || '',
              lastModified: slot.lastModified || new Date()
            });
            
            teacherSchedules[teacherId].totalPeriodsPerWeek++;
          }
        });
      }
    }
  }
  
  // Insert teacher timetables
  let created = 0;
  for (const teacherId in teacherSchedules) {
    const existing = await teacherTimetables.findOne({
      teacherId: mongoose.Types.ObjectId(teacherId),
      academicYear: teacherSchedules[teacherId].academicYear
    });
    
    if (!existing) {
      await teacherTimetables.insertOne(teacherSchedules[teacherId]);
      created++;
    }
  }
  
  console.log(`✓ Created ${created} teacher timetables`);
};

const validateMigration = async () => {
  console.log('\n📝 Validating migration...');
  
  const db = mongoose.connection.db;
  
  // Check Staff collection
  const staff = db.collection('staff');
  const staffCount = await staff.countDocuments({ teacherAssignments: { $exists: true } });
  console.log(`✓ Staff records with teacherAssignments: ${staffCount}`);
  
  // Check Class collection
  const classes = db.collection('classes');
  const classCount = await classes.countDocuments({
    classTag: { $exists: true },
    assignedSubjects: { $exists: true }
  });
  console.log(`✓ Class records with new fields: ${classCount}`);
  
  // Check Timetable collection
  const timetables = db.collection('timetables');
  const timetableCount = await timetables.countDocuments({
    version: { $exists: true },
    lastSyncedAt: { $exists: true }
  });
  console.log(`✓ Timetable records with metadata: ${timetableCount}`);
  
  // Check TeacherTimetable collection
  const teacherTimetables = db.collection('teachertimetables');
  const teacherTimetableCount = await teacherTimetables.countDocuments({});
  console.log(`✓ Teacher timetables created: ${teacherTimetableCount}`);
  
  // Check indexes
  const timetableIndexes = await timetables.indexes();
  const teacherTimetableIndexes = await teacherTimetables.indexes();
  const staffIndexes = await staff.indexes();
  
  console.log(`✓ Timetable indexes: ${timetableIndexes.length}`);
  console.log(`✓ TeacherTimetable indexes: ${teacherTimetableIndexes.length}`);
  console.log(`✓ Staff indexes: ${staffIndexes.length}`);
};

// Main migration function
const runMigration = async () => {
  console.log('🚀 Starting Timetable Management Migration...\n');
  console.log('This migration will:');
  console.log('  1. Add teacherAssignments field to Staff collection');
  console.log('  2. Add classTag and assignedSubjects to Class collection');
  console.log('  3. Add metadata fields to Timetable collection');
  console.log('  4. Create TeacherTimetable collection');
  console.log('  5. Create ConflictLog collection');
  console.log('  6. Create necessary indexes');
  console.log('  7. Generate teacher timetables from class timetables');
  console.log('  8. Validate migration\n');
  
  try {
    await connectDB();
    
    await addStaffFields();
    await addClassFields();
    await addTimetableFields();
    await createTeacherTimetableCollection();
    await createConflictLogCollection();
    await createIndexes();
    await generateTeacherTimetables();
    await validateMigration();
    
    console.log('\n✅ Migration completed successfully!');
    console.log('\nNext steps:');
    console.log('  1. Restart your backend server');
    console.log('  2. Set ENABLE_TIMETABLE_MANAGEMENT=true in .env');
    console.log('  3. Test the timetable management features');
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    console.error('\nPlease restore from backup and contact support.');
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n✓ Database connection closed');
  }
};

// Run migration if called directly
if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };
