import mongoose from 'mongoose';
import { connectDB, Class, Staff } from '../database.js';
import dotenv from 'dotenv';

dotenv.config();

async function listAllClasses() {
  try {
    await connectDB();
    console.log('✅ Connected to database\n');

    // List all classes with their classTeacherId
    const classes = await Class.find({}).sort({ name: 1, section: 1 });
    
    console.log('=== ALL CLASSES ===');
    classes.forEach(c => {
      console.log(`ID: ${c._id.toString()} | ${c.name}-${c.section} | classTeacherId: ${c.classTeacherId ? c.classTeacherId.toString() : 'null'}`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

listAllClasses();
