import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Get directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables FIRST
dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/school_db';

console.log('🔍 Starting diagnostic for class 5A...\n');
console.log('📡 Connecting to MongoDB Atlas...');

// Define schemas inline
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
  isDeleted: Boolean
}, { strict: false });

const Class = mongoose.model('Class', classSchema);
const Student = mongoose.model('Student', studentSchema);

async function diagnose() {
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    
    console.log('✅ Connected to MongoDB\n');
    
    // Find class 5A
    console.log('📋 Step 1: Finding class 5A...');
    const class5A = await Class.findOne({ name: 'Class 5', section: 'A' });
    
    if (!class5A) {
      console.log('❌ Class 5A not found!');
      console.log('\n📋 Available classes:');
      const allClasses = await Class.find({}).select('name section _id');
      allClasses.forEach(c => {
        console.log(`  - ${c.name}-${c.section} (ID: ${c._id})`);
      });
      process.exit(1);
    }
    
    console.log(`✅ Found class 5A: ${class5A.name}-${class5A.section}`);
    console.log(`   ID: ${class5A._id}`);
    console.log(`   Strength: ${class5A.strength || 'not set'}\n`);
    
    // Query 1: All students with classId matching 5A (no filters)
    console.log('📊 Query 1: ALL students with classId = 5A (no filters)');
    const allStudents = await Student.find({ classId: class5A._id });
    console.log(`   Total: ${allStudents.length} students`);
    allStudents.forEach(s => {
      console.log(`   - ${s.name} (Roll: ${s.rollNo}, Status: ${s.status}, isDeleted: ${s.isDeleted})`);
    });
    console.log('');
    
    // Query 2: Active students only
    console.log('📊 Query 2: Students with status="active"');
    const activeStudents = await Student.find({ 
      classId: class5A._id,
      status: 'active'
    });
    console.log(`   Total: ${activeStudents.length} students`);
    activeStudents.forEach(s => {
      console.log(`   - ${s.name} (Roll: ${s.rollNo}, isDeleted: ${s.isDeleted})`);
    });
    console.log('');
    
    // Query 3: Active + not deleted (staff app filter)
    console.log('📊 Query 3: Students with status="active" AND isDeleted != true (Staff App)');
    const staffAppStudents = await Student.find({ 
      classId: class5A._id,
      status: 'active',
      isDeleted: { $ne: true }
    });
    console.log(`   Total: ${staffAppStudents.length} students`);
    staffAppStudents.forEach(s => {
      console.log(`   - ${s.name} (Roll: ${s.rollNo}, isDeleted: ${s.isDeleted})`);
    });
    console.log('');
    
    // Query 4: Inactive students
    console.log('📊 Query 4: Students with status="inactive"');
    const inactiveStudents = await Student.find({ 
      classId: class5A._id,
      status: 'inactive'
    });
    console.log(`   Total: ${inactiveStudents.length} students`);
    inactiveStudents.forEach(s => {
      console.log(`   - ${s.name} (Roll: ${s.rollNo}, isDeleted: ${s.isDeleted})`);
    });
    console.log('');
    
    // Query 5: Deleted students
    console.log('📊 Query 5: Students with isDeleted = true');
    const deletedStudents = await Student.find({ 
      classId: class5A._id,
      isDeleted: true
    });
    console.log(`   Total: ${deletedStudents.length} students`);
    deletedStudents.forEach(s => {
      console.log(`   - ${s.name} (Roll: ${s.rollNo}, Status: ${s.status})`);
    });
    console.log('');
    
    // Summary
    console.log('📈 SUMMARY:');
    console.log(`   Total students in 5A: ${allStudents.length}`);
    console.log(`   Active students: ${activeStudents.length}`);
    console.log(`   Active + not deleted (Staff App): ${staffAppStudents.length}`);
    console.log(`   Inactive students: ${inactiveStudents.length}`);
    console.log(`   Deleted students: ${deletedStudents.length}`);
    console.log('');
    
    // Analysis
    console.log('🔍 ANALYSIS:');
    console.log(`   Expected Staff App count: 8 students`);
    console.log(`   Actual Staff App count: ${staffAppStudents.length} students`);
    console.log(`   Expected School Dashboard: 1 active + 1 inactive`);
    console.log(`   Actual School Dashboard: ${activeStudents.length} active + ${inactiveStudents.length} inactive`);
    console.log('');
    
    // Check for data inconsistencies
    console.log('🔧 POTENTIAL ISSUES:');
    
    const studentsWithoutStatus = allStudents.filter(s => !s.status);
    if (studentsWithoutStatus.length > 0) {
      console.log(`⚠️  ${studentsWithoutStatus.length} students have no status field`);
      studentsWithoutStatus.forEach(s => {
        console.log(`   - ${s.name} (Roll: ${s.rollNo})`);
      });
    }
    
    const studentsWithUndefinedDeleted = allStudents.filter(s => s.isDeleted === undefined);
    if (studentsWithUndefinedDeleted.length > 0) {
      console.log(`⚠️  ${studentsWithUndefinedDeleted.length} students have undefined isDeleted field`);
      studentsWithUndefinedDeleted.forEach(s => {
        console.log(`   - ${s.name} (Roll: ${s.rollNo}, Status: ${s.status})`);
      });
    }
    
    if (class5A.strength !== staffAppStudents.length) {
      console.log(`⚠️  Class strength (${class5A.strength}) doesn't match actual count (${staffAppStudents.length})`);
    }
    
    console.log('\n✅ Diagnostic complete!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

diagnose();
