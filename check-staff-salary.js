import mongoose from 'mongoose';
import { connectDB, Staff } from './database.js';

async function checkStaffData() {
  await connectDB();

  try {
    const allStaff = await Staff.find({});
    console.log(`Total Staff: ${allStaff.length}`);

    const activeStaff = allStaff.filter(s => {
        const status = (s.status || '').toLowerCase().trim();
        return status === 'active' || !s.status;
    });
    console.log(`Active Staff: ${activeStaff.length}`);

    const staffWithSalary = activeStaff.filter(s => s.salary && s.salary > 0);
    console.log(`Active Staff with Salary > 0: ${staffWithSalary.length}`);

    console.log('\nSample Active Staff:');
    activeStaff.slice(0, 5).forEach(s => {
      console.log(`ID: ${s._id}, Name: ${s.name}, Salary: ${s.salary}, Status: ${s.status}, EmploymentType: ${s.employmentType}`);
    });

    if (staffWithSalary.length === 0) {
        console.log('\n❌ CRITICAL: No active staff have a salary configured. Payroll run will fail for everyone.');
    } else if (staffWithSalary.length < activeStaff.length) {
        console.log(`\n⚠️ WARNING: Only ${staffWithSalary.length} out of ${activeStaff.length} active staff have a salary configured.`);
    } else {
        console.log('\n✅ All active staff have salary configured.');
    }

  } catch (error) {
    console.error('Error checking staff data:', error);
  } finally {
    await mongoose.connection.close();
  }
}

checkStaffData();
