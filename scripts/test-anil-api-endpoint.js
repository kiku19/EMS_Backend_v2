import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/school_db';

const staffSchema = new mongoose.Schema({}, { strict: false });
const classSchema = new mongoose.Schema({}, { strict: false });
const studentSchema = new mongoose.Schema({}, { strict: false });

const Staff = mongoose.model('Staff', staffSchema);
const Class = mongoose.model('Class', classSchema);
const Student = mongoose.model('Student', studentSchema);

async function testApiEndpoint() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to database\n');

    // Find Anil Kumar
    const anil = await Staff.findOne({ name: { $regex: /anil/i } });
    if (!anil) {
      console.log('❌ Anil Kumar not found');
      return;
    }

    const id = anil._id.toString();
    console.log('=== SIMULATING /api/staff/:id/classes ENDPOINT ===');
    console.log(`Staff ID (as string): ${id}\n`);

    // Get classes from assignedClasses field
    const assignedClassIds = anil.assignedClasses || [];
    console.log('1. assignedClasses:', assignedClassIds);

    // Also get classes from teacherAssignments
    const teacherAssignmentClasses = (anil.teacherAssignments || []).flatMap(ta => ta.classes || []);
    console.log('2. teacherAssignments classes:', teacherAssignmentClasses.map(c => c.toString()));

    // Also get classes where this staff is the class teacher (using staff._id ObjectId)
    const classTeacherClasses = await Class.find({ classTeacherId: anil._id });
    const classTeacherClassIds = classTeacherClasses.map(c => c._id.toString());
    console.log('3. classTeacherId matches (using ObjectId):', classTeacherClassIds);
    console.log('   Found classes:', classTeacherClasses.map(c => `${c.name}-${c.section}`));

    // Combine all class IDs
    const allClassIds = [...new Set([...assignedClassIds, ...teacherAssignmentClasses.map(c => c.toString()), ...classTeacherClassIds])];
    console.log('\n=== COMBINED CLASS IDS ===');
    console.log('Total:', allClassIds.length);
    console.log('IDs:', allClassIds);

    // Fetch class details (simulating the API logic)
    console.log('\n=== CLASS DETAILS ===\n');
    
    for (const classId of allClassIds) {
      const classData = await Class.findById(classId);
      
      if (classData) {
        const studentCount = await Student.countDocuments({
          classId: classData._id,
          status: 'active',
          isDeleted: { $ne: true }
        });

        const isClassTeacher = classData.classTeacherId?.toString() === id;

        console.log(`${classData.name}-${classData.section}`);
        console.log(`  ID: ${classData._id}`);
        console.log(`  Students: ${studentCount}`);
        console.log(`  Is Class Teacher: ${isClassTeacher}`);
        console.log(`  Subject: ${isClassTeacher ? `Class Teacher - ${classData.name}` : (anil.department || 'General')}`);
        console.log('');
      }
    }

    console.log('=== SUMMARY ===');
    console.log(`Total classes shown in UI: ${allClassIds.length}`);
    console.log(`Classes where Anil is class teacher: ${classTeacherClassIds.length}`);
    console.log(`Classes from subject teaching: ${teacherAssignmentClasses.length}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

testApiEndpoint();
