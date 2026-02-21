import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/school_db';

const staffSchema = new mongoose.Schema({
  code: String,
  name: String,
  role: [String],
  department: String,
  status: String,
  isClassTeacher: Boolean,
  classTeacherOf: String,
}, { strict: false });

const classSchema = new mongoose.Schema({
  name: String,
  section: String,
  classTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
}, { strict: false });

const Staff = mongoose.model('Staff', staffSchema);
const Class = mongoose.model('Class', classSchema);

async function check() {
  await mongoose.connect(MONGODB_URI);

  const staff = await Staff.find({ role: 'Teacher' }).sort({ name: 1 });
  const classes = await Class.find({}).populate('classTeacherId').sort({ name: 1, section: 1 });

  console.log('\n=== STAFF MEMBERS (Teachers) ===');
  console.log('Total:', staff.length);
  staff.forEach(s => {
    const assignment = s.isClassTeacher ? `-> ${s.classTeacherOf}` : '(Unassigned)';
    console.log(`- ${s.name} (${s.department || 'N/A'}) ${assignment}`);
  });

  console.log('\n=== CLASSES WITH TEACHERS ===');
  let assigned = 0;
  let unassigned = 0;
  classes.forEach(c => {
    const teacher = c.classTeacherId?.name || 'Unassigned';
    console.log(`- ${c.name}-${c.section}: ${teacher}`);
    if (c.classTeacherId) assigned++;
    else unassigned++;
  });

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total Teachers: ${staff.length}`);
  console.log(`Total Classes: ${classes.length}`);
  console.log(`Assigned: ${assigned}`);
  console.log(`Unassigned: ${unassigned}`);

  process.exit(0);
}

check();
