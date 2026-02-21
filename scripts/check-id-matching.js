import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/school_db';

async function check() {
  await mongoose.connect(MONGO_URI);

  const Student = mongoose.model('Student', new mongoose.Schema({}, { collection: 'students', strict: false }));
  const Class = mongoose.model('Class', new mongoose.Schema({ name: String, section: String }, { collection: 'classes' }));

  const classes = await Class.find({}).lean();
  const students = await Student.find({ status: 'active', isDeleted: { $ne: true } }).lean();

  console.log('=== CLASS ID TO STUDENT MAPPING ===\n');

  for (const cls of classes) {
    // Simulate exactly what the frontend does
    const classStudents = students.filter(s => String(s.classId) === String(cls._id));

    console.log(`Class ${cls.name}-${cls.section}:`);
    console.log(`  Class _id: ${cls._id}`);
    console.log(`  Class _id type: ${typeof cls._id}`);
    console.log(`  Active students count: ${classStudents.length}`);

    if (classStudents.length > 0 && classStudents.length < 3) {
      console.log(`  Students:`);
      classStudents.forEach(s => {
        console.log(`    - ${s.name} (classId: ${s.classId}, type: ${typeof s.classId})`);
      });
    }
    console.log('');
  }

  // Check for orphaned students
  const classIds = new Set(classes.map(c => String(c._id)));
  const orphanedStudents = students.filter(s => !classIds.has(String(s.classId)));

  if (orphanedStudents.length > 0) {
    console.log('=== ORPHANED STUDENTS (classId not in classes collection) ===');
    orphanedStudents.forEach(s => {
      console.log(`  ${s.name}: classId=${s.classId}`);
    });
  }

  await mongoose.disconnect();
}

check().catch(console.error);
