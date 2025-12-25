import { connectDB, Staff, Student, Class, Counter, Attendance } from './database.js';

async function clearAll() {
  await connectDB();

  await Staff.deleteMany({});
  await Student.deleteMany({});
  await Class.deleteMany({});
  await Attendance.deleteMany({});
  await Counter.deleteMany({});

  // Reset counter to 0
  await Counter.create({ _id: 'staffCode', seq: 0 });

  console.log('All data cleared!');
  console.log('- Staff: 0');
  console.log('- Students: 0');
  console.log('- Classes: 0');
  process.exit(0);
}

clearAll().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
