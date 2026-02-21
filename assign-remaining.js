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

async function assignRemaining() {
  await mongoose.connect(MONGODB_URI);

  // Get unassigned teachers
  const unassignedTeachers = await Staff.find({
    role: 'Teacher',
    $or: [
      { isClassTeacher: false },
      { isClassTeacher: null },
      { classTeacherOf: null }
    ]
  });

  // Get classes without teachers
  const classesWithoutTeachers = await Class.find({
    classTeacherId: null
  }).sort({ name: 1, section: 1 });

  console.log(`\n📋 Unassigned teachers: ${unassignedTeachers.length}`);
  console.log(`📚 Classes without teachers: ${classesWithoutTeachers.length}`);

  // Assign remaining teachers
  const assignments = [
    { className: '8-A', teacher: 'Priya Sharma' },
    { className: '8-B', teacher: 'Mohan Reddy' },
    { className: '9-A', teacher: 'Sunita Singh' },
  ];

  for (const assignment of assignments) {
    const [name, section] = assignment.className.split('-');
    const cls = await Class.findOne({ name: `Class ${name}`, section });
    const teacher = await Staff.findOne({ name: assignment.teacher });

    if (cls && teacher) {
      cls.classTeacherId = teacher._id;
      await cls.save();

      teacher.isClassTeacher = true;
      teacher.classTeacherOf = `${cls.name}-${cls.section}`;
      await teacher.save();

      console.log(`✅ Assigned ${teacher.name} to ${cls.name}-${cls.section}`);
    }
  }

  // Final summary
  const staff = await Staff.find({ role: 'Teacher' }).sort({ name: 1 });
  const classes = await Class.find({}).populate('classTeacherId').sort({ name: 1, section: 1 });

  console.log('\n=== FINAL SUMMARY ===');
  console.log(`Total Teachers: ${staff.length}`);

  let assigned = 0;
  let unassigned = 0;
  classes.forEach(c => {
    if (c.classTeacherId) assigned++;
    else unassigned++;
  });

  console.log(`Classes with teachers: ${assigned}`);
  console.log(`Classes without teachers: ${unassigned}`);

  console.log('\n=== ALL CLASS ASSIGNMENTS ===');
  classes.forEach(c => {
    const teacher = c.classTeacherId?.name || 'Unassigned';
    console.log(`- ${c.name}-${c.section}: ${teacher}`);
  });

  process.exit(0);
}

assignRemaining();
