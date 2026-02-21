import mongoose from 'mongoose';
import { connectDB, Class, Staff } from '../database.js';
import dotenv from 'dotenv';

dotenv.config();

async function checkAllClassesForAnil() {
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

    // Get ALL classes (including soft deleted)
    const allClasses = await Class.find({}).sort({ name: 1, section: 1 });
    
    console.log('=== ALL CLASSES ===');
    let anilCount = 0;
    allClasses.forEach(c => {
      const isAnil = c.classTeacherId && c.classTeacherId.toString() === anilIdStr;
      if (isAnil) anilCount++;
      console.log(`${c.name}-${c.section}: classTeacherId = ${c.classTeacherId ? c.classTeacherId.toString() : 'null'} ${isAnil ? '✅ MATCHES ANIL' : ''}`);
    });
    
    console.log(`\nTotal classes with Anil as class teacher: ${anilCount}`);

    // Also check for any duplicates
    console.log('\n=== CHECKING FOR DUPLICATE CLASS IDs ===');
    const idMap = new Map();
    allClasses.forEach(c => {
      const key = `${c.name}-${c.section}`;
      if (idMap.has(key)) {
        console.log(`DUPLICATE: ${key}`);
        console.log(`  ID 1: ${idMap.get(key)}`);
        console.log(`  ID 2: ${c._id}`);
      } else {
        idMap.set(key, c._id.toString());
      }
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

checkAllClassesForAnil();
