import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB, Student, Class } from '../database.js';

// Get directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from backend/.env
dotenv.config({ path: path.join(__dirname, '../.env') });

console.log('Environment check:');
console.log('MONGO_URI:', process.env.MONGO_URI ? 'Found' : 'Not found');
console.log('');

/**
 * Diagnostic script to investigate class 5A student count discrepancy
 * 
 * Issue: Different counts across different views:
 * - School Dashboard Student List: 1 active + 1 inactive = 2 students
 * - Staff App: 8 students
 * - School Dashboard Classes: 1 student
 */

async function diagnose5AIssue() {
  try {
    console.log('🔍 Starting diagnostic for class 5A...\n');
    
    console.log('📡 Connecting to MongoDB...');
    await connectDB();
    
    // Find class 5A
    console.log('📋 Step 1: Finding class 5A...');
    const class5A = await Class.findOne({ name: '5', section: 'A' });
    
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
    console.log(`   ID: ${class5A._id}\n`);
    
    // Query 1: All students with classId matching 5A (no filters)
    console.log('📊 Query 1: ALL students with classId = 5A (no filters)');
    const allStudents = await Student.find({ classId: class5A._id });
    console.log(`   Total: ${allStudents.length} students`);
    allStudents.forEach(s => {
      console.log(`   - ${s.name} (Roll: ${s.rollNo}, Status: ${s.status}, isDeleted: ${s.isDeleted})`);
    });
    console.log('');
    
    // Query 2: Active students only (school dashboard student list filter)
    console.log('📊 Query 2: Students with status="active" (School Dashboard filter)');
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
    console.log('📊 Query 3: Students with status="active" AND isDeleted != true (Staff App filter)');
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
    console.log(`   Active + not deleted: ${staffAppStudents.length}`);
    console.log(`   Inactive students: ${inactiveStudents.length}`);
    console.log(`   Deleted students: ${deletedStudents.length}`);
    console.log('');
    
    // Analysis
    console.log('🔍 ANALYSIS:');
    
    if (staffAppStudents.length === 8) {
      console.log('✅ Staff App shows 8 students - this matches active + not deleted filter');
    }
    
    if (activeStudents.length === 1 && inactiveStudents.length === 1) {
      console.log('✅ School Dashboard Student List shows 1 active + 1 inactive = 2 students');
    }
    
    // Check for data inconsistencies
    console.log('\n🔧 POTENTIAL ISSUES:');
    
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
    
    // Check class strength
    console.log('\n📊 CLASS STRENGTH:');
    console.log(`   Class 5A strength field: ${class5A.strength || 'not set'}`);
    console.log(`   Actual active students: ${staffAppStudents.length}`);
    
    if (class5A.strength !== staffAppStudents.length) {
      console.log(`⚠️  Class strength (${class5A.strength}) doesn't match actual count (${staffAppStudents.length})`);
    }
    
    console.log('\n✅ Diagnostic complete!');
    
  } catch (error) {
    console.error('❌ Error during diagnostic:', error);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

diagnose5AIssue();
