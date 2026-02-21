import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/school_db';

async function debugPopulate() {
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    
    console.log('✅ Connected to MongoDB\n');
    
    // Get class 5A ID
    const Class = mongoose.model('Class', new mongoose.Schema({}, { strict: false }));
    const class5A = await Class.findOne({ name: 'Class 5', section: 'A' });
    console.log('📋 Class 5A:', class5A._id.toString());
    console.log('   Name:', class5A.name);
    console.log('   Section:', class5A.section);
    console.log('');
    
    // Query 1: Get all students with this classId (no populate)
    const Student = mongoose.model('Student', new mongoose.Schema({}, { strict: false }));
    
    console.log('📊 Query 1: All students with classId (no populate, no filters)');
    const allStudents = await Student.find({ classId: class5A._id });
    console.log(`   Total: ${allStudents.length} students`);
    allStudents.forEach(s => {
      console.log(`   - ${s.name} (classId: ${s.classId}, status: ${s.status}, isDeleted: ${s.isDeleted})`);
    });
    console.log('');
    
    // Query 2: With isDeleted filter
    console.log('📊 Query 2: Students with isDeleted != true');
    const notDeletedStudents = await Student.find({ 
      classId: class5A._id,
      isDeleted: { $ne: true }
    });
    console.log(`   Total: ${notDeletedStudents.length} students`);
    console.log('');
    
    // Query 3: With populate
    console.log('📊 Query 3: Students with populate (limit 50)');
    const populatedStudents = await Student.find({ 
      isDeleted: { $ne: true }
    })
      .populate('classId', 'name section')
      .limit(50);
    
    const class5APopulated = populatedStudents.filter(s => 
      s.classId && s.classId._id && s.classId._id.toString() === class5A._id.toString()
    );
    
    console.log(`   Total students returned: ${populatedStudents.length}`);
    console.log(`   Class 5A students: ${class5APopulated.length}`);
    console.log('');
    
    if (class5APopulated.length > 0) {
      console.log('   Sample student:');
      const sample = class5APopulated[0];
      console.log(`   - Name: ${sample.name}`);
      console.log(`   - classId type: ${typeof sample.classId}`);
      console.log(`   - classId value:`, sample.classId);
      console.log(`   - classId._id: ${sample.classId._id}`);
      console.log(`   - classId.name: ${sample.classId.name}`);
      console.log(`   - classId.section: ${sample.classId.section}`);
    }
    console.log('');
    
    // Query 4: Check if there's a sorting issue
    console.log('📊 Query 4: All students sorted by rollNo');
    const sortedStudents = await Student.find({ 
      classId: class5A._id,
      isDeleted: { $ne: true }
    }).sort({ rollNo: 1 });
    
    console.log(`   Total: ${sortedStudents.length} students`);
    sortedStudents.forEach(s => {
      console.log(`   - ${s.name} (Roll: ${s.rollNo})`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

debugPopulate();
