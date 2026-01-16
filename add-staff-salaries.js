import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function addStaffSalaries() {
  try {
    // Connect to MongoDB
    const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/school_db';
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Define Staff schema (minimal)
    const staffSchema = new mongoose.Schema({}, { strict: false });
    const Staff = mongoose.model('Staff', staffSchema);

    // Get all staff
    const staff = await Staff.find({});
    console.log(`📋 Found ${staff.length} staff members`);

    // Salary ranges based on role
    const salaryByRole = {
      'Principal': { min: 45000, max: 60000 },
      'Vice Principal': { min: 40000, max: 50000 },
      'Teacher': { min: 25000, max: 40000 },
      'Admin': { min: 20000, max: 30000 },
      'Librarian': { min: 18000, max: 25000 },
      'Lab Assistant': { min: 15000, max: 22000 },
      'Accountant': { min: 25000, max: 35000 },
      'Receptionist': { min: 15000, max: 20000 },
      'Peon': { min: 12000, max: 18000 },
      'default': { min: 20000, max: 30000 }
    };

    let updated = 0;
    for (const member of staff) {
      // Skip if already has salary
      if (member.salary && member.salary > 0) {
        console.log(`⏭️  ${member.name} already has salary: ₹${member.salary}`);
        continue;
      }

      // Get salary range for role
      const range = salaryByRole[member.role] || salaryByRole['default'];
      
      // Generate random salary within range
      const salary = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
      
      // Round to nearest 1000
      const roundedSalary = Math.round(salary / 1000) * 1000;

      // Update staff member
      await Staff.updateOne(
        { _id: member._id },
        { $set: { salary: roundedSalary } }
      );

      console.log(`✅ ${member.name} (${member.role}): ₹${roundedSalary}`);
      updated++;
    }

    console.log(`\n🎉 Updated ${updated} staff members with salaries`);
    console.log('💡 You can now run payroll successfully!');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

addStaffSalaries();
