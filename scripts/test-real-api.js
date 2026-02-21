import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB, Student, Class } from '../database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

async function testRealApi() {
  try {
    await connectDB();
    
    console.log('✅ Connected to MongoDB\n');
    
    // Simulate the exact backend API query
    console.log('📡 Simulating GET /api/students (exact backend query)...\n');
    
    const query = { isDeleted: { $ne: true } };
    
    const students = await Student.find(query)
      .populate('classId', 'name section')
      .sort({ rollNo: 1 })
      .limit(50);
    
    console.log(`📊 Total students returned: ${students.length}\n`);
    
    // Find class 5A
    const class5A = await Class.findOne({ name: 'Class 5', section: 'A' });
    console.log(`📋 Class 5A ID: ${class5A._id}\n`);
    
    // Filter for class 5A students
    const class5AStudents = students.filter(s => 
      s.classId && s.classId._id && s.classId._id.toString() === class5A._id.toString()
    );
    
    console.log(`📋 Class 5A students in API response: ${class5AStudents.length}`);
    console.log('');
    
    class5AStudents.forEach(s => {
      const classInfo = s.classId ? `${s.classId.name.replace('Class ', '')}-${s.classId.section}` : null;
      console.log(`  - ${s.name}`);
      console.log(`    Roll: ${s.rollNo}`);
      console.log(`    Status: ${s.status}`);
      console.log(`    isDeleted: ${s.isDeleted}`);
      console.log(`    class field: "${classInfo}"`);
      console.log(`    classId._id: ${s.classId._id}`);
      console.log(`    classId.name: ${s.classId.name}`);
      console.log(`    classId.section: ${s.classId.section}`);
      console.log('');
    });
    
    // Now check ALL students in class 5A (without limit)
    console.log('📊 Checking ALL students in class 5A (no limit)...\n');
    
    const allClass5AStudents = await Student.find({
      classId: class5A._id,
      isDeleted: { $ne: true }
    })
      .populate('classId', 'name section')
      .sort({ rollNo: 1 });
    
    console.log(`   Total: ${allClass5AStudents.length} students`);
    allClass5AStudents.forEach(s => {
      const classInfo = s.classId ? `${s.classId.name.replace('Class ', '')}-${s.classId.section}` : null;
      console.log(`   - ${s.name} (Roll: ${s.rollNo}, Status: ${s.status}, class: "${classInfo}")`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    process.exit(0);
  }
}

testRealApi();
