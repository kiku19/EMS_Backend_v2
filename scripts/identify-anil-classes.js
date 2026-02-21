import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/school_db';

const classSchema = new mongoose.Schema({}, { strict: false });
const staffSchema = new mongoose.Schema({}, { strict: false });
const Class = mongoose.model('Class', classSchema);
const Staff = mongoose.model('Staff', staffSchema);

async function identifyClasses() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to database\n');

    const classIds = [
      '6972605d47f5721444d7afbd',
      '6972605d47f5721444d7afbe',
      '6972605d47f5721444d7afbf',
      '6972605d47f5721444d7afc0',
      '6972605d47f5721444d7afc1',
      '6972605d47f5721444d7afc2'
    ];

    console.log('=== CLASSES IN ANIL\'S teacherAssignments ===\n');
    
    for (const classId of classIds) {
      const cls = await Class.findById(classId);
      if (cls) {
        const classTeacher = cls.classTeacherId ? await Staff.findById(cls.classTeacherId) : null;
        console.log(`${cls.name}-${cls.section}`);
        console.log(`  ID: ${cls._id}`);
        console.log(`  Class Teacher: ${classTeacher ? classTeacher.name : 'None'}`);
        console.log('');
      } else {
        console.log(`Class ID ${classId} not found\n`);
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

identifyClasses();
