import mongoose from 'mongoose';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '../.env') });

const classSchema = new mongoose.Schema({}, { strict: false, collection: 'classes' });
const Class = mongoose.model('Class', classSchema);

async function checkClasses() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    console.log('📊 Checking classes data...\n');

    const classes = await Class.find({}).lean();
    
    console.log(`Total classes in database: ${classes.length}\n`);

    if (classes.length === 0) {
      console.log('❌ NO CLASSES FOUND IN DATABASE!');
      console.log('\nThis is why the class list is empty.');
      console.log('\nTo fix:');
      console.log('1. Add classes through the "Add Class" button in the UI');
      console.log('2. Or run a script to seed sample classes');
    } else {
      console.log('✅ Classes found:\n');
      classes.forEach((cls, index) => {
        console.log(`${index + 1}. Class ${cls.name}-${cls.section}`);
        console.log(`   ID: ${cls._id}`);
        console.log(`   Teacher ID: ${cls.classTeacherId || 'Not assigned'}`);
        console.log(`   Strength: ${cls.studentCount || cls.strength || 0}`);
        console.log(`   Created: ${cls.createdAt || 'Unknown'}`);
        console.log('');
      });
    }

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkClasses();
