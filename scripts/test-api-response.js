import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/school_db';

const classSchema = new mongoose.Schema({
  name: String,
  section: String,
  strength: Number
}, { strict: false });

const studentSchema = new mongoose.Schema({
  name: String,
  rollNo: Number,
  classId: mongoose.Schema.Types.ObjectId,
  status: String,
  isDeleted: Boolean,
  academicYear: String,
  admissionId: String
}, { strict: false });

const Class = mongoose.model('Class', classSchema);
const Student = mongoose.model('Student', studentSchema);

async function testApiResponse() {
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    
    console.log('✅ Connected to MongoDB\n');
    
    // Simulate the backend API query
    console.log('📡 Simulating GET /api/students query...\n');
    
    const query = { isDeleted: { $ne: true } };
    
    const students = await Student.find(query)
      .populate('classId', 'name section')
      .sort({ rollNo: 1 })
      .limit(50);
    
    console.log(`📊 Total students returned: ${students.length}\n`);
    
    // Find class 5A students
    const class5A = await Class.findOne({ name: 'Class 5', section: 'A' });
    
    const class5AStudents = students.filter(s => 
      s.classId && s.classId._id.toString() === class5A._id.toString()
    );
    
    console.log(`📋 Class 5A students in response: ${class5AStudents.length}`);
    console.log('');
    
    class5AStudents.forEach(s => {
      try {
        const classInfo = s.classId && s.classId.name ? `${s.classId.name.replace('Class ', '')}-${s.classId.section}` : 'NO CLASS INFO';
        console.log(`  - ${s.name}`);
        console.log(`    Roll: ${s.rollNo}`);
        console.log(`    Status: ${s.status}`);
        console.log(`    isDeleted: ${s.isDeleted}`);
        console.log(`    class field: "${classInfo}"`);
        console.log(`    classId exists: ${!!s.classId}`);
        if (s.classId) {
          console.log(`    classId._id: ${s.classId._id}`);
          console.log(`    classId.name: ${s.classId.name}`);
          console.log(`    classId.section: ${s.classId.section}`);
        }
        console.log('');
      } catch (err) {
        console.log(`  ERROR processing ${s.name}:`, err.message);
        console.log(`  classId:`, s.classId);
        console.log('');
      }
    });
    
    // Check what the formatted response would look like
    console.log('📦 Formatted API response for class 5A students:\n');
    
    const formatted = class5AStudents.map(s => {
      const classInfo = s.classId && s.classId.name ? `${s.classId.name.replace('Class ', '')}-${s.classId.section}` : null;
      return {
        id: s._id.toString(),
        name: s.name,
        admissionId: s.admissionId,
        rollNo: s.rollNo,
        classId: s.classId?._id?.toString(),
        class: classInfo,
        status: s.status,
        isDeleted: s.isDeleted
      };
    });
    
    console.log(JSON.stringify(formatted, null, 2));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

testApiResponse();
