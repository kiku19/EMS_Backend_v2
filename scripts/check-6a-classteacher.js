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

async function checkClassTeacher() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to database\n');

    // Find Anil Kumar
    const anil = await Staff.findOne({ name: { $regex: /anil/i } });
    console.log('=== ANIL KUMAR ===');
    console.log('_id:', anil._id);
    console.log('_id type:', typeof anil._id);
    console.log('_id toString:', anil._id.toString());
    console.log('');

    // Find class 6A
    const class6A = await Class.findOne({ name: 'Class 6', section: 'A' });
    console.log('=== CLASS 6A ===');
    console.log('_id:', class6A._id);
    console.log('classTeacherId:', class6A.classTeacherId);
    console.log('classTeacherId type:', typeof class6A.classTeacherId);
    console.log('classTeacherId toString:', class6A.classTeacherId ? class6A.classTeacherId.toString() : 'null');
    console.log('');

    // Check if they match
    console.log('=== COMPARISON ===');
    console.log('Direct comparison:', class6A.classTeacherId === anil._id);
    console.log('String comparison:', class6A.classTeacherId?.toString() === anil._id.toString());
    console.log('');

    // Try finding with different methods
    console.log('=== FINDING CLASSES ===');
    
    const method1 = await Class.find({ classTeacherId: anil._id });
    console.log('Method 1 - find({ classTeacherId: anil._id }):', method1.length);
    
    const method2 = await Class.find({ classTeacherId: anil._id.toString() });
    console.log('Method 2 - find({ classTeacherId: anil._id.toString() }):', method2.length);
    
    const method3 = await Class.find({ classTeacherId: mongoose.Types.ObjectId(anil._id) });
    console.log('Method 3 - find({ classTeacherId: ObjectId(anil._id) }):', method3.length);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

checkClassTeacher();
