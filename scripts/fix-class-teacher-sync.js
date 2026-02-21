import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// MongoDB connection
const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/school-management';

// Define schemas
const StaffSchema = new mongoose.Schema({
  name: String,
  role: [String],
  staffType: [String],
  isClassTeacher: Boolean,
  classTeacherOf: String
}, { strict: false });

const ClassSchema = new mongoose.Schema({
  name: String,
  section: String,
  classTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' }
}, { strict: false });

const Staff = mongoose.model('Staff', StaffSchema);
const Class = mongoose.model('Class', ClassSchema);

async function fixClassTeacherSync() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Get all teachers who claim to be class teachers
    const teachersWithClasses = await Staff.find({
      classTeacherOf: { $exists: true, $ne: null, $ne: '' }
    }).lean();

    console.log('👨‍🏫 Teachers claiming to be class teachers:', teachersWithClasses.length);
    console.log('\n=== Checking Consistency ===\n');

    let fixed = 0;
    let alreadyCorrect = 0;
    let notFound = 0;

    for (const teacher of teachersWithClasses) {
      const teacherId = teacher._id;
      const claimedClass = teacher.classTeacherOf; // e.g., "Class 7-A" or "7-A"
      
      console.log(`\n📋 ${teacher.name} claims: "${claimedClass}"`);

      // Parse the class name and section
      let className, section;
      
      // Try different formats
      if (claimedClass.includes('Class ')) {
        // Format: "Class 7-A"
        const parts = claimedClass.replace('Class ', '').split('-');
        className = `Class ${parts[0].trim()}`; // Keep "Class " prefix
        section = parts[1]?.trim();
      } else if (claimedClass.includes('-')) {
        // Format: "7-A"
        const parts = claimedClass.split('-');
        className = `Class ${parts[0].trim()}`; // Add "Class " prefix
        section = parts[1]?.trim();
      } else {
        console.log(`  ⚠️  Cannot parse class format: "${claimedClass}"`);
        continue;
      }

      console.log(`  → Parsed as: Class ${className}, Section ${section}`);

      // Find the class in database
      const classDoc = await Class.findOne({ 
        name: className,
        section: section 
      });

      if (!classDoc) {
        console.log(`  ❌ Class not found in database!`);
        notFound++;
        continue;
      }

      // Check if class already has this teacher assigned
      if (classDoc.classTeacherId && String(classDoc.classTeacherId) === String(teacherId)) {
        console.log(`  ✅ Already correct - class has this teacher assigned`);
        alreadyCorrect++;
        continue;
      }

      // Check if class has a different teacher
      if (classDoc.classTeacherId && String(classDoc.classTeacherId) !== String(teacherId)) {
        const otherTeacher = await Staff.findById(classDoc.classTeacherId);
        console.log(`  ⚠️  Class currently assigned to: ${otherTeacher?.name || 'Unknown'}`);
        console.log(`  🔧 Updating to: ${teacher.name}`);
      } else {
        console.log(`  🔧 Class has no teacher - assigning ${teacher.name}`);
      }

      // Update the class to have this teacher
      await Class.findByIdAndUpdate(classDoc._id, {
        classTeacherId: teacherId
      });

      console.log(`  ✅ Fixed! Class ${className}-${section} now has ${teacher.name}`);
      fixed++;
    }

    console.log('\n\n=== Summary ===');
    console.log(`✅ Already correct: ${alreadyCorrect}`);
    console.log(`🔧 Fixed: ${fixed}`);
    console.log(`❌ Class not found: ${notFound}`);

    // Now check the reverse - classes that have teachers but teachers don't know about it
    console.log('\n\n=== Checking Reverse (Classes → Teachers) ===\n');

    const classesWithTeachers = await Class.find({
      classTeacherId: { $exists: true, $ne: null }
    }).populate('classTeacherId').lean();

    let reverseFixed = 0;
    let reverseCorrect = 0;

    for (const cls of classesWithTeachers) {
      const teacher = cls.classTeacherId;
      if (!teacher) continue;

      const expectedClassTeacherOf = `${cls.name}-${cls.section}`;
      
      console.log(`\n📋 Class ${cls.name}-${cls.section} has teacher: ${teacher.name}`);
      console.log(`  → Teacher's classTeacherOf: "${teacher.classTeacherOf}"`);

      if (teacher.classTeacherOf === expectedClassTeacherOf || 
          teacher.classTeacherOf === `Class ${expectedClassTeacherOf}`) {
        console.log(`  ✅ Already correct`);
        reverseCorrect++;
        continue;
      }

      // Update teacher's classTeacherOf field
      await Staff.findByIdAndUpdate(teacher._id, {
        classTeacherOf: expectedClassTeacherOf,
        isClassTeacher: true
      });

      console.log(`  🔧 Updated teacher's classTeacherOf to: ${expectedClassTeacherOf}`);
      reverseFixed++;
    }

    console.log('\n=== Reverse Summary ===');
    console.log(`✅ Already correct: ${reverseCorrect}`);
    console.log(`🔧 Fixed: ${reverseFixed}`);

    // Final verification
    console.log('\n\n=== Final Verification ===\n');
    
    const allClasses = await Class.find({}).populate('classTeacherId').lean();
    const assignedClasses = allClasses.filter(c => c.classTeacherId);
    const unassignedClasses = allClasses.filter(c => !c.classTeacherId);

    console.log(`📚 Total Classes: ${allClasses.length}`);
    console.log(`✅ Assigned: ${assignedClasses.length}`);
    console.log(`⚠️  Unassigned: ${unassignedClasses.length}`);

    console.log('\n=== Assigned Classes ===');
    assignedClasses.forEach(c => {
      console.log(`  ✓ Class ${c.name}-${c.section}: ${c.classTeacherId?.name || 'Unknown'}`);
    });

    if (unassignedClasses.length > 0) {
      console.log('\n=== Unassigned Classes ===');
      unassignedClasses.forEach(c => {
        console.log(`  ○ Class ${c.name}-${c.section}`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

fixClassTeacherSync();
