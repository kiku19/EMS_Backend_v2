import mongoose from 'mongoose';
import { connectDB, Class, Staff } from '../database.js';
import dotenv from 'dotenv';

dotenv.config();

async function checkSpecificClasses() {
  try {
    await connectDB();
    console.log('✅ Connected to database\n');

    // Find Anil Kumar staff ID
    const anil = await Staff.findOne({ name: { $regex: /anil/i } });
    if (!anil) {
      console.log('Anil Kumar not found');
      return;
    }

    console.log('Anil ID:', anil._id.toString());
    console.log('Anil ID (raw):', anil._id);
    console.log('');

    // Check specific classes
    const classNames = ['1-C', '1-D', '5-B', '6-A', '1C', '1D', '5B', '6A'];
    
    for (const name of classNames) {
      const cls = await Class.findOne({ 
        $or: [
          { name: name },
          { name: `Class ${name}` }
        ]
      });
      
      if (cls) {
        const hasAnil = cls.classTeacherId && String(cls.classTeacherId) === String(anil._id);
        console.log(`${cls.name}-${cls.section}: classTeacherId = ${cls.classTeacherId ? cls.classTeacherId.toString() : 'null'} ${hasAnil ? '✅ MATCHES ANIL' : ''}`);
      } else {
        console.log(`${name}: NOT FOUND`);
      }
    }

    // Also check all classes
    console.log('\n=== ALL CLASSES WITH ANIL AS CLASS TEACHER ===');
    const allClasses = await Class.find({ classTeacherId: anil._id });
    console.log('Count:', allClasses.length);
    allClasses.forEach(c => {
      console.log(`  ${c.name}-${c.section}`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

checkSpecificClasses();
