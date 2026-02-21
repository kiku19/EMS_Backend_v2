import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/school_db';

const staffSchema = new mongoose.Schema({
  code: { type: String, unique: true },
  name: String,
  role: [String],
  staffType: [String],
  department: String,
  status: String,
  phone: String,
  email: String,
  isClassTeacher: Boolean,
  classTeacherOf: String,
  password: String,
}, { strict: false });

staffSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

const classSchema = new mongoose.Schema({
  name: String,
  section: String,
  classTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
}, { strict: false });

const Staff = mongoose.model('Staff', staffSchema);
const Class = mongoose.model('Class', classSchema);

async function completeAssignments() {
  await mongoose.connect(MONGODB_URI);

  // Create a new teacher for 9-B
  // Get the highest existing code number
  const lastStaff = await Staff.findOne({ code: /^EMP\d+$/ }).sort({ code: -1 });
  const lastCodeNum = lastStaff ? parseInt(lastStaff.code.replace('EMP', '')) : 0;
  const staffCode = `EMP${String(lastCodeNum + 1).padStart(3, '0')}`;
  console.log(`📋 Next staff code: ${staffCode} (last was EMP${lastCodeNum})`);

  const newTeacher = new Staff({
    code: staffCode,
    name: 'Sanjay Kapoor',
    role: ['Teacher'],
    staffType: ['Teacher'],
    department: 'Mathematics',
    phone: '9876543290',
    email: 'sanjay.kapoor@school.edu',
    username: 'sanjay.kapoor',
    password: 'password123',
    status: 'active',
    isClassTeacher: false,
  });

  await newTeacher.save();
  console.log(`✅ Created new teacher: ${newTeacher.name} (${newTeacher.code})`);

  // Find and assign to 9-B
  const class9B = await Class.findOne({ name: 'Class 9', section: 'B' });
  if (class9B) {
    class9B.classTeacherId = newTeacher._id;
    await class9B.save();

    newTeacher.isClassTeacher = true;
    newTeacher.classTeacherOf = 'Class 9-B';
    await newTeacher.save();

    console.log(`✅ Assigned ${newTeacher.name} to Class 9-B`);
  }

  // Final verification
  const classes = await Class.find({}).populate('classTeacherId').sort({ name: 1, section: 1 });

  console.log('\n=== FINAL CLASS ASSIGNMENTS ===');
  let assigned = 0;
  let unassigned = 0;

  classes.forEach(c => {
    const teacher = c.classTeacherId?.name || 'Unassigned';
    const status = c.classTeacherId ? '✅' : '❌';
    console.log(`${status} ${c.name}-${c.section}: ${teacher}`);
    if (c.classTeacherId) assigned++;
    else unassigned++;
  });

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total Classes: ${classes.length}`);
  console.log(`Assigned: ${assigned}`);
  console.log(`Unassigned: ${unassigned}`);
  console.log(`\n🎉 All ${assigned} classes now have class teachers!`);

  process.exit(0);
}

completeAssignments();
