import mongoose from 'mongoose';
import { connectDB, Class, Staff } from '../database.js';
import dotenv from 'dotenv';

dotenv.config();

async function checkForDuplicateClasses() {
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
    console.log(`Anil ID: ${anilIdStr}\n`);

    // Check all classes
    const allClasses = await Class.find({}).sort({ name: 1, section: 1 });
    
    console.log('=== ALL CLASSES WITH classTeacherId ===');
    let count = 0;
    allClasses.forEach(c => {
      if (c.classTeacherId) {
        const teacherIdStr = c.classTeacherId.toString();
        const isAnil = teacherIdStr === anilIdStr;
        if (isAnil) count++;
        console.log(`${c.name}-${c.section}: classTeacherId = ${teacherIdStr} ${isAnil ? '✅ MATCHES ANIL' : ''}`);
      }
    });
    
    console.log(`\nTotal classes with Anil as class teacher: ${count}`);

    // Also check if there are duplicate class entries
    console.log('\n=== CHECKING FOR DUPLICATE CLASSES ===');
    const classMap = new Map();
    allClasses.forEach(c => {
      const key = `${c.name}-${c.section}`;
      if (classMap.has(key)) {
        console.log(`DUPLICATE FOUND: ${key}`);
        console.log(`  Existing: ${classMap.get(key)}`);
        console.log(`  New: ${c._id}`);
      } else {
        classMap.set(key, c._id.toString());
      }
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

checkForDuplicateClasses();
