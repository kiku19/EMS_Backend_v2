/**
 * Detailed diagnostic for 5A class specifically
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/school_db';

const classSchema = new mongoose.Schema({
  name: String,
  section: String,
  classTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
}, { collection: 'classes' });

const studentSchema = new mongoose.Schema({
  name: String,
  admissionId: String,
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
  status: String,
  isDeleted: Boolean,
}, { collection: 'students', strict: false });

const Class = mongoose.model('Class', classSchema);
const Student = mongoose.model('Student', studentSchema);

async function diagnose() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find 5A class
    const class5A = await Class.findOne({ name: { $regex: '5', $options: 'i' }, section: { $regex: 'A', $options: 'i' } });

    if (!class5A) {
      console.log('❌ Class 5A not found');
      const allClasses = await Class.find({}).lean();
      console.log('\n📋 Available classes:');
      allClasses.forEach(c => console.log(`   - ${c.name}-${c.section} (ID: ${c._id})`));
      return;
    }

    console.log('🏫 Class 5A Details:');
    console.log(`   ID: ${class5A._id}`);
    console.log(`   ID type: ${typeof class5A._id}`);
    console.log(`   ID toString: ${class5A._id.toString()}`);
    console.log(`   Name: ${class5A.name}`);
    console.log(`   Section: ${class5A.section}`);

    // Get ALL students in this class
    const allStudents = await Student.find({ classId: class5A._id }).lean();
    console.log(`\n📊 Total students in 5A: ${allStudents.length}`);

    // Get active + not deleted students
    const activeStudents = await Student.find({
      classId: class5A._id,
      status: 'active',
      isDeleted: { $ne: true }
    }).lean();
    console.log(`📊 Active & not deleted: ${activeStudents.length}`);

    // Show all students with their details
    console.log('\n📋 All students in 5A:');
    allStudents.forEach((s, i) => {
      console.log(`   ${i + 1}. ${s.name} (${s.admissionId})`);
      console.log(`      - classId: ${s.classId}`);
      console.log(`      - classId type: ${typeof s.classId}`);
      console.log(`      - classId toString: ${s.classId?.toString()}`);
      console.log(`      - status: ${s.status || 'undefined'}`);
      console.log(`      - isDeleted: ${s.isDeleted || false}`);
      console.log(`      - Matches class ID: ${s.classId?.toString() === class5A._id.toString()}`);
    });

    // Check if any students have different classId format
    console.log('\n🔍 Checking classId matching:');
    const matchingStudents = allStudents.filter(s =>
      s.classId?.toString() === class5A._id.toString()
    );
    console.log(`   Students with matching classId: ${matchingStudents.length}`);

    // Check for string vs ObjectId issues
    const stringClassIdStudents = allStudents.filter(s => typeof s.classId === 'string');
    console.log(`   Students with string classId: ${stringClassIdStudents.length}`);

    // Simulate frontend filtering
    console.log('\n🔬 Simulating frontend filtering:');
    console.log('   Filter: s.classId === class5A._id');
    const frontendFilter1 = allStudents.filter(s => s.classId === class5A._id);
    console.log(`   Result: ${frontendFilter1.length} students`);

    console.log('\n   Filter: s.classId === class5A._id.toString()');
    const frontendFilter2 = allStudents.filter(s => s.classId === class5A._id.toString());
    console.log(`   Result: ${frontendFilter2.length} students`);

    console.log('\n   Filter: String(s.classId) === String(class5A._id)');
    const frontendFilter3 = allStudents.filter(s => String(s.classId) === String(class5A._id));
    console.log(`   Result: ${frontendFilter3.length} students`);

    // Check the classes API response format
    console.log('\n📡 Simulating API response:');
    const classResponse = { id: class5A._id, ...class5A.toObject() };
    console.log(`   Class API response id: ${classResponse.id}`);
    console.log(`   Class API response id type: ${typeof classResponse.id}`);

    // Check if student.classId matches classResponse.id
    console.log('\n🔬 Matching with API response format:');
    const apiMatch1 = allStudents.filter(s => s.classId === classResponse.id);
    console.log(`   s.classId === classResponse.id: ${apiMatch1.length} students`);

    const apiMatch2 = allStudents.filter(s => String(s.classId) === String(classResponse.id));
    console.log(`   String(s.classId) === String(classResponse.id): ${apiMatch2.length} students`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

diagnose();
