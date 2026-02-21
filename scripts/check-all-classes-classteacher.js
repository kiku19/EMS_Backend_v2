import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/school_db';

const staffSchema = new mongoose.Schema({}, { strict: false });
const classSchema = new mongoose.Schema({}, { strict: false });

const Staff = mongoose.model('Staff', staffSchema);
const Class = mongoose.model('Class', classSchema);

async function checkAllClasses() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to database\n');

    // Find Anil Kumar
    const anil = await Staff.findOne({ name: { $regex: /anil/i } });
    console.log('=== ANIL KUMAR ===');
    console.log('_id:', anil._id.toString());
    console.log('');

    // Get all classes
    const allClasses = await Class.find({}).sort({ name: 1, section: 1 });
    
    console.log('=== ALL CLASSES ===\n');
    
    for (const cls of allClasses) {
      const classTeacher = cls.classTeacherId ? await Staff.findById(cls.classTeacherId) : null;
      const matchesAnil = cls.classTeacherId?.toString() === anil._id.toString();
      
      console.log(`${cls.name}-${cls.section}`);
      console.log(`  ID: ${cls._id}`);
      console.log(`  classTeacherId: ${cls.classTeacherId || 'null'}`);
      console.log(`  Class Teacher: ${classTeacher ? classTeacher.name : 'None'}`);
      console.log(`  Matches Anil: ${matchesAnil ? '✓ YES' : 'no'}`);
      console.log('');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

checkAllClasses();
