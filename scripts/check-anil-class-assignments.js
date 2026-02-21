import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/school_db';

// Define schemas
const staffSchema = new mongoose.Schema({
  name: String,
  code: String,
  department: String,
  isClassTeacher: Boolean,
  assignedClass: mongoose.Schema.Types.ObjectId,
  assignedClasses: [mongoose.Schema.Types.ObjectId]
}, { strict: false });

const classSchema = new mongoose.Schema({
  name: String,
  section: String,
  classTeacher: mongoose.Schema.Types.ObjectId
}, { strict: false });

const Staff = mongoose.model('Staff', staffSchema);
const Class = mongoose.model('Class', classSchema);

async function checkAnilAssignments() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to database\n');

    // Find Anil Kumar
    const anil = await Staff.findOne({ name: { $regex: /anil/i } });
    if (!anil) {
      console.log('❌ Anil Kumar not found');
      return;
    }

    console.log('=== ANIL KUMAR STAFF RECORD ===');
    console.log('Name:', anil.name);
    console.log('ID:', anil._id);
    console.log('isClassTeacher:', anil.isClassTeacher);
    console.log('assignedClass:', anil.assignedClass);
    console.log('assignedClasses:', anil.assignedClasses);
    console.log('');

    // Find all classes where Anil is the class teacher
    console.log('=== CLASSES WHERE ANIL IS CLASS TEACHER ===');
    const classesWithAnil = await Class.find({ classTeacher: anil._id });
    console.log(`Found ${classesWithAnil.length} classes:\n`);
    
    classesWithAnil.forEach(cls => {
      console.log(`  - ${cls.name}-${cls.section} (ID: ${cls._id})`);
    });
    console.log('');

    // Check if assignedClass matches
    if (anil.assignedClass) {
      const assignedClass = await Class.findById(anil.assignedClass);
      console.log('=== ASSIGNED CLASS (from staff.assignedClass) ===');
      if (assignedClass) {
        console.log(`  ${assignedClass.name}-${assignedClass.section}`);
      } else {
        console.log('  ⚠️ assignedClass ID exists but class not found');
      }
      console.log('');
    }

    // Check assignedClasses array
    if (anil.assignedClasses && anil.assignedClasses.length > 0) {
      console.log('=== ASSIGNED CLASSES (from staff.assignedClasses array) ===');
      for (const classId of anil.assignedClasses) {
        const cls = await Class.findById(classId);
        if (cls) {
          console.log(`  - ${cls.name}-${cls.section} (ID: ${classId})`);
        } else {
          console.log(`  - ⚠️ Class ID ${classId} not found`);
        }
      }
      console.log('');
    }

    // Analysis
    console.log('=== ANALYSIS ===');
    console.log(`Classes where Anil is classTeacher: ${classesWithAnil.length}`);
    console.log(`Expected: 1 (only 6A)`);
    
    if (classesWithAnil.length > 1) {
      console.log('\n⚠️ ISSUE FOUND: Multiple classes have Anil as classTeacher');
      console.log('These classes should be checked:');
      classesWithAnil.forEach(cls => {
        const is6A = cls.name === '6' && cls.section === 'A';
        console.log(`  - ${cls.name}-${cls.section} ${is6A ? '✓ (correct)' : '✗ (should be removed)'}`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

checkAnilAssignments();
