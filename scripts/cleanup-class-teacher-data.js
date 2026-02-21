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

async function cleanupClassTeacherData() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    console.log('=== CLEANUP PLAN ===\n');
    console.log('1. Standardize Class.name format (remove "Class " prefix)');
    console.log('2. Remove redundant Staff.classTeacherOf field');
    console.log('3. Remove redundant Staff.isClassTeacher field');
    console.log('4. Keep Class.classTeacherId as single source of truth\n');

    // Step 1: Standardize class names
    console.log('Step 1: Standardizing class names...\n');
    
    const classes = await Class.find({});
    let classesUpdated = 0;

    for (const cls of classes) {
      if (cls.name.startsWith('Class ')) {
        const newName = cls.name.replace('Class ', '');
        await Class.findByIdAndUpdate(cls._id, { name: newName });
        console.log(`  ✓ Updated: "${cls.name}" → "${newName}"`);
        classesUpdated++;
      }
    }

    console.log(`\n✅ Updated ${classesUpdated} class names\n`);

    // Step 2: Remove redundant fields from Staff
    console.log('Step 2: Removing redundant fields from Staff...\n');

    const result = await Staff.updateMany(
      {},
      { 
        $unset: { 
          classTeacherOf: "",
          isClassTeacher: ""
        }
      }
    );

    console.log(`✅ Removed redundant fields from ${result.modifiedCount} staff members\n`);

    // Step 3: Verify
    console.log('Step 3: Verification...\n');

    const allClasses = await Class.find({}).populate('classTeacherId');
    const assignedClasses = allClasses.filter(c => c.classTeacherId);

    console.log('📚 Classes:');
    console.log(`  Total: ${allClasses.length}`);
    console.log(`  Assigned: ${assignedClasses.length}`);
    console.log(`  Unassigned: ${allClasses.length - assignedClasses.length}\n`);

    console.log('Sample classes:');
    allClasses.slice(0, 5).forEach(c => {
      const teacher = c.classTeacherId?.name || 'Unassigned';
      console.log(`  ${c.name}-${c.section}: ${teacher}`);
    });

    console.log('\n=== CLEANUP COMPLETE ===\n');
    console.log('✅ Class names standardized (no "Class " prefix)');
    console.log('✅ Redundant Staff fields removed');
    console.log('✅ Class.classTeacherId is now the single source of truth\n');

    console.log('To find a teacher\'s assigned class:');
    console.log('  const cls = await Class.findOne({ classTeacherId: teacherId });\n');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  }
}

cleanupClassTeacherData();
