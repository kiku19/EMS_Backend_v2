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

const Staff = mongoose.model('Staff', staffSchema);
const Class = mongoose.model('Class', classSchema);

async function checkAnilFullData() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to database\n');

    const anil = await Staff.findOne({ name: { $regex: /anil/i } });
    if (!anil) {
      console.log('❌ Anil Kumar not found');
      return;
    }

    console.log('=== ANIL KUMAR COMPLETE DATA ===\n');
    console.log(JSON.stringify(anil.toObject(), null, 2));
    console.log('\n');

    // Check classes where Anil is classTeacherId
    console.log('=== CLASSES WHERE ANIL IS classTeacherId ===');
    const classTeacherClasses = await Class.find({ classTeacherId: anil._id });
    console.log(`Found ${classTeacherClasses.length} classes:\n`);
    classTeacherClasses.forEach(cls => {
      console.log(`  - ${cls.name}-${cls.section} (ID: ${cls._id})`);
    });
    console.log('');

    // Simulate the API endpoint logic
    console.log('=== SIMULATING API ENDPOINT /api/staff/:id/classes ===\n');
    
    const assignedClassIds = anil.assignedClasses || [];
    console.log('1. assignedClasses:', assignedClassIds);
    
    const teacherAssignmentClasses = (anil.teacherAssignments || []).flatMap(ta => ta.classes || []);
    console.log('2. teacherAssignments classes:', teacherAssignmentClasses);
    
    const classTeacherClassIds = classTeacherClasses.map(c => c._id.toString());
    console.log('3. classTeacherId matches:', classTeacherClassIds);
    
    const allClassIds = [...new Set([...assignedClassIds, ...teacherAssignmentClasses.map(c => c.toString()), ...classTeacherClassIds])];
    console.log('\nCombined unique class IDs:', allClassIds);
    console.log('Total classes shown in UI:', allClassIds.length);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

checkAnilFullData();
