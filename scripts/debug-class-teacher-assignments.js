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

async function debugClassTeacherAssignments() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Get all classes with their teacher IDs
    const classes = await Class.find({}).lean();
    console.log('📚 Total Classes:', classes.length);
    console.log('\n=== Classes with Teachers ===');
    
    const classesWithTeachers = classes.filter(c => c.classTeacherId);
    console.log('Classes with teachers:', classesWithTeachers.length);
    
    classesWithTeachers.forEach(c => {
      console.log(`- ${c.name}-${c.section}: Teacher ID = ${c.classTeacherId} (type: ${typeof c.classTeacherId})`);
    });

    // Get all teachers
    const teachers = await Staff.find({
      $or: [
        { role: 'Teacher' },
        { staffType: 'Teacher' },
        { isClassTeacher: true }
      ]
    }).lean();
    
    console.log('\n👨‍🏫 Total Teachers:', teachers.length);
    console.log('\n=== Teacher Assignments ===');
    
    teachers.forEach(teacher => {
      const teacherId = String(teacher._id);
      const assignedClasses = classes.filter(c => 
        c.classTeacherId && String(c.classTeacherId) === teacherId
      );
      
      if (assignedClasses.length > 0) {
        console.log(`✓ ${teacher.name} (ID: ${teacherId})`);
        assignedClasses.forEach(c => {
          console.log(`  → Class ${c.name}-${c.section}`);
        });
      } else {
        console.log(`○ ${teacher.name} (ID: ${teacherId}) - No assignments`);
      }
    });

    // Check for duplicate assignments
    console.log('\n=== Checking for Issues ===');
    const teacherIdCounts = {};
    classesWithTeachers.forEach(c => {
      const id = String(c.classTeacherId);
      teacherIdCounts[id] = (teacherIdCounts[id] || 0) + 1;
    });

    const duplicates = Object.entries(teacherIdCounts).filter(([id, count]) => count > 1);
    if (duplicates.length > 0) {
      console.log('⚠️  Teachers assigned to multiple classes:');
      for (const [teacherId, count] of duplicates) {
        const teacher = teachers.find(t => String(t._id) === teacherId);
        const assignedClasses = classesWithTeachers.filter(c => String(c.classTeacherId) === teacherId);
        console.log(`  - ${teacher?.name || 'Unknown'} (${count} classes):`);
        assignedClasses.forEach(c => console.log(`    → ${c.name}-${c.section}`));
      }
    } else {
      console.log('✅ No duplicate assignments found');
    }

    // Check unassigned classes
    const unassignedClasses = classes.filter(c => !c.classTeacherId);
    console.log(`\n⚠️  Unassigned Classes: ${unassignedClasses.length}`);
    unassignedClasses.forEach(c => {
      console.log(`  - ${c.name}-${c.section}`);
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

debugClassTeacherAssignments();
