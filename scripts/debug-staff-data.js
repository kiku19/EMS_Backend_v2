import mongoose from 'mongoose';
import { connectDB, Class, Staff } from '../database.js';
import dotenv from 'dotenv';

dotenv.config();

async function debugStaffData() {
  try {
    await connectDB();
    console.log('✅ Connected to database\n');

    // Find Anil Kumar
    const anil = await Staff.findOne({ name: { $regex: /anil/i } });
    if (!anil) {
      console.log('Anil Kumar not found');
      return;
    }

    const anilIdStr = anil._id.toString();
    console.log('=== CHECKING EXACT MATCHING ===\n');

    // Get all classes from API
    const allClasses = await Class.find({}).sort({ name: 1, section: 1 });
    
    console.log('All classes with classTeacherId:');
    let matchCount = 0;
    allClasses.forEach(c => {
      if (c.classTeacherId) {
        const classTeacherIdStr = c.classTeacherId.toString();
        console.log(`  ${c.name}-${c.section}: classTeacherId="${classTeacherIdStr}"`);
        
        // Exact string comparison
        if (classTeacherIdStr === anilIdStr) {
          matchCount++;
          console.log(`    ^^^ MATCHES ANIL (${anilIdStr})`);
        }
        
        // Also check without .toString()
        if (String(c.classTeacherId) === String(anilIdStr)) {
          console.log(`    ^^^ ALSO MATCHES using String()`);
        }
      }
    });
    
    console.log(`\nTotal matches: ${matchCount}`);

    // Simulate frontend filter
    console.log('\n=== SIMULATING FRONTEND FILTER ===');
    const classesWithTeachers = allClasses.map(c => ({
      ...c.toObject(),
      id: c._id.toString(),
      _id: c._id,
      classTeacherId: c.classTeacherId ? c.classTeacherId.toString() : null
    }));

    const staff = {
      id: anilIdStr,
      _id: anilIdStr
    };

    const filtered = classesWithTeachers.filter(cls =>
      String(cls.classTeacherId) === String(staff.id) || 
      String(cls.classTeacherId) === String(staff._id)
    );

    console.log(`Filtered count: ${filtered.length}`);
    filtered.forEach(c => {
      console.log(`  - ${c.name}-${c.section}`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

debugStaffData();
