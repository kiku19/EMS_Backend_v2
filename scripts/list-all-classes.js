import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

const ClassSchema = new mongoose.Schema({
  name: String,
  section: String,
  classTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' }
}, { strict: false });

const Class = mongoose.model('Class', ClassSchema);

async function listAllClasses() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected\n');

    const classes = await Class.find({}).sort({ name: 1, section: 1 }).lean();
    
    console.log('📚 All Classes in Database:\n');
    classes.forEach((c, i) => {
      console.log(`${i + 1}. name: "${c.name}", section: "${c.section}" → Display as: ${c.name}-${c.section}`);
    });

    console.log(`\nTotal: ${classes.length} classes`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

listAllClasses();
