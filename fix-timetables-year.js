import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/school_db';

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

const Timetable = mongoose.model('Timetable', timetableSchema);

async function fixAcademicYear() {
  await mongoose.connect(MONGODB_URI);

  // First, check what we have
  const oldYear = await Timetable.countDocuments({ academicYear: '2024-25' });
  const newYear = await Timetable.countDocuments({ academicYear: '2025-26' });

  console.log(`📋 Timetables with 2024-25: ${oldYear}`);
  console.log(`📋 Timetables with 2025-26: ${newYear}`);

  // Delete old 2024-25 timetables
  const deleteResult = await Timetable.deleteMany({ academicYear: '2024-25' });
  console.log(`🗑️ Deleted ${deleteResult.deletedCount} old timetables (2024-25)`);

  // Update 2025-26 to 2024-25
  const updateResult = await Timetable.updateMany(
    { academicYear: '2025-26' },
    { $set: { academicYear: '2024-25' } }
  );
  console.log(`✅ Updated ${updateResult.modifiedCount} timetables to academic year 2024-25`);

  // Verify
  const final = await Timetable.countDocuments({ academicYear: '2024-25' });
  console.log(`📋 Final count with 2024-25: ${final}`);

  process.exit(0);
}

fixAcademicYear();
