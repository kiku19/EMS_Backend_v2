import mongoose from 'mongoose';
import { connectDB, Class, Staff } from '../database.js';
import dotenv from 'dotenv';

dotenv.config();

async function checkAnilInAllFields() {
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
    console.log('Anil ID:', anilIdStr);
    console.log('');

    // Check ALL classes for any field that might contain Anil's ID
    const allClasses = await Class.find({});
    
    console.log('=== CHECKING ALL CLASSES FOR ANIL ID ===');
    let foundInAnyField = false;
    
    allClasses.forEach(c => {
      const classDoc = c.toObject();
      
      // Check all keys in the class document
      for (const [key, value] of Object.entries(classDoc)) {
        if (value && typeof value === 'string' && value.includes(anilIdStr)) {
          console.log(`${c.name}-${c.section}: ${key} = ${value}`);
          foundInAnyField = true;
        }
        // Check if it's an ObjectId
        if (value && typeof value === 'object' && value.toString && value.toString().includes(anilIdStr)) {
          console.log(`${c.name}-${c.section}: ${key} = ${value.toString()}`);
          foundInAnyField = true;
        }
      }
      
      // Also check nested objects
      if (c.teacherAssignments) {
        c.teacherAssignments.forEach((ta, idx) => {
          if (ta.teacherId && String(ta.teacherId) === anilIdStr) {
            console.log(`${c.name}-${c.section}: teacherAssignments[${idx}].teacherId = ${anilIdStr}`);
            foundInAnyField = true;
          }
        });
      }
    });

    if (!foundInAnyField) {
      console.log('No classes found with Anil ID in any field (except classTeacherId for 6-A)');
    }

    // Check specifically the 1C, 1D, 5B classes
    console.log('\n=== CHECKING SPECIFIC CLASSES ===');
    const specificClasses = await Class.find({
      $or: [
        { name: 'Class 1-C' },
        { name: 'Class 1-D' },
        { name: 'Class 5-B' },
        { name: 'Class 6-A' }
      ]
    });

    specificClasses.forEach(c => {
      console.log(`\n${c.name}-${c.section}:`);
      console.log(`  _id: ${c._id.toString()}`);
      console.log(`  classTeacherId: ${c.classTeacherId ? c.classTeacherId.toString() : 'null'}`);
      if (c.teacherAssignments) {
        console.log(`  teacherAssignments: ${JSON.stringify(c.teacherAssignments)}`);
      }
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

checkAnilInAllFields();
