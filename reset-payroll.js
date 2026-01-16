import mongoose from 'mongoose';
import dotenv from 'dotenv';
import PayrollRecord from './models/PayrollRecord.js';
import PayrollRun from './models/PayrollRun.js';

dotenv.config();

async function resetPayroll() {
  try {
    // Connect to MongoDB
    const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/school_db';
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Delete all payroll records
    const recordsDeleted = await PayrollRecord.deleteMany({});
    console.log(`🗑️  Deleted ${recordsDeleted.deletedCount} payroll records`);

    // Delete all payroll runs
    const runsDeleted = await PayrollRun.deleteMany({});
    console.log(`🗑️  Deleted ${runsDeleted.deletedCount} payroll runs`);

    console.log('✅ Payroll data reset complete!');
    console.log('💡 You can now run payroll again from the UI');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error resetting payroll:', error);
    process.exit(1);
  }
}

resetPayroll();
