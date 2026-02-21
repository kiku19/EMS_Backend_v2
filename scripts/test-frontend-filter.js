/**
 * Test script to verify the ObjectId string conversion fix
 * This simulates what the frontend receives after the API changes
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/school_db';

async function test() {
  await mongoose.connect(MONGO_URI);

  const Student = mongoose.model('Student', new mongoose.Schema({}, { collection: 'students', strict: false }));
  const Class = mongoose.model('Class', new mongoose.Schema({ name: String, section: String }, { collection: 'classes' }));

  // Get 5A class
  const class5A = await Class.findOne({ name: { $regex: '5', $options: 'i' }, section: { $regex: 'A', $options: 'i' } });

  console.log('=== SIMULATING API RESPONSE ===\n');

  // OLD FORMAT (ObjectId objects)
  const oldFormat = { id: class5A._id };
  console.log('OLD FORMAT (ObjectId object):');
  console.log('  id:', oldFormat.id);
  console.log('  typeof id:', typeof oldFormat.id);

  // NEW FORMAT (Strings)
  const newFormat = { id: class5A._id.toString() };
  console.log('\nNEW FORMAT (String):');
  console.log('  id:', newFormat.id);
  console.log('  typeof id:', typeof newFormat.id);

  // Get students (simulating API response)
  const students = await Student.find({ classId: class5A._id, status: 'active', isDeleted: { $ne: true } }).lean();

  // OLD FORMAT
  const oldStudents = students.map(s => ({
    id: s._id,
    classId: s.classId
  }));

  // NEW FORMAT
  const newStudents = students.map(s => ({
    id: s._id.toString(),
    classId: s.classId.toString()
  }));

  console.log('\n=== FRONTEND FILTERING SIMULATION ===\n');

  // Simulate frontend filtering with OLD format
  const oldClassId = oldFormat.id;
  const oldMatch = oldStudents.filter(s => s.classId === oldClassId);
  console.log('OLD FORMAT matching:');
  console.log(`  s.classId === class.id: ${oldMatch.length} matches (should be 8)`);

  // Simulate frontend filtering with NEW format
  const newClassId = newFormat.id;
  const newMatch = newStudents.filter(s => s.classId === newClassId);
  console.log('\nNEW FORMAT matching:');
  console.log(`  s.classId === class.id: ${newMatch.length} matches (should be 8)`);

  // Also test with String() conversion (what I added to frontend)
  const stringMatch = oldStudents.filter(s => String(s.classId) === String(oldClassId));
  console.log('\nWith String() conversion on OLD format:');
  console.log(`  String(s.classId) === String(class.id): ${stringMatch.length} matches (should be 8)`);

  console.log('\n=== RESULT ===');
  console.log(`Expected: 8 active students in Class 5-A`);
  console.log(`NEW FORMAT gives: ${newMatch.length} matches ✅`);
  console.log(`OLD FORMAT gives: ${oldMatch.length} matches ❌`);

  await mongoose.disconnect();
}

test().catch(console.error);
