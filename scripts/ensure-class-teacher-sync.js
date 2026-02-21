import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

const StaffSchema = new mongoose.Schema({
  name: String,
  classTeacherOf: String,
  isClassTeacher: Boolean
}, { strict: false });

const ClassSchema = new mongoose.Schema({
  name: String,
  section: String,
  classTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' }
}, { strict: false });

const Staff = mongoose.model('Staff', StaffSchema);
const Class = mongoose.model('Class', ClassSchema);

/**
 * This script ensures both fields are synchronized:
 * - Class.classTeacherId (source of truth)
 * - Staff.classTeacherOf (for convenience/backward compatibility)
 * 
 * Run this periodically or after bulk operations to ensure consistency.
 */
async function ensureSync() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    console.log('=== Synchronizing Class Teacher Data ===\n');

    // Step 1: Clear all staff classTeacherOf fields first
    console.log('Step 1: Clearing all staff classTeacherOf fields...');
    await Staff.updateMany({}, {
      $set: { 
        classTeacherOf: null,
        isClassTeacher: false
      }
    });
    console.log('✅ Cleared\n');

    // Step 2: Update staff based on class assignments
    console.log('Step 2: Updating staff based on class assignments...\n');

    const classesWithTeachers = await Class.find({
      classTeacherId: { $exists: true, $ne: null }
    }).populate('classTeacherId');

    let updated = 0;

    for (const cls of classesWithTeachers) {
      if (!cls.classTeacherId) continue;

      const teacherId = cls.classTeacherId._id;
      const classTeacherOf = `${cls.name}-${cls.section}`;

      await Staff.findByIdAndUpdate(teacherId, {
        classTeacherOf: classTeacherOf,
        isClassTeacher: true
      });

      console.log(`  ✓ ${cls.classTeacherId.name} → ${classTeacherOf}`);
      updated++;
    }

    console.log(`\n✅ Updated ${updated} staff members\n`);

    // Step 3: Verification
    console.log('Step 3: Verification...\n');

    const allClasses = await Class.find({}).populate('classTeacherId').lean();
    const allStaff = await Staff.find({ isClassTeacher: true }).lean();

    console.log('📊 Summary:');
    console.log(`  Classes with teachers: ${classesWithTeachers.length}`);
    console.log(`  Staff marked as class teachers: ${allStaff.length}`);

    if (classesWithTeachers.length === allStaff.length) {
      console.log('  ✅ Counts match!\n');
    } else {
      console.log('  ⚠️  Counts don\'t match - may need investigation\n');
    }

    // Show sample data
    console.log('Sample synchronized data:');
    for (let i = 0; i < Math.min(5, classesWithTeachers.length); i++) {
      const cls = classesWithTeachers[i];
      const teacher = await Staff.findById(cls.classTeacherId._id);
      console.log(`  Class ${cls.name}-${cls.section}:`);
      console.log(`    → Class.classTeacherId: ${cls.classTeacherId.name}`);
      console.log(`    → Staff.classTeacherOf: ${teacher.classTeacherOf}`);
      console.log(`    → Match: ${teacher.classTeacherOf === `${cls.name}-${cls.section}` ? '✅' : '❌'}\n`);
    }

    console.log('=== Synchronization Complete ===\n');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  }
}

ensureSync();
