import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/school_db';

async function check() {
  await mongoose.connect(MONGO_URI);

  const Student = mongoose.model('Student', new mongoose.Schema({}, { collection: 'students', strict: false }));
  const Class = mongoose.model('Class', new mongoose.Schema({ name: String, section: String }, { collection: 'classes' }));

  const allStudents = await Student.find({}).lean();
  console.log('=== DATABASE STATE ===');
  console.log('Total students in DB:', allStudents.length);

  const activeStudents = allStudents.filter(s => s.status === 'active' && s.isDeleted !== true);
  console.log('Active + not deleted students:', activeStudents.length);

  // Get all classes
  const classes = await Class.find({}).lean();
  console.log('\n=== STUDENTS PER CLASS ===');

  for (const cls of classes) {
    const classStudents = allStudents.filter(s => String(s.classId) === String(cls._id));
    const activeClassStudents = classStudents.filter(s => s.status === 'active' && s.isDeleted !== true);
    console.log(`${cls.name}-${cls.section}: ${activeClassStudents.length} active / ${classStudents.length} total`);
  }

  await mongoose.disconnect();
}

check().catch(console.error);
