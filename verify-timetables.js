import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/school_db';
const ACADEMIC_YEAR = '2025-26';

const staffSchema = new mongoose.Schema({
  code: String,
  name: String,
  department: String,
  teacherAssignments: [{
    subject: String,
    classes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
  }],
}, { strict: false });

const classSchema = new mongoose.Schema({
  name: String,
  section: String,
  classTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  subjects: [String],
}, { strict: false });

const timetableSchema = new mongoose.Schema({
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
  academicYear: String,
  periods: [{
    name: String,
    startTime: String,
    endTime: String,
    isBreak: Boolean
  }],
  schedule: {
    Monday: [{ subject: String, teacherId: mongoose.Schema.Types.ObjectId, room: String }],
    Tuesday: [{ subject: String, teacherId: mongoose.Schema.Types.ObjectId, room: String }],
    Wednesday: [{ subject: String, teacherId: mongoose.Schema.Types.ObjectId, room: String }],
    Thursday: [{ subject: String, teacherId: mongoose.Schema.Types.ObjectId, room: String }],
    Friday: [{ subject: String, teacherId: mongoose.Schema.Types.ObjectId, room: String }],
    Saturday: [{ subject: String, teacherId: mongoose.Schema.Types.ObjectId, room: String }]
  }
}, { timestamps: true });

const Staff = mongoose.model('Staff', staffSchema);
const Class = mongoose.model('Class', classSchema);
const Timetable = mongoose.model('Timetable', timetableSchema);

async function verifyAndShow() {
  await mongoose.connect(MONGODB_URI);

  // Get all data
  const classes = await Class.find({}).populate('classTeacherId').sort({ name: 1, section: 1 });
  const teachers = await Staff.find({}).populate('teacherAssignments.classes');

  console.log('\n=== TEACHER SUBJECT ASSIGNMENTS ===\n');
  for (const teacher of teachers) {
    if (!teacher.teacherAssignments || teacher.teacherAssignments.length === 0) continue;

    console.log(`${teacher.name} (${teacher.department || 'N/A'}):`);
    for (const assignment of teacher.teacherAssignments) {
      const classNames = assignment.classes
        .filter(c => c)
        .map(c => `${c.name}-${c.section}`)
        .join(', ');
      console.log(`  - ${assignment.subject}: ${classNames || 'No classes'}`);
    }
    console.log('');
  }

  console.log('\n=== CLASS TIMETABLES ===\n');
  for (const cls of classes) {
    const timetable = await Timetable.findOne({ classId: cls._id, academicYear: ACADEMIC_YEAR });

    console.log(`${cls.name}-${cls.section} (Teacher: ${cls.classTeacherId?.name || 'Unassigned'})`);
    console.log(`Subjects: ${cls.subjects?.join(', ') || 'None'}`);

    if (timetable) {
      console.log('Monday Schedule:');
      timetable.schedule.Monday.forEach((slot, idx) => {
        const period = timetable.periods[idx];
        if (period?.isBreak) {
          console.log(`  ${idx + 1}. ${period.name} (${period.startTime}-${period.endTime})`);
        } else if (slot.subject) {
          console.log(`  ${idx + 1}. ${slot.subject} (Room: ${slot.room || 'TBD'})`);
        } else {
          console.log(`  ${idx + 1}. Free Period`);
        }
      });
    } else {
      console.log('  No timetable found');
    }
    console.log('');
  }

  process.exit(0);
}

verifyAndShow();
