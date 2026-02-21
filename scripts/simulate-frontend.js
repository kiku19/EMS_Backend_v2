import mongoose from 'mongoose';
import { connectDB, Class, Staff } from '../database.js';
import dotenv from 'dotenv';

dotenv.config();

// Simulate what the frontend does
async function simulateFrontend() {
  try {
    await connectDB();
    console.log('✅ Connected to database\n');

    // 1. Fetch staff (simulating GET /api/staff)
    const staffDocs = await Staff.find().populate('reporterId', 'name').sort({ createdAt: 1 });
    const staff = staffDocs.map(s => {
      const obj = s.toObject();
      obj.id = s._id; // This is what the API does
      return obj;
    });

    // 2. Fetch classes (simulating GET /api/classes)
    const classDocs = await Class.find().populate('classTeacherId', 'name').sort({ name: 1, section: 1 });
    const classes = classDocs.map(c => ({
      id: c._id.toString(),
      name: c.name,
      section: c.section,
      classTeacherId: c.classTeacherId?._id?.toString(),
      classTeacherName: c.classTeacherId?.name,
    }));

    // 3. Find Anil Kumar
    const anil = staff.find(s => s.name.toLowerCase().includes('anil'));
    if (!anil) {
      console.log('Anil Kumar not found');
      return;
    }

    console.log('=== Anil Kumar Staff Record ===');
    console.log('id:', anil.id);
    console.log('id type:', typeof anil.id);
    console.log('_id:', anil._id);
    console.log('_id type:', typeof anil._id);
    console.log('name:', anil.name);

    // 4. Simulate the frontend filter
    console.log('\n=== Simulating Frontend Filter ===');
    console.log('Filter: String(cls.classTeacherId) === String(staff.id) || String(cls.classTeacherId) === String(staff._id)');

    const classTeacherAssignments = classes.filter(cls => {
      const match1 = String(cls.classTeacherId) === String(anil.id);
      const match2 = String(cls.classTeacherId) === String(anil._id);
      const matches = match1 || match2;

      if (cls.classTeacherId) {
        console.log(`\n${cls.name}-${cls.section}:`);
        console.log(`  cls.classTeacherId: "${cls.classTeacherId}" (${typeof cls.classTeacherId})`);
        console.log(`  String(cls.classTeacherId): "${String(cls.classTeacherId)}"`);
        console.log(`  String(anil.id): "${String(anil.id)}"`);
        console.log(`  String(anil._id): "${String(anil._id)}"`);
        console.log(`  Match with id: ${match1}`);
        console.log(`  Match with _id: ${match2}`);
        console.log(`  RESULT: ${matches ? '✓ INCLUDED' : '✗ EXCLUDED'}`);
      }

      return matches;
    });

    console.log('\n=== Final Result ===');
    console.log(`Class Teacher Assignments for Anil Kumar: ${classTeacherAssignments.length}`);
    classTeacherAssignments.forEach(cls => {
      console.log(`  - ${cls.name}-${cls.section}`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

simulateFrontend();
