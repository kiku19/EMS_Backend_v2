/**
 * Script to assign subjects to teachers and create timetables for all classes
 * Usage: node seed-subjects-timetables.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/school_db';
const ACADEMIC_YEAR = '2025-26';

// Schemas
const staffSchema = new mongoose.Schema({
  code: String,
  name: String,
  role: [String],
  staffType: [String],
  department: String,
  status: String,
  isClassTeacher: Boolean,
  classTeacherOf: String,
  teacherAssignments: [{
    subject: String,
    classes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],
    createdAt: { type: Date, default: Date.now }
  }],
}, { strict: false });

const classSchema = new mongoose.Schema({
  name: String,
  section: String,
  classTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  subjects: [String],
  academicYear: { type: String, default: ACADEMIC_YEAR },
}, { strict: false });

const timetableSchema = new mongoose.Schema({
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  academicYear: { type: String, default: ACADEMIC_YEAR },
  periods: [{
    name: String,
    startTime: String,
    endTime: String,
    isBreak: { type: Boolean, default: false }
  }],
  schedule: {
    Monday: [{ subject: String, teacherId: mongoose.Schema.Types.ObjectId, room: String }],
    Tuesday: [{ subject: String, teacherId: mongoose.Schema.Types.ObjectId, room: String }],
    Wednesday: [{ subject: String, teacherId: mongoose.Schema.Types.ObjectId, room: String }],
    Thursday: [{ subject: String, teacherId: mongoose.Schema.Types.ObjectId, room: String }],
    Friday: [{ subject: String, teacherId: mongoose.Schema.Types.ObjectId, room: String }],
    Saturday: [{ subject: String, teacherId: mongoose.Schema.Types.ObjectId, room: String }]
  },
  version: { type: Number, default: 1 }
}, { timestamps: true });

timetableSchema.index({ classId: 1, academicYear: 1 }, { unique: true });

const Staff = mongoose.model('Staff', staffSchema);
const Class = mongoose.model('Class', classSchema);
const Timetable = mongoose.model('Timetable', timetableSchema);

// Default subjects for different grade levels
const PRIMARY_SUBJECTS = ['English', 'Hindi', 'Mathematics', 'Science', 'Social Studies', 'Art', 'Physical Education', 'Computer Science'];
const MIDDLE_SUBJECTS = ['English', 'Hindi', 'Mathematics', 'Science', 'Social Studies', 'Computer Science', 'Physical Education', 'Art'];
const HIGH_SUBJECTS = ['English', 'Hindi', 'Mathematics', 'Science', 'Social Studies', 'Computer Science', 'Physical Education'];

// Default periods configuration
const DEFAULT_PERIODS = [
  { name: 'Period 1', startTime: '08:00', endTime: '08:45', isBreak: false },
  { name: 'Period 2', startTime: '08:45', endTime: '09:30', isBreak: false },
  { name: 'Period 3', startTime: '09:30', endTime: '10:15', isBreak: false },
  { name: 'Break', startTime: '10:15', endTime: '10:30', isBreak: true },
  { name: 'Period 4', startTime: '10:30', endTime: '11:15', isBreak: false },
  { name: 'Period 5', startTime: '11:15', endTime: '12:00', isBreak: false },
  { name: 'Lunch', startTime: '12:00', endTime: '12:45', isBreak: true },
  { name: 'Period 6', startTime: '12:45', endTime: '13:30', isBreak: false },
  { name: 'Period 7', startTime: '13:30', endTime: '14:15', isBreak: false },
  { name: 'Period 8', startTime: '14:15', endTime: '15:00', isBreak: false }
];

// Days of the week
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Map department to subjects
const DEPARTMENT_SUBJECTS = {
  'Mathematics': ['Mathematics'],
  'Science': ['Science', 'Physics', 'Chemistry', 'Biology'],
  'Physics': ['Science', 'Physics'],
  'Chemistry': ['Science', 'Chemistry'],
  'Biology': ['Science', 'Biology'],
  'English': ['English'],
  'Hindi': ['Hindi'],
  'Social Studies': ['Social Studies'],
  'Computer Science': ['Computer Science'],
  'Physical Education': ['Physical Education'],
  'Art': ['Art'],
  'Music': ['Music'],
};

async function seedSubjectsAndTimetables() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Get all teachers and classes
    const teachers = await Staff.find({ role: 'Teacher', status: 'active' }).sort({ name: 1 });
    const classes = await Class.find({}).sort({ name: 1, section: 1 });

    console.log(`\n📚 Found ${teachers.length} teachers and ${classes.length} classes`);

    // =====================
    // STEP 1: Assign subjects to teachers
    // =====================
    console.log('\n=== STEP 1: Assigning Subjects to Teachers ===');

    // Clear existing assignments
    for (const teacher of teachers) {
      teacher.teacherAssignments = [];
    }

    // Assign subjects based on department and class teacher assignment
    for (const teacher of teachers) {
      const subjects = DEPARTMENT_SUBJECTS[teacher.department] || ['General'];
      const assignedClasses = [];

      // Get the class this teacher is a class teacher of
      const classTeacherOfClass = classes.find(c =>
        c.classTeacherId && c.classTeacherId.toString() === teacher._id.toString()
      );

      // Assign subjects to classes based on grade level
      for (const subject of subjects) {
        // Determine which classes to assign based on grade level
        let targetClasses = [];

        // Primary classes (1-4) - lower grade teachers
        // Middle classes (5-7) - middle grade teachers
        // High classes (8-10) - high grade teachers

        const classGrade = classTeacherOfClass ? parseInt(classTeacherOfClass.name.replace('Class ', '')) : 5;

        if (classGrade <= 4) {
          // Primary teacher - assign to classes 1-4
          targetClasses = classes.filter(c => {
            const grade = parseInt(c.name.replace('Class ', ''));
            return grade >= 1 && grade <= 4;
          });
        } else if (classGrade <= 7) {
          // Middle teacher - assign to classes 5-7
          targetClasses = classes.filter(c => {
            const grade = parseInt(c.name.replace('Class ', ''));
            return grade >= 5 && grade <= 7;
          });
        } else {
          // High teacher - assign to classes 8-10
          targetClasses = classes.filter(c => {
            const grade = parseInt(c.name.replace('Class ', ''));
            return grade >= 8 && grade <= 10;
          });
        }

        // Create assignment
        if (targetClasses.length > 0) {
          teacher.teacherAssignments.push({
            subject,
            classes: targetClasses.map(c => c._id),
            createdAt: new Date()
          });
          console.log(`  📝 ${teacher.name} (${teacher.department}): ${subject} → ${targetClasses.length} classes`);
        }
      }

      await teacher.save();
    }

    console.log(`\n✅ Assigned subjects to ${teachers.length} teachers`);

    // =====================
    // STEP 2: Create timetables for all classes
    // =====================
    console.log('\n=== STEP 2: Creating Timetables for All Classes ===');

    // Delete existing timetables for this academic year
    await Timetable.deleteMany({ academicYear: ACADEMIC_YEAR });
    console.log('  🗑️ Cleared existing timetables');

    // Reload teachers with updated assignments
    const updatedTeachers = await Staff.find({ role: 'Teacher', status: 'active' });

    let createdCount = 0;

    for (const cls of classes) {
      // Get subjects for this class based on grade level
      const grade = parseInt(cls.name.replace('Class ', ''));
      let classSubjects = grade <= 4 ? [...PRIMARY_SUBJECTS] :
                          grade <= 7 ? [...MIDDLE_SUBJECTS] :
                          [...HIGH_SUBJECTS];

      // Update class subjects
      cls.subjects = classSubjects;
      await cls.save();

      // Create timetable
      const timetable = new Timetable({
        classId: cls._id,
        academicYear: ACADEMIC_YEAR,
        periods: DEFAULT_PERIODS,
        schedule: {
          Monday: [],
          Tuesday: [],
          Wednesday: [],
          Thursday: [],
          Friday: [],
          Saturday: []
        }
      });

      // Generate schedule for each day
      for (const day of DAYS) {
        const daySchedule = [];
        let subjectIndex = 0;

        for (let periodIdx = 0; periodIdx < DEFAULT_PERIODS.length; periodIdx++) {
          const period = DEFAULT_PERIODS[periodIdx];

          if (period.isBreak) {
            // Break period - no class
            daySchedule.push({
              subject: '',
              teacherId: null,
              room: ''
            });
          } else {
            // Regular period - assign subject and teacher
            const subject = classSubjects[subjectIndex % classSubjects.length];

            // Find a teacher who teaches this subject and can teach this class
            const eligibleTeachers = updatedTeachers.filter(t =>
              t.teacherAssignments.some(a =>
                a.subject === subject &&
                a.classes.some(c => c.toString() === cls._id.toString())
              )
            );

            // Pick a teacher (preferably the class teacher if they teach this subject)
            let selectedTeacher = eligibleTeachers.find(t =>
              cls.classTeacherId && t._id.toString() === cls.classTeacherId.toString()
            );

            if (!selectedTeacher && eligibleTeachers.length > 0) {
              // Rotate through eligible teachers to distribute load
              selectedTeacher = eligibleTeachers[periodIdx % eligibleTeachers.length];
            }

            daySchedule.push({
              subject: subject,
              teacherId: selectedTeacher ? selectedTeacher._id : null,
              room: `Room ${cls.name.replace('Class ', '')}-${cls.section}`
            });

            subjectIndex++;
          }
        }

        timetable.schedule[day] = daySchedule;
      }

      await timetable.save();
      createdCount++;

      const classTeacher = updatedTeachers.find(t =>
        cls.classTeacherId && t._id.toString() === cls.classTeacherId.toString()
      );

      console.log(`  ✅ Created timetable for ${cls.name}-${cls.section} (Teacher: ${classTeacher?.name || 'Unassigned'})`);
    }

    // =====================
    // Summary
    // =====================
    console.log('\n=== SUMMARY ===');
    console.log(`✅ Subject assignments created for ${teachers.length} teachers`);
    console.log(`✅ Timetables created for ${createdCount} classes`);
    console.log(`📅 Academic Year: ${ACADEMIC_YEAR}`);
    console.log(`⏰ Periods per day: ${DEFAULT_PERIODS.filter(p => !p.isBreak).length}`);
    console.log(`📆 Working days: ${DAYS.length}`);

    // Show sample timetable
    const sampleTimetable = await Timetable.findOne().populate('classId');
    if (sampleTimetable) {
      console.log(`\n=== SAMPLE TIMETABLE (${sampleTimetable.classId.name}-${sampleTimetable.classId.section}) ===`);
      console.log('Monday:');
      sampleTimetable.schedule.Monday.forEach((slot, idx) => {
        if (slot.subject) {
          console.log(`  Period ${idx + 1}: ${slot.subject}`);
        } else {
          console.log(`  Period ${idx + 1}: Break`);
        }
      });
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

seedSubjectsAndTimetables();
